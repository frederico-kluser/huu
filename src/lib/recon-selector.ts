/**
 * Selector LLM: takes the user's intent + a tiny project hint + the catalog
 * description list, and returns an array of selections — each one either a
 * catalog id string or a custom `{title, prompt}` object. The recon stage
 * then resolves these into runnable items and fans them out in parallel.
 *
 * The selector replaces the old "always run all 4 fixed agents" behavior:
 * the AI now picks what's actually needed for the user's intent (max 10),
 * and can also request fully custom missions when the catalog doesn't cover
 * an angle. We keep the call cheap and structured — minimax-m2.7 with
 * function-calling, no chain-of-thought baked in.
 */

import { z } from 'zod';
import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import {
  RECON_CATALOG,
  type ReconCatalogEntry,
} from './project-recon-prompts.js';
import { MAX_SELECTIONS, type RawSelection } from './recon-resolve.js';
import { log as dlog } from './debug-logger.js';

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const OPENROUTER_HEADERS = {
  'HTTP-Referer': 'https://github.com/frederico-kluser/huu',
  'X-OpenRouter-Title': 'huu',
};

/**
 * Default selector model — same family/tier as the recon agents themselves,
 * since the work is similar (one structured-output call against a short
 * context). Override via the `modelId` option if you want a heavier brain.
 */
export const SELECTOR_MODEL = 'minimax/minimax-m2.7';

/**
 * Selector output schema. Each `selections[i]` is EITHER a string (catalog
 * id, fuzzy-resolved later) OR an object with `{title, prompt}` for a custom
 * mission. We let zod accept the heterogeneous array because that's the
 * shape the prompt asks for; the resolver downstream is the source of truth
 * for normalization, dedup, and dropping unresolvable strings.
 */
export const SelectionSchema = z.union([
  z.string().min(1).max(80),
  z.object({
    title: z.string().min(1).max(80),
    prompt: z.string().min(20).max(1500),
  }),
]);

export const SelectorOutputSchema = z.object({
  selections: z.array(SelectionSchema).min(1).max(MAX_SELECTIONS),
});
export type SelectorOutput = z.infer<typeof SelectorOutputSchema>;

export interface RunSelectorOptions {
  apiKey: string;
  /** What the user wants the pipeline to do — drives every pick. */
  intent: string;
  /** Optional project hint (name + 1-paragraph summary). Helps the selector
   *  skip catalog items that obviously don't apply. */
  projectHint?: string;
  modelId?: string;
  signal?: AbortSignal;
}

function buildCatalogList(catalog: readonly ReconCatalogEntry[]): string {
  return catalog.map((e) => `- ${e.id} — ${e.description}`).join('\n');
}

export function buildSelectorSystemPrompt(
  catalog: readonly ReconCatalogEntry[] = RECON_CATALOG,
): string {
  return `Você é o SELETOR de reconhecimento. Sua única responsabilidade: dado o que o usuário quer fazer (intent) e um hint mínimo do projeto, escolher quais processos de reconhecimento devem rodar para alimentar a entrevista do assistente de pipeline.

# Como funciona

- Existe um catálogo de processos pré-definidos (lista abaixo). Cada um lê um digest estático do projeto e devolve 2-6 bullets factuais.
- Os bullets de TODOS os processos selecionados são concatenados e injetados como contexto na próxima entrevista. O assistente lê esse contexto antes de fazer perguntas ao usuário.
- Você escolhe O QUE rodar. Se um processo do catálogo cobre o que precisa, retorne o ID dele (string). Se nada do catálogo cobre algum aspecto crítico, retorne um objeto \`{title, prompt}\` com uma missão CUSTOM.

# Catálogo

${buildCatalogList(catalog)}

# Como decidir

- Pense: "para responder bem ao intent do usuário, quais aspectos do projeto eu preciso conhecer?"
- Escolha o MÍNIMO necessário. Mais não é melhor — cada processo extra é latência e custo. Tipicamente 2-5 processos resolvem; só passe disso se o intent for genuinamente multi-domínio.
- Se o intent for específico ("rodar prettier em src/"), escolha 2-3 processos relevantes (\`stack\`, \`quality-tooling\`, \`structure\`).
- Se o intent for vago ("melhorar o projeto"), escolha 4-6 processos para mapear o terreno.
- Se um aspecto não estiver no catálogo (ex: "como o módulo X usa o módulo Y", "qual o formato dos arquivos de config em /etc"), use um item custom.

# Regra dura: máximo 10 itens no array.

# Itens custom (\`{title, prompt}\`)

- \`title\`: ≤ 60 caracteres, vai ser exibido como label na UI ("Análise de routing", "Mapeamento de configs").
- \`prompt\`: a missão que o agente vai receber. Seja ESPECÍFICO: diga (a) qual seção do digest olhar (\`## File tree\`, \`package.json\`, \`README.md\`, \`CLAUDE.md\`, \`AGENTS.md\`, \`tsconfig.json\`), (b) o que extrair, (c) quantos bullets esperar (2-6). Use o tom imperativo, igual aos missions do catálogo. NÃO defina formato de saída — isso é fixo.

# Strings (catalog refs)

- Sempre que possível, use o ID EXATO do catálogo (ex: \`stack\`, \`build-deploy\`, \`pain-points\`).
- Vamos validar com fuzzy match, mas IDs exatos são mais rápidos e confiáveis.

# Saída

JSON estruturado:
\`\`\`
{
  "selections": [
    "stack",
    "structure",
    { "title": "...", "prompt": "..." }
  ]
}
\`\`\`

- Mínimo 1, máximo 10 itens.
- Cada item é UMA STRING (id do catálogo) OU UM OBJETO {title, prompt}.
- Sem campos extras, sem comentários, sem preâmbulo.`;
}

export function buildSelectorHumanMessage(intent: string, projectHint?: string): string {
  const hint = projectHint?.trim();
  const hintBlock = hint ? `\n\n## Hint do projeto\n${hint}` : '';
  return `## Intent do usuário\n${intent.trim()}${hintBlock}`;
}

/**
 * Calls the selector LLM and returns the raw (unresolved) array. Throws on
 * network/auth/parse errors — the UI is expected to catch and fall back to
 * the core-4 catalog items so the recon stage never dead-ends.
 */
export async function runReconSelector(
  opts: RunSelectorOptions,
): Promise<RawSelection[]> {
  const stub =
    process.env.HUU_LANGCHAIN_STUB === '1' || opts.apiKey.trim() === 'stub';
  if (stub) return runStubSelector(opts);

  const apiKey = opts.apiKey.trim();
  if (!apiKey) throw new Error('OpenRouter API key ausente.');
  const modelId = (opts.modelId ?? SELECTOR_MODEL).trim();

  const chat = new ChatOpenAI({
    model: modelId,
    temperature: 0,
    maxTokens: 800,
    configuration: {
      baseURL: OPENROUTER_BASE_URL,
      apiKey,
      defaultHeaders: OPENROUTER_HEADERS,
    },
  });
  const structured = chat.withStructuredOutput(SelectorOutputSchema, {
    name: 'ReconSelector',
    method: 'functionCalling',
  });

  const messages = [
    new SystemMessage(buildSelectorSystemPrompt()),
    new HumanMessage(buildSelectorHumanMessage(opts.intent, opts.projectHint)),
  ];

  const raw = (await structured.invoke(messages, {
    signal: opts.signal,
  })) as SelectorOutput;
  const parsed = SelectorOutputSchema.parse(raw);
  dlog('action', 'recon-selector.picked', {
    count: parsed.selections.length,
    catalogRefs: parsed.selections.filter((s) => typeof s === 'string').length,
    custom: parsed.selections.filter((s) => typeof s !== 'string').length,
  });
  return parsed.selections;
}

/**
 * Deterministic stub: returns 3 catalog refs + 1 custom. Exercises both code
 * paths in tests and offline `--stub` runs without touching the network.
 */
async function runStubSelector(_opts: RunSelectorOptions): Promise<RawSelection[]> {
  return [
    'stack',
    'structure',
    'libraries',
    {
      title: 'Stub custom mission',
      prompt:
        'OLHE APENAS o `## File tree` e liste arquivos em `scripts/` se existirem. Caso contrário, retorne um bullet "sem scripts/ no file tree".',
    },
  ];
}

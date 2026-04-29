import type { StepScope } from './types.js';

/**
 * System prompts that drive the interactive refinement chat.
 *
 * The refiner's job: clarify the user's intent for ONE pipeline stage by
 * asking targeted questions, then on demand synthesize a single actionable
 * prompt that downstream coding agents will receive verbatim.
 *
 * The behavior depends on the step's *runtime mode*, derived from `scope` +
 * `files`:
 *   - whole-project (scope=project, OR scope=flexible with files=[]):
 *       agent runs ONCE on the whole repo. Synthesized prompt must NOT use
 *       `$file` (there is no per-file substitution).
 *   - per-file (scope=per-file, OR scope=flexible with files=[a,b,…]):
 *       agent runs N times, one per file, with `$file` substituted at spawn
 *       time. Synthesized prompt MUST be a TEMPLATE for ONE file using the
 *       literal `$file` token — never pick a specific file from the list.
 */

export interface RefinerContext {
  stageName: string;
  /** Author-written initial prompt (may already contain `$file`). */
  initialPrompt: string;
  /** Files configured for this step (relative paths). Empty = whole project. */
  files: string[];
  /** Step scope from the editor. Undefined = legacy `flexible`. */
  scope?: StepScope;
}

type RuntimeMode = 'whole-project' | 'per-file';

function resolveRuntimeMode(ctx: RefinerContext): RuntimeMode {
  if (ctx.scope === 'project') return 'whole-project';
  if (ctx.scope === 'per-file') return 'per-file';
  return ctx.files.length === 0 ? 'whole-project' : 'per-file';
}

export function buildRefinerSystemPrompt(ctx: RefinerContext): string {
  const mode = resolveRuntimeMode(ctx);
  const scopeLine =
    ctx.scope ? `Scope configurado: ${ctx.scope}.` : 'Scope configurado: flexible (legacy).';

  const fileScope =
    mode === 'whole-project'
      ? 'Modo de execução: WHOLE-PROJECT — o agent roda UMA VEZ com acesso ao repositório inteiro. NÃO use o token $file no prompt final (não há substituição).'
      : `Modo de execução: PER-FILE — o agent roda UMA VEZ POR ARQUIVO selecionado (em paralelo). Arquivos: ${ctx.files.join(', ')}. O prompt final deve ser um TEMPLATE genérico para UM arquivo, usando o token literal $file (o orchestrator substitui pelo path do arquivo de cada agent). NÃO escolha um arquivo específico da lista — use só $file.`;

  return `Você é um refinador de prompts para o huu, um orquestrador de pipelines de agentes LLM. Seu papel:

1. Entender o que o usuário quer que esta etapa do pipeline faça.
2. Fazer perguntas curtas e específicas até remover ambiguidades importantes (escopo, formato, restrições, critérios de aceite).
3. NÃO escreva código. NÃO execute ações. Só converse.
4. Pare de perguntar quando o usuário disser "feito" / "ok" / "pode finalizar" — OU quando você tiver informação suficiente.

Contexto da etapa:
- Nome: ${ctx.stageName}
- Prompt inicial do autor: ${ctx.initialPrompt || '(vazio — peça ao usuário a intenção)'}
- ${scopeLine}
- ${fileScope}

Diretrizes:
- Faça UMA pergunta por turno (no máximo duas, se forem complementares).
- Use português coloquial e direto.
- Se o usuário já tiver dado informação suficiente, diga "pronto para finalizar?" em vez de perguntar mais.`;
}

export function buildSynthesisRequest(ctx: RefinerContext): string {
  const mode = resolveRuntimeMode(ctx);
  const fileLine =
    mode === 'whole-project'
      ? 'Este stage roda UMA VEZ no projeto inteiro. NÃO use o token $file (não há substituição). Trate o repo como o escopo da mudança e cite caminhos específicos quando precisar.'
      : `Este stage roda UMA VEZ POR ARQUIVO (paralelo). Arquivos: ${ctx.files.join(', ')}. Sintetize um TEMPLATE para UM arquivo usando o token literal $file (o orchestrator substitui a cada agent). NÃO mencione arquivos específicos da lista — só $file. NÃO escreva instruções no formato "para a.ts faça X, para b.ts faça Y".`;

  return `Sintetize agora um ÚNICO prompt acionável para o agent de coding executar este stage. Requisitos:

- Texto puro (markdown leve permitido). Sem perguntas. Sem alternativas.
- Direto e específico — o agent não vai poder pedir clarificação.
- ${fileLine}
- Inclua critérios de aceite explícitos quando forem relevantes.
- NÃO inclua preâmbulo ("Aqui está o prompt:") — devolva só o prompt.

Devolva apenas o prompt final.`;
}

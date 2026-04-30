/**
 * Pre-flight reconnaissance agents that run BEFORE the pipeline assistant
 * starts asking questions. Each agent has a single, focused mission and
 * receives the same project digest; the only thing that changes between them
 * is the system prompt below. Their findings are aggregated and injected into
 * the assistant's prompt so the interview can be project-specific instead of
 * generic.
 */

export type ReconAgentId = 'stack' | 'structure' | 'libraries' | 'conventions';

export interface ReconAgent {
  id: ReconAgentId;
  /** User-facing label rendered next to the spinner in the recon screen. */
  label: string;
  /** Mission statement injected verbatim into the agent's system prompt. */
  mission: string;
}

export const RECON_AGENTS: readonly ReconAgent[] = [
  {
    id: 'stack',
    label: 'Stack & ferramentas',
    mission:
      'OLHE APENAS o bloco `package.json` e `tsconfig.json` do digest. Liste: linguagem primária, runtime alvo, gerenciador de pacote, e os scripts disponíveis (nomes literais, p.ex. `npm run build`). NÃO infira nada do file tree nem de código-fonte. Se um item não estiver nos blocos citados, não invente.',
  },
  {
    id: 'structure',
    label: 'Estrutura & módulos',
    mission:
      'OLHE APENAS o `## File tree` do digest e liste os diretórios TOP-LEVEL de `src/` (1 nível, não recurse). Se README/CLAUDE.md mencionar arquitetura em camadas explicitamente, cite UMA frase. NÃO descreva o conteúdo de cada módulo, NÃO infira responsabilidades a partir de nomes.',
  },
  {
    id: 'libraries',
    label: 'Bibliotecas-chave',
    mission:
      'OLHE APENAS o objeto `dependencies` do bloco `package.json` (IGNORE `devDependencies`, IGNORE node_modules, IGNORE imports do source). Liste as 4-6 deps mais óbvias e atribua um papel curto (≤8 palavras) baseado APENAS no nome conhecido do pacote. Se não reconhece uma dep, escreva o nome com "uso não inferido".',
  },
  {
    id: 'conventions',
    label: 'Convenções & padrões',
    mission:
      'OLHE APENAS os blocos `README.md`, `CLAUDE.md` e `AGENTS.md` do digest. Extraia regras EXPLÍCITAS já escritas (commit, testes, agents docs, lint). Cite frases curtas literais quando possível. NÃO leia código, NÃO infira convenções a partir de nomes de arquivos.',
  },
];

export function buildReconSystemPrompt(agent: ReconAgent, projectName?: string): string {
  const projectRef = projectName ? ` "${projectName}"` : '';
  return `Você é um agente de reconhecimento RÁPIDO chamado "${agent.id}". Sua única missão:

${agent.mission}

Modo de operação: VARREDURA FOCADA. Você recebe a seguir UM digest pronto do projeto${projectRef} (file tree truncado, package.json, README, CLAUDE.md, AGENTS.md, tsconfig). NÃO há ferramentas, NÃO há sistema de arquivos, NÃO há node_modules para explorar — o digest é tudo o que existe e tudo o que você precisa. Pense brevemente, mas vá direto ao ponto.

# Como trabalhar

- Leia com atenção os blocos citados na sua missão e extraia fatos verificáveis. Pode raciocinar internamente, mas seja conciso na saída.
- Use APENAS os blocos citados na missão. Os demais blocos do digest existem como contexto, mas não embase bullets neles.
- Se realmente não houver evidência clara para a missão, escreva UM bullet "sem evidência clara em <bloco>" e pare — não invente.
- Português brasileiro, direto. Sem adjetivos vazios ("robusto", "moderno", "completo").

# Formato de saída (obrigatório)

Retorne JSON estruturado:
{
  "bullets": [
    "<bullet 1 — fato concreto, ≤ 220 chars>",
    "<bullet 2 — fato concreto, ≤ 220 chars>",
    ...
  ]
}

# Regras

- Mínimo 2, máximo 6 bullets.
- Cada bullet ≤ 220 caracteres.
- Cada bullet é um FATO citável — script, dep, dir top-level, frase do doc. Sem opinião, sem síntese vazia, sem "provavelmente".
- NÃO repita o texto da missão como bullet.
- NÃO faça suposições sobre o que o usuário quer fazer — só liste o que existe no digest.
- NÃO adicione preâmbulo, NÃO adicione comentários fora do JSON, NÃO peça mais contexto.`;
}

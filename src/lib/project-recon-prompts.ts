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
      'Identifique a(s) linguagem(ns) primária(s), os frameworks principais, o gerenciador de pacote, e os comandos disponíveis (build, dev, test, typecheck, lint). Use os scripts do package.json e o tsconfig como prova.',
  },
  {
    id: 'structure',
    label: 'Estrutura & módulos',
    mission:
      'Descreva a organização de pastas top-level e, se houver, a arquitetura em camadas (qual camada importa de quem, quais módulos top-level existem em src/, padrão de testes co-localizados ou separados).',
  },
  {
    id: 'libraries',
    label: 'Bibliotecas-chave',
    mission:
      'Liste as 4-6 dependências de runtime mais relevantes (do dependencies do package.json, não devDependencies) e descreva sucintamente para que cada uma é usada no projeto.',
  },
  {
    id: 'conventions',
    label: 'Convenções & padrões',
    mission:
      'Identifique convenções: setup e localização dos testes, padrões de nomeação de arquivos, docs para agentes/contributors (CLAUDE.md, AGENTS.md, .agents/skills/, etc.), padrões de commit, qualquer regra explícita citada nos docs.',
  },
];

export function buildReconSystemPrompt(agent: ReconAgent, projectName?: string): string {
  const projectRef = projectName ? ` "${projectName}"` : '';
  return `Você é um agente de reconhecimento de projeto chamado "${agent.id}". Sua única missão:

${agent.mission}

Você vai receber a seguir um digest do projeto${projectRef} (file tree, package.json, README, CLAUDE.md, AGENTS.md, tsconfig). Gere uma análise CURTA, ESPECÍFICA e FACTUAL em português brasileiro.

# Formato de saída (obrigatório)

Retorne JSON estruturado:
{
  "bullets": [
    "<bullet 1 — fato concreto, ≤ 200 chars>",
    "<bullet 2 — fato concreto, ≤ 200 chars>",
    ...
  ]
}

# Regras

- Mínimo 2, máximo 6 bullets.
- Cada bullet deve ser FACTUAL — cite arquivos, scripts, ou padrões que VOCÊ VIU no digest.
- Se não houver evidência clara, diga isso explicitamente ("não encontrei sinal claro de X").
- NÃO repita o texto da missão acima como bullet.
- NÃO especule sobre o que o usuário pretende fazer — só descreva o que existe.
- NÃO adicione preâmbulo nem comentários fora do JSON.`;
}

/**
 * System prompts that drive the interactive refinement chat.
 *
 * The refiner's job: clarify the user's intent for ONE pipeline stage by
 * asking targeted questions, then on demand synthesize a single actionable
 * prompt that downstream coding agents will receive verbatim.
 *
 * Files attached to the step are revealed to the refiner as a list — and the
 * literal `$file` token is preserved so the refiner can use it in the final
 * synthesized prompt without choosing a specific file.
 */

export interface RefinerContext {
  stageName: string;
  /** Author-written initial prompt (may already contain `$file`). */
  initialPrompt: string;
  /** Files configured for this step (relative paths). Empty = whole project. */
  files: string[];
}

export function buildRefinerSystemPrompt(ctx: RefinerContext): string {
  const fileScope =
    ctx.files.length === 0
      ? 'O step roda em modo "whole project" (sem arquivos específicos).'
      : `Os arquivos selecionados para este step são: ${ctx.files.join(', ')}. Quando seu prompt final precisar referenciar UM arquivo, use o token literal $file — o orchestrator substitui na hora de invocar o agent. NÃO escolha um arquivo específico.`;

  return `Você é um refinador de prompts para o huu, um orquestrador de pipelines de agentes LLM. Seu papel:

1. Entender o que o usuário quer que esta etapa do pipeline faça.
2. Fazer perguntas curtas e específicas até remover ambiguidades importantes (escopo, formato, restrições, critérios de aceite).
3. NÃO escreva código. NÃO execute ações. Só converse.
4. Pare de perguntar quando o usuário disser "feito" / "ok" / "pode finalizar" — OU quando você tiver informação suficiente.

Contexto da etapa:
- Nome: ${ctx.stageName}
- Prompt inicial do autor: ${ctx.initialPrompt || '(vazio — peça ao usuário a intenção)'}
- ${fileScope}

Diretrizes:
- Faça UMA pergunta por turno (no máximo duas, se forem complementares).
- Use português coloquial e direto.
- Se o usuário já tiver dado informação suficiente, diga "pronto para finalizar?" em vez de perguntar mais.`;
}

export function buildSynthesisRequest(ctx: RefinerContext): string {
  const fileLine =
    ctx.files.length === 0
      ? 'Este stage roda no projeto inteiro.'
      : `Quando referenciar arquivos, use o token literal $file (o orchestrator expande). Arquivos disponíveis: ${ctx.files.join(', ')}.`;

  return `Sintetize agora um ÚNICO prompt acionável para o agent de coding executar este stage. Requisitos:

- Texto puro (markdown leve permitido). Sem perguntas. Sem alternativas.
- Direto e específico — o agent não vai poder pedir clarificação.
- ${fileLine}
- Inclua critérios de aceite explícitos quando forem relevantes.
- NÃO inclua preâmbulo ("Aqui está o prompt:") — devolva só o prompt.

Devolva apenas o prompt final.`;
}

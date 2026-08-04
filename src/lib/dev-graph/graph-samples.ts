// The sample library — hand-drawn methods a human can open, read and change.
//
// WHY SAMPLES ARE NOT A TEMPLATE ENGINE: `emptyDevGraph` deliberately gives a
// new graph nothing but the root, because a pre-drawn topology is a topology
// somebody else underwrote. These samples are the other half of that same
// position — they are not defaults and nothing loads them behind the user's
// back. They are WORKED EXAMPLES: the human opens one, reads a method someone
// wrote down, and either adopts it knowingly or throws it away. That is the
// difference between a method you subscribe to and a method that happened to
// you.
//
// Every sample here compiles the same promise: it passes `validateGraph` with
// ZERO errors (the colocated test is the net), it lays out on the canvas without
// overlapping, and `build(now)` is deterministic given `now`.
//
// LANGUAGE, and the split is not arbitrary — it follows the text's READER:
//  - labels, descriptions, notes and `prompt.goal` are pt-BR: they are read by
//    the human, and `DEVGRAPH_DEFAULT_GOAL` set that precedent;
//  - `research.query` is pt-BR because `research-contract.ts` wraps it in a
//    pt-BR agent prompt;
//  - `gate.condition` is ENGLISH because `check-evaluator.ts` wraps it in an
//    English judge prompt, exactly like every bundled pipeline's condition.
// Mixing the language of a prompt with the language of its frame is a quality
// loss nobody measures until the verdicts get strange.
//
// Keep this file PURE — no fs, no env. The single tolerated impurity is
// `build()`'s default timestamp, which mirrors `emptyDevGraph` and is documented
// there.
//
// ORDER IS CONTRACT, for the same reason as `ACTION_BLOCKS`: this array is
// served to the browser and rendered in order. Append; never reorder.

import { DEVGRAPH_FORMAT_TAG } from './graph-schema.js';
import type { DevGraph, GraphEdge, JoinPolicy } from './graph-types.js';

/**
 * A worked example, ready to be dropped on the canvas.
 *
 * `id`, `name` and `description` mirror the graph `build()` returns — the
 * library entry and the file the user saves say the same thing, so a sample
 * cannot be advertised as one method and open as another (the colocated test
 * pins it).
 */
export interface GraphSample {
  /** Slug. Becomes the saved graph's id, hence its filename. */
  id: string;
  name: string;
  description: string;
  /** Deterministic given `now`; falls back to the clock like `emptyDevGraph`. */
  build(now?: string): DevGraph;
}

/**
 * A FRESH `all` join per node.
 *
 * A factory, not a shared constant: handing the same object to every node is
 * the bug `graph-schema.ts` calls out for zod defaults — one editor that mutates
 * a join in place would silently rewrite the whole graph.
 */
function joinAll(): JoinPolicy {
  return { mode: 'all' };
}

/**
 * An edge, with `sourceOutcome` present ONLY when an arm is actually named.
 * Writing the key as `undefined` would round-trip differently and the validator
 * reports a named arm on a non-branching source as `edge-outcome-forbidden`.
 */
function edge(id: string, source: string, target: string, sourceOutcome?: string): GraphEdge {
  return sourceOutcome === undefined ? { id, source, target } : { id, source, target, sourceOutcome };
}

/** The placeholder objective, with a per-sample tail saying what depends on it. */
function goal(tail: string): string {
  return `Troque este texto pelo objetivo real deste trabalho, em uma ou duas frases. Ele é injetado em cada nó pelo token $goal — ${tail}`;
}

// --- 1. Three fronts in parallel, continuing from one of them ---------------

const TDD_SECURITY_PERFORMANCE_DESCRIPTION =
  'Um objetivo dispara TRÊS frentes em paralelo — TDD, revisão de segurança e ' +
  'revisão de performance — e a consolidação depende só da revisão de ' +
  'performance: o join dela está em modo "subset". Seja honesto sobre o que isso ' +
  'faz: relaxar o join tira a DEPENDÊNCIA (o nó deixa de esperar as outras duas ' +
  'frentes e deixa de falhar quando elas falham) e NÃO a barreira de merge da ' +
  'onda — o huu continua mesclando todos os ramos da onda no worktree de ' +
  'integração antes do próximo estágio, então isto não faz o nó começar antes.';

function buildTddSecurityPerformance(now?: string): DevGraph {
  const stamp = now ?? new Date().toISOString();
  return {
    _format: DEVGRAPH_FORMAT_TAG,
    id: 'tdd-seguranca-performance',
    name: 'TDD, segurança e performance em paralelo',
    description: TDD_SECURITY_PERFORMANCE_DESCRIPTION,
    createdAt: stamp,
    updatedAt: stamp,
    meta: { methodology: { tdd: true } },
    nodes: [
      {
        id: 'entrada',
        kind: 'prompt',
        label: 'Entrada do prompt',
        position: { x: 0, y: 0 },
        goal: goal('três frentes vão trabalhar a partir dele ao mesmo tempo.'),
      },
      {
        id: 'tdd',
        kind: 'action',
        label: 'TDD',
        position: { x: 360, y: -220 },
        block: 'tdd',
        join: joinAll(),
      },
      {
        id: 'seguranca',
        kind: 'action',
        label: 'Revisão de segurança',
        position: { x: 360, y: 0 },
        notes:
          'Escopo de projeto, e não o "per-file" padrão do bloco: sem lista de ' +
          'arquivos escolhida à mão, a auditoria cobre o repositório inteiro. Para ' +
          'auditar arquivo a arquivo, escolha os arquivos neste nó ou abra um leque ' +
          'a partir de um nó de reconhecimento (veja a amostra "recon-fanout").',
        block: 'security-review',
        scope: 'project',
        join: joinAll(),
      },
      {
        id: 'performance',
        kind: 'action',
        label: 'Revisão de performance',
        position: { x: 360, y: 220 },
        block: 'performance-review',
        join: joinAll(),
      },
      {
        id: 'consolidar',
        kind: 'action',
        label: 'Consolidar (segue só pela performance)',
        position: { x: 760, y: 0 },
        notes:
          'As três setas continuam desenhadas porque as três frentes alimentam este ' +
          'relatório. O subset diz de quais delas este nó DEPENDE: só da revisão de ' +
          'performance. O que sobra é desenho — e o merge da onda acontece do mesmo jeito.',
        block: 'consolidate',
        join: { mode: 'subset', of: ['performance'] },
      },
    ],
    edges: [
      edge('e-1', 'entrada', 'tdd'),
      edge('e-2', 'entrada', 'seguranca'),
      edge('e-3', 'entrada', 'performance'),
      edge('e-4', 'tdd', 'consolidar'),
      edge('e-5', 'seguranca', 'consolidar'),
      edge('e-6', 'performance', 'consolidar'),
    ],
  };
}

// --- 2. A yes/no question that routes ---------------------------------------

const BOOLEAN_RESEARCH_DESCRIPTION =
  'Uma pergunta de sim/não decide o caminho: se já existe rede de testes, o ' +
  'trabalho vai direto para a implementação; se não existe, ele começa pelo TDD, ' +
  'que escreve o teste que falha antes de qualquer código. Os DOIS braços têm ' +
  'destino cadastrado — um braço sem saída é erro de grafo. O defaultOutcome é ' +
  '"no": quando o juiz falha, o grafo segue pela rota que ASSUME não haver rede de ' +
  'segurança, porque errar para o lado do TDD custa um teste a mais, e errar para ' +
  'o outro lado custa uma mudança sem teste nenhum.';

function buildBooleanResearch(now?: string): DevGraph {
  const stamp = now ?? new Date().toISOString();
  return {
    _format: DEVGRAPH_FORMAT_TAG,
    id: 'pesquisa-booleana',
    name: 'Pesquisa com resposta sim/não',
    description: BOOLEAN_RESEARCH_DESCRIPTION,
    createdAt: stamp,
    updatedAt: stamp,
    meta: {},
    nodes: [
      {
        id: 'entrada',
        kind: 'prompt',
        label: 'Entrada do prompt',
        position: { x: 0, y: 0 },
        goal: goal('a pesquisa decide o caminho a partir dele.'),
      },
      {
        id: 'ha-testes',
        kind: 'research',
        label: 'Já existe rede de testes?',
        position: { x: 360, y: 0 },
        query:
          'A área do repositório que o objetivo acima vai alterar já está coberta por ' +
          'testes automatizados? Responda yes apenas se existir um comando do próprio ' +
          'projeto (script do package.json, alvo de Makefile ou passo do workflow de CI) ' +
          'que rode esses testes, e diga qual é o comando. Na dúvida, responda no.',
        useContext: true,
        outputKind: 'boolean',
        defaultOutcome: 'no',
        join: joinAll(),
      },
      {
        id: 'implementar',
        kind: 'action',
        label: 'Implementar sobre a rede existente',
        position: { x: 760, y: -180 },
        block: 'implement',
        join: joinAll(),
      },
      {
        id: 'tdd',
        kind: 'action',
        label: 'Construir a rede primeiro (TDD)',
        position: { x: 760, y: 180 },
        block: 'tdd',
        join: joinAll(),
      },
    ],
    edges: [
      edge('e-1', 'entrada', 'ha-testes'),
      edge('e-2', 'ha-testes', 'implementar', 'yes'),
      edge('e-3', 'ha-testes', 'tdd', 'no'),
    ],
  };
}

// --- 3. An n-way question that routes ---------------------------------------

const CHOICE_RESEARCH_DESCRIPTION =
  'Uma pesquisa de múltipla escolha com três opções, cada uma com seu próprio nó ' +
  'de destino: defeito segue para o TDD, melhoria segue para a implementação e ' +
  'documentação segue para o bloco de documentar. Cada opção precisa de ' +
  'exatamente uma seta saindo — nem zero, nem duas. O defaultOutcome é ' +
  '"documentacao", o único braço que não altera código de produção: se o juiz ' +
  'falhar, o grafo segue em frente pelo caminho mais barato de desfazer.';

function buildChoiceResearch(now?: string): DevGraph {
  const stamp = now ?? new Date().toISOString();
  return {
    _format: DEVGRAPH_FORMAT_TAG,
    id: 'pesquisa-multipla-escolha',
    name: 'Pesquisa com três caminhos',
    description: CHOICE_RESEARCH_DESCRIPTION,
    createdAt: stamp,
    updatedAt: stamp,
    meta: {},
    nodes: [
      {
        id: 'entrada',
        kind: 'prompt',
        label: 'Entrada do prompt',
        position: { x: 0, y: 0 },
        goal: goal('a pesquisa classifica o trabalho a partir dele.'),
      },
      {
        id: 'natureza',
        kind: 'research',
        label: 'Qual é a natureza do trabalho?',
        position: { x: 360, y: 0 },
        query:
          'Classifique o trabalho que o objetivo acima exige DESTE repositório, em uma ' +
          'única opção. Escolha "defeito" quando existir comportamento errado a ' +
          'corrigir, "melhoria" quando for comportamento novo a construir e ' +
          '"documentacao" quando o código já fizer o que se pede e apenas o texto ' +
          'estiver desatualizado. Cite o arquivo que sustenta a sua escolha.',
        useContext: true,
        outputKind: 'choice',
        choices: [
          { id: 'defeito', label: 'Corrigir defeito' },
          { id: 'melhoria', label: 'Construir melhoria' },
          { id: 'documentacao', label: 'Atualizar documentação' },
        ],
        defaultOutcome: 'documentacao',
        join: joinAll(),
      },
      {
        id: 'corrigir-defeito',
        kind: 'action',
        label: 'Corrigir com teste que falha primeiro',
        position: { x: 760, y: -220 },
        block: 'tdd',
        join: joinAll(),
      },
      {
        id: 'construir-melhoria',
        kind: 'action',
        label: 'Implementar a melhoria',
        position: { x: 760, y: 0 },
        block: 'implement',
        join: joinAll(),
      },
      {
        id: 'atualizar-docs',
        kind: 'action',
        label: 'Atualizar a documentação',
        position: { x: 760, y: 220 },
        block: 'docs',
        join: joinAll(),
      },
    ],
    edges: [
      edge('e-1', 'entrada', 'natureza'),
      edge('e-2', 'natureza', 'corrigir-defeito', 'defeito'),
      edge('e-3', 'natureza', 'construir-melhoria', 'melhoria'),
      edge('e-4', 'natureza', 'atualizar-docs', 'documentacao'),
    ],
  };
}

// --- 4. A question whose answer is CONTEXT, not a route ---------------------

const INFO_RESEARCH_DESCRIPTION =
  'Uma pesquisa informativa não ramifica nada: ela responde antes do trabalho ' +
  'começar e o resultado entra como CONTEXTO nos nós seguintes. Por isso o nó tem ' +
  'exatamente uma saída e nenhuma seta nomeia braço — nomear um braço aqui seria ' +
  'uma rota que não existe. useContext está ligado: a resposta tem que ser lida ' +
  'DESTE repositório, não recitada de memória.';

function buildInfoResearch(now?: string): DevGraph {
  const stamp = now ?? new Date().toISOString();
  return {
    _format: DEVGRAPH_FORMAT_TAG,
    id: 'pesquisa-informativa',
    name: 'Pesquisa informativa como contexto',
    description: INFO_RESEARCH_DESCRIPTION,
    createdAt: stamp,
    updatedAt: stamp,
    meta: {},
    nodes: [
      {
        id: 'entrada',
        kind: 'prompt',
        label: 'Entrada do prompt',
        position: { x: 0, y: 0 },
        goal: goal('a pesquisa levanta o terreno antes de qualquer mudança.'),
      },
      {
        id: 'convencoes',
        kind: 'research',
        label: 'Convenções que a mudança precisa respeitar',
        position: { x: 360, y: 0 },
        notes:
          'Sem ramificação: o artefato desta pesquisa vira contexto de leitura para os ' +
          'nós a jusante. Uma seta, sem braço nomeado.',
        query:
          'Levante as convenções que uma mudança neste repositório precisa respeitar: ' +
          'comandos reais de build, typecheck e teste; onde ficam os testes e como são ' +
          'nomeados; e as regras que o próprio projeto documenta (AGENTS.md, CLAUDE.md, ' +
          'README, guia de contribuição). Cite o caminho de cada afirmação e diga ' +
          'explicitamente o que não conseguiu confirmar.',
        useContext: true,
        outputKind: 'info',
        join: joinAll(),
      },
      {
        id: 'implementar',
        kind: 'action',
        label: 'Implementar seguindo as convenções',
        position: { x: 760, y: 0 },
        block: 'implement',
        join: joinAll(),
      },
      {
        id: 'documentar',
        kind: 'action',
        label: 'Documentar o que mudou',
        position: { x: 1160, y: 0 },
        block: 'docs',
        join: joinAll(),
      },
    ],
    edges: [
      edge('e-1', 'entrada', 'convencoes'),
      edge('e-2', 'convencoes', 'implementar'),
      edge('e-3', 'implementar', 'documentar'),
    ],
  };
}

// --- 5. Recon writes the target list, the next node fans out over it --------

const RECON_FANOUT_DESCRIPTION =
  'O reconhecimento mapeia o repositório e escreve a lista de alvos; o nó ' +
  'seguinte abre um leque com UM agente por entrada dessa lista (escopo "memory" ' +
  'com fanOutFrom apontando para o reconhecimento). É assim que uma frente ' +
  'per-file existe sem ninguém digitar caminhos à mão — e o teto maxFiles é a ' +
  'largura do leque que você está subscrevendo, não uma sugestão.';

function buildReconFanout(now?: string): DevGraph {
  const stamp = now ?? new Date().toISOString();
  return {
    _format: DEVGRAPH_FORMAT_TAG,
    id: 'recon-fanout',
    name: 'Reconhecimento e leque por arquivo',
    description: RECON_FANOUT_DESCRIPTION,
    createdAt: stamp,
    updatedAt: stamp,
    meta: {},
    nodes: [
      {
        id: 'entrada',
        kind: 'prompt',
        label: 'Entrada do prompt',
        position: { x: 0, y: 0 },
        goal: goal('o reconhecimento escolhe os arquivos a partir dele.'),
      },
      {
        id: 'mapear-alvos',
        kind: 'action',
        label: 'Mapear os alvos',
        position: { x: 360, y: 0 },
        block: 'recon',
        join: joinAll(),
      },
      {
        id: 'gerar-testes',
        kind: 'action',
        label: 'Gerar testes (um agente por alvo)',
        position: { x: 760, y: 0 },
        notes:
          'Escopo "memory": a lista de arquivos vem do nó de reconhecimento, não deste. ' +
          'maxFiles é o teto de agentes que este nó pode abrir.',
        block: 'tests',
        scope: 'memory',
        fanOutFrom: 'mapear-alvos',
        maxFiles: 8,
        join: joinAll(),
      },
      {
        id: 'consolidar',
        kind: 'action',
        label: 'Consolidar o que o leque produziu',
        position: { x: 1160, y: 0 },
        block: 'consolidate',
        join: joinAll(),
      },
    ],
    edges: [
      edge('e-1', 'entrada', 'mapear-alvos'),
      edge('e-2', 'mapear-alvos', 'gerar-testes'),
      edge('e-3', 'gerar-testes', 'consolidar'),
    ],
  };
}

// --- 6. A human-authored judge, with a forward default ----------------------

const QUALITY_GATE_DESCRIPTION =
  'Uma verificação escrita por você: um juiz LLM avalia a condição no worktree de ' +
  'integração, depois do merge, e escolhe por qual saída o grafo segue. A ' +
  'condição é mecânica de propósito (um comando sai com código zero, um diff está ' +
  'limpo) — juiz consultado sobre impressão responde com impressão. O ' +
  'defaultOutcome é "approved" porque essa é a regra do huu: um juiz que falha ' +
  'não pode travar a execução, então uma saída é sempre o caminho seguro adiante.';

function buildQualityGate(now?: string): DevGraph {
  const stamp = now ?? new Date().toISOString();
  return {
    _format: DEVGRAPH_FORMAT_TAG,
    id: 'portao-de-qualidade',
    name: 'Portão de qualidade com juiz',
    description: QUALITY_GATE_DESCRIPTION,
    createdAt: stamp,
    updatedAt: stamp,
    meta: { methodology: { lintGate: true } },
    nodes: [
      {
        id: 'entrada',
        kind: 'prompt',
        label: 'Entrada do prompt',
        position: { x: 0, y: 0 },
        goal: goal('o portão julga o resultado contra ele.'),
      },
      {
        id: 'implementar',
        kind: 'action',
        label: 'Implementar',
        position: { x: 360, y: 0 },
        block: 'implement',
        join: joinAll(),
      },
      {
        id: 'portao',
        kind: 'gate',
        label: 'Build, typecheck e testes passam?',
        position: { x: 760, y: 0 },
        notes:
          'A condição é avaliada DEPOIS do merge, no worktree de integração. Escreva ' +
          'algo que se verifica rodando um comando ou lendo um diff.',
        condition:
          "The project's own build/typecheck command and its full test suite both exit zero in this worktree, and the diff introduces no suppression comment, disabled rule or skipped test.",
        outcomes: [
          { id: 'approved', label: 'Aprovado' },
          { id: 'rejected', label: 'Reprovado' },
        ],
        defaultOutcome: 'approved',
        maxRuns: 3,
        join: joinAll(),
      },
      {
        id: 'documentar',
        kind: 'action',
        label: 'Documentar o que mudou',
        position: { x: 1160, y: -180 },
        block: 'docs',
        join: joinAll(),
      },
      {
        id: 'corrigir-checagens',
        kind: 'action',
        label: 'Corrigir o que as checagens apontaram',
        position: { x: 1160, y: 180 },
        block: 'lint-fix',
        join: joinAll(),
      },
    ],
    edges: [
      edge('e-1', 'entrada', 'implementar'),
      edge('e-2', 'implementar', 'portao'),
      edge('e-3', 'portao', 'documentar', 'approved'),
      edge('e-4', 'portao', 'corrigir-checagens', 'rejected'),
    ],
  };
}

/** The shipped samples, in library order. Append only — see the header. */
export const GRAPH_SAMPLES: readonly GraphSample[] = [
  {
    id: 'tdd-seguranca-performance',
    name: 'TDD, segurança e performance em paralelo',
    description: TDD_SECURITY_PERFORMANCE_DESCRIPTION,
    build: buildTddSecurityPerformance,
  },
  {
    id: 'pesquisa-booleana',
    name: 'Pesquisa com resposta sim/não',
    description: BOOLEAN_RESEARCH_DESCRIPTION,
    build: buildBooleanResearch,
  },
  {
    id: 'pesquisa-multipla-escolha',
    name: 'Pesquisa com três caminhos',
    description: CHOICE_RESEARCH_DESCRIPTION,
    build: buildChoiceResearch,
  },
  {
    id: 'pesquisa-informativa',
    name: 'Pesquisa informativa como contexto',
    description: INFO_RESEARCH_DESCRIPTION,
    build: buildInfoResearch,
  },
  {
    id: 'recon-fanout',
    name: 'Reconhecimento e leque por arquivo',
    description: RECON_FANOUT_DESCRIPTION,
    build: buildReconFanout,
  },
  {
    id: 'portao-de-qualidade',
    name: 'Portão de qualidade com juiz',
    description: QUALITY_GATE_DESCRIPTION,
    build: buildQualityGate,
  },
];

/** The sample with this id, or `undefined`. */
export function findSample(id: string): GraphSample | undefined {
  return GRAPH_SAMPLES.find((sample) => sample.id === id);
}

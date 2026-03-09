// ── Catálogo de Modelos OpenRouter ────────────────────────────────────
// Contém todos os modelos disponíveis com preços, benchmarks e pontuação custo-benefício.
// Dados extraídos de docs/models-llm-openrouter.md (Março 2026).

// ── Tipos ────────────────────────────────────────────────────────────

export interface ModelPricing {
  /** Custo por milhão de tokens de entrada (USD) */
  input: number;
  /** Custo por milhão de tokens de saída (USD) */
  output: number;
}

export interface ModelBenchmarks {
  /** SWE-Bench Verified (0-100), null se desconhecido */
  sweBenchVerified: number | null;
  /** BFCL Multi-Turn (0-100), null se desconhecido */
  bfclMultiTurn: number | null;
  /** Terminal-Bench 2.0 (0-100), null se desconhecido */
  terminalBench: number | null;
}

export type ToolCallingQuality = 'excellent' | 'good' | 'basic' | 'limited';
export type ModelTier = 'premium' | 'standard' | 'economy';
export type ModelConfidence = 'high' | 'medium-high' | 'medium' | 'medium-low' | 'low';

export interface ModelEntry {
  /** ID do modelo no OpenRouter (ex: "anthropic/claude-sonnet-4.5") */
  id: string;
  /** Nome legível */
  name: string;
  /** Nome do provedor */
  provider: string;
  /** Preço por MTok */
  pricing: ModelPricing;
  /** Tamanho da janela de contexto em tokens */
  contextWindow: number;
  /** Pontuações de benchmark */
  benchmarks: ModelBenchmarks;
  /** Qualidade de tool calling */
  toolCalling: ToolCallingQuality;
  /** Classificação de tier do modelo */
  tier: ModelTier;
  /** Nível de confiança baseado em evidência de produção */
  confidence: ModelConfidence;
  /** Se o modelo suporta pensamento estendido/raciocínio */
  reasoning: boolean;
}

// ── Papéis dos Agentes ──────────────────────────────────────────────

export type AgentRole =
  | 'orchestrator'
  | 'planner'
  | 'builder'
  | 'tester'
  | 'reviewer'
  | 'researcher'
  | 'merger'
  | 'refactorer'
  | 'doc-writer'
  | 'debugger'
  | 'context-curator';

// ── Descrições dos Papéis dos Agentes ────────────────────────────────
// Exibidas no Assistente de Configuração para explicar o que cada agente faz
// e por que o modelo recomendado foi escolhido.

export interface AgentRoleInfo {
  /** Nome legível do papel */
  displayName: string;
  /** Descrição curta do que o agente faz */
  description: string;
  /** Por que o modelo recomendado é ideal para este papel */
  modelRationale: string;
}

export const AGENT_ROLE_INFO: Record<AgentRole, AgentRoleInfo> = {
  orchestrator: {
    displayName: 'Orquestrador',
    description: 'Showrunner — decompõe tarefas, delega para agentes e mantém a coerência do projeto.',
    modelRationale: 'Necessita pensamento estendido para raciocínio complexo. Cache de prompt via API economiza ~80% em input recorrente. Sonnet 4.5 equilibra qualidade e custo para decisões estratégicas.',
  },
  planner: {
    displayName: 'Planejador',
    description: 'Decompõe o trabalho em um Beat Sheet hierárquico — a estrutura fractal de tarefas.',
    modelRationale: 'Modo de pensamento permite decomposição estruturada. MiniMax M2.5 "Modo Arquiteto" é um fallback forte para planejamento a 13x menos custo.',
  },
  builder: {
    displayName: 'Construtor',
    description: 'Implementa código em worktrees Git isolados. Executa a maior parte do desenvolvimento.',
    modelRationale: 'Sonnet 4.6 lidera SWE-Bench com 79.6% e 1M de contexto. MiniMax M2.5 (80.2% SWE-Bench) é o melhor custo-benefício para features simples.',
  },
  tester: {
    displayName: 'Testador',
    description: 'Escreve e valida testes usando metodologia TDD. Garante a correção do código.',
    modelRationale: 'MiniMax M2.5 se destaca em tool calling (76.8% BFCL Multi-Turn vs Opus 63.3%). Geração de testes depende de uso sequencial robusto de tools — M2.5 reduz re-prompt em ~20%.',
  },
  reviewer: {
    displayName: 'Revisor',
    description: 'Revisa qualidade do código e valida contra requisitos. Baixa alucinação é crítica.',
    modelRationale: 'Opus 4.6 com 1M de contexto pode revisar codebases inteiros. API direta para cache de prompt. Taxa baixa de alucinação é essencial para revisões precisas.',
  },
  researcher: {
    displayName: 'Pesquisador',
    description: 'Coleta contexto do codebase e de fontes externas via busca.',
    modelRationale: 'Gemini 2.5 Flash oferece 1M de contexto para documentação extensiva com cache implícito. Custo-efetivo para busca e coleta de contexto em alto volume.',
  },
  merger: {
    displayName: 'Integrador',
    description: 'Resolve conflitos Git e executa merges entre worktrees dos agentes.',
    modelRationale: 'GPT-4.1 com 1.05M de contexto lida com diffs grandes. Otimizado para precisão em aplicação de patches e resolução de conflitos.',
  },
  refactorer: {
    displayName: 'Refatorador',
    description: 'Limpeza, remoção de código morto e transformações mecânicas de código.',
    modelRationale: 'DeepSeek V3.2 a $0.28/$0.42 é ideal para transformações mecânicas — 70.4% SWE-Bench a custo mínimo com cache automático 0.1x.',
  },
  'doc-writer': {
    displayName: 'Documentador',
    description: 'Mantém a documentação sincronizada com mudanças no código.',
    modelRationale: 'Gemini 3.1 Flash Lite com níveis de pensamento e 1M de contexto. Melhor prosa estruturada que GPT-5 Mini a custo similar.',
  },
  debugger: {
    displayName: 'Depurador',
    description: 'Investigação profunda de bugs com acesso a logs, traces e o codebase completo.',
    modelRationale: 'Gemini 3.1 Pro lidera Terminal-Bench 2.0 com 78.4%. 1M de contexto para analisar logs extensivos e stack traces.',
  },
  'context-curator': {
    displayName: 'Curador de Contexto',
    description: 'Curadoria de memória pós-atividade — decide qual conhecimento persiste no scratchpad.',
    modelRationale: 'Gemini 2.5 Flash Lite a $0.10/$0.40 é ultra-barato com 1M de contexto. Curadoria é filtrar e resumir — ideal para modelo econômico.',
  },
};

// ── Catálogo de Modelos ──────────────────────────────────────────────
// Preços e benchmarks de docs/models-llm-openrouter.md (Março 2026)

export const MODEL_CATALOG: ModelEntry[] = [
  // ── Tier Premium ──────────────────────────────────────────────────
  {
    id: 'anthropic/claude-opus-4',
    name: 'Claude Opus 4.6',
    provider: 'Anthropic',
    pricing: { input: 5.00, output: 25.00 },
    contextWindow: 1_000_000,
    benchmarks: { sweBenchVerified: 80.8, bfclMultiTurn: 63.3, terminalBench: 74.7 },
    toolCalling: 'excellent',
    tier: 'premium',
    confidence: 'high',
    reasoning: true,
  },
  {
    id: 'anthropic/claude-sonnet-4.5',
    name: 'Claude Sonnet 4.5',
    provider: 'Anthropic',
    pricing: { input: 3.00, output: 15.00 },
    contextWindow: 1_000_000,
    benchmarks: { sweBenchVerified: 77.2, bfclMultiTurn: null, terminalBench: null },
    toolCalling: 'excellent',
    tier: 'premium',
    confidence: 'high',
    reasoning: true,
  },
  {
    id: 'anthropic/claude-sonnet-4',
    name: 'Claude Sonnet 4.6',
    provider: 'Anthropic',
    pricing: { input: 3.00, output: 15.00 },
    contextWindow: 1_000_000,
    benchmarks: { sweBenchVerified: 79.6, bfclMultiTurn: null, terminalBench: 59.1 },
    toolCalling: 'excellent',
    tier: 'premium',
    confidence: 'high',
    reasoning: true,
  },
  {
    id: 'google/gemini-2.5-pro-preview-03-25',
    name: 'Gemini 3.1 Pro',
    provider: 'Google',
    pricing: { input: 2.00, output: 12.00 },
    contextWindow: 1_000_000,
    benchmarks: { sweBenchVerified: 80.6, bfclMultiTurn: null, terminalBench: 78.4 },
    toolCalling: 'excellent',
    tier: 'premium',
    confidence: 'high',
    reasoning: true,
  },
  {
    id: 'openai/gpt-5.2',
    name: 'GPT-5.2',
    provider: 'OpenAI',
    pricing: { input: 1.75, output: 14.00 },
    contextWindow: 400_000,
    benchmarks: { sweBenchVerified: 80.0, bfclMultiTurn: null, terminalBench: null },
    toolCalling: 'excellent',
    tier: 'premium',
    confidence: 'high',
    reasoning: true,
  },
  {
    id: 'openai/gpt-5.4',
    name: 'GPT-5.4',
    provider: 'OpenAI',
    pricing: { input: 2.50, output: 15.00 },
    contextWindow: 1_050_000,
    benchmarks: { sweBenchVerified: 80.0, bfclMultiTurn: null, terminalBench: 75.0 },
    toolCalling: 'excellent',
    tier: 'premium',
    confidence: 'high',
    reasoning: true,
  },
  {
    id: 'openai/gpt-5.3-codex',
    name: 'GPT-5.3 Codex',
    provider: 'OpenAI',
    pricing: { input: 1.75, output: 14.00 },
    contextWindow: 400_000,
    benchmarks: { sweBenchVerified: null, bfclMultiTurn: null, terminalBench: 77.3 },
    toolCalling: 'excellent',
    tier: 'premium',
    confidence: 'high',
    reasoning: true,
  },

  // ── Tier Standard ─────────────────────────────────────────────────
  {
    id: 'minimax/minimax-m2.5',
    name: 'MiniMax M2.5',
    provider: 'MiniMax',
    pricing: { input: 0.15, output: 1.20 },
    contextWindow: 196_000,
    benchmarks: { sweBenchVerified: 80.2, bfclMultiTurn: 76.8, terminalBench: 42.2 },
    toolCalling: 'excellent',
    tier: 'standard',
    confidence: 'medium-high',
    reasoning: true,
  },
  {
    id: 'minimax/minimax-m2.5-lightning',
    name: 'MiniMax M2.5 Lightning',
    provider: 'MiniMax',
    pricing: { input: 0.30, output: 2.40 },
    contextWindow: 196_000,
    benchmarks: { sweBenchVerified: 80.2, bfclMultiTurn: null, terminalBench: null },
    toolCalling: 'excellent',
    tier: 'standard',
    confidence: 'medium',
    reasoning: true,
  },
  {
    id: 'anthropic/claude-haiku-4.5',
    name: 'Claude Haiku 4.5',
    provider: 'Anthropic',
    pricing: { input: 1.00, output: 5.00 },
    contextWindow: 200_000,
    benchmarks: { sweBenchVerified: 73.3, bfclMultiTurn: null, terminalBench: null },
    toolCalling: 'excellent',
    tier: 'standard',
    confidence: 'high',
    reasoning: true,
  },
  {
    id: 'deepseek/deepseek-chat',
    name: 'DeepSeek V3.2',
    provider: 'DeepSeek',
    pricing: { input: 0.28, output: 0.42 },
    contextWindow: 128_000,
    benchmarks: { sweBenchVerified: 70.4, bfclMultiTurn: null, terminalBench: 39.6 },
    toolCalling: 'good',
    tier: 'standard',
    confidence: 'medium',
    reasoning: true,
  },
  {
    id: 'moonshot/kimi-k2.5',
    name: 'Kimi K2.5',
    provider: 'Moonshot AI',
    pricing: { input: 0.60, output: 2.50 },
    contextWindow: 256_000,
    benchmarks: { sweBenchVerified: 76.8, bfclMultiTurn: null, terminalBench: 50.8 },
    toolCalling: 'excellent',
    tier: 'standard',
    confidence: 'medium',
    reasoning: true,
  },
  {
    id: 'openai/gpt-4.1',
    name: 'GPT-4.1',
    provider: 'OpenAI',
    pricing: { input: 2.00, output: 8.00 },
    contextWindow: 1_050_000,
    benchmarks: { sweBenchVerified: 54.6, bfclMultiTurn: null, terminalBench: null },
    toolCalling: 'excellent',
    tier: 'standard',
    confidence: 'high',
    reasoning: false,
  },
  {
    id: 'openai/gpt-5',
    name: 'GPT-5',
    provider: 'OpenAI',
    pricing: { input: 1.25, output: 10.00 },
    contextWindow: 400_000,
    benchmarks: { sweBenchVerified: 75.0, bfclMultiTurn: null, terminalBench: null },
    toolCalling: 'excellent',
    tier: 'standard',
    confidence: 'high',
    reasoning: true,
  },
  {
    id: 'google/gemini-3-flash',
    name: 'Gemini 3 Flash',
    provider: 'Google',
    pricing: { input: 0.50, output: 3.00 },
    contextWindow: 1_000_000,
    benchmarks: { sweBenchVerified: 78.0, bfclMultiTurn: null, terminalBench: null },
    toolCalling: 'excellent',
    tier: 'standard',
    confidence: 'high',
    reasoning: true,
  },
  {
    id: 'mistral/devstral-2',
    name: 'Devstral 2',
    provider: 'Mistral',
    pricing: { input: 0.40, output: 2.00 },
    contextWindow: 256_000,
    benchmarks: { sweBenchVerified: 72.2, bfclMultiTurn: null, terminalBench: 43.8 },
    toolCalling: 'good',
    tier: 'standard',
    confidence: 'medium',
    reasoning: false,
  },

  // ── Tier Economy ──────────────────────────────────────────────────
  {
    id: 'google/gemini-2.5-flash-preview',
    name: 'Gemini 2.5 Flash',
    provider: 'Google',
    pricing: { input: 0.30, output: 2.50 },
    contextWindow: 1_000_000,
    benchmarks: { sweBenchVerified: 64.0, bfclMultiTurn: null, terminalBench: null },
    toolCalling: 'excellent',
    tier: 'economy',
    confidence: 'high',
    reasoning: true,
  },
  {
    id: 'google/gemini-2.5-flash-lite-preview',
    name: 'Gemini 2.5 Flash Lite',
    provider: 'Google',
    pricing: { input: 0.10, output: 0.40 },
    contextWindow: 1_000_000,
    benchmarks: { sweBenchVerified: null, bfclMultiTurn: null, terminalBench: null },
    toolCalling: 'good',
    tier: 'economy',
    confidence: 'medium',
    reasoning: false,
  },
  {
    id: 'openai/gpt-5-mini',
    name: 'GPT-5 Mini',
    provider: 'OpenAI',
    pricing: { input: 0.25, output: 2.00 },
    contextWindow: 200_000,
    benchmarks: { sweBenchVerified: null, bfclMultiTurn: null, terminalBench: null },
    toolCalling: 'good',
    tier: 'economy',
    confidence: 'medium',
    reasoning: true,
  },
  {
    id: 'openai/gpt-5-nano',
    name: 'GPT-5 Nano',
    provider: 'OpenAI',
    pricing: { input: 0.05, output: 0.40 },
    contextWindow: 128_000,
    benchmarks: { sweBenchVerified: null, bfclMultiTurn: null, terminalBench: null },
    toolCalling: 'basic',
    tier: 'economy',
    confidence: 'medium',
    reasoning: false,
  },
  {
    id: 'openai/gpt-4.1-nano',
    name: 'GPT-4.1 Nano',
    provider: 'OpenAI',
    pricing: { input: 0.10, output: 0.40 },
    contextWindow: 1_050_000,
    benchmarks: { sweBenchVerified: null, bfclMultiTurn: null, terminalBench: null },
    toolCalling: 'basic',
    tier: 'economy',
    confidence: 'medium',
    reasoning: false,
  },
  {
    id: 'google/gemini-3.1-flash-lite',
    name: 'Gemini 3.1 Flash Lite',
    provider: 'Google',
    pricing: { input: 0.25, output: 1.50 },
    contextWindow: 1_000_000,
    benchmarks: { sweBenchVerified: null, bfclMultiTurn: null, terminalBench: null },
    toolCalling: 'good',
    tier: 'economy',
    confidence: 'medium',
    reasoning: true,
  },
  {
    id: 'step-ai/step-3.5-flash',
    name: 'Step 3.5 Flash',
    provider: 'Step AI',
    pricing: { input: 0.10, output: 0.30 },
    contextWindow: 262_000,
    benchmarks: { sweBenchVerified: 74.4, bfclMultiTurn: null, terminalBench: 51.0 },
    toolCalling: 'good',
    tier: 'economy',
    confidence: 'medium',
    reasoning: true,
  },
  {
    id: 'xiaomi/mimo-v2-flash',
    name: 'MiMo-V2-Flash',
    provider: 'Xiaomi',
    pricing: { input: 0.10, output: 0.30 },
    contextWindow: 256_000,
    benchmarks: { sweBenchVerified: 73.4, bfclMultiTurn: null, terminalBench: 38.5 },
    toolCalling: 'good',
    tier: 'economy',
    confidence: 'medium-low',
    reasoning: true,
  },
  {
    id: 'mistral/devstral-small-2',
    name: 'Devstral Small 2',
    provider: 'Mistral',
    pricing: { input: 0.10, output: 0.30 },
    contextWindow: 256_000,
    benchmarks: { sweBenchVerified: 68.0, bfclMultiTurn: null, terminalBench: 40.0 },
    toolCalling: 'good',
    tier: 'economy',
    confidence: 'medium',
    reasoning: false,
  },
  {
    id: 'xai/grok-code-fast-1',
    name: 'Grok Code Fast 1',
    provider: 'xAI',
    pricing: { input: 0.20, output: 1.50 },
    contextWindow: 256_000,
    benchmarks: { sweBenchVerified: 70.8, bfclMultiTurn: null, terminalBench: null },
    toolCalling: 'good',
    tier: 'economy',
    confidence: 'medium-low',
    reasoning: false,
  },
  {
    id: 'qwen/qwen3-coder-480b',
    name: 'Qwen3-Coder 480B',
    provider: 'Alibaba',
    pricing: { input: 0.22, output: 1.00 },
    contextWindow: 262_000,
    benchmarks: { sweBenchVerified: 55.0, bfclMultiTurn: null, terminalBench: null },
    toolCalling: 'good',
    tier: 'economy',
    confidence: 'medium-low',
    reasoning: true,
  },
];

// ── Algoritmo de Custo-Benefício ────────────────────────────────────

export interface CostBenefitScore {
  /** Entrada do modelo */
  model: ModelEntry;
  /** Score SWE-Bench normalizado (0-1), 0 se desconhecido */
  normalizedScore: number;
  /** Custo combinado por MTok (ponderado: 30% input + 70% output) */
  blendedCostPerMTok: number;
  /** Razão custo-benefício: score / custo (maior = melhor valor) */
  costBenefitRatio: number;
  /** Rótulo custo-benefício legível */
  label: string;
}

/**
 * Calcula pontuação custo-benefício para um modelo.
 *
 * Fórmula:
 *   blendedCost = 0.30 * inputCost + 0.70 * outputCost
 *   normalizedScore = sweBenchVerified / 100 (ou 0.5 padrão se desconhecido)
 *   costBenefitRatio = normalizedScore / blendedCost
 *
 * Ponderação 70/30 em output porque agentes produzem mais tokens de saída
 * do que de entrada em workflows de codificação (tool calls, geração de código).
 */
export function calculateCostBenefit(model: ModelEntry): CostBenefitScore {
  const normalizedScore = model.benchmarks.sweBenchVerified !== null
    ? model.benchmarks.sweBenchVerified / 100
    : 0.5; // Padrão conservador para modelos sem dados SWE-Bench

  const blendedCostPerMTok =
    0.30 * model.pricing.input + 0.70 * model.pricing.output;

  // Evita divisão por zero
  const costBenefitRatio = blendedCostPerMTok > 0
    ? normalizedScore / blendedCostPerMTok
    : 0;

  return {
    model,
    normalizedScore,
    blendedCostPerMTok,
    costBenefitRatio,
    label: formatCostBenefitLabel(costBenefitRatio),
  };
}

function formatCostBenefitLabel(ratio: number): string {
  if (ratio >= 2.0) return 'Excepcional';
  if (ratio >= 1.0) return 'Excelente';
  if (ratio >= 0.5) return 'Bom';
  if (ratio >= 0.1) return 'Regular';
  return 'Premium';
}

/**
 * Classifica todos os modelos por razão custo-benefício (decrescente).
 */
export function rankModelsByCostBenefit(): CostBenefitScore[] {
  return MODEL_CATALOG
    .map(calculateCostBenefit)
    .sort((a, b) => b.costBenefitRatio - a.costBenefitRatio);
}

/**
 * Retorna modelos compatíveis com um papel específico, classificados por custo-benefício.
 * Filtra com base em requisitos mínimos por papel (tool calling, benchmarks, etc).
 */
export function getModelsForRole(role: AgentRole): CostBenefitScore[] {
  const requirements = ROLE_REQUIREMENTS[role];
  return rankModelsByCostBenefit().filter((scored) => {
    const m = scored.model;

    if (!meetsToolCallingReq(m.toolCalling, requirements.minToolCalling)) {
      return false;
    }

    if (m.contextWindow < requirements.minContext) {
      return false;
    }

    if (
      requirements.minSweBench !== null &&
      m.benchmarks.sweBenchVerified !== null &&
      m.benchmarks.sweBenchVerified < requirements.minSweBench
    ) {
      return false;
    }

    if (requirements.requiresReasoning && !m.reasoning) {
      return false;
    }

    return true;
  });
}

/**
 * Retorna TODOS os modelos para um papel, com os recomendados primeiro.
 * Modelos que atendem os requisitos do papel vêm primeiro (por custo-benefício),
 * seguidos dos demais modelos (também por custo-benefício).
 */
export function getAllModelsForRole(role: AgentRole): CostBenefitScore[] {
  const requirements = ROLE_REQUIREMENTS[role];
  const all = rankModelsByCostBenefit();

  const recommended: CostBenefitScore[] = [];
  const others: CostBenefitScore[] = [];

  for (const scored of all) {
    if (meetsRoleRequirements(scored.model, requirements)) {
      recommended.push(scored);
    } else {
      others.push(scored);
    }
  }

  return [...recommended, ...others];
}

/**
 * Verifica se um modelo atende os requisitos de um papel.
 */
function meetsRoleRequirements(model: ModelEntry, requirements: RoleRequirements): boolean {
  if (!meetsToolCallingReq(model.toolCalling, requirements.minToolCalling)) {
    return false;
  }
  if (model.contextWindow < requirements.minContext) {
    return false;
  }
  if (
    requirements.minSweBench !== null &&
    model.benchmarks.sweBenchVerified !== null &&
    model.benchmarks.sweBenchVerified < requirements.minSweBench
  ) {
    return false;
  }
  if (requirements.requiresReasoning && !model.reasoning) {
    return false;
  }
  return true;
}

/**
 * Verifica se um modelo é compatível com um papel específico.
 */
export function isModelRecommendedForRole(modelId: string, role: AgentRole): boolean {
  const model = MODEL_CATALOG.find((m) => m.id === modelId);
  if (!model) return false;
  return meetsRoleRequirements(model, ROLE_REQUIREMENTS[role]);
}

/**
 * Retorna o modelo padrão recomendado para cada papel de agente.
 */
export function getDefaultModelForRole(role: AgentRole): string {
  return DEFAULT_MODELS[role];
}

/**
 * Busca um modelo pelo seu ID OpenRouter.
 */
export function findModelById(id: string): ModelEntry | undefined {
  return MODEL_CATALOG.find((m) => m.id === id);
}

/**
 * Formata informações do modelo para exibição no seletor TUI com colunas alinhadas.
 * Inclui: nome, SWE-Bench, preço input/output, contexto, custo-benefício e razão.
 */
export function formatModelOption(scored: CostBenefitScore, defaultModelId?: string): string {
  const m = scored.model;
  const isDefault = defaultModelId !== undefined && m.id === defaultModelId;
  const star = isDefault ? '\u2605 ' : '  ';
  const name = m.name.padEnd(22);
  const swe = m.benchmarks.sweBenchVerified !== null
    ? `${m.benchmarks.sweBenchVerified.toFixed(1)}%`.padStart(6)
    : '  N/A '.padStart(6);
  const inPrice = `$${m.pricing.input.toFixed(2)}`.padStart(6);
  const outPrice = `$${m.pricing.output.toFixed(2)}`.padStart(7);
  const ctx = formatContextWindow(m.contextWindow).padStart(5);
  const ratio = scored.costBenefitRatio >= 0.01
    ? scored.costBenefitRatio.toFixed(1).padStart(5)
    : '  N/A';
  const cb = scored.label.padEnd(10);
  return `${star}${name} ${swe}  ${inPrice}/${outPrice}  ${ctx}  ${ratio}  ${cb}`;
}

function formatContextWindow(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  return `${Math.round(tokens / 1000)}K`;
}

// ── Requisitos por Papel ────────────────────────────────────────────

interface RoleRequirements {
  minToolCalling: ToolCallingQuality;
  minContext: number;
  minSweBench: number | null;
  requiresReasoning: boolean;
}

const ROLE_REQUIREMENTS: Record<AgentRole, RoleRequirements> = {
  orchestrator: {
    minToolCalling: 'excellent',
    minContext: 200_000,
    minSweBench: 70,
    requiresReasoning: true,
  },
  planner: {
    minToolCalling: 'good',
    minContext: 200_000,
    minSweBench: 70,
    requiresReasoning: true,
  },
  builder: {
    minToolCalling: 'excellent',
    minContext: 200_000,
    minSweBench: 70,
    requiresReasoning: false,
  },
  tester: {
    minToolCalling: 'excellent',
    minContext: 100_000,
    minSweBench: null,
    requiresReasoning: false,
  },
  reviewer: {
    minToolCalling: 'excellent',
    minContext: 200_000,
    minSweBench: 70,
    requiresReasoning: true,
  },
  researcher: {
    minToolCalling: 'good',
    minContext: 200_000,
    minSweBench: null,
    requiresReasoning: false,
  },
  merger: {
    minToolCalling: 'excellent',
    minContext: 200_000,
    minSweBench: null,
    requiresReasoning: false,
  },
  refactorer: {
    minToolCalling: 'good',
    minContext: 100_000,
    minSweBench: null,
    requiresReasoning: false,
  },
  'doc-writer': {
    minToolCalling: 'good',
    minContext: 100_000,
    minSweBench: null,
    requiresReasoning: false,
  },
  debugger: {
    minToolCalling: 'excellent',
    minContext: 200_000,
    minSweBench: 70,
    requiresReasoning: true,
  },
  'context-curator': {
    minToolCalling: 'good',
    minContext: 100_000,
    minSweBench: null,
    requiresReasoning: false,
  },
};

// ── Modelos Padrão ──────────────────────────────────────────────────
// Baseados na análise de tiering de docs/models-llm-openrouter.md

const DEFAULT_MODELS: Record<AgentRole, string> = {
  // Tier Crítico — Decisões estratégicas
  orchestrator: 'anthropic/claude-sonnet-4.5',
  reviewer: 'anthropic/claude-opus-4',
  debugger: 'google/gemini-2.5-pro-preview-03-25',

  // Tier Principal — Motor de desenvolvimento
  planner: 'anthropic/claude-sonnet-4.5',
  builder: 'anthropic/claude-sonnet-4',
  tester: 'minimax/minimax-m2.5',
  merger: 'openai/gpt-4.1',

  // Tier Econômico — Alto volume
  researcher: 'google/gemini-2.5-flash-preview',
  refactorer: 'deepseek/deepseek-chat',
  'doc-writer': 'google/gemini-3.1-flash-lite',
  'context-curator': 'google/gemini-2.5-flash-lite-preview',
};

// ── Helpers ──────────────────────────────────────────────────────────

const TOOL_CALLING_RANK: Record<ToolCallingQuality, number> = {
  excellent: 4,
  good: 3,
  basic: 2,
  limited: 1,
};

function meetsToolCallingReq(
  actual: ToolCallingQuality,
  minimum: ToolCallingQuality,
): boolean {
  return TOOL_CALLING_RANK[actual] >= TOOL_CALLING_RANK[minimum];
}

# F2 · `huu run --dry-run` + Cost Forecast

> **Tier:** 1 (Sprint) · **Esforço:** 3 dias · **Bloqueia:** F9, F10
> **Dependências:** F0.1 (zod schema), F0.2 (price catalog) · **Recomendado:** F0.3 (history)

## Project Paths

- **`huu` (target):** `/home/ondokai/Projects/huu.worktrees/ai-task-1777469117`
- **Bernstein (reference):** `/home/ondokai/Projects/bernstein`

## Context

A pergunta que paralisa a adoção de pipelines paralelos é: **"vai me custar
$25 ou $1.50?"**. Resolver ela é o desbloqueio mais importante da adoção
do `huu`.

`--dry-run` carrega a pipeline, valida com schema, estima tokens × preços,
e mostra:
- Custo total esperado (com intervalo de confiança).
- Wall-clock estimado.
- Breakdown por modelo / por step.
- Oportunidades de cache.

Sem chamar LLM. Sem criar worktrees. Sem custo nenhum além do CPU local.

## Current state in `huu`

- `src/cli.tsx:165` — flag `--stub` valida estrutura sem LLM, mas não
  estima custo.
- `src/cli.tsx:207` — `huu run <pipeline.json>` carrega e dispara fluxo
  real.
- README:566 lista `huu estimate` como item de roadmap.

## Bernstein reference

- `/home/ondokai/Projects/bernstein/src/bernstein/cli/commands/dry_run_cmd.py`
  — implementação Python do mesmo conceito.
- `/home/ondokai/Projects/bernstein/src/bernstein/cli/commands/cost.py`
  — cost breakdown subcommand.

Output Bernstein típico:
```
5 stages × 12 tasks × Sonnet 4.5: estimated $3.40, ~14 min wallclock.
```

Vamos fazer parecido mas mais detalhado.

## Dependencies (DAG)

- **F0.1** — `pipelineSchema.parse()` valida input antes de estimar.
- **F0.2** — `getPriceCatalog()` + `estimateCost()` para preço por modelo.
- **F0.3** *(opcional, mas recomendado)* — refina prior empírico se
  histórico disponível.

## What to build

### New files

| Path | Purpose |
|---|---|
| `src/forecast/index.ts` | API principal: `forecastPipeline(pipeline, opts) → ForecastReport`. |
| `src/forecast/token-estimator.ts` | Estima tokens IN/OUT por step (baseline + per-file). |
| `src/forecast/forecast.test.ts` | Testes contra fixtures de pipelines reais. |
| `src/cli/commands/dry-run.ts` | Render da CLI: tabela texto, JSON output. |
| `src/ui/screens/forecast-screen.tsx` | Tela TUI pré-execução com `[a]ccept / [c]ancel`. |

### Existing files to modify

| Path | Change |
|---|---|
| `src/cli.tsx` | `huu run --dry-run <pipeline.json>` rota nova. Manter ortogonal a `--stub`. Adicionar `--json` flag global ao subcomando. |
| `src/app.tsx` | Quando `huu run` é invocado em modo TUI, exibir `ForecastScreen` antes do `ModelPickerScreen`. |
| `package.json` | Possível adição de `cli-table3` ou similar para render bonito; **prefer não adicionar** — render manual é OK. |

### Code sketch (`src/forecast/token-estimator.ts`)

```typescript
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Pipeline, PromptStep } from '../schema/pipeline-v1.js';
import type { HistoryEntry } from '../lib/history.js';
import { aggregate } from '../lib/history.js';

/** Heuristic constants — refine over time with empirical data. */
const SYSTEM_PROMPT_TOKENS = 800;       // Pi SDK system prompt baseline
const FILE_SCAN_OVERHEAD_TOKENS = 200;  // overhead per file read
const TOKENS_PER_BYTE = 0.25;           // English code: ~4 bytes/token
const DEFAULT_OUTPUT_TOKENS = 4000;     // mean LLM output for code mod
const DEFAULT_TURNS = 3;                // mean turns per agent

export interface StepEstimate {
  stepIndex: number;
  stepName: string;
  modelId: string;
  tasksCount: number;
  /** Per-task. */
  tokensInPerTask: number;
  tokensOutPerTask: number;
  totalTokensIn: number;
  totalTokensOut: number;
  /** Source of this estimate: 'theoretical' or 'empirical' (uses history). */
  priorSource: 'theoretical' | 'empirical';
}

export async function estimateStep(
  step: PromptStep,
  stepIndex: number,
  defaultModelId: string,
  repoRoot: string,
  history: HistoryEntry[] = [],
): Promise<StepEstimate> {
  const modelId = step.modelId ?? defaultModelId;
  const tasksCount = step.files.length === 0 ? 1 : step.files.length;

  // Theoretical prior:
  const promptTokens = Math.ceil(step.prompt.length * TOKENS_PER_BYTE);
  const fileTokens = await estimateFileTokens(repoRoot, step.files);
  const baselineIn = SYSTEM_PROMPT_TOKENS + promptTokens + fileTokens;
  const tokensIn = baselineIn * DEFAULT_TURNS;
  const tokensOut = DEFAULT_OUTPUT_TOKENS * DEFAULT_TURNS;

  // Empirical refinement: if we have ≥5 history entries for this stepName + modelId,
  // use the median.
  const matching = history.filter((h) => h.stepName === step.name && h.modelId === modelId);
  if (matching.length >= 5) {
    const stats = aggregate(matching);
    const empiricalIn = matching.reduce((a, e) => a + e.tokensIn, 0) / matching.length;
    const empiricalOut = matching.reduce((a, e) => a + e.tokensOut, 0) / matching.length;
    return {
      stepIndex,
      stepName: step.name,
      modelId,
      tasksCount,
      tokensInPerTask: empiricalIn,
      tokensOutPerTask: empiricalOut,
      totalTokensIn: empiricalIn * tasksCount,
      totalTokensOut: empiricalOut * tasksCount,
      priorSource: 'empirical',
    };
  }

  return {
    stepIndex,
    stepName: step.name,
    modelId,
    tasksCount,
    tokensInPerTask: tokensIn,
    tokensOutPerTask: tokensOut,
    totalTokensIn: tokensIn * tasksCount,
    totalTokensOut: tokensOut * tasksCount,
    priorSource: 'theoretical',
  };
}

async function estimateFileTokens(repoRoot: string, files: string[]): Promise<number> {
  let total = 0;
  for (const f of files) {
    try {
      const stat = await fs.stat(path.join(repoRoot, f));
      total += stat.size * TOKENS_PER_BYTE + FILE_SCAN_OVERHEAD_TOKENS;
    } catch {
      // file may not exist yet (intentional creation step) — assume small
      total += 500;
    }
  }
  return Math.ceil(total);
}
```

### Code sketch (`src/forecast/index.ts`)

```typescript
import type { Pipeline } from '../schema/pipeline-v1.js';
import { getPriceCatalog, estimateCost } from '../lib/price-catalog.js';
import { queryHistory } from '../lib/history.js';
import { estimateStep, type StepEstimate } from './token-estimator.js';

const DEFAULT_STEP_DURATION_MS = 60_000; // p50 from typical Sonnet code-edit task

export interface ForecastReport {
  pipeline: { name: string; stagesCount: number; tasksCount: number };
  totalCostUsd: number;
  totalCostCi95Usd: number;
  wallClockMs: number;
  unknownModels: string[];
  perStep: StepEstimate[];
  perModel: Record<string, { tasks: number; costUsd: number }>;
  source: 'theoretical' | 'mixed' | 'empirical';
}

export async function forecastPipeline(
  pipeline: Pipeline,
  opts: { repoRoot: string; defaultModelId: string; concurrency: number },
): Promise<ForecastReport> {
  const catalog = await getPriceCatalog();
  const history = await queryHistory(opts.repoRoot, { successOnly: true });

  const perStep: StepEstimate[] = [];
  for (let i = 0; i < pipeline.steps.length; i++) {
    perStep.push(await estimateStep(pipeline.steps[i], i, opts.defaultModelId, opts.repoRoot, history));
  }

  let totalCost = 0;
  let totalCi95 = 0;
  const unknownModels = new Set<string>();
  const perModel: Record<string, { tasks: number; costUsd: number }> = {};
  for (const s of perStep) {
    const c = estimateCost(catalog, s.modelId, s.totalTokensIn, s.totalTokensOut);
    if (!c.modelKnown) unknownModels.add(s.modelId);
    totalCost += c.usd;
    totalCi95 += c.ci95;
    perModel[s.modelId] ??= { tasks: 0, costUsd: 0 };
    perModel[s.modelId].tasks += s.tasksCount;
    perModel[s.modelId].costUsd += c.usd;
  }

  // Wall-clock: stages are sequential, tasks within a stage are parallel up to concurrency.
  let wallClockMs = 0;
  for (const s of perStep) {
    const passes = Math.ceil(s.tasksCount / opts.concurrency);
    wallClockMs += passes * DEFAULT_STEP_DURATION_MS;
  }

  const sources = new Set(perStep.map((s) => s.priorSource));
  const source: ForecastReport['source'] =
    sources.size === 1 ? [...sources][0] : 'mixed';

  return {
    pipeline: {
      name: pipeline.name,
      stagesCount: pipeline.steps.length,
      tasksCount: perStep.reduce((a, s) => a + s.tasksCount, 0),
    },
    totalCostUsd: totalCost,
    totalCostCi95Usd: totalCi95,
    wallClockMs,
    unknownModels: [...unknownModels],
    perStep,
    perModel,
    source,
  };
}
```

### Code sketch (`src/cli/commands/dry-run.ts`)

```typescript
import { loadPipelineFromFile } from '../../lib/pipeline-io.js';
import { forecastPipeline, type ForecastReport } from '../../forecast/index.js';
import { resolveRepoRoot } from '../../git/git-client.js'; // existing helper

export async function runDryRunCommand(argv: string[]): Promise<number> {
  const json = argv.includes('--json');
  const file = argv.find((a) => !a.startsWith('--'));
  if (!file) {
    console.error('Usage: huu run --dry-run <pipeline.json>');
    return 2;
  }

  const pipeline = await loadPipelineFromFile(file);
  const repoRoot = resolveRepoRoot(process.cwd());
  const report = await forecastPipeline(pipeline, {
    repoRoot,
    defaultModelId: 'anthropic/claude-sonnet-4-6',
    concurrency: 8,
  });

  if (json) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    return 0;
  }
  renderHumanReport(report);
  return 0;
}

function renderHumanReport(r: ForecastReport): void {
  console.log(`\nPlan: ${r.pipeline.tasksCount} tasks across ${r.pipeline.stagesCount} stages`);
  console.log(`Estimated cost:    $${r.totalCostUsd.toFixed(2)}  (± $${r.totalCostCi95Usd.toFixed(2)}, source=${r.source})`);
  console.log(`Estimated wall:     ${Math.ceil(r.wallClockMs / 60_000)} min  (concurrency=8)`);
  console.log('Per model:');
  for (const [m, v] of Object.entries(r.perModel)) {
    console.log(`  ${m.padEnd(40)} $${v.costUsd.toFixed(2).padStart(8)}  ${v.tasks} tasks`);
  }
  if (r.unknownModels.length) {
    console.log(`\n⚠ Unknown models (cost $0 in estimate): ${r.unknownModels.join(', ')}`);
    console.log(`  Run "huu prices --refresh" to update the catalog.`);
  }
}
```

### Wire into `src/cli.tsx`

In the run-command handler (around line 207), check for `--dry-run` flag
and dispatch:

```typescript
if (firstArg === 'run') {
  const args = process.argv.slice(3);
  if (args.includes('--dry-run')) {
    const { runDryRunCommand } = await import('./cli/commands/dry-run.js');
    process.exit(await runDryRunCommand(args.filter((a) => a !== '--dry-run')));
  }
  // ... existing TUI flow ...
}
```

### TUI integration (`src/ui/screens/forecast-screen.tsx`)

When `huu run pipeline.json` is invoked WITHOUT `--dry-run` from terminal,
the TUI now shows the forecast as an intermediate screen between
`ModelPickerScreen` and the actual run. User sees the same table + has
`[a]ccept` / `[c]ancel` keys. Implements **gate humano** explicitamente.

```tsx
import { Box, Text, useInput } from 'ink';
import { useEffect, useState } from 'react';
import { forecastPipeline, type ForecastReport } from '../../forecast/index.js';

export function ForecastScreen({ pipeline, defaultModelId, repoRoot, onAccept, onCancel }: Props) {
  const [report, setReport] = useState<ForecastReport | null>(null);
  useEffect(() => {
    forecastPipeline(pipeline, { repoRoot, defaultModelId, concurrency: 8 }).then(setReport);
  }, []);

  useInput((input) => {
    if (input.toLowerCase() === 'a') onAccept();
    if (input.toLowerCase() === 'c') onCancel();
  });

  if (!report) return <Text>Estimating cost…</Text>;
  return (
    <Box flexDirection="column">
      <Text bold>Cost forecast for "{pipeline.name}"</Text>
      <Text>{report.pipeline.tasksCount} tasks · ${report.totalCostUsd.toFixed(2)} (± ${report.totalCostCi95Usd.toFixed(2)})</Text>
      <Text>~{Math.ceil(report.wallClockMs / 60_000)} min wall-clock</Text>
      {/* ... per-model breakdown ... */}
      <Text>[a]ccept   [c]ancel</Text>
    </Box>
  );
}
```

## Libraries

Nenhuma nova. Tudo built-in ou trazido por F0.1/F0.2/F0.3.

## Tests

### Unit (`src/forecast/forecast.test.ts`)

```typescript
import { describe, it, expect, vi } from 'vitest';
import { forecastPipeline } from './index.js';
import * as priceCatalog from '../lib/price-catalog.js';
import * as historyMod from '../lib/history.js';

describe('forecastPipeline', () => {
  beforeEach(() => {
    vi.spyOn(priceCatalog, 'getPriceCatalog').mockResolvedValue({
      fetchedAt: Date.now(), source: 'live',
      prices: {
        'anthropic/claude-sonnet-4-6': {
          inputPerMillion: 3, outputPerMillion: 15,
          cacheReadPerMillion: 0.3, cacheWritePerMillion: 3.75,
        },
      },
    });
    vi.spyOn(historyMod, 'queryHistory').mockResolvedValue([]);
  });

  it('estimates cost for whole-project step', async () => {
    const pipeline = {
      name: 'demo',
      steps: [{ name: 'A', prompt: 'do A', files: [] }],
    };
    const r = await forecastPipeline(pipeline, {
      repoRoot: '/tmp', defaultModelId: 'anthropic/claude-sonnet-4-6', concurrency: 8,
    });
    expect(r.totalCostUsd).toBeGreaterThan(0);
    expect(r.pipeline.tasksCount).toBe(1);
    expect(r.unknownModels).toEqual([]);
    expect(r.source).toBe('theoretical');
  });

  it('flags unknown model', async () => {
    const r = await forecastPipeline(
      { name: 'x', steps: [{ name: 'A', prompt: 'p', files: [], modelId: 'unknown/model' }] },
      { repoRoot: '/tmp', defaultModelId: 'unknown/model', concurrency: 1 },
    );
    expect(r.unknownModels).toContain('unknown/model');
    expect(r.totalCostUsd).toBe(0);
  });

  it('uses empirical prior when history present', async () => {
    vi.spyOn(historyMod, 'queryHistory').mockResolvedValue(
      Array.from({ length: 10 }, () => ({
        ts: '2026-01-01', runId: 'r', stageIndex: 0, stepName: 'A', agentId: 1,
        modelId: 'anthropic/claude-sonnet-4-6', files: [], success: true,
        costUsd: 0.10, tokensIn: 5000, tokensOut: 1000,
        cacheReadTokens: 0, cacheWriteTokens: 0, durationMs: 30000,
      })),
    );
    const r = await forecastPipeline(
      { name: 'x', steps: [{ name: 'A', prompt: 'p', files: [] }] },
      { repoRoot: '/tmp', defaultModelId: 'anthropic/claude-sonnet-4-6', concurrency: 1 },
    );
    expect(r.source).toBe('empirical');
  });
});
```

### Integration

- Manual: rodar contra `pipelines/demo-rapida.pipeline.json` real e
  conferir output.
- Calibração: depois de 50 runs reais com history populado, comparar
  predição vs realidade. Mediana de erro deve ser <30%.

## Acceptance criteria

- [ ] `huu run --dry-run example.pipeline.json` completa em <1s.
- [ ] `--json` mode emite ForecastReport parseável.
- [ ] Modelos sem preço conhecido: warning, não erro fatal.
- [ ] TUI: tela de forecast aparece *antes* do run real, exige aprovação.
- [ ] Variação real vs estimativa em 10 runs registradas: mediana <30% de
      erro (validar manualmente após F0.3 popular history).
- [ ] `npm run typecheck && npm test` zero regressões.
- [ ] Smoke: `./scripts/smoke-pipeline.sh` continua passando.

## Out of scope

- ❌ Estimar wall-clock baseado em modelo do agente (usamos constante por
      ora; refinar quando F0.3 acumular dados).
- ❌ Retry estimation (assumimos 0 retries para baseline).
- ❌ Cache hit rate estimation (assumimos 0% no MVP).
- ❌ Bandit-driven model swap (F6 banido).

## Risk register

| Risco | Mitigação |
|---|---|
| Estimativa muito errada cria falsa confiança | Sempre exibir CI 95% e source (theoretical/empirical/mixed). |
| Modelos novos não estão no catálogo | F0.2 fallback + manual update; warning prominente. |
| Repos grandes têm files com 100k LOC → estimativa explode | Cap por step: warn se step prevê >$5; sugerir splitting. |

## Estimated effort

3 dias-dev sênior:
- 1 dia: token-estimator + tests.
- 1 dia: forecast aggregation + CLI render.
- 0.5 dia: TUI screen integration.
- 0.5 dia: calibração inicial + docs.

## After this task is merged

Desbloqueia: **F9** (`huu pr` body inclui forecast vs actual), **F10**
(autofix usa forecast antes de spawn). Indiretamente desbloqueia
adoção real do `huu` em projetos com budget consciente.

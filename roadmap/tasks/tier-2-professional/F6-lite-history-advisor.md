# F6-lite · `huu lint` (History Advisor + Schema Validator)

> **Tier:** 2 (Professional) · **Esforço:** 1–2 dias
> **Dependências:** F0.1, F0.3, F1, F7.

## Project Paths

- **`huu`:** `/home/ondokai/Projects/huu.worktrees/ai-task-1777469117`
- **Bernstein:** `/home/ondokai/Projects/bernstein`

## Context

Roadmap (`README.md:567`) lista `huu lint` como TODO. Esta task entrega:

- **Schema validation** estrita (já existe via F0.1; lint expõe).
- **Overlap detection** entre `step.files` em stages diferentes.
- **History advisor** (de F0.3): "step X falhou 12/20 vezes com Gemini
  Flash; considere Haiku 4.5 (success 18/20)".
- **Cost flag**: avisar se pipeline estima > $10.

**Importante:** isto NÃO é bandit (F6 banido em ROADMAP §10). É só
*advisor* — humano decide.

## Current state in `huu`

- `huu run --dry-run` (F2) já estima cost.
- F0.3 history disponível.
- Sem subcomando `lint`.

## Bernstein reference

- Bernstein não tem lint dedicado; análise vem implícita no run.

## Dependencies (DAG)

- **F0.1** (schema), **F0.3** (history), **F1** (gate failure rates),
  **F7** (circuit state).

## What to build

### New files

| Path | Purpose |
|---|---|
| `src/cli/commands/lint.ts` | Subcomando completo. |
| `src/lib/lint-rules.ts` | Regras individuais. |

### Code sketch (`src/lib/lint-rules.ts`)

```typescript
import { queryHistory, aggregate } from './history.js';
import { forecastPipeline } from '../forecast/index.js';
import type { Pipeline } from '../schema/pipeline-v1.js';

export interface LintFinding {
  severity: 'error' | 'warning' | 'info';
  rule: string;
  message: string;
  step?: string;
  fix?: string;
}

export async function lintPipeline(pipeline: Pipeline, repoRoot: string): Promise<LintFinding[]> {
  const findings: LintFinding[] = [];

  // 1. Overlap detection
  const filesByStage = pipeline.steps.map((s, i) => ({ idx: i, files: new Set(s.files) }));
  for (let i = 0; i < filesByStage.length; i++) {
    for (let j = i + 1; j < filesByStage.length; j++) {
      const overlap = [...filesByStage[i].files].filter((f) => filesByStage[j].files.has(f));
      if (overlap.length > 0) {
        findings.push({
          severity: 'warning',
          rule: 'file-overlap',
          message: `Stages "${pipeline.steps[i].name}" and "${pipeline.steps[j].name}" both touch: ${overlap.slice(0, 3).join(', ')}${overlap.length > 3 ? '...' : ''}`,
          step: pipeline.steps[i].name,
          fix: 'Move shared files to one stage or split them.',
        });
      }
    }
  }

  // 2. $file placeholder check
  for (const step of pipeline.steps) {
    if (step.files.length > 0 && !step.prompt.includes('$file')) {
      findings.push({
        severity: 'warning',
        rule: 'missing-file-placeholder',
        message: `Step "${step.name}" has files but prompt doesn't reference $file`,
        step: step.name,
        fix: 'Add $file in the prompt to differentiate per-file work.',
      });
    }
  }

  // 3. History advisor
  const history = await queryHistory(repoRoot, {});
  for (const step of pipeline.steps) {
    const modelId = step.modelId;
    if (!modelId) continue;
    const matching = history.filter((h) => h.stepName === step.name && h.modelId === modelId);
    if (matching.length >= 5) {
      const stats = aggregate(matching);
      if (stats.successRate < 0.6) {
        // Find an alternative model that works better
        const altByModel = new Map<string, ReturnType<typeof aggregate>>();
        for (const e of history.filter((h) => h.stepName === step.name)) {
          if (!altByModel.has(e.modelId)) {
            altByModel.set(e.modelId, aggregate(history.filter((h) => h.stepName === step.name && h.modelId === e.modelId)));
          }
        }
        const better = [...altByModel.entries()]
          .filter(([m, s]) => m !== modelId && s.count >= 5 && s.successRate > stats.successRate)
          .sort((a, b) => b[1].successRate - a[1].successRate)[0];
        findings.push({
          severity: 'info',
          rule: 'low-success-rate',
          message: `Step "${step.name}" has ${(stats.successRate * 100).toFixed(0)}% success with ${modelId} (${matching.length} runs).`,
          step: step.name,
          fix: better
            ? `Consider ${better[0]} (${(better[1].successRate * 100).toFixed(0)}% success).`
            : 'No alternative model in history yet.',
        });
      }
    }
  }

  // 4. Cost flag
  try {
    const forecast = await forecastPipeline(pipeline, {
      repoRoot, defaultModelId: 'anthropic/claude-sonnet-4-6', concurrency: 8,
    });
    if (forecast.totalCostUsd > 10) {
      findings.push({
        severity: 'warning',
        rule: 'expensive-pipeline',
        message: `Estimated cost: $${forecast.totalCostUsd.toFixed(2)} (over $10 threshold).`,
        fix: 'Consider routing mechanical steps to Haiku/Gemini Flash.',
      });
    }
  } catch { /* skip if forecast fails */ }

  return findings;
}
```

### Code sketch (`src/cli/commands/lint.ts`)

```typescript
import { loadPipelineFromFile } from '../../lib/pipeline-io.js';
import { lintPipeline, type LintFinding } from '../../lib/lint-rules.js';
import { resolveRepoRoot } from '../../git/git-client.js';

export async function runLintCommand(argv: string[]): Promise<number> {
  const json = argv.includes('--json');
  const file = argv.find((a) => !a.startsWith('--'));
  if (!file) { console.error('Usage: huu lint <pipeline.json>'); return 2; }

  const pipeline = await loadPipelineFromFile(file);
  const repoRoot = resolveRepoRoot(process.cwd());
  const findings = await lintPipeline(pipeline, repoRoot);

  if (json) {
    process.stdout.write(JSON.stringify(findings, null, 2) + '\n');
  } else {
    if (findings.length === 0) {
      console.log('✓ No issues found.');
    } else {
      for (const f of findings) {
        const sym = f.severity === 'error' ? '✗' : f.severity === 'warning' ? '⚠' : 'i';
        console.log(`${sym} [${f.rule}] ${f.message}`);
        if (f.fix) console.log(`  fix: ${f.fix}`);
      }
    }
  }
  const errors = findings.filter((f) => f.severity === 'error').length;
  return errors > 0 ? 1 : 0;
}
```

### Wire into `src/cli.tsx`

```typescript
if (firstArg === 'lint') {
  const { runLintCommand } = await import('./cli/commands/lint.js');
  process.exit(await runLintCommand(process.argv.slice(3)));
}
```

## Libraries

Nenhuma nova.

## Tests

```typescript
import { describe, it, expect } from 'vitest';
import { lintPipeline } from './lint-rules.js';

describe('lintPipeline', () => {
  it('detects file overlap', async () => {
    const findings = await lintPipeline({
      name: 'x',
      steps: [
        { name: 's1', prompt: 'p $file', files: ['a.ts', 'b.ts'] },
        { name: 's2', prompt: 'q $file', files: ['b.ts', 'c.ts'] },
      ],
    } as any, '/tmp');
    expect(findings.find((f) => f.rule === 'file-overlap')).toBeDefined();
  });

  it('warns on missing $file placeholder', async () => {
    const findings = await lintPipeline({
      name: 'x', steps: [{ name: 's', prompt: 'no placeholder', files: ['a.ts'] }],
    } as any, '/tmp');
    expect(findings.find((f) => f.rule === 'missing-file-placeholder')).toBeDefined();
  });
});
```

## Acceptance criteria

- [ ] `huu lint pipeline.json` em pipeline com overlap detecta em <100ms (cold).
- [ ] `--json` output parseável.
- [ ] History advisor sugere model baseado em stats reais (não hard-coded).
- [ ] Sem history → sem advisor findings (graceful).

## Out of scope

- ❌ Auto-fix (apenas diagnose).
- ❌ Bandit completo (banido).
- ❌ Plugin custom rules.

## Risk register

| Risco | Mitigação |
|---|---|
| History pequeno → advisor errado | Min 5 runs antes de sugerir; documentar. |
| Forecast falha em CI sem network | Try/catch; `expensive-pipeline` é "soft" check. |

## Estimated effort

1–2 dias.

## After this task is merged

Onboarding melhora; usuário pega bugs antes de gastar tokens.

# F10 · `huu autofix` Daemon

> **Tier:** 3 (Platform) · **Esforço:** 5 dias
> **Dependências:** F1, F2, F9, F12.

## Project Paths

- **`huu`:** `/home/ondokai/Projects/huu.worktrees/ai-task-1777469117`
- **Bernstein:** `/home/ondokai/Projects/bernstein`

## Context

CI vermelho em PR aberto pelo `huu`? `huu autofix` é um daemon que polla
o status, identifica falhas conhecidas (lint/type/test patterns), spawna
pipeline de fix, push.

**Crítico:** *segunda* falha consecutiva → para e alerta humano.
Não loop infinito.

## Current state in `huu`

- Sem daemon mode. Sem CI poll.

## Bernstein reference

- `/home/ondokai/Projects/bernstein/src/bernstein/core/autofix/daemon.py`
- `/home/ondokai/Projects/bernstein/src/bernstein/cli/commands/autofix_cmd.py`

## Dependencies (DAG)

- **F1** — gate awareness (consume gate report from PR body).
- **F2** — cost forecast antes de spawn.
- **F9** — abrir PR de fix.
- **F12** — hooks para notify.

## What to build

### New files

| Path | Purpose |
|---|---|
| `src/autofix/daemon.ts` | Loop principal. |
| `src/autofix/ci-detector.ts` | `gh run view` parser. |
| `src/autofix/fix-templates.ts` | Pipeline templates por classe de erro. |
| `src/cli/commands/autofix.ts` | Subcomando. |

### Code sketch (`src/autofix/daemon.ts`)

```typescript
import { execa } from 'execa';
import { detectCiFailure, type CiFailure } from './ci-detector.js';
import { templateFromFailure } from './fix-templates.js';
import { savePipelineToFile } from '../lib/pipeline-io.js';
import { forecastPipeline } from '../forecast/index.js';

interface DaemonOptions {
  prUrl: string;
  pollMs: number;
  costCapUsd: number;
  attempts: number;
  notifier: (msg: string) => Promise<void>;
}

export async function runAutofixDaemon(opts: DaemonOptions): Promise<void> {
  let attemptsLeft = opts.attempts;
  while (attemptsLeft > 0) {
    const status = await getPrCi(opts.prUrl);
    if (status.state === 'success') {
      await opts.notifier(`✓ ${opts.prUrl}: green`);
      return;
    }
    if (status.state === 'pending') {
      await sleep(opts.pollMs);
      continue;
    }
    // state === 'failure'
    const failure = await detectCiFailure(opts.prUrl);
    const pipeline = templateFromFailure(failure);
    if (!pipeline) {
      await opts.notifier(`Cannot auto-fix ${opts.prUrl}; human required`);
      return;
    }
    const tmp = `/tmp/autofix-${Date.now()}.huu-pipeline.json`;
    await savePipelineToFile(tmp, pipeline);

    const forecast = await forecastPipeline(pipeline, {
      repoRoot: process.cwd(), defaultModelId: 'anthropic/claude-haiku-4-5', concurrency: 4,
    });
    if (forecast.totalCostUsd > opts.costCapUsd) {
      await opts.notifier(`Skipping fix: estimated $${forecast.totalCostUsd.toFixed(2)} > cap $${opts.costCapUsd}`);
      return;
    }

    await opts.notifier(`Attempting fix (attempt ${opts.attempts - attemptsLeft + 1}/${opts.attempts}): est. $${forecast.totalCostUsd.toFixed(2)}`);
    await execa('huu', ['run', tmp], { stdio: 'inherit' });
    await execa('git', ['push']);
    attemptsLeft--;
    await sleep(opts.pollMs);
  }
  await opts.notifier(`Autofix exhausted (${opts.attempts} attempts) for ${opts.prUrl}`);
}

async function getPrCi(prUrl: string): Promise<{ state: 'success' | 'failure' | 'pending' }> {
  const { stdout } = await execa('gh', ['pr', 'view', prUrl, '--json', 'statusCheckRollup']);
  const pr = JSON.parse(stdout);
  // ... parse rollup ...
  return { state: 'pending' };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
```

### Code sketch (`src/autofix/fix-templates.ts`)

```typescript
import type { Pipeline } from '../schema/pipeline-v1.js';

export interface CiFailure {
  type: 'lint' | 'typecheck' | 'test' | 'unknown';
  files: string[];
  errorSnippets: string[];
}

export function templateFromFailure(f: CiFailure): Pipeline | null {
  switch (f.type) {
    case 'lint':
      return {
        name: `autofix-lint-${Date.now()}`,
        steps: [{
          name: 'Fix lint errors',
          prompt: `Fix lint errors in $file. Errors:\n${f.errorSnippets.join('\n')}`,
          files: f.files,
          modelId: 'anthropic/claude-haiku-4-5',
        }],
      };
    case 'typecheck':
      return {
        name: `autofix-types-${Date.now()}`,
        steps: [{
          name: 'Fix TypeScript errors',
          prompt: `Fix TS errors in $file. Errors:\n${f.errorSnippets.join('\n')}`,
          files: f.files,
        }],
      };
    case 'test':
      return null; // tests fixing requires understanding intent — human required
    default:
      return null;
  }
}
```

### Subcomando

```typescript
// src/cli/commands/autofix.ts
import { runAutofixDaemon } from '../../autofix/daemon.js';

export async function runAutofixCommand(argv: string[]): Promise<number> {
  const prUrl = argv[0];
  const pollMs = parseInt(argv[argv.indexOf('--poll') + 1] ?? '300000', 10);
  const costCap = parseFloat(argv[argv.indexOf('--cost-cap') + 1] ?? '5');
  const attempts = parseInt(argv[argv.indexOf('--max-attempts') + 1] ?? '2', 10);

  await runAutofixDaemon({
    prUrl, pollMs, costCapUsd: costCap, attempts,
    notifier: async (msg) => console.log(`[autofix] ${msg}`),
  });
  return 0;
}
```

## Libraries

`execa` (ja em F1).

## Tests

```typescript
import { describe, it, expect } from 'vitest';
import { templateFromFailure } from './fix-templates.js';

describe('templateFromFailure', () => {
  it('builds lint fix pipeline', () => {
    const p = templateFromFailure({
      type: 'lint', files: ['src/foo.ts'], errorSnippets: ['Unused var x'],
    });
    expect(p?.steps[0].name).toContain('lint');
  });

  it('returns null for test failures', () => {
    expect(templateFromFailure({ type: 'test', files: [], errorSnippets: [] })).toBeNull();
  });
});
```

## Acceptance criteria

- [ ] `huu autofix <pr-url>` polla CI a cada 5min (configurável).
- [ ] Detecta lint/type errors automaticamente; testes vão pra human.
- [ ] 2 falhas consecutivas → para + alerta.
- [ ] Cost cap respect (default $5 por fix attempt).
- [ ] Notifier plugável via env (`HUU_AUTOFIX_NOTIFY=ntfy:topic`).

## Out of scope

- ❌ Self-healing infinito (cap atemptos).
- ❌ Fix em PRs não-criados-por-`huu` (manter scope inicial).

## Risk register

| Risco | Mitigação |
|---|---|
| Loop infinito | Hard cap em attempts; human escalation. |
| Burst de tokens | Cost cap antes de spawn. |
| Daemon crash | Documentar systemd unit; supervisor externo. |

## Estimated effort

5 dias.

## After this task is merged

Resolve "PRs flake" — pain mais real de quem usa agentes.

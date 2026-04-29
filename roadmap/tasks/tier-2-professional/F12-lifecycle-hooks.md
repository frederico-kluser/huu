# F12 · Lifecycle Hooks

> **Tier:** 2 (Professional) · **Esforço:** 2–3 dias · **Bloqueia:** F7, F10, F14, F19
> **Dependências:** F0.4 (event bus)

## Project Paths

- **`huu` (target):** `/home/ondokai/Projects/huu.worktrees/ai-task-1777469117`
- **Bernstein (reference):** `/home/ondokai/Projects/bernstein`

## Context

Hooks permitem usuário injetar shell scripts em pontos do lifecycle:
notify Slack quando run termina, trigger backup quando merge completa,
custom validation antes de spawn. Sem precisar mudar `huu` core.

## Current state in `huu`

- F0.4 (event bus) emite eventos. Hooks são consumers públicos do bus
  via shell scripts.
- Nenhum sistema de hooks implementado.

## Bernstein reference

- `/home/ondokai/Projects/bernstein/src/bernstein/core/hook_protocol.py`
  — `pluggy`-based, hooks via Python plugins.
- Vamos fazer mais simples: shell scripts em `.huu/hooks/`.

## Dependencies (DAG)

- **F0.4** — hooks são subscribers do event bus.

## What to build

### New files

| Path | Purpose |
|---|---|
| `src/hooks/runner.ts` | Discover scripts em `.huu/hooks/`, registrar como subscribers. |
| `src/hooks/hooks.test.ts` | Test runner com fixtures. |

### Code sketch (`src/hooks/runner.ts`)

```typescript
import { execa } from 'execa';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { EventBus, OrchEvent } from '../orchestrator/event-bus.js';

const HOOK_NAMES: Record<string, OrchEvent['type']> = {
  pre_run:    'run_started',
  post_run:   'run_finished',
  pre_stage:  'stage_started',
  post_stage: 'stage_completed',
  pre_task:   'agent_spawned',
  post_task:  'agent_finished',
  pre_merge:  'merge_started',
  post_merge: 'merge_completed',
};

export async function registerHooks(repoRoot: string, bus: EventBus): Promise<() => void> {
  const dir = path.join(repoRoot, '.huu', 'hooks');
  let scripts: string[] = [];
  try {
    scripts = await fs.readdir(dir);
  } catch {
    return () => {}; // no hooks dir
  }

  const offFns: Array<() => void> = [];
  for (const [hookName, eventType] of Object.entries(HOOK_NAMES)) {
    const candidates = scripts.filter((s) => s.startsWith(hookName) && (s.endsWith('.sh') || !s.includes('.')));
    for (const script of candidates) {
      const scriptPath = path.join(dir, script);
      const off = bus.on(eventType, async (event) => {
        try {
          await execa(scriptPath, [], {
            env: eventToEnv(event, repoRoot),
            timeout: 30_000,
            cwd: repoRoot,
          });
        } catch (err) {
          if (hookName.startsWith('pre_')) {
            // Pre-hook failure aborts (the bus's emit will throw)
            throw new Error(`Hook ${script} failed: ${String(err)}`);
          }
          // Post-hook errors logged, not thrown
          console.warn(`[hooks] ${script} failed:`, err);
        }
      });
      offFns.push(off);
    }
  }
  return () => offFns.forEach((f) => f());
}

function eventToEnv(event: OrchEvent, repoRoot: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HUU_REPO_ROOT: repoRoot,
    HUU_EVENT_TYPE: event.type,
    HUU_RUN_ID: event.runId,
    HUU_TS: String(event.ts),
  };
  switch (event.type) {
    case 'agent_spawned':
      env.HUU_AGENT_ID = String(event.agentId);
      env.HUU_MODEL_ID = event.modelId;
      env.HUU_FILES_JSON = JSON.stringify(event.files);
      env.HUU_WORKTREE_PATH = event.worktreePath;
      break;
    case 'agent_finished':
      env.HUU_AGENT_ID = String(event.agentId);
      env.HUU_EXIT_CODE = event.success ? '0' : '1';
      env.HUU_COST_USD = String(event.costUsd);
      env.HUU_TOKENS_IN = String(event.tokensIn);
      env.HUU_TOKENS_OUT = String(event.tokensOut);
      break;
    case 'stage_started':
      env.HUU_STAGE_INDEX = String(event.stageIndex);
      env.HUU_STAGE_NAME = event.stageName;
      break;
    case 'run_finished':
      env.HUU_STATUS = event.status;
      env.HUU_TOTAL_COST_USD = String(event.totalCostUsd);
      break;
    // ... add more as needed
  }
  return env;
}
```

### Wire into orchestrator

```typescript
import { registerHooks } from '../hooks/runner.js';

// In orchestrator init:
const offHooks = await registerHooks(repoRoot, this.bus);
try {
  // ... run ...
} finally {
  offHooks();
}
```

### Example user hooks

`.huu/hooks/post_run`:
```bash
#!/usr/bin/env bash
# Notify on completion via ntfy
curl -d "huu run $HUU_RUN_ID finished: $HUU_STATUS, \$$HUU_TOTAL_COST_USD" ntfy.sh/my-topic
```

`.huu/hooks/pre_task`:
```bash
#!/usr/bin/env bash
# Reject if cost would push monthly over budget
TOTAL_THIS_MONTH=$(jq '.costUsd' .huu/history.jsonl | awk '{s+=$1} END {print s}')
[ "$(echo "$TOTAL_THIS_MONTH > 100" | bc)" = "1" ] && echo "Monthly budget exceeded" && exit 1
exit 0
```

(Note: `pre_task` failure aborts spawn.)

## Libraries

`execa` (already added in F1).

## Tests

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { createEventBus } from '../orchestrator/event-bus.js';
import { registerHooks } from './runner.js';

describe('hooks runner', () => {
  let tmp: string;
  beforeEach(async () => { tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'huu-hooks-')); });
  afterEach(async () => { await fs.rm(tmp, { recursive: true, force: true }); });

  it('runs post_run script', async () => {
    const dir = path.join(tmp, '.huu', 'hooks');
    await fs.mkdir(dir, { recursive: true });
    const out = path.join(tmp, 'marker.txt');
    const script = `#!/bin/sh\necho "ran" > ${out}`;
    await fs.writeFile(path.join(dir, 'post_run'), script, { mode: 0o755 });

    const bus = createEventBus();
    const off = await registerHooks(tmp, bus);
    await bus.emit({ type: 'run_finished', runId: 'r', status: 'done', totalCostUsd: 0, ts: 0 });
    off();

    const content = await fs.readFile(out, 'utf-8');
    expect(content.trim()).toBe('ran');
  });

  it('pre_task failure aborts', async () => {
    const dir = path.join(tmp, '.huu', 'hooks');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'pre_task'), '#!/bin/sh\nexit 1', { mode: 0o755 });

    const bus = createEventBus();
    await registerHooks(tmp, bus);
    await expect(
      bus.emit({ type: 'agent_spawned', runId: 'r', agentId: 1, modelId: 'x', files: [], worktreePath: '/', ts: 0 }),
    ).rejects.toThrow();
  });
});
```

## Acceptance criteria

- [ ] Script em `.huu/hooks/post_run` executa após run termina.
- [ ] `pre_task` falhando aborta spawn (exit code != 0).
- [ ] `post_*` errors logam warning, não derrubam orquestrador.
- [ ] Env vars documentadas: `HUU_RUN_ID`, `HUU_AGENT_ID`, etc.
- [ ] Timeout 30s por hook.
- [ ] Documentação: exemplos de Slack notify, ntfy, datadog.

## Out of scope

- ❌ Plugin npm packages (post-MVP).
- ❌ Hooks em outras linguagens (shell script é universal).
- ❌ UI mostrando hook status — log apenas.

## Risk register

| Risco | Mitigação |
|---|---|
| Hook esconde bug interno do orchestrator | Logs claros: `[hooks] script.sh failed`. |
| Hook tira segurança do repo | Roda sob UID do user (não root). Documentar. |
| Hook timeout 30s muito curto/longo | Configurável via `HUU_HOOK_TIMEOUT_MS`. |

## Estimated effort

2–3 dias:
- 1 dia: runner + env mapping + tests.
- 0.5 dia: orchestrator wiring.
- 0.5 dia: docs com exemplos.

## After this task is merged

Desbloqueia: **F7** (token budget hook), **F10** (autofix usa hooks),
**F14** (telemetry custom como hook), **F19** (chaos injection points).

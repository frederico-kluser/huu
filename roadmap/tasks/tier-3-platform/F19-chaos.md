# F19 · `huu chaos` (Fault Injection)

> **Tier:** 3 (Platform) · **Esforço:** 2 dias
> **Dependências:** F12 (hooks/event bus).

## Project Paths

- **`huu`:** `/home/ondokai/Projects/huu.worktrees/ai-task-1777469117`
- **Bernstein:** `/home/ondokai/Projects/bernstein`

## Context

Para QA do próprio `huu` e para SLO testing em produção, injetar falhas
aleatórias: kill agentes, simular rate-limit, corromper worktree.

## Current state in `huu`

- Sem chaos engineering.

## Bernstein reference

- `/home/ondokai/Projects/bernstein/src/bernstein/cli/commands/chaos_cmd.py`

## Dependencies (DAG)

- **F12** — chaos é hook subscriber do bus.

## What to build

### New files

| Path | Purpose |
|---|---|
| `src/chaos/injector.ts` | Random fault injection. |
| `src/chaos/chaos.test.ts` | Tests. |

### Code sketch (`src/chaos/injector.ts`)

```typescript
import type { EventBus } from '../orchestrator/event-bus.js';

export interface ChaosConfig {
  /** "agent-kill@0.1" → 10% probability per agent_spawned. */
  rules: Array<{ kind: 'agent-kill' | 'latency' | 'flaky-result'; probability: number }>;
}

export function parseChaos(spec: string): ChaosConfig {
  const rules: ChaosConfig['rules'] = [];
  for (const part of spec.split(',')) {
    const m = part.match(/^([\w-]+)@([0-9.]+)$/);
    if (!m) continue;
    rules.push({ kind: m[1] as any, probability: parseFloat(m[2]) });
  }
  return { rules };
}

export function attachChaos(bus: EventBus, config: ChaosConfig, killAgent: (id: number) => Promise<void>): () => void {
  const offs: Array<() => void> = [];

  const killRule = config.rules.find((r) => r.kind === 'agent-kill');
  if (killRule) {
    offs.push(bus.on('agent_phase_changed', async (e) => {
      if (e.phase === 'streaming' && Math.random() < killRule.probability) {
        // eslint-disable-next-line no-console
        console.warn(`[chaos] killing agent ${e.agentId}`);
        await killAgent(e.agentId);
      }
    }));
  }

  const latencyRule = config.rules.find((r) => r.kind === 'latency');
  if (latencyRule) {
    offs.push(bus.on('agent_spawned', async (_e) => {
      if (Math.random() < latencyRule.probability) {
        await new Promise((r) => setTimeout(r, 5000 + Math.random() * 10000));
      }
    }));
  }

  return () => offs.forEach((f) => f());
}
```

### CLI flag

`huu run --chaos agent-kill@0.1,latency@0.05 pipeline.json`.

In orchestrator init:

```typescript
import { attachChaos, parseChaos } from '../chaos/injector.js';

if (opts.chaosSpec) {
  const config = parseChaos(opts.chaosSpec);
  attachChaos(this.bus, config, async (agentId) => {
    // hook into existing agent kill plumbing
    await this.killAgent(agentId);
  });
}
```

## Libraries

Nenhuma nova.

## Tests

```typescript
import { describe, it, expect, vi } from 'vitest';
import { parseChaos, attachChaos } from './injector.js';
import { createEventBus } from '../orchestrator/event-bus.js';

describe('chaos injector', () => {
  it('parses spec', () => {
    const c = parseChaos('agent-kill@0.5,latency@0.1');
    expect(c.rules).toHaveLength(2);
  });

  it('triggers kill at probability=1', async () => {
    const bus = createEventBus();
    const killed = vi.fn();
    attachChaos(bus, parseChaos('agent-kill@1.0'), killed);
    await bus.emit({ type: 'agent_phase_changed', runId: 'r', agentId: 1, phase: 'streaming', ts: 0 });
    expect(killed).toHaveBeenCalledWith(1);
  });
});
```

## Acceptance criteria

- [ ] `huu run --chaos agent-kill@1.0 pipeline.json` mata todos agentes.
- [ ] `--chaos agent-kill@0` é no-op.
- [ ] Documentar: NUNCA usar em produção real (apenas teste).

## Out of scope

- ❌ Network partition simulation.
- ❌ Disk full simulation.

## Risk register

| Risco | Mitigação |
|---|---|
| User esquece flag em prod | Documentação clara; warning verbose ao usar. |

## Estimated effort

2 dias.

## After this task is merged

QA do próprio `huu`.

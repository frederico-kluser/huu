# F7 · Token Budget + Circuit Breaker

> **Tier:** 2 (Professional) · **Esforço:** 3 dias · **Bloqueia:** F6-lite
> **Dependências:** F0.1 (schema), F12 (event bus / hooks).

## Project Paths

- **`huu`:** `/home/ondokai/Projects/huu.worktrees/ai-task-1777469117`
- **Bernstein:** `/home/ondokai/Projects/bernstein`

## Context

Hoje `huu` tem timeouts e retries por step. Sem **budget de tokens/USD**
nem **circuit breaker** contra agentes runaway que entram em loop e
queimam tokens sem progredir.

## Current state in `huu`

- Per-step `cardTimeoutMs`, `singleFileCardTimeoutMs`, `maxRetries`
  (`src/lib/types.ts:54-60`).
- Cost recorded per agent. Sem hard limit.

## Bernstein reference

- `/home/ondokai/Projects/bernstein/src/bernstein/evolution/circuit.py`
  — circuit breaker para evolution proposals (não tokens).
- Token-growth monitor: citado em docs Bernstein, não localizado in-tree.
  Vamos definir o nosso.

## Dependencies (DAG)

- **F0.1** — schema delta com `step.tokenBudget`, `step.circuitBreaker`.
- **F12** — pre_task hook pode emitir budget warning.

## What to build

### Schema delta

```typescript
// src/schema/pipeline-v1.ts addition:
export const tokenBudgetSchema = z.object({
  softUsd: z.number().positive(),
  hardUsd: z.number().positive(),
}).strict();

export const circuitBreakerSchema = z.object({
  consecutiveFailuresMax: z.number().int().min(1).default(3),
}).strict();

// Add to promptStepSchema:
//   tokenBudget: tokenBudgetSchema.optional(),
//   circuitBreaker: circuitBreakerSchema.optional(),
```

### New files

| Path | Purpose |
|---|---|
| `src/circuit/breaker.ts` | Per-(step, modelId) state machine. |
| `src/circuit/budget-monitor.ts` | Token budget enforcer. |
| `src/circuit/circuit.test.ts` | Tests. |

### Code sketch (`src/circuit/breaker.ts`)

```typescript
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export type CircuitState = 'closed' | 'open' | 'half-open';

interface CircuitEntry {
  consecutiveFailures: number;
  lastFailureAt?: number;
  state: CircuitState;
}

export class CircuitBreaker {
  private entries: Map<string, CircuitEntry> = new Map();
  private statePath: string;

  constructor(repoRoot: string) {
    this.statePath = path.join(repoRoot, '.huu', 'circuit.json');
  }

  async load(): Promise<void> {
    try {
      const raw = await fs.readFile(this.statePath, 'utf-8');
      this.entries = new Map(Object.entries(JSON.parse(raw)));
    } catch {
      this.entries = new Map();
    }
  }

  async save(): Promise<void> {
    await fs.mkdir(path.dirname(this.statePath), { recursive: true });
    await fs.writeFile(this.statePath, JSON.stringify(Object.fromEntries(this.entries), null, 2));
  }

  key(stepName: string, modelId: string): string {
    return `${stepName}::${modelId}`;
  }

  isAllowed(stepName: string, modelId: string): boolean {
    const e = this.entries.get(this.key(stepName, modelId));
    return !e || e.state !== 'open';
  }

  reportSuccess(stepName: string, modelId: string): void {
    const k = this.key(stepName, modelId);
    this.entries.set(k, { consecutiveFailures: 0, state: 'closed' });
  }

  reportFailure(stepName: string, modelId: string, max: number): void {
    const k = this.key(stepName, modelId);
    const e = this.entries.get(k) ?? { consecutiveFailures: 0, state: 'closed' as CircuitState };
    e.consecutiveFailures++;
    e.lastFailureAt = Date.now();
    if (e.consecutiveFailures >= max) e.state = 'open';
    this.entries.set(k, e);
  }
}
```

### Code sketch (`src/circuit/budget-monitor.ts`)

```typescript
import type { EventBus } from '../orchestrator/event-bus.js';

export interface BudgetEnforcement {
  /** Cumulative cost so far in this run. */
  cumulativeCostUsd: number;
  /** Per-step cumulative cost map. */
  perStepCostUsd: Map<string, number>;
}

export function attachBudgetMonitor(
  bus: EventBus,
  pipeline: { steps: Array<{ name: string; tokenBudget?: { softUsd: number; hardUsd: number } }> },
  onHardBreach: (agentId: number, stepName: string) => Promise<void>,
): () => void {
  const state: BudgetEnforcement = {
    cumulativeCostUsd: 0,
    perStepCostUsd: new Map(),
  };

  return bus.on('agent_finished', async (event) => {
    state.cumulativeCostUsd += event.costUsd;
    // We don't have stepName in agent_finished today — would need to track
    // it via spawn event correlation. Implement as separate map keyed by agentId.
    // ...
    // For each step with budget, check thresholds.
  });
  // (Real implementation tracks stepName via agent_spawned → agent_finished correlation.)
}
```

> **Implementation note:** budget-monitor needs `agent_spawned → agent_finished`
> correlation by `agentId`. Either: (a) extend `agent_finished` to include
> `stepName`, or (b) maintain `Map<agentId, stepName>` internally. Choose (a)
> if the event bus refactor is open.

### Wire into orchestrator

After every `agent_finished`, check budgets. If hard breach: kill the
agent's process (the SIGTERM helper that already kills timeouts can be
reused). If soft breach: emit warning to TUI.

## Libraries

Nenhuma nova.

## Tests

```typescript
import { describe, it, expect } from 'vitest';
import { CircuitBreaker } from './breaker.js';

describe('CircuitBreaker', () => {
  it('opens after consecutive failures', async () => {
    const cb = new CircuitBreaker('/tmp/circuit-test');
    cb.reportFailure('step', 'model', 3);
    expect(cb.isAllowed('step', 'model')).toBe(true); // 1st
    cb.reportFailure('step', 'model', 3);
    expect(cb.isAllowed('step', 'model')).toBe(true); // 2nd
    cb.reportFailure('step', 'model', 3);
    expect(cb.isAllowed('step', 'model')).toBe(false); // 3rd → open
  });

  it('reset on success', async () => {
    const cb = new CircuitBreaker('/tmp/circuit-test');
    cb.reportFailure('step', 'model', 3);
    cb.reportSuccess('step', 'model');
    cb.reportFailure('step', 'model', 3);
    expect(cb.isAllowed('step', 'model')).toBe(true);
  });
});
```

## Acceptance criteria

- [ ] Pipeline com `tokenBudget: { softUsd: 0.5, hardUsd: 1.0 }`:
      hard breach mata agente em <2s.
- [ ] Soft breach emite warning na TUI.
- [ ] Circuit state persistido em `.huu/circuit.json`.
- [ ] 3 falhas seguidas em (step, model) → próximas tasks skipam.
- [ ] Reset por mão: `huu circuit reset` (subcomando opcional).

## Out of scope

- ❌ Half-open recovery automático (manual reset suficiente MVP).
- ❌ Budget no nível pipeline (post-MVP).
- ❌ Per-tenant budget.

## Risk register

| Risco | Mitigação |
|---|---|
| Falso positivo (3 falhas legítimas mas trabalho importante) | `huu circuit reset` ou `--ignore-circuit` flag. |
| Hard kill durante write deixa worktree corrupta | Cleanup já existe via worktree-manager destroy. |

## Estimated effort

3 dias.

## After this task is merged

Desbloqueia: **F6-lite** advisor consome circuit history para sugerir
modelos alternativos.

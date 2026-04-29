# F26 · `huu record` / `huu replay`

> **Tier:** 3 (Platform) · **Esforço:** 6–8 dias
> **Dependências:** F4 (audit log).

## Project Paths

- **`huu`:** `/home/ondokai/Projects/huu.worktrees/ai-task-1777469117`
- **Bernstein:** `/home/ondokai/Projects/bernstein`

## Context

CI dos próprios cookbook entries (F23) precisa rodar pipelines com
custo zero. **`huu record`** captura todas interações LLM em fixtures.
**`huu replay`** re-executa contra fixtures sem network.

## Current state in `huu`

- Sem record/replay.

## Bernstein reference

- `/home/ondokai/Projects/bernstein/src/bernstein/cli/commands/gateway_cmd.py`
  — Bernstein faz via MCP gateway proxy.

## Dependencies (DAG)

- **F4** — audit log fornece o evento canônico do que aconteceu.

## What to build

### New files

| Path | Purpose |
|---|---|
| `src/record/recorder.ts` | Captura requests/responses Pi SDK. |
| `src/record/replayer.ts` | Mock Pi SDK respondendo de fixtures. |
| `src/cli/commands/record.ts` | Subcomando wrap em `huu run`. |
| `src/cli/commands/replay.ts` | Subcomando. |

### Code sketch (`src/record/recorder.ts`)

```typescript
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export interface RecordedTurn {
  agentId: number;
  request: unknown;
  response: unknown;
  ts: number;
}

export class Recorder {
  private turns: RecordedTurn[] = [];

  constructor(private repoRoot: string, private runId: string) {}

  capture(turn: RecordedTurn): void {
    this.turns.push(turn);
  }

  async flush(): Promise<void> {
    const dir = path.join(this.repoRoot, '.huu', 'fixtures', this.runId);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'turns.jsonl'),
      this.turns.map((t) => JSON.stringify(t)).join('\n') + '\n');
  }
}
```

### Code sketch (`src/record/replayer.ts`)

```typescript
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export class Replayer {
  private byAgent: Map<number, unknown[]> = new Map();
  private cursors: Map<number, number> = new Map();

  static async load(repoRoot: string, runId: string): Promise<Replayer> {
    const r = new Replayer();
    const file = path.join(repoRoot, '.huu', 'fixtures', runId, 'turns.jsonl');
    const raw = await fs.readFile(file, 'utf-8');
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      const turn = JSON.parse(line);
      const arr = r.byAgent.get(turn.agentId) ?? [];
      arr.push(turn.response);
      r.byAgent.set(turn.agentId, arr);
    }
    return r;
  }

  next(agentId: number): unknown {
    const arr = this.byAgent.get(agentId) ?? [];
    const i = this.cursors.get(agentId) ?? 0;
    if (i >= arr.length) throw new Error(`Replay exhausted for agent ${agentId}`);
    this.cursors.set(agentId, i + 1);
    return arr[i];
  }
}
```

### Pi SDK injection

In `src/orchestrator/real-agent.ts`, wrap Pi SDK calls with:

```typescript
import type { Recorder } from '../record/recorder.js';
import type { Replayer } from '../record/replayer.js';

interface AgentContext {
  recorder?: Recorder;
  replayer?: Replayer;
}

async function callLlm(ctx: AgentContext, request: unknown): Promise<unknown> {
  if (ctx.replayer) {
    return ctx.replayer.next(/* agentId */ 0);
  }
  const response = await piAgent.runTurn(request as any);
  ctx.recorder?.capture({ agentId: 0, request, response, ts: Date.now() });
  return response;
}
```

### CLI subcomandos

```typescript
// huu record run pipeline.json    → run + flush fixtures at end
// huu replay <runId>               → re-run using fixtures, no network
```

## Libraries

Nenhuma nova.

## Tests

```typescript
import { describe, it, expect } from 'vitest';
import { Recorder } from './recorder.js';
import { Replayer } from './replayer.js';

describe('record/replay', () => {
  it('round-trip: record then replay', async () => {
    // Setup tmp repo
    // Record one turn
    // Flush
    // Load replayer, next() returns same response
  });
});
```

## Acceptance criteria

- [ ] `huu record run pipeline.json` cria `.huu/fixtures/<runId>/turns.jsonl`.
- [ ] `huu replay <runId>` executa sem chamar OpenRouter (verifiable: unset `OPENROUTER_API_KEY`).
- [ ] Replay é determinístico — mesma ordem.
- [ ] Cookbook CI pode usar replay para validar entries.

## Out of scope

- ❌ Replay com modificações (não é record-and-edit).
- ❌ Cross-platform fixture portability.

## Risk register

| Risco | Mitigação |
|---|---|
| Pi SDK responses contém timestamps que invalidam comparison | Capturar exatamente; replay devolve raw response. |
| Fixtures muito grandes | NDJSON + gzip post-flush. |

## Estimated effort

6–8 dias.

## After this task is merged

Cookbook entries CI testáveis sem custo de tokens.

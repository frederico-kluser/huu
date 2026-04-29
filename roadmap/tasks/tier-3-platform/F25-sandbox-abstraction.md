# F25 · Sandbox Abstraction Pluggable

> **Tier:** 3 (Platform) · **Esforço:** 5 dias core + N por backend
> **Dependências:** F0.1.

## Project Paths

- **`huu`:** `/home/ondokai/Projects/huu.worktrees/ai-task-1777469117`
- **Bernstein:** `/home/ondokai/Projects/bernstein`

## Context

Sandbox = git worktree, hard-coded em `src/git/worktree-manager.ts`.
Para suportar E2B, Modal, etc. (sob demanda real), refactor em
interface plugável.

## Current state in `huu`

- `src/git/worktree-manager.ts` — implementação única.
- Docker é o ambiente do orchestrator, não sandbox per-task.

## Bernstein reference

- `/home/ondokai/Projects/bernstein/src/bernstein/core/security/sandbox.py`
- entry-point group `bernstein.sandbox_backends`.

## Dependencies (DAG)

- **F0.1** — schema delta com `sandbox` field.

## What to build

### Schema delta

```typescript
// src/schema/pipeline-v1.ts addition:
export const sandboxModeSchema = z.enum(['worktree', 'e2b', 'modal']).or(z.string());
// Add to pipelineSchema:
//   sandbox: sandboxModeSchema.optional().default('worktree'),
```

### New files

| Path | Purpose |
|---|---|
| `src/sandbox/types.ts` | `Sandbox` interface. |
| `src/sandbox/worktree.ts` | Built-in implementation (move logic from worktree-manager). |
| `src/sandbox/registry.ts` | Resolve name → factory. |

### Code sketch (`src/sandbox/types.ts`)

```typescript
export interface SandboxHandle {
  /** Identifier for diff/destroy. */
  id: string;
  /** Where files live (path on filesystem, or remote ref). */
  workspacePath: string;
}

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface Sandbox {
  /** Allocate a sandbox for the agent task. */
  create(opts: { taskId: string; baseCommit: string; files: string[] }): Promise<SandboxHandle>;
  /** Run a command inside the sandbox. */
  exec(handle: SandboxHandle, command: string[]): Promise<ExecResult>;
  /** Get unified diff of changes since create(). */
  diff(handle: SandboxHandle): Promise<string>;
  /** Cleanup. */
  destroy(handle: SandboxHandle): Promise<void>;
}
```

### Code sketch (`src/sandbox/registry.ts`)

```typescript
import type { Sandbox } from './types.js';
import { WorktreeSandbox } from './worktree.js';

const builtins: Record<string, () => Sandbox> = {
  worktree: () => new WorktreeSandbox(),
};

export function resolveSandbox(name: string): Sandbox {
  if (builtins[name]) return builtins[name]();
  // Plugin lookup: try to require `@huu/sandbox-${name}`
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require(`@huu/sandbox-${name}`);
    return mod.default ? new mod.default() : mod.create();
  } catch {
    throw new Error(`Unknown sandbox: ${name}. Built-in: worktree. Plugin: install @huu/sandbox-${name}.`);
  }
}
```

### Refactor `src/git/worktree-manager.ts` → `src/sandbox/worktree.ts`

Extract the existing logic into a class implementing `Sandbox`. Keep
`worktree-manager.ts` as a thin re-export for backwards compat in
existing call sites; deprecate over time.

### Wire into orchestrator

```typescript
import { resolveSandbox } from '../sandbox/registry.js';

const sandbox = resolveSandbox(pipeline.sandbox ?? 'worktree');
const handle = await sandbox.create({ taskId, baseCommit, files });
// ... agent runs against handle.workspacePath ...
await sandbox.destroy(handle);
```

## Libraries

Nenhuma nova no core.

## Tests

```typescript
import { describe, it, expect } from 'vitest';
import { resolveSandbox } from './registry.js';

describe('sandbox registry', () => {
  it('resolves worktree built-in', () => {
    const s = resolveSandbox('worktree');
    expect(s).toBeDefined();
  });

  it('throws on unknown', () => {
    expect(() => resolveSandbox('nonexistent')).toThrow(/Unknown sandbox/);
  });
});
```

## Acceptance criteria

- [ ] Existing tests passam após refactor.
- [ ] `worktree` é default.
- [ ] Plugin npm `@huu/sandbox-e2b` carregável (não construído neste PR).
- [ ] Pipeline schema aceita `sandbox: "worktree"|"e2b"|"modal"|<custom>`.

## Out of scope

- ❌ Implementar E2B/Modal backends in-tree (são plugins separados).
- ❌ Migrar testes existentes wholesale.

## Risk register

| Risco | Mitigação |
|---|---|
| Refactor introduz regressão | Testes de regressão existentes (`worktree-manager.test`). |

## Estimated effort

5 dias core + N por backend.

## After this task is merged

Plugin ecosystem (E2B, Modal) viável pelo community.

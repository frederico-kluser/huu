# F16 · ACP Bridge

> **Tier:** 3 (Platform) · **Esforço:** 1–2 dias após F3
> **Dependências:** F3 (MCP server).

## Project Paths

- **`huu`:** `/home/ondokai/Projects/huu.worktrees/ai-task-1777469117`
- **Bernstein:** `/home/ondokai/Projects/bernstein`

## Context

ACP (Agent Communication Protocol) é o protocolo do Zed Editor / Sketch.dev
para integrar agents externos sem plugin. Bernstein expõe via
`bernstein acp serve --stdio`.

Como F3 (MCP server) já existe no `huu`, ACP é tipicamente o mesmo
plumbing com schema diferente — custo marginal.

## Current state in `huu`

- F3 expõe MCP server. Sem ACP.

## Bernstein reference

- `/home/ondokai/Projects/bernstein/src/bernstein/cli/commands/acp_cmd.py`

## Dependencies (DAG)

- **F3** — base do server.

## What to build

### New files

| Path | Purpose |
|---|---|
| `src/acp/server.ts` | ACP-flavored server (stdio). |
| `src/cli/commands/acp.ts` | Subcomando. |

### Code sketch (`src/cli/commands/acp.ts`)

```typescript
import { serveAcp } from '../../acp/server.js';

export async function runAcpCommand(argv: string[]): Promise<number> {
  const sub = argv[0];
  if (sub !== 'serve') {
    console.error('Usage: huu acp serve [--stdio]');
    return 2;
  }
  await serveAcp({ transport: 'stdio' });
  return 0;
}
```

### Implementation strategy

ACP and MCP differ in:
- Message envelope (slightly different JSON-RPC variants).
- Tool registration manifest.

Reuse `src/mcp/tools/*` handlers; thin adapter in `src/acp/server.ts` that:
1. Reads JSON-RPC requests from stdin.
2. Translates to internal handler call.
3. Writes JSON-RPC responses to stdout.

If the ACP spec evolves significantly from where it is in 2026, this task
may need a real spec read. **Before starting:** check
[Zed ACP docs](https://zed.dev/docs/agents/acp) for the current schema.

## Libraries

Possibly `@zed-industries/acp-sdk` if it ships; otherwise manual JSON-RPC.

## Tests

```typescript
import { describe, it, expect } from 'vitest';
// Mock stdio, send a tool call, expect response.
```

## Acceptance criteria

- [ ] `huu acp serve --stdio` discoverable por Zed.
- [ ] Mesmas tools do MCP server expostas.
- [ ] Documentação como configurar em Zed.

## Out of scope

- ❌ ACP HTTP transport (post-MVP).
- ❌ Auth dedicado (stdio é local-only).

## Risk register

| Risco | Mitigação |
|---|---|
| ACP spec ainda em flux | Confirmar versão atual antes; não pre-implementar. |

## Estimated effort

1–2 dias.

## After this task is merged

Zed users acessam `huu` sem instalar plugin.

# F3 · MCP Server Mode

> **Tier:** 1 (Sprint) · **Esforço:** 5–7 dias · **Bloqueia:** F5, F16
> **Dependências:** F0.1 (zod schema). Tools incrementais aproveitam F2 e F4.

## Project Paths

- **`huu` (target):** `/home/ondokai/Projects/huu.worktrees/ai-task-1777469117`
- **Bernstein (reference):** `/home/ondokai/Projects/bernstein`

## Context

`huu` já recusa **MCP cliente** (consumir servers MCP) por motivo
econômico (~55k tokens/turn × N agentes paralelos é inviável). README:402-408.

Mas **MCP server** é exatamente o oposto: o `huu` se expõe *como* servidor.
Custo de tokens fica no cliente (Claude Desktop, Cursor, Zed) que consome.
Para o `huu`, custo = zero.

**Distribuição masiva quase de graça**: em 2026, quem não está em algum
cliente MCP não existe pro usuário casual. Um único click "Run pipeline X"
dentro do Claude Desktop dispara `huu` no projeto local.

**Diferenciador filosófico:** Bernstein faz MCP server "decida você";
`huu` faz com **gate humano explícito** (default exige `--auto-approve`
ou TUI confirm). Empresas regulated preferem essa combo.

## Current state in `huu`

- Zero MCP code. `package.json` não tem `@modelcontextprotocol/sdk`.
- Subcomandos não-TUI listados em `src/cli.tsx:189`.

## Bernstein reference

- `/home/ondokai/Projects/bernstein/src/bernstein/mcp/server.py:74-200`
  — implementação canônica via FastMCP Python.
- `/home/ondokai/Projects/bernstein/src/bernstein/mcp/remote_transport.py`
  — Cloudflare Workers transport (NÃO copiamos).
- `/home/ondokai/Projects/bernstein/src/bernstein/mcp/routine_tools.py`
  — tools adicionais.

Tools que Bernstein expõe:
- `bernstein_run(goal, role, priority, scope, complexity, estimated_minutes)`
- `bernstein_status()`, `bernstein_tasks(status?)`, `bernstein_cost()`
- `bernstein_approve(task_id)`, `bernstein_health()`, `bernstein_stop()`
- `load_skill(name, reference?, script?)`

## Dependencies (DAG)

- **F0.1** — `pipelineSchema.parse()` valida pipelines submetidas via tool.
- **F2** *(soft)* — tool `huu_estimate` requer F2 mergeado, mas pode ser
  adicionada incrementalmente. MVP do MCP pode não incluir.
- **F4** *(soft)* — tool `huu_audit_verify` idem.

## What to build

### New files

| Path | Purpose |
|---|---|
| `src/mcp/server.ts` | Servidor MCP com tools registradas. |
| `src/mcp/tools/run-pipeline.ts` | Tool: `huu_run_pipeline`. |
| `src/mcp/tools/list-runs.ts` | Tool: `huu_list_runs`. |
| `src/mcp/tools/run-status.ts` | Tool: `huu_run_status`. |
| `src/mcp/tools/validate-pipeline.ts` | Tool: `huu_pipeline_validate`. |
| `src/mcp/tools/cookbook.ts` | Tools: `huu_cookbook_list`, `huu_cookbook_get` (stub até F23). |
| `src/mcp/tools/estimate.ts` | Tool: `huu_estimate` (depende de F2). |
| `src/mcp/tools/audit.ts` | Tool: `huu_audit_verify` (depende de F4). |
| `src/mcp/auth.ts` | Bearer token validation para HTTP mode. |
| `src/mcp/approval-store.ts` | State para "awaiting_approval" runs. |
| `src/cli/commands/mcp.ts` | Subcomando `huu mcp serve`. |
| `src/cli/commands/approve.ts` | Subcomando `huu approve <runId>`. |
| `src/mcp/server.test.ts` | Tests dos tools (mockando dispatch real). |

### Existing files to modify

| Path | Change |
|---|---|
| `src/cli.tsx:189` | Adicionar `mcp` e `approve` em `NON_TUI_SUBCOMMANDS`. |
| `package.json` | `"@modelcontextprotocol/sdk": "^1.x.y"` (versão atual no momento da implementação). |
| `src/lib/init-docker.ts` | Adicionar flag `--with-mcp` que gera fragmento de `claude_desktop_config.json`. |

### Code sketch (`src/mcp/server.ts`)

```typescript
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { runPipelineTool, runPipelineSchema } from './tools/run-pipeline.js';
import { listRunsTool, listRunsSchema } from './tools/list-runs.js';
import { runStatusTool, runStatusSchema } from './tools/run-status.js';
import { validatePipelineTool, validatePipelineSchema } from './tools/validate-pipeline.js';
import { cookbookListTool, cookbookGetTool } from './tools/cookbook.js';

const TOOLS = {
  huu_run_pipeline: { handler: runPipelineTool, schema: runPipelineSchema, description: '...' },
  huu_list_runs: { handler: listRunsTool, schema: listRunsSchema, description: '...' },
  huu_run_status: { handler: runStatusTool, schema: runStatusSchema, description: '...' },
  huu_pipeline_validate: { handler: validatePipelineTool, schema: validatePipelineSchema, description: '...' },
  huu_cookbook_list: { handler: cookbookListTool, schema: { type: 'object' }, description: '...' },
  huu_cookbook_get: { handler: cookbookGetTool, schema: { type: 'object' }, description: '...' },
};

export interface ServeOptions {
  transport: 'stdio' | 'http';
  bind?: string;
  port?: number;
  authToken?: string;
}

export async function serveMcp(opts: ServeOptions): Promise<void> {
  const server = new Server(
    { name: 'huu', version: '0.4.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: Object.entries(TOOLS).map(([name, t]) => ({
      name,
      description: t.description,
      inputSchema: t.schema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const tool = TOOLS[req.params.name as keyof typeof TOOLS];
    if (!tool) throw new Error(`Unknown tool: ${req.params.name}`);
    const result = await tool.handler(req.params.arguments ?? {});
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  });

  if (opts.transport === 'stdio') {
    const transport = new StdioServerTransport();
    await server.connect(transport);
  } else {
    // HTTP mode requires bind = '127.0.0.1' or auth token; enforce here.
    if (opts.bind === '0.0.0.0' && !opts.authToken) {
      throw new Error('--bind 0.0.0.0 requires --auth-token');
    }
    // ... wire SSE transport ...
  }
}
```

### Code sketch (`src/mcp/tools/run-pipeline.ts`)

This is the most security-sensitive tool. Implements **gate humano**.

```typescript
import { pipelineSchema, type Pipeline } from '../../schema/pipeline-v1.js';
import { loadPipelineFromFile } from '../../lib/pipeline-io.js';
import { resolveRepoRoot } from '../../git/git-client.js';
import { saveAwaitingApproval } from '../approval-store.js';
import * as crypto from 'node:crypto';

export const runPipelineSchema = {
  type: 'object',
  properties: {
    pipeline: { type: 'object', description: 'huu-pipeline-v1 JSON object' },
    pipelinePath: { type: 'string', description: 'Absolute path to pipeline file' },
    dryRun: { type: 'boolean', default: false },
    autoApprove: { type: 'boolean', default: false },
  },
};

export interface RunPipelineArgs {
  pipeline?: unknown;
  pipelinePath?: string;
  dryRun?: boolean;
  autoApprove?: boolean;
}

export async function runPipelineTool(args: RunPipelineArgs): Promise<{
  status: 'awaiting_approval' | 'running' | 'completed' | 'estimated';
  runId: string;
  approvalUrl?: string;
  estimate?: { totalCostUsd: number; tasks: number };
}> {
  const repoRoot = resolveRepoRoot(process.cwd());
  let pipeline: Pipeline;
  if (args.pipelinePath) {
    pipeline = await loadPipelineFromFile(args.pipelinePath);
  } else if (args.pipeline) {
    pipeline = pipelineSchema.parse(args.pipeline);
  } else {
    throw new Error('One of pipeline or pipelinePath must be provided.');
  }

  const runId = `mcp-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;

  if (args.dryRun) {
    const { forecastPipeline } = await import('../../forecast/index.js');
    const forecast = await forecastPipeline(pipeline, {
      repoRoot, defaultModelId: 'anthropic/claude-sonnet-4-6', concurrency: 8,
    });
    return {
      status: 'estimated',
      runId,
      estimate: { totalCostUsd: forecast.totalCostUsd, tasks: forecast.pipeline.tasksCount },
    };
  }

  // Auto-approve gate: requires explicit env var AND args.autoApprove.
  if (args.autoApprove && process.env.HUU_MCP_AUTOAPPROVE === '1') {
    // ... directly invoke orchestrator ...
    // Audit log will tag this run with auto_approved=true (visible in `huu audit verify`).
    throw new Error('Auto-approve flow not yet implemented; use TUI approval for now.');
  }

  // Default: stash plan, return awaiting_approval.
  await saveAwaitingApproval(repoRoot, runId, pipeline);
  return {
    status: 'awaiting_approval',
    runId,
    approvalUrl: `huu://approve/${runId}`,
  };
}
```

### Code sketch (`src/mcp/approval-store.ts`)

```typescript
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Pipeline } from '../schema/pipeline-v1.js';

const DIR = '.huu/awaiting-approval';

export async function saveAwaitingApproval(
  repoRoot: string,
  runId: string,
  pipeline: Pipeline,
): Promise<void> {
  const dir = path.join(repoRoot, DIR);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, `${runId}.json`),
    JSON.stringify({ pipeline, submittedAt: new Date().toISOString() }, null, 2),
  );
}

export async function consumeAwaitingApproval(repoRoot: string, runId: string): Promise<Pipeline | null> {
  const file = path.join(repoRoot, DIR, `${runId}.json`);
  try {
    const raw = await fs.readFile(file, 'utf-8');
    await fs.unlink(file);
    return (JSON.parse(raw) as { pipeline: Pipeline }).pipeline;
  } catch {
    return null;
  }
}

export async function listAwaitingApproval(repoRoot: string): Promise<Array<{ runId: string; submittedAt: string }>> {
  const dir = path.join(repoRoot, DIR);
  try {
    const files = await fs.readdir(dir);
    const out: Array<{ runId: string; submittedAt: string }> = [];
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      const raw = await fs.readFile(path.join(dir, f), 'utf-8');
      out.push({ runId: f.replace('.json', ''), submittedAt: JSON.parse(raw).submittedAt });
    }
    return out;
  } catch {
    return [];
  }
}
```

### Code sketch (`src/cli/commands/approve.ts`)

```typescript
import { consumeAwaitingApproval, listAwaitingApproval } from '../../mcp/approval-store.js';
import { resolveRepoRoot } from '../../git/git-client.js';

export async function runApproveCommand(argv: string[]): Promise<number> {
  const repoRoot = resolveRepoRoot(process.cwd());
  const runId = argv[0];

  if (!runId) {
    const list = await listAwaitingApproval(repoRoot);
    if (list.length === 0) {
      console.log('No pipelines awaiting approval.');
      return 0;
    }
    console.log('Pending approvals:');
    for (const a of list) console.log(`  ${a.runId}  (submitted ${a.submittedAt})`);
    console.log('\nApprove with: huu approve <runId>');
    return 0;
  }

  const pipeline = await consumeAwaitingApproval(repoRoot, runId);
  if (!pipeline) {
    console.error(`No pending approval for run ${runId}`);
    return 1;
  }
  console.log(`Approved. Starting run for pipeline "${pipeline.name}"...`);
  // Spawn the actual TUI run via existing path (fork or re-exec):
  const { spawn } = await import('node:child_process');
  const tmpFile = `/tmp/huu-approved-${runId}.json`;
  await import('node:fs/promises').then((fs) =>
    fs.writeFile(tmpFile, JSON.stringify({ _format: 'huu-pipeline-v1', pipeline }, null, 2)),
  );
  spawn(process.argv[0], [process.argv[1], 'run', tmpFile], { stdio: 'inherit' });
  return 0;
}
```

### Code sketch (`src/cli/commands/mcp.ts`)

```typescript
import { serveMcp } from '../../mcp/server.js';

export async function runMcpCommand(argv: string[]): Promise<number> {
  const sub = argv[0];
  if (sub !== 'serve') {
    console.error('Usage: huu mcp serve [--stdio|--http] [--bind 127.0.0.1] [--port 3001] [--auth-token TOKEN]');
    return 2;
  }
  const transport = argv.includes('--http') ? 'http' : 'stdio';
  const bind = argv[argv.indexOf('--bind') + 1] ?? '127.0.0.1';
  const port = parseInt(argv[argv.indexOf('--port') + 1] ?? '3001', 10);
  const authToken = argv[argv.indexOf('--auth-token') + 1] ?? process.env.HUU_MCP_AUTH_TOKEN;

  await serveMcp({ transport, bind, port, authToken });
  return 0;
}
```

### Wire into `src/cli.tsx`

```typescript
if (firstArg === 'mcp') {
  const { runMcpCommand } = await import('./cli/commands/mcp.js');
  process.exit(await runMcpCommand(process.argv.slice(3)));
}
if (firstArg === 'approve') {
  const { runApproveCommand } = await import('./cli/commands/approve.js');
  process.exit(await runApproveCommand(process.argv.slice(3)));
}
```

### `init-docker --with-mcp` fragment

When user passes `--with-mcp`, write `.huu/claude-desktop-snippet.json`
with content the user pastes into Claude Desktop config:

```json
{
  "mcpServers": {
    "huu": {
      "command": "huu",
      "args": ["mcp", "serve", "--stdio"]
    }
  }
}
```

## Libraries

- `@modelcontextprotocol/sdk` — pinar versão atual no momento (provavelmente
  ^1.0.0 ou superior; verificar npm).

## Tests

### Unit (`src/mcp/server.test.ts`)

```typescript
import { describe, it, expect } from 'vitest';
import { runPipelineTool } from './tools/run-pipeline.js';

describe('huu_run_pipeline tool', () => {
  it('rejects malformed pipeline', async () => {
    await expect(runPipelineTool({ pipeline: { name: '' } })).rejects.toThrow();
  });

  it('returns awaiting_approval by default', async () => {
    const result = await runPipelineTool({
      pipeline: { name: 'x', steps: [{ name: 's', prompt: 'p', files: [] }] },
    });
    expect(result.status).toBe('awaiting_approval');
    expect(result.approvalUrl).toMatch(/^huu:\/\/approve\//);
  });

  it('returns estimate in dryRun mode', async () => {
    const result = await runPipelineTool({
      pipeline: { name: 'x', steps: [{ name: 's', prompt: 'p', files: [] }] },
      dryRun: true,
    });
    expect(result.status).toBe('estimated');
    expect(result.estimate).toBeDefined();
  });
});
```

### Manual integration

Configure Claude Desktop with the snippet above. Restart Claude Desktop.
Verify `huu_*` tools appear in the tool palette. Submit a pipeline; see
TUI prompt for approval.

## Acceptance criteria

- [ ] `huu mcp serve --stdio` discoverable por Claude Desktop com config.
- [ ] Tool `huu_run_pipeline` sem `autoApprove` retorna `awaiting_approval`.
- [ ] `huu approve <runId>` consome pendente e executa.
- [ ] Auth token obrigatório em `--bind 0.0.0.0`.
- [ ] Cobertura ≥80% em `src/mcp/`.
- [ ] Listado em pelo menos 1 registry público (Glama / awesome-mcp).
- [ ] `npm run typecheck && npm test` zero regressões.

## Out of scope

- ❌ MCP cliente (continuar recusando — README:402-408).
- ❌ Cloudflare remote transport.
- ❌ OAuth / SSO (auth token simples basta MVP).
- ❌ Tools que invoquem shell arbitrário.

## Risk register

| Risco | Mitigação |
|---|---|
| Misuse de auto-approve | Env var explícita + audit log marca `auto_approved: true`; verify mostra red flag. |
| Cliente MCP recursivo (huu chama huu) | `huu_run_pipeline` rejeita pipelines que referenciam o próprio server (heuristic: pipeline name matches huu prefix). |
| Servidor HTTP exposed por engano | Default `--bind 127.0.0.1`; `0.0.0.0` exige auth token. |
| Race em saveAwaitingApproval com mesmo runId | Use crypto random + timestamp para runId — colisão astronomicamente improvável. |

## Estimated effort

5–7 dias-dev sênior:
- 1 dia: server skeleton + transports.
- 1 dia: `huu_run_pipeline` tool com approval flow.
- 1 dia: outras tools (list, status, validate, cookbook stubs).
- 1 dia: subcomandos CLI (mcp, approve).
- 1 dia: tests + auth.
- 0.5 dia: `init-docker --with-mcp` + docs.
- 0.5 dia: registry submission (Glama).

## After this task is merged

Desbloqueia: **F5** (skill packs expostos via `load_skill` MCP tool),
**F16** (ACP bridge — mesmo plumbing).

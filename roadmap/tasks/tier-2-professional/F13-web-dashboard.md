# F13 · Web Dashboard read-only

> **Tier:** 2 (Professional) · **Esforço:** 6–10 dias
> **Dependências:** F4 (audit log), F1 (gate results), F0.3 (history).

## Project Paths

- **`huu`:** `/home/ondokai/Projects/huu.worktrees/ai-task-1777469117`
- **Bernstein:** `/home/ondokai/Projects/bernstein`

## Context

TUI Ink é ótimo para dev, mas stakeholder não-dev quer ver progress no
celular ou navegador. **`huu dashboard`** levanta servidor local
read-only mostrando histórico de runs, custos, gate results, audit
chain status.

## Current state in `huu`

- TUI Ink (`src/ui/`) — não acessível via web.
- `huu status --json` para scripts.
- Sem servidor HTTP.

## Bernstein reference

- `/home/ondokai/Projects/bernstein/src/bernstein/cli/dashboard_app.py`
  (Textual TUI). Bernstein dashboard é Textual, não web. Vamos diferir.

## Dependencies (DAG)

- **F4** — chain status.
- **F1** — gate results.
- **F0.3** — history aggregation.

## What to build

### New files

| Path | Purpose |
|---|---|
| `src/dashboard/server.ts` | Express/Fastify server, routes. |
| `src/dashboard/views/timeline.ts` | HTML render. |
| `src/dashboard/views/run-detail.ts` | Run detail page. |
| `src/dashboard/views/audit.ts` | Audit chain visual. |
| `src/cli/commands/dashboard.ts` | Subcomando. |
| `src/dashboard/static/styles.css` | Tailwind via CDN; no build. |

### Stack

- **Server:** Fastify (lightweight, ~50KB) ou Hono (mesmo nível).
- **Frontend:** htmx + tailwind via CDN. **Zero build step.**
- **Charts:** chart.js via CDN.

### Code sketch (`src/dashboard/server.ts`)

```typescript
import Fastify from 'fastify';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { queryHistory } from '../lib/history.js';
import { AuditLog } from '../audit/audit-log.js';

export async function startDashboard(repoRoot: string, port: number): Promise<void> {
  const app = Fastify({ logger: false });

  // All endpoints are GET — read-only enforcement
  app.addHook('onRequest', async (req, reply) => {
    if (req.method !== 'GET') {
      reply.code(405).send({ error: 'Read-only dashboard' });
    }
  });

  app.get('/', async () => renderTimeline(repoRoot));
  app.get('/runs/:runId', async (req) => {
    const { runId } = req.params as { runId: string };
    return renderRunDetail(repoRoot, runId);
  });
  app.get('/api/runs', async () => {
    const history = await queryHistory(repoRoot, {});
    const byRun = new Map<string, any>();
    for (const e of history) {
      if (!byRun.has(e.runId)) byRun.set(e.runId, { runId: e.runId, ts: e.ts, agents: 0, cost: 0 });
      const r = byRun.get(e.runId)!;
      r.agents++;
      r.cost += e.costUsd;
    }
    return [...byRun.values()];
  });
  app.get('/api/audit/:runId', async (req) => {
    const { runId } = req.params as { runId: string };
    try {
      return await AuditLog.verify(repoRoot, runId);
    } catch (err) {
      return { valid: false, error: String(err) };
    }
  });

  // Bind 127.0.0.1 only — never expose externally
  await app.listen({ host: '127.0.0.1', port });
  console.log(`Dashboard at http://127.0.0.1:${port}`);
}
```

### Code sketch (`src/dashboard/views/timeline.ts`)

```typescript
import { queryHistory } from '../../lib/history.js';

export async function renderTimeline(repoRoot: string): Promise<string> {
  const history = await queryHistory(repoRoot, {});
  const runs = aggregateByRun(history);

  return /* html */ `
<!DOCTYPE html>
<html>
<head>
  <title>huu dashboard</title>
  <script src="https://unpkg.com/htmx.org@1.9.10"></script>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-gray-900 text-gray-100 p-4 font-mono">
  <h1 class="text-xl mb-4">huu — recent runs</h1>
  <table class="w-full">
    <thead>
      <tr class="border-b border-gray-700">
        <th class="text-left p-2">Run ID</th>
        <th class="text-left p-2">Time</th>
        <th class="text-right p-2">Agents</th>
        <th class="text-right p-2">Cost</th>
        <th class="text-left p-2">Status</th>
      </tr>
    </thead>
    <tbody>
      ${runs.map((r) => `
        <tr class="border-b border-gray-800 hover:bg-gray-800">
          <td class="p-2"><a href="/runs/${r.runId}" class="text-blue-400">${r.runId}</a></td>
          <td class="p-2">${new Date(r.ts).toLocaleString()}</td>
          <td class="p-2 text-right">${r.agents}</td>
          <td class="p-2 text-right">$${r.cost.toFixed(2)}</td>
          <td class="p-2">${r.success ? '✓' : '✗'}</td>
        </tr>
      `).join('')}
    </tbody>
  </table>
</body>
</html>`;
}

function aggregateByRun(entries: any[]): any[] {
  const m = new Map();
  for (const e of entries) {
    if (!m.has(e.runId)) m.set(e.runId, { runId: e.runId, ts: e.ts, agents: 0, cost: 0, success: true });
    const r = m.get(e.runId);
    r.agents++;
    r.cost += e.costUsd;
    r.success = r.success && e.success;
  }
  return [...m.values()].sort((a, b) => b.ts.localeCompare(a.ts)).slice(0, 30);
}
```

### Subcomando

```typescript
// src/cli/commands/dashboard.ts
import { startDashboard } from '../../dashboard/server.js';
import { resolveRepoRoot } from '../../git/git-client.js';

export async function runDashboardCommand(argv: string[]): Promise<number> {
  const port = parseInt(argv[argv.indexOf('--port') + 1] ?? '3737', 10);
  const repoRoot = resolveRepoRoot(process.cwd());
  await startDashboard(repoRoot, port);
  return 0; // never reached — server runs forever
}
```

## Libraries

- `fastify@^5.x` — server.

## Tests

Smoke tests via supertest ou similar:

```typescript
import { describe, it, expect } from 'vitest';
// Use Fastify's inject() for in-process testing without sockets.
import Fastify from 'fastify';

describe('dashboard server', () => {
  it('GET / returns 200 HTML', async () => {
    // Setup: minimal mock repo with .huu/history.jsonl
    // ...
  });

  it('rejects POST', async () => {
    // ...
  });
});
```

## Acceptance criteria

- [ ] `huu dashboard --port 3737` levanta servidor.
- [ ] Bind 127.0.0.1 only (não externo).
- [ ] Render 100 runs históricos em <300ms.
- [ ] Mobile-friendly (responsive Tailwind).
- [ ] Read-only: POST/PUT retornam 405.
- [ ] Sem auth no MVP (local-only).

## Out of scope

- ❌ Auth / multi-user.
- ❌ Live update via WebSocket (polling htmx é OK).
- ❌ Edit pipeline da web (fica na TUI — humano gate).
- ❌ Approve runs da web — só TUI/CLI.

## Risk register

| Risco | Mitigação |
|---|---|
| Scope creep para write features | PRs que adicionam write rejeitadas. |
| Servidor exposto por engano | Bind 127.0.0.1 no listen, hard-coded. |

## Estimated effort

6–10 dias.

## After this task is merged

Stakeholders não-dev acompanham progress.

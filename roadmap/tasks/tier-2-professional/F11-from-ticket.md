# F11 · `huu from-ticket`

> **Tier:** 2 (Professional) · **Esforço:** 4–6 dias (MVP GitHub)
> **Dependências:** F0.1 (schema). Beneficia-se de `interactive: true` (já existe).

## Project Paths

- **`huu`:** `/home/ondokai/Projects/huu.worktrees/ai-task-1777469117`
- **Bernstein:** `/home/ondokai/Projects/bernstein`

## Context

Equipes têm processo: tickets em GitHub Issues / Linear / Jira. **`huu
from-ticket <url>`** lê o ticket, extrai contexto, gera draft de
pipeline `huu-pipeline-v1.json` via AI-assisted draft (já existente),
exige aprovação humana antes de salvar.

## Current state in `huu`

- `step.interactive: true` (`src/lib/types.ts:36`) já chama refinement
  chat multi-turno.
- Sem fetch de tickets externos.

## Bernstein reference

- `/home/ondokai/Projects/bernstein/src/bernstein/github_app/mapper.py`
  — GitHub Issue → Bernstein task mapping.
- Linear/Jira: Bernstein não confirmou in-tree; pode ser plugin.

## Dependencies (DAG)

- **F0.1** — output passa schema.

## What to build

### New files

| Path | Purpose |
|---|---|
| `src/cli/commands/from-ticket.ts` | Subcomando. |
| `src/lib/ticket-fetcher/github.ts` | Fetch GitHub Issue via API. |
| `src/lib/ticket-fetcher/types.ts` | `Ticket` interface comum. |
| `src/lib/draft-from-ticket.ts` | Chama LLM com contexto + retorna pipeline draft. |

### MVP scope

- ✅ GitHub Issues (`https://github.com/owner/repo/issues/N`).
- ⏳ Linear, Jira: post-MVP.

### Code sketch (`src/lib/ticket-fetcher/github.ts`)

```typescript
export interface Ticket {
  source: 'github' | 'linear' | 'jira';
  url: string;
  title: string;
  body: string;
  labels: string[];
  assignees: string[];
  /** Files referenced in body (best-effort regex). */
  hintedFiles: string[];
}

const ISSUE_RE = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)$/;

export async function fetchGitHubIssue(url: string): Promise<Ticket> {
  const m = url.match(ISSUE_RE);
  if (!m) throw new Error(`Not a GitHub issue URL: ${url}`);
  const [, owner, repo, num] = m;
  const token = process.env.GITHUB_TOKEN;
  const headers: Record<string, string> = { 'Accept': 'application/vnd.github+json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${num}`, { headers });
  if (!res.ok) {
    if (res.status === 404 && !token) {
      throw new Error('Issue not found (or private). Set GITHUB_TOKEN to access private repos.');
    }
    throw new Error(`GitHub API ${res.status}`);
  }
  const issue = await res.json() as any;
  return {
    source: 'github',
    url,
    title: issue.title,
    body: issue.body ?? '',
    labels: (issue.labels ?? []).map((l: any) => typeof l === 'string' ? l : l.name),
    assignees: (issue.assignees ?? []).map((a: any) => a.login),
    hintedFiles: extractFilePaths(issue.body ?? ''),
  };
}

function extractFilePaths(text: string): string[] {
  // Heuristic: words that look like paths. Capture: `src/foo.ts`, `**/foo.py`.
  const matches = text.match(/[`'"]?([\w./-]+\.\w{1,5})[`'"]?/g) ?? [];
  return [...new Set(matches.map((s) => s.replace(/[`'"]/g, '')))]
    .filter((s) => /\.\w{2,5}$/.test(s) && s.length < 200);
}
```

### Code sketch (`src/lib/draft-from-ticket.ts`)

```typescript
import { runRefinementChat } from './refinement-prompts.js'; // existing
import type { Ticket } from './ticket-fetcher/types.js';
import { pipelineSchema, type Pipeline } from '../schema/pipeline-v1.js';

export async function draftFromTicket(ticket: Ticket, modelId: string): Promise<Pipeline> {
  const systemPrompt = `You are creating a huu-pipeline-v1.json from a project ticket.
Output ONLY valid JSON matching the huu-pipeline schema.

Ticket title: ${ticket.title}
Ticket body: ${ticket.body}
Labels: ${ticket.labels.join(', ') || 'none'}
Hinted files: ${ticket.hintedFiles.join(', ') || 'none'}

Constraints:
- Each step should have name, prompt, and either files (per-file work) or [] (whole-project).
- Prefer per-file decomposition when possible (better parallelism).
- Reference $file in the prompt when files is non-empty.

Return JSON only, no prose.`;

  const response = await runRefinementChat(modelId, systemPrompt, '');
  const json = extractJson(response);
  return pipelineSchema.parse(json);
}

function extractJson(s: string): unknown {
  // Strip markdown fences if present
  const m = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  return JSON.parse(m ? m[1] : s);
}
```

### Code sketch (`src/cli/commands/from-ticket.ts`)

```typescript
import { fetchGitHubIssue } from '../../lib/ticket-fetcher/github.js';
import { draftFromTicket } from '../../lib/draft-from-ticket.js';
import { savePipelineToFile } from '../../lib/pipeline-io.js';

export async function runFromTicketCommand(argv: string[]): Promise<number> {
  const url = argv[0];
  const out = argv[argv.indexOf('--out') + 1] ?? 'pipelines/from-ticket.huu-pipeline.json';
  if (!url) { console.error('Usage: huu from-ticket <url> [--out file.json]'); return 2; }

  let ticket;
  if (url.includes('github.com')) ticket = await fetchGitHubIssue(url);
  else { console.error(`Provider not supported (yet): ${url}`); return 2; }

  console.log(`Drafting pipeline from "${ticket.title}"...`);
  const pipeline = await draftFromTicket(ticket, process.env.HUU_DRAFT_MODEL ?? 'moonshotai/kimi-k2.6');

  await savePipelineToFile(out, pipeline);
  console.log(`✓ Wrote ${out}`);
  console.log('Edit if needed, then: huu run --dry-run ' + out);
  return 0;
}
```

## Libraries

Nada novo (built-in `fetch`).

## Tests

```typescript
import { describe, it, expect, vi } from 'vitest';
import { fetchGitHubIssue } from './github.js';

describe('fetchGitHubIssue', () => {
  it('parses well-formed URL', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ title: 'X', body: 'Touch `src/foo.ts`', labels: [], assignees: [] }),
    }));
    const t = await fetchGitHubIssue('https://github.com/a/b/issues/1');
    expect(t.title).toBe('X');
    expect(t.hintedFiles).toContain('src/foo.ts');
  });

  it('rejects malformed URL', async () => {
    await expect(fetchGitHubIssue('https://example.com/foo')).rejects.toThrow();
  });
});
```

## Acceptance criteria

- [ ] `huu from-ticket https://github.com/foo/bar/issues/42` produz JSON válido.
- [ ] Sem `GITHUB_TOKEN` em repo público funciona; em private retorna mensagem útil.
- [ ] Output passa `pipelineSchema.parse()`.
- [ ] Files referenciados no body são extraídos para `step.files`.

## Out of scope

- ❌ Linear, Jira (post-MVP).
- ❌ Bidirecional (atualizar issue com link do PR — F9 já cria PR).
- ❌ Bulk import (uma issue por vez).

## Risk register

| Risco | Mitigação |
|---|---|
| LLM gera JSON inválido | `pipelineSchema.parse()` rejeita; usuário re-roda. |
| Issue private sem token | Mensagem com link `gh auth login`. |
| Rate limit GitHub | 60 req/h sem token suficiente para uso normal. |

## Estimated effort

4–6 dias (MVP GitHub).

## After this task is merged

Plugin ecosystem para Linear/Jira pode ser construído pelo community.

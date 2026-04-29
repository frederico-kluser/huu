# F23 · `huu/cookbook` Registry

> **Tier:** 3 (Platform) · **Esforço:** 10–15 dias
> **Dependências:** F0.1 (schema), F8 (JSON Schema), F5 (skills), F11 (importer).

## Project Paths

- **`huu`:** `/home/ondokai/Projects/huu.worktrees/ai-task-1777469117`
- **Bernstein:** `/home/ondokai/Projects/bernstein`

## Context

`README.md:568` lista cookbook como roadmap. Ideia: **repo separado**
(`frederico-kluser/huu-cookbook`) com pipelines reusáveis, instaláveis
via CLI:

```bash
huu cookbook search refactor
huu cookbook install owasp-audit-by-file
huu cookbook publish ./my-pipeline.json   # abre PR no cookbook
```

## Current state in `huu`

- Pipelines bundled em `pipelines/` (pt-BR).
- Sem registry remoto, sem search/install/publish.

## Bernstein reference

- Bernstein tem entry-point group `bernstein.skill_sources` para
  3rd-party packs. Vamos fazer simpler: cookbook é Git repo + CLI client.

## Dependencies (DAG)

- **F0.1** — validate antes de install.
- **F8** — JSON Schema para edição em IDE.
- **F5** — cookbook entries podem incluir skills.
- **F11** *(soft)* — importer pode listar cookbook matches por keyword.

## What to build

### Repo separado: `huu-cookbook`

Estrutura:
```
huu-cookbook/
├── README.md
├── index.json                       # manifesto versionado
└── pipelines/
    ├── refactoring/
    │   ├── mocha-to-vitest.huu-pipeline.json
    │   ├── mocha-to-vitest.README.md
    │   └── mocha-to-vitest.LICENSE       # MIT default
    ├── auditing/
    │   ├── owasp-by-file.huu-pipeline.json
    │   ├── owasp-by-file.README.md
    │   └── owasp-by-file.LICENSE
    └── docs/
        └── ...
```

### `index.json` schema

```json
{
  "schemaVersion": 1,
  "pipelines": [
    {
      "id": "mocha-to-vitest",
      "category": "refactoring",
      "title": "Migrate Mocha tests to Vitest",
      "description": "Per-file conversion preserving test semantics.",
      "tags": ["test", "mocha", "vitest", "migration"],
      "license": "MIT",
      "author": "@frederico-kluser",
      "version": "1.0.0",
      "path": "pipelines/refactoring/mocha-to-vitest.huu-pipeline.json"
    }
  ]
}
```

### CLI client (in `huu` repo): new files

| Path | Purpose |
|---|---|
| `src/cli/commands/cookbook.ts` | `huu cookbook search/install/publish/list`. |
| `src/cookbook/registry-client.ts` | Fetch + cache registry index. |
| `src/cookbook/install.ts` | Install pipeline a `<repo>/pipelines/` ou prompt user path. |

### Code sketch (`src/cookbook/registry-client.ts`)

```typescript
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

const REGISTRY_INDEX_URL = 'https://raw.githubusercontent.com/frederico-kluser/huu-cookbook/main/index.json';
const RAW_BASE = 'https://raw.githubusercontent.com/frederico-kluser/huu-cookbook/main/';
const CACHE_FILE = path.join(os.homedir(), '.huu', 'cookbook-index.json');
const TTL_MS = 60 * 60 * 1000; // 1h

interface CookbookEntry {
  id: string;
  category: string;
  title: string;
  description: string;
  tags: string[];
  license: string;
  author: string;
  version: string;
  path: string;
}

interface CookbookIndex {
  schemaVersion: number;
  pipelines: CookbookEntry[];
  fetchedAt: number;
}

export async function fetchIndex(forceRefresh = false): Promise<CookbookIndex> {
  if (!forceRefresh) {
    try {
      const raw = await fs.readFile(CACHE_FILE, 'utf-8');
      const cached = JSON.parse(raw) as CookbookIndex;
      if (Date.now() - cached.fetchedAt < TTL_MS) return cached;
    } catch { /* miss */ }
  }
  const res = await fetch(REGISTRY_INDEX_URL);
  if (!res.ok) throw new Error(`Cookbook fetch ${res.status}`);
  const data = (await res.json()) as Omit<CookbookIndex, 'fetchedAt'>;
  const index: CookbookIndex = { ...data, fetchedAt: Date.now() };
  await fs.mkdir(path.dirname(CACHE_FILE), { recursive: true });
  await fs.writeFile(CACHE_FILE, JSON.stringify(index, null, 2));
  return index;
}

export function searchIndex(index: CookbookIndex, query: string): CookbookEntry[] {
  const q = query.toLowerCase();
  return index.pipelines.filter((p) =>
    p.id.toLowerCase().includes(q) ||
    p.title.toLowerCase().includes(q) ||
    p.tags.some((t) => t.toLowerCase().includes(q)),
  );
}

export async function fetchPipeline(entry: CookbookEntry): Promise<unknown> {
  const url = RAW_BASE + entry.path;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Pipeline fetch ${res.status}: ${url}`);
  return await res.json();
}
```

### CLI commands

```typescript
// src/cli/commands/cookbook.ts
import { fetchIndex, searchIndex, fetchPipeline } from '../../cookbook/registry-client.js';
import { pipelineFileSchema, parsePipelineFile } from '../../schema/pipeline-v1.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { execa } from 'execa';

export async function runCookbookCommand(argv: string[]): Promise<number> {
  const sub = argv[0];
  switch (sub) {
    case 'search': {
      const query = argv[1] ?? '';
      const index = await fetchIndex();
      const results = searchIndex(index, query);
      for (const r of results) {
        console.log(`${r.id.padEnd(30)} ${r.category.padEnd(15)} ${r.title}`);
      }
      return 0;
    }
    case 'list': {
      const index = await fetchIndex();
      console.log(JSON.stringify(index.pipelines, null, 2));
      return 0;
    }
    case 'install': {
      const id = argv[1];
      if (!id) { console.error('huu cookbook install <id>'); return 2; }
      const index = await fetchIndex();
      const entry = index.pipelines.find((p) => p.id === id);
      if (!entry) { console.error(`Not found: ${id}`); return 1; }
      const json = await fetchPipeline(entry);
      const validated = parsePipelineFile(json); // validate via F0.1
      const out = path.join('pipelines', `${entry.id}.huu-pipeline.json`);
      await fs.mkdir('pipelines', { recursive: true });
      await fs.writeFile(out, JSON.stringify(validated, null, 2) + '\n');
      console.log(`✓ Installed ${entry.id} (v${entry.version}) to ${out}`);
      return 0;
    }
    case 'publish': {
      const file = argv[1];
      if (!file) { console.error('huu cookbook publish <pipeline.json>'); return 2; }
      // Fork cookbook repo, add entry, open PR via gh CLI.
      // (Detailed flow: read pipeline, infer category from filename or ask, create
      // commit on a fork, gh pr create.)
      console.error('Publish flow: see docs/COOKBOOK-CONTRIB.md');
      return 1;
    }
    default:
      console.error('Usage: huu cookbook { search | list | install <id> | publish <file> }');
      return 2;
  }
}
```

### Wire into `src/cli.tsx`

```typescript
if (firstArg === 'cookbook') {
  const { runCookbookCommand } = await import('./cli/commands/cookbook.js');
  process.exit(await runCookbookCommand(process.argv.slice(3)));
}
```

## Libraries

Nenhuma nova.

## Tests

Mock fetch para fixtures de index/pipelines. Garantir que install
valida via schema.

## Acceptance criteria

- [ ] `huu cookbook search refactor` retorna ≥1 entry.
- [ ] `huu cookbook install <id>` baixa e valida via schema.
- [ ] Pipelines invalidos no cookbook são rejeitados (não corromper repo do user).
- [ ] Cache em `~/.huu/cookbook-index.json` com TTL 1h.
- [ ] Repo `huu-cookbook` criado com ≥3 entries iniciais.

## Out of scope (MVP)

- ❌ Cosign signing (post-MVP segurança).
- ❌ Versioning múltiplas versões da mesma pipeline.
- ❌ Comments/ratings.
- ❌ Centralized HTTP API (raw.githubusercontent.com basta).

## Risk register

| Risco | Mitigação |
|---|---|
| Pipeline malicioso | Validate via schema (no shell exec arbitrário). Documentar review. |
| Repo cookbook deleta entries | Imutável via Git history; install valida; comprometido = re-fork. |

## Estimated effort

10–15 dias (CLI + repo separado + initial entries + docs).

## After this task is merged

Community building. Tipping point para `huu` como plataforma.

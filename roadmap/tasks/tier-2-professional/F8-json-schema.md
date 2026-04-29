# F8 · JSON Schema + LSP

> **Tier:** 2 (Professional) · **Esforço:** 5–8 dias · **Bloqueia:** F23
> **Dependências:** F0.1 (zod schema)

## Project Paths

- **`huu` (target):** `/home/ondokai/Projects/huu.worktrees/ai-task-1777469117`
- **Bernstein (reference):** `/home/ondokai/Projects/bernstein`

## Context

Schema do `huu-pipeline-v1` está documentado em prosa (README) e em
TypeScript (após F0.1, em zod). Editores externos não têm autocomplete
ou validação. Usuário escrevendo pipeline a mão erra silenciosamente.

**Solução:** publicar JSON Schema (draft 2020-12) derivado do zod;
registrar em SchemaStore.org para autocomplete grátis em VS Code/Cursor.
LSP custom é nice-to-have mas SchemaStore + `$schema` URL cobre 90%.

## Current state in `huu`

- Após F0.1: zod schema em `src/schema/pipeline-v1.ts`.
- Sem export para JSON Schema. Sem URL pública.

## Bernstein reference

- `/home/ondokai/Projects/bernstein/src/bernstein/core/planning/plan_schema.py`
  — Bernstein é JSON Schema puro; mas não publica em SchemaStore (oportunidade nossa).

## Dependencies (DAG)

- **F0.1** — fonte do schema.

## What to build

### New files

| Path | Purpose |
|---|---|
| `scripts/build-schema.ts` | Script que lê zod, exporta `schema/v1.json`. Roda em build. |
| `schema/v1.json` | Output committed. URL pública: `https://raw.githubusercontent.com/frederico-kluser/huu/main/schema/v1.json`. |
| `docs/PIPELINE-SCHEMA.md` | Documentação humana do schema (gerada parcialmente). |

### Existing files to modify

| Path | Change |
|---|---|
| `package.json` | Adicionar `"zod-to-json-schema": "^3.x.y"` em devDependencies. Adicionar npm script `"build:schema": "tsx scripts/build-schema.ts"`. Hook em `prebuild`. |
| `src/lib/pipeline-io.ts` | `savePipelineToFile()` adiciona campo `"$schema": "https://raw.githubusercontent.com/frederico-kluser/huu/main/schema/v1.json"` quando salva. |
| `README.md` | Linkar nova doc + SchemaStore guidance. |

### Code sketch (`scripts/build-schema.ts`)

```typescript
import { zodToJsonSchema } from 'zod-to-json-schema';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pipelineFileSchema } from '../src/schema/pipeline-v1.js';

const schema = zodToJsonSchema(pipelineFileSchema, {
  name: 'HuuPipelineV1',
  $refStrategy: 'root',
  errorMessages: true,
});

const out = path.resolve(__dirname, '..', 'schema', 'v1.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(schema, null, 2) + '\n');
console.log(`Schema written to ${out} (${fs.statSync(out).size} bytes)`);
```

### SchemaStore submission

Após o schema viver em URL estável, abrir PR em
[`SchemaStore/schemastore`](https://github.com/SchemaStore/schemastore)
com entry em `src/api/json/catalog.json`:

```json
{
  "name": "huu pipeline",
  "description": "huu-pipeline-v1 — orchestrated LLM pipeline definition",
  "fileMatch": ["*.huu-pipeline.json", "*.huu-pipeline-v1.json"],
  "url": "https://raw.githubusercontent.com/frederico-kluser/huu/main/schema/v1.json"
}
```

### Optional: minimal LSP

Se precisar (post-MVP): usar
[`vscode-langservers-extracted`](https://github.com/hrsh7th/vscode-langservers-extracted)
JSON server com schema custom. Não é prioridade — SchemaStore basta.

## Libraries

- `zod-to-json-schema@^3.x` (devDep, build only).

## Tests

```typescript
import { describe, it, expect } from 'vitest';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { pipelineFileSchema } from './pipeline-v1.js';

describe('zod → JSON Schema export', () => {
  it('produces valid draft 2020-12 schema', () => {
    const schema = zodToJsonSchema(pipelineFileSchema);
    expect(schema).toHaveProperty('properties');
    expect(JSON.stringify(schema)).toContain('huu-pipeline-v1');
  });

  it('all required fields present', () => {
    const schema = zodToJsonSchema(pipelineFileSchema) as any;
    expect(schema.required).toContain('_format');
    expect(schema.required).toContain('pipeline');
  });
});
```

## Acceptance criteria

- [ ] `npm run build:schema` produz `schema/v1.json` válido.
- [ ] VS Code com `"$schema": "..."` no JSON: autocomplete + hover + diagnostics.
- [ ] PR em SchemaStore submetido (mergear pode demorar; aceitar).
- [ ] Schema publicado em raw.githubusercontent URL estável.
- [ ] `huu` exportado salva com `$schema` no JSON.
- [ ] Documento `docs/PIPELINE-SCHEMA.md` cobre todos os campos com exemplos.

## Out of scope

- ❌ LSP server custom no MVP.
- ❌ VS Code extension.
- ❌ Schema versioning v2 (não há v2).

## Risk register

| Risco | Mitigação |
|---|---|
| `zod-to-json-schema` perde features de zod | Cobrir com snapshot test; fixar versão. |
| SchemaStore PR demora | Aceitável; URL raw funciona imediatamente via `$schema`. |
| Schema diff entre TS e JSON | CI step que verifica `git diff schema/v1.json` em PRs (committed). |

## Estimated effort

5–8 dias:
- 1 dia: build script + schema export.
- 1 dia: docs + README updates.
- 1 dia: SchemaStore PR.
- 1 dia: testes + CI integration.
- (Opcional) 3 dias: LSP server custom.

## After this task is merged

Desbloqueia: **F23** (cookbook entries validados via schema). UX melhora
imediato em editores.

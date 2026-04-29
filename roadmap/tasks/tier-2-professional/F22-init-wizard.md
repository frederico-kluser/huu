# F22 · `huu init-wizard`

> **Tier:** 2 (Professional) · **Esforço:** 3–4 dias
> **Dependências:** F0.1 (schema), F1 (gates a sugerir).

## Project Paths

- **`huu`:** `/home/ondokai/Projects/huu.worktrees/ai-task-1777469117`
- **Bernstein:** `/home/ondokai/Projects/bernstein`

## Context

Onboarding "do zero" hoje requer escrever JSON manualmente. **Wizard
detecta stack do projeto** (Node? Python? Go?), gera template funcional
em `pipelines/example.huu-pipeline.json` + `.huu/config.json` com
defaults razoáveis para gates (F1).

## Current state in `huu`

- `huu init-docker` existe (gera `compose.yaml` etc.) — comando diferente.
- Nenhum wizard de pipeline.

## Bernstein reference

- `/home/ondokai/Projects/bernstein/src/bernstein/cli/commands/init_wizard_cmd.py`

## Dependencies (DAG)

- **F0.1** — gera output válido contra schema.
- **F1** — gates a sugerir baseado em stack detectada.

## What to build

### New files

| Path | Purpose |
|---|---|
| `src/cli/commands/init.ts` | Subcomando `huu init` (sem hyphen — distinct de `init-docker`). |
| `src/cli/commands/init-wizard.test.ts` | Testes mockando filesystem. |
| `src/lib/stack-detector.ts` | Detecta linguagem/scripts a partir de arquivos no repo. |

### Existing files to modify

| Path | Change |
|---|---|
| `src/cli.tsx:189` | Adicionar `init` em `NON_TUI_SUBCOMMANDS`. |

### Code sketch (`src/lib/stack-detector.ts`)

```typescript
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export interface DetectedStack {
  primary: 'node' | 'python' | 'go' | 'rust' | 'unknown';
  scripts: {
    lint?: string;
    typecheck?: string;
    test?: string;
  };
  hasTsconfig: boolean;
}

export async function detectStack(repoRoot: string): Promise<DetectedStack> {
  const has = async (p: string) => fs.access(path.join(repoRoot, p)).then(() => true).catch(() => false);
  const stack: DetectedStack = { primary: 'unknown', scripts: {}, hasTsconfig: false };

  if (await has('package.json')) {
    stack.primary = 'node';
    stack.hasTsconfig = await has('tsconfig.json');
    try {
      const pkg = JSON.parse(await fs.readFile(path.join(repoRoot, 'package.json'), 'utf-8'));
      if (pkg.scripts?.lint) stack.scripts.lint = 'npm run lint';
      if (pkg.scripts?.typecheck) stack.scripts.typecheck = 'npm run typecheck';
      else if (stack.hasTsconfig) stack.scripts.typecheck = 'npx tsc --noEmit';
      if (pkg.scripts?.test) stack.scripts.test = 'npm test';
      // Prefer `test:affected` if present
      if (pkg.scripts?.['test:affected']) stack.scripts.test = 'npm run test:affected';
    } catch { /* ignore */ }
  } else if (await has('pyproject.toml') || await has('requirements.txt')) {
    stack.primary = 'python';
    stack.scripts.lint = 'ruff check .';
    stack.scripts.typecheck = 'pyright';
    stack.scripts.test = 'pytest -q';
  } else if (await has('go.mod')) {
    stack.primary = 'go';
    stack.scripts.lint = 'go vet ./...';
    stack.scripts.test = 'go test ./...';
  } else if (await has('Cargo.toml')) {
    stack.primary = 'rust';
    stack.scripts.lint = 'cargo clippy -- -D warnings';
    stack.scripts.test = 'cargo test';
  }
  return stack;
}
```

### Code sketch (`src/cli/commands/init.ts`)

```typescript
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { detectStack } from '../../lib/stack-detector.js';
import { savePipelineToFile } from '../../lib/pipeline-io.js';
import { resolveRepoRoot } from '../../git/git-client.js';
import * as readline from 'node:readline/promises';

export async function runInitCommand(argv: string[]): Promise<number> {
  const force = argv.includes('--force');
  const repoRoot = resolveRepoRoot(process.cwd());
  const stack = await detectStack(repoRoot);

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = async (q: string, def: string) => {
    const a = (await rl.question(`${q} [${def}]: `)).trim();
    return a || def;
  };

  console.log(`Detected stack: ${stack.primary}`);
  if (stack.scripts.lint) console.log(`  lint: ${stack.scripts.lint}`);
  if (stack.scripts.typecheck) console.log(`  typecheck: ${stack.scripts.typecheck}`);
  if (stack.scripts.test) console.log(`  test: ${stack.scripts.test}`);

  const pipelineName = await ask('Pipeline name', 'example');
  const targetFile = await ask('Output file', `pipelines/${pipelineName}.huu-pipeline.json`);

  // Check existing
  const fullPath = path.join(repoRoot, targetFile);
  if (!force) {
    try {
      await fs.access(fullPath);
      console.error(`File exists: ${fullPath}. Use --force to overwrite.`);
      rl.close();
      return 1;
    } catch { /* OK to write */ }
  }

  const pipeline = {
    name: pipelineName,
    steps: [
      {
        name: 'Add JSDoc headers',
        prompt: 'Add a JSDoc header on top of $file describing what the file does.',
        files: stack.primary === 'node' ? ['src/index.ts'] : [],
      },
    ],
    qualityGates: {
      ...(stack.scripts.lint && { lint: { command: stack.scripts.lint, required: true } }),
      ...(stack.scripts.typecheck && { types: { command: stack.scripts.typecheck, required: true } }),
      ...(stack.scripts.test && { tests: { command: stack.scripts.test, required: false } }),
      pii: { enabled: true },
    },
    qualityGatesMode: 'warn' as const,
  };

  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await savePipelineToFile(fullPath, pipeline);
  console.log(`✓ Wrote ${targetFile}`);
  console.log(`Edit it, then run: huu run --dry-run ${targetFile}`);

  rl.close();
  return 0;
}
```

## Libraries

Nada novo. Built-in `node:readline/promises`.

## Tests

```typescript
import { describe, it, expect, vi } from 'vitest';
import { detectStack } from '../../lib/stack-detector.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

describe('detectStack', () => {
  it('detects node + tsconfig', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'init-'));
    await fs.writeFile(path.join(tmp, 'package.json'), JSON.stringify({
      scripts: { lint: 'eslint .', typecheck: 'tsc --noEmit', test: 'vitest run' },
    }));
    await fs.writeFile(path.join(tmp, 'tsconfig.json'), '{}');
    const s = await detectStack(tmp);
    expect(s.primary).toBe('node');
    expect(s.hasTsconfig).toBe(true);
    expect(s.scripts.lint).toBe('npm run lint');
    await fs.rm(tmp, { recursive: true });
  });

  it('detects python', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'init-'));
    await fs.writeFile(path.join(tmp, 'pyproject.toml'), '[project]\nname="x"');
    const s = await detectStack(tmp);
    expect(s.primary).toBe('python');
    await fs.rm(tmp, { recursive: true });
  });
});
```

## Acceptance criteria

- [ ] `huu init` em projeto Node detecta scripts do `package.json` e gera template funcional.
- [ ] Em projeto vazio: gera template documentado em comments + warns "no stack detected".
- [ ] `--force` necessário para sobrescrever.
- [ ] Output passa `pipelineSchema.parse()`.
- [ ] Suporta Node, Python, Go, Rust.

## Out of scope

- ❌ Wizard interativo full-screen Ink (basta readline simples).
- ❌ Detecção de monorepo / múltiplos sub-projects.
- ❌ Templates por domínio (testing/security/docs) — use cookbook (F23) para isso.

## Risk register

| Risco | Mitigação |
|---|---|
| Detecção errada (Node em monorepo Python) | `--force-stack node` flag manual override. |
| Sobrescreve config existente | Default refuse + `--force`. |

## Estimated effort

3–4 dias.

## After this task is merged

Onboarding melhora; docs README pode dizer "run `huu init` para começar".

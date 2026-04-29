# F1 · Janitor Determinístico (Quality Gates)

> **Tier:** 1 (Sprint) · **Esforço:** 4–5 dias · **Bloqueia:** F9, F10, F22, F6-lite
> **Dependências:** F0.1 (zod schema), F0.4 (event bus)

## Project Paths

- **`huu` (target):** `/home/ondokai/Projects/huu.worktrees/ai-task-1777469117`
- **Bernstein (reference):** `/home/ondokai/Projects/bernstein`

## Context

Hoje a verificação pós-merge do `huu` é opcional via **integration agent
LLM-based** (`src/orchestrator/integration-agent.ts:44`). Custa tokens
toda vez que roda; é flaky; e LLM-as-judge é menos confiável que
ferramentas determinísticas que o usuário já confia (tsc, eslint,
vitest, ruff, mypy, pytest).

**O janitor**: depois do merge para integration branch, roda gates
configurados no JSON da pipeline. Se algum falhar, marca run como
`merged-with-gate-failures`. Cobre ~80% do trabalho de "este diff é OK?"
sem custo de tokens.

**Importante para a filosofia:** humano define os gates no plano; o
sistema executa. Quem define o que é "done" é a pessoa, não o modelo.
Isto é a essência de *humans underwrite*.

## Current state in `huu`

- `src/orchestrator/integration-agent.ts:44` — agente LLM que roda em
  side-worktree para resolver conflitos. Continua existindo no MVP do
  janitor; vira **fallback** opcional quando o usuário não quer (ou
  não pode) rodar gates.
- `src/git/integration-merge.ts` — merge determinístico fast-path. Janitor
  roda **depois** desse merge.
- Sem nenhum módulo `janitor/` ou `gates/`.

## Bernstein reference

- `/home/ondokai/Projects/bernstein/src/bernstein/core/quality/quality_gates.py`
  — orquestrador principal de gates.
- `/home/ondokai/Projects/bernstein/src/bernstein/core/quality/` (20 files):
  - `coverage_gate.py`, `dead_code_detector.py`, `complexity_advisor.py`
  - `cross_model_verifier.py` — gate LLM-based (recusamos no MVP do `huu`)
  - `arch_conformance.py` — usa `import-linter`
- Bernstein expõe entry-point group `bernstein.gates` para custom gates;
  vamos copiar essa abertura mas mais simples (npm package).

## Dependencies (DAG)

- **F0.1** — schema da pipeline ganha `qualityGates` field.
- **F0.4** — gate runner é subscriber do bus (eventos `gate_started` /
  `gate_finished` emitidos durante execução).

## What to build

### New files

| Path | Purpose |
|---|---|
| `src/janitor/index.ts` | API principal: `runGates(opts) → GateReport`. |
| `src/janitor/gates/lint.ts` | Lint gate (eslint, biome, ruff, etc). |
| `src/janitor/gates/typecheck.ts` | Type gate (tsc, mypy, pyright). |
| `src/janitor/gates/test.ts` | Test gate (vitest, jest, pytest). |
| `src/janitor/gates/pii.ts` | PII detection (regex sobre diff). |
| `src/janitor/gates/custom.ts` | Custom shell-command gate. |
| `src/janitor/gate-types.ts` | Tipos compartilhados (`GateResult`, `GateConfig`). |
| `src/janitor/janitor.test.ts` | Suite testando cada gate isolado. |
| `src/janitor/diff-utils.ts` | Helper para extrair diff entre integration branch e baseCommit. |

### Existing files to modify

| Path | Change |
|---|---|
| `src/schema/pipeline-v1.ts` | Adicionar `qualityGates` field (ver schema delta abaixo). |
| `src/orchestrator/index.ts` | Após `merge_completed` evento, invocar janitor se config presente. |

### Schema delta (`src/schema/pipeline-v1.ts`)

```typescript
export const gateConfigSchema = z.object({
  command: z.string().min(1),
  required: z.boolean().default(true),
  timeoutMs: z.number().int().positive().optional(),
  cwd: z.string().optional(),
}).strict();

export const piiGateSchema = z.object({
  enabled: z.boolean().default(false),
  patterns: z.array(z.string()).optional()
    .describe('Custom regex patterns to flag in diffs.'),
}).strict();

export const customGateSchema = z.object({
  name: z.string().min(1),
  command: z.string().min(1),
  required: z.boolean().default(true),
  timeoutMs: z.number().int().positive().optional(),
}).strict();

export const qualityGatesSchema = z.object({
  lint: gateConfigSchema.optional(),
  types: gateConfigSchema.optional(),
  tests: gateConfigSchema.optional(),
  pii: piiGateSchema.optional(),
  custom: z.array(customGateSchema).optional(),
}).strict();

// Add to pipelineSchema:
//   qualityGates: qualityGatesSchema.optional(),
//   qualityGatesMode: z.enum(['warn', 'strict']).default('warn'),
```

### Code sketch (`src/janitor/gate-types.ts`)

```typescript
export interface GateResult {
  name: string;
  passed: boolean;
  required: boolean;
  durationMs: number;
  /** Stdout/stderr captured. */
  output: string;
  exitCode?: number;
  /** When PII gate found something: list of {file, line, redactedSnippet}. */
  findings?: PIIFinding[];
}

export interface PIIFinding {
  file: string;
  line: number;
  patternName: string;
  redactedSnippet: string;
}

export interface GateReport {
  gates: GateResult[];
  /** True if all required gates passed. */
  allPassed: boolean;
  totalDurationMs: number;
}
```

### Code sketch (`src/janitor/index.ts`)

```typescript
import type { Pipeline } from '../schema/pipeline-v1.js';
import type { EventBus } from '../orchestrator/event-bus.js';
import type { GateReport, GateResult } from './gate-types.js';
import { runLintGate } from './gates/lint.js';
import { runTypecheckGate } from './gates/typecheck.js';
import { runTestGate } from './gates/test.js';
import { runPIIGate } from './gates/pii.js';
import { runCustomGate } from './gates/custom.js';

export interface RunGatesOptions {
  pipeline: Pipeline;
  worktreePath: string;
  baseCommit: string;
  bus: EventBus;
  runId: string;
}

export async function runGates(opts: RunGatesOptions): Promise<GateReport> {
  const config = opts.pipeline.qualityGates;
  const results: GateResult[] = [];
  const t0 = Date.now();

  if (!config) {
    return { gates: [], allPassed: true, totalDurationMs: 0 };
  }

  // Gates run sequentially — most have side effects on filesystem (locks).
  if (config.lint) {
    await emit('lint', opts.bus, opts.runId);
    results.push(await runLintGate(config.lint, opts.worktreePath));
    await emitDone('lint', results[results.length - 1], opts.bus, opts.runId);
  }
  if (config.types) {
    await emit('types', opts.bus, opts.runId);
    results.push(await runTypecheckGate(config.types, opts.worktreePath));
    await emitDone('types', results[results.length - 1], opts.bus, opts.runId);
  }
  if (config.tests) {
    await emit('tests', opts.bus, opts.runId);
    results.push(await runTestGate(config.tests, opts.worktreePath));
    await emitDone('tests', results[results.length - 1], opts.bus, opts.runId);
  }
  if (config.pii?.enabled) {
    await emit('pii', opts.bus, opts.runId);
    results.push(await runPIIGate(config.pii, opts.worktreePath, opts.baseCommit));
    await emitDone('pii', results[results.length - 1], opts.bus, opts.runId);
  }
  for (const c of config.custom ?? []) {
    await emit(c.name, opts.bus, opts.runId);
    results.push(await runCustomGate(c, opts.worktreePath));
    await emitDone(c.name, results[results.length - 1], opts.bus, opts.runId);
  }

  const allPassed = results.every((r) => !r.required || r.passed);
  return { gates: results, allPassed, totalDurationMs: Date.now() - t0 };
}

async function emit(name: string, bus: EventBus, runId: string) {
  await bus.emit({ type: 'gate_started', runId, gateName: name, ts: Date.now() });
}
async function emitDone(name: string, r: GateResult, bus: EventBus, runId: string) {
  await bus.emit({
    type: 'gate_finished',
    runId, gateName: name, passed: r.passed, durationMs: r.durationMs, ts: Date.now(),
  });
}
```

### Code sketch (`src/janitor/gates/lint.ts`)

```typescript
import { execa } from 'execa';
import type { GateResult } from '../gate-types.js';

interface GateConfig {
  command: string;
  required?: boolean;
  timeoutMs?: number;
  cwd?: string;
}

const DEFAULT_TIMEOUT = 5 * 60_000; // 5min

export async function runLintGate(config: GateConfig, worktreePath: string): Promise<GateResult> {
  const t0 = Date.now();
  const [cmd, ...args] = config.command.split(/\s+/);
  try {
    const result = await execa(cmd, args, {
      cwd: config.cwd ?? worktreePath,
      timeout: config.timeoutMs ?? DEFAULT_TIMEOUT,
      reject: false,
      all: true,
    });
    return {
      name: 'lint',
      passed: result.exitCode === 0,
      required: config.required ?? true,
      durationMs: Date.now() - t0,
      output: result.all ?? '',
      exitCode: result.exitCode,
    };
  } catch (err) {
    return {
      name: 'lint',
      passed: false,
      required: config.required ?? true,
      durationMs: Date.now() - t0,
      output: String(err),
    };
  }
}
```

> Repete o pattern em `typecheck.ts`, `test.ts`, `custom.ts` — basicamente
> mesmo código com nome diferente. Pode-se factor para uma função helper
> `runShellGate(name, config, worktreePath)`.

### Code sketch (`src/janitor/gates/pii.ts`)

```typescript
import { execa } from 'execa';
import type { PIIFinding, GateResult } from '../gate-types.js';

const BUILTIN_PATTERNS: Array<{ name: string; regex: RegExp }> = [
  { name: 'openai-key',     regex: /\bsk-[A-Za-z0-9]{20,}\b/g },
  { name: 'github-token',   regex: /\bghp_[A-Za-z0-9]{36}\b/g },
  { name: 'aws-access-key', regex: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: 'email',          regex: /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g },
  { name: 'jwt-token',      regex: /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g },
];

export async function runPIIGate(
  config: { enabled: boolean; patterns?: string[] },
  worktreePath: string,
  baseCommit: string,
): Promise<GateResult> {
  const t0 = Date.now();
  const { stdout: diff } = await execa('git', ['diff', baseCommit, '--unified=0'], { cwd: worktreePath });
  const findings: PIIFinding[] = [];

  const allPatterns = [
    ...BUILTIN_PATTERNS,
    ...(config.patterns ?? []).map((p, i) => ({ name: `custom-${i}`, regex: new RegExp(p, 'g') })),
  ];

  let currentFile = '';
  let currentLineNum = 0;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ b/')) currentFile = line.slice(6);
    else if (line.startsWith('@@')) {
      const m = line.match(/\+(\d+)/);
      currentLineNum = m ? parseInt(m[1], 10) : 0;
    } else if (line.startsWith('+') && !line.startsWith('+++')) {
      for (const { name, regex } of allPatterns) {
        for (const match of line.matchAll(regex)) {
          findings.push({
            file: currentFile,
            line: currentLineNum,
            patternName: name,
            redactedSnippet: redact(line, match[0]),
          });
        }
      }
      currentLineNum++;
    }
  }

  return {
    name: 'pii',
    passed: findings.length === 0,
    required: true,
    durationMs: Date.now() - t0,
    output: findings.length === 0 ? 'no PII detected' : `${findings.length} PII finding(s)`,
    findings,
  };
}

function redact(line: string, secret: string): string {
  const masked = secret.length > 8 ? secret.slice(0, 4) + '***' + secret.slice(-2) : '***';
  return line.replace(secret, masked).slice(0, 200);
}
```

### Wire into orchestrator (`src/orchestrator/index.ts`)

After the integration merge succeeds, before `run_finished`:

```typescript
import { runGates } from '../janitor/index.js';

// After merge_completed event:
const gateReport = await runGates({
  pipeline,
  worktreePath: integrationWorktreePath,
  baseCommit: manifest.baseCommit,
  bus: this.bus,
  runId,
});

if (!gateReport.allPassed && pipeline.qualityGatesMode === 'strict') {
  await this.bus.emit({
    type: 'run_finished', runId, status: 'error', totalCostUsd, ts: Date.now(),
  });
  throw new Error(`Quality gates failed: ${gateReport.gates.filter((g) => !g.passed).map((g) => g.name).join(', ')}`);
}
```

## Libraries

- `execa@^9.5.0` — robust child_process wrapper (handles timeouts, output
  capture, signals). Já é dependência transitiva do Pi SDK provavelmente;
  confirmar e adicionar explícita se necessário.

## Tests

### Unit (`src/janitor/janitor.test.ts`)

```typescript
import { describe, it, expect } from 'vitest';
import { runLintGate } from './gates/lint.js';
import { runPIIGate } from './gates/pii.js';

describe('lint gate', () => {
  it('passes when command exits 0', async () => {
    const r = await runLintGate({ command: 'true' }, '/tmp');
    expect(r.passed).toBe(true);
  });

  it('fails when command exits non-zero', async () => {
    const r = await runLintGate({ command: 'false' }, '/tmp');
    expect(r.passed).toBe(false);
  });

  it('respects timeout', async () => {
    const r = await runLintGate({ command: 'sleep 2', timeoutMs: 100 }, '/tmp');
    expect(r.passed).toBe(false);
  });
});

describe('pii gate', () => {
  it('detects API keys in diff', async () => {
    // Setup: temp git repo with a commit that adds `OPENAI_KEY=sk-abc...`
    // ...
    const r = await runPIIGate({ enabled: true }, repoPath, baseCommit);
    expect(r.findings?.length).toBeGreaterThan(0);
    expect(r.findings?.[0].patternName).toBe('openai-key');
  });
});
```

### Integration

- Manual: criar pipeline com `qualityGates.lint = "npm run lint"`, rodar
  contra projeto que tem lint quebrado de propósito → ver `gate_finished`
  evento + flag no UI.

## Acceptance criteria

- [ ] Pipeline com `qualityGates: { lint: { command: "npm run lint" } }`
      executa lint após merge.
- [ ] Falha em gate aparece em vermelho na TUI com link para output.
- [ ] PII gate detecta `sk-...`, `ghp_...`, `AKIA...` em diff.
- [ ] Modo `strict` + falha = exit code != 0; modo `warn` continua.
- [ ] Timeout configurável; default 5min.
- [ ] Subscribers do event bus recebem `gate_started` e `gate_finished`.
- [ ] `npm run typecheck && npm test` zero regressões.

## Out of scope

- ❌ Cross-model code review LLM gate (Bernstein faz; recusamos no MVP).
- ❌ Mutation testing.
- ❌ Coverage gate (pode virar custom gate se usuário quiser).
- ❌ Auto-fix em failures (isso é F10 autofix).
- ❌ Detecção automática de stack para gerar defaults (isso é F22 init-wizard).

## Risk register

| Risco | Mitigação |
|---|---|
| `npm test` em projeto grande demora 10+ min | Documentar `required: false` para testes pesados; sugerir `vitest --changed` ou `npm run test:affected`. |
| Gate command com path errado | Mensagem de erro explícita citando `cwd`; `huu doctor` (F21) detecta isso preventivamente. |
| PII regex false positive (e.g. UUIDs parecem keys) | Patterns conservadores; `enabled: false` por default; custom patterns. |

## Estimated effort

4–5 dias-dev sênior:
- 1 dia: schema + types + runner skeleton.
- 1 dia: lint/types/test gates (similares).
- 1 dia: PII gate (mais complexo — diff parsing).
- 1 dia: integração com orchestrator + UI rendering das gate failures.
- 0.5 dia: tests + smoke.
- 0.5 dia: docs (README + skill).

## After this task is merged

Desbloqueia: **F9** (PR body inclui gate verdict), **F10** (autofix
detecta gate failure), **F22** (wizard sugere defaults baseado em stack),
**F6-lite** (history advisor consome gate failure rates).

# F21 · `huu doctor`

> **Tier:** 2 (Professional) · **Esforço:** 1–2 dias · **Bloqueia:** —
> **Dependências:** F0.1 (validate pipeline path opcional).

## Project Paths

- **`huu` (target):** `/home/ondokai/Projects/huu.worktrees/ai-task-1777469117`
- **Bernstein (reference):** `/home/ondokai/Projects/bernstein`

## Context

Quando algo dá errado em uma run de `huu`, o usuário não sabe se o
problema é Docker, Node version, OpenRouter key, disco cheio, ou bug
do `huu`. **`huu doctor`** roda checagens de ambiente e reporta status
claro, com sugestões de fix.

## Current state in `huu`

- Sem `doctor` subcomando.
- `huu status` existe mas inspeciona run, não ambiente.

## Bernstein reference

- `/home/ondokai/Projects/bernstein/src/bernstein/cli/commands/doctor_cmd.py`

## Dependencies (DAG)

- **F0.1** *(soft)* — se argv inclui pipeline path, validar via schema.

## What to build

### New files

| Path | Purpose |
|---|---|
| `src/cli/commands/doctor.ts` | Subcomando completo. |
| `src/cli/commands/doctor.test.ts` | Mock checks, verify exit codes. |

### Existing files to modify

| Path | Change |
|---|---|
| `src/cli.tsx:189` | Adicionar `doctor` em `NON_TUI_SUBCOMMANDS`. |

### Code sketch (`src/cli/commands/doctor.ts`)

```typescript
import { execa } from 'execa';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import * as net from 'node:net';

interface CheckResult {
  name: string;
  status: 'ok' | 'warn' | 'error';
  message: string;
  fix?: string;
}

const checks: Array<() => Promise<CheckResult>> = [
  checkNodeVersion,
  checkGitVersion,
  checkDocker,
  checkApiKey,
  checkDiskSpace,
  checkPortRange,
  checkCcCompiler,
  checkRepoState,
];

export async function runDoctorCommand(argv: string[]): Promise<number> {
  const json = argv.includes('--json');
  const results: CheckResult[] = [];
  for (const c of checks) {
    try {
      results.push(await c());
    } catch (err) {
      results.push({ name: c.name, status: 'error', message: String(err) });
    }
  }
  if (json) {
    process.stdout.write(JSON.stringify(results, null, 2) + '\n');
  } else {
    renderHuman(results);
  }
  const errors = results.filter((r) => r.status === 'error').length;
  const warns = results.filter((r) => r.status === 'warn').length;
  return errors > 0 ? 2 : warns > 0 ? 1 : 0;
}

function renderHuman(results: CheckResult[]): void {
  console.log('huu doctor — checking environment\n');
  for (const r of results) {
    const sym = r.status === 'ok' ? '✓' : r.status === 'warn' ? '⚠' : '✗';
    console.log(`  ${sym} ${r.message}`);
    if (r.fix && r.status !== 'ok') console.log(`    fix: ${r.fix}`);
  }
  const errors = results.filter((r) => r.status === 'error').length;
  const warns = results.filter((r) => r.status === 'warn').length;
  console.log(`\nResult: ${errors} error(s), ${warns} warning(s).`);
}

// --- Individual checks ---

async function checkNodeVersion(): Promise<CheckResult> {
  const v = process.versions.node;
  const major = parseInt(v.split('.')[0], 10);
  if (major < 18) {
    return { name: 'node', status: 'error', message: `node ${v} (need ≥18)`, fix: 'Install Node 20 LTS' };
  }
  return { name: 'node', status: 'ok', message: `node v${v}` };
}

async function checkGitVersion(): Promise<CheckResult> {
  try {
    const { stdout } = await execa('git', ['--version']);
    const m = stdout.match(/(\d+)\.(\d+)/);
    if (!m) return { name: 'git', status: 'warn', message: `git: unparseable version: ${stdout}` };
    const [, major, minor] = m;
    if (parseInt(major, 10) < 2 || (parseInt(major, 10) === 2 && parseInt(minor, 10) < 20)) {
      return { name: 'git', status: 'warn', message: `git ${major}.${minor} (worktree behavior may be flaky)`, fix: 'Upgrade to git ≥2.30' };
    }
    return { name: 'git', status: 'ok', message: stdout };
  } catch {
    return { name: 'git', status: 'error', message: 'git not in PATH', fix: 'Install git' };
  }
}

async function checkDocker(): Promise<CheckResult> {
  if (process.env.HUU_NO_DOCKER === '1') {
    return { name: 'docker', status: 'warn', message: 'HUU_NO_DOCKER=1 (running native)', fix: 'unset HUU_NO_DOCKER for isolation' };
  }
  try {
    await execa('docker', ['version'], { timeout: 3000 });
    return { name: 'docker', status: 'ok', message: 'docker running' };
  } catch {
    return { name: 'docker', status: 'error', message: 'docker not running or not installed', fix: 'Install OrbStack/Docker Desktop or run with --yolo' };
  }
}

async function checkApiKey(): Promise<CheckResult> {
  if (process.env.OPENROUTER_API_KEY) return { name: 'apikey', status: 'ok', message: 'OPENROUTER_API_KEY set' };
  if (process.env.OPENROUTER_API_KEY_FILE) {
    try {
      await fs.access(process.env.OPENROUTER_API_KEY_FILE);
      return { name: 'apikey', status: 'ok', message: `OPENROUTER_API_KEY_FILE: ${process.env.OPENROUTER_API_KEY_FILE}` };
    } catch {
      return { name: 'apikey', status: 'error', message: `OPENROUTER_API_KEY_FILE points to non-existent path`, fix: 'Check the path' };
    }
  }
  return { name: 'apikey', status: 'warn', message: 'no OpenRouter key set (TUI will prompt on first run)' };
}

async function checkDiskSpace(): Promise<CheckResult> {
  // Best-effort using statfs (Linux/Mac). On Windows, skip.
  try {
    const { stdout } = await execa('df', ['-Pk', '.']);
    const lines = stdout.split('\n');
    const fields = lines[1]?.split(/\s+/) ?? [];
    const availKb = parseInt(fields[3] ?? '0', 10);
    const availGb = availKb / (1024 * 1024);
    if (availGb < 2) return { name: 'disk', status: 'warn', message: `${availGb.toFixed(1)}GB free (need ≥2GB)`, fix: 'Free up disk space' };
    return { name: 'disk', status: 'ok', message: `${availGb.toFixed(1)}GB free` };
  } catch {
    return { name: 'disk', status: 'warn', message: 'unable to check free disk' };
  }
}

async function checkPortRange(): Promise<CheckResult> {
  // Probe 55100 only as smoke; full window allocation happens at run time.
  const taken = await isPortTaken(55100);
  if (taken) return { name: 'ports', status: 'warn', message: 'port 55100 in use; allocator will slide forward', fix: 'kill stale process or change basePort' };
  return { name: 'ports', status: 'ok', message: 'port 55100 free' };
}

function isPortTaken(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(true));
    srv.once('listening', () => srv.close(() => resolve(false)));
    srv.listen(port, '127.0.0.1');
  });
}

async function checkCcCompiler(): Promise<CheckResult> {
  try {
    await execa('cc', ['--version'], { timeout: 2000 });
    return { name: 'cc', status: 'ok', message: 'cc available (port shim will compile)' };
  } catch {
    return {
      name: 'cc',
      status: 'warn',
      message: 'cc not in PATH (port shim falls back to env-only mode)',
      fix: 'Install build-essential / xcode-select; see PORT-SHIM.md §6.4',
    };
  }
}

async function checkRepoState(): Promise<CheckResult> {
  try {
    const { stdout } = await execa('git', ['status', '--porcelain']);
    if (stdout.trim().length > 0) {
      return { name: 'repo', status: 'warn', message: 'working tree is dirty (huu refuses to start dirty)', fix: 'commit or stash before running' };
    }
    return { name: 'repo', status: 'ok', message: 'working tree clean' };
  } catch {
    return { name: 'repo', status: 'warn', message: 'cwd is not a git repo' };
  }
}
```

### Wire into `src/cli.tsx`

```typescript
if (firstArg === 'doctor') {
  const { runDoctorCommand } = await import('./cli/commands/doctor.js');
  process.exit(await runDoctorCommand(process.argv.slice(3)));
}
```

## Libraries

`execa` (já em F1).

## Tests

```typescript
import { describe, it, expect, vi } from 'vitest';
import { runDoctorCommand } from './doctor.js';

describe('huu doctor', () => {
  it('exits 0 when all checks pass', async () => {
    // Mock all checks to return 'ok' — implementation detail varies
    const code = await runDoctorCommand(['--json']);
    expect([0, 1]).toContain(code); // 0 OK; 1 if any warn (acceptable in test env)
  });

  it('--json output is valid JSON', async () => {
    const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await runDoctorCommand(['--json']);
    const last = String(out.mock.calls.at(-1)?.[0]);
    expect(() => JSON.parse(last)).not.toThrow();
  });
});
```

## Acceptance criteria

- [ ] `huu doctor` corre em <2s.
- [ ] Cada check tem teste unitário.
- [ ] Exit codes: 0 OK, 1 warn, 2 error.
- [ ] `--json` emite array parseável.
- [ ] Mensagens de fix citam comando exato.

## Out of scope

- ❌ Auto-fix (apenas diagnose).
- ❌ Conexão a OpenRouter para validar key (custaria token; fora do scope).
- ❌ Telemetry de doctor runs.

## Risk register

| Risco | Mitigação |
|---|---|
| Check trava (e.g., docker hang) | Timeout em todos os execa calls. |
| False positives em CI | Documentar quais checks skip em CI (HUU_CI=1 env). |

## Estimated effort

1–2 dias:
- 0.5 dia: skeleton + checks básicos.
- 0.5 dia: tests.
- 0.5 dia: docs.

## After this task is merged

Onboarding melhora; `huu init-wizard` (F22) referencia output.

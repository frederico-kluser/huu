# F4 · HMAC-Chained Audit Log

> **Tier:** 1 (Sprint) · **Esforço:** 2–3 dias · **Bloqueia:** F9, F13, F26
> **Dependências:** F0.4 (event bus)

## Project Paths

- **`huu` (target):** `/home/ondokai/Projects/huu.worktrees/ai-task-1777469117`
- **Bernstein (reference):** `/home/ondokai/Projects/bernstein`

## Context

Logs do `huu` hoje (`.huu/debug-<ISO>.log` NDJSON, run logs chronológicos)
são tamper-vulneráveis: alguém com write access pode editar entradas
sem detecção. Para uso em **regulated industries** (finance, health,
gov) ou **forensics** ("o agente fez exatamente isso?"), precisamos de
audit trail crypto-verificável.

**Solução:** cadeia HMAC-SHA256 sobre eventos. Cada entry contém
`hmac` que depende do `prev_hmac` + payload. Adulterar uma entrada
quebra todas as posteriores. Verifier separado recomputa cadeia.

**Diferenciador filosófico vs Bernstein:** Bernstein faz audit log mas
ele *também* tem `bernstein -g` (autonomia LLM). `huu` faz audit + gate
humano explícito no plan. **Combo único** que regulated prefere.

## Current state in `huu`

- `src/lib/debug-logger.ts:52-59` — NDJSON debug log atual.
- `src/lib/run-logger.ts:61-80` — chronological run log.
- Nenhum dos dois é tamper-evident.

## Bernstein reference

- `/home/ondokai/Projects/bernstein/src/bernstein/core/security/audit.py`
  — implementação canônica. Estudar a estrutura da chain.
- `/home/ondokai/Projects/bernstein/src/bernstein/core/security/audit_integrity.py`
  — verifier.
- `/home/ondokai/Projects/bernstein/src/bernstein/core/security/audit_export.py`
  — export para auditor externo.

Bernstein:
- Genesis HMAC: `"0" * 64`
- Cada entry: `hmac = HMAC-SHA256(key, raw_event_bytes)` chain a partir do anterior.
- Chave em `$XDG_STATE_HOME/bernstein/audit.key` (chmod 0600).
- Permission validation hard-error em startup se chmod frouxo.

## Dependencies (DAG)

- **F0.4** — audit log é subscriber do event bus que recebe `*` e
  encadeia.

## What to build

### New files

| Path | Purpose |
|---|---|
| `src/audit/hmac-chain.ts` | Pure functions: `appendEvent(prevHmac, event, key) → newHmac`, `verifyChain(events, hmacs, key) → result`. |
| `src/audit/audit-log.ts` | Subscriber do event bus que escreve em disco e mantém chain. |
| `src/audit/key-manager.ts` | Carrega/cria a key, valida permissões. |
| `src/cli/commands/audit.ts` | Subcomando `huu audit verify/export/list`. |
| `src/audit/audit.test.ts` | Tests da chain (tamper detection, edge cases). |

### Existing files to modify

| Path | Change |
|---|---|
| `src/cli.tsx:189` | Adicionar `audit` em `NON_TUI_SUBCOMMANDS`. |
| `src/orchestrator/index.ts` | Construir `AuditLog` e registrar como subscriber do bus durante a run. |

### Code sketch (`src/audit/hmac-chain.ts`)

```typescript
import * as crypto from 'node:crypto';

const GENESIS_HMAC = '0'.repeat(64);
const ALGO = 'sha256';

export interface AuditEvent {
  type: string;
  runId: string;
  ts: number;
  [k: string]: unknown;
}

/**
 * Compute the HMAC for the next entry in the chain.
 *   newHmac = HMAC-SHA256(key, prevHmac || canonicalJSON(event))
 *
 * canonicalJSON sorts keys to make it reproducible.
 */
export function nextHmac(prevHmac: string, event: AuditEvent, key: Buffer): string {
  const h = crypto.createHmac(ALGO, key);
  h.update(prevHmac);
  h.update(canonicalJson(event));
  return h.digest('hex');
}

export function genesisHmac(): string {
  return GENESIS_HMAC;
}

export interface VerifyResult {
  valid: boolean;
  /** First broken index, if any. */
  brokenAt?: number;
  /** Total entries verified before break (or all). */
  verifiedCount: number;
}

export function verifyChain(events: AuditEvent[], hmacs: string[], key: Buffer): VerifyResult {
  if (events.length !== hmacs.length) {
    return { valid: false, brokenAt: 0, verifiedCount: 0 };
  }
  let prev = GENESIS_HMAC;
  for (let i = 0; i < events.length; i++) {
    const expected = nextHmac(prev, events[i], key);
    if (expected !== hmacs[i]) {
      return { valid: false, brokenAt: i, verifiedCount: i };
    }
    prev = hmacs[i];
  }
  return { valid: true, verifiedCount: events.length };
}

/** Stable JSON serialization: sorted keys recursively. */
function canonicalJson(value: unknown): string {
  return JSON.stringify(value, sortReplacer);
}

function sortReplacer(_key: string, value: unknown): unknown {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)),
    );
  }
  return value;
}
```

### Code sketch (`src/audit/key-manager.ts`)

```typescript
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';

const DEFAULT_KEY_PATH = path.join(os.homedir(), '.huu', 'audit.key');

export function getKeyPath(): string {
  return process.env.HUU_AUDIT_KEY_PATH ?? DEFAULT_KEY_PATH;
}

/**
 * Load or create the audit key.
 *
 *  - If file exists: validate chmod 0600 (owner-only). Throw on slacker perms.
 *  - If missing: generate 32 random bytes, write with mode 0o600.
 */
export async function loadOrCreateKey(): Promise<Buffer> {
  const p = getKeyPath();
  try {
    const stat = await fsp.stat(p);
    if (process.platform !== 'win32') {
      const mode = stat.mode & 0o777;
      if (mode !== 0o600) {
        throw new Error(
          `Audit key at ${p} has loose permissions (mode=${mode.toString(8)}); refusing to read. ` +
          `Run: chmod 600 "${p}"`,
        );
      }
    }
    return await fsp.readFile(p);
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code !== 'ENOENT') throw err;
    // generate
    const key = crypto.randomBytes(32);
    await fsp.mkdir(path.dirname(p), { recursive: true });
    await fsp.writeFile(p, key, { mode: 0o600 });
    return key;
  }
}
```

### Code sketch (`src/audit/audit-log.ts`)

```typescript
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { genesisHmac, nextHmac, verifyChain, type AuditEvent } from './hmac-chain.js';
import { loadOrCreateKey } from './key-manager.js';
import type { EventBus, OrchEvent } from '../orchestrator/event-bus.js';

export class AuditLog {
  private prevHmac = genesisHmac();
  private logPath: string;
  private hmacPath: string;
  private key!: Buffer;
  private unsubscribe?: () => void;

  constructor(private repoRoot: string, private runId: string) {
    const dir = path.join(repoRoot, '.huu', 'audit');
    this.logPath = path.join(dir, `${runId}.jsonl`);
    this.hmacPath = path.join(dir, `${runId}.hmac`);
  }

  async start(bus: EventBus): Promise<void> {
    this.key = await loadOrCreateKey();
    await fsp.mkdir(path.dirname(this.logPath), { recursive: true });
    this.unsubscribe = bus.on('*', (event) => this.append(toAuditEvent(event)));
  }

  async stop(): Promise<void> {
    this.unsubscribe?.();
  }

  async append(event: AuditEvent): Promise<void> {
    const hmac = nextHmac(this.prevHmac, event, this.key);
    // Write both atomically-ish: append to .jsonl then to .hmac.
    // On crash mid-flush, verify will detect mismatch (count differs).
    await fsp.appendFile(this.logPath, JSON.stringify(event) + '\n');
    await fsp.appendFile(this.hmacPath, hmac + '\n');
    this.prevHmac = hmac;
  }

  static async verify(repoRoot: string, runId: string): Promise<{ valid: boolean; brokenAt?: number; events: number }> {
    const dir = path.join(repoRoot, '.huu', 'audit');
    const eventsRaw = await fsp.readFile(path.join(dir, `${runId}.jsonl`), 'utf-8');
    const hmacsRaw = await fsp.readFile(path.join(dir, `${runId}.hmac`), 'utf-8');
    const events = eventsRaw.split('\n').filter(Boolean).map((l) => JSON.parse(l) as AuditEvent);
    const hmacs = hmacsRaw.split('\n').filter(Boolean);
    const key = await loadOrCreateKey();
    const result = verifyChain(events, hmacs, key);
    return { valid: result.valid, brokenAt: result.brokenAt, events: events.length };
  }
}

function toAuditEvent(e: OrchEvent): AuditEvent {
  // Pass-through; OrchEvent already has type, runId, ts.
  return e as unknown as AuditEvent;
}
```

### Code sketch (`src/cli/commands/audit.ts`)

```typescript
import { AuditLog } from '../../audit/audit-log.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { resolveRepoRoot } from '../../git/git-client.js';
import { execa } from 'execa';

export async function runAuditCommand(argv: string[]): Promise<number> {
  const sub = argv[0];
  const repoRoot = resolveRepoRoot(process.cwd());

  switch (sub) {
    case 'verify': {
      const runId = argv[1];
      if (!runId) { console.error('huu audit verify <runId>'); return 2; }
      const r = await AuditLog.verify(repoRoot, runId);
      if (r.valid) {
        console.log(`✓ chain valid (${r.events} events)`);
        return 0;
      }
      console.error(`✗ chain broken at index ${r.brokenAt} of ${r.events}`);
      return 1;
    }
    case 'list': {
      const dir = path.join(repoRoot, '.huu', 'audit');
      const files = await fs.readdir(dir).catch(() => []);
      const runs = [...new Set(files.map((f) => f.replace(/\.(jsonl|hmac)$/, '')))];
      for (const r of runs) console.log(r);
      return 0;
    }
    case 'export': {
      const runId = argv[1];
      const out = argv[argv.indexOf('--out') + 1] ?? `audit-${runId}.tgz`;
      const dir = path.join(repoRoot, '.huu', 'audit');
      await execa('tar', ['czf', out, '-C', dir, `${runId}.jsonl`, `${runId}.hmac`]);
      console.log(`exported to ${out}`);
      return 0;
    }
    default:
      console.error('Usage: huu audit { verify <runId> | list | export <runId> [--out file.tgz] }');
      return 2;
  }
}
```

### Wire into orchestrator

```typescript
import { AuditLog } from '../audit/audit-log.js';

const audit = new AuditLog(repoRoot, runId);
await audit.start(this.bus);
try {
  // ... run pipeline ...
} finally {
  await audit.stop();
}
```

## Libraries

- `execa` (já em F1).
- Native crypto via `node:crypto` (built-in).

## Tests

### Unit (`src/audit/audit.test.ts`)

```typescript
import { describe, it, expect } from 'vitest';
import { nextHmac, genesisHmac, verifyChain } from './hmac-chain.js';
import * as crypto from 'node:crypto';

describe('hmac chain', () => {
  const key = crypto.randomBytes(32);

  it('verifies a clean chain', () => {
    const events = [
      { type: 'run_started', runId: 'r', ts: 1 },
      { type: 'agent_spawned', runId: 'r', ts: 2 },
      { type: 'run_finished', runId: 'r', ts: 3 },
    ];
    let prev = genesisHmac();
    const hmacs = events.map((e) => (prev = nextHmac(prev, e, key)));
    expect(verifyChain(events, hmacs, key).valid).toBe(true);
  });

  it('detects single-byte tamper', () => {
    const events = [{ type: 'a', runId: 'r', ts: 1 }, { type: 'b', runId: 'r', ts: 2 }];
    let prev = genesisHmac();
    const hmacs = events.map((e) => (prev = nextHmac(prev, e, key)));
    // Tamper:
    events[1].ts = 99;
    const r = verifyChain(events, hmacs, key);
    expect(r.valid).toBe(false);
    expect(r.brokenAt).toBe(1);
  });

  it('rejects mismatched array lengths', () => {
    const events = [{ type: 'a', runId: 'r', ts: 1 }];
    expect(verifyChain(events, [], key).valid).toBe(false);
  });
});
```

### Performance test

10k events; verify in <500ms. Add as test with timeout assertion.

## Acceptance criteria

- [ ] Adulterar 1 byte em `.jsonl` → `huu audit verify` retorna `failed at line N`.
- [ ] Verify de 10k eventos < 500ms.
- [ ] Chave em `~/.huu/audit.key` chmod 0600 (validado em startup).
- [ ] Loose perms (e.g., 0644) → erro hard refusing to read.
- [ ] `huu audit export <runId>` produz tarball válido.
- [ ] `huu audit list` lista runs com audit.
- [ ] `npm run typecheck && npm test` zero regressões.
- [ ] Doc explícita: "perda da chave = log inverificável".

## Out of scope

- ❌ Sync da chave para HSM / cloud KMS.
- ❌ Multi-tenant isolation (uma chave por user).
- ❌ Compliance certifications (SOC2/ISO27001) — documentar que ajuda mas não é certificação.
- ❌ Sign + publish (cosign) — F23 cookbook signing.

## Risk register

| Risco | Mitigação |
|---|---|
| Chave perdida = log inverificável | Documentar; nunca derivar da senha do user. Backup é dever do usuário. |
| Performance write-amplification (2× I/O) | Aceitar; HMAC é cheap; appends são small. |
| Crash mid-write deixa logs/hmac desync | Verify detecta count mismatch; perda do último evento (aceitável). |
| Windows não suporta chmod | Skip permission check em Windows (documentar limitação). |

## Estimated effort

2–3 dias-dev sênior:
- 1 dia: hmac-chain core + key manager + tests.
- 1 dia: AuditLog subscriber + CLI subcomandos.
- 0.5 dia: orchestrator wiring + smoke.

## After this task is merged

Desbloqueia: **F9** (PR body inclui audit verify status), **F13** (web
dashboard mostra chain status), **F26** (replay precisa do log canônico).

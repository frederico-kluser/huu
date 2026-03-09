import pc from 'picocolors';

// ── Symbols (legible in plain text + colored environments) ───────────

const SYMBOLS = {
  info: 'i',
  success: '+',
  warn: '!',
  error: 'x',
  event: '>',
  merge: 'M',
  agent: 'A',
  step: '-',
} as const;

// ── Timestamp ────────────────────────────────────────────────────────

function timestamp(): string {
  const now = new Date();
  const h = String(now.getHours()).padStart(2, '0');
  const m = String(now.getMinutes()).padStart(2, '0');
  const s = String(now.getSeconds()).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

// ── Core output functions ────────────────────────────────────────────

export function printInfo(message: string, runId?: string): void {
  const ts = pc.dim(timestamp());
  const tag = pc.cyan(`[${SYMBOLS.info}]`);
  const rid = runId ? pc.dim(` [${runId.slice(0, 8)}]`) : '';
  console.log(`${ts}${rid} ${tag} ${message}`);
}

export function printSuccess(message: string, runId?: string): void {
  const ts = pc.dim(timestamp());
  const tag = pc.green(`[${SYMBOLS.success}]`);
  const rid = runId ? pc.dim(` [${runId.slice(0, 8)}]`) : '';
  console.log(`${ts}${rid} ${tag} ${pc.green(message)}`);
}

export function printWarn(message: string, runId?: string): void {
  const ts = pc.dim(timestamp());
  const tag = pc.yellow(`[${SYMBOLS.warn}]`);
  const rid = runId ? pc.dim(` [${runId.slice(0, 8)}]`) : '';
  console.log(`${ts}${rid} ${tag} ${pc.yellow(message)}`);
}

export function printError(message: string, runId?: string): void {
  const ts = pc.dim(timestamp());
  const tag = pc.red(`[${SYMBOLS.error}]`);
  const rid = runId ? pc.dim(` [${runId.slice(0, 8)}]`) : '';
  console.error(`${ts}${rid} ${tag} ${pc.red(message)}`);
}

export function printEvent(
  eventType: string,
  message: string,
  runId?: string,
): void {
  const ts = pc.dim(timestamp());
  const tag = pc.blue(`[${eventType}]`);
  const rid = runId ? pc.dim(` [${runId.slice(0, 8)}]`) : '';
  console.log(`${ts}${rid} ${tag} ${message}`);
}

export function printStep(message: string, runId?: string): void {
  const ts = pc.dim(timestamp());
  const tag = pc.dim(`[${SYMBOLS.step}]`);
  const rid = runId ? pc.dim(` [${runId.slice(0, 8)}]`) : '';
  console.log(`${ts}${rid} ${tag} ${message}`);
}

// ── Structured sections ──────────────────────────────────────────────

export function printHeader(title: string): void {
  const line = pc.dim('-'.repeat(60));
  console.log(line);
  console.log(pc.bold(title));
  console.log(line);
}

export function printKeyValue(key: string, value: string): void {
  console.log(`  ${pc.dim(key + ':')} ${value}`);
}

export function printDivider(): void {
  console.log(pc.dim('-'.repeat(60)));
}

// ── Status rendering ─────────────────────────────────────────────────

export function colorizeStatus(status: string): string {
  switch (status) {
    case 'idle':
      return pc.dim(status);
    case 'running':
    case 'in_progress':
    case 'spawning':
    case 'context_ready':
      return pc.cyan(status);
    case 'merge_pending':
    case 'queued':
      return pc.blue(status);
    case 'merged':
    case 'completed':
      return pc.green(status);
    case 'failed':
    case 'error':
    case 'dead_letter':
      return pc.red(status);
    case 'conflict':
    case 'escalated':
      return pc.yellow(status);
    case 'aborted':
      return pc.magenta(status);
    default:
      return status;
  }
}

/**
 * Stdout logging for the WEB server process — the "what is huu doing?"
 * channel for the terminal that launched huu (`npm start` / `huu`). The
 * browser gets rich SSE frames; before this module the terminal got a
 * startup banner and then SILENCE — a run that 401'd on its API key looked
 * like "huu did nothing". Every meaningful lifecycle event now mirrors
 * here: run queued/started/finished/failed, orchestrator activity-log
 * entries, key validation/save/clear, settings changes and request errors.
 *
 * Leaf module (node built-ins only) so anything under src/web may import
 * it. ANSI colors degrade to plain text when stdout is not a TTY, and the
 * default writer stays quiet under vitest so suites don't fill with run
 * chatter; tests assert via {@link setTermLogWriter} or the pure
 * {@link formatTermLine}.
 */

export type TermLogLevel = 'info' | 'ok' | 'warn' | 'error';

const ICONS: Record<TermLogLevel, string> = {
  info: '·',
  ok: '✓',
  warn: '!',
  error: '✗',
};

const COLORS: Record<TermLogLevel, string> = {
  info: '\x1b[0m', // default foreground (timestamp is the dim part)
  ok: '\x1b[32m', // green
  warn: '\x1b[33m', // yellow
  error: '\x1b[31m', // red
};

let writer: ((line: string) => void) | null = null;

function defaultWrite(line: string): void {
  // Keep the vitest runner's output clean — suites construct real
  // WebRunManagers and would otherwise interleave run chatter with results.
  if (process.env.VITEST) return;
  process.stdout.write(line + '\n');
}

/** Swap the sink (tests). Returns the previous writer so callers can restore. */
export function setTermLogWriter(
  w: ((line: string) => void) | null,
): ((line: string) => void) | null {
  const prev = writer;
  writer = w;
  return prev;
}

/** Pure formatter — exported for tests. `when`/`color` default to live values. */
export function formatTermLine(
  level: TermLogLevel,
  scope: string,
  message: string,
  when: Date = new Date(),
  color: boolean = process.stdout.isTTY === true,
): string {
  const hh = String(when.getHours()).padStart(2, '0');
  const mm = String(when.getMinutes()).padStart(2, '0');
  const ss = String(when.getSeconds()).padStart(2, '0');
  const head = `${hh}:${mm}:${ss} huu`;
  const body = `${ICONS[level]} [${scope}] ${message}`;
  if (!color) return `${head} ${body}`;
  return `\x1b[2m${head}\x1b[0m ${COLORS[level]}${body}\x1b[0m`;
}

/** Write one line to the serve terminal. Never throws — logging must never take the server down. */
export function termLog(level: TermLogLevel, scope: string, message: string): void {
  try {
    (writer ?? defaultWrite)(formatTermLine(level, scope, message));
  } catch {
    /* a broken sink is not our problem */
  }
}

// Unified logger with verbosity controls
import pc from 'picocolors';
import type { VerbosityLevel } from './errors.js';

// ── Level ordering ───────────────────────────────────────────────────

const LEVEL_ORDER: Record<VerbosityLevel, number> = {
  quiet: 0,
  notice: 1,
  info: 2,
  debug: 3,
  trace: 4,
};

// ── Symbols ──────────────────────────────────────────────────────────

const SYMBOLS = {
  info: 'i',
  success: '+',
  warn: '!',
  error: 'x',
  debug: 'd',
  trace: 't',
  step: '-',
} as const;

// ── Logger class ─────────────────────────────────────────────────────

export class Logger {
  private level: VerbosityLevel;

  constructor(level: VerbosityLevel = 'notice') {
    this.level = level;
  }

  getLevel(): VerbosityLevel {
    return this.level;
  }

  setLevel(level: VerbosityLevel): void {
    this.level = level;
  }

  private shouldLog(msgLevel: VerbosityLevel): boolean {
    return LEVEL_ORDER[msgLevel] <= LEVEL_ORDER[this.level];
  }

  private timestamp(): string {
    const now = new Date();
    const h = String(now.getHours()).padStart(2, '0');
    const m = String(now.getMinutes()).padStart(2, '0');
    const s = String(now.getSeconds()).padStart(2, '0');
    return `${h}:${m}:${s}`;
  }

  private formatRunId(runId?: string): string {
    return runId ? pc.dim(` [${runId.slice(0, 8)}]`) : '';
  }

  // ── notice-level (default) ──────────────────────────────────────

  info(message: string, runId?: string): void {
    if (!this.shouldLog('notice')) return;
    const ts = pc.dim(this.timestamp());
    const tag = pc.cyan(`[${SYMBOLS.info}]`);
    console.log(`${ts}${this.formatRunId(runId)} ${tag} ${message}`);
  }

  success(message: string, runId?: string): void {
    if (!this.shouldLog('notice')) return;
    const ts = pc.dim(this.timestamp());
    const tag = pc.green(`[${SYMBOLS.success}]`);
    console.log(
      `${ts}${this.formatRunId(runId)} ${tag} ${pc.green(message)}`,
    );
  }

  warn(message: string, runId?: string): void {
    // Warnings show even in quiet mode
    const ts = pc.dim(this.timestamp());
    const tag = pc.yellow(`[${SYMBOLS.warn}]`);
    console.error(
      `${ts}${this.formatRunId(runId)} ${tag} ${pc.yellow(message)}`,
    );
  }

  error(message: string, runId?: string): void {
    // Errors always show
    const ts = pc.dim(this.timestamp());
    const tag = pc.red(`[${SYMBOLS.error}]`);
    console.error(
      `${ts}${this.formatRunId(runId)} ${tag} ${pc.red(message)}`,
    );
  }

  event(eventType: string, message: string, runId?: string): void {
    if (!this.shouldLog('notice')) return;
    const ts = pc.dim(this.timestamp());
    const tag = pc.blue(`[${eventType}]`);
    console.log(`${ts}${this.formatRunId(runId)} ${tag} ${message}`);
  }

  step(message: string, runId?: string): void {
    if (!this.shouldLog('notice')) return;
    const ts = pc.dim(this.timestamp());
    const tag = pc.dim(`[${SYMBOLS.step}]`);
    console.log(`${ts}${this.formatRunId(runId)} ${tag} ${message}`);
  }

  // ── info-level (-v) ─────────────────────────────────────────────

  verbose(message: string, runId?: string): void {
    if (!this.shouldLog('info')) return;
    const ts = pc.dim(this.timestamp());
    const tag = pc.dim(`[${SYMBOLS.info}]`);
    console.log(
      `${ts}${this.formatRunId(runId)} ${tag} ${pc.dim(message)}`,
    );
  }

  // ── debug-level (-vv) ──────────────────────────────────────────

  debug(message: string, runId?: string): void {
    if (!this.shouldLog('debug')) return;
    const ts = pc.dim(this.timestamp());
    const tag = pc.magenta(`[${SYMBOLS.debug}]`);
    console.error(
      `${ts}${this.formatRunId(runId)} ${tag} ${pc.dim(message)}`,
    );
  }

  // ── trace-level (-vvv) ─────────────────────────────────────────

  trace(message: string, runId?: string): void {
    if (!this.shouldLog('trace')) return;
    const ts = pc.dim(this.timestamp());
    const tag = pc.dim(`[${SYMBOLS.trace}]`);
    console.error(
      `${ts}${this.formatRunId(runId)} ${tag} ${pc.dim(message)}`,
    );
  }

  // ── Structured output (always on stdout, notice-level gated) ───

  header(title: string): void {
    if (!this.shouldLog('notice')) return;
    const line = pc.dim('-'.repeat(60));
    console.log(line);
    console.log(pc.bold(title));
    console.log(line);
  }

  keyValue(key: string, value: string): void {
    if (!this.shouldLog('notice')) return;
    console.log(`  ${pc.dim(key + ':')} ${value}`);
  }

  divider(): void {
    if (!this.shouldLog('notice')) return;
    console.log(pc.dim('-'.repeat(60)));
  }
}

// ── Singleton ────────────────────────────────────────────────────────

let _logger: Logger | null = null;

export function getLogger(): Logger {
  if (!_logger) {
    _logger = new Logger('notice');
  }
  return _logger;
}

export function setGlobalLogger(logger: Logger): void {
  _logger = logger;
}

// ── Parse verbosity from CLI flags ───────────────────────────────────

export function resolveVerbosity(opts: {
  quiet?: boolean | undefined;
  verbose?: number | undefined;
}): VerbosityLevel {
  if (opts.quiet && opts.verbose && opts.verbose > 0) {
    throw new Error(
      'Flags --quiet and --verbose cannot be used together.',
    );
  }

  if (opts.quiet) return 'quiet';

  switch (opts.verbose ?? 0) {
    case 0:
      return 'notice';
    case 1:
      return 'info';
    case 2:
      return 'debug';
    default:
      return 'trace';
  }
}

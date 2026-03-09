#!/usr/bin/env node

import { Command } from 'commander';
import { runAction } from './commands/run.js';
import { statusAction } from './commands/status.js';
import { initAction } from './commands/init.js';
import { configAction } from './commands/config-cmd.js';
import {
  formatError,
  getExitCode,
  CliError,
  errors,
  EXIT_CODES,
} from './errors.js';
import { Logger, getLogger, setGlobalLogger, resolveVerbosity } from './logger.js';
import type { VerbosityLevel } from './errors.js';

const program = new Command();

// ── Verbosity tracking ───────────────────────────────────────────────

let verboseCount = 0;

program
  .name('huu')
  .description('Multi-agent orchestrator for software development')
  .version('1.0.0')
  .option('-v, --verbose', 'increase verbosity (-v, -vv, -vvv)', () => {
    verboseCount++;
  })
  .option('-q, --quiet', 'suppress non-essential output')
  .hook('preAction', (thisCommand: { opts: () => Record<string, unknown> }) => {
    const opts = thisCommand.opts();
    const quiet = opts['quiet'] === true;

    // Check for conflicting flags
    if (quiet && verboseCount > 0) {
      console.error(
        formatError(errors.conflictingFlags('--quiet', '--verbose')),
      );
      process.exitCode = EXIT_CODES.USAGE_ERROR;
      process.exit(EXIT_CODES.USAGE_ERROR);
    }

    const level = resolveVerbosity({
      quiet,
      verbose: verboseCount,
    });
    setGlobalLogger(new Logger(level));
  });

// ── Commands ─────────────────────────────────────────────────────────

program
  .command('run')
  .description(
    'Execute one builder agent end-to-end (task -> worktree -> implement -> merge)',
  )
  .argument('<taskDescription>', 'Description of the task to implement')
  .option('--dry-run', 'Preview the beat sheet plan without executing')
  .action(async (taskDescription: string, opts: { dryRun?: boolean }) => {
    const trimmed = taskDescription.trim();
    if (trimmed.length < 5) {
      const log = getLogger();
      log.error('Task description must be at least 5 characters.');
      process.exitCode = EXIT_CODES.USAGE_ERROR;
      return;
    }

    if (opts.dryRun) {
      // Dry-run mode: show preview without execution
      const log = getLogger();
      log.info(
        'Dry-run mode — generating plan preview without execution.',
      );
      log.info(
        'Note: Full dry-run requires the Beat Sheet Engine (2.1) decomposition. Showing plan structure.',
      );
      log.divider();
      log.keyValue('Task', trimmed);
      log.keyValue('Mode', 'dry-run (no side effects)');
      log.info(
        'To execute with the full decomposition pipeline, run without --dry-run.',
      );
      return;
    }

    await runAction(trimmed);
  });

program
  .command('status')
  .description('Show current single-agent execution status')
  .action(async () => {
    await statusAction();
  });

program
  .command('init')
  .description('Initialize HUU in the current project')
  .option('--yes', 'accept defaults, no confirmation prompts')
  .option('--non-interactive', 'fail instead of prompting')
  .option('--force', 'overwrite existing config')
  .option('--dry-run', 'show plan only, no side effects')
  .action(
    async (opts: Record<string, unknown>) => {
      await initAction({
        yes: opts['yes'] === true,
        nonInteractive: opts['nonInteractive'] === true,
        force: opts['force'] === true,
        dryRun: opts['dryRun'] === true,
      });
    },
  );

program
  .command('config')
  .description('View or modify HUU configuration')
  .option('--set <key=value...>', 'set configuration values (repeatable)', (
    val: string,
    prev: string[],
  ) => {
    prev.push(val);
    return prev;
  }, [] as string[])
  .option('--json', 'output configuration as JSON')
  .option('--reset', 'reset configuration to defaults')
  .option('--non-interactive', 'disallow interactive prompts')
  .action(
    async (opts: Record<string, unknown>) => {
      await configAction({
        set: Array.isArray(opts['set']) ? opts['set'] as string[] : undefined,
        json: opts['json'] === true,
        reset: opts['reset'] === true,
        nonInteractive: opts['nonInteractive'] === true,
      });
    },
  );

// ── Unknown commands ─────────────────────────────────────────────────

program.on('command:*', () => {
  const log = getLogger();
  log.error(`Unknown command "${program.args.join(' ')}".`);
  log.info('Run `huu --help` for available commands.');
  process.exitCode = EXIT_CODES.USAGE_ERROR;
});

// ── Parse and run ────────────────────────────────────────────────────

try {
  await program.parseAsync(process.argv);
} catch (err) {
  const log = getLogger();
  const level = log.getLevel();
  console.error(formatError(err, level));
  process.exitCode = getExitCode(err);
}

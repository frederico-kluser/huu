#!/usr/bin/env node

import { Command } from 'commander';
import { runAction } from './commands/run.js';
import { statusAction } from './commands/status.js';

const program = new Command();

program
  .name('huu')
  .description('Multi-agent orchestrator for software development')
  .version('1.0.0');

program
  .command('run')
  .description('Execute one builder agent end-to-end (task -> worktree -> implement -> merge)')
  .argument('<taskDescription>', 'Description of the task to implement')
  .action(async (taskDescription: string) => {
    const trimmed = taskDescription.trim();
    if (trimmed.length < 5) {
      console.error('Error: task description must be at least 5 characters.');
      process.exitCode = 2;
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

// Handle unknown commands
program.on('command:*', () => {
  console.error(`Error: unknown command "${program.args.join(' ')}".`);
  console.error('Run `huu --help` for available commands.');
  process.exitCode = 2;
});

// Parse and run
try {
  await program.parseAsync(process.argv);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`Fatal error: ${message}`);
  process.exitCode = 1;
}

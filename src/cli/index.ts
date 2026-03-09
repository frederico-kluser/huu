#!/usr/bin/env node

// HUU — TUI-only entry point
//
// Usage:
//   huu            → Abre a TUI full-screen
//   huu --help     → Mostra ajuda
//   huu --version  → Mostra versão

import { Command } from 'commander';
import {
  formatError,
  getExitCode,
} from './errors.js';
import { Logger, setGlobalLogger, resolveVerbosity } from './logger.js';
import { huuDirExists, configExists, loadConfig, createDefaultConfig, writeConfigAtomic } from './config.js';
import type { HuuConfig } from './config.js';
import { renderSetupWizard, renderFullScreenApp } from './render.js';

const program = new Command();

// ── Verbosity tracking ───────────────────────────────────────────────

let verboseCount = 0;

program
  .name('huu')
  .description('Multi-agent orchestrator for software development — TUI full-screen')
  .version('1.0.0')
  .option('-v, --verbose', 'increase verbosity (-v, -vv, -vvv)', () => {
    verboseCount++;
  })
  .option('-q, --quiet', 'suppress non-essential output')
  .action(async () => {
    // Resolve verbosity
    const opts = program.opts();
    const quiet = opts['quiet'] === true;
    const level = resolveVerbosity({ quiet, verbose: verboseCount });
    setGlobalLogger(new Logger(level));

    const cwd = process.cwd();
    const hasApiKey = Boolean(process.env['OPENROUTER_API_KEY']);
    const hasInit = huuDirExists(cwd) && configExists(cwd);

    // Se não tem API key ou projeto, mostra setup wizard primeiro (modo legado)
    if (!hasApiKey || !hasInit) {
      const result = await renderSetupWizard({ hasApiKey, hasInit });
      if (result.apiKey) {
        process.env['OPENROUTER_API_KEY'] = result.apiKey;
      }
      // Se ainda não tem init, criar config padrão
      if (!hasInit) {
        const { initAction } = await import('./commands/init.js');
        await initAction({ yes: true });
      }

      // Apply wizard model selections to the config (init writes defaults,
      // so we overwrite with what the user actually chose)
      if (configExists(cwd)) {
        const config = loadConfig(cwd);
        config.orchestrator.agentModels = { ...result.agentModels };
        writeConfigAtomic(cwd, config);
      }
    }

    // Carregar config (pode ter sido criada pelo setup)
    let config: HuuConfig;
    try {
      config = loadConfig(cwd);
    } catch {
      config = createDefaultConfig();
    }

    // Lançar TUI full-screen
    await renderFullScreenApp({ config });
  });

// ── Parse and run ────────────────────────────────────────────────────

try {
  await program.parseAsync(process.argv);
} catch (err) {
  const log = new Logger('notice');
  console.error(formatError(err, log.getLevel()));
  process.exitCode = getExitCode(err);
}

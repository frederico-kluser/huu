// huu config — interactive and non-interactive configuration
import {
  loadConfig,
  writeConfigAtomic,
  configExists,
  validateConfig,
  createDefaultConfig,
  getConfigValue,
  setConfigValue,
  CONFIGURABLE_KEYS,
} from '../config.js';
import type { HuuConfig } from '../config.js';
import { errors, EXIT_CODES } from '../errors.js';
import { getLogger } from '../logger.js';
import pc from 'picocolors';
import * as readline from 'node:readline';

// ── Types ────────────────────────────────────────────────────────────

export interface ConfigFlags {
  set?: string[] | undefined;
  json?: boolean | undefined;
  reset?: boolean | undefined;
  nonInteractive?: boolean | undefined;
}

// ── Non-interactive set ──────────────────────────────────────────────

function parseKeyValue(
  pair: string,
): { key: string; value: string } | null {
  const eqIdx = pair.indexOf('=');
  if (eqIdx === -1) return null;
  return {
    key: pair.slice(0, eqIdx).trim(),
    value: pair.slice(eqIdx + 1).trim(),
  };
}

function applySetValues(
  config: HuuConfig,
  pairs: string[],
): { applied: string[]; errors: string[] } {
  const applied: string[] = [];
  const errs: string[] = [];
  const validKeys = CONFIGURABLE_KEYS.map((k) => k.key);

  for (const pair of pairs) {
    const parsed = parseKeyValue(pair);
    if (!parsed) {
      errs.push(`Invalid format "${pair}" — expected key=value`);
      continue;
    }

    if (!validKeys.includes(parsed.key as typeof validKeys[number])) {
      errs.push(
        `Unknown key "${parsed.key}" — valid keys: ${validKeys.join(', ')}`,
      );
      continue;
    }

    const keyDef = CONFIGURABLE_KEYS.find((k) => k.key === parsed.key)!;

    // Validate value
    if (keyDef.type === 'number') {
      const num = Number(parsed.value);
      if (isNaN(num)) {
        errs.push(`"${parsed.key}" must be a number`);
        continue;
      }
      if (keyDef.min !== undefined && num < keyDef.min) {
        errs.push(`"${parsed.key}" must be >= ${keyDef.min}`);
        continue;
      }
      if (keyDef.max !== undefined && num > keyDef.max) {
        errs.push(`"${parsed.key}" must be <= ${keyDef.max}`);
        continue;
      }
      setConfigValue(
        config,
        parsed.key as Parameters<typeof setConfigValue>[1],
        num,
      );
    } else if (keyDef.type === 'select') {
      if (keyDef.options && !keyDef.options.includes(parsed.value)) {
        errs.push(
          `"${parsed.key}" must be one of: ${keyDef.options.join(', ')}`,
        );
        continue;
      }
      setConfigValue(
        config,
        parsed.key as Parameters<typeof setConfigValue>[1],
        parsed.value,
      );
    }

    applied.push(`${parsed.key} = ${parsed.value}`);
  }

  return { applied, errors: errs };
}

// ── Simple readline prompt ───────────────────────────────────────────

function createPromptInterface(): readline.Interface {
  return readline.createInterface({
    input: process.stdin,
    output: process.stderr,
  });
}

async function promptSelect(
  rl: readline.Interface,
  label: string,
  options: string[],
  current: string,
): Promise<string | null> {
  return new Promise((resolve) => {
    console.error('');
    console.error(pc.bold(`  ${label}`));
    for (let i = 0; i < options.length; i++) {
      const marker = options[i] === current ? pc.green('*') : ' ';
      console.error(`    ${marker} ${i + 1}) ${options[i]}`);
    }
    rl.question(
      `  Choice [1-${options.length}] (enter to keep "${current}"): `,
      (answer: string) => {
        if (answer.trim() === '') {
          resolve(current);
          return;
        }
        const idx = parseInt(answer.trim(), 10) - 1;
        if (idx >= 0 && idx < options.length) {
          resolve(options[idx]!);
        } else {
          console.error(pc.yellow('    Invalid choice, keeping current value.'));
          resolve(current);
        }
      },
    );

    rl.on('close', () => resolve(null));
  });
}

async function promptNumber(
  rl: readline.Interface,
  label: string,
  current: number,
  min: number,
  max: number,
): Promise<number | null> {
  return new Promise((resolve) => {
    console.error('');
    console.error(pc.bold(`  ${label}`));
    rl.question(
      `  Value [${min}-${max}] (enter to keep ${current}): `,
      (answer: string) => {
        if (answer.trim() === '') {
          resolve(current);
          return;
        }
        const num = parseInt(answer.trim(), 10);
        if (!isNaN(num) && num >= min && num <= max) {
          resolve(num);
        } else {
          console.error(
            pc.yellow(`    Invalid value (must be ${min}-${max}), keeping ${current}.`),
          );
          resolve(current);
        }
      },
    );

    rl.on('close', () => resolve(null));
  });
}

async function promptConfirm(
  rl: readline.Interface,
  message: string,
): Promise<boolean | null> {
  return new Promise((resolve) => {
    rl.question(`  ${message} [y/N]: `, (answer: string) => {
      resolve(answer.trim().toLowerCase() === 'y');
    });

    rl.on('close', () => resolve(null));
  });
}

// ── Interactive flow ─────────────────────────────────────────────────

async function interactiveConfig(config: HuuConfig): Promise<HuuConfig | null> {
  const log = getLogger();
  const rl = createPromptInterface();
  const updated = JSON.parse(JSON.stringify(config)) as HuuConfig;

  try {
    console.error(pc.bold('\n  HUU Configuration\n'));

    for (const keyDef of CONFIGURABLE_KEYS) {
      const currentValue = getConfigValue(
        updated,
        keyDef.key,
      );

      if (keyDef.type === 'select' && keyDef.options) {
        const result = await promptSelect(
          rl,
          keyDef.label,
          keyDef.options,
          String(currentValue),
        );
        if (result === null) {
          // User cancelled
          return null;
        }
        setConfigValue(updated, keyDef.key, result);
      } else if (keyDef.type === 'number') {
        const result = await promptNumber(
          rl,
          keyDef.label,
          Number(currentValue),
          keyDef.min ?? 1,
          keyDef.max ?? 100,
        );
        if (result === null) {
          return null;
        }
        setConfigValue(updated, keyDef.key, result);
      }
    }

    // Show diff
    console.error('');
    console.error(pc.bold('  Summary of changes:'));
    let hasChanges = false;
    for (const keyDef of CONFIGURABLE_KEYS) {
      const oldVal = getConfigValue(config, keyDef.key);
      const newVal = getConfigValue(updated, keyDef.key);
      if (oldVal !== newVal) {
        console.error(
          `    ${keyDef.label}: ${pc.red(String(oldVal))} → ${pc.green(String(newVal))}`,
        );
        hasChanges = true;
      }
    }

    if (!hasChanges) {
      console.error(pc.dim('    No changes made.'));
      return config;
    }

    const confirm = await promptConfirm(rl, 'Save changes?');
    if (confirm === null || !confirm) {
      return null;
    }

    return updated;
  } finally {
    rl.close();
  }
}

// ── Main action ──────────────────────────────────────────────────────

export async function configAction(flags: ConfigFlags = {}): Promise<void> {
  const log = getLogger();
  const cwd = process.cwd();

  // Check init
  if (!configExists(cwd)) {
    throw errors.notInitialized();
  }

  let config = loadConfig(cwd);

  // --reset: restore defaults
  if (flags.reset) {
    const defaults = createDefaultConfig();
    writeConfigAtomic(cwd, defaults);
    log.success('Configuration reset to defaults.');

    if (flags.json) {
      console.log(JSON.stringify(defaults, null, 2));
    }
    return;
  }

  // --set key=value (non-interactive)
  if (flags.set && flags.set.length > 0) {
    const result = applySetValues(config, flags.set);

    if (result.errors.length > 0) {
      for (const err of result.errors) {
        log.error(err);
      }
      if (result.applied.length === 0) {
        process.exitCode = EXIT_CODES.USAGE_ERROR;
        return;
      }
    }

    // Validate final config
    const validation = validateConfig(config);
    if (!validation.valid) {
      throw errors.configInvalid(
        'config',
        validation.errors.join('; '),
      );
    }

    writeConfigAtomic(cwd, config);

    for (const a of result.applied) {
      log.success(`Set ${a}`);
    }

    if (flags.json) {
      console.log(JSON.stringify(config, null, 2));
    }
    return;
  }

  // --json without other flags: dump current config
  if (flags.json && !flags.set) {
    console.log(JSON.stringify(config, null, 2));
    return;
  }

  // --non-interactive without --set: show current config
  if (flags.nonInteractive) {
    log.header('HUU — Current Configuration');
    for (const keyDef of CONFIGURABLE_KEYS) {
      log.keyValue(
        keyDef.label,
        String(getConfigValue(config, keyDef.key)),
      );
    }
    log.divider();
    return;
  }

  // Interactive flow
  const result = await interactiveConfig(config);
  if (result === null) {
    log.info('Configuration cancelled — no changes saved.');
    process.exitCode = EXIT_CODES.USER_CANCELLED;
    return;
  }

  // Validate
  const validation = validateConfig(result);
  if (!validation.valid) {
    throw errors.configInvalid(
      'config',
      validation.errors.join('; '),
    );
  }

  writeConfigAtomic(cwd, result);
  log.success('Configuration saved.');
}

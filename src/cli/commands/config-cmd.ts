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
import { renderConfigScreen } from '../render.js';

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

  // --non-interactive without --set: show current config as JSON
  if (flags.nonInteractive) {
    console.log(JSON.stringify(config, null, 2));
    return;
  }

  // Interactive flow via Ink
  const result = await renderConfigScreen(config);
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

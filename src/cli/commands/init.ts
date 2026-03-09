// huu init — idempotent project initialization
import fs from 'node:fs';
import path from 'node:path';
import { openDatabase, getDatabaseHealth } from '../../db/connection.js';
import { migrate } from '../../db/migrator.js';
import {
  createDefaultConfig,
  writeConfigAtomic,
  getHuuDir,
  getDbPath,
  getConfigPath,
  huuDirExists,
  configExists,
  loadConfig,
  HUU_DIR,
  DB_FILENAME,
  CONFIG_FILENAME,
} from '../config.js';
import type { HuuConfig } from '../config.js';
import { CliError, errors } from '../errors.js';
import { getLogger } from '../logger.js';

// ── Types ────────────────────────────────────────────────────────────

export interface InitFlags {
  yes?: boolean | undefined;
  nonInteractive?: boolean | undefined;
  force?: boolean | undefined;
  dryRun?: boolean | undefined;
}

interface InitPlanItem {
  artifact: string;
  action: 'create' | 'validate' | 'skip' | 'overwrite';
  reason: string;
}

interface InitPlan {
  items: InitPlanItem[];
  config: HuuConfig;
  isReInit: boolean;
}

// ── Plan builder ─────────────────────────────────────────────────────

function buildInitPlan(cwd: string, flags: InitFlags): InitPlan {
  const items: InitPlanItem[] = [];
  const isReInit = huuDirExists(cwd);
  const config = createDefaultConfig();

  // .huu/ directory
  if (isReInit) {
    items.push({
      artifact: HUU_DIR + '/',
      action: 'validate',
      reason: 'directory already exists',
    });
  } else {
    items.push({
      artifact: HUU_DIR + '/',
      action: 'create',
      reason: 'runtime home directory',
    });
  }

  // .huu/huu.db
  const dbExists = fs.existsSync(getDbPath(cwd));
  if (dbExists) {
    items.push({
      artifact: `${HUU_DIR}/${DB_FILENAME}`,
      action: 'validate',
      reason: 'database exists, will validate and migrate',
    });
  } else {
    items.push({
      artifact: `${HUU_DIR}/${DB_FILENAME}`,
      action: 'create',
      reason: 'unified SQLite store (WAL mode)',
    });
  }

  // .huu/config.json
  const cfgExists = configExists(cwd);
  if (cfgExists && !flags.force) {
    items.push({
      artifact: `${HUU_DIR}/${CONFIG_FILENAME}`,
      action: 'skip',
      reason: 'config exists (use --force to overwrite)',
    });
  } else if (cfgExists && flags.force) {
    items.push({
      artifact: `${HUU_DIR}/${CONFIG_FILENAME}`,
      action: 'overwrite',
      reason: 'overwriting existing config (--force)',
    });
  } else {
    items.push({
      artifact: `${HUU_DIR}/${CONFIG_FILENAME}`,
      action: 'create',
      reason: 'default runtime configuration',
    });
  }

  return { items, config, isReInit };
}

// ── Plan renderer ────────────────────────────────────────────────────

function printPlan(plan: InitPlan): void {
  const log = getLogger();
  log.header(
    plan.isReInit
      ? 'HUU Init — Re-initialization Plan'
      : 'HUU Init — Initialization Plan',
  );

  for (const item of plan.items) {
    const actionLabel =
      item.action === 'create'
        ? '  + create'
        : item.action === 'validate'
          ? '  ~ validate'
          : item.action === 'overwrite'
            ? '  ! overwrite'
            : '  - skip';
    log.keyValue(actionLabel, `${item.artifact} (${item.reason})`);
  }

  log.divider();
}

// ── Execution ────────────────────────────────────────────────────────

export async function initAction(flags: InitFlags = {}): Promise<void> {
  const log = getLogger();
  const cwd = process.cwd();

  // Preflight: check directory is writable
  try {
    fs.accessSync(cwd, fs.constants.W_OK);
  } catch {
    throw errors.initDirNotWritable(cwd);
  }

  // Build plan
  const plan = buildInitPlan(cwd, flags);

  // Dry run: print plan and exit
  if (flags.dryRun) {
    printPlan(plan);
    log.info('Dry run — no changes made.');
    return;
  }

  // Confirmation for re-init (unless --yes or --non-interactive)
  if (plan.isReInit && !flags.yes && !flags.nonInteractive) {
    log.info(
      'HUU is already initialized in this directory. Re-running will validate existing state.',
    );
  }

  printPlan(plan);

  // Execute plan
  log.step('Executing init plan...');

  // 1. Create .huu/
  const huuDir = getHuuDir(cwd);
  fs.mkdirSync(huuDir, { recursive: true });
  log.verbose(`Created/verified directory: ${huuDir}`);

  // 2. Create/open database
  const dbPath = getDbPath(cwd);
  let db;
  try {
    db = openDatabase(dbPath);
  } catch (err) {
    throw errors.dbOpenFailed(
      dbPath,
      err instanceof Error ? err : new Error(String(err)),
    );
  }

  try {
    // Verify WAL mode
    const health = getDatabaseHealth(db);
    if (health.journalMode.toLowerCase() !== 'wal') {
      throw errors.dbWalUnavailable(health.journalMode);
    }
    log.verbose(`Database WAL mode: ${health.journalMode}`);
    log.verbose(`Foreign keys: ${health.foreignKeys ? 'ON' : 'OFF'}`);

    // Run migrations
    try {
      const result = migrate(db);
      if (result.applied > 0) {
        log.success(
          `Applied ${result.applied} migration(s), schema at version ${result.current}`,
        );
      } else {
        log.verbose(`Schema up to date at version ${result.current}`);
      }
    } catch (err) {
      throw errors.dbMigrationFailed(
        err instanceof Error ? err : new Error(String(err)),
      );
    }
  } finally {
    db.close();
  }

  // 3. Write config
  const configPath = getConfigPath(cwd);
  const cfgItem = plan.items.find(
    (i) => i.artifact === `${HUU_DIR}/${CONFIG_FILENAME}`,
  )!;

  if (cfgItem.action === 'skip') {
    // Validate existing config
    try {
      const existing = loadConfig(cwd);
      log.verbose('Existing config validated successfully');
    } catch (err) {
      if (err instanceof CliError) {
        log.warn(`Config validation issue: ${err.message}`);
        log.info(
          'Run `huu config` to fix, or `huu init --force` to overwrite.',
        );
      } else {
        throw err;
      }
    }
  } else {
    writeConfigAtomic(cwd, plan.config);
    log.verbose(`Config written to ${configPath}`);
  }

  // 4. Report
  log.divider();
  log.success(
    plan.isReInit
      ? 'HUU re-initialized successfully — existing state validated.'
      : 'HUU initialized successfully!',
  );

  if (!plan.isReInit) {
    log.info('Next steps:');
    log.step('  Run `huu config` to customize settings');
    log.step('  Run `huu run "task description"` to start an agent');
  }
}

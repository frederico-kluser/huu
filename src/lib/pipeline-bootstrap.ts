import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEFAULT_PIPELINE_FILENAME,
  getDefaultPipelineFileContent,
} from './default-pipelines/huu-test-suite.js';
import {
  DEFAULT_PIPELINES,
  type DefaultPipelineModule,
} from './default-pipelines/registry.js';

const PIPELINES_DIR = 'pipelines';

export interface BootstrapResult {
  /** Absolute path of the default pipeline file (whether or not we wrote it). */
  filePath: string;
  /** True if we just materialized the file in this call. */
  created: boolean;
}

/**
 * Idempotently writes `pipelines/huu-test-suite.pipeline.json` in the given
 * repo if it isn't there yet. Never overwrites an existing file — the user
 * is free to edit (or delete; we won't recreate after delete because the
 * file itself is the sentinel).
 *
 * Best-effort: any fs error is swallowed and reported via the optional
 * `onError` callback so the boot path never blows up because the repo is
 * read-only / mounted with weird perms.
 *
 * Kept for back-compat — {@link ensureAllDefaultPipelines} is the new entry
 * point that iterates the full registry.
 */
export function ensureDefaultPipeline(
  repoRoot: string,
  onError?: (err: Error) => void,
): BootstrapResult {
  return materializeOne(
    repoRoot,
    DEFAULT_PIPELINE_FILENAME,
    getDefaultPipelineFileContent,
    onError,
  );
}

export interface BootstrapAllResult {
  /** The pipelines directory path (whether or not it existed before). */
  dir: string;
  /** One entry per bundled default. */
  results: Array<BootstrapResult & { name: string }>;
}

/**
 * Iterate the {@link DEFAULT_PIPELINES} catalog and idempotently materialize
 * each into `pipelines/<filename>.pipeline.json`. Same non-overwrite and
 * best-effort guarantees as {@link ensureDefaultPipeline}.
 *
 * The order of writes follows {@link DEFAULT_PIPELINES}; an error writing
 * one file does NOT stop the others.
 */
export function ensureAllDefaultPipelines(
  repoRoot: string,
  onError?: (err: Error, pipeline: DefaultPipelineModule) => void,
): BootstrapAllResult {
  const dir = join(repoRoot, PIPELINES_DIR);
  const results: BootstrapAllResult['results'] = [];
  for (const mod of DEFAULT_PIPELINES) {
    const res = materializeOne(
      repoRoot,
      mod.DEFAULT_PIPELINE_FILENAME,
      mod.getDefaultPipelineFileContent,
      (err) => onError?.(err, mod),
    );
    results.push({ ...res, name: mod.DEFAULT_PIPELINE_NAME });
  }
  return { dir, results };
}

function materializeOne(
  repoRoot: string,
  filename: string,
  getContent: () => string,
  onError?: (err: Error) => void,
): BootstrapResult {
  const dir = join(repoRoot, PIPELINES_DIR);
  const filePath = join(dir, filename);

  if (existsSync(filePath)) {
    return { filePath, created: false };
  }

  try {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(filePath, getContent(), 'utf8');
    return { filePath, created: true };
  } catch (err) {
    onError?.(err as Error);
    return { filePath, created: false };
  }
}

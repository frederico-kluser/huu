import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEFAULT_PIPELINE_FILENAME,
  getDefaultPipelineFileContent,
} from './default-pipelines/huu-test-suite.js';

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
 */
export function ensureDefaultPipeline(
  repoRoot: string,
  onError?: (err: Error) => void,
): BootstrapResult {
  const dir = join(repoRoot, PIPELINES_DIR);
  const filePath = join(dir, DEFAULT_PIPELINE_FILENAME);

  if (existsSync(filePath)) {
    return { filePath, created: false };
  }

  try {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(filePath, getDefaultPipelineFileContent(), 'utf8');
    return { filePath, created: true };
  } catch (err) {
    onError?.(err as Error);
    return { filePath, created: false };
  }
}

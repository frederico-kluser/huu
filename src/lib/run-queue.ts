/**
 * The (pipeline × project) fan-out: one run per pair, each with its OWN repo
 * root. The typed counterpart of the web client's `fanOutBatch`
 * (`src/web/client/queue-util.js`), used by the Ink TUI's run-queue review
 * screen and by the multi-run dashboard that consumes the reviewed list.
 *
 * Pure + leaf: string/array work only (`basename` is a pure path op), so the
 * reducer and the review screen can both use it without touching the fs.
 */

import { basename } from 'node:path';
import type { Pipeline } from './types.js';

export interface RunQueueItem {
  pipeline: Pipeline;
  /** Repo root for THIS run. */
  cwd: string;
  /** `<pipeline> → <folder>` — the tab strip and the batch summary read this. */
  label: string;
}

/** `<pipeline name> → <folder basename>`; falls back to the raw path at the fs root. */
export function runLabel(pipeline: Pipeline, cwd: string): string {
  return `${pipeline.name} → ${basename(cwd) || cwd}`;
}

/**
 * Build the queue. PIPELINE-MAJOR order (all projects of pipeline 1, then
 * pipeline 2, …) because index IS scheduler priority: the first pipeline's
 * projects should be served before the second pipeline starts competing for
 * RAM, which is also how the web groups its queue rows.
 *
 * `projectDirs` empty → falls back to `[fallbackCwd]`, so the legacy
 * "N pipelines, one repo" batch produces the same list it always did.
 */
export function buildRunQueue(
  pipelines: readonly Pipeline[],
  projectDirs: readonly string[],
  fallbackCwd: string,
): RunQueueItem[] {
  const dirs = projectDirs.length > 0 ? projectDirs : [fallbackCwd];
  const out: RunQueueItem[] = [];
  for (const pipeline of pipelines) {
    for (const cwd of dirs) {
      out.push({ pipeline, cwd, label: runLabel(pipeline, cwd) });
    }
  }
  return out;
}

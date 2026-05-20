// Pipeline list / persistence helpers used by `WebSession`.
//
// Kept free of `WebConnection` so they can be unit-tested without
// instantiating a session. Mirrors the side effects performed by the
// TUI in `src/app.tsx` (see the welcome / saved-pipelines effects).

import { join } from 'node:path';
import {
  listAllPipelines,
  savePipelineToMemory,
  deletePipelineFromMemory,
  parsePipelineFromJson,
  type PipelineEntry,
} from '../../lib/pipeline-io.js';
import { listPipelinesInMemory } from '../../lib/pipeline-memory.js';
import type { Pipeline } from '../../lib/types.js';

export interface PipelineLists {
  available: PipelineEntry[];
  saved: PipelineEntry[];
}

/**
 * Reads the on-disk `pipelines/` directory beneath `cwd` (plus the
 * global pipelines dir, via `listAllPipelines`) AND the in-memory
 * saved-pipelines store. Both lists are normalized to `PipelineEntry`
 * so the protocol's `pipelines` message can carry them uniformly.
 */
export function loadPipelineLists(cwd: string): PipelineLists {
  const available = listAllPipelines(join(cwd, 'pipelines'));
  const saved = listPipelinesInMemory().map<PipelineEntry>((e) => ({
    fileName: e.name,
    filePath: `memory://${e.name}`,
    pipeline: e.pipeline,
    source: 'global',
  }));
  return { available, saved };
}

/**
 * Persist `pipeline` to the in-memory store under `name`. The store
 * keys on `pipeline.name`, so we splice the requested name into the
 * object before saving — that lets the front-end rename a pipeline
 * during save without a separate "rename" round-trip.
 */
export function savePipeline(name: string, pipeline: Pipeline): void {
  const renamed: Pipeline = { ...pipeline, name };
  savePipelineToMemory(renamed);
}

export function deletePipeline(name: string): boolean {
  return deletePipelineFromMemory(name);
}

/**
 * Parse a pipeline from a raw JSON string. Accepts both the wrapped
 * `{ _format, pipeline }` shape and a bare pipeline object — same
 * lenience the TUI's "paste JSON" path gives the user.
 */
export function importPipelineFromJson(json: string): Pipeline {
  return parsePipelineFromJson(json);
}

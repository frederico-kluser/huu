// The MEMORY CONTRACT — the boilerplate the user never writes.
//
// A step that declares `produces: "<path>"` promises to write a
// huu-memory-v1 file for a later `memory`-scope step. Instead of asking the
// pipeline author to paste the JSON format into the producer's prompt (and
// keep it in sync by hand), the orchestrator appends this deterministic
// block at run time. The saved pipeline JSON stays clean; the agent always
// receives the exact, current contract.
//
// Keep this file pure (no fs / no env): it is imported by the orchestrator
// AND by UI surfaces that want to preview the injected text.

import type { Pipeline } from './types.js';
import { DEFAULT_MEMORY_MAX_FILES } from './types.js';

/**
 * The deterministic contract block appended to a producer step's prompt.
 * `cap` should come from {@link memoryCapForPath} so the producer is told
 * the SAME limit the consumer will enforce.
 */
export function memoryContract(path: string, cap: number = DEFAULT_MEMORY_MAX_FILES): string {
  return `=== MEMORY CONTRACT (appended by huu — a later step consumes this file) ===
Before finishing, write \`${path}\` EXACTLY in this format:
{ "_format": "huu-memory-v1", "files": [ { "path": "<repo-relative path>", "hint": "<one line of context for the agent that will work on this file>", "priority": <number, higher runs first — optional> } ] }
- List at most ${cap} files. Entries beyond the cap are dropped at run time.
- Every entry MUST carry a hint — it becomes the next step's $hint and is the single most valuable thing you hand over.
- Only list files that genuinely qualify. An empty "files" array is valid and means "nothing found" (the next step then runs zero tasks).
- Paths are relative to the repo root; absolute paths and ".." are rejected.`;
}

/**
 * The fan-out cap the consumer of `path` will enforce: the `maxFiles` of
 * the memory-scope step whose `filesFrom` matches, falling back to
 * {@link DEFAULT_MEMORY_MAX_FILES}. Used so the producer's contract quotes
 * the real limit.
 */
export function memoryCapForPath(pipeline: Pipeline, path: string): number {
  for (const step of pipeline.steps) {
    if (step.type === 'check') continue;
    if (step.scope === 'memory' && step.filesFrom === path) {
      return step.maxFiles ?? DEFAULT_MEMORY_MAX_FILES;
    }
  }
  return DEFAULT_MEMORY_MAX_FILES;
}

// Resolver for `memory`-scope steps: an earlier step writes a huu-memory-v1
// JSON listing repo-relative paths (optionally with per-file hints and
// priorities); when the cursor reaches the consuming step, the orchestrator
// reads that file FROM THE INTEGRATION WORKTREE (the merged state of every
// previous stage — so check-loop rewrites are picked up for free) and fans
// out one task per listed file.
//
// Failure split (deterministic and stub-safe):
// - MISSING memory file → { files: [] } + warning: absence can be legitimate
//   (the producer chose nothing; stub runs write no files). The stage then
//   completes empty and the run TERMINATES instead of crashing.
// - PRESENT but corrupt (bad JSON, wrong _format, schema violation, or
//   every path unusable) → throws MemoryFileError: corruption is never
//   legitimate and must fail the run loudly.

import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, normalize } from 'node:path';
import { z } from 'zod';
import { DEFAULT_MEMORY_MAX_FILES } from '../lib/types.js';

export const MEMORY_FORMAT_TAG = 'huu-memory-v1';

const MemoryEntrySchema = z.union([
  z.string().min(1),
  z.object({
    path: z.string().min(1),
    hint: z.string().max(600).optional(),
    priority: z.number().optional(),
  }),
]);

export const MemoryFileSchema = z.object({
  _format: z.literal(MEMORY_FORMAT_TAG),
  files: z.array(MemoryEntrySchema),
});

/** Thrown when the memory file exists but cannot be trusted. */
export class MemoryFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MemoryFileError';
  }
}

export interface ResolvedMemoryFiles {
  /** Repo-relative paths, priority desc then list order, capped at maxFiles. */
  files: string[];
  /** Per-path hint from the producing step (only entries that had one). */
  hints: Map<string, string>;
  /** Human-readable notes: missing file, dropped paths, truncation. */
  warnings: string[];
  /** True when the memory file did not exist (files is then empty). */
  missing: boolean;
}

// Paths under these roots never become tasks even if a producer lists them —
// same families the per-file prompts auto-skip. Generated/vendored content
// teaches an agent nothing and burns the width budget.
const SKIPPED_PREFIXES = [
  'node_modules/',
  'dist/',
  'build/',
  'out/',
  'coverage/',
  '.git/',
  'vendor/',
  'target/',
  '__pycache__/',
];

function isSkipped(path: string): boolean {
  return SKIPPED_PREFIXES.some((p) => path === p.slice(0, -1) || path.startsWith(p) || path.includes(`/${p}`));
}

/**
 * Reads and validates a huu-memory-v1 file from `worktreeRoot` and returns
 * the runnable file list. See the module header for the missing-vs-corrupt
 * contract. Paths that escape the repo (absolute or `..`) or don't exist in
 * the worktree are dropped with a warning; if the file listed entries and
 * NONE survive, that is treated as corruption (throws).
 */
export function resolveMemoryFiles(
  filesFrom: string,
  worktreeRoot: string,
  maxFiles: number = DEFAULT_MEMORY_MAX_FILES,
): ResolvedMemoryFiles {
  const warnings: string[] = [];
  const memoryPath = join(worktreeRoot, filesFrom);

  if (!existsSync(memoryPath)) {
    warnings.push(
      `memory file "${filesFrom}" not found in the integration worktree — step resolves to 0 tasks (stage will complete empty)`,
    );
    return { files: [], hints: new Map(), warnings, missing: true };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(memoryPath, 'utf8'));
  } catch (err) {
    throw new MemoryFileError(
      `memory file "${filesFrom}" is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const parsed = MemoryFileSchema.safeParse(raw);
  if (!parsed.success) {
    throw new MemoryFileError(
      `memory file "${filesFrom}" does not match ${MEMORY_FORMAT_TAG}: ${parsed.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ')}`,
    );
  }

  type Normalized = { path: string; hint?: string; priority: number; order: number };
  const normalized: Normalized[] = parsed.data.files.map((entry, order) =>
    typeof entry === 'string'
      ? { path: entry, priority: 0, order }
      : { path: entry.path, hint: entry.hint, priority: entry.priority ?? 0, order },
  );

  const seen = new Set<string>();
  const usable: Normalized[] = [];
  for (const entry of normalized) {
    const rel = normalize(entry.path);
    if (isAbsolute(rel) || rel === '..' || rel.startsWith(`..`)) {
      warnings.push(`dropped "${entry.path}": escapes the repository root`);
      continue;
    }
    if (isSkipped(rel)) {
      warnings.push(`dropped "${entry.path}": matches the generated/vendored skip list`);
      continue;
    }
    if (seen.has(rel)) {
      warnings.push(`dropped duplicate "${entry.path}"`);
      continue;
    }
    if (!existsSync(join(worktreeRoot, rel))) {
      warnings.push(`dropped "${entry.path}": does not exist in the integration worktree`);
      continue;
    }
    seen.add(rel);
    usable.push({ ...entry, path: rel });
  }

  if (normalized.length > 0 && usable.length === 0) {
    throw new MemoryFileError(
      `memory file "${filesFrom}" listed ${normalized.length} file(s) but none are usable (${warnings.join('; ')})`,
    );
  }

  usable.sort((a, b) => b.priority - a.priority || a.order - b.order);

  let capped = usable;
  if (usable.length > maxFiles) {
    warnings.push(
      `memory file "${filesFrom}" lists ${usable.length} usable files — truncated to maxFiles=${maxFiles} (priority desc, then list order)`,
    );
    capped = usable.slice(0, maxFiles);
  }

  const hints = new Map<string, string>();
  for (const entry of capped) {
    if (entry.hint) hints.set(entry.path, entry.hint);
  }

  return { files: capped.map((e) => e.path), hints, warnings, missing: false };
}

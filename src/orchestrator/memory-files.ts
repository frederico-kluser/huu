// Resolver for `memory`-scope steps: an earlier step writes a huu-memory-v1
// JSON listing repo-relative paths (optionally with per-file hints and
// priorities); when the cursor reaches the consuming step, the orchestrator
// reads that file FROM THE INTEGRATION WORKTREE (the merged state of every
// previous stage — so check-loop rewrites are picked up for free) and fans
// out one task per listed file.
//
// Failure split (deterministic and stub-safe). Guiding rule: the memory layer
// must NEVER abort a run for a SALVAGEABLE reason — only a file that is not a
// usable list AT ALL is fatal.
// - MISSING memory file → { files: [] } + warning: absence can be legitimate
//   (the producer chose nothing; stub runs write no files). The stage then
//   completes empty and the run TERMINATES instead of crashing.
// - SOFT, per-entry problems are SALVAGED, each with a warning, never fatal:
//   a hint over the length cap is TRUNCATED; a non-string hint / non-numeric
//   priority is IGNORED; an entry that is not a string or a `{ path }` object
//   (or whose path is empty) is DROPPED. An LLM producer should never kill a
//   run over the shape of one optional field.
// - STRUCTURAL corruption is fatal — throws MemoryFileError: not valid JSON,
//   wrong/absent `_format`, `files` not an array, OR a list that named real
//   paths of which NONE survive validation. Those mean "this is not a usable
//   list", which must fail loudly.

import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, normalize } from 'node:path';
import { z } from 'zod';
import { DEFAULT_MEMORY_HINT_MAX_CHARS, DEFAULT_MEMORY_MAX_FILES } from '../lib/types.js';

export const MEMORY_FORMAT_TAG = 'huu-memory-v1';

// Only the top-level SHAPE is a hard gate: the file must announce the format
// tag and carry a `files` ARRAY. Entries are deliberately `unknown` here and
// salvaged per-entry in `normalizeEntry` below, so a soft problem in one entry
// (long hint, bad priority, wrong shape) can never fail the whole parse — and
// thus can never abort the run. See the module header's failure split.
export const MemoryFileSchema = z.object({
  _format: z.literal(MEMORY_FORMAT_TAG),
  files: z.array(z.unknown()),
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

type Normalized = { path: string; hint?: string; priority: number; order: number };

/**
 * Salvage ONE raw `files` entry into a normalized record, or drop it. Soft
 * problems never throw: an over-length hint is truncated to
 * {@link DEFAULT_MEMORY_HINT_MAX_CHARS}, a non-string hint or non-numeric
 * priority is ignored, and an entry with no usable path is dropped. Every
 * adjustment appends a warning so the choice is visible in the run log.
 * Returns `null` when the entry yields no usable path.
 */
function normalizeEntry(entry: unknown, order: number, warnings: string[]): Normalized | null {
  if (typeof entry === 'string') {
    if (entry.length === 0) {
      warnings.push(`dropped entry #${order}: empty path string`);
      return null;
    }
    return { path: entry, priority: 0, order };
  }
  if (entry !== null && typeof entry === 'object' && !Array.isArray(entry)) {
    const obj = entry as Record<string, unknown>;
    if (typeof obj.path !== 'string' || obj.path.length === 0) {
      warnings.push(`dropped entry #${order}: missing or empty "path"`);
      return null;
    }
    const path = obj.path;
    let hint: string | undefined;
    if (typeof obj.hint === 'string') {
      if (obj.hint.length > DEFAULT_MEMORY_HINT_MAX_CHARS) {
        warnings.push(
          `truncated hint for "${path}" (${obj.hint.length} → ${DEFAULT_MEMORY_HINT_MAX_CHARS} chars)`,
        );
        hint = obj.hint.slice(0, DEFAULT_MEMORY_HINT_MAX_CHARS);
      } else {
        hint = obj.hint;
      }
    } else if (obj.hint !== undefined) {
      warnings.push(`ignored non-string hint for "${path}"`);
    }
    let priority = 0;
    if (typeof obj.priority === 'number' && Number.isFinite(obj.priority)) {
      priority = obj.priority;
    } else if (obj.priority !== undefined) {
      warnings.push(`ignored non-numeric priority for "${path}" (defaulted to 0)`);
    }
    return { path, hint, priority, order };
  }
  warnings.push(`dropped entry #${order}: not a path string or { path } object`);
  return null;
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

  // Salvage each entry independently — a malformed one is dropped (with a
  // warning), never a parse failure. `normalized` therefore holds only the
  // entries that yielded a usable path; the "named files but NONE usable"
  // backstop below still fires for a producer that emitted real-looking
  // paths that all turn out to be unusable.
  const normalized: Normalized[] = [];
  parsed.data.files.forEach((entry, order) => {
    const n = normalizeEntry(entry, order, warnings);
    if (n) normalized.push(n);
  });

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

import type { SimpleGit } from 'simple-git';

// ── Types ────────────────────────────────────────────────────────────

export interface FileChangeSummary {
  added: string[];
  modified: string[];
  deleted: string[];
  renamed: Array<{ from: string; to: string }>;
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Collect file changes from a commit using `git diff-tree`.
 * Returns a structured summary with added/modified/deleted/renamed files.
 *
 * Uses `--find-renames` to detect renames instead of reporting them
 * as a delete + add pair.
 */
export async function getFileChangesFromCommit(
  git: SimpleGit,
  commitSha: string,
): Promise<FileChangeSummary> {
  const result = await git.raw([
    'diff-tree',
    '--no-commit-id',
    '--name-status',
    '--find-renames',
    '-r',
    '-z',
    commitSha,
  ]);

  return parseDiffTreeOutput(result);
}

/**
 * Collect file changes from the working tree (uncommitted changes).
 * Uses `git status --porcelain=v2 -z` for reliable parsing.
 */
export async function getFileChangesFromWorkingTree(
  git: SimpleGit,
): Promise<FileChangeSummary> {
  const result = await git.raw([
    'status',
    '--porcelain=v2',
    '-z',
  ]);

  return parsePorcelainV2Output(result);
}

// ── Parsers ──────────────────────────────────────────────────────────

/**
 * Parse output of `git diff-tree --name-status --find-renames -r -z`.
 *
 * Format: NUL-separated entries.
 * Regular entries: `<status>\0<path>\0`
 * Rename entries:  `R<score>\0<from>\0<to>\0`
 */
export function parseDiffTreeOutput(raw: string): FileChangeSummary {
  const summary: FileChangeSummary = {
    added: [],
    modified: [],
    deleted: [],
    renamed: [],
  };

  if (!raw || raw.trim() === '') return summary;

  // Split by NUL, filter empty trailing entries
  const parts = raw.split('\0').filter((p) => p !== '');
  let i = 0;

  while (i < parts.length) {
    const status = parts[i]!;
    const code = status[0]!;

    if (code === 'R' || code === 'C') {
      // Rename or Copy: status, old path, new path
      const from = parts[i + 1];
      const to = parts[i + 2];
      if (from !== undefined && to !== undefined) {
        summary.renamed.push({ from, to });
      }
      i += 3;
    } else {
      const filePath = parts[i + 1];
      if (filePath !== undefined) {
        switch (code) {
          case 'A':
            summary.added.push(filePath);
            break;
          case 'M':
          case 'T': // type change (e.g. file -> symlink)
            summary.modified.push(filePath);
            break;
          case 'D':
            summary.deleted.push(filePath);
            break;
          default:
            // Unknown status: treat as modified
            summary.modified.push(filePath);
            break;
        }
      }
      i += 2;
    }
  }

  return summary;
}

/**
 * Parse output of `git status --porcelain=v2 -z`.
 *
 * Format: NUL-separated entries.
 * Ordinary changed entries: `1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>`
 * Renamed/copied entries:   `2 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <X><score> <path><sep><origPath>`
 * Untracked:                `? <path>`
 */
export function parsePorcelainV2Output(raw: string): FileChangeSummary {
  const summary: FileChangeSummary = {
    added: [],
    modified: [],
    deleted: [],
    renamed: [],
  };

  if (!raw || raw.trim() === '') return summary;

  const parts = raw.split('\0').filter((p) => p !== '');
  let i = 0;

  while (i < parts.length) {
    const line = parts[i]!;

    if (line.startsWith('?')) {
      // Untracked file
      const filePath = line.slice(2);
      summary.added.push(filePath);
      i += 1;
    } else if (line.startsWith('1')) {
      // Ordinary changed entry
      const fields = line.split(' ');
      const xy = fields[1]!;
      const filePath = fields.slice(8).join(' ');

      const indexStatus = xy[0]!;
      if (indexStatus === 'A') {
        summary.added.push(filePath);
      } else if (indexStatus === 'D') {
        summary.deleted.push(filePath);
      } else if (indexStatus === 'M' || indexStatus === 'T') {
        summary.modified.push(filePath);
      }
      i += 1;
    } else if (line.startsWith('2')) {
      // Renamed/copied entry: next part is the original path
      const fields = line.split(' ');
      const newPath = fields.slice(9).join(' ');
      const origPath = parts[i + 1];

      if (origPath !== undefined) {
        summary.renamed.push({ from: origPath, to: newPath });
      }
      i += 2;
    } else {
      // Skip headers or unknown lines
      i += 1;
    }
  }

  return summary;
}

/**
 * Create an empty file change summary.
 */
export function emptyFileChangeSummary(): FileChangeSummary {
  return { added: [], modified: [], deleted: [], renamed: [] };
}

/**
 * Check if a file change summary has any changes.
 */
export function hasChanges(summary: FileChangeSummary): boolean {
  return (
    summary.added.length > 0 ||
    summary.modified.length > 0 ||
    summary.deleted.length > 0 ||
    summary.renamed.length > 0
  );
}

/**
 * Flatten a FileChangeSummary to a simple list of affected file paths.
 */
export function flattenChangedFiles(summary: FileChangeSummary): string[] {
  return [
    ...summary.added,
    ...summary.modified,
    ...summary.deleted,
    ...summary.renamed.map((r) => r.to),
  ];
}

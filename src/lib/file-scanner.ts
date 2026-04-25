import { readdirSync, statSync } from 'node:fs';
import { join, relative, extname } from 'node:path';

const IGNORED_DIRS = new Set([
  '.git', 'node_modules', 'dist', 'build', '.next', '.nuxt',
  'coverage', '.turbo', '.cache', '__pycache__', '.venv', 'venv',
  '.programatic-agent-worktrees',
]);

const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.svg',
  '.woff', '.woff2', '.ttf', '.eot',
  '.zip', '.tar', '.gz', '.br',
  '.exe', '.dll', '.so', '.dylib',
  '.pdf', '.mp3', '.mp4', '.mov', '.avi',
  '.lock',
]);

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Returns a flat list of textual file paths (relative to rootDir),
 * skipping ignored dirs, hidden entries, and binary extensions.
 */
export function listRepoFiles(rootDir: string): string[] {
  const result: string[] = [];
  walk(rootDir, rootDir, result);
  result.sort();
  return result;
}

function walk(dir: string, rootDir: string, out: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.startsWith('.')) continue;
    const fullPath = join(dir, entry);
    if (isDirectory(fullPath)) {
      if (IGNORED_DIRS.has(entry)) continue;
      walk(fullPath, rootDir, out);
    } else {
      const ext = extname(entry).toLowerCase();
      if (BINARY_EXTENSIONS.has(ext)) continue;
      out.push(relative(rootDir, fullPath));
    }
  }
}

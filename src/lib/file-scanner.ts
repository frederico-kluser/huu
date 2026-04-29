import { readdirSync, statSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import type { FileNode } from './types.js';

const IGNORED_DIRS = new Set([
  '.git', 'node_modules', 'dist', 'build', '.next', '.nuxt',
  'coverage', '.turbo', '.cache', '__pycache__', '.venv', 'venv',
  '.huu-worktrees',
  '.huu',
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

/** Builds a recursive FileNode tree rooted at rootDir, with the root expanded. */
export function scanDirectory(rootDir: string): FileNode {
  return scanRecursive(rootDir, rootDir);
}

function scanRecursive(dir: string, rootDir: string): FileNode {
  const name = dir === rootDir ? '.' : dir.split('/').pop() || dir;
  const relPath = relative(rootDir, dir) || '.';

  const children: FileNode[] = [];

  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return { name, path: relPath, isDirectory: true, children: [], expanded: false, selected: false };
  }

  entries.sort((a, b) => {
    const aIsDir = isDirectory(join(dir, a));
    const bIsDir = isDirectory(join(dir, b));
    if (aIsDir && !bIsDir) return -1;
    if (!aIsDir && bIsDir) return 1;
    return a.localeCompare(b);
  });

  for (const entry of entries) {
    if (entry.startsWith('.')) continue;
    const fullPath = join(dir, entry);
    const entryRelPath = relative(rootDir, fullPath);

    if (isDirectory(fullPath)) {
      if (IGNORED_DIRS.has(entry)) continue;
      children.push(scanRecursive(fullPath, rootDir));
    } else {
      const ext = extname(entry).toLowerCase();
      if (BINARY_EXTENSIONS.has(ext)) continue;
      children.push({
        name: entry,
        path: entryRelPath,
        isDirectory: false,
        selected: false,
      });
    }
  }

  return {
    name,
    path: relPath,
    isDirectory: true,
    children,
    expanded: relPath === '.',
    selected: false,
  };
}

/** Toggles selection on a node; folders cascade selection to descendants. */
export function toggleNode(node: FileNode, targetPath: string): FileNode {
  if (node.path === targetPath) {
    return applySelection(node, !node.selected);
  }
  if (!node.children) return node;
  const newChildren = node.children.map((child) => toggleNode(child, targetPath));
  const allSelected = newChildren.every((c) =>
    c.isDirectory ? (c.children?.every((gc) => gc.selected) ?? true) : c.selected,
  );
  return { ...node, children: newChildren, selected: allSelected };
}

function applySelection(node: FileNode, selected: boolean): FileNode {
  if (!node.isDirectory) return { ...node, selected };
  const newChildren = node.children?.map((child) => applySelection(child, selected));
  return { ...node, selected, children: newChildren };
}

/** Expands or collapses a directory node. No-op for files. */
export function toggleExpand(node: FileNode, targetPath: string): FileNode {
  if (node.path === targetPath && node.isDirectory) {
    return { ...node, expanded: !node.expanded };
  }
  if (!node.children) return node;
  return {
    ...node,
    children: node.children.map((child) => toggleExpand(child, targetPath)),
  };
}

/** Flattens the visible (expanded) portion of the tree, depth-annotated. */
export function flattenVisible(node: FileNode, depth = 0): Array<{ node: FileNode; depth: number }> {
  const result: Array<{ node: FileNode; depth: number }> = [];
  if (depth > 0) result.push({ node, depth });
  if (node.isDirectory && (node.expanded || node.path === '.')) {
    for (const child of node.children || []) {
      result.push(...flattenVisible(child, depth + 1));
    }
  }
  return result;
}

/** Returns the relative paths of all selected files (folders not included). */
export function flattenSelected(node: FileNode): string[] {
  const files: string[] = [];
  if (!node.isDirectory && node.selected) files.push(node.path);
  if (node.children) {
    for (const child of node.children) files.push(...flattenSelected(child));
  }
  return files;
}

/** Recursively selects/deselects every file in the tree. */
export function selectAll(node: FileNode, selected: boolean): FileNode {
  return applySelection(node, selected);
}

/** Pre-selects the given file paths in the tree. All other files are deselected. */
export function selectByPaths(node: FileNode, paths: Set<string>): FileNode {
  if (!node.isDirectory) {
    return { ...node, selected: paths.has(node.path) };
  }
  const newChildren = node.children?.map((child) => selectByPaths(child, paths));
  const allSelected = (newChildren?.length ?? 0) > 0 && (newChildren?.every((c) => c.selected) ?? false);
  return { ...node, children: newChildren, selected: allSelected };
}

/** Selects every file whose relative path matches the regex; deselects all others. */
export function selectByRegex(node: FileNode, regex: RegExp): FileNode {
  if (!node.isDirectory) {
    return { ...node, selected: regex.test(node.path) };
  }
  const newChildren = node.children?.map((child) => selectByRegex(child, regex));
  const allSelected = (newChildren?.length ?? 0) > 0 && (newChildren?.every((c) => c.selected) ?? false);
  return { ...node, children: newChildren, selected: allSelected };
}

/** Counts file leaves whose relative path matches the regex (directories not included). */
export function countRegexMatches(node: FileNode, regex: RegExp): number {
  let count = 0;
  if (!node.isDirectory) {
    if (regex.test(node.path)) count += 1;
  } else if (node.children) {
    for (const child of node.children) count += countRegexMatches(child, regex);
  }
  return count;
}

/** Expands every directory in the subtree (used when filtering so matches are visible). */
export function expandAll(node: FileNode): FileNode {
  if (!node.isDirectory) return node;
  return {
    ...node,
    expanded: true,
    children: node.children?.map(expandAll),
  };
}

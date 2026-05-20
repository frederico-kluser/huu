// File-tree scan for the web UI's file picker. Wraps the synchronous
// `scanDirectory` helper from `lib/file-scanner.ts` and returns a
// single-element array to match the protocol's `tree: FileNode[]`
// shape (the TUI uses a single root node, but the wire type leaves
// room for multiple roots if a future variant wants e.g. a worktree
// list).

import { scanDirectory } from '../../lib/file-scanner.js';
import type { FileNode } from '../../lib/types.js';

export function scanFileTree(root: string): FileNode[] {
  return [scanDirectory(root)];
}

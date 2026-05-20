import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { listRepoFiles } from './file-scanner.js';

const MAX_FILE_TREE_ENTRIES = 200;
const MAX_README_CHARS = 3500;
const MAX_DOC_CHARS = 3000;
const MAX_PKG_CHARS = 4000;
const MAX_TSCONFIG_CHARS = 1500;

export interface ProjectDigest {
  rootDir: string;
  projectName?: string;
  digest: string;
}

function readBoundedFile(path: string, max: number): string | undefined {
  try {
    if (!existsSync(path)) return undefined;
    const stat = statSync(path);
    if (!stat.isFile()) return undefined;
    const content = readFileSync(path, 'utf8');
    if (content.length <= max) return content;
    return `${content.slice(0, max)}\n\n[…${content.length - max} chars truncados…]`;
  } catch {
    return undefined;
  }
}

/**
 * Collects a one-shot snapshot of the project for the recon agents to reason
 * over. Synchronous, lossy by design — every section is bounded so the digest
 * fits comfortably in a model context. Missing files are skipped silently;
 * the agents are told to surface "no clear evidence" when they can't find
 * something.
 */
export function buildProjectDigest(rootDir: string): ProjectDigest {
  const sections: string[] = [];

  const pkgRaw = readBoundedFile(join(rootDir, 'package.json'), MAX_PKG_CHARS);
  let projectName: string | undefined;
  if (pkgRaw) {
    try {
      const parsed = JSON.parse(pkgRaw) as { name?: unknown };
      if (typeof parsed.name === 'string' && parsed.name.length > 0) {
        projectName = parsed.name;
      }
    } catch {
      // Truncated JSON or malformed — name detection is best-effort.
    }
    sections.push(`## package.json\n\`\`\`json\n${pkgRaw}\n\`\`\``);
  }

  const tsconfig = readBoundedFile(join(rootDir, 'tsconfig.json'), MAX_TSCONFIG_CHARS);
  if (tsconfig) sections.push(`## tsconfig.json\n\`\`\`json\n${tsconfig}\n\`\`\``);

  const readme = readBoundedFile(join(rootDir, 'README.md'), MAX_README_CHARS);
  if (readme) sections.push(`## README.md\n${readme}`);

  const claudeMd = readBoundedFile(join(rootDir, 'CLAUDE.md'), MAX_DOC_CHARS);
  if (claudeMd) sections.push(`## CLAUDE.md\n${claudeMd}`);

  const agentsMd = readBoundedFile(join(rootDir, 'AGENTS.md'), MAX_DOC_CHARS);
  if (agentsMd) sections.push(`## AGENTS.md\n${agentsMd}`);

  let files: string[] = [];
  try {
    files = listRepoFiles(rootDir);
  } catch {
    // listRepoFiles already swallows per-directory errors; an empty list is
    // a valid degraded state.
  }
  const visible = files.slice(0, MAX_FILE_TREE_ENTRIES);
  const tail =
    files.length > MAX_FILE_TREE_ENTRIES
      ? `\n[… +${files.length - MAX_FILE_TREE_ENTRIES} arquivos restantes truncados]`
      : '';
  sections.push(
    `## File tree (paths relativos, ignora node_modules/dist/.git/etc)\n${visible.join('\n')}${tail}`,
  );

  return {
    rootDir,
    projectName,
    digest: sections.join('\n\n'),
  };
}

// Does the target repo already carry an agent-skills knowledge system?
//
// The `huu Knowledge System` pipeline answers this question INSIDE a prompt
// (its step 1 tells the agent to shell out and look for
// `.agents/skills/catalog.md` / a router SKILL.md). Dev mode needs the same
// answer BEFORE any agent runs, so it can decide whether to spend a whole
// bootstrap run on it. This module is that probe, kept deliberately in the
// same spirit as `project-digest.ts`: synchronous, bounded, best-effort, and
// silent on every filesystem error — a probe must never take a run down.
//
// Detection order mirrors the pipeline's own rules so the two can never
// disagree about what "already configured" means:
//   1. `.agents/skills/catalog.md`      → the canonical routing surface
//   2. a `.agents/skills/*/SKILL.md` that IS a router (frontmatter
//      `type: router`, or the conventional names)
//   3. any `.agents/skills/*/SKILL.md`  → skills exist but no routing surface
//   4. the same three probes under `.claude/skills/`
// Nothing found ⇒ absent, and dev mode bootstraps.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Skill trees huu recognizes, in priority order. `.agents/` is canonical. */
const SKILL_ROOTS = ['.agents/skills', '.claude/skills'] as const;

/** Directory names conventionally used for the routing skill. */
const ROUTER_NAMES = ['project-router', 'project-knowledge'] as const;

/** Bound on how many skill directories we stat — a probe, not a crawler. */
const MAX_SKILL_DIRS = 200;

/** Only the frontmatter block is read; skill bodies can be long. */
const MAX_FRONTMATTER_CHARS = 2000;

export type KnowledgeSurface = 'agents' | 'claude';

export interface KnowledgeStatus {
  /**
   * True when the repo has a knowledge system dev mode can route through.
   * Requires BOTH at least one skill and a routing surface (catalog or
   * router skill) — loose skills with nothing to route them are treated as
   * absent, because the dev planner has no entry point into them.
   */
  present: boolean;
  /** Which tree the skills live in; undefined when none was found. */
  surface?: KnowledgeSurface;
  /** Repo-relative path of the routing catalog, when one exists. */
  catalogPath?: string;
  /** Directory name of the router skill, when one was identified. */
  routerSkill?: string;
  /** How many skill directories carry a SKILL.md. */
  skillCount: number;
  /** Skill directory names, sorted; capped at {@link MAX_SKILL_DIRS}. */
  skills: string[];
  /**
   * What the bootstrap run should do when it runs: 'create' from scratch, or
   * 'extend' an existing surface. Matches the vocabulary the Knowledge System
   * pipeline writes into `.huu/knowledge/system.json`.
   */
  bootstrapMode: 'create' | 'extend';
  /** One human-readable line explaining the verdict. Always populated. */
  reason: string;
}

function safeReaddir(path: string): string[] {
  try {
    if (!existsSync(path)) return [];
    return readdirSync(path);
  } catch {
    return [];
  }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/**
 * Reads the leading YAML frontmatter of a SKILL.md as raw text. Returns an
 * empty string when the file is unreadable or carries no frontmatter — the
 * caller only pattern-matches, so a miss degrades to "not a router".
 */
function readFrontmatter(path: string): string {
  try {
    const raw = readFileSync(path, 'utf8').slice(0, MAX_FRONTMATTER_CHARS);
    if (!raw.startsWith('---')) return '';
    const end = raw.indexOf('\n---', 3);
    return end === -1 ? raw : raw.slice(0, end);
  } catch {
    return '';
  }
}

/**
 * True when a SKILL.md declares itself the routing surface. Accepts the
 * frontmatter form the huu skills use (`metadata.type: router`, i.e. a
 * `type: router` line anywhere in the block) — the conventional directory
 * names are checked separately by the caller.
 */
export function isRouterFrontmatter(frontmatter: string): boolean {
  return /^\s*type:\s*["']?router["']?\s*$/m.test(frontmatter);
}

function probeRoot(repoRoot: string, root: string): Omit<KnowledgeStatus, 'reason'> | null {
  const rootAbs = join(repoRoot, root);
  if (!isDirectory(rootAbs)) return null;

  const surface: KnowledgeSurface = root.startsWith('.agents') ? 'agents' : 'claude';

  const skills: string[] = [];
  let routerSkill: string | undefined;
  for (const entry of safeReaddir(rootAbs).sort()) {
    if (skills.length >= MAX_SKILL_DIRS) break;
    const skillMd = join(rootAbs, entry, 'SKILL.md');
    // A per-skill symlink (`.claude/skills/` mirrors `.agents/skills/`)
    // resolves through statSync, so both trees probe identically.
    if (!isFile(skillMd)) continue;
    skills.push(entry);
    if (routerSkill === undefined) {
      if ((ROUTER_NAMES as readonly string[]).includes(entry) || isRouterFrontmatter(readFrontmatter(skillMd))) {
        routerSkill = entry;
      }
    }
  }

  const catalogAbs = join(rootAbs, 'catalog.md');
  const catalogPath = isFile(catalogAbs) ? `${root}/catalog.md` : undefined;

  if (skills.length === 0 && catalogPath === undefined) return null;

  // A routing surface is what makes the knowledge REACHABLE. Skills with no
  // catalog and no router exist, but the dev planner would have no entry
  // point — treat that as "extend", not "present".
  const hasRouting = catalogPath !== undefined || routerSkill !== undefined;

  return {
    present: hasRouting && skills.length > 0,
    surface,
    catalogPath,
    routerSkill,
    skillCount: skills.length,
    skills,
    bootstrapMode: 'extend',
  };
}

/**
 * Probes `repoRoot` for an agent-skills knowledge system. Never throws.
 *
 * Dev mode calls this before its first epoch: `present: false` means the
 * bootstrap run (`huu Knowledge System`) is worth its cost, and
 * `bootstrapMode` tells that run whether it is creating a surface or
 * extending one that already exists.
 */
export function detectKnowledge(repoRoot: string): KnowledgeStatus {
  for (const root of SKILL_ROOTS) {
    const found = probeRoot(repoRoot, root);
    if (!found) continue;

    if (found.present) {
      const via = found.catalogPath ? `catalog \`${found.catalogPath}\`` : `router skill \`${found.routerSkill}\``;
      return { ...found, reason: `${found.skillCount} skill(s) under \`${root}/\` routed by ${via}` };
    }
    return {
      ...found,
      reason:
        found.skillCount > 0
          ? `${found.skillCount} skill(s) under \`${root}/\` but no catalog.md and no router skill — nothing to route through`
          : `\`${root}/catalog.md\` exists but no skill carries a SKILL.md`,
    };
  }

  return {
    present: false,
    skillCount: 0,
    skills: [],
    bootstrapMode: 'create',
    reason: `no skill tree found (looked for ${SKILL_ROOTS.map((r) => `\`${r}/\``).join(' and ')})`,
  };
}

/**
 * Consolidate `.changes/*.md` fragment files into CHANGELOG.md under
 * `## [Unreleased]`.  Fragments are sorted alphabetically by filename and
 * their sections (Added, Changed, Fixed, Removed) are merged in canonical
 * order.
 *
 * Usage:
 *   npx tsx scripts/changelog.ts           # consolidate
 *   npx tsx scripts/changelog.ts --check   # validate only (exit 0 ok, 1 fail)
 *   npx tsx scripts/changelog.ts --dry-run # print what would land
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const CHANGELOG_PATH = join(ROOT, "CHANGELOG.md");
const FRAGMENTS_DIR = join(ROOT, ".changes");

const VALID_SECTIONS = ["Added", "Changed", "Fixed", "Removed"] as const;
const SECTION_ORDER: Record<string, number> = Object.fromEntries(
  VALID_SECTIONS.map((s, i) => [s, i]),
);

interface Fragment {
  file: string;
  sections: Map<string, string[]>;
  errors: string[];
}

// ---------------------------------------------------------------------------
// Parse a single fragment file
// ---------------------------------------------------------------------------

function parseFragment(filePath: string, fileName: string): Fragment {
  const fragment: Fragment = { file: fileName, sections: new Map(), errors: [] };
  let content: string;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch {
    fragment.errors.push(`cannot read ${fileName}`);
    return fragment;
  }

  const lines = content.split("\n");
  let currentSection: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip blank lines
    if (trimmed === "") continue;

    const headingMatch = /^###\s+(Added|Changed|Fixed|Removed)\s*$/.exec(
      trimmed,
    );
    if (headingMatch) {
      currentSection = headingMatch[1];
      if (!fragment.sections.has(currentSection)) {
        fragment.sections.set(currentSection, []);
      }
      continue;
    }

    const bulletMatch = /^-\s+(.+)$/.exec(trimmed);
    if (bulletMatch) {
      if (currentSection === null) {
        fragment.errors.push(
          `${fileName}:${i + 1}: bullet outside any section`,
        );
      } else {
        fragment.sections.get(currentSection)!.push(bulletMatch[1]);
      }
      continue;
    }

    // Non-blank, non-heading, non-bullet line
    fragment.errors.push(
      `${fileName}:${i + 1}: unexpected line — expected '### Section' or '- item'`,
    );
  }

  if (fragment.sections.size === 0 && fragment.errors.length === 0) {
    fragment.errors.push(`${fileName}: no sections found`);
  }

  return fragment;
}

// ---------------------------------------------------------------------------
// Main logic
// ---------------------------------------------------------------------------

function readFragments(): Fragment[] {
  if (!existsSync(FRAGMENTS_DIR)) return [];

  const files = readdirSync(FRAGMENTS_DIR)
    .filter((f) => f.endsWith(".md") && f !== "README.md")
    .sort();

  return files.map((f) => parseFragment(join(FRAGMENTS_DIR, f), f));
}

/** Build the replacement text that goes under `## [Unreleased]`. */
function consolidate(fragments: Fragment[]): string {
  // Collect all entries per section, preserving fragment-file order (alpha).
  const bySection = new Map<string, string[]>();
  for (const sec of VALID_SECTIONS) bySection.set(sec, []);

  for (const frag of fragments) {
    for (const [sec, items] of frag.sections) {
      for (const item of items) {
        bySection.get(sec)!.push(item);
      }
    }
  }

  const out: string[] = [];
  for (const sec of VALID_SECTIONS) {
    const items = bySection.get(sec)!;
    if (items.length === 0) continue;
    out.push(`### ${sec}`);
    out.push("");
    for (const item of items) out.push(`- ${item}`);
    out.push("");
  }

  return out.join("\n").trimEnd() + "\n";
}

function replaceUnreleased(changelog: string, body: string): string {
  const lines = changelog.split("\n");

  // Find the `## [Unreleased]` heading
  const unreleasedIdx = lines.findIndex(
    (l) => l.trim() === "## [Unreleased]",
  );
  if (unreleasedIdx === -1) {
    throw new Error("CHANGELOG.md: `## [Unreleased]` section not found");
  }

  // Find the next `## [...]` heading
  const nextIdx = lines.findIndex(
    (l, i) => i > unreleasedIdx && /^##\s+\[.+?\]/.test(l.trim()),
  );
  if (nextIdx === -1) {
    throw new Error(
      "CHANGELOG.md: no next version heading after `## [Unreleased]`",
    );
  }

  // Replace everything between unreleased heading and next heading
  const before = lines.slice(0, unreleasedIdx + 1);
  const after = lines.slice(nextIdx);

  return [...before, "", body, ...after].join("\n");
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("-")));

if (flags.size > 1 || (flags.size === 1 && args.length > 1)) {
  console.error("Usage: npx tsx scripts/changelog.ts [--check|--dry-run]");
  process.exit(2);
}

const mode = flags.has("--check") ? "check" : flags.has("--dry-run") ? "dry" : "write";

const fragments = readFragments();

// --check: validate format, exit 0 ok / 1 fail
if (mode === "check") {
  let totalErrors = 0;
  for (const frag of fragments) {
    for (const err of frag.errors) {
      console.error(err);
      totalErrors++;
    }
  }
  if (totalErrors > 0) {
    console.error(`\n${totalErrors} error(s) in changelog fragments`);
    process.exit(1);
  }
  console.error(`OK — ${fragments.length} fragment(s) valid`);
  process.exit(0);
}

// Build the consolidated body
const body = consolidate(fragments);

if (mode === "dry") {
  console.log(`## [Unreleased]\n`);
  console.log(body);
  process.exit(0);
}

// mode === "write": update CHANGELOG.md
const changelog = readFileSync(CHANGELOG_PATH, "utf-8");
const updated = replaceUnreleased(changelog, body);
writeFileSync(CHANGELOG_PATH, updated);
console.error(
  `Consolidated ${fragments.length} fragment(s) into CHANGELOG.md`,
);

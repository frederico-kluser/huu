/**
 * Pre-flight reconnaissance catalog. Every "process" is a focused mission a
 * single agent can run against a static project digest, returning ≤6 short
 * bullets. The catalog is what the SELECTOR LLM picks from when deciding
 * which processes to fire for a given user intent — the model can either
 * cite a catalog id or request a fully custom mission via {title, prompt}.
 *
 * Each entry has:
 *   - id          stable key (used for matching + UI keying)
 *   - label       user-facing string in the recon UI
 *   - description one-liner shown to the selector LLM (drives its picks)
 *   - mission     verbatim body injected into the agent's system prompt
 *
 * Missions all follow the same contract: "LOOK ONLY at <block>" so each
 * agent stays in its lane and doesn't redo what another covers.
 */

export type ReconCatalogId =
  | 'stack'
  | 'structure'
  | 'libraries'
  | 'conventions'
  | 'entry-points'
  | 'test-strategy'
  | 'build-deploy'
  | 'domain-model'
  | 'external-integrations'
  | 'ui-surface'
  | 'cli-surface'
  | 'auth-security'
  | 'git-workflow'
  | 'quality-tooling'
  | 'pain-points';

export interface ReconCatalogEntry {
  id: ReconCatalogId;
  /** User-facing label rendered next to the spinner in the recon screen. */
  label: string;
  /** One-liner shown to the selector LLM so it knows what each process covers. */
  description: string;
  /** Mission statement injected verbatim into the agent's system prompt. */
  mission: string;
}

/** Uniform shape for a runnable recon mission — catalog entry OR custom item. */
export interface ReconRunItem {
  /** Stable tag for UI state keying. Catalog items use their id; customs use `custom:<n>`. */
  tag: string;
  /** UI display label. */
  label: string;
  /** Mission body for the agent's system prompt. */
  mission: string;
  /** Where this item came from. */
  source: 'catalog' | 'custom';
}

export const RECON_CATALOG: readonly ReconCatalogEntry[] = [
  {
    id: 'stack',
    label: 'Stack & tooling',
    description:
      'Primary language, target runtime, package manager and the available npm/yarn scripts.',
    mission:
      'LOOK ONLY at the `package.json` and `tsconfig.json` blocks of the digest. List: primary language, target runtime, package manager, and the available scripts (literal names, e.g. `npm run build`). Do NOT infer anything from the file tree or source code. If an item is not in the cited blocks, do not invent it.',
  },
  {
    id: 'structure',
    label: 'Structure & modules',
    description:
      'Top-level directories of src/ and any layered architecture documented in the project.',
    mission:
      'LOOK ONLY at the `## File tree` of the digest and list the TOP-LEVEL directories of `src/` (1 level, no recursion). If README/CLAUDE.md explicitly mentions a layered architecture, cite ONE sentence. Do NOT describe the contents of each module, do NOT infer responsibilities from names.',
  },
  {
    id: 'libraries',
    label: 'Key libraries',
    description:
      'Main runtime libraries (from package.json dependencies) and their roles.',
    mission:
      'LOOK ONLY at the `dependencies` object inside the `package.json` block (IGNORE `devDependencies`, IGNORE node_modules, IGNORE imports from source). List the 4-6 most obvious deps and assign each a short role (≤8 words) based ONLY on the package\'s well-known name. If you do not recognize a dep, write its name with "role not inferred".',
  },
  {
    id: 'conventions',
    label: 'Conventions & rules',
    description:
      'Explicit commit, test, lint and process rules documented in README/CLAUDE.md/AGENTS.md.',
    mission:
      'LOOK ONLY at the `README.md`, `CLAUDE.md` and `AGENTS.md` blocks of the digest. Extract EXPLICIT rules already written (commit, tests, agents docs, lint). Cite short literal phrases when possible. Do NOT read code, do NOT infer conventions from file names.',
  },
  {
    id: 'entry-points',
    label: 'Entry points',
    description:
      'package.json bin/main/exports + cli/index/app files at the src/ root.',
    mission:
      'LOOK ONLY at the `bin`, `main`, `module`, `exports` fields of the `package.json` AND at the `## File tree` for files like `cli.*`, `index.*`, `app.*` at the root of `src/`. List each entry point and its relative path. If no entry point is explicit, return ONE bullet "no entry point declared in package.json/file tree".',
  },
  {
    id: 'test-strategy',
    label: 'Test strategy',
    description:
      'Test framework, location (co-located vs separate) and the execution command.',
    mission:
      'LOOK ONLY at the `package.json` (devDependencies for frameworks like `vitest`, `jest`, `mocha`, `playwright`, `cypress` + scripts whose name contains `test`) AND at the `## File tree` for patterns like `*.test.*`, `*.spec.*`, `tests/`, `__tests__/`. Report: framework used, location (co-located vs separate directory), and the literal execution command. Do NOT read test code.',
  },
  {
    id: 'build-deploy',
    label: 'Build & deploy',
    description:
      'Build, release and deploy scripts and procedures (including Docker when present).',
    mission:
      'LOOK ONLY at the `package.json` scripts whose name contains `build`, `release`, `deploy`, `bundle`, `dist`, `compile` AND at `README.md`/`CLAUDE.md` for release/deploy instructions. Cite LITERAL scripts and procedures. Mention `Dockerfile`, `compose.yaml` or similar ONLY if they appear in the file tree. Do NOT infer CI pipelines from isolated file names.',
  },
  {
    id: 'domain-model',
    label: 'Domain model',
    description:
      'Core types, entities and contracts (contracts/, models/, types/, domain/, entities/).',
    mission:
      'LOOK ONLY at the `## File tree` for directories `contracts/`, `models/`, `types/`, `domain/`, `entities/`, `schema*` inside `src/` and list the visible files (1 bullet per directory with up to 3 files each). If none of those directories exist, return ONE bullet "no dedicated domain directory under src/". Do NOT read source code, do NOT invent entities.',
  },
  {
    id: 'external-integrations',
    label: 'External integrations',
    description:
      'SDKs and clients for external services: HTTP APIs, databases, message brokers, LLMs.',
    mission:
      'LOOK ONLY at the `dependencies` of `package.json` for API SDKs (axios, got, ofetch, openai, anthropic, langchain, stripe, twilio, etc.), databases (pg, mysql2, mongodb, redis, sqlite), brokers (kafka, amqplib, nats), or storage (aws-sdk, @google-cloud/*) AND EXPLICIT mentions of external services in README/CLAUDE.md. List each integration in ONE bullet (name + role). If nothing is evident, return ONE bullet "no external integrations detected".',
  },
  {
    id: 'ui-surface',
    label: 'UI surface',
    description:
      'UI framework (web or TUI), component/screen directories and routing pattern.',
    mission:
      'LOOK ONLY at the `dependencies` for UI frameworks (`react`, `vue`, `svelte`, `solid-js`, `ink`, `htmx`, `next`, `nuxt`, `astro`, `remix`) AND at the `## File tree` for directories `ui/`, `components/`, `screens/`, `views/`, `pages/`, `routes/` inside `src/`. List the detected framework, visible top-level UI dirs, and the routing pattern if evident. If the project has no apparent UI, return ONE bullet "no UI framework detected".',
  },
  {
    id: 'cli-surface',
    label: 'CLI surface',
    description:
      'Commands, flags and subcommands of the CLI (if the project is a CLI).',
    mission:
      'LOOK ONLY at the `bin` field of `package.json` AND at the `dependencies` for CLI libs (`commander`, `yargs`, `oclif`, `meow`, `cac`, `ink`) AND any README.md block describing flags/subcommands. List top-level commands and key flags WITH literal quotation when possible. If the project is not a CLI, return ONE bullet "no clear evidence in package.json bin/deps".',
  },
  {
    id: 'auth-security',
    label: 'Auth & secrets',
    description:
      'Authentication, secret management and credential handling.',
    mission:
      'LOOK ONLY at the `dependencies` for auth libs (`jsonwebtoken`, `passport*`, `oauth*`, `bcrypt*`, `argon2`, `firebase-auth`, `next-auth`, `lucia`) AND EXPLICIT mentions in README/CLAUDE.md of credentials, secrets, API keys, or sensitive environment variables. List concrete signals in up to 4 bullets. If nothing is evident, return ONE bullet "no clear evidence in deps/docs".',
  },
  {
    id: 'git-workflow',
    label: 'Git workflow',
    description:
      'Documented git rules: branch naming, commit style, hooks, tag policy.',
    mission:
      'LOOK ONLY at the `README.md`, `CLAUDE.md`, `AGENTS.md` blocks for EXPLICIT git rules: branch naming, commit style (Conventional Commits etc.), hooks (`.githooks`, husky), tag policy, force-push rules, release flow. Cite literal phrases when possible. Do NOT infer rules from the file tree.',
  },
  {
    id: 'quality-tooling',
    label: 'Quality & tooling',
    description:
      'Linting, formatting, type-checking, hooks and CI/CD.',
    mission:
      'LOOK ONLY at the `package.json` for quality-related devDependencies (`eslint*`, `prettier`, `biome`, `typescript`, `husky`, `lint-staged`) and scripts whose name contains `lint`, `format`, `typecheck`, `check`. Mention CI ONLY if README/CLAUDE.md cites it explicitly. List the tooling + literal command for each.',
  },
  {
    id: 'pain-points',
    label: 'Pain points',
    description:
      'Known limitations, TODOs, roadmap items and documented technical debt.',
    mission:
      'LOOK ONLY at the `## File tree` for files like `TODO.md`, `ROADMAP.md`, `*roadmap*`, `hardening*`, `CHANGELOG.md` AND any `README.md`/`CLAUDE.md` block with "limitations", "TODO", "future improvements", or "known issues" sections. List concrete signals (file name OR short citation). If nothing is evident, return ONE bullet "no documented pain points".',
  },
];

/** @deprecated kept for backwards compatibility — prefer `RECON_CATALOG`. */
export const RECON_AGENTS = RECON_CATALOG;
/** @deprecated alias of `ReconCatalogEntry`. */
export type ReconAgent = ReconCatalogEntry;
/** @deprecated alias of `ReconCatalogId`. */
export type ReconAgentId = ReconCatalogId;

/**
 * Builds the system prompt fed to a single recon agent. Works for both
 * catalog entries (where `id` is a stable key) and custom items (where `id`
 * is the synthesized tag, e.g. "custom:0"). The mission body is the only
 * content that varies between agents — everything else (output format,
 * language, guardrails) stays constant.
 */
export function buildReconSystemPrompt(
  item: { id?: string; tag?: string; mission: string },
  projectName?: string,
): string {
  const projectRef = projectName ? ` "${projectName}"` : '';
  const idForHeader = item.id ?? item.tag ?? 'recon';
  return `You are a FAST reconnaissance agent named "${idForHeader}". Your single mission:

${item.mission}

Mode of operation: FOCUSED SWEEP. You receive ONE ready-made digest of the project${projectRef} below (truncated file tree, package.json, README, CLAUDE.md, AGENTS.md, tsconfig). There are NO tools, NO filesystem, NO node_modules to explore — the digest is everything that exists and everything you need. Think briefly, then get to the point.

# How to work

- Read the blocks cited by your mission carefully and extract verifiable facts. You may reason internally, but be concise in the output.
- Use ONLY the blocks cited by the mission. The other blocks of the digest exist as context, but do not ground bullets in them.
- If there really is no clear evidence for the mission, write ONE bullet "no clear evidence in <block>" and stop — do not invent.
- Plain English, direct. No empty adjectives ("robust", "modern", "complete").

# Output format (mandatory)

Return structured JSON:
{
  "bullets": [
    "<bullet 1 — concrete fact, ≤ 220 chars>",
    "<bullet 2 — concrete fact, ≤ 220 chars>",
    ...
  ]
}

# Rules

- Minimum 2, maximum 6 bullets.
- Each bullet ≤ 220 characters.
- Each bullet is a citable FACT — script, dep, top-level dir, doc phrase. No opinions, no empty synthesis, no "probably".
- Do NOT repeat the mission text as a bullet.
- Do NOT make assumptions about what the user wants to do — only list what exists in the digest.
- Do NOT add preamble, Do NOT add comments outside the JSON, Do NOT ask for more context.`;
}

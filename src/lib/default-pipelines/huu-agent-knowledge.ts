// Agent-Knowledge pipeline. Studies the project progressively (recon →
// per-file deep study → topic synthesis) and MATERIALIZES the accumulated
// knowledge as Agent Skills under `.agents/skills/` — one skill per topic
// plus a central router skill any future agent loads first. This is a
// SETUP pipeline (like huu Test Suite), not an audit: it mutates the repo
// by design (`.agents/skills/**`, `.huu/knowledge/**`, and at most one
// `.gitignore` adjustment so the knowledge base survives the merge).
//
// Skill format follows the Agent Skills spec (https://agentskills.io):
// SKILL.md with YAML frontmatter `name` (1-64 chars, ^[a-z0-9]+(-[a-z0-9]+)*$,
// equal to the parent directory) + `description` (1-1024 chars, what + when),
// body < 500 lines, overflow in references/ one level deep.
//
// IMPORTANT: keep this file pure (no fs / no env). Imported on the hot path
// of `App` mount via the default-pipelines registry.

import type { Pipeline } from '../types.js';

export const DEFAULT_PIPELINE_FILENAME = 'huu-agent-knowledge.pipeline.json';
export const DEFAULT_PIPELINE_NAME = 'huu Agent Knowledge';

const STEP1_PROMPT = `You are huu's agent-knowledge recon agent. Goal: map the project end-to-end, scaffold \`.huu/knowledge/atlas.md\`, and initialize \`.huu/knowledge/findings.json\` — the progressive knowledge base that the WHOLE pipeline accumulates into and that later steps compile into Agent Skills under \`.agents/skills/\`.

=== STEP 0 — PERSISTENCE CHECK (do this first) ===
The knowledge base must survive the stage merge, so it cannot be gitignored.
Run: \`git check-ignore -q .huu/knowledge && echo IGNORED || echo OK\`
If IGNORED: the committed \`.gitignore\` excludes \`.huu/\`. Apply the MINIMAL rewrite — replace the line \`.huu/\` (or \`.huu\`) with \`.huu/*\` and add \`!.huu/knowledge/\` on the next line. Git cannot re-include below an excluded DIRECTORY, but \`.huu/*\` only excludes the entries, so the negation works. Touch nothing else in \`.gitignore\`. If OK: leave \`.gitignore\` alone.

=== STEP 1 — Detect identity and stack ===
Inspect manifests and entry points (package.json, pyproject.toml, go.mod, Cargo.toml, pom.xml, *.csproj, Gemfile, Makefile, Dockerfile, CI configs):
- What IS this project (one paragraph a new contributor would understand)?
- Language(s), framework(s), runtime version constraints.
- The exact build / run / test / lint commands (verify them empirically when cheap — e.g. read the scripts block; do NOT run long builds).

=== STEP 2 — Map the modules ===
Walk the source tree (ignore node_modules, dist, build, out, coverage, .git, vendor, target, __pycache__):
- Top-level modules/packages and the one-line responsibility of each.
- Entry points (CLI binaries, servers, exported APIs).
- Dependency direction between layers (who may import whom).
- Naming conventions, file-organization conventions, lint/format rules in force.
- Domain vocabulary: project-specific terms a newcomer must learn (glossary candidates).

=== STEP 3 — Write .huu/knowledge/atlas.md ===
Create the directory first: \`mkdir -p .huu/knowledge\`. Required scaffold (English, concise):

# .huu/knowledge/atlas.md — Project atlas

> Built by huu's Agent Knowledge pipeline. Raw knowledge base — compiled into \`.agents/skills/\` by the later steps.

## 1. Identity
<what the project is, who it serves, how it's shipped>

## 2. Stack & commands
- Language/runtime: <...>
- Build: \`<cmd>\` · Run: \`<cmd>\` · Test: \`<cmd>\` · Lint: \`<cmd>\`

## 3. Module map
| Module/dir | Responsibility | Key files |
|---|---|---|

## 4. Conventions
<naming, imports, error handling, layering rules — as observed, with file evidence>

## 5. Glossary
| Term | Meaning |
|---|---|

## 6. Topic plan
(filled in by step 3 of the pipeline)

## 7. Open questions
<things you could not determine — later steps may resolve them>

=== STEP 4 — Initialize .huu/knowledge/findings.json ===
Path: \`./.huu/knowledge/findings.json\`.
If absent: write \`[]\` + trailing newline. If present and a valid JSON array: leave untouched. If corrupted: replace with \`[]\` and note it in the log.

Schema per entry (this is the contract for the WHOLE pipeline):
\`\`\`json
{ "path": "<source file or null for project-level facts>", "summary": "<=256 chars, one sentence", "knowledge": "<=5000 chars: the full fact — context, evidence, file paths, line refs>", "kind": "architecture|convention|workflow|api|gotcha|domain", "topics": ["<candidate-topic-slug, lowercase-hyphen>"], "confidence": "high|medium|low" }
\`\`\`

Seed it with 5–10 project-level findings (path: null) covering: identity, build/test workflow, layering rule, the strongest conventions, and the most surprising gotcha you hit during recon.

=== HARD RULES ===
- Allowed writes: \`.huu/knowledge/**\` + the single \`.gitignore\` adjustment from STEP 0. NOTHING else.
- DO NOT create \`.agents/skills/\` yet — that's step 4's job, after the knowledge has accumulated.
- Be language-agnostic — do not assume Node.js.
- Every claim in atlas.md must carry file evidence (a path a reader can open).`;

const STEP2_PROMPT = `You are at step 2 — deep-study of ONE source file: \`$file\`. Goal: extract the knowledge in this file that a FUTURE coding agent would need, and append it to the shared knowledge base.

=== STEP 0 — SKIP RULE ===
SKIP IMMEDIATELY (no findings, no append) if \`$file\` matches: \`node_modules/\`, \`dist/\`, \`build/\`, \`out/\`, \`coverage/\`, \`.git/\`, \`vendor/\`, \`target/\`, \`__pycache__/\`, \`*.generated.*\`, \`*.min.js\`, \`*.min.css\`, \`*.d.ts\`, \`*.lock\`, \`*.snap\`.
Note the pipeline caps total nodes at \`maxNodeExecutions: 50\` — on a large repo, select the 30–40 files that carry the architecture (entry points, core modules, the files everything imports), not leaf utilities.

=== STEP 1 — REQUIRED reads BEFORE any analysis ===
a) \`.huu/knowledge/atlas.md\` — where \`$file\` sits in the module map.
b) \`.huu/knowledge/findings.json\` — what other agents (running in PARALLEL with you) already discovered. Use it; do not re-derive solved facts.
If either is missing: abort with a clear error — step 1 of the pipeline is a prerequisite.

=== STEP 2 — Study \`$file\` ===
Answer, with evidence:
- PURPOSE: why does this file exist? What breaks if it's deleted?
- PUBLIC SURFACE: exported functions/classes/types and their contracts (inputs, outputs, errors).
- PATTERNS & INVARIANTS: conventions it follows or establishes (state machines, immutability rules, ordering guarantees, locking, retries).
- RELATIONSHIPS: what it imports, what imports it, which layer it belongs to.
- GOTCHAS: anything surprising — implicit coupling, magic values, ordering requirements, footguns a future agent could trip on. These are the HIGHEST-value findings.

=== STEP 3 — APPEND 1–3 findings to .huu/knowledge/findings.json ===
Quality bar: a finding must teach something NON-OBVIOUS (the kind of thing you only learn by reading the code). Do not pad; if \`$file\` is genuinely trivial, append nothing.
Append protocol (other agents run in parallel):
1. RE-READ \`.huu/knowledge/findings.json\` immediately before writing.
2. Append entries following the schema in the file's contract (path = "$file", kind, topics as lowercase-hyphen slugs, confidence).
3. DO NOT duplicate: if a semantically equivalent summary already exists, skip it.
4. Never rewrite or delete existing entries — append-only.
5. Re-validate: the file must remain a single valid JSON array.

=== HARD RULES ===
- ONLY analyze \`$file\` (reading its direct imports for context is fine).
- The ONLY write allowed in this step is the append to \`.huu/knowledge/findings.json\`.
- DO NOT modify \`$file\`, the atlas, or anything under \`.agents/\`.`;

const STEP3_PROMPT = `You are at step 3 — topic synthesis. Goal: cluster everything in \`.huu/knowledge/findings.json\` into 5–8 knowledge topics and write the skill plan that step 4 will materialize.

=== STEP 1 — Read the whole knowledge base ===
- \`.huu/knowledge/atlas.md\` (all sections).
- \`.huu/knowledge/findings.json\` (every entry — project-level and per-file).
If either is missing: abort with a clear error.

=== STEP 2 — Cluster into 5–8 topics ===
Group findings by the knowledge a future agent would load TOGETHER. Strong default topics (adapt to the project):
- architecture (module map, layering, dependency rules)
- conventions (naming, style, error handling, file organization)
- build-and-test (exact commands, CI expectations, how to verify a change)
- domain (glossary + business rules)
- gotchas (the surprises — highest value per token)
Plus 0–3 project-specific topics where findings cluster naturally (e.g. a protocol, a state machine, a plugin system).

Constraints per topic:
- \`name\`: 1–64 chars, MUST match \`^[a-z0-9]+(-[a-z0-9]+)*$\` (lowercase alphanumerics + single hyphens; no leading/trailing/double hyphen).
- \`description\` draft: 1–1024 chars stating WHAT the skill covers and WHEN an agent should load it, with concrete trigger keywords.
- Coverage: >= 90% of findings must map to at least one topic. List the orphans explicitly.

=== STEP 3 — Write .huu/knowledge/topics.json ===
\`\`\`json
{
  "topics": [
    { "name": "<slug>", "description": "<draft what+when>", "files": ["<key source paths>"], "keyFindings": ["<summary of each finding folded into this topic>"] }
  ],
  "router": { "name": "project-knowledge" },
  "orphans": ["<summaries of findings left out, if any>"]
}
\`\`\`

=== STEP 4 — Update atlas.md section "6. Topic plan" ===
Replace the placeholder with a table: | Topic | Findings folded | Key files | one-line scope |. Update ONLY section 6.

=== HARD RULES ===
- Allowed writes: \`.huu/knowledge/topics.json\` + section 6 of \`.huu/knowledge/atlas.md\`.
- DO NOT create \`.agents/skills/\` yet.
- Topic names will become directory names verbatim — validate the regex NOW, not in step 4.`;

const STEP4_PROMPT = `You are at step 4 — materialize the Agent Skills. Goal: compile the knowledge base into \`.agents/skills/<topic>/SKILL.md\` files (one per topic in \`.huu/knowledge/topics.json\`) plus the central router skill \`.agents/skills/project-knowledge/SKILL.md\`, following the Agent Skills spec (https://agentskills.io).

NOTE: a validation step runs after you and may send the pipeline BACK here with feedback in its verdict. If \`.agents/skills/\` already contains skills from a previous iteration of this run, FIX them in place instead of starting over.

=== STEP 1 — Read the plan ===
- \`.huu/knowledge/topics.json\` (the topic list — your work order).
- \`.huu/knowledge/findings.json\` + \`.huu/knowledge/atlas.md\` (the source material).
If topics.json is missing: abort with a clear error.

=== STEP 2 — Spec constraints (apply to EVERY skill you write) ===
- Frontmatter \`name\`: MUST equal the parent directory name; 1–64 chars; \`^[a-z0-9]+(-[a-z0-9]+)*$\`.
- Frontmatter \`description\`: 1–1024 chars; states WHAT the skill does AND WHEN to load it; includes the trigger keywords an agent would think of.
- Body: < 500 lines (target < 5000 tokens). Move overflow to \`references/<topic-detail>.md\` inside the skill directory and link it from the body — references stay ONE level deep.
- Body structure (adapt as needed): ## Scope · ## Key files (paths a reader can open) · ## How things work (the distilled findings) · ## Boundaries (Do / Don't) · ## Gotchas.
- Every fact must be traceable: keep the concrete file paths from the findings. No generic filler an LLM could have written without reading this repo.

=== STEP 3 — Write one skill per topic ===
For each entry in topics.json: \`mkdir -p .agents/skills/<name>\` then write \`.agents/skills/<name>/SKILL.md\`:

---
name: <name — identical to the directory>
description: <refined from the draft: what + when + keywords>
---

<body per STEP 2, compiled from this topic's keyFindings + the relevant atlas sections>

=== STEP 4 — Write the central router skill ===
Path: \`.agents/skills/project-knowledge/SKILL.md\`. This is the skill every future agent should load FIRST — its description must make that irresistible and its body must route to the right topic skill. Frontmatter description (substitute the topic list):

"Master index of generated knowledge for this repository. Load this FIRST for any task in this codebase — implementing features, fixing bugs, refactoring, writing tests, reviewing code, or answering questions about architecture, conventions, build, or domain logic. It routes you to the right topic skill: <topic-1>, <topic-2>, <...>. Do not use for questions unrelated to this repository."

Body structure:
1. One-paragraph project identity (from atlas section 1).
2. The routing table — this is the heart of the router:
   | Skill | Scope (one line) | Load when... | Key paths |
   |---|---|---|---|
3. The 3–5 facts EVERY agent needs regardless of task (build/test commands, the one layering rule, the top gotcha).
4. Instruction: "Open exactly the topic skill(s) whose 'Load when' matches your task; do not load all of them."
Router constraints: same frontmatter rules; the routing table MUST list every topic skill generated in STEP 3 (no more, no less).

=== STEP 5 — Self-check before finishing ===
For each \`.agents/skills/*/SKILL.md\` you wrote: frontmatter parses as YAML; name == directory; name matches the regex; description length 1–1024; body < 500 lines; router table covers all topics. Fix anything that fails NOW — a judge will verify after you.

=== HARD RULES ===
- Allowed writes: \`.agents/skills/**\` only. Do NOT touch \`.huu/knowledge/**\` (read-only here), production source, or manifests.
- Do NOT overwrite skills that existed BEFORE this run (e.g. hand-written ones) — only create/update the directories named in topics.json + \`project-knowledge\`.
- No secrets in skill bodies: if a finding contains tokens/credentials, redact to \`<redacted>\`.`;

const CHECK_CONDITION = `Inspect every skill directory that this run generated (the ones named in .huu/knowledge/topics.json plus project-knowledge) under .agents/skills/. The skills are VALID when ALL hold: (1) each directory contains a SKILL.md whose YAML frontmatter parses and has exactly the required fields name and description (optional fields allowed); (2) each frontmatter name is identical to its parent directory name, is 1-64 chars, and matches ^[a-z0-9]+(-[a-z0-9]+)*$; (3) each description is 1-1024 chars and states both what the skill covers and when to load it; (4) each SKILL.md body is under 500 lines, and any referenced files exist inside the skill directory; (5) .agents/skills/project-knowledge/SKILL.md exists and its routing table lists every generated topic skill exactly once. If $runs >= 3, lean approved unless a skill is structurally broken (unparseable frontmatter or name/directory mismatch). Emit "approved" if valid, "rework" if not — and when emitting rework, spell out per-skill exactly what failed so the materialize step can fix it.`;

const STEP6_PROMPT = `You are the final agent — step 6. Goal: seal the knowledge base and leave a self-explanatory trail.

=== STEP 1 — Final router-coverage pass ===
List the topic skills generated by this run (from \`.huu/knowledge/topics.json\`) and re-read \`.agents/skills/project-knowledge/SKILL.md\`. If any generated topic skill is missing from the routing table (or a listed one doesn't exist), fix the ROUTER (table only — do not rewrite topic skills here).

=== STEP 2 — Seal .huu/knowledge/atlas.md ===
Append a final section:

## 8. Generated skills
- Skills written by this run: <table: skill name → one-line scope → path>
- Findings folded: <N total, N orphaned>
- How to regenerate: re-run the "huu Agent Knowledge" pipeline; findings.json is append-only across runs, so knowledge accumulates.

=== STEP 3 — Inventory to the log ===
Print to the log: every path written under \`.agents/skills/\` this run, total skills, total findings, and the router description (so the run log shows what future agents will see).

=== HARD RULES ===
- Allowed writes: \`.agents/skills/project-knowledge/SKILL.md\` (router fixes only) + \`.huu/knowledge/atlas.md\` (append section 8 only).
- \`.huu/knowledge/\` stays in the repo on purpose — it is the raw, append-only knowledge base that future runs extend; the skills are its compiled form.
- DO NOT touch production source, manifests, or other docs.`;

export function getDefaultPipeline(): Pipeline {
  return {
    name: DEFAULT_PIPELINE_NAME,
    maxRetries: 1,
    maxNodeExecutions: 50,
    steps: [
      {
        type: 'work',
        name: '1. Recon: project atlas + knowledge base',
        prompt: STEP1_PROMPT,
        files: [],
        scope: 'project',
      },
      {
        type: 'work',
        name: '2. Deep-study $file into findings',
        prompt: STEP2_PROMPT,
        files: [],
        scope: 'per-file',
      },
      {
        type: 'work',
        name: '3. Synthesize topic plan',
        prompt: STEP3_PROMPT,
        files: [],
        scope: 'project',
      },
      {
        type: 'work',
        name: '4. Materialize .agents/skills/',
        prompt: STEP4_PROMPT,
        files: [],
        scope: 'project',
      },
      {
        type: 'check',
        name: '5. Validate generated skills',
        condition: CHECK_CONDITION,
        maxRuns: 3,
        outcomes: [
          // `approved` is the default ON PURPOSE: judge failures (and the
          // --stub backend, which always picks the default) terminate the
          // loop instead of burning rework iterations.
          { label: 'approved', nextStepName: '6. Finalize knowledge base', default: true },
          { label: 'rework', nextStepName: '4. Materialize .agents/skills/' },
        ],
      },
      {
        type: 'work',
        name: '6. Finalize knowledge base',
        prompt: STEP6_PROMPT,
        files: [],
        scope: 'project',
      },
    ],
  } as Pipeline;
}

export function getDefaultPipelineFileContent(): string {
  return (
    JSON.stringify(
      {
        _format: 'huu-pipeline-v2',
        exportedAt: new Date().toISOString(),
        pipeline: getDefaultPipeline(),
      },
      null,
      2,
    ) + '\n'
  );
}

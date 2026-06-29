// Default test pipeline shipped with huu. The single source of truth lives
// here; `lib/pipeline-bootstrap.ts` materializes it into the user's repo at
// `pipelines/huu-test-suite.pipeline.json` on first run.
//
// FULLY AUTONOMOUS (v2): the file set is chosen by a recon step, not by the
// user. Step 2 selects the most test-worthy files and writes a huu-memory-v1
// list (`huu-tests-targets.json`); step 3 fans out one agent per entry via
// `scope: 'memory'`, each entry's hint riding `$hint`. No `per-file` picker,
// no "user-selected" stage. A CheckStep gate then loops cleanup until the
// suite is green (the never-rewind integration worktree accumulates commits).
//
// CODE-FROZEN (v3): the production tree is READ-ONLY. This pipeline ONLY
// writes tests + its own artifacts — it NEVER modifies application/library
// source for ANY reason, not even to "fix a bug a test exposed" (that is the
// dominant documented LLM test-gen failure mode: the agent cheats to green by
// editing the code under test). When a test reveals apparently-buggy
// behavior, the agent CHARACTERIZES it (pins the ACTUAL current behavior so
// the suite stays green and truthful — Feathers, "Working Effectively with
// Legacy Code") and FLAGS it as a suspected bug (rolled up into
// `huu-tests-findings.md`); for stacks with a real expected-failure mechanism
// it ALSO leaves a strict xfail-family marker that encodes the desired
// behavior and auto-detects the day the bug is fixed.
//
// Enforcement is layered (defense in depth), strongest first:
//   1. every mutating step opens with the frozen-tree allowlist + a SELF-CHECK
//      that reverts the agent's own stray edits;
//   2. the cleanup step ALWAYS runs once (after the per-file fan-out, BEFORE
//      the judge) and mechanically RESTORES modified/deleted source
//      (`git checkout $baseCommit -- <path>`) and REMOVES agent-added source
//      (`git rm -f <path>`) for any non-allowlisted path in
//      `git diff --name-status $baseCommit..HEAD`. This is the load-bearing
//      backstop and does not depend on the judge running;
//   3. the judge diffs `$baseCommit..HEAD` (fail-closed) and rejects
//      non-allowlisted changes + assertion-free / weak / self-mocked
//      "green by emptiness" tests.
// RESIDUAL (documented honestly): all three layers are executed by LLM agents,
// so the freeze is strongly defended but not yet a hard, non-LLM guarantee —
// the judge's forward-default can fall open (judge error / stub / maxRuns).
// A future orchestrator-level deterministic gate (a pipeline-declared
// protected-paths assertion run post-merge, outside any agent) would close the
// remaining gap; it is deliberately NOT bolted on here because a generic
// "what is a test file" allowlist is per-repo (step 1 discovers it) and a
// wrong cut would false-fail legitimate runs — worse than the layered defense.
//
// Test-quality grounding baked into the prompts:
// - Assertions that survive mutation testing (test behavior, not
//   implementation; no change-detector tests): Google Testing Blog +
//   https://testing.googleblog.com/2021/04/mutation-testing.html
// - Anti-flakiness rules (no sleeps, no network, frozen clocks, fixed
//   seeds, isolation): https://martinfowler.com/articles/nonDeterminism.html
// - Hermetic unit tests (Google "small" size: single process, no I/O):
//   https://abseil.io/resources/swe-book/html/ch11.html
// - Characterization / golden-master testing (pin current behavior, never
//   change the code under test): Michael Feathers, WELC.
// - Mutation tools (optional follow-up): https://stryker-mutator.io/
//
// IMPORTANT: keep this file pure (no fs / no env). It is imported on the
// hot path of `App` mount, before any side effects.

import type { Pipeline } from '../types.js';
import { targetsRecon } from './knowledge-protocol.js';

export const DEFAULT_PIPELINE_FILENAME = 'huu-test-suite.pipeline.json';
export const DEFAULT_PIPELINE_NAME = 'huu Test Suite';

// Repo-root memory file: the recon step (2) writes it, the fan-out step (3)
// consumes it, the finalize step (6) deletes it. Kept at the root (next to
// huu-tests.md / huu-tests-faq.json) so it survives the stage merge without a
// `.gitignore` adjustment — Test Suite's side-effect surface stays "root docs
// + README badge".
const TARGETS_PATH = 'huu-tests-targets.json';
const TARGETS_MAX_FILES = 12;

// The closed allowlist of paths this pipeline may write. Repeated verbatim at
// the top of every mutating step (and enforced by the judge) so the writable
// surface is a single source of truth — a small model reads it before the
// task, the judge enforces it as an enumeration. Everything else — all
// application/library source AND the manifest/config (outside the setup step)
// — is FROZEN. `setup` adds the one exception: step 1 may also wire the runner.
function frozenBanner(setup = false): string {
  const setupLine = setup
    ? '\nSETUP EXCEPTION (this step only): you may ALSO add test/dev-dependencies + a test/coverage script to an existing manifest (package.json / pyproject.toml / pom.xml / build.gradle / go.mod / Cargo.toml / *.csproj), write the test-runner config file, and the matching lockfile hunk — and nothing else in those files.'
    : '';
  return `=== CODE IS FROZEN — the rule that overrides every other instruction ===
PRODUCTION SOURCE IS READ-ONLY. You may CREATE or EDIT only these paths:
- test files (per the test convention in \`huu-tests.md\`) and local test helpers next to them;
- \`huu-tests.md\`, \`huu-tests-faq.json\`, \`huu-tests-findings.md\`, \`huu-tests-targets.json\`;
- the single README test-coverage badge LINE (\`img.shields.io/badge/tests-\`).
You may NEVER edit, add, or delete ANY other file — no application/library source, no runtime dependency, no entry point, no manifest, no config — for ANY reason, not even a one-line "obvious" fix. If a test cannot pass without changing source, the SOURCE stays untouched and you adjust the TEST or record a FINDING. Apparent bugs are sometimes relied on as features; changing them is out of scope. The cleanup step restores any drift against the run's base commit and a judge re-checks the diff, so a smuggled change cannot survive.${setupLine}`;
}

// One-line reminder of the per-stack expected-failure idiom. The FULL
// cheat-sheet is written into huu-tests.md by step 1; steps 3/4 reference it.
// CRITICAL: skip/disable/ignore run ZERO assertions, so they CANNOT track a
// bug — only the xfail family (which runs the desired-behavior assertion and
// flips red when the bug is fixed) may encode a known bug.
const MARKER_REMINDER = `Known-bug marker = the xfail-family idiom recorded in huu-tests.md (vitest \`test.fails\`, pytest \`@pytest.mark.xfail(strict=True, reason=...)\`, RSpec \`pending\`). On stacks with NO native xfail (Go, Rust, JUnit 5 → idiom NONE) you do NOT mark — you write a CHARACTERIZATION test only. NEVER use \`.skip\`/\`xit\`/\`test.todo\`/\`@Disabled\`/\`#[ignore]\`/\`t.Skip\` to encode a bug — they assert nothing and silently park the test.`;

const STEP1_PROMPT = `You are huu's test-bootstrap agent. Goal: leave the project with a working test runner, write \`huu-tests.md\` at the repo root, and initialize \`huu-tests-faq.json\` as an incremental knowledge base.

${frozenBanner(true)}
In a manifest you may ONLY add test/dev deps and a test/coverage script — never runtime deps, entry points, exports, or other fields. Touch ZERO application source. Auxiliary tools run ephemerally (\`npx --yes\`, \`pipx run\`), never added to the manifest.

=== STEP 1 — Detect the stack ===
Inspect the root and key sub-folders to identify the language and (if any) the already-configured test runner:
- Node.js / TypeScript / JavaScript: package.json, tsconfig.json, vitest.config.*, jest.config.*, *.test.*, *.spec.*.
- React/Vue/Svelte: package.json + framework deps, *.tsx/*.jsx.
- Python: pyproject.toml, setup.py, requirements*.txt, pytest.ini, conftest.py, test_*.py.
- Go: go.mod, *_test.go.
- Rust: Cargo.toml, #[cfg(test)] modules, tests/ folder.
- Ruby: Gemfile + rspec/minitest, *_spec.rb, test/test_*.rb.
- Java: pom.xml (Maven) or build.gradle (Gradle), src/test/java/**.
- .NET: *.csproj + xunit/nunit/mstest.

If the project is polyglot, pick the MAJORITY stack by source-file count and mention it in huu-tests.md.

=== STEP 2 — Ensure a working runner ===
If a runner is already configured: run a minimal test (create an ephemeral sample if needed) to confirm the infra responds. If the CONFIG is broken, fix the config (never the app source) until the sample passes.

If NO runner is configured: install the canonical default for the detected stack (NEVER pick an exotic runner):
- Plain Node: Vitest (npm i -D vitest; scripts: "test": "vitest run").
- React (Vite/Next/CRA): Vitest + @testing-library/react + jsdom.
- Python: pytest (pip install pytest, or pyproject [project.optional-dependencies]). Also set \`xfail_strict = true\` in the pytest config.
- Go: \`go test ./...\` (already in the toolchain).
- Rust: \`cargo test\` (already in cargo).
- Ruby: RSpec if the project already leans that way; otherwise Minitest.
- Java + Maven: JUnit 5 (Jupiter) + Mockito + maven-surefire >= 3.
- Java + Gradle: JUnit 5 + Mockito (test { useJUnitPlatform() }).
- .NET: xUnit (dotnet add package xunit).

Add the minimum config and discover the exact commands empirically.

=== STEP 3 — Write huu-tests.md AT THE ROOT ===
Path: ./huu-tests.md — fill every <placeholder> with the project's real values:

# huu-tests.md

## What this suite is
This suite CHARACTERIZES current behavior — its job is to detect future CHANGES, not to judge correctness. Tests assert what the code does TODAY. A passing test proves the code does X today; it does NOT prove X is correct. Source is READ-ONLY: suspected-incorrect behavior is recorded as a FINDING (see \`huu-tests-findings.md\`), never fixed by this suite.

## Stack
- Language: <detected>
- Runner: <chosen/detected> (1-line rationale)

## How to run the full test suite
\`\`\`bash
<exact command>
\`\`\`

## How to run a SINGLE test file
\`\`\`bash
<exact command with path placeholder>
\`\`\`
(CRITICAL — the following pipeline steps depend on this.)

## How to run a SINGLE test by name (if supported)
\`\`\`bash
<exact command or "not supported by this runner">
\`\`\`

## How to write tests in this project
- Naming/path convention: <e.g.: foo.ts -> foo.test.ts alongside; or tests/test_module.py>
- Helpers/mocks used: <list common imports or "none">
- Setup files / fixtures: <e.g.: vitest.config.ts setupFiles, conftest.py>
- What to avoid: <e.g.: real I/O, network, system time, global state>

## Known-bug marker for THIS runner (expectedFailureIdiom)
Record the EXACT idiom the per-file step uses to encode a desired-but-currently-broken behavior WITHOUT turning the suite red. Use the STRICT / auto-detecting form (flips red the day the bug is fixed). Skip/disable/ignore are NOT valid here — they run no assertion.
- expectedFailureIdiom: <one of the below for the detected runner>
  - Vitest/Jest: \`test.fails('desired: … (KNOWN BUG sb-<id>)', () => { /* assert the DESIRED value; stays green only while it still throws */ })\`
  - pytest: \`@pytest.mark.xfail(strict=True, reason="known bug sb-<id>: …")\`  (with \`xfail_strict = true\` in config)
  - RSpec: \`pending("known bug sb-<id>: …")\` then assert the desired value
  - Go / Rust / JUnit 5: NONE — no native xfail. Use a CHARACTERIZATION test only (assert ACTUAL output, comment \`// suspected-bug sb-<id> — desired: …\`). Do NOT use t.Skip / #[ignore] / @Disabled to track a bug.

## Determinism rules (every generated test MUST follow — banned tokens)
Derived from Fowler "Eradicating Non-Determinism in Tests" + Google's flaky taxonomy:
- NO \`sleep\` / \`Thread.sleep\` / \`time.sleep\` / \`setTimeout\`-as-wait — poll a condition with a bounded timeout or use the runner's fake clock.
- NO \`Date.now()\` / \`new Date()\` / \`Math.random()\` / \`random.random()\` without a fake timer or an explicit fixed seed in scope.
- Sort collections / use order-insensitive matchers before asserting — never depend on iteration order.
- Floats: assert with tolerance (\`toBeCloseTo\` / \`pytest.approx\` / \`InDelta\`), never \`==\`.
- Fresh fixtures + isolated tmp dirs per test; no order dependence; no shared mutable globals.
- No real network/disk/db — test doubles only. Unit tests are "small" (single process, hermetic).

## Assertion strength (so the tests actually catch bugs)
A test that passes no matter what the code does is worse than none. Per assertion ask: "would this fail if one operator in the function flipped (< → <=, + → -, true → false, a return → null/0)?" If not, strengthen it to a concrete literal value. Cover both branches with DIFFERENT expected outputs; assert error paths by the exact error type/message. No snapshot-only change-detector tests; no "it didn't throw" as the sole assertion. (Mutation testing measures this directly — see below.)

## Going beyond coverage (optional follow-up, not run by this pipeline)
Line coverage only proves code RAN, not that assertions would catch a bug. Mutation testing measures that directly:
- JS/TS: \`npm init stryker@latest\` then \`npx stryker run\` (https://stryker-mutator.io/)
- Python: \`mutmut run\` · JVM: PIT (https://pitest.org/)

## How to measure coverage
\`\`\`bash
<exact command — e.g.: npx vitest run --coverage; pytest --cov; go test -cover; cargo tarpaulin; mvn jacoco:report>
\`\`\`

## Accumulated FAQ
See \`huu-tests-faq.json\` — incremental knowledge base populated by the next steps. Item schema:
\`\`\`json
{ "summary": "string up to 256 chars", "knowledge": "string up to 5000 chars", "path": "<file the lesson came from — optional>", "category": "<free-form tag, e.g. 'mocking', 'run-summary' — optional>" }
\`\`\`
A SUSPECTED-BUG finding is a fixed-shape entry (all fields additive; older entries without them stay valid):
\`\`\`json
{ "category": "suspected-bug", "id": "sb-<file-slug>-<n>", "path": "<source file>", "test": "<name of the characterization test pinning ACTUAL behavior>", "actual": "<observed literal output>", "expected": "<what a correct impl would return>", "evidence": "<=1 line why it looks wrong" }
\`\`\`
The \`id\` is the join key linking the finding ↔ its expected-failure marker ↔ the finalize rollup.

=== STEP 4 — Initialize huu-tests-faq.json AT THE ROOT ===
Path: ./huu-tests-faq.json
If it does NOT exist: create it with the exact content \`[]\` (empty array + trailing newline).
If it EXISTS and is a valid JSON array: DO NOT touch it (preserve accumulated knowledge).
If it exists but is corrupted / not an array: replace with \`[]\` and mention it in the commit message.

=== HARD RULES ===
- DO NOT write tests for project files in this step — that's step 3's job.
- DO NOT modify application/library source. Writable surface = runner config/manifest (test deps + test script only) + huu-tests.md + huu-tests-faq.json.
- Ensure the documented "run the full test suite" command exits 0 (even if it's just the sample).`;

const STEP2_PROMPT = `${targetsRecon({
  role: "huu's test-target selector (step 2 of the test pipeline)",
  purpose: 'writing focused unit tests for',
  prefer: [
    'modules with real logic — transforms, validations, calculations, parsers, state machines, request/event handlers',
    'files with a clear public surface (several exported functions / classes / components) testable through that surface alone — the code is FROZEN, so a file that can only be tested by editing it to add a seam is a poor pick',
    'diversity across the run — a pure util, an I/O-abstractable module, a stateful/orchestrator file',
    'files a prior run did NOT already cover — read `huu-tests-faq.json` first and skip paths already recorded there',
  ],
  hintGuide:
    'name the public surface and the 1-2 behaviors / edge cases / error paths most worth asserting (what would a subtle bug break here?)',
  maxFiles: TARGETS_MAX_FILES,
})}

=== BEFORE YOU START ===
Read \`huu-tests.md\` (written by step 1) for the project's test conventions, and \`huu-tests-faq.json\` for what prior runs already tested. If \`huu-tests.md\` is missing, abort: step 1 is a prerequisite.`;

const STEP3_PROMPT = `You are at step 3 — write tests for ONE source file: \`$file\`. Goal: \`$file\` is covered by green, bug-catching tests AND every learning is propagated to \`huu-tests-faq.json\`. You are one of many agents running in parallel; your whole job is this single file.

${frozenBanner()}
WRITABLE HERE: ONLY the test file for \`$file\` (+ a local test helper) and \`huu-tests-faq.json\` (append-only) — nothing else, not the README badge, not the manifest, not findings.md (those belong to other steps).
${MARKER_REMINDER}

The recon step (2) chose this file deliberately and left you a lead — start from it: $hint

=== STEP 0 — SKIP RULE ===
SKIP IMMEDIATELY (no tests, no FAQ append) if \`$file\` matches: \`node_modules/\`, \`dist/\`, \`build/\`, \`out/\`, \`coverage/\`, \`.git/\`, \`vendor/\`, \`target/\`, \`__pycache__/\`, \`*.generated.*\`, \`*.min.js\`, \`*.min.css\`, \`*.d.ts\`, \`*.lock\`, \`*.snap\`.

=== STEP 1 — REQUIRED: read BEFORE any action ===
a) \`huu-tests.md\` (runner, commands, conventions, determinism rules, assertion strength, the expectedFailureIdiom for this runner).
b) \`huu-tests-faq.json\` (array of \`{ summary, knowledge, path?, category? }\` — the knowledge base parallel agents accumulate; use it to avoid repeating solved errors and to reuse suspected-bug \`id\`s on \`$file\`).
If either is missing: abort — steps 1 and 2 are prerequisites.

=== STEP 2 — Locate / create the test file for $file ===
Follow the convention in huu-tests.md (e.g. foo.ts→foo.test.ts; module.py→tests/test_module.py; Foo.java→src/test/java/<pkg>/FooTest.java; foo.go→foo_test.go).

=== STEP 3 — Write behavior tests for the EXISTING public surface ===
1. Read \`$file\`; identify the public surface (exports, functions, classes, components). If it already has tests, run them (single-file command) and ADD tests for uncovered branches/edge-cases/error-paths.
2. Test through the PUBLIC surface only. If \`$file\` cannot be reached without a seam, mock at the boundary YOU control (dependency injection, monkeypatch, module mock) — do NOT add exports, parameters, debug prints, or test seams to \`$file\`. A unit that is untestable as-is is a FINDING (record it in the FAQ), never a reason to edit source.
3. Cover: the main behavior of each public export; ≥1 edge case each (empty, null/undefined/None, boundary); the exact error each invalid input produces.
4. DETERMINISM + HERMETIC: mock external deps (network, fs, db, time, APIs); single process; obey huu-tests.md's banned-token determinism rules.

=== STEP 4 — When a test of the CORRECT behavior fails (code looks buggy) ===
GUARD: at most ~3 suspected-bug findings per file — if you'd need more, recon mis-picked \`$file\`: record ONE FAQ note and stop.
The code is FROZEN; you do NOT edit \`$file\`. Walk this decision (one branch applies):
- The failure came from a WRONG assumption in your test (a behavior the public contract never promised) → fix the TEST to the real contract. Done.
- \`$file\` genuinely produces output that looks wrong (a real bug) → CHARACTERIZE — ALWAYS do BOTH:
   b1. Run the function, observe the REAL output, assert THAT exact literal value (a green test pinning current behavior). Comment it: \`huu CHARACTERIZATION — pins ACTUAL (suspected-buggy) behavior; code frozen; FAQ id sb-<file-slug>-<n>\`.
   b2. APPEND the suspected-bug FAQ entry: \`{ "category":"suspected-bug", "id":"sb-<file-slug>-<n>", "path":"$file", "test":"<characterization test name>", "actual":"<observed literal>", "expected":"<correct value>", "evidence":"<=1 line>" }\`.
   THEN — only if this runner HAS an xfail idiom (vitest/pytest/RSpec) — ALSO add ONE expected-failure marker (the idiom from huu-tests.md) asserting the DESIRED value, titled with the SAME \`sb-<id>\`. On NONE-idiom runners (Go/Rust/JUnit5) do not add a marker — the characterization test is the record.
- Missing helper/mock → add it in the test file or a local helper.
ID RULE: \`sb-<file-slug>-<n>\` — pick the smallest \`<n>\` not already on this path in the FAQ. NEVER assert desired-but-false behavior as if it passed.
Up to 3 attempts to get a test deterministic/correct. If a test is just hard/flaky (NOT a suspected bug) and still fails after 3 tries, leave it failing with a \`TODO\` — cleanup converts bug-catchers to markers and removes the rest.

=== STEP 5 — SELF-CHECK before finishing ===
- MUTATION CHECK (no tools, just think): for each test, imagine ONE operator in \`$file\` flips (< → <=, + → -, true → false, a return → null/0/""). Would at least one assertion now FAIL? If not, strengthen it to a concrete literal.
- Did I change ANY file other than the test file (+ local helper) and \`huu-tests-faq.json\`? If yes — especially \`$file\` — REVERT it now. The code is frozen.
- Characterization tests hard-code the observed output as a LITERAL; they NEVER compute the expected value by calling the same production code, importing its constants, or re-deriving its formula.
- Is the unit-under-test itself un-mocked (only its dependencies are doubled)? Does every test assert a concrete value/effect (not just "no throw", not a bare snapshot)?
- Single-file command exits 0 (suspected bugs are pinned green and/or xfail-marked, never left red)?

=== HARD REQUIREMENTS ===
- The ONLY changes allowed: (a) the test file for \`$file\` (+ a small local test helper); (b) \`huu-tests-faq.json\` (append-only). NOTHING else — NOT \`$file\`, NOT global config, NOT the manifest.
- Single-file command for \`$file\` MUST exit 0 (except a genuinely unfixable flaky test — leave it failing with a TODO; cleanup converts bug-catchers to markers and removes the rest).
- NO \`.skip\`/\`xit\`/\`test.todo\`/\`@Disabled\`/\`#[ignore]\`/\`t.Skip\` used to encode a known bug — use the runner's xfail idiom, or characterization on NONE runners.
- DO NOT touch huu-tests.md.
This WHOLE pipeline is about UNIT tests. No integration, no e2e.`;

const STEP4_PROMPT = `You are the cleanup step. Goal: restore any source an agent drifted, leave the test suite green WITHOUT touching production code, collect coverage, and update the README badge. You ALWAYS run before the judge — your STEP 0 restore is the freeze's real guarantee, so do it carefully.

${frozenBanner()}
WRITABLE HERE: test files (convert/delete only failing BLOCKS), the README badge line, and \`huu-tests-faq.json\` — plus the STEP 0 restore of drifted source. Not the manifest, not application source (beyond restoring it).
${MARKER_REMINDER}

=== STEP 0 — RESTORE THE FROZEN TREE (do this FIRST, every visit) ===
A parallel agent may have drifted OR added a source file. This restore — not the judge — is the freeze's guarantee, so run it every time:
1. Run \`git diff --name-status $baseCommit..HEAD\`. (If \`$baseCommit\` renders empty — it never should; preflight guarantees it — STOP and report; do NOT proceed as if the tree were clean.)
2. For every changed path that is NOT a test file and NOT an allowlisted artifact (see the banner):
   - status \`M\` or \`D\` (modified/deleted source) → \`git checkout $baseCommit -- <path>\` (restore the base version).
   - status \`A\` (a file that did NOT exist at base) → \`git rm -f <path>\` (remove the smuggled addition — \`git checkout\` cannot remove an added path).
3. Re-run \`git diff --name-status $baseCommit..HEAD\` and confirm only test files + allowlisted artifacts remain.
This is the ONE place removing a non-test file is allowed, and ONLY to undo drift — never a fresh edit to source.

=== STEP 1 — Read huu-tests.md AND huu-tests-faq.json ===
From \`huu-tests.md\`: the exact "run all tests" and coverage commands + the expectedFailureIdiom.
From \`huu-tests-faq.json\`: \`category:"suspected-bug"\` ids tell you which failing tests caught a REAL bug (preserve them) vs which are flaky-by-construction (delete candidates).

=== STEP 2 — Run the full suite and list failures ===
Run the "run all tests" command. Capture failing tests as \`<file>::<name>\` (re-run with a verbose reporter if needed).

=== STEP 3 — Make each failing test green WITHOUT editing source — match ONE case per test ===
- CASE wrong-test: the assertion encodes a WRONG assumption (bad mock/setup/contract) → rewrite it to pin the ACTUAL current output (characterization, literal value).
- CASE suspected-bug: it encodes a genuine DESIRED behavior the code doesn't meet → CONVERT it to this runner's xfail marker (strict) and ensure a \`suspected-bug\` FAQ entry + a sibling characterization test (pinning actual) exist. DO NOT delete. On NONE-idiom runners (Go/Rust/JUnit5) keep only the characterization test. If a prior xfail marker now XPASSes (the bug got fixed and the suite went red): do NOT silently flip it — convert it to a normal test asserting the NEW behavior and set its FAQ entry's evidence to "resolved/changed".
- CASE broken: structurally broken (won't compile/import, references a nonexistent symbol, flaky-by-construction and unfixable) → delete ONLY that test block and append a one-line justification to \`huu-tests-faq.json\`.
Deletion is the LAST resort (CASE broken only) — a justified xfail marker always beats deleting a bug-catching test.

SACRED RULES: you NEVER edit a production-source file (STEP 0 only RESTORES); you NEVER delete an entire test FILE — only the failing BLOCK, by runner:
- Vitest/Jest/Mocha: the whole \`it('…', …)\` / \`test('…', …)\` call (an emptied \`describe\` may stay or go).
- pytest: the whole \`def test_<name>(...)\` incl. decorators. · Go: the whole \`func Test<Name>(t *testing.T){…}\`. · Rust: the whole \`#[test] fn <name>(){…}\`. · JUnit: the whole \`@Test … <name>(){…}\`. · RSpec: the whole \`it "…" do … end\`. · xUnit: the whole \`[Fact]/[Theory] … <Name>(){…}\`.
If a file ends up with NO tests: keep the file, add a top comment \`// huu: every test here was removed by cleanup — rewrite before re-running.\` (language comment style).

=== STEP 4 — Re-run until green ===
Re-run "run all tests" — it must exit 0. Repeat STEPS 2-3 up to 3 iterations; if still failing, log it and proceed (the judge catches it).

=== STEP 5 — Collect coverage ===
Use the documented coverage command. Take LINE coverage (fallback: statements), round to an integer. If it fails, use 0 and proceed.

=== STEP 6 — Update the README.md badge ===
Path: ./README.md (create with \`# <project name>\\n\\n\` if absent).
Badge: \`![tests](https://img.shields.io/badge/tests-XX%25-<color>)\` — color: \`<50\` red, \`50–79\` yellow, \`>=80\` brightgreen (exact shields.io name).
Idempotent: if a \`img.shields.io/badge/tests-\` line exists, REPLACE it (don't duplicate); else insert right after the first H1 (blank line around it); if no H1, at the top.
DO NOT touch any other part of README, huu-tests.md, or production code.`;

const CHECK5_CONDITION = `You are the test-suite quality + code-freeze gate. Work from the integration worktree; the run base commit is in the Git Context above and inlined below. Run the project's FULL test suite using the "run all tests" command in \`huu-tests.md\`.

The suite is HEALTHY when ALL clauses hold:
1. GREEN: the run exits 0 (cleanup pins suspected bugs as xfail markers/characterization tests and deletes only structurally-broken blocks).
2. BADGE: \`README.md\` contains exactly ONE line matching \`img.shields.io/badge/tests-\`.
3. FAQ: \`huu-tests-faq.json\` parses as a JSON array.
4. CODE FROZEN (hard — never waived): run \`git diff --name-only $baseCommit..HEAD\`. FAIL-CLOSED: if that range renders empty/malformed (e.g. it reads as \`..HEAD\` because the base is missing) or the command errors, answer "rework" — NEVER approve clause 4 without a confirmed non-empty base and a real changed-file list. EVERY changed path must be one of — a test file (per huu-tests.md's convention, e.g. \`*.test.*\`, \`*.spec.*\`, \`test_*.py\`, \`*_test.go\`, \`tests/**\`, \`src/test/**\`, \`*Test.java\`, \`*_spec.rb\`); the runner config/manifest/lockfile (package.json, *.config.*, pyproject.toml, pytest.ini, pom.xml, build.gradle, go.mod, go.sum, Cargo.toml, *.csproj, lockfiles) where a manifest diff touches ONLY test/dev-deps + the test script (NOT runtime deps or other scripts); or a huu artifact (\`huu-tests.md\`, \`huu-tests-faq.json\`, \`huu-tests-findings.md\`, \`huu-tests-targets.json\`, \`README.md\` badge line). ANY other path — an application/library source file — FAILS clause 4.
5. NO CHEAP-GREEN (hard — never waived): spot-check a few test files changed this run. REWORK if you find a test with zero assertions, or whose SOLE assertion is weak (\`assert(true)\`, defined-only, not-null-only, truthy/falsy-only, length-only, did-not-throw-only, whole-object-snapshot-only), or that mocks the function-under-test as itself, or a \`.skip\`/\`@Disabled\`/\`#[ignore]\`/\`t.Skip\` whose reason mentions a bug (skip-as-bug-tracker).
6. FINDINGS JOIN: each \`suspected-bug\` \`id\` in the FAQ maps to AT LEAST ONE test sharing that id (grep the id — on xfail-idiom runners a characterization test AND a marker may both carry it; both are fine). Fail only on an ORPHAN: an id in the FAQ with zero matching tests, or an \`sb-\` id in a test with no FAQ entry.

This is run $runs of this gate. If every clause holds, answer "approved". Otherwise answer "rework" and name precisely what failed — for clause 1 the failing \`<file>::<name>\` blocks; for clause 4 the EXACT production-source paths that changed; for clause 5 the offending test. Clauses 4, 5, 6 are HARD contract checks: never approve while one fails, regardless of $runs. Only for clause 1 (a single stubborn failing block) may you lean "approved" when $runs >= 2.`;

const STEP6_PROMPT = `You are the final agent. The judge approved the suite. Goal: final hygiene + publish the suspected-bug findings + close the knowledge loop. No new tests here.

${frozenBanner()}

=== STEP 1 — Final verification ===
- Run the "run all tests" command once more — it must exit 0.
- Confirm \`README.md\` has exactly ONE \`img.shields.io/badge/tests-\` line, no test FILE was deleted, and \`git diff --name-only $baseCommit..HEAD\` shows no application-source path.

=== STEP 2 — Publish the suspected-bug findings ===
Regenerate \`./huu-tests-findings.md\` from scratch (it is derived + idempotent) from the \`category:"suspected-bug"\` entries in \`huu-tests-faq.json\`. DEDUPE by \`id\` first (a path may carry findings from several runs; keep one row per id). For each unique finding, cross-check that its \`id\` actually appears in a test in the tree (grep) — report orphans, never invent rows.

# huu-tests-findings.md
> Bugs this suite SURFACED but did NOT fix — the code is frozen. Each is pinned by a characterization test and/or an xfail marker. Green != correct; fixing these is a human decision.

## Suspected bugs
| id | file | actual | expected | evidence | tracked-by |
| --- | --- | --- | --- | --- | --- |
| sb-… | … | … | … | … | <test name / xfail marker> |

If there are NO suspected-bug entries, write the table header followed by \`_None surfaced this run._\`.

=== STEP 3 — Remove the transient target list ===
Delete \`./huu-tests-targets.json\` (the step-2→step-3 handoff). Leave \`huu-tests.md\` and \`huu-tests-faq.json\` (they accumulate across runs).

=== STEP 4 — Close the knowledge loop ===
APPEND one entry to \`huu-tests-faq.json\` (re-read first; preserve the array):
\`\`\`json
{ "summary": "Run summary: coverage <XX>%, <M> files tested, <S> suspected bugs flagged, <K> xfail markers, <N> broken blocks deleted", "knowledge": "<recurring failure causes, which blocks were deleted and why, what the next run should do differently>", "category": "run-summary" }
\`\`\`
Confirm \`huu-tests-faq.json\` is still a valid JSON array.

=== HARD RULES ===
- DO NOT modify production code or huu-tests.md.
- DO NOT add or delete tests — verify, publish findings, stamp only.`;

export function getDefaultPipeline(): Pipeline {
  return {
    name: DEFAULT_PIPELINE_NAME,
    description:
      'Autonomously picks the most test-worthy files and writes mutation-surviving, non-flaky unit tests in parallel, looping until green. Never edits your code — bugs it finds are pinned and reported, not fixed. Adds a coverage badge.',
    _default: true,
    maxRetries: 1,
    maxNodeExecutions: 50,
    steps: [
      {
        type: 'work',
        name: '1. Analyze stack and write huu-tests.md',
        prompt: STEP1_PROMPT,
        files: [],
        scope: 'project',
      },
      {
        type: 'work',
        name: '2. Select test targets',
        prompt: STEP2_PROMPT,
        files: [],
        scope: 'project',
        // huu appends the huu-memory-v1 MEMORY CONTRACT (exact path + format +
        // cap) at run time — step 3 fans out over this list. No user picking.
        produces: TARGETS_PATH,
      },
      {
        type: 'work',
        name: '3. Write tests for $file',
        prompt: STEP3_PROMPT,
        files: [],
        // The recon step (2) writes the target list — autonomous, no picker.
        scope: 'memory',
        filesFrom: TARGETS_PATH,
        maxFiles: TARGETS_MAX_FILES,
      },
      {
        type: 'work',
        name: '4. Cleanup + coverage badge',
        prompt: STEP4_PROMPT,
        files: [],
        scope: 'project',
      },
      {
        type: 'check',
        name: '5. Suite green and code untouched?',
        condition: CHECK5_CONDITION,
        maxRuns: 2,
        outcomes: [
          // Default is the FORWARD path: a judge failure or the stub backend
          // moves on to finalize instead of looping until maxRuns. The freeze
          // does NOT depend on this gate — the cleanup STEP 0 restore (which
          // always runs before the judge) is the deterministic guarantee.
          { label: 'approved', nextStepName: '6. Finalize', default: true },
          { label: 'rework', nextStepName: '4. Cleanup + coverage badge' },
        ],
      },
      {
        type: 'work',
        name: '6. Finalize',
        prompt: STEP6_PROMPT,
        files: [],
        scope: 'project',
      },
    ],
  } as Pipeline;
}

/**
 * Serialized wrapper format consumed by `pipeline-io.importPipeline`.
 * Kept here (not in pipeline-io) so the bootstrap doesn't pull the whole
 * io module — which transitively touches fs at module load time via the
 * `huu-home` import.
 */
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

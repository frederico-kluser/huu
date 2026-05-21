// Default test pipeline shipped with huu. The single source of truth lives
// here; `lib/pipeline-bootstrap.ts` materializes it into the user's repo at
// `pipelines/huu-test-suite.pipeline.json` on first run.
//
// IMPORTANT: keep this file pure (no fs / no env). It is imported on the
// hot path of `App` mount, before any side effects.

import type { Pipeline } from '../types.js';

export const DEFAULT_PIPELINE_FILENAME = 'huu-test-suite.pipeline.json';
export const DEFAULT_PIPELINE_NAME = 'huu Test Suite';

const STEP1_PROMPT = `You are huu's test-bootstrap agent. Goal: leave the project with a working test runner, write \`huu-tests.md\` at the repo root with operational instructions, and initialize \`huu-tests-faq.json\` as an incremental knowledge base.

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
If a runner is already configured: run a minimal test (create an ephemeral sample if needed) to confirm the infra responds. If the config is broken, fix it until the sample passes.

If NO runner is configured: install the canonical default for the detected stack (NEVER pick an exotic runner):
- Plain Node: Vitest (npm i -D vitest; scripts: "test": "vitest run").
- React (Vite/Next/CRA): Vitest + @testing-library/react + jsdom.
- Python: pytest (pip install pytest, or pyproject [project.optional-dependencies]).
- Go: \`go test ./...\` (already in the toolchain).
- Rust: \`cargo test\` (already in cargo).
- Ruby: RSpec if the project already leans that way; otherwise Minitest.
- Java + Maven: JUnit 5 (Jupiter) + Mockito + maven-surefire >= 3.
- Java + Gradle: JUnit 5 + Mockito (test { useJUnitPlatform() }).
- .NET: xUnit (dotnet add package xunit).

Add the minimum config and discover the exact commands empirically.

=== STEP 3 — Write huu-tests.md AT THE ROOT ===
Path: ./huu-tests.md
Required content (English, concise, no fluff):

# huu-tests.md

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

## How to measure coverage
\`\`\`bash
<exact command — e.g.: npx vitest run --coverage; pytest --cov; go test -cover; cargo tarpaulin; mvn jacoco:report>
\`\`\`

## Accumulated FAQ
See \`huu-tests-faq.json\` — incremental knowledge base populated by the next pipeline steps. Schema per item:
\`\`\`json
{ "summary": "string up to 256 chars", "knowledge": "string up to 5000 chars" }
\`\`\`

=== STEP 4 — Initialize huu-tests-faq.json AT THE ROOT ===
Path: ./huu-tests-faq.json
If it does NOT exist: create it with the exact content \`[]\` (empty array + trailing newline).
If it EXISTS and is a valid JSON array: DO NOT touch it (preserve accumulated knowledge).
If it exists but is corrupted / not an array: replace with \`[]\` and mention it in the commit message.

=== HARD RULES ===
- DO NOT write tests for project files in this step — that's the job of steps 2 and 3.
- DO NOT modify production source beyond what's needed to get the test infra up.
- The ONLY new output of this step is huu-tests.md + huu-tests-faq.json + minimal runner config.
- Ensure the "run the full test suite" command documented in huu-tests.md exits 0 (even if it's just the sample).`;

const STEP2_PROMPT = `You are at step 2 — write tests for 3 representative project files. Goal: by the end, those 3 files have green tests and the lessons learned are distilled into \`huu-tests-faq.json\`.

=== STEP 1 — REQUIRED: read huu-tests.md at the root BEFORE anything else ===
It tells you:
- Which runner to use.
- Exact "run a SINGLE test file" command.
- Test path/name convention.
- Project helpers/mocks/setup.

If huu-tests.md does NOT exist: abort with a clear error. Step 1 of the pipeline is a prerequisite.

=== STEP 2 — Read huu-tests-faq.json (may be empty) ===
It's an array of \`{ summary, knowledge }\`. Use the content as additional context.

=== STEP 3 — Pick 3 representative files ===
Selection heuristic (do NOT pick trivial files):
- Prefer modules with real business logic (transforms, validations, calculations, parsers, handlers).
- Prefer files with a clear public surface (multiple exported functions/methods).
- Cover DIVERSITY: try to take 3 distinct areas (e.g.: 1 pure util, 1 with abstractable I/O, 1 stateful/orchestrator).
- IGNORE: purely declarative files (constants, types), entry points (index/main), generated files (dist/, build/, *.generated.*), config (eslint/prettier/tsconfig), files < 30 useful lines.

List the 3 picks before you start writing (leave them in the log).

=== STEP 4 — For EACH of the 3 files ===
a) Identify the public surface (exports, classes, functions, components).
b) Create/update the corresponding test file following the huu-tests.md convention.
c) Write tests covering:
   - Main behavior of each public export.
   - At least 1 edge case (empty, null/undefined/None, limit).
   - At least 1 error path (expected exception).
d) MOCK external dependencies (network, fs, db, time). Tests must be fast, isolated, and deterministic.
e) Run the test file with the single-file command from huu-tests.md.

=== STEP 5 — Error recovery + feed the FAQ ===
For EACH failure found:
1. Investigate the cause. Categorize:
   - Real bug in production code -> FIX the code (minimal change, no refactor).
   - Poorly written test (wrong assertion, weak mock, wrong expectation) -> FIX the test.
   - Missing infra/helper (e.g.: needs fake timer, fixture) -> ADD it in the test file or in a local helper; NEVER touch huu-tests.md or the global config without absolute necessity.
2. Re-run. Repeat until green OR up to 3 attempts per test (after that, mark the function with a clear TODO — step 4 will delete functions that keep failing).
3. If you resolved it: APPEND a new object to huu-tests-faq.json:
   \`\`\`json
   { "summary": "<up to 256 chars: describes the problem in 1 sentence>", "knowledge": "<up to 5000 chars: context, symptom, root cause, applied fix, pattern to reuse in next tests>" }
   \`\`\`
   - Re-read huu-tests-faq.json before the append (preserve the prior array).
   - DO NOT duplicate entries: if a semantically equivalent summary already exists, skip.

=== STEP 6 — Final validation ===
- Run the 3 test files (single-file each). Ideally all green.
- huu-tests-faq.json is still a valid JSON array (\`jq . huu-tests-faq.json\` or equivalent).
- Did NOT touch huu-tests.md.
- Did NOT touch files outside the 3 picks + their tests + (eventual) shared test helper.`;

const STEP3_PROMPT = `You are at step 3 — write tests for ONE source file: \`$file\`. Goal: \`$file\` ends with green tests AND the learning is propagated to \`huu-tests-faq.json\`.

=== STEP 1 — REQUIRED: read BEFORE any action ===
a) \`huu-tests.md\` at the root (runner, commands, conventions).
b) \`huu-tests-faq.json\` at the root (array of \`{ summary, knowledge }\` — knowledge base accumulated by the previous steps; use it to avoid repeating errors other agents already solved).

If either is missing: abort with a clear error. Steps 1 and 2 of the pipeline are prerequisites.

=== STEP 2 — Locate / create the test file for $file ===
Follow the convention documented in huu-tests.md. Examples:
- foo.ts -> foo.test.ts alongside.
- module.py -> tests/test_module.py.
- Foo.java -> src/test/java/<same package>/FooTest.java.
- foo.go -> foo_test.go alongside.

=== STEP 3 — Case A: $file ALREADY has tests ===
1. Run them with the single-file command from huu-tests.md.
2. If ALL pass: read \`$file\` and ADD tests for uncovered branches/edge-cases/error-paths. Re-run — all must stay green.
3. If ANY fails: jump to STEP 5.

=== STEP 4 — Case B: $file has NO tests ===
1. Read \`$file\` and identify the public surface (exports, functions, classes, components).
2. Create the test file per convention.
3. Cover:
   - Main behavior of each public export.
   - At least 1 edge case per public export (empty, null/undefined/None, limit).
   - Error paths (expected exceptions).
4. MOCK external dependencies (network, fs, db, time, APIs). Unit tests — fast, isolated, deterministic.
5. Run with single-file command from huu-tests.md.

=== STEP 5 — Error recovery + APPEND to FAQ ===
For each failure:
1. Categorize:
   - Real bug in \`$file\` -> fix \`$file\` (minimal change, no refactor).
   - Wrong test -> fix the test.
   - Missing helper/mock -> add it inside the test file or in a local helper.
2. Re-run. Up to 3 attempts per test; after that, leave it (step 4 cleans up).
3. If resolved: APPEND to \`huu-tests-faq.json\`:
   - Re-read the file (other parallel agents may have appended).
   - Add \`{ "summary": "<=256>", "knowledge": "<=5000>" }\`.
   - DO NOT duplicate: if a semantically equivalent summary exists, skip.

=== HARD REQUIREMENTS ===
- Single-file command for \`$file\`'s test MUST exit 0 (except for functions you couldn't fix in 3 attempts — leave them failing with a TODO; step 4 deletes).
- ZERO tests with .skip / xit / @Disabled / @pytest.mark.skip without justification.
- DO NOT touch huu-tests.md.
- DO NOT touch global config (package.json scripts, pyproject.toml [tool.X], pom.xml, build.gradle) without absolute necessity.
- The only changes allowed beyond the test are:
  a) \`$file\` (only if a REAL bug is exposed by the test).
  b) \`huu-tests-faq.json\` (append-only).
  c) A small local test helper (next to the test file).

This WHOLE pipeline is about UNIT tests. No integration, no e2e.`;

const STEP4_PROMPT = `You are the final agent — step 4. Goal: leave the test suite 100% green by DELETING only the test functions/blocks that keep failing, collect coverage, and update the badge in README.md.

=== STEP 1 — Read huu-tests.md at the root ===
Grab the exact commands for:
- Running ALL tests.
- Measuring coverage.

=== STEP 2 — Run the full suite and identify failures ===
Execute the "run all tests" command from huu-tests.md.
Capture the list of FAILING tests in the format \`<test file>::<test name>\` (or the runner's equivalent). If the runner output is not directly parseable, re-run with verbose / detailed reporter.

=== STEP 3 — Delete ONLY the test functions that fail ===
SACRED RULE: you NEVER delete an entire test file. You only delete the BLOCK of the function/test that failed.

By language/runner, what constitutes "a block":
- Vitest/Jest: the entire \`it('name', () => { ... })\` or \`test('name', () => { ... })\` call. If it sits inside a \`describe\` that becomes empty, you can leave the \`describe\` empty OR remove it. DO NOT remove the file.
- Mocha: same (\`it(...)\` / \`describe(...)\`).
- pytest: the entire \`def test_<name>(...)\` (including decorators above).
- Go: the entire \`func Test<Name>(t *testing.T) { ... }\`.
- Rust: the entire \`#[test] fn <name>() { ... }\` function.
- JUnit: the entire \`@Test ... void <name>() { ... }\` method.
- RSpec: the entire \`it "..." do ... end\` block.
- xUnit/.NET: the entire \`[Fact] / [Theory] public void <Name>() { ... }\` method.

If a test file ends up with NO test functions after removals:
- DO NOT delete the file.
- Leave a comment at the top: \`// huu: every test in this file was removed by step 4 of the default pipeline. Rewrite them before re-running.\` (use the language's comment style).

=== STEP 4 — Re-run and confirm green ===
Run "run all tests" again. It must exit 0 (or runner equivalent).
If failures remain, repeat STEPS 2-3 until green OR up to 3 iterations; if iteration 3 still has failures, log it and proceed (the badge will reflect reality).

=== STEP 5 — Collect coverage ===
Use the command documented in huu-tests.md. Extract the LINE coverage percentage — it's the standard metric for the badge.
If the runner only reports statements/branches, use statements as fallback.
Round to the nearest integer. If the coverage command fails, use coverage = 0 and proceed (don't block the pipeline).

=== STEP 6 — Update the README.md badge ===
Path: ./README.md (root). If it does not exist, create it with \`# <detected project name>\\n\\n\` as a base.

Badge format:
\`![tests](https://img.shields.io/badge/tests-XX%25-<color>)\`

Color by threshold:
- \`<\` 50  -> red
- 50 to 79 -> yellow
- \`>=\` 80 -> brightgreen (use exactly this string — it's the canonical shields.io name)

Idempotent insertion rule:
1. If a line containing \`img.shields.io/badge/tests-\` already exists in the README, REPLACE it with the new one (preserve indentation). DO NOT duplicate.
2. Otherwise, insert the line right after the first H1 heading (\`# Title\`), with one blank line before and after.
3. If there is no H1, insert it at the absolute top of the file.

DO NOT touch other parts of the README. DO NOT touch huu-tests.md, huu-tests-faq.json, or production code.

=== STEP 7 — Final verification ===
- "run all tests" still passes.
- README.md contains exactly ONE line with \`img.shields.io/badge/tests-\`.
- No test file was DELETED (only internal blocks).
- huu-tests-faq.json is still a valid JSON array (should NOT have been touched in this step).`;

const CHECK_TESTS_GREEN_CONDITION = `Read \`huu-tests.md\` and run the "run all tests" command exactly as documented there. The runner's exit code is the source of truth.

Verdict labels:
- \`green\` — runner exits 0 with no failing tests reported.
- \`failing\` — runner exits non-zero OR reports at least one failing/errored test.

If you cannot read huu-tests.md or cannot execute the command at all, emit \`failing\`.

You are on attempt $runs (max 3). If $runs >= 3, emit \`green\` regardless — step 4 will delete the residual failing blocks.`;

export function getDefaultPipeline(): Pipeline {
  return {
    name: DEFAULT_PIPELINE_NAME,
    _default: true,
    maxRetries: 1,
    maxNodeExecutions: 30,
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
        name: '2. Test 3 representative files',
        prompt: STEP2_PROMPT,
        files: [],
        scope: 'project',
      },
      {
        type: 'work',
        name: '3. Test $file (user-selected)',
        prompt: STEP3_PROMPT,
        files: [],
        scope: 'per-file',
      },
      {
        type: 'check',
        name: '3.5 All tests green?',
        condition: CHECK_TESTS_GREEN_CONDITION,
        maxRuns: 3,
        outcomes: [
          { label: 'green', nextStepName: '4. Final cleanup + coverage badge', default: true },
          { label: 'failing', nextStepName: '2. Test 3 representative files' },
        ],
      },
      {
        type: 'work',
        name: '4. Final cleanup + coverage badge',
        prompt: STEP4_PROMPT,
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

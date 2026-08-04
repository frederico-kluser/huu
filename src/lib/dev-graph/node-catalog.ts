// The palette a human draws from — the block library of `huu-devgraph-v1`.
//
// WHY A CATALOG AND NOT FREE TEXT: the manifesto's line is "o humano subscreve
// o escopo; a IA executa dentro dele". A human who has to write every prompt
// from scratch subscribes nothing — they improvise, and improvisation is the
// variance the huu is built to remove. A block is a METHOD someone already
// underwrote: what the agent does, at which scope, whether it may write, and
// the clause its judge is held to. Dropping `tdd` on the canvas is a decision
// about process, not a prompt-writing exercise.
//
// `custom` is the deliberate escape hatch — an empty template the human fills
// in. It is a block like any other precisely so that "I wrote this one myself"
// stays visible on the canvas instead of hiding inside a node's prompt field.
//
// ORDER IS CONTRACT. This array is served to the browser and rendered as the
// palette in order. APPENDING a block is additive; REORDERING changes what the
// user sees under their muscle memory, so new blocks go at the END.
//
// Keep this file pure (no fs / no env). It is imported by the editor, the
// server and the validator alike.

import { DEV_METHODOLOGIES } from '../dev-mode/methodology-registry.js';
import type { GraphNodeKind } from './graph-types.js';

/**
 * One drawable unit of work.
 *
 * `label` / `description` are pt-BR (they are palette chrome, and the huu's
 * primary audience reads pt-BR). `promptTemplate` and `judgeClause` are ENGLISH
 * — they are agent-facing, like every prompt under `src/lib/default-pipelines/`.
 */
export interface ActionBlock {
  /** Slug. Stored in `ActionNode.block`; stable forever once shipped. */
  id: string;
  /** Short pt-BR name shown on the palette and on the node chip. */
  label: string;
  /** One pt-BR line: what dropping this block actually does. */
  description: string;
  /**
   * The default prompt the node runs. `$goal` is substituted with the graph's
   * `prompt` node text; `$file` / `$hint` are huu's own per-agent fan-out
   * tokens and only resolve under `per-file` / `memory` scope. Empty for
   * `custom`.
   */
  promptTemplate: string;
  /** Scope an editor should pre-select. The human may always override it. */
  defaultScope: 'project' | 'per-file' | 'memory';
  /**
   * The block writes a `huu-memory-v1` list, so a LATER node may fan out one
   * agent per entry (`ActionNode.fanOutFrom` → `WorkStep.filesFrom`). huu
   * appends the exact MEMORY CONTRACT to the prompt at run time, which is why
   * no template here contains format boilerplate.
   *
   * Mutually exclusive with `readOnly` in practice: writing a list needs the
   * write tool.
   */
  produces: boolean;
  /**
   * The block audits/reports and must not change code. The compiler decides
   * how to enforce it (`WorkStep.readOnly` hands the session a tool allowlist
   * with no edit/write, and a REPORT-ONLY marker goes in the prompt).
   */
  readOnly: boolean;
  /** Turn on the per-task generator→critic loop (`WorkStep.review`) by default. */
  review: boolean;
  /**
   * A sentence appended to the node's judge condition. Written to be
   * MECHANICALLY checkable (a file exists, a command exits zero, a diff is
   * empty) — a judge asked for a vibe answers with a vibe.
   */
  judgeClause?: string;
}

/**
 * The shipped blocks, in palette order.
 *
 * Every template opens by restating the objective (`$goal`) because a node that
 * does not know why it exists writes plausible work for the wrong goal.
 */
export const ACTION_BLOCKS: readonly ActionBlock[] = [
  {
    id: 'recon',
    label: 'Reconhecimento',
    description: 'Mapeia o repositório e escreve a lista de alvos para os nós seguintes.',
    promptTemplate: `Objective of this run: $goal

Map this repository against that objective and pick the files that actually need work.

1. Read the entry points, the build configuration and the project's own conventions (AGENTS.md / CLAUDE.md / README) BEFORE opening anything else.
2. Rank candidate files by how much the objective depends on them. Skip node_modules/, dist/, build/, vendor/, and generated or lock files.
3. Shortlist only files a later agent can act on. Each pick carries a one-line reason stating what must be done TO THAT FILE.

The shortlist is the deliverable. Do not change code.`,
    defaultScope: 'project',
    produces: true,
    readOnly: false,
    review: false,
    judgeClause:
      'A target list exists, every entry names a path that exists in the repository, and every entry carries a one-line reason.',
  },
  {
    id: 'implement',
    label: 'Implementar',
    description: 'Executa a mudança pedida pelo objetivo, sem ampliar o escopo.',
    promptTemplate: `Objective of this run: $goal

Implement exactly that, and nothing beyond it.

1. Read the surrounding code first and follow the conventions already in the file you are editing.
2. Make the smallest change that fully satisfies the objective. Do not refactor code you were not asked to touch.
3. Keep the project building: run the project's build/typecheck command and fix what your change broke.
4. If the objective cannot be satisfied as written, say so plainly and stop — do not invent adjacent work.`,
    defaultScope: 'project',
    produces: false,
    readOnly: false,
    review: true,
    judgeClause:
      "The objective is satisfied in the diff and the project's build/typecheck command exits zero.",
  },
  {
    id: 'tdd',
    label: 'TDD',
    description: 'Escreve o teste que falha, vê falhar, e só então implementa.',
    promptTemplate: `Objective of this run: $goal

Work test-first. The ORDER is the method — do not reorder it.

1. Write the test that expresses the desired behavior, in the project's existing test framework and style.
2. RUN it and confirm it FAILS for the right reason. A test that passes before the implementation exists is testing nothing.
3. Only now write the smallest implementation that makes it pass.
4. Re-run the full suite. Every previously passing test must still pass.

Report the failing output from step 2 and the passing output from step 4.`,
    defaultScope: 'project',
    produces: false,
    readOnly: false,
    review: true,
    judgeClause:
      'Every behavior added in this diff is covered by a test, and the full suite exits zero.',
  },
  {
    id: 'tests',
    label: 'Gerar testes',
    description: 'Cobre código existente com testes, sem alterar o código sob teste.',
    promptTemplate: `Objective of this run: $goal

Write tests for the existing code in \`$file\`. Context from the previous step: $hint

RULES:
1. The production tree is READ-ONLY. Never edit the code under test — not even to fix a bug a test exposes.
2. Assert observable BEHAVIOR (inputs to outputs), never implementation details. A test that breaks on a rename tests nothing.
3. No sleeps, no network, no wall-clock or random dependence. Fixed seeds, frozen clocks, real temp dirs.
4. When current behavior looks wrong, CHARACTERIZE it (pin what the code does today so the suite stays truthful) and flag it as a suspected bug in your report.
5. Every test carries at least one assertion. An empty test that goes green is a lie.`,
    defaultScope: 'per-file',
    produces: false,
    readOnly: false,
    review: true,
    judgeClause:
      'New tests assert behavior, contain assertions, run without network or sleeps, and no file outside the test tree was modified.',
  },
  {
    id: 'security-review',
    label: 'Revisão de segurança',
    description: 'Audita riscos de segurança e relata — nunca altera código.',
    promptTemplate: `Objective of this run: $goal

REPORT ONLY. Audit \`$file\` for security defects. You must not change any code.

Look for, in this order: injection into a shell/SQL/HTML sink, secrets or credentials in source, unvalidated external input reaching a privileged operation, missing authorization on a state change, unsafe deserialization, path traversal, and dependencies used in a way their docs call unsafe.

For every finding report: the exact path and line, the attacker-controlled input, the sink it reaches, and the concrete consequence. A finding you cannot trace from input to sink is a suspicion — label it as one instead of promoting it.

Report nothing you did not verify by reading the code.`,
    defaultScope: 'per-file',
    produces: false,
    readOnly: true,
    review: false,
    judgeClause: 'Every finding cites a path and a line, and the diff contains no code change.',
  },
  {
    id: 'performance-review',
    label: 'Revisão de performance',
    description: 'Aponta custos reais de execução e relata — nunca altera código.',
    promptTemplate: `Objective of this run: $goal

REPORT ONLY. Audit this project for performance defects. You must not change any code.

A finding must name a MEASURABLE cost: an N+1 query, a synchronous call on a hot path, an allocation inside a loop, a round-trip that could be batched, an O(n²) scan over data that grows, work repeated per request that could be cached.

For every finding report: the path and line, the cost it pays, the input size at which it starts to matter, and how you would measure it. "This looks slow" is not a finding.`,
    defaultScope: 'project',
    produces: false,
    readOnly: true,
    review: false,
    judgeClause:
      'Every finding names a measurable cost with a path and a line, and the diff contains no code change.',
  },
  {
    id: 'refactor',
    label: 'Refatorar',
    description: 'Melhora a estrutura mantendo o comportamento observável idêntico.',
    promptTemplate: `Objective of this run: $goal

Refactor \`$file\`. Context from the previous step: $hint

BEHAVIOR MUST NOT CHANGE. That is the whole contract of this node.

1. Run the existing tests FIRST and record that they pass. If they do not, stop and report it — you cannot refactor over a red suite.
2. Change structure only: extract, rename, inline, deduplicate, narrow types. No new features, no fixed bugs, no changed defaults.
3. When you move a public signature, update every caller in the same diff.
4. Re-run the tests. Identical results, or the refactor is wrong.`,
    defaultScope: 'per-file',
    produces: false,
    readOnly: false,
    review: true,
    judgeClause:
      'The test suite exits zero and no observable behavior (public signature, default, output format) changed without every caller being updated in the same diff.',
  },
  {
    id: 'docs',
    label: 'Documentar',
    description: 'Escreve documentação verificada contra o código, não contra a intenção.',
    promptTemplate: `Objective of this run: $goal

Document it, following this project's existing documentation conventions.

1. VERIFY before you write: every command, flag, path, environment variable and function signature you mention must exist in the repository exactly as written. Open the file and check.
2. Write for someone who has the repository open and does not know it. Start from what the thing is for, then how to run it, then the edge cases.
3. Do not document intentions, roadmaps or behavior you did not confirm in the code.
4. Update the documents that already exist before creating a new one.`,
    defaultScope: 'project',
    produces: false,
    readOnly: false,
    review: false,
    judgeClause:
      'Every command, flag and path named in the new documentation exists in the repository as written.',
  },
  {
    id: 'characterize',
    label: 'Caracterizar',
    description: 'Congela o comportamento atual em snapshots antes de qualquer mudança.',
    promptTemplate: `Objective of this run: $goal

Capture what \`$file\` does TODAY as committed snapshots, before anything changes it. Context: $hint

1. Identify the observable surface: what this code returns, prints, writes or renders for a given input.
2. Write tests that pin the CURRENT output — including output you believe is wrong. This is a characterization suite (Feathers, "Working Effectively with Legacy Code"); its job is to notice change, not to bless it.
3. Never adjust the code to make a snapshot prettier. If the current behavior looks like a bug, pin it and say so in your report.
4. Snapshots must be deterministic: no timestamps, no absolute paths, no random ids in the recorded output.`,
    defaultScope: 'per-file',
    produces: false,
    readOnly: false,
    review: true,
    judgeClause:
      'Each snapshot records current behavior deterministically and no file outside the test tree was modified.',
  },
  {
    id: 'lint-fix',
    label: 'Corrigir lint',
    description: 'Roda o lint/typecheck do projeto e conserta o que ele aponta.',
    promptTemplate: `Objective of this run: $goal

Bring this project's static checks back to green.

1. Discover the ACTUAL commands from the project configuration (package scripts, Makefile, CI workflow). Do not guess a tool the project does not use.
2. Run them and fix the violations they report, one by one.
3. NEVER silence a rule to pass: no disable comments, no rule removal, no config loosening, no cast that only hides the error. If a rule is genuinely wrong for this codebase, report that instead of disabling it.
4. Change nothing the checks did not flag.
5. Re-run until the commands exit zero, and paste the final output.`,
    defaultScope: 'project',
    produces: false,
    readOnly: false,
    review: false,
    judgeClause:
      "The project's lint/typecheck commands exit zero and the diff adds no suppression comment or loosened rule configuration.",
  },
  {
    id: 'consolidate',
    label: 'Consolidar',
    description: 'Junta os resultados dos nós anteriores num relatório único.',
    promptTemplate: `Objective of this run: $goal

Consolidate what the previous steps produced into ONE report.

1. Read the artifacts those steps left in the repository. Work only from what is written there.
2. Group findings by theme, deduplicate what several steps found, and keep every citation (path and line) intact.
3. Order by consequence, not by the order you found them. Say plainly what is blocking and what is not.
4. Add NO claim that is not in the source artifacts. Where they contradict each other, report the contradiction instead of picking a winner.
5. Close with what remains unknown — the steps that ran, ran on something; say what they did not cover.`,
    defaultScope: 'project',
    produces: false,
    readOnly: false,
    review: false,
    judgeClause:
      'The report cites the artifacts it summarizes and contains no claim absent from them.',
  },
  {
    id: 'custom',
    label: 'Personalizado',
    description: 'Bloco em branco: o método é seu, o prompt é seu.',
    promptTemplate: '',
    defaultScope: 'project',
    produces: false,
    readOnly: false,
    review: false,
  },

  // ==========================================================================
  // THE `-findings` FAMILY — audits that HAND OVER WORK, not audits that talk.
  //
  // READ THIS BEFORE "FIXING" ONE OF THESE INTO ITS `-review` TWIN.
  //
  // `security-review` and `security-findings` are NOT duplicates and neither is
  // a stricter version of the other. They differ in the only dimension that
  // matters to a graph: whether the node can hand DATA to the node after it.
  //
  //   security-review    readOnly: true,  produces: false  → REPORTS.
  //   security-findings  readOnly: false, produces: true   → WRITES WORK ORDERS.
  //
  // Why the pair has to exist:
  //
  // 1. In huu the ONLY step→step data channel is the COMMITTED FILESYSTEM of
  //    the integration worktree. `resolveMemoryFiles` (src/orchestrator/
  //    memory-files.ts) reads the producer's list from there; a check judge's
  //    `CheckEvaluationResult.reason` never reaches the next prompt. So a node
  //    that writes nothing is a data DEAD END — it can route control (via a
  //    gate) but it cannot tell the next node WHAT it found.
  // 2. `WorkStep.readOnly` (src/lib/types/pipeline.ts:262-272) is enforced at
  //    the HARNESS layer: the backend hands the session a tool allowlist with
  //    no `edit` and no `write`. Its own doc spells out the consequence — "an
  //    audit that writes its findings to a file needs `write` and must NOT set
  //    this". readOnly and produces are therefore mutually exclusive, pinned by
  //    a test in node-catalog.test.ts.
  // 3. The validator's `fanout-source-not-producer` (graph-validate.ts:~725)
  //    requires `findBlock(source.block)?.produces === true` for ANY
  //    `fanOutFrom`. Before this family, `recon` was the single producer in the
  //    catalog, so EVERY fan-out in every graph was forced to start at a
  //    file-shortlist recon. The pattern "audit → one agent per PROBLEM" was
  //    literally inexpressible.
  //
  // So: setting `readOnly: true` on a `-findings` block does not make it
  // "safer", it makes it INERT — the fan-out below it stops validating and the
  // agent loses the tool it needs to do its only job. If you want an audit that
  // must not write, that block already exists: use the `-review` twin.
  //
  // Shape of the hand-over (same contract as `taskSpecContract` in
  // src/lib/dev-mode/dev-protocol.ts, which the dev-mode planner already lives
  // by): one markdown TASK FILE per finding, each declaring the files it OWNS,
  // and a list whose entries point at the TASK FILES — not at source files. The
  // consumer fans out one agent per entry, so `$file` there is the briefing and
  // `$hint` is the one-line "what is broken". Each block writes into its OWN
  // `.huu/findings/<axis>/` directory so two findings nodes in the same wave
  // never contend for a path.
  //
  // No template spells the list FORMAT: huu appends the MEMORY CONTRACT
  // (src/lib/memory-contract.ts) to the prompt at run time whenever the compiled
  // step carries `produces`. Writing it by hand would drift from it.
  // ==========================================================================
  {
    id: 'security-findings',
    label: 'Achados de segurança',
    description:
      'Audita segurança e ESCREVE uma tarefa por achado (o par read-only `security-review` só relata).',
    promptTemplate: `Objective of this run: $goal

You are a security auditor whose deliverable is WORK ORDERS, not a report. Audit this project and turn every defect you can PROVE into one self-contained task file that a later agent will fix alone.

=== STEP 1 — Find the defects ===
Look for, in this order: injection into a shell/SQL/HTML sink, secrets or credentials in source, unvalidated external input reaching a privileged operation, missing authorization on a state change, unsafe deserialization, path traversal, and dependencies used in a way their docs call unsafe.
Trace every candidate from the attacker-controlled input to the sink by READING the code. One you cannot trace is a suspicion, not a finding: drop it.

=== STEP 2 — Write one task file per finding ===
Create the directory, then write \`.huu/findings/security/001-<slug>.md\`, \`002-<slug>.md\`, … — zero-padded, most consequential first.
Each file is the COMPLETE briefing for ONE agent that works alone, in its own worktree, with no access to you and no knowledge of the other tasks:

# <NNN> — <imperative title>

## Finding
<the path and line, the attacker-controlled input, the sink it reaches, the concrete consequence>

## Files this task OWNS
- <repo-relative path> — <why this task needs to write it>
(The agent may READ anything; it may WRITE only the files listed here.)

## Fix
1. <concrete action>
2. …

## Done when
- <objectively checkable statement>

=== STEP 3 — PARTITION BY FILE OWNERSHIP (the rule that decides whether this merges) ===
The next step runs ONE AGENT PER TASK FILE, in parallel, and merges their branches deterministically. Two tasks that write the same file conflict and cost the whole stage.
- Every file belongs to exactly ONE task. Two findings in the same file are ONE task, not two.
- Fewer, well-partitioned tasks beat many overlapping ones. One task is a fine answer.
- A shared file (a router, a barrel, a config) belongs to a single task; name that owner in the other tasks' Fix section.

=== STEP 4 — Hand the list over ===
Write the list described by the MEMORY CONTRACT appended at the end of this prompt: one entry per TASK FILE you wrote — its path, a one-line hint naming the defect and the file it fixes, and a higher priority for the ones that must land first (proven and exploitable before theoretical).
List the task files, never the source files: the next agent's assignment is the briefing.

=== STEP 5 — Commit, or none of it exists ===
The next step reads the MERGED worktree, so an uncommitted file is invisible to it. \`git add\` the task files and the list, then commit them.
Probe the DELIVERABLE directory, never its parent: \`git check-ignore -q .huu/findings\`. A \`.gitignore\` carrying \`.huu/**\` leaves \`.huu\` itself un-ignored, so asking about the parent answers OK while every task file you wrote is dropped by \`git add\`.
If it says the path is ignored, replace the line that ignores it — whichever form it takes, \`.huu/\`, \`.huu\`, \`/.huu/\` or \`.huu/**\` — with \`.huu/*\`, and add \`!.huu/findings/\` on the next line. That is the one edit permitted outside \`.huu/findings/\`. Re-run the probe: it must now say OK.

=== HARD RULES ===
- Fix NOTHING here. You write work orders; the next step does the work.
- Invent NOTHING to fill the list. An empty list is a valid, honest result and simply runs zero agents.
- Every path you name must exist in the repository — an entry whose path does not resolve is dropped at run time.

=== SELF-CHECK (before finishing) ===
- Every listed task file exists on disk and is committed.
- No file is claimed by two tasks.
- Every finding cites a path and a line that exist.
- No task file contains a placeholder (\`TODO\`, \`TBD\`, an empty section).`,
    defaultScope: 'project',
    produces: true,
    readOnly: false,
    review: false,
    judgeClause:
      'The task list is committed and every path it names resolves to a committed markdown task file; each task file cites a path and a line that exist in the repository, names at least one file it owns, and contains no placeholder (TODO, TBD, an empty section); no file is owned by two tasks.',
  },
  {
    id: 'performance-findings',
    label: 'Achados de performance',
    description:
      'Audita performance e ESCREVE uma tarefa por achado (o par read-only `performance-review` só relata).',
    promptTemplate: `Objective of this run: $goal

You are a performance auditor whose deliverable is WORK ORDERS, not a report. Audit this project and turn every measurable cost into one self-contained task file that a later agent will fix alone.

=== STEP 1 — Find the costs ===
A finding must name a MEASURABLE cost: an N+1 query, a synchronous call on a hot path, an allocation inside a loop, a round-trip that could be batched, an O(n²) scan over data that grows, work repeated per request that could be cached.
For each one, establish the path and line, the cost it pays, and the input size at which it starts to matter. "This looks slow" is not a finding: drop it.

=== STEP 2 — Write one task file per finding ===
Create the directory, then write \`.huu/findings/performance/001-<slug>.md\`, \`002-<slug>.md\`, … — zero-padded, most consequential first.
Each file is the COMPLETE briefing for ONE agent that works alone, in its own worktree, with no access to you and no knowledge of the other tasks:

# <NNN> — <imperative title>

## Finding
<the path and line, the cost it pays, the input size at which it starts to matter, how to measure it>

## Files this task OWNS
- <repo-relative path> — <why this task needs to write it>
(The agent may READ anything; it may WRITE only the files listed here.)

## Fix
1. <concrete action>
2. …

## Done when
- <objectively checkable statement, including the behavior that must stay identical>

=== STEP 3 — PARTITION BY FILE OWNERSHIP (the rule that decides whether this merges) ===
The next step runs ONE AGENT PER TASK FILE, in parallel, and merges their branches deterministically. Two tasks that write the same file conflict and cost the whole stage.
- Every file belongs to exactly ONE task. Two findings in the same file are ONE task, not two.
- Fewer, well-partitioned tasks beat many overlapping ones. One task is a fine answer.
- A shared file (a router, a barrel, a config) belongs to a single task; name that owner in the other tasks' Fix section.

=== STEP 4 — Hand the list over ===
Write the list described by the MEMORY CONTRACT appended at the end of this prompt: one entry per TASK FILE you wrote — its path, a one-line hint naming the cost and the file it fixes, and a higher priority for the ones that must land first (measured cost on a hot path before a theoretical one).
List the task files, never the source files: the next agent's assignment is the briefing.

=== STEP 5 — Commit, or none of it exists ===
The next step reads the MERGED worktree, so an uncommitted file is invisible to it. \`git add\` the task files and the list, then commit them.
Probe the DELIVERABLE directory, never its parent: \`git check-ignore -q .huu/findings\`. A \`.gitignore\` carrying \`.huu/**\` leaves \`.huu\` itself un-ignored, so asking about the parent answers OK while every task file you wrote is dropped by \`git add\`.
If it says the path is ignored, replace the line that ignores it — whichever form it takes, \`.huu/\`, \`.huu\`, \`/.huu/\` or \`.huu/**\` — with \`.huu/*\`, and add \`!.huu/findings/\` on the next line. That is the one edit permitted outside \`.huu/findings/\`. Re-run the probe: it must now say OK.

=== HARD RULES ===
- Optimize NOTHING here. You write work orders; the next step does the work.
- Invent NOTHING to fill the list. An empty list is a valid, honest result and simply runs zero agents.
- Every path you name must exist in the repository — an entry whose path does not resolve is dropped at run time.

=== SELF-CHECK (before finishing) ===
- Every listed task file exists on disk and is committed.
- No file is claimed by two tasks.
- Every finding names a measurable cost at a path and a line that exist.
- No task file contains a placeholder (\`TODO\`, \`TBD\`, an empty section).`,
    defaultScope: 'project',
    produces: true,
    readOnly: false,
    review: false,
    judgeClause:
      'The task list is committed and every path it names resolves to a committed markdown task file; each task file names a measurable cost at a path and a line that exist in the repository, names at least one file it owns, and contains no placeholder (TODO, TBD, an empty section); no file is owned by two tasks.',
  },
  {
    id: 'review-findings',
    label: 'Achados de revisão',
    description:
      'Revisa o código e ESCREVE uma tarefa por achado, para o passo seguinte corrigir um por agente.',
    promptTemplate: `Objective of this run: $goal

You are a code reviewer whose deliverable is WORK ORDERS, not a report. Review this project against the objective and turn every defect worth someone's time into one self-contained task file that a later agent will fix alone.

=== STEP 1 — Find the defects ===
Look for: logic that is wrong for an input the code accepts, an error path that is swallowed or cannot happen as written, a contract the code states and then violates (a doc comment, a type, a validation), duplicated logic that has already drifted between copies, dead code still wired in, and behavior with no test where a regression would go unnoticed.
Judge against what the code CLAIMS, not against your taste. A style preference is not a finding: drop it.

=== STEP 2 — Write one task file per finding ===
Create the directory, then write \`.huu/findings/review/001-<slug>.md\`, \`002-<slug>.md\`, … — zero-padded, most consequential first.
Each file is the COMPLETE briefing for ONE agent that works alone, in its own worktree, with no access to you and no knowledge of the other tasks:

# <NNN> — <imperative title>

## Finding
<the path and line, what the code claims, what it actually does, and the consequence>

## Files this task OWNS
- <repo-relative path> — <why this task needs to write it>
(The agent may READ anything; it may WRITE only the files listed here.)

## Fix
1. <concrete action>
2. …

## Done when
- <objectively checkable statement>

=== STEP 3 — PARTITION BY FILE OWNERSHIP (the rule that decides whether this merges) ===
The next step runs ONE AGENT PER TASK FILE, in parallel, and merges their branches deterministically. Two tasks that write the same file conflict and cost the whole stage.
- Every file belongs to exactly ONE task. Two findings in the same file are ONE task, not two.
- Fewer, well-partitioned tasks beat many overlapping ones. One task is a fine answer.
- A shared file (a router, a barrel, a config) belongs to a single task; name that owner in the other tasks' Fix section.

=== STEP 4 — Hand the list over ===
Write the list described by the MEMORY CONTRACT appended at the end of this prompt: one entry per TASK FILE you wrote — its path, a one-line hint naming the defect and the file it fixes, and a higher priority for the ones that must land first (wrong behavior before untested behavior before duplication).
List the task files, never the source files: the next agent's assignment is the briefing.

=== STEP 5 — Commit, or none of it exists ===
The next step reads the MERGED worktree, so an uncommitted file is invisible to it. \`git add\` the task files and the list, then commit them.
Probe the DELIVERABLE directory, never its parent: \`git check-ignore -q .huu/findings\`. A \`.gitignore\` carrying \`.huu/**\` leaves \`.huu\` itself un-ignored, so asking about the parent answers OK while every task file you wrote is dropped by \`git add\`.
If it says the path is ignored, replace the line that ignores it — whichever form it takes, \`.huu/\`, \`.huu\`, \`/.huu/\` or \`.huu/**\` — with \`.huu/*\`, and add \`!.huu/findings/\` on the next line. That is the one edit permitted outside \`.huu/findings/\`. Re-run the probe: it must now say OK.

=== HARD RULES ===
- Fix NOTHING here. You write work orders; the next step does the work.
- Invent NOTHING to fill the list. An empty list is a valid, honest result and simply runs zero agents.
- Every path you name must exist in the repository — an entry whose path does not resolve is dropped at run time.

=== SELF-CHECK (before finishing) ===
- Every listed task file exists on disk and is committed.
- No file is claimed by two tasks.
- Every finding cites a path and a line that exist.
- No task file contains a placeholder (\`TODO\`, \`TBD\`, an empty section).`,
    defaultScope: 'project',
    produces: true,
    readOnly: false,
    review: false,
    judgeClause:
      'The task list is committed and every path it names resolves to a committed markdown task file; each task file cites a path and a line that exist in the repository, names at least one file it owns, and contains no placeholder (TODO, TBD, an empty section); no file is owned by two tasks.',
  },
];

/** The block with this id, or `undefined`. Used by the validator's `unknown-block`. */
export function findBlock(id: string): ActionBlock | undefined {
  return ACTION_BLOCKS.find((block) => block.id === id);
}

/** Every block id, in palette order. */
export function blockIds(): string[] {
  return ACTION_BLOCKS.map((block) => block.id);
}

/**
 * The non-action node kinds, for the palette. `action` is listed too so the
 * palette can render all four from one array — its blocks come from
 * {@link ACTION_BLOCKS}.
 */
export interface NodeKindInfo {
  kind: GraphNodeKind;
  label: string;
  description: string;
}

/** Palette order: the entry first, then work, then the two decision nodes. */
export const NODE_KINDS: readonly NodeKindInfo[] = [
  {
    kind: 'prompt',
    label: 'Entrada do prompt',
    description: 'O objetivo, escrito por você. Existe um por grafo e é a raiz de tudo.',
  },
  {
    kind: 'action',
    label: 'Ação',
    description: 'Um bloco de trabalho do catálogo, executado por agentes em paralelo.',
  },
  {
    kind: 'research',
    label: 'Pesquisa',
    description: 'Uma pergunta respondida antes de continuar — pode ramificar o caminho.',
  },
  {
    kind: 'gate',
    label: 'Verificação',
    description: 'Um juiz LLM avalia sua condição e escolhe por qual saída o grafo segue.',
  },
];

/**
 * The methodologies, projected for the graph editor.
 *
 * PROJECTED, never re-declared: {@link DEV_METHODOLOGIES} is the single
 * declaration surface (the CLI flags, the /dev checkboxes and the planner's
 * bullets all derive from it), and `src/web/server.ts` already does exactly
 * this for the /dev form. A second hand-written list is the drift bug this
 * projection exists to prevent. Only the browser-facing columns cross over —
 * the CLI flag and the planner bullet are nobody's business here.
 *
 * The `key` widens to `string` on purpose: `DevGraphMeta.methodology` is a
 * loose record so this module does not drag the dev-mode types into a browser
 * payload. The COMPILER narrows the keys back to `keyof DevMethodology`.
 */
export function methodologyOptions(): { key: string; label: string; description: string }[] {
  return DEV_METHODOLOGIES.map(({ key, label, description }) => ({ key, label, description }));
}

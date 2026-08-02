// Prompts for the dev-mode orchestrator — the TWO structured LLM calls per
// epoch that decide, first, WHAT IT NEEDS TO KNOW, and then HOW the swarm
// attacks the human's goal.
//
// The orchestrator is BLIND: it has no tools, reads no file, and never sees a
// repo digest. That is not a way of skipping retrieval — it is a way of
// DELEGATING it. Stage one emits questions; huu turns each one into a real
// spec file, a fan-out of agents answers them with a shell in the repo, and
// their consolidated briefing is the ONLY thing about the repository the
// orchestrator ever reads. Stage two plans against that briefing.
//
// Both outputs are schema-enforced (`knowledge-schema.ts`, `plan-schema.ts`),
// so these prompts do not describe a JSON format: they describe the JUDGEMENT.
// What they DO have to describe is every schema bound in PROSE — id patterns,
// caps, string lengths. No provider enforces a JSON-schema `pattern` or
// `maxLength` reliably, so a bound that exists only in Zod is a bound the model
// finds out about by having its whole response rejected. Stating them here is
// what makes the repair round rare instead of routine.
//
// Three rules are load-bearing and repeated deliberately:
//  - Fronts are parallel and their agents MERGE. A plan whose fronts fight
//    over the same files converts into merge conflicts, not throughput.
//  - The planner decomposes; it never re-scopes. The human wrote the goal.
//  - What the briefings do not state, the orchestrator does not know. An
//    invented command or framework reaches a real agent as an order.
//
// Both builders put the session-fixed framing FIRST and the epoch context
// LAST, split by DYNAMIC_BOUNDARY: provider prompt caches key on the longest
// shared prefix, and dev mode pays for these prompts every epoch. New fixed
// rules belong above the line; new epoch context below it.
//
// Keep this file pure (no fs / no env).

import {
  DEV_MAX_FRONTS,
  DEV_MAX_GAPS,
  type DevEpochEvidence,
  type DevEpochRecord,
  type DevMethodology,
} from '../types.js';
import { activeMethodologies } from './methodology-registry.js';

/** Bounds on the rendered evidence table — the orchestrator gets a summary, never a window into the repo. */
const MAX_EVIDENCE_FILES_SHOWN = 20;
const MAX_VERDICTS_SHOWN = 10;
const MAX_WAIVED_SHOWN = 8;

/** What both stages know before anyone has read anything for them. */
export interface DevPlanningContext {
  /** The human's goal, verbatim. */
  goal: string;
  /** 1-based epoch about to be planned. */
  epoch: number;
  /** One line naming the project's knowledge surface, when it has one. */
  knowledgeSummary?: string;
  /** Epochs already executed, oldest first. Empty on the first epoch. */
  history: readonly DevEpochRecord[];
  /**
   * Structured outcome of the PREVIOUS epoch. Bounded and tabular by
   * construction ({@link DevEpochEvidence}) — it is what keeps the
   * orchestrator blind while still being informed.
   */
  previousEvidence?: DevEpochEvidence;
}

/** Stage one: the knowledge REQUEST. */
export interface KnowledgePromptInput extends DevPlanningContext {
  /** Ceiling on questions. Clamped to {@link DEV_MAX_GAPS}. */
  maxGaps?: number;
}

/** Stage two: the PLAN, written against the briefings stage one bought. */
export interface PlannerPromptInput extends DevPlanningContext {
  /**
   * The consolidated briefing (`knowledge/digest.md`) written by the agents
   * that answered stage one — the ONLY thing this planner learns about the
   * repository. Absent or empty means nobody answered, and the prompt says so
   * out loud rather than letting the model fill the silence with assumptions.
   */
  briefPack?: string;
  /**
   * Everything EARLIER epochs of this session established, deduped by gap with
   * the newest answer winning (`assembleAccumulatedKnowledge`).
   *
   * The per-epoch briefing answers what THIS epoch asked; the baseline
   * questions — stack, entry points, build/test commands, conventions — are
   * asked once, in epoch 1, and were then simply lost. Absent (epoch 1, or a
   * session with no shards) ⇒ the prompt is byte-identical to before.
   */
  accumulatedPack?: string;
  /** Report text of the PREVIOUS epoch, when one exists. */
  previousReport?: string;
  /**
   * The notes the orchestrator wrote for ITSELF in its knowledge request —
   * `KnowledgeRequest.planningNotes` promises they come back at planning
   * time. Rendered as one small labeled section; ABSENT ⇒ the prompt stays
   * byte-identical.
   */
  planningNotes?: string;
  /**
   * The methodologies the human underwrote for this session (the dev-mode
   * checkboxes). Rendered as CONTENT constraints on the plan — the compiler
   * turns them into structure, so what they ask of the planner is content:
   * testable criteria, declared partitions, named conventions. Absent — or
   * every flag off — ⇒ the section is not rendered and the prompt stays
   * byte-identical.
   */
  methodology?: DevMethodology;
  /** Hard cap on fronts for this epoch. */
  maxFronts: number;
}

const BLIND_ROLE = `You are huu's development orchestrator. You have NOT read this repository and you will not: you have no shell, no file access and no search. Everything you will ever know about the code arrives because you ASKED for it and a separate agent — one with a shell, standing in the actual repo — went and looked.

That is the whole point of this step: you DELEGATE retrieval, you do not skip it. A question you fail to ask is a fact you will plan without.`;

const PLANNER_ROLE = `You are huu's development planner. A swarm of coding agents is about to run in parallel git worktrees, and your plan is the ONLY thing that decides what each of them does. You get one shot per epoch: there is no interactive follow-up, and the agents cannot ask you anything.`;

const WHAT_A_FRONT_IS = `=== WHAT A FRONT IS ===
A FRONT is one parallel workstream. Each front you emit becomes three pipeline steps that huu runs for you:
1. a RECON agent that reads the repo and splits your front into independent task specs;
2. a SWARM of agents, one per task spec, each in its own git worktree, running AT THE SAME TIME — and each one's diff is audited by a separate REVIEWER before it may merge;
3. a JUDGE that must be able to prove the front is done.
Fronts run in parallel with each other. Their branches are merged deterministically when the wave ends.`;

const PARTITION_RULE = `=== THE RULE THAT DECIDES IF THIS WORKS ===
Parallel agents merge. Two fronts that write the same files produce merge conflicts, and a conflict costs more than the parallelism bought.
- Split by FILE OWNERSHIP, not by activity. "backend" + "frontend" is a good split; "implement" + "test" is a bad one, because both touch the same files.
- When work genuinely cannot be partitioned, emit ONE front. One front is a correct, common answer — a serial plan that merges beats a parallel plan that conflicts.
- Use \`dependsOnFronts\` only for a real ordering constraint (front B needs the API that front A creates). It costs you the parallelism, so justify it in the rationale.`;

const PROMPT_GUIDANCE = `=== WRITING THE THREE PROMPTS ===
You write three fields per front. They are handed to different agents, so aim each one.

\`reconPrompt\` → the agent that SPLITS the front into task specs.
  Tell it what to look for in the repo and what makes a good task boundary HERE. It already receives the epoch atlas, the spec file format, and the partitioning rule — do not repeat those.

\`workPrompt\` → EVERY agent in the swarm, each of which also has its own spec.
  Put the front's shared context here: the design decision to follow, the convention to match, the API to reuse, the thing that must not break. Do not describe individual tasks — you do not know how the recon will split them. The tokens \`$file\` (this agent's spec path) and \`$hint\` (its one-line summary) are substituted automatically and are already in the preamble.

\`verifyCondition\` → the JUDGE, which has shell access in the merged worktree.
  State what can be MECHANICALLY checked: a command that must exit 0, a file that must exist and contain something specific, a behavior a test proves. "The code is clean" is unjudgeable and will rubber-stamp. If the briefings name a test or type-check command, name it too.`;

const ANTI_PATTERNS = `=== DO NOT ===
- Do not widen, narrow, or reinterpret the goal. You decompose what the human wrote; you never decide what they "really meant".
- Do not emit a front whose only content is "write tests for the other fronts" — it would race them for the same files.
- Do not plan the whole goal into one epoch if it is large. Plan the slice that is worth doing NOW; a later epoch replans with the code you produced in hand.
- Do not invent files, commands or frameworks. If the briefings do not show a test runner, do not tell a judge to run one.`;

function historyBlock(input: DevPlanningContext): string {
  if (input.history.length === 0) {
    return `=== HISTORY ===
This is the FIRST epoch. Nothing has been built yet.`;
  }
  const lines = input.history.map(
    (e) =>
      `- Epoch ${e.epoch} (${e.status}): ${e.epochGoal} — fronts: ${e.frontIds.join(', ') || 'none'}${
        e.landingError ? ` — LANDING FAILED: ${e.landingError}` : ''
      }`,
  );
  return `=== HISTORY (already executed, already merged into the working tree) ===
${lines.join('\n')}

Do NOT re-plan work an earlier epoch already delivered.`;
}

/**
 * The previous epoch's outcome, as a bounded table.
 *
 * Deliberately NOT prose written by a model that liked its own work: verdicts,
 * counts, waived review findings and the landing result are facts the run
 * recorded. `waived` is the highest-signal row here — it is work that merged
 * while a critic was still objecting.
 */
function evidenceBlock(evidence: DevEpochEvidence | undefined): string {
  if (!evidence) return '';
  const lines: string[] = [`=== WHAT EPOCH ${evidence.epoch} ACTUALLY DID (measured, not reported) ===`];

  lines.push(
    `- Tasks: ${evidence.taskOutcomes.done} done, ${evidence.taskOutcomes.noChanges} produced nothing, ${evidence.taskOutcomes.failed} failed, ${evidence.taskOutcomes.unmerged} never merged.`,
  );
  lines.push(
    `- Landing: ${evidence.landing.landed ? `merged as ${evidence.landing.commit ?? 'unknown commit'}` : `FAILED — ${evidence.landing.error ?? 'unknown error'}`}`,
  );

  if (evidence.filesChanged.length > 0) {
    const shown = evidence.filesChanged.slice(0, MAX_EVIDENCE_FILES_SHOWN);
    const more = evidence.filesChanged.length - shown.length;
    lines.push(`- Files changed (${evidence.filesChanged.length}): ${shown.join(', ')}${more > 0 ? ` …and ${more} more` : ''}`);
  }

  if (evidence.verdicts.length > 0) {
    lines.push('- Judge verdicts:');
    for (const v of evidence.verdicts.slice(0, MAX_VERDICTS_SHOWN)) {
      lines.push(
        `  - ${v.stepName}: ${v.label}${v.fromJudge ? '' : ' (NO judge answer — the safe default fired, so this step was never actually verified)'}${v.reason ? ` — ${v.reason}` : ''}`,
      );
    }
  }

  if (evidence.waived.length > 0) {
    lines.push(
      `- Merged WITH the reviewer still objecting (${evidence.waived.length} task(s) hit the review cap):`,
    );
    for (const w of evidence.waived.slice(0, MAX_WAIVED_SHOWN)) {
      const summary = w.findings
        .slice(0, 3)
        .map((f) => `${f.severity}: ${f.summary}`)
        .join('; ');
      lines.push(`  - ${w.stageName} (agent ${w.agentId}): ${summary || 'no findings recorded'}`);
    }
    lines.push('  This is the most likely place for the code to be wrong. Weigh it before planning anything new.');
  }

  if (evidence.diffStat.trim()) {
    lines.push('- Diff stat:');
    lines.push('```');
    lines.push(evidence.diffStat.trim());
    lines.push('```');
  }

  if (evidence.reportExcerpt?.trim()) {
    lines.push('- From the epoch report:');
    lines.push(evidence.reportExcerpt.trim());
  }

  return lines.join('\n');
}

function knowledgeSummaryBlock(input: DevPlanningContext, forPlanner: boolean): string {
  if (!input.knowledgeSummary) return '';
  const tail = forPlanner
    ? 'These skills are the project\'s own documented conventions. Point the fronts at the relevant ones instead of restating what they already say.'
    : 'These skills are the project\'s own documented conventions. A `convention` question is answered from them — so ask which rule applies, not whether a rule file exists.';
  return `\n=== PROJECT KNOWLEDGE ===\n${input.knowledgeSummary}\n${tail}\n`;
}

/**
 * The orchestrator's own notes from its knowledge request, handed back
 * exactly as the schema promises. Empty string when absent — a request that
 * carried no notes must produce a byte-identical prompt.
 */
function planningNotesBlock(input: PlannerPromptInput): string {
  const notes = input.planningNotes?.trim();
  if (!notes) return '';
  return `\n=== YOUR NOTES TO YOURSELF (from your knowledge request — nobody else wrote or read these) ===\n${notes}\n`;
}

/**
 * The methodologies the human underwrote, as CONTENT constraints on the
 * plan. The compiler enforces them structurally (step splits, gates, a plan
 * audit); what the planner owes is a plan that SURVIVES them — testable
 * "Done when" criteria, a declared partition, named conventions. Empty
 * string when nothing is on, so an unflagged session plans byte-identically.
 */
function methodologyBlock(input: PlannerPromptInput): string {
  const lines = activeMethodologies(input.methodology).map((d) => d.plannerBullet);
  if (lines.length === 0) return '';
  return `\n=== METODOLOGIAS ATIVAS (mandatadas pelo humano) ===\nThe human underwrote these methodologies for this session. They are enforced structurally when your plan compiles — what they ask of YOU is content:\n${lines.join('\n')}\n`;
}

/**
 * The visible split between the cacheable stable prefix and the per-epoch
 * dynamic suffix — the same idea as Claude Code's
 * `__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__`. Exported so tests assert the split
 * against the same string the prompts carry.
 */
export const DYNAMIC_BOUNDARY = '--- DYNAMIC CONTEXT BELOW (changes every epoch) ---';

/**
 * STAGE ONE — the knowledge request.
 *
 * The first call of a blind orchestrator, and the only one that runs before
 * anybody has read the repository for it. Its output is a list of QUESTIONS,
 * which huu materializes as one real spec file per gap and answers with a
 * parallel fan-out.
 */
export function buildKnowledgePrompt(input: KnowledgePromptInput): string {
  const cap = Math.min(Math.max(1, input.maxGaps ?? DEV_MAX_GAPS), DEV_MAX_GAPS);
  const evidence = evidenceBlock(input.previousEvidence);
  return `${BLIND_ROLE}

=== THE GOAL (written by the human — this is the scope, all of it and only it) ===
${input.goal}

=== WHAT HAPPENS TO YOUR QUESTIONS ===
Each gap you declare becomes a spec file, and one agent is spawned per gap, IN PARALLEL, to answer it. Every answer comes back as a short brief with its sources; the briefs are consolidated into a single document, and that document is the ONLY thing about this repository you will see when you plan the epoch.

So: a question you do not ask is a fact you will plan without. And a question that would not change your plan costs a whole agent for nothing.

=== THE THREE LANES (\`kind\`) ===
Pick the lane by WHERE the answer lives, never by which file to open — naming files is the answering agent's job, and it is the one that can see them.
- \`repo\` — the answer is in this codebase. The agent may only cite real paths and quoted lines.
- \`convention\` — the answer is a project rule (skills, router, contributing docs). The agent loads the rule FIRST, then verifies it against the code; a rule the code contradicts comes back as a finding, not as a rule.
- \`external\` — the answer is outside this repository (a library's real API, a spec, a version's behavior). Answered by web research, with citations.

=== HOW TO ASK WELL ===
- Ask what CHANGES the plan. "How is the CLI wired?" is worth an agent when the goal touches the CLI, and worthless when it does not.
- You do not know the file layout, so do not pretend to. Ask "where does X live and what owns it", never "read src/foo.ts".
- One answerable question per gap. Two questions in one gap get half an answer to each.
- \`why\` must say what the answer changes ABOUT THIS GOAL. A gap that cannot say that is a gap you invented to look thorough — drop it.
- \`goodAnswer\` is the acceptance criterion the answering agent is graded on. Say what a complete answer contains (a path, a command, a named convention, a version), not "a good explanation".
- Prefer few sharp questions over many vague ones. An honest gap beats an invented fact — on both sides of this exchange.${
    input.epoch === 1
      ? `\n- huu already asks a fixed baseline for you on the first epoch: the stack and entry points, the build/test commands, where this goal lands in the tree, and the project's conventions surface. Do NOT spend your budget re-asking those — ask what they would not cover.`
      : `\n- huu already asks, for you, what the previous epoch actually delivered versus what it promised. Do NOT re-ask that.`
  }

=== YOUR OUTPUT (the bounds are enforced mechanically — a violation is rejected wholesale) ===
- \`restatedGoal\`: the human's goal in YOUR words, at most 600 characters. This is a comprehension check the human reads at the approval gate; drift here is caught before an epoch runs.
- \`gaps\`: at most ${cap} entries. An EMPTY list is legal and means "I already know enough to plan" — on the first epoch that is almost certainly false.
- Each gap has exactly four fields:
  - \`id\`: kebab-case, 3 to 40 characters, lowercase letters, digits and hyphens ONLY, starting and ending with a letter or digit (for example \`api-layer\`, \`test-runner\`, \`auth-flow\`). No spaces, no slashes, no underscores, no capitals — it names a file on disk.
  - \`kind\`: exactly one of \`repo\`, \`convention\`, \`external\`.
  - \`question\`: one answerable question, at most 400 characters.
  - \`why\`: what the answer changes about THIS goal, at most 400 characters.
  - \`goodAnswer\`: the acceptance criterion, at most 600 characters.
- \`planningNotes\` (optional, at most 1000 characters): anything you want handed back to yourself at planning time. It is not read by anyone else.

${DYNAMIC_BOUNDARY}

${historyBlock(input)}${evidence ? `\n\n${evidence}` : ''}
${knowledgeSummaryBlock(input, false)}`;
}

/** The single planner call for one epoch. Schema-enforced by the caller. */
export function buildPlannerPrompt(input: PlannerPromptInput): string {
  const cap = Math.min(input.maxFronts, DEV_MAX_FRONTS);
  const evidence = evidenceBlock(input.previousEvidence);
  const briefings = input.briefPack?.trim();
  return `${PLANNER_ROLE}

=== THE GOAL (written by the human — this is the scope, all of it and only it) ===
${input.goal}

${WHAT_A_FRONT_IS}

${PARTITION_RULE}

${PROMPT_GUIDANCE}

${ANTI_PATTERNS}

=== YOUR OUTPUT (the bounds are enforced mechanically — a violation is rejected wholesale) ===
Plan epoch ${input.epoch}: at most ${cap} front(s), fewer when fewer are genuinely independent.
- \`epochGoal\`: the slice of the goal THIS epoch delivers, at most 400 characters.
- \`doneWhen\`: the objectively checkable criterion for the OVERALL goal, at most 600 characters — the same text every epoch, unless the code proves it needs sharpening.
- \`goalComplete\`: set it to true, with zero fronts, ONLY when the repository already satisfies \`doneWhen\`. That ends the session. When in doubt, plan an epoch.
- Each front has exactly eight fields, and every bound below is hard:
  - \`id\`: kebab-case, 3 to 40 characters, lowercase letters, digits and hyphens ONLY, starting and ending with a letter or digit (for example \`api-layer\`, \`web-client\`). No spaces, no slashes, no underscores, no capitals — it names a directory on disk.
  - \`title\`: at most 60 characters.
  - \`rationale\`: why this front is one unit of work, at most 400 characters.
  - \`dependsOnFronts\`: ids of OTHER fronts in this same epoch that must land first. Usually empty.
  - \`reconPrompt\`: at most 4000 characters.
  - \`workPrompt\`: at most 6000 characters.
  - \`verifyCondition\`: at most 1200 characters.
  - \`maxTasks\`: an integer from 1 to 40 — how many agents that front's swarm may use. Match it to how many independent, non-overlapping pieces of work the front genuinely has, not to how ambitious it sounds.

${DYNAMIC_BOUNDARY}

${historyBlock(input)}${evidence ? `\n\n${evidence}` : ''}${
    input.previousReport
      ? `\n\n=== PREVIOUS EPOCH REPORT ===\n${input.previousReport}\n\nIts "Pendências" and "Próximo passo" sections are the highest-signal input you have for this epoch.`
      : ''
  }
${knowledgeSummaryBlock(input, true)}${planningNotesBlock(input)}${methodologyBlock(input)}
${
    input.accumulatedPack?.trim()
      ? `=== ESTABLISHED EARLIER IN THIS SESSION (verified by agents in previous epochs) ===
${input.accumulatedPack.trim()}

Treat these as still true unless the briefings below contradict them — the briefings are newer and were gathered for THIS epoch. A gap listed here was already answered; do not plan work whose only purpose is to re-discover it.

`
      : ''
  }=== BRIEFINGS (everything you know about this repository) ===
${
  briefings ||
  '(none — no knowledge request was answered for this epoch, so you know NOTHING about this codebase beyond the goal itself)'
}

You did not read this repository; agents did, and the block above is what they reported back. Treat what it states as true, and treat everything it does not state as UNKNOWN. If it does not name a command, a framework, a directory or a file, you do not have one — telling an agent to use it does not make it exist.${
    briefings
      ? ''
      : ' With no briefings at all, plan ONE front and make its recon do the discovering; do not guess at a structure.'
  }`;
}

/**
 * The ONE guided repair round, shared by both stages.
 *
 * Same shape `assistant-architect.ts` already uses for an invalid pipeline:
 * hand the model back its OWN rejected output plus the verbatim validation
 * errors, and ask once more. Minimal edits — a redesign at this point usually
 * trades one violation for another.
 */
export function buildRepairPrompt(args: {
  /** What was being produced, for the opening line ("knowledge request", "plan"). */
  what: string;
  rejectedJson: string;
  issues: string;
}): string {
  return `The ${args.what} below failed huu's mechanical validation. Fix ONLY what the errors name — minimal edits, no redesign — and return the corrected ${args.what}.

# Validation errors (verbatim)

${args.issues}

# What you returned

${args.rejectedJson}

Re-read the field bounds you were given: ids are kebab-case with no spaces or capitals, every string has a maximum length, and every list has a maximum size. Keep the content you already had wherever it was valid.`;
}

/**
 * A deterministic single-front plan used when no LLM is available (stub
 * backend, `apiKey: 'stub'`). Keeps `huu dev --stub` a real end-to-end
 * smoke path: the pipeline compiles, the waves run, nothing calls out.
 */
export function stubPlanFronts(goal: string): {
  epochGoal: string;
  doneWhen: string;
} {
  const oneLine = goal.replace(/\s+/g, ' ').trim().slice(0, 200);
  return {
    epochGoal: `Stub epoch for: ${oneLine}`,
    doneWhen: `Stub: the repository satisfies "${oneLine}".`,
  };
}

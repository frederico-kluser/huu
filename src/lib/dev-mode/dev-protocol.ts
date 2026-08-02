// Shared prompt blocks for dev mode — the boilerplate the PLANNER never
// writes and can therefore never get wrong.
//
// The planner emits intent per front (what to look for, what to build, what
// proves it). Everything mechanical — where the blackboard lives, how a task
// spec is shaped, the conflict-avoidance rule, the skip list — is assembled
// here and is byte-identical across every front and every epoch. This is the
// same division of labour `knowledge-protocol.ts` uses for the bundled
// pipelines, and the reason a weak planner still produces a runnable epoch.
//

/**
 * Prefixed to EVERY agent prompt when the target project has a project-router
 * skill.
 *
 * THIS USED TO BE THE LITERAL STRING `/skill:project-router`, and it never once
 * did anything. Two independent reasons, both in the pi SDK:
 *  1. `_expandSkillCommand` (`core/agent-session.js`) returns the text
 *     untouched unless it STARTS with `/skill:` — and every huu message opens
 *     with the agent role header, so the token was never in position 0;
 *  2. huu's hermetic resource loader passed `noSkills: true`, so
 *     `project-router` was not even loaded to be found.
 *
 * (2) is now fixed by scoping skill discovery to the worktree
 * (`backends/pi/hermetic.ts`), which means pi lists every project skill in the
 * system prompt as `<available_skills>` with its description and path. So what
 * belongs here is no longer an invocation — it is the one thing the catalog
 * cannot say: that in THIS project the router is consulted FIRST. Kept short on
 * purpose; it is paid for on every prompt of every agent.
 */
export const ROUTER_PREFIX = `Before you act: this project's conventions are documented as agent skills, listed for you under <available_skills>. Read the \`project-router\` skill file first — it says which other skills apply to a task like this one — then read those. Use the \`read\` tool; there is no command for it.`;

/**
 * Prepend the router prefix to a prompt string, if the project has a router.
 * Returns the original prompt unchanged when `prefix` is falsy.
 */
export function prefixPrompt(prompt: string, prefix?: string): string {
  if (!prefix) return prompt;
  return `${prefix}\n\n${prompt}`;
}
// Keep this file pure (no fs / no env).

import { DEV_MODE_DIR } from '../types.js';

/** Blackboard path helpers — one place, so prompts and driver never drift. */
export const devPaths = {
  root: DEV_MODE_DIR,
  goal: `${DEV_MODE_DIR}/goal.md`,
  state: `${DEV_MODE_DIR}/state.json`,
  journal: `${DEV_MODE_DIR}/journal.md`,
  epochDir: (epoch: number): string => `${DEV_MODE_DIR}/epoch-${epoch}`,
  atlas: (epoch: number): string => `${DEV_MODE_DIR}/epoch-${epoch}/atlas.md`,
  /**
   * Directory of per-writer findings SHARDS. Deliberately not one shared file:
   * a fan-out wave has N agents all appending, they all commit, and the stage
   * merge is sequential — so one shared `findings.json` conflicts on every
   * branch after the first and hands the whole wave to the LLM conflict
   * resolver. Distinct filenames merge with zero conflict, and the
   * consolidation step folds them.
   */
  findingsDir: (epoch: number): string => `${DEV_MODE_DIR}/epoch-${epoch}/findings`,
  /** One writer's shard. `writer` must be unique within the epoch. */
  findings: (epoch: number, writer: string): string =>
    `${DEV_MODE_DIR}/epoch-${epoch}/findings/${writer}.json`,
  epochReport: (epoch: number): string => `${DEV_MODE_DIR}/epoch-${epoch}/report.md`,
  frontDir: (epoch: number, frontId: string): string => `${DEV_MODE_DIR}/epoch-${epoch}/${frontId}`,
  frontTasks: (epoch: number, frontId: string): string =>
    `${DEV_MODE_DIR}/epoch-${epoch}/${frontId}/tasks.json`,
  frontReport: (epoch: number, frontId: string): string =>
    `${DEV_MODE_DIR}/epoch-${epoch}/${frontId}/report.md`,
} as const;

/**
 * The same blackboard, NAMESPACED BY SESSION — `.huu/dev/<sessionId>/epoch-N/…`.
 *
 * WHY THIS EXISTS (it is a correctness fix, not tidiness).
 *
 * `resolveMemoryFiles` reads a step's `filesFrom` out of the INTEGRATION
 * worktree, which branches from the user's checkout — and the user's checkout,
 * after any previous session landed, CONTAINS a committed
 * `.huu/dev/epoch-1/<frontId>/tasks.json`. Front ids are semantic (`api`,
 * `tests`, `cli`), so a collision on epoch 1 of the next session is likely
 * rather than exotic. And `resolveMemoryFiles` performs NO validity check on
 * what it finds — just `existsSync`. So a new session whose recon fails, or
 * merely writes fewer specs, would fan out over the PREVIOUS SESSION'S SWARM:
 * real agents, real worktrees, work nobody asked for. One path segment turns
 * that from "improbable" into "impossible".
 *
 * The session index — `goal.md`, `state.json`, `journal.md` — deliberately
 * stays at the root (`devPaths`): it is the pointer INTO the sessions, and
 * `journal.md` is the one file that must accumulate across all of them.
 *
 * `devPaths` is kept intact and exported alongside; migrating its call sites is
 * a separate, compile-error-driven step.
 */
export interface DevSessionPaths {
  /** The session this instance is namespaced by. */
  sessionId: string;
  /** `.huu/dev/<sessionId>` — the root of everything this session's epochs write. */
  root: string;
  epochDir: (epoch: number) => string;
  atlas: (epoch: number) => string;
  /** See {@link devPaths.findingsDir} — one shard per writer, for the same reason. */
  findingsDir: (epoch: number) => string;
  findings: (epoch: number, writer: string) => string;
  epochReport: (epoch: number) => string;
  /**
   * The compiled epoch graph, persisted as a portable artefact. Today the
   * compiled pipeline is thrown away after the run; writing it here makes an
   * epoch reusable, editable and auditable — the property the project claims
   * for every OTHER pipeline.
   */
  pipeline: (epoch: number) => string;
  frontDir: (epoch: number, frontId: string) => string;
  frontTasks: (epoch: number, frontId: string) => string;
  frontReport: (epoch: number, frontId: string) => string;
  /** Per-task critic shards for one front — same anti-conflict rule as findings. */
  reviewDir: (epoch: number, frontId: string) => string;
  reviewFindings: (epoch: number, frontId: string, taskId: string) => string;
  /** Phase A (knowledge) — the gap specs, the briefs answering them, the digest. */
  knowledgeDir: (epoch: number) => string;
  gapsDir: (epoch: number) => string;
  /** One gap spec. `gapId` carries its own ordering prefix (`G-001-stack`). */
  gapFile: (epoch: number, gapId: string) => string;
  /** The huu-memory-v1 list of gap specs — written by the DRIVER, never by an LLM. */
  knowledgeIndex: (epoch: number) => string;
  briefsDir: (epoch: number) => string;
  /** One answering agent's brief, prose half. */
  brief: (epoch: number, gapId: string) => string;
  /** The same brief's structured half. */
  briefJson: (epoch: number, gapId: string) => string;
  /** The consolidated digest — the ONLY repo input the blind orchestrator sees. */
  knowledgeDigest: (epoch: number) => string;
}

/**
 * Builds the session-scoped path set. `sessionId` is used VERBATIM (never
 * sanitized): sanitizing would map two distinct ids onto one directory, which
 * is precisely the collision this namespacing exists to make impossible.
 * Anything that could escape or collapse the namespace is therefore rejected
 * outright — an empty id would silently degrade back to `.huu/dev/epoch-N/…`,
 * a separator would escape it, and whitespace would split into two argv tokens
 * the first time one of these paths reached `GitClient.exec`.
 */
export function devSessionPaths(sessionId: string): DevSessionPaths {
  if (
    sessionId.length === 0 ||
    /\s/.test(sessionId) ||
    sessionId.includes('/') ||
    sessionId.includes('\\') ||
    sessionId === '.' ||
    sessionId === '..'
  ) {
    throw new Error(
      `invalid dev session id ${JSON.stringify(sessionId)}: must be a non-empty single path segment`,
    );
  }

  const root = `${DEV_MODE_DIR}/${sessionId}`;
  const epochDir = (epoch: number): string => `${root}/epoch-${epoch}`;
  const frontDir = (epoch: number, frontId: string): string => `${epochDir(epoch)}/${frontId}`;
  const knowledgeDir = (epoch: number): string => `${epochDir(epoch)}/knowledge`;
  const gapsDir = (epoch: number): string => `${knowledgeDir(epoch)}/gaps`;
  const briefsDir = (epoch: number): string => `${knowledgeDir(epoch)}/briefs`;
  const reviewDir = (epoch: number, frontId: string): string => `${frontDir(epoch, frontId)}/review`;

  return {
    sessionId,
    root,
    epochDir,
    atlas: (epoch) => `${epochDir(epoch)}/atlas.md`,
    findingsDir: (epoch) => `${epochDir(epoch)}/findings`,
    findings: (epoch, writer) => `${epochDir(epoch)}/findings/${writer}.json`,
    epochReport: (epoch) => `${epochDir(epoch)}/report.md`,
    pipeline: (epoch) => `${epochDir(epoch)}/pipeline.json`,
    frontDir,
    frontTasks: (epoch, frontId) => `${frontDir(epoch, frontId)}/tasks.json`,
    frontReport: (epoch, frontId) => `${frontDir(epoch, frontId)}/report.md`,
    reviewDir,
    reviewFindings: (epoch, frontId, taskId) => `${reviewDir(epoch, frontId)}/${taskId}.json`,
    knowledgeDir,
    gapsDir,
    gapFile: (epoch, gapId) => `${gapsDir(epoch)}/${gapId}.md`,
    knowledgeIndex: (epoch) => `${knowledgeDir(epoch)}/index.json`,
    briefsDir,
    brief: (epoch, gapId) => `${briefsDir(epoch)}/${gapId}.md`,
    briefJson: (epoch, gapId) => `${briefsDir(epoch)}/${gapId}.json`,
    knowledgeDigest: (epoch) => `${knowledgeDir(epoch)}/digest.md`,
  };
}

/**
 * The visible split between the CACHEABLE stable prefix of a compiled step
 * prompt and its per-epoch, per-front, per-agent tail — the same device
 * `planner-prompts.ts` already uses for the two planner calls, and the same
 * idea as Claude Code's `__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__`.
 *
 * It matters more HERE than it does for the planner. The planner is two calls
 * an epoch; the swarm is N agents × long prompts, so the swarm is where the
 * token bill actually is — and it was exactly where huu interleaved fixed and
 * variable text freely, destroying any shared prefix.
 *
 * Be honest about the ceiling: `$file` and `$hint` are substituted per agent,
 * so the tail can never be shared. What the reorder buys is that everything
 * ABOVE this line is byte-identical across every agent of every front of the
 * epoch — the router pointer, the discipline block and the skip rule.
 */
export const DEV_STEP_BOUNDARY = '--- TASK-SPECIFIC CONTEXT BELOW ---';

/** Paths no agent should read as work targets or list as a task spec. */
export const DEV_SKIP_RULE = `=== SKIP RULE ===
Never treat these as work targets: \`node_modules/\`, \`dist/\`, \`build/\`, \`out/\`, \`coverage/\`, \`.git/\`, \`vendor/\`, \`target/\`, \`__pycache__/\`, \`*.generated.*\`, \`*.min.js\`, \`*.min.css\`, \`*.d.ts\`, \`*.lock\`, \`*.snap\`.`;

/** The one-line schema every dev-mode findings entry uses. */
export const DEV_FINDINGS_SCHEMA_LINE =
  '{ "front": "<front id>", "task": "<task id or \'recon\'>", "kind": "decision|risk|blocker|done", "summary": "<one line>", "files": ["<repo-relative path>"] }';

/**
 * The block that turns a front's recon into a TASK-SPEC producer.
 *
 * Two hard mechanics the planner must not be trusted with:
 *  1. Every listed path must EXIST in the worktree — `resolveMemoryFiles`
 *     silently drops entries that don't, and a list where NOTHING resolves
 *     fails the run. So the recon writes a real spec FILE per task and lists
 *     those files, never source paths it merely intends to change.
 *  2. Parallel task agents merge deterministically at the stage boundary, so
 *     two specs that edit the same file WILL conflict. Partitioning by file
 *     ownership is the recon's single most important job.
 *
 * The huu-memory-v1 format itself is NOT described here — the step declares
 * `produces`, so the orchestrator appends the exact MEMORY CONTRACT at run
 * time (`src/lib/memory-contract.ts`).
 */
export function taskSpecContract(epoch: number, frontId: string, maxTasks: number): string {
  const dir = devPaths.frontDir(epoch, frontId);
  return `=== TASK SPECS (write these BEFORE the memory file) ===
Split this front into at most ${maxTasks} INDEPENDENT tasks and write one spec file per task at \`${dir}/T-001.md\`, \`${dir}/T-002.md\`, … (zero-padded, in priority order). Create the directory if needed.

Each spec is the COMPLETE briefing for one agent that will work alone, in its own worktree, with no access to you and no knowledge of the other tasks. Write it as:

\`\`\`markdown
# T-00N — <imperative title>

## Objective
<what must be true when this task is done — one paragraph>

## Files this task OWNS
- <repo-relative path> — <why>
(An agent may READ anything; it may only WRITE the files listed here.)

## Steps
1. <concrete action>
2. …

## Done when
- <objectively checkable statement>
- <…>

## Context
<the specific facts this agent needs and cannot cheaply rediscover: existing
APIs to reuse, conventions to match, the surrounding design decision>
\`\`\`

=== PARTITIONING RULE (the one that decides whether this front merges cleanly) ===
The task agents run IN PARALLEL and their branches are merged deterministically at the end of the stage. Two tasks that write the SAME file will conflict.
- Give every file exactly ONE owning task. If two pieces of work need the same file, they are ONE task, not two.
- Prefer fewer, well-partitioned tasks over many overlapping ones. One task is a perfectly good answer.
- If a change must touch a shared file (a router, a barrel, an index), assign that file to a single task and say so in the other specs' Context.

=== HARD RULES ===
- Write ONLY under \`${dir}/\` in this step. Do not modify source; you are planning, not building.
- If \`${devPaths.frontTasks(epoch, frontId)}\` already exists, REPLACE it wholesale with the list you just wrote — never merge it with what is already there. A leftover entry points at a spec from other work entirely, and the fan-out that reads this file does not validate what it finds: it would dispatch an agent against it.
- Every spec file you list in the memory file must exist on disk when you finish — an entry whose path does not resolve is dropped.
- An EMPTY task list is valid and means "nothing to do on this front"; the fan-out then runs zero agents.`;
}

/**
 * Preamble for a task agent. `$file` resolves to the spec path and `$hint` to
 * the recon's one-line summary — both substituted by the orchestrator.
 */
export function taskWorkPreamble(epoch: number, frontId: string): string {
  return `You are one agent in a parallel swarm working on the "${frontId}" front. Your ENTIRE assignment is the spec file \`$file\`.

Summary from the planner: $hint

=== PROCEDURE ===
1. Read \`$file\` in full. It names the files you OWN and the criteria for done.
2. Read \`${devPaths.goal}\` for the overall goal, and \`${devPaths.atlas(epoch)}\` for the map of the codebase produced this epoch.
3. Do the work.
4. Verify it yourself against the spec's "Done when" list before finishing.

=== OWNERSHIP (non-negotiable) ===
- Write ONLY the files your spec lists under "Files this task OWNS", plus YOUR OWN findings shard (named below).
- You may READ anything. Other agents are editing other files RIGHT NOW; touching a file you don't own produces a merge conflict that costs the whole stage.
- Never edit another task's spec, another front's directory, or \`${devPaths.state}\`.

=== WHEN THE SPEC IS WRONG ===
If the spec is impossible, already done, or contradicted by the code, do NOT improvise a different task. Do the part that is valid, then record a \`"kind": "blocker"\` finding explaining exactly what was wrong. The next epoch's planner reads it.`;
}

/**
 * The shared-memory protocol block.
 *
 * `writer` names THIS agent's shard. Reading is shared (glob the directory);
 * writing is exclusive to one file per agent — which is what makes a parallel
 * wave merge cleanly. Pass `null` for a step whose writer name is only known
 * at run time (a task agent derives it from its spec filename).
 */
export function devFindingsProtocol(epoch: number, writer: string | null): string {
  const dir = devPaths.findingsDir(epoch);
  const own = writer === null
    ? `\`${dir}/<front>-<the basename of \`$file\` without its extension>.json\` — e.g. a spec at \`${dir.replace('/findings', '')}/api/T-003.md\` writes \`${dir}/api-T-003.json\``
    : `\`${devPaths.findings(epoch, writer)}\``;
  return `=== SHARED MEMORY ===
\`${dir}/\` holds this epoch's shared memory as one JSON file PER WRITER. Reading is shared; writing is not.
1. BEFORE acting: read EVERY \`*.json\` in \`${dir}/\` (each is a JSON array). Build on what other agents already discovered; do not re-derive solved facts.
2. WRITE AS YOU GO, not at the end. Your own file is ${own} — a JSON array of entries shaped:
   ${DEV_FINDINGS_SCHEMA_LINE}
   Create it with your first real finding, and REWRITE it whole each time you learn something worth another agent's time. Waiting until you finish means a card that times out, is preempted, or has its context compacted takes everything it learned with it — and that is the common case, not the rare one. A file on disk is the only memory this epoch actually keeps.
3. NEVER write to another agent's file, and never to a single shared \`findings.json\`. Other agents are running RIGHT NOW; one file per writer is what lets your branches merge without conflicting.
4. Create the directory if it does not exist. If your own file already exists (you are a retry, or an earlier turn of your own), replace it wholesale with your current findings.`;
}

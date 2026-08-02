// `runDevMode` — the development-mode driver.
//
// Dev mode is the one huu flow whose step graph is written at run time. The
// driver is what makes that safe: it never lets a planner decide anything
// structural. The sequence per session is fixed, and a human wrote the goal.
//
//   Session   resume or start fresh, then report integration branches an
//             earlier session left behind.
//   Phase 0   knowledge gate — probe the repo for agent skills; if it has
//             none, run a pi agent (deepseek-v4-pro) with the knowledge-
//             skills-architect prompt to bootstrap them.
//   Phase 1..N  epochs. An epoch is TWO runs, not one, because the plan can
//             only exist after the knowledge arrived:
//
//               A. KNOWLEDGE (run #1, a FIXED pipeline nobody plans)
//                  The blind orchestrator declares what it needs to know;
//                  huu materializes one real spec file per gap, COMMITS them,
//                  and a fan-out of agents with a shell answers them into one
//                  consolidated digest.
//               B. PLAN (no run)
//                  The same orchestrator plans the epoch against that digest —
//                  the only thing about this repository it ever reads — and
//                  the compiled graph is persisted as a portable artefact.
//               C. EXECUTION (run #2, the planned pipeline)
//                  → land → collect structured evidence → replan.
//
//             Zero gaps ⇒ Phase A is skipped and the epoch is one run, exactly
//             as it has always been.
//
// Layering note: like `run-many.ts`, this module lives in `lib/` yet imports
// `orchestrator/` — the established exception for run DRIVERS. Everything
// below it (the planner, the compilers, the protocol blocks) stays pure.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { runKnowledgeBootstrap, type BootstrapEvent } from './knowledge-bootstrap.js';
import { Orchestrator } from '../../orchestrator/index.js';
import { GitClient } from '../../git/git-client.js';
import type { AgentFactory } from '../../orchestrator/types.js';
import type { LlmClientContext } from '../llm-client-factory.js';
import { detectKnowledge, type KnowledgeStatus } from '../knowledge-detect.js';
import { generateRunId } from '../run-id.js';
import {
  deadDevModelRungs,
  formatDevModelPreflightError,
  isPiModelKnown,
  preflightDevModelPolicy,
} from '../model-registry-check.js';
import type {
  AppConfig,
  DevEpochRecord,
  DevModeConfig,
  DevPlan,
  DevState,
  DevVerifyCommands,
  OrchestratorState,
  Pipeline,
} from '../types.js';
import { DEV_MAX_FRONTS, DEV_MAX_GAPS, DEV_UNBOUNDED_EPOCH_BACKSTOP } from '../types.js';
import { compileEpochPipeline } from './plan-to-pipeline.js';
import { detectChangelogPaths } from './changelog-surface.js';
import { PipelineSchema } from '../pipeline-io.js';
import { checkWritePartition, formatWritePartitionViolations, type TaskSpec } from './write-partition.js';
import { compileKnowledgePipeline } from './knowledge-to-pipeline.js';
import { landEpoch, type LandEpochResult } from './epoch-landing.js';
import { devPaths, devSessionPaths, ROUTER_PREFIX, type DevSessionPaths } from './dev-protocol.js';
import { collapseDevModelPolicy, pickModelRung, resolveDevModels } from './dev-model-policy.js';
import type { KnowledgeGap, KnowledgeRequest } from './knowledge-schema.js';
import {
  FITNESS_COMMANDS_GAP,
  KNOWLEDGE_DIGEST_MAX_CHARS,
  assembleAccumulatedKnowledge,
  extractVerifyCommands,
  flattenVerifyCommands,
  mergeBaselineGaps,
  readAccumulatedBriefs,
  readKnowledgeDigest,
  writeKnowledgeGaps,
} from './knowledge-blackboard.js';
import {
  MAX_VIOLATION_TASKS,
  collectEpochEvidence,
  formatInstrumentationLine,
  readLandedDiffStat,
} from './epoch-evidence.js';
import { findOrphanIntegrationBranches, type OrphanBranch } from './orphan-branches.js';
import {
  planEpoch,
  planKnowledge,
  type PlanEpochOptions,
  type PlanKnowledgeOptions,
} from './planner.js';
import {
  DEV_STATE_FORMAT,
  commitBlackboard,
  foreignDirtyPaths,
  readDevState,
  readEpochReport,
  writeDevState,
  writeGoalFile,
} from './dev-state.js';

/** Why the session stopped. Every exit takes exactly one of these. */
export type DevStopReason =
  | 'goal-complete'
  | 'max-epochs'
  | 'plan-rejected'
  | 'planner-failed'
  | 'empty-plan'
  | 'run-failed'
  | 'landing-failed'
  | 'consecutive-failures'
  | 'cost-ceiling'
  | 'graceful-stop'
  | 'bootstrap-failed'
  | 'knowledge-failed'
  | 'model-preflight-failed'
  | 'dirty-tree'
  | 'aborted';

/**
 * Consecutive FAILED epochs the driver tolerates before stopping the session
 * (`'consecutive-failures'`). One bad epoch is often just a bad epoch — its
 * partial work lands and the next planner sees it on disk — but this many in
 * a row is a failure that is not recovering, and an unattended session must
 * not retry it forever. The shape of Claude Code's
 * `MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES = 3`, adopted for the same incident:
 * sessions looping on a failure that never recovers, burning API calls.
 * Exported for tests.
 */
export const MAX_CONSECUTIVE_EPOCH_FAILURES = 3;

export type DevEvent =
  | { type: 'knowledge'; status: KnowledgeStatus }
  | { type: 'bootstrap-start'; model: string }
  | { type: 'bootstrap-progress'; message: string }
  | { type: 'bootstrap-done'; ok: boolean }
  | { type: 'planning'; epoch: number }
  | { type: 'planned'; epoch: number; plan: DevPlan; warnings: string[] }
  | { type: 'epoch-start'; epoch: number; pipeline: Pipeline }
  | { type: 'epoch-done'; record: DevEpochRecord }
  | { type: 'stopped'; reason: DevStopReason; detail?: string }
  | { type: 'log'; level: 'info' | 'warn' | 'error'; message: string };

/**
 * Which run of the session an orchestrator is being built for.
 *
 * The surfaces care: a `bootstrap` run predates epoch 1 and floods the
 * machine, a `knowledge` run is the epoch's cheap two-step retrieval phase,
 * and a `work` run is the planned epoch. All three are ordinary huu runs and
 * all three now go through the SAME factory — which is what gives the
 * bootstrap a run id, SSE frames and an abort handle it never had.
 */
export type DevRunPhase = 'bootstrap' | 'knowledge' | 'work';

/** What a caller wants done with integration branches an earlier session left. */
export type OrphanAction = 'land' | 'ignore';

export interface RunDevModeArgs {
  dev: DevModeConfig;
  config: AppConfig;
  /** The user's checkout. Epochs accumulate on its current branch. */
  cwd: string;
  agentFactory: AgentFactory;
  conflictResolverFactory?: AgentFactory;
  concurrency?: number;
  autoScale?: boolean;
  cardTimeoutMs?: number;
  singleFileCardTimeoutMs?: number;
  /**
   * Names the session's blackboard namespace (`.huu/dev/<sessionId>/…`).
   * Absent ⇒ generated. A value that is not a usable single path segment is
   * refused with a warning and replaced by a generated one: an unusable id
   * must not cost the session, and collapsing it into a shared directory is
   * exactly the collision the namespace exists to prevent.
   */
  sessionId?: string;
  /**
   * `'auto'` resumes a matching session without asking; `'never'` never does.
   * Undefined defers to {@link RunDevModeArgs.onResumeOffer}, and with no
   * callback wired the answer is NO — a fresh session, so every existing
   * caller keeps behaving exactly as it does today.
   */
  resume?: 'auto' | 'never';
  /**
   * Asked once, before the knowledge gate, when the previous session's state
   * carries the SAME goal and never reported it complete. Return true to
   * continue that session: same `sessionId`, epoch numbering continued, its
   * epochs seeded as history.
   */
  onResumeOffer?: (state: DevState, nextEpoch: number) => boolean | Promise<boolean>;
  /**
   * Called when integration branches from earlier runs are not contained in
   * HEAD — genuinely lost work that `git status` cannot show. `'land'` merges
   * them oldest epoch first; `'ignore'` just names them. With no callback the
   * driver warns and continues: a forgotten branch must never block a new
   * session.
   */
  onOrphanBranches?: (orphans: OrphanBranch[]) => OrphanAction | Promise<OrphanAction>;
  onEvent?: (event: DevEvent) => void;
  /** Mirrors each running orchestrator's state (kanban, logs, budget). */
  onState?: (state: OrchestratorState, epoch: number) => void;
  /**
   * Approval gate. Called with every compiled plan when
   * `dev.approval === 'each-epoch'`; resolve false to end the session.
   * Ignored in `'autonomous'` mode.
   */
  onApprove?: (plan: DevPlan, epoch: number, warnings: string[]) => boolean | Promise<boolean>;
  /** Test seam: replaces the planner (and therefore every LLM call). */
  planner?: (opts: PlanEpochOptions) => Promise<DevPlan>;
  /** Test seam: replaces stage one, the blind orchestrator's knowledge request. */
  knowledgePlanner?: (opts: PlanKnowledgeOptions) => Promise<KnowledgeRequest>;
  /**
   * Stops the session. Checked at every boundary (before planning, before the
   * knowledge run, between the epoch's two runs, before the approval gate,
   * before landing, and at the top of each epoch), and it aborts the live
   * run. An epoch interrupted this way is NOT landed — see below for why.
   */
  signal?: AbortSignal;
  /**
   * STOP AFTER THE CURRENT EPOCH LANDS.
   *
   * `signal` is a hard abort: the live run is cut, and an aborted epoch is
   * deliberately NOT landed (its agents were killed mid-flight and no judge saw
   * the result). That is correct for "stop, this is going wrong" and much too
   * blunt for "stop when you reach a good place" — pressing it costs the merge
   * of every front that had already passed its judge.
   *
   * This signal is the second one. It is checked only at epoch boundaries, so
   * the epoch in flight runs to completion, lands, records its evidence, and
   * THEN the session ends cleanly. Absent ⇒ nothing changes.
   */
  gracefulSignal?: AbortSignal;
  /** Test seam: replaces orchestrator construction. */
  orchestratorFactory?: (pipeline: Pipeline, epoch: number, phase: DevRunPhase) => DevRunHandle;
}

/** The slice of `Orchestrator` the driver actually uses. */
export interface DevRunHandle {
  subscribe(listener: (state: OrchestratorState) => void): () => void;
  start(): Promise<{
    manifest: { runId: string; status: string; integrationBranch: string };
    /**
     * What the run cost. It sits beside the manifest rather than inside it
     * because `RunManifest` carries no cost field — `OrchestratorResult` does.
     * Optional so a handle that cannot report one simply doesn't; the driver
     * then falls back to the last state it observed.
     */
    totalCost?: number;
  }>;
  abort(): void;
  /**
   * Flood mode (one agent per queued task, the memory guard as the only
   * backstop). Used for the knowledge BOOTSTRAP, which should take the whole
   * machine. Optional: a handle that cannot flood just runs narrower.
   */
  setGreedy?(): void;
}

export interface DevModeResult {
  stoppedBecause: DevStopReason;
  detail?: string;
  epochs: DevEpochRecord[];
  goalComplete: boolean;
  knowledge: KnowledgeStatus;
  knowledgeBootstrapped: boolean;
  /** The blackboard namespace this session used — `.huu/dev/<sessionId>/`. */
  sessionId: string;
  /** True when this session continued a previous one's epoch numbering. */
  resumed: boolean;
}

/** What one orchestrator run produced, in the terms the driver reasons about. */
interface RunOutcome {
  runId: string;
  /** `''` when the run never produced one. */
  branch: string;
  /** Manifest status was `done`. */
  ok: boolean;
  /** The abort signal fired while this run was live. */
  interrupted: boolean;
  /** Last state the run emitted — the input to `collectEpochEvidence`. */
  state: OrchestratorState | null;
  totalCost?: number;
}

function nowIso(): string {
  return new Date().toISOString();
}

function summarizeKnowledge(status: KnowledgeStatus): string | undefined {
  if (!status.present) return undefined;
  const where = status.catalogPath ?? `.${status.surface}/skills/`;
  return `This project documents its own conventions as agent skills: ${status.skillCount} skill(s) (${status.skills.join(', ')}), routed by \`${where}\`. Read the relevant ones before deciding anything they already answer.`;
}

function writeFileEnsuringDir(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf8');
}

/** `devSessionPaths` for an id that may be junk, without throwing. */
function safeSessionPaths(sessionId: string): DevSessionPaths | null {
  try {
    return devSessionPaths(sessionId);
  } catch {
    return null;
  }
}

/**
 * The consolidation step's report for `epoch`.
 *
 * Session-scoped first, because that is where a compiled epoch writes it. The
 * fallback reads the pre-namespacing location (`.huu/dev/epoch-N/report.md`),
 * which is all a blackboard left by an older huu ever had.
 */
function readEpochReportFor(
  cwd: string,
  paths: DevSessionPaths,
  epoch: number,
): string | undefined {
  const scoped = join(cwd, paths.epochReport(epoch));
  if (existsSync(scoped)) {
    try {
      const text = readFileSync(scoped, 'utf8');
      if (text.trim().length > 0) return text;
    } catch {
      /* fall through to the legacy location */
    }
  }
  return readEpochReport(cwd, epoch);
}

/** Names the branch that holds work huu deliberately did not merge. */
function unlandedDetail(branch: string, why: string): string {
  return branch
    ? `${why} — not landed; the partial work is on \`${branch}\` (merge it yourself with \`git merge ${branch}\` if you want it)`
    : `${why} before the run produced an integration branch`;
}

/**
 * Recursively scan a directory for task spec files (`.md` files whose content
 * has an ownership heading — `## Files this task OWNS`, or any heading whose
 * title names both "own(s)" and "file(s)", in either order, exactly the gate
 * {@link checkWritePartition}'s parser applies) and return them as
 * {@link TaskSpec} entries.
 */
function scanSpecs(root: string): TaskSpec[] {
  const specs: TaskSpec[] = [];
  if (!existsSync(root)) return specs;
  const entries = readdirSync(root, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(root, entry.name);
    if (entry.isDirectory()) {
      specs.push(...scanSpecs(full));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      try {
        const content = readFileSync(full, 'utf8');
        if (/^#{1,6}\s+(?=.*\bowns?\b)(?=.*\bfiles?\b)/im.test(content)) {
          specs.push({ path: full, content });
        }
      } catch {
        // Unreadable file — skip.
      }
    }
  }
  return specs;
}
/**
 * Run a full dev-mode session. Never throws for an expected failure — every
 * stop path comes back as a `DevModeResult` so the CLI and the web surface
 * can report the same thing.
 */
export async function runDevMode(args: RunDevModeArgs): Promise<DevModeResult> {
  const { dev, config, cwd } = args;
  const emit = (event: DevEvent): void => {
    try {
      args.onEvent?.(event);
    } catch {
      /* an observer must never take the session down */
    }
  };
  const log = (level: 'info' | 'warn' | 'error', message: string): void =>
    emit({ type: 'log', level, message });

  const git = new GitClient(cwd);
  // No ceiling configured ⇒ run until the goal is reported complete, the
  // consecutive-failure circuit breaker trips, or the caller aborts. The
  // backstop is not a product limit, it is the thing that keeps an unattended
  // session from looping forever on a planner that never says "done".
  const unboundedEpochs = dev.maxEpochs === undefined;
  const maxEpochs = unboundedEpochs
    ? DEV_UNBOUNDED_EPOCH_BACKSTOP
    : Math.max(1, dev.maxEpochs!);
  const maxFronts = Math.min(Math.max(1, dev.maxFronts ?? DEV_MAX_FRONTS), DEV_MAX_FRONTS);
  const aborted = (): boolean => args.signal?.aborted === true;
  const stopRequested = (): boolean => args.gracefulSignal?.aborted === true;
  const epochs: DevEpochRecord[] = [];

  // Every role, resolved. Only `planner` is read from here — it is the one
  // call the driver makes itself. The compilers get the RAW policy, because a
  // role it does not name must keep OMITTING `modelId` so the orchestrator's
  // own `AppConfig.modelId` fallback stays the single authority.
  const models = resolveDevModels(
    dev.models,
    config.modelId,
    (config.backend ?? 'pi') === 'pi' ? isPiModelKnown : undefined,
  );

  let sessionId = args.sessionId?.trim() || generateRunId();
  let resumed = false;
  /** Set on resume when a previous session died with an epoch mid-EXECUTION. */
  let resumePending: DevState['pendingEpoch'];

  const state: DevState = {
    _format: DEV_STATE_FORMAT,
    goal: dev.goal,
    doneWhen: '',
    epochs,
    goalComplete: false,
    updatedAt: nowIso(),
    sessionId,
  };

  const persist = async (message: string, extraPaths: readonly string[] = []): Promise<void> => {
    state.updatedAt = nowIso();
    state.sessionId = sessionId;
    writeGoalFile(cwd, dev.goal);
    writeDevState(cwd, state);
    try {
      const sha = await commitBlackboard(git, cwd, message, extraPaths);
      if (sha) log('info', `blackboard commited (${sha.slice(0, 8)})`);
    } catch (err) {
      // Not fatal on its own, but the next landing merge will refuse on the
      // resulting dirty tree — so say it loudly.
      log('warn', `could not commit the dev blackboard: ${message_(err)}. The next epoch's landing may refuse on a dirty tree.`);
    }
  };

  const finish = (reason: DevStopReason, knowledge: KnowledgeStatus, bootstrapped: boolean, detail?: string): DevModeResult => {
    emit({ type: 'stopped', reason, detail });
    return {
      stoppedBecause: reason,
      detail,
      epochs,
      goalComplete: state.goalComplete,
      knowledge,
      knowledgeBootstrapped: bootstrapped,
      sessionId,
      resumed,
    };
  };

  /**
   * One orchestrator run, whatever its phase. Owning construction, the abort
   * wiring, the state mirror and the cost read in ONE place is what let the
   * bootstrap join the same path as the epochs — it used to build its
   * `Orchestrator` inline, which is why it had no run id, no frames and no
   * abort handle.
   */
  const runPipeline = async (
    pipeline: Pipeline,
    epochForState: number,
    phase: DevRunPhase,
  ): Promise<RunOutcome> => {
    const handle: DevRunHandle =
      args.orchestratorFactory?.(pipeline, epochForState, phase) ??
      wrapOrchestrator(
        new Orchestrator(config, pipeline, cwd, args.agentFactory, {
          initialConcurrency: args.concurrency,
          conflictResolverFactory: args.conflictResolverFactory,
          autoScale: args.autoScale ?? args.concurrency === undefined,
        }),
      );

    // An abort DURING the run has to reach the orchestrator, and the orchestrator
    // resolves an aborted run as `done` (index.ts forces the terminal status),
    // so the manifest can never tell us it was interrupted. Track it here.
    let interrupted = false;
    const onAbort = (): void => {
      interrupted = true;
      try {
        handle.abort();
      } catch (err) {
        log('warn', `${phase} run: abort failed: ${message_(err)}`);
      }
    };
    if (aborted()) onAbort();
    args.signal?.addEventListener('abort', onAbort, { once: true });

    // A one-slot holder rather than a bare `let`: the subscription writes it
    // from a callback, and a captured `let` keeps its initializer's type for
    // the reader below. Holding the last state here is also what makes the
    // evidence free — `DevRunHandle` needs no new member for it, because the
    // driver already receives every state the run emits.
    const observed: { last: OrchestratorState | null } = { last: null };
    const unsubscribe = handle.subscribe((s) => {
      observed.last = s;
      args.onState?.(s, epochForState);
    });

    let runId = '';
    let branch = '';
    let ok = false;
    let totalCost: number | undefined;
    try {
      const result = await handle.start();
      runId = result.manifest.runId;
      branch = result.manifest.integrationBranch;
      ok = result.manifest.status === 'done';
      totalCost = result.totalCost;
    } catch (err) {
      log('error', `${phase} run failed: ${message_(err)}`);
    } finally {
      unsubscribe();
      args.signal?.removeEventListener('abort', onAbort);
    }

    return {
      runId,
      branch,
      ok,
      interrupted,
      state: observed.last,
      totalCost: totalCost ?? observed.last?.totalCost,
    };
  };

  /**
   * Integration branches HEAD never absorbed — a crash, a Ctrl-C, a conflicted
   * landing. It is genuinely lost work and it is invisible (`git status` is
   * clean, the files are simply not there), so a new session says what it
   * found. It NEVER blocks: with no callback, or with a landing that fails,
   * the session continues and the branch is named.
   */
  const handleOrphanBranches = async (): Promise<void> => {
    let orphans: OrphanBranch[];
    try {
      orphans = await findOrphanIntegrationBranches(git, epochs);
    } catch (err) {
      log('warn', `could not scan for orphan integration branches: ${message_(err)}`);
      return;
    }
    if (orphans.length === 0) return;

    const describe = (o: OrphanBranch): string =>
      `\`${o.branch}\` (${o.ahead} commit(s)${o.epoch === undefined ? '' : `, epoch ${o.epoch}`})`;
    log('warn', `${orphans.length} integration branch(es) never landed: ${orphans.map(describe).join(', ')}`);

    let action: OrphanAction = 'ignore';
    if (args.onOrphanBranches) {
      try {
        action = await Promise.resolve(args.onOrphanBranches(orphans));
      } catch (err) {
        log('warn', `the orphan-branch offer threw (${message_(err)}) — leaving them alone`);
        action = 'ignore';
      }
    }

    if (action !== 'land') {
      for (const orphan of orphans) {
        log('warn', `left behind: ${describe(orphan)} — land it yourself with \`git merge ${orphan.branch}\``);
      }
      return;
    }

    // Ascending epoch order (`findOrphanIntegrationBranches` sorts them):
    // merging an older epoch after a newer one replays history backwards.
    for (const orphan of orphans) {
      const landing = await landEpoch({ cwd, integrationBranch: orphan.branch, epoch: orphan.epoch ?? 0 });
      if (landing.landed) {
        log('info', `landed orphan ${orphan.branch}${landing.commit ? ` at ${landing.commit.slice(0, 8)}` : ''}`);
      } else {
        log('warn', `could not land ${orphan.branch}: ${landing.error} — land it yourself with \`git merge ${orphan.branch}\``);
      }
    }
  };

  // --- Phase 0: the knowledge gate ---------------------------------------
  let knowledge = detectKnowledge(cwd);
  emit({ type: 'knowledge', status: knowledge });
  log('info', `knowledge probe: ${knowledge.present ? 'present' : 'absent'} — ${knowledge.reason}`);

  // Model routing is checked BEFORE anything is created. Left to itself, an id
  // the pi registry has never heard of throws inside the first agent — after
  // its worktree and branch already exist. `planner` is deliberately exempt:
  // it runs through the structured-output client, not the pi registry.
  const modelIssues = preflightDevModelPolicy(dev.models, config.backend ?? 'pi');
  if (modelIssues.length > 0) {
    return finish('model-preflight-failed', knowledge, false, formatDevModelPreflightError(modelIssues));
  }
  // A chain that has quietly degraded to a later rung still runs — but silently
  // running on the fallback is how a routing decision stops being a decision.
  for (const degraded of deadDevModelRungs(dev.models, config.backend ?? 'pi')) {
    log(
      'warn',
      `model routing: ${degraded.role} skipped ${degraded.dead.join(', ')} (not in the pi registry) and will run on ${degraded.using}`,
    );
  }

  // Fail fast on the user's own uncommitted work. Every epoch ends in a merge
  // into this branch, and that merge refuses on a dirty tree — better to say
  // so now than after the first epoch has burned a swarm.
  try {
    const foreign = await foreignDirtyPaths(git, cwd);
    if (foreign.length > 0) {
      return finish(
        'dirty-tree',
        knowledge,
        false,
        `the working tree has uncommitted changes huu does not own (${foreign.slice(0, 5).join(', ')}${
          foreign.length > 5 ? `, +${foreign.length - 5} more` : ''
        }) — commit or stash them first; every epoch ends in a merge into this branch`,
      );
    }
  } catch (err) {
    log('warn', `could not read the working tree state: ${message_(err)}`);
  }

  // --- Session: resume, or start a new one -------------------------------
  //
  // A DIFFERENT goal is a different session, full stop: continuing one
  // session's epoch numbering under another's goal is how the planner ends up
  // reading history that never applied to what it is being asked to do.
  const previous = readDevState(cwd);
  const previousSession = previous?.sessionId?.trim();

  if (
    previous !== null &&
    // A v1 state file has no session, and an id that is not a path segment
    // cannot address its own blackboard — neither can be attributed to, so
    // neither is resumable. (`readDevState` already refuses a foreign format.)
    previousSession !== undefined &&
    safeSessionPaths(previousSession) !== null &&
    previous.goal.trim() === dev.goal.trim() &&
    !previous.goalComplete &&
    args.resume !== 'never'
  ) {
    const nextEpoch = previous.epochs.length + 1;
    let accept = args.resume === 'auto';
    if (!accept && args.onResumeOffer) {
      try {
        accept = (await Promise.resolve(args.onResumeOffer(previous, nextEpoch))) === true;
      } catch (err) {
        log('warn', `the resume offer threw (${message_(err)}) — starting a new session`);
        accept = false;
      }
    }
    if (accept) {
      resumed = true;
      sessionId = previousSession;
      state.sessionId = sessionId;
      state.doneWhen = previous.doneWhen;
      // The commands the previous session extracted stay the critic's anchor —
      // the baseline gap that produced them is never asked again.
      if (isUsableVerifyCommands(previous.verifyCommands)) {
        state.verifyCommands = previous.verifyCommands;
      }
      // An epoch whose EXECUTION run started and never finished. Its compiled
      // graph is a committed artefact; re-running it is strictly cheaper and
      // strictly more faithful than re-buying the knowledge run and asking a
      // planner to reproduce a plan it can no longer see.
      if (
        previous.pendingEpoch &&
        Number.isInteger(previous.pendingEpoch.epoch) &&
        existsSync(join(cwd, previous.pendingEpoch.pipelinePath))
      ) {
        resumePending = previous.pendingEpoch;
      }
      // Seeded, not just counted: history and the previous epoch's structured
      // evidence are what the next planning pass reads.
      epochs.push(...previous.epochs);
      log('info', `resuming session ${sessionId} at epoch ${nextEpoch} (${epochs.length} epoch(s) already done)`);
    }
  }

  let paths = safeSessionPaths(sessionId);
  if (!paths) {
    const generated = generateRunId();
    log(
      'warn',
      `dev session id ${JSON.stringify(sessionId)} is not a usable path segment — this session's blackboard goes under "${generated}" instead`,
    );
    sessionId = generated;
    state.sessionId = sessionId;
    paths = devSessionPaths(sessionId);
  }
  const startEpoch = epochs.length + 1;

  await handleOrphanBranches();

  await persist('chore(huu-dev): abrir sessão de desenvolvimento');

  if (aborted()) return finish('aborted', knowledge, false, 'aborted before the first epoch');

  let bootstrapped = false;
  if (!knowledge.present && !dev.skipKnowledgeBootstrap) {
    log(
      'info',
      `no knowledge system found — bootstrapping with pi (${config.modelId}) using the knowledge-skills-architect prompt`,
    );
    emit({ type: 'bootstrap-start', model: config.modelId });

    const sessionDir = join(cwd, '.huu', 'dev', '.bootstrap-session');
    const result = await runKnowledgeBootstrap({
      cwd,
      config,
      sessionDir,
      signal: args.signal,
      onEvent: (e: BootstrapEvent) => {
        if (e.type === 'bootstrap-progress') {
          emit({ type: 'bootstrap-progress', message: e.message });
        } else if (e.type === 'bootstrap-log') {
          emit({ type: 'log', level: e.level, message: e.message });
        }
      },
    });

    if (aborted()) {
      return finish('aborted', knowledge, false, 'aborted during the knowledge bootstrap');
    }
    if (!result.ok) {
      return finish('bootstrap-failed', knowledge, false, result.error ?? 'the knowledge bootstrap agent did not complete');
    }

    // The bootstrap agent writes directly to the repo — commit its work.
    await persist('chore(huu-dev): bootstrap do sistema de knowledge skills');

    bootstrapped = true;
    knowledge = result.knowledge;
    emit({ type: 'knowledge', status: knowledge });
    emit({ type: 'bootstrap-done', ok: true });
    log('info', `knowledge bootstrap complete — ${knowledge.reason}`);
  } else if (!knowledge.present) {
    log('warn', 'no knowledge system found, but the bootstrap was skipped — the planner will plan from whatever the knowledge phase can gather');
  }

  const knowledgeSummary = summarizeKnowledge(knowledge);
  const plan_ = args.planner ?? planEpoch;
  const planKnowledge_ = args.knowledgePlanner ?? planKnowledge;

  /**
   * The critic's executable anchor for one epoch. Persisted on first
   * successful extraction: the `build-test-commands` baseline gap is only
   * asked in epoch 1, so without this every epoch ≥ 2 silently compiled with
   * no commands at all. Falls back to the LATEST brief that has them, so a
   * session resumed from an older state file still finds epoch 1's.
   */
  const verifyCommandsForEpoch = (epoch: number): DevVerifyCommands | undefined => {
    if (isUsableVerifyCommands(state.verifyCommands)) return state.verifyCommands;
    for (let e = epoch; e >= 1; e--) {
      const extraction = extractVerifyCommands(cwd, paths, e);
      if (!extraction) continue;
      for (const warning of extraction.warnings) {
        log('warn', `epoch ${epoch} verify commands: ${warning}`);
      }
      state.verifyCommands = extraction.commands;
      return extraction.commands;
    }
    return undefined;
  };

  /**
   * PHASE C — run the planned graph, land it, record what it actually did.
   *
   * Extracted so it has TWO entry points: the ordinary one, right after the
   * planner compiled a fresh graph, and the RESUME one, which reads the graph
   * back off disk. The compiled pipeline was always persisted as a portable
   * artefact; before this it was only ever auditable, never reusable, so a
   * crash between the plan and the record threw away the expensive half of the
   * epoch and re-bought it.
   *
   * Returns a `stop` when the session must end here (only the abort path does),
   * and a `failure` for the circuit breaker to count. Never throws.
   */
  const runPlannedEpoch = async (
    pipeline: Pipeline,
    epoch: number,
    knowledgeCost: number,
    meta: { epochGoal: string; frontIds: string[] },
  ): Promise<{
    stop?: DevModeResult;
    failure?: { reason: 'run-failed' | 'landing-failed'; detail: string };
  }> => {
  // --- Phase C: execution ---------------------------------------------
  emit({ type: 'epoch-start', epoch, pipeline: pipeline });
  const startedAt = nowIso();

  const run = await runPipeline(pipeline, epoch, 'work');
  let runStatus: DevEpochRecord['status'] = run.ok ? 'done' : 'error';
  // Abort wins over whatever the manifest claims.
  if (run.interrupted || aborted()) runStatus = 'aborted';

  const record: DevEpochRecord = {
    epoch,
    runId: run.runId,
    epochGoal: meta.epochGoal,
    frontIds: meta.frontIds,
    status: runStatus,
    startedAt,
    finishedAt: nowIso(),
  };
  // BOTH runs — the epoch is what it cost, and the knowledge run is not free.
  const costUsd = knowledgeCost + (run.totalCost ?? 0);
  if (costUsd > 0) record.costUsd = costUsd;

  // Sweep huu's OWN housekeeping before landing. `Orchestrator.start()`
  // writes `.gitignore` (worktree dir, run logs, .env.huu, agent bin), which
  // leaves the tree dirty — and `landEpoch` refuses to merge onto a dirty
  // tree. Committing it here is huu owning what huu wrote.
  await persist(`chore(huu-dev): manutenção antes de aterrissar a época ${epoch}`);

  if (runStatus === 'aborted') {
    // An ABORTED epoch is NOT landed. Its agents were cut mid-flight, so
    // whatever merged is partial and no judge ever saw it — exactly the
    // state the user pressed stop to avoid. The work is not lost: it stays
    // on the integration branch, and we name it so they can land it by hand.
    record.landingError = unlandedDetail(run.branch, 'aborted');
    const abortedEvidence = collectEpochEvidence({
      epoch,
      state: run.state,
      landing: { landed: false, error: record.landingError },
      report: readEpochReportFor(cwd, paths, epoch),
      diffStat: '',
    });
    record.evidence = abortedEvidence;
    delete state.pendingEpoch;
    // An aborted epoch measured LESS, not nothing — the cards that already
    // went through the critic still carry their numbers.
    log('info', formatInstrumentationLine(epoch, abortedEvidence.instrumentation));
    epochs.push(record);
    emit({ type: 'epoch-done', record });
    await persist(`chore(huu-dev): época ${epoch} abortada`);
    return { stop: finish('aborted', knowledge, bootstrapped, record.landingError) };
  }

  // Land even a FAILED epoch: partial work that merged into the integration
  // branch is still work, and the next planner needs to see it on disk. An
  // aborted one is different — see above.
  const headBefore = await safeHead(git, cwd);
  let landing: LandEpochResult;
  if (run.branch) {
    landing = await landEpoch({ cwd, integrationBranch: run.branch, epoch });
    if (landing.landed && !landing.alreadyUpToDate) {
      record.landedCommit = landing.commit;
    } else if (landing.alreadyUpToDate) {
      record.landingError = `epoch ${epoch} landing produced no new commits (the integration branch was already contained in HEAD)`;
    } else {
      record.landingError = landing.error;
    }
  } else {
    landing = { landed: false, error: 'the epoch produced no integration branch' };
    record.landingError = landing.error;
  }

  // Evidence is collected AFTER landing: the diff stat is the range the
  // landing actually produced, and the report only reaches this checkout
  // through the landing merge.
  const evidence = collectEpochEvidence({
    epoch,
    state: run.state,
    landing,
    report: readEpochReportFor(cwd, paths, epoch),
    diffStat: await readLandedDiffStat(git, headBefore, landing.commit),
  });

  // Declared-ownership partition check, AFTER the landing: the T-*.md specs
  // are written DURING the run by the front recons, so they only exist in
  // this checkout once the epoch landed (checking earlier scanned a
  // directory that had none — the check was structurally dead). Advisory on
  // purpose: violations are recorded as epoch evidence and logged, never
  // blocked on; the blocking role moves to a compiled step in a later wave.
  // RECONCILIATION pass. The run itself now reports collisions BEFORE its
  // fan-out (`OrchestratorState.declaredWriteCollisions` → the evidence
  // above), which is both earlier and cross-front. This scan stays for the
  // cases that check cannot reach: an epoch whose specs were written but
  // never fanned out, and a run whose state was lost. It therefore only
  // fills the field when the run reported nothing.
  const landedSpecs = scanSpecs(join(cwd, paths.epochDir(epoch)));
  if (landedSpecs.length > 0 && evidence.declaredPartitionViolations === undefined) {
    const partition = checkWritePartition(landedSpecs);
    if (!partition.ok) {
      evidence.declaredPartitionViolations = partition.violations.slice(0, MAX_VIOLATION_TASKS);
      log('warn', `epoch ${epoch}: ${formatWritePartitionViolations(partition.violations)}`);
    }
  }
  record.evidence = evidence;

  // The four numbers the research came back empty on, once per epoch, in the
  // operator log. Without this line the measurement exists only inside
  // `state.json` — and a number nobody reads changes no decision.
  log('info', formatInstrumentationLine(epoch, evidence.instrumentation));

  // The epoch is RECORDED, so it is no longer in flight. Cleared before the
  // persist below, so what lands on disk already reflects that.
  delete state.pendingEpoch;
  epochs.push(record);
  emit({ type: 'epoch-done', record });
  await persist(`chore(huu-dev): época ${epoch} — ${meta.epochGoal}`.slice(0, 200));
    const failure: { reason: 'run-failed' | 'landing-failed'; detail: string } | undefined =
      runStatus !== 'done'
        ? {
            reason: 'run-failed',
            detail: `epoch ${epoch} ended with status "${runStatus}" (run ${run.runId || 'unknown'})`,
          }
        : record.landingError !== undefined
          ? { reason: 'landing-failed', detail: record.landingError }
          : undefined;
    return failure ? { failure } : {};
  };

  // --- Phase 1..N: the epochs --------------------------------------------
  //
  // The ceiling counts epochs from where this session STARTS, so `--epochs=3`
  // on a resumed session still means "three more epochs".
  //
  // Circuit-breaker state: CONSECUTIVE failed epochs — an epoch fails when its
  // execution run errors or it ends without a `landedCommit`. A clean landed
  // epoch resets the count; an abort is never a failure. The budget is per
  // session: a resumed session starts fresh, because continuing one is itself
  // a human decision.
  let consecutiveEpochFailures = 0;
  let lastEpochFailure: { reason: 'run-failed' | 'landing-failed'; detail: string } | undefined;
  for (let epoch = startEpoch; epoch < startEpoch + maxEpochs; epoch++) {
    if (aborted()) {
      return finish('aborted', knowledge, bootstrapped, `aborted after ${epochs.length} epoch(s)`);
    }

    // Requested BETWEEN epochs, so everything the last epoch merged is landed
    // and recorded. This is the exit a human reaches for; the hard abort above
    // is the one they reach for when something is wrong.
    if (stopRequested()) {
      return finish(
        'graceful-stop',
        knowledge,
        bootstrapped,
        `stopped by request after ${epochs.length} epoch(s), with everything landed`,
      );
    }

    // The breaker is checked BEFORE the epoch burns a planner call: this many
    // failures in a row is a failure that is not recovering, and retrying it
    // is exactly the waste the protection exists to stop.
    if (consecutiveEpochFailures >= MAX_CONSECUTIVE_EPOCH_FAILURES) {
      log(
        'warn',
        `circuit breaker (MAX_CONSECUTIVE_EPOCH_FAILURES=${MAX_CONSECUTIVE_EPOCH_FAILURES}): ${consecutiveEpochFailures} consecutive epoch failure(s) — stopping the session instead of burning more runs`,
      );
      return finish(
        'consecutive-failures',
        knowledge,
        bootstrapped,
        `${consecutiveEpochFailures} consecutive epochs failed — last: ${lastEpochFailure?.detail ?? 'unknown'}`,
      );
    }
    // The dollar ceiling, checked in the SAME place and for the same reason as
    // the failure breaker: before the epoch burns a planner call. Between
    // epochs rather than inside one — aborting a live swarm to save money loses
    // the work and still pays for the tokens already spent.
    if (dev.maxCostUsd !== undefined && dev.maxCostUsd > 0) {
      const spent = epochs.reduce((sum, e) => sum + (e.costUsd ?? 0), 0);
      if (spent >= dev.maxCostUsd) {
        return finish(
          'cost-ceiling',
          knowledge,
          bootstrapped,
          `spent $${spent.toFixed(2)} of the $${dev.maxCostUsd.toFixed(2)} ceiling after ${epochs.length} epoch(s) — stopping before epoch ${epoch}`,
        );
      }
    }
    // RESUMED EPOCH: its plan already exists on disk as a committed artefact,
    // so Phases A and B are skipped entirely and Phase C re-runs the persisted
    // graph. Consumed once — a second failure of the same epoch replans, which
    // is the right escalation: re-running a plan that just died twice is how a
    // session loops.
    const resuming = resumePending?.epoch === epoch ? resumePending : undefined;
    resumePending = undefined;
    if (resuming) {
      const restored = readPersistedPipeline(cwd, resuming.pipelinePath);
      if (restored) {
        log(
          'info',
          `epoch ${epoch}: resuming the EXECUTION run from the persisted plan (${resuming.pipelinePath}) — knowledge and planning are not re-bought`,
        );
        const resumedOutcome = await runPlannedEpoch(restored.pipeline, epoch, 0, {
          epochGoal: resuming.epochGoal,
          frontIds: resuming.frontIds,
        });
        if (resumedOutcome.stop) return resumedOutcome.stop;
        if (resumedOutcome.failure) {
          consecutiveEpochFailures++;
          lastEpochFailure = resumedOutcome.failure;
        } else {
          consecutiveEpochFailures = 0;
          lastEpochFailure = undefined;
        }
        continue;
      }
      log(
        'warn',
        `epoch ${epoch}: the persisted plan at ${resuming.pipelinePath} could not be read — planning it again`,
      );
    }

    emit({ type: 'planning', epoch });

    const previousEvidence = epochs.length > 0 ? epochs[epochs.length - 1]!.evidence : undefined;

    // --- Phase A: knowledge ---------------------------------------------
    let knowledgeRequest: KnowledgeRequest;
    try {
      knowledgeRequest = await planKnowledge_({
        goal: dev.goal,
        epoch,
        knowledgeSummary,
        history: epochs,
        previousEvidence,
        apiKey: config.apiKey,
        modelId: models.planner,
        llmContext: llmContextFor(config),
      });
    } catch (err) {
      // An orchestrator that cannot even produce a schema-valid QUESTION is
      // not one whose plan should run a swarm.
      return finish('planner-failed', knowledge, bootstrapped, `epoch ${epoch} knowledge request: ${message_(err)}`);
    }

    if (aborted()) {
      return finish('aborted', knowledge, bootstrapped, `aborted while planning epoch ${epoch}`);
    }

    // ZERO gaps is a decision, not a defect: the orchestrator is saying it
    // already knows enough, and huu honors it by skipping Phase A entirely.
    // The baseline gaps are a FLOOR UNDER A REQUEST, not a reason to
    // manufacture one nobody made — and this is also what keeps a `--stub`
    // session at one run per epoch (the stub backend cannot answer a question:
    // it writes no files).
    const merged =
      knowledgeRequest.gaps.length === 0
        ? { gaps: [] as KnowledgeGap[], warnings: [] as string[] }
        : mergeBaselineGaps(
            knowledgeRequest,
            epoch,
            DEV_MAX_GAPS,
            dev.methodology?.fitnessFunctions === true ? [FITNESS_COMMANDS_GAP] : [],
          );
    for (const warning of merged.warnings) {
      log('warn', `epoch ${epoch} knowledge request repaired: ${warning}`);
    }

    let briefPack: string | undefined;
    let knowledgeCost = 0;
    if (merged.gaps.length === 0) {
      log('info', `epoch ${epoch}: the orchestrator declared no knowledge gaps — planning straight away`);
    } else {
      let writtenPaths: string[];
      let knowledgePipeline: Pipeline;
      try {
        // huu writes the gap specs AND the memory index in TypeScript, from
        // one list. An agent asked to write both can miss the contract in a
        // dozen ordinary ways, and `resolveMemoryFiles` does not merely drop a
        // path that is missing — when a non-empty list resolves to nothing it
        // THROWS, which kills the run.
        writtenPaths = writeKnowledgeGaps({
          cwd,
          paths,
          epoch,
          gaps: merged.gaps,
          goal: dev.goal,
          knowledge,
        }).writtenPaths;
        knowledgePipeline = compileKnowledgePipeline({
          gaps: merged.gaps,
          epoch,
          goal: dev.goal,
          paths,
          knowledgeSummary,
          // The whole phase IS the retrieval the orchestrator delegates, so it
          // runs on the `recon` role. Unset ⇒ the field is omitted and the run
          // model applies, exactly as today.
          ...(() => {
            const recon = pickModelRung(
              dev.models?.recon,
              (config.backend ?? 'pi') === 'pi' ? isPiModelKnown : undefined,
            );
            return recon ? { subagentModelId: recon } : {};
          })(),
          // Only `chainOfVerification` reads this — every other option shapes
          // Phase C. Passed whole so the compiler stays the one place that
          // decides which flags reach the knowledge graph.
          ...(dev.methodology ? { methodology: dev.methodology } : {}),
          cardTimeoutMs: args.cardTimeoutMs,
          singleFileCardTimeoutMs: args.singleFileCardTimeoutMs,
          routerPrefix: knowledge.present ? ROUTER_PREFIX : undefined,
        }).pipeline;
      } catch (err) {
        return finish('knowledge-failed', knowledge, bootstrapped, `epoch ${epoch}: ${message_(err)}`);
      }

      // COMMITTED BEFORE THE RUN, and that is a correctness requirement rather
      // than tidiness: the fan-out resolves `filesFrom` out of the INTEGRATION
      // worktree, which branches from HEAD. An uncommitted spec does not exist
      // there, and a list whose entries all vanish makes `resolveMemoryFiles`
      // throw — killing the run.
      await persist(
        `chore(huu-dev): época ${epoch} — ${merged.gaps.length} lacuna(s) de conhecimento`,
        writtenPaths,
      );

      if (aborted()) {
        return finish('aborted', knowledge, bootstrapped, `aborted before the knowledge run of epoch ${epoch}`);
      }

      emit({ type: 'epoch-start', epoch, pipeline: knowledgePipeline });
      const run = await runPipeline(knowledgePipeline, epoch, 'knowledge');
      knowledgeCost = run.totalCost ?? 0;

      if (run.interrupted || aborted()) {
        return finish(
          'aborted',
          knowledge,
          bootstrapped,
          unlandedDetail(run.branch, `aborted during the knowledge run of epoch ${epoch}`),
        );
      }

      await persist(`chore(huu-dev): manutenção antes de aterrissar o conhecimento da época ${epoch}`);

      if (run.branch) {
        const landing = await landEpoch({ cwd, integrationBranch: run.branch, epoch });
        if (!landing.landed) {
          return finish('landing-failed', knowledge, bootstrapped, `epoch ${epoch} knowledge run: ${landing.error}`);
        }
        if (landing.alreadyUpToDate) {
          log('warn', `epoch ${epoch} knowledge landing: no new commits (already up-to-date)`);
        }
      } else {
        log('warn', `epoch ${epoch}: the knowledge run produced no integration branch — nothing to land`);
      }

      // Forward default, deliberately: a knowledge run that failed still
      // usually landed SOME briefs, and `readKnowledgeDigest` falls back to the
      // raw shards. Planning on a thin briefing beats losing the session.
      if (!run.ok) {
        log('warn', `epoch ${epoch}: the knowledge run did not complete — planning continues on whatever landed`);
      }

      // The gap list is passed so the digest can be CHECKED: a consolidation
      // step that silently dropped a gap used to reach the planner as a
      // confident-looking document with a hole in it, and the planner cannot
      // tell a missing section from a verified "nothing here".
      briefPack =
        readKnowledgeDigest(cwd, paths, epoch, dev.knowledgeDigestMaxChars, merged.gaps) || undefined;
      log(
        'info',
        briefPack
          ? `epoch ${epoch}: knowledge digest is ${briefPack.length} chars over ${merged.gaps.length} gap(s)`
          : `epoch ${epoch}: NO knowledge digest and no briefs landed — the planner gets nothing about this repo`,
      );

      // Back to planning: the run frames the surfaces just showed were the
      // knowledge phase, not the epoch's work.
      emit({ type: 'planning', epoch });
    }

    if (aborted()) {
      return finish('aborted', knowledge, bootstrapped, `aborted while planning epoch ${epoch}`);
    }

    // Everything EARLIER epochs established, deduped by gap with the newest
    // answer winning. Budgeted separately and smaller than the epoch's own
    // digest: it is standing knowledge, and it must never crowd out the fresh
    // briefing it exists to complement.
    const accumulatedPack =
      epoch > 1
        ? assembleAccumulatedKnowledge(
            readAccumulatedBriefs(cwd, paths, epoch - 1),
            Math.floor((dev.knowledgeDigestMaxChars ?? KNOWLEDGE_DIGEST_MAX_CHARS) * 0.4),
          )
        : '';
    if (accumulatedPack) {
      log(
        'info',
        `epoch ${epoch}: ${accumulatedPack.length} chars of knowledge carried forward from earlier epochs`,
      );
    }

    // --- Phase B: the plan ----------------------------------------------
    let plan: DevPlan;
    try {
      plan = await plan_({
        goal: dev.goal,
        epoch,
        briefPack,
        ...(accumulatedPack ? { accumulatedPack } : {}),
        knowledgeSummary,
        history: epochs,
        previousEvidence,
        previousReport: epoch > 1 ? readEpochReportFor(cwd, paths, epoch - 1) : undefined,
        ...(knowledgeRequest.planningNotes?.trim()
          ? { planningNotes: knowledgeRequest.planningNotes }
          : {}),
        ...(dev.methodology ? { methodology: dev.methodology } : {}),
        maxFronts,
        apiKey: config.apiKey,
        modelId: models.planner,
        llmContext: llmContextFor(config),
      });
    } catch (err) {
      return finish('planner-failed', knowledge, bootstrapped, `epoch ${epoch}: ${message_(err)}`);
    }

    if (aborted()) {
      return finish('aborted', knowledge, bootstrapped, `aborted while planning epoch ${epoch}`);
    }

    const previousDoneWhen = state.doneWhen;
    state.doneWhen = plan.doneWhen;

    if (plan.goalComplete) {
      if (epoch === 1) {
        log('warn', `epoch 1: the planner reported goalComplete on the first epoch — refusing; goalComplete requires corroboration from at least one executed epoch`);
      } else {
        state.goalComplete = true;
        await persist(`chore(huu-dev): objetivo concluído após ${epochs.length} época(s)`);
        log('info', `planner reports the goal is already satisfied: ${plan.doneWhen}`);
        return finish('goal-complete', knowledge, bootstrapped);
      }
    }

    if (plan.fronts.length === 0) {
      return finish('empty-plan', knowledge, bootstrapped, `epoch ${epoch}: the planner emitted no fronts and did not declare the goal complete`);
    }

    const verifyCommands = verifyCommandsForEpoch(epoch);

    let compiled;
    try {
      compiled = compileEpochPipeline({
        plan,
        epoch,
        goal: dev.goal,
        knowledgeSummary,
        maxFronts,
        cardTimeoutMs: args.cardTimeoutMs,
        singleFileCardTimeoutMs: args.singleFileCardTimeoutMs,
        ...(() => {
          // The compiler stamps ONE id per step, so a chain must collapse to
          // its surviving rung before it gets there — a step carrying
          // "a, b" as its modelId would fail in the factory, which is exactly
          // the failure the chain exists to prevent.
          const collapsed = collapseDevModelPolicy(
            dev.models,
            (config.backend ?? 'pi') === 'pi' ? isPiModelKnown : undefined,
          );
          return collapsed ? { models: collapsed } : {};
        })(),
        sessionId,
        ...(verifyCommands ? { verifyCommands: flattenVerifyCommands(verifyCommands) } : {}),
        ...(dev.methodology ? { methodology: dev.methodology } : {}),
        ...(verifyCommands && verifyCommands.lint.length > 0
          ? { lintCommands: [...verifyCommands.lint] }
          : {}),
        ...(verifyCommands && verifyCommands.test.length > 0
          ? { testCommands: [...verifyCommands.test] }
          : {}),
        // Detected, never assumed: `changelogGate`'s critic half names a real
        // file back to the agent, so a project without one gets the
        // commit-format gate and no invented demand. Probed per epoch — an
        // earlier epoch may have created the surface.
        ...(dev.methodology?.changelogGate === true
          ? { changelogPaths: detectChangelogPaths(cwd) }
          : {}),
        ...(verifyCommands && (verifyCommands.fitness?.length ?? 0) > 0
          ? { fitnessCommands: [...verifyCommands.fitness!] }
          : {}),
        routerPrefix: knowledge.present ? ROUTER_PREFIX : undefined,
      });
    } catch (err) {
      return finish('planner-failed', knowledge, bootstrapped, `epoch ${epoch}: ${message_(err)}`);
    }

    for (const warning of compiled.warnings) log('warn', `epoch ${epoch} plan repaired: ${warning}`);
    emit({ type: 'planned', epoch, plan, warnings: compiled.warnings });

    // Gate augmentations: doneWhen drift and restatedGoal comprehension check
    const doneWhenChanged = previousDoneWhen.length > 0 && previousDoneWhen !== plan.doneWhen;
    if (doneWhenChanged) {
      log('warn', `epoch ${epoch}: doneWhen changed — was "${previousDoneWhen.slice(0, 80)}${previousDoneWhen.length > 80 ? '…' : ''}", now "${plan.doneWhen.slice(0, 80)}${plan.doneWhen.length > 80 ? '…' : ''}"`);
    }
    if (knowledgeRequest.restatedGoal) {
      log('info', `epoch ${epoch}: restatedGoal: ${knowledgeRequest.restatedGoal.slice(0, 120)}${knowledgeRequest.restatedGoal.length > 120 ? '…' : ''}`);
    }
    const gateWarnings = [
      ...compiled.warnings,
      ...(doneWhenChanged ? [`doneWhen changed from "${previousDoneWhen.slice(0, 80)}${previousDoneWhen.length > 80 ? '…' : ''}" to "${plan.doneWhen.slice(0, 80)}${plan.doneWhen.length > 80 ? '…' : ''}"`] : []),
      ...(knowledgeRequest.restatedGoal ? [`restatedGoal: ${knowledgeRequest.restatedGoal}`] : []),
    ];

    if (dev.approval === 'each-epoch') {
      const approved = await Promise.resolve(args.onApprove?.(plan, epoch, gateWarnings) ?? false);
      if (!approved) {
        return finish('plan-rejected', knowledge, bootstrapped, `epoch ${epoch} plan was not approved`);
      }
    }
    if (aborted()) {
      return finish('aborted', knowledge, bootstrapped, `aborted before epoch ${epoch} started`);
    }

    // The compiled graph is the epoch's PORTABLE artefact — reusable, editable
    // and auditable, which is what huu claims for every other pipeline. It is
    // also huu-written, so huu commits it: an uncommitted file under `.huu/`
    // leaves the tree dirty and the landing merge refuses.
    const pipelinePath = paths.pipeline(epoch);
    let pipelineExtras: string[] = [];
    try {
      writeFileEnsuringDir(join(cwd, pipelinePath), `${JSON.stringify(compiled.pipeline, null, 2)}\n`);
      pipelineExtras = [pipelinePath];
    } catch (err) {
      log('warn', `epoch ${epoch}: could not persist the compiled pipeline: ${message_(err)}`);
    }
    await persist(`chore(huu-dev): época ${epoch} — pipeline compilado`, pipelineExtras);

    // --- Phase C: execution ---------------------------------------------
    //
    // The plan is on disk and committed; record the epoch as IN FLIGHT so a
    // crash from here on resumes the execution instead of re-planning it.
    state.pendingEpoch = {
      epoch,
      pipelinePath,
      epochGoal: plan.epochGoal,
      frontIds: compiled.frontOrder,
    };
    const outcome = await runPlannedEpoch(compiled.pipeline, epoch, knowledgeCost, {
      epochGoal: plan.epochGoal,
      frontIds: compiled.frontOrder,
    });
    if (outcome.stop) return outcome.stop;
    const failure = outcome.failure;

    // Circuit-breaker accounting. A failed epoch no longer stops the session
    // by itself: whatever merged landed above, the next planner sees it on
    // disk, and one bad epoch is often just a bad epoch. What must never
    // happen is the incident behind Claude Code's
    // MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES — sessions retrying a failure that
    // never recovers, burning API calls forever. So failures defer the stop:
    // the session ends when the breaker trips at the top of the loop, or when
    // the ceiling arrives with the last epoch(s) failed (reported just after
    // the loop). A run error counts even when its partial work landed; the
    // reset requires a CLEAN landed epoch.
    if (failure) {
      consecutiveEpochFailures++;
      lastEpochFailure = failure;
      log(
        'warn',
        `epoch ${epoch} failed — ${consecutiveEpochFailures} consecutive failure(s); the circuit breaker stops the session at ${MAX_CONSECUTIVE_EPOCH_FAILURES}`,
      );
      continue;
    }
    consecutiveEpochFailures = 0;
    lastEpochFailure = undefined;
  }

  // The ceiling with the last epoch(s) failed reports that failure, not the
  // ceiling: 'max-epochs' claims a healthy chain (and maps to exit 0). These
  // are the two finishes the circuit breaker deferred from inside the loop.
  if (lastEpochFailure) {
    return finish(lastEpochFailure.reason, knowledge, bootstrapped, lastEpochFailure.detail);
  }

  return finish(
    'max-epochs',
    knowledge,
    bootstrapped,
    unboundedEpochs
      ? `stopped at the ${maxEpochs}-epoch safety backstop without the planner ever reporting the goal complete — inspect \`${devPaths.journal}\` before starting another session`
      : `reached the ${maxEpochs}-epoch ceiling`,
  );
}

/** Adapts a real `Orchestrator` to the slice the driver uses. */
function wrapOrchestrator(orch: Orchestrator): DevRunHandle {
  return {
    subscribe: (listener) => orch.subscribe(listener),
    start: () => orch.start(),
    abort: () => orch.abort(),
    setGreedy: () => orch.enableGreedyMode(),
  };
}

/**
 * Read a persisted epoch graph back off disk and VALIDATE it.
 *
 * The file is huu-written and committed, but it is also plain JSON in the
 * user's repository and a resume is exactly when it may have been edited (by
 * hand, or by a merge). It therefore goes through the same `PipelineSchema` a
 * run performs at load time; anything that fails simply reads as "no persisted
 * plan" and the epoch is planned again. Never throws.
 */
function readPersistedPipeline(
  cwd: string,
  pipelinePath: string,
): { pipeline: Pipeline } | null {
  try {
    const raw: unknown = JSON.parse(readFileSync(join(cwd, pipelinePath), 'utf8'));
    const parsed = PipelineSchema.safeParse(raw);
    return parsed.success ? { pipeline: parsed.data as Pipeline } : null;
  } catch {
    return null;
  }
}

async function safeHead(git: GitClient, cwd: string): Promise<string | undefined> {
  try {
    return await git.getHead(cwd);
  } catch {
    return undefined;
  }
}

function message_(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Shape guard for the PERSISTED verify commands — `readDevState` casts without
 * validating, and a hand-edited state file must not be able to crash the
 * compiler with a `verifyCommands` that is not what huu wrote.
 */
function isUsableVerifyCommands(value: DevVerifyCommands | undefined): value is DevVerifyCommands {
  return (
    value !== undefined &&
    Array.isArray(value.all) &&
    value.all.length > 0 &&
    value.all.every((command) => typeof command === 'string' && command.trim().length > 0)
  );
}

/**
 * Map an {@link AppConfig} onto the backend-aware context the planner's chat
 * client needs. Mirrors `helperLlmContext` in `app.tsx`: routing an Azure run
 * through the OpenRouter field would silently bill the wrong provider.
 */
export function llmContextFor(config: AppConfig): LlmClientContext {
  if (config.backend === 'azure') {
    return { backend: 'azure', azureApiKey: config.apiKey, azureEndpoint: config.endpoint ?? '' };
  }
  return { backend: config.backend ?? 'pi', openrouterApiKey: config.apiKey };
}

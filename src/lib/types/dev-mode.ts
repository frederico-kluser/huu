/**
 * Dev-mode types.
 *
 * Re-exported from the `lib/types` barrel so existing callers that import
 * `../lib/types.js` keep type-checking. New code may import directly from
 * `../lib/types/dev-mode.js`.
 */

import type { ReviewFinding } from './pipeline.js';

// --- Development mode ---
//
// Dev mode is the one huu flow whose STEP GRAPH is written at run time: a
// planner decomposes a human-underwritten goal into parallel FRONTS, each
// front compiles into a recon → memory fan-out → judge chain, and the whole
// thing is emitted as an ordinary `Pipeline` with `dependsOn` edges so the
// existing wave scheduler runs it unchanged (see `src/lib/dev-mode/`).
//
// The human still underwrites the goal and the method; the planner only
// DECOMPOSES what the human asked for, and every front ends at a judge.

/** Root of the dev-mode blackboard inside the target repo. */
export const DEV_MODE_DIR = '.huu/dev';

/** Hard cap on parallel fronts per epoch. Keeps the compiled pipeline under
 *  the 20-step planner ceiling: 1 recon + fronts×3 + 3 tail steps. */
export const DEV_MAX_FRONTS = 4;

/** Default cap on tasks fanned out per front (the memory step's maxFiles). */
export const DEV_DEFAULT_MAX_TASKS = 8;

/** Default ceiling on epochs in one dev-mode session (CLI default). */
export const DEV_DEFAULT_MAX_EPOCHS = 3;

/**
 * Backstop when NO epoch ceiling is set (the web surface deliberately offers
 * none — a session runs until the planner reports the goal complete or the
 * user aborts). This is not a product limit; it is the last thing standing
 * between a planner that never says "done" and an unattended overnight run.
 * Reaching it is reported as `max-epochs` with a loud detail.
 */
export const DEV_UNBOUNDED_EPOCH_BACKSTOP = 50;

/**
 * Hard cap on knowledge gaps the orchestrator may declare for one epoch. The
 * orchestrator plans without reading the repo, so its gap list is the ONLY
 * retrieval it gets — but each gap costs a parallel subagent, and a model
 * asked for "everything it doesn't know" will happily list thirty. The cap
 * forces prioritization; the fixed baseline gaps guarantee a floor.
 */
export const DEV_MAX_GAPS = 12;

/** Who decides that an epoch's plan may run. */
export type DevApprovalMode = 'autonomous' | 'each-epoch';

/**
 * The distinct jobs a dev-mode session hands to a model. Each maps to a
 * `modelId` the orchestrator already honors end to end (`WorkStep.modelId`,
 * `CheckStep.modelId`, `Pipeline.integrationModelId`, `ReviewSpec.modelId`) —
 * heterogeneous routing needs no orchestrator change at all, the dev-mode
 * compiler just has to fill the fields in.
 *
 * A word on the economics, because it is easy to get backwards: splitting
 * roles across models is NOT a cost optimization. Running a fan-out of agents
 * costs several times a single agent's tokens, while the price gap between the
 * models here is about 2× — routing work to the cheaper model does not pay for
 * the multiplier. The justification is context isolation and parallelism, and
 * for `critic` specifically, getting a second opinion from another vendor.
 */
export type DevModelRole =
  /**
   * The blind orchestrator: no tools, no file reads, no repo digest. Reached
   * through the structured-output LangChain client, NOT through the pi agent
   * registry — which is why an id the pi registry has never heard of is fine
   * here and fatal anywhere else.
   */
  | 'planner'
  /** Global recon plus each front's recon — the retrieval the planner delegates. */
  | 'recon'
  /** The memory fan-out: the agents that actually write code. */
  | 'worker'
  /**
   * The per-task critic of {@link ReviewSpec}. Cross-family from `worker` on
   * purpose — a model auditing its own family's output is the single most
   * fragile assumption in this design, so the default preset breaks it.
   */
  | 'critic'
  /** Consolidation and sealing — writing a report about a diff. */
  | 'reporter'
  /**
   * Front verification and the epoch gate (`CheckStep` judges). Kept on the
   * strong model even in the thrifty preset: every check has a forward
   * `default: true` outcome, so a judge that fails or hallucinates a label
   * APPROVES SILENTLY. It is the one place where saving cents buys a broken
   * epoch.
   */
  | 'judge'
  /** The merge-conflict resolver → `Pipeline.integrationModelId`. */
  | 'integration';

/**
 * Role → model id. Partial by design: a role left unset OMITS the field on the
 * emitted step, so the existing `AppConfig.modelId` fallback applies and the
 * compiled pipeline is byte-identical to today's.
 */
export type DevModelPolicy = Partial<Record<DevModelRole, string>>;

/** Named policies the CLI and the web offer. */
export type DevModelPreset = 'hetero' | 'thrifty' | 'monoculture' | 'uniform';

const DS = 'deepseek/deepseek-v4-pro';

export const DEV_MODEL_PRESETS = {
  /** ★ The default: strong blind leader, cheap swarm, critic from ANOTHER family. */
  hetero: {
    planner: 'z-ai/glm-5.2',
    recon: DS,
    worker: DS,
    critic: 'moonshotai/kimi-k2.6',
    reporter: DS,
    judge: DS,
    integration: DS,
  },
  /** Same as `hetero`, with the reporter demoted — it is mechanical prose over a diff. */
  thrifty: {
    planner: 'z-ai/glm-5.2',
    recon: DS,
    worker: DS,
    critic: 'moonshotai/kimi-k2.6',
    reporter: 'deepseek/deepseek-v4-flash',
    judge: DS,
    integration: DS,
  },
  /**
   * Everything on the worker's model — INCLUDING the critic. This is
   * explicitly the configuration the evidence flags as the weakest
   * assumption; it exists so the cross-family critic can be A/B'd against it,
   * not as a recommendation.
   */
  monoculture: {
    planner: 'z-ai/glm-5.2',
    recon: DS,
    worker: DS,
    critic: DS,
    reporter: DS,
    judge: DS,
    integration: DS,
  },
  /** Every role falls back to `AppConfig.modelId` — today's behavior, byte-identical. */
  uniform: {},
} as const satisfies Record<DevModelPreset, DevModelPolicy>;

/** One parallel workstream within an epoch. */
export interface DevFront {
  /** Stable kebab-case id, unique within the epoch. Names the blackboard dir. */
  id: string;
  /** Short human-facing title. */
  title: string;
  /** Why this front exists — surfaced in the approval view. */
  rationale: string;
  /** Ids of OTHER fronts in this epoch that must land before this one starts. */
  dependsOnFronts: string[];
  /** What the front's recon must discover and hand to the fan-out. */
  reconPrompt: string;
  /** What each task agent must do. Uses the `$file` / `$hint` tokens. */
  workPrompt: string;
  /** Objectively checkable condition for the front's judge. */
  verifyCondition: string;
  /** Fan-out cap for this front. */
  maxTasks: number;
}

/** One epoch's plan — the unit the planner emits and the human approves. */
export interface DevPlan {
  /** What THIS epoch achieves (a slice of the overall goal). */
  epochGoal: string;
  /** Objective criterion for the OVERALL goal being finished. */
  doneWhen: string;
  /** True when the planner judges the overall goal already satisfied. */
  goalComplete: boolean;
  fronts: DevFront[];
}

/**
 * What an executed epoch actually produced, in a shape the next planning pass
 * can read. Today the next epoch's planner gets only a prose report; this is
 * the structured half.
 *
 * It is also what keeps the orchestrator blind while still being INFORMED:
 * every field is bounded and tabular (never a file, never a diff body), so the
 * model gets a summary of reality rather than a window into the repo. The
 * INTERPRETATION of it is not the planner's job either — from epoch 2 on, a
 * "what was delivered vs what was promised" gap is handed to a subagent that
 * can actually read the code, and its answer arrives as ordinary knowledge.
 *
 * Everything here is derivable from state the run already has: verdicts from
 * `OrchestratorState.checkRuns`, waived/outcomes from `OrchestratorState.agents`,
 * landing from the epoch-landing result, `diffStat` from git.
 */
export interface DevEpochEvidence {
  epoch: number;
  /** `git diff --stat`, truncated by churn (top ~40 files + "…and N more"). */
  diffStat: string;
  /** Changed paths, capped. */
  filesChanged: string[];
  /** Every check verdict, and whether the judge produced it or the forward default fired. */
  verdicts: { stepName: string; label: string; fromJudge: boolean; reason?: string }[];
  /**
   * Tasks that merged with blocking review findings waived at the round cap.
   * The single most important row for the next planner: it is work that landed
   * while a critic was still objecting.
   */
  waived: { agentId: number; stageName: string; findings: ReviewFinding[] }[];
  taskOutcomes: { done: number; noChanges: number; failed: number; unmerged: number };
  landing: { landed: boolean; commit?: string; error?: string };
  /** A bounded slice of the epoch's consolidation report. */
  reportExcerpt?: string;
  /**
   * DECLARED-vs-declared write-set check, run over the epoch's task specs
   * AFTER the landing — the only moment the `T-*.md` files exist in the
   * user's checkout (the front recons write them during the run). Sibling of
   * `instrumentation.writeSetViolations`, which measures what agents ACTUALLY
   * wrote outside their spec; this one measures whether the specs themselves
   * partitioned the tree. Advisory: violations are recorded here and logged,
   * never blocked on — the blocking role moves to a compiled step in a later
   * wave. Absent when the epoch produced no specs or the specs are disjoint.
   */
  declaredPartitionViolations?: { path: string; specs: string[] }[];
  /**
   * The four numbers nobody has published for parallel coding agents, which
   * huu is in a position to MEASURE rather than cite. They exist to make the
   * severity-vs-proof blocking choice, and the parallel-fronts bet, revisable
   * with this project's own data instead of another domain's literature.
   *
   * Optional only because this record is PERSISTED (`state.json` →
   * `DevEpochRecord.evidence`): an epoch written before instrumentation
   * existed is still a valid v2 record and comes back on resume without the
   * block. `collectEpochEvidence` ALWAYS emits it — zeros and empty arrays
   * when nothing was measured, never `undefined`.
   */
  instrumentation?: {
    /** Files an agent committed that its task spec did not declare as OWNED. */
    writeSetViolations: { agentId: number; stageName: string; paths: string[] }[];
    /**
     * Blocking findings that triggered a fix round, split by whether a command
     * proved them, plus the RAW per-card round distribution — not an average.
     * "How many rounds of critique actually help" is a question about the
     * shape of that distribution, and a mean hides the tail that answers it.
     */
    review: { proved: number; unproved: number; rounds: number[]; waivedCount: number };
    /** Per stage merge: how many eligible branches conflicted and needed the resolver. */
    mergeConflicts: { stageName: string; eligible: number; conflicted: number }[];
  };
}

/** Outcome of one executed epoch, appended to the dev state. */
export interface DevEpochRecord {
  epoch: number;
  runId: string;
  epochGoal: string;
  frontIds: string[];
  /** Terminal status of the epoch's orchestrator run. */
  status: 'done' | 'error' | 'aborted';
  /** Commit the epoch's work landed on, when the merge succeeded. */
  landedCommit?: string;
  /** Populated when landing failed (conflict, dirty tree, merge error). */
  landingError?: string;
  startedAt: string;
  finishedAt: string;
  /** Structured outcome of the epoch — see {@link DevEpochEvidence}. */
  evidence?: DevEpochEvidence;
  /**
   * What the epoch cost, in USD, from the run manifest's authoritative total.
   * Per-epoch cost is not measurable today at all; one propagated field makes
   * every "is this design worth it" question answerable with a number.
   */
  costUsd?: number;
}

/**
 * The project's real verification commands, extracted from the
 * `build-test-commands` knowledge brief and classified by kind.
 *
 * `all` preserves the brief's original order and is what current consumers
 * (the per-task critic) receive — so an epoch compiled from a persisted value
 * is byte-identical to one compiled straight from the brief. The buckets are
 * the same commands partitioned by kind, for consumers that need a subset: a
 * later wave feeds `lint` (lint/typecheck — the fast checks) to a merge gate,
 * which must never inherit a command nobody could classify.
 */
export interface DevVerifyCommands {
  /** Every command, in the order the brief listed them. */
  all: string[];
  build: string[];
  test: string[];
  /** Lint AND type-check commands — the subset a merge gate may run. */
  lint: string[];
  /**
   * Architecture/fitness-function commands (dependency rules, layering,
   * cycles). Optional and additive: a state file persisted before this bucket
   * existed is still valid, and re-extraction fills it.
   *
   * Populated ONLY from an explicit `fitness:` label — never from a hint —
   * so enabling `fitnessFunctions` cannot quietly move a command out of the
   * `lint` bucket that `lintGate` has always run.
   */
  fitness?: string[];
}

/**
 * Persisted dev-mode blackboard: `.huu/dev/state.json`.
 *
 * The v2 format tag exists so `readDevState` can refuse a v1 file outright —
 * it returns null for any foreign tag, which degrades to "no resume offered"
 * and needs no migration code at all. v2 adds `sessionId`, which namespaces
 * the epoch blackboard (`.huu/dev/<sessionId>/epoch-N/…`): without it, a
 * second session's memory fan-out can resolve a PREVIOUS session's committed
 * `tasks.json` and dispatch the wrong swarm.
 */
export interface DevState {
  /**
   * Transitional union: v2 is what huu writes from now on, v1 is retained only
   * until the writer (`dev-state.ts` / `dev-driver.ts`) is bumped, so this
   * type change lands without breaking them. Drop the v1 arm with that bump.
   */
  _format: 'huu-devstate-v2' | 'huu-devstate-v1';
  /** The human's goal, verbatim. Never rewritten by an agent. */
  goal: string;
  doneWhen: string;
  epochs: DevEpochRecord[];
  /** Last verdict from the planner about whether the goal is met. */
  goalComplete: boolean;
  updatedAt: string;
  /**
   * Identifier of this dev session — the path segment every epoch artefact
   * lives under. Optional ONLY for the transition (a v1 state file has none);
   * every v2 writer sets it. See the format note above for why it exists.
   */
  sessionId?: string;
  /**
   * Verification commands extracted from the `build-test-commands` brief,
   * persisted on first successful extraction. The baseline gap that produces
   * them is only asked in epoch 1 — without this field every epoch ≥ 2 lost
   * the critic's executable anchor. Additive and optional: a state file
   * written before it existed is still valid v2 and simply re-extracts.
   */
  verifyCommands?: DevVerifyCommands;
  /**
   * An epoch whose EXECUTION run was started and never recorded — set just
   * before Phase C spawns, cleared the moment the epoch's record is pushed.
   *
   * It exists so a crash in Phase C does not cost Phases A and B. Resume was
   * epoch-granular: a session that died with twenty agents already merged came
   * back and re-bought the knowledge run, re-planned, and re-compiled — even
   * though the compiled graph was ALREADY on disk as a committed artefact
   * (`paths.pipeline(epoch)`). This field is the pointer that makes that
   * artefact usable instead of merely auditable.
   *
   * Deliberately NOT mid-run resume: the agents are gone, their worktrees are
   * gone, and reconstructing them is a different problem. What is recovered is
   * the epoch's PLAN, which is the expensive part nobody should pay twice.
   */
  pendingEpoch?: {
    epoch: number;
    /** Repo-relative path of the compiled pipeline for that epoch. */
    pipelinePath: string;
    /** The epoch's goal, so a resumed run records the same history line. */
    epochGoal: string;
    /** The fronts it compiled, for the same reason. */
    frontIds: string[];
  };
}

/**
 * The selectable methodologies of a dev-mode session — one checkbox each, all
 * OFF by default. Each flag is the HUMAN underwriting a piece of method: it
 * changes the STRUCTURE the dev compiler emits (step splits, merge gates,
 * judge rubrics, review behavior), never gives a model new structure fields.
 *
 * Additive by design, same contract as {@link DevModelPolicy}: a session that
 * sets none of this compiles the pipeline it compiles today, byte for byte.
 * Enforcement is never a silent waive — a flagged gate that fails blocks with
 * a human escape (see `ReviewSpec.onBlocked` in `./pipeline.js`).
 */
export interface DevMethodology {
  /** Split each front's work into a tests step + an implementation step (TDD). */
  tdd?: boolean;
  /** Run the project's lint/typecheck commands as a deterministic merge gate. */
  lintGate?: boolean;
  /** Add the project's atlas/conventions as a rubric to every per-task critic. */
  standards?: boolean;
  /** Compile a plan-validation step (work + check with loop-back) before the fan-out. */
  planReview?: boolean;
  /**
   * Enforce each task spec's declared `Files this task OWNS` list: the critic
   * blocks any file written outside it and the front's judge re-checks it
   * after the merge. huu already MEASURES this
   * (`DevEpochInstrumentation.writeSetViolations`); this flag is the human
   * turning the measurement into a gate.
   */
  writeSet?: boolean;
  /**
   * Check commit subjects against Conventional Commits as a deterministic
   * merge gate, and make the critic demand a changelog entry for any
   * user-visible change — when the project HAS a changelog surface.
   */
  changelogGate?: boolean;
  /**
   * Cap each task's diff (lines and files) as a deterministic merge gate, and
   * tell the planner to decompose until every task fits. Small batches are
   * what keeps the critic's review effective at all.
   */
  diffBudget?: boolean;
  /**
   * Ask an agent, in the knowledge phase, for the project's architecture/
   * dependency-rule command, then run it as a merge gate and give the critic
   * the atlas's layering rules as a citable rubric. Parallel fronts erode
   * layering faster than anything else, and nothing else here catches it.
   */
  fitnessFunctions?: boolean;
  /**
   * Make the critic answer a FIXED checklist item by item — one enum verdict
   * (`PASS`/`FAIL`/`N/A`) plus one line of evidence each — instead of writing
   * free prose. A fixed-enum verdict with mandatory evidence is reproducible
   * between runs in a way an uncalibrated judgement is not.
   */
  checklistReview?: boolean;
  /**
   * Compile a traceability pair after the consolidation: an agent builds a
   * bidirectional matrix (every "Done when" criterion → the test/file that
   * settles it, and back) and a check refuses orphans in either direction,
   * looping back to the matrix step.
   */
  traceability?: boolean;
  /**
   * Split each front's work into a characterization step + an implementation
   * step: capture TODAY's observable behavior as committed snapshots before
   * changing anything, then treat any later divergence as a defect unless it
   * was explicitly approved.
   *
   * This is `tdd` for the work that has no spec to test against — audits,
   * knowledge extraction, legacy refactors — which is most of what huu exists
   * to run.
   */
  characterization?: boolean;
  /**
   * Insert a verification pass into the KNOWLEDGE phase (the only methodology
   * that does): one agent per brief re-checks every claim against the
   * repository and demotes what it cannot reproduce into `unknowns`.
   *
   * It never fails and never deletes — every path out of Phase A stays
   * forward. It exists because the orchestrator is blind: the digest is the
   * only thing it learns about the repo, so one confident wrong claim there
   * becomes a plan nobody downstream can correct.
   */
  chainOfVerification?: boolean;
}

/** Everything `runDevMode` needs beyond the shared `AppConfig`. */
export interface DevModeConfig {
  /** The human-underwritten goal. Required — dev mode never invents scope. */
  goal: string;
  approval: DevApprovalMode;
  /**
   * Ceiling on epochs. Undefined = UNBOUNDED: run until the planner reports
   * the goal complete, the consecutive-failure circuit breaker trips, or the
   * caller aborts — bounded only by {@link DEV_UNBOUNDED_EPOCH_BACKSTOP}. The
   * CLI defaults to {@link DEV_DEFAULT_MAX_EPOCHS}; the web sends nothing.
   */
  maxEpochs?: number;
  /** Ceiling on parallel fronts per epoch. Defaults to {@link DEV_MAX_FRONTS}. */
  maxFronts?: number;
  /** Skip the knowledge bootstrap even when the probe says it is missing. */
  skipKnowledgeBootstrap?: boolean;
  /**
   * Per-role model routing. Undefined — or any role left unset inside it —
   * means the emitted step omits `modelId` entirely and falls back to
   * `AppConfig.modelId`, so a session that doesn't ask for routing compiles
   * exactly the pipeline it compiles today. See {@link DEV_MODEL_PRESETS}.
   */
  models?: DevModelPolicy;
  /**
   * Selectable methodologies (the checkboxes). Undefined — or every flag left
   * unset — compiles exactly the pipeline it compiles today, byte for byte.
   * See {@link DevMethodology}.
   */
  methodology?: DevMethodology;
  /**
   * Hard ceiling on what the SESSION may spend, in USD. Checked at the top of
   * each epoch against the sum of every epoch's `costUsd` (which counts BOTH
   * runs). Undefined ⇒ no ceiling, exactly as before.
   *
   * The number was already being collected and was gating nothing: the only
   * two stops an unattended session had were the consecutive-failure breaker
   * (3) and the epoch backstop ({@link DEV_UNBOUNDED_EPOCH_BACKSTOP} = 50), and
   * 50 epochs × two runs × N agents is not a bound anyone can reason about in
   * advance. A dollar figure is. The check is deliberately BETWEEN epochs, not
   * inside one: killing a swarm mid-flight to save money loses the work AND
   * still pays for the tokens already spent.
   */
  maxCostUsd?: number;
  /**
   * Overrides the character ceiling on the knowledge digest — the ONLY thing
   * the blind planner ever reads about the repository.
   *
   * The default ({@link KNOWLEDGE_DIGEST_MAX_CHARS}) is small ON PURPOSE, and
   * not because of any context window: a near-relevant paragraph in a briefing
   * is a distractor that measurably pulls a planner off, so the budget is a
   * DISTRACTOR bound, not a capacity bound. Deriving it from the planner
   * model's window would measure what fits, not what helps.
   *
   * What was wrong before was not the number — it was that the number could not
   * be moved without editing a constant, so nobody could ever measure whether
   * it is right. This is that dial.
   */
  knowledgeDigestMaxChars?: number;
}

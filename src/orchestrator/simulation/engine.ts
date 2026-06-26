/**
 * SimulationEngine — a synthetic, no-side-effect stand-in for the real
 * {@link Orchestrator}. It produces byte-identical {@link OrchestratorState}
 * snapshots and {@link AgentOutputChunk} firehose frames over time, so the
 * EXISTING web kanban / logs / drawer render a believable run WITHOUT any
 * LLM call, git worktree, branch, filesystem write or network access.
 *
 * Used by the `/simulation` web route (a marketing / demo surface). It exposes
 * the small driver contract `WebRunManager` consumes — `subscribe`,
 * `subscribeAgentOutput`, `start`, `abort` — plus `setPaused` and the
 * concurrency nudges, so it slots into the run-manager exactly where a real
 * Orchestrator would.
 *
 * Layering: lives under `orchestrator/`, depends only on `lib/` types and the
 * sibling firehose type — never on git/ui/web. Determinism: progression is
 * driven by a logical tick counter + a seeded PRNG, so tests drive
 * {@link SimulationEngine.advance} directly with no timers and no wall clock.
 */

import type {
  AgentLifecyclePhase,
  AgentStatus,
  AutoScaleStatus,
  CheckRun,
  LogEntry,
  OrchestratorState,
  StageIntegration,
} from '../../lib/types.js';
import type { AgentOutputChunk } from '../types.js';
import { THINKING_LOG_PREFIX } from '../types.js';
import {
  ASSISTANT_LINES,
  FATAL_ERRORS,
  GUARD_LINES,
  JUDGE_REASONS,
  LOG_LINES,
  MERGE_LINES,
  PRESETS,
  RETRY_ERRORS,
  THINKING_LINES,
  TOOLS,
  type SimPreset,
  fill,
  pickFiles,
} from './corpus.js';

export interface SimulationOptions {
  /** Run id shown in the UI (synthetic, e.g. `sim-...`). */
  runId: string;
  /** Chosen model ids — cosmetic labels round-robined across cards. */
  modelIds: string[];
  /** Number of per-file fan-out cards. Clamped to [1, 200]. */
  fileCount: number;
  /** Max cards "in progress" at once. Clamped to [1, 64]. */
  concurrency: number;
  /** Force a specific preset by name; otherwise sampled from the seed. */
  presetName?: string;
  /** Override the displayed pipeline name (defaults to the preset's name). */
  pipelineName?: string;
  /** PRNG seed — same seed + same options ⇒ identical run (tests). */
  seed?: number;
  /** Logical tick interval in ms. Drives the live clock + elapsed. */
  tickMs?: number;
}

/** Minimal result shape the run-manager reads (`runId` + `manifest.errorReason`). */
export interface SimulationResult {
  runId: string;
  manifest: { errorReason?: string };
}

type Scenario =
  | 'happy'
  | 'heavy'
  | 'no_changes'
  | 'requeue'
  | 'error_retry'
  | 'error_final';

type StateName = AgentStatus['state'];

interface MicroStep {
  phase: AgentLifecyclePhase;
  state: StateName;
  ticks: number;
  /** Log template applied once on step entry. */
  log?: string;
  /** Bump token usage on entry. */
  usage?: boolean;
  /** Emit a file_write on entry. */
  file?: boolean;
  /** Tool name — emits an "invoking X" log on entry. */
  tool?: string;
}

interface SimCard {
  id: number;
  status: AgentStatus;
  scenario: Scenario;
  script: MicroStep[];
  /** -1 before the first step is entered. */
  mi: number;
  /** Ticks remaining in the current step. */
  mt: number;
  files: string[];
  /** Index in `script` at which a memory-guard requeue should fire. */
  requeueAt: number;
  requeuesPlanned: number;
  /** Index at which an error+retry should fire (once). */
  retryAt: number;
  /** First streaming step — where a retry jumps back to. */
  streamStart: number;
  retried: boolean;
}

interface WorkPhase {
  kind: 'work';
  name: string;
  stageIndex: number;
  pending: number[];
  active: Set<number>;
  started: boolean;
}

interface MergePhase {
  kind: 'merge';
  name: string;
  stageIndex: number;
  branchIds: number[];
  ticks: number;
  total: number;
  started: boolean;
  record?: StageIntegration;
}

interface CheckPhase {
  kind: 'check';
  runs: number;
  ticks: number;
  total: number;
  started: boolean;
  outcome: 'approved' | 'rework';
  record?: CheckRun;
}

type Phase = WorkPhase | MergePhase | CheckPhase;

const ACTIVE_PHASES: ReadonlySet<AgentLifecyclePhase> = new Set([
  'worktree_creating',
  'worktree_ready',
  'session_starting',
  'streaming',
  'tool_running',
  'finalizing',
  'validating',
  'committing',
  'pushing',
  'cleaning_up',
]);

/** Deterministic, tiny PRNG (mulberry32). */
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Sample the scenario for each of the `n` fan-out cards. GUARANTEES that every
 * "special" scenario the file count can afford is represented at least once —
 * the user wants all scenarios drawn each run — then fills the rest with a
 * happy/heavy mix and shuffles. Exported for unit testing.
 */
export function sampleScenarioDeck(n: number, rng: () => number): Scenario[] {
  const deck: Scenario[] = [];
  const forced: Scenario[] = [];
  if (n >= 4) forced.push('no_changes', 'requeue', 'error_retry');
  if (n >= 8) forced.push('error_final');
  if (n >= 12) forced.push('requeue', 'heavy');
  for (const s of forced) if (deck.length < n) deck.push(s);
  while (deck.length < n) deck.push(rng() < 0.32 ? 'heavy' : 'happy');
  // Fisher–Yates with the seeded rng.
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [deck[i], deck[j]] = [deck[j]!, deck[i]!];
  }
  return deck;
}

const PRICE_IN = 0.000003;
const PRICE_OUT = 0.000012;

export class SimulationEngine {
  private readonly opts: Required<Omit<SimulationOptions, 'presetName' | 'pipelineName'>> &
    Pick<SimulationOptions, 'presetName' | 'pipelineName'>;
  private readonly rng: () => number;
  private readonly preset: SimPreset;
  private readonly modelIds: string[];
  readonly pipelineName: string;

  private readonly subscribers = new Set<(s: OrchestratorState) => void>();
  private readonly outputSubscribers = new Set<(c: AgentOutputChunk) => void>();

  private readonly cards = new Map<number, SimCard>();
  private readonly stageIntegrations: StageIntegration[] = [];
  private readonly checkRuns: CheckRun[] = [];
  private readonly logs: LogEntry[] = [];
  private phases: Phase[] = [];
  private cursor = 0;
  private nextId = 0;
  private nextVisit = 0;
  private reworkBudget = 0;

  private status: OrchestratorState['status'] = 'idle';
  private startedAt = 0;
  private activeTicks = 0;
  private target: number;
  private workStagesEntered = 0;
  private readonly totalStages = 2;
  private totalAgents = 0;
  private doneAgents = 0;
  private autoScale: AutoScaleStatus;

  private paused = false;
  private finished = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private resolveStart: ((r: SimulationResult) => void) | null = null;
  private startPromise: Promise<SimulationResult> | null = null;
  private errorReason: string | undefined;

  constructor(options: SimulationOptions) {
    const seed =
      options.seed != null ? options.seed >>> 0 : hashSeed(options.runId || 'sim');
    this.rng = makeRng(seed);
    this.opts = {
      runId: options.runId,
      modelIds: options.modelIds,
      fileCount: clamp(Math.round(options.fileCount), 1, 200),
      concurrency: clamp(Math.round(options.concurrency), 1, 64),
      seed,
      tickMs: options.tickMs && options.tickMs > 0 ? options.tickMs : 130,
      presetName: options.presetName,
      pipelineName: options.pipelineName,
    };
    this.target = this.opts.concurrency;
    this.modelIds =
      options.modelIds && options.modelIds.length > 0
        ? options.modelIds.filter((m) => m && m.trim())
        : [];
    if (this.modelIds.length === 0) this.modelIds = ['simulation/model'];

    this.preset =
      PRESETS.find((p) => p.name === options.presetName) ??
      PRESETS[Math.floor(this.rng() * PRESETS.length)]!;
    this.pipelineName = this.opts.pipelineName || this.preset.name;

    this.autoScale = {
      enabled: true,
      mode: 'auto',
      state: 'NORMAL',
      cooldownRemainingMs: 0,
      cpuPercent: 22,
      ramPercent: 41,
      observedAgentMemoryMb: 250,
      ramAvailableMb: 6144,
      guardKillCount: 0,
    };

    this.buildPlan();
  }

  // --- driver contract (consumed by WebRunManager) ------------------------

  subscribe(cb: (s: OrchestratorState) => void): () => void {
    this.subscribers.add(cb);
    cb(this.getState());
    return () => this.subscribers.delete(cb);
  }

  subscribeAgentOutput(cb: (c: AgentOutputChunk) => void): () => void {
    this.outputSubscribers.add(cb);
    return () => this.outputSubscribers.delete(cb);
  }

  start(): Promise<SimulationResult> {
    if (this.startPromise) return this.startPromise;
    this.status = 'running';
    this.startedAt = Date.now();
    this.orchLog('simulation started — synthetic run, no branches created');
    this.startPromise = new Promise<SimulationResult>((resolve) => {
      this.resolveStart = resolve;
    });
    this.timer = setInterval(() => {
      try {
        this.advance();
      } catch (err) {
        this.errorReason = err instanceof Error ? err.message : String(err);
        this.finishRun();
      }
    }, this.opts.tickMs);
    this.emit();
    return this.startPromise;
  }

  abort(): void {
    if (this.finished) return;
    this.orchLog('simulation stopped by user');
    this.finishRun();
  }

  setPaused(paused: boolean): void {
    if (this.paused === paused || this.finished) return;
    this.paused = paused;
    this.orchLog(paused ? 'simulation paused' : 'simulation resumed');
    this.emit();
  }

  // The run-manager may forward concurrency controls; in the sim they nudge
  // the live "in progress" cap so the MAX / +/- buttons actually do something.
  setConcurrency(value: number): void {
    this.target = clamp(Math.round(value), 1, 64);
    this.autoScale = { ...this.autoScale, enabled: false, mode: 'manual' };
  }
  increaseConcurrency(): void {
    this.setConcurrency(this.target + 1);
  }
  decreaseConcurrency(): void {
    this.setConcurrency(this.target - 1);
  }
  enableAutoScale(): void {
    this.autoScale = { ...this.autoScale, enabled: true, mode: 'auto' };
  }
  disableAutoScale(): void {
    this.autoScale = { ...this.autoScale, enabled: false, mode: 'manual' };
  }
  enableGreedyMode(): void {
    this.target = clamp(this.opts.fileCount, 1, 64);
    this.autoScale = { ...this.autoScale, enabled: false, mode: 'greedy' };
  }

  // --- plan construction --------------------------------------------------

  private buildPlan(): void {
    const deck = sampleScenarioDeck(this.opts.fileCount, this.rng);
    const files = pickFiles(this.opts.fileCount);
    const fan: WorkPhase = {
      kind: 'work',
      name: this.preset.fanStage,
      stageIndex: 0,
      pending: [],
      active: new Set(),
      started: false,
    };
    for (let i = 0; i < this.opts.fileCount; i++) {
      const id = this.newCard(deck[i]!, [files[i]!], 0, this.preset.fanStage);
      fan.pending.push(id);
    }
    this.phases.push(fan);
    this.phases.push(this.makeMerge(this.preset.fanStage, 0, fan.pending.slice()));

    this.pushConsolidateAndJudge();

    // Usually showcase one judge rework→approved loop (the user asked for it).
    this.reworkBudget = this.opts.fileCount >= 2 && this.rng() < 0.75 ? 1 : 0;
  }

  /** Append a consolidate work stage + its merge + the judge check. */
  private pushConsolidateAndJudge(): void {
    const reportFile = '.huu/audits/report.md';
    const cons: WorkPhase = {
      kind: 'work',
      name: this.preset.consolidateStage,
      stageIndex: 1,
      pending: [],
      active: new Set(),
      started: false,
    };
    const id = this.newCard('happy', [reportFile], 1, this.preset.consolidateStage);
    cons.pending.push(id);
    this.phases.push(cons);
    this.phases.push(this.makeMerge(this.preset.consolidateStage, 1, [id]));
    const check: CheckPhase = {
      kind: 'check',
      runs: 1,
      ticks: 0,
      total: 3 + Math.floor(this.rng() * 4),
      started: false,
      outcome: 'approved',
    };
    this.phases.push(check);
  }

  private makeMerge(name: string, stageIndex: number, branchIds: number[]): MergePhase {
    return {
      kind: 'merge',
      name,
      stageIndex,
      branchIds,
      ticks: 0,
      total: 3 + Math.floor(this.rng() * 4),
      started: false,
    };
  }

  private newCard(
    scenario: Scenario,
    files: string[],
    stageIndex: number,
    stageName: string,
  ): number {
    const id = this.nextId++;
    const shortRun = (this.opts.runId || 'sim').slice(-6);
    const status: AgentStatus = {
      agentId: id,
      state: 'idle',
      phase: 'pending',
      currentFile: files[0] ?? null,
      logs: [],
      tokensIn: 0,
      tokensOut: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      cost: 0,
      filesModified: [],
      branchName: `huu/${shortRun}/agent-${id}`,
      pushStatus: 'pending',
      stageIndex,
      stageName,
      createdAt: Date.now(),
      requeues: 0,
      actionCounts: {},
    };
    const script = this.buildScript(scenario);
    const streamStart = script.findIndex((s) => s.state === 'streaming');
    const streamIdxs = script
      .map((s, i) => (s.state === 'streaming' ? i : -1))
      .filter((i) => i >= 0);
    const midStream = streamIdxs[Math.floor(streamIdxs.length / 2)] ?? 1;
    this.cards.set(id, {
      id,
      status,
      scenario,
      script,
      mi: -1,
      mt: 0,
      files,
      requeueAt: scenario === 'requeue' ? midStream : -1,
      requeuesPlanned: scenario === 'requeue' ? 1 : 0,
      retryAt: scenario === 'error_retry' ? streamIdxs[streamIdxs.length - 1] ?? -1 : -1,
      streamStart: streamStart < 0 ? 0 : streamStart,
      retried: false,
    });
    this.totalAgents++;
    return id;
  }

  private buildScript(scenario: Scenario): MicroStep[] {
    const rint = (lo: number, hi: number) => lo + Math.floor(this.rng() * (hi - lo + 1));
    const streamCount = scenario === 'heavy' ? rint(4, 6) : rint(2, 3);
    const steps: MicroStep[] = [
      { phase: 'session_starting', state: 'idle', ticks: 1, log: 'agent #$id starting on $f' },
    ];
    for (let i = 0; i < streamCount; i++) {
      steps.push({
        phase: 'streaming',
        state: 'streaming',
        ticks: rint(2, 4),
        usage: true,
        log: LOG_LINES[rint(0, LOG_LINES.length - 1)]!,
      });
      if (this.rng() < 0.5) {
        steps.push({
          phase: 'tool_running',
          state: 'tool_running',
          ticks: rint(1, 3),
          tool: TOOLS[rint(0, TOOLS.length - 1)]!,
        });
      }
    }
    if (scenario !== 'no_changes' && scenario !== 'error_final') {
      steps.push({
        phase: 'committing',
        state: 'tool_running',
        ticks: 1,
        file: true,
        log: 'wrote notes for $f',
      });
    }
    return steps;
  }

  // --- the clock ----------------------------------------------------------

  /** Advance one logical tick. `start()` drives this on a timer; tests call it directly. */
  advance(): void {
    if (this.finished) return;
    if (this.paused) {
      this.emit();
      return;
    }
    this.activeTicks++;
    this.tickAutoScale();
    this.step();
    this.emit();
  }

  private step(): void {
    if (this.cursor >= this.phases.length) {
      this.finishRun();
      return;
    }
    const phase = this.phases[this.cursor]!;
    if (phase.kind === 'work') this.stepWork(phase);
    else if (phase.kind === 'merge') this.stepMerge(phase);
    else this.stepCheck(phase);
  }

  private stepWork(phase: WorkPhase): void {
    this.status = 'running';
    if (!phase.started) {
      // Count each distinct work stage we begin, once (clamped for the header).
      phase.started = true;
      this.workStagesEntered = Math.min(this.workStagesEntered + 1, this.totalStages);
    }
    // Fill open slots up to the live concurrency target.
    while (phase.active.size < this.target && phase.pending.length > 0) {
      const id = phase.pending.shift()!;
      const card = this.cards.get(id)!;
      card.status.startedAt = Date.now();
      phase.active.add(id);
      this.enterStep(card, 0, phase);
    }
    for (const id of [...phase.active]) {
      this.advanceCard(this.cards.get(id)!, phase);
    }
    if (phase.pending.length === 0 && phase.active.size === 0) {
      this.cursor++;
    }
  }

  private stepMerge(phase: MergePhase): void {
    this.status = 'integrating';
    if (!phase.started) {
      phase.started = true;
      phase.ticks = phase.total;
      const visitIndex = this.nextVisit++;
      const rec: StageIntegration = {
        visitIndex,
        stepIndex: phase.stageIndex,
        stageName: phase.name,
        runs: 1,
        phase: 'merging',
        modelId: this.modelIds[0]!,
        resolverUsed: false,
        branchesMerged: [],
        branchesPending: phase.branchIds.map((id) => this.cards.get(id)?.status.branchName ?? `agent-${id}`),
        conflicts: [],
        startedAt: Date.now(),
        lastLog: fill(MERGE_LINES[0]!, { n: phase.branchIds.length }),
      };
      this.stageIntegrations.push(rec);
      phase.record = rec;
      this.orchLog(rec.lastLog!, 9997);
      return;
    }
    const rec = phase.record!;
    phase.ticks--;
    // Halfway through, a low chance of a trivial conflict resolved in-place.
    if (phase.ticks === Math.floor(phase.total / 2) && this.rng() < 0.25) {
      rec.resolverUsed = true;
      rec.conflicts = [
        { file: '.huu/audits/report.md', branches: rec.branchesPending.slice(0, 2), resolved: true },
      ];
      rec.lastLog = fill(MERGE_LINES[2]!, { f: '.huu/audits/report.md' });
      this.orchLog(rec.lastLog, 9997);
    }
    if (phase.ticks <= 0) {
      rec.phase = 'done';
      rec.branchesMerged = rec.branchesPending.slice();
      rec.branchesPending = [];
      rec.finishedAt = Date.now();
      rec.lastLog = fill(MERGE_LINES[3]!, { sha: this.sha() });
      this.orchLog(fill(MERGE_LINES[1]!, { n: rec.branchesMerged.length }), 9997);
      this.cursor++;
    }
  }

  private stepCheck(phase: CheckPhase): void {
    this.status = 'running';
    if (!phase.started) {
      phase.started = true;
      phase.ticks = phase.total;
      const willRework = this.reworkBudget > 0 && this.rng() < 0.85;
      phase.outcome = willRework ? 'rework' : 'approved';
      const visitIndex = this.nextVisit++;
      const rec: CheckRun = {
        visitIndex,
        stepIndex: 2,
        stepName: this.preset.judgeStep,
        runs: phase.runs,
        maxRuns: 3,
        phase: 'judging',
        modelId: this.modelIds[0]!,
        condition: this.preset.judgeCondition,
        fromJudge: true,
        startedAt: Date.now(),
      };
      this.checkRuns.push(rec);
      phase.record = rec;
      this.orchLog(`judging: ${this.preset.judgeStep} (run ${phase.runs})`, 9998);
      return;
    }
    const rec = phase.record!;
    phase.ticks--;
    if (phase.ticks <= 0) {
      rec.phase = 'done';
      rec.finishedAt = Date.now();
      if (phase.outcome === 'rework') {
        this.reworkBudget--;
        rec.outcomeLabel = 'rework';
        rec.nextStepName = this.preset.consolidateStage;
        rec.reason = pick(JUDGE_REASONS.rework, this.rng);
        this.orchLog(`verdict: rework → ${rec.nextStepName} (${rec.reason})`, 9998);
        // Splice a fresh consolidate → merge → judge cone right after this check.
        this.spliceRework(phase.runs + 1);
      } else {
        rec.outcomeLabel = 'approved';
        rec.reason = pick(JUDGE_REASONS.approved, this.rng);
        this.orchLog(`verdict: approved (${rec.reason})`, 9998);
      }
      this.cursor++;
    }
  }

  private spliceRework(nextRuns: number): void {
    const reportFile = '.huu/audits/report.md';
    const cons: WorkPhase = {
      kind: 'work',
      name: this.preset.consolidateStage,
      stageIndex: 1,
      pending: [],
      active: new Set(),
      started: false,
    };
    const id = this.newCard('happy', [reportFile], 1, `${this.preset.consolidateStage} (rework)`);
    cons.pending.push(id);
    const merge = this.makeMerge(this.preset.consolidateStage, 1, [id]);
    const check: CheckPhase = {
      kind: 'check',
      runs: nextRuns,
      ticks: 0,
      total: 3 + Math.floor(this.rng() * 4),
      started: false,
      outcome: 'approved',
    };
    this.phases.splice(this.cursor + 1, 0, cons, merge, check);
  }

  // --- per-card progression ----------------------------------------------

  private advanceCard(card: SimCard, phase: WorkPhase): void {
    if (card.mi < 0) {
      this.enterStep(card, 0, phase);
      return;
    }
    const step = card.script[card.mi]!;
    if (step.state === 'streaming') this.streamTick(card);
    card.mt--;
    if (card.mt <= 0) {
      const next = card.mi + 1;
      if (next >= card.script.length) this.finalizeCard(card, phase);
      else this.enterStep(card, next, phase);
    }
  }

  private enterStep(card: SimCard, index: number, phase: WorkPhase): void {
    let i = index;
    if (i === card.requeueAt && card.requeuesPlanned > 0) {
      this.requeueCard(card, phase);
      return;
    }
    if (i === card.retryAt && !card.retried) {
      card.retried = true;
      card.status.attempt = (card.status.attempt ?? 1) + 1;
      const msg = fill(pick(RETRY_ERRORS, this.rng), { a: card.status.attempt - 1 });
      this.cardLog(card, msg, 'error');
      // Jump back to the first streaming step and replay to completion.
      i = card.streamStart;
    }
    const step = card.script[i]!;
    card.mi = i;
    card.mt = step.ticks;
    card.status.phase = step.phase;
    card.status.state = step.state;
    if (step.state === 'streaming') this.bump(card, 'stream');
    if (step.phase === 'session_starting') {
      card.status.tokensIn += 800 + Math.floor(this.rng() * 3200);
      card.status.cacheReadTokens += Math.floor(this.rng() * 1500);
      this.recost(card);
    }
    if (step.usage) {
      card.status.tokensOut += 60 + Math.floor(this.rng() * 140);
      this.recost(card);
      this.bump(card, 'usage');
    }
    if (step.tool) {
      this.cardLog(card, fill('invoking $tool', { tool: step.tool }));
      this.bump(card, 'tool');
    }
    if (step.file) {
      const f = card.files[0] ?? 'report.md';
      if (!card.status.filesModified.includes(f)) card.status.filesModified.push(f);
      this.bump(card, 'file');
    }
    if (step.log) {
      this.cardLog(card, fill(step.log, this.cardVars(card)));
    }
  }

  private streamTick(card: SimCard): void {
    const vars = this.cardVars(card);
    const reply = fill(pick(ASSISTANT_LINES, this.rng), vars);
    this.emitOutput(card.id, 'assistant', reply);
    this.bump(card, 'stream');
    card.status.tokensOut += 30 + Math.floor(this.rng() * 130);
    this.recost(card);
    if (this.rng() < 0.5) {
      const think = fill(pick(THINKING_LINES, this.rng), vars);
      this.emitOutput(card.id, 'thinking', think);
      // Mirror the reasoning trace into the card's per-agent log too (tagged) —
      // matches the real orchestrator; kept OUT of the global run log like it.
      card.status.logs.push(`${THINKING_LOG_PREFIX}${think}`);
      if (card.status.logs.length > 400) card.status.logs.shift();
    }
    // Mirror some of the reply text into the on-page run log (not every line).
    if (this.rng() < 0.35) this.cardLog(card, reply);
  }

  private requeueCard(card: SimCard, phase: WorkPhase): void {
    card.requeuesPlanned--;
    card.status.requeues = (card.status.requeues ?? 0) + 1;
    card.status.phase = 'pending';
    card.status.state = 'idle';
    card.mi = -1;
    card.mt = 0;
    phase.active.delete(card.id);
    phase.pending.unshift(card.id); // requeue at the FRONT, like the real guard
    this.autoScale = {
      ...this.autoScale,
      state: 'DESTROYING',
      guardKillCount: this.autoScale.guardKillCount + 1,
      ramPercent: 96,
      cooldownRemainingMs: 1500,
    };
    this.cardLog(
      card,
      fill(GUARD_LINES[0]!, { ram: 96, id: card.id }),
      'warn',
    );
    this.cardLog(
      card,
      fill(GUARD_LINES[1]!, { f: card.files[0] ?? '', n: card.status.requeues }),
      'warn',
    );
  }

  private finalizeCard(card: SimCard, phase: WorkPhase): void {
    phase.active.delete(card.id);
    card.status.finishedAt = Date.now();
    if (card.scenario === 'error_final') {
      card.status.phase = 'error';
      card.status.state = 'error';
      card.status.error = pick(FATAL_ERRORS, this.rng);
      card.status.errorKind = 'failed';
      card.status.pushStatus = 'skipped';
      this.bump(card, 'error');
      this.cardLog(card, card.status.error, 'error');
    } else if (card.scenario === 'no_changes') {
      card.status.phase = 'no_changes';
      card.status.state = 'done';
      card.status.pushStatus = 'skipped';
      this.bump(card, 'done');
      this.cardLog(card, 'no production source modified (report-only)');
    } else {
      card.status.phase = 'done';
      card.status.state = 'done';
      card.status.commitSha = this.sha();
      card.status.pushStatus = 'skipped';
      this.bump(card, 'done');
      this.cardLog(card, fill('done $verb $f', this.cardVars(card)));
    }
    this.doneAgents++;
  }

  // --- helpers ------------------------------------------------------------

  private cardVars(card: SimCard): Record<string, string | number> {
    return {
      f: card.files[0] ?? 'the project',
      id: card.id,
      verb: this.preset.verb,
      n: 1 + Math.floor(this.rng() * 6),
      lines: 40 + Math.floor(this.rng() * 600),
      ms: 20 + Math.floor(this.rng() * 900),
      tool: TOOLS[Math.floor(this.rng() * TOOLS.length)]!,
    };
  }

  private bump(card: SimCard, action: string): void {
    const counts = (card.status.actionCounts ??= {});
    counts[action] = (counts[action] ?? 0) + 1;
    card.status.lastAction = action;
  }

  private recost(card: SimCard): void {
    card.status.cost = +(card.status.tokensIn * PRICE_IN + card.status.tokensOut * PRICE_OUT).toFixed(4);
  }

  private sha(): string {
    const hex = '0123456789abcdef';
    let s = '';
    for (let i = 0; i < 7; i++) s += hex[Math.floor(this.rng() * 16)];
    return s;
  }

  private cardLog(card: SimCard, message: string, level: LogEntry['level'] = 'info'): void {
    card.status.logs.push(message);
    if (card.status.logs.length > 400) card.status.logs.shift();
    this.logs.push({
      timestamp: Date.now(),
      agentId: card.id,
      level,
      phase: card.status.phase,
      message,
      modelId: this.modelIds[card.id % this.modelIds.length],
      runId: this.opts.runId,
      stageIndex: card.status.stageIndex,
      stageName: card.status.stageName,
      kind: 'worker',
    });
    this.bump(card, 'log');
    this.trimLogs();
  }

  private orchLog(message: string, agentId = 9999): void {
    this.logs.push({
      timestamp: Date.now(),
      agentId,
      level: 'info',
      message,
      runId: this.opts.runId,
      kind: agentId === 9998 ? 'integrator' : 'orchestrator',
    });
    this.trimLogs();
  }

  private trimLogs(): void {
    if (this.logs.length > 600) this.logs.splice(0, this.logs.length - 600);
  }

  private tickAutoScale(): void {
    const a = this.autoScale;
    const drift = (cur: number, lo: number, hi: number) =>
      clamp(cur + (this.rng() - 0.5) * 8, lo, hi);
    let state = a.state;
    let cooldown = Math.max(0, a.cooldownRemainingMs - this.opts.tickMs);
    let ram = a.ramPercent;
    if (state === 'DESTROYING' && cooldown === 0) {
      state = 'COOLDOWN';
    } else if (state === 'COOLDOWN' && cooldown === 0) {
      state = 'NORMAL';
    }
    if (state === 'NORMAL') ram = drift(ram, 30, 78);
    this.autoScale = {
      ...a,
      state,
      cooldownRemainingMs: cooldown,
      cpuPercent: Math.round(drift(a.cpuPercent, 8, 72)),
      ramPercent: Math.round(ram),
      observedAgentMemoryMb: Math.round(clamp(a.observedAgentMemoryMb + (this.rng() - 0.5) * 12, 180, 420)),
      ramAvailableMb: Math.round(clamp(a.ramAvailableMb + (this.rng() - 0.5) * 256, 1024, 12288)),
    };
  }

  private finishRun(): void {
    if (this.finished) return;
    this.finished = true;
    this.status = 'done';
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.orchLog(
      this.errorReason
        ? `simulation ended with error: ${this.errorReason}`
        : 'simulation complete',
    );
    this.emit();
    this.resolveStart?.({ runId: this.opts.runId, manifest: { errorReason: this.errorReason } });
    this.resolveStart = null;
  }

  private emitOutput(agentId: number, channel: AgentOutputChunk['channel'], text: string): void {
    if (this.outputSubscribers.size === 0) return;
    const chunk: AgentOutputChunk = { agentId, channel, text };
    for (const cb of this.outputSubscribers) cb(chunk);
  }

  private emit(): void {
    if (this.subscribers.size === 0) return;
    const state = this.getState();
    for (const cb of this.subscribers) cb(state);
  }

  getState(): OrchestratorState {
    let active = 0;
    let pending = 0;
    let cost = 0;
    const agents: AgentStatus[] = [];
    for (const card of this.cards.values()) {
      agents.push(card.status);
      cost += card.status.cost;
      if (card.status.phase === 'pending') pending++;
      else if (ACTIVE_PHASES.has(card.status.phase)) active++;
    }
    agents.sort((a, b) => a.agentId - b.agentId);
    return {
      status: this.status,
      runId: this.opts.runId,
      agents,
      logs: this.logs.slice(-200),
      totalCost: +cost.toFixed(4),
      completedTasks: this.doneAgents,
      totalTasks: this.totalAgents,
      integrationStatus: {
        phase: this.status === 'integrating' ? 'merging' : this.finished ? 'done' : 'pending',
        branchesMerged: this.stageIntegrations.flatMap((s) => s.branchesMerged),
        branchesPending: [],
        conflicts: [],
      },
      stageIntegrations: [...this.stageIntegrations],
      checkRuns: [...this.checkRuns],
      startedAt: this.startedAt,
      elapsedMs: this.activeTicks * this.opts.tickMs,
      concurrency: this.target,
      currentStage: Math.max(1, this.workStagesEntered),
      totalStages: this.totalStages,
      pendingTaskCount: pending,
      activeAgentCount: active,
      autoScale: this.autoScale,
    };
  }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function pick<T>(arr: readonly T[], rng: () => number): T {
  return arr[Math.floor(rng() * arr.length)]!;
}

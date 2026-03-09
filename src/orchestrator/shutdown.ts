// Graceful shutdown (5.2.4)
//
// Signal handlers for SIGINT/SIGTERM with phased shutdown:
// QUIESCE → DRAIN → FLUSH → CLEANUP → EXIT
//
// Second signal forces immediate exit (fail-safe).

import type Database from 'better-sqlite3';
import { walCheckpoint } from '../db/connection.js';
import { RunStateMachine } from './state-machine.js';
import { EventLog } from './recovery.js';

// ── Types ────────────────────────────────────────────────────────────

export type ShutdownPhase = 'running' | 'quiesce' | 'drain' | 'flush' | 'cleanup' | 'exit';

export interface ShutdownConfig {
  /** Maximum time to wait for agents to finish (ms). */
  gracePeriodMs: number;
  /** Maximum time for final merge processing (ms). */
  mergeFlushTimeoutMs: number;
  /** Maximum time for DB checkpoint (ms). */
  checkpointTimeoutMs: number;
}

export const DEFAULT_SHUTDOWN_CONFIG: ShutdownConfig = {
  gracePeriodMs: 30_000,
  mergeFlushTimeoutMs: 10_000,
  checkpointTimeoutMs: 5_000,
};

export interface ShutdownState {
  phase: ShutdownPhase;
  signalCount: number;
  firstSignalAt: number | null;
  drainStartedAt: number | null;
  exitCode: number;
}

export type ShutdownHook = () => Promise<void> | void;

// ── Shutdown manager ─────────────────────────────────────────────────

export class ShutdownManager {
  private readonly config: ShutdownConfig;
  private readonly state: ShutdownState;
  private readonly hooks: {
    onQuiesce: ShutdownHook[];
    onDrain: ShutdownHook[];
    onFlush: ShutdownHook[];
    onCleanup: ShutdownHook[];
  };
  private abortController: AbortController | null = null;
  private db: Database.Database | null = null;
  private runId: string | null = null;
  private stateMachine: RunStateMachine | null = null;
  private eventLog: EventLog | null = null;
  private registered = false;

  constructor(config?: Partial<ShutdownConfig>) {
    this.config = { ...DEFAULT_SHUTDOWN_CONFIG, ...config };
    this.state = {
      phase: 'running',
      signalCount: 0,
      firstSignalAt: null,
      drainStartedAt: null,
      exitCode: 0,
    };
    this.hooks = {
      onQuiesce: [],
      onDrain: [],
      onFlush: [],
      onCleanup: [],
    };
  }

  /**
   * Initialize with runtime dependencies.
   */
  init(params: {
    db: Database.Database;
    runId: string;
    abortController: AbortController;
  }): void {
    this.db = params.db;
    this.runId = params.runId;
    this.abortController = params.abortController;
    this.stateMachine = new RunStateMachine(params.db);
    this.eventLog = new EventLog(params.db);
  }

  /**
   * Register signal handlers. Idempotent.
   */
  registerSignalHandlers(): void {
    if (this.registered) return;
    this.registered = true;

    const handler = (signal: NodeJS.Signals) => {
      void this.handleSignal(signal);
    };

    process.on('SIGINT', handler);
    process.on('SIGTERM', handler);
  }

  /**
   * Register lifecycle hooks.
   */
  onPhase(phase: 'quiesce' | 'drain' | 'flush' | 'cleanup', hook: ShutdownHook): void {
    switch (phase) {
      case 'quiesce': this.hooks.onQuiesce.push(hook); break;
      case 'drain': this.hooks.onDrain.push(hook); break;
      case 'flush': this.hooks.onFlush.push(hook); break;
      case 'cleanup': this.hooks.onCleanup.push(hook); break;
    }
  }

  /**
   * Get current shutdown state.
   */
  getState(): Readonly<ShutdownState> {
    return this.state;
  }

  /**
   * Check if shutdown has been requested.
   */
  isShuttingDown(): boolean {
    return this.state.phase !== 'running';
  }

  /**
   * Handle incoming signal.
   */
  async handleSignal(signal: NodeJS.Signals): Promise<void> {
    this.state.signalCount++;

    // Second signal — force exit
    if (this.state.signalCount > 1) {
      this.state.exitCode = 1;
      this.state.phase = 'exit';

      // Log forced exit
      if (this.eventLog && this.runId) {
        try {
          this.eventLog.append({
            runId: this.runId,
            eventType: 'forced_shutdown',
            payload: { signal, signalCount: this.state.signalCount },
            idempotencyKey: `forced-shutdown-${this.runId}`,
          });
        } catch {
          // Best effort
        }
      }

      // Final checkpoint attempt
      if (this.db) {
        try { walCheckpoint(this.db, 'PASSIVE'); } catch { /* best effort */ }
      }

      process.exit(1);
    }

    // First signal — start graceful shutdown
    this.state.firstSignalAt = Date.now();
    await this.executeGracefulShutdown(signal);
  }

  /**
   * Execute the phased shutdown sequence.
   */
  async executeGracefulShutdown(signal: NodeJS.Signals): Promise<void> {
    // Phase 1: QUIESCE — stop accepting new tasks
    this.state.phase = 'quiesce';
    if (this.abortController) {
      // Signal to the orchestrator loop to stop assigning
      // (the loop checks isShuttingDown())
    }
    if (this.stateMachine && this.runId) {
      try {
        this.stateMachine.requestShutdown(this.runId);
      } catch {
        // Run may already be in terminal state
      }
    }
    await this.runHooks(this.hooks.onQuiesce);

    // Phase 2: DRAIN — wait for in-progress agents
    this.state.phase = 'drain';
    this.state.drainStartedAt = Date.now();
    await this.runHooks(this.hooks.onDrain);

    // Wait for drain with timeout
    const drainDeadline = Date.now() + this.config.gracePeriodMs;
    while (Date.now() < drainDeadline) {
      // Check if all agents have finished (hooks should signal this)
      if (this.abortController?.signal.aborted) break;
      await sleep(250);
    }

    // If drain timed out, abort remaining agents
    if (this.abortController && !this.abortController.signal.aborted) {
      this.abortController.abort();
    }

    // Phase 3: FLUSH — persist checkpoint + process pending merges
    this.state.phase = 'flush';
    await this.runHooks(this.hooks.onFlush);

    // Log graceful shutdown event
    if (this.eventLog && this.runId) {
      try {
        this.eventLog.append({
          runId: this.runId,
          eventType: 'graceful_shutdown',
          payload: {
            signal,
            drainDurationMs: Date.now() - (this.state.drainStartedAt ?? Date.now()),
          },
          idempotencyKey: `graceful-shutdown-${this.runId}`,
        });
      } catch {
        // Best effort
      }
    }

    // WAL checkpoint
    if (this.db) {
      try { walCheckpoint(this.db, 'FULL'); } catch { /* best effort */ }
    }

    // Phase 4: CLEANUP — release resources
    this.state.phase = 'cleanup';
    await this.runHooks(this.hooks.onCleanup);

    // Close DB
    if (this.db) {
      try { this.db.close(); } catch { /* best effort */ }
    }

    // Phase 5: EXIT
    this.state.phase = 'exit';
    this.state.exitCode = 0;
    process.exit(0);
  }

  // ── Internal ────────────────────────────────────────────────────────

  private async runHooks(hooks: ShutdownHook[]): Promise<void> {
    for (const hook of hooks) {
      try {
        await hook();
      } catch {
        // Don't let hook errors break shutdown sequence
      }
    }
  }
}

// ── Utility ──────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Create a preconfigured shutdown manager with standard hooks.
 */
export function createShutdownManager(params: {
  db: Database.Database;
  runId: string;
  abortController: AbortController;
  config?: Partial<ShutdownConfig>;
  onQuiesce?: ShutdownHook;
  onDrain?: ShutdownHook;
  onFlush?: ShutdownHook;
  onCleanup?: ShutdownHook;
}): ShutdownManager {
  const manager = new ShutdownManager(params.config);
  manager.init({
    db: params.db,
    runId: params.runId,
    abortController: params.abortController,
  });
  if (params.onQuiesce) manager.onPhase('quiesce', params.onQuiesce);
  if (params.onDrain) manager.onPhase('drain', params.onDrain);
  if (params.onFlush) manager.onPhase('flush', params.onFlush);
  if (params.onCleanup) manager.onPhase('cleanup', params.onCleanup);
  return manager;
}

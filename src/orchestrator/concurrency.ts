// Concurrency cap — configurable scheduler queue with backpressure
//
// Provides a queue-based concurrency limiter for agent tasks with:
// - Configurable max concurrent agents (default 5, range 1..20)
// - Backpressure: rejects new tasks when backlog exceeds threshold
// - AbortSignal support for cancellation
// - Introspection: running count, pending count, saturation status
// - ENV override: HUU_MAX_CONCURRENT_AGENTS

import type { OrchestratorConfig } from '../types/index.js';

// ── Configuration resolution ────────────────────────────────────────

const MIN_CONCURRENCY = 1;
const MAX_CONCURRENCY = 20;
const WARN_CONCURRENCY = 10;
const DEFAULT_CONCURRENCY = 5;
const DEFAULT_MAX_PENDING = 50;

export interface ConcurrencyConfig {
  maxConcurrentAgents: number;
  maxPendingTasks: number;
}

/**
 * Resolve the effective concurrency cap from multiple sources.
 * Priority: CLI flag > ENV > config file > default.
 */
export function resolveConcurrencyCap(opts: {
  cliFlag?: number | undefined;
  envVar?: string | undefined;
  configValue?: number | undefined;
}): { cap: number; warning?: string } {
  let cap = DEFAULT_CONCURRENCY;
  let source = 'default';

  // config file
  if (opts.configValue !== undefined && opts.configValue >= MIN_CONCURRENCY) {
    cap = opts.configValue;
    source = 'config';
  }

  // ENV override
  if (opts.envVar !== undefined) {
    const parsed = parseInt(opts.envVar, 10);
    if (!Number.isNaN(parsed) && parsed >= MIN_CONCURRENCY) {
      cap = parsed;
      source = 'env';
    }
  }

  // CLI flag override
  if (opts.cliFlag !== undefined && opts.cliFlag >= MIN_CONCURRENCY) {
    cap = opts.cliFlag;
    source = 'cli';
  }

  // Validate range
  cap = Math.max(MIN_CONCURRENCY, Math.min(MAX_CONCURRENCY, cap));

  if (cap > WARN_CONCURRENCY) {
    const warning = `Concurrency cap set to ${cap} (from ${source}). Values above ${WARN_CONCURRENCY} may increase coordination overhead. Monitor metrics and reduce if throughput degrades.`;
    return { cap, warning };
  }

  return { cap };
}

// ── Scheduler Queue ─────────────────────────────────────────────────

export type TaskPriority = number; // higher = more important

interface QueueEntry<T> {
  id: string;
  priority: TaskPriority;
  task: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
  signal?: AbortSignal | undefined;
}

export interface SchedulerQueueStats {
  running: number;
  pending: number;
  maxConcurrent: number;
  maxPending: number;
  isSaturated: boolean;
  totalCompleted: number;
  totalRejected: number;
}

/**
 * Priority-based concurrency limiter with backpressure.
 * Does NOT replace the orchestrator's FSM — augments it with queue discipline.
 */
export class SchedulerQueue {
  private readonly maxConcurrent: number;
  private readonly maxPending: number;
  private readonly pending: QueueEntry<unknown>[] = [];
  private running = 0;
  private _totalCompleted = 0;
  private _totalRejected = 0;
  private _draining = false;

  constructor(config?: Partial<ConcurrencyConfig>) {
    this.maxConcurrent = config?.maxConcurrentAgents ?? DEFAULT_CONCURRENCY;
    this.maxPending = config?.maxPendingTasks ?? DEFAULT_MAX_PENDING;
  }

  /**
   * Enqueue a task. Returns a promise that resolves when the task completes.
   * Throws if backpressure is active (queue full).
   */
  add<T>(
    task: () => Promise<T>,
    opts?: { id?: string; priority?: number; signal?: AbortSignal },
  ): Promise<T> {
    if (this._draining) {
      return Promise.reject(new Error('Scheduler is draining — no new tasks accepted'));
    }

    if (this.pending.length >= this.maxPending && this.running >= this.maxConcurrent) {
      this._totalRejected++;
      return Promise.reject(
        new SchedulerOverloadError(
          `Scheduler overloaded: ${this.pending.length} pending, ${this.running} running (backpressure active)`,
        ),
      );
    }

    // Check if already aborted
    if (opts?.signal?.aborted) {
      return Promise.reject(new Error('Task aborted before enqueue'));
    }

    return new Promise<T>((resolve, reject) => {
      const entry: QueueEntry<T> = {
        id: opts?.id ?? `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        priority: opts?.priority ?? 0,
        task,
        resolve,
        reject,
        signal: opts?.signal,
      };

      // Listen for abort
      if (opts?.signal) {
        const onAbort = () => {
          const idx = this.pending.indexOf(entry as QueueEntry<unknown>);
          if (idx >= 0) {
            this.pending.splice(idx, 1);
            reject(new Error('Task aborted while pending'));
          }
        };
        opts.signal.addEventListener('abort', onAbort, { once: true });
      }

      this.pending.push(entry as QueueEntry<unknown>);
      // Sort by priority descending (higher priority first)
      this.pending.sort((a, b) => b.priority - a.priority);

      this.tryRunNext();
    });
  }

  /** Current stats for monitoring. */
  get stats(): SchedulerQueueStats {
    return {
      running: this.running,
      pending: this.pending.length,
      maxConcurrent: this.maxConcurrent,
      maxPending: this.maxPending,
      isSaturated: this.running >= this.maxConcurrent,
      totalCompleted: this._totalCompleted,
      totalRejected: this._totalRejected,
    };
  }

  /** Whether the queue is full and running at capacity. */
  get isSaturated(): boolean {
    return this.running >= this.maxConcurrent;
  }

  /** Current number of running tasks. */
  get runningCount(): number {
    return this.running;
  }

  /** Current number of pending tasks. */
  get pendingCount(): number {
    return this.pending.length;
  }

  /**
   * Drain the queue: stop accepting new tasks, wait for running to finish,
   * reject remaining pending tasks.
   */
  async drain(): Promise<void> {
    this._draining = true;

    // Reject all pending
    for (const entry of this.pending) {
      entry.reject(new Error('Scheduler drained — task cancelled'));
    }
    this.pending.length = 0;

    // Wait for running to finish
    while (this.running > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
    }

    this._draining = false;
  }

  /** Clear pending tasks without affecting running ones. */
  clearPending(): number {
    const count = this.pending.length;
    for (const entry of this.pending) {
      entry.reject(new Error('Task cleared from queue'));
    }
    this.pending.length = 0;
    return count;
  }

  private tryRunNext(): void {
    while (this.running < this.maxConcurrent && this.pending.length > 0) {
      const entry = this.pending.shift()!;

      // Skip if already aborted
      if (entry.signal?.aborted) {
        entry.reject(new Error('Task aborted before execution'));
        continue;
      }

      this.running++;

      entry
        .task()
        .then((result) => {
          this._totalCompleted++;
          entry.resolve(result);
        })
        .catch((err) => {
          entry.reject(err);
        })
        .finally(() => {
          this.running--;
          this.tryRunNext();
        });
    }
  }
}

// ── Error types ─────────────────────────────────────────────────────

export class SchedulerOverloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SchedulerOverloadError';
  }
}

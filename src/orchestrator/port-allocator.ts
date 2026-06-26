import { createServer } from 'node:net';

export interface AgentPortBundle {
  agentId: number;
  http: number;
  db: number;
  ws: number;
  extras: number[];
  databaseUrl: string;
}

export interface PortAllocatorOptions {
  basePort?: number;
  windowSize?: number;
  maxAgents?: number;
  enabled?: boolean;
  /**
   * Shared cross-run reservation set. In multi-run scheduling the
   * GlobalScheduler passes ONE Set to every subordinate run's allocator, so two
   * runs (each with their own agentId space) can never hand out the same
   * physical port window. Omit for single-run — the allocator then owns a
   * private set and behaves exactly as before.
   */
  sharedReservedPorts?: Set<number>;
}

const DEFAULT_BASE_PORT = 55100;
const DEFAULT_WINDOW_SIZE = 10;
const DEFAULT_MAX_AGENTS = 20;
const SLOTS_PER_BUNDLE = 10;

/**
 * Allocates a contiguous, host-validated port window per agentId so parallel
 * worktrees never collide on bind(). Each bundle reserves `windowSize` ports
 * (default 10): http, db, ws, plus extras[0..6]. Probe is TCP bind on
 * 127.0.0.1 with `exclusive: true` — if any slot is taken by an external
 * process, the whole window slides forward until a free one is found.
 *
 * The reservation is in-memory (per orchestrator run); release() is mandatory
 * on every agent exit path to avoid leaking ranges across retries.
 */
export class PortAllocator {
  private readonly basePort: number;
  private readonly windowSize: number;
  private maxAgents: number;
  private readonly enabled: boolean;
  private readonly reserved = new Map<number, AgentPortBundle>();
  /**
   * Set of every port currently claimed. Private per allocator unless a shared
   * Set is injected (multi-run), in which case it spans all concurrent runs so
   * windows are never double-handed-out across runs.
   */
  private readonly reservedPorts: Set<number>;

  constructor(options: PortAllocatorOptions = {}) {
    this.basePort = options.basePort ?? DEFAULT_BASE_PORT;
    this.windowSize = Math.max(SLOTS_PER_BUNDLE, options.windowSize ?? DEFAULT_WINDOW_SIZE);
    this.maxAgents = options.maxAgents ?? DEFAULT_MAX_AGENTS;
    this.enabled = options.enabled ?? true;
    this.reservedPorts = options.sharedReservedPorts ?? new Set<number>();
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setMaxAgents(n: number): void {
    if (n < 1) throw new Error(`PortAllocator.setMaxAgents: n must be >= 1, got ${n}`);
    this.maxAgents = n;
  }

  async allocate(agentId: number): Promise<AgentPortBundle> {
    if (!this.enabled) {
      throw new Error('PortAllocator is disabled');
    }
    const existing = this.reserved.get(agentId);
    if (existing) return existing;

    // Start at the agent's natural slot but slide forward on collision.
    // The cap (`maxAgents`) is the *expected* concurrency, not a hard limit
    // — we keep scanning past it because external processes could occupy any
    // window in the range and we still need to find one.
    const startSlot = Math.max(0, agentId - 1);
    for (let attempt = 0; attempt < this.maxAgents * 4; attempt++) {
      const slot = (startSlot + attempt) % (this.maxAgents * 4);
      const base = this.basePort + slot * this.windowSize;
      const bundle = await this.tryReserveWindow(agentId, base);
      if (bundle) {
        this.reserved.set(agentId, bundle);
        return bundle;
      }
    }
    throw new Error(
      `PortAllocator: no free window found in [${this.basePort}, ${this.basePort + this.maxAgents * 4 * this.windowSize}) for agent ${agentId}`,
    );
  }

  release(agentId: number): void {
    const bundle = this.reserved.get(agentId);
    if (!bundle) return;
    this.reserved.delete(agentId);
    this.reservedPorts.delete(bundle.http);
    this.reservedPorts.delete(bundle.db);
    this.reservedPorts.delete(bundle.ws);
    for (const p of bundle.extras) this.reservedPorts.delete(p);
  }

  getBundle(agentId: number): AgentPortBundle | undefined {
    return this.reserved.get(agentId);
  }

  releaseAll(): void {
    // Release only THIS allocator's own windows from reservedPorts — the set
    // may be shared with other concurrent runs, so a blanket clear() would
    // free their reservations too. (For a private set this is equivalent to
    // clear(), since the only members are this allocator's bundles.)
    for (const bundle of this.reserved.values()) {
      this.reservedPorts.delete(bundle.http);
      this.reservedPorts.delete(bundle.db);
      this.reservedPorts.delete(bundle.ws);
      for (const p of bundle.extras) this.reservedPorts.delete(p);
    }
    this.reserved.clear();
  }

  private async tryReserveWindow(
    agentId: number,
    base: number,
  ): Promise<AgentPortBundle | null> {
    const slots: number[] = [];
    for (let i = 0; i < SLOTS_PER_BUNDLE; i++) slots.push(base + i);

    // Claim the whole window SYNCHRONOUSLY (before any await) so a concurrent
    // allocate() — from this run OR another run sharing this reservedPorts set
    // (multi-run scheduling) — cannot pick the same window during the async
    // probe gap. Bind+close probes alone are a TOCTOU; the synchronous claim
    // is what actually serializes window hand-out within the event loop.
    for (const port of slots) {
      if (this.reservedPorts.has(port)) return null;
    }
    for (const port of slots) this.reservedPorts.add(port);

    // Validate against EXTERNAL processes. Bind+close is cheap; the cost we
    // care about is the alternative: launching an agent that crashes on
    // EADDRINUSE. If any slot is taken, drop the optimistic claim and slide.
    for (const port of slots) {
      const free = await probePortFree(port);
      if (!free) {
        for (const p of slots) this.reservedPorts.delete(p);
        return null;
      }
    }

    const [http, db, ws, ...extras] = slots;
    return {
      agentId,
      http: http!,
      db: db!,
      ws: ws!,
      extras,
      databaseUrl: `postgresql://localhost:${db!}/huu_agent_${agentId}`,
    };
  }
}

/**
 * Returns true iff the port can be exclusively bound on 127.0.0.1.
 * `exclusive: true` makes the bind fail when another process holds the port
 * even with SO_REUSEADDR semantics — exactly the failure mode we want to
 * detect before launching an agent on top of it.
 */
function probePortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.unref();
    let settled = false;
    const settle = (value: boolean) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    server.once('error', () => {
      settle(false);
      server.close(() => undefined);
    });
    server.once('listening', () => {
      server.close(() => settle(true));
    });
    try {
      server.listen({ port, host: '127.0.0.1', exclusive: true });
    } catch {
      settle(false);
    }
  });
}

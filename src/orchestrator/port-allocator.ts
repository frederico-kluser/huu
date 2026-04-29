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
   * When true, scan the entire usable port space (up to MAX_PORT - windowSize)
   * instead of capping at `maxAgents * 4`. Used by the autoscaler since the
   * agent count is not known up-front.
   */
  unlimited?: boolean;
}

const DEFAULT_BASE_PORT = 55100;
const DEFAULT_WINDOW_SIZE = 10;
const DEFAULT_MAX_AGENTS = 20;
const SLOTS_PER_BUNDLE = 10;
const MAX_PORT = 65535;

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
  private readonly maxAgents: number;
  private readonly enabled: boolean;
  private unlimited: boolean;
  private readonly reserved = new Map<number, AgentPortBundle>();
  private readonly reservedPorts = new Set<number>();

  constructor(options: PortAllocatorOptions = {}) {
    this.basePort = options.basePort ?? DEFAULT_BASE_PORT;
    this.windowSize = Math.max(SLOTS_PER_BUNDLE, options.windowSize ?? DEFAULT_WINDOW_SIZE);
    this.maxAgents = options.maxAgents ?? DEFAULT_MAX_AGENTS;
    this.enabled = options.enabled ?? true;
    this.unlimited = options.unlimited ?? false;
  }

  /**
   * Toggle unlimited mode at runtime — invoked by the orchestrator when the
   * autoscaler is enabled so port allocation tracks dynamic agent counts.
   */
  setUnlimited(value: boolean): void {
    this.unlimited = value;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  async allocate(agentId: number): Promise<AgentPortBundle> {
    if (!this.enabled) {
      throw new Error('PortAllocator is disabled');
    }
    const existing = this.reserved.get(agentId);
    if (existing) return existing;

    // Start at the agent's natural slot but slide forward on collision.
    // In bounded mode (default) the cap is `maxAgents * 4` slots, with a wrap
    // so a high-id agent doesn't run out of range. In unlimited mode (auto-
    // scale) we scan sequentially up to MAX_PORT, no wrap — agentIds can grow
    // past the bounded range and there is no useful modulus.
    const startSlot = Math.max(0, agentId - 1);
    const slotCount = this.unlimited
      ? Math.max(0, Math.floor((MAX_PORT - this.basePort) / this.windowSize) - 1)
      : this.maxAgents * 4;
    for (let attempt = 0; attempt < slotCount; attempt++) {
      const slot = this.unlimited
        ? startSlot + attempt
        : (startSlot + attempt) % slotCount;
      const base = this.basePort + slot * this.windowSize;
      if (base + this.windowSize > MAX_PORT) break;
      const bundle = await this.tryReserveWindow(agentId, base);
      if (bundle) {
        this.reserved.set(agentId, bundle);
        return bundle;
      }
    }
    throw new Error(
      `PortAllocator: no free window found in [${this.basePort}, ${this.basePort + slotCount * this.windowSize}) for agent ${agentId}`,
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
    this.reserved.clear();
    this.reservedPorts.clear();
  }

  private async tryReserveWindow(
    agentId: number,
    base: number,
  ): Promise<AgentPortBundle | null> {
    const slots: number[] = [];
    for (let i = 0; i < SLOTS_PER_BUNDLE; i++) slots.push(base + i);

    // Reject upfront if any slot is in our internal reserved set — avoids a
    // probe race where two allocate() calls await on adjacent ports.
    for (const port of slots) {
      if (this.reservedPorts.has(port)) return null;
    }

    // Probe each slot. Bind+close is cheap; the cost we care about is the
    // alternative: launching an agent that crashes on EADDRINUSE.
    for (const port of slots) {
      const free = await probePortFree(port);
      if (!free) return null;
    }

    for (const port of slots) this.reservedPorts.add(port);

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

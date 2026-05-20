import { describe, it, expect, afterEach } from 'vitest';
import { createServer, type Server } from 'node:net';
import { PortAllocator } from './port-allocator.js';

const TEST_BASE = 56500;
const TEST_WINDOW = 10;

function activeServers(): Server[] {
  return holders;
}

const holders: Server[] = [];

function holdPort(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.once('listening', () => {
      holders.push(server);
      resolve();
    });
    server.listen({ port, host: '127.0.0.1', exclusive: true });
  });
}

afterEach(async () => {
  await Promise.all(
    activeServers().splice(0).map(
      (s) => new Promise<void>((resolve) => s.close(() => resolve())),
    ),
  );
});

describe('PortAllocator', () => {
  it('hands out non-overlapping windows for sequential agents', async () => {
    const alloc = new PortAllocator({ basePort: TEST_BASE, windowSize: TEST_WINDOW, maxAgents: 5 });
    const seen = new Set<number>();
    for (let id = 1; id <= 5; id++) {
      const bundle = await alloc.allocate(id);
      expect(bundle.agentId).toBe(id);
      // Bundle's primary ports must be unique across all agents.
      for (const p of [bundle.http, bundle.db, bundle.ws, ...bundle.extras]) {
        expect(seen.has(p)).toBe(false);
        seen.add(p);
      }
    }
  });

  it('exposes semantic slots aligned to base port', async () => {
    const alloc = new PortAllocator({ basePort: TEST_BASE + 100, windowSize: 10, maxAgents: 3 });
    const b = await alloc.allocate(1);
    expect(b.http).toBe(TEST_BASE + 100);
    expect(b.db).toBe(TEST_BASE + 101);
    expect(b.ws).toBe(TEST_BASE + 102);
    expect(b.extras).toHaveLength(7);
    expect(b.databaseUrl).toBe(`postgresql://localhost:${b.db}/huu_agent_1`);
  });

  it('returns the same bundle for repeated allocate(id) without releasing', async () => {
    const alloc = new PortAllocator({ basePort: TEST_BASE + 200, windowSize: 10, maxAgents: 3 });
    const a = await alloc.allocate(7);
    const b = await alloc.allocate(7);
    expect(a).toBe(b);
  });

  it('reuses a window after release()', async () => {
    const alloc = new PortAllocator({ basePort: TEST_BASE + 300, windowSize: 10, maxAgents: 3 });
    const a = await alloc.allocate(1);
    alloc.release(1);
    const b = await alloc.allocate(1);
    expect(b.http).toBe(a.http);
  });

  it('skips a window when an external process holds one of its ports', async () => {
    const base = TEST_BASE + 400;
    // Occupy the http slot of agent 1's natural window.
    await holdPort(base);
    const alloc = new PortAllocator({ basePort: base, windowSize: 10, maxAgents: 5 });
    const bundle = await alloc.allocate(1);
    // Must not reuse the held port.
    expect(bundle.http).not.toBe(base);
    expect(bundle.db).not.toBe(base);
    expect(bundle.ws).not.toBe(base);
    expect(bundle.extras).not.toContain(base);
  });

  it('isEnabled reflects constructor flag', () => {
    expect(new PortAllocator().isEnabled()).toBe(true);
    expect(new PortAllocator({ enabled: false }).isEnabled()).toBe(false);
  });
});

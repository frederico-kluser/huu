import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { McpToolCache } from './cache.js';

function makeTool(name: string, description: string = '') {
  return {
    name,
    description,
    inputSchema: { type: 'object' as const, properties: {} },
  };
}

describe('McpToolCache', () => {
  let cache: McpToolCache;

  beforeEach(() => {
    cache = new McpToolCache();
  });

  it('stores and retrieves tools', () => {
    cache.set('server1', [makeTool('tool_a', 'Tool A')]);
    const entry = cache.get('server1', 'tool_a');
    expect(entry).toBeDefined();
    expect(entry!.name).toBe('tool_a');
    expect(entry!.serverId).toBe('server1');
    expect(entry!.description).toBe('Tool A');
  });

  it('returns undefined for missing entries', () => {
    expect(cache.get('server1', 'nonexistent')).toBeUndefined();
  });

  it('getForServer returns all tools for a server', () => {
    cache.set('s1', [makeTool('a'), makeTool('b')]);
    cache.set('s2', [makeTool('c')]);
    const s1Tools = cache.getForServer('s1');
    expect(s1Tools).toHaveLength(2);
    expect(s1Tools.map((t) => t.name).sort()).toEqual(['a', 'b']);
  });

  it('getAll returns all cached tools', () => {
    cache.set('s1', [makeTool('a')]);
    cache.set('s2', [makeTool('b')]);
    expect(cache.getAll()).toHaveLength(2);
  });

  it('search by name', () => {
    cache.set('s1', [makeTool('search_repos'), makeTool('get_file')]);
    const results = cache.search('search');
    expect(results).toHaveLength(1);
    expect(results[0]!.name).toBe('search_repos');
  });

  it('search by description', () => {
    cache.set('s1', [makeTool('tool_a', 'Search repositories')]);
    const results = cache.search('repositories');
    expect(results).toHaveLength(1);
  });

  it('search filtered by server', () => {
    cache.set('s1', [makeTool('search')]);
    cache.set('s2', [makeTool('search')]);
    const results = cache.search('search', 's1');
    expect(results).toHaveLength(1);
    expect(results[0]!.serverId).toBe('s1');
  });

  it('invalidate removes all tools for a server', () => {
    cache.set('s1', [makeTool('a'), makeTool('b')]);
    cache.set('s2', [makeTool('c')]);
    cache.invalidate('s1');
    expect(cache.getForServer('s1')).toHaveLength(0);
    expect(cache.getForServer('s2')).toHaveLength(1);
  });

  it('clear removes all entries', () => {
    cache.set('s1', [makeTool('a')]);
    cache.set('s2', [makeTool('b')]);
    cache.clear();
    expect(cache.size).toBe(0);
  });

  it('expired entries are removed on get', () => {
    const shortCache = new McpToolCache(100); // 100ms TTL
    shortCache.set('s1', [makeTool('a')]);
    expect(shortCache.get('s1', 'a')).toBeDefined();

    vi.useFakeTimers();
    vi.advanceTimersByTime(200);
    expect(shortCache.get('s1', 'a')).toBeUndefined();
    vi.useRealTimers();
  });

  it('expired entries are removed on getAll', () => {
    const shortCache = new McpToolCache(100);
    shortCache.set('s1', [makeTool('a')]);

    vi.useFakeTimers();
    vi.advanceTimersByTime(200);
    expect(shortCache.getAll()).toHaveLength(0);
    vi.useRealTimers();
  });

  it('size reflects current entries', () => {
    expect(cache.size).toBe(0);
    cache.set('s1', [makeTool('a'), makeTool('b')]);
    expect(cache.size).toBe(2);
  });
});

import type { Tool as McpTool } from '@modelcontextprotocol/sdk/types.js';
import type { CachedToolMetadata } from './types.js';

const DEFAULT_TTL_MS = 30 * 60 * 1000; // 30 minutes

export class McpToolCache {
  private readonly entries = new Map<string, CachedToolMetadata>();
  private readonly ttlMs: number;

  constructor(ttlMs: number = DEFAULT_TTL_MS) {
    this.ttlMs = ttlMs;
  }

  private key(serverId: string, toolName: string): string {
    return `${serverId}/${toolName}`;
  }

  set(serverId: string, tools: McpTool[]): void {
    const now = Date.now();
    for (const tool of tools) {
      const entry: CachedToolMetadata = {
        serverId,
        name: tool.name,
        description: tool.description ?? '',
        inputSchema: (tool.inputSchema ?? {}) as Record<string, unknown>,
        cachedAt: now,
      };
      this.entries.set(this.key(serverId, tool.name), entry);
    }
  }

  get(serverId: string, toolName: string): CachedToolMetadata | undefined {
    const entry = this.entries.get(this.key(serverId, toolName));
    if (!entry) return undefined;
    if (Date.now() - entry.cachedAt > this.ttlMs) {
      this.entries.delete(this.key(serverId, toolName));
      return undefined;
    }
    return entry;
  }

  getForServer(serverId: string): CachedToolMetadata[] {
    const now = Date.now();
    const result: CachedToolMetadata[] = [];
    for (const [key, entry] of this.entries) {
      if (entry.serverId !== serverId) continue;
      if (now - entry.cachedAt > this.ttlMs) {
        this.entries.delete(key);
        continue;
      }
      result.push(entry);
    }
    return result;
  }

  getAll(): CachedToolMetadata[] {
    const now = Date.now();
    const result: CachedToolMetadata[] = [];
    for (const [key, entry] of this.entries) {
      if (now - entry.cachedAt > this.ttlMs) {
        this.entries.delete(key);
        continue;
      }
      result.push(entry);
    }
    return result;
  }

  search(query: string, serverId?: string | undefined): CachedToolMetadata[] {
    const q = query.toLowerCase();
    const all = serverId ? this.getForServer(serverId) : this.getAll();
    return all.filter(
      (entry) =>
        entry.name.toLowerCase().includes(q) ||
        entry.description.toLowerCase().includes(q),
    );
  }

  invalidate(serverId: string): void {
    for (const key of this.entries.keys()) {
      if (key.startsWith(`${serverId}/`)) {
        this.entries.delete(key);
      }
    }
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}

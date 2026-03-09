import { describe, it, expect } from 'vitest';
import { makeBridgeToolName, parseBridgeToolName } from './types.js';

describe('MCP types', () => {
  describe('makeBridgeToolName', () => {
    it('creates bridge tool names', () => {
      expect(makeBridgeToolName('github', 'search_repos')).toBe(
        'mcp/github/search_repos',
      );
    });

    it('handles tools with slashes', () => {
      expect(makeBridgeToolName('server', 'ns/tool')).toBe(
        'mcp/server/ns/tool',
      );
    });
  });

  describe('parseBridgeToolName', () => {
    it('parses valid bridge tool names', () => {
      const result = parseBridgeToolName('mcp/github/search_repos');
      expect(result).toEqual({ serverId: 'github', toolName: 'search_repos' });
    });

    it('parses tools with slashes in name', () => {
      const result = parseBridgeToolName('mcp/server/ns/tool');
      expect(result).toEqual({ serverId: 'server', toolName: 'ns/tool' });
    });

    it('returns null for invalid names', () => {
      expect(parseBridgeToolName('read_file')).toBeNull();
      expect(parseBridgeToolName('mcp/')).toBeNull();
      expect(parseBridgeToolName('')).toBeNull();
    });
  });
});

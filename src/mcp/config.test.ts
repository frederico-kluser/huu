import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  loadMcpConfig,
  McpConfigError,
  getServerLifecycle,
  getServerIdleTimeoutMs,
  getServerDirectTools,
  resolveServerEnv,
} from './config.js';
import type { McpGlobalSettings, McpServerConfig } from './types.js';

describe('MCP config', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-config-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeProjectConfig(content: unknown): void {
    const dir = path.join(tmpDir, '.huu');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'mcp.json'), JSON.stringify(content));
  }

  describe('loadMcpConfig', () => {
    it('returns defaults when no config exists', () => {
      const config = loadMcpConfig(tmpDir);
      expect(config.settings.idleTimeoutMinutes).toBe(10);
      expect(config.settings.lifecycle).toBe('lazy');
      expect(config.settings.toolPrefix).toBe('mcp');
      expect(config.settings.directTools).toBe(false);
      expect(Object.keys(config.mcpServers)).toHaveLength(0);
    });

    it('loads project config', () => {
      writeProjectConfig({
        settings: { idleTimeoutMinutes: 5 },
        mcpServers: {
          test: {
            transport: 'stdio',
            command: 'echo',
            args: ['hello'],
          },
        },
      });

      const config = loadMcpConfig(tmpDir);
      expect(config.settings.idleTimeoutMinutes).toBe(5);
      expect(config.mcpServers['test']).toBeDefined();
      expect(config.mcpServers['test']!.command).toBe('echo');
    });

    it('validates stdio transport requires command', () => {
      writeProjectConfig({
        mcpServers: {
          bad: { transport: 'stdio' },
        },
      });

      expect(() => loadMcpConfig(tmpDir)).toThrow(McpConfigError);
    });

    it('validates http transport requires url', () => {
      writeProjectConfig({
        mcpServers: {
          bad: { transport: 'http' },
        },
      });

      expect(() => loadMcpConfig(tmpDir)).toThrow(McpConfigError);
    });

    it('validates http url format', () => {
      writeProjectConfig({
        mcpServers: {
          bad: { transport: 'http', url: 'not-a-url' },
        },
      });

      expect(() => loadMcpConfig(tmpDir)).toThrow(McpConfigError);
    });

    it('validates transport type', () => {
      writeProjectConfig({
        mcpServers: {
          bad: { transport: 'websocket' },
        },
      });

      expect(() => loadMcpConfig(tmpDir)).toThrow(McpConfigError);
    });

    it('validates lifecycle mode', () => {
      writeProjectConfig({
        settings: { lifecycle: 'invalid' },
      });

      expect(() => loadMcpConfig(tmpDir)).toThrow(McpConfigError);
    });

    it('validates idleTimeoutMinutes', () => {
      writeProjectConfig({
        settings: { idleTimeoutMinutes: -1 },
      });

      expect(() => loadMcpConfig(tmpDir)).toThrow(McpConfigError);
    });

    it('validates directTools on server', () => {
      writeProjectConfig({
        mcpServers: {
          test: {
            transport: 'stdio',
            command: 'echo',
            directTools: 42,
          },
        },
      });

      expect(() => loadMcpConfig(tmpDir)).toThrow(McpConfigError);
    });

    it('accepts valid http config', () => {
      writeProjectConfig({
        mcpServers: {
          remote: {
            transport: 'http',
            url: 'https://example.com/mcp',
            headers: { Authorization: 'Bearer token' },
          },
        },
      });

      const config = loadMcpConfig(tmpDir);
      expect(config.mcpServers['remote']!.url).toBe('https://example.com/mcp');
    });

    it('accepts directTools as string array', () => {
      writeProjectConfig({
        mcpServers: {
          test: {
            transport: 'stdio',
            command: 'echo',
            directTools: ['tool_a', 'tool_b'],
          },
        },
      });

      const config = loadMcpConfig(tmpDir);
      expect(config.mcpServers['test']!.directTools).toEqual(['tool_a', 'tool_b']);
    });

    it('rejects invalid JSON', () => {
      const dir = path.join(tmpDir, '.huu');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'mcp.json'), 'not json');

      expect(() => loadMcpConfig(tmpDir)).toThrow(McpConfigError);
    });
  });

  describe('resolveServerEnv', () => {
    it('resolves environment placeholders', () => {
      const prev = process.env['TEST_TOKEN'];
      process.env['TEST_TOKEN'] = 'secret123';
      try {
        const config: McpServerConfig = {
          transport: 'stdio',
          command: 'echo',
          env: { TOKEN: '${TEST_TOKEN}' },
        };
        const resolved = resolveServerEnv(config);
        expect(resolved).toEqual({ TOKEN: 'secret123' });
      } finally {
        if (prev === undefined) {
          delete process.env['TEST_TOKEN'];
        } else {
          process.env['TEST_TOKEN'] = prev;
        }
      }
    });

    it('throws on missing env var', () => {
      const config: McpServerConfig = {
        transport: 'stdio',
        command: 'echo',
        env: { TOKEN: '${NONEXISTENT_VAR_XYZ}' },
      };
      expect(() => resolveServerEnv(config)).toThrow(McpConfigError);
    });

    it('returns undefined when no env', () => {
      const config: McpServerConfig = {
        transport: 'stdio',
        command: 'echo',
      };
      expect(resolveServerEnv(config)).toBeUndefined();
    });
  });

  describe('helper functions', () => {
    const defaults: McpGlobalSettings = {
      idleTimeoutMinutes: 10,
      lifecycle: 'lazy',
      toolPrefix: 'mcp',
      directTools: false,
    };

    it('getServerLifecycle uses server override', () => {
      const server: McpServerConfig = {
        transport: 'stdio',
        command: 'echo',
        lifecycle: 'eager',
      };
      expect(getServerLifecycle(server, defaults)).toBe('eager');
    });

    it('getServerLifecycle falls back to global', () => {
      const server: McpServerConfig = {
        transport: 'stdio',
        command: 'echo',
      };
      expect(getServerLifecycle(server, defaults)).toBe('lazy');
    });

    it('getServerIdleTimeoutMs converts minutes to ms', () => {
      const server: McpServerConfig = {
        transport: 'stdio',
        command: 'echo',
        idleTimeoutMinutes: 5,
      };
      expect(getServerIdleTimeoutMs(server, defaults)).toBe(5 * 60 * 1000);
    });

    it('getServerDirectTools uses server override', () => {
      const server: McpServerConfig = {
        transport: 'stdio',
        command: 'echo',
        directTools: ['tool_a'],
      };
      expect(getServerDirectTools(server, defaults)).toEqual(['tool_a']);
    });

    it('getServerDirectTools falls back to global', () => {
      const server: McpServerConfig = {
        transport: 'stdio',
        command: 'echo',
      };
      expect(getServerDirectTools(server, defaults)).toBe(false);
    });
  });
});

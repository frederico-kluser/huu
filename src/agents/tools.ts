import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type Anthropic from '@anthropic-ai/sdk';
import type { AgentDefinition } from './types.js';
import { effectiveTools } from './types.js';

// ── Tool types ───────────────────────────────────────────────────────

export interface ToolResult {
  content: string;
  isError?: boolean | undefined;
}

export interface ToolExecutionContext {
  runId: string;
  cwd: string;
  signal: AbortSignal;
  agent: AgentDefinition;
}

export type ToolHandler = (
  input: Record<string, unknown>,
  ctx: ToolExecutionContext,
) => Promise<ToolResult>;

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Anthropic.Tool['input_schema'];
  handler: ToolHandler;
}

// ── Tool Registry ────────────────────────────────────────────────────

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();

  /** Register a tool handler. */
  register(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
  }

  /** Get a tool by name. */
  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  /** Check if a tool exists. */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /** Get all registered tool names. */
  names(): string[] {
    return [...this.tools.keys()];
  }

  /**
   * Get Anthropic-compatible tool definitions filtered by agent policy.
   * Applies allowlist (agent.tools) and denylist (agent.disallowedTools).
   */
  getToolsForAgent(agent: AgentDefinition): Anthropic.Tool[] {
    const allowed = effectiveTools(agent);
    const result: Anthropic.Tool[] = [];

    for (const name of allowed) {
      const tool = this.tools.get(name);
      if (tool) {
        result.push({
          name: tool.name,
          description: tool.description,
          input_schema: tool.inputSchema,
        });
      }
    }

    return result;
  }

  /**
   * Execute a tool by name, enforcing agent policy.
   * Returns error result if the tool is not allowed or not registered.
   */
  async execute(
    name: string,
    input: Record<string, unknown>,
    ctx: ToolExecutionContext,
  ): Promise<ToolResult> {
    const allowed = effectiveTools(ctx.agent);
    if (!allowed.includes(name)) {
      return {
        content: `Tool "${name}" is not allowed for agent "${ctx.agent.name}". Allowed tools: ${allowed.join(', ')}`,
        isError: true,
      };
    }

    const tool = this.tools.get(name);
    if (!tool) {
      return {
        content: `Tool "${name}" is not registered in the tool registry.`,
        isError: true,
      };
    }

    if (ctx.signal.aborted) {
      return {
        content: 'Execution aborted before tool execution.',
        isError: true,
      };
    }

    try {
      return await tool.handler(input, ctx);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: `Tool execution error: ${message}`,
        isError: true,
      };
    }
  }
}

// ── Built-in tools ───────────────────────────────────────────────────

/**
 * Create a registry with built-in tools for agent execution.
 * Provides minimal tools sufficient for basic agent operations.
 */
export function createDefaultRegistry(): ToolRegistry {
  const registry = new ToolRegistry();

  registry.register({
    name: 'read_file',
    description:
      'Read the contents of a file. Use this to understand existing code before modifying it.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        path: {
          type: 'string',
          description: 'Relative path to the file from the working directory.',
        },
      },
      required: ['path'],
    },
    handler: async (input, ctx) => {
      const filePath = path.resolve(ctx.cwd, input['path'] as string);
      if (!filePath.startsWith(ctx.cwd)) {
        return {
          content: 'Error: path traversal is not allowed.',
          isError: true,
        };
      }
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        return { content };
      } catch (err) {
        return {
          content: `Error reading file: ${err instanceof Error ? err.message : String(err)}`,
          isError: true,
        };
      }
    },
  });

  registry.register({
    name: 'write_file',
    description:
      'Write content to a file. Creates the file and parent directories if needed.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        path: {
          type: 'string',
          description: 'Relative path to the file from the working directory.',
        },
        content: {
          type: 'string',
          description: 'The content to write to the file.',
        },
      },
      required: ['path', 'content'],
    },
    handler: async (input, ctx) => {
      const filePath = path.resolve(ctx.cwd, input['path'] as string);
      if (!filePath.startsWith(ctx.cwd)) {
        return {
          content: 'Error: path traversal is not allowed.',
          isError: true,
        };
      }
      try {
        const dir = path.dirname(filePath);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(filePath, input['content'] as string, 'utf-8');
        return { content: `File written: ${input['path'] as string}` };
      } catch (err) {
        return {
          content: `Error writing file: ${err instanceof Error ? err.message : String(err)}`,
          isError: true,
        };
      }
    },
  });

  registry.register({
    name: 'list_files',
    description:
      'List files and directories in a path. Directories have a trailing /.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        path: {
          type: 'string',
          description:
            'Relative path to the directory. Defaults to working directory.',
        },
      },
    },
    handler: async (input, ctx) => {
      const dirPath = path.resolve(
        ctx.cwd,
        (input['path'] as string | undefined) ?? '.',
      );
      if (!dirPath.startsWith(ctx.cwd)) {
        return {
          content: 'Error: path traversal is not allowed.',
          isError: true,
        };
      }
      try {
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        const lines = entries.map((e) =>
          e.isDirectory() ? `${e.name}/` : e.name,
        );
        return { content: lines.join('\n') || '(empty directory)' };
      } catch (err) {
        return {
          content: `Error listing directory: ${err instanceof Error ? err.message : String(err)}`,
          isError: true,
        };
      }
    },
  });

  registry.register({
    name: 'bash',
    description:
      'Execute a bash command in the working directory. Use for running tests, git commands, and other shell operations.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        command: {
          type: 'string',
          description: 'The bash command to execute.',
        },
        timeout_ms: {
          type: 'number',
          description:
            'Maximum execution time in milliseconds. Defaults to 30000.',
        },
      },
      required: ['command'],
    },
    handler: (input, ctx) => {
      const command = input['command'] as string;
      const timeoutMs = (input['timeout_ms'] as number | undefined) ?? 30_000;

      return new Promise<ToolResult>((resolve) => {
        execFile(
          'bash',
          ['-c', command],
          {
            cwd: ctx.cwd,
            timeout: timeoutMs,
            maxBuffer: 1024 * 1024,
            signal: ctx.signal,
          },
          (err, stdout, stderr) => {
            if (err) {
              const output = [stdout, stderr, err.message]
                .filter(Boolean)
                .join('\n');
              resolve({
                content: output || `Command failed: ${err.message}`,
                isError: true,
              });
            } else {
              const output = [stdout, stderr].filter(Boolean).join('\n');
              resolve({ content: output || '(no output)' });
            }
          },
        );
      });
    },
  });

  return registry;
}

import fs from 'node:fs';
import path from 'node:path';
import type { AgentDefinition } from './types.js';

// ── Context preparation pipeline ─────────────────────────────────────

export interface PreparedContext {
  system: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  metadata: {
    tokensEstimate: number;
    sources: string[];
  };
}

export interface ContextLayer {
  name: string;
  content: string;
  priority: number;
}

export interface PrepareContextInput {
  agent: AgentDefinition;
  taskPrompt: string;
  cwd: string;
  scratchpad?: string | undefined;
  projectRulesPath?: string | undefined;
  tokenBudget?: number | undefined;
}

const DEFAULT_TOKEN_BUDGET = 150_000;
const CHARS_PER_TOKEN = 4;

/**
 * Prepare context for an agent execution.
 * Builds layered prompt with system instructions, project rules,
 * task payload, and optional scratchpad.
 */
export function prepareContext(input: PrepareContextInput): PreparedContext {
  const budget = input.tokenBudget ?? DEFAULT_TOKEN_BUDGET;
  const sources: string[] = [];

  // Layer 1: Agent system prompt
  const systemParts: string[] = [input.agent.systemPrompt];

  // Layer 2: Project rules (CLAUDE.md / AGENTS.md)
  const projectRules = loadProjectRules(input.cwd, input.projectRulesPath);
  if (projectRules) {
    systemParts.push(
      `\n\n<project_rules>\n${projectRules.content}\n</project_rules>`,
    );
    sources.push(projectRules.source);
  }

  const system = systemParts.join('');

  // Layer 3 + 4: Task prompt + scratchpad -> user message
  const userParts: string[] = [];

  if (input.scratchpad) {
    userParts.push(
      `<scratchpad>\n${input.scratchpad}\n</scratchpad>\n\n`,
    );
    sources.push('scratchpad');
  }

  userParts.push(input.taskPrompt);
  const userContent = userParts.join('');

  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [
    { role: 'user', content: userContent },
  ];

  // Estimate tokens
  const totalChars = system.length + userContent.length;
  const tokensEstimate = Math.ceil(totalChars / CHARS_PER_TOKEN);

  if (tokensEstimate > budget) {
    sources.push(
      `WARNING: estimated ${tokensEstimate} tokens exceeds budget of ${budget}`,
    );
  }

  return {
    system,
    messages,
    metadata: {
      tokensEstimate,
      sources,
    },
  };
}

/**
 * Estimate token count for a string (rough heuristic: ~4 chars per token).
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

// ── Internal helpers ─────────────────────────────────────────────────

function loadProjectRules(
  cwd: string,
  explicitPath?: string | undefined,
): { content: string; source: string } | null {
  const candidates = explicitPath
    ? [explicitPath]
    : [path.join(cwd, 'CLAUDE.md'), path.join(cwd, 'AGENTS.md')];

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        const content = fs.readFileSync(candidate, 'utf-8');
        if (content.trim()) {
          return { content: content.trim(), source: candidate };
        }
      }
    } catch {
      // File not readable, skip
    }
  }

  return null;
}

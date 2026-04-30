import { z } from 'zod';
import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { buildProjectDigest } from './project-digest.js';
import {
  RECON_AGENTS,
  buildReconSystemPrompt,
  type ReconAgent,
  type ReconAgentId,
} from './project-recon-prompts.js';
import { log as dlog } from './debug-logger.js';

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const OPENROUTER_HEADERS = {
  'HTTP-Referer': 'https://github.com/frederico-kluser/huu',
  'X-OpenRouter-Title': 'huu',
};

/**
 * Default recon model — chosen because minimax is fast, cheap, and supports
 * function calling on OpenRouter, so we can fan out 4 parallel agents without
 * blowing up the user's wallet on the pre-flight stage.
 */
export const RECON_MODEL = 'minimax/minimax-m2.7';

export const ReconBulletsSchema = z.object({
  bullets: z.array(z.string().min(1).max(180)).min(1).max(5),
});
export type ReconBullets = z.infer<typeof ReconBulletsSchema>;

export type ReconStatus = 'pending' | 'running' | 'done' | 'error';

export interface ReconUpdate {
  agentId: ReconAgentId;
  status: ReconStatus;
  bullets?: readonly string[];
  error?: string;
}

export interface ReconAgentResult {
  agent: ReconAgent;
  status: 'done' | 'error';
  bullets: readonly string[];
  error?: string;
}

export interface RunProjectReconOptions {
  apiKey: string;
  repoRoot: string;
  modelId?: string;
  onUpdate: (update: ReconUpdate) => void;
  signal?: AbortSignal;
}

export { RECON_AGENTS };
export type { ReconAgent, ReconAgentId };

/**
 * Aggregates per-agent bullets into a single markdown chunk that can be
 * embedded in the assistant's system prompt. Skips agents that produced no
 * bullets (e.g. errored out) so the assistant doesn't see empty sections.
 */
export function buildReconContextMarkdown(results: readonly ReconAgentResult[]): string {
  const blocks: string[] = [];
  for (const r of results) {
    if (r.bullets.length === 0) continue;
    const lines = r.bullets.map((b) => `- ${b}`).join('\n');
    blocks.push(`### ${r.agent.label}\n${lines}`);
  }
  return blocks.join('\n\n');
}

/**
 * Fires every recon agent in parallel against the configured model. Each
 * agent receives the same digest but a different mission via its system
 * prompt; results stream through `onUpdate` so the UI can render per-agent
 * loaders, and the returned promise resolves once every agent has either
 * succeeded or failed (errors are isolated per agent — a single timeout
 * doesn't kill the rest).
 */
export async function runProjectRecon(
  opts: RunProjectReconOptions,
): Promise<ReconAgentResult[]> {
  const stub =
    process.env.HUU_LANGCHAIN_STUB === '1' || opts.apiKey.trim() === 'stub';

  for (const agent of RECON_AGENTS) {
    opts.onUpdate({ agentId: agent.id, status: 'running' });
  }

  if (stub) return runStubRecon(opts);

  const apiKey = opts.apiKey.trim();
  if (!apiKey) {
    const message = 'OpenRouter API key ausente.';
    for (const agent of RECON_AGENTS) {
      opts.onUpdate({ agentId: agent.id, status: 'error', error: message });
    }
    throw new Error(message);
  }
  const modelId = (opts.modelId ?? RECON_MODEL).trim();

  // Digest is built once and shared across all agents — both faster and more
  // consistent than letting each agent see a different snapshot.
  const digest = buildProjectDigest(opts.repoRoot);

  const promises = RECON_AGENTS.map(async (agent): Promise<ReconAgentResult> => {
    try {
      const chat = new ChatOpenAI({
        model: modelId,
        // temperature 0 + low maxTokens keep recon deterministic and short.
        // The agents work from a static digest, so creativity buys nothing.
        temperature: 0,
        maxTokens: 400,
        modelKwargs: {
          // OpenRouter "reasoning" param — `effort: "none"` disables extended
          // thinking entirely on models that support it (MiniMax M2.x ships
          // with thinking ON by default). For pre-flight recon we want a
          // single fast pass over a static digest, not multi-step reasoning.
          // See https://openrouter.ai/docs/guides/best-practices/reasoning-tokens
          reasoning: { effort: 'none' },
        },
        configuration: {
          baseURL: OPENROUTER_BASE_URL,
          apiKey,
          defaultHeaders: OPENROUTER_HEADERS,
        },
      });
      const structured = chat.withStructuredOutput(ReconBulletsSchema, {
        name: 'ReconBullets',
        method: 'functionCalling',
      });
      const messages = [
        new SystemMessage(buildReconSystemPrompt(agent, digest.projectName)),
        new HumanMessage(`Digest do projeto:\n\n${digest.digest}`),
      ];
      const raw = (await structured.invoke(messages, {
        signal: opts.signal,
      })) as ReconBullets;
      const parsed = ReconBulletsSchema.parse(raw);
      opts.onUpdate({
        agentId: agent.id,
        status: 'done',
        bullets: parsed.bullets,
      });
      return { agent, status: 'done', bullets: parsed.bullets };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      dlog('error', 'project-recon.agent_failed', { agent: agent.id, message });
      opts.onUpdate({ agentId: agent.id, status: 'error', error: message });
      return { agent, status: 'error', bullets: [], error: message };
    }
  });
  return Promise.all(promises);
}

const STUB_BULLETS: Record<ReconAgentId, string[]> = {
  stack: [
    'TypeScript + React (Ink) — CLI/TUI rodando em Node 20+.',
    'Build via tsc; testes com Vitest; lint não detectado.',
    'Scripts: npm run dev / build / test / typecheck.',
  ],
  structure: [
    'Top-level em src/: ui, lib, orchestrator, git, models, contracts.',
    'Camadas fluem para baixo (UI → orchestrator → git → lib).',
    'Testes co-localizados (*.test.ts ao lado do módulo).',
  ],
  libraries: [
    'ink — render React no terminal.',
    'langchain + @langchain/openai — chamadas a LLMs via OpenRouter.',
    'zod — validação de schemas estruturados.',
    'commander — parsing de CLI flags.',
  ],
  conventions: [
    'Skills domain-specific em .agents/skills/.',
    'CLAUDE.md raiz documenta arquitetura, build, e regras de commit.',
    'Conventional commits + sem CI automatizada (typecheck/test manual).',
  ],
};

async function runStubRecon(
  opts: RunProjectReconOptions,
): Promise<ReconAgentResult[]> {
  const results: ReconAgentResult[] = [];
  for (const agent of RECON_AGENTS) {
    const bullets = STUB_BULLETS[agent.id];
    opts.onUpdate({ agentId: agent.id, status: 'done', bullets });
    results.push({ agent, status: 'done', bullets });
  }
  return results;
}

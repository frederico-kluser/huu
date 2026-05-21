import { z } from 'zod';
import type { CheckStep, Pipeline } from './types.js';
import {
  createAssistantChat,
  HumanMessage,
  SystemMessage,
  type BaseMessage,
} from './assistant-client.js';
import { ChatOpenAI } from '@langchain/openai';

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const OPENROUTER_HEADERS = {
  'HTTP-Referer': 'https://github.com/frederico-kluser/huu',
  'X-OpenRouter-Title': 'huu',
};

export const FeasibilitySchema = z.object({
  feasible: z.boolean(),
  reason: z.string(),
  instructionDraft: z.string(),
  warnings: z.array(z.string()).default([]),
});

export type FeasibilityResult = z.infer<typeof FeasibilitySchema>;

export interface FeasibilityInput {
  step: CheckStep;
  pipeline: Pipeline;
  apiKey: string;
  repoRoot: string;
  modelId?: string;
}

/**
 * Setup-time check: ask an LLM whether the user's natural-language condition
 * can plausibly be evaluated by a judge agent at runtime, given:
 *
 *  - the step's declared outcomes (the judge MUST pick one of these labels)
 *  - the surrounding pipeline (the previous steps that produced the state
 *    the judge will inspect)
 *  - the repo root (so the assistant can mention concrete artifacts —
 *    package.json scripts, coverage tooling, etc.)
 *
 * Returns a stub when `apiKey === 'stub'` or `HUU_LANGCHAIN_STUB=1`, so
 * tests and offline development don't hit the network.
 */
export async function analyzeCheckFeasibility(
  input: FeasibilityInput,
): Promise<FeasibilityResult> {
  if (input.apiKey === 'stub' || process.env.HUU_LANGCHAIN_STUB === '1') {
    return stubFeasibility(input.step);
  }

  const apiKey = input.apiKey.trim();
  if (!apiKey) {
    return {
      feasible: false,
      reason: 'no OpenRouter API key configured; cannot analyze feasibility',
      instructionDraft: '',
      warnings: ['set OPENROUTER_API_KEY or use --stub'],
    };
  }

  const modelId = (input.modelId ?? 'moonshotai/kimi-k2.6').trim();
  const chat = new ChatOpenAI({
    model: modelId,
    temperature: 0.2,
    configuration: {
      baseURL: OPENROUTER_BASE_URL,
      apiKey,
      defaultHeaders: OPENROUTER_HEADERS,
    },
  });
  const structured = chat.withStructuredOutput(FeasibilitySchema, {
    name: 'CheckFeasibility',
    method: 'functionCalling',
  });

  const messages: BaseMessage[] = [
    new SystemMessage(buildSystem()),
    new HumanMessage(buildUser(input)),
  ];
  const result = (await structured.invoke(messages)) as FeasibilityResult;
  return FeasibilitySchema.parse(result);
}

function buildSystem(): string {
  return [
    'You are an assistant that analyzes the feasibility of a condition for a pipeline decision step.',
    'Your response MUST be strict JSON.',
    '- feasible: true if the judge LLM can, at runtime, with shell access in the worktree, decide between the declared labels.',
    '- reason: brief justification (≤ 200 chars).',
    '- instructionDraft: 2-5 concrete sentences saying HOW the judge should verify (e.g.: "run `npm test -- --coverage`, read `coverage/coverage-summary.json`, compare total.lines.pct against 60").',
    '- warnings: list of warnings (e.g.: command missing in package.json, tool not installed).',
  ].join('\n');
}

function buildUser(input: FeasibilityInput): string {
  const { step, pipeline, repoRoot } = input;
  const lines: string[] = [];
  lines.push(`<repo-root>${repoRoot}</repo-root>`);
  lines.push(`<pipeline-name>${pipeline.name}</pipeline-name>`);
  lines.push('<previous-steps>');
  for (const s of pipeline.steps) {
    if (s.name === step.name) break;
    if (s.type === 'check') {
      lines.push(`- check "${s.name}"`);
    } else {
      lines.push(`- work "${s.name}" — files=${s.files.length === 0 ? 'whole-project' : s.files.join(',')}`);
    }
  }
  lines.push('</previous-steps>');
  lines.push('<check-step>');
  lines.push(`name: ${step.name}`);
  lines.push(`condition: ${step.condition}`);
  lines.push('outcomes:');
  for (const o of step.outcomes) {
    lines.push(`  - label="${o.label}" → "${o.nextStepName}"${o.default ? ' (default)' : ''}`);
  }
  lines.push('</check-step>');
  lines.push('');
  lines.push('Avalie e responda em JSON.');
  return lines.join('\n');
}

function stubFeasibility(step: CheckStep): FeasibilityResult {
  const labels = step.outcomes.map((o) => o.label).join('|');
  return {
    feasible: true,
    reason: 'stub: feasibility analyzer unavailable; assuming runnable.',
    instructionDraft: `Stub draft — replace before running with a real model. Evaluate the condition "${step.condition.slice(0, 80)}" and return a label from {${labels}}.`,
    warnings: ['stub mode — real analysis requires OPENROUTER_API_KEY'],
  };
}

import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { z } from 'zod';
import { DEFAULT_ASSISTANT_MODEL } from './assistant-client.js';
import type { Pipeline, PromptStep } from './types.js';
import { log as dlog } from './debug-logger.js';

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const OPENROUTER_HEADERS = {
  'HTTP-Referer': 'https://github.com/frederico-kluser/huu',
  'X-OpenRouter-Title': 'huu',
};

/** Hard cap on how many paths we send to the LLM. Bigger prompts blow up
 * cost and quickly bump into context limits without improving suggestion
 * quality — the model only meaningfully uses the top hundred or so. */
export const MAX_FILES_IN_PROMPT = 800;

export const SuggestFilesResponseSchema = z.object({
  files: z.array(z.string()).max(200),
  reasoning: z.string().max(2000).optional(),
});
export type SuggestFilesResponse = z.infer<typeof SuggestFilesResponseSchema>;

export interface SuggestFilesInput {
  pipeline: Pipeline;
  currentStepIndex: number;
  /** Step in edit-time state — may differ from pipeline.steps[index] when
   * the user has unsaved edits. Always pass the live one. */
  currentStep: PromptStep;
  /** Repo-relative paths from the file scanner (already gitignore-filtered). */
  availableFiles: string[];
  /** OpenRouter API key. '' or 'stub' triggers a deterministic stub. */
  apiKey: string;
  modelId?: string;
  signal?: AbortSignal;
  /** Optional callback for progress updates during the suggestion flow. */
  onProgress?: (message: string) => void;
}

export interface SuggestFilesResult {
  /** Always a subset of `availableFiles`. */
  files: string[];
  reasoning?: string;
  /** Paths the LLM returned that didn't match `availableFiles`. */
  ignoredCount: number;
}

const STOP_WORDS = new Set([
  'about','above','after','again','against','all','also','and','any','are',
  'because','been','before','being','between','both','but','can','cannot',
  'could','did','does','done','down','during','each','few','file','files',
  'for','from','further','had','has','have','having','here','hers','herself',
  'him','himself','how','into','its','itself','just','make','more','most',
  'must','need','not','now','only','other','our','ours','ourselves','out',
  'over','own','same','should','some','step','steps','such','than','that',
  'the','their','theirs','them','themselves','then','there','these','they',
  'this','those','through','too','under','until','use','very','was','were',
  'what','when','where','which','while','who','whom','why','with','would',
  'you','your','yours','yourself','yourselves',
]);

export function extractKeywords(text: string): string[] {
  const tokens = text.toLowerCase().match(/[a-z][a-z0-9_-]{3,}/g) ?? [];
  return Array.from(new Set(tokens.filter((t) => !STOP_WORDS.has(t))));
}

/** Truncate `available` to at most `MAX_FILES_IN_PROMPT` paths, prioritizing:
 * (1) anything already selected in the step, (2) keyword matches against the
 * prompt, (3) common source roots, (4) common code/doc extensions. */
export function selectRelevantFiles(
  available: string[],
  promptText: string,
  alwaysInclude: string[],
): string[] {
  if (available.length <= MAX_FILES_IN_PROMPT) return available;
  const keywords = extractKeywords(promptText);
  const score = (path: string): number => {
    const lower = path.toLowerCase();
    let s = 0;
    for (const kw of keywords) if (lower.includes(kw)) s += 4;
    if (/^src\/|^lib\/|^app\//.test(lower)) s += 1;
    if (/\.(ts|tsx|js|jsx|py|go|rs|md|yaml|json)$/.test(lower)) s += 1;
    return s;
  };
  const must = new Set(alwaysInclude.filter((p) => available.includes(p)));
  const ranked = available
    .filter((p) => !must.has(p))
    .map((path) => ({ path, s: score(path) }))
    .sort((a, b) => b.s - a.s);
  const out: string[] = Array.from(must);
  for (const e of ranked) {
    if (out.length >= MAX_FILES_IN_PROMPT) break;
    out.push(e.path);
  }
  dlog('warn', 'llm-suggest-files.truncated', {
    total: available.length,
    kept: out.length,
  });
  return out;
}

export function filterValidPaths(
  returned: string[],
  available: string[],
): { valid: string[]; ignoredCount: number } {
  const allowed = new Set(available);
  const valid: string[] = [];
  let ignoredCount = 0;
  for (const p of returned) {
    if (allowed.has(p)) valid.push(p);
    else ignoredCount += 1;
  }
  return { valid, ignoredCount };
}

export function stubSuggest(input: SuggestFilesInput): SuggestFilesResult {
  const text = `${input.currentStep.prompt} ${input.currentStep.name}`;
  const keywords = extractKeywords(text);
  const matches = input.availableFiles.filter((p) => {
    const lower = p.toLowerCase();
    return keywords.some((kw) => lower.includes(kw));
  });
  const picked = matches.length > 0
    ? matches.slice(0, 5)
    : input.availableFiles.slice(0, Math.min(2, input.availableFiles.length));
  return { files: picked, reasoning: 'stub: keyword match', ignoredCount: 0 };
}

function buildPrompt(
  input: SuggestFilesInput,
  filesForPrompt: string[],
): { system: string; user: string } {
  const { pipeline, currentStepIndex, currentStep } = input;
  const previousLines = pipeline.steps
    .slice(0, currentStepIndex)
    .map((s, i) => {
      if (s.type === 'check') {
        return `#${i + 1} "${s.name}" — check (decision node)`;
      }
      const filesText = s.files.length === 0 ? '(whole project)' : s.files.join(', ');
      const scope = s.scope ?? 'flexible';
      return `#${i + 1} "${s.name}" — scope=${scope} — files: ${filesText}`;
    })
    .join('\n');

  const alreadySelected =
    currentStep.files.length === 0 ? '(none)' : currentStep.files.join(', ');
  const scope = currentStep.scope ?? 'flexible';

  const system = [
    'Você é um assistente que sugere arquivos relevantes para uma etapa de pipeline huu.',
    'Sua resposta DEVE ser JSON estrito conforme o schema solicitado.',
    'Não invente caminhos: TODOS os paths em "files" precisam estar EXATAMENTE na lista "Available files in repo" abaixo.',
    'Pense no que o STEP ATUAL precisa, considerando o que steps anteriores já tocaram.',
    'Seja seletivo: 3 a 30 arquivos é geralmente o ideal. Não sugira o repo inteiro.',
  ].join(' ');

  const user = [
    `## Pipeline: ${pipeline.name}`,
    `Total steps: ${pipeline.steps.length}`,
    '',
    '## Steps anteriores',
    previousLines || '(nenhum step anterior)',
    '',
    `## Step atual #${currentStepIndex + 1} — FOCO`,
    `Name: ${currentStep.name}`,
    `Scope: ${scope}`,
    'Prompt:',
    currentStep.prompt,
    `Already selected: ${alreadySelected}`,
    '',
    `## Available files in repo (${filesForPrompt.length} of ${input.availableFiles.length})`,
    filesForPrompt.join('\n'),
    '',
    'Retorne JSON: {"files": ["path/relative", ...], "reasoning": "1-2 frases"}',
  ].join('\n');

  return { system, user };
}

export async function suggestFilesForStep(
  input: SuggestFilesInput,
): Promise<SuggestFilesResult> {
  const progress = input.onProgress ?? (() => {});

  if (input.signal?.aborted) {
    throw new Error('aborted');
  }

  const apiKey = input.apiKey.trim();
  if (
    process.env.HUU_LANGCHAIN_STUB === '1' ||
    apiKey === '' ||
    apiKey === 'stub'
  ) {
    progress('Using stub suggester (no API key)');
    return stubSuggest(input);
  }

  progress('Scanning repo files and building prompt…');
  const filesForPrompt = selectRelevantFiles(
    input.availableFiles,
    `${input.currentStep.prompt} ${input.currentStep.name}`,
    input.currentStep.files,
  );
  const { system, user } = buildPrompt(input, filesForPrompt);

  const modelId = (input.modelId ?? DEFAULT_ASSISTANT_MODEL).trim();
  progress(`Sending request to ${modelId.replace(/^.*\//, '')}…`);
  const chat = new ChatOpenAI({
    model: modelId,
    temperature: 0.2,
    configuration: {
      baseURL: OPENROUTER_BASE_URL,
      apiKey,
      defaultHeaders: OPENROUTER_HEADERS,
    },
  });
  const structured = chat.withStructuredOutput(SuggestFilesResponseSchema, {
    name: 'SuggestFiles',
    method: 'functionCalling',
  });

  progress('Awaiting AI response…');
  const messages = [new SystemMessage(system), new HumanMessage(user)];
  const raw = (await structured.invoke(messages, {
    signal: input.signal,
  })) as SuggestFilesResponse;
  const parsed = SuggestFilesResponseSchema.parse(raw);

  progress('Validating suggested file paths…');
  const { valid, ignoredCount } = filterValidPaths(parsed.files, input.availableFiles);
  if (ignoredCount > 0) {
    dlog('warn', 'llm-suggest-files.ignored_paths', {
      ignoredCount,
      total: parsed.files.length,
    });
  }

  return {
    files: valid,
    reasoning: parsed.reasoning,
    ignoredCount,
  };
}

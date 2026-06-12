// Pipeline Assistant adapter for the web UI.
//
// The TUI's `PipelineAssistant` is a multi-turn Q&A flow (see
// `src/ui/components/PipelineAssistant.tsx` and the AssistantTurn
// schema in `lib/assistant-schema.ts`). The web protocol currently
// exposes a one-shot `assistant.prompt` → `assistant.chunk*` +
// `assistant.done` shape; full multi-turn support is a TODO that
// requires either threading a chat-history session id through the
// protocol or adding `assistant.answer` messages.
//
// For now we expose a single-turn helper: given a user prompt, run
// one `invokeStructured` call and either resolve with a concrete
// `Pipeline` (when the assistant decided to finalize on turn 1) or
// throw with the question text so the caller can emit an error /
// chunk explaining what the assistant would have asked next.

import {
  createAssistantChat,
  HumanMessage,
  SystemMessage,
} from '../../lib/assistant-client.js';
import { buildAssistantSystemPrompt } from '../../lib/assistant-prompts.js';
import { loadRecommendedModels } from '../../models/catalog.js';
import type { Pipeline } from '../../lib/types.js';
import type { LlmClientContext } from '../../lib/llm-client-factory.js';

export interface StreamAssistantOptions {
  apiKey: string;
  prompt: string;
  cwd: string;
  /** Called with the rationale / question text before resolve/reject. */
  onChunk: (chunk: string) => void;
  /** Backend-aware context. Required for `--backend=azure`. */
  llmContext?: LlmClientContext;
}

/**
 * Convert the assistant's `PipelineDraft` (steps without a `files`
 * field) into the runtime `Pipeline` shape the orchestrator expects.
 * Mirrors the conversion the TUI does inside PipelineAssistant.
 */
function draftToPipeline(draft: {
  name: string;
  steps: ReadonlyArray<{
    name: string;
    prompt: string;
    scope: 'project' | 'per-file' | 'flexible' | 'memory';
    filesFrom?: string;
    produces?: string;
    dependsOn?: string[];
    modelId?: string;
  }>;
}): Pipeline {
  return {
    name: draft.name,
    steps: draft.steps.map((s) => ({
      name: s.name,
      prompt: s.prompt,
      files: [],
      scope: s.scope,
      filesFrom: s.filesFrom,
      produces: s.produces,
      dependsOn: s.dependsOn,
      modelId: s.modelId,
    })),
  };
}

export async function streamAssistant(
  opts: StreamAssistantOptions,
): Promise<Pipeline> {
  const chat = createAssistantChat({ apiKey: opts.apiKey, llmContext: opts.llmContext });
  const system = buildAssistantSystemPrompt({
    models: loadRecommendedModels(opts.cwd),
  });
  const turn = await chat.invokeStructured([
    new SystemMessage(system),
    new HumanMessage(opts.prompt),
  ]);
  if (turn.done) {
    opts.onChunk('finalizing pipeline…');
    return draftToPipeline(turn.pipeline);
  }
  // Single-turn limitation: surface the assistant's clarifying
  // question to the caller and bail. A full multi-turn loop is the
  // TODO above.
  opts.onChunk(turn.question);
  throw new Error(
    `assistant requested clarification (multi-turn not yet supported over web): ${turn.question}`,
  );
}

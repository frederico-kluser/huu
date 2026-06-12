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

import { DEFAULT_ASSISTANT_MODEL } from '../../lib/assistant-client.js';
import { runArchitect } from '../../lib/assistant-architect.js';
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
 * One-shot web path: skip the interview entirely and run the Architect
 * flow on the raw intent (parallel sketches → generative selection →
 * parallel prompt expansion → mechanical validation). Phase updates
 * stream to the client as assistant chunks. Multi-turn interviewing
 * over the web remains the TODO above.
 */
export async function streamAssistant(
  opts: StreamAssistantOptions,
): Promise<Pipeline> {
  const result = await runArchitect({
    apiKey: opts.apiKey,
    modelId: DEFAULT_ASSISTANT_MODEL,
    llmContext: opts.llmContext,
    intent: opts.prompt,
    transcript: '',
    onPhase: (_phase, detail) => opts.onChunk(detail),
  });
  return result.pipeline;
}

// Project Recon adapter for the web UI.
//
// Wraps `runProjectRecon` and forwards per-agent updates as opaque
// `chunk` strings. The protocol's `recon.done` carries an `unknown`
// result so we ship the final array of agent results as-is.

import { runProjectRecon, type ReconUpdate, type ReconAgentResult } from '../../lib/project-recon.js';
import type { LlmClientContext } from '../../lib/llm-client-factory.js';

export interface StreamReconOptions {
  apiKey: string;
  repoRoot: string;
  onChunk: (chunk: string) => void;
  signal?: AbortSignal;
  /** Backend-aware context. Required for `--backend=azure`. */
  llmContext?: LlmClientContext;
}

export async function streamRecon(
  opts: StreamReconOptions,
): Promise<ReconAgentResult[]> {
  const sigOpt = opts.signal ? { signal: opts.signal } : {};
  return runProjectRecon({
    apiKey: opts.apiKey,
    repoRoot: opts.repoRoot,
    llmContext: opts.llmContext,
    onUpdate: (u: ReconUpdate) => {
      // Serialize the update so the wire side can stay schema-agnostic.
      // The front-end can JSON.parse and inspect `status` / `bullets`.
      try {
        opts.onChunk(JSON.stringify(u));
      } catch {
        // A malformed update shouldn't kill the run; drop it.
      }
    },
    ...sigOpt,
  });
}

/** Shared constants and helpers (M7-02). */
import type { AgentTask, Pipeline } from '../lib/types.js';
import { DEFAULT_CARD_TIMEOUT_MS, DEFAULT_SINGLE_FILE_CARD_TIMEOUT_MS } from '../lib/types.js';

export const POLL_INTERVAL_MS = 500;
export const PRESSURE_POLL_INTERVAL_MS = 150;

export function computeCardTimeoutMs(task: AgentTask, pipeline: Pipeline): number {
  if (task.files.length === 1) {
    return pipeline.singleFileCardTimeoutMs ?? DEFAULT_SINGLE_FILE_CARD_TIMEOUT_MS;
  }
  return pipeline.cardTimeoutMs ?? DEFAULT_CARD_TIMEOUT_MS;
}

export function unionPaths(
  current: readonly string[] | undefined,
  added: readonly string[],
): string[] {
  return Array.from(new Set([...(current ?? []), ...added]));
}

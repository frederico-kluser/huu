// Source of truth for the WebSocket wire protocol between huu's Node
// backend (`src/web/server.ts`) and the browser front-end (`webui/`).
//
// IMPORTANT: this file MUST stay import-clean of Node.js APIs. The
// front-end workspace imports it directly via a tsconfig path alias.
// No `node:*`, no `fs`, no `process`, no `Buffer`. Only pure TypeScript
// type declarations and a couple of runtime guards that work in both
// environments.

import type {
  Pipeline,
  OrchestratorState,
  OrchestratorResult,
  FileNode,
  AgentBackendKind,
} from '../lib/types.js';
import type { PipelineEntry } from '../lib/pipeline-io.js';
import type { ApiKeySpec } from '../lib/api-key-registry.js';
import type { Screen, FsmEvent } from '../lib/screen-fsm.js';

// Re-export shared domain types so the front-end can pull everything
// from this single module without reaching into Node-only files.
export type {
  Pipeline,
  OrchestratorState,
  OrchestratorResult,
  FileNode,
  AgentBackendKind,
  PipelineEntry,
  ApiKeySpec,
  Screen,
  FsmEvent,
};

/**
 * @deprecated Use `FsmEvent` from `../lib/screen-fsm.js` (re-exported
 * above). Retained for one release so external front-end code that
 * pinned to the structural placeholder keeps compiling.
 */
export interface FsmEventPayload {
  type: string;
  [k: string]: unknown;
}

export interface ModelCatalogEntry {
  id: string;
  label: string;
  provider: string;
  pricing?: { in: number; out: number };
}

export const WS_PROTOCOL_VERSION = 1;

// --- Server → Client ---

export type ServerMessage =
  | { type: 'hello'; protocolVersion: 1; serverVersion: string }
  | { type: 'screen'; screen: Screen }
  | { type: 'state'; state: OrchestratorState }
  | { type: 'pipelines'; available: PipelineEntry[]; saved: PipelineEntry[] }
  | { type: 'models'; backend: AgentBackendKind; catalog: ModelCatalogEntry[] }
  | { type: 'files'; root: string; tree: FileNode[] }
  | { type: 'assistant.chunk'; chunk: string }
  | { type: 'assistant.done'; pipeline: Pipeline }
  | { type: 'recon.chunk'; chunk: string }
  | { type: 'recon.done'; result: unknown }
  | { type: 'apiKey.required'; missing: ApiKeySpec[] }
  | { type: 'result'; result: OrchestratorResult }
  | { type: 'error'; message: string; code?: string };

// --- Client → Server ---

export type ClientMessage =
  | { type: 'nav'; event: FsmEvent }
  | { type: 'pipeline.save'; pipeline: Pipeline; name: string }
  | { type: 'pipeline.delete'; name: string }
  | { type: 'pipeline.import'; json: string }
  | { type: 'pipeline.export'; pipeline: Pipeline }
  | { type: 'pipeline.requestList' }
  | { type: 'backend.select'; backendKind: AgentBackendKind }
  | { type: 'model.requestCatalog'; backend: AgentBackendKind }
  | { type: 'model.select'; modelId: string }
  | { type: 'apiKey.submit'; values: Record<string, string>; saveGlobally: boolean }
  | { type: 'files.scan'; root: string }
  | { type: 'assistant.prompt'; prompt: string }
  | { type: 'recon.start' }
  | { type: 'run.start'; modelId: string; apiKey: string }
  | { type: 'run.abort' }
  | { type: 'run.setConcurrency'; concurrency: number }
  | { type: 'run.setAutoScale'; enabled: boolean }
  | { type: 'ping' };

// --- Type guards ---

const CLIENT_MSG_TYPES: ReadonlySet<string> = new Set([
  'nav',
  'pipeline.save',
  'pipeline.delete',
  'pipeline.import',
  'pipeline.export',
  'pipeline.requestList',
  'backend.select',
  'model.requestCatalog',
  'model.select',
  'apiKey.submit',
  'files.scan',
  'assistant.prompt',
  'recon.start',
  'run.start',
  'run.abort',
  'run.setConcurrency',
  'run.setAutoScale',
  'ping',
]);

const SERVER_MSG_TYPES: ReadonlySet<string> = new Set([
  'hello',
  'screen',
  'state',
  'pipelines',
  'models',
  'files',
  'assistant.chunk',
  'assistant.done',
  'recon.chunk',
  'recon.done',
  'apiKey.required',
  'result',
  'error',
]);

function hasStringType(x: unknown): x is { type: string } {
  return (
    typeof x === 'object' &&
    x !== null &&
    typeof (x as { type?: unknown }).type === 'string'
  );
}

export function isClientMessage(x: unknown): x is ClientMessage {
  return hasStringType(x) && CLIENT_MSG_TYPES.has(x.type);
}

export function isServerMessage(x: unknown): x is ServerMessage {
  return hasStringType(x) && SERVER_MSG_TYPES.has(x.type);
}

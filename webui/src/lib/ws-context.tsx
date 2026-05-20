import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  type ReactNode,
} from 'react';
import type {
  AgentBackendKind,
  ClientMessage,
  ModelCatalogEntry,
  OrchestratorState,
  PipelineEntry,
  Pipeline,
  Screen,
  ServerMessage,
} from '@shared/ws-protocol';
import { useWs } from './use-ws';
import type { WsStatus } from './ws-client';

/* ------------------------------------------------------------------ */
/* Accumulator state                                                  */
/* ------------------------------------------------------------------ */

interface AccumulatorState {
  pipelinesAvailable: PipelineEntry[];
  pipelinesSaved: PipelineEntry[];
  modelCatalogs: Partial<Record<AgentBackendKind, ModelCatalogEntry[]>>;
  assistantChunks: string;
  assistantPipeline: Pipeline | null;
  reconChunks: string;
  lastError: { message: string; code?: string; at: number } | null;
  lastScreenKind: string | null;
  /** Most recent pipeline the client has worked with (selected/imported/edited). */
  currentPipeline: Pipeline | null;
}

const initialAcc: AccumulatorState = {
  pipelinesAvailable: [],
  pipelinesSaved: [],
  modelCatalogs: {},
  assistantChunks: '',
  assistantPipeline: null,
  reconChunks: '',
  lastError: null,
  lastScreenKind: null,
  currentPipeline: null,
};

type AccAction =
  | { type: 'msg'; msg: ServerMessage }
  | { type: 'screenChanged'; kind: string }
  | { type: 'setCurrentPipeline'; pipeline: Pipeline | null };

function accReducer(prev: AccumulatorState, action: AccAction): AccumulatorState {
  switch (action.type) {
    case 'setCurrentPipeline':
      return { ...prev, currentPipeline: action.pipeline };
    case 'screenChanged': {
      if (action.kind === prev.lastScreenKind) return prev;
      return {
        ...prev,
        lastScreenKind: action.kind,
        assistantChunks: '',
        assistantPipeline: null,
        reconChunks: '',
      };
    }
    case 'msg': {
      const m = action.msg;
      switch (m.type) {
        case 'pipelines':
          return {
            ...prev,
            pipelinesAvailable: m.available,
            pipelinesSaved: m.saved,
          };
        case 'models':
          return {
            ...prev,
            modelCatalogs: { ...prev.modelCatalogs, [m.backend]: m.catalog },
          };
        case 'assistant.chunk':
          return { ...prev, assistantChunks: prev.assistantChunks + m.chunk };
        case 'assistant.done':
          return { ...prev, assistantPipeline: m.pipeline, currentPipeline: m.pipeline };
        case 'recon.chunk':
          return { ...prev, reconChunks: prev.reconChunks + m.chunk };
        case 'error':
          return {
            ...prev,
            lastError: { message: m.message, code: m.code, at: Date.now() },
          };
        default:
          return prev;
      }
    }
    default:
      return prev;
  }
}

/* ------------------------------------------------------------------ */
/* Context                                                            */
/* ------------------------------------------------------------------ */

export interface WsSession {
  status: WsStatus;
  send: (msg: ClientMessage) => void;
  screen: Screen | null;
  state: OrchestratorState | null;
  pipelinesAvailable: PipelineEntry[];
  pipelinesSaved: PipelineEntry[];
  modelCatalogs: Partial<Record<AgentBackendKind, ModelCatalogEntry[]>>;
  assistantChunks: string;
  assistantPipeline: Pipeline | null;
  reconChunks: string;
  lastError: { message: string; code?: string; at: number } | null;
  currentPipeline: Pipeline | null;
  setCurrentPipeline: (p: Pipeline | null) => void;
}

const WsContext = createContext<WsSession | null>(null);

export function WsProvider({ url, children }: { url: string; children: ReactNode }) {
  const ws = useWs(url);
  const [acc, dispatch] = useReducer(accReducer, initialAcc);

  // Fold ServerMessages into accumulators
  useEffect(() => {
    if (ws.lastMessage) dispatch({ type: 'msg', msg: ws.lastMessage });
  }, [ws.lastMessage]);

  // Reset transient buckets on screen change
  useEffect(() => {
    if (ws.screen) dispatch({ type: 'screenChanged', kind: ws.screen.kind });
  }, [ws.screen?.kind]); // eslint-disable-line react-hooks/exhaustive-deps

  const value = useMemo<WsSession>(
    () => ({
      status: ws.status,
      send: ws.send,
      screen: ws.screen,
      state: ws.state,
      pipelinesAvailable: acc.pipelinesAvailable,
      pipelinesSaved: acc.pipelinesSaved,
      modelCatalogs: acc.modelCatalogs,
      assistantChunks: acc.assistantChunks,
      assistantPipeline: acc.assistantPipeline,
      reconChunks: acc.reconChunks,
      lastError: acc.lastError,
      currentPipeline: acc.currentPipeline,
      setCurrentPipeline: (p: Pipeline | null) => dispatch({ type: 'setCurrentPipeline', pipeline: p }),
    }),
    [ws.status, ws.send, ws.screen, ws.state, acc],
  );

  return <WsContext.Provider value={value}>{children}</WsContext.Provider>;
}

export function useWsSession(): WsSession {
  const v = useContext(WsContext);
  if (!v) throw new Error('useWsSession must be used inside <WsProvider>');
  return v;
}

/** Derive ws:// URL from current page (`/` → `ws://host/ws`). */
export function deriveWsUrl(): string {
  if (typeof window === 'undefined') return 'ws://localhost:0/ws';
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/ws`;
}

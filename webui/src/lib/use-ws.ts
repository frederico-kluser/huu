import { useCallback, useEffect, useReducer, useRef } from 'react';
import type {
  ClientMessage,
  OrchestratorState,
  Screen,
  ServerMessage,
} from '@shared/ws-protocol';
import { WsClient, type WsStatus } from './ws-client';

interface WsState {
  status: WsStatus;
  lastMessage: ServerMessage | null;
  state: OrchestratorState | null;
  screen: Screen | null;
}

type Action =
  | { type: 'status'; status: WsStatus }
  | { type: 'message'; msg: ServerMessage };

const initial: WsState = {
  status: 'connecting',
  lastMessage: null,
  state: null,
  screen: null,
};

function reducer(prev: WsState, action: Action): WsState {
  switch (action.type) {
    case 'status':
      return prev.status === action.status ? prev : { ...prev, status: action.status };
    case 'message': {
      const next: WsState = { ...prev, lastMessage: action.msg };
      if (action.msg.type === 'state') next.state = action.msg.state;
      else if (action.msg.type === 'screen') next.screen = action.msg.screen;
      return next;
    }
    default:
      return prev;
  }
}

export interface UseWsResult {
  status: WsStatus;
  send: (msg: ClientMessage) => void;
  lastMessage: ServerMessage | null;
  state: OrchestratorState | null;
  screen: Screen | null;
}

/**
 * React hook around `WsClient`. Owns one client per `url` (kept in a ref).
 * Accumulates the latest `state` and `screen` messages into reactive
 * buckets via `useReducer` so re-renders are cheap.
 */
export function useWs(url: string): UseWsResult {
  const [s, dispatch] = useReducer(reducer, initial);
  const clientRef = useRef<WsClient | null>(null);

  useEffect(() => {
    const client = new WsClient({
      url,
      onMessage: (msg) => dispatch({ type: 'message', msg }),
      onStatusChange: (status) => dispatch({ type: 'status', status }),
    });
    clientRef.current = client;
    return () => {
      client.close();
      clientRef.current = null;
    };
  }, [url]);

  const send = useCallback((msg: ClientMessage) => {
    clientRef.current?.send(msg);
  }, []);

  return {
    status: s.status,
    send,
    lastMessage: s.lastMessage,
    state: s.state,
    screen: s.screen,
  };
}

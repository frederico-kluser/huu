import { isServerMessage, type ClientMessage, type ServerMessage } from '@shared/ws-protocol';

export type WsStatus = 'connecting' | 'open' | 'closed' | 'error';

export interface WsClientOptions {
  url: string;
  onMessage: (msg: ServerMessage) => void;
  onStatusChange: (s: WsStatus) => void;
  reconnectBaseMs?: number;
  reconnectMaxMs?: number;
}

/**
 * Type-safe WebSocket client with auto-reconnect and outbound queue.
 *
 * - Outgoing messages are queued while `readyState !== OPEN`; the queue is
 *   flushed in FIFO order as soon as the socket opens.
 * - Reconnect uses exponential backoff with full jitter
 *   (`random(0, min(max, base * 2^attempt))`).
 * - Inbound payloads are JSON-parsed and validated through
 *   `isServerMessage` from the protocol module; malformed frames are
 *   silently dropped (front-end is a strict consumer).
 */
export class WsClient {
  private socket: WebSocket | null = null;
  private queue: ClientMessage[] = [];
  private attempt = 0;
  private closed = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly opts: Required<WsClientOptions>;

  constructor(opts: WsClientOptions) {
    this.opts = {
      reconnectBaseMs: 500,
      reconnectMaxMs: 10_000,
      ...opts,
    };
    this.connect();
  }

  send(msg: ClientMessage): void {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(msg));
    } else {
      this.queue.push(msg);
    }
  }

  close(): void {
    this.closed = true;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
    this.opts.onStatusChange('closed');
  }

  private connect(): void {
    if (this.closed) return;
    this.opts.onStatusChange('connecting');
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.opts.url);
    } catch {
      this.opts.onStatusChange('error');
      this.scheduleReconnect();
      return;
    }
    this.socket = ws;

    ws.addEventListener('open', () => {
      this.attempt = 0;
      this.opts.onStatusChange('open');
      // Flush queue.
      const pending = this.queue;
      this.queue = [];
      for (const msg of pending) {
        try {
          ws.send(JSON.stringify(msg));
        } catch {
          // If send fails mid-flush, re-queue the remainder.
          this.queue.push(msg);
        }
      }
    });

    ws.addEventListener('message', (ev) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(typeof ev.data === 'string' ? ev.data : '');
      } catch {
        return;
      }
      if (isServerMessage(parsed)) {
        this.opts.onMessage(parsed);
      }
    });

    ws.addEventListener('error', () => {
      this.opts.onStatusChange('error');
    });

    ws.addEventListener('close', () => {
      this.socket = null;
      if (!this.closed) {
        this.opts.onStatusChange('closed');
        this.scheduleReconnect();
      }
    });
  }

  private scheduleReconnect(): void {
    if (this.closed) return;
    const exp = Math.min(
      this.opts.reconnectMaxMs,
      this.opts.reconnectBaseMs * 2 ** this.attempt,
    );
    // Full jitter: random in [0, exp).
    const delay = Math.random() * exp;
    this.attempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }
}

/**
 * Derive the WebSocket URL from the current `window.location`.
 *
 * Swaps `http:` → `ws:` / `https:` → `wss:`, appends `/ws`, and forwards
 * the `?t=<token>` query string when present so the server can validate
 * the loopback session token.
 */
export function deriveWsUrl(): string {
  const { protocol, host, search } = window.location;
  const wsProto = protocol === 'https:' ? 'wss:' : 'ws:';
  const params = new URLSearchParams(search);
  const token = params.get('t');
  const query = token !== null ? `?t=${encodeURIComponent(token)}` : '';
  return `${wsProto}//${host}/ws${query}`;
}

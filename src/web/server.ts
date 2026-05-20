// HTTP + WebSocket transport layer for the huu web UI.
//
// Security model:
//   1. The server binds to 127.0.0.1 by default. It is not reachable
//      from other hosts on the network unless the caller explicitly
//      overrides `host` (don't).
//   2. Every HTTP request and the WebSocket upgrade must carry a
//      per-process random token (`?t=<uuid>`). The token is generated
//      via `crypto.randomUUID()` at startup and printed to the caller
//      as part of the returned URL. It is NEVER logged.
//   3. Token comparison uses `crypto.timingSafeEqual` over equal-length
//      buffers to avoid trivial timing oracles. Tokens that don't
//      decode to the expected length are rejected before the compare.
//   4. Static file serving resolves paths inside `staticDir` and
//      refuses anything that escapes the directory after `path.resolve`.

import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
  type Server as HttpServer,
} from 'node:http';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep as pathSep } from 'node:path';
import { Buffer } from 'node:buffer';
import type { Socket } from 'node:net';
import { WebSocketServer, WebSocket } from 'ws';
import {
  isClientMessage,
  type ClientMessage,
  type ServerMessage,
} from './ws-protocol.js';
import { openBrowser } from './browser-open.js';

export interface StartWebServerOptions {
  staticDir: string;
  host?: string;
  port?: number;
  openBrowser?: boolean;
  onConnection?: (conn: WebConnection) => void;
}

export interface WebConnection {
  id: string;
  send: (msg: ServerMessage) => void;
  onMessage: (handler: (msg: ClientMessage) => void) => void;
  close: () => void;
}

export interface WebServerHandle {
  url: string;
  token: string;
  port: number;
  close: () => Promise<void>;
}

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

const HEARTBEAT_INTERVAL_MS = 30_000;
const HEARTBEAT_GRACE_MS = 10_000;
const CLOSE_GRACE_MS = 5_000;

function parseUrl(reqUrl: string | undefined): URL | null {
  if (!reqUrl) return null;
  try {
    return new URL(reqUrl, 'http://localhost');
  } catch {
    return null;
  }
}

function tokensEqual(received: string | null, expected: string): boolean {
  if (received == null) return false;
  const a = Buffer.from(received, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) {
    // Constant-time dummy compare to avoid trivially short-circuiting
    // on length mismatch.
    timingSafeEqual(b, b);
    return false;
  }
  return timingSafeEqual(a, b);
}

function getTokenFromUrl(u: URL | null): string | null {
  if (!u) return null;
  return u.searchParams.get('t');
}

function isInside(parent: string, child: string): boolean {
  if (child === parent) return true;
  return child.startsWith(parent + pathSep);
}

async function serveStatic(
  staticDir: string,
  urlPath: string,
  res: ServerResponse,
): Promise<void> {
  const root = resolve(staticDir);
  let rel: string;
  try {
    rel = decodeURIComponent(urlPath);
  } catch {
    res.statusCode = 400;
    res.end('Bad Request');
    return;
  }
  if (rel.startsWith('/')) rel = rel.slice(1);
  if (rel === '' || rel.endsWith('/')) rel = `${rel}index.html`;

  const candidate = resolve(root, rel);
  if (!isInside(root, candidate)) {
    res.statusCode = 403;
    res.end('Forbidden');
    return;
  }

  try {
    const st = await stat(candidate);
    if (st.isDirectory()) {
      const indexPath = resolve(candidate, 'index.html');
      if (!isInside(root, indexPath)) {
        res.statusCode = 403;
        res.end('Forbidden');
        return;
      }
      const body = await readFile(indexPath);
      res.statusCode = 200;
      res.setHeader('Content-Type', CONTENT_TYPES['.html']);
      res.end(body);
      return;
    }
    const body = await readFile(candidate);
    const ext = extname(candidate).toLowerCase();
    res.statusCode = 200;
    res.setHeader('Content-Type', CONTENT_TYPES[ext] ?? 'application/octet-stream');
    res.end(body);
  } catch {
    // SPA fallback only for extension-less paths that look like client
    // routes ("/run"), never for missing static assets ("/missing.css").
    if (extname(candidate) === '') {
      try {
        const fallback = resolve(root, 'index.html');
        if (!isInside(root, fallback)) {
          res.statusCode = 403;
          res.end('Forbidden');
          return;
        }
        const body = await readFile(fallback);
        res.statusCode = 200;
        res.setHeader('Content-Type', CONTENT_TYPES['.html']);
        res.end(body);
        return;
      } catch {
        // fallthrough to 404
      }
    }
    res.statusCode = 404;
    res.end('Not Found');
  }
}

export async function startWebServer(
  opts: StartWebServerOptions,
): Promise<WebServerHandle> {
  const token = randomUUID();
  const host = opts.host ?? '127.0.0.1';
  const requestedPort = opts.port ?? 0;
  const staticDir = resolve(opts.staticDir);

  const httpServer: HttpServer = createServer(async (req, res) => {
    const u = parseUrl(req.url);
    if (!u) {
      res.statusCode = 400;
      res.end('Bad Request');
      return;
    }
    if (!tokensEqual(getTokenFromUrl(u), token)) {
      res.statusCode = 401;
      res.end('Unauthorized');
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.statusCode = 405;
      res.end('Method Not Allowed');
      return;
    }
    if (u.pathname === '/ws') {
      res.statusCode = 426;
      res.end('Upgrade Required');
      return;
    }
    await serveStatic(staticDir, u.pathname, res);
  });

  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (req: IncomingMessage, socket: Socket, head: Buffer) => {
    const u = parseUrl(req.url);
    if (!u || u.pathname !== '/ws' || !tokensEqual(getTokenFromUrl(u), token)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      const conn = wireConnection(ws);
      opts.onConnection?.(conn);
    });
  });

  function wireConnection(ws: WebSocket): WebConnection {
    const id = randomUUID();
    const handlers: Array<(msg: ClientMessage) => void> = [];
    let alive = true;
    let pendingPongTimer: NodeJS.Timeout | null = null;

    const sendRaw = (msg: ServerMessage): void => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(msg));
      }
    };

    ws.on('message', (data) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(data.toString());
      } catch {
        sendRaw({ type: 'error', message: 'invalid message', code: 'BAD_MSG' });
        return;
      }
      if (!isClientMessage(parsed)) {
        sendRaw({ type: 'error', message: 'invalid message', code: 'BAD_MSG' });
        return;
      }
      for (const h of handlers) h(parsed);
    });

    ws.on('pong', () => {
      alive = true;
      if (pendingPongTimer) {
        clearTimeout(pendingPongTimer);
        pendingPongTimer = null;
      }
    });

    const heartbeat = setInterval(() => {
      if (ws.readyState !== WebSocket.OPEN) return;
      alive = false;
      try {
        ws.ping();
      } catch {
        // ignore
      }
      pendingPongTimer = setTimeout(() => {
        if (!alive) {
          try {
            ws.terminate();
          } catch {
            // ignore
          }
        }
      }, HEARTBEAT_GRACE_MS);
    }, HEARTBEAT_INTERVAL_MS);

    ws.on('close', () => {
      clearInterval(heartbeat);
      if (pendingPongTimer) clearTimeout(pendingPongTimer);
    });

    return {
      id,
      send: sendRaw,
      onMessage: (h) => {
        handlers.push(h);
      },
      close: () => {
        try {
          ws.close();
        } catch {
          // ignore
        }
      },
    };
  }

  await new Promise<void>((resolveListen, rejectListen) => {
    const onErr = (err: Error): void => rejectListen(err);
    httpServer.once('error', onErr);
    httpServer.listen(requestedPort, host, () => {
      httpServer.removeListener('error', onErr);
      resolveListen();
    });
  });

  const addr = httpServer.address();
  if (!addr || typeof addr === 'string') {
    throw new Error('huu web server: unexpected address shape');
  }
  const port = addr.port;
  // no-log: token
  const url = `http://${host}:${port}/?t=${token}`;

  if (opts.openBrowser) {
    await openBrowser(url);
  }

  const close = async (): Promise<void> => {
    // Close WSS first: terminate all clients, then close the listener;
    // otherwise httpServer.close() can hang waiting on open sockets.
    await new Promise<void>((res) => {
      const timer = setTimeout(() => res(), CLOSE_GRACE_MS);
      for (const client of wss.clients) {
        try {
          client.terminate();
        } catch {
          // ignore
        }
      }
      wss.close(() => {
        clearTimeout(timer);
        res();
      });
    });
    await new Promise<void>((res) => {
      const timer = setTimeout(() => res(), CLOSE_GRACE_MS);
      httpServer.close(() => {
        clearTimeout(timer);
        res();
      });
      httpServer.closeAllConnections?.();
    });
  };

  return { url, token, port, close };
}

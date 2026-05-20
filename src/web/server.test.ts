import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { WebSocket } from 'ws';
import { startWebServer, type WebServerHandle, type WebConnection } from './server.js';

interface HttpResult {
  status: number;
  body: string;
  contentType?: string;
}

function httpGet(url: string): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(url, { method: 'GET' }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(Buffer.from(c)));
      res.on('end', () => {
        resolve({
          status: res.statusCode ?? 0,
          body: Buffer.concat(chunks).toString('utf8'),
          contentType: res.headers['content-type'],
        });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

describe('startWebServer', () => {
  let staticDir: string;
  let handle: WebServerHandle | null = null;

  beforeEach(async () => {
    staticDir = join(tmpdir(), `huu-web-test-${randomUUID()}`);
    await mkdir(staticDir, { recursive: true });
    await writeFile(join(staticDir, 'index.html'), '<!doctype html><title>huu</title>');
    await writeFile(join(staticDir, 'style.css'), 'body { color: red; }');
  });

  afterEach(async () => {
    if (handle) {
      await handle.close();
      handle = null;
    }
    await rm(staticDir, { recursive: true, force: true });
  });

  it('boots and returns URL+token bound to 127.0.0.1', async () => {
    handle = await startWebServer({ staticDir });
    expect(handle.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/\?t=/);
    expect(handle.token.length).toBeGreaterThan(8);
    expect(handle.port).toBeGreaterThan(0);
  });

  it('rejects GET / without token with 401', async () => {
    handle = await startWebServer({ staticDir });
    const res = await httpGet(`http://127.0.0.1:${handle.port}/`);
    expect(res.status).toBe(401);
  });

  it('serves index.html with correct token', async () => {
    handle = await startWebServer({ staticDir });
    const res = await httpGet(handle.url);
    expect(res.status).toBe(200);
    expect(res.body).toContain('<title>huu</title>');
    expect(res.contentType).toMatch(/text\/html/);
  });

  it('serves CSS with text/css content-type', async () => {
    handle = await startWebServer({ staticDir });
    const res = await httpGet(`http://127.0.0.1:${handle.port}/style.css?t=${handle.token}`);
    expect(res.status).toBe(200);
    expect(res.contentType).toMatch(/text\/css/);
    expect(res.body).toContain('color: red');
  });

  it('blocks path traversal', async () => {
    handle = await startWebServer({ staticDir });
    // Write a sibling file OUTSIDE staticDir; we must never be able to
    // read it. Use a raw TCP socket so the WHATWG URL parser in
    // node:http client doesn't normalise ../ away before send.
    const secretDir = `${staticDir}-secret`;
    await mkdir(secretDir, { recursive: true });
    await writeFile(join(secretDir, 'leak.txt'), 'TOP-SECRET-LEAK-MARKER');
    try {
      const net = await import('node:net');
      const raw: string = await new Promise((resolve, reject) => {
        const sock = net.connect(handle!.port, '127.0.0.1', () => {
          // Send a path that, when resolved naively, escapes staticDir.
          sock.write(
            `GET /../${
              secretDir.split('/').pop()
            }/leak.txt?t=${handle!.token} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`,
          );
        });
        const chunks: Buffer[] = [];
        sock.on('data', (c) => chunks.push(c));
        sock.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        sock.on('error', reject);
      });
      expect(raw).not.toContain('TOP-SECRET-LEAK-MARKER');
      // Status should be 4xx (403, 404, or 400).
      expect(raw).toMatch(/HTTP\/1\.1 4\d\d/);
    } finally {
      await rm(secretDir, { recursive: true, force: true });
    }
  });

  it('rejects WS upgrade with wrong token', async () => {
    handle = await startWebServer({ staticDir });
    const ws = new WebSocket(`ws://127.0.0.1:${handle.port}/ws?t=wrong-token`);
    await new Promise<void>((resolve) => {
      ws.on('error', () => resolve());
      ws.on('close', () => resolve());
      ws.on('open', () => {
        ws.close();
        resolve();
      });
    });
    expect(ws.readyState).not.toBe(WebSocket.OPEN);
  });

  it('accepts WS upgrade with correct token and onConnection sees hello-send', async () => {
    let captured: WebConnection | null = null;
    handle = await startWebServer({
      staticDir,
      onConnection: (conn) => {
        captured = conn;
        conn.send({ type: 'hello', protocolVersion: 1, serverVersion: 'test' });
      },
    });
    const ws = new WebSocket(`ws://127.0.0.1:${handle.port}/ws?t=${handle.token}`);
    const firstMsg: string = await new Promise((resolve, reject) => {
      ws.once('message', (data) => resolve(data.toString()));
      ws.once('error', reject);
    });
    const parsed = JSON.parse(firstMsg);
    expect(parsed.type).toBe('hello');
    expect(parsed.protocolVersion).toBe(1);
    expect(captured).not.toBeNull();
    ws.close();
  });

  it('responds with error code BAD_MSG on malformed JSON', async () => {
    handle = await startWebServer({
      staticDir,
      onConnection: () => {
        /* no-op */
      },
    });
    const ws = new WebSocket(`ws://127.0.0.1:${handle.port}/ws?t=${handle.token}`);
    await new Promise<void>((r) => ws.once('open', () => r()));
    ws.send('not json {');
    const reply: string = await new Promise((resolve) => {
      ws.once('message', (data) => resolve(data.toString()));
    });
    const parsed = JSON.parse(reply);
    expect(parsed).toMatchObject({ type: 'error', code: 'BAD_MSG' });
    ws.close();
  });

  it('routes valid ping to onConnection handler', async () => {
    const received: unknown[] = [];
    handle = await startWebServer({
      staticDir,
      onConnection: (conn) => {
        conn.onMessage((msg) => received.push(msg));
      },
    });
    const ws = new WebSocket(`ws://127.0.0.1:${handle.port}/ws?t=${handle.token}`);
    await new Promise<void>((r) => ws.once('open', () => r()));
    ws.send(JSON.stringify({ type: 'ping' }));
    await new Promise((r) => setTimeout(r, 50));
    expect(received).toContainEqual({ type: 'ping' });
    ws.close();
  });

  it('close() shuts down the listener', async () => {
    handle = await startWebServer({ staticDir });
    const port = handle.port;
    const token = handle.token;
    await handle.close();
    handle = null;
    await expect(httpGet(`http://127.0.0.1:${port}/?t=${token}`)).rejects.toThrow();
  });
});

---
name: building-web-ui
description: Maps huu's browser front-end (src/web/) — the dependency-free node:http + SSE server, the single /events stream and its TWO frame types (the throttled run snapshot vs the un-throttled agent-output firehose), the WebRunManager single-run lifecycle (409 on concurrent), the browser-only API-key flow, the vanilla-JS no-build client and its MANDATORY dist copy step, the HUU_WEB_TOKEN gate and the sibling-of-ui layering. Use for any change under src/web/ — server routes, SSE frames, run-manager, api-data endpoints, or the browser client (app.js/index.html/styles.css).
metadata:
  version: 0.1.0
  type: knowledge
---

# Building the Web UI

## When to use

Any work under `src/web/`: the `node:http` server + routes (`server.ts`), the
SSE event stream, `WebRunManager` (`run-manager.ts`), the `/api/*` read layer
(`api-data.ts`), the port/host/banner entry (`serve.ts` / `interface-mode.ts`),
or the vanilla-JS browser client (`client/app.js`, `index.html`, `styles.css`).
Symptoms that route here: "the web UI doesn't update / isn't real-time", a new
`/api` endpoint, a new SSE frame, browser-console work, a folder/model/key
control on the launch form.

## Injected knowledge

### The layer and its one hard constraint

- `src/web/` is a presentation/entry layer, a SIBLING to `ui/`. It may import
  `orchestrator/`, `lib/`, models — NEVER the reverse (same downward-only rule
  as the TUI; see following-architecture-conventions). Both front-ends drive
  ONE `Orchestrator`; the web is just a different face, not a different engine.
- DEPENDENCY-FREE on purpose: `node:http` + Server-Sent Events only, no web
  framework, no CDN. The runtime image prunes devDependencies, so anything
  beyond Node built-ins simply won't exist in prod. Do not reach for
  express/ws/socket.io — the SSE-over-`node:http` pattern is the design.

### One SSE stream, two frame types (the core mental model)

- Server→browser is ONE SSE stream at `GET /events`. Browser→server is plain
  `fetch` POSTs (`/api/run`, `/api/run/abort`, `/api/run/concurrency`,
  `/api/keys/validate`). The client's `es.onmessage` routes purely by
  `frame.type`.
- `{type:'run', run}` — the THROTTLED state snapshot. Coalesced to ≤1 frame per
  `BROADCAST_INTERVAL_MS` (120 ms) so a busy run can't flood every browser; the
  LAST frame is REPLAYED on connect so a refresh re-syncs. Per-agent `logs` are
  trimmed to `MAX_AGENT_LOG_LINES` (200) inside the frame (full set on demand
  via `GET /api/agent-logs?id=`).
- `{type:'agent-stream', agentId, channel, text}` — the RAW agent-output
  firehose: one frame per coalesced output line, NOT throttled, NOT replayed.
  Fed by `Orchestrator.subscribeAgentOutput` (a SECOND channel, distinct from
  the snapshot `subscribe`); the browser mirrors it to `console.log`
  (`window.HUU_LOG_STREAM = false` silences). **RULE:** high-frequency,
  append-only data rides the firehose — NEVER inflate the throttled snapshot
  with it (the snapshot truncates per-agent logs and rebuilds `getState()` each
  emit). Adding a frame type = a `JSON.stringify({type:…})` writer on the
  server + a branch in `connectSse`'s `onmessage`.

### WebRunManager — one run per instance

- `run-manager.ts` wraps the Orchestrator for the web exactly like
  `RunDashboard.tsx` does for the TUI and `headless-run.ts` does for
  `huu auto`. A FRESH Orchestrator per `start()`; a second `start()` while one
  is active throws → `server.ts` maps that message to HTTP 409. `abort()` backs
  `/api/run/abort` and the server's `close` handler.
- Constructor is `(cwd, onUpdate, onAgentOutput?)`: `onUpdate` is the throttled
  snapshot sink, `onAgentOutput` the firehose sink — both unsubscribed in the
  run's `.finally()`. CLI/headless callers omit `onAgentOutput` (no console to
  mirror to).
- Keys are browser-only: it prefers `params.apiKey` over `resolveApiKey` and
  NEVER calls `saveApiKey` (full policy in integrating-llm-backends).

### The vanilla-JS client (no build, no framework)

- `client/app.js` is a plain browser ES module: browser globals only
  (`document`, `EventSource`, `fetch`, `console`, `sessionStorage`) — NO npm
  imports, NO TypeScript, NO JSX. `tsc` does not see it; `node --check
  src/web/client/app.js` is your only compile check. Match the house style:
  `$ = (id) => getElementById`, the `api()` fetch helper, the single `S` state
  object, `esc()` before injecting any text into HTML.
- It is served from `clientDir()` = `./client/` RELATIVE TO THE MODULE → dev
  (tsx) serves `src/web/client/`, prod serves `dist/web/client/`. The build
  copies it: `mkdir -p dist/web/client && cp -R src/web/client/. dist/web/client/`
  (package.json `build`). So a client edit shows up instantly under `npm run
  dev`, but needs `npm run build` to reach the prod bundle / Docker image —
  forgetting the copy ships a stale UI with green tests.
- `serveStatic` normalizes + confines paths to the client root (traversal
  guard); MIME from the `CONTENT_TYPES` map.

### Endpoints, the token gate, host/port

- Add an endpoint in three places: a route in `server.ts` `handleRequest`
  (static assets + `/api/health` are ungated; everything BELOW the
  `requireToken(...)` line is token-gated), a pure read builder in
  `api-data.ts` (`listModelsInfo`, `keyStatus`, `listPipelinesInfo`,
  `listDirs`, `repoName`, `validateKeyValue`, …), and a caller via `api()` in
  `app.js`.
- `HUU_WEB_TOKEN` gates `/api` + `/events` (accepts `?token=` or the
  `x-huu-token` header); the static shell + `/api/health` stay open so the page
  can load and prompt for the token.
- Host/port live in `interface-mode.ts` (`resolveWebHost` → `HUU_WEB_HOST`,
  default `0.0.0.0`; `resolveWebPort` → `--port` / `HUU_WEB_PORT`, default
  4888). `serve.ts` binds the port, prints the access banner, and stays pending
  for the process's life (cli.tsx owns SIGINT/SIGTERM).

### Testing without a browser or an LLM

- `server.test.ts` boots a real server on an ephemeral port over a real git
  temp repo with the `stub` backend (no key, no model). Drive a run with `POST
  /api/run {backend:'stub', modelId:'stub'}` and read SSE frames off
  `res.body.getReader()` — decode, split on `\n\n`, `JSON.parse` the `data:`
  lines. The stub emits `stream` events, so the agent-stream firehose is
  exercised end-to-end (the client `console.log` itself isn't unit-tested —
  `node --check` covers its syntax).

## References

- `src/web/server.ts`, `src/web/run-manager.ts`, `src/web/api-data.ts`,
  `src/web/serve.ts`, `src/web/interface-mode.ts`, `src/web/client/app.js`,
  `src/web/server.test.ts`
- Related skills: working-on-orchestrator (`subscribe` vs `subscribeAgentOutput`,
  the `stream` AgentEvent), integrating-llm-backends (browser-only key flow),
  building-tui-screens (the other front-end), following-architecture-conventions
  (the sibling-of-ui layering).

> Facts verified against source on 2026-06-25.

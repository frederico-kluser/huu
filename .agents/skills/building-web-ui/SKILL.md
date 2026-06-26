---
name: building-web-ui
description: Procedure and conventions for huu's BROWSER UI (src/web) — the vanilla-ESM no-build client (index.html/app.js/styles.css), the stateless single-run server over node:http + SSE with its TWO frame types (throttled run snapshot vs the un-throttled agent-stream output firehose mirrored to the browser console), the browser-owns-state rule (keys in sessionStorage, run history in IndexedDB), the provider→backend dispatch gotcha, and how to verify client logic with no browser. Use for any change under src/web/ — client screens, the SSE/run-manager server, api-data, or web run/queue/history behavior.
metadata:
  version: 0.2.0
  type: task
---

# Building the Web UI

## When to use

Anything under `src/web/`: the browser client (`client/index.html`, `client/app.js`, `client/styles.css`, sibling ES modules), the HTTP+SSE server (`server.ts`), `api-data.ts`, `run-manager.ts`, `serve.ts`, `interface-mode.ts`. The web UI is huu's DEFAULT front-end (`--cli`/`--tui` switches to Ink); see `running-in-docker` for web-vs-cli vs docker-vs-native. Also covers the synthetic `/simulation` demo surface — the `SimulationEngine` lives in `src/orchestrator/simulation/` but is wired in and driven entirely from `run-manager.ts` / `server.ts` / the client.

## Injected knowledge

### Layering & build

- `src/web/` is a presentation layer, sibling to `src/ui/` — it may import from `orchestrator`/`lib`, never the reverse (`following-architecture-conventions`).
- The client is **vanilla ES modules — no framework, no bundler, no CDN** (works offline and in Docker). `build` does `tsc && cp -R src/web/client/. dist/web/client/` — the client is copied RAW. `tsconfig` has **no `allowJs`**, so client `.js` is NOT type-checked and there is **no client test harness**. The server `.ts` files (`server.ts`, `api-data.ts`, `run-manager.ts`, `interface-mode.ts`) ARE type-checked and DO have colocated `.test.ts`.
- `clientDir()` resolves `./client/` from `import.meta.url`, so dev (tsx, serves `src/`) and prod (serves `dist/`) both work. Static GETs are path-traversal-confined to that dir; content-type is by extension.

### Client conventions (`client/app.js`)

- Helpers: `$(id)` = getElementById; one mutable `S` state object; `api(path, opts)` = fetch+JSON wrapper that throws on `!res.ok`; `esc()` for HTML. Match these — don't introduce a framework.
- **One SSE stream, two frame types.** `/events` carries server→browser frames; browser→server actions are fetch POSTs. `{type:'run', run}` is the THROTTLED state snapshot — coalesced to ≤1 frame / 120 ms (`BROADCAST_INTERVAL_MS`), last frame replayed to a new EventSource so a refresh re-syncs, per-agent `logs` capped at 200 (`trimState`). `{type:'agent-stream', agentId, channel, text}` is the RAW agent-output firehose — one frame per coalesced output line (assistant + thinking), NOT throttled and NOT replayed, written straight to every client by `broadcastAgentStream`; `app.js` mirrors it to the DevTools `console.log` (`window.HUU_LOG_STREAM = false` silences). It is fed by `Orchestrator.subscribeAgentOutput` (a SECOND channel beside the snapshot `subscribe`; surfaced via `WebRunManager`'s 3rd ctor arg `onAgentOutput`). RULE: high-frequency / append-only data gets its OWN un-throttled frame type — never inflate the `run` snapshot with it (it truncates + churns `getState()`). `connectSse().onmessage` branches on `frame.type`.
- **The browser owns state.** API keys live ONLY in `sessionStorage` (validated via `POST /api/keys/validate`, never written to disk) and are sent as `apiKey` with each `/api/run`. Run **history** lives in **IndexedDB** (`client/db.js`). Persist secrets nowhere on disk; persist queues to `localStorage` WITHOUT keys.
- Keep any non-DOM logic (record builders, serializers) in a **separate module with NO top-level DOM/IndexedDB access** (e.g. `db.js` touches `indexedDB`/`document` only inside function bodies) so it imports cleanly in Node — that is the ONLY way to unit-test client logic here.

### Server contract & gotchas (each is a real constraint)

- **Single run per server.** `WebRunManager` holds one `Orchestrator`; a second `start()` throws `already in progress` → server returns **HTTP 409**. On settle the run-manager flips phase to `done`/`error` and nulls the orch, so the next `/api/run` is accepted. This is what makes **browser-driven SEQUENTIAL runs** work: watch SSE for a terminal phase, then POST the next run (retry briefly on a transient 409). Verified: two back-to-back `{backend:'stub'}` runs start with distinct runIds.
- **Provider derives the backend; `lockedBackend` is ignored by `startRun`.** `server.startRun` does `provider ? providerToBackend(provider) : parseBackendKind(body.backend)` (openrouter→pi, azure→azure). So `--stub` does NOT force stub for browser-initiated runs. To drive a stub run, POST `{backend:'stub'}` with **NO `provider`** (stub `requiresApiKey:false`).
- `/api/run` already accepts per-run `provider, modelId, mode, concurrency, apiKey, endpoint, runDirectory, timeoutMinutes` — **heterogeneous sequential runs need ZERO server change**.
- **Cards & cost.** `OrchestratorState` cards = `agents[]` (only these carry per-card `cost` + tokens), `stageIntegrations[]` (merge), `checkRuns[]` (judge). Merge/judge LLM cost is NOT metered per-card — it folds into `state.totalCost` (the authoritative project cost). The terminal SSE frame carries the full final `state` (`trimState` only caps `agent.logs` to 200 lines), so the browser can archive every card + cost on settle.
- **Synthetic `/simulation` demo run.** `run-manager.ts` drives runs through a tiny `RunDriver` seam — `subscribe` + `subscribeAgentOutput` + `start():Promise<{runId,manifest:{errorReason?}}>` — satisfied structurally by BOTH the real `Orchestrator` and a `SimulationEngine` (`src/orchestrator/simulation/`), so a private `launch()` wires either through the SAME snapshot/SSE machinery and the real-run path is untouched. The engine fabricates byte-identical `OrchestratorState` snapshots + `agent-stream` frames with NO git/LLM/key, so the existing kanban/log/drawer render a believable run unchanged. Routes: `GET /simulation` serves the SPA shell (explicit route placed BEFORE the catch-all static handler, else the bare path 404s; the client routes on `location.pathname`); `POST /api/run {simulate:true,modelIds,fileCount,concurrency}` branches at the TOP of `startRun` (no backend/provider/key resolution) → `manager.startSimulation()`; `POST /api/run/pause {paused}` → `manager.setPaused()`. Each run randomly samples the full scenario mix (streaming, requeue ↻, retries, errors, stage merges, judge rework→approved). See LEARNINGS for the seam + the timer-free determinism recipe (`advance()` + seeded PRNG).

### Styling (`client/styles.css`)

Apple "Liquid Glass" system: CSS-var tokens (`--accent` indigo, `--accent-2` purple, `--glass`, `--elev`, semantic `--green/--red/--yellow/--teal`, `--radius*`), theme via `:root[data-theme=auto|light|dark]`. **Reuse tokens; never hardcode colors.** The "magenta = AI only" rule is Ink-specific (`theme.ai`); the web palette uses `--accent`/`--accent-2` freely.

## Procedure

1. **Client UI** → edit `client/index.html` (markup), `client/styles.css` (tokens only), `client/app.js` (logic). Put pure/DOM-free logic in its own `client/*.js` module so it's Node-testable.
2. **Server/data** → `server.ts` (routes), `api-data.ts` (bootstrap/models/keys/pipelines), `run-manager.ts` (run lifecycle). These are typed + have `.test.ts` — add tests here (`writing-tests`).
3. **Verify with no browser** (the repo has no DOM harness):
   - pure builders → import the DOM-free module in Node and assert;
   - IndexedDB → `npm i fake-indexeddb` in a SCRATCH dir (not project deps), `import 'fake-indexeddb/auto'`, exercise the store;
   - static + ESM graph → boot `HUU_NO_DOCKER=1 npx tsx src/cli.tsx --web --stub --port=N`, curl `/`, `/app.js`, sibling modules, `/api/bootstrap`;
   - real run + sequencing → POST `/api/run {backend:'stub', runDirectory:<temp git repo>}` (drop a wrapped pipeline into `pipelines/` — `parsePipelineFromJson` accepts `{_format,pipeline}`), poll `/api/bootstrap`.run.phase.
4. `npm run typecheck && npm test` (`committing-and-validating`). Twin the README (pt-BR + EN) if the change is user-facing (`writing-project-docs`).

## References

- `src/web/server.ts` (`createWebServer`, `startRun`, SSE throttle), `src/web/run-manager.ts` (`WebRunManager`), `src/web/api-data.ts`, `src/web/interface-mode.ts` (`decideInterfaceMode`, default web).
- `src/lib/providers.ts` (`providerToBackend`/`backendToProvider`), `src/lib/types.ts` (`OrchestratorState`, `AgentStatus`, `StageIntegration`, `CheckRun`).
- `src/orchestrator/simulation/engine.ts` + `corpus.ts` (the `/simulation` `SimulationEngine`), `engine.test.ts` + `src/web/run-manager.test.ts` (its specs).
- Related: `following-architecture-conventions`, `working-on-orchestrator`, `integrating-llm-backends`, `running-in-docker`, `building-tui-screens` (the Ink counterpart).

> Facts verified against source on 2026-06-25; `/simulation` synthetic demo surface added + verified 2026-06-26.

## <evolution>

After the task completes:

1. Only persist learnings if the task passed its tests/criteria.
2. Keep only non-obvious, durable learnings: surprises, user corrections, discovered conventions, failed approaches. Skip the obvious and the volatile.
3. Append to the LEARNINGS.md of the skill that OWNS the domain. Format: `- [YYYY-MM-DD][source:user|inference][task:<slug>][probation] <fact>` — user feedback outranks inference.
4. If LEARNINGS.md shows a stable repeated pattern, distill it into this SKILL.md body and bump `metadata.version`.
5. If a NEW knowledge area emerged, invoke meta-skill-evolution to propose a new skill.
6. Never merge skill changes yourself — leave them as an uncommitted git diff for human review.

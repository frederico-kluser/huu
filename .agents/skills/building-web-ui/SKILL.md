---
name: building-web-ui
description: Procedure and conventions for huu's BROWSER UI (src/web) — the vanilla-ESM no-build client (index.html/app.js/styles.css), the multi-run server over node:http + SSE with its TWO frame types (throttled run snapshot vs the un-throttled agent-stream output firehose mirrored to the browser console), the browser-owns-state rule (keys in sessionStorage, run history in IndexedDB), the provider→backend dispatch gotcha, and how to verify client logic with no browser. Use for any change under src/web/ — client screens, the SSE/run-manager server, api-data, or web run/queue/history behavior.
metadata:
  version: 0.8.0
  type: task
---

# Building the Web UI

## When to use

Anything under `src/web/`: browser client (`client/index.html`, `client/app.js`, `client/styles.css`, sibling ES modules), HTTP+SSE server (`server.ts`), `api-data.ts`, `run-manager.ts`, `serve.ts`, `interface-mode.ts`. The web UI is huu's DEFAULT front-end (`--cli`/`--tui` switches to Ink). Also covers the synthetic `/simulation` demo — `SimulationEngine` in `src/orchestrator/simulation/` driven from `run-manager.ts`/`server.ts`.

## Injected knowledge

### Layering & build

- `src/web/` is a presentation layer, sibling to `src/ui/` — imports from `orchestrator`/`lib`, never the reverse (`following-architecture-conventions`).
- Client is **vanilla ES modules — no framework, no bundler, no CDN**. `build` does `tsc && cp -R src/web/client/. dist/web/client/`. `tsconfig` has **no `allowJs`**, so client `.js` is NOT type-checked. Server `.ts` files ARE type-checked and have colocated `.test.ts`.
- `clientDir()` resolves `./client/` from `import.meta.url`, works in dev (tsx) and prod (dist). Static GETs confined to that dir; content-type by extension.

### Client conventions (`client/app.js`)

- Helpers: `$(id)` = getElementById; mutable `S` state; `api(path, opts)` = fetch+JSON (throws on `!res.ok`); `esc()` for HTML. Match these.
- **One SSE stream, two frame types.** `{type:'run', run}` is the THROTTLED snapshot — ≤1 frame/120ms, last replayed on connect, agent logs capped at 200 (`trimState`). `{type:'agent-stream', agentId, channel, text}` is the RAW firehose — NOT throttled, NOT replayed, mirrored to `console.log` (silence with `HUU_LOG_STREAM=false`). Fed by `Orchestrator.subscribeAgentOutput` (second channel beside snapshot `subscribe`). RULE: high-frequency data gets its OWN un-throttled frame type. **SSE liveness watchdog:** server sends real `event: ping` every 25s; client (`sse-liveness.js`, pure + Node-tested) detects 60s silence/CLOSED → force reopens EventSource with backoff + `/api/bootstrap` resync; `visibilitychange`/`online` check immediately. `renderLog` coalesced to one trailing render/100ms (timer, NOT rAF).
- **The browser owns state.** Launch-form API keys in `sessionStorage` (validated via `POST /api/keys/validate`), sent as `apiKey` per `/api/run`. Run **history** in **IndexedDB** (`client/db.js`). Queue perists to `localStorage` WITHOUT keys — versioned `{schema:'huu-queue-v2'}` envelope with per-item `status`+`runId`; `relinkQueue` re-links on boot. **⚙ Settings → OpenRouter key** persists server-side — `POST /api/keys` validates + writes config store + arms `WebRunManager.setWebKey`; rejected keys never saved; `maskKey` removes raw value from payloads/logs.
- Keep non-DOM logic in **separate modules with NO top-level DOM/IndexedDB access** (e.g. `db.js`) so they import cleanly in Node. Colocated `.test.js` runs under vitest (esbuild transforms; `tsconfig`'s missing `allowJs` only gates `tsc`). The "no client test harness" caveat applies ONLY to code touching DOM at import/call time.

### Guided launch (cart) flow — the DEFAULT launch view

4-step wizard (`goStep(n)` + `#stepper` chips): **1** pick pipeline · **2** mark ≥1 project folder (multi-select checkbox picker over `/api/folders`; `S.markedDirs` absolute paths persist across nav; `☑ Mark all` bulk-marks current listing) · **3** configure pipeline (per-pipeline model/provider/concurrency/timeout, shared by projects) · **4** review grouped queue → add another pipeline or run. Each batch fans out over marked folders into flat `S.queue.items` via `fanOutBatch()` (`queue-util.js`); `groupQueueItems` renders groups. ENTIRELY client-side over existing per-item POST — ZERO server change. `commitBatch` "spends" the batch; `renderQueue` calls `renderStepper` each SSE frame (safe: only touches `#stepper`). Inline edit/reorder de-scoped. GOTCHA: `listDirs` follows directory symlinks but EXCLUDES symlinks resolving to files.

### Server contract & gotchas

- **Multiple runs over one `GlobalScheduler`.** `WebRunManager` holds `Map<runId>`; each run streams OWN `{type:'run'}` snapshot + `{type:'agent-stream', runId}` firehose. Actions (`/api/run/abort|concurrency|pause`) take `runId`; abort with NO runId stops ALL. `/api/bootstrap` returns `runs[]`. Client shows custom Motion-animated listbox project selector when >1 run. **LAZY admission:** `pending` queue drained by 500ms loop via shared `AdmissionController`; first run starts immediately, rest `queued` until spare capacity. `MAX_LIVE_RUNS=8`, `MAX_CONCURRENT_RUNS=64`. Registration in `orch.start()` (admission), so `queued` orch costs ZERO budget. Browser POSTs whole queue; server paces it. **Add-to-queue mid-run** via `S.homePinned` flag (opts home out of `renderActiveRun`'s per-frame board auto-switch). Machine-global **RAM budget dial** via `POST /api/run ramPercent` → `scheduler.setBudgetPercent()`.
- **Provider→backend dispatch.** `server.startRun` does `provider ? providerToBackend(provider) : parseBackendKind(body.backend)` (openrouter→pi, azure→azure). `--stub` does NOT force stub for browser runs; POST `{backend:'stub'}` with NO `provider`. `/api/run` accepts per-run `provider, modelId, mode, concurrency, apiKey, endpoint, runDirectory, timeoutMinutes`.
- **Interactive retry.** Held-open `awaiting_retry` runs retried via `POST /api/run/retry {runId, agentId, timeoutMinutes?}` and released via `/api/run/finish`. Drive chrome off inner `run.state.status==='awaiting_retry'`, NOT `run.phase`. Timeout cards get amber `.phase.tmo` badge; `manualRetries` foot bit.
- **Cards & cost.** `agents[]` carry per-card `cost`+tokens; `totalCost` summed live in `getState()`. Merge/judge cost NOT metered yet. Terminal SSE frame carries final `state` for archival.
- **Terminal narration.** `web/terminal-log.ts` mirrors lifecycle events (key ops, queue start/finish, failures). `OrchestratorOptions.onLog` tees per-run activity; raw firehose opt-in `HUU_WEB_LOG_STREAM=1`. Client failures TOAST via `postRun` catch + `phase:'error'` transition (deduped `processed` Set).
- **Synthetic `/simulation` demo.** `RunDriver` seam (`subscribe` + `subscribeAgentOutput` + `start():Promise<{runId,manifest}>`) satisfied by both `Orchestrator` and `SimulationEngine`. `/simulation` route serves SPA; `POST /api/run {simulate:true,…}` branches before key resolution. Engine: `advance()` + seeded PRNG for timer-free deterministic tests; scenario mix mirrors real run.

### Styling (`client/styles.css`)

Apple "Liquid Glass": CSS-var tokens (`--accent` indigo, `--accent-2` purple, `--glass`, `--elev`, semantic `--green/--red/--yellow/--teal`, `--radius*`), theme via `:root[data-theme=auto|light|dark]`. **Reuse tokens; never hardcode colors.** "Magenta = AI only" is Ink-specific; web uses `--accent`/`--accent-2`.

## Procedure

1. **Client UI** → `client/index.html` (markup), `client/styles.css` (tokens), `client/app.js` (logic). Pure logic in `client/*.js` for Node-testability.
2. **Server/data** → `server.ts`, `api-data.ts`, `run-manager.ts`. Typed + `.test.ts` — add tests.
3. **Verify with no browser:** pure builders → import in Node; IndexedDB → `fake-indexeddb` in scratch dir; static+ESM graph → `--web --stub` + curl `/`, `/app.js`, `/api/bootstrap`; real run → POST `{backend:'stub', runDirectory:<temp git repo>}` + poll `/api/bootstrap`.
4. `npm run typecheck && npm test` (`committing-and-validating`). Twin README if user-facing.

## References

- `src/web/server.ts`, `src/web/run-manager.ts`, `src/web/api-data.ts`, `src/web/interface-mode.ts`.
- `src/lib/providers.ts` (`providerToBackend`/`backendToProvider`), `src/lib/types.ts`.
- `src/orchestrator/simulation/engine.ts` + `corpus.ts`, `engine.test.ts`, `run-manager.test.ts`.
- Related: `following-architecture-conventions`, `working-on-orchestrator`, `integrating-llm-backends`, `running-in-docker`, `building-tui-screens`.

> Facts verified 2026-06-25 — 2026-07-03. See LEARNINGS.md for per-task provenance (simulation, multi-run, lazy admission, guided launch, Settings panel, SSE liveness, queue v2, budget telemetry, Mark all).

## <evolution>

After the task completes:

1. Only persist learnings if the task passed its tests/criteria.
2. Keep only non-obvious, durable learnings: surprises, user corrections, discovered conventions, failed approaches.
3. Append to LEARNINGS.md of the skill that OWNS the domain. Format: `- [YYYY-MM-DD][source:user|inference][task:<slug>][probation] <fact>`.
4. If LEARNINGS.md shows a stable repeated pattern, distill it into this body and bump `metadata.version`.
5. If a NEW knowledge area emerged, invoke meta-skill-evolution.
6. Never merge skill changes yourself — leave as uncommitted diff for human review.

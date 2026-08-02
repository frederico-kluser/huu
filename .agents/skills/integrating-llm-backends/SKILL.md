---
name: integrating-llm-backends
description: Maps huu's agent-backend system — the registry kind→factory dispatch (pi, azure, stub), the BackendBundle contract, the 5-step API-key resolution chain, thinking-model detection and model catalogs. Use when changing LLM clients, adding or debugging a backend, fixing auth/key resolution, or touching model selection.
metadata:
  version: 0.5.0
  type: knowledge
---

# Integrating LLM Backends

## When to use

Work on `src/orchestrator/backends/**`, `src/lib/api-key*.ts`, `src/lib/llm-client-factory.ts` / `openrouter.ts` / `azure.ts`, model catalogs, or any "agent won't authenticate / wrong model" bug.

## Injected knowledge

### Registry is the single dispatch point

`src/orchestrator/backends/registry.ts:16` — `AgentBackendKind = 'pi' | 'azure' | 'stub'`. The file's own doc comment is the extension contract: "Adding a new backend is a one-line case append here — cli.tsx and Orchestrator never need to learn about it." Kind names double as CLI flag values (`--backend=<kind>`) and `AppConfig.backend`; changing one means changing both intentionally.

Note: azure IS a real backend (`backends/azure/factory.ts`, `docs/azure-backend.md`) even though older docs listed only three kinds.

### BackendBundle contract (registry.ts:20-40)

- `agentFactory` — per-task agents.
- `conflictResolverFactory` — `undefined` for backends that can't reasonably resolve merge conflicts (stub): the orchestrator then fails loud on conflict instead of shipping a silent bad merge.
- `requiresApiKey` — stub returns `false`, which is what lets `--stub` smoke runs work without any key. If you add a keyless backend, this flag is the only thing the api-key prompt screen checks.
- `label` / `description` — feed the TUI backend selector directly; `ALL_BACKENDS` (registry.ts:18) drives what the selector lists.

### API-key resolution chain (`src/lib/api-key.ts:24-27`)

1. Secret mount: `/run/secrets/<name>` (Docker `--mount`, readonly) — a VALUE SNAPSHOT frozen at container start, it does NOT track the store live
2. Persisted store: `$XDG_CONFIG_HOME/huu/config.json` (fallback `~/.config/huu/config.json`; `HUU_CONFIG_DIR` overrides the dir — the Docker wrapper points it at the HOST config dir and bind-mounts it RW, so in-container saves persist across containers) — an explicitly saved key, now ABOVE the env var. Helpers: `saveApiKey` / `loadStoredApiKey` / `clearStoredApiKey` (clearing needs its own function — `saveApiKey` early-returns on empty) / `maskKey` (log/UI-safe fingerprint, 6-char prefix + last 4)
3. `<NAME>_FILE` env var pointing at a file (postgres-style `_FILE` convention)
4. Plain env var — the fallback when nothing is saved (CI / headless)
5. TUI prompt (which can persist to step 2)

Per-backend specs live in `src/lib/api-key-registry.ts` (envVar / envFileVar / secretMountPath per key). The Docker wrapper forwards every registry envVar/envFileVar into the container and mounts secret files — add a new key spec there and the wrapper picks it up without edits.

**Source-aware resolution (the inverted "valid key still 401s" trap).** `resolveApiKey` delegates to `resolveApiKeyWithSource(spec) → { value, source, storedOverridesEnv }`. `source` is which tier won (`secret-mount`/`stored`/`env-file`/`env`/`none`); the saved store now OUTRANKS the env var, so an explicitly saved key beats a stale `OPENROUTER_API_KEY` from a shell profile or a sourced `~/.secrets` (the old foot-gun, reversed). `storedOverridesEnv` is true when the saved key won AND a *different* non-empty env value is present — i.e. an ambient env var is being deliberately ignored. Build user-facing remediation with `keyRemedyHint(spec, res)` — it names the actual source (update the saved key when stored won; fix the env var / save one when env was the fallback). The orchestrator's 401 probe path and the docker-reexec host loop both use these; never re-hardcode the old blanket message. When the CALLER already knows the key's provenance it must DECLARE it instead of letting the probe re-run the resolver: `AppConfig.apiKeySource` (`'request'` = browser-sent with the run, `'options'` = web-Options live override, else a resolver tier) makes the 401 preflight blame the key ACTUALLY used — re-resolving at error time misattributes whenever the run carried its own key (the documented web foot-gun). Diagnose mismatches by comparing `checkOpenRouterReachable` against a raw `curl https://openrouter.ai/api/v1/auth/key` — same endpoint, so curl-200 + huu-401 means key MISMATCH, not a bad key.

### Web UI key flow: per-tab session key + ⚙ Options persistence

Two surfaces (user-authorized policy change 2026-07-03 — this SUPERSEDES the old "browser-only, never disk" rule):

- **Launch form (per-tab, unchanged):** validate first (`POST /api/keys/validate` → `validateKeyValue` in `api-data.ts`: openrouter→`checkOpenRouterReachable`, azureApiKey→`checkAzureReachable`, else `unverifiable`; `invalid` is refused), keep the value only in `sessionStorage('huu.key.<spec>')`, send it as `apiKey` with each `POST /api/run`.
- **⚙ Settings → OpenRouter API key (persists):** validate, then `POST /api/keys` — writes the disk store via `saveApiKey` AND arms `WebRunManager.setWebKey` (live in-session override). The override exists because the Docker secret mount is a startup SNAPSHOT: a disk save alone would stay outranked by the stale mount until restart. `GET /api/keys/status?name=` reports the effective source (`options|stored|secret-mount|env-file|env|none`) + `maskKey`'d value (never the raw key — pinned by a `server.test.ts` regression); `DELETE /api/keys?name=` clears store + override and names the fallback tier.

Run-key precedence is the exported+tested `pickRunKey(requestKey, webOptionsKey, spec)` in `run-manager.ts`: request > options > resolver. The winner travels as `AppConfig.apiKeySource` so the 401 hint blames the right key. `BackendInfo.apiKeySpecName` (from `bundle.apiKeySpecName`) lets the browser look up its per-backend session key. Every validate/save/clear and each run's (masked) key source is mirrored to the serve terminal (`web/terminal-log.ts`).

### Models

- Thinking-capable detection is a modelId-prefix heuristic (anthropic/claude*, deepseek/deepseek-r1*, openai/o1*, google/gemini-2.5*, z-ai/glm-z1*) — extend the list when a new reasoning family appears, don't special-case call sites.
- `recommended-models.json` (repo root) is the curated default catalog shown in the selector; recents persist to `~/.huu/recents.json`. The **default model** is `DEFAULT_MODEL_ID` (`src/models/catalog.ts`, currently `deepseek/deepseek-v4-flash`) — kept in sync with the FIRST entry of BOTH `recommended-models.json` and the in-code `DEFAULT_RECOMMENDED_MODELS` fallback; the TUI leads the recommended list with it and the web client preselects it (the web's live catalog is sorted alphabetically, so `models[0]` is NOT a curated default — `app.js` mirrors the id as a `const` and prefers it). GOTCHA: `loadRecommendedModels` SWALLOWS any zod parse error and silently returns the in-code fallback, so ONE out-of-enum `tier`/`bestFor` value drops the WHOLE file (this once stranded the documented `planning` models, making the real default silently `minimax/minimax-m2.7`). `tier`/`bestFor` are cosmetic-only — adding a new value REQUIRES extending `ModelTierSchema`/`ModelUseCaseSchema` first; `catalog.test.ts` now fails if the shipped file ever stops parsing.
- **Web picker — FULL live OpenRouter catalog (public, no key needed).** `GET /api/models` → `listModelsForBackend` (`web/api-data.ts`) returns, for `pi`, the ENTIRE live catalog (`listAllModels` / `projectAllModels` in `lib/openrouter.ts`, 339 today) — NO capability filter; each model is annotated `supportsTools`/`supportsReasoning` so the picker BADGES (`reasoning`, soft `no tools`) instead of hiding. OpenRouter's `GET /api/v1/models` is PUBLIC, so the catalog loads WITH OR WITHOUT a key: `buildAuthHeaders` omits `Authorization` when no key is held (an empty `Bearer ` 401s) and sends `Bearer <key>` when present; `fetchModelCapabilities`/`listAllModels` default `apiKey=''`. A validated key is forwarded via the `x-huu-key` header for the per-account view but is NEVER required to list; the static recommended list is only a network-failure fallback. Keep tests hermetic by intercepting the `openrouter.ai` URL, NOT by a key gate — `server.test.ts` wraps `globalThis.fetch` to passthrough localhost + canned-respond openrouter.ai (it uses real fetch to reach its own server). `filterToolReasoningModels`/`listToolReasoningModels` are KEPT (tested) for callers wanting only the dual-capable subset. The web picker is vanilla JS (`web/client/app.js`), NOT the Ink `ModelSelectorOverlay` / `model-selector-ink` table — confirm web vs TUI before changing "the model selector".
- The stage-integration/conflict agent uses the SAME model as the run — there is no per-step model override for it.

### Adding a backend — checklist

1. `backends/<kind>/factory.ts` implementing `AgentFactory` (+ conflict resolver or explicit `undefined`).
2. One-line append in `registry.ts` (kind union + `ALL_BACKENDS` + bundle).
3. Key spec in `api-key-registry.ts` if it needs auth.
4. Model catalog source in `src/lib/` (see `openrouter.ts` / `azure.ts` for the shape).
5. Selector, api-key screen and Docker env passthrough follow automatically from 2–3.

## References

- `src/orchestrator/backends/registry.ts`, `src/lib/api-key.ts`, `src/lib/api-key-registry.ts`, `docs/azure-backend.md` (pt-BR), `docs/pi-coding-agent.md`
- Related skills: working-on-orchestrator, running-in-docker (secret mounts)

> Facts verified against source on 2026-06-12; API-key source-awareness (`resolveApiKeyWithSource`/`keyRemedyHint`) + the web browser-only key flow verified and added 2026-06-25; resolver precedence inverted 2026-06-25 so the saved store now outranks the env var (`shadowsStored` → `storedOverridesEnv`); web picker de-gated 2026-06-26 — full PUBLIC catalog loads with or without a key (`listAllModels`, no filter), hermeticity now via `openrouter.ai` URL interception in `server.test.ts`; default-model convention (`DEFAULT_MODEL_ID` = `deepseek/deepseek-v4-flash`) + the silent-fallback / `planning`-enum repair added and verified 2026-06-26; web ⚙ Options key persistence (validate→save + live override, status/clear endpoints), `pickRunKey`/`AppConfig.apiKeySource` 401 attribution, `clearStoredApiKey`/`maskKey`, and `HUU_CONFIG_DIR` store override verified 2026-07-03 — supersedes the browser-only-key policy above.

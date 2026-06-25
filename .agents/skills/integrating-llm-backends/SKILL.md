---
name: integrating-llm-backends
description: Maps huu's agent-backend system — the registry kind→factory dispatch (pi, copilot, azure, stub), the BackendBundle contract, the 5-step API-key resolution chain, thinking-model detection and model catalogs. Use when changing LLM clients, adding or debugging a backend, fixing auth/key resolution, or touching model selection.
metadata:
  version: 0.1.0
  type: knowledge
---

# Integrating LLM Backends

## When to use

Work on `src/orchestrator/backends/**`, `src/lib/api-key*.ts`, `src/lib/llm-client-factory.ts` / `openrouter.ts` / `azure.ts`, model catalogs, or any "agent won't authenticate / wrong model" bug.

## Injected knowledge

### Registry is the single dispatch point

`src/orchestrator/backends/registry.ts:16` — `AgentBackendKind = 'pi' | 'copilot' | 'azure' | 'stub'`. The file's own doc comment is the extension contract: "Adding a new backend is a one-line case append here — cli.tsx and Orchestrator never need to learn about it." Kind names double as CLI flag values (`--backend=<kind>`) and `AppConfig.backend`; changing one means changing both intentionally.

Note: azure IS a real backend (`backends/azure/factory.ts`, `docs/azure-backend.md`) even though older docs listed only three kinds.

### BackendBundle contract (registry.ts:20-40)

- `agentFactory` — per-task agents.
- `conflictResolverFactory` — `undefined` for backends that can't reasonably resolve merge conflicts (stub): the orchestrator then fails loud on conflict instead of shipping a silent bad merge.
- `requiresApiKey` — stub returns `false`, which is what lets `--stub` smoke runs work without any key. If you add a keyless backend, this flag is the only thing the api-key prompt screen checks.
- `label` / `description` — feed the TUI backend selector directly; `ALL_BACKENDS` (registry.ts:18) drives what the selector lists.

### API-key resolution chain (`src/lib/api-key.ts:24-27`)

1. Secret mount: `/run/secrets/<name>` (Docker `--mount`, readonly)
2. Persisted store: `$XDG_CONFIG_HOME/huu/config.json` (fallback `~/.config/huu/config.json`) — an explicitly saved key, now ABOVE the env var
3. `<NAME>_FILE` env var pointing at a file (postgres-style `_FILE` convention)
4. Plain env var — the fallback when nothing is saved (CI / headless)
5. TUI prompt (which can persist to step 2)

Per-backend specs live in `src/lib/api-key-registry.ts` (envVar / envFileVar / secretMountPath per key). The Docker wrapper forwards every registry envVar/envFileVar into the container and mounts secret files — add a new key spec there and the wrapper picks it up without edits.

**Source-aware resolution (the inverted "valid key still 401s" trap).** `resolveApiKey` delegates to `resolveApiKeyWithSource(spec) → { value, source, storedOverridesEnv }`. `source` is which tier won (`secret-mount`/`stored`/`env-file`/`env`/`none`); the saved store now OUTRANKS the env var, so an explicitly saved key beats a stale `OPENROUTER_API_KEY` from a shell profile or a sourced `~/.secrets` (the old foot-gun, reversed). `storedOverridesEnv` is true when the saved key won AND a *different* non-empty env value is present — i.e. an ambient env var is being deliberately ignored. Build user-facing remediation with `keyRemedyHint(spec, res)` — it names the actual source (update the saved key when stored won; fix the env var / save one when env was the fallback). The orchestrator's 401 probe path and the docker-reexec host loop both use these; never re-hardcode the old blanket message. Diagnose mismatches by comparing `checkOpenRouterReachable` against a raw `curl https://openrouter.ai/api/v1/auth/key` — same endpoint, so curl-200 + huu-401 means key MISMATCH, not a bad key.

### Web UI key flow is browser-only (never disk)

`src/web/` does NOT use the TUI's save-to-disk path. The browser validates a pasted key first (`POST /api/keys/validate` → `validateKeyValue` in `api-data.ts`: openrouter→`checkOpenRouterReachable`, azureApiKey→`checkAzureReachable`, else `unverifiable`), keeps a `valid`/`unverifiable` value only in `sessionStorage('huu.key.<spec>')`, and sends it as `apiKey` in `POST /api/run`. `WebRunManager.start` prefers `params.apiKey` over `resolveApiKey` and NEVER calls `saveApiKey`. `BackendInfo.apiKeySpecName` (from `bundle.apiKeySpecName`) lets the browser look up its per-backend session key. The legacy disk-saving `POST /api/keys` endpoint stays for CLI reuse only.

### Models

- Thinking-capable detection is a modelId-prefix heuristic (anthropic/claude*, deepseek/deepseek-r1*, openai/o1*, google/gemini-2.5*, z-ai/glm-z1*) — extend the list when a new reasoning family appears, don't special-case call sites.
- `recommended-models.json` (repo root) is the default catalog shown in the selector; recents persist to `~/.huu/recents.json`.
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

> Facts verified against source on 2026-06-12; API-key source-awareness (`resolveApiKeyWithSource`/`keyRemedyHint`) + the web browser-only key flow verified and added 2026-06-25; resolver precedence inverted 2026-06-25 so the saved store now outranks the env var (`shadowsStored` → `storedOverridesEnv`).

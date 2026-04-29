---
name: llm-integration
description: >-
  Define OpenRouter model selection, Pi SDK usage, thinking/reasoning detection,
  and API key handling. Use when adding model support, debugging agent sessions,
  or modifying LLM integration. Do not use for pipeline structure or git
  operations.
---
# LLM Integration

## Goal

Document LLM integration via OpenRouter and Pi SDK, including model selection,
thinking/reasoning detection, and API key management.

## Boundaries

**Do:**
- Use `AgentFactory` as an abstract port — orchestrator does not know Pi SDK
- Resolve the OpenRouter API key through `lib/api-key.ts`'s `resolveOpenRouterApiKey()`. Precedence follows the postgres / mysql `_FILE` convention: `/run/secrets/openrouter_api_key` → `OPENROUTER_API_KEY_FILE` → `OPENROUTER_API_KEY` → empty (TUI prompt). The TUI seed in `app.tsx` and the real-agent factory both go through this single resolver.
- Select model via `ModelSelectorOverlay` (quick-pick + lazy-loaded table)
- Detect thinking/reasoning via `supportsThinking(modelId)` in `model-factory.ts`
- Use `recommended-models.json` as default catalog (fallback if file is missing)

**Do not:**
- Hardcode model IDs outside of `recommended-models.json` or `model-factory.ts`
- Access Pi SDK outside of `real-agent.ts`
- Read `process.env.OPENROUTER_API_KEY` directly in new code — always go through `resolveOpenRouterApiKey()` so the file-based and Docker-secret paths keep working.
- Persist the API key to any filesystem location the operator did not explicitly opt into. The `_FILE` paths the resolver accepts are caller-controlled; the only auto-created path is the temp file the auto-Docker wrapper writes under `/dev/shm` (tmpfs on Linux, never on disk) and unlinks on wrapper exit. See the `docker-runtime` skill.
- Assume every model supports thinking — verify via heuristic

## Workflow

### Model Selection
1. `models/catalog.ts` loads `recommended-models.json` (or hardcoded fallback)
2. `models/recents.ts` persists recents/favorites in `~/.huu/recents.json`
3. `ModelSelectorOverlay` offers quick-pick (recents + favorites + recommended)
4. Full table lazy-loaded via `model-selector-ink` ("More models...")

### Real Agent Factory (`real-agent.ts`)
1. Validates `apiKey` and `modelId`
2. Resolves thinking level via `supportsThinking()`
3. Creates Pi SDK session: `createAgentSession({ auth, model, thinking })`
4. Translates Pi events → `AgentEvent` (log, state_change, file_write, done, error)
5. Calls `session.prompt(message)` and waits for terminal state

### Stub Agent Factory (`stub-agent.ts`)
- For testing without a real LLM (`--stub`)
- Sleeps 2-5s, writes `STUB_*.md`, emits log events
- Useful for visually validating the flow

### Thinking Detection (`model-factory.ts`)
Heuristic based on modelId prefixes:
- Claude: `anthropic/claude`
- DeepSeek: `deepseek/deepseek-r1`, `deepseek-v3`
- OpenAI: `openai/o1`, `openai/o3`, `openai/o4`
- Gemini: `google/gemini-2.5`, `google/gemini-3`
- GLM: `z-ai/glm-z1`

### Interactive refinement (LangChain.js)

Steps with `interactive: true` open a multi-turn chat BEFORE the stage runs.
The chat is driven by `lib/langchain-client.ts` (LangChain.js `ChatOpenAI`
configured for OpenRouter via `baseURL: https://openrouter.ai/api/v1`). The
default model is `moonshotai/kimi-k2.6` and can be overridden per step via
`refinementModel`. The synthesized output replaces `step.prompt` for that
run only — the saved Pipeline is unchanged.

- API key: same `resolveOpenRouterApiKey()` path as the agent factory.
- Stub mode: `HUU_LANGCHAIN_STUB=1` OR `apiKey === 'stub'` returns a deterministic
  fake chat — no network. Auto-applied by `--stub` runs since the TUI passes
  `'stub'` as the apiKey.
- Reasoning: `kimi-k2.6` reasoning is OFF by default (extra tokens billed).
  Toggle via `createRefinementChat({ reasoning: true })`.
- The refinement chat does NOT spawn worktrees, agents, or git operations —
  it only converses with the user.
- Scope-aware synthesis: the refiner reads `step.scope` (or falls back to
  `files.length` for legacy flexible) to decide whether to emit a
  whole-project prompt (no `$file`) or a per-file template (must use `$file`).
  See `src/lib/refinement-prompts.ts` — both `buildRefinerSystemPrompt` and
  `buildSynthesisRequest` branch on the runtime mode.

## Gotchas

- `@mariozechner/pi-coding-agent` and `@mariozechner/pi-ai` use `latest` version.
- The model selector is global (recents in `~/.huu/recents.json`).
- The API key can be omitted when using `--stub`; otherwise, the TUI prompts for it.
- There is no per-step model override — a single model for the entire run.
- The integration agent (conflict resolution) uses the SAME model as the run.
- `openrouter.ts` caches model capabilities and API key validation.
- LangChain.js (`@langchain/openai`, `@langchain/core`) is used ONLY by the
  interactive-refinement path. Pi SDK still drives the coding agents — the two
  coexist without sharing any HTTP client.

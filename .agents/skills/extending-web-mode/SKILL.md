---
name: extending-web-mode
description: Procedure for huu --web changes — adding WebSocket message types with CLIENT_MSG_TYPES validation, wiring session handlers and the StateCoalescer, respecting the token-auth server and the Node-free ws-protocol rule, and placing webui React components in the right Atomic Design tier. Use when adding WS messages, web handlers, webui components, or debugging web/TUI behavior divergence.
metadata:
  version: 0.1.0
  type: task
---

# Extending Web Mode

## When to use

Changes under `src/web/` or `webui/`, new client↔server messages, web-side features mirroring TUI behavior, `--web` startup issues.

## Injected knowledge

### The protocol file is the contract (`src/web/ws-protocol.ts`)

- It must stay import-clean of Node.js APIs (its own header says so): the front-end imports it directly via the `@shared/*` alias (`webui/tsconfig.json:21` → `../src/web/*`). One `node:fs` import there breaks the webui build, not the server.
- Today: 13 `ServerMessage` types (`:56-69`), 18 `ClientMessage` types (`:73-91`). Runtime validation = membership in `CLIENT_MSG_TYPES` (`:95`) / `SERVER_MSG_TYPES` (`:116`) checked by `isClientMessage`/`isServerMessage` — a new union member WITHOUT its Set entry compiles fine and is then silently dropped at runtime. That asymmetry is the classic bug here.
- Domain types (Pipeline, OrchestratorState, Screen, FsmEvent…) are re-exported from ws-protocol so the front-end never imports Node-tainted files.

### Architecture facts

- `session.ts` is the side-effect layer mirroring `app.tsx`: one WebSession per connection drives the SAME pure FSM (`src/lib/screen-fsm.ts`). A transition added for the TUI usually needs its event handled here too, or web users get stuck where TUI users don't.
- `orchestrator-bridge.ts` (StateCoalescer) throttles state frames to 125 ms (~8 Hz, matching the TUI dashboard) and flushes immediately on terminal frames (done/error). Don't emit state directly from handlers — route through the coalescer.
- `server.ts`: binds 127.0.0.1, per-process UUID token required on every request and WS upgrade (`?t=`, timing-safe compare), 30s heartbeat / 10s grace / 5s close-grace, path-escape-proof static serving of `dist-static`.
- Phase-1 constraint: `--web` requires `--yolo` outside the container, enforced in `cli.tsx:20-33` BEFORE `decideReexec` so the error beats any docker pull. Moving that gate changes UX, not just plumbing.
- `src/web/` never imports `src/ui/` (Ink stays out of the server bundle).
- `webui/src` tiers: atoms ⊂ molecules ⊂ organisms ⊂ templates ⊂ pages — higher tiers import lower only. State flows through `useWsSession()` (WsContext accumulator) — components don't open sockets. Tailwind token `ai` (fuchsia) mirrors the TUI magenta rule.

## Procedure — adding a message end-to-end

1. Add the variant to `ClientMessage` or `ServerMessage` in `ws-protocol.ts` AND to the matching `*_MSG_TYPES` Set (the validator).
2. Server side: handle it in `session.ts` (dispatch FSM event, call a `handlers/*` function, or orchestrator action). Run-control messages follow the `run.setConcurrency` pattern.
3. Client side: send via `useWsSession()`; if the server replies with a new message type, extend the WsContext accumulator so the data lands in state.
4. Place new UI in the correct Atomic tier; AI-driven elements use the `ai` token.
5. Validate: root `npm run typecheck && npm test`, webui typecheck/build (`npm run build` covers it), then `./scripts/smoke-web.sh` (~5s, port-bind sanity). For interactive checks: `huu --web --yolo` (`HUU_WEB_NO_OPEN=1` skips browser auto-open).

## References

- `src/web/ws-protocol.ts`, `src/web/session.ts`, `src/web/server.ts`, `webui/src/lib/ws-context.tsx`, `docs/WEB-UI.md`
- Related skills: building-tui-screens (shared FSM), following-architecture-conventions, writing-tests

> Facts verified against source on 2026-06-12 (line refs from ws-protocol.ts as of today).

## <evolution>

After the task completes:

1. Only persist learnings if typecheck/tests/smoke passed and the change was accepted.
2. Keep only non-obvious, durable learnings: protocol pitfalls, session/FSM parity gaps, build-chain surprises. Skip the obvious and the volatile.
3. Append to the LEARNINGS.md of the skill that OWNS the domain (protocol/webui facts → here; FSM facts → building-tui-screens). Format: `- [YYYY-MM-DD][source:user|inference][task:<slug>][probation] <fact>` — user feedback outranks inference.
4. If LEARNINGS.md shows a stable repeated pattern, distill it into this SKILL.md body and bump `metadata.version`.
5. If a NEW knowledge area emerged, invoke meta-skill-evolution to propose a new skill.
6. Never merge skill changes yourself — leave them as an uncommitted git diff for human review.

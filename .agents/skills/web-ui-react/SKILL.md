---
name: web-ui-react
description: >-
  Define React + Vite + Tailwind component patterns for the `huu --web`
  browser front-end (`webui/`). Use when adding or modifying web UI
  pages/atoms/molecules/organisms/templates, wiring WebSocket events
  through `useWsSession()`, or extending the protocol consumed by the
  front-end. Do not use for Ink/TUI work, back-end server logic, or
  orchestrator changes.
---
# Web UI (React) — `huu --web`

## Goal

Documents the React component patterns used by the browser-based
front-end that mirrors the TUI 1:1 over a WebSocket session.

Files governed: `webui/**`.

## Boundaries

**Do:**
- Follow Atomic Design strictly: `atoms ⊂ molecules ⊂ organisms ⊂ templates ⊂ pages`. Higher tiers may import from lower tiers, never the reverse.
- Use the shared protocol types from `@shared/ws-protocol` (alias to `src/web/ws-protocol.ts`) — never duplicate them.
- Drive all server interaction through `useWsSession()` (provided by `src/lib/ws-context`). It exposes `send`, `status`, `state`, `modelCatalogs`, etc.
- Use Tailwind utility classes with tokens from `webui/src/lib/theme.ts`. The fuchsia `ai` color is reserved for AI-driven affordances (Pipeline Assistant, Smart Select, Project Recon) and must match the TUI's `theme.ai`.
- Keep components click-driven. Keyboard shortcuts may complement, but every action must be reachable by mouse.
- Functional components only, strict TypeScript, explicit prop types.
- Lazy-load heavy organisms (e.g., editors) with `React.lazy` when bundle impact is non-trivial.

**Don't:**
- Import anything from `src/ui/` (Ink-specific; would pull terminal-only deps into the browser bundle).
- Use `any` or non-null `!` assertions to silence the FSM Screen narrowing — derive props from the narrowed `screen.kind === '…'` branch in `Router.tsx`.
- Introduce new ad-hoc colors outside the theme tokens.
- Default-export components (named exports only, matching the TUI convention).
- Persist app state outside `useWsSession()` — the server's FSM is the source of truth; client state is for ephemeral input drafts and UI affordances only.

## Run dashboard specifics

- **CheckRunPill** (molecule) renders CheckStep judge runs on the run
  page, next to `IntegrationPill`: fuchsia `ai` while `judging` (it is
  an LLM agent), green outcome label when `fromJudge`, amber
  `DEFAULT: <label>` on fallback. Data comes from
  `state.checkRuns`; the derived type is
  `CheckRun = OrchestratorState['checkRuns'][number]` in
  `webui/src/lib/domain-types.ts` — extend that derivation, don't
  re-declare the shape.
- **AgentStatusPill** shows a `↻N` requeue badge (from
  `agent.requeues`) when the memory guard killed the agent and sent its
  task back to TODO.
- Concurrency messages: `{ type: 'run.setConcurrency', concurrency }`
  **pins manual mode server-side** (memory-aware auto-scale is the
  default); `{ type: 'run.setAutoScale', enabled }` toggles auto back
  on/off. Any new client message MUST also be added to
  `CLIENT_MSG_TYPES` in `src/web/ws-protocol.ts` or `isClientMessage()`
  rejects it with `BAD_MSG`.

## Cross-references

- Protocol: `src/web/ws-protocol.ts`.
- Server-side handlers: `src/web/handlers/`.
- FSM (shared with TUI): `src/lib/screen-fsm.ts`.
- Sibling skill for the TUI: `.agents/skills/ui-tui-ink/SKILL.md`.

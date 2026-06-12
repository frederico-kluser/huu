---
name: building-tui-screens
description: Procedure and conventions for Ink TUI work in huu — screen-fsm states, app.tsx routing, the theme token rules (theme.ai magenta strictly for AI-driven UI), the cardHeight() budget sync, FULL_CLEAR resize handling and useInput ref-stability. Use when adding or altering screens, Ink components, keyboard behavior or colors in src/ui/ and app.tsx.
metadata:
  version: 0.1.0
  type: task
---

# Building TUI Screens

## When to use

New screens/components in `src/ui/`, keyboard/navigation changes in `app.tsx`, kanban/dashboard tweaks, color decisions.

## Injected knowledge

### Routing is a pure FSM (`src/lib/screen-fsm.ts`)

- `Screen` is a discriminated union of 15 kinds (welcome, faq, pipeline-assistant, pipeline-editor, pipeline-import, pipeline-import-custom, pipeline-import-paste, pipeline-export, saved-pipelines, backend-selector, model-selector, api-key, timeout-prompt, run, summary), some carrying payloads (`model-selector` carries backendKind; `run` carries modelId+apiKey).
- The reducer is PURE — no I/O. `app.tsx` (TUI) and `src/web/session.ts` (web) both drive it: they resolve I/O (backend selection, key lookup) and dispatch events with resolved payloads. Keep new transitions in the reducer and their side effects in the callers, or the web session silently diverges from the TUI.

### Theme (`src/ui/theme.ts` — 8 tokens, `as const`)

`ai: magenta`, `aiAccent: magentaBright`, `border: cyan`, `cursor: cyan`, `success: green`, `warning: yellow`, `error: red`, `info: blue`.

`theme.ai` is reserved for AI-driven UI (Smart Select, Pipeline Assistant, Project Recon, agent activity) so users can tell at a glance "an LLM did this". Non-AI components use `theme.info` or cyanBright for purple-ish needs. Documented exception: the `conflict_resolving` kanban card is magenta because conflict resolution IS an LLM agent. The same rule maps to fuchsia in the web UI.

### Rendering gotchas (each one is a past bug)

- `cardHeight()` in `RunKanban.tsx` budgets rows per card (title + subtitle + meta + error + log + borders). Any row you add to the rendered card must be added to the budget, or columns silently overflow `maxCardRows`. `packCards()` then slices to fit and anchors on the focused/most-recent card.
- `RunKanban` is memoized so the ~1Hz SystemMetricsBar tick doesn't redraw the board — keep new props referentially stable.
- `useInput` handlers are wrapped in `useCallback` with REF-mirrored state (`screenKindRef`, etc.): the metrics tick re-renders App every second, and a handler re-created from stale closures drops keystrokes. Gate handlers with `isActive` per screen.
- `FULL_CLEAR = '\x1b[3J'` is prepended before re-renders to clear scrollback — without it, shrinking the terminal leaves wrapped-line artifacts. `useTerminalResize` also polls dimensions at 500ms as a fallback.

## Procedure

1. Add the screen kind (+ payload) to the `Screen` union and its transitions to `reduce()` in `screen-fsm.ts`. Check whether `src/web/session.ts` needs the same event wired (usually yes — shared FSM).
2. Create the component in `src/ui/components/` (PascalCase file, named export, theme tokens only — no raw color strings).
3. Render-branch it in `app.tsx`; wire `useInput` with `isActive` gating and ref-stable state.
4. Update `docs/KEYBOARD.md` if shortcuts changed; respect existing welcome-screen bindings (Q quit, ? FAQ, A assistant, N new, I import, M saved, ↑↓/ENTER/1-9).
5. If the screen shows run state, read it from `OrchestratorState` snapshots (including `checkRuns` for judge cards) — never reach into orchestrator internals.
6. Tests colocated; `npm run typecheck && npm test`.

## References

- `src/lib/screen-fsm.ts`, `src/app.tsx`, `src/ui/theme.ts`, `src/ui/components/RunKanban.tsx`, `docs/KEYBOARD.md`
- Related skills: following-architecture-conventions, extending-web-mode (FSM/state shared with web), writing-tests

> Facts verified against source on 2026-06-12.

## <evolution>

After the task completes:

1. Only persist learnings if typecheck/tests passed and the UI change was accepted.
2. Keep only non-obvious, durable learnings: rendering gotchas, focus/keyboard traps, theme decisions. Skip the obvious and the volatile.
3. Append to the LEARNINGS.md of the skill that OWNS the domain (Ink/TUI facts → here; FSM/web parity issues → extending-web-mode too). Format: `- [YYYY-MM-DD][source:user|inference][task:<slug>][probation] <fact>` — user feedback outranks inference.
4. If LEARNINGS.md shows a stable repeated pattern, distill it into this SKILL.md body and bump `metadata.version`.
5. If a NEW knowledge area emerged, invoke meta-skill-evolution to propose a new skill.
6. Never merge skill changes yourself — leave them as an uncommitted git diff for human review.

---
name: building-tui-screens
description: Procedure and conventions for Ink TUI work in huu — screen-fsm states, app.tsx routing, the theme token rules (theme.ai magenta strictly for AI-driven UI), the cardHeight() budget sync, FULL_CLEAR resize handling and useInput ref-stability. Use when adding or altering screens, Ink components, keyboard behavior or colors in src/ui/ and app.tsx.
metadata:
  version: 0.3.0
  type: task
---

# Building TUI Screens

## When to use

New screens/components in `src/ui/`, keyboard/navigation changes in `app.tsx`, kanban/dashboard tweaks, color decisions.

## Injected knowledge

### Routing is a pure FSM (`src/lib/screen-fsm.ts`)

- `Screen` is a discriminated union of 16 kinds (welcome, faq, pipeline-assistant, pipeline-editor, pipeline-import, pipeline-import-custom, pipeline-import-paste, pipeline-export, saved-pipelines, options, backend-selector, model-selector, api-key, timeout-prompt, run, summary), some carrying payloads (`model-selector` carries backendKind; `run` carries modelId+apiKey; `options` carries an optional `focusSpecName`).
- The reducer is PURE — no I/O. `app.tsx` drives it: it resolves I/O (backend selection, key lookup) and dispatches events with resolved payloads. Keep new transitions in the reducer and their side effects in the callers.

### Theme (`src/ui/theme.ts` — 8 tokens, `as const`)

`ai: magenta`, `aiAccent: magentaBright`, `border: cyan`, `cursor: cyan`, `success: green`, `warning: yellow`, `error: red`, `info: blue`.

`theme.ai` is reserved for AI-driven UI (Smart Select, Pipeline Assistant, Project Recon, agent activity) so users can tell at a glance "an LLM did this". Non-AI components use `theme.info` or cyanBright for purple-ish needs. Documented exception: the `conflict_resolving` kanban card is magenta because conflict resolution IS an LLM agent.

### Rendering gotchas (each one is a past bug)

- `cardHeight()` in `RunKanban.tsx` budgets rows per card (title + subtitle + meta + error + log + borders). Any row you add to the rendered card must be added to the budget, or columns silently overflow `maxCardRows`. `packCards()` then slices to fit and anchors on the focused/most-recent card.
- `RunKanban` is memoized so the ~1Hz SystemMetricsBar tick doesn't redraw the board — keep new props referentially stable.
- `useInput` handlers are wrapped in `useCallback` with REF-mirrored state (`screenKindRef`, etc.): the metrics tick re-renders App every second, and a handler re-created from stale closures drops keystrokes. Gate handlers with `isActive` per screen.
- `FULL_CLEAR = '\x1b[3J'` is prepended before re-renders to clear scrollback — without it, shrinking the terminal leaves wrapped-line artifacts. `useTerminalResize` also polls dimensions at 500ms as a fallback.

### Interactive retry on the run dashboard (`awaiting_retry`)

When a single run ends with failed cards it holds open in `awaiting_retry` (see working-on-orchestrator); `RunDashboard` sets `interactiveRetry:true` (MultiRunDashboard does NOT — it has no per-card focus, so multi-run TUI never holds open; the web covers multi-run retry). Keys: `R` retries the focused error card (a `errorKind==='timeout'` card opens a NEW-timeout overlay first; any other error calls `orch.retryTask(id)` immediately), `D` → `orch.finish()`, both gated on `state.status==='awaiting_retry'`. The new-timeout overlay REUSES `TimeoutPrompt` (not a screen-fsm kind — the run screen owns the live Orchestrator): a `retryAgentId` state + an early-return render branch like the existing `modalOpen && focusedAgent` branch. CRITICAL input trap: RunDashboard's `useInput` AND the overlay's own `useInput` are both registered at once (hooks run before the early return), so the handler MUST gate at the top — `if (modalOpenRef.current || retryAgentIdRef.current !== null) return;` (mirror EVERY new overlay into that ref-gated guard or it double-processes ENTER/ESC). `manualRetries` renders as a `⟳N` badge folded into the card TITLE in RunKanban — NOT a new row, so zero `cardHeight()` change (same trick as the `↻N` requeue badge). `errorKind==='timeout'` was ALREADY rendered as amber `TIMEOUT` (RunKanban) — only the retry affordance was new.

### Multi-run dashboard (concurrent projects)

`MultiRunDashboard` (`src/ui/components/MultiRunDashboard.tsx`) runs N pipelines CONCURRENTLY as subordinates of ONE `GlobalScheduler` (shared RAM/concurrency budget — see working-on-orchestrator) and renders a project switcher (`Tab` / `1`-`9` / `←→`). It is a SEPARATE component — the single-run `RunDashboard` is untouched — that reuses the presentational `RunKanban` + `LogArea`. Deliberately leaner than RunDashboard: no per-card modal/focus and no per-run `+`/`-`/`A`/`M`, because concurrency is scheduler-owned (showing the per-run `grant` instead). It mirrors RunDashboard's throttled-subscribe (generalized to an array of states) + terminal-sizing patterns; keep them in sync. Launch path: the `saved-pipelines` screen multi-selects with `SPACE` → `saved.selectMany` sets `FsmState.pipelines` (a `Pipeline[]` batch, NOT a new screen kind) → the SHARED backend/model/timeout flow (app.tsx forces `skipModelSelector:false` when `isMulti`) → the `run` screen renders MultiRunDashboard when `pipelines.length >= 2`, else RunDashboard. `FsmState.pipelines` is CLEARED in every single-pipeline transition so a later single run is never misread as multi; `Q` maps to `run.abort`.

## Procedure

1. Add the screen kind (+ payload) to the `Screen` union and its transitions to `reduce()` in `screen-fsm.ts`.
2. Create the component in `src/ui/components/` (PascalCase file, named export, theme tokens only — no raw color strings).
3. Render-branch it in `app.tsx`; wire `useInput` with `isActive` gating and ref-stable state.
4. Update `docs/KEYBOARD.md` if shortcuts changed; respect existing welcome-screen bindings (Q quit, ? FAQ, A assistant, N new, I import, M saved, ↑↓/ENTER/1-9).
5. If the screen shows run state, read it from `OrchestratorState` snapshots (including `checkRuns` for judge cards) — never reach into orchestrator internals.
6. Tests colocated; `npm run typecheck && npm test`.

## References

- `src/lib/screen-fsm.ts`, `src/app.tsx`, `src/ui/theme.ts`, `src/ui/components/RunKanban.tsx`, `docs/KEYBOARD.md`
- Related skills: following-architecture-conventions, writing-tests

> Facts verified against source on 2026-06-12; MultiRunDashboard (concurrent-projects TUI + saved-pipelines multi-select) added + verified 2026-06-26; interactive-retry overlay (`R`/`D` keys, TimeoutPrompt reuse, `manualRetries` badge) added + promoted from `[task:timeout-error-retry]` 2026-06-29.

## <evolution>

After the task completes:

1. Only persist learnings if typecheck/tests passed and the UI change was accepted.
2. Keep only non-obvious, durable learnings: rendering gotchas, focus/keyboard traps, theme decisions. Skip the obvious and the volatile.
3. Append to the LEARNINGS.md of the skill that OWNS the domain (Ink/TUI and FSM facts → here). Format: `- [YYYY-MM-DD][source:user|inference][task:<slug>][probation] <fact>` — user feedback outranks inference.
4. If LEARNINGS.md shows a stable repeated pattern, distill it into this SKILL.md body and bump `metadata.version`.
5. If a NEW knowledge area emerged, invoke meta-skill-evolution to propose a new skill.
6. Never merge skill changes yourself — leave them as an uncommitted git diff for human review.

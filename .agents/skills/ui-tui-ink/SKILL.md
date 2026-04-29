---
name: ui-tui-ink
description: >-
  Define Ink (React for terminals) component patterns, screen routing, and
  keyboard handling. Use when adding or modifying TUI screens. Do not use for
  business logic, git operations, or non-terminal UI work.
---
# UI / TUI (Ink)

## Goal

Documents the React Ink component patterns used in the huu
terminal interface.

## Boundaries

**Do:**
- Use Ink's `Box`, `Text`, `useInput`, `useApp`, `useStdout`
- Use discriminated union `Screen` for routing between screens in `app.tsx`
- Functional components with typed return: `React.JSX.Element`
- Custom hooks in `ui/hooks/` (e.g., `useTerminalClear`)
- Adapters in `ui/adapters/` to transform domain types into UI types
- Lazy-load heavy components (e.g., `model-selector-ink` via `void import(...)`)

**Don't:**
- Place business logic (orchestration, git) directly in UI components
- Use `export default`
- Create screens without adding the corresponding `kind` to the `Screen` union in `app.tsx`
- Ignore cleanup of listeners/subscribers in `useEffect`
- Confuse "TUI screens" (this skill) with "non-TUI subcommands". `huu --help`, `huu init-docker`, `huu status`, and `huu prune` deliberately BYPASS the Ink render path — their CLIs live in `lib/{init-docker,status,prune}.ts` and dispatch in `cli.tsx` BEFORE `render(<App />)`. Adding a new non-TUI subcommand belongs in those files (and the `NON_TUI_SUBCOMMANDS` set in `cli.tsx`), not as a new `Screen`. See the `docker-runtime` skill.

## Workflow

### Adding a New Screen
1. Add `kind` to the `Screen` union in `app.tsx`
2. Create component in `ui/components/ScreenName.tsx`
3. Add conditional render block in `app.tsx`
4. Implement navigation via `useInput` or callbacks

### Main Components
- **PipelineEditor** — step list, add/delete/reorder (Shift+↑↓), rename, import/export
- **StepEditor** — edit a step (name, prompt, files); TAB cycle fields
- **FileMultiSelect** — interactive file tree; Space toggle, A select all, C clear, / filter
- **ModelSelectorOverlay** — quick-pick (recents + favorites + recommended) + lazy table view
- **ApiKeyPrompt** — API key input with mask (`*`)
- **RunDashboard** — KanbanBoard with agent cards; concurrency adjustment (`+`/`-`)
- **AgentDetailModal** — timeline, logs, agent modified files

### Keyboard Handling
- Ink's `useInput` for key capture
- Shortcuts documented in README (N new, I import, Q quit, G go, etc.)
- `isActive` option to avoid conflicts between listeners

## Gotchas

- The entire UI is in English (messages, labels, shortcuts), although the README and some comments are in Portuguese.
- `useTerminalClear` clears scrollback on mount/unmount to avoid ghost lines.
- `agent-card-adapter.ts` maps `AgentStatus` → `KanbanCardData` (columns: todo/doing/done).
- RunDashboard instantiates `Orchestrator` in `useMemo` and starts it in `useEffect`.
- There is no state management library — only React state + prop drilling.
- There are no error boundaries in React components — handler errors may crash the TUI.

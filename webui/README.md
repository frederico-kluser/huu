# huu webui

Front-end React workspace for `huu --web`. Built with Vite + Tailwind + shadcn/ui.

## Dev

From repo root: `npm install` (installs workspace), then `npm run dev -w webui`.

The Vite dev server proxies `/ws` to the back-end (configured at runtime when the back-end is up).

## Build

`npm run build:webui` from the repo root. Output goes to `src/web/dist-static/` and is served by the `huu --web` back-end.

## Atomic Design

- `atoms/`     — primitive UI: Button, Badge, Input, etc.
- `molecules/` — small composites: AgentPill, FileChip.
- `organisms/` — large composites: KanbanBoard, LogPanel.
- `templates/` — layouts: AppShell, FullscreenModal.
- `pages/`     — one per FSM screen.

Theme tokens mirror `src/ui/theme.ts`. The `ai` color (fuchsia) is reserved for AI-driven UI.

## Component map

### Atoms (`webui/src/atoms/`)

| Component       | Purpose                                                                   |
| --------------- | ------------------------------------------------------------------------- |
| `Button`        | Primary action. `variant`: primary/secondary/ghost/danger/ai · `size`: sm/md/lg · supports `loading`. |
| `IconButton`    | Square button with a single lucide icon. Requires `aria-label`.          |
| `Badge`         | Rounded-full label. `tone`: success/warning/error/info/ai/neutral.       |
| `Input`         | Labelled text input with prefix/suffix slots + error state.              |
| `Textarea`      | Multi-line input with auto-resize.                                       |
| `Select`        | Styled native `<select>`.                                                |
| `Spinner`       | CSS spinner. Sizes sm/md/lg, optional `ai` color.                        |
| `Tooltip`       | Pure CSS hover/focus tooltip (`role="tooltip"`).                         |
| `Kbd`           | Keyboard hint badge. Doc/accessibility only — UI is click-driven.        |
| `Toast` + `ToastHost` + `ToastProvider` + `useToast` | Stacked top-right notifications, auto-dismiss after 4s. |

### Molecules (`webui/src/molecules/`)

| Component           | Domain input                                                  |
| ------------------- | ------------------------------------------------------------- |
| `AgentStatusPill`   | `AgentStatus` — id, phase badge, elapsed, token counts.       |
| `TokenCounter`      | `{in,out,cacheRead?,cacheWrite?}` — `↓ 12k ↑ 4k (cache: 1k)`. |
| `FileChip`          | `path` — removable file pill.                                 |
| `StepRow`           | `PromptStep` — name, prompt preview, files, reorder/edit/remove. |
| `LogLine`           | `LogEntry` — monospace `time [agent] message`.                |
| `BackendCard`       | `AgentBackendKind` — big clickable backend chooser.           |
| `ModelCard`         | `ModelCatalogEntry` — id, provider, pricing.                  |
| `PipelineCard`      | `PipelineEntry` — name, step/file count, source.              |
| `ConcurrencyControl`| `value`, `min`, `max` — `[−] N [+]` stepper.                  |
| `CostDisplay`       | `usd`, `budget?` — `$0.42 / $1.00` + progress bar.            |

### Organisms (`webui/src/organisms/`)

| Component           | Purpose                                                       |
| ------------------- | ------------------------------------------------------------- |
| `KanbanBoard`       | Columns per agent phase, horizontal scroll on mobile.         |
| `LogPanel`          | Auto-scroll log viewer, last 500 lines, pause on scroll-up.   |
| `StepEditor`        | Add/remove/reorder steps + edit prompt/files/model.           |
| `FileMultiSelect`   | Checkbox tree, search box, AI-color **Smart Select** button.  |
| `ModelSelectorList` | Filterable, provider-grouped model list.                      |
| `PipelineList`      | Responsive grid of `PipelineCard`.                            |
| `AssistantChat`     | AI-color chat panel for Pipeline Assistant.                   |
| `Header`            | Logo, version badge, connection status, theme toggle.         |
| `Sidebar`           | Click-driven left nav, hamburger drawer on mobile.            |

### Templates (`webui/src/templates/`)

| Component           | Purpose                                                       |
| ------------------- | ------------------------------------------------------------- |
| `AppShell`          | Header on top, Sidebar on left (md+), content area.           |
| `SplitPanel`        | Side-by-side left/right above `md`, stacked below.            |
| `FullscreenModal`   | Centered overlay with backdrop, close button, Esc handler.    |

### Library (`webui/src/lib/`)

| Module              | Purpose                                                       |
| ------------------- | ------------------------------------------------------------- |
| `ws-client.ts`      | `WsClient` (reconnect + queue) + `deriveWsUrl()`.             |
| `use-ws.ts`         | React hook around `WsClient`; accumulates `state` / `screen`. |
| `use-theme.ts`      | Toggles `<html class="dark">`, persists to `localStorage`.    |
| `cn.ts`             | `clsx` + `tailwind-merge` helper.                             |
| `theme.ts`          | Theme tokens mirroring `src/ui/theme.ts`.                     |
| `domain-types.ts`   | Aliases for nested protocol types (`AgentStatus`, `LogEntry`, …). |

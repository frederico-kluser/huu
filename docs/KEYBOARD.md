# Keyboard reference

The entire TUI is in English (the pipeline assistant is currently in
Portuguese, matching the recon prompts). Below is the complete map.

## Welcome

- `A` open the **pipeline assistant** (guided conversational authoring; runs a four-agent project recon first)
- `N` new pipeline (empty editor)
- `I` import from list (`./pipelines/*.pipeline.json`)
- `↑↓` highlight a pipeline from the discovered list · `ENTER` load it
- `1`–`9` jump straight to the Nth discovered pipeline
- `Q` quit

## Pipeline assistant

- Model picker is open first — same key map as the global model selector.
- On the intent screen: `ENTER` start the interview · `ESC` go back.
- During recon: `ESC` cancel and return to the intent screen.
- During an interview question: `1`–`9` select an option; the last option is always a free-text escape hatch.
- Free-text answer screen: `ENTER` submit · `ESC` cancel.
- Anywhere except `pick-model`: `ESC` opens a `Y/N` confirm-cancel prompt — `Y` exits to welcome, `N` (or `ESC`) returns.

## Pipeline editor

- `↑↓` select step · `SHIFT+↑↓` reorder · `ENTER` edit step
- `N` new step · `D` delete step · `R` rename pipeline
- `T` open timeouts/retries settings
- `I` import · `S` save (export)
- `G` go (run pipeline) when every step is valid
- `ESC` back

## Step editor

- `↑↓` select field · `TAB` cycle (Name / Prompt / Scope / Files / Model)
- The active field is marked by a `›` indicator on the left.
- `ENTER` start editing the active field · `ENTER` again to confirm and move on
- On the **Scope** row: `ENTER` cycles `flexible` → `project` → `per-file`,
  or jump directly with `P` (project), `F` (per-file), `X` (flexible).
  - `project` — runs once on the whole project. The Files row is locked.
  - `per-file` — runs once per selected file. The Files row demands a
    selection; `ENTER` (and `F`) on Files opens the picker.
  - `flexible` — pick at edit time (legacy behavior).
- On the **Files** row:
  - `scope=flexible`: `F` open the picker · `W` use whole project · `ENTER`
    re-opens the picker once a choice has been made.
  - `scope=per-file`: `F` or `ENTER` open the picker. `W` is disabled.
  - `scope=project`: `F`/`W`/`ENTER` are no-ops — the selection is locked.
- On the **Model** row: `M` pick a model for this step · `C` clear and use the global default
- `ESC` exit editing
- Pressing `ESC` outside editing discards the in-progress step

## File picker

- `↑↓` navigate · `SPACE` toggle · `A` select all · `C` clear all
- `/` filter (smart-case substring)
- `r` regex-select across the whole tree
- `P` copy file selection from a previous step
- `ENTER` confirm (empty selection means whole-project)
- `ESC` cancel

## Run dashboard

- `+` / `-` adjust concurrency live (default `10`); manual changes
  automatically disable auto-scale until you re-enable with `A`
- `A` toggle resource-bound auto-scaling. When enabled, the header shows
  `AUTO <NORMAL|SCALING_UP|BACKING_OFF|COOLDOWN|DESTROYING>` plus live
  `CPU%`/`RAM%`. Also enabled at startup via `huu --auto-scale`.
- `↑↓←→` navigate cards · `ENTER` open card details
- `F` filter logs to a single agent (cycles through agents and back to "all")
- `Q` abort the run · press `Q` twice to force-exit the dashboard immediately

## Card details modal

- `↑↓` scroll · `ESC` / `ENTER` close

## Summary

- `ENTER` back to editor · `Q` quit

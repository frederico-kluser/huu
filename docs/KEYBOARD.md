# Keyboard reference

The entire TUI is in English. Below is the complete map.

## Welcome

- `N` new pipeline
- `I` import from list
- `Q` quit

## Pipeline editor

- `↑↓` select step · `SHIFT+↑↓` reorder · `ENTER` edit step
- `N` new step · `D` delete step · `R` rename pipeline
- `T` open timeouts/retries settings
- `I` import · `S` save (export)
- `G` go (run pipeline) when every step is valid
- `ESC` back

## Step editor

- `↑↓` select field · `TAB` cycle (Name / Prompt / Scope / Files / Model)
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

- `+` / `-` adjust concurrency live (default `10`)
- `↑↓←→` navigate cards · `ENTER` open card details
- `F` filter logs to a single agent (cycles through agents and back to "all")
- `Q` abort the run · press `Q` twice to force-exit the dashboard immediately

## Card details modal

- `↑↓` scroll · `ESC` / `ENTER` close

## Summary

- `ENTER` back to editor · `Q` quit

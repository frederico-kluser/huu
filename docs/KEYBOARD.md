# Keyboard reference

The entire TUI is in English (the pipeline assistant is currently in
Portuguese, matching the recon prompts). Below is the complete map.

## Welcome

- `A` open the **pipeline assistant** (guided conversational authoring; runs a four-agent project recon first)
- `N` new pipeline — opens the **pattern picker** first (Discover → Act, Per-file transform, Audit with judge, Blank); `↑↓` choose · `ENTER` scaffold · `ESC` back
- `I` import from list (`./pipelines/*.pipeline.json`)
- `M` saved pipelines
- `O` open **Options** — edit AI provider API keys (also opens automatically when a run aborts on an invalid key)
- `↑↓` highlight a pipeline from the discovered list · `ENTER` load it
- `0`–`9` jump straight to the labelled pipeline; `[0]` is the pinned **default** (unit-test suite), shown first and colored distinctly
- `Q` quit

## Options

- `↑↓` select a provider · `ENTER` edit its key (masked input) · `ENTER` save · `ESC` cancel/back
- Keys are persisted to the global config (`~/.config/huu/config.json`, mode 0600)

## Pipeline assistant

- Model picker is open first — same key map as the global model selector.
  The chosen model runs the interview AND the **Architect flow** (3 parallel
  blueprint sketches under different lenses → generative selection against a
  mechanical rubric → per-step prompts written in parallel → real schema +
  topology validation, one guided fix at most). Planning is maximum
  leverage — `planning`-tier models (deepseek-v4-pro, kimi-k2.6, gpt-5.4,
  claude-opus-4.6) are suggested on screen.
- After the interview finalizes, the Architect phases stream live; the
  finished pipeline lands in the editor as usual. `ESC` cancels.
- On the intent screen: `ENTER` start the interview · `ESC` go back.
- During recon: `ESC` cancel and return to the intent screen.
- During an interview question: `1`–`9` select an option; the last option is always a free-text escape hatch.
- Free-text answer screen: `ENTER` submit · `ESC` cancel.
- Anywhere except `pick-model`: `ESC` opens a `Y/N` confirm-cancel prompt — `Y` exits to welcome, `N` (or `ESC`) returns.

## Pipeline editor

- `↑↓` select step · `SHIFT+↑↓` reorder · `ENTER` edit step
- `N` new **work** step · `C` new **check** step (LLM-judged decision node)
- `D` delete step · `R` rename pipeline
- `T` open timeouts/retries settings
- `I` import · `S` save (export)
- `G` go (run pipeline) when every step is valid
- `ESC` back

## Check step editor (conditional routing)

- `↑↓` select field · `ENTER` start editing the active field
- Fields: **Name**, **Condition** (NL — supports `$runs` token), **MaxRuns**, **Outcomes**, **Feasibility**
- **Outcomes** subform:
  - `A` add outcome · `D` delete · `S` set as default
  - `L` edit label · `N` edit `nextStepName`
  - `C` cycle `nextStepName` through existing step names
- **Feasibility** row: `ENTER` runs the setup-time LLM analysis (`analyzeCheckFeasibility`) and surfaces an `instructionDraft` hint for the runtime judge.
- `ESC` exit editing · `S` save check step

## Step editor

- `↑↓` select field · `TAB` cycle (Name / Prompt / Scope / Files / Model)
- The active field is marked by a `›` indicator; a single footer line always
  shows the keys for the focused field.
- `ENTER` start editing the active field · `ENTER` again to confirm and move on
- On the **Prompt** row: `ENTER` edit inline (single line) · `E` open the
  prompt in `$EDITOR` for multiline editing (git-commit pattern; set
  `EDITOR`/`VISUAL`).
- On the **Scope** row: `ENTER` opens a **scope list** with a one-line
  consequence per option, or jump directly with `P` (project), `F`
  (per-file), `X` (flexible), `M` (memory).
- On the **Deps** row: `ENTER` opens the **dependency picker** (SPACE
  toggles earlier steps · `D` default chain · `R` root). Declaring any
  dependency switches the run into deterministic parallel waves.
  - `project` — runs once on the whole project. The Files row is locked.
  - `per-file` — runs once per selected file. The Files row demands a
    selection; `ENTER` (and `F`) on Files opens the picker.
  - `memory` — runs once per file listed in a memory file an EARLIER step
    writes (`$file` + `$hint` in the prompt).
  - `flexible` — pick at edit time (legacy behavior).
- On the **Files** row:
  - `scope=flexible`: `F` open the picker · `W` use whole project · `ENTER`
    re-opens the picker once a choice has been made.
  - `scope=per-file`: `F` or `ENTER` open the picker. `W` is disabled.
  - `scope=project`: `F`/`W`/`ENTER` are no-ops — the selection is locked.
  - `scope=memory`: `ENTER` opens the **memory link picker** — choose a
    file an earlier step `produces`, pick an earlier step to produce it
    (huu wires both sides and appends the format contract to that step's
    prompt at run time), or type a custom path. `U` unlinks.
  - A step that `produces` a memory file shows `→ produces: <path>` here;
    `O` stops producing it.
- On the **Model** row: `M` pick a model for this step · `C` clear and use the global default
- `ESC` exit editing
- Pressing `ESC` outside editing saves the step when complete (cancels when incomplete)

## File picker

- `↑↓` navigate · `SPACE` toggle · `A` select all · `C` clear all
- `/` filter (smart-case substring)
- `r` regex-select across the whole tree
- `P` copy file selection from a previous step
- `ENTER` confirm (empty selection means whole-project)
- `ESC` cancel

## Run dashboard

- `+` / `-` adjust concurrency live **and pin manual mode**
  (memory-aware auto-scale is on by default); the always-on memory
  guard stays active in manual — the header swaps the `AUTO` chip for
  a `GUARD` chip with the kill count
- `A` toggle auto-scale back on. In auto mode the header shows
  `AUTO <NORMAL|SCALING_UP|BACKING_OFF|COOLDOWN|DESTROYING>` plus live
  `CPU%`/`RAM%`, the observed `~<N>MB/agent` footprint, and free
  memory. Pin manual at startup with `huu --concurrency=N` or
  `huu --no-auto-scale`.
- `M` toggle **MAX mode** (greedy): floods one agent per queued task
  (capped at the hard ceiling) and lets the always-on memory guard be the
  sole backstop — concurrency settles right at the RAM limit, the newest
  agent is killed and requeued to TODO whenever it's crossed. The header
  shows a blue `MAX <state>` chip with live `CPU%`/`RAM%` and the kill
  count. Cooldown-damped, so it never thrashes. Press `M` again (or `A`)
  to return to auto; `+`/`-` drops to manual.
- `↑↓←→` navigate cards · `ENTER` open card details
- `F` filter logs to a single agent (cycles through agents and back to "all")
- `Q` abort the run · press `Q` twice to force-exit the dashboard immediately

### Retry a failed task (`awaiting_retry`)

When a single-run pipeline finishes its steps but **left one or more task cards
in error**, the dashboard does **not** jump to the summary — it pauses in a
**`review (retry?)`** state (amber status, integration worktree kept alive) so
you can recover individual failures:

- `R` — retry the **focused** error card. A **timed-out** card (amber `TIMEOUT`)
  opens a small prompt for a **new time limit** before re-running; any other
  failure (red `FAILED`) re-runs immediately. The card re-runs against the
  current integration HEAD and, on success, its branch is merged in. A user
  retry shows as a `⟳N` badge on the card.
- `D` — **done**: leave the review hold and finalize the run (advances to the
  summary). `Q` instead aborts, discarding any remaining failures.

The multi-run dashboard does not offer per-card retry (it has no per-card
focus); the web UI does.

## Multi-run dashboard (concurrent projects)

Reached from **saved pipelines** (`M` on the welcome screen): check 2+ pipelines
with `SPACE`, then `ENTER` to run them **concurrently** under one shared
scheduler (they share ONE backend/model/key, chosen once).

- `Tab` / `1`–`9` / `←→` switch which project's board is shown
- `Q` abort all remaining projects and return (press `Q` twice to force)

Concurrency is **scheduler-controlled** across all projects — earlier projects
have priority, later ones backfill the idle slots, and the lowest-priority
project's newest agent is killed first under memory pressure — so the per-run
`+` / `-` / `A` / `M` concurrency keys are intentionally absent here.

## Card details modal

- `↑↓` scroll · `ESC` / `ENTER` close

## Summary

- `ENTER` back to editor · `Q` quit

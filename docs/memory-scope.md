# Memory scope — file fan-out decided by the pipeline itself

> One step **discovers** the work and writes it to a memory file; a later step
> **fans out** one agent per discovered path. No human file-picking anywhere.
>
> Português: [memory-scope.pt-BR.md](memory-scope.pt-BR.md) · Schema reference:
> [pipeline-json-guide.md](pipeline-json-guide.md) (section `"memory"`)

huu steps used to have two ways of receiving files: the whole project
(`scope: "project"`, `files: []`) or a human-picked list (`scope: "per-file"`).
The `memory` scope adds the third and most powerful one: **an earlier step
writes a `huu-memory-v1` JSON listing relative paths, and the consuming step
fans out over them at run time** — the pipeline decides its own work.

## The two sides of the contract

There is no special "producer step type". The contract has two halves,
configured in two different places, linked only by the file path:

| Side | Where it's configured | What you do |
|---|---|---|
| **Producer** (any earlier step) | In its **prompt** | Instruct the agent to write the memory file at an agreed path, in the exact format below |
| **Consumer** | In the **step fields** | `scope: "memory"` + `filesFrom: "<same path>"` (+ optional `maxFiles`) |

huu never checks that "someone promised to write the file" — it checks at
execution time: when the cursor reaches the consumer, it reads the file from
the **integration worktree** (the merged state of everything that ran before)
and spawns one agent per listed path.

## The memory file format (`huu-memory-v1`)

```json
{
  "_format": "huu-memory-v1",
  "files": [
    { "path": "src/lib/types.ts", "hint": "extract the step contract here", "priority": 10 },
    "src/cli.tsx"
  ]
}
```

- An entry is either a plain string (just the path) or an object:
  - `path` — relative to the repo root. Absolute paths and `..` are rejected.
  - `hint` (optional, ≤600 chars) — per-file context from the producer.
    It reaches the consumer's prompt through the **`$hint`** token.
  - `priority` (optional number) — execution order: priority descending,
    then list order.

## The consuming step

```json
{
  "name": "2. Fix $file",
  "prompt": "Fix the issue in $file. The scanner's note about this file: $hint",
  "files": [],
  "scope": "memory",
  "filesFrom": ".huu/scan-list.json",
  "maxFiles": 20
}
```

- `files` stays `[]` — the editor locks it when you choose the memory scope.
- `$file` is the path of the current task; `$hint` is that entry's hint
  (empty string when absent). `$hint` is substituted before `$file`.
- `maxFiles` (default **40**) caps the fan-out width: excess entries are
  dropped by priority order, with an explicit warning. Tell the producer the
  cap in its prompt so it doesn't over-list.
- A memory step can **never be the pipeline's first step** — nothing ran yet
  to write its file. The schema rejects it at load time.

## Execution semantics

1. The producer runs, commits, and its stage merges into the integration
   worktree — the memory file now exists in the merged state.
2. When the cursor reaches the memory step, huu reads `filesFrom` from the
   integration worktree, validates every entry, and decomposes into one task
   per surviving path.
3. The pool runs the agents in parallel (auto-scaled), each in its own git
   worktree, each with its `$file`/`$hint` substituted.
4. **Check loops re-read the file on every visit** — if a judge sends the
   pipeline back and some step rewrites the memory file, the next visit fans
   out over the new version. This is the backbone of discover → work →
   re-discover loops.

## Failure rules (deterministic by design)

| Situation | Behavior |
|---|---|
| Memory file **missing** | The step resolves to **zero tasks**: the stage completes empty with a loud warning and the run continues. Absence can be legitimate (the scanner found nothing; stub runs write no files). |
| File exists but is **corrupt** (invalid JSON, wrong `_format`, schema violation, or zero usable paths out of a non-empty list) | The **run fails immediately**. Corruption is never legitimate. |
| Entry escapes the repo (`..`, absolute), duplicates another, doesn't exist in the worktree, or matches the generated/vendored skip list (`node_modules/`, `dist/`, …) | Dropped individually, each with its own warning. |
| More usable entries than `maxFiles` | Truncated (priority desc, then list order) with a warning. |
| `config.files["<step name>"]` set in a headless run | The override **wins** and the memory file is not read (logged) — the escape hatch. |

## Configuring it in each interface

- **TUI** (`huu`): edit the step → **Scope** field → press **M** (or ENTER to
  cycle) → move to **Files** → ENTER opens a text input for the `filesFrom`
  path. The editor won't save a memory step without it.
- **Web UI** (`huu --web`): edit the step → **Scope** select → choose
  *memory* → a **Memory file (filesFrom)** input appears; the file picker is
  disabled (the pipeline picks, not you).
- **JSON**: the fields above; full schema in
  [pipeline-json-guide.md](pipeline-json-guide.md).
- **Pipeline Assistant**: ask for a discover-then-act flow ("scan the repo
  and fix every file you find") and it emits the producer/consumer pair.
- **Headless** (`huu auto`): nothing extra — the memory file is read at run
  time. `config.files` overrides per step if you need to force a list.

## A complete minimal pipeline

```json
{
  "_format": "huu-pipeline-v2",
  "pipeline": {
    "name": "scan-and-fix",
    "steps": [
      {
        "name": "1. Scan",
        "prompt": "Find files with leftover console.log calls. Write .huu/scan-list.json EXACTLY as huu-memory-v1: { \"_format\": \"huu-memory-v1\", \"files\": [ { \"path\": \"<relative path>\", \"hint\": \"<one line: where the problem is>\" } ] }. List at most 20 files; every entry MUST carry a hint.",
        "files": [],
        "scope": "project"
      },
      {
        "name": "2. Fix $file",
        "prompt": "Remove the leftover console.log calls from $file. The scanner's note: $hint",
        "files": [],
        "scope": "memory",
        "filesFrom": ".huu/scan-list.json",
        "maxFiles": 20
      }
    ]
  }
}
```

## Budget note

`maxNodeExecutions` (default 50) counts **cursor visits to steps, not
agents** — a memory fan-out of 25 files costs **one** visit. Chain as many
producer→memory pairs as the method needs; the real bound is LLM cost and
pool width, capped by `maxFiles`.

## Patterns

- **scan → fix** — auditor lists offending files with the offence as `hint`.
- **recon → study** — `huu Knowledge System` (bundled default) does exactly
  this: recon writes `study-list.json` with a per-file lead, the study step
  fans out over it, and later its dossiers fan out again into one
  skill-writer agent per topic. Read its source as the reference
  implementation: `src/lib/default-pipelines/huu-knowledge-system.ts`.
- **rank → refactor** — a hotspot ranking step lists the top-N files with
  the smell as `hint`; the refactor step works each one in parallel.

## Troubleshooting

- *Stage completed with 0 tasks* — the memory file wasn't in the integration
  worktree under the exact `filesFrom` path. Check the producer's prompt
  (path typo?) and that its stage actually committed the file.
- *Run failed with `memory file ... is not valid JSON / does not match
  huu-memory-v1`* — the producer wrote a malformed file; tighten its prompt
  (paste the exact format, as the example above does).
- *Fewer agents than listed entries* — read the run log warnings: dropped
  paths (nonexistent / skip-list / duplicates / escaping) and `maxFiles`
  truncation are each logged individually.

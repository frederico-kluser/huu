---
name: authoring-dev-graphs
description: Covers `huu-devgraph-v1` — the HAND-DRAWN method under src/lib/dev-graph/ that a human draws and a compiler turns into an ordinary huu-pipeline-v2. Explains the four node kinds, the block catalog, the deliberate schema/validator split (zod = SHAPE, validateGraph = product limits, never throws), the compiler that DOES throw, rework arms vs dependsOn, the fan-out contract at .huu/findings/, prompt-text neutralization, the store's atomic writes and reserved ids, and the three surfaces (web /api/graphs + canvas, TUI graph-picker, `huu dev --graph`). Use for ANY change under src/lib/dev-graph/, src/web/graph-api.ts, src/web/client/modules/graph/, ui/components/GraphScreen.tsx, or when a drawn method fails to compile, validate or run.
metadata:
  version: 0.1.0
  type: task
---

# Authoring Dev Graphs (`huu-devgraph-v1`)

## When to use

Anything under `src/lib/dev-graph/` (schema, types, validator, node catalog,
compiler, store, research contract/bridge), `src/web/graph-api.ts`,
`src/web/client/modules/graph/*`, `src/ui/components/GraphScreen.tsx`, or the
`--graph` half of `src/lib/dev-mode/dev-cli.ts` / `src/web/dev-manager.ts`.
Also: a drawing that will not open, will not compile, or ran the wrong method.

## Why the format exists

Dev mode hands the TOPOLOGY to an LLM planner. MANIFESTO says that is the one
decision the human must underwrite. A devgraph is the answer: the human draws
which blocks run, in which order, where a decision branches and where branches
rejoin; the agent supplies intelligence only INSIDE a node. Nothing in this
subtree lets a model invent a node, an edge or a route — hold that line.

## Injected knowledge

### The pieces, and who owns what

| module | owns |
| --- | --- |
| `graph-types.ts` | types + ALL caps + the `GraphIssueCode` union. Pure, no imports beyond types. |
| `graph-schema.ts` | zod. SHAPE only + DoS ceilings. `parseDevGraph`, `DEVGRAPH_FORMAT_TAG`. |
| `graph-validate.ts` | product rules. `validateGraph` → `{ ok, issues[] }`. NEVER throws. |
| `node-catalog.ts` | `ACTION_BLOCKS` (15 today: recon, implement, tdd, tests, refactor, docs, `*-review`, `*-findings`, custom…), `NODE_KINDS`, `methodologyOptions()`. |
| `graph-to-pipeline.ts` | `compileGraphPipeline` → `huu-pipeline-v2`. THROWS on an invalid graph. |
| `graph-store.ts` | `.huu/dev/graphs/<id>.json` — list/read/write/delete, atomic. |
| `research-contract.ts` / `research-bridge.ts` | `huu-research-v1` artifact, prompt + judge condition builders, `neutralizePromptText`. |

Node kinds: `prompt` (exactly one, the objective, the root — compiles to
NOTHING), `action` (→ one `WorkStep`), `research` (→ a `WorkStep` of kind
`info`, plus a `CheckStep` when it routes), `gate` (→ one `CheckStep`).

### The rules that are non-obvious

- **zod = SHAPE, validator = PRODUCT LIMITS, one owner per cap.** The schema's
  ceilings sit an order of magnitude above the product caps (40 nodes, 80-char
  labels, 4000-char goals — all in `graph-types.ts`, all enforced by
  `graph-validate.ts`). Reason: a parse error is a BLANK CANVAS and the human
  loses their drawing; an issue is a to-do they can fix on screen. Same rule
  sorts ids — a DECLARATION (graph/choice/outcome id) is strict in zod, a
  REFERENCE (node id, edge source/target, `fanOutFrom`, `join.subset.of`) is
  permissive there and checked by the validator.
- **`validateGraph` never throws; `compileGraphPipeline` always does.** The
  validator is called on every keystroke of a half-drawn graph, so it filters
  every list down to entries it understands and reports each discard
  (`malformed-node-entry`/`malformed-edge-entry`). The compiler refuses the
  first invalid graph instead, because a compiler that silently "repairs" a
  broken method runs a method nobody underwrote.
- **`GraphIssue.code` is the identity of a problem** — the UI maps it to a
  translated sentence. `message` is a developer-facing English fallback and may
  be reworded freely; **renaming a code is a breaking change to the front-end.**
- **Two edge layers over one drawing.** DEPENDENCY layer = every edge WITHOUT
  `rework` (`topoOrder`, `ancestorsOf`, `effectiveDependencies`; `cycle` is
  looked for here and nowhere else). ACTIVATION layer = every edge
  (reachability, `nextStepName`). That split is what lets a rework arm point
  backwards without being a cycle. It compiles to an `outcomes[].nextStepName`
  and to NOTHING in `dependsOn` — `validateTopology` requires dependencies to
  point backwards in the array, so a route back is legal exactly where a
  dependency back is not. Bound by the gate's `maxRuns`
  (`DEVGRAPH_REWORK_CHECK_MAX_RUNS`), with `Pipeline.maxNodeExecutions` as the
  run-wide backstop.
- **One edge per branch outcome** (`branch-outcome-multiple-edges`), because a
  `CheckStep` routes to ONE `nextStepName` per outcome. To parallelize after a
  decision, point the arm at one action node and let THAT node fan out.
- **Fan-out paths are load-bearing, not tidiness.** The `huu-memory-v1` list a
  producer writes goes to `.huu/findings/<session>/<node>.json` — by NODE
  (`validateTopology` rejects two steps with the same `produces`) and by
  SESSION (`resolveMemoryFiles` reads `filesFrom` out of the integration
  worktree with only an `existsSync`; a session-less path would dispatch
  today's fan-out onto yesterday's committed targets). It must live UNDER
  `.huu/findings/` and not under `graphRoot`, because the block prompts' one
  permitted gitignore edit (`.huu/*` + `!.huu/findings/`) re-includes exactly
  that path and would leave `graphRoot` ignored — a silent zero-task fan-out in
  precisely the repos that need the remedy. Task-spec markdown, separately,
  goes to `.huu/findings/<axis>/`, namespaced by AXIS, so a new scan over that
  tree reads PAST epochs.
- **Text that travels is neutralized; text that stays is not.** The `goal`
  (reaches every block template and critic brief) and a gate `condition`
  (pasted into a judge prompt whose enum and JSON contract are huu machinery)
  go through `neutralizePromptText`. A node's own `prompt` override does NOT —
  it IS that node's instruction, and mangling its fences buys nothing. `notes`
  never reach an agent. This is coherence, not a security boundary.
- **Reserved ids are refused on WRITE.** `catalog`, `compile`, `validate`,
  `from-sample` are legal slugs AND routes, so a graph so named could be saved
  and never read back. `GRAPH_RESERVED_SEGMENTS` makes it a 400 at creation
  time (`src/web/graph-api.ts`), rather than removing the route.
- **`writeGraph` is tmp + rename**, staged INSIDE the graphs directory (rename
  is only atomic within one filesystem). A bad `now` falls back to the clock
  instead of failing the write — here dropping the value costs one field of
  provenance while refusing costs the human their drawing. That trade is the
  OPPOSITE of the `graph`/`graphId` rule in `dev-manager`, where the fallback
  is the LLM planner: refuse, never shrug.
- **A drawn session is exactly ONE epoch** (`graph-conflict` on
  `maxEpochs > 1`). Audit every default that feeds `maxEpochs` when touching
  this — `DEV_DEFAULT_MAX_EPOCHS = 3` once made every `huu dev --graph` refuse.
- `subset` joins relax the `dependsOn` DEPENDENCY only. They do NOT remove
  huu's BSP merge barrier, and this compiler cannot express "skip the barrier".

### Three surfaces, one core

`src/web/graph-api.ts` (`handleGraphRequest` — the whole `/api/graphs` grammar
as a PURE function; `server.ts` only recognizes the prefix and parses the body)
· the browser canvas (`src/web/client/modules/graph/`, React Flow from
`client/vendor/`, DOM tests need `// @vitest-environment jsdom`) ·
`src/ui/components/GraphScreen.tsx` (a PICKER, not a canvas) · `huu dev
--graph=<id|path.json>` (a value with `/` or `.` is a PATH, a bare slug is a
saved id). All four go through the same `parseDevGraph` → `validateGraph` →
`compileGraphPipeline` chain — never add a second parser.

## Procedure

1. Read `graph-types.ts` first — caps and issue codes are declared there once.
2. Decide the layer: shape → `graph-schema.ts`; a rule a human should SEE →
   `graph-validate.ts` (add a `GraphIssueCode`, never reuse one loosely);
   emission → `graph-to-pipeline.ts`; a new block → `node-catalog.ts`.
3. Keep `graph-*.ts` PURE (no fs/env/clock) — the editor, the server, the CLI
   and the driver all import them. I/O belongs in `graph-store.ts`.
4. Test it: colocated `*.test.ts`. Guard every "for each" loop with an explicit
   non-vacuity assertion, and pin new compiler output against
   `PipelineSchema.safeParse` + `validateTopology`, not against a snapshot.
5. New block → add it to `ACTION_BLOCKS` and check `graph-samples.test.ts`
   ("uses only blocks that exist in the catalog today") and
   `graph-to-pipeline.test.ts` ("compiles EVERY catalog block without
   throwing") stay green.
6. `npm run typecheck && npm test` (`committing-and-validating`).

## References

- `src/lib/dev-graph/` (all modules above) · `src/web/graph-api.ts` ·
  `src/lib/dev-mode/dev-driver.ts` (`devGraphRoot`, `devGraphFanOutNamespace`,
  `scanSpecs`) · `src/lib/dev-mode/dev-cli.ts` (`--graph`).
- Related skills: `authoring-pipelines` (the compile TARGET), `running-dev-mode`
  (the session that runs a drawing), `building-web-ui` (canvas + API surface),
  `building-tui-screens` (GraphScreen), `writing-tests`,
  `following-architecture-conventions`.

> Facts verified against source on 2026-08-04.

## <evolution>

After the task completes:

1. Only persist learnings if the task passed its tests/criteria.
2. Keep only non-obvious, durable learnings: surprises, user corrections, discovered conventions, failed approaches. Skip the obvious and the volatile.
3. Append to the LEARNINGS.md of the skill that OWNS the domain. Format: `- [YYYY-MM-DD][source:user|inference][task:<slug>][probation] <fact>` — user feedback outranks inference.
4. SKILL.md bodies have one human writer per surface — never auto-distill LEARNINGS into the body.
5. If a NEW knowledge area emerged, invoke meta-skill-evolution to propose a new skill.
6. Never merge skill changes yourself — leave them as an uncommitted git diff for human review.

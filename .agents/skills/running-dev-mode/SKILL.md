---
name: running-dev-mode
description: Covers huu's development mode (src/lib/dev-mode/, `huu dev`, web `/dev`) — the one flow whose step graph is written at RUN TIME. Explains the TWO-RUN epoch (knowledge → plan → execution), the BLIND orchestrator that reads no file and gets a digest agents wrote, why gap specs must be real files committed BEFORE the run, the per-task generator→critic loop (`WorkStep.review`) with severity convergence and forward-default on every failure, per-role model routing (why `z-ai/glm-5.2` can only be the planner), session-namespaced blackboards with resume + orphan branches, the epoch-landing merge, and the MANIFESTO boundary that keeps the planner decomposing instead of inventing scope. Use for any change under src/lib/dev-mode/, src/lib/knowledge-detect.ts, src/lib/model-registry-check.ts, src/web/dev-manager.ts, the `huu dev` CLI, or when debugging a dev session that stalled, refused to start, or planned the wrong thing.
metadata:
  version: 0.2.0
  type: task
---

# Running Development Mode

## When to use

Any change to `src/lib/dev-mode/**`, `src/lib/knowledge-detect.ts`,
`src/lib/model-registry-check.ts`, `src/web/dev-manager.ts`, the `dev` branch
of `src/cli.tsx`, or `docs/dev-mode*.md`. Also for debugging: a session that
stops with `dirty-tree` / `landing-failed` / `empty-plan` /
`model-preflight-failed`, a plan whose fronts fight over the same files, an
epoch whose fan-out ran zero agents, or a card stuck in `reviewing`/`fixing`.

The per-task critic loop itself is orchestrator machinery — for the loop's
placement, locking and preemption see working-on-orchestrator; for `review` as
a schema field usable by ANY pipeline see authoring-pipelines and
`docs/pipeline-json-guide.md`.

## Injected knowledge

### The identity boundary (do not erode it)

`AGENTS.md` says huu is NOT a feature-building tool and that no LLM planner
invents scope. Dev mode lives inside that rule, not around it:

- The human underwrites the **goal** — verbatim in `.huu/dev/goal.md`, and
  every prompt says no agent may rewrite or reinterpret it.
- The human underwrites the **method** — the epoch shape is huu's and fixed
  (Phase A is a pipeline huu WROTE; Phase C is a fixed template: global recon
  → parallel fronts → consolidation → gate → seal). Neither
  `KnowledgeRequestSchema` nor `DevPlanSchema` carries `steps`, `dependsOn` or
  a file path: the model writes CONTENT, never STRUCTURE.
- Every path ends at a `CheckStep` with exactly one forward `default: true`.
- Autonomy is the user's call. `--autonomous` is the CLI default; the plan gate
  (`--approve-each`) is what makes the human sign the PLAN and not just the goal.

Say the costs out loud rather than hiding them — `docs/dev-mode.md` already
does, and docs must not drift from it. Three framings are load-bearing:
the leader **delegates** retrieval, it does not skip it (the knowledge phase IS
the retrieval); the model split is **not** a cost optimization (a fan-out costs
3–10× a single agent while the price gap is ~2× — the justification is context
isolation, parallelism, and a cross-vendor second opinion); the blind leader is
an **instrumented hypothesis**, not proven practice.

### An epoch is TWO runs, not one

The plan can only exist after the knowledge arrives, so `runDevMode`
(`dev-driver.ts`) drives three phases per epoch:

```
A. KNOWLEDGE  run #1 — a FIXED pipeline no model has a say over
   ① planKnowledge()  blind orchestrator → KnowledgeRequest {restatedGoal, gaps[], planningNotes}
   ② writeKnowledgeGaps()  huu, in TypeScript, writes one real .md per gap
                           + …/knowledge/index.json (huu-memory-v1) and COMMITS them
   ③ compileKnowledgePipeline() → K0 prepare · K1 answer (memory fan-out) · K2 consolidate
                                → …/knowledge/digest.md  (≤ 6000 chars)
   → landEpoch
B. PLAN       no run — planEpoch() reads goal + digest + history + evidence
              → compileEpochPipeline() → gate → persist epoch-N/pipeline.json
C. EXECUTION  run #2 — the planned pipeline; per-task review loop inside the swarm
   → landEpoch → collectEpochEvidence() → replan
```

**Zero gaps ⇒ Phase A is SKIPPED entirely** and the epoch is one run, exactly
as it always was. That is a decision the orchestrator is allowed to make, and
it is also what keeps a `--stub` session at one run per epoch.

### The orchestrator is BLIND — and the digest is the only exception

`planKnowledge`/`planEpoch` are structured-output calls through
`buildChatClient` → LangChain `ChatOpenAI` → OpenRouter. No tools, no file
reads, and **no repo digest**: the mechanically truncated file listing the old
planner got is gone. The only thing it ever learns about this repository is
`digest.md`, which AGENTS wrote from the code, with citations.

Two mechanisms keep it blind while still improving each epoch:

- **`BASELINE_GAPS`** (epoch 1) is the grounding floor — stack/entrypoints,
  build+test commands, where the goal lands, conventions surface. Treat them as
  production prompts: the first request is genuinely ungrounded, so anything
  the model adds on top of them will be generic.
- **`DELIVERED_VS_PLANNED_GAP`** (epochs ≥ 2) replaces the baseline: a `repo`
  gap asking an AGENT to compare promised vs delivered. The interpretation of
  the last epoch is written by something that can read the diff — the planner
  only ever sees the capped, structured `DevEpochEvidence` plus that answer,
  folded into the same digest.

`KnowledgeBriefSchema.unknowns` is REQUIRED while `facts`/`sources` default to
`[]`. The asymmetry is the point: an agent with nowhere to say "I couldn't
check this" writes confident filler, and a single plausible-but-wrong
distractor measurably degrades the reader. An honest gap beats an invented fact.

### Gap specs are real FILES, committed BEFORE the run

`resolveMemoryFiles` does not merely drop a listed path that does not exist —
when a non-empty list resolves to ZERO survivors it **THROWS**, and
`prepareStageTasks` turns that into `recordRunError`, killing the run. And it
resolves `filesFrom` out of the INTEGRATION worktree, which branches from HEAD.

So: huu writes the gap specs and the memory index itself, in TypeScript, from
one list (`writeKnowledgeGaps`), and `persist()` commits them BEFORE the
knowledge run starts. An LLM asked to write both can miss the contract a dozen
ordinary ways; an uncommitted spec simply does not exist where the fan-out
looks. Same reason Phase C's task specs are real markdown files written by each
front's recon.

**Why the knowledge pipeline has a K0 that looks redundant:**
`validateTopology` rejects a `memory`-scope step at index 0 (no earlier step
could have written its memory file) — it cannot tell that huu wrote and
committed the index. So K0 exists anyway, and it takes the one job the run
genuinely needs first: the PERSISTENCE CHECK. In a repo whose `.gitignore`
excludes `.huu/`, every brief would be silently dropped from its agent's
commit — merging nothing, consolidating nothing, and planning the next epoch
on an empty file with no error to show for it.

There is deliberately **no CheckStep in Phase A**: `readKnowledgeDigest` falls
back to the raw brief shards for free, so every path out of Phase A is forward.

### The per-task generator → critic loop

Phase C stamps `review` onto each front's implement step (`buildReviewSpec` in
`plan-to-pipeline.ts`). What matters when changing dev mode:

- **Convergence is mechanical and by SEVERITY.** The loop repeats while any
  finding's severity is in `blockOn` (default `blocker`+`major`). The critic's
  own `verdict` string is logged and never decides.
- **Every failure is forward-default — the work MERGES.** Critic throws, times
  out, is abandoned, or emits nothing parseable ⇒ `unavailable` ⇒ zero
  blocking. Fix turn fails ⇒ waive. Round cap with blockers still open ⇒
  WAIVE, record, merge. Failing the card instead would make
  `runStageIntegration` drop the branch and turn "90% right with one major
  finding" into nothing.
- **Waived findings are not lost**: they reach `DevEpochEvidence.waived`, the
  consolidation prompt and the epoch gate, so the next planner sees them.
- The critic's briefing is generic and lives in `review-agent.ts`. What
  `plan-to-pipeline.ts` adds is only what dev mode knows: the epoch atlas as
  the standard, the front's task specs, `findingsDir` per front. A vague atlas
  produces vague findings — that is why the atlas prompt demands checkable rules.

### Per-role model routing

`DevModelRole` = planner · recon · worker · critic · reporter · judge ·
integration; `DevModelPolicy` is `Partial`, and a role left unset **omits**
`modelId` on the emitted step so `AppConfig.modelId` stays the one authority.
No routing at all ⇒ the compiled pipeline is byte-identical to before.

**`z-ai/glm-5.2` can only ever be the `planner`.** The pi registry has no such
id (`getModel('openrouter', …)` returns `undefined`, and `pi/factory.ts`
throws on that), while the planner never touches the registry — it is the
LangChain path. So `preflightDevModelPolicy` checks the six PI-EXECUTED roles
and excludes `planner` **at the type level** (`Exclude<DevModelRole,'planner'>`)
— a preflight that checked it would refuse dev mode in its own default preset.
The check runs at the borders (`dev-cli.ts`, `dev-manager.start()`) so an
unknown id is a refusal instead of a throw inside the first agent, after its
worktree already exists.

`critic` is a distinct role from `judge` on purpose: the judge runs post-merge
in the integration worktree and routes a step; the critic runs pre-merge in the
worker's worktree and decides whether the branch enters. `judge` stays on the
strong model in every preset — its outcomes are forward-default, so a judge
that fails APPROVES SILENTLY.

### Session namespacing, resume, orphan branches

- The blackboard is `.huu/dev/<sessionId>/…`; only `goal.md`, `state.json` and
  `journal.md` stay at `.huu/dev/`. Without the namespace, a previous session's
  committed `epoch-1/<front>/tasks.json` is a live `filesFrom` target for this
  session's fan-out (`resolveMemoryFiles` only checks `existsSync`) — front ids
  are semantic (`api`, `cli`, `tests`), so collision was probable, not exotic.
- `DEV_STATE_FORMAT = 'huu-devstate-v2'`. `readDevState` returns `null` on a
  foreign `_format`, so a v1 file degrades to "no resume" with no migration
  code. Resume is OFFERED only when the goal matches EXACTLY and the previous
  session never reported complete; **with no callback the default is NO** —
  every existing caller keeps behaving as it did.
- The epoch ceiling counts from where the session STARTS, so `--epochs=3` on a
  resumed session still means three MORE epochs.
- `findOrphanIntegrationBranches` reports `huu/*/integration` branches HEAD
  never absorbed (`rev-list --count HEAD..<branch>` > 0) — genuinely lost work
  that `git status` cannot show. It NEVER blocks: no callback ⇒ warn and
  continue, naming the branch and the manual `git merge`.

### Instrumentation (it exists to be MEASURED, not to gate)

The research pass behind this design found genuine absence of published data on
two numbers huu's architecture rests on. Four counters ride the run and land in
`DevEpochEvidence`: `writeSetViolations` (files committed outside the spec's
declared ownership — pure instrumentation, nothing is blocked),
`reviewStats.provedBlocking`/`unprovedBlocking`, `reviewRounds`/`reviewWaived`,
and `costUsd` per epoch (BOTH runs). Don't quietly turn any of them into a
gate; changing `blockOn` is the deliberate lever.

### Stub path

`--stub` / `apiKey: 'stub'` / `backend: 'stub'` gives a deterministic
single-front plan (`stubPlan`). The graph compiles, waves schedule, merges
land — but the stub backend writes no files, so the memory fan-out resolves to
ZERO tasks and the critic loop never runs (nothing to review). That is a wiring
smoke test, not a work test, and it is exactly how an earlier findings fix
shipped completely unexercised.

## Procedure

1. Read `docs/dev-mode.md` (or `.pt-BR.md`) — user-facing contract, stop
   reasons, known limits, and the MANIFESTO reconciliation you must not drift from.
2. Change the PURE layer first (`knowledge-schema`, `plan-schema`,
   `dev-protocol`, `knowledge-to-pipeline`, `plan-to-pipeline`,
   `dev-model-policy`, `epoch-evidence`) and prove it with its colocated test.
   `plan-to-pipeline.test.ts` walks the compiled graph through the REAL
   `computeWave` + `validateTopology`; its "no `models`, no `review`" assertions
   are the compatibility proof — keep them passing unchanged.
3. Driver changes go through `dev-driver.test.ts`: real git repos in `mkdtemp`,
   an `orchestratorFactory` seam, and a fake run that leaves commits on an
   integration branch. Never mock git here.
4. `npm run typecheck && npm test`.
5. **Then run it end to end** — several unit-invisible bugs (the `.gitignore`
   sweep, the porcelain truncation) were only ever found this way:
   ```bash
   HUU_IN_CONTAINER=1 npx tsx src/cli.tsx dev "<goal>" --stub --epochs=2 \
       --skip-knowledge --run-dir=/tmp/<scratch-repo>
   ```
   Assert: `stoppedBecause: max-epochs`, every epoch carries a `landedCommit`,
   and `git status --porcelain` is EMPTY afterwards. Then run it a SECOND time
   in the same repo with a DIFFERENT goal — that is what proves the session
   namespace, and the stub cannot prove the swarm/review path at all.
6. Web changes: `src/web/dev-manager.test.ts` drives the real HTTP server (no
   browser). An epoch rides the SAME `{type:'run'}` SSE frames the board
   already renders; only the session layer gets `{type:'dev'}`. The resume and
   orphan gates use the approval gate's parked-promise pattern and must fail
   CLOSED on abort (no resume, nothing merged).

## References

- `src/lib/dev-mode/` (`dev-driver.ts`, `knowledge-blackboard.ts`,
  `knowledge-to-pipeline.ts`, `plan-to-pipeline.ts`, `epoch-evidence.ts`,
  `orphan-branches.ts`, `dev-model-policy.ts`, `dev-protocol.ts`),
  `src/lib/model-registry-check.ts`, `src/lib/knowledge-detect.ts`,
  `src/orchestrator/review-agent.ts`, `src/web/dev-manager.ts`
- `docs/dev-mode.md` · `docs/dev-mode.pt-BR.md` · `docs/memory-scope.md` ·
  `docs/pipeline-json-guide.md` (the `review` field)
- Related skills: working-on-orchestrator (the review loop's placement,
  locking and preemption; the finalize git-truth rule),
  authoring-pipelines (the schema the compiler must satisfy),
  integrating-llm-backends (registry vs LangChain paths, key pool),
  orchestrating-git-worktrees (integration branch, landing merge),
  authoring-agent-prompts (planner/front/critic prompts), building-web-ui,
  writing-tests

> Facts verified against source on 2026-07-28.

## <evolution>

After the task completes:

1. Only persist learnings if the task passed its tests/criteria.
2. Keep only non-obvious, durable learnings: surprises, user corrections, discovered conventions, failed approaches. Skip the obvious and the volatile.
3. Append to the LEARNINGS.md of the skill that OWNS the domain. Format: `- [YYYY-MM-DD][source:user|inference][task:<slug>][probation] <fact>` — user feedback outranks inference.
4. SKILL.md bodies have one human writer per surface — never auto-distill LEARNINGS into the body.
5. If a NEW knowledge area emerged, invoke meta-skill-evolution to propose a new skill.
6. Never merge skill changes yourself — leave them as an uncommitted git diff for human review.

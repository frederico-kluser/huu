# Learnings — editing-default-pipelines

Append-only log consumed by meta-skill-evolution and meta-skill-consolidate.
Entry format: `- [YYYY-MM-DD][source:user|inference][task:<slug>][probation] <fact>`
States: probation (default) -> promoted (distilled into SKILL.md by meta-skill-consolidate after dual-buffer check) | superseded (kept for history, never deleted).
Learnings are routed here when THIS skill owns the domain of the fact — regardless of which skill ran the task.

<!-- entries below this line -->
- [2026-06-12][source:inference][task:knowledge-system][probation] registry.test.ts is NOT the whole default-pipeline contract: src/lib/pipeline-bootstrap.test.ts ALSO pins per-pipeline shapes (no $file in single-task steps; named check-loop topologies per pipeline). Replacing huu Agent Knowledge broke two of its asserts silently because only registry.test was run — the gate for default-pipeline changes is the FULL suite, not the named contract file.
- [2026-06-25][source:inference][task:autonomous-pipelines][probation] The committed `pipelines/huu-*.pipeline.json` are git-TRACKED materialized copies, not just user artifacts — after editing a default-pipeline source module they DRIFT from the source until regenerated. Regen: `rm pipelines/huu-*.pipeline.json && HUU_NO_DOCKER=1 node_modules/.bin/tsx -e "import {ensureAllDefaultPipelines} from './src/lib/pipeline-bootstrap.js'; ensureAllDefaultPipelines(process.cwd())"`. `getDefaultPipelineFileContent()` stamps `exportedAt: new Date()`, so a regen ALWAYS shows a diff even with no content change (bootstrap never overwrites, so they don't self-heal).
- [2026-06-25][source:inference][task:autonomous-pipelines][probation] To remove manual file-picking (`scope:'per-file'`) from a default: insert a recon step built from the shared `targetsRecon()` helper (knowledge-protocol.ts) with `produces:'<path>'` (huu auto-appends the MEMORY CONTRACT), then convert the per-file step to `scope:'memory'` + `filesFrom:'<same path>'` + `$hint`. registry.test.ts now hard-asserts NO default uses `scope:'per-file'` AND every memory step has a `produces` producer — the autonomy invariant is enforced, not just convention.

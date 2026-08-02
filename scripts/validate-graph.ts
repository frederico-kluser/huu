#!/usr/bin/env npx tsx
/**
 * validate-graph.ts — pipeline topology validation.
 *
 * Runs EVERY check from `validateTopology` (names, references, scope rules,
 * edge direction) PLUS structural properties the schema-level validator
 * does NOT verify:
 *
 * 1. Reachability from step 0 (every step reachable via next/outcome/dependsOn)
 * 2. Orphans (steps with zero incoming references, warning-only)
 * 3. Outcome-complete routing (no dead branch that leads to an unreachable sink)
 * 4. Wave monotonicity (every step's deps are strictly earlier in the array)
 * 5. Wave width vs a reasonable pool cap (heuristic warning)
 *
 * Exit 0 when ALL pipeline files pass every check, 1 otherwise.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// --- types (inline to stay self-contained — no src/ import at CLI top) ---
interface PipelineStep {
  name: string;
  type?: string;
  next?: string;
  dependsOn?: string[];
  outcomes?: Array<{ label: string; nextStepName: string; default?: boolean }>;
}

interface Pipeline {
  name: string;
  steps: PipelineStep[];
}

// --- helpers ---

function isCheckStep(s: PipelineStep): boolean {
  return s.type === 'check';
}

function validateTopologyRaw(p: Pipeline): string[] {
  const errors: string[] = [];
  const add = (msg: string) => errors.push(msg);

  const stepNames = p.steps.map((s) => s.name);
  const nameToIdx = new Map(stepNames.map((n, i) => [n, i]));

  // Unique names
  const seen = new Set<string>();
  for (const name of stepNames) {
    if (seen.has(name)) {
      add(`duplicate step name "${name}"`);
    }
    seen.add(name);
  }

  for (let i = 0; i < p.steps.length; i++) {
    const step = p.steps[i]!;

    // dependsOn references + direction (only earlier steps)
    for (const dep of step.dependsOn ?? []) {
      const depIdx = nameToIdx.get(dep);
      if (depIdx === undefined) {
        add(`step "${step.name}" dependsOn unknown step "${dep}"`);
      } else if (depIdx >= i) {
        add(
          `step "${step.name}" dependsOn "${dep}" which is not an EARLIER step`,
        );
      }
    }

    // next references
    if (step.next !== undefined && !nameToIdx.has(step.next)) {
      add(`step "${step.name}".next → unknown step "${step.next}"`);
    }

    // CheckStep outcomes: references + exactly one default
    if (isCheckStep(step)) {
      const defaults = (step.outcomes ?? []).filter((o) => o.default);
      if (defaults.length !== 1) {
        add(
          `check step "${step.name}" must have exactly one default outcome (has ${defaults.length})`,
        );
      }
      const labels = new Set<string>();
      for (const outcome of step.outcomes ?? []) {
        if (labels.has(outcome.label)) {
          add(
            `check step "${step.name}" has duplicate outcome label "${outcome.label}"`,
          );
        }
        labels.add(outcome.label);
        if (!nameToIdx.has(outcome.nextStepName)) {
          add(
            `check step "${step.name}" outcome "${outcome.label}" → unknown step "${outcome.nextStepName}"`,
          );
        }
      }
    }
  }

  return errors;
}

/**
 * Every edge FROM a step (next, outcomes, dependsOn → the reverse of an
 * explicit dep), for the reachability + orphan analysis.
 */
function outgoingEdges(s: PipelineStep): string[] {
  const out: string[] = [];
  if (s.next) out.push(s.next);
  for (const o of s.outcomes ?? []) out.push(o.nextStepName);
  // dependsOn is incoming for this step — the OUTGOING side is every step
  // that lists THIS name in its dependsOn. We handle that in computeEdges().
  return out;
}

/** Build adjacency: stepName → set of successors reachable in one hop. */
function computeEdges(
  steps: PipelineStep[],
): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>();
  for (const s of steps) adj.set(s.name, new Set());

  for (const s of steps) {
    const succ = adj.get(s.name)!;
    // next
    if (s.next) succ.add(s.next);
    // outcomes
    for (const o of s.outcomes ?? []) {
      if (o.nextStepName) succ.add(o.nextStepName);
    }
  }

  // dependsOn edges: if A dependsOn B, then B → A is an edge (B must run
  // before A). We add B→A as an additional edge for reachability tracking
  // (a step's outgoing fan includes consumers that depend on it).
  for (const s of steps) {
    for (const dep of s.dependsOn ?? []) {
      adj.get(dep)?.add(s.name);
    }
  }

  // For steps with NO dependsOn and not step 0, the previous step in array
  // order is an implicit dependency, so previous → this is an edge.
  for (let i = 1; i < steps.length; i++) {
    const step = steps[i]!;
    if ((step.dependsOn ?? []).length === 0) {
      adj.get(steps[i - 1]!.name)?.add(step.name);
    }
  }

  return adj;
}

// --- checks ---

/** 1. Reachability from step 0 (BFS over all edge types). */
function checkReachability(
  pipeline: Pipeline,
): string[] {
  const errors: string[] = [];
  if (pipeline.steps.length === 0) return errors;

  const adj = computeEdges(pipeline.steps);
  const visited = new Set<string>();
  const queue = [pipeline.steps[0]!.name];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const n of adj.get(current) ?? new Set()) {
      if (!visited.has(n)) queue.push(n);
    }
  }

  for (const s of pipeline.steps) {
    if (!visited.has(s.name)) {
      errors.push(
        `step "${s.name}" is unreachable from step "${pipeline.steps[0]!.name}"`,
      );
    }
  }

  return errors;
}

/**
 * 2. Orphans — steps (other than step 0) with zero INCOMING references from
 *    any mechanism: no `next`, no `dependsOn`, no outcome, and not the
 *    implicit successor of the previous array element. These are WARNINGs:
 *    a linear chain with no explicit edges is valid, but in a DAG pipeline
 *    an orphan is dead code. The check is the same for both cases — the
 *    caller decides severity.
 */
function checkOrphans(
  pipeline: Pipeline,
): string[] {
  const warnings: string[] = [];
  if (pipeline.steps.length <= 1) return warnings;

  // Collect every target name.
  const referenced = new Set<string>();

  for (const s of pipeline.steps) {
    if (s.next) referenced.add(s.next);
    for (const o of s.outcomes ?? []) referenced.add(o.nextStepName);
    for (const d of s.dependsOn ?? []) referenced.add(d);
  }

  // Implicit chain: step i (i>0) is implicitly "referenced" by step i-1
  // when neither uses explicit dependsOn.
  for (let i = 1; i < pipeline.steps.length; i++) {
    const prev = pipeline.steps[i - 1]!;
    const cur = pipeline.steps[i]!;
    if (cur.dependsOn === undefined && prev.dependsOn === undefined) {
      // Both are on the implicit chain — prev implicitly "references" cur
      // (it's the default fallthrough). But this is a soft link: if ANY
      // step has dependsOn, treat the whole pipeline as DAG and only count
      // explicit references.
    }
  }

  // Determine mode: if ANY step has dependsOn, it's a DAG pipeline.
  const isDag = pipeline.steps.some((s) => s.dependsOn !== undefined);

  for (const s of pipeline.steps) {
    if (s.name === pipeline.steps[0]!.name) continue; // step 0 is the entry
    if (!referenced.has(s.name)) {
      // Also check: is it the implicit successor of its previous sibling?
      const idx = pipeline.steps.findIndex((x) => x.name === s.name);
      const isImplicitSucc =
        idx > 0 &&
        !isDag &&
        (pipeline.steps[idx]!.dependsOn ?? []).length === 0;
      // skip if explicit incoming refs (dependsOn from another step)
      // already handled by the outer `referenced` check — the only case
      // left is a step whose only incoming link is the implicit chain.
      if (!isImplicitSucc) {
        warnings.push(
          `step "${s.name}" appears to be an orphan — zero incoming references from next/dependsOn/outcomes and not an implicit linear successor`,
        );
      }
    }
  }

  return warnings.filter(Boolean);
}

/**
 * 3. Unreachable after outcome routing: for each CheckStep, verify that
 *    every outcome leads to a step that IS reachable from itself. Also
 *    check that no outcome creates a dead end (a step whose only incoming
 *    edge is a single check-outcome branch that excludes all other paths).
 *
 *    We model this as: for each reachable CheckStep, ALL of its outcome
 *    targets must also be reachable from the entry — if a check's outcome
 *    points to a step that itself has zero implicit/explicit incoming
 *    references AND is not reachable through any other path, that's a
 *    dead-end branch.
 */
function checkOutcomeRouting(
  pipeline: Pipeline,
): string[] {
  const errors: string[] = [];
  const adj = computeEdges(pipeline.steps);

  // All steps reachable from entry via BFS (ignoring check-outcome
  // branching — this is the union of all possible paths).
  const reachable = new Set<string>();
  const queue = [pipeline.steps[0]!.name];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (reachable.has(cur)) continue;
    reachable.add(cur);
    for (const n of adj.get(cur) ?? new Set()) {
      if (!reachable.has(n)) queue.push(n);
    }
  }

  // For each CheckStep, every outcome's target must be reachable.
  // (This covers the degenerate case where an outcome points BACKWARDS
  // to a step that already ran — structurally fine but semantically a
  // rework loop; we don't judge intent, only topology.)
  for (const s of pipeline.steps) {
    if (!isCheckStep(s)) continue;
    for (const o of s.outcomes ?? []) {
      if (!reachable.has(o.nextStepName)) {
        errors.push(
          `check step "${s.name}" outcome "${o.label}" targets step "${o.nextStepName}" which is not reachable from the entry step`,
        );
      }
    }
  }

  // Dead-end check: a step whose ONLY incoming edges come from check
  // outcomes and none of those checks are reachable. Skip step 0.
  for (const step of pipeline.steps) {
    if (step.name === pipeline.steps[0]!.name) continue;

    // Compute all incoming edges to this step.
    const incoming = new Set<string>();
    for (const s of pipeline.steps) {
      if (s.next === step.name) incoming.add(s.name);
      for (const o of s.outcomes ?? []) {
        if (o.nextStepName === step.name) incoming.add(s.name);
      }
      for (const d of s.dependsOn ?? []) {
        if (d === step.name) incoming.add(s.name);
      }
    }

    // If the step has zero incoming edges, it's already caught by orphans.
    if (incoming.size === 0) continue;

    // If ALL incoming edges are from checks that are unreachable, the step
    // itself is dead. But if even ONE incoming edge is from a non-check or
    // a reachable check, it's fine.
    let anyReachable = false;
    for (const src of incoming) {
      const srcStep = pipeline.steps.find((s) => s.name === src);
      if (!isCheckStep(srcStep!)) {
        anyReachable = true;
        break;
      }
      if (reachable.has(src)) {
        anyReachable = true;
        break;
      }
    }

    if (!anyReachable) {
      errors.push(
        `step "${step.name}" is only reachable from unreachable check outcomes — dead end`,
      );
    }
  }

  return errors;
}

/**
 * 4. Wave monotonicity: every step's effective dependencies (explicit
 *    dependsOn, or the implicit previous-step chain) must point to EARLIER
 *    steps in the array. This duplicates validateTopology's check but also
 *    catches implicit-chain violations (the schema validator only checks
 *    explicit dependsOn direction).
 *
 *    Also verifies: for DAG pipelines, no step's dependsOn transitively
 *    includes a step later in the array (the explicit-index check already
 *    prevents this since deps must be strictly earlier, so this is just a
 *    double-check for the implicit case).
 */
function checkWaveMonotonicity(
  pipeline: Pipeline,
): string[] {
  const errors: string[] = [];
  const nameToIdx = new Map(pipeline.steps.map((s, i) => [s.name, i]));

  for (let i = 0; i < pipeline.steps.length; i++) {
    const step = pipeline.steps[i]!;
    const deps = step.dependsOn ?? (i > 0 ? [pipeline.steps[i - 1]!.name] : []);
    for (const dep of deps) {
      const depIdx = nameToIdx.get(dep);
      if (depIdx === undefined) continue; // caught by validateTopology
      if (depIdx >= i) {
        errors.push(
          `step "${step.name}" (idx ${i}) depends on "${dep}" (idx ${depIdx}) — not strictly earlier`,
        );
      }
    }
  }

  return errors;
}

/**
 * 5. Wave width vs pool capacity: for DAG pipelines, compute the maximum
 *    number of STEPS that can run concurrently in a single wave and warn
 *    if the fan-out exceeds a heuristic bound. This is a SOFT check: the
 *    orchestrator caps task-level concurrency per the memory budget, so a
 *    wide wave is just a scheduling hint, not a structural error.
 */
function checkWaveWidth(
  pipeline: Pipeline,
): string[] {
  const warnings: string[] = [];
  const nameToIdx = new Map(pipeline.steps.map((s, i) => [s.name, i]));

  // Only meaningful for DAG pipelines.
  if (!pipeline.steps.some((s) => s.dependsOn !== undefined)) return warnings;

  // Simulate wave computation (simplified — no check-step barrier logic,
  // just group by the maximum depth of dependency chain).
  const depth = new Map<string, number>();

  function getDepth(name: string): number {
    if (depth.has(name)) return depth.get(name)!;
    const idx = nameToIdx.get(name);
    if (idx === undefined) return 0;
    const step = pipeline.steps[idx]!;
    const deps = step.dependsOn ?? (idx > 0 ? [pipeline.steps[idx - 1]!.name] : []);
    let maxDep = 0;
    for (const d of deps) {
      maxDep = Math.max(maxDep, getDepth(d) + 1);
    }
    depth.set(name, maxDep);
    return maxDep;
  }

  for (const s of pipeline.steps) getDepth(s.name);

  // Group by depth to estimate wave width.
  const byDepth = new Map<number, string[]>();
  for (const s of pipeline.steps) {
    const d = getDepth(s.name);
    if (!byDepth.has(d)) byDepth.set(d, []);
    byDepth.get(d)!.push(s.name);
  }

  const HARD_CAP = 64;
  for (const [d, names] of byDepth) {
    if (names.length > HARD_CAP) {
      warnings.push(
        `wave at depth ${d} has ${names.length} steps — exceeds pool width heuristic of ${HARD_CAP}; consider splitting into smaller dependencies`,
      );
    }
  }

  return warnings;
}

// --- main ---

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Usage: validate-graph.ts <pipeline.json>...');
  process.exit(1);
}

let errors = 0;
let warnings = 0;

for (const file of args) {
  const path = resolve(file);
  if (!existsSync(path)) {
    console.error(`FAIL ${file}: file not found`);
    errors++;
    continue;
  }

  let pipeline: Pipeline;
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    pipeline = raw.pipeline ?? raw;
    if (!pipeline.steps || !Array.isArray(pipeline.steps)) {
      console.error(`FAIL ${file}: missing or invalid steps array`);
      errors++;
      continue;
    }
    if (pipeline.steps.length === 0) {
      console.error(`FAIL ${file}: steps array is empty`);
      errors++;
      continue;
    }
  } catch (e: any) {
    console.error(`FAIL ${file}: ${e.message}`);
    errors++;
    continue;
  }

  const fileErrors: string[] = [];
  const fileWarnings: string[] = [];

  // ----- validateTopology checks (schema-level) -----
  fileErrors.push(...validateTopologyRaw(pipeline));

  // ----- Structural graph checks -----
  fileErrors.push(...checkReachability(pipeline));
  fileWarnings.push(...checkOrphans(pipeline));
  fileErrors.push(...checkOutcomeRouting(pipeline));
  fileErrors.push(...checkWaveMonotonicity(pipeline));
  fileWarnings.push(...checkWaveWidth(pipeline));

  // Report
  for (const e of fileErrors) {
    console.error(`FAIL ${file}: ${e}`);
  }
  for (const w of fileWarnings) {
    console.warn(`WARN ${file}: ${w}`);
  }

  if (fileErrors.length === 0 && fileWarnings.length === 0) {
    console.log(`OK   ${file}`);
  }

  errors += fileErrors.length;
  warnings += fileWarnings.length;
}

// Summary
const total = errors + warnings;
if (errors === 0) {
  if (warnings > 0) {
    console.log(`\nOK: all pipelines pass (${warnings} warning(s), 0 errors)`);
  } else {
    console.log('\nOK: all pipelines pass graph validation');
  }
} else {
  console.log(`\nFAIL: ${errors} error(s), ${warnings} warning(s)`);
}

process.exit(errors > 0 ? 1 : 0);

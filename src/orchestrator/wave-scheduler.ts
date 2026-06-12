// Deterministic wave scheduling for DAG pipelines (`dependsOn`).
//
// The model is BSP supersteps, not a continuous ready-set: each WAVE runs
// every pending step whose dependencies are done — all their tasks share
// ONE worker pool — and then merges them sequentially in ARRAY ORDER. Wave
// composition and merge order derive only from the graph + the array,
// never from timing: the same pipeline always produces the same commit
// sequence. Checks are barriers: a ready CheckStep runs as a singleton
// wave (judges share the integration worktree and must not overlap).
//
// Loops never live in dependsOn (validation forbids forward/unknown refs,
// which also makes cycles structurally impossible). A check outcome or a
// work step's `next` is an ACTIVATION edge: it re-pends its target and —
// in cascade — everything that depends on the target ("rework redoes
// whatever depended on the reworked step").
//
// Pure module: no orchestrator state, fully unit-testable.

import type { PipelineStep } from '../lib/types.js';
import { isCheckStep } from '../lib/types.js';

/** True when any step declares dependsOn — the run switches to wave mode. */
export function hasDagEdges(steps: readonly PipelineStep[]): boolean {
  return steps.some((s) => s.dependsOn !== undefined);
}

/**
 * The step's effective dependencies:
 * - explicit `dependsOn` when present (possibly `[]` = root);
 * - otherwise the previous step in the array (v2 chain back-compat);
 * - PLUS the implicit memory edge: a memory step whose `filesFrom` matches
 *   an earlier step's `produces` depends on that producer (the declared
 *   link from the memory feature becomes a DAG edge for free — and it
 *   keeps producer and consumer out of the same wave).
 */
export function effectiveDeps(steps: readonly PipelineStep[], index: number): string[] {
  const step = steps[index]!;
  const deps = new Set<string>(
    step.dependsOn ?? (index > 0 ? [steps[index - 1]!.name] : []),
  );
  if (!isCheckStep(step) && step.scope === 'memory' && step.filesFrom) {
    for (let i = 0; i < index; i++) {
      const candidate = steps[i]!;
      if (!isCheckStep(candidate) && candidate.produces === step.filesFrom) {
        deps.add(candidate.name);
      }
    }
  }
  return [...deps];
}

/**
 * The next wave: every pending step whose effective deps are all done, in
 * array order. When the first ready step (array order) is a CheckStep, the
 * wave is that check ALONE — decisions are barriers and judges never
 * overlap in the integration worktree. Returns [] when nothing can run
 * (remaining pending steps are unreachable → the run ends, skipping them).
 */
export function computeWave(
  steps: readonly PipelineStep[],
  done: ReadonlySet<string>,
  pending: ReadonlySet<string>,
): PipelineStep[] {
  const ready: PipelineStep[] = [];
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!;
    if (!pending.has(step.name)) continue;
    if (effectiveDeps(steps, i).every((d) => done.has(d))) {
      ready.push(step);
    }
  }
  if (ready.length === 0) return [];
  const firstCheck = ready.find((s) => isCheckStep(s));
  if (firstCheck) {
    // A ready check preempts the wave as a singleton. Work steps that were
    // also ready simply run in the NEXT wave — order stays deterministic.
    return [firstCheck];
  }
  return ready;
}

/**
 * Every step that transitively depends on `name` (via effective deps), in
 * array order. Used by activation: re-pending a step re-pends its whole
 * downstream cone.
 */
export function descendantsOf(steps: readonly PipelineStep[], name: string): string[] {
  const affected = new Set<string>([name]);
  // Single forward pass suffices: deps only point backwards in the array.
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!;
    if (affected.has(step.name)) continue;
    if (effectiveDeps(steps, i).some((d) => affected.has(d))) {
      affected.add(step.name);
    }
  }
  affected.delete(name);
  return steps.map((s) => s.name).filter((n) => affected.has(n));
}

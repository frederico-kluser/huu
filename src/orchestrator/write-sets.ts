/**
 * Runtime write-set disjunction check — runs before the stage merge.
 *
 * (a) STATIC validation lives in `src/lib/pipeline-io.ts` (`validateTopology`):
 *     two steps in the same wave with intersecting `writes` globs FAIL early.
 * (b) RUNTIME check (this module): before `runStageIntegration`, the
 *     orchestrator builds a `Map<path, agentId[]>` from each agent's
 *     `filesModified` and flags every path with ≥2 writers.
 *
 * The violation is LOGGED and recorded in `AgentStatus.writeSetViolations`.
 * It does NOT block the merge — purely instrumentation today, like the
 * existing per-agent `writeSetViolations` in `review-agent.ts`.
 */

/**
 * Context compactions huu tolerates on ONE card before it stops the card.
 *
 * Same threshold and the same reasoning as `MAX_CONSECUTIVE_EPOCH_FAILURES`
 * one level up, and as the auto-compact breaker Claude Code ships at the
 * session level: a loop that refills the context as fast as it is compacted is
 * not recovering, and the only thing continuing buys is a larger bill. Failing
 * LOUDLY with an actionable message is the whole point — the operator, not the
 * harness, is the one who can narrow the step.
 */
export const MAX_CARD_COMPACTIONS = 3;

/**
 * What huu says to an agent whose context was just compacted.
 *
 * Short and entirely re-statement: the spec path and the declared write scope,
 * the two facts that arrived in turn one and are therefore exactly what
 * compaction is documented to lose. It adds no new instruction — an agent that
 * still remembers everything reads it as a redundant reminder, which costs a
 * few dozen tokens and changes nothing.
 */
export function compactionReminder(task: {
  files: readonly string[];
  ownedPaths?: readonly string[];
}): string {
  const lines = [
    'Your context was just compacted, so earlier turns may be gone. Re-anchoring, in case:',
  ];
  const spec = task.files[0];
  if (spec) lines.push(`- Your assignment is briefed in \`${spec}\`. Re-read it if you are unsure.`);
  if (task.ownedPaths && task.ownedPaths.length > 0) {
    lines.push(`- You may WRITE only: ${task.ownedPaths.map((p) => `\`${p}\``).join(', ')}.`);
  }
  lines.push(
    '- Anything you have learned that is not yet in a file you wrote is at risk. Write it down now, then continue.',
  );
  return lines.join('\n');
}

/**
 * A file DECLARED as owned by more than one spec.
 *
 * Distinct from {@link WriteSetViolation}, and that distinction is the point:
 * this one is DECLARED-vs-DECLARED and is known BEFORE any agent runs, while
 * `WriteSetViolation` is ACTUAL-vs-ACTUAL and is only knowable after they have
 * already written. The declared collision is the one that can still change an
 * outcome — a merge conflict this run has not paid for yet.
 */
export interface DeclaredOwnershipCollision {
  /** Repo-relative path claimed by ≥2 specs. */
  path: string;
  /** Paths of the specs that claim it (stable order). */
  specs: string[];
}

/**
 * The pure collision core over DECLARED ownership.
 *
 * Two claim shapes count as a collision: the same exact path claimed twice, and
 * a directory claim (`src/api/`) that contains another spec's file claim
 * (`src/api/routes.ts`). A spec claiming its own file twice is not a collision.
 *
 * Lives here — the orchestrator's write-set module — rather than in dev mode,
 * because the SAME answer must serve two callers that used to be independent:
 * the pre-fan-out check (over the specs `resolveMemoryFiles` just resolved) and
 * dev mode's post-landing `checkWritePartition`. One implementation is what
 * keeps them from ever disagreeing about the same specs.
 *
 * Pure. Never throws.
 */
export function collideDeclaredOwnership(
  entries: ReadonlyMap<string, readonly string[]>,
): DeclaredOwnershipCollision[] {
  // claim → the specs that made it
  const owners = new Map<string, string[]>();
  for (const [spec, claims] of entries) {
    for (const claim of claims) {
      let list = owners.get(claim);
      if (!list) {
        list = [];
        owners.set(claim, list);
      }
      if (!list.includes(spec)) list.push(spec);
    }
  }

  const byPath = new Map<string, Set<string>>();
  const add = (path: string, specs: readonly string[]): void => {
    let set = byPath.get(path);
    if (!set) {
      set = new Set();
      byPath.set(path, set);
    }
    for (const s of specs) set.add(s);
  };

  for (const [claim, specs] of owners) {
    if (specs.length >= 2) add(claim, specs);
  }

  // Directory containment: `src/api/` owned by A, `src/api/routes.ts` by B.
  const dirs = [...owners.entries()].filter(([claim]) => claim.endsWith('/'));
  for (const [claim, specs] of owners) {
    if (claim.endsWith('/')) continue;
    for (const [dir, dirSpecs] of dirs) {
      if (!claim.startsWith(dir)) continue;
      const foreign = dirSpecs.filter((s) => !specs.includes(s));
      if (foreign.length > 0) add(claim, [...specs, ...foreign]);
    }
  }

  return [...byPath.entries()]
    .map(([path, specs]) => ({ path, specs: [...specs].sort() }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

/** One line per collision, for an operator log. */
export function formatDeclaredCollisions(
  collisions: readonly DeclaredOwnershipCollision[],
): string {
  if (collisions.length === 0) return '';
  const lines = [
    `declared write-set collision: ${collisions.length} file(s) claimed by more than one task spec — these WILL conflict at the stage merge:`,
  ];
  for (const c of collisions) {
    lines.push(`  - ${c.path} claimed by ${c.specs.join(', ')}`);
  }
  return lines.join('\n');
}

/**
 * A single file path written by ≥2 agents in the same stage.
 */
export interface WriteSetViolation {
  /** Repo-relative path. */
  path: string;
  /** Agent ids that modified this path. */
  agentIds: number[];
}

/**
 * Build a `Map<path, agentId[]>` from the per-agent `filesModified` and
 * return every path with ≥2 writers.
 *
 * @param filesModified - Map from agentId to the files that agent modified.
 * @param writes - Per-agent write-set globs (declared by the step), for
 *   attribution in log messages. Same index order as `filesModified` keys.
 *   When absent (agent has no `writes` declared), the agent's files are
 *   still counted for collision detection.
 */
export function checkWriteSetViolations(
  filesModified: ReadonlyMap<number, readonly string[]>,
  writes?: Array<{ agentId: number; globs: string[] } | undefined>,
): WriteSetViolation[] {
  // Invert: path → set of agentIds that touched it.
  const pathToAgents = new Map<string, Set<number>>();
  for (const [agentId, files] of filesModified) {
    for (const file of files) {
      // .huu/ artefacts are huu's own scratch tree, never a collision signal.
      if (file.startsWith('.huu/') || file.startsWith('.huu-') || file === '.env.huu') continue;
      let agents = pathToAgents.get(file);
      if (!agents) {
        agents = new Set();
        pathToAgents.set(file, agents);
      }
      agents.add(agentId);
    }
  }

  const violations: WriteSetViolation[] = [];
  for (const [path, agentIds] of pathToAgents) {
    if (agentIds.size >= 2) {
      violations.push({ path, agentIds: [...agentIds].sort((a, b) => a - b) });
    }
  }

  // Stable sort for deterministic output.
  violations.sort((a, b) => a.path.localeCompare(b.path));

  return violations;
}

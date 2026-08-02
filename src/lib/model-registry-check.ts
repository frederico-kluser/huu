/**
 * Preflight for model ids that will be executed as pi AGENTS.
 *
 * `src/orchestrator/backends/pi/factory.ts` resolves every agent's model with
 * `getModel('openrouter', id)` and THROWS when the registry has never heard of
 * the id. Today that throw lands inside the first agent — after worktrees and
 * branches already exist. Checking the ids up front, at the border
 * (`dev-cli.ts`, `dev-manager.start()`), turns a half-created run into a
 * refusal that names the role, the id and the ids the registry does have.
 *
 * ## Why `planner` is NEVER checked — the whole reason this module exists
 *
 * The pi registry is NOT the set of usable models; it is the set of models the
 * pi AGENT can run. The blind orchestrator (`planner`) is not an agent: it is
 * a structured-output call through `buildChatClient` → LangChain `ChatOpenAI`
 * → OpenRouter, a path that accepts any id the OpenRouter API accepts and
 * never touches this registry.
 *
 * That distinction is load-bearing, not academic: the default preset routes
 * `planner` to `z-ai/glm-5.2`, which the pi registry does NOT contain (its
 * `z-ai` family stops at `glm-5.1`), while `deepseek/deepseek-v4-pro` and
 * `moonshotai/kimi-k2.6` — the ids that DO run as agents — are both present.
 * A preflight that checked `planner` would therefore refuse to start dev mode
 * in its own default configuration. {@link PI_EXECUTED_DEV_MODEL_ROLES}
 * excludes it at the type level, and `model-registry-check.test.ts` pins it.
 *
 * Pure: no fs, no network, no env. The registry is the static table bundled
 * with `@mariozechner/pi-ai`.
 */

import { getModel, getModels } from '@mariozechner/pi-ai';
import type { AgentBackendKind, DevModelPolicy, DevModelRole } from './types.js';
import { modelRungs } from './dev-mode/dev-model-policy.js';

/** The provider whose catalog the pi backend runs against. */
const PI_PROVIDER = 'openrouter';

/** One id, and whether the pi registry can resolve it. */
export interface PiModelCheck {
  id: string;
  known: boolean;
}

/**
 * Resolve each id against the pi registry, 1:1 and IN ORDER, so a caller that
 * built the list from a role map can zip the results back onto their roles.
 * Unknown ids are reported, never thrown — the caller decides what a miss
 * means.
 */
export function checkPiModelIds(ids: readonly string[]): PiModelCheck[] {
  return ids.map((id) => ({
    id,
    // The typed signature wants a literal key of the generated table; the
    // whole job here is asking about ids that may not be in it. `getModel`
    // returns undefined for a miss (same contract pi/factory.ts relies on).
    known: Boolean(getModel(PI_PROVIDER, id.trim() as never)),
  }));
}

let cachedIds: string[] | null = null;

/** Every id the pi registry knows for the pi backend's provider. */
function registryIds(): string[] {
  cachedIds ??= getModels(PI_PROVIDER).map((model) => model.id);
  return cachedIds;
}

function commonPrefixLength(a: string, b: string): number {
  const max = Math.min(a.length, b.length);
  let i = 0;
  while (i < max && a[i] === b[i]) i += 1;
  return i;
}

function splitId(id: string): { vendor: string; stem: string } {
  const slash = id.indexOf('/');
  return slash < 0
    ? { vendor: '', stem: id }
    : { vendor: id.slice(0, slash), stem: id.slice(slash + 1) };
}

/**
 * Registry ids closest to `id`, best first — what makes an "unknown model"
 * message actionable instead of a dead end.
 *
 * Same-vendor ids always outrank cross-vendor ones (`z-ai/glm-5.2` →
 * `z-ai/glm-5.1` before anything else); within a rank, the longest shared
 * model-name prefix wins, ties broken alphabetically for determinism. A
 * cross-vendor id only qualifies on a substantial shared prefix, so a typo in
 * the VENDOR (`zai/glm-5.2`) still finds the `glm-5.x` family instead of
 * returning noise.
 */
export function suggestNearbyModelIds(id: string, limit = 3): string[] {
  const target = splitId(id.trim());
  const MIN_CROSS_VENDOR_PREFIX = 3;
  const scored: { id: string; score: number }[] = [];
  for (const candidate of registryIds()) {
    if (candidate === id.trim()) continue;
    const { vendor, stem } = splitId(candidate);
    const shared = commonPrefixLength(stem, target.stem);
    if (vendor === target.vendor) scored.push({ id: candidate, score: 1000 + shared });
    else if (shared >= MIN_CROSS_VENDOR_PREFIX) scored.push({ id: candidate, score: shared });
  }
  scored.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  return scored.slice(0, Math.max(0, limit)).map((entry) => entry.id);
}

/**
 * Exhaustiveness lock with the exclusion built into the TYPE: adding a role to
 * {@link DevModelRole} fails compilation here until someone decides whether it
 * runs as a pi agent, and `planner` cannot be added back by accident because
 * `Exclude` removes it from the key set.
 */
const PI_EXECUTED: Record<Exclude<DevModelRole, 'planner'>, true> = {
  recon: true,
  worker: true,
  critic: true,
  reporter: true,
  judge: true,
  integration: true,
};

/** The roles that run as pi agents — every role except `planner` (see module doc). */
export const PI_EXECUTED_DEV_MODEL_ROLES: readonly DevModelRole[] = Object.keys(
  PI_EXECUTED,
) as DevModelRole[];

/** An explicitly routed role whose model the pi registry cannot resolve. */
export interface DevModelIssue {
  role: DevModelRole;
  id: string;
  /** Registry ids closest to `id` — possibly empty. */
  suggestions: string[];
}

/**
 * The border check: every pi-executed role the policy EXPLICITLY routes, in
 * role order. Empty result ⇒ safe to start.
 *
 * Two deliberate boundaries:
 *
 * - Only ids the policy actually names are checked. A role the policy leaves
 *   unset omits `modelId` on the emitted step and inherits the run's model,
 *   whose validation is the pi factory's existing job for every huu run — the
 *   new failure mode this guards is a user typing an id into a per-role slot.
 * - `backend` gates the whole check: the pi registry says nothing about an
 *   Azure deployment name, and the stub has no catalog at all. It defaults to
 *   `'pi'` so a caller that forgets the argument gets the check, not a silent
 *   pass.
 */
export function preflightDevModelPolicy(
  policy: DevModelPolicy | undefined,
  backend: AgentBackendKind = 'pi',
): DevModelIssue[] {
  if (!policy || backend !== 'pi') return [];
  const issues: DevModelIssue[] = [];
  for (const role of PI_EXECUTED_DEV_MODEL_ROLES) {
    const rungs = modelRungs(policy[role]);
    if (rungs.length === 0) continue;
    const checks = checkPiModelIds(rungs);
    // A CHAIN fails only when EVERY rung is unknown. One dead rung in an
    // ordered fallback is the case the chain exists for — refusing the session
    // over it would make the feature pointless — so it is reported through the
    // caller's warning channel, not as a refusal.
    if (checks.some((c) => c.known)) continue;
    issues.push({
      role,
      id: rungs.join(', '),
      suggestions: suggestNearbyModelIds(rungs[0]!),
    });
  }
  return issues;
}

/**
 * Rungs a policy names that the registry does NOT have, per role — the dead
 * entries a chain silently skips over. Never a refusal: this is what the border
 * says out loud so a chain that has quietly degraded to its last rung is
 * visible instead of merely working.
 */
export function deadDevModelRungs(
  policy: DevModelPolicy | undefined,
  backend: AgentBackendKind = 'pi',
): Array<{ role: DevModelRole; dead: string[]; using: string }> {
  if (!policy || backend !== 'pi') return [];
  const out: Array<{ role: DevModelRole; dead: string[]; using: string }> = [];
  for (const role of PI_EXECUTED_DEV_MODEL_ROLES) {
    const rungs = modelRungs(policy[role]);
    if (rungs.length < 2) continue;
    const checks = checkPiModelIds(rungs);
    const dead = checks.filter((c) => !c.known).map((c) => c.id);
    const alive = checks.find((c) => c.known);
    if (dead.length > 0 && alive) out.push({ role, dead, using: alive.id });
  }
  return out;
}

/** Is this id in the pi registry? The predicate `resolveDevModels` injects. */
export function isPiModelKnown(id: string): boolean {
  return checkPiModelIds([id])[0]?.known === true;
}

/**
 * The refusal message for {@link preflightDevModelPolicy} issues — names the
 * role, the id and the nearby ids, and states the `planner` carve-out so the
 * next reader doesn't "fix" the check by adding it.
 */
export function formatDevModelPreflightError(issues: readonly DevModelIssue[]): string {
  const lines = issues.map((issue) => {
    const nearby = issue.suggestions.length
      ? `nearby ids: ${issue.suggestions.join(', ')}`
      : 'no nearby ids in the registry';
    return `  • ${issue.role}: "${issue.id}" — ${nearby}`;
  });
  return [
    `Model routing preflight failed — ${issues.length === 1 ? 'this id is' : 'these ids are'} not in the pi model registry, so the agent would throw after its worktree already exists:`,
    ...lines,
    'Fix the id, or drop the role so it falls back to the run model.',
    'Note: the `planner` role is intentionally NOT checked — it runs through the structured-output client, not the pi registry.',
  ].join('\n');
}

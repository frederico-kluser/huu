/**
 * Per-role model routing for dev mode — pure, no I/O, no fs, no env.
 *
 * The whole point of this module is that it adds NOTHING implicitly. A role
 * left unset resolves to the caller's fallback (`AppConfig.modelId`), which is
 * exactly what every dev-mode step gets today, so a session that never asks
 * for routing compiles the pipeline it compiles today — byte for byte. The
 * defaults live at the SURFACES (CLI flag, web option), never in the driver:
 * that is what makes heterogeneous routing an opt-in instead of a rewrite of
 * everyone's runs.
 *
 * Consumes the contract from `../types.js` ({@link DevModelRole},
 * {@link DevModelPolicy}, {@link DEV_MODEL_PRESETS}) — it does not redefine it.
 *
 * A note on the economics, because it reads backwards: splitting roles across
 * models is not a cost optimization (a fan-out costs several times a single
 * agent while the price gap between these models is ~2×). The justification is
 * context isolation, parallelism, and for `critic` specifically a second
 * opinion from another vendor.
 */

import {
  DEV_MODEL_PRESETS,
  type AgentBackendKind,
  type DevModelPolicy,
  type DevModelPreset,
  type DevModelRole,
} from '../types.js';

/**
 * Exhaustiveness lock: adding a role to {@link DevModelRole} fails compilation
 * HERE until it is listed, so {@link DEV_MODEL_ROLES} can never silently miss
 * a role and leave it unresolved.
 */
const ALL_ROLES: Record<DevModelRole, true> = {
  planner: true,
  recon: true,
  worker: true,
  critic: true,
  reporter: true,
  judge: true,
  integration: true,
};

/** Every role, in declaration order. */
export const DEV_MODEL_ROLES: readonly DevModelRole[] = Object.keys(ALL_ROLES) as DevModelRole[];

/**
 * Split a policy value into its ordered fallback RUNGS.
 *
 * A role's value may name one model (`"deepseek/v4-pro"`) or an ordered chain
 * (`"deepseek/v4-pro, z-ai/glm-5.2"`). One id is the overwhelmingly common
 * case and stays exactly what it was; a chain says "use the first of these the
 * registry actually has".
 *
 * WHY A CHAIN AT ALL. A role was one id, and an id the pi registry has never
 * heard of throws inside the first agent — after its worktree and branch
 * already exist. `preflightDevModelPolicy` moved that failure to the border,
 * which is better, but the answer was still "refuse the session". A provider
 * dropping a model, or a registry lagging a rename, should cost a rung, not a
 * run.
 *
 * Commas are the separator because the same rule then works for a CLI flag, a
 * web text field and a JSON string with no per-surface parsing. No id in the
 * OpenRouter registry contains a comma (`vendor/model[:variant]`), so nothing
 * is ambiguous — and an id that somehow did would split into rungs that simply
 * fail the preflight, loudly, rather than misbehaving quietly.
 */
export function modelRungs(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((rung) => rung.trim())
    .filter((rung) => rung.length > 0);
}

/**
 * Collapse a chain to the rung that will actually run.
 *
 * `isKnown` is injected rather than imported so this module stays pure — the pi
 * registry lives behind `model-registry-check.ts`, and a policy resolver that
 * needs a registry is a policy resolver nobody can unit-test. With no predicate
 * the first rung wins, which is the pre-chain behavior exactly.
 */
export function pickModelRung(
  value: string | undefined,
  isKnown?: (id: string) => boolean,
): string | undefined {
  const rungs = modelRungs(value);
  if (rungs.length === 0) return undefined;
  if (!isKnown) return rungs[0];
  return rungs.find((rung) => isKnown(rung)) ?? rungs[0];
}

/**
 * Role → the model id that role must actually run on.
 *
 * Deliberately a plain `??`-style resolution with NO hidden defaulting: an
 * absent policy — or any role missing from it, or set to whitespace — falls
 * back to `fallbackModelId`. Callers that want the opinionated routing ask for
 * it explicitly via {@link defaultDevModelPolicy}.
 *
 * The compiler stamps the result onto `WorkStep.modelId` / `CheckStep.modelId`
 * / `ReviewSpec.modelId` / `Pipeline.integrationModelId` ONLY where a policy
 * actually named a model — a resolved-to-fallback role must keep omitting the
 * field, so the orchestrator's own fallback stays the one authority.
 */
export function resolveDevModels(
  policy: DevModelPolicy | undefined,
  fallbackModelId: string,
  isKnown?: (id: string) => boolean,
): Record<DevModelRole, string> {
  const resolved = {} as Record<DevModelRole, string>;
  for (const role of DEV_MODEL_ROLES) {
    resolved[role] = pickModelRung(policy?.[role], isKnown) || fallbackModelId;
  }
  return resolved;
}

/**
 * The policy the COMPILER should stamp: every role collapsed to its surviving
 * rung, roles the policy never named still absent.
 *
 * Absent-stays-absent is the whole contract of the routing feature — a role the
 * policy does not name must keep OMITTING `modelId` so `AppConfig.modelId`
 * stays the single authority — so this cannot simply reuse
 * {@link resolveDevModels}, which fills every role with the fallback.
 */
export function collapseDevModelPolicy(
  policy: DevModelPolicy | undefined,
  isKnown?: (id: string) => boolean,
): DevModelPolicy | undefined {
  if (!policy) return undefined;
  const out: DevModelPolicy = {};
  for (const role of DEV_MODEL_ROLES) {
    const picked = pickModelRung(policy[role], isKnown);
    if (picked) out[role] = picked;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * The policy a surface should offer for `backend`, defaulting to the `hetero`
 * preset.
 *
 * Returns `{}` for `azure` and `stub`: every id in the presets is an
 * OpenRouter id served by the pi backend. Stamping `z-ai/glm-5.2` onto an
 * Azure deployment name — or onto the stub, which has no catalog at all —
 * would break a run that works fine today, so those backends keep the uniform
 * fallback behavior.
 *
 * The returned object is a fresh mutable copy; mutating it cannot corrupt
 * {@link DEV_MODEL_PRESETS}.
 */
export function defaultDevModelPolicy(
  backend: AgentBackendKind,
  preset: DevModelPreset = 'hetero',
): DevModelPolicy {
  if (backend !== 'pi') return {};
  return { ...DEV_MODEL_PRESETS[preset] };
}

/**
 * Defensive parse of an untrusted policy — it arrives in a POST body.
 *
 * Keeps only known roles carrying a non-empty string, trimmed; drops anything
 * else (unknown role, number, null, nested object, empty string) WITHOUT
 * throwing, because a malformed field must degrade to "no routing for that
 * role" rather than refuse the run. Iterating over the known roles instead of
 * the input's own keys also makes `__proto__`-style keys structurally
 * unreachable.
 */
export function parseDevModelPolicy(raw: unknown): DevModelPolicy {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const source = raw as Record<string, unknown>;
  const policy: DevModelPolicy = {};
  for (const role of DEV_MODEL_ROLES) {
    const value = source[role];
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (trimmed) policy[role] = trimmed;
  }
  return policy;
}

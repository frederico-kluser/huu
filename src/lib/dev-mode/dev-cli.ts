// `huu dev "<objetivo>"` — the headless entry point for development mode.
//
// Output discipline mirrors `headless-run.ts`: human-readable progress on
// stderr, ONE machine-readable JSON object on stdout at the end, exit 0 only
// when the session ended for a good reason (goal complete, or the epoch
// ceiling with every epoch landed).
//
// Kept out of `cli.tsx` on purpose — that file's module body has to stay
// cheap because the Docker re-exec gate runs at the top of it before the Ink
// imports load.
//
// Everything up to "start the session" is the PURE `parseDevCliArgs`: flags in,
// either a refusal message or a fully resolved option set out. That is what
// makes the compatibility promise testable — `--model=<id>` keeps its exact
// meaning of today (the fallback for every role nothing else routes) and the
// model-routing flags are additive on top of it.

import { createInterface } from 'node:readline';
import { resolve as resolvePath } from 'node:path';
import { findSpec, resolveApiKey } from '../api-key.js';
import { formatDevModelPreflightError, preflightDevModelPolicy } from '../model-registry-check.js';
import { selectBackend, type AgentBackendKind } from '../../orchestrator/backends/registry.js';
import {
  DEV_DEFAULT_MAX_EPOCHS,
  DEV_MAX_FRONTS,
  DEV_MODEL_PRESETS,
  type AppConfig,
  type DevMethodology,
  type DevModelPolicy,
  type DevModelPreset,
  type DevModelRole,
  type DevPlan,
  type DevState,
} from '../types.js';
import { DEV_MODEL_ROLES, defaultDevModelPolicy, resolveDevModels } from './dev-model-policy.js';
import {
  activeMethodologies,
  methodologyUsageBlock,
  parseMethodologyFlags,
} from './methodology-registry.js';
import { runDevMode, type DevEvent, type DevModeResult, type DevStopReason, type OrphanAction } from './dev-driver.js';
import type { OrphanBranch } from './orphan-branches.js';

export interface RunDevCliArgs {
  /** Argv after the `dev` subcommand, with CLI-global flags already filtered. */
  args: string[];
  cwd: string;
  /** Backend chosen via `--backend=` / `--provider=` / `--stub`; defaults to pi. */
  backend?: AgentBackendKind;
  concurrency?: number;
  autoScale?: boolean;
}

/**
 * Stop reasons that are a legitimate end of a session, not a failure.
 * `'consecutive-failures'` is deliberately NOT here: the circuit breaker only
 * trips when work stopped making progress, so it exits non-zero like every
 * other failure stop.
 */
const CLEAN_STOPS: ReadonlySet<DevStopReason> = new Set<DevStopReason>([
  'goal-complete',
  'max-epochs',
  'plan-rejected',
  // The ceiling the user ASKED for was honored. Exiting non-zero would report
  // "your budget worked" as a failure. Same for a requested graceful stop.
  'cost-ceiling',
  'graceful-stop',
]);

/**
 * Role → the flag that routes it. Typed as a total record so adding a
 * {@link DevModelRole} fails compilation HERE until the CLI grows its flag —
 * a role nobody can reach from the command line is a silent hole.
 */
export const DEV_MODEL_ROLE_FLAGS: Readonly<Record<DevModelRole, string>> = {
  planner: 'planner-model',
  recon: 'recon-model',
  worker: 'worker-model',
  critic: 'critic-model',
  reporter: 'reporter-model',
  judge: 'judge-model',
  integration: 'integration-model',
};

const PRESET_NAMES = Object.keys(DEV_MODEL_PRESETS) as DevModelPreset[];

function flagValue(args: readonly string[], name: string): string | undefined {
  const eq = args.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.slice(name.length + 3);
  const idx = args.indexOf(`--${name}`);
  if (idx >= 0 && args[idx + 1] && !args[idx + 1]!.startsWith('--')) return args[idx + 1];
  return undefined;
}

function positiveInt(raw: string | undefined, label: string): number | undefined {
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`huu dev: --${label} expects a positive integer (got "${raw}")`);
  }
  return n;
}

/** A money ceiling: any positive number, not necessarily an integer. */
function positiveNumber(raw: string | undefined, label: string): number | undefined {
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`huu dev: --${label} expects a positive number (got "${raw}")`);
  }
  return n;
}

function err(message: string): void {
  process.stderr.write(`${message}\n`);
}

/** Renders a plan for the approval gate — the human's only view of it. */
export function formatPlan(plan: DevPlan, epoch: number, warnings: readonly string[]): string {
  const lines: string[] = [
    '',
    `── Plano da época ${epoch} ${'─'.repeat(Math.max(0, 46 - String(epoch).length))}`,
    `  Objetivo da época: ${plan.epochGoal}`,
    `  Pronto quando:     ${plan.doneWhen}`,
    '',
  ];
  plan.fronts.forEach((front, i) => {
    const deps = front.dependsOnFronts.length > 0 ? ` (depois de: ${front.dependsOnFronts.join(', ')})` : ' (paralelo)';
    lines.push(`  ${i + 1}. ${front.title} [${front.id}]${deps}`);
    lines.push(`     ${front.rationale}`);
    lines.push(`     até ${front.maxTasks} agente(s) · juiz: ${front.verifyCondition.slice(0, 90)}`);
    lines.push('');
  });
  for (const w of warnings) lines.push(`  ⚠ plano ajustado: ${w}`);
  return lines.join('\n');
}

/**
 * The routing block of the opening summary: every role and the id it will
 * actually run on.
 *
 * All SEVEN roles are listed, including `planner`. It is the one id that does
 * NOT go through the pi registry (it is a structured-output call), which is
 * exactly why an operator needs to see it next to the six that do — otherwise
 * the one id the preflight deliberately cannot vouch for is also the one id
 * nobody is shown. Roles the policy does not name are marked as inheriting
 * `--model`, so "where does this id come from" is answerable from the output.
 */
export function formatModelRouting(
  resolved: Readonly<Record<DevModelRole, string>>,
  policy: DevModelPolicy | undefined,
  preset?: DevModelPreset,
): string {
  const width = Math.max(...DEV_MODEL_ROLES.map((r) => r.length));
  const lines = [`  roteamento de modelos${preset ? ` (preset ${preset})` : ''}:`];
  for (const role of DEV_MODEL_ROLES) {
    const routed = Boolean(policy?.[role]?.trim());
    const note = routed
      ? role === 'planner'
        ? '  ← orquestrador cego (structured output, fora do registry do pi)'
        : ''
      : '  ← --model';
    lines.push(`    ${role.padEnd(width)}  ${resolved[role]}${note}`);
  }
  return lines.join('\n');
}

/**
 * One y/N question on stdin. Non-interactive stdin answers NO, always, and
 * says why on stderr — a gate with no human on the other end must never
 * resolve to an implicit yes. Every caller here relies on that: no TTY means
 * no approval, no resume, and no orphan landing.
 */
async function confirm(question: string, nonTtyNote: string): Promise<boolean> {
  if (!process.stdin.isTTY) {
    err(nonTtyNote);
    return false;
  }
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = await new Promise<string>((res) => rl.question(`${question} [y/N] `, res));
    return /^(y|s|sim|yes)$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

/**
 * The resume gate. Offered only when the driver already matched the previous
 * session's goal to this one and found it unfinished; the CLI just decides
 * whether the human wants it. `--resume` skips this (the driver never asks),
 * `--no-resume` makes it unreachable.
 */
export async function offerResume(state: DevState, nextEpoch: number): Promise<boolean> {
  const done = state.epochs.length;
  const last = state.epochs[done - 1];
  err('');
  err(`── Sessão anterior encontrada ${'─'.repeat(34)}`);
  err(`  sessão: ${state.sessionId ?? '(sem id)'} · ${done} época(s) concluída(s) · próxima seria a ${nextEpoch}`);
  if (last) {
    err(
      `  última época: ${last.status}${last.landedCommit ? ` — aterrissou em ${last.landedCommit.slice(0, 8)}` : ''}${
        last.landingError ? ` — LANDING FALHOU: ${last.landingError}` : ''
      }`,
    );
  }
  err(`  objetivo: ${state.goal}`);
  return confirm(
    'Retomar essa sessão (continuando a numeração das épocas)?',
    'huu dev: sem terminal interativo — começando uma sessão NOVA (use --resume para retomar sem perguntar).',
  );
}

/**
 * The orphan-branch gate: integration branches from earlier runs that HEAD
 * never absorbed. `--land-orphans` answers `'land'` without asking; anything
 * else defaults to `'ignore'`, which only NAMES them. A forgotten branch is a
 * thing to report, never a thing that silently rewrites the working branch.
 */
export async function offerOrphanLanding(
  orphans: readonly OrphanBranch[],
  landOrphans: boolean,
): Promise<OrphanAction> {
  if (landOrphans) {
    err(`huu dev: --land-orphans — aterrissando ${orphans.length} branch(es) de integração órfão(s).`);
    return 'land';
  }
  err('');
  err(`── Branches de integração órfãos (${orphans.length}) ${'─'.repeat(24)}`);
  for (const orphan of orphans) {
    err(
      `  ${orphan.branch} — ${orphan.ahead} commit(s) que o HEAD não tem${
        orphan.epoch === undefined ? '' : ` · época ${orphan.epoch}`
      }`,
    );
  }
  const yes = await confirm(
    'Aterrissar esses branches (merge --no-ff) antes de começar?',
    'huu dev: sem terminal interativo — deixando os branches órfãos como estão (use --land-orphans para aterrissá-los).',
  );
  return yes ? 'land' : 'ignore';
}

function describeEvent(event: DevEvent): string | null {
  switch (event.type) {
    case 'knowledge':
      return `knowledge: ${event.status.present ? 'presente' : 'ausente'} — ${event.status.reason}`;
    case 'bootstrap-start':
      return `bootstrap de knowledge com pi (${event.model})…`;
    case 'bootstrap-done':
      return `bootstrap ${event.ok ? 'concluído' : 'FALHOU'}`;
    case 'bootstrap-progress':
      return null; // too noisy for the CLI
    case 'planning':
      return `planejando época ${event.epoch}…`;
    case 'planned':
      return `época ${event.epoch}: ${event.plan.fronts.length} frente(s) — ${event.plan.fronts.map((f) => f.id).join(', ')}`;
    case 'epoch-start':
      return `época ${event.epoch}: rodando ${event.pipeline.steps.length} passos`;
    case 'epoch-done':
      return `época ${event.record.epoch}: ${event.record.status}${
        event.record.landedCommit ? ` — aterrissou em ${event.record.landedCommit.slice(0, 8)}` : ''
      }${event.record.landingError ? ` — LANDING FALHOU: ${event.record.landingError}` : ''}`;
    case 'stopped':
      return `sessão encerrada: ${event.reason}${event.detail ? ` — ${event.detail}` : ''}`;
    case 'log':
      return event.level === 'info' ? null : `[${event.level}] ${event.message}`;
  }
}

/** Everything `runDevCli` needs from argv, already validated. */
export interface DevCliOptions {
  goal: string;
  /** Raw `--run-dir` value; unresolved so the parser stays free of path I/O. */
  runDir?: string;
  maxEpochs: number;
  maxFronts?: number;
  /** `--max-cost=<usd>`: stop the session before the epoch that would exceed it. */
  maxCostUsd?: number;
  approveEach: boolean;
  skipKnowledge: boolean;
  /** The run-level model: `--model`, or the routed `worker` when every role is routed. */
  modelId: string;
  /** Undefined when no routing flag was given — the compilers then omit `modelId` entirely. */
  models?: DevModelPolicy;
  /** The `--models=` preset, for the summary. */
  preset?: DevModelPreset;
  /**
   * The methodology checkboxes (`--tdd` & friends). Undefined when none was
   * given — NOT an empty object — so an unflagged session compiles exactly
   * the pipeline it compiles today, byte for byte. See {@link DevMethodology}.
   */
  methodology?: DevMethodology;
  resume?: 'auto' | 'never';
  landOrphans: boolean;
  /** Non-fatal notes to print before starting. */
  warnings: string[];
}

export type DevCliParse = { ok: true; options: DevCliOptions } | { ok: false; message: string };

const USAGE =
  'Usage: huu dev "<objetivo>" [--model=<id>] [--models=<' +
  PRESET_NAMES.join('|') +
  '>] [--worker-model=<id> …] [--epochs=<n>] [--fronts=<n>] [--max-cost=<usd>] [--run-dir=<path>] [--approve-each|--autonomous] [--skip-knowledge] [--resume|--no-resume] [--land-orphans] [--stub]\n' +
  methodologyUsageBlock();

/**
 * Reads the model-routing flags into a policy.
 *
 * The preset is the base and per-role flags override it, so
 * `--models=hetero --critic-model=x` means exactly what it reads like. No flag
 * at all returns `undefined` — NOT an empty object — because "no routing" has
 * to compile the pipeline huu compiles today, with `modelId` omitted from
 * every step so `AppConfig.modelId` stays the single authority.
 */
function parseModelFlags(
  args: readonly string[],
  backend: AgentBackendKind,
): { policy?: DevModelPolicy; preset?: DevModelPreset; warnings: string[] } | { error: string } {
  const warnings: string[] = [];
  const rawPreset = flagValue(args, 'models')?.trim();
  let preset: DevModelPreset | undefined;
  if (rawPreset !== undefined) {
    if (!PRESET_NAMES.includes(rawPreset as DevModelPreset)) {
      return { error: `huu dev: --models expects one of ${PRESET_NAMES.join(', ')} (got "${rawPreset}")` };
    }
    preset = rawPreset as DevModelPreset;
  }

  // `defaultDevModelPolicy` returns {} for azure/stub on purpose: every id in
  // the presets is an OpenRouter id served by pi. Say so instead of silently
  // dropping a flag the user typed.
  const policy: DevModelPolicy = preset ? defaultDevModelPolicy(backend, preset) : {};
  if (preset && backend !== 'pi' && Object.keys(policy).length === 0 && Object.keys(DEV_MODEL_PRESETS[preset]).length > 0) {
    warnings.push(
      `--models=${preset} ignorado no backend ${backend}: os ids do preset são da OpenRouter, servidos pelo backend pi.`,
    );
  }

  let anyRoleFlag = false;
  for (const role of DEV_MODEL_ROLES) {
    const flag = DEV_MODEL_ROLE_FLAGS[role];
    const raw = flagValue(args, flag);
    if (raw === undefined) continue;
    const id = raw.trim();
    if (!id) return { error: `huu dev: --${flag}=<id> expects a model id` };
    // Explicit per-role flags apply on ANY backend — unlike the preset, the
    // user named this id for this role, and an Azure deployment name in a
    // worker slot is a legitimate thing to want.
    policy[role] = id;
    anyRoleFlag = true;
  }

  if (!preset && !anyRoleFlag) return { warnings };
  return { policy, preset, warnings };
}

/**
 * Parse argv into a runnable option set, or into the message that refuses it.
 * Pure: no fs, no network, no process state — the whole surface the tests need.
 */
export function parseDevCliArgs(args: readonly string[], backend: AgentBackendKind = 'pi'): DevCliParse {
  const goal = args.find((a) => !a.startsWith('--'));
  if (!goal || goal.trim().length === 0) return { ok: false, message: USAGE };

  let maxEpochs: number | undefined;
  let maxFronts: number | undefined;
  let maxCostUsd: number | undefined;
  try {
    maxEpochs = positiveInt(flagValue(args, 'epochs'), 'epochs');
    maxFronts = positiveInt(flagValue(args, 'fronts'), 'fronts');
    maxCostUsd = positiveNumber(flagValue(args, 'max-cost'), 'max-cost');
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }

  const warnings: string[] = [];
  if (maxFronts !== undefined && maxFronts > DEV_MAX_FRONTS) {
    warnings.push(`--fronts is capped at ${DEV_MAX_FRONTS}; using ${DEV_MAX_FRONTS}.`);
    maxFronts = DEV_MAX_FRONTS;
  }

  const approveEach = args.includes('--approve-each');
  if (approveEach && args.includes('--autonomous')) {
    return { ok: false, message: 'huu dev: --approve-each and --autonomous are mutually exclusive.' };
  }

  const wantsResume = args.includes('--resume');
  const refusesResume = args.includes('--no-resume');
  if (wantsResume && refusesResume) {
    return { ok: false, message: 'huu dev: --resume and --no-resume are mutually exclusive.' };
  }

  const parsedModels = parseModelFlags(args, backend);
  if ('error' in parsedModels) return { ok: false, message: parsedModels.error };
  const { policy, preset } = parsedModels;
  warnings.push(...parsedModels.warnings);

  // `--model` keeps its exact meaning: the fallback for every role nothing
  // else routes. It only becomes optional once the routing covers EVERY role,
  // because the run-level model is still what an unstamped step and the
  // knowledge bootstrap run use — a session with no fallback at all would
  // start and then fail deep inside an agent.
  const explicitModel = flagValue(args, 'model')?.trim();
  let modelId = explicitModel || (backend === 'stub' ? 'stub-model' : '');
  if (!modelId) {
    const uncovered = DEV_MODEL_ROLES.filter((role) => !policy?.[role]?.trim());
    if (uncovered.length === 0) {
      // Fully routed: the worker's id is the honest run-level fallback — it is
      // the model that does the bulk of the work, including the knowledge
      // bootstrap swarm, which is not compiled from the plan.
      modelId = policy!.worker!;
    } else {
      return {
        ok: false,
        message:
          'huu dev: --model=<id> is required (or use --stub for a no-LLM dry run).' +
          (policy
            ? `\n  Model routing left ${uncovered.length} role(s) unrouted (${uncovered.join(', ')}); ` +
              '--model is only optional when every role carries an id.'
            : ''),
      };
    }
  }

  // Border preflight: an id the pi registry has never heard of throws inside
  // the first agent, AFTER its worktree and branch exist. `planner` is
  // deliberately never checked — it runs through the structured-output client
  // (LangChain → OpenRouter), not the pi registry, which is why the factory
  // default can route it to `z-ai/glm-5.2`, an id the registry does not carry.
  // Checking it would make huu refuse to start in its own default config.
  const issues = preflightDevModelPolicy(policy, backend);
  if (issues.length > 0) return { ok: false, message: `huu dev: ${formatDevModelPreflightError(issues)}` };

  const methodology = parseMethodologyFlags(args);

  return {
    ok: true,
    options: {
      goal: goal.trim(),
      runDir: flagValue(args, 'run-dir'),
      // The CLI keeps its documented default; `undefined` means UNBOUNDED in
      // the driver, and that belongs to the web surface (which has a live
      // Abort button), not to a headless invocation that may be unattended.
      maxEpochs: maxEpochs ?? DEV_DEFAULT_MAX_EPOCHS,
      maxFronts,
      ...(maxCostUsd !== undefined ? { maxCostUsd } : {}),
      approveEach,
      skipKnowledge: args.includes('--skip-knowledge'),
      modelId,
      ...(policy ? { models: policy } : {}),
      ...(preset ? { preset } : {}),
      ...(methodology ? { methodology } : {}),
      ...(wantsResume ? { resume: 'auto' as const } : refusesResume ? { resume: 'never' as const } : {}),
      landOrphans: args.includes('--land-orphans'),
      warnings,
    },
  };
}

/**
 * Parse + run. Returns the process exit code; never throws for a user error
 * (those print a usage line and return 1).
 */
export async function runDevCli(input: RunDevCliArgs): Promise<number> {
  const { args, cwd } = input;
  const backend: AgentBackendKind = input.backend ?? 'pi';

  const parsed = parseDevCliArgs(args, backend);
  if (!parsed.ok) {
    err(parsed.message);
    return 1;
  }
  const opts = parsed.options;
  for (const warning of opts.warnings) err(`huu dev: ${warning}`);

  const bundle = selectBackend(backend);

  let apiKey = '';
  let endpoint: string | undefined;
  if (bundle.requiresApiKey) {
    const specName = backend === 'azure' ? 'azureApiKey' : 'openrouter';
    const spec = findSpec(specName);
    if (spec) apiKey = resolveApiKey(spec);
    if (!apiKey) {
      err(
        `huu dev: the ${backend === 'azure' ? 'Azure AI Foundry' : 'OpenRouter'} provider requires an API key but ` +
          `${spec?.envVar ?? specName} is not set. Export it, mount a secret at ` +
          `${spec?.secretMountPath ?? '/run/secrets/<key>'}, or persist it via the TUI first.`,
      );
      return 1;
    }
    if (backend === 'azure') {
      const endpointSpec = findSpec('azureEndpoint');
      if (endpointSpec) endpoint = resolveApiKey(endpointSpec) || undefined;
      if (!endpoint) {
        err('huu dev: the Azure AI Foundry provider requires AZURE_OPENAI_BASE_URL. Export it or persist it via the TUI first.');
        return 1;
      }
    }
  }

  const config: AppConfig = {
    apiKey: apiKey || 'stub',
    modelId: opts.modelId,
    backend,
    provider: backend === 'azure' ? 'azure' : 'openrouter',
    endpoint,
  };

  const repoRoot = opts.runDir ? resolvePath(opts.runDir) : cwd;

  err(`huu dev — objetivo: ${opts.goal}`);
  err(`  repo: ${repoRoot} · modelo: ${opts.modelId} · backend: ${backend}`);
  err(
    `  épocas: até ${opts.maxEpochs} · frentes: até ${opts.maxFronts ?? DEV_MAX_FRONTS} · aprovação: ${
      opts.approveEach ? 'a cada época' : 'autônoma'
    } · resume: ${opts.resume ?? 'perguntar'}`,
  );
  err(formatModelRouting(resolveDevModels(opts.models, opts.modelId), opts.models, opts.preset));
  // Methodologies change what the run ENFORCES, so an operator reading stderr
  // has to be able to see which ones are on without reconstructing the command
  // line. Silent when none is on — that is the default and it needs no line.
  const activeMethods = activeMethodologies(opts.methodology);
  if (activeMethods.length > 0) {
    err(`  metodologias: ${activeMethods.map((d) => `--${d.flag}`).join(' ')}`);
  }

  let result: DevModeResult;
  try {
    result = await runDevMode({
      dev: {
        goal: opts.goal,
        approval: opts.approveEach ? 'each-epoch' : 'autonomous',
        maxEpochs: opts.maxEpochs,
        maxFronts: opts.maxFronts,
        skipKnowledgeBootstrap: opts.skipKnowledge,
        ...(opts.maxCostUsd !== undefined ? { maxCostUsd: opts.maxCostUsd } : {}),
        ...(opts.models ? { models: opts.models } : {}),
        ...(opts.methodology ? { methodology: opts.methodology } : {}),
      },
      config,
      cwd: repoRoot,
      agentFactory: bundle.agentFactory,
      conflictResolverFactory: bundle.conflictResolverFactory,
      concurrency: input.concurrency,
      autoScale: input.autoScale,
      ...(opts.resume ? { resume: opts.resume } : {}),
      onResumeOffer: offerResume,
      onOrphanBranches: (orphans) => offerOrphanLanding(orphans, opts.landOrphans),
      onEvent: (event) => {
        const line = describeEvent(event);
        if (line) err(`  ${line}`);
      },
      onApprove: async (plan, epoch, warnings) => {
        err(formatPlan(plan, epoch, warnings));
        return confirm(
          `Rodar a época ${epoch}?`,
          'huu dev: --approve-each precisa de um terminal interativo; encerrando sem rodar a época.',
        );
      },
    });
  } catch (e) {
    err(`huu dev: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }

  const landedAll = result.epochs.every((r) => r.landedCommit !== undefined);
  const ok = CLEAN_STOPS.has(result.stoppedBecause) && landedAll;

  err(`  sessão: ${result.sessionId}${result.resumed ? ' (retomada)' : ''} · épocas: ${result.epochs.length}`);

  process.stdout.write(
    `${JSON.stringify(
      {
        goal: opts.goal,
        stoppedBecause: result.stoppedBecause,
        detail: result.detail,
        goalComplete: result.goalComplete,
        knowledgeBootstrapped: result.knowledgeBootstrapped,
        sessionId: result.sessionId,
        resumed: result.resumed,
        epochs: result.epochs,
      },
      null,
      2,
    )}\n`,
  );

  return ok ? 0 : 1;
}

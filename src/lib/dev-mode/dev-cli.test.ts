// Contract tests for the `huu dev` command line.
//
// Two of these are compatibility PINS, not feature tests: `--model=<id>` alone
// must keep parsing exactly as it does today (no routing, no policy), and a
// bare invocation without it must keep the same refusal. Per-role routing is
// additive on top of that or it is a breaking change wearing a feature's hat.
//
// The third pin protects the factory default from its own preflight: the
// `hetero` preset routes `planner` to `z-ai/glm-5.2`, which the pi registry
// deliberately does NOT carry (the blind orchestrator is a structured-output
// call, not a pi agent). A preflight that checked `planner` would refuse to
// start huu in its default configuration.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEV_METHODOLOGIES, methodologyUsageBlock } from './methodology-registry.js';
import {
  DEV_MODEL_ROLE_FLAGS,
  formatModelRouting,
  formatPlan,
  offerOrphanLanding,
  offerResume,
  parseDevCliArgs,
  runDevCli,
} from './dev-cli.js';
import { runDevMode, type DevModeResult } from './dev-driver.js';
import { DEV_MODEL_ROLES, resolveDevModels } from './dev-model-policy.js';
import type { OrphanBranch } from './orphan-branches.js';
import {
  DEV_DEFAULT_MAX_EPOCHS,
  DEV_MAX_FRONTS,
  DEV_MODEL_PRESETS,
  type DevPlan,
  type DevState,
} from '../types.js';

// The driver's only runtime export the CLI consumes — stubbed so the
// `runDevCli` wiring tests can inspect the exact literal it is called with
// instead of booting a session.
vi.mock('./dev-driver.js', () => ({ runDevMode: vi.fn() }));

/** `parseDevCliArgs` or a thrown assertion — keeps the happy path unindented. */
function parseOk(args: string[], backend: 'pi' | 'stub' | 'azure' = 'pi') {
  const parsed = parseDevCliArgs(args, backend);
  if (!parsed.ok) throw new Error(`expected a parse, got refusal: ${parsed.message}`);
  return parsed.options;
}

function parseFail(args: string[], backend: 'pi' | 'stub' | 'azure' = 'pi'): string {
  const parsed = parseDevCliArgs(args, backend);
  if (parsed.ok) throw new Error('expected a refusal, got a parse');
  return parsed.message;
}

describe('parseDevCliArgs — compatibility with today', () => {
  it('parses the invocation that works today, with NO model policy at all', () => {
    const opts = parseOk(['fazer a coisa', '--model=deepseek/deepseek-v4-pro']);
    expect(opts.goal).toBe('fazer a coisa');
    expect(opts.modelId).toBe('deepseek/deepseek-v4-pro');
    // The whole compatibility promise: no routing flags ⇒ no policy ⇒ every
    // compiled step omits `modelId` and falls back to AppConfig.modelId.
    expect(opts.models).toBeUndefined();
    expect(opts.preset).toBeUndefined();
    expect(opts.methodology).toBeUndefined();
    expect(opts.approveEach).toBe(false);
    expect(opts.resume).toBeUndefined();
    expect(opts.landOrphans).toBe(false);
    expect(opts.maxEpochs).toBe(DEV_DEFAULT_MAX_EPOCHS);
    expect(opts.warnings).toEqual([]);
  });

  it('still refuses a run with no --model and no routing at all', () => {
    const message = parseFail(['fazer a coisa']);
    expect(message).toContain('--model=<id> is required');
    expect(message).toContain('--stub');
  });

  it('keeps --stub defaulting the model, and the other existing flags', () => {
    const opts = parseOk(
      ['fazer a coisa', '--epochs=2', '--fronts=2', '--approve-each', '--skip-knowledge', '--run-dir=/tmp/x'],
      'stub',
    );
    expect(opts.modelId).toBe('stub-model');
    expect(opts.maxEpochs).toBe(2);
    expect(opts.maxFronts).toBe(2);
    expect(opts.approveEach).toBe(true);
    expect(opts.skipKnowledge).toBe(true);
    expect(opts.runDir).toBe('/tmp/x');
  });

  it('rejects a non-positive --epochs and clamps --fronts with a warning', () => {
    expect(parseFail(['g', '--model=m', '--epochs=0'])).toContain('--epochs expects a positive integer');
    const opts = parseOk(['g', '--model=m', `--fronts=${DEV_MAX_FRONTS + 3}`]);
    expect(opts.maxFronts).toBe(DEV_MAX_FRONTS);
    expect(opts.warnings.join(' ')).toContain(`capped at ${DEV_MAX_FRONTS}`);
  });

  it('rejects mutually exclusive flags', () => {
    expect(parseFail(['g', '--model=m', '--approve-each', '--autonomous'])).toContain('mutually exclusive');
    expect(parseFail(['g', '--model=m', '--resume', '--no-resume'])).toContain('--resume and --no-resume');
  });

  it('documents every existing flag in the usage line', () => {
    const usage = parseFail([]);
    for (const flag of [
      '--model=',
      '--models=',
      '--worker-model=',
      '--epochs=',
      '--fronts=',
      '--run-dir=',
      '--approve-each',
      '--autonomous',
      '--skip-knowledge',
      '--resume',
      '--no-resume',
      '--land-orphans',
      '--stub',
      // Methodology flags come from the registry — the list cannot go stale.
      ...DEV_METHODOLOGIES.map((d) => `--${d.flag}`),
    ]) {
      expect(usage).toContain(flag);
    }
  });
});

describe('parseDevCliArgs — model routing', () => {
  it('applies a preset on its own', () => {
    const opts = parseOk(['g', '--model=fallback/one', '--models=hetero']);
    expect(opts.preset).toBe('hetero');
    expect(opts.models).toEqual(DEV_MODEL_PRESETS.hetero);
    // The preset is a copy — mutating it must not corrupt the shared table.
    opts.models!.worker = 'mutated';
    expect(DEV_MODEL_PRESETS.hetero.worker).not.toBe('mutated');
  });

  it('lets a per-role flag beat the preset, leaving every other role on it', () => {
    const opts = parseOk([
      'g',
      '--model=fallback/one',
      '--models=hetero',
      `--${DEV_MODEL_ROLE_FLAGS.critic}=deepseek/deepseek-v4-pro`,
    ]);
    expect(opts.models?.critic).toBe('deepseek/deepseek-v4-pro');
    expect(opts.models?.worker).toBe(DEV_MODEL_PRESETS.hetero.worker);
    expect(opts.models?.planner).toBe(DEV_MODEL_PRESETS.hetero.planner);
  });

  it('exposes a flag for every role, and reads each one', () => {
    const args = ['g'];
    for (const role of DEV_MODEL_ROLES) args.push(`--${DEV_MODEL_ROLE_FLAGS[role]}=deepseek/deepseek-v4-pro`);
    const opts = parseOk(args);
    for (const role of DEV_MODEL_ROLES) expect(opts.models?.[role], role).toBe('deepseek/deepseek-v4-pro');
  });

  it('makes --model OPTIONAL once a preset routes every role', () => {
    const opts = parseOk(['g', '--models=hetero']);
    expect(opts.models).toEqual(DEV_MODEL_PRESETS.hetero);
    // The run-level fallback still has to be a real id — an unstamped step and
    // the knowledge bootstrap run both use it. The worker's model is it.
    expect(opts.modelId).toBe(DEV_MODEL_PRESETS.hetero.worker);
  });

  it('keeps --model REQUIRED when routing leaves roles uncovered', () => {
    // `uniform` is the empty policy by definition: every role falls back.
    const uniform = parseFail(['g', '--models=uniform']);
    expect(uniform).toContain('--model=<id> is required');
    // A single role flag routes one role and leaves six with no model at all.
    const partial = parseFail(['g', `--${DEV_MODEL_ROLE_FLAGS.critic}=moonshotai/kimi-k2.6`]);
    expect(partial).toContain('--model=<id> is required');
    expect(partial).toContain('unrouted');
    expect(partial).toContain('worker');
  });

  it('rejects an unknown preset and an empty per-role id', () => {
    const bad = parseFail(['g', '--model=m', '--models=cheapest']);
    expect(bad).toContain('--models expects one of');
    for (const name of Object.keys(DEV_MODEL_PRESETS)) expect(bad).toContain(name);
    expect(parseFail(['g', '--model=m', `--${DEV_MODEL_ROLE_FLAGS.worker}=  `])).toContain('expects a model id');
  });

  it('drops a preset on a backend it cannot serve, and says so', () => {
    const opts = parseOk(['g', '--models=hetero'], 'stub');
    expect(opts.models).toEqual({});
    expect(opts.modelId).toBe('stub-model');
    expect(opts.warnings.join(' ')).toContain('--models=hetero ignorado');
  });
});

describe('parseDevCliArgs — pi registry preflight', () => {
  it('refuses an agent role whose id the pi registry does not know', () => {
    const message = parseFail(['g', '--model=deepseek/deepseek-v4-pro', `--${DEV_MODEL_ROLE_FLAGS.worker}=z-ai/glm-5.2`]);
    expect(message).toContain('worker');
    expect(message).toContain('z-ai/glm-5.2');
    // Actionable: it names the ids the registry does have nearby.
    expect(message).toContain('z-ai/glm-5.1');
  });

  it('does NOT check the planner — the pin that keeps the default preset startable', () => {
    // `z-ai/glm-5.2` is absent from the pi registry ON PURPOSE: the blind
    // orchestrator runs through LangChain → OpenRouter, never through pi.
    const opts = parseOk(['g', '--model=deepseek/deepseek-v4-pro', `--${DEV_MODEL_ROLE_FLAGS.planner}=z-ai/glm-5.2`]);
    expect(opts.models?.planner).toBe('z-ai/glm-5.2');
    // And the factory default carries exactly that id, so it must parse too.
    expect(DEV_MODEL_PRESETS.hetero.planner).toBe('z-ai/glm-5.2');
    expect(parseOk(['g', '--models=hetero']).models?.planner).toBe('z-ai/glm-5.2');
  });

  it('every shipped preset survives its own preflight', () => {
    for (const name of Object.keys(DEV_MODEL_PRESETS)) {
      const parsed = parseDevCliArgs(['g', '--model=deepseek/deepseek-v4-pro', `--models=${name}`], 'pi');
      expect(parsed.ok, `preset ${name}: ${parsed.ok ? '' : parsed.message}`).toBe(true);
    }
  });

  it('does not preflight non-pi backends against the pi registry', () => {
    const opts = parseOk(['g', `--${DEV_MODEL_ROLE_FLAGS.worker}=my-azure-deployment`, '--model=m'], 'azure');
    expect(opts.models?.worker).toBe('my-azure-deployment');
  });
});

describe('parseDevCliArgs — methodology flags', () => {
  // Driven from the registry so a new option cannot ship without a flag that
  // reaches the parser — the whole point of having one declaration surface.
  it('sets each key from its own flag, and ONLY that key', () => {
    for (const def of DEV_METHODOLOGIES) {
      expect(parseOk(['g', `--${def.flag}`], 'stub').methodology, def.flag).toEqual({
        [def.key]: true,
      });
    }
  });

  it('combines every flag into a single object', () => {
    const flags = DEV_METHODOLOGIES.map((d) => `--${d.flag}`);
    const opts = parseOk(['g', ...flags], 'stub');
    expect(opts.methodology).toEqual(Object.fromEntries(DEV_METHODOLOGIES.map((d) => [d.key, true])));
  });

  it('gives every option a UNIQUE key and flag', () => {
    expect(new Set(DEV_METHODOLOGIES.map((d) => d.key)).size).toBe(DEV_METHODOLOGIES.length);
    expect(new Set(DEV_METHODOLOGIES.map((d) => d.flag)).size).toBe(DEV_METHODOLOGIES.length);
  });

  it('lists every flag in the usage text, with a gap after the longest one', () => {
    const usage = methodologyUsageBlock();
    for (const def of DEV_METHODOLOGIES) {
      expect(usage, def.flag).toContain(`--${def.flag}`);
      expect(usage, def.flag).toContain(def.usage);
    }
    // The description column never collides with the flag column.
    for (const line of usage.split('\n').slice(1)) {
      expect(line, line).toMatch(/^ {4}--[a-z-]+ {2,}\S/);
    }
  });

  it('leaves methodology UNDEFINED without any flag — the byte-identical promise', () => {
    // NOT `{}`: a session that asks for none of this must compile exactly the
    // pipeline huu compiles today (same contract as `models`).
    expect(parseOk(['g'], 'stub').methodology).toBeUndefined();
    expect(parseOk(['fazer a coisa', '--model=deepseek/deepseek-v4-pro']).methodology).toBeUndefined();
  });
});

describe('formatPlan', () => {
  const plan: DevPlan = {
    epochGoal: 'entregar o CLI',
    doneWhen: 'os testes passam',
    goalComplete: false,
    fronts: [
      {
        id: 'cli',
        title: 'Superfície de linha de comando',
        rationale: 'porque as flags moram aqui',
        dependsOnFronts: [],
        reconPrompt: 'mapeie',
        workPrompt: 'implemente',
        verifyCondition: 'tsc limpo',
        maxTasks: 3,
      },
      {
        id: 'docs',
        title: 'Documentação',
        rationale: 'para o humano entender',
        dependsOnFronts: ['cli'],
        reconPrompt: 'mapeie',
        workPrompt: 'escreva',
        verifyCondition: 'sem link quebrado',
        maxTasks: 1,
      },
    ],
  };

  it('renders the epoch header, both fronts and their dependency shape', () => {
    const out = formatPlan(plan, 2, ['uma frente foi reparada']);
    expect(out).toContain('── Plano da época 2');
    expect(out).toContain('Objetivo da época: entregar o CLI');
    expect(out).toContain('Pronto quando:     os testes passam');
    expect(out).toContain('1. Superfície de linha de comando [cli] (paralelo)');
    expect(out).toContain('2. Documentação [docs] (depois de: cli)');
    expect(out).toContain('até 3 agente(s) · juiz: tsc limpo');
    expect(out).toContain('⚠ plano ajustado: uma frente foi reparada');
  });
});

describe('formatModelRouting', () => {
  it('lists every role with its effective id, marking the ones on --model', () => {
    const policy = { ...DEV_MODEL_PRESETS.hetero };
    const block = formatModelRouting(resolveDevModels(policy, 'fallback/one'), policy, 'hetero');
    expect(block).toContain('preset hetero');
    for (const role of DEV_MODEL_ROLES) expect(block, role).toContain(role);
    expect(block).toContain(DEV_MODEL_PRESETS.hetero.critic);
    // The planner id is shown WITH the reason it is exempt from the preflight.
    expect(block).toContain('structured output');
    expect(block).not.toContain('← --model');

    const uniform = formatModelRouting(resolveDevModels(undefined, 'fallback/one'), undefined);
    expect(uniform.match(/← --model/g)).toHaveLength(DEV_MODEL_ROLES.length);
    expect(uniform).not.toContain('preset');
  });
});

describe('interactive gates with no TTY', () => {
  const originalIsTTY = process.stdin.isTTY;
  let originalWrite: typeof process.stderr.write;
  let stderr: string[];

  beforeEach(() => {
    stderr = [];
    originalWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: unknown): boolean => {
      stderr.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;
    // Forced, not assumed: a test that BLOCKED on a real prompt would be worse
    // than a failing one.
    process.stdin.isTTY = false;
  });

  afterEach(() => {
    process.stderr.write = originalWrite;
    process.stdin.isTTY = originalIsTTY;
  });

  const state: DevState = {
    _format: 'huu-devstate-v2',
    goal: 'fazer a coisa',
    doneWhen: 'pronto',
    goalComplete: false,
    updatedAt: '2026-07-28T00:00:00.000Z',
    sessionId: 'abc123',
    epochs: [
      {
        epoch: 1,
        runId: 'r1',
        epochGoal: 'primeira',
        frontIds: ['cli'],
        status: 'done',
        landedCommit: 'deadbeefcafe',
        startedAt: '2026-07-28T00:00:00.000Z',
        finishedAt: '2026-07-28T00:10:00.000Z',
      },
    ],
  };

  const orphans: OrphanBranch[] = [
    { branch: 'huu/r1/integration', runId: 'r1', ahead: 3, epoch: 1 },
    { branch: 'huu/r2/integration', runId: 'r2', ahead: 1 },
  ];

  it('answers NO to the resume offer, and says why', async () => {
    await expect(offerResume(state, 2)).resolves.toBe(false);
    const out = stderr.join('');
    expect(out).toContain('sem terminal interativo');
    expect(out).toContain('--resume');
    // It still shows what it found — a refused offer must not hide the session.
    expect(out).toContain('abc123');
    expect(out).toContain('fazer a coisa');
  });

  it("answers 'ignore' for orphan branches, naming each one", async () => {
    await expect(offerOrphanLanding(orphans, false)).resolves.toBe('ignore');
    const out = stderr.join('');
    expect(out).toContain('huu/r1/integration');
    expect(out).toContain('huu/r2/integration');
    expect(out).toContain('--land-orphans');
  });

  it("honors --land-orphans without asking anything", async () => {
    await expect(offerOrphanLanding(orphans, true)).resolves.toBe('land');
    expect(stderr.join('')).toContain('--land-orphans');
  });
});

describe('runDevCli — the dev: literal carries the methodology', () => {
  const RESULT: DevModeResult = {
    stoppedBecause: 'max-epochs',
    epochs: [],
    goalComplete: false,
    knowledge: { present: false, skillCount: 0, skills: [], bootstrapMode: 'create', reason: 'sem skills' },
    knowledgeBootstrapped: false,
    sessionId: 'sess-test',
    resumed: false,
  };

  let originalStdout: typeof process.stdout.write;
  let originalStderr: typeof process.stderr.write;

  beforeEach(() => {
    vi.mocked(runDevMode).mockReset();
    vi.mocked(runDevMode).mockResolvedValue(RESULT);
    // runDevCli reports progress on stderr and emits its JSON verdict on
    // stdout — both captured so the wiring test stays silent.
    originalStdout = process.stdout.write.bind(process.stdout);
    originalStderr = process.stderr.write.bind(process.stderr);
    process.stdout.write = (() => true) as typeof process.stdout.write;
    process.stderr.write = (() => true) as typeof process.stderr.write;
  });

  afterEach(() => {
    process.stdout.write = originalStdout;
    process.stderr.write = originalStderr;
  });

  it('passes the parsed methodology through to runDevMode', async () => {
    const code = await runDevCli({
      args: ['g', '--tdd', '--lint-gate', '--standards', '--plan-review'],
      cwd: process.cwd(),
      backend: 'stub',
    });
    expect(code).toBe(0);
    const args = vi.mocked(runDevMode).mock.calls[0]?.[0];
    expect(args?.dev.methodology).toEqual({ tdd: true, lintGate: true, standards: true, planReview: true });
  });

  it('omits methodology from the literal entirely when no flag was given', async () => {
    const code = await runDevCli({ args: ['g'], cwd: process.cwd(), backend: 'stub' });
    expect(code).toBe(0);
    const args = vi.mocked(runDevMode).mock.calls[0]?.[0];
    // Not `undefined` under the key — NO key at all, so the compiled pipeline
    // stays byte-identical to the one huu compiles today.
    expect(args?.dev).not.toHaveProperty('methodology');
  });

  // The circuit breaker is NOT a clean stop: it only trips when work stopped
  // making progress, so it exits non-zero like every other failure — even
  // when every executed epoch happened to land its partial work.
  it('exits non-zero on consecutive-failures, even with every epoch landed', async () => {
    vi.mocked(runDevMode).mockResolvedValue({
      ...RESULT,
      stoppedBecause: 'consecutive-failures',
      epochs: [
        {
          epoch: 1,
          runId: 'run-1',
          epochGoal: 'fatia 1',
          frontIds: ['a'],
          status: 'done',
          landedCommit: 'deadbeef',
          startedAt: '2026-07-01T00:00:00.000Z',
          finishedAt: '2026-07-01T01:00:00.000Z',
        },
      ],
    });

    const code = await runDevCli({ args: ['g'], cwd: process.cwd(), backend: 'stub' });
    expect(code).toBe(1);
  });
});

describe('--max-cost', () => {
  const MODEL = '--model=deepseek/deepseek-v4-pro';

  it('accepts a dollar ceiling', () => {
    expect(parseOk(['goal', MODEL, '--max-cost=12.50']).maxCostUsd).toBe(12.5);
  });

  it('refuses a non-positive ceiling instead of silently ignoring it', () => {
    // A ceiling that parses to nothing is worse than no ceiling: the operator
    // believes they set a bound and the session runs unbounded.
    for (const bad of ['0', '-1', 'abc']) {
      expect(parseFail(['goal', MODEL, `--max-cost=${bad}`])).toContain('--max-cost');
    }
  });

  it('is absent by default — no ceiling is still the default', () => {
    expect(parseOk(['goal', MODEL]).maxCostUsd).toBeUndefined();
  });
});

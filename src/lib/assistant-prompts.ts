import type { ModelEntry } from '../contracts/models.js';

/**
 * Stable marker phrase used in the parallelization MASTER RULE block.
 * Exported so tests can assert presence without coupling to surrounding
 * prose copy-edits.
 */
export const PARALLEL_RULE_SHORT = 'N independent → per-file. 1 shared → project';

/**
 * Shared scope/memory/dependsOn doctrine — used by the interview system
 * prompt (phase A) AND by the architect's sketch/expansion prompts so the
 * rules never drift between phases.
 */
export const SCOPE_AND_LINKS_GUIDE = `# How to choose the "scope" of each step

MASTER RULE: huu's main feature is running N agents in parallel inside a per-file step. Whenever the step's work decomposes into independent units per file, CHOOSE per-file — parallelism is the default, project is the fallback. If you are unsure between the two, ask: "does this step produce N independent artifacts (one per file) or 1 shared artifact?". ${PARALLEL_RULE_SHORT}.

- "per-file": the step runs ONCE PER SELECTED FILE, in parallel (N simultaneous agents in isolated git worktrees). Use whenever the task fans out per file: create/update unit tests per module, generate JSDoc/docstring per file, apply the same lint rule, translate comments, add a header, migrate import/syntax file-by-file, refactor local boilerplate. CRITICAL VERB DISTINCTION: "RUN the test suite / build / lint" is project (1 command, single global output); "CREATE/WRITE tests for each file" is per-file (1 agent per source file). Same principle: "generate coverage report" is project; "write tests to raise coverage" is per-file.
- "project": the step runs ONCE on the whole project. ONE agent, sees the entire repo. Use when the task requires cross-file context (architecture refactor, move symbols between modules, rename an API with callers everywhere), depends on global state (install deps, configure tooling, run build/test/lint), or produces a SINGLE artifact (edit README, add a badge, write an ADR, generate changelog, update package.json).
- "flexible": legacy — only use if the user explicitly wants to decide case-by-case later. PREFER "project" or "per-file" when inference is possible.
- "memory": the file set is DISCOVERED BY AN EARLIER STEP at run time. Emit a PAIR: the producer step declares "produces": "<path>" (e.g. ".huu/memory/targets.json") and the memory step declares "filesFrom" with the SAME path; one agent per listed path, $hint carries the producer's per-file note. CRITICAL RULE: NEVER write file-format boilerplate in the producer's prompt — huu appends the exact MEMORY CONTRACT (path + JSON format + cap + hint rule) to it at run time; the producer's prompt should only say WHAT to look for and that each pick needs a one-line why. Use for scan→fix, recon→study, rank→refactor shapes where the user should NOT hand-pick files. A memory step can never be the first step.
- "dependsOn" (parallel waves): independent branches declare dependsOn on their shared predecessor and a join step declares dependsOn on all branches (a DIAMOND); any dependsOn switches the run to deterministic waves. Dependencies may only point to EARLIER steps; loops use check outcomes (activation), never dependsOn. Do NOT serialize independent branches into a chain.

ANTI-PATTERNS (do not commit):
- per-file on a step that produces ONE shared artifact (badge, README, ADR, root config) — with no N input files, per-file becomes "1 agent, no $file" and parallelism doesn't happen. Single-artifact is ALWAYS project.
- project on a step whose work is clearly file-by-file and independent (e.g.: "create unit tests", "add JSDoc to each export") — you're throwing the platform's parallelism away on purpose.
- Collapsing multiple phases into one step to "simplify" — if the user described N distinct phases (setup → creation → verification), produce N steps. Each step has independent scope.

THE FILE LIST IS NOT YOUR RESPONSIBILITY. The user selects files later in the pipeline editor. Do not ask about paths.`;

/** Shared rules for writing a final step prompt (phase A finalize + phase D expansion). */
export const STEP_PROMPT_GUIDE = `# How to write a good step "prompt"

- Plain text (light markdown allowed). Direct and specific — the agent cannot ask for clarification.
- For scope="per-file", use the literal token $file in the prompt — the orchestrator substitutes the real path per agent. Do NOT mention specific files.
- For scope="memory", use $file AND $hint (the producer's one-line note about this file).
- For scope="project", DO NOT use $file (no substitution). Quote paths only if the user mentioned them.
- Include acceptance criteria when relevant.`;

export interface AssistantPromptContext {
  /**
   * Catalog of recommended models the assistant can pick from when assigning
   * `modelId` to a step. Empty list = the assistant should leave `modelId`
   * unset and let the run-time model picker decide.
   */
  models: readonly ModelEntry[];
  /**
   * Optional pre-flight reconnaissance findings produced by the recon agents
   * (see `project-recon.ts`). When provided, rendered as a "Project context"
   * section near the top of the prompt so the assistant can ask
   * project-specific questions instead of generic ones. Pass an empty string
   * (or omit) to skip the section entirely.
   */
  reconContext?: string;
}

/**
 * The assistant's job: interview the user ONLY when needed until it can
 * synthesize a `Pipeline` for the huu orchestrator. Each turn returns either
 * a multiple-choice question (last option always a free-text fallback) or
 * the final pipeline. Zero questions is a valid path — if the intent +
 * recon already answer everything in the sufficiency checklist, the assistant
 * MUST finalize on the first turn.
 */
export function buildAssistantSystemPrompt(ctx: AssistantPromptContext): string {
  const modelCatalog = ctx.models.length
    ? ctx.models
        .map((m) => {
          const price =
            m.inputPrice !== undefined && m.outputPrice !== undefined
              ? ` (in $${m.inputPrice}/M, out $${m.outputPrice}/M)`
              : '';
          const tier = m.tier ? ` · tier: ${m.tier}` : '';
          const tags =
            m.bestFor && m.bestFor.length > 0
              ? ` · bestFor: ${m.bestFor.join(', ')}`
              : '';
          const description = m.description ? `\n    ${m.description}` : '';
          return `- \`${m.id}\` — ${m.label}${price}${tier}${tags}${description}`;
        })
        .join('\n')
    : '(empty catalog — leave modelId empty for every step)';

  // Group recommended models by primary use-case for a quick decision matrix.
  const byUseCase = new Map<string, string[]>();
  for (const m of ctx.models) {
    if (!m.bestFor || m.bestFor.length === 0) continue;
    for (const tag of m.bestFor) {
      const list = byUseCase.get(tag) ?? [];
      list.push(m.id);
      byUseCase.set(tag, list);
    }
  }
  const matrixLine = (tag: string, label: string): string => {
    const ids = byUseCase.get(tag) ?? [];
    if (ids.length === 0) return '';
    return `- ${label}: ${ids.map((id) => `\`${id}\``).join(', ')}`;
  };
  const matrixLines = [
    matrixLine('coding', 'Heavy coding / multi-file refactor'),
    matrixLine('reasoning', 'Mathematical / logical reasoning'),
    matrixLine('agentic', 'Agentic with tools / long context'),
    matrixLine('fast', 'Fast & cheap (per-file fan-out, lint, rename)'),
    matrixLine('cheap', 'Cheap workhorse (simple, cost-sensitive steps)'),
    matrixLine('general', 'General-purpose flagship (everything, but expensive)'),
  ].filter((s) => s.length > 0);
  const decisionMatrix = matrixLines.length > 0 ? matrixLines.join('\n') : '';

  const reconBlock =
    ctx.reconContext && ctx.reconContext.trim().length > 0
      ? `

# Project context (discovered before the interview)

Before this conversation, reconnaissance agents analyzed the project in parallel and surfaced the following facts. USE THEM to ask project-specific questions and AVOID asking things already answered here:

${ctx.reconContext.trim()}
`
      : '';

  return `You are the huu "Pipeline assistant" — an orchestrator for LLM agents running in parallel git worktrees. Your job: gather enough context from the user (in ENGLISH) by asking the MINIMUM number of questions (including zero) and then return an executable pipeline.
${reconBlock}
# How you respond

Every response is structured JSON in ONE of two shapes:

(A) Multiple-choice question — when critical context is STILL missing:
{
  "done": false,
  "question": "<short, direct question, in English>",
  "rationale": "<optional, max 200 chars: why you are asking this>",
  "options": [
    { "label": "<option 1 — concrete>" },
    { "label": "<option 2 — concrete>" },
    { "label": "<option 3 — concrete, optional>" },
    { "label": "Other (type it)", "isFreeText": true }
  ]
}

OPTION RULES:
- Minimum 2, maximum 5 options.
- The LAST option ALWAYS has "isFreeText": true with a label like "Other (type it)" or "None of these — explain".
- EXACTLY one option carries isFreeText.
- Each option is a CONCRETE choice, not a placeholder ("e.g.: leave default").
- Do not repeat options already picked in earlier turns.

(B) Final pipeline — when you ALREADY have enough context (see checklist below):
{
  "done": true,
  "pipeline": {
    "name": "<short kebab-case, max 80 chars>",
    "steps": [
      {
        "name": "<step name, max 80 chars>",
        "prompt": "<actionable prompt the agent will execute>",
        "scope": "project" | "per-file" | "flexible" | "memory",
        "filesFrom": "<memory scope ONLY: repo-relative path of the memory file an EARLIER step produces>",
        "produces": "<producer side of a memory link ONLY: the path this step promises to write — huu appends the exact file-format contract to its prompt at run time>",
        "dependsOn": ["<EARLIER step names this one waits for — omit for the default chain; [] = root. ANY dependsOn switches the run to deterministic parallel waves>"],
        "modelId": "<an id from the catalog below, optional>"
      }
    ]
  }
}

# When you ALREADY have enough information — STOP ASKING

Before each question, run this internal check. If EVERY item is answered by what you already know (initial intent + project context + earlier answers), return (B) IMMEDIATELY — do not ask for confirmation, do not announce that you will finalize.

SUFFICIENCY CHECKLIST (3 items — ALL must be answered):
1. **Concrete and actionable GOAL**: can you write a prompt that an agent executes without needing further clarification? Is there a clear "done" criterion? (Not vague: "refactor module X from Y to Z because W".)
2. **DECOMPOSITION**: you know how many steps the pipeline has and in what order. (1 step is a valid answer.)
3. **SCOPE per step**: for each step, you decided between "project" (1 agent sees the whole repo) or "per-file" (N agents in parallel, one per file). If the task type makes the scope obvious, INFER — do not ask. Strong default: WHENEVER the work of a step decomposes naturally per file/module (write unit tests, add JSDoc, translate comments, migrate import file-by-file, apply the same local transform), pick per-file. Project is the fallback, not the default.

Details like modelId, pipeline name, fine ordering of the prompt — you DEDUCE. Do not ask.

# Counter-factual rule — DO NOT ask useless questions

Before every question, simulate: "for EACH option I am about to offer, which pipeline would I return?" If ALL options lead to essentially the same pipeline, DO NOT ask — finalize. Only ask when different answers materially change the result (number of steps, order, scope, or one step's prompt).

# Typical scenarios

- Specific intent ("run prettier on src/**/*.ts") + recon shows prettier is configured → ZERO questions. Finalize with 1 step, per-file scope, prompt using $file.
- Multi-phase intent with natural fan-out in the middle ("set up vitest, write tests for each module, add a coverage badge to README") → 3 sequential steps, do NOT collapse into 1 or 2: (a) setup project (installs+configures tooling), (b) create-tests per-file (N parallel agents, one per source file, prompt uses $file), (c) add-badge project (edits 1 README). Collapsing the per-file creation phase into a single project step throws away parallelism — that's the most expensive mistake you can make.
- Discover-then-act intent ("audit performance and fix only the slow files", "find every X and migrate it") → a memory PAIR: (a) discover project step with "produces": ".huu/memory/targets.json" (prompt says what qualifies + that every pick needs a one-line why; NO format boilerplate — huu appends the contract), (b) act step with scope "memory" + "filesFrom" on the same path, prompt using $file and $hint. The user picks NOTHING by hand — that is the point.
- INDEPENDENT analyses intent ("run a lint pass, a security pass and a docs pass, then consolidate") → a DIAMOND via dependsOn: setup step with "dependsOn": [], each independent branch with "dependsOn": ["<setup>"] (they run IN PARALLEL in one wave), and a join step with "dependsOn": [all branches] whose prompt combines the results. Do NOT serialize independent branches into a chain — that throws away wave parallelism. Loops still use check outcomes (activation), never dependsOn.
- Specific intent but with a genuine open decision ("refactor authentication" without saying whether they want 1 big PR or incremental steps) → 1-2 questions to nail the decomposition.
- Vague intent ("improve the code") → 2-4 questions to extract a concrete goal + scope. Lead with the MOST IMPACTFUL one (the one that changes the pipeline the most).
- Complex pipeline (5+ steps with dependencies) → up to 4-6 questions. But only ask while each new answer can still change the pipeline; the moment the checklist closes, finalize.

There is no fixed question limit, but each question has friction cost. Ask the minimum. Don't ask for completeness — ask only where missing context blocks you from writing the pipeline.

# What a huu pipeline is

A pipeline has 1+ steps run in SERIES. Each step decomposes into N tasks run in PARALLEL in isolated git worktrees; at the end of the step the branches are merged into a central worktree. The next step starts from that merge.

${SCOPE_AND_LINKS_GUIDE}

${STEP_PROMPT_GUIDE}

# Available models catalog

You can assign a "modelId" per step from this list. Each entry has ID, label, price, tier and \`bestFor\` tags (scenarios where the model shines) followed by a description line:

${modelCatalog}
${decisionMatrix ? `\n# Recommended model per scenario\n\n${decisionMatrix}\n` : ''}
Selection guidelines:
- \`moonshotai/kimi-k2.6\` — for steps that demand THOUGHT: heavy coding, multi-file refactor, reasoning, dense logic, complex planning, cross-file context.
- \`minimax/minimax-m2.7\` — for SIMPLE steps: per-file fan-out, lint, rename, JSDoc, translate, boilerplate, mechanical/repetitive tasks.
- Entries tagged \`planning\` are for the ASSISTANT/ARCHITECT itself, not for pipeline steps — never assign them to a step.
- ALWAYS assign a modelId to every step. Rule: if the step is simple/mechanical/per-file → minimax. If it demands reasoning/creativity/cross-file vision → kimi.
- Never leave modelId empty.

# Tone

Clear, professional English. No emojis. No fluff. Ask ONE thing per turn. Do not ask about files, pipeline name, timeouts, retries, or whether the user wants to run — the user approves later.`;
}

/**
 * Message injected into the history when the user has consumed the safety
 * question budget (internal cap, not exposed in the prompt). Forces the next
 * response to be `done: true`. The cap exists only to avoid pathological
 * loops — in normal use the model finalizes well before via the sufficiency
 * checklist.
 */
export const FORCE_DONE_NUDGE = `You have reached the question limit. Synthesize the final pipeline now based on what has already been discussed, returning a response in the (B) format with "done": true. Do not ask any more questions.`;

// --- Architect flow prompts (sketch → select → expand → fix) --------------

export interface ArchitectLens {
  id: string;
  title: string;
  directive: string;
}

/**
 * Three deliberately DIFFERENT design lenses — diversity is what makes
 * best-of-N selection beat single-shot (research: parallel diverse
 * candidates + generative selection > one attempt iterated).
 */
export const ARCHITECT_LENSES: ArchitectLens[] = [
  {
    id: 'parallelism',
    title: 'maximize-parallelism',
    directive:
      'Squeeze every independent unit of work into fan-out and waves: per-file/memory wherever work decomposes per file, dependsOn diamonds wherever branches are independent, joins only where results genuinely combine. Wall-clock latency is the enemy.',
  },
  {
    id: 'cost',
    title: 'minimize-cost',
    directive:
      'The fewest steps and fewest agent invocations that still honour the goal completely. Merge only what is TRULY shared, prefer narrow blast radii, add checks only where a wrong result is expensive to discover late.',
  },
  {
    id: 'verifiability',
    title: 'maximize-verifiability',
    directive:
      'Gate every consequential phase: discovery feeds memory pairs (auditable lists with hints), check steps with objectively checkable conditions guard the transitions, every check has a safe FORWARD default and a bounded maxRuns. Trust is built mechanically, not by hope.',
  },
];

const BLUEPRINT_SHAPE = `Each step: { "name", "type": "work"|"check", "summary" (<=300 chars — WHAT it does, NOT the final prompt), "scope" (work), "produces"/"filesFrom" (memory pairs), "dependsOn" (waves), "condition"+"outcomes"+"maxRuns" (checks; EXACTLY one outcome with "default": true pointing FORWARD) }.`;

/** Phase B: one structural sketch under a lens (call 3× in parallel, temp ~0.7). */
export function buildSketchPrompt(args: {
  lens: ArchitectLens;
  intent: string;
  transcript: string;
  reconContext?: string;
  baselineJson?: string;
}): string {
  const recon = args.reconContext?.trim()
    ? `\n# Project context (from recon agents)\n\n${args.reconContext.trim()}\n`
    : '';
  const baseline = args.baselineJson
    ? `\n# Interviewer baseline (candidate 0)\n\nThe interviewing assistant sketched this pipeline. Treat it as ONE perspective — diverge from it wherever your lens demands; do not copy it:\n${args.baselineJson}\n`
    : '';
  return `You are a pipeline ARCHITECT for huu (LLM agents in parallel git worktrees). Produce ONE structural blueprint of the pipeline — names, shapes and links only. Final prompts are written later by another phase; your "summary" fields describe intent, not wording.

# Your design lens: ${args.lens.title}
${args.lens.directive}
${recon}${baseline}
# The user's goal

${args.intent.trim()}

# Interview answers (verbatim)

${args.transcript.trim() || '(no questions were needed)'}

${SCOPE_AND_LINKS_GUIDE}

# Output

A single blueprint. ${BLUEPRINT_SHAPE}
Rules: 1-20 steps; dependsOn only references EARLIER steps; a memory step's filesFrom matches an earlier step's produces; never put format boilerplate in summaries; name steps imperatively and uniquely.`;
}

/**
 * Phase C: generative selection (GenSelect) + light fusion. The selector
 * COMPARES candidates against a mechanical rubric — it never rewrites from
 * scratch (research: comparison beats scoring; rewriting reintroduces
 * single-shot risk).
 */
export function buildSelectorPrompt(args: { intent: string; candidatesJson: string }): string {
  return `You are the SELECTOR in huu's pipeline-architect flow. Several independent blueprints for the same goal follow. Compare them and produce the final fused blueprint.

# The user's goal

${args.intent.trim()}

# Candidates (JSON array; index 0 may be the interviewer baseline)

${args.candidatesJson}

# Mechanical rubric — judge candidates against THESE aspects, in order

1. No collapsed fan-out: work that decomposes per file is per-file or memory, never a single project step.
2. Discovery feeds action through a memory PAIR (produces on the discoverer, filesFrom on the actor, same path).
3. Independent branches form a dependsOn DIAMOND (parallel wave + join), never an artificial chain.
4. Every check has an objectively checkable condition, EXACTLY one default:true outcome pointing FORWARD, and a bounded maxRuns.
5. No per-file scope on single-artifact steps (README, badge, config).
6. dependsOn only references earlier steps; memory steps are never first.
7. Step count is proportionate to the goal (prefer <=12 unless the goal truly demands more).

# Your output

Pick the strongest candidate as "winner" (index). GRAFT at most small, specific ideas from the losers (each graft <=200 chars, recorded in "grafts"). Output the fused blueprint in "steps" — minimal edits to the winner, never a rewrite. ${BLUEPRINT_SHAPE}
Also assign a "modelId" to every WORK step: \`minimax/minimax-m2.7\` for simple/mechanical/per-file work, \`moonshotai/kimi-k2.6\` for reasoning/cross-file work. Keep "reasoning" <=600 chars.`;
}

/** Phase D: write the FINAL prompt for one work step (call N× in parallel, temp ~0.2). */
export function buildStepExpansionPrompt(args: {
  intent: string;
  reconContext?: string;
  blueprintOutline: string;
  stepJson: string;
}): string {
  const recon = args.reconContext?.trim()
    ? `\n# Project context (from recon agents)\n\n${args.reconContext.trim()}\n`
    : '';
  return `You write the FINAL agent prompt for ONE step of a huu pipeline. The blueprint is fixed — do not change names, scopes or links; your only output is this step's prompt text.

# The user's goal

${args.intent.trim()}
${recon}
# The whole blueprint (for context — one line per step)

${args.blueprintOutline}

# The step you are writing the prompt for

${args.stepJson}

${STEP_PROMPT_GUIDE}

Extra rules for this phase:
- If the step has "produces": say WHAT qualifies for the list and that every pick needs a one-line why — NO file-format boilerplate (huu appends the exact MEMORY CONTRACT at run time).
- If the step is part of an audit/report flow: include the REPORT-ONLY discipline (write only to the report path; touch nothing else).
- The agent cannot ask questions: include concrete acceptance criteria.`;
}

/** Phase E: single mechanically-guided fix (zod/topology errors verbatim). */
export function buildArchitectFixPrompt(args: { pipelineJson: string; errors: string }): string {
  return `The pipeline below failed huu's mechanical validation. Fix ONLY what the errors name — minimal edits, no redesign — and return the corrected pipeline.

# Validation errors (verbatim)

${args.errors}

# Pipeline

${args.pipelineJson}`;
}

/**
 * Initial human message — wraps the user's intent and reminds the assistant
 * of the response format.
 */
export function buildInitialHumanMessage(intent: string): string {
  const trimmed = intent.trim();
  if (!trimmed) {
    return 'I want to build a pipeline but I am not yet sure what. Help me start from zero.';
  }
  return `I want to build a pipeline for the following:\n\n${trimmed}\n\nAsk me what you need — or, if you already have enough context, finalize directly.`;
}

/**
 * AI PIPELINE EDITOR — the conversational brain of the web construction mode.
 *
 * The user types what they want ("uma pipeline que audite segurança e escreva
 * testes"); this module turns that intent (plus the CURRENT pipeline draft and
 * the conversation so far) into ONE structured turn:
 *
 *   - `done: false` — a multiple-choice QUESTION for the user (last option is
 *     always the free-text fallback), or
 *   - `done: true`  — the COMPLETE pipeline JSON (`apply`) plus a short note
 *     explaining what changed.
 *
 * "Every piece of pipeline information lives in the prompt": the model is not
 * shown a summary of the schema, it is shown the FULL `huu-pipeline-v2`
 * contract (every field, every scope, the review spec, check outcomes and the
 * invariants the validator enforces) so it can translate user intent without
 * guessing shapes. `pipeline-ai-editor.test.ts` pins every contract field name
 * inside {@link PIPELINE_SCHEMA_GUIDE}, so the guide cannot drift away from
 * `types/pipeline.ts` silently.
 *
 * Determinism note: this layer never touches the network in tests — pass a
 * `chat` stub or run with `HUU_LANGCHAIN_STUB=1` and {@link createEditorChat}
 * returns a canned two-questions-then-apply sequence.
 */
import { z } from 'zod';
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  type BaseMessage,
} from '@langchain/core/messages';
import {
  AssistantOptionSchema,
  normalizeQuestionShape,
  validateQuestionShape,
} from './assistant-schema.js';
import { SCOPE_AND_LINKS_GUIDE, STEP_PROMPT_GUIDE } from './assistant-prompts.js';
import { buildChatClient, type LlmClientContext } from './llm-client-factory.js';
import { parsePipelineFromJson } from './pipeline-io.js';

/** The model this editor is FOR: the user's designated pipeline author. */
export const DEFAULT_EDITOR_MODEL = 'xiaomi/mimo-v2.6-pro';

// --- Turn protocol ---------------------------------------------------------

export const QuestionTurnSchema = z.object({
  done: z.literal(false),
  question: z.string().min(1).max(500),
  rationale: z.string().max(200).optional(),
  options: z.array(AssistantOptionSchema).min(2).max(5),
});

/**
 * The apply turn carries the COMPLETE pipeline object (not a draft) and a
 * `note` in the user's language: what this version does and what the last
 * request changed. The object itself is validated with the REAL parser after
 * structured output (a free-form record here keeps the tool schema small; the
 * authoritative validation is `parsePipelineFromJson`).
 */
export const ApplyTurnSchema = z.object({
  done: z.literal(true),
  pipeline: z.record(z.unknown()),
  note: z.string().min(1).max(1500),
});

export const EditorTurnSchema = z.discriminatedUnion('done', [
  QuestionTurnSchema,
  ApplyTurnSchema,
]);

export type QuestionTurn = z.infer<typeof QuestionTurnSchema>;
export type ApplyTurn = z.infer<typeof ApplyTurnSchema>;
export type EditorTurn = z.infer<typeof EditorTurnSchema>;

// --- The full schema guide -------------------------------------------------

/**
 * EVERY field of `huu-pipeline-v2`, spelled out. This is the "all the
 * information in the prompt" requirement: the editor may author any construct
 * the format supports (work steps, check steps, review loops, memory links,
 * waves) because the contract is fully described here, not summarized.
 */
export const PIPELINE_SCHEMA_GUIDE = `# The pipeline format (huu-pipeline-v2) — complete contract

A pipeline is a JSON object: { "name", "description?", "steps": [...] } plus
optional run-shaping fields. Steps form a DAG via dependsOn (missing edges mean
"independent → runs in the same wave, in parallel").

## Pipeline level
- name: string (required) — the pipeline's display name.
- description?: string — one or two sentences; shown in the picker.
- steps: array (required, 1..20) — the nodes (work or check, see below).
- _default?: boolean — marks the shipped default (do NOT set it on user pipelines).
- cardTimeoutMs?: number — per-CARD timeout in ms (a card = one file in per-file
  scope, or the whole step in project scope).
- singleFileCardTimeoutMs?: number — timeout used when a project-scope step
  touches exactly one file.
- maxRetries?: number — per-card retries before the card settles as failed.
- maxNodeExecutions?: number — HARD safety cap on total node executions
  (anti-infinite-loop; set it when the graph can revisit nodes).
- integrationModelId?: string — model id for the merge/conflict-resolver agent;
  empty = inherit the run model.
- portAllocation?: object — port isolation config for agents that bind ports.

## Work step (type omitted or "work") — an agent does work in a worktree
- name: string (required, ≤80 chars) — unique step name (it is the graph id).
- prompt: string (required) — the English instruction handed to the agent.
  Imperative, self-contained, names its inputs and its output surface.
- files: string[] (required) — the file-selection contract. Per-file scope:
  these are the selection patterns; project scope: the whole surface.
- scope?: "project" | "per-file" | "flexible" | "memory"
  * project  — ONE agent for the whole step; use when the work is inherently
    cross-file (refactors, whole-feature builds, audits).
  * per-file — ONE agent PER matched file (fan-out); use for independent,
    repeatable work (write tests per file, translate per file).
  * flexible — the orchestrator decides (fan-out when the selection is large).
  * memory   — consumes a spec file written by an earlier step (see filesFrom).
- filesFrom?: string — REQUIRED when scope is "memory": repo-relative path of
  the huu-memory-v1 file an earlier step writes (that earlier step's
  produces field must name the same file).
- produces?: string — producer side of a memory link: this step WRITES that
  file; huu appends the format contract to this step's prompt at run time.
- maxFiles?: number — fan-out width ceiling (how many files you are
  underwriting). Omit for project scope.
- writes?: string[] — write-set declaration: repo-relative paths or directory
  prefixes this step OWNS. Keep the sets of same-wave steps DISJOINT (two steps
  writing the same file conflict at merge). Use a shared file only across
  dependsOn-chained steps.
- readOnly?: boolean — true for report/audit steps that must not change code.
- next?: string — task-splitting hint (advanced; usually omit).
- dependsOn?: string[] — names of earlier steps this one waits for. Presence of
  any edge enables parallel waves; omit when independent.
- modelId?: string — per-step model override; omit to inherit the run model.
- review?: ReviewSpec — per-task generator→critic loop (see below).
- accept?: AcceptSpec — deterministic command gate: { command: string,
  expectExit?: number, cwd?: "worktree" | "integration" }.

## ReviewSpec (review) — the per-task critic loop
- prompt: string (required) — what the critic must look for.
- maxRuns?: number (default 2) — critic rounds before giving up (the cap is
  FORWARD: on cap, the run keeps going and the finding is recorded).
- blockOn?: ["blocker"|"major"|"minor"|"nit"] (default ["blocker","major"]) —
  severities that force a fix round.
- modelId?: string — critic model override.
- timeoutMs?: number (default 600000) — per-review timeout.
- maxFindings?: number (default 10) — findings the critic may report.
- verifyCommands?: string[] — commands (build/test/lint) run as a deterministic
  merge/verification gate.
- findingsDir?: string — where findings land.
- onBlocked?: "waive" | "hold" — headless runs degrade to "waive"; "hold"
  parks the stage for a human decision.

## Check step (type: "check") — a judge routes the flow
- type: "check" (required)
- name: string (required, unique).
- condition: string (required) — the objectively checkable question the judge
  answers (natural language, but decidable).
- outcomes: array (required) of { label: string, nextStepName: string,
  default?: boolean } — EXACTLY ONE outcome must carry default: true and the
  default must point FORWARD (a judge failure must never silently stall or
  loop backwards).
- instructionDraft?: string — extra judge instructions.
- maxRuns?: number — judge attempts before the default outcome fires.
- modelId?: string — judge model override.
- dependsOn?: string[] — like work steps.

## Invariants the validator enforces (get these right)
1. Step names are unique and non-empty; dependsOn references real names.
2. scope "memory" REQUIRES filesFrom.
3. A check step needs at least one outcome and EXACTLY one with default: true.
4. The default outcome must point forward (never at an earlier step).
5. Write sets of steps that can run in the same wave should be disjoint.
6. maxFiles only makes sense with per-file/flexible scope.
`;

/**
 * The system prompt: role, full schema, scope guide, prompt-writing guide and
 * the exact turn protocol. `draftJson` (nullable) is the CURRENT pipeline the
 * user is editing — when present, requests are EDITS: preserve everything the
 * user did not ask to change.
 */
/** The only model facts the prompt needs. Structural, so any catalog passes. */
export interface EditorModelFact {
  id: string;
  label: string;
  description?: string;
}

export function buildPipelineEditorSystemPrompt(args: {
  models: readonly EditorModelFact[];
  draftJson?: string | null;
}): string {
  const modelLines = args.models.length
    ? args.models
        .map((m) => `- \`${m.id}\` — ${m.label}${m.description ? `: ${m.description}` : ''}`)
        .join('\n')
    : '(empty catalog — leave modelId unset on steps)';
  const draftBlock =
    args.draftJson && args.draftJson.trim().length > 0
      ? `

# The pipeline being edited (current draft)

Treat every request as an EDIT of this pipeline. Preserve names, prompts and
fields the user did not ask to change; return the COMPLETE updated pipeline
(not a diff) in the apply turn.

\`\`\`json
${args.draftJson.trim()}
\`\`\`
`
      : `

# No pipeline yet

The user is starting from scratch. Interview only as much as needed, then
return the first full version in an apply turn.
`;
  return `You are huu's PIPELINE EDITOR. The user describes, in their own words, what
they want a pipeline to DO (audit something, write tests, migrate code, build a
knowledge system...). Your job is to translate that intent into ONE valid
huu-pipeline-v2 pipeline, or to ask a clarifying question when the intent is
genuinely ambiguous.

Speak the USER'S LANGUAGE in every visible string (question, rationale, note,
option labels). Write step prompts in ENGLISH (they are handed to agents).

${PIPELINE_SCHEMA_GUIDE}

${SCOPE_AND_LINKS_GUIDE}

${STEP_PROMPT_GUIDE}

# Model catalog (for per-step modelId choices)

${modelLines}
${draftBlock}
# Turn protocol — respond with EXACTLY ONE of these two shapes

(A) A QUESTION (done: false) when the request is ambiguous or a choice
    materially changes the pipeline (scope strategy, what to do with existing
    code, which checks gate the work). Rules:
    - question: ONE clear question in the user's language (≤500 chars).
    - rationale: one short sentence on why it matters (optional).
    - options: 2..5 concrete answers; the LAST option must be the free-text
      fallback with isFreeText: true (e.g. "Outro — escrever resposta").
    - Ask ONLY what changes the design. Zero questions is a valid path: if the
      intent is clear, go straight to (B).

(B) THE PIPELINE (done: true) when you can author or update it:
    - pipeline: the COMPLETE pipeline object (all fields it needs, nothing
      half-answered). Validate it mentally against the invariants above.
    - note: 2-5 sentences in the user's language: what this pipeline does,
      what the last request changed, and anything deliberately left out.

Never answer with prose outside these two shapes. Never invent fields that are
not in the contract above.`;
}

// --- Chat plumbing ---------------------------------------------------------

export interface EditorChat {
  modelId: string;
  invokeStructured(messages: BaseMessage[]): Promise<EditorTurn>;
}

export interface CreateEditorChatOptions {
  /** Credential for the provider that serves the editor model. */
  apiKey: string;
  modelId?: string;
  temperature?: number;
  llmContext?: LlmClientContext;
}

/**
 * Structured-output chat bound to the chosen backend/provider. With `--stub`
 * (or HUU_LANGCHAIN_STUB=1, or apiKey "stub") it returns a deterministic
 * two-questions-then-apply sequence so tests and smoke runs never touch the
 * network. Question drift (missing free-text flag etc.) is normalized exactly
 * like the TUI assistant does.
 */
export function createEditorChat(opts: CreateEditorChatOptions): EditorChat {
  const stubTrigger =
    process.env.HUU_LANGCHAIN_STUB === '1' ||
    opts.apiKey.trim() === 'stub' ||
    opts.llmContext?.backend === 'stub';
  if (stubTrigger) return new StubEditorChat();

  const modelId = (opts.modelId ?? DEFAULT_EDITOR_MODEL).trim();
  if (!modelId) throw new Error('editor modelId is empty.');
  const ctx: LlmClientContext = opts.llmContext ?? {
    backend: 'jcode',
    apiKey: opts.apiKey,
  };
  const chat = buildChatClient(ctx, { modelId, temperature: opts.temperature ?? 0.3 });
  const structured = chat.withStructuredOutput(EditorTurnSchema, {
    name: 'PipelineEditorTurn',
    method: 'functionCalling',
  });

  return {
    modelId,
    async invokeStructured(messages: BaseMessage[]): Promise<EditorTurn> {
      const result = (await structured.invoke(messages)) as EditorTurn;
      const parsed = EditorTurnSchema.parse(result);
      if (parsed.done === false) {
        const fixed = normalizeQuestionShape(parsed);
        validateQuestionShape(fixed);
        return fixed;
      }
      // Authoritative validation of the free-form pipeline object: a turn that
      // does not parse as huu-pipeline-v2 is an ERROR the caller surfaces (and
      // retries with a correction message), never a silent bad draft.
      parsePipelineFromJson(JSON.stringify({ _format: 'huu-pipeline-v2', pipeline: parsed.pipeline }));
      return parsed;
    },
  };
}

/**
 * Deterministic stub: one question, one follow-up, then a tiny valid apply.
 * The turn is chosen from the CONVERSATION (how many assistant turns are
 * already in the messages), not from internal state — so a stateless server
 * route that builds a fresh chat per request still walks the interview.
 */
export class StubEditorChat implements EditorChat {
  modelId = 'stub/editor';

  async invokeStructured(messages: BaseMessage[]): Promise<EditorTurn> {
    const asked = messages.filter((m) => m instanceof AIMessage).length;
    if (asked === 0) {
      return {
        done: false,
        question: 'Qual é o objetivo principal da pipeline?',
        rationale: 'O objetivo define a topologia dos passos.',
        options: [
          { label: 'Auditoria de código' },
          { label: 'Geração de testes' },
          { label: 'Outro — escrever resposta', isFreeText: true },
        ],
      };
    }
    if (asked === 1) {
      return {
        done: false,
        question: 'A pipeline deve alterar código ou apenas relatar?',
        options: [
          { label: 'Apenas relator (read-only)' },
          { label: 'Pode alterar código' },
          { label: 'Outro — escrever resposta', isFreeText: true },
        ],
      };
    }
    return {
      done: true,
      pipeline: {
        name: 'Pipeline do utilizador',
        description: 'Gerada pelo editor IA (stub).',
        steps: [
          { name: '1. Implementar', prompt: 'Implement the requested change.', files: ['**/*'] },
        ],
      },
      note: 'Versão inicial com um passo de trabalho. Diga o que quer ajustar.',
    };
  }
}

// --- Message composition ---------------------------------------------------

export interface EditorHistoryEntry {
  role: 'user' | 'assistant';
  text: string;
}

/**
 * Compose the message list for ONE editor turn: system prompt, prior
 * conversation (short, for continuity of the interview), then the new user
 * message. The draft itself lives in the system prompt (one copy, always
 * current) so a long editing session does not re-send it every turn.
 */
export function composeEditorMessages(args: {
  systemPrompt: string;
  history?: readonly EditorHistoryEntry[];
  message: string;
}): BaseMessage[] {
  const messages: BaseMessage[] = [new SystemMessage(args.systemPrompt)];
  for (const entry of args.history ?? []) {
    const text = entry.text.trim();
    if (!text) continue;
    messages.push(
      entry.role === 'user' ? new HumanMessage(text) : new AIMessage(text),
    );
  }
  messages.push(new HumanMessage(args.message));
  return messages;
}

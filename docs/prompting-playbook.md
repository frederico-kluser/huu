# Prompting techniques playbook — cross-LLM, applied to huu step prompts

> Field-tested techniques for writing the per-step prompts that drive huu's
> agents, distilled to survive across providers and **small** models.
>
> Português: [prompting-playbook.pt-BR.md](prompting-playbook.pt-BR.md) ·
> Knowledge skill: [`.agents/skills/authoring-agent-prompts/SKILL.md`](../.agents/skills/authoring-agent-prompts/SKILL.md) ·
> Schema reference: [pipeline-json-guide.md](pipeline-json-guide.md)

huu runs LLM agents in isolated git worktrees through deterministic
pipelines. Each step is **one cognitive operation**; the human underwrites
the method and the agent supplies the intelligence. That contract only holds
if the step prompt is precise enough for a *small* model to execute
mechanically — across whichever of pi's 15+ providers is wired in.

This playbook is the prompt-engineering layer of that contract. Every
bundled default pipeline (`src/lib/default-pipelines/`) already applies it;
read it before you author or sharpen any step prompt, judge condition, or
memory recon prompt.

## Techniques

**1. Atomic directive decomposition.** Express each step as one cognitive op
broken into numbered, verb-driven substeps; replace vague verbs
(*improve*, *consider*, *handle*) with mechanical ones (*read*, *parse*,
*write*, *assert*).
*Why cross-LLM:* small/weak models do not infer intent — they execute literal
verbs, and a single op keeps the whole instruction inside their working
attention.
*In huu:* one step = one `produces` artifact or one transformation; a per-file
fan-out step does the SAME single op to every `$file`, never a checklist.

**2. Structural tags / sectioning.** Separate instruction from data with
visible zones — `=== STEP n ===` banners or XML-ish `<task>` / `<context>` /
`<output>` blocks.
*Why cross-LLM:* delimiters are the most portable cross-provider signal for
"this is a command, that is payload"; small models otherwise blur the two.
*In huu:* fence the injected `$file` content and the `$hint` note inside their
own tagged block so the model never treats scanned data as orders.

**3. Explicit output contract.** State the exact schema — field names, types,
enums — BEFORE the task body, not after.
*Why cross-LLM:* every provider honors a schema stated up front far better than
one inferred from prose; it is the single highest-leverage reliability move.
*In huu:* the `produces` MEMORY CONTRACT (path + `huu-memory-v1` format + the
consumer's cap + the hint rule) is auto-appended by
`src/lib/memory-contract.ts`, and the audits' FAQ-append schema
(`<topic>-faq.json`) is stated the same way — declare the link, never paste
boilerplate.

**4. Role + stakes opener.** Open with "You are X. Goal: Y." — a concrete
role plus the one outcome that matters.
*Why cross-LLM:* a role cheaply primes the right retrieval region; stating the
stake stops the model optimizing for the wrong thing.
*In huu:* "You are a security auditor. Goal: write `.huu/audits/<topic>.md`,
report-only" orients the agent and reasserts the report-only contract in one
line.

**5. Few-shot anchoring.** Give 2-3 curated examples — one canonical, one
edge case — kept short.
*Why cross-LLM:* a worked example pins format and granularity more reliably
than any amount of description, and transfers across model families.
*In huu:* show one well-formed `huu-memory-v1` entry and one tricky one (a path
with no hint, a file to skip) so the recon step emits exactly the shape the
consumer fans out over.

**6. Negative constraints with parsimony.** Use a few HARD RULES, not a wall
of prohibitions, and pair each "don't" with the positive alternative.
*Why cross-LLM:* long negation lists degrade small models (they latch onto the
forbidden token); a positive redirect is what they can act on.
*In huu:* "Do NOT touch `README.md`/`package.json`; write ONLY under
`.huu/audits/`" — the report-only surface as one prohibition plus its
allowed target.

**7. Chain-of-thought ONLY in judges/decisions.** Ask for step-by-step
reasoning in CheckStep judges and routing decisions — not in code steps,
where the diff IS the reasoning.
*Why cross-LLM:* CoT lifts decision accuracy ([Wei et al. 2022](https://arxiv.org/abs/2201.11903))
but bloats and destabilizes deterministic transformation steps and wastes
tokens on small models.
*In huu:* a judge may reason before its verdict JSON; a per-file fix step just
edits and commits — the worktree diff is the audit trail, no narration asked.

**8. Self-verification / self-check.** End the prompt with a "SELF-CHECK
before finishing" block listing the invariants to confirm.
*Why cross-LLM:* a model re-reading its own output against an explicit
checklist catches its own violations — a cheap, provider-agnostic quality
gate.
*In huu:* "SELF-CHECK: file written at the exact `filesFrom` path? every entry
has a hint? `_format` is `huu-memory-v1`?" — it pre-empts the corrupt-file
run failure before the next stage reads it.

**9. Variable injection.** Parameterize with `$file`, `$hint`, `$runs`; never
hardcode a path or a filename.
*Why cross-LLM:* decoupling the prompt from the data lets one prompt template
run in parallel over N tasks and stay reusable as the file set changes.
*In huu:* `$hint` (substituted before `$file`) carries the producer's per-file
lead into the consumer; `$runs` lets a judge condition see the visit count for
loop caps.

**10. Progressive disclosure / lean system prompt.** Keep the system/preamble
tiny; put task logic in the step prompt.
*Why cross-LLM:* pi holds its system prompt under ~1k tokens and loads project
instructions (AGENTS.md / on-demand skills) only as needed — a bloated
preamble crowds out the actual task on small context windows.
*In huu:* the step prompt is the unit of work; don't restate architecture or
tool docs the agent already loads — say WHAT to produce and HOW it's checked.

**11. Mechanical judges (fixed-enum verdicts).** A judge emits
`{ "label": "...", "reason": "..." }` from a small fixed label set; no
multi-hop reasoning, and the **default outcome must move the pipeline
FORWARD** (stub-safe).
*Why cross-LLM:* a tiny enum is parseable from any model and degrades safely;
the forward default means a weak/stubbed judge never deadlocks the run.
*In huu:* `outcomes[]` carries exactly one `default: true` — make it the SAFE
path (usually `approved`/`proceed`), never the loop, because it fires on judge
failure, unknown label, or the `maxRuns` cap.

**12. Empirical iteration.** A/B a step prompt against a few representative
files; treat descriptions and prompts as the routing signal and sharpen them
from observed failures.
*Why cross-LLM:* models differ — the only ground truth is behavior on your
repo; prompt wording is tuned, not guessed.
*In huu:* dry-run with the stub backend (free, no key), watch which judge
outcome actually fires on the kanban, then tighten the wording the failure
came from.

## PI coding agent notes

The default backend is **pi** (pi.dev / `@mariozechner/pi-coding-agent`) over
OpenRouter. Write step prompts to its grain:

- **It loads project instructions on its own.** pi reads `AGENTS.md` /
  `SYSTEM.md` and pulls in on-demand skills — don't re-paste architecture,
  conventions, or repo layout into a step prompt.
- **Tools are bare UNIX.** read / bash / edit / write / grep. The agent
  already knows how to use them, so prompts need not document tool APIs or
  teach the CLI — state the task and the acceptance criteria, skip the tool
  tutorial.
- **The model is pluggable (15+ providers).** Keep prompts
  provider-agnostic: rely on schema + delimiters + examples, not on any one
  model's quirks or hidden features.
- **Assume competence, specify outcome.** The reliable shape is *task +
  acceptance*, not *step-by-step keystrokes* — tell it WHAT must be true when
  it's done, let it choose the commands.

See [pi-coding-agent.md](pi-coding-agent.md) for how huu instantiates and
controls pi sessions.

## Anti-patterns

- **Multi-op steps** — one prompt that scans AND fixes AND documents; split
  into atomic steps (technique 1).
- **Unconstrained "respond in JSON"** with no field/type/enum schema — the
  output drifts and the next stage's parser fails (technique 3).
- **Vague acceptance** — "write good tests", "make it better"; nothing is
  checkable, so no judge can gate it (techniques 1, 11).
- **Overstuffed system prompt** — restating tool docs and architecture the
  agent already loads, crowding out the task (technique 10).
- **Negation overload** — a wall of "don't" with no positive alternative
  small models can act on (technique 6).
- **Role without stakes** — "You are an expert engineer." with no goal; the
  role primes nothing useful (technique 4).
- **Blending discovery + transformation** in one step — let an earlier step
  WRITE the memory file and the memory step CONSUME it; don't make one step
  both find and fix (techniques 1, 9).
- **Hardcoded file paths** in a fan-out prompt — breaks parallel reuse; inject
  `$file`/`$hint` instead (technique 9).
- **Judges doing heavy reasoning** — a CheckStep that re-audits the whole repo
  instead of checking a stated, objective condition; keep the verdict
  mechanical and the default forward (technique 11).

## Sources

- [Anthropic — Prompt engineering overview](https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/overview) — role, examples, structure, explicit instructions.
- [OpenAI — GPT-4.1 prompting guide](https://developers.openai.com/cookbook/examples/gpt4-1_prompting_guide) — instruction-following, delimiters, agentic prompting.
- [OpenAI — Structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs) — schema-first, fixed-enum output reliability.
- [Google — Gemini prompting strategies](https://ai.google.dev/gemini-api/docs/prompting-strategies) — task framing, few-shot, constraints.
- [Wei et al. 2022 — Chain-of-Thought prompting](https://arxiv.org/abs/2201.11903) — reasoning for decisions/judges, not transformations.
- [pi coding agent — design notes](https://mariozechner.at/posts/2025-11-30-pi-coding-agent/) and [pi.dev](https://pi.dev/) — lean system prompt, bare UNIX tools, pluggable models.

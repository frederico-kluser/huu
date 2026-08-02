---
name: authoring-agent-prompts
description: Cross-LLM prompt-engineering knowledge for huu step prompts, judge conditions and memory-recon prompts — the 12 techniques (atomic decomposition, structural tags, explicit output contract, role+stakes, few-shot, parsimonious negatives, CoT only in judges, self-check, variable injection, lean system prompt, mechanical fixed-enum judges, empirical iteration) tied to the produces MEMORY CONTRACT, $file/$hint fan-out, scope memory, forward-default CheckStep verdicts and the pi backend. Use when writing or sharpening a pipeline step prompt, designing a judge verdict, authoring a memory recon prompt, targeting a small model, or making a prompt provider-agnostic across pi's many providers.
metadata:
  version: 0.1.0
  type: knowledge
---

# Authoring Agent Prompts

## When to use

Writing or sharpening any per-step prompt, CheckStep `condition`, or memory
recon prompt — especially for small models or to stay portable across pi's
15+ providers. Pairs with authoring-pipelines (step/check shapes) and
editing-default-pipelines (the 7 bundled defaults). The full prose +
sources live in `docs/prompting-playbook.md` (pt-BR twin alongside).

## The contract this serves

huu steps are **one cognitive op each**; the human owns the method, the
agent supplies intelligence. That only holds if the prompt is mechanical
enough for a *small* model on *any* provider. These techniques are how you
get there.

## The 12 techniques (each: rule → huu hook)

1. **Atomic directive decomposition** — one cognitive op, numbered
   verb-driven substeps; swap vague verbs (improve/consider/handle) for
   mechanical ones (read/parse/write/assert). → one step = one `produces`
   artifact or one transformation; a per-file step does the SAME op to every
   `$file`, never a checklist.
2. **Structural tags / sectioning** — `=== STEP n ===` banners or
   `<task>/<context>/<output>` zones so the model parses instruction vs
   data. → fence injected `$file` content and the `$hint` note in their own
   tagged block so scanned data is never read as orders.
3. **Explicit output contract** — state field names, types, enums BEFORE the
   task. → the `produces` MEMORY CONTRACT (path + `huu-memory-v1` + consumer
   cap + hint rule) is auto-appended by `src/lib/memory-contract.ts`; audits'
   FAQ-append schema (`<topic>-faq.json`) the same. Declare the link, don't
   paste boilerplate.
4. **Role + stakes opener** — "You are X. Goal: Y." → "You are a security
   auditor. Goal: write `.huu/audits/<topic>.md`, report-only" reasserts the
   report-only contract in the opener.
5. **Few-shot anchoring** — 2-3 short curated examples (one canonical, one
   edge). → show one well-formed `huu-memory-v1` entry and one tricky one
   (no hint / skip-listed file) so recon emits the exact shape the consumer
   fans out over.
6. **Negative constraints, parsimoniously** — a few HARD RULES, each "don't"
   paired with the positive alternative; not a wall of negations (they
   degrade small models). → "Do NOT touch `README.md`/`package.json`; write
   ONLY under `.huu/audits/`".
7. **CoT ONLY in judges/decisions** — reasoning in CheckStep judges and
   routing, never in code steps (the diff is the reasoning). → judge may
   reason before its verdict JSON; a per-file fix step just edits + commits,
   no narration.
8. **Self-verification** — end with "SELF-CHECK before finishing" listing
   the invariants. → "file at the exact `filesFrom` path? every entry has a
   hint? `_format` is `huu-memory-v1`?" pre-empts the corrupt-file run
   failure.
9. **Variable injection** — `$file`, `$hint`, `$runs`; never hardcode a
   path. → `$hint` (substituted BEFORE `$file`) carries the producer's
   per-file lead; `$runs` exposes the visit count to a judge condition for
   loop caps.
10. **Lean system prompt / progressive disclosure** — pi keeps its system
    prompt < ~1k tokens and loads AGENTS.md / on-demand skills as needed; put
    task logic in the step prompt. → don't restate architecture or tool docs
    the agent already loads; say WHAT to produce and HOW it's checked.
11. **Mechanical judges (fixed-enum verdicts)** — judge emits
    `{label, reason}` from a small label set, no multi-hop reasoning, and the
    **default outcome moves FORWARD** (stub-safe). → exactly one
    `default: true` in `outcomes[]`; make it the SAFE path
    (`approved`/`proceed`), never the loop — it fires on judge failure,
    unknown label, or the `maxRuns` cap.
12. **Empirical iteration** — A/B the prompt on a few representative files;
    descriptions/prompts ARE the routing signal, sharpen from observed
    failures. → dry-run with the stub backend (free, no key), watch which
    judge outcome fires on the kanban, tighten the wording the failure came
    from.

## pi backend grain (default: `@mariozechner/pi-coding-agent`, OpenRouter)

- Loads project instructions itself (AGENTS.md / SYSTEM.md / on-demand
  skills) — don't re-paste repo layout, conventions, or architecture.
- Tools are bare UNIX (read/bash/edit/write/grep) — don't document tool APIs
  or teach the CLI; state task + acceptance.
- Model is pluggable across 15+ providers — keep prompts provider-agnostic
  (schema + delimiters + examples, not a model's quirks).
- Reliable shape is *task + acceptance*, not *step-by-step keystrokes*: say
  what must be TRUE when done. Deep dive: `docs/pi-coding-agent.md`.

## Anti-patterns (and the fix)

- Multi-op step (scan AND fix AND document) → split into atomic steps (1).
- "respond in JSON" with no field/type/enum schema → state the schema (3).
- Vague acceptance ("write good tests") → nothing a judge can gate (1, 11).
- Overstuffed system prompt restating loaded docs → trim (10).
- Negation overload with no positive redirect → a few HARD RULES (6).
- Role without stakes ("You are an expert engineer.") → add the goal (4).
- Discovery + transformation blended in one step → an earlier step WRITES
  the memory file, the memory step CONSUMES it (1, 9).
- Hardcoded paths in a fan-out prompt → inject `$file`/`$hint` (9).
- A judge re-auditing the whole repo → check one objective condition, keep
  the default forward (11).

## References

- `docs/prompting-playbook.md` (+ `docs/prompting-playbook.pt-BR.md`) — full
  technique prose, the pi notes, and cited sources (Anthropic, OpenAI
  GPT-4.1 + structured outputs, Gemini, Chain-of-Thought, pi).
- Related skills: authoring-pipelines (WorkStep/CheckStep schema, `produces`
  link, the memory scope), editing-default-pipelines (how the 7 bundled
  defaults apply all of this), integrating-llm-backends (the pi backend).
- `src/lib/memory-contract.ts` (auto-appended MEMORY CONTRACT);
  `docs/memory-scope.md` (`$hint`/`filesFrom` semantics).

> Facts verified against source on 2026-06-25.

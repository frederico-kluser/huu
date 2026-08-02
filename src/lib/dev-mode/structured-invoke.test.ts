import { describe, expect, it } from 'vitest';
import { KnowledgeRequestSchema } from './knowledge-schema.js';
import { formatZodIssues, invokeWithRepair, type StructuredInvoker } from './structured-invoke.js';

// The repair round, pinned against the real contract it exists for. Three
// behaviors decide whether it earns its extra call:
//   1. a valid first answer costs EXACTLY ONE invocation (no speculative round);
//   2. a rejected answer is repaired in EXACTLY ONE more, and the repair prompt
//      actually receives the rejected value — the reason the invoker returns
//      `unknown` instead of a parsed `T`;
//   3. two failures throw carrying BOTH issue lists, so the driver's
//      `planner-failed` names the field the model never understood.

const TEMPERATURE = 0.4;

/** A gap that satisfies `KnowledgeGapSchema`. */
const GOOD_GAP = {
  id: 'build-test-commands',
  kind: 'repo',
  question: 'How is the test suite run?',
  why: 'The plan must call the real gate.',
  goodAnswer: 'The command plus where it is declared.',
};

const VALID = { restatedGoal: 'Add a retry to the HTTP client.', gaps: [GOOD_GAP] };
/** Fails on `restatedGoal` (missing). */
const JUNK_A = { gaps: [] };
/** Fails on `gaps.0.id` (not kebab-case) — a DIFFERENT path from JUNK_A's. */
const JUNK_B = { restatedGoal: 'ok', gaps: [{ ...GOOD_GAP, id: 'Bad_Id' }] };

interface Call {
  schema: unknown;
  name: string;
  prompt: string;
  temperature: number;
}

/** Returns the scripted responses in order; a call past the script is a failure. */
function scripted(...responses: unknown[]): { invoke: StructuredInvoker; calls: Call[] } {
  const calls: Call[] = [];
  const invoke: StructuredInvoker = async (schema, name, prompt, temperature) => {
    calls.push({ schema, name, prompt, temperature });
    if (calls.length > responses.length) {
      throw new Error(`invoker called ${calls.length}× — only ${responses.length} response(s) scripted`);
    }
    return responses[calls.length - 1];
  };
  return { invoke, calls };
}

const fixPrompt = (rawJson: string, issues: string): string =>
  `FIX\n--- rejected ---\n${rawJson}\n--- errors ---\n${issues}`;

function run(invoke: StructuredInvoker) {
  return invokeWithRepair({
    invoke,
    schema: KnowledgeRequestSchema,
    name: 'KnowledgeRequest',
    prompt: 'ASK: what do you need to know?',
    temperature: TEMPERATURE,
    fixPrompt,
  });
}

describe('invokeWithRepair', () => {
  it('returns a valid first answer after EXACTLY ONE invocation', async () => {
    const { invoke, calls } = scripted(VALID);
    const result = await run(invoke);

    expect(calls).toHaveLength(1);
    expect(result.repaired).toBe(false);
    expect(result.issues).toBeUndefined();
    expect(result.value.restatedGoal).toBe(VALID.restatedGoal);
    expect(result.value.gaps[0]?.id).toBe('build-test-commands');
  });

  it('applies the schema defaults on the happy path', async () => {
    const { invoke } = scripted({ restatedGoal: 'nothing to ask' });
    const result = await run(invoke);
    expect(result.value.gaps).toEqual([]);
  });

  it('repairs junk → valid in EXACTLY TWO invocations and reports `repaired`', async () => {
    const { invoke, calls } = scripted(JUNK_A, VALID);
    const result = await run(invoke);

    expect(calls).toHaveLength(2);
    expect(result.repaired).toBe(true);
    expect(result.value.gaps[0]?.id).toBe('build-test-commands');
    // The issues carried back are the FIRST attempt's — what the model got wrong.
    expect(result.issues).toContain('restatedGoal');
  });

  it('hands the repair call the REJECTED value and the exact issues', async () => {
    const { invoke, calls } = scripted(JUNK_A, VALID);
    await run(invoke);

    const repairPrompt = calls[1]!.prompt;
    expect(repairPrompt).toContain(JSON.stringify(JUNK_A));
    expect(repairPrompt).toContain('restatedGoal');
    // Same schema, same tool name, same temperature: the same question, asked
    // again with more information — not a different question.
    expect(calls[1]!.schema).toBe(KnowledgeRequestSchema);
    expect(calls[1]!.name).toBe('KnowledgeRequest');
    expect(calls[1]!.temperature).toBe(TEMPERATURE);
    expect(calls[0]!.prompt).toBe('ASK: what do you need to know?');
  });

  it('survives a model that returned nothing at all', async () => {
    const { invoke, calls } = scripted(undefined, VALID);
    const result = await run(invoke);

    expect(calls).toHaveLength(2);
    expect(result.repaired).toBe(true);
    // `JSON.stringify(undefined)` is undefined, not a string — the repair
    // prompt must still be a string, never `"undefined"` interpolated blindly
    // from a crash path.
    expect(calls[1]!.prompt).toContain('undefined');
  });

  it('throws with BOTH issue lists when the repair also fails', async () => {
    const { invoke, calls } = scripted(JUNK_A, JUNK_B);
    let error: Error | undefined;
    try {
      await run(invoke);
    } catch (e) {
      error = e as Error;
    }

    expect(error, 'two failed attempts must throw').toBeInstanceOf(Error);
    expect(calls).toHaveLength(2);
    const message = error?.message ?? '';
    expect(message).toContain('failed validation twice');
    expect(message).toContain('KnowledgeRequest');
    // First list: the missing goal. Second list: the malformed gap id. A message
    // carrying only the last attempt would hide which field never landed.
    expect(message).toContain('restatedGoal');
    expect(message).toContain('gaps.0.id');
    expect(message.indexOf('restatedGoal')).toBeLessThan(message.indexOf('gaps.0.id'));
  });

  it('never invokes a third time', async () => {
    const { invoke, calls } = scripted(JUNK_A, JUNK_B);
    await run(invoke).catch(() => undefined);
    expect(calls).toHaveLength(2);
  });

  it('propagates an invoker failure untouched, without a repair round', async () => {
    // A transport error carries no rejected value to reason about — it belongs
    // to the caller's retry/rotation domain, not to schema repair.
    const calls: string[] = [];
    const invoke: StructuredInvoker = async (_schema, _name, prompt) => {
      calls.push(prompt);
      throw new Error('429 rate limited');
    };
    await expect(run(invoke)).rejects.toThrow('429 rate limited');
    expect(calls).toHaveLength(1);
  });
});

describe('formatZodIssues', () => {
  it('renders `path: message`, joined by "; " — the same format as plan-to-pipeline', () => {
    const parsed = KnowledgeRequestSchema.safeParse(JUNK_B);
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    const rendered = formatZodIssues(parsed.error);
    expect(rendered).toMatch(/^gaps\.0\.id: /);
    expect(rendered).toContain('kebab-case');
  });

  it('joins multiple issues with "; "', () => {
    const parsed = KnowledgeRequestSchema.safeParse({ restatedGoal: 42, gaps: 'nope' });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    const rendered = formatZodIssues(parsed.error);
    expect(rendered.split('; ')).toHaveLength(2);
    expect(rendered).toContain('restatedGoal: ');
    expect(rendered).toContain('gaps: ');
  });
});

import { describe, expect, it } from 'vitest';
import { DEV_MAX_GAPS } from '../types.js';
import {
  GAP_ID_PATTERN,
  KnowledgeBriefSchema,
  KnowledgeGapSchema,
  KnowledgeRequestSchema,
} from './knowledge-schema.js';

// The contract the blind orchestrator asks knowledge through. Two invariants
// are pinned here, and the second is the load-bearing one:
//   1. the bounds — ids that cannot name a blackboard file, and a gap list too
//      long to answer in parallel, must not parse;
//   2. STRUCTURAL BLINDNESS — no `steps`, no `dependsOn`, no `files` reaches a
//      consumer, at the type level or at runtime. That is the property the
//      whole design rests on; if it ever fails, the orchestrator stopped being
//      blind and this file should be the first thing that says so.
// Plus the answer side: `unknowns` is mandatory, because an agent with nowhere
// to admit a gap writes confident filler instead (a plausible-but-wrong fact in
// a brief is actively harmful, not neutral padding).

function gap(over: Record<string, unknown> = {}): unknown {
  return {
    id: 'stack-and-entrypoints',
    kind: 'repo',
    question: 'Which command runs the test suite?',
    why: 'The goal adds tests, so the swarm needs the real runner.',
    goodAnswer: 'The exact command plus the file that declares it.',
    ...over,
  };
}

function request(over: Record<string, unknown> = {}): unknown {
  return { restatedGoal: 'Add a retry to the HTTP client.', gaps: [gap()], ...over };
}

function brief(over: Record<string, unknown> = {}): unknown {
  return {
    gapId: 'stack-and-entrypoints',
    kind: 'repo',
    confidence: 'high',
    answer: '`npm test` runs vitest over src/**/*.test.ts.',
    facts: ['package.json declares "test": "vitest run"'],
    sources: ['package.json:58'],
    unknowns: [],
    ...over,
  };
}

describe('KnowledgeGap schema', () => {
  it('accepts a well-formed gap', () => {
    expect(KnowledgeGapSchema.safeParse(gap()).success).toBe(true);
  });

  it('rejects an id that could not name a blackboard file', () => {
    // 2 chars (the pattern needs 3), underscore, uppercase, edge dashes, 41 chars.
    for (const id of ['', 'ab', 'a_b', 'Api', '-api', 'api-', 'a'.repeat(41), 'api docs']) {
      expect(KnowledgeGapSchema.safeParse(gap({ id })).success, id).toBe(false);
    }
  });

  it('accepts the kebab-case ids the pattern is there to allow', () => {
    for (const id of ['api', 'stack-and-entrypoints', 'a'.repeat(40), 'g-001']) {
      expect(KnowledgeGapSchema.safeParse(gap({ id })).success, id).toBe(true);
      expect(GAP_ID_PATTERN.test(id), id).toBe(true);
    }
  });

  it('rejects a kind outside the three retrieval lanes', () => {
    for (const kind of ['repo', 'convention', 'external']) {
      expect(KnowledgeGapSchema.safeParse(gap({ kind })).success, kind).toBe(true);
    }
    expect(KnowledgeGapSchema.safeParse(gap({ kind: 'web' })).success).toBe(false);
  });

  it('requires question, why and goodAnswer to be non-empty', () => {
    for (const field of ['question', 'why', 'goodAnswer']) {
      expect(KnowledgeGapSchema.safeParse(gap({ [field]: '' })).success, field).toBe(false);
      const missing = gap() as Record<string, unknown>;
      delete missing[field];
      expect(KnowledgeGapSchema.safeParse(missing).success, field).toBe(false);
    }
  });
});

describe('KnowledgeRequest schema', () => {
  it('accepts a request and keeps every declared field', () => {
    const parsed = KnowledgeRequestSchema.parse(request({ planningNotes: 'watch the retries' }));
    expect(parsed.restatedGoal).toBe('Add a retry to the HTTP client.');
    expect(parsed.gaps).toHaveLength(1);
    expect(parsed.gaps[0]?.id).toBe('stack-and-entrypoints');
    expect(parsed.planningNotes).toBe('watch the retries');
  });

  it('accepts `gaps: []` — "I already know enough", not a failed answer', () => {
    const parsed = KnowledgeRequestSchema.parse(request({ gaps: [] }));
    expect(parsed.gaps).toEqual([]);
  });

  it('defaults an omitted gaps list to the same empty array', () => {
    const bare = { restatedGoal: 'Ship the thing.' };
    expect(KnowledgeRequestSchema.parse(bare).gaps).toEqual([]);
  });

  it(`rejects more than DEV_MAX_GAPS (${DEV_MAX_GAPS}) gaps and accepts exactly that many`, () => {
    // The cap the plan fixes: each gap costs one parallel subagent, and a model
    // asked what it doesn't know will happily list thirty.
    expect(DEV_MAX_GAPS).toBe(12);
    const gaps = (n: number): unknown[] =>
      Array.from({ length: n }, (_, i) => gap({ id: `gap-${String(i).padStart(3, '0')}` }));
    expect(KnowledgeRequestSchema.safeParse(request({ gaps: gaps(DEV_MAX_GAPS) })).success).toBe(true);
    expect(KnowledgeRequestSchema.safeParse(request({ gaps: gaps(DEV_MAX_GAPS + 1) })).success).toBe(
      false,
    );
  });

  it('requires a restated goal', () => {
    expect(KnowledgeRequestSchema.safeParse({ gaps: [] }).success).toBe(false);
    expect(KnowledgeRequestSchema.safeParse(request({ restatedGoal: '' })).success).toBe(false);
  });

  it("lets a duplicated gap id through — dedup is the blackboard writer's job", () => {
    // Deliberate: repairing a name collision in TypeScript is free, spending a
    // whole repair round on it is not.
    const parsed = KnowledgeRequestSchema.parse(request({ gaps: [gap(), gap()] }));
    expect(parsed.gaps.map((g) => g.id)).toEqual(['stack-and-entrypoints', 'stack-and-entrypoints']);
  });
});

describe('structural blindness', () => {
  it('strips every structural field from a request — none reaches a consumer', () => {
    const parsed = KnowledgeRequestSchema.parse(
      request({
        steps: [{ type: 'work', name: '1. Do it', prompt: 'go' }],
        dependsOn: ['1. Do it'],
        files: ['src/index.ts'],
        maxNodeExecutions: 50,
        agentCount: 4,
      }),
    );
    expect(Object.keys(parsed).sort()).toEqual(['gaps', 'restatedGoal']);
    for (const key of ['steps', 'dependsOn', 'files', 'maxNodeExecutions', 'agentCount']) {
      expect(key in parsed, key).toBe(false);
    }

    // …and the type agrees: nothing downstream can even ask for a step. Each
    // line below is a compile error the annotation asserts must exist — if the
    // schema ever grew one of these fields, `npx tsc --noEmit` fails here.
    // @ts-expect-error — a knowledge request has no step array
    expect(parsed.steps).toBeUndefined();
    // @ts-expect-error — a knowledge request has no dependency edges
    expect(parsed.dependsOn).toBeUndefined();
    // @ts-expect-error — a knowledge request names no files
    expect(parsed.files).toBeUndefined();
  });

  it('strips structural fields from an individual gap too', () => {
    const parsed = KnowledgeGapSchema.parse(
      gap({ files: ['src/a.ts'], path: '.huu/dev/gaps/g.md', stepName: '1. Recon', agents: 3 }),
    );
    expect(Object.keys(parsed).sort()).toEqual(['goodAnswer', 'id', 'kind', 'question', 'why']);
    // @ts-expect-error — a gap is a question, not a work assignment
    expect(parsed.files).toBeUndefined();
    // @ts-expect-error — the gap never names where its answer lands
    expect(parsed.path).toBeUndefined();
  });
});

describe('KnowledgeBrief schema (huu-devbrief-v1)', () => {
  it('accepts a well-formed brief', () => {
    const parsed = KnowledgeBriefSchema.parse(brief());
    expect(parsed.gapId).toBe('stack-and-entrypoints');
    expect(parsed.facts).toHaveLength(1);
    expect(parsed.unknowns).toEqual([]);
  });

  it('REJECTS a brief with no `unknowns` — the field is mandatory on purpose', () => {
    const missing = brief() as Record<string, unknown>;
    delete missing.unknowns;
    expect(KnowledgeBriefSchema.safeParse(missing).success).toBe(false);
  });

  it('accepts an empty `unknowns` — that is a claim, not an omission', () => {
    expect(KnowledgeBriefSchema.safeParse(brief({ unknowns: [] })).success).toBe(true);
    const parsed = KnowledgeBriefSchema.parse(brief({ unknowns: ['could not reach the CI config'] }));
    expect(parsed.unknowns).toEqual(['could not reach the CI config']);
  });

  it('defaults facts and sources — only `unknowns` has no escape hatch', () => {
    // The asymmetry IS the contract: an agent that found nothing still owes an
    // explicit "here is what I could not verify".
    const sparse = brief() as Record<string, unknown>;
    delete sparse.facts;
    delete sparse.sources;
    const parsed = KnowledgeBriefSchema.parse(sparse);
    expect(parsed.facts).toEqual([]);
    expect(parsed.sources).toEqual([]);
  });

  it('strips the `_format` wrapper tag without complaining about it', () => {
    const parsed = KnowledgeBriefSchema.parse({ _format: 'huu-devbrief-v1', ...(brief() as object) });
    expect('_format' in parsed).toBe(false);
    expect(parsed.answer).toContain('vitest');
  });

  it('rejects a malformed gapId, an unknown kind and an unknown confidence', () => {
    expect(KnowledgeBriefSchema.safeParse(brief({ gapId: 'Bad_Id' })).success).toBe(false);
    expect(KnowledgeBriefSchema.safeParse(brief({ kind: 'internet' })).success).toBe(false);
    expect(KnowledgeBriefSchema.safeParse(brief({ confidence: 'certain' })).success).toBe(false);
    for (const confidence of ['high', 'medium', 'low']) {
      expect(KnowledgeBriefSchema.safeParse(brief({ confidence })).success, confidence).toBe(true);
    }
  });

  it('requires a non-empty answer', () => {
    expect(KnowledgeBriefSchema.safeParse(brief({ answer: '' })).success).toBe(false);
  });
});

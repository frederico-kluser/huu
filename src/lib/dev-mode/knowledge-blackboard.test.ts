import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveMemoryFiles } from '../../orchestrator/memory-files.js';
import type { KnowledgeStatus } from '../knowledge-detect.js';
import { DEV_MAX_GAPS } from '../types.js';
import { devSessionPaths } from './dev-protocol.js';
import {
  BASELINE_GAPS,
  DELIVERED_VS_PLANNED_GAP,
  FITNESS_COMMANDS_GAP,
  KNOWLEDGE_DIGEST_MAX_CHARS,
  extractVerifyCommands,
  flattenVerifyCommands,
  mergeBaselineGaps,
  readKnowledgeDigest,
  writeKnowledgeGaps,
  assembleKnowledgeDigest,
  assembleAccumulatedKnowledge,
  digestMissingGaps,
  readAccumulatedBriefs,
  type LoadedBrief,
} from './knowledge-blackboard.js';
import {
  DEV_BRIEF_FORMAT,
  KnowledgeGapSchema,
  type KnowledgeBrief,
  type KnowledgeGap,
  type KnowledgeRequest,
} from './knowledge-schema.js';

const paths = devSessionPaths('sess-1');

function gap(id: string, over: Partial<KnowledgeGap> = {}): KnowledgeGap {
  return {
    id,
    kind: 'repo',
    question: `what about ${id}?`,
    why: `because ${id}`,
    goodAnswer: `paths proving ${id}`,
    ...over,
  };
}

function request(gaps: KnowledgeGap[]): KnowledgeRequest {
  return { restatedGoal: 'do the thing', gaps };
}

function knowledgeStatus(over: Partial<KnowledgeStatus> = {}): KnowledgeStatus {
  return {
    present: true,
    surface: 'agents',
    catalogPath: '.agents/skills/catalog.md',
    routerSkill: 'project-router',
    skillCount: 19,
    skills: ['project-router'],
    bootstrapMode: 'extend',
    reason: 'catalog found',
    ...over,
  };
}

let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'huu-blackboard-'));
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

function write(rel: string, body: string): void {
  const abs = join(cwd, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, body, 'utf8');
}

describe('writeKnowledgeGaps', () => {
  it('writes one spec per gap plus the index that fans out over them', () => {
    const gaps = [
      gap('alpha'),
      gap('beta', { kind: 'convention' }),
      gap('gamma', { kind: 'external' }),
    ];
    const { writtenPaths, indexPath } = writeKnowledgeGaps({
      cwd,
      paths,
      epoch: 1,
      gaps,
      goal: 'ship it',
      knowledge: knowledgeStatus(),
    });

    expect(indexPath).toBe(paths.knowledgeIndex(1));
    // The specs AND the index: the driver commits this list wholesale, and an
    // uncommitted index resolves to nothing in the integration worktree.
    expect(writtenPaths).toEqual([
      paths.gapFile(1, 'G-001-alpha'),
      paths.gapFile(1, 'G-002-beta'),
      paths.gapFile(1, 'G-003-gamma'),
      indexPath,
    ]);
    for (const rel of writtenPaths) expect(existsSync(join(cwd, rel))).toBe(true);
  });

  // THE invariant of this module. `resolveMemoryFiles` does not merely drop a
  // path that is missing — when the list named entries and NONE survive, it
  // THROWS, and `prepareStageTasks` turns that into a dead run. Writing the
  // index from the same loop that writes the files makes that unreachable, so
  // the assertion runs the REAL resolver rather than re-checking existsSync.
  it('produces an index the real resolver accepts, with every entry present', () => {
    const gaps = [gap('alpha'), gap('beta'), gap('gamma')];
    const { indexPath } = writeKnowledgeGaps({
      cwd,
      paths,
      epoch: 2,
      gaps,
      goal: 'ship it',
      knowledge: knowledgeStatus(),
    });

    const resolved = resolveMemoryFiles(indexPath, cwd, gaps.length);
    expect(resolved.missing).toBe(false);
    expect(resolved.warnings).toEqual([]);
    expect(resolved.files).toEqual([
      paths.gapFile(2, 'G-001-alpha'),
      paths.gapFile(2, 'G-002-beta'),
      paths.gapFile(2, 'G-003-gamma'),
    ]);
    // `$hint` is the question — it reaches the agent before it opens the file.
    expect(resolved.hints.get(resolved.files[0]!)).toBe('what about alpha?');
  });

  it('keeps the fan-out in list order via descending priority', () => {
    const gaps = [gap('first'), gap('second')];
    writeKnowledgeGaps({ cwd, paths, epoch: 1, gaps, goal: 'g', knowledge: knowledgeStatus() });
    const index = JSON.parse(readFileSync(join(cwd, paths.knowledgeIndex(1)), 'utf8')) as {
      _format: string;
      files: { path: string; priority: number }[];
    };
    expect(index._format).toBe('huu-memory-v1');
    expect(index.files.map((f) => f.priority)).toEqual([2, 1]);
  });

  it('routes each gap by kind inside its OWN spec file', () => {
    const gaps = [
      gap('repo-lane'),
      gap('conv-lane', { kind: 'convention' }),
      gap('ext-lane', { kind: 'external' }),
    ];
    writeKnowledgeGaps({ cwd, paths, epoch: 1, gaps, goal: 'g', knowledge: knowledgeStatus() });
    const spec = (id: string): string => readFileSync(join(cwd, paths.gapFile(1, id)), 'utf8');

    const repo = spec('G-001-repo-lane');
    expect(repo).toContain('Answer from THIS REPOSITORY only');
    expect(repo).toContain('at most 15 lines');
    expect(repo).toMatch(/Do NOT search the web/);
    expect(repo).toContain('An honest gap beats an invented fact');

    const convention = spec('G-002-conv-lane');
    expect(convention).toContain('DOCUMENTED knowledge FIRST');
    expect(convention).toContain('.agents/skills/catalog.md');
    expect(convention).toContain('project-router');
    expect(convention).toContain('VERIFY EVERY RULE AGAINST THE CODE');
    expect(convention).toMatch(/contradicts is a FINDING, not a convention/);

    const external = spec('G-003-ext-lane');
    expect(external).toContain('command -v surf-research-skill');
    expect(external).toContain('URL in `sources`');
    expect(external).toContain('confidence: "low"');
    // Lanes must not leak into each other: the repo lane forbids exactly what
    // the external lane requires, and the documented-knowledge surface belongs
    // to the convention lane alone — pointing the repo lane at it would invite
    // the answer this design most wants to avoid, a documented rule passed on
    // without being checked against the code.
    expect(external).not.toContain('Answer from THIS REPOSITORY only');
    expect(repo).not.toContain('surf-research-skill');
    expect(repo).not.toContain('.agents/skills');
  });

  it('tells the convention lane when the repo documents nothing', () => {
    writeKnowledgeGaps({
      cwd,
      paths,
      epoch: 1,
      gaps: [gap('conv-lane', { kind: 'convention' })],
      goal: 'g',
      knowledge: knowledgeStatus({
        present: false,
        catalogPath: undefined,
        routerSkill: undefined,
        surface: undefined,
        skillCount: 0,
        skills: [],
        bootstrapMode: 'create',
        reason: 'no skills found',
      }),
    });
    const spec = readFileSync(join(cwd, paths.gapFile(1, 'G-001-conv-lane')), 'utf8');
    expect(spec).toContain('NO documented knowledge surface');
    expect(spec).toContain('no skills found');
  });

  it('carries the question, the stakes and the exact output paths into the spec', () => {
    writeKnowledgeGaps({
      cwd,
      paths,
      epoch: 1,
      gaps: [gap('alpha')],
      goal: 'the human goal',
      knowledge: knowledgeStatus(),
    });
    const spec = readFileSync(join(cwd, paths.gapFile(1, 'G-001-alpha')), 'utf8');
    expect(spec).toContain('what about alpha?');
    expect(spec).toContain('because alpha');
    expect(spec).toContain('paths proving alpha');
    expect(spec).toContain('the human goal');
    expect(spec).toContain(paths.brief(1, 'alpha'));
    expect(spec).toContain(paths.briefJson(1, 'alpha'));
    expect(spec).toContain('Change NO source code');
  });

  it('points epoch >= 2 at the previous epoch instead of nowhere', () => {
    writeKnowledgeGaps({
      cwd,
      paths,
      epoch: 3,
      gaps: [DELIVERED_VS_PLANNED_GAP],
      goal: 'g',
      knowledge: knowledgeStatus(),
    });
    const spec = readFileSync(join(cwd, paths.gapFile(3, 'G-001-delivered-vs-planned')), 'utf8');
    expect(spec).toContain(paths.epochReport(2));
    expect(spec).toContain('.huu/dev/journal.md');
  });

  // Both would corrupt the blackboard: an unsafe id escapes the directory, a
  // duplicate silently overwrites another gap's spec. `mergeBaselineGaps`
  // removes them, so reaching here means the driver skipped it.
  it.each(['../escape', 'Has-Caps', 'x', ''])('refuses the unusable id %j', (bad) => {
    expect(() =>
      writeKnowledgeGaps({
        cwd,
        paths,
        epoch: 1,
        gaps: [gap(bad)],
        goal: 'g',
        knowledge: knowledgeStatus(),
      }),
    ).toThrow(/not a safe file-name segment/);
  });

  it('refuses duplicate ids', () => {
    expect(() =>
      writeKnowledgeGaps({
        cwd,
        paths,
        epoch: 1,
        gaps: [gap('alpha'), gap('alpha')],
        goal: 'g',
        knowledge: knowledgeStatus(),
      }),
    ).toThrow(/duplicate gap id/);
  });
});

describe('mergeBaselineGaps', () => {
  it('every fixed gap is a schema-valid gap', () => {
    for (const g of [...BASELINE_GAPS, DELIVERED_VS_PLANNED_GAP]) {
      expect(KnowledgeGapSchema.safeParse(g).success).toBe(true);
    }
  });

  it('puts the four baseline gaps first in epoch 1', () => {
    const { gaps, warnings } = mergeBaselineGaps(request([gap('extra')]), 1);
    expect(gaps.map((g) => g.id)).toEqual([
      'stack-and-entrypoints',
      'build-test-commands',
      'where-the-goal-lands',
      'conventions-surface',
      'extra',
    ]);
    expect(warnings).toEqual([]);
  });

  it('swaps the baseline for the delivered-vs-planned gap from epoch 2 on', () => {
    for (const epoch of [2, 5]) {
      const { gaps } = mergeBaselineGaps(request([gap('extra')]), epoch);
      expect(gaps.map((g) => g.id)).toEqual(['delivered-vs-planned', 'extra']);
    }
  });

  // A methodology gap exists because the HUMAN underwrote an option, so it
  // outranks anything the blind orchestrator invented.
  it('puts a methodology gap after the baseline and BEFORE the model of gaps', () => {
    const { gaps } = mergeBaselineGaps(request([gap('extra')]), 1, DEV_MAX_GAPS, [
      FITNESS_COMMANDS_GAP,
    ]);
    expect(gaps.map((g) => g.id)).toEqual([
      'stack-and-entrypoints',
      'build-test-commands',
      'where-the-goal-lands',
      'conventions-surface',
      'architecture-rules',
      'extra',
    ]);
  });

  // Unlike the baseline, it is asked EVERY epoch: it feeds a gate that runs
  // every epoch, and epoch 2's repo is not epoch 1's.
  it('asks the methodology gap in every epoch, not only the first', () => {
    const { gaps } = mergeBaselineGaps(request([]), 4, DEV_MAX_GAPS, [FITNESS_COMMANDS_GAP]);
    expect(gaps.map((g) => g.id)).toEqual(['delivered-vs-planned', 'architecture-rules']);
  });

  it('adds nothing at all when no methodology asked for a gap', () => {
    const withNone = mergeBaselineGaps(request([gap('extra')]), 1, DEV_MAX_GAPS, []);
    expect(withNone.gaps.map((g) => g.id)).toEqual(mergeBaselineGaps(request([gap('extra')]), 1).gaps.map((g) => g.id));
  });

  it('keeps the methodology gap schema-valid', () => {
    expect(KnowledgeGapSchema.safeParse(FITNESS_COMMANDS_GAP).success).toBe(true);
  });

  it('answers an empty request with the baseline alone', () => {
    expect(mergeBaselineGaps(request([]), 1).gaps).toHaveLength(BASELINE_GAPS.length);
    expect(mergeBaselineGaps(request([]), 2).gaps).toEqual([DELIVERED_VS_PLANNED_GAP]);
  });

  // The request schema deliberately allows duplicate ids so a near-miss never
  // costs a repair round; this is where that promise is kept.
  it('dedupes by id, keeping huu framing of a question the model re-asked', () => {
    const mine = gap('stack-and-entrypoints', { question: 'my own phrasing' });
    const { gaps, warnings } = mergeBaselineGaps(request([mine, gap('dup'), gap('dup')]), 1);
    expect(gaps.filter((g) => g.id === 'stack-and-entrypoints')).toHaveLength(1);
    expect(gaps.find((g) => g.id === 'stack-and-entrypoints')!.question).toBe(
      BASELINE_GAPS[0]!.question,
    );
    expect(gaps.filter((g) => g.id === 'dup')).toHaveLength(1);
    expect(warnings).toHaveLength(2);
    expect(warnings.every((w) => w.includes('duplicate'))).toBe(true);
  });

  it('drops an id that could not become a file name', () => {
    const { gaps, warnings } = mergeBaselineGaps(request([gap('../etc/passwd'), gap('ok-one')]), 1);
    expect(gaps.map((g) => g.id)).not.toContain('../etc/passwd');
    expect(gaps.map((g) => g.id)).toContain('ok-one');
    expect(warnings.join(' ')).toMatch(/not a safe file-name segment/);
  });

  it('clamps at the cap, keeping the baseline gaps', () => {
    const many = Array.from({ length: 30 }, (_, i) => gap(`extra-${i}`));
    const { gaps, warnings } = mergeBaselineGaps(request(many), 1);
    expect(gaps).toHaveLength(DEV_MAX_GAPS);
    expect(gaps.slice(0, 4).map((g) => g.id)).toEqual(BASELINE_GAPS.map((g) => g.id));
    expect(warnings.join(' ')).toMatch(/more knowledge than the cap allows/);
  });

  it('honors an explicit cap below the default', () => {
    const { gaps } = mergeBaselineGaps(request([gap('extra')]), 1, 2);
    expect(gaps.map((g) => g.id)).toEqual(['stack-and-entrypoints', 'build-test-commands']);
  });
});

describe('readKnowledgeDigest', () => {
  it('returns the digest when the consolidation step wrote one', () => {
    write(paths.knowledgeDigest(1), '# Conhecimento\n\n## alpha — q\n**Resposta:** a\n');
    expect(readKnowledgeDigest(cwd, paths, 1)).toContain('## alpha — q');
  });

  // The blind orchestrator has no other source of repo knowledge, so a missing
  // digest must degrade to the raw briefs — never to an exception and never to
  // an empty plan input.
  it('falls back to the brief shards when the digest is missing', () => {
    write(paths.brief(1, 'beta'), 'beta says the runner is vitest');
    write(paths.brief(1, 'alpha'), 'alpha says the entry point is src/cli.tsx');
    write(paths.briefJson(1, 'alpha'), '{"gapId":"alpha"}');

    const text = readKnowledgeDigest(cwd, paths, 1);
    expect(text).toContain('was not written');
    // File order, so the output is deterministic across machines.
    expect(text.indexOf('--- alpha ---')).toBeLessThan(text.indexOf('--- beta ---'));
    expect(text).toContain('src/cli.tsx');
    expect(text).toContain('vitest');
    // The `.json` twin is not prose and must not be pasted into a prompt.
    expect(text).not.toContain('"gapId"');
  });

  it('falls back when the digest exists but is empty', () => {
    write(paths.knowledgeDigest(1), '   \n');
    write(paths.brief(1, 'alpha'), 'alpha content');
    expect(readKnowledgeDigest(cwd, paths, 1)).toContain('alpha content');
  });

  it('returns an empty string — never throws — when nothing was written', () => {
    expect(readKnowledgeDigest(cwd, paths, 1)).toBe('');
    expect(readKnowledgeDigest(join(cwd, 'does-not-exist'), paths, 1)).toBe('');
  });

  it('never exceeds the character budget, from either source', () => {
    write(paths.knowledgeDigest(1), 'x'.repeat(KNOWLEDGE_DIGEST_MAX_CHARS * 2));
    const digest = readKnowledgeDigest(cwd, paths, 1);
    expect(digest.length).toBeLessThanOrEqual(KNOWLEDGE_DIGEST_MAX_CHARS);
    expect(digest.endsWith('… (truncated)')).toBe(true);

    write(paths.brief(2, 'a'), 'a'.repeat(5000));
    write(paths.brief(2, 'b'), 'b'.repeat(5000));
    const fallback = readKnowledgeDigest(cwd, paths, 2, 1200);
    expect(fallback.length).toBeLessThanOrEqual(1200);
    expect(fallback).toContain('--- a ---');
  });

  it('skips a brief the epoch never produced', () => {
    write(paths.brief(1, 'alpha'), 'alpha content');
    write(paths.brief(1, 'empty'), '   ');
    const text = readKnowledgeDigest(cwd, paths, 1);
    expect(text).toContain('--- alpha ---');
    expect(text).not.toContain('--- empty ---');
  });
});

describe('extractVerifyCommands', () => {
  function writeBrief(epoch: number, facts: unknown[]): void {
    write(
      paths.briefJson(epoch, 'build-test-commands'),
      JSON.stringify({
        _format: 'huu-devbrief-v1',
        gapId: 'build-test-commands',
        kind: 'repo',
        confidence: 'high',
        answer: 'os comandos',
        facts,
        sources: ['package.json'],
        unknowns: [],
      }),
    );
  }

  it('classifies an explicit fitness label into its own bucket', () => {
    writeBrief(1, [
      'lint: npm run typecheck',
      'fitness: npx depcruise src',
      'arch: npm run boundaries',
    ]);
    const found = extractVerifyCommands(cwd, paths, 1);
    expect(found?.commands.fitness).toEqual(['npx depcruise src', 'npm run boundaries']);
    // The lint bucket — the one `lintGate` has always run — is untouched.
    expect(found?.commands.lint).toEqual(['npm run typecheck']);
  });

  // No hint regex on purpose: a hint matching `dependency-cruiser` would MOVE
  // a command out of `lint` for projects that have run it under `lintGate` all
  // along. An opt-in option must not change what a different option does.
  it('never routes an UNLABELED command to fitness, however architectural it looks', () => {
    writeBrief(1, ['npx depcruise --config .dependency-cruiser.js src', 'npm run madge']);
    const found = extractVerifyCommands(cwd, paths, 1);
    expect(found?.commands.fitness).toBeUndefined();
  });

  // Persistence shape: a project with no fitness command must serialize the
  // exact `DevVerifyCommands` it serialized before the bucket existed.
  it('omits the fitness bucket entirely when nothing landed in it', () => {
    writeBrief(1, ['test: npm test']);
    const found = extractVerifyCommands(cwd, paths, 1);
    expect('fitness' in (found!.commands as object)).toBe(false);
  });

  it('classifies kind-labeled commands and keeps the brief order in the flat list', () => {
    writeBrief(1, ['build: npm run build', 'test: npm test', 'lint: npm run typecheck']);

    const found = extractVerifyCommands(cwd, paths, 1);
    expect(found?.warnings).toEqual([]);
    expect(found?.commands).toEqual({
      all: ['npm run build', 'npm test', 'npm run typecheck'],
      build: ['npm run build'],
      test: ['npm test'],
      // Type-checks count as lint: the subset a merge gate may run.
      lint: ['npm run typecheck'],
    });
    expect(flattenVerifyCommands(found!.commands)).toEqual(['npm run build', 'npm test', 'npm run typecheck']);
  });

  it('classifies unlabeled commands by keyword, preserving the brief order', () => {
    writeBrief(1, ['npm run typecheck', 'npm test', 'make all']);

    const found = extractVerifyCommands(cwd, paths, 1);
    // The flat list is the pre-classification shape — same facts, same order.
    expect(found?.commands.all).toEqual(['npm run typecheck', 'npm test', 'make all']);
    expect(found?.commands.lint).toEqual(['npm run typecheck']);
    expect(found?.commands.test).toEqual(['npm test']);
    expect(found?.commands.build).toEqual(['make all']);
  });

  it('strips source notes and accepts the label spellings the gap asks for', () => {
    writeBrief(1, [
      'type-check: npm run typecheck (from package.json)',
      'tests: npx vitest run',
      'check: cargo check',
    ]);

    const found = extractVerifyCommands(cwd, paths, 1);
    expect(found?.commands.lint).toEqual(['npm run typecheck', 'cargo check']);
    expect(found?.commands.test).toEqual(['npx vitest run']);
    expect(found?.commands.all).toEqual(['npm run typecheck', 'npx vitest run', 'cargo check']);
  });

  it('skips invalid entries with a warning, never throwing', () => {
    writeBrief(1, [42, '   ', 'lint:', 'npm test']);

    const found = extractVerifyCommands(cwd, paths, 1);
    expect(found?.commands.all).toEqual(['npm test']);
    expect(found?.warnings).toHaveLength(3);
  });

  it('returns undefined when the brief is missing, unreadable, foreign, or empty', () => {
    expect(extractVerifyCommands(cwd, paths, 1)).toBeUndefined();

    write(paths.briefJson(1, 'build-test-commands'), '{ not json');
    expect(extractVerifyCommands(cwd, paths, 1)).toBeUndefined();

    write(
      paths.briefJson(1, 'build-test-commands'),
      JSON.stringify({ _format: 'huu-devbrief-v0', facts: ['npm test'] }),
    );
    expect(extractVerifyCommands(cwd, paths, 1)).toBeUndefined();

    writeBrief(1, []);
    expect(extractVerifyCommands(cwd, paths, 1)).toBeUndefined();

    writeBrief(1, ['   ']);
    expect(extractVerifyCommands(cwd, paths, 1)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Deterministic digest assembly. The digest is the ONLY thing the blind planner
// ever reads about the repo, and until now a single unchecked LLM step was its
// only producer.
// ---------------------------------------------------------------------------

const GAP = (id: string, question = `what about ${id}?`): KnowledgeGap => ({
  id,
  kind: 'repo',
  question,
  why: 'because',
  goodAnswer: 'a path and a command',
});

const BRIEF = (gapId: string, over: Partial<KnowledgeBrief> = {}): LoadedBrief => ({
  gapId,
  brief: {
    gapId,
    kind: 'repo',
    confidence: 'high',
    answer: `the answer for ${gapId}`,
    facts: [`fact one for ${gapId}`, `fact two for ${gapId}`, `fact three for ${gapId}`],
    sources: ['src/a.ts'],
    unknowns: [],
    ...over,
  },
});

describe('assembleKnowledgeDigest', () => {
  it('emits exactly one section per gap, in order', () => {
    const gaps = [GAP('stack'), GAP('test-runner')];
    const out = assembleKnowledgeDigest({
      epoch: 1,
      gaps,
      briefs: [BRIEF('stack'), BRIEF('test-runner')],
    });
    expect(out.indexOf('## stack')).toBeLessThan(out.indexOf('## test-runner'));
    expect(digestMissingGaps(out, ['stack', 'test-runner'])).toEqual([]);
  });

  it('gives a gap with NO shard a section that says so', () => {
    // Silence has to be visible: a section that simply is not there reads to
    // the planner as "nothing to know here", which is a false negative.
    const out = assembleKnowledgeDigest({ epoch: 2, gaps: [GAP('missing')], briefs: [] });
    expect(out).toContain('## missing');
    expect(out).toContain('sem resposta');
    expect(out).toContain('**Confiança:** low');
  });

  it('never drops a section or an unknown under budget pressure', () => {
    const gaps = ['a', 'b', 'c', 'd'].map((id) => GAP(id));
    const briefs = gaps.map((g) =>
      BRIEF(g.id, { answer: 'x'.repeat(1800), unknowns: [`could not check ${g.id}`] }),
    );
    const out = assembleKnowledgeDigest({ epoch: 1, gaps, briefs, maxChars: 900 });
    for (const g of gaps) {
      expect(out).toContain(`## ${g.id}`);
      expect(out).toContain(`could not check ${g.id}`);
    }
  });

  it('spends facts before it touches the answer, at every budget', () => {
    // The ORDERING is the rule, not any single arithmetic outcome: an answer
    // that is still whole may coexist with cut facts, but a truncated answer
    // implies the facts were already spent to zero.
    const gaps = [GAP('one')];
    const briefs = [BRIEF('one', { answer: 'SHORT ANSWER' })];
    let sawFullFacts = false;
    let sawCutFacts = false;
    for (const maxChars of [400, 300, 250, 200, 170, 150, 140]) {
      const out = assembleKnowledgeDigest({ epoch: 1, gaps, briefs, maxChars });
      const factCount = (out.match(/^- fact /gm) ?? []).length;
      if (factCount === 3) sawFullFacts = true;
      if (factCount < 3) sawCutFacts = true;
      if (!out.includes('SHORT ANSWER')) expect(factCount).toBe(0);
    }
    expect(sawFullFacts).toBe(true);
    expect(sawCutFacts).toBe(true);
  });

  it('honors the budget wherever the skeletons fit, and keeps every section when they do not', () => {
    const gaps = ['a', 'b', 'c'].map((id) => GAP(id));
    const briefs = gaps.map((g) => BRIEF(g.id, { answer: 'y'.repeat(3000) }));
    for (const budget of [6000, 2000, 900, 500]) {
      const out = assembleKnowledgeDigest({ epoch: 1, gaps, briefs, maxChars: budget });
      expect(out.length).toBeLessThanOrEqual(budget);
      for (const g of gaps) expect(out).toContain(`## ${g.id}`);
    }
    // Below the irreducible skeleton the stronger invariant wins: overshoot the
    // budget rather than silently lose a question the planner asked.
    const impossible = assembleKnowledgeDigest({ epoch: 1, gaps, briefs, maxChars: 60 });
    for (const g of gaps) expect(impossible).toContain(`## ${g.id}`);
  });
});

describe('digestMissingGaps', () => {
  it('names the gaps a written digest never covered', () => {
    const digest = '# Conhecimento — época 1\n\n## stack — x\n**Resposta:** y\n';
    expect(digestMissingGaps(digest, ['stack', 'test-runner'])).toEqual(['test-runner']);
  });

  it('does not match a gap id that only appears in prose', () => {
    const digest = '# Conhecimento\n\nWe considered test-runner but wrote no section.\n';
    expect(digestMissingGaps(digest, ['test-runner'])).toEqual(['test-runner']);
  });
});

describe('readKnowledgeDigest — the tier order', () => {
  function scaffold(): { cwd: string; p: ReturnType<typeof devSessionPaths> } {
    const cwd = mkdtempSync(join(tmpdir(), 'huu-digest-'));
    return { cwd, p: devSessionPaths('s1') };
  }

  it('keeps a complete written digest untouched', () => {
    const { cwd, p } = scaffold();
    const digest = '# d\n\n## stack — q\n**Resposta:** npm run build\n';
    mkdirSync(dirname(join(cwd, p.knowledgeDigest(1))), { recursive: true });
    writeFileSync(join(cwd, p.knowledgeDigest(1)), digest);
    expect(readKnowledgeDigest(cwd, p, 1, undefined, [GAP('stack')])).toBe(digest.trim());
  });

  it('replaces an INCOMPLETE digest with the mechanical assembly when shards exist', () => {
    const { cwd, p } = scaffold();
    mkdirSync(dirname(join(cwd, p.knowledgeDigest(1))), { recursive: true });
    writeFileSync(join(cwd, p.knowledgeDigest(1)), '# d\n\n## stack — q\n**Resposta:** x\n');
    mkdirSync(join(cwd, p.briefsDir(1)), { recursive: true });
    for (const id of ['stack', 'test-runner']) {
      writeFileSync(
        join(cwd, p.briefJson(1, id)),
        JSON.stringify({ _format: DEV_BRIEF_FORMAT, ...BRIEF(id).brief }),
      );
    }
    const out = readKnowledgeDigest(cwd, p, 1, undefined, [GAP('stack'), GAP('test-runner')]);
    expect(out).toContain('assembled mechanically');
    expect(out).toContain('## test-runner');
  });

  it('DEGRADES rather than discards: an incomplete digest it cannot replace still ships', () => {
    // The rule the rest of dev mode lives by. Throwing away the only artefact
    // because it could not be PROVEN complete turns a partial answer into no
    // answer — strictly worse for a planner that has no other source.
    const { cwd, p } = scaffold();
    mkdirSync(dirname(join(cwd, p.knowledgeDigest(1))), { recursive: true });
    writeFileSync(join(cwd, p.knowledgeDigest(1)), '# d\n\nnpm run build\n');
    const out = readKnowledgeDigest(cwd, p, 1, undefined, [GAP('stack')]);
    expect(out).toContain('npm run build');
    expect(out).toContain('stack');
    expect(out).toContain('UNANSWERED');
  });

  it('is byte-identical to the legacy behavior when no gaps are passed', () => {
    const { cwd, p } = scaffold();
    const digest = '# d\n\nanything at all\n';
    mkdirSync(dirname(join(cwd, p.knowledgeDigest(1))), { recursive: true });
    writeFileSync(join(cwd, p.knowledgeDigest(1)), digest);
    expect(readKnowledgeDigest(cwd, p, 1)).toBe(digest.trim());
  });
});

describe('accumulated knowledge across epochs', () => {
  function seed(cwd: string, p: ReturnType<typeof devSessionPaths>, epoch: number, id: string, over: Partial<KnowledgeBrief> = {}): void {
    mkdirSync(join(cwd, p.briefsDir(epoch)), { recursive: true });
    writeFileSync(
      join(cwd, p.briefJson(epoch, id)),
      JSON.stringify({ _format: DEV_BRIEF_FORMAT, ...BRIEF(id, over).brief }),
    );
  }

  it('carries every gap forward, newest epoch winning', () => {
    // Without this the baseline gaps — stack, commands, conventions — are asked
    // ONCE, in epoch 1, and are simply gone by epoch 3.
    const cwd = mkdtempSync(join(tmpdir(), 'huu-accum-'));
    const p = devSessionPaths('s1');
    seed(cwd, p, 1, 'stack', { answer: 'OLD stack answer' });
    seed(cwd, p, 1, 'test-runner');
    seed(cwd, p, 2, 'stack', { answer: 'NEW stack answer' });

    const acc = readAccumulatedBriefs(cwd, p, 2);
    expect([...acc.keys()].sort()).toEqual(['stack', 'test-runner']);
    expect(acc.get('stack')!.brief.answer).toBe('NEW stack answer');
    expect(acc.get('stack')!.epoch).toBe(2);
    expect(acc.get('stack')!.supersedes).toEqual([1]);
  });

  it('names what it superseded instead of dropping it silently', () => {
    const acc = new Map([
      ['stack', { epoch: 3, supersedes: [1], brief: BRIEF('stack').brief }],
      ['cli', { epoch: 1, supersedes: [], brief: BRIEF('cli').brief }],
    ]);
    const text = assembleAccumulatedKnowledge(acc, 4000);
    expect(text).toContain('re-verified in epoch 3, supersedes epoch 1');
    expect(text).toContain('**cli** (epoch 1)');
  });

  it('surfaces what is still unknown, and respects its budget', () => {
    const acc = new Map([
      ['a', { epoch: 1, supersedes: [], brief: BRIEF('a', { unknowns: ['could not check the CI'] }).brief }],
    ]);
    expect(assembleAccumulatedKnowledge(acc, 4000)).toContain('still unknown: could not check the CI');
    expect(assembleAccumulatedKnowledge(acc, 80).length).toBeLessThanOrEqual(80);
    expect(assembleAccumulatedKnowledge(acc, 0)).toBe('');
    expect(assembleAccumulatedKnowledge(new Map(), 4000)).toBe('');
  });

  it('ignores a shard with a foreign format or a broken schema', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'huu-accum2-'));
    const p = devSessionPaths('s1');
    mkdirSync(join(cwd, p.briefsDir(1)), { recursive: true });
    writeFileSync(join(cwd, p.briefJson(1, 'foreign')), JSON.stringify({ _format: 'other', gapId: 'foreign' }));
    writeFileSync(join(cwd, p.briefJson(1, 'broken')), '{ not json');
    expect(readAccumulatedBriefs(cwd, p, 1).size).toBe(0);
  });
});

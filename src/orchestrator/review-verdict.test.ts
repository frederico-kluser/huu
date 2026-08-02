import { describe, it, expect } from 'vitest';
import { parseReviewVerdict } from './review-verdict.js';

const BLOCKER = {
  id: 'R1',
  severity: 'blocker',
  category: 'correctness',
  file: 'src/a.ts',
  line: 12,
  summary: 'off-by-one',
  evidence: 'loop runs n+1 times',
  fix: 'use <',
};

function fenced(obj: unknown): string {
  return '```json\n' + JSON.stringify(obj, null, 2) + '\n```';
}

describe('parseReviewVerdict', () => {
  it('reads a fenced JSON block', () => {
    const text = `I ran the checks.\n\n${fenced({ verdict: 'changes-requested', findings: [BLOCKER] })}`;
    const parsed = parseReviewVerdict(text)!;
    expect(parsed.verdict).toBe('changes-requested');
    expect(parsed.findings).toHaveLength(1);
    expect(parsed.findings[0]).toMatchObject({ id: 'R1', severity: 'blocker', line: 12 });
    expect(parsed.warnings).toEqual([]);
  });

  it('reads an inline (unfenced) object, including its nested findings array', () => {
    // The judge's flat `{[^{}]*"label"[^{}]*}` regex cannot see a nested array —
    // this is why the review parser walks braces instead.
    const text = `verdict: ${JSON.stringify({ verdict: 'approved', findings: [] })}`;
    expect(parseReviewVerdict(text)).toEqual({
      verdict: 'approved',
      findings: [],
      warnings: [],
    });
  });

  it('still reads the block when the critic keeps talking afterwards', () => {
    const text = `${fenced({ verdict: 'approved', findings: [] })}\n\nHope that helps! Let me know.`;
    expect(parseReviewVerdict(text)?.verdict).toBe('approved');
  });

  it('takes the LAST block when several appear', () => {
    const text = [
      'draft:',
      fenced({ verdict: 'changes-requested', findings: [BLOCKER] }),
      'on reflection the check passes:',
      fenced({ verdict: 'approved', findings: [] }),
    ].join('\n');
    const parsed = parseReviewVerdict(text)!;
    expect(parsed.verdict).toBe('approved');
    expect(parsed.findings).toEqual([]);
  });

  it('drops a finding with an unknown severity, with a warning — a malformed entry never gates a merge', () => {
    const text = fenced({
      verdict: 'changes-requested',
      findings: [{ ...BLOCKER, severity: 'catastrophic' }, BLOCKER],
    });
    const parsed = parseReviewVerdict(text)!;
    expect(parsed.findings).toHaveLength(1);
    expect(parsed.warnings.join(' ')).toContain('unknown severity "catastrophic"');
  });

  it('drops a finding with an unknown category', () => {
    const text = fenced({
      verdict: 'changes-requested',
      findings: [{ ...BLOCKER, category: 'vibes' }],
    });
    const parsed = parseReviewVerdict(text)!;
    expect(parsed.findings).toEqual([]);
    expect(parsed.warnings.join(' ')).toContain('unknown category "vibes"');
  });

  it('drops a finding with no file — an unlocatable claim cannot be acted on', () => {
    const text = fenced({ verdict: 'changes-requested', findings: [{ ...BLOCKER, file: '  ' }] });
    const parsed = parseReviewVerdict(text)!;
    expect(parsed.findings).toEqual([]);
    expect(parsed.warnings.join(' ')).toContain('no file');
  });

  it('returns null on malformed JSON', () => {
    const text = '```json\n{ "verdict": "approved", findings: [ }\n```';
    expect(parseReviewVerdict(text)).toBeNull();
  });

  it('returns null when the critic emitted no verdict at all', () => {
    expect(parseReviewVerdict('Everything looks fine to me.')).toBeNull();
    expect(parseReviewVerdict('')).toBeNull();
  });

  it('accepts an empty findings array as a clean review', () => {
    const parsed = parseReviewVerdict(fenced({ verdict: 'approved', findings: [] }))!;
    expect(parsed.findings).toEqual([]);
    expect(parsed.verdict).toBe('approved');
  });

  it('repairs cosmetic gaps instead of dropping the finding (missing id, bad line)', () => {
    const text = fenced({
      verdict: 'changes-requested',
      findings: [
        { severity: 'major', category: 'style', file: 'src/b.ts', line: 'nope', summary: 'x' },
      ],
    });
    const parsed = parseReviewVerdict(text)!;
    expect(parsed.findings).toHaveLength(1);
    expect(parsed.findings[0]!.id).toBe('F-1');
    expect(parsed.findings[0]!.line).toBeUndefined();
    expect(parsed.findings[0]!.evidence).toBe('');
  });

  it('keeps a well-formed proof and drops a proof with no command', () => {
    const text = fenced({
      verdict: 'changes-requested',
      findings: [
        { ...BLOCKER, proof: { command: 'npm test', exitCode: 1, excerpt: '1 failing' } },
        { ...BLOCKER, id: 'R2', proof: { exitCode: 1, excerpt: 'nope' } },
      ],
    });
    const parsed = parseReviewVerdict(text)!;
    expect(parsed.findings[0]!.proof).toEqual({
      command: 'npm test',
      exitCode: 1,
      excerpt: '1 failing',
    });
    // A commandless "proof" proves nothing, and would be miscounted as a PROVED
    // blocker in reviewStats — the one metric the field exists to feed.
    expect(parsed.findings[1]!.proof).toBeUndefined();
    expect(parsed.warnings.join(' ')).toContain('proof with no command');
  });

  it('records an unrecognized verdict as changes-requested rather than failing the parse', () => {
    const parsed = parseReviewVerdict(fenced({ verdict: 'LGTM', findings: [] }))!;
    expect(parsed.verdict).toBe('changes-requested');
    expect(parsed.warnings.join(' ')).toContain('unknown verdict');
  });

  it('ignores unrelated JSON objects the critic printed along the way', () => {
    const text = [
      '```json',
      '{ "coverage": 81.2 }',
      '```',
      fenced({ verdict: 'approved', findings: [] }),
      '```json',
      '{ "notes": "done" }',
      '```',
    ].join('\n');
    expect(parseReviewVerdict(text)?.verdict).toBe('approved');
  });
});

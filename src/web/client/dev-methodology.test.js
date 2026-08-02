import { describe, expect, it } from 'vitest';
import { buildDevMethodologyPayload, parseStoredMethodology } from './dev-methodology.js';

// The panel's whole contract is "what goes in the POST body" and "what a
// persisted selection may restore". Pinned here for the same reason as
// dev-models.test.js: the client half and the server half of this feature
// were written in parallel against a written contract and nothing else checks
// them together.

// A stand-in for devMethodologyOptions keys as /api/bootstrap serves them.
const KEYS = ['tdd', 'lintGate', 'standards', 'planReview'];

describe('buildDevMethodologyPayload', () => {
  it('sends NOTHING when no option is on — today\'s body, byte for byte', () => {
    expect(buildDevMethodologyPayload([])).toEqual({});
    expect(buildDevMethodologyPayload()).toEqual({});
    expect(buildDevMethodologyPayload('tdd')).toEqual({}); // not an array
  });

  it('sends exactly the ON keys, each mapped to true', () => {
    expect(buildDevMethodologyPayload(['tdd', 'standards'])).toEqual({
      methodology: { tdd: true, standards: true },
    });
    expect(buildDevMethodologyPayload(KEYS)).toEqual({
      methodology: { tdd: true, lintGate: true, standards: true, planReview: true },
    });
  });

  it('dedupes and drops blank/non-string keys', () => {
    expect(buildDevMethodologyPayload(['tdd', 'tdd', '', '  ', 7, null])).toEqual({
      methodology: { tdd: true },
    });
  });
});

describe('parseStoredMethodology', () => {
  it('restores a stored selection, filtered to keys the server still advertises', () => {
    const raw = JSON.stringify({ maxAgentMinutes: 30, devMethodology: ['tdd', 'standards'] });
    expect(parseStoredMethodology(raw, KEYS)).toEqual(['tdd', 'standards']);
  });

  it('drops keys the current build no longer serves', () => {
    const raw = JSON.stringify({ devMethodology: ['tdd', 'bdd', 'lintGate'] });
    expect(parseStoredMethodology(raw, KEYS)).toEqual(['tdd', 'lintGate']);
  });

  it('returns [] for corrupt JSON, non-arrays and missing fields', () => {
    expect(parseStoredMethodology('not json', KEYS)).toEqual([]);
    expect(parseStoredMethodology('{"devMethodology":"tdd"}', KEYS)).toEqual([]);
    expect(parseStoredMethodology('{"maxAgentMinutes":30}', KEYS)).toEqual([]);
    expect(parseStoredMethodology('null', KEYS)).toEqual([]);
  });

  it('dedupes and drops non-string entries', () => {
    const raw = JSON.stringify({ devMethodology: ['tdd', 'tdd', 42, true] });
    expect(parseStoredMethodology(raw, KEYS)).toEqual(['tdd']);
  });
});

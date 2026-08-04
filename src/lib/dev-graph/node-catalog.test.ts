import { describe, expect, it } from 'vitest';
import { DEV_METHODOLOGIES } from '../dev-mode/methodology-registry.js';
import { DEVGRAPH_SLUG_PATTERN } from './graph-types.js';
import {
  ACTION_BLOCKS,
  NODE_KINDS,
  blockIds,
  findBlock,
  methodologyOptions,
} from './node-catalog.js';

// The palette order is served to the browser, so it is a CONTRACT: appending is
// additive, reordering is not. This literal is the pin.
const EXPECTED_BLOCK_ORDER = [
  'recon',
  'implement',
  'tdd',
  'tests',
  'security-review',
  'performance-review',
  'refactor',
  'docs',
  'characterize',
  'lint-fix',
  'consolidate',
  'custom',
];

describe('node-catalog / ACTION_BLOCKS', () => {
  it('ships exactly the contracted blocks, in the contracted order', () => {
    expect(ACTION_BLOCKS.map((block) => block.id)).toEqual(EXPECTED_BLOCK_ORDER);
  });

  it('gives every block a slug id', () => {
    for (const block of ACTION_BLOCKS) {
      expect(DEVGRAPH_SLUG_PATTERN.test(block.id), block.id).toBe(true);
    }
  });

  it('has no duplicate block id', () => {
    expect(new Set(ACTION_BLOCKS.map((b) => b.id)).size).toBe(ACTION_BLOCKS.length);
  });

  it('gives every block a pt-BR label and a one-line description', () => {
    for (const block of ACTION_BLOCKS) {
      expect(block.label.length, block.id).toBeGreaterThan(0);
      expect(block.description.length, block.id).toBeGreaterThan(0);
      expect(block.description.includes('\n'), block.id).toBe(false);
    }
  });

  it('leaves only `custom` without a prompt template', () => {
    for (const block of ACTION_BLOCKS) {
      if (block.id === 'custom') expect(block.promptTemplate).toBe('');
      else expect(block.promptTemplate.length, block.id).toBeGreaterThan(0);
    }
  });

  it('injects the graph objective with $goal in every non-custom template', () => {
    for (const block of ACTION_BLOCKS) {
      if (block.id === 'custom') continue;
      expect(block.promptTemplate.includes('$goal'), block.id).toBe(true);
    }
  });

  it('uses the $file fan-out token exactly where the scope substitutes it', () => {
    for (const block of ACTION_BLOCKS) {
      const perAgent = block.defaultScope === 'per-file' || block.defaultScope === 'memory';
      expect(block.promptTemplate.includes('$file'), block.id).toBe(perAgent);
    }
  });

  it('only declares scopes the pipeline layer understands', () => {
    for (const block of ACTION_BLOCKS) {
      expect(['project', 'per-file', 'memory']).toContain(block.defaultScope);
    }
  });

  it('has exactly one producer of a fan-out list, and it is recon', () => {
    const producers = ACTION_BLOCKS.filter((block) => block.produces);
    expect(producers.map((block) => block.id)).toEqual(['recon']);
  });

  it('never marks a producer read-only (writing a list needs the write tool)', () => {
    for (const block of ACTION_BLOCKS) {
      if (block.produces) expect(block.readOnly, block.id).toBe(false);
    }
  });

  it('marks the two audit blocks read-only', () => {
    const readOnly = ACTION_BLOCKS.filter((block) => block.readOnly).map((block) => block.id);
    expect(readOnly).toEqual(['security-review', 'performance-review']);
  });

  it('turns the critic loop on for the blocks that change code with judgement', () => {
    const reviewed = ACTION_BLOCKS.filter((block) => block.review).map((block) => block.id);
    expect(reviewed).toEqual(['implement', 'tdd', 'tests', 'refactor', 'characterize']);
  });

  it('gives every block but `custom` a mechanically checkable judge clause', () => {
    for (const block of ACTION_BLOCKS) {
      if (block.id === 'custom') expect(block.judgeClause).toBeUndefined();
      else expect(block.judgeClause?.length ?? 0, block.id).toBeGreaterThan(0);
    }
  });

  it('never writes memory-file format boilerplate into a producer prompt', () => {
    // huu appends the MEMORY CONTRACT at run time (src/lib/memory-contract.ts);
    // a template that also spelled the format would drift from it.
    for (const block of ACTION_BLOCKS) {
      expect(block.promptTemplate.includes('huu-memory-v1'), block.id).toBe(false);
    }
  });
});

describe('node-catalog / findBlock + blockIds', () => {
  it('finds every shipped block by id', () => {
    for (const id of EXPECTED_BLOCK_ORDER) {
      expect(findBlock(id)?.id).toBe(id);
    }
  });

  it('returns undefined for an unknown id', () => {
    expect(findBlock('does-not-exist')).toBeUndefined();
    expect(findBlock('')).toBeUndefined();
  });

  it('lists ids in palette order', () => {
    expect(blockIds()).toEqual(EXPECTED_BLOCK_ORDER);
  });

  it('hands back a fresh array the caller may mutate', () => {
    const ids = blockIds();
    ids.push('mutated');
    expect(blockIds()).toEqual(EXPECTED_BLOCK_ORDER);
  });
});

describe('node-catalog / NODE_KINDS', () => {
  it('describes all four node kinds, entry first', () => {
    expect(NODE_KINDS.map((info) => info.kind)).toEqual(['prompt', 'action', 'research', 'gate']);
  });

  it('gives every kind a label and a description', () => {
    for (const info of NODE_KINDS) {
      expect(info.label.length, info.kind).toBeGreaterThan(0);
      expect(info.description.length, info.kind).toBeGreaterThan(0);
    }
  });
});

describe('node-catalog / methodologyOptions', () => {
  it('projects the registry rather than re-declaring it', () => {
    expect(methodologyOptions().map((option) => option.key)).toEqual(
      DEV_METHODOLOGIES.map((definition) => definition.key),
    );
  });

  it('carries the label and description of each registry entry', () => {
    const options = methodologyOptions();
    for (const [index, definition] of DEV_METHODOLOGIES.entries()) {
      expect(options[index]?.label).toBe(definition.label);
      expect(options[index]?.description).toBe(definition.description);
    }
  });

  it('does not leak the CLI flag or the planner bullet into the browser payload', () => {
    for (const option of methodologyOptions()) {
      expect(Object.keys(option).sort()).toEqual(['description', 'key', 'label']);
    }
  });

  it('hands back a fresh array every call', () => {
    const first = methodologyOptions();
    first.pop();
    expect(methodologyOptions().length).toBe(DEV_METHODOLOGIES.length);
  });
});

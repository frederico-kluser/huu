import { describe, it, expect } from 'vitest';
import {
  buildRowLabel,
  buildRowBody,
  HEADER_ROW,
  COL,
  EMPTY_METRICS,
  padR,
  padL,
  type AARowMetrics,
} from './format-row.js';
import type { ModelEntry } from '../contracts/models.js';

const sampleEntry: ModelEntry = {
  id: 'deepseek/deepseek-v4-pro',
  label: 'DeepSeek V4 Pro',
  inputPrice: 0.85,
  outputPrice: 5.2,
  bestFor: ['coding', 'agentic'],
  tier: 'flagship',
  description: 'Flagship coding-first.',
};

const sampleMetrics: AARowMetrics = {
  agentic: 72,
  coding: 81,
  reasoning: 76,
  tokensPerSecond: 90,
};

describe('padR / padL', () => {
  it('right-pads with spaces to width', () => {
    expect(padR('abc', 6)).toBe('abc   ');
    expect(padR('abc', 6).length).toBe(6);
  });

  it('left-pads with spaces to width', () => {
    expect(padL('1', 4)).toBe('   1');
    expect(padL('1', 4).length).toBe(4);
  });

  it('truncates strings longer than the target width without ellipsis', () => {
    expect(padR('verylongstring', 5)).toBe('veryl');
    expect(padL('verylongstring', 5)).toBe('veryl');
  });
});

describe('buildRowBody', () => {
  it('renders a fixed-width row matching the configured column widths', () => {
    const row = buildRowBody(sampleEntry, sampleMetrics);
    // label(20) + speed(7) + agnt(5) + code(5) + razn(5) + price(15) + bestFor
    const fixedWidth = COL.label + COL.speed + COL.agentic + COL.coding + COL.reasoning + COL.price;
    expect(row.startsWith('DeepSeek V4 Pro     ')).toBe(true);
    // Numbers appear in their respective columns
    expect(row.slice(COL.label, COL.label + COL.speed)).toMatch(/^90 +$/);
    expect(row.slice(COL.label + COL.speed, COL.label + COL.speed + COL.agentic)).toMatch(/^72 +$/);
    // Best-for tags follow the price column
    expect(row.slice(fixedWidth)).toBe('coding,agentic');
  });

  it('renders dashes when AA metrics are missing', () => {
    const row = buildRowBody(sampleEntry, EMPTY_METRICS);
    // tok/s column should start with the em-dash placeholder
    expect(row.slice(COL.label, COL.label + COL.speed).trimEnd()).toBe('—');
  });

  it('renders a $? placeholder when prices are missing', () => {
    const row = buildRowBody(
      { id: 'foo/bar', label: 'Foo' },
      EMPTY_METRICS,
    );
    const priceStart = COL.label + COL.speed + COL.agentic + COL.coding + COL.reasoning;
    expect(row.slice(priceStart, priceStart + COL.price).trimEnd()).toBe('$?/$?');
  });
});

describe('buildRowLabel', () => {
  it('prepends a fixed-width prefix column so columns line up across prefixed and unprefixed rows', () => {
    const withStar = buildRowLabel(sampleEntry, sampleMetrics, '★');
    const withoutPrefix = buildRowLabel(sampleEntry, sampleMetrics, '');
    // After prefix(2) the label column should start at the same offset.
    expect(withStar.slice(COL.prefix, COL.prefix + 8)).toBe(withoutPrefix.slice(COL.prefix, COL.prefix + 8));
  });
});

describe('HEADER_ROW', () => {
  it('contains the column titles in order', () => {
    expect(HEADER_ROW).toMatch(/Model.*tok\/s.*Agnt.*Code.*Razn.*\$in\/out.*BestFor/);
  });
});

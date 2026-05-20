import type { ModelEntry, ModelUseCase } from '../contracts/models.js';

/**
 * Fixed-width column layout used by the quick model selector. The widths are
 * tuned so the row fits in ~80 columns including the SelectInput indicator
 * (2 cells) before the row.
 *
 * Why fixed widths in a string instead of an Ink Box layout: ink-select-input
 * v5 renders each item via a single Text node from a string `label`. Multi-cell
 * Box layouts inside that node aren't supported, so we ship a monospace string.
 */
export const COL = {
  prefix: 2,
  label: 20,
  speed: 7,
  agentic: 5,
  coding: 5,
  reasoning: 5,
  price: 15,
} as const;

export const HEADER_ROW = (() => {
  return (
    padR('Model', COL.prefix + COL.label) +
    padR('tok/s', COL.speed) +
    padR('Agnt', COL.agentic) +
    padR('Code', COL.coding) +
    padR('Razn', COL.reasoning) +
    padR('$in/out', COL.price) +
    'BestFor'
  );
})();

/**
 * Metrics extracted from a matched Artificial Analysis entry. Any null means
 * either the model didn't match an AA row or AA didn't publish that metric.
 */
export interface AARowMetrics {
  /** artificial_analysis_intelligence_index — used as agentic proxy. */
  readonly agentic: number | null;
  /** artificial_analysis_coding_index — programming. */
  readonly coding: number | null;
  /** artificial_analysis_math_index — reasoning proxy. */
  readonly reasoning: number | null;
  /** median_output_tokens_per_second. */
  readonly tokensPerSecond: number | null;
}

export const EMPTY_METRICS: AARowMetrics = {
  agentic: null,
  coding: null,
  reasoning: null,
  tokensPerSecond: null,
};

/** Right-pad to `width`. Truncates with no ellipsis when overflowing. */
export function padR(s: string, width: number): string {
  if (s.length >= width) return s.slice(0, width);
  return s + ' '.repeat(width - s.length);
}

/** Left-pad to `width`. */
export function padL(s: string, width: number): string {
  if (s.length >= width) return s.slice(0, width);
  return ' '.repeat(width - s.length) + s;
}

/** "—" placeholder for missing metric values. Single cell. */
const DASH = '—';

function formatNumber(n: number | null, decimals = 0): string {
  if (n === null || Number.isNaN(n)) return DASH;
  return decimals === 0 ? String(Math.round(n)) : n.toFixed(decimals);
}

function formatPrice(p: number | undefined | null): string {
  if (p === undefined || p === null) return '$?';
  return `$${p.toFixed(2)}`;
}

/**
 * Pretty-print a tag list. The first tag is highlighted by leading the string;
 * the rest are joined with `,`. Truncated at 14 chars to keep the row tight.
 */
function formatBestFor(tags: readonly ModelUseCase[] | undefined): string {
  if (!tags || tags.length === 0) return '';
  const joined = tags.slice(0, 3).join(',');
  return joined.length > 14 ? joined.slice(0, 14) : joined;
}

/**
 * Build the right-of-prefix section of a row: label, speed, the three
 * benchmark indices, prices, and best-for tags. The caller is responsible
 * for prepending the prefix column (e.g. recent/favorite glyph or spaces).
 */
export function buildRowBody(entry: ModelEntry, metrics: AARowMetrics): string {
  const speed = metrics.tokensPerSecond !== null ? formatNumber(metrics.tokensPerSecond) : DASH;
  const agnt = formatNumber(metrics.agentic);
  const code = formatNumber(metrics.coding);
  const razn = formatNumber(metrics.reasoning);
  const price = `${formatPrice(entry.inputPrice)}/${formatPrice(entry.outputPrice)}`;
  const best = formatBestFor(entry.bestFor);

  return (
    padR(entry.label, COL.label) +
    padR(speed, COL.speed) +
    padR(agnt, COL.agentic) +
    padR(code, COL.coding) +
    padR(razn, COL.reasoning) +
    padR(price, COL.price) +
    best
  );
}

/**
 * Full row including a prefix column. Pass an empty string when there's no
 * prefix; this function pads it to the prefix width so columns line up.
 */
export function buildRowLabel(
  entry: ModelEntry,
  metrics: AARowMetrics,
  prefix: string,
): string {
  return padR(prefix, COL.prefix) + buildRowBody(entry, metrics);
}

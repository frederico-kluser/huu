/**
 * USD formatting for run/agent spend. Twin of the web client's `fmtCost`
 * (`src/web/client/app.js`) so both front-ends read the same number the same way.
 *
 * The 4-decimal branch is load-bearing: agent costs are routinely fractions of a
 * cent, and `toFixed(2)` renders a live run as a motionless "$0.00".
 */
export function formatCost(usd: number): string {
  if (!Number.isFinite(usd)) return '$0.0000';
  return `$${usd >= 1 ? usd.toFixed(2) : usd.toFixed(4)}`;
}

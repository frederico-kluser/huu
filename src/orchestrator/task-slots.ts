/**
 * Free slots a run's TASK pool may fill this tick.
 *
 * `reserved` counts the run's live judge/integration agents (the reserved ids
 * 9998/9999). They never enter the pool's own maps, but they hold real RAM and
 * are counted in the run's reported demand (`getDemand`). The COUPLING is the
 * invariant this module pins: if demand includes a reserved agent but the
 * pool's busy side did not, the demand-capped grant would carry one slot FOR
 * the judge and the pool would read it as free — spawning one task agent
 * BEYOND the budget on top of the judge. Both sides must count reserved, or
 * neither. (Within one run the overlap is unreachable today — checks are
 * singleton waves and merges run after the pool drains — so this is insurance
 * plus spec, not a live-bug fix.)
 */
export function availableTaskSlots(
  grant: number,
  active: number,
  spawning: number,
  reserved: number,
): number {
  return Math.max(0, grant - (active + spawning + reserved));
}

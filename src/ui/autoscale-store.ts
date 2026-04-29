import { useEffect, useState } from 'react';
import type { AutoscaleSnapshot } from '../lib/types.js';

/**
 * Tiny pub-sub for autoscale UI state. The orchestrator lives inside
 * RunDashboard but the SystemMetricsBar is rendered globally in App — they
 * can't share state through React context without lifting the orchestrator
 * up. This singleton is the minimum-friction bridge: the dashboard writes,
 * the bar subscribes via `useAutoscaleSnapshot()`. Reset to defaults when
 * the dashboard unmounts so a stale "AUTO" label never bleeds across runs.
 */
type Listener = (s: AutoscaleSnapshot) => void;

const DEFAULT_SNAPSHOT: AutoscaleSnapshot = {
  enabled: false,
  killedCount: 0,
  preemptedAbortedCount: 0,
};

let current: AutoscaleSnapshot = DEFAULT_SNAPSHOT;
const listeners = new Set<Listener>();

export function setAutoscaleSnapshot(snapshot: AutoscaleSnapshot): void {
  if (
    current.enabled === snapshot.enabled &&
    current.killedCount === snapshot.killedCount &&
    current.preemptedAbortedCount === snapshot.preemptedAbortedCount &&
    current.lastAction === snapshot.lastAction &&
    current.lastActionAt === snapshot.lastActionAt
  ) {
    return;
  }
  current = snapshot;
  for (const listener of listeners) listener(snapshot);
}

export function resetAutoscaleSnapshot(): void {
  setAutoscaleSnapshot(DEFAULT_SNAPSHOT);
}

export function useAutoscaleSnapshot(): AutoscaleSnapshot {
  const [snapshot, setSnapshot] = useState(current);
  useEffect(() => {
    listeners.add(setSnapshot);
    setSnapshot(current);
    return () => {
      listeners.delete(setSnapshot);
    };
  }, []);
  return snapshot;
}

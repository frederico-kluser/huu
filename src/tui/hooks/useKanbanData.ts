// Polling hook for Kanban data with change detection
//
// Uses a 2-phase approach:
// 1. getWatermark() — cheap check for changes
// 2. getSnapshot() — full read only when watermark changes
//
// Adaptive polling: 500ms with running tasks, 1500ms when idle.
// Paused when Kanban tab is not active.

import { useState, useEffect, useRef } from 'react';
import type { BoardSnapshot, KanbanDataProvider } from '../types.js';

const POLL_ACTIVE_MS = 500;
const POLL_IDLE_MS = 1500;

export function useKanbanData(
  provider: KanbanDataProvider,
  isActive: boolean,
): BoardSnapshot {
  const [snapshot, setSnapshot] = useState<BoardSnapshot>(() =>
    provider.getSnapshot(),
  );
  const lastWatermarkRef = useRef(snapshot.watermark);
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;

  useEffect(() => {
    if (!isActive) return;

    let timer: ReturnType<typeof setTimeout> | undefined;
    let mounted = true;

    function poll(): void {
      if (!mounted) return;

      try {
        const wm = provider.getWatermark();
        if (wm !== lastWatermarkRef.current) {
          const next = provider.getSnapshot();
          lastWatermarkRef.current = next.watermark;
          snapshotRef.current = next;
          setSnapshot(next);
        }
      } catch {
        // Skip on transient error (e.g., SQLITE_BUSY)
      }

      const hasRunning = snapshotRef.current.tasks.some(
        (t) => t.column === 'running',
      );
      timer = setTimeout(poll, hasRunning ? POLL_ACTIVE_MS : POLL_IDLE_MS);
    }

    // Start polling after initial delay
    timer = setTimeout(poll, POLL_ACTIVE_MS);

    return () => {
      mounted = false;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [isActive, provider]);

  return snapshot;
}

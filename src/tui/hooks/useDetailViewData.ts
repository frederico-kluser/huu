// Polling hook for Detail View data with change detection
//
// Mirrors useKanbanData pattern: 2-phase watermark + snapshot.
// Polls at 300ms when task is running, 2000ms when done/failed.
// Maintains a ring buffer of log lines (max 2000).

import { useState, useEffect, useRef } from 'react';
import type { DetailDataProvider, DetailSnapshot } from '../types.js';

const POLL_ACTIVE_MS = 300;
const POLL_IDLE_MS = 2000;
const MAX_LOG_LINES = 2000;

const EMPTY_SNAPSHOT: DetailSnapshot = {
  taskId: '',
  taskName: '',
  agent: '',
  column: 'backlog',
  logs: [],
  diffs: [],
  metrics: {
    inputTokens: 0,
    outputTokens: 0,
    contextUsedTokens: 0,
    contextWindowTokens: 0,
    costUsd: 0,
    elapsedMs: 0,
    model: 'N/A',
    startedAt: null,
    updatedAt: null,
  },
  interventionLevel: 'ok',
  interventionSignals: [],
  watermark: '',
};

export function useDetailViewData(
  provider: DetailDataProvider | undefined,
  taskId: string | null,
): DetailSnapshot {
  const [snapshot, setSnapshot] = useState<DetailSnapshot>(EMPTY_SNAPSHOT);
  const lastWatermarkRef = useRef('');
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;

  useEffect(() => {
    if (!provider || !taskId) {
      setSnapshot(EMPTY_SNAPSHOT);
      return;
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    let mounted = true;

    function poll(): void {
      if (!mounted || !provider || !taskId) return;

      try {
        const wm = provider.getDetailWatermark(taskId);
        if (wm !== lastWatermarkRef.current) {
          const next = provider.getDetailSnapshot(taskId);
          // Enforce ring buffer limit on logs
          if (next.logs.length > MAX_LOG_LINES) {
            next.logs = next.logs.slice(next.logs.length - MAX_LOG_LINES);
          }
          lastWatermarkRef.current = next.watermark;
          snapshotRef.current = next;
          setSnapshot(next);
        }
      } catch {
        // Skip on transient error
      }

      const isActive =
        snapshotRef.current.column === 'running' ||
        snapshotRef.current.column === 'review';
      timer = setTimeout(poll, isActive ? POLL_ACTIVE_MS : POLL_IDLE_MS);
    }

    // Reset on task change
    lastWatermarkRef.current = '';
    poll();

    return () => {
      mounted = false;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [provider, taskId]);

  return snapshot;
}

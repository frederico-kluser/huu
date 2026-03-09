// Lightweight view transition hook for Kanban ↔ Detail navigation
//
// Provides a short transitioning state (150ms) between views.
// Falls back to instant transition when disabled.

import { useState, useCallback, useRef, useEffect } from 'react';

export type ViewState = 'kanban' | 'transitioning' | 'detail';

export interface ViewTransition {
  view: ViewState;
  detailTaskId: string | null;
  openDetail(taskId: string): void;
  closeDetail(): void;
}

const TRANSITION_MS = 150;

export function useViewTransition(
  enableTransitions: boolean = true,
): ViewTransition {
  const [view, setView] = useState<ViewState>('kanban');
  const [detailTaskId, setDetailTaskId] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current !== undefined) clearTimeout(timerRef.current);
    };
  }, []);

  const openDetail = useCallback(
    (taskId: string) => {
      setDetailTaskId(taskId);
      if (enableTransitions) {
        setView('transitioning');
        timerRef.current = setTimeout(() => {
          setView('detail');
        }, TRANSITION_MS);
      } else {
        setView('detail');
      }
    },
    [enableTransitions],
  );

  const closeDetail = useCallback(() => {
    if (timerRef.current !== undefined) clearTimeout(timerRef.current);
    setView('kanban');
    // Keep detailTaskId so Kanban can restore focus
  }, []);

  return { view, detailTaskId, openDetail, closeDetail };
}

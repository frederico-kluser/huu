// Polling hooks for specialized views — same 2-phase pattern as useKanbanData
//
// Each hook:
// 1. getWatermark() — cheap change detection
// 2. getSnapshot() — full read only when watermark changes
// Paused when tab is not active.

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import type {
  LogsSnapshot,
  LogsDataProvider,
  MergeQueueSnapshot,
  MergeQueueDataProvider,
  CostSnapshot,
  CostDataProvider,
  CostGroupBy,
  BeatSheetSnapshot,
  BeatSheetDataProvider,
  BeatNode,
  LogLevel,
  CoordinationMetricsSnapshot,
  CoordinationMetricsProvider,
} from '../types.js';

const POLL_ACTIVE_MS = 500;
const POLL_IDLE_MS = 1500;

// ── Logs hook ───────────────────────────────────────────────────────

const EMPTY_LOGS: LogsSnapshot = { entries: [], watermark: '0' };
const LOG_BUFFER_MAX = 5000;

export interface LogsFilter {
  agents: string[];
  levels: LogLevel[];
  search: string;
  searchRegex: boolean;
}

const DEFAULT_LOGS_FILTER: LogsFilter = {
  agents: [],
  levels: [],
  search: '',
  searchRegex: false,
};

export function useLogsData(
  provider: LogsDataProvider | undefined,
  isActive: boolean,
) {
  const [snapshot, setSnapshot] = useState<LogsSnapshot>(EMPTY_LOGS);
  const lastWatermarkRef = useRef('');

  useEffect(() => {
    if (!isActive || !provider) return;

    let timer: ReturnType<typeof setTimeout> | undefined;
    let mounted = true;

    function poll(): void {
      if (!mounted) return;
      try {
        const wm = provider!.getWatermark();
        if (wm !== lastWatermarkRef.current) {
          const next = provider!.getSnapshot(LOG_BUFFER_MAX);
          lastWatermarkRef.current = next.watermark;
          setSnapshot(next);
        }
      } catch {
        // Skip on transient error
      }
      timer = setTimeout(poll, POLL_ACTIVE_MS);
    }

    timer = setTimeout(poll, POLL_ACTIVE_MS);
    return () => {
      mounted = false;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [isActive, provider]);

  const [filter, setFilter] = useState<LogsFilter>(DEFAULT_LOGS_FILTER);
  const [scrollOffset, setScrollOffset] = useState(0);

  const filteredEntries = useMemo(() => {
    let entries = snapshot.entries;

    if (filter.agents.length > 0) {
      const agentSet = new Set(filter.agents);
      entries = entries.filter((e: { agentId: string }) => agentSet.has(e.agentId));
    }

    if (filter.levels.length > 0) {
      const levelSet = new Set(filter.levels);
      entries = entries.filter((e: { level: LogLevel }) => levelSet.has(e.level));
    }

    if (filter.search) {
      if (filter.searchRegex) {
        try {
          const re = new RegExp(filter.search, 'i');
          entries = entries.filter((e: { message: string }) => re.test(e.message));
        } catch {
          const lower = filter.search.toLowerCase();
          entries = entries.filter((e: { message: string }) =>
            e.message.toLowerCase().includes(lower),
          );
        }
      } else {
        const lower = filter.search.toLowerCase();
        entries = entries.filter((e: { message: string }) =>
          e.message.toLowerCase().includes(lower),
        );
      }
    }

    return entries;
  }, [snapshot.entries, filter]);

  const counts = useMemo(() => {
    const total = snapshot.entries.length;
    let errors = 0;
    let warns = 0;
    const agents = new Set<string>();
    for (const e of snapshot.entries) {
      if (e.level === 'error') errors++;
      if (e.level === 'warn') warns++;
      agents.add(e.agentId);
    }
    return { total, errors, warns, agentCount: agents.size };
  }, [snapshot.entries]);

  return {
    entries: filteredEntries,
    counts,
    filter,
    setFilter,
    scrollOffset,
    setScrollOffset,
  };
}

// ── Merge Queue hook ────────────────────────────────────────────────

const EMPTY_MERGE: MergeQueueSnapshot = {
  items: [],
  queueLength: 0,
  runningCount: 0,
  blockedCount: 0,
  avgWaitMs: 0,
  watermark: '0',
};

export function useMergeQueueData(
  provider: MergeQueueDataProvider | undefined,
  isActive: boolean,
) {
  const [snapshot, setSnapshot] = useState<MergeQueueSnapshot>(EMPTY_MERGE);
  const lastWatermarkRef = useRef('');

  useEffect(() => {
    if (!isActive || !provider) return;

    let timer: ReturnType<typeof setTimeout> | undefined;
    let mounted = true;

    function poll(): void {
      if (!mounted) return;
      try {
        const wm = provider!.getWatermark();
        if (wm !== lastWatermarkRef.current) {
          const next = provider!.getSnapshot();
          lastWatermarkRef.current = next.watermark;
          setSnapshot(next);
        }
      } catch {
        // Skip on transient error
      }
      const active = snapshot.runningCount > 0 || snapshot.queueLength > 0;
      timer = setTimeout(poll, active ? POLL_ACTIVE_MS : POLL_IDLE_MS);
    }

    timer = setTimeout(poll, POLL_ACTIVE_MS);
    return () => {
      mounted = false;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [isActive, provider, snapshot.runningCount, snapshot.queueLength]);

  const [selectedIndex, setSelectedIndex] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);

  const filteredItems = useMemo(() => {
    if (!statusFilter) return snapshot.items;
    return snapshot.items.filter((i: { status: string }) => i.status === statusFilter);
  }, [snapshot.items, statusFilter]);

  return {
    snapshot,
    filteredItems,
    selectedIndex,
    setSelectedIndex,
    expandedId,
    setExpandedId,
    statusFilter,
    setStatusFilter,
  };
}

// ── Cost hook ───────────────────────────────────────────────────────

const EMPTY_COST: CostSnapshot = {
  totalCostUsd: 0,
  totalTokens: 0,
  avgCostPerTask: 0,
  rows: [],
  trend: [],
  watermark: '0',
};

export function useCostData(
  provider: CostDataProvider | undefined,
  isActive: boolean,
) {
  const [groupBy, setGroupBy] = useState<CostGroupBy>('agent');
  const [snapshot, setSnapshot] = useState<CostSnapshot>(EMPTY_COST);
  const lastWatermarkRef = useRef('');

  useEffect(() => {
    if (!isActive || !provider) return;

    let timer: ReturnType<typeof setTimeout> | undefined;
    let mounted = true;

    function poll(): void {
      if (!mounted) return;
      try {
        const wm = provider!.getWatermark();
        if (wm !== lastWatermarkRef.current) {
          const next = provider!.getSnapshot(groupBy);
          lastWatermarkRef.current = next.watermark;
          setSnapshot(next);
        }
      } catch {
        // Skip on transient error
      }
      timer = setTimeout(poll, POLL_IDLE_MS);
    }

    timer = setTimeout(poll, POLL_ACTIVE_MS);
    return () => {
      mounted = false;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [isActive, provider, groupBy]);

  return { snapshot, groupBy, setGroupBy };
}

// ── Beat Sheet hook ─────────────────────────────────────────────────

const EMPTY_BEAT: BeatSheetSnapshot = {
  nodes: [],
  checkpoints: [],
  overallProgressPct: 0,
  watermark: '0',
};

export function useBeatSheetData(
  provider: BeatSheetDataProvider | undefined,
  isActive: boolean,
) {
  const [snapshot, setSnapshot] = useState<BeatSheetSnapshot>(EMPTY_BEAT);
  const lastWatermarkRef = useRef('');

  useEffect(() => {
    if (!isActive || !provider) return;

    let timer: ReturnType<typeof setTimeout> | undefined;
    let mounted = true;

    function poll(): void {
      if (!mounted) return;
      try {
        const wm = provider!.getWatermark();
        if (wm !== lastWatermarkRef.current) {
          const next = provider!.getSnapshot();
          lastWatermarkRef.current = next.watermark;
          setSnapshot(next);
        }
      } catch {
        // Skip on transient error
      }
      timer = setTimeout(poll, POLL_IDLE_MS);
    }

    timer = setTimeout(poll, POLL_ACTIVE_MS);
    return () => {
      mounted = false;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [isActive, provider]);

  const [expandedIds, setExpandedIds] = useState<Set<string>>(
    () => new Set<string>(),
  );
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Build visible nodes based on expanded state
  const visibleNodes = useMemo(() => {
    const result: BeatNode[] = [];
    const expandedSet = expandedIds;

    for (const node of snapshot.nodes) {
      if (!node.parentId) {
        result.push(node);
      } else {
        let visible = true;
        let currentParentId: string | undefined = node.parentId;
        const visited = new Set<string>();
        while (currentParentId && !visited.has(currentParentId)) {
          visited.add(currentParentId);
          if (!expandedSet.has(currentParentId)) {
            visible = false;
            break;
          }
          const parent = snapshot.nodes.find((n: BeatNode) => n.id === currentParentId);
          currentParentId = parent?.parentId;
        }
        if (visible) result.push(node);
      }
    }

    return result;
  }, [snapshot.nodes, expandedIds]);

  const toggleExpand = useCallback((id: string) => {
    setExpandedIds((prev: Set<string>) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const expandNode = useCallback((id: string) => {
    setExpandedIds((prev: Set<string>) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }, []);

  const collapseNode = useCallback((id: string) => {
    setExpandedIds((prev: Set<string>) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  return {
    snapshot,
    visibleNodes,
    expandedIds,
    selectedIndex,
    setSelectedIndex,
    toggleExpand,
    expandNode,
    collapseNode,
  };
}

// ── Coordination Metrics hook ────────────────────────────────────────

const EMPTY_COORDINATION: CoordinationMetricsSnapshot = {
  coordinationMs: 0,
  executionMs: 0,
  ratio: 0,
  level: 'green',
  taskCount: 0,
  p50QueueWaitMs: 0,
  p95QueueWaitMs: 0,
  avgMergeWaitMs: 0,
  tasksPerSecond: 0,
  schedulerRunning: 0,
  schedulerPending: 0,
  schedulerSaturated: false,
  watermark: '0',
};

export function useCoordinationMetrics(
  provider: CoordinationMetricsProvider | undefined,
  isActive: boolean,
) {
  const [snapshot, setSnapshot] = useState<CoordinationMetricsSnapshot>(EMPTY_COORDINATION);
  const lastWatermarkRef = useRef('');

  useEffect(() => {
    if (!isActive || !provider) return;

    let timer: ReturnType<typeof setTimeout> | undefined;
    let mounted = true;

    function poll(): void {
      if (!mounted) return;
      try {
        const wm = provider!.getWatermark();
        if (wm !== lastWatermarkRef.current) {
          const next = provider!.getSnapshot();
          lastWatermarkRef.current = next.watermark;
          setSnapshot(next);
        }
      } catch {
        // Skip on transient error
      }
      timer = setTimeout(poll, POLL_ACTIVE_MS);
    }

    timer = setTimeout(poll, POLL_ACTIVE_MS);
    return () => {
      mounted = false;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [isActive, provider]);

  return { metrics: snapshot };
}

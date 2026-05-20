/**
 * Resolves the selector LLM's raw output into a uniform list of runnable
 * recon items. Selector output is heterogeneous on purpose — strings reference
 * catalog ids, objects describe a custom mission. We:
 *
 *   1. Walk the array, classify each element (string vs object).
 *   2. For strings, try to resolve against the catalog (exact → normalized →
 *      Levenshtein ≤ 2). LLMs hallucinate ids ("structure-modules" instead of
 *      "structure"); fuzzy matching catches that without us re-prompting.
 *   3. For objects, take {title, prompt} verbatim and synthesize a tag.
 *   4. Dedupe by tag and by mission body, then cap at MAX_SELECTIONS.
 *
 * Anything that can't be resolved is dropped silently and reported via the
 * returned `dropped` array, so the caller (UI / telemetry) can surface why a
 * selection went missing without breaking the recon stage.
 */

import {
  RECON_CATALOG,
  type ReconCatalogEntry,
  type ReconCatalogId,
  type ReconRunItem,
} from './project-recon-prompts.js';

export const MAX_SELECTIONS = 10;

/** Raw output shape from the selector LLM. */
export type RawSelection =
  | string
  | { title: string; prompt: string };

export interface ResolveResult {
  items: ReconRunItem[];
  /** Raw selections that we couldn't resolve (string ids that didn't match anything). */
  dropped: Array<{ raw: string; reason: string }>;
}

const CATALOG_BY_ID = new Map<ReconCatalogId, ReconCatalogEntry>(
  RECON_CATALOG.map((e) => [e.id, e]),
);

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Iterative Levenshtein with a tight ceiling — `max` lets us bail out as soon
 * as we know two strings are too different to ever match. Used only for short
 * catalog ids (≤ 30 chars) so the O(m·n) cost is negligible.
 */
function levenshtein(a: string, b: string, max: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array<number>(n + 1);
  let curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j += 1) prev[j] = j;
  for (let i = 1; i <= m; i += 1) {
    curr[0] = i;
    let rowMin = curr[0]!;
    for (let j = 1; j <= n; j += 1) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(curr[j - 1]! + 1, prev[j]! + 1, prev[j - 1]! + cost);
      if (curr[j]! < rowMin) rowMin = curr[j]!;
    }
    if (rowMin > max) return max + 1;
    [prev, curr] = [curr, prev];
  }
  return prev[n]!;
}

/**
 * Tries to map an arbitrary string to a catalog entry. Returns null when no
 * acceptable match is found — the caller decides whether to drop or surface.
 *
 * Fuzzy strategy:
 *   1. Exact (case-sensitive)        → highest confidence, model used the id.
 *   2. Exact normalized              → model used the wrong case/punctuation.
 *   3. Levenshtein ≤ 2 on normalized → small typos (`structre` → `structure`).
 *   4. Substring containment         → "module structure" → "structure".
 */
export function resolveCatalogId(input: string): ReconCatalogEntry | null {
  if (!input) return null;

  const direct = CATALOG_BY_ID.get(input as ReconCatalogId);
  if (direct) return direct;

  const norm = normalize(input);
  if (!norm) return null;

  for (const entry of RECON_CATALOG) {
    if (normalize(entry.id) === norm) return entry;
  }

  let best: { entry: ReconCatalogEntry; dist: number } | null = null;
  for (const entry of RECON_CATALOG) {
    const dist = levenshtein(norm, normalize(entry.id), 2);
    if (dist <= 2 && (best === null || dist < best.dist)) {
      best = { entry, dist };
    }
  }
  if (best) return best.entry;

  for (const entry of RECON_CATALOG) {
    const eid = normalize(entry.id);
    if (eid.length >= 4 && (norm.includes(eid) || eid.includes(norm))) {
      return entry;
    }
  }

  return null;
}

function isCustomObject(x: unknown): x is { title: string; prompt: string } {
  return (
    typeof x === 'object' &&
    x !== null &&
    typeof (x as { title?: unknown }).title === 'string' &&
    typeof (x as { prompt?: unknown }).prompt === 'string'
  );
}

/**
 * Normalizes a selector array into a uniform `ReconRunItem[]`. Drops invalid
 * entries and dedupes — same catalog id twice, identical custom titles, or
 * identical mission bodies all collapse to a single item.
 */
export function resolveSelections(raw: readonly RawSelection[]): ResolveResult {
  const items: ReconRunItem[] = [];
  const dropped: Array<{ raw: string; reason: string }> = [];
  const seenTags = new Set<string>();
  const seenMissions = new Set<string>();
  let customIdx = 0;

  for (const sel of raw) {
    if (items.length >= MAX_SELECTIONS) break;

    if (typeof sel === 'string') {
      const entry = resolveCatalogId(sel);
      if (!entry) {
        dropped.push({ raw: sel, reason: 'no catalog match' });
        continue;
      }
      if (seenTags.has(entry.id)) continue;
      seenTags.add(entry.id);
      seenMissions.add(entry.mission);
      items.push({
        tag: entry.id,
        label: entry.label,
        mission: entry.mission,
        source: 'catalog',
      });
      continue;
    }

    if (isCustomObject(sel)) {
      const title = sel.title.trim().slice(0, 80);
      const prompt = sel.prompt.trim();
      if (!title || prompt.length < 10) {
        dropped.push({
          raw: JSON.stringify(sel).slice(0, 120),
          reason: 'custom item missing title or prompt',
        });
        continue;
      }
      if (seenMissions.has(prompt)) continue;
      const tag = `custom:${customIdx}`;
      customIdx += 1;
      seenTags.add(tag);
      seenMissions.add(prompt);
      items.push({ tag, label: title, mission: prompt, source: 'custom' });
      continue;
    }

    dropped.push({
      raw: typeof sel === 'object' ? JSON.stringify(sel).slice(0, 120) : String(sel),
      reason: 'unrecognized selection shape',
    });
  }

  return { items, dropped };
}

/** Catalog-only fallback — used when the selector itself errors out so the
 *  recon stage degrades gracefully into the legacy "always run all 4" mode. */
export function fallbackCoreItems(): ReconRunItem[] {
  const coreIds: ReconCatalogId[] = ['stack', 'structure', 'libraries', 'conventions'];
  return coreIds
    .map((id) => CATALOG_BY_ID.get(id)!)
    .map((entry) => ({
      tag: entry.id,
      label: entry.label,
      mission: entry.mission,
      source: 'catalog' as const,
    }));
}

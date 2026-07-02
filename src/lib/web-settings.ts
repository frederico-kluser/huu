/**
 * Server-side persistence for the web UI's machine-global settings — today
 * just the RAM-budget dial. Before this file the dial lived ONLY in the
 * browser's localStorage and traveled piggybacked on each `POST /api/run`, so
 * changing the gear mid-run silently did nothing and a blank field silently
 * meant 85% — the "I set 50% and I can't even tell whether it took" failure.
 * The server is now the source of truth: `POST /api/settings` applies the dial
 * to the shared scheduler IMMEDIATELY and persists it here; `/api/bootstrap`
 * reads it back so every browser sees the effective value.
 *
 * Same XDG location convention as the api-key config
 * (`~/.config/huu/web-settings.json`). Pure + leaf (`src/lib`); load/save
 * never throw — a broken settings file degrades to defaults, never blocks.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { clampPercent } from './budget.js';

export interface WebSettings {
  /** Machine-global RAM budget dial (clamped 10–95). Absent → env/default. */
  ramPercent?: number;
}

/** Path to the persisted web settings. Exposed for tests + help text. */
export function webSettingsPath(env: NodeJS.ProcessEnv = process.env): string {
  const xdg = env.XDG_CONFIG_HOME?.trim();
  const dir = xdg ? join(xdg, 'huu') : join(homedir(), '.config', 'huu');
  return join(dir, 'web-settings.json');
}

/** Load persisted settings. Missing/corrupt file → `{}` (never throws). */
export function loadWebSettings(path: string = webSettingsPath()): WebSettings {
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    const out: WebSettings = {};
    if (typeof raw.ramPercent === 'number' && Number.isFinite(raw.ramPercent)) {
      out.ramPercent = clampPercent(raw.ramPercent);
    }
    return out;
  } catch {
    return {};
  }
}

/** Persist settings (mkdir -p). Best-effort: returns false on failure. */
export function saveWebSettings(
  settings: WebSettings,
  path: string = webSettingsPath(),
): boolean {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
    return true;
  } catch {
    return false;
  }
}

/**
 * Host-side persistence for huu's machine-global settings — today just the
 * RAM-budget dial. Before this file the dial lived ONLY in the browser's
 * localStorage and traveled piggybacked on each `POST /api/run`, so changing the
 * gear mid-run silently did nothing and a blank field silently meant 85% — the
 * "I set 50% and I can't even tell whether it took" failure. The host is now the
 * source of truth: `POST /api/settings` applies the dial to the shared scheduler
 * IMMEDIATELY and persists it here; `/api/bootstrap` reads it back so every
 * browser sees the effective value.
 *
 * NOT web-only despite the filename: the dial is MACHINE-global (one machine,
 * one RAM), so the Ink TUI's Options screen writes the SAME store and
 * {@link effectiveRamPercent} is what every scheduler/AutoScaler construction
 * resolves through. The on-disk name stays `web-settings.json` so dials users
 * already persisted keep working.
 *
 * Same XDG location convention as the api-key config
 * (`~/.config/huu/web-settings.json`). Pure + leaf (`src/lib`); load/save
 * never throw — a broken settings file degrades to defaults, never blocks.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { clampPercent, resolveRamPercent } from './budget.js';

export interface WebSettings {
  /** Machine-global RAM budget dial (clamped 10–95). Absent → env/default. */
  ramPercent?: number;
}

/**
 * Path to the persisted web settings. Exposed for tests + help text.
 * `HUU_CONFIG_DIR` (the host config dir the Docker wrapper mounts RW into
 * the container) wins over local XDG — same rule as `configFilePath()` in
 * api-key.ts, and for the same reason: the container's $HOME is ephemeral,
 * so settings saved in-container must land on the host to survive.
 */
export function webSettingsPath(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.HUU_CONFIG_DIR?.trim();
  if (explicit) return join(explicit, 'web-settings.json');
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

/**
 * The RAM dial actually in force, layered:
 *
 *   explicit argument → persisted store → `HUU_RAM_PERCENT` → default
 *
 * Call this at the FRONT-END EDGE and pass the result inward as
 * `budgetPercent` (`GlobalScheduler`, `OrchestratorOptions`, `MultiRunDriver`).
 * The deep constructors deliberately do NOT read this store themselves: doing so
 * made every run's budget depend on ambient home-dir state, which broke the
 * budget-math suites the moment a developer had a dial saved.
 *
 * It exists because before it only the web consulted the store (it re-applied
 * the value with `setBudgetPercent` right after constructing its scheduler),
 * while the Ink TUI and headless runs used bare `resolveRamPercent()` — so a
 * dial saved from ⚙ Settings was SILENTLY IGNORED outside the browser.
 * Machine-global has to mean machine-global on every surface.
 */
export function effectiveRamPercent(
  explicit?: number,
  path: string = webSettingsPath(),
): number {
  if (explicit !== undefined && Number.isFinite(explicit)) return clampPercent(explicit);
  const stored = loadWebSettings(path).ramPercent;
  if (stored !== undefined) return clampPercent(stored);
  return resolveRamPercent();
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

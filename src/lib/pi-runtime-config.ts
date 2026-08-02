/**
 * Shared config for huu's hermetic pi runtime — the tiny pure bits both the
 * session composer (orchestrator/backends/pi/hermetic.ts) and the `huu status`
 * doctor (lib/pi-doctor.ts) need. Lives in lib/ so imports only flow downward.
 */
import { join } from 'node:path';
import { getHuuHome } from './huu-home.js';

/**
 * Hermetic is the DEFAULT. Only an explicit `HUU_PI_HERMETIC=0|false` opts a
 * run back into the legacy host-global pi behavior (debugging escape hatch).
 */
export function resolveHermeticEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.HUU_PI_HERMETIC?.trim().toLowerCase();
  return raw !== '0' && raw !== 'false';
}

/**
 * The huu-owned pi agent dir: `~/.huu/pi-agent` (mirrors the documented
 * `~/.huu/bin/` vendored-tool convention; honors HUU_HOST_HOME in-container so
 * it lands on the bind-mounted host `~/.huu` like pipelines/recents do).
 */
export function hermeticAgentDir(): string {
  return join(getHuuHome(), '.huu', 'pi-agent');
}

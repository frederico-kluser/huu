/**
 * Hermetic jcode-session composition — huu's OWN clean jcode runtime.
 *
 * Why this exists: jcode by default reads its config from the user's home
 * directory and may auto-discover extensions, write telemetry, and persist
 * embeddings. This module builds a session environment that isolates jcode
 * into huu-owned space so:
 *  - Zero embeddings (`JCODE_MEMORY_ENABLED=false`) — each agent run is
 *    stateless; the transcript is the memory.
 *  - No telemetry (`JCODE_NO_TELEMETRY=1`) — huu is the caller and
 *    handles its own observability.
 *  - Isolated agent dir (`~/.huu/jcode-agent`) — never touches
 *    host-global config, never writes to `~/.jcode`.
 *
 * The single escape hatch is `HUU_JCODE_HERMETIC=0`, which reproduces
 * the host-global behavior byte-for-byte (debugging parity).
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { getHuuHome } from '../../../lib/huu-home.js';

/**
 * Hermetic is the DEFAULT. Only an explicit `HUU_JCODE_HERMETIC=0|false`
 * opts a run back into the legacy host-global jcode behavior.
 */
export function resolveHermeticEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const raw = env.HUU_JCODE_HERMETIC?.trim().toLowerCase();
  return raw !== '0' && raw !== 'false';
}

/**
 * The huu-owned jcode agent dir: `~/.huu/jcode-agent` — mirrors the
 * pi-agent convention so both backends share the `~/.huu/` namespace.
 */
export function jcodeAgentDir(): string {
  return join(getHuuHome(), '.huu', 'jcode-agent');
}

export interface JcodeSessionEnvironment {
  /** False only under the HUU_JCODE_HERMETIC=0 escape hatch. */
  hermetic: boolean;
  /** huu-owned agent dir; set only when hermetic. */
  agentDir?: string;
  /** The env object to pass to child_process.spawn. */
  env: NodeJS.ProcessEnv;
}

/**
 * Compose the environment object for `child_process.spawn('jcode', …)`.
 *
 * Hermetic branch (default):
 *  - `JCODE_MEMORY_ENABLED=false` — zero embeddings, stateless runs.
 *  - `JCODE_NO_TELEMETRY=1` — no external telemetry.
 *  - `JCODE_AGENT_DIR` → `~/.huu/jcode-agent` — isolated runtime dir.
 *  - The agent dir is mkdir'd so jcode doesn't fail on first write.
 *
 * Legacy escape hatch (`HUU_JCODE_HERMETIC=0`):
 *  - Returns `process.env` as-is — exactly the pre-hermetic behavior.
 */
export function buildJcodeSessionEnvironment(
  opts?: { env?: NodeJS.ProcessEnv },
): JcodeSessionEnvironment {
  const parentEnv = opts?.env ?? process.env;

  if (!resolveHermeticEnabled(parentEnv)) {
    return { hermetic: false, env: { ...parentEnv } };
  }

  const agentDir = jcodeAgentDir();
  try {
    mkdirSync(agentDir, { recursive: true });
  } catch {
    /* best-effort — jcode may create it on first write */
  }

  const env: NodeJS.ProcessEnv = {
    ...parentEnv,
    JCODE_MEMORY_ENABLED: 'false',
    JCODE_NO_TELEMETRY: '1',
    JCODE_AGENT_DIR: agentDir,
  };

  return { hermetic: true, agentDir, env };
}

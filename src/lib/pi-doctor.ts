/**
 * `huu status` doctor section for the embedded pi runtime — answers, at a
 * glance: which pi version is huu running, is the hermetic composition active,
 * which agent dir will sessions use, and which HOST-GLOBAL npm `pi-*` packages
 * exist that hermetic mode is deliberately IGNORING (the class of extension
 * that once crashed a whole multi-run fleet).
 *
 * Shape follows init-docker: a PURE core (`resolvePiRuntimeReport`) with every
 * fs/exec input injected — unit-testable — plus one impure gatherer and a text
 * renderer. Everything degrades to null/[] instead of throwing: a doctor that
 * crashes `huu status` would be worse than no doctor.
 */
import { execSync } from 'node:child_process';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { getHuuHome } from './huu-home.js';
import { resolveHermeticEnabled, hermeticAgentDir } from './pi-runtime-config.js';

export interface PiRuntimeReport {
  /** Installed @mariozechner/pi-coding-agent version, or null if unresolvable. */
  piVersion: string | null;
  hermetic: boolean;
  /** The agent dir pi sessions will effectively use. */
  agentDir: string;
  /** Where that dir came from: user env override, huu-owned, or host ~/.pi. */
  agentDirSource: 'env' | 'huu' | 'host';
  globalNpmRoot: string | null;
  /** Host-global pi-* packages found under the npm root (hermetic ignores them). */
  ignoredGlobalPiPackages: string[];
}

export interface PiRuntimeInputs {
  env: NodeJS.ProcessEnv;
  piVersion: string | null;
  globalNpmRoot: string | null;
  globalPackageNames: string[];
  /** Injectable homes for pure testing; default to the real resolvers. */
  huuHome?: string;
  osHome?: string;
}

/** PURE: derive the report from injected inputs — no fs/exec/env reads. */
export function resolvePiRuntimeReport(inputs: PiRuntimeInputs): PiRuntimeReport {
  const hermetic = resolveHermeticEnabled(inputs.env);
  const envDir = inputs.env.PI_CODING_AGENT_DIR?.trim();
  const huuHome = inputs.huuHome ?? getHuuHome();
  const osHome = inputs.osHome ?? homedir();

  let agentDir: string;
  let agentDirSource: PiRuntimeReport['agentDirSource'];
  if (envDir) {
    // A user-set PI_CODING_AGENT_DIR wins in both modes (hermetic never
    // overwrites a preset value; the SDK honors it when non-hermetic).
    agentDir = envDir;
    agentDirSource = 'env';
  } else if (hermetic) {
    agentDir = join(huuHome, '.huu', 'pi-agent');
    agentDirSource = 'huu';
  } else {
    agentDir = join(osHome, '.pi', 'agent');
    agentDirSource = 'host';
  }

  const piPackages = inputs.globalPackageNames
    .filter((n) => n.startsWith('pi-') || /^@[^/]+\/pi-/.test(n))
    .sort();

  return {
    piVersion: inputs.piVersion,
    hermetic,
    agentDir,
    agentDirSource,
    globalNpmRoot: inputs.globalNpmRoot,
    ignoredGlobalPiPackages: piPackages,
  };
}

/**
 * Resolve the installed pi version WITHOUT importing the (heavy) package
 * barrel and WITHOUT `require.resolve` — the package is ESM-only with an
 * exports map, so a CJS resolve of the bare specifier (or `…/package.json`)
 * throws ERR_PACKAGE_PATH_NOT_EXPORTED. Instead walk UP from this very file
 * until a `node_modules/@mariozechner/pi-coding-agent/package.json` appears —
 * correct in dev (src/), in the build (dist/), and in a global install, since
 * huu's node_modules always sits at the package root above this module.
 */
function resolveInstalledPiVersion(): string | null {
  try {
    let dir = dirname(fileURLToPath(import.meta.url));
    for (let i = 0; i < 8; i++) {
      const candidate = join(
        dir,
        'node_modules',
        '@mariozechner',
        'pi-coding-agent',
        'package.json',
      );
      if (existsSync(candidate)) {
        const pkg = JSON.parse(readFileSync(candidate, 'utf8')) as { version?: string };
        return pkg.version ?? null;
      }
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch {
    /* not resolvable — report null */
  }
  return null;
}

/** IMPURE gatherer — every probe degrades (null/[]) instead of throwing. */
export function gatherPiRuntimeInputs(): Omit<PiRuntimeInputs, 'env' | 'huuHome' | 'osHome'> {
  const piVersion = resolveInstalledPiVersion();

  let globalNpmRoot: string | null = null;
  try {
    globalNpmRoot = execSync('npm root -g', { encoding: 'utf8', timeout: 5_000 }).trim() || null;
  } catch {
    globalNpmRoot = null;
  }

  const globalPackageNames: string[] = [];
  if (globalNpmRoot) {
    try {
      for (const entry of readdirSync(globalNpmRoot, { withFileTypes: true })) {
        if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
        if (entry.name.startsWith('@')) {
          try {
            for (const scoped of readdirSync(join(globalNpmRoot, entry.name))) {
              globalPackageNames.push(`${entry.name}/${scoped}`);
            }
          } catch {
            /* unreadable scope dir — skip */
          }
        } else {
          globalPackageNames.push(entry.name);
        }
      }
    } catch {
      /* unreadable npm root — report none */
    }
  }

  return { piVersion, globalNpmRoot, globalPackageNames };
}

/** Render the doctor lines appended to the `huu status` text output. */
export function renderPiRuntimeText(r: PiRuntimeReport): string[] {
  const lines: string[] = [];
  lines.push(
    `  pi runtime:    ${r.piVersion ?? 'unresolved'} · hermetic=${r.hermetic ? 'on' : 'OFF'} · agentDir=${r.agentDir} (${r.agentDirSource})`,
  );
  if (r.ignoredGlobalPiPackages.length > 0) {
    const verb = r.hermetic ? 'ignored' : 'LOADABLE (hermetic off!)';
    lines.push(
      `                 global pi-* ${verb}: ${r.ignoredGlobalPiPackages.join(', ')} (${r.ignoredGlobalPiPackages.length})`,
    );
  } else if (r.globalNpmRoot) {
    lines.push('                 global pi-* packages: none found');
  }
  return lines;
}

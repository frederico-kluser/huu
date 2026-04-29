import { existsSync, mkdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { platform, arch } from 'node:process';

export interface NativeShim {
  /** Absolute path to the compiled shared library. */
  libPath: string;
  /** Env-var name the loader expects (LD_PRELOAD on Linux, DYLD_INSERT_LIBRARIES on macOS). */
  envVar: 'LD_PRELOAD' | 'DYLD_INSERT_LIBRARIES';
  /** OS detected at build time. */
  os: 'linux' | 'darwin';
}

/**
 * Locates the C source for the bind() interceptor relative to this module.
 * Works for both `tsx` (running .ts directly) and `tsc` builds (running from
 * `dist/`) by walking up until we find the `native/` sibling.
 */
function findShimSource(): string | null {
  const here = dirname(fileURLToPath(import.meta.url));
  // Try common layouts: src/orchestrator/ → ../../native/...
  // and dist/orchestrator/ → ../../native/...
  const candidates = [
    resolve(here, '../../native/port-shim/port-shim.c'),
    resolve(here, '../../../native/port-shim/port-shim.c'),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

function libFileName(os: 'linux' | 'darwin'): string {
  return os === 'darwin' ? 'huu-port-shim.dylib' : 'huu-port-shim.so';
}

function detectOs(): 'linux' | 'darwin' | null {
  if (platform === 'linux') return 'linux';
  if (platform === 'darwin') return 'darwin';
  return null;
}

function isCompilerAvailable(): boolean {
  try {
    execFileSync('cc', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function isFresher(libPath: string, sourcePath: string): boolean {
  try {
    const lib = statSync(libPath);
    const src = statSync(sourcePath);
    return lib.mtimeMs >= src.mtimeMs;
  } catch {
    return false;
  }
}

/**
 * Ensures a usable bind()-interceptor shared library exists for the current
 * platform, compiling it on demand into `<repoRoot>/.huu-cache/native-shim/`.
 *
 * Resolution order:
 *   1. `HUU_NATIVE_SHIM_PATH` — absolute path to a prebuilt .so/.dylib.
 *      Used by the official Docker image (the runtime stage has no `cc`,
 *      so the builder stage compiles the shim ahead of time and the
 *      Dockerfile points this var at the resulting library). Skips
 *      compile entirely when the file exists.
 *   2. Cached compile under `<repoRoot>/.huu-cache/native-shim/<os>-<arch>/`,
 *      reused if newer than the source.
 *   3. Fresh compile via `cc` into the same cache dir.
 *
 * Returns null when the shim is unavailable for any reason — Windows host,
 * missing C compiler, missing source, or compile failure. Callers must
 * tolerate this: the rest of the port-allocation chain still works (env-var
 * + dotenv + system-prompt path), this just removes the universal fallback.
 *
 * Errors are intentionally swallowed and surfaced via the optional
 * `onWarning` callback rather than thrown — the orchestrator should keep
 * running even when LD_PRELOAD isn't viable.
 */
export function ensureNativeShim(
  repoRoot: string,
  onWarning?: (msg: string) => void,
): NativeShim | null {
  const os = detectOs();
  if (!os) {
    onWarning?.(`native port-shim unsupported on platform=${platform}; falling back to env-only port isolation`);
    return null;
  }

  const envVar: NativeShim['envVar'] =
    os === 'darwin' ? 'DYLD_INSERT_LIBRARIES' : 'LD_PRELOAD';

  // Step 1: prebuilt path (set by the Docker image at /opt/huu/native/...).
  // Trust the operator: if HUU_NATIVE_SHIM_PATH is set and the file exists,
  // we don't try to compile a fresher copy or check arch — the Dockerfile
  // built it for the right arch via multi-arch buildx.
  const prebuiltPath = process.env.HUU_NATIVE_SHIM_PATH?.trim();
  if (prebuiltPath && existsSync(prebuiltPath)) {
    return { libPath: prebuiltPath, envVar, os };
  }
  if (prebuiltPath) {
    onWarning?.(`HUU_NATIVE_SHIM_PATH=${prebuiltPath} does not exist; falling through to compile-on-demand`);
  }

  const source = findShimSource();
  if (!source) {
    onWarning?.('native port-shim source not found; falling back to env-only port isolation');
    return null;
  }

  const cacheDir = join(repoRoot, '.huu-cache', 'native-shim', `${os}-${arch}`);
  const libPath = join(cacheDir, libFileName(os));

  if (existsSync(libPath) && isFresher(libPath, source)) {
    return { libPath, envVar, os };
  }

  if (!isCompilerAvailable()) {
    onWarning?.('cc not found in PATH; cannot build native port-shim. Install a C compiler (apt install build-essential, or Xcode CLT) to enable bind() interception');
    return null;
  }

  try {
    mkdirSync(cacheDir, { recursive: true });
    const args =
      os === 'darwin'
        ? ['-O2', '-fPIC', '-Wall', '-dynamiclib', '-o', libPath, source]
        : ['-O2', '-fPIC', '-Wall', '-shared', '-o', libPath, source, '-ldl', '-lpthread'];
    execFileSync('cc', args, { stdio: 'pipe' });
    return { libPath, envVar, os };
  } catch (err) {
    onWarning?.(`native port-shim compile failed: ${err instanceof Error ? err.message : String(err)}; falling back to env-only port isolation`);
    return null;
  }
}

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  JCODE_CONTAINER_DIR,
  JCODE_CONTAINER_EXECUTABLE,
  JCODE_EXECUTABLE_NAME,
  detectBundlePayloadMachine,
  detectHostJcodeBundle,
  findJcodeExecutable,
  jcodeMissingExecutableMessage,
  readElfMachine,
  resolveJcodeBundle,
  type JcodeBundleInputs,
} from './jcode-bundle.js';

const EM_X86_64 = 0x3e;
const EM_AARCH64 = 0xb7;

/** Minimal but REAL ELF header: magic + class/data + e_machine at offset 18. */
function elfHeader(machine: number, opts: { bigEndian?: boolean } = {}): Buffer {
  const buf = Buffer.alloc(64);
  buf[0] = 0x7f;
  buf[1] = 0x45; // E
  buf[2] = 0x4c; // L
  buf[3] = 0x46; // F
  buf[4] = 2; // EI_CLASS = ELFCLASS64
  buf[5] = opts.bigEndian ? 2 : 1; // EI_DATA
  buf[6] = 1; // EI_VERSION
  buf.writeUInt16LE(2, 16); // e_type = ET_EXEC (endianness irrelevant for the test)
  if (opts.bigEndian) buf.writeUInt16BE(machine, 18);
  else buf.writeUInt16LE(machine, 18);
  return buf;
}

/** The 505-byte /bin/sh launcher shipped by real jcode builds, in spirit. */
const LAUNCHER_SCRIPT = [
  '#!/usr/bin/env sh',
  'set -eu',
  'self_dir=$(CDPATH= cd -- "$(dirname -- "$(readlink -f -- "$0")")" && pwd)',
  'export LD_LIBRARY_PATH="$self_dir"',
  'exec "$self_dir/jcode-linux-x86_64.bin" "$@"',
  '',
].join('\n');

let tmp: string;

beforeEach(() => {
  // realpath: macOS resolves /var → /private/var, and the module returns
  // realpath'd paths, so the expectation must be realpath'd too.
  tmp = realpathSync(mkdtempSync(join(tmpdir(), 'huu-jcode-bundle-')));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

/**
 * Write a jcode bundle exactly like a real install: a launcher SCRIPT plus the
 * sidecar ELF payload it execs, both in the same directory.
 */
function writeBundle(dir: string, machine = EM_X86_64): string {
  mkdirSync(dir, { recursive: true });
  const launcher = join(dir, 'jcode');
  writeFileSync(launcher, LAUNCHER_SCRIPT, { mode: 0o755 });
  writeFileSync(join(dir, 'jcode-linux-x86_64.bin'), elfHeader(machine), { mode: 0o755 });
  return launcher;
}

// ---------------------------------------------------------------------------
// resolveJcodeBundle — the PURE guard core
// ---------------------------------------------------------------------------

describe('resolveJcodeBundle (pure)', () => {
  const base: JcodeBundleInputs = {
    platform: 'linux',
    arch: 'x64',
    executablePath: '/home/u/.jcode/builds/versions/0.67.1/jcode',
    payloadMachine: EM_X86_64,
  };

  it('accepts a linux x86-64 bundle and mounts the DIRECTORY, not the file', () => {
    const bundle = resolveJcodeBundle(base);
    expect(bundle).not.toBeNull();
    expect(bundle!.hostDir).toBe('/home/u/.jcode/builds/versions/0.67.1');
    expect(bundle!.hostExecutable).toBe(base.executablePath);
    expect(bundle!.containerDir).toBe(JCODE_CONTAINER_DIR);
    expect(bundle!.payloadMachine).toBe(EM_X86_64);
  });

  it('accepts an arm64 host whose payload is AArch64', () => {
    const bundle = resolveJcodeBundle({ ...base, arch: 'arm64', payloadMachine: EM_AARCH64 });
    expect(bundle).not.toBeNull();
  });

  it('refuses a macOS host — a Mach-O binary cannot run in the Linux container', () => {
    expect(resolveJcodeBundle({ ...base, platform: 'darwin' })).toBeNull();
  });

  it('refuses a Windows host', () => {
    expect(resolveJcodeBundle({ ...base, platform: 'win32' })).toBeNull();
  });

  it('degrades to null when the host has no jcode at all', () => {
    expect(resolveJcodeBundle({ ...base, executablePath: null, payloadMachine: null })).toBeNull();
  });

  it('refuses an architecture mismatch (x86-64 host, AArch64 payload)', () => {
    expect(resolveJcodeBundle({ ...base, payloadMachine: EM_AARCH64 })).toBeNull();
  });

  it('refuses when no ELF payload could be proven (launcher without a binary)', () => {
    expect(resolveJcodeBundle({ ...base, payloadMachine: null })).toBeNull();
  });

  it('refuses an architecture it cannot map, rather than guessing', () => {
    expect(resolveJcodeBundle({ ...base, arch: 'mips' })).toBeNull();
  });

  it('refuses a launcher not named `jcode` (the container symlink is static)', () => {
    expect(
      resolveJcodeBundle({ ...base, executablePath: '/home/u/.jcode/versions/0.67.1/jcode-0.67.1' }),
    ).toBeNull();
  });

  it.each(['/usr/bin', '/usr/local/bin', '/bin', '/opt/homebrew/bin'])(
    'refuses %s — mounting a shared system bin dir would drag the host userland in',
    (dir) => {
      expect(resolveJcodeBundle({ ...base, executablePath: `${dir}/jcode` })).toBeNull();
    },
  );

  it('never throws, whatever the inputs', () => {
    expect(() =>
      resolveJcodeBundle({ platform: 'aix', arch: '', executablePath: '', payloadMachine: NaN }),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// readElfMachine — real files on disk
// ---------------------------------------------------------------------------

describe('readElfMachine', () => {
  it('reads e_machine from a little-endian ELF', () => {
    const p = join(tmp, 'x86.bin');
    writeFileSync(p, elfHeader(EM_X86_64));
    expect(readElfMachine(p)).toBe(EM_X86_64);
  });

  it('reads e_machine from a big-endian ELF (EI_DATA=2)', () => {
    const p = join(tmp, 'be.bin');
    writeFileSync(p, elfHeader(EM_AARCH64, { bigEndian: true }));
    expect(readElfMachine(p)).toBe(EM_AARCH64);
  });

  it('returns null for a shell script (the jcode launcher is one)', () => {
    const p = join(tmp, 'jcode');
    writeFileSync(p, LAUNCHER_SCRIPT);
    expect(readElfMachine(p)).toBeNull();
  });

  it('returns null for a file shorter than an ELF header', () => {
    const p = join(tmp, 'tiny');
    writeFileSync(p, '\x7fELF');
    expect(readElfMachine(p)).toBeNull();
  });

  it('returns null for a missing path and for a directory', () => {
    expect(readElfMachine(join(tmp, 'nope'))).toBeNull();
    expect(readElfMachine(tmp)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// findJcodeExecutable — real PATH, real symlink chain
// ---------------------------------------------------------------------------

describe('findJcodeExecutable', () => {
  it('follows the whole symlink chain to the real bundle file', () => {
    // Mirrors a real install: ~/.local/bin/jcode → builds/stable/jcode →
    // builds/versions/<v>/jcode.
    const versionDir = join(tmp, 'builds', 'versions', '0.67.1');
    const real = writeBundle(versionDir);
    const stableDir = join(tmp, 'builds', 'stable');
    mkdirSync(stableDir, { recursive: true });
    symlinkSync(real, join(stableDir, 'jcode'));
    const binDir = join(tmp, '.local', 'bin');
    mkdirSync(binDir, { recursive: true });
    symlinkSync(join(stableDir, 'jcode'), join(binDir, 'jcode'));

    expect(findJcodeExecutable({ PATH: binDir } as NodeJS.ProcessEnv)).toBe(real);
  });

  it('skips PATH entries that have no jcode and honors ordering', () => {
    const empty = join(tmp, 'empty');
    mkdirSync(empty, { recursive: true });
    const bundleDir = join(tmp, 'bundle');
    const real = writeBundle(bundleDir);
    const PATH = [empty, bundleDir].join(delimiter);
    expect(findJcodeExecutable({ PATH } as NodeJS.ProcessEnv)).toBe(real);
  });

  it('skips a dangling symlink instead of returning a broken path', () => {
    const brokenDir = join(tmp, 'broken');
    mkdirSync(brokenDir, { recursive: true });
    symlinkSync(join(tmp, 'does-not-exist'), join(brokenDir, 'jcode'));
    const bundleDir = join(tmp, 'good');
    const real = writeBundle(bundleDir);
    const PATH = [brokenDir, bundleDir].join(delimiter);
    expect(findJcodeExecutable({ PATH } as NodeJS.ProcessEnv)).toBe(real);
  });

  it('returns null for an absent, empty or unset PATH', () => {
    expect(findJcodeExecutable({ PATH: join(tmp, 'nowhere') } as NodeJS.ProcessEnv)).toBeNull();
    expect(findJcodeExecutable({ PATH: '' } as NodeJS.ProcessEnv)).toBeNull();
    expect(findJcodeExecutable({} as NodeJS.ProcessEnv)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// detectBundlePayloadMachine
// ---------------------------------------------------------------------------

describe('detectBundlePayloadMachine', () => {
  it('finds the sidecar payload next to a script launcher', () => {
    const launcher = writeBundle(join(tmp, 'bundle'));
    expect(detectBundlePayloadMachine(launcher)).toBe(EM_X86_64);
  });

  it('uses the launcher itself when a build ships the binary directly', () => {
    const dir = join(tmp, 'flat');
    mkdirSync(dir, { recursive: true });
    const launcher = join(dir, 'jcode');
    writeFileSync(launcher, elfHeader(EM_AARCH64), { mode: 0o755 });
    expect(detectBundlePayloadMachine(launcher)).toBe(EM_AARCH64);
  });

  it('returns null when the directory holds no ELF at all', () => {
    const dir = join(tmp, 'scriptonly');
    mkdirSync(dir, { recursive: true });
    const launcher = join(dir, 'jcode');
    writeFileSync(launcher, LAUNCHER_SCRIPT, { mode: 0o755 });
    writeFileSync(join(dir, 'README.txt'), 'no binary here');
    expect(detectBundlePayloadMachine(launcher)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// detectHostJcodeBundle — the impure gatherer, end to end
// ---------------------------------------------------------------------------

describe('detectHostJcodeBundle', () => {
  it('resolves a real on-disk bundle into the mount pair', () => {
    const bundleDir = join(tmp, 'builds', 'versions', '0.67.1');
    writeBundle(bundleDir);
    const bundle = detectHostJcodeBundle(
      { PATH: bundleDir } as NodeJS.ProcessEnv,
      'linux',
      'x64',
    );
    expect(bundle).not.toBeNull();
    expect(bundle!.hostDir).toBe(bundleDir);
    expect(bundle!.containerDir).toBe('/opt/jcode');
  });

  it('mounts nothing on a macOS host even when a bundle is on PATH', () => {
    const bundleDir = join(tmp, 'bundle');
    writeBundle(bundleDir);
    expect(
      detectHostJcodeBundle({ PATH: bundleDir } as NodeJS.ProcessEnv, 'darwin', 'x64'),
    ).toBeNull();
  });

  it('mounts nothing when the payload targets another architecture', () => {
    const bundleDir = join(tmp, 'arm-bundle');
    writeBundle(bundleDir, EM_AARCH64);
    expect(
      detectHostJcodeBundle({ PATH: bundleDir } as NodeJS.ProcessEnv, 'linux', 'x64'),
    ).toBeNull();
  });

  it('degrades to null (never throws) on a host with no jcode', () => {
    expect(
      detectHostJcodeBundle({ PATH: join(tmp, 'nowhere') } as NodeJS.ProcessEnv, 'linux', 'x64'),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The actionable failure message
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Dockerfile parity — the container path is written in TWO places
// ---------------------------------------------------------------------------

// The mount destination lives here (JCODE_CONTAINER_DIR, sent to `docker run`)
// AND in the Dockerfile (the symlink that puts it on PATH). Nothing else links
// them: CI never builds the image, so a rename on either side would ship a
// bundle mounted at a path no `jcode` name points at — silent, and only
// visible as `spawn jcode ENOENT` on a host that HAS jcode installed.
describe('Dockerfile parity', () => {
  const root = join(fileURLToPath(import.meta.url), '..', '..', '..');

  it('symlinks the mounted launcher onto PATH at exactly the path this module owns', () => {
    const dockerfile = readFileSync(join(root, 'Dockerfile'), 'utf8');
    expect(dockerfile).toContain(
      `ln -s ${JCODE_CONTAINER_EXECUTABLE} /usr/local/bin/${JCODE_EXECUTABLE_NAME}`,
    );
  });
});

describe('jcodeMissingExecutableMessage', () => {
  it('names the missing binary, the mount path and BOTH native escape hatches', () => {
    const msg = jcodeMissingExecutableMessage();
    expect(msg).toMatch(/jcode/);
    expect(msg).toMatch(/not found/i);
    expect(msg).toContain(JCODE_CONTAINER_DIR);
    expect(msg).toContain('--no-docker');
    expect(msg).toContain('--yolo');
    expect(msg).toContain('npm run dev');
  });
});

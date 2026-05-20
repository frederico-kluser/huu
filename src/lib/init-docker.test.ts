import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  initDocker,
  renderCompose,
  renderDevcontainer,
  renderWrapper,
} from './init-docker.js';

describe('init-docker', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'huu-init-docker-test-'));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  describe('renderers', () => {
    it('renderCompose embeds the image and uses the same-path bind mount pattern', () => {
      const out = renderCompose('ghcr.io/owner/huu:1.2.3');
      expect(out).toContain('image: ghcr.io/owner/huu:1.2.3');
      expect(out).toContain('${PWD}:${PWD}');
      expect(out).toContain('working_dir: ${PWD}');
      expect(out).toContain('tty: true');
      expect(out).toContain('stdin_open: true');
    });

    it('renderWrapper produces a bash script that maps host UID/GID', () => {
      const out = renderWrapper('ghcr.io/owner/huu:latest');
      expect(out.startsWith('#!/usr/bin/env bash')).toBe(true);
      expect(out).toContain('id -u');
      expect(out).toContain('id -g');
      expect(out).toContain('ghcr.io/owner/huu:latest');
    });

    it('renderDevcontainer is valid JSON and references the image', () => {
      const out = renderDevcontainer('ghcr.io/owner/huu:1.2.3');
      const parsed = JSON.parse(out);
      expect(parsed.image).toBe('ghcr.io/owner/huu:1.2.3');
      expect(parsed.containerEnv.HUU_IN_CONTAINER).toBe('1');
      expect(parsed.workspaceFolder).toBe('${localWorkspaceFolder}');
    });
  });

  describe('initDocker', () => {
    it('writes only compose.huu.yaml by default', () => {
      const result = initDocker({ targetDir: tmp });
      expect(result.written).toEqual(['compose.huu.yaml']);
      expect(result.skipped).toEqual([]);
      expect(existsSync(join(tmp, 'compose.huu.yaml'))).toBe(true);
      expect(existsSync(join(tmp, 'scripts/huu-docker'))).toBe(false);
      expect(existsSync(join(tmp, '.devcontainer/devcontainer.json'))).toBe(false);
    });

    it('writes wrapper with executable bit when --with-wrapper', () => {
      const result = initDocker({ targetDir: tmp, withWrapper: true });
      expect(result.written).toContain('scripts/huu-docker');
      const wrapperPath = join(tmp, 'scripts/huu-docker');
      expect(existsSync(wrapperPath)).toBe(true);
      // 0o100 bit checks owner-execute. We don't compare full mode because
      // umask varies between hosts.
      expect(statSync(wrapperPath).mode & 0o100).toBe(0o100);
    });

    it('writes devcontainer when --with-devcontainer', () => {
      const result = initDocker({ targetDir: tmp, withDevcontainer: true });
      expect(result.written).toContain('.devcontainer/devcontainer.json');
      const json = JSON.parse(
        readFileSync(join(tmp, '.devcontainer/devcontainer.json'), 'utf8'),
      );
      expect(json.image).toContain('huu');
    });

    it('skips files that already exist when force is false', () => {
      writeFileSync(join(tmp, 'compose.huu.yaml'), '# user-owned\n');
      const result = initDocker({ targetDir: tmp });
      expect(result.written).toEqual([]);
      expect(result.skipped).toEqual(['compose.huu.yaml']);
      // The pre-existing file must be untouched.
      expect(readFileSync(join(tmp, 'compose.huu.yaml'), 'utf8')).toBe('# user-owned\n');
    });

    it('overwrites existing files when force is true', () => {
      writeFileSync(join(tmp, 'compose.huu.yaml'), '# user-owned\n');
      const result = initDocker({ targetDir: tmp, force: true });
      expect(result.written).toEqual(['compose.huu.yaml']);
      expect(result.skipped).toEqual([]);
      expect(readFileSync(join(tmp, 'compose.huu.yaml'), 'utf8')).toContain('image:');
    });

    it('honors a custom image override', () => {
      initDocker({ targetDir: tmp, image: 'localhost/huu:dev' });
      expect(readFileSync(join(tmp, 'compose.huu.yaml'), 'utf8')).toContain(
        'image: localhost/huu:dev',
      );
    });
  });
});

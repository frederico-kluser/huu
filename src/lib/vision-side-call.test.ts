import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  analyzeImages,
  buildVisionMessage,
  loadVisionImages,
  visionDisclosure,
  type VisionImage,
} from './vision-side-call.js';

const img: VisionImage = { path: '/tmp/shot.png', mimeType: 'image/png', base64: 'QUJD' };

describe('vision-side-call', () => {
  it('builds the OpenAI-compatible content-parts shape: text first, one data-URL per image', () => {
    const msg = buildVisionMessage('o que vês?', [img, { ...img, path: '/tmp/other.jpg', mimeType: 'image/jpeg' }]);
    const content = (msg as unknown as { content: unknown[] }).content;
    expect(content[0]).toEqual({ type: 'text', text: 'o que vês?' });
    expect(content[1]).toEqual({ type: 'image_url', image_url: { url: 'data:image/png;base64,QUJD' } });
    expect(content[2]).toEqual({ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,QUJD' } });
  });

  it('loads real files by extension and REJECTS unknown formats loudly', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vision-'));
    try {
      const png = join(dir, 'a.png');
      writeFileSync(png, Buffer.from('bytes'));
      const [loaded] = loadVisionImages([png]);
      expect(loaded.mimeType).toBe('image/png');
      expect(loaded.base64).toBe(Buffer.from('bytes').toString('base64'));

      expect(() => loadVisionImages([join(dir, 'a.bmp')])).toThrow(/formato de imagem não suportado/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('disclosure names the model, the files, and that the analysis is SECOND-HAND', () => {
    const d = visionDisclosure('xiaomi/mimo-v2.6-pro', ['/tmp/prints/tela.png']);
    expect(d).toContain('xiaomi/mimo-v2.6-pro');
    expect(d).toContain('tela.png');
    expect(d).toContain('segundo grau');
    expect(d).toContain('side-call');
  });

  it('analyzeImages wraps the model output under the disclosure — never silent', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vision-'));
    const real = join(dir, 'tela.png');
    writeFileSync(real, Buffer.from('png-bytes'));
    const client = {
      invoke: async () => ({ content: 'Um formulário de login com dois campos.' }),
    };
    const r = await analyzeImages({
      ctx: { backend: 'jcode', provider: 'openrouter', apiKey: 'sk-test' },
      modelId: 'xiaomi/mimo-v2.6-pro',
      prompt: 'descreve',
      imagePaths: [real],
      client,
    });
    rmSync(dir, { recursive: true, force: true });
    expect(r.raw).toBe('Um formulário de login com dois campos.');
    expect(r.disclosed.startsWith('[visão via xiaomi/mimo-v2.6-pro')).toBe(true);
    expect(r.disclosed).toContain('Um formulário de login com dois campos.');
    expect(r.images).toBe(1);
  });

  it('extracts array-shaped responses and refuses an empty model id', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vision-'));
    const real = join(dir, 'a.png');
    writeFileSync(real, Buffer.from('x'));
    const client = {
      invoke: async () => ({ content: [{ text: 'linha 1' }, { text: 'linha 2' }] }),
    };
    const r = await analyzeImages({
      ctx: { backend: 'jcode' },
      modelId: 'x/y',
      prompt: 'p',
      imagePaths: [real],
      client,
    });
    rmSync(dir, { recursive: true, force: true });
    expect(r.raw).toBe('linha 1\nlinha 2');

    await expect(
      analyzeImages({ ctx: { backend: 'jcode' }, modelId: '  ', prompt: 'p', imagePaths: [], client }),
    ).rejects.toThrow(/modelId vazio/);
  });
});

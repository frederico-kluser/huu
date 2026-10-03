import { describe, expect, it } from 'vitest';
import { checkDevVisionGate } from './dev-vision-gate.js';

const vision = (id: string) => id === 'xiaomi/mimo-v2.6-pro';

describe('dev-vision-gate', () => {
  it('lets a session through when every model accepts image', () => {
    expect(
      checkDevVisionGate({
        models: ['xiaomi/mimo-v2.6-pro', 'xiaomi/mimo-v2.6-pro'],
        acceptsImage: vision,
      }),
    ).toEqual({ ok: true });
  });

  it('refuses a text-only model with an actionable message naming it', () => {
    const r = checkDevVisionGate({
      models: ['deepseek/deepseek-v4-flash'],
      acceptsImage: vision,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.offenders).toEqual(['deepseek/deepseek-v4-flash']);
    expect(r.message).toContain('deepseek/deepseek-v4-flash');
    // Actionable: all three ways out are named (switch model / curate catalog / --stub).
    expect(r.message).toContain('xiaomi/mimo-v2.6-pro');
    expect(r.message).toContain('inputModalities');
    expect(r.message).toContain('--stub');
  });

  it('gates UNKNOWN ids as non-vision (fail-safe) — the escape hatch is the catalog, not guessing', () => {
    const r = checkDevVisionGate({
      models: ['custom/my-private-vlm'],
      acceptsImage: vision,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.offenders).toEqual(['custom/my-private-vlm']);
    expect(r.message).toContain('inputModalities');
  });

  it('names every offending id once, and ignores blank ids', () => {
    const r = checkDevVisionGate({
      models: ['deepseek/deepseek-v4-flash', '', 'deepseek/deepseek-v4-flash', 'a/b'],
      acceptsImage: vision,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.offenders).toEqual(['deepseek/deepseek-v4-flash', 'a/b']);
  });

  it('never passes silently on an empty model list (caller bug, not a vision session)', () => {
    // An empty list means the caller failed to resolve a model at all — the
    // run would die deeper inside an agent; refuse at the boundary instead.
    const r = checkDevVisionGate({ models: ['', '   '], acceptsImage: vision });
    expect(r.ok).toBe(false);
  });
});

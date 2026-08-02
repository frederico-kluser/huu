import { describe, it, expect, afterEach } from 'vitest';
import {
  DEFAULT_LOCALE,
  LOCALES,
  MissingParamError,
  MissingTranslationError,
  availableLocales,
  getLocale,
  hasMessage,
  initI18n,
  isLocale,
  localesMissing,
  messagesFor,
  normalizeLocale,
  resolveLocale,
  setLocale,
  setStrict,
  sourceKeys,
  t,
  tStatus,
  translate,
} from './index.js';

const ORIGINAL = getLocale();

afterEach(() => {
  setLocale(ORIGINAL);
  setStrict(true);
});

describe('normalizeLocale', () => {
  it('maps POSIX and BCP-47 spellings onto the shipped locales', () => {
    expect(normalizeLocale('pt_BR.UTF-8')).toBe('pt-BR');
    expect(normalizeLocale('pt-br')).toBe('pt-BR');
    expect(normalizeLocale('pt')).toBe('pt-BR');
    expect(normalizeLocale('pt-PT')).toBe('pt-BR');
    expect(normalizeLocale('en_US.UTF-8')).toBe('en');
    expect(normalizeLocale('en-GB')).toBe('en');
  });

  it('returns null for anything it does not ship', () => {
    expect(normalizeLocale('fr_FR')).toBeNull();
    expect(normalizeLocale('')).toBeNull();
    expect(normalizeLocale(undefined)).toBeNull();
  });
});

describe('resolveLocale', () => {
  it('prefers HUU_LANG over the POSIX chain', () => {
    expect(resolveLocale({ HUU_LANG: 'pt-BR', LANG: 'en_US.UTF-8' })).toBe('pt-BR');
  });

  it('falls back through LC_ALL / LC_MESSAGES / LANG', () => {
    expect(resolveLocale({ LC_ALL: 'pt_BR.UTF-8' })).toBe('pt-BR');
    expect(resolveLocale({ LC_MESSAGES: 'pt_BR' })).toBe('pt-BR');
    expect(resolveLocale({ LANG: 'pt_BR.UTF-8' })).toBe('pt-BR');
  });

  it('defaults to English when nothing matches', () => {
    expect(resolveLocale({})).toBe(DEFAULT_LOCALE);
    expect(resolveLocale({ LANG: 'fr_FR.UTF-8' })).toBe(DEFAULT_LOCALE);
  });
});

describe('t', () => {
  it('renders the active locale', () => {
    setLocale('en');
    expect(t('common.action.cancel')).toBe('cancel');
    setLocale('pt-BR');
    expect(t('common.action.cancel')).toBe('cancelar');
  });

  it('interpolates {placeholders}', () => {
    setLocale('en');
    expect(t('tui.dash.retry_prompt', { id: 7 })).toContain('#7');
  });

  it('throws MissingParamError when a placeholder has no value', () => {
    setLocale('en');
    expect(() => t('tui.dash.retry_prompt')).toThrow(MissingParamError);
  });

  it('leaves text without placeholders untouched', () => {
    setLocale('en');
    expect(t('tui.check.ready')).toBe('ready');
  });
});

describe('translate (runtime keys)', () => {
  it('throws MissingTranslationError for a key no locale carries', () => {
    expect(() => translate('nope.not.a.key')).toThrow(MissingTranslationError);
  });

  it('names the locales that are missing the key', () => {
    try {
      translate('nope.not.a.key');
      expect.unreachable('should have thrown');
    } catch (err) {
      const e = err as MissingTranslationError;
      expect(e.key).toBe('nope.not.a.key');
      expect([...e.missingIn].sort()).toEqual([...LOCALES].sort());
    }
  });

  it('resolves the status.* family from a kanban CODE', () => {
    setLocale('en');
    expect(tStatus('NO CHANGES')).toBe('NO CHANGES');
    setLocale('pt-BR');
    expect(tStatus('NO CHANGES')).toBe('SEM MUDANÇAS');
  });
});

describe('strict mode', () => {
  it('degrades to the raw key with a warning when HUU_I18N_STRICT=0', () => {
    const written: string[] = [];
    const original = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: unknown) => {
      written.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;
    try {
      setStrict(false);
      expect(translate('nope.not.a.key')).toBe('nope.not.a.key');
      expect(written.join('')).toContain('nope.not.a.key');
    } finally {
      process.stderr.write = original;
    }
  });
});

describe('initI18n', () => {
  it('audits the catalogs and adopts the environment locale', () => {
    expect(initI18n({ HUU_LANG: 'pt-BR' })).toBe('pt-BR');
    expect(getLocale()).toBe('pt-BR');
    expect(initI18n({ HUU_LANG: 'en' })).toBe('en');
  });
});

describe('catalog surface', () => {
  it('ships exactly the declared locales, each with a self-named label', () => {
    expect(availableLocales().map((l) => l.id)).toEqual([...LOCALES]);
    expect(availableLocales().every((l) => l.label.length > 0)).toBe(true);
  });

  it('exposes a full message map per locale for the browser', () => {
    for (const locale of LOCALES) {
      const messages = messagesFor(locale);
      expect(Object.keys(messages).length).toBe(sourceKeys().length);
    }
  });

  it('reports a fully translated key as present in every locale', () => {
    expect(localesMissing('common.action.cancel')).toEqual([]);
    expect(hasMessage('common.action.cancel')).toBe(true);
    expect(hasMessage('nope.not.a.key')).toBe(false);
  });

  it('rejects an unsupported locale', () => {
    expect(isLocale('fr')).toBe(false);
    // @ts-expect-error deliberately wrong locale
    expect(() => setLocale('fr')).toThrow(TypeError);
  });
});

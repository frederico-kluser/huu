/* Browser i18n runtime. Runs in Node: the module deliberately touches no DOM at
   import time, and `applyI18n` takes any object with `querySelectorAll`, so the
   markup walk is testable without a browser (same rule as db.js). */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  MissingTranslationError,
  applyI18n,
  availableLocales,
  getLocale,
  hasMessage,
  initI18n,
  interpolate,
  keysInMarkup,
  setCatalog,
  t,
} from './i18n.js';

const CATALOG = {
  locale: 'pt-BR',
  defaultLocale: 'en',
  locales: [
    { id: 'en', label: 'English' },
    { id: 'pt-BR', label: 'Português (Brasil)' },
  ],
  messages: {
    'web.common.close': 'Fechar',
    'web.queue.run_n': 'Rodar a fila ({count})',
    'web.settings.title': 'Configurações',
    'web.dev.subtitle': 'Escreva o <strong>objetivo</strong>',
  },
};

beforeEach(() => setCatalog(CATALOG));

describe('interpolate', () => {
  it('fills {slots} from params', () => {
    expect(interpolate('a {x} b', { x: 1 })).toBe('a 1 b');
  });

  it('leaves an unfilled slot verbatim instead of printing undefined', () => {
    expect(interpolate('a {x} b', {})).toBe('a {x} b');
  });

  it('short-circuits templates with no slots', () => {
    expect(interpolate('plain', { x: 1 })).toBe('plain');
  });
});

describe('t', () => {
  it('renders from the loaded catalog', () => {
    expect(t('web.settings.title')).toBe('Configurações');
  });

  it('interpolates', () => {
    expect(t('web.queue.run_n', { count: 3 })).toBe('Rodar a fila (3)');
  });

  it('throws on a key the catalog does not carry', () => {
    expect(() => t('web.nope.missing')).toThrow(MissingTranslationError);
  });

  it('reports the offending key on the error', () => {
    try {
      t('web.nope.missing');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err.key).toBe('web.nope.missing');
    }
  });
});

describe('setCatalog', () => {
  it('adopts the served locale and its label list', () => {
    expect(getLocale()).toBe('pt-BR');
    expect(availableLocales().map((l) => l.id)).toEqual(['en', 'pt-BR']);
  });

  it('reports key presence', () => {
    expect(hasMessage('web.common.close')).toBe(true);
    expect(hasMessage('web.nope.missing')).toBe(false);
  });
});

describe('initI18n', () => {
  it('asks the server for the preferred locale and adopts the answer', async () => {
    const seen = [];
    const fetchJson = async (path) => {
      seen.push(path);
      return { ...CATALOG, locale: 'en', messages: { 'web.settings.title': 'Settings' } };
    };
    await initI18n(fetchJson, 'en');
    expect(seen).toEqual(['/api/i18n?locale=en']);
    expect(getLocale()).toBe('en');
    expect(t('web.settings.title')).toBe('Settings');
  });
});

/** Minimal stand-in for the parts of the DOM `applyI18n` actually touches. */
function fakeDom(nodes) {
  return {
    querySelectorAll(selector) {
      const attr = selector.slice(1, -1); // "[data-i18n-title]" → "data-i18n-title"
      return nodes.filter((n) => n.attrs[attr] !== undefined);
    },
  };
}

function fakeNode(attrs) {
  return {
    attrs,
    textContent: '',
    innerHTML: '',
    set: {},
    getAttribute(name) {
      return this.attrs[name] ?? null;
    },
    setAttribute(name, value) {
      this.set[name] = value;
    },
  };
}

describe('applyI18n', () => {
  it('fills textContent, innerHTML and the attribute forms', () => {
    const text = fakeNode({ 'data-i18n': 'web.settings.title' });
    const html = fakeNode({ 'data-i18n-html': 'web.dev.subtitle' });
    const title = fakeNode({ 'data-i18n-title': 'web.common.close' });
    const aria = fakeNode({ 'data-i18n-aria-label': 'web.common.close' });
    const ph = fakeNode({ 'data-i18n-placeholder': 'web.common.close' });

    const n = applyI18n(fakeDom([text, html, title, aria, ph]));

    expect(n).toBe(5);
    expect(text.textContent).toBe('Configurações');
    expect(html.innerHTML).toBe('Escreva o <strong>objetivo</strong>');
    expect(title.set.title).toBe('Fechar');
    expect(aria.set['aria-label']).toBe('Fechar');
    expect(ph.set.placeholder).toBe('Fechar');
  });

  it('is idempotent, so a language switch can just re-run it', () => {
    const node = fakeNode({ 'data-i18n': 'web.settings.title' });
    const dom = fakeDom([node]);
    applyI18n(dom);
    applyI18n(dom);
    expect(node.textContent).toBe('Configurações');
  });

  it('throws when the markup names a key the catalog lacks', () => {
    const node = fakeNode({ 'data-i18n': 'web.nope.missing' });
    expect(() => applyI18n(fakeDom([node]))).toThrow(MissingTranslationError);
  });
});

describe('keysInMarkup', () => {
  it('collects every data-i18n* key, de-duplicated and sorted', () => {
    const html =
      '<b data-i18n="web.b">x</b><i data-i18n-title="web.a">y</i>' +
      '<u data-i18n-placeholder="web.a">z</u>';
    expect(keysInMarkup(html)).toEqual(['web.a', 'web.b']);
  });
});

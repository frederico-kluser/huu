/**
 * The catalog registry. `en` is authoritative: its keys ARE the message-key
 * type, so a key added to `en` without a `pt-BR` twin is a TYPE error, and a
 * key referenced but present in only one catalog is a RUN-TIME error
 * (see ./validate.ts and the guard inside ./index.ts).
 */

import type { Locale, Messages } from './types.js';
import { LOCALES } from './types.js';
import { en } from './locales/en/index.js';
import { ptBR } from './locales/pt-BR/index.js';

/** Every key huu can render. Derived from the English catalog. */
export type MessageKey = keyof typeof en;

export const CATALOGS: Readonly<Record<Locale, Messages>> = {
  en,
  'pt-BR': ptBR,
};

/** Keys of the source catalog, sorted — the reference set for every audit. */
export function sourceKeys(): string[] {
  return Object.keys(en).sort();
}

/** Locales that actually carry `key`. */
export function localesWith(key: string): Locale[] {
  return LOCALES.filter((loc) => Object.prototype.hasOwnProperty.call(CATALOGS[loc], key));
}

/** Locales that are MISSING `key` — empty means the key is fully translated. */
export function localesMissing(key: string): Locale[] {
  return LOCALES.filter((loc) => {
    const value = CATALOGS[loc][key];
    return typeof value !== 'string' || value.length === 0;
  });
}

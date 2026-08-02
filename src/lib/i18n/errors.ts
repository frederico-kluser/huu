/**
 * i18n failure modes. These are LOUD by design: the project contract is that a
 * key without a translation in every shipped locale is a bug that must surface
 * at run time, not a string that silently degrades to its own key.
 */

import type { Locale } from './types.js';

export class I18nError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'I18nError';
  }
}

/** A key is absent from at least one shipped catalog. */
export class MissingTranslationError extends I18nError {
  readonly key: string;
  readonly missingIn: readonly Locale[];

  constructor(key: string, missingIn: readonly Locale[]) {
    super(
      `i18n: message key "${key}" has no translation in ${missingIn.join(', ')}. ` +
        `Add it to src/lib/i18n/locales/<locale>/*.ts for EVERY locale ` +
        `(huu refuses to render a half-translated key).`,
    );
    this.name = 'MissingTranslationError';
    this.key = key;
    this.missingIn = [...missingIn];
  }
}

/** A `{placeholder}` in the message had no matching entry in `params`. */
export class MissingParamError extends I18nError {
  readonly key: string;
  readonly param: string;

  constructor(key: string, param: string, locale: Locale) {
    super(`i18n: message "${key}" (${locale}) needs the "${param}" parameter, which was not supplied.`);
    this.name = 'MissingParamError';
    this.key = key;
    this.param = param;
  }
}

/** The whole-catalog audit found holes — thrown at boot by `assertCatalogsComplete()`. */
export class CatalogIntegrityError extends I18nError {
  readonly missing: Readonly<Record<Locale, readonly string[]>>;
  readonly extra: Readonly<Record<Locale, readonly string[]>>;

  constructor(
    message: string,
    missing: Readonly<Record<Locale, readonly string[]>>,
    extra: Readonly<Record<Locale, readonly string[]>>,
  ) {
    super(message);
    this.name = 'CatalogIntegrityError';
    this.missing = missing;
    this.extra = extra;
  }
}

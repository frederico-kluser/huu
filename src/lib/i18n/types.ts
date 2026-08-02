/**
 * i18n primitives. Kept dependency-free so every layer (lib → git →
 * orchestrator → ui/web) can import it without creating a cycle.
 */

/** Every locale huu ships. `en` is the SOURCE catalog — it defines the keys. */
export const LOCALES = ['en', 'pt-BR'] as const;

export type Locale = (typeof LOCALES)[number];

/** The locale used when nothing else resolves, and the key-defining catalog. */
export const DEFAULT_LOCALE: Locale = 'en';

/** A flat, dot-namespaced catalog: `web.settings.title` → `'Settings'`. */
export type Messages = Record<string, string>;

/** Values injected into `{placeholder}` slots. */
export type MessageParams = Record<string, string | number>;

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/**
 * Map anything POSIX/BCP-47-ish onto a supported locale.
 * `pt_BR.UTF-8`, `pt-br`, `pt` → `pt-BR`; `en_US.UTF-8` → `en`; unknown → null.
 */
export function normalizeLocale(raw: string | undefined | null): Locale | null {
  if (!raw) return null;
  const head = raw.trim().split(/[.@:]/)[0].replace(/_/g, '-').toLowerCase();
  if (!head) return null;
  if (head === 'pt-br' || head === 'pt' || head.startsWith('pt-')) return 'pt-BR';
  if (head === 'en' || head.startsWith('en-')) return 'en';
  return null;
}

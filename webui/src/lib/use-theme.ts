import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'huu:theme';
export type ThemeMode = 'light' | 'dark';

function readInitial(): ThemeMode {
  if (typeof window === 'undefined') return 'dark';
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === 'light' || stored === 'dark') return stored;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function apply(mode: ThemeMode): void {
  const root = document.documentElement;
  if (mode === 'dark') root.classList.add('dark');
  else root.classList.remove('dark');
}

/**
 * Toggles the `<html class="dark">` flag and persists the choice to
 * `localStorage`. Initial value: stored preference > OS preference > 'dark'.
 */
export function useTheme(): { mode: ThemeMode; toggle: () => void; set: (m: ThemeMode) => void } {
  const [mode, setMode] = useState<ThemeMode>(readInitial);

  useEffect(() => {
    apply(mode);
    try {
      window.localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      // ignore quota/access errors
    }
  }, [mode]);

  const toggle = useCallback(() => setMode((m) => (m === 'dark' ? 'light' : 'dark')), []);
  const set = useCallback((m: ThemeMode) => setMode(m), []);
  return { mode, toggle, set };
}

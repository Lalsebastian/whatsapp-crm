import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  DARK_QUERY,
  normaliseTheme,
  resolveTheme,
  THEME_STORAGE_KEY,
  toggledTheme,
} from '@/lib/theme-utils';

/*
 * Theme is stored explicitly rather than always following the OS, because an
 * operations console is often left open on a shared or kiosk screen where
 * following the system at 6am is wrong.
 */

function readInitial() {
  if (typeof window === 'undefined') return 'system';
  return normaliseTheme(window.localStorage.getItem(THEME_STORAGE_KEY));
}

const ThemeContext = createContext(null);

export function ThemeProvider({ children }) {
  const [preference, setPreference] = useState(readInitial);
  const [systemTheme, setSystemTheme] = useState(
    () => (typeof window !== 'undefined' && window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light')
  );

  useEffect(() => {
    const mql = window.matchMedia(DARK_QUERY);
    const onChange = (event) => setSystemTheme(event.matches ? 'dark' : 'light');
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  const resolvedTheme = resolveTheme(preference, systemTheme);

  const setTheme = useCallback((next) => {
    if (next !== 'light' && next !== 'dark' && next !== 'system') return;
    setPreference(next);
    if (next === 'system') window.localStorage.removeItem(THEME_STORAGE_KEY);
    else window.localStorage.setItem(THEME_STORAGE_KEY, next);
  }, []);

  const toggleTheme = useCallback(
    () => setTheme(toggledTheme(resolvedTheme)),
    [resolvedTheme, setTheme]
  );

  const value = useMemo(
    () => ({ preference, resolvedTheme, setTheme, toggleTheme }),
    [preference, resolvedTheme, setTheme, toggleTheme]
  );

  return createElement(ThemeContext.Provider, { value }, children);
}

export function useTheme() {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useTheme must be used within <ThemeProvider>');
  return value;
}

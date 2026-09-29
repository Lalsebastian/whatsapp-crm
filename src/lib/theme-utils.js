export const THEME_STORAGE_KEY = 'crm-console-theme';
export const DARK_QUERY = '(prefers-color-scheme: dark)';

export function normaliseTheme(value) {
  return value === 'light' || value === 'dark' ? value : 'system';
}

export function resolveTheme(preference, systemTheme) {
  return preference === 'system' ? systemTheme : preference;
}

export function toggledTheme(resolvedTheme) {
  return resolvedTheme === 'dark' ? 'light' : 'dark';
}

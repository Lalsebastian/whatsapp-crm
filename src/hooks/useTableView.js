import { useMemo, useState } from 'react';

const DEFAULT_DENSITY = 'comfortable';

function readPreference(storageKey) {
  if (typeof window === 'undefined') return { density: DEFAULT_DENSITY, hidden: [] };
  try {
    return { density: DEFAULT_DENSITY, hidden: [], ...JSON.parse(localStorage.getItem(storageKey) ?? '{}') };
  } catch {
    return { density: DEFAULT_DENSITY, hidden: [] };
  }
}

export function useTableView(storageKey, columns) {
  const [preference, setPreference] = useState(() => readPreference(storageKey));

  function update(next) {
    setPreference((current) => {
      const value = typeof next === 'function' ? next(current) : next;
      localStorage.setItem(storageKey, JSON.stringify(value));
      return value;
    });
  }

  const visibleColumns = useMemo(
    () => columns.filter((column) => column.required || !preference.hidden.includes(column.key)),
    [columns, preference.hidden]
  );

  return {
    density: preference.density,
    hidden: preference.hidden,
    visibleColumns,
    setDensity: (density) => update((current) => ({ ...current, density })),
    toggleColumn: (key) => update((current) => ({
      ...current,
      hidden: current.hidden.includes(key)
        ? current.hidden.filter((item) => item !== key)
        : [...current.hidden, key],
    })),
    reset: () => update({ density: DEFAULT_DENSITY, hidden: [] }),
  };
}

import { useState } from 'react';

const STORAGE_KEY = 'joboy.owner.dashboard.widgets';

const DEFAULT_DASHBOARD_WIDGETS = {
  today: true,
  performance: true,
  revenue: true,
  operations: true,
  customerCare: true,
};

function readWidgets() {
  try {
    return { ...DEFAULT_DASHBOARD_WIDGETS, ...JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}') };
  } catch {
    return DEFAULT_DASHBOARD_WIDGETS;
  }
}

export function useDashboardWidgets() {
  const [widgets, setWidgets] = useState(readWidgets);

  function update(next) {
    setWidgets(next);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }

  return {
    widgets,
    toggle: (key) => update({ ...widgets, [key]: !widgets[key] }),
    reset: () => update(DEFAULT_DASHBOARD_WIDGETS),
  };
}

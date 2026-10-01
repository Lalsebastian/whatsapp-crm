import { useCallback, useSyncExternalStore } from 'react';

const STORAGE_KEY = 'joboy.crm.workspace';
const EVENT_NAME = 'joboy-workspace-change';
const DEFAULTS = {
  density: 'comfortable',
  defaultRange: '30d',
  pinned: [],
  recent: [],
};

let snapshotCache = null;
let snapshotRaw = null;

function readWorkspace() {
  if (typeof window === 'undefined') return DEFAULTS;
  const raw = window.localStorage.getItem(STORAGE_KEY) ?? '';
  if (raw === snapshotRaw && snapshotCache) return snapshotCache;
  try {
    snapshotCache = { ...DEFAULTS, ...JSON.parse(raw || '{}') };
  } catch {
    snapshotCache = DEFAULTS;
  }
  snapshotRaw = raw;
  return snapshotCache;
}

function subscribe(callback) {
  window.addEventListener(EVENT_NAME, callback);
  window.addEventListener('storage', callback);
  return () => {
    window.removeEventListener(EVENT_NAME, callback);
    window.removeEventListener('storage', callback);
  };
}

function writeWorkspace(next) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  snapshotRaw = null;
  window.dispatchEvent(new Event(EVENT_NAME));
}

export function useWorkspacePreferences() {
  const workspace = useSyncExternalStore(subscribe, readWorkspace, () => DEFAULTS);
  const update = useCallback((recipe) => {
    const current = readWorkspace();
    writeWorkspace(typeof recipe === 'function' ? recipe(current) : { ...current, ...recipe });
  }, []);

  const setDensity = useCallback((density) => update((current) => ({ ...current, density })), [update]);
  const setDefaultRange = useCallback((defaultRange) => update((current) => ({ ...current, defaultRange })), [update]);
  const rememberRecord = useCallback((record) => update((current) => ({
    ...current,
    recent: [record, ...current.recent.filter((item) => item.href !== record.href)].slice(0, 8),
  })), [update]);
  const togglePinned = useCallback((record) => update((current) => ({
    ...current,
    pinned: current.pinned.some((item) => item.href === record.href)
      ? current.pinned.filter((item) => item.href !== record.href)
      : [record, ...current.pinned].slice(0, 12),
  })), [update]);
  const clearRecent = useCallback(() => update((current) => ({ ...current, recent: [] })), [update]);

  return {
    ...workspace,
    setDensity,
    setDefaultRange,
    rememberRecord,
    togglePinned,
    clearRecent,
  };
}

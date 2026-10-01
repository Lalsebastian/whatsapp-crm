import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'joboy-motion-preference';
const OPTIONS = new Set(['full', 'gentle', 'still']);

function initialValue() {
  if (typeof window === 'undefined') return 'full';
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (OPTIONS.has(stored)) return stored;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'still' : 'full';
}

export function useMotionPreference() {
  const [motion, setMotionState] = useState(initialValue);

  useEffect(() => {
    document.documentElement.dataset.motion = motion;
  }, [motion]);

  useEffect(() => {
    const sync = (event) => setMotionState(event.detail);
    window.addEventListener('joboy:motion-change', sync);
    return () => window.removeEventListener('joboy:motion-change', sync);
  }, []);

  const setMotion = useCallback((next) => {
    if (!OPTIONS.has(next)) return;
    window.localStorage.setItem(STORAGE_KEY, next);
    document.documentElement.dataset.motion = next;
    setMotionState(next);
    window.dispatchEvent(new CustomEvent('joboy:motion-change', { detail: next }));
  }, []);

  return { motion, setMotion };
}

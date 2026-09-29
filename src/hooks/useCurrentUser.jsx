import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { initialRole, ROLE_META, ROLES } from '@/lib/roles';

/*
 * THE AUTH SEAM.
 *
 * Auth is deliberately deferred, so this hook is the single place that answers
 * "who is using the app". Everything else consumes `role` / `can` and never
 * reads storage directly. When Supabase Auth lands, only `resolveUser` and
 * `can` need to change — no view, route or component is touched.
 *
 * Because there is no real identity yet, this is NOT access control. It is a
 * development affordance. See "Security debt" in the plan: with the anon key
 * and no RLS, the underlying data is reachable by anyone who can load the app.
 */

export { ROLE_META, ROLES } from '@/lib/roles';

const STORAGE_KEY = 'crm-console-role';

const PERMISSIONS = {
  owner: ['analytics:view', 'bookings:view', 'complaints:view', 'escalations:view', 'jobs:view'],
  agent: ['bookings:view', 'bookings:write', 'complaints:view', 'complaints:write', 'escalations:view', 'escalations:write', 'jobs:view', 'jobs:assign'],
  tech: ['jobs:view', 'jobs:update', 'media:upload'],
};

const MOCK_USER = {
  id: 'dev-user',
  name: 'Dev User',
  email: 'dev@localhost',
  phone: null,
};

const UserContext = createContext(null);

function readStoredRole() {
  if (typeof window === 'undefined') return null;
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return ROLES.includes(stored) ? stored : null;
}

export function UserProvider({ children }) {
  // Production has no role switcher and no real identity yet, so it falls back
  // to a fixed default rather than pretending to authenticate anyone.
  const [role, setRoleState] = useState(() =>
    initialRole({ isDev: import.meta.env.DEV, storedRole: readStoredRole() })
  );

  useEffect(() => {
    if (import.meta.env.DEV) return;
    if (!window.localStorage.getItem(STORAGE_KEY)) {
      console.warn(
        '[auth] No authenticated user — falling back to the "owner" view. ' +
          'This is a placeholder until Supabase Auth is wired into useCurrentUser.'
      );
    }
  }, []);

  const setRole = useCallback((next) => {
    if (!import.meta.env.DEV) return;
    if (!ROLES.includes(next)) return;
    setRoleState(next);
    window.localStorage.setItem(STORAGE_KEY, next);
  }, []);

  const value = useMemo(
    () => ({
      user: MOCK_USER,
      role,
      roleMeta: ROLE_META[role],
      setRole,
      can: (permission) => PERMISSIONS[role]?.includes(permission) ?? false,
      isMock: true,
    }),
    [role, setRole]
  );

  return <UserContext.Provider value={value}>{children}</UserContext.Provider>;
}

export function useCurrentUser() {
  const ctx = useContext(UserContext);
  if (!ctx) throw new Error('useCurrentUser must be used within <UserProvider>');
  return ctx;
}

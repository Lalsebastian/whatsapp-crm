import { useSearchParams } from 'react-router-dom';

/*
 * Module addressing for the views.
 *
 * `?view=` rather than a nested route, matching navConfig. Sidebar and Topbar
 * read the same param, so setting it here keeps the entire shell in sync — that
 * is why this goes through setSearchParams instead of local state.
 *
 * An unknown value falls back to the role default rather than rendering
 * nothing, so a stale bookmark shows a working screen instead of a blank panel.
 */
export function useModule(defaultModule) {
  const [searchParams, setSearchParams] = useSearchParams();
  const requested = searchParams.get('view');

  return {
    active: requested ?? defaultModule,
    setModule: (moduleId, params = {}) =>
      setSearchParams({ view: moduleId, ...params }, { replace: true }),
  };
}

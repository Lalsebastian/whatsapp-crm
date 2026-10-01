import { useNavigate, useSearchParams } from 'react-router-dom';
import { modulesForRole, moduleHref } from '@/components/layout/navConfig';
import { useCurrentUser } from '@/hooks/useCurrentUser';

export function MobileBottomNav() {
  const { role } = useCurrentUser();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const modules = modulesForRole(role).slice(0, 5);
  const active = searchParams.get('view') ?? modules[0]?.id;
  return (
    <nav className="mobile-bottom-nav lg:hidden" style={{ gridTemplateColumns: `repeat(${modules.length}, minmax(0, 1fr))` }} aria-label="Primary mobile navigation">
      {modules.map((item) => {
        const Icon = item.icon;
        const selected = item.id === active;
        return <button key={item.id} type="button" aria-label={item.label} aria-current={selected ? 'page' : undefined} onClick={() => navigate(moduleHref(role, item.id))} className={selected ? 'is-active' : ''}><span aria-hidden="true"><Icon /></span><small>{item.label}</small></button>;
      })}
    </nav>
  );
}

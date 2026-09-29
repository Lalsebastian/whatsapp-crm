import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { NavLink, useLocation, useSearchParams } from 'react-router-dom';
import { Menu } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ROLE_META, useCurrentUser } from '@/hooks/useCurrentUser';
import { DEFAULT_MODULE, modulesForRole, moduleHref } from '@/components/layout/navConfig';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';

const MobileNavContext = createContext(null);

export function MobileNavProvider({ children }) {
  const location = useLocation();
  const routeKey = `${location.pathname}${location.search}`;

  // The drawer is only open on the route it was opened from, so navigating
  // closes it as a derived value instead of a setState-in-effect pass that
  // repaints the open drawer over the screen the user just moved to.
  const [openedOn, setOpenedOn] = useState(null);
  const open = openedOn === routeKey;

  const setOpen = useCallback((next) => setOpenedOn(next ? routeKey : null), [routeKey]);
  const toggle = useCallback(() => setOpenedOn((cur) => (cur === routeKey ? null : routeKey)), [routeKey]);

  const value = useMemo(() => ({ open, setOpen, toggle }), [open, setOpen, toggle]);

  return <MobileNavContext.Provider value={value}>{children}</MobileNavContext.Provider>;
}

function useMobileNav() {
  const ctx = useContext(MobileNavContext);
  if (!ctx) throw new Error('useMobileNav must be used within <MobileNavProvider>');
  return ctx;
}

export function MobileNavTrigger({ className }) {
  const { toggle } = useMobileNav();
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className={cn('lg:hidden', className)}
      onClick={toggle}
      aria-label="Open navigation"
    >
      <Menu className="size-4" />
    </Button>
  );
}

export function MobileNavDrawer() {
  const { open, setOpen } = useMobileNav();
  const { role } = useCurrentUser();
  const [searchParams] = useSearchParams();
  const activeModule = searchParams.get('view') ?? DEFAULT_MODULE[role];

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent side="left" className="w-80 gap-0 p-0">
        <SheetHeader className="from-primary/10 border-b bg-gradient-to-br to-transparent px-5 py-5">
          <SheetTitle className="text-lg">Joboy CRM</SheetTitle>
          <SheetDescription>{ROLE_META[role].label} workspace</SheetDescription>
        </SheetHeader>
        <nav className="flex-1 overflow-y-auto p-3">
          <ul className="space-y-2">
            {modulesForRole(role).map((mod) => (
              <li key={mod.id}>
                <NavLink
                  to={moduleHref(role, mod.id)}
                  className={cn(
                    'group flex items-center gap-3 rounded-2xl p-2.5 text-sm font-semibold transition-all',
                    mod.id === activeModule
                      ? 'bg-primary/8 text-foreground ring-primary/10 ring-1'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  )}
                >
                  <span className={cn(
                    'grid size-11 shrink-0 place-items-center rounded-xl transition-all',
                    mod.id === activeModule
                      ? 'from-primary to-primary/80 text-primary-foreground shadow-primary/20 bg-gradient-to-br shadow-lg'
                      : 'bg-muted group-hover:bg-card group-hover:text-primary group-hover:shadow-sm'
                  )}>
                    <mod.icon className="size-[19px]" />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate">{mod.label}</span>
                    <span className="text-muted-foreground block truncate text-[11px] font-normal">{mod.description}</span>
                  </span>
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </SheetContent>
    </Sheet>
  );
}

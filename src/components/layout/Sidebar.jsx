import { useState } from 'react';
import { NavLink, useNavigate, useSearchParams } from 'react-router-dom';
import { Bot, ChevronDown, Moon, PanelLeftClose, PanelLeftOpen, ShieldAlert, Sun, UserRoundCog } from 'lucide-react';
import joboyLogo from '@/assets/joboy-logo.png';
import { cn } from '@/lib/utils';
import { ROLE_META, useCurrentUser } from '@/hooks/useCurrentUser';
import { DEFAULT_MODULE, groupedModules, moduleHref } from '@/components/layout/navConfig';
import { useTheme } from '@/hooks/useTheme';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { roleHome } from '@/lib/roles';

const SIDEBAR_STORAGE_KEY = 'crm-sidebar-collapsed';

function Brand({ collapsed }) {
  return <div className={cn('flex min-h-[5.25rem] items-center py-3', collapsed ? 'justify-center px-2' : 'px-5')}>
    <img
      src={joboyLogo}
      alt="Joboy"
      className={cn(
        'block object-contain transition-[width,transform] duration-300 hover:scale-[1.03]',
        collapsed ? 'w-14' : 'w-40'
      )}
    />
  </div>;
}

function RoleSwitcher({ collapsed }) {
  const { role, setRole } = useCurrentUser();
  const navigate = useNavigate();
  const switchRole = (nextRole) => {
    setRole(nextRole);
    navigate(roleHome(nextRole), { replace: true });
  };

  if (!import.meta.env.DEV) return <div className={cn('pb-3', collapsed ? 'px-4' : 'px-3')}>
    <div title={collapsed ? `Auth pending — ${ROLE_META[role].label}` : undefined} className={cn('bg-warning/10 text-warning ring-warning/25 flex items-start gap-2 rounded-lg p-2.5 text-[11px] leading-relaxed ring-1 ring-inset', collapsed && 'justify-center')}>
      <ShieldAlert className="mt-px size-3.5 shrink-0" />
      {!collapsed ? <span>Auth pending — showing the {ROLE_META[role].label} view to everyone.</span> : null}
    </div>
  </div>;

  return <div className={cn('pb-3', collapsed ? 'px-4' : 'px-3')}>
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size={collapsed ? 'icon' : 'sm'} className={cn(!collapsed && 'w-full justify-between')} title={collapsed ? 'Preview role' : undefined}>
          {collapsed ? <UserRoundCog className="size-4" /> : <><span className="truncate">{ROLE_META[role].label}</span><ChevronDown className="size-3.5 opacity-60" /></>}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel>Preview role</DropdownMenuLabel>
        {Object.entries(ROLE_META).map(([key, meta]) => <DropdownMenuItem key={key} onSelect={() => switchRole(key)}>
          <span className="flex flex-col items-start"><span>{meta.label}</span><span className="text-muted-foreground text-[11px]">{meta.description}</span></span>
        </DropdownMenuItem>)}
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="normal-case tracking-normal">Dev only — not access control</DropdownMenuLabel>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>;
}

function NavItems({ role, activeModule, collapsed }) {
  const currentModule = activeModule ?? DEFAULT_MODULE[role];
  return <nav className={cn('scrollbar-thin flex-1 overflow-y-auto pb-4', collapsed ? 'space-y-3 px-3' : 'space-y-6 px-3')}>
    {groupedModules(role).map(([group, mods]) => <div key={group}>
      {!collapsed ? <div className="text-sidebar-foreground/40 px-3 pb-2 text-[9px] font-bold tracking-[0.18em] uppercase">{group}</div> : null}
      <ul className="space-y-1.5">{mods.map((mod) => {
        const isActive = mod.id === currentModule;
        return <li key={mod.id}><NavLink
          to={moduleHref(role, mod.id)} title={collapsed ? mod.label : undefined} aria-current={isActive ? 'page' : undefined}
          className={cn('group/nav relative flex items-center rounded-2xl text-[13px] font-semibold transition-all duration-300', collapsed ? 'justify-center p-1.5' : 'gap-3 p-2', isActive ? 'joboy-nav-active text-sidebar-foreground ring-primary/15 ring-1' : 'text-sidebar-foreground/62 hover:bg-sidebar-muted hover:text-sidebar-foreground')}
        >
          {isActive ? <span className="bg-primary absolute top-1/2 -left-3 h-7 w-1 -translate-y-1/2 rounded-r-full" /> : null}
          <span className={cn('grid size-11 shrink-0 place-items-center rounded-xl transition-all duration-300', isActive ? 'joboy-gradient text-primary-foreground shadow-primary/25 shadow-lg' : 'bg-sidebar-muted/75 text-sidebar-foreground/55 group-hover/nav:bg-card group-hover/nav:text-info group-hover/nav:-translate-y-0.5 group-hover/nav:scale-105 group-hover/nav:shadow-md')}>
            <mod.icon className="size-[19px] transition-transform duration-300 group-hover/nav:rotate-3" strokeWidth={isActive ? 2.3 : 1.9} />
          </span>
          {!collapsed ? <span className="min-w-0 flex-1 animate-in fade-in duration-200"><span className="block truncate">{mod.label}</span><span className="text-sidebar-foreground/38 mt-0.5 block truncate text-[10px] font-medium">{mod.description}</span></span> : null}
        </NavLink></li>;
      })}</ul>
    </div>)}
  </nav>;
}

function ThemeRow({ collapsed }) {
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  return <div className={cn('border-sidebar-border flex items-center gap-2 border-t py-3.5', collapsed ? 'justify-center px-3' : 'justify-between px-5')}>
    {collapsed ? <Button variant="ghost" size="icon" onClick={() => setTheme(isDark ? 'light' : 'dark')} aria-label={isDark ? 'Use light theme' : 'Use dark theme'} title={isDark ? 'Use light theme' : 'Use dark theme'}>
      {isDark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </Button> : <><Label htmlFor="theme-toggle" className="text-sidebar-foreground/80 text-[12px]">Dark theme</Label><Switch id="theme-toggle" checked={isDark} onCheckedChange={(checked) => setTheme(checked ? 'dark' : 'light')} /></>}
  </div>;
}

export function Sidebar({ className }) {
  const { role } = useCurrentUser();
  const [searchParams] = useSearchParams();
  const activeModule = searchParams.get('view');
  const [collapsed, setCollapsed] = useState(() => window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === 'true');
  const toggleCollapsed = () => setCollapsed((current) => {
    const next = !current;
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(next));
    return next;
  });

  return <aside className={cn('bg-sidebar/94 text-sidebar-foreground border-sidebar-border relative sticky top-0 z-20 h-dvh shrink-0 flex-col border-r shadow-[12px_0_40px_rgba(15,23,42,.045)] backdrop-blur-2xl transition-[width] duration-300 ease-out', collapsed ? 'w-[5.25rem]' : 'w-[17rem]', className)}>
    <Button variant="outline" size="icon-sm" onClick={toggleCollapsed} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-expanded={!collapsed} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} className="bg-card absolute top-7 -right-4 z-30 rounded-full shadow-md">
      {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
    </Button>
    <Brand collapsed={collapsed} />
    <RoleSwitcher collapsed={collapsed} />
    <NavItems role={role} activeModule={activeModule} collapsed={collapsed} />
    <div className={cn('border-sidebar-border border-t py-3', collapsed ? 'px-3' : 'px-4')}>
      <div title={collapsed ? 'WhatsApp connected' : undefined} className={cn('bg-success/8 text-sidebar-foreground/65 flex items-center rounded-xl border border-success/15 text-[11px]', collapsed ? 'justify-center p-3' : 'gap-2.5 px-3 py-2.5')}>
        <span className="relative flex size-2 shrink-0"><span className="bg-success absolute inline-flex size-full animate-ping rounded-full opacity-40" /><span className="bg-success relative inline-flex size-2 rounded-full" /></span>
        {!collapsed ? <><Bot className="size-3.5" /><span className="font-medium">WhatsApp connected</span></> : null}
      </div>
    </div>
    <ThemeRow collapsed={collapsed} />
  </aside>;
}

import { useLayoutEffect } from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from '@/components/layout/Sidebar';
import { Topbar } from '@/components/layout/Topbar';
import { MobileNavDrawer, MobileNavProvider } from '@/components/layout/MobileNav';
import { useTheme } from '@/hooks/useTheme';

function ShellChrome() {
  const { resolvedTheme } = useTheme();

  // useLayoutEffect rather than a plain effect so the class is applied before
  // the browser paints — a reload would otherwise flash the wrong theme.
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', resolvedTheme === 'dark');
    root.style.colorScheme = resolvedTheme;
  }, [resolvedTheme]);

  return (
    <div className="app-canvas text-foreground relative flex min-h-dvh overflow-x-hidden">
      <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden="true">
        <div className="ambient-orb bg-primary/12 absolute -top-40 right-[8%] size-[30rem] rounded-full blur-3xl" />
        <div className="ambient-orb ambient-orb-delayed bg-info/8 absolute bottom-[-14rem] left-[18%] size-[34rem] rounded-full blur-3xl" />
      </div>
      <Sidebar className="hidden lg:flex" />
      <MobileNavDrawer />

      <div className="relative z-10 flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main className="min-w-0 flex-1">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export function AppShell() {
  return (
    <MobileNavProvider>
      <ShellChrome />
    </MobileNavProvider>
  );
}

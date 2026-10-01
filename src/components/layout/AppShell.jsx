import { useLayoutEffect, useRef } from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from '@/components/layout/Sidebar';
import { Topbar } from '@/components/layout/Topbar';
import { MobileNavDrawer, MobileNavProvider } from '@/components/layout/MobileNav';
import { MobileBottomNav } from '@/components/layout/MobileBottomNav';
import { useTheme } from '@/hooks/useTheme';
import { useMotionPreference } from '@/hooks/useMotionPreference';
import { useWorkspacePreferences } from '@/hooks/useWorkspacePreferences';

function ShellChrome() {
  const { resolvedTheme } = useTheme();
  const { density } = useWorkspacePreferences();
  useMotionPreference();
  const canvasRef = useRef(null);

  // useLayoutEffect rather than a plain effect so the class is applied before
  // the browser paints — a reload would otherwise flash the wrong theme.
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', resolvedTheme === 'dark');
    root.style.colorScheme = resolvedTheme;
  }, [resolvedTheme]);

  return (
    <div
      ref={canvasRef}
      onPointerMove={(event) => {
        canvasRef.current?.style.setProperty('--spotlight-x', `${event.clientX}px`);
        canvasRef.current?.style.setProperty('--spotlight-y', `${event.clientY}px`);
        const parallaxX = (event.clientX / window.innerWidth - 0.5) * 18;
        const parallaxY = (event.clientY / window.innerHeight - 0.5) * 14;
        canvasRef.current?.style.setProperty('--parallax-x', `${parallaxX}px`);
        canvasRef.current?.style.setProperty('--parallax-y', `${parallaxY}px`);
      }}
      className="app-canvas dreamscape text-foreground relative flex min-h-dvh overflow-x-hidden"
      data-ui-density={density}
    >
      <a href="#crm-main" className="skip-link">Skip to main content</a>
      <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden="true">
        <div className="ambient-orb bg-primary/12 absolute -top-40 right-[8%] size-[30rem] rounded-full blur-3xl" />
        <div className="ambient-orb ambient-orb-delayed bg-info/8 absolute bottom-[-14rem] left-[18%] size-[34rem] rounded-full blur-3xl" />
        <div className="aurora-mesh absolute inset-0" />
        <div className="dashboard-grid absolute inset-0" />
        <div className="surreal-particles absolute inset-0" />
        <div className="surreal-constellation absolute inset-0"><i /><i /><i /><i /><i /><i /></div>
        <div className="cursor-spotlight absolute inset-0" />
        <div className="surreal-scene absolute inset-0">
          <div className="surreal-sun" />
          <div className="surreal-orbit"><span /></div>
          <div className="surreal-monolith" />
          <div className="surreal-ribbon" />
          <div className="surreal-portal"><i /><i /></div>
          <div className="surreal-prism"><i /></div>
          <div className="surreal-wave"><i /><i /><i /></div>
        </div>
      </div>
      <Sidebar className="hidden lg:flex" />
      <MobileNavDrawer />

      <div className="relative z-10 flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main id="crm-main" tabIndex="-1" className="min-w-0 flex-1 pb-[calc(5.5rem+env(safe-area-inset-bottom))] md:pb-0">
          <Outlet />
        </main>
      </div>
      <MobileBottomNav />
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

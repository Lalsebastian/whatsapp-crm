import { useSearchParams } from 'react-router-dom';
import { useIsFetching, useQueryClient } from '@tanstack/react-query';
import { Bot, RefreshCw } from 'lucide-react';
import { initials } from '@/lib/utils';
import { ROLE_META, useCurrentUser } from '@/hooks/useCurrentUser';
import { modulesForRole } from '@/components/layout/navConfig';
import { MobileNavTrigger } from '@/components/layout/MobileNav';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { GlobalSearch } from '@/components/layout/GlobalSearch';
import { NotificationCenter } from '@/components/layout/NotificationCenter';

export function Topbar() {
  const { user, role, roleMeta } = useCurrentUser();
  const [searchParams] = useSearchParams();
  const modules = modulesForRole(role);
  const current = modules.find((m) => m.id === searchParams.get('view')) ?? modules[0];
  const queryClient = useQueryClient();
  const fetching = useIsFetching();

  return (
    <header className="joboy-topbar bg-background/85 supports-[backdrop-filter]:bg-background/65 sticky top-0 z-30 flex h-16 shrink-0 items-center gap-3 border-b px-4 backdrop-blur-xl lg:px-6">
      <MobileNavTrigger />

      <div className="whatsapp-status bg-success/8 text-foreground hidden items-center gap-2 rounded-full border border-success/15 px-3 py-1.5 text-xs font-semibold md:flex">
        <span className="relative flex size-2">
          <span className="bg-success absolute inline-flex size-full animate-ping rounded-full opacity-40" />
          <span className="bg-success relative inline-flex size-2 rounded-full" />
        </span>
        <Bot className="text-info size-3.5" />
        <span>WhatsApp Bot</span>
      </div>

      <div className="min-w-0 xl:block">
        <h1 className="truncate text-sm font-semibold">{current?.label ?? roleMeta.label}</h1>
        <p className="text-muted-foreground truncate text-[11px]">{roleMeta.description}</p>
      </div>

      <div className="ml-auto flex items-center gap-2">
        <GlobalSearch />

        {import.meta.env.DEV && (
          <Badge variant="warning" className="hidden sm:inline-flex">
            Dev mode
          </Badge>
        )}

        <NotificationCenter />

        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Refresh dashboard data"
          title="Refresh dashboard data"
          onClick={() => queryClient.invalidateQueries()}
        >
          <RefreshCw className={fetching ? 'size-4 animate-spin' : 'size-4'} />
        </Button>

        <div className="flex items-center gap-2 pl-1">
          <Avatar className="size-7">
            <AvatarFallback>{initials(user.name)}</AvatarFallback>
          </Avatar>
          <div className="hidden leading-tight sm:block">
            <div className="text-[13px] font-medium">{user.name}</div>
            <div className="text-muted-foreground text-[11px]">{roleMeta.label}</div>
          </div>
        </div>
      </div>
    </header>
  );
}

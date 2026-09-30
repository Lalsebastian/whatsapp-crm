import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Bell, CalendarClock, CheckCircle2, MessageSquareWarning } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { listBookings, listComplaints, listEscalations } from '@/lib/api';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { moduleHref } from '@/components/layout/navConfig';
import { formatDate, formatPhone } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';

export function NotificationCenter() {
  const [open, setOpen] = useState(false);
  const { role } = useCurrentUser();
  const navigate = useNavigate();
  const enabled = role === 'owner' || role === 'agent';
  const notifications = useQuery({
    queryKey: ['notification-centre', role],
    queryFn: async () => {
      const [bookings, complaints, escalations] = await Promise.all([
        listBookings({}),
        listComplaints({}),
        listEscalations({}),
      ]);
      return { bookings, complaints, escalations };
    },
    enabled,
    staleTime: 30_000,
  });

  const items = useMemo(() => {
    if (!notifications.data) return [];
    const today = new Date().toISOString().slice(0, 10);
    const escalationItems = notifications.data.escalations
      .filter((item) => item.status !== 'resolved')
      .map((item) => ({
        id: `escalation-${item.id}`,
        icon: AlertTriangle,
        tone: 'warning',
        title: item.reason || 'Human handoff needs attention',
        detail: item.customer?.name ?? formatPhone(item.phone),
        module: 'escalations',
      }));
    const complaintItems = notifications.data.complaints
      .filter((item) => ['open', 'escalated'].includes(item.status))
      .map((item) => ({
        id: `complaint-${item.id}`,
        icon: MessageSquareWarning,
        tone: item.status === 'escalated' ? 'destructive' : 'warning',
        title: `${item.reference ?? 'Complaint'} · ${item.status === 'escalated' ? 'Escalated' : 'Open'}`,
        detail: item.customer?.name ?? formatPhone(item.customer?.phone),
        module: role === 'owner' ? 'complaints' : 'board',
      }));
    const delayedBookings = notifications.data.bookings
      .filter((item) => item.scheduled_date && item.scheduled_date < today && !['completed', 'cancelled'].includes(item.status))
      .map((item) => ({
        id: `booking-${item.id}`,
        icon: CalendarClock,
        tone: 'info',
        title: `${item.reference ?? 'Booking'} may be delayed`,
        detail: `${item.service?.name ?? 'Service'} · ${formatDate(item.scheduled_date)}`,
        module: 'bookings',
      }));
    return [...escalationItems, ...complaintItems, ...delayedBookings].slice(0, 30);
  }, [notifications.data, role]);

  if (!enabled) return null;

  function openModule(module) {
    navigate(moduleHref(role, module));
    setOpen(false);
  }

  return (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        className="relative"
        onClick={() => setOpen(true)}
        aria-label={`Notifications${items.length ? `, ${items.length} need attention` : ''}`}
        title="Notifications"
      >
        <Bell className="size-4" />
        {items.length ? (
          <span className="absolute -top-1 -right-1 grid min-w-4 place-items-center rounded-full bg-destructive px-1 text-[9px] leading-4 font-bold text-white">
            {items.length > 9 ? '9+' : items.length}
          </span>
        ) : null}
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="w-full gap-0 overflow-y-auto p-0 sm:max-w-md">
          <SheetHeader className="notification-hero border-b p-6 pr-12">
            <div className="mb-2 flex items-center gap-2">
              <span className="surreal-icon grid size-9 place-items-center bg-primary/15 text-primary"><Bell className="size-4" /></span>
              <Badge variant={items.length ? 'warning' : 'success'}>{items.length ? `${items.length} active` : 'All clear'}</Badge>
            </div>
            <SheetTitle className="text-xl">Attention centre</SheetTitle>
            <SheetDescription>Operational signals that may need a response.</SheetDescription>
          </SheetHeader>

          <div className="p-3">
            {notifications.isLoading ? (
              <div className="space-y-2 p-2">
                {Array.from({ length: 5 }, (_, index) => <div key={index} className="bg-muted h-16 animate-pulse rounded-xl" />)}
              </div>
            ) : notifications.isError ? (
              <div className="text-destructive p-8 text-center text-sm">Notifications could not be loaded.</div>
            ) : items.length ? (
              <ul className="space-y-1.5">
                {items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => openModule(item.module)}
                        className="group hover:bg-muted/60 focus-visible:ring-ring flex w-full items-start gap-3 rounded-xl p-3 text-left transition-colors focus-visible:ring-2 focus-visible:outline-none"
                      >
                        <span className={`notification-icon notification-icon-${item.tone}`}><Icon className="size-4" /></span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium">{item.title}</span>
                          <span className="text-muted-foreground mt-0.5 block truncate text-xs">{item.detail}</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="flex flex-col items-center px-6 py-16 text-center">
                <span className="mb-3 grid size-12 place-items-center rounded-full bg-success/10 text-success"><CheckCircle2 /></span>
                <div className="font-medium">Everything looks clear</div>
                <p className="text-muted-foreground mt-1 max-w-xs text-sm">No delayed jobs, open complaints, or escalations currently need attention.</p>
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

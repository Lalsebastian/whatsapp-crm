import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays, ClipboardList, MessageSquare, Search } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { listBookings, listComplaints, listConversationPhones } from '@/lib/api';
import { moduleHref } from '@/components/layout/navConfig';
import { formatPhone } from '@/lib/utils';
import { Input } from '@/components/ui/input';

const MAX_RESULTS = 8;

function includes(value, needle) {
  return String(value ?? '').toLowerCase().includes(needle);
}

export function GlobalSearch() {
  const { role } = useCurrentUser();
  const navigate = useNavigate();
  const [value, setValue] = useState('');
  const [open, setOpen] = useState(false);
  const canSearch = role === 'owner' || role === 'agent';

  const directory = useQuery({
    queryKey: ['global-search', role],
    queryFn: async () => {
      const [bookings, complaints, conversations] = await Promise.all([
        listBookings({}),
        listComplaints({}),
        role === 'agent' ? listConversationPhones() : Promise.resolve([]),
      ]);
      return { bookings, complaints, conversations };
    },
    enabled: canSearch && open,
    staleTime: 60_000,
  });

  const results = useMemo(() => {
    const needle = value.trim().toLowerCase();
    if (needle.length < 2 || !directory.data) return [];

    const bookings = directory.data.bookings
      .filter((item) =>
        [item.reference, item.customer?.name, item.customer?.phone, item.service?.name].some(
          (candidate) => includes(candidate, needle)
        )
      )
      .map((item) => ({
        id: `booking-${item.id}`,
        kind: 'Booking',
        icon: CalendarDays,
        title: item.reference ?? 'Booking',
        detail: item.customer?.name ?? formatPhone(item.customer?.phone),
        module: 'bookings',
      }));

    const complaints = directory.data.complaints
      .filter((item) =>
        [item.reference, item.description, item.category, item.customer?.name, item.customer?.phone].some(
          (candidate) => includes(candidate, needle)
        )
      )
      .map((item) => ({
        id: `complaint-${item.id}`,
        kind: 'Complaint',
        icon: ClipboardList,
        title: item.reference ?? item.category ?? 'Complaint',
        detail: item.customer?.name ?? formatPhone(item.customer?.phone),
        module: role === 'owner' ? 'complaints' : 'board',
      }));

    const conversations = directory.data.conversations
      .filter((item) => includes(item.phone, needle))
      .map((item) => ({
        id: `conversation-${item.phone}`,
        kind: 'Conversation',
        icon: MessageSquare,
        title: formatPhone(item.phone),
        detail: 'WhatsApp conversation',
        module: 'inbox',
      }));

    return [...bookings, ...complaints, ...conversations].slice(0, MAX_RESULTS);
  }, [directory.data, role, value]);

  if (!canSearch) return null;

  const showMenu = open && value.trim().length >= 2;

  return (
    <div
      className="relative hidden md:block"
      onFocus={() => setOpen(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 z-10 size-3.5 -translate-y-1/2" />
      <Input
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="Search bookings, customers, complaints..."
        aria-label="Search CRM"
        aria-expanded={showMenu}
        className="bg-background/70 h-9 w-80 rounded-xl pl-9 text-[13px] shadow-sm backdrop-blur"
      />

      {showMenu ? (
        <div className="bg-popover absolute top-full right-0 mt-2 w-[25rem] overflow-hidden rounded-xl border shadow-xl">
          <div className="text-muted-foreground border-b px-3 py-2 text-[11px] font-medium tracking-wide uppercase">CRM search</div>
          {directory.isLoading ? (
            <p className="text-muted-foreground px-4 py-6 text-center text-sm">Searching...</p>
          ) : directory.isError ? (
            <p className="text-destructive px-4 py-6 text-center text-sm">Search is unavailable.</p>
          ) : results.length ? (
            <ul className="max-h-80 overflow-y-auto p-1.5">
              {results.map((result) => {
                const Icon = result.icon;
                return (
                  <li key={result.id}>
                    <button
                      type="button"
                      className="hover:bg-muted focus-visible:bg-muted flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left outline-none"
                      onClick={() => {
                        navigate(moduleHref(role, result.module));
                        setOpen(false);
                      }}
                    >
                      <span className="bg-primary/10 text-primary grid size-8 shrink-0 place-items-center rounded-lg"><Icon className="size-4" /></span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{result.title}</span>
                        <span className="text-muted-foreground block truncate text-xs">{result.detail}</span>
                      </span>
                      <span className="text-muted-foreground text-[10px] tracking-wide uppercase">{result.kind}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-muted-foreground px-4 py-6 text-center text-sm">No matching CRM records.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays, ClipboardList, MessageSquare, Search } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { listBookings, listComplaints, listConversationPhones } from '@/lib/api';
import { moduleHref, modulesForRole } from '@/components/layout/navConfig';
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
  const inputRef = useRef(null);
  const canSearch = role === 'owner' || role === 'agent';
  const modules = modulesForRole(role);

  useEffect(() => {
    function onKeyDown(event) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
      if (event.key === 'Escape' && open) {
        setOpen(false);
        inputRef.current?.blur();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

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
    enabled: canSearch && open && value.trim().length >= 2,
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

  const showMenu = open;
  const searching = value.trim().length >= 2;

  function goTo(module) {
    navigate(moduleHref(role, module));
    setOpen(false);
    setValue('');
  }

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
        ref={inputRef}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="Search or jump to..."
        aria-label="Search CRM"
        aria-expanded={showMenu}
        className="bg-background/70 h-9 w-80 rounded-xl pr-12 pl-9 text-[13px] shadow-sm backdrop-blur"
      />
      <kbd className="text-muted-foreground pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 rounded border bg-muted/70 px-1.5 py-0.5 text-[9px] font-medium">⌘K</kbd>

      {showMenu ? (
        <div className="bg-popover absolute top-full right-0 mt-2 w-[25rem] overflow-hidden rounded-xl border shadow-xl">
          <div className="text-muted-foreground border-b px-3 py-2 text-[11px] font-medium tracking-wide uppercase">
            {searching ? 'CRM search' : 'Quick navigation'}
          </div>
          {!searching ? (
            <ul className="p-1.5">
              {modules.map((module) => {
                const Icon = module.icon;
                return (
                  <li key={module.id}>
                    <button
                      type="button"
                      className="hover:bg-muted focus-visible:bg-muted flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left outline-none"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => goTo(module.id)}
                    >
                      <span className="bg-info/10 text-info dark:bg-primary/10 dark:text-primary grid size-8 place-items-center rounded-lg"><Icon className="size-4" /></span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium">{module.label}</span>
                        <span className="text-muted-foreground block text-xs">{module.description}</span>
                      </span>
                      <span className="text-muted-foreground text-[10px] tracking-wide uppercase">Open</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : directory.isLoading ? (
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
                        goTo(result.module);
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

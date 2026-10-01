import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, CalendarDays, CalendarPlus, ClipboardList, Command, MessageSquare, MessageSquarePlus, RefreshCw, Search } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { listBookings, listComplaints, listConversationPhones } from '@/lib/api';
import { moduleHref, modulesForRole } from '@/components/layout/navConfig';
import { formatPhone } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

const MAX_RESULTS = 10;
const includes = (value, needle) => String(value ?? '').toLowerCase().includes(needle);

export function GlobalSearch() {
  const { role } = useCurrentUser();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [value, setValue] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef(null);
  const canSearch = role === 'owner' || role === 'agent';
  const modules = modulesForRole(role);

  useEffect(() => {
    const onKeyDown = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((current) => !current);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  const directory = useQuery({
    queryKey: ['global-search', role],
    queryFn: async () => {
      const [bookings, complaints, conversations] = await Promise.all([
        listBookings({}), listComplaints({}), role === 'agent' ? listConversationPhones() : Promise.resolve([]),
      ]);
      return { bookings, complaints, conversations };
    },
    enabled: canSearch && open && value.trim().length >= 2,
    staleTime: 60_000,
  });

  const recordResults = useMemo(() => {
    const needle = value.trim().toLowerCase();
    if (needle.length < 2 || !directory.data) return [];
    const bookings = directory.data.bookings.filter((item) => [item.reference, item.customer?.name, item.customer?.phone, item.service?.name].some((candidate) => includes(candidate, needle))).map((item) => ({ id: `booking-${item.id}`, record: item.id, kind: 'Booking', icon: CalendarDays, title: item.reference ?? 'Booking', detail: item.customer?.name ?? formatPhone(item.customer?.phone), module: 'bookings', search: item.reference }));
    const complaints = directory.data.complaints.filter((item) => [item.reference, item.description, item.category, item.customer?.name, item.customer?.phone].some((candidate) => includes(candidate, needle))).map((item) => ({ id: `complaint-${item.id}`, record: item.id, kind: 'Complaint', icon: ClipboardList, title: item.reference ?? item.category ?? 'Complaint', detail: item.customer?.name ?? formatPhone(item.customer?.phone), module: role === 'owner' ? 'complaints' : 'board', search: item.reference }));
    const conversations = directory.data.conversations.filter((item) => includes(item.phone, needle)).map((item) => ({ id: `conversation-${item.phone}`, kind: 'Conversation', icon: MessageSquare, title: formatPhone(item.phone), detail: 'WhatsApp conversation', module: 'inbox', search: item.phone }));
    return [...bookings, ...complaints, ...conversations].slice(0, MAX_RESULTS);
  }, [directory.data, role, value]);

  const commands = useMemo(() => {
    if (value.trim().length >= 2) return recordResults;
    const navigation = modules.map((module) => ({ ...module, kind: module.group, title: module.label }));
    const quick = [
      { id: 'create-booking', kind: 'Quick action', title: 'Create booking', detail: 'Open the booking form', icon: CalendarPlus, action: () => window.dispatchEvent(new CustomEvent('joboy:quick-create', { detail: 'booking' })) },
      { id: 'create-complaint', kind: 'Quick action', title: 'Create complaint', detail: 'Log a customer issue', icon: MessageSquarePlus, action: () => window.dispatchEvent(new CustomEvent('joboy:quick-create', { detail: 'complaint' })) },
      { id: 'refresh', kind: 'Quick action', title: 'Refresh CRM data', detail: 'Reload all dashboard queries', icon: RefreshCw, action: () => queryClient.invalidateQueries() },
    ];
    return [...quick, ...navigation];
  }, [modules, queryClient, recordResults, value]);

  if (!canSearch) return null;

  function run(command) {
    if (!command) return;
    setOpen(false);
    setValue('');
    if (command.action) command.action();
    else if (command.module) navigate(`${moduleHref(role, command.module)}${command.search ? `&search=${encodeURIComponent(command.search)}` : ''}${command.record ? `&record=${encodeURIComponent(command.record)}` : ''}`);
  }

  function onInputKeyDown(event) {
    if (event.key === 'ArrowDown') { event.preventDefault(); setActiveIndex((current) => Math.min(commands.length - 1, current + 1)); }
    if (event.key === 'ArrowUp') { event.preventDefault(); setActiveIndex((current) => Math.max(0, current - 1)); }
    if (event.key === 'Enter') { event.preventDefault(); run(commands[activeIndex]); }
  }

  return <>
    <Button variant="outline" size="sm" onClick={() => { setActiveIndex(0); setOpen(true); }} className="command-trigger bg-background/65 hidden min-w-52 justify-between rounded-xl font-normal text-muted-foreground shadow-sm backdrop-blur md:inline-flex"><span className="flex items-center gap-2"><Search className="size-3.5" />Search or command</span><kbd className="rounded border bg-muted/70 px-1.5 py-0.5 text-[9px] font-semibold">⌘K</kbd></Button>
    <Button variant="ghost" size="icon-sm" onClick={() => { setActiveIndex(0); setOpen(true); }} className="md:hidden" aria-label="Open command palette"><Search /></Button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent showCloseButton={false} className="command-palette top-[12%] max-h-[76dvh] max-w-2xl translate-y-0 gap-0 overflow-hidden border-primary/15 bg-popover/92 p-0 shadow-[0_35px_120px_rgba(5,24,58,.28)] backdrop-blur-2xl">
        <DialogHeader className="sr-only"><DialogTitle>CRM command palette</DialogTitle><DialogDescription>Search records, navigate modules, or run a quick action.</DialogDescription></DialogHeader>
        <div className="command-search relative border-b p-3"><Search className="text-muted-foreground absolute top-1/2 left-6 size-5 -translate-y-1/2" /><Input ref={inputRef} value={value} onChange={(event) => { setValue(event.target.value); setActiveIndex(0); }} onKeyDown={onInputKeyDown} placeholder="Search records or type a command…" className="h-12 border-0 bg-transparent pr-16 pl-11 text-base shadow-none focus-visible:ring-0" /><kbd className="text-muted-foreground absolute top-1/2 right-6 -translate-y-1/2 rounded-md border bg-muted/60 px-2 py-1 text-[10px]">ESC</kbd></div>
        <div className="command-aurora" aria-hidden="true"><i /><i /></div>
        <div className="relative max-h-[56dvh] overflow-y-auto p-2">
          <div className="text-muted-foreground flex items-center gap-2 px-3 py-2 text-[10px] font-bold tracking-[.14em] uppercase"><Command className="size-3" />{value.trim().length >= 2 ? 'Matching CRM records' : 'Search and shortcuts'}</div>
          {directory.isLoading && value.trim().length >= 2 ? <div className="space-y-2 p-3">{Array.from({ length: 4 }, (_, index) => <div key={index} className="premium-skeleton h-12 rounded-xl" />)}</div> : commands.length ? <ul className="space-y-1">{commands.map((command, index) => {
            const Icon = command.icon || Command;
            return <li key={command.id}><button type="button" onMouseEnter={() => setActiveIndex(index)} onClick={() => run(command)} className={`command-result group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left outline-none ${activeIndex === index ? 'is-active' : ''}`}><span className="command-result-icon grid size-10 shrink-0 place-items-center rounded-xl"><Icon className="size-[18px]" /></span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{command.title}</span><span className="text-muted-foreground block truncate text-xs">{command.detail ?? command.description}</span></span><span className="text-muted-foreground text-[9px] font-bold tracking-wider uppercase">{command.kind}</span><ArrowRight className="size-3.5 -translate-x-1 opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100" /></button></li>;
          })}</ul> : <div className="px-6 py-12 text-center"><span className="empty-state-orbit mx-auto grid size-14 place-items-center rounded-full bg-muted"><Search className="size-5" /></span><h3 className="mt-4 font-semibold">No matching CRM records</h3><p className="text-muted-foreground mt-1 text-sm">Try a reference, customer name, phone, or service.</p></div>}
        </div>
        <div className="text-muted-foreground flex flex-wrap items-center gap-4 border-t bg-muted/25 px-5 py-2.5 text-[10px]"><span><kbd>↑↓</kbd> Navigate</span><span><kbd>↵</kbd> Open</span><span><kbd>esc</kbd> Close</span><span className="ml-auto flex items-center gap-1.5"><span className="size-1.5 rounded-full bg-success" />Live workspace</span></div>
      </DialogContent>
    </Dialog>
  </>;
}

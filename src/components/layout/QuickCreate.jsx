import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarPlus, MessageSquarePlus, Plus } from 'lucide-react';
import { createBookingRecord, createComplaintRecord, listCustomers, listServices } from '@/lib/api';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from '@/lib/toast';

const CATEGORIES = ['service_not_completed', 'problem_returned', 'technician_delayed', 'technician_behaviour', 'property_damage', 'payment_issue', 'other'];

export function QuickCreate() {
  const { can } = useCurrentUser();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState('booking');
  const [dirty, setDirty] = useState(false);
  const queryClient = useQueryClient();
  const customers = useQuery({ queryKey: ['customers', 'quick-create'], queryFn: listCustomers, enabled: open });
  const services = useQuery({ queryKey: ['services', 'quick-create'], queryFn: () => listServices({}), enabled: open });
  const mutation = useMutation({
    mutationFn: async (form) => {
      const stamp = Date.now().toString().slice(-8);
      if (type === 'booking') return createBookingRecord({ reference: `CRM-${stamp}`, customer_id: form.get('customer_id'), service_id: form.get('service_id'), scheduled_date: form.get('scheduled_date'), scheduled_time: form.get('scheduled_time') || null, notes: form.get('notes') || null, status: 'pending' });
      return createComplaintRecord({ reference: `CMP-${stamp}`, customer_id: form.get('customer_id'), category: form.get('category'), description: form.get('description') || null, status: 'open' });
    },
    onSuccess: () => {
      queryClient.invalidateQueries();
      setDirty(false);
      setOpen(false);
      toast({ title: `${type === 'booking' ? 'Booking' : 'Complaint'} created`, description: 'The new record is available in the workspace.' });
    },
    onError: (error) => toast({ title: `Could not create ${type}`, description: error.message, tone: 'error' }),
  });

  useEffect(() => {
    const openQuickCreate = (event) => {
      setType(event.detail === 'complaint' ? 'complaint' : 'booking');
      setDirty(false);
      setOpen(true);
    };
    window.addEventListener('joboy:quick-create', openQuickCreate);
    return () => window.removeEventListener('joboy:quick-create', openQuickCreate);
  }, []);

  if (!can('bookings:write') && !can('complaints:write')) return null;
  const changeOpen = (next) => {
    if (!next && dirty && !window.confirm('Discard the information entered in this form?')) return;
    if (!next) setDirty(false);
    setOpen(next);
  };
  return (
    <>
      <Button size="sm" onClick={() => { setDirty(false); setOpen(true); }} className="hidden sm:inline-flex"><Plus />Create</Button>
      <Button size="icon-sm" onClick={() => { setDirty(false); setOpen(true); }} className="sm:hidden" aria-label="Create record"><Plus /></Button>
      <Dialog open={open} onOpenChange={changeOpen}>
        <DialogContent className="max-w-lg overflow-hidden p-0">
          <div className="from-primary/16 via-accent/8 to-card border-b bg-gradient-to-br p-6"><DialogHeader><DialogTitle>Quick create</DialogTitle><DialogDescription>Add operational work without leaving the current page.</DialogDescription></DialogHeader></div>
          <div className="p-6">
            <div className="mb-5 grid grid-cols-2 gap-2 rounded-xl bg-muted/60 p-1">
              <button type="button" onClick={() => setType('booking')} className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition-all ${type === 'booking' ? 'bg-card text-primary shadow-sm' : 'text-muted-foreground'}`}><CalendarPlus className="size-4" />Booking</button>
              <button type="button" onClick={() => setType('complaint')} className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition-all ${type === 'complaint' ? 'bg-card text-primary shadow-sm' : 'text-muted-foreground'}`}><MessageSquarePlus className="size-4" />Complaint</button>
            </div>
            <form className="space-y-4" onInput={() => setDirty(true)} onSubmit={(event) => { event.preventDefault(); mutation.mutate(new FormData(event.currentTarget)); }}>
              <Field label="Customer"><select name="customer_id" required className="bg-background h-9 w-full rounded-md border px-3 text-sm"><option value="">Select customer</option>{(customers.data ?? []).map((item) => <option key={item.id} value={item.id}>{item.name ?? item.phone}</option>)}</select></Field>
              {type === 'booking' ? <><Field label="Service"><select name="service_id" required className="bg-background h-9 w-full rounded-md border px-3 text-sm"><option value="">Select service</option>{(services.data ?? []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field><div className="grid grid-cols-2 gap-3"><Field label="Date"><Input name="scheduled_date" type="date" required /></Field><Field label="Time"><Input name="scheduled_time" type="time" /></Field></div><Field label="Internal notes"><Input name="notes" placeholder="Access or service notes" /></Field></> : <><Field label="Category"><select name="category" required className="bg-background h-9 w-full rounded-md border px-3 text-sm">{CATEGORIES.map((item) => <option key={item} value={item}>{humanise(item)}</option>)}</select></Field><Field label="Description"><textarea name="description" rows="4" required className="bg-background w-full rounded-md border px-3 py-2 text-sm" placeholder="Describe the customer issue" /></Field></>}
              {mutation.error ? <p className="text-destructive text-xs">{mutation.error.message}</p> : null}
              <div className="flex justify-end gap-2 pt-2"><Button type="button" variant="outline" onClick={() => changeOpen(false)}>Cancel</Button><Button type="submit" disabled={mutation.isPending}>{mutation.isPending ? 'Creating…' : `Create ${type}`}</Button></div>
            </form>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Field({ label, children }) { return <div><Label className="mb-1.5 block">{label}</Label>{children}</div>; }
function humanise(value) { return value.replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase()); }

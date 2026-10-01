import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, Bot, BriefcaseBusiness, CheckCircle2, CircleAlert, Gauge, Pencil, Plus, ShieldCheck, SlidersHorizontal, Tags, UsersRound, Wrench } from 'lucide-react';
import {
  createService,
  listAutomationSettings,
  listBookings,
  listComplaints,
  listCustomers,
  listOperationalTargets,
  listServices,
  listSlaPolicies,
  updateAutomationSetting,
  updateOperationalTarget,
  queryKeys,
  updateService,
  updateSlaPolicy,
} from '@/lib/api';
import { createTechnician, listTechnicians, updateTechnician } from '@/lib/api/technicians';
import { buildCustomerSegments, findDataQualityIssues } from '@/lib/control-centre';
import { useModule } from '@/hooks/useModule';
import { ViewShell } from '@/components/layout/ViewShell';
import { Panel, PanelBody, PanelHeader, PanelTitle } from '@/components/layout/Panel';
import { DataTable } from '@/components/data/DataTable';
import { ErrorState, PanelSkeleton } from '@/components/data/EmptyState';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { formatCurrency, formatDate, formatNumber } from '@/lib/utils';

const CONTROL_KEY = ['crm-control-centre'];

export function OwnerControlCentre() {
  const queryClient = useQueryClient();
  const { setModule } = useModule('control');
  const [editor, setEditor] = useState(null);
  const core = useQuery({
    queryKey: [...CONTROL_KEY, 'core'],
    queryFn: async () => {
      const [services, technicianResult, customers, bookings, complaints] = await Promise.all([
        listServices({ activeOnly: false }),
        listTechnicians({ activeOnly: false }).then((rows) => ({ rows, available: true })).catch((error) => ({ rows: [], available: false, error })),
        listCustomers(),
        listBookings({}),
        listComplaints({}),
      ]);
      return { services, technicians: technicianResult.rows, technicianSetup: technicianResult, customers, bookings, complaints };
    },
  });
  const settings = useQuery({
    queryKey: [...CONTROL_KEY, 'settings'],
    queryFn: async () => {
      const [targets, automations, sla] = await Promise.all([listOperationalTargets(), listAutomationSettings(), listSlaPolicies()]);
      return { targets, automations, sla };
    },
    retry: false,
  });
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: CONTROL_KEY });
    queryClient.invalidateQueries({ queryKey: queryKeys.services.all });
    queryClient.invalidateQueries({ queryKey: queryKeys.technicians.all });
  };
  const serviceMutation = useMutation({
    mutationFn: ({ id, patch }) => id ? updateService(id, patch) : createService(patch),
    onSuccess: () => { refresh(); setEditor(null); },
  });
  const technicianMutation = useMutation({
    mutationFn: ({ id, patch }) => id ? updateTechnician(id, patch) : createTechnician(patch),
    onSuccess: () => { refresh(); setEditor(null); },
  });
  const settingMutation = useMutation({
    mutationFn: ({ kind, id, patch }) => kind === 'target' ? updateOperationalTarget(id, patch) : kind === 'sla' ? updateSlaPolicy(id, patch) : updateAutomationSetting(id, patch),
    onSuccess: refresh,
  });

  if (core.isError) return <ViewShell title="CRM Control Centre"><ErrorState error={core.error} onRetry={core.refetch} /></ViewShell>;
  const data = core.data ?? { services: [], technicians: [], customers: [], bookings: [], complaints: [], technicianSetup: { available: true } };
  const segments = buildCustomerSegments(data.customers, data.bookings, data.complaints);
  const issues = findDataQualityIssues(data);
  const activeServices = data.services.filter((row) => row.active !== false).length;
  const activeTechnicians = data.technicians.filter((row) => row.active !== false).length;

  return (
    <ViewShell title="CRM settings" description="Manage services, technicians, customer groups and record quality">
      <section className="control-hero relative overflow-hidden rounded-[1.65rem] border border-primary/15 p-5 md:p-6">
        <div className="control-hero-glow" aria-hidden="true" />
        <div className="relative grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <ControlMetric icon={BriefcaseBusiness} label="Active services" value={activeServices} detail={`${data.services.length} catalogued`} />
          <ControlMetric icon={UsersRound} label="Field team" value={activeTechnicians} detail={`${data.technicians.length} technicians`} />
          <ControlMetric icon={Tags} label="Customer segments" value={new Set(segments.flatMap((row) => row.segments)).size} detail="Live behavioural groups" />
          <ControlMetric icon={issues.length ? CircleAlert : CheckCircle2} label="Data issues" value={issues.length} detail={issues.length ? 'Records need attention' : 'Core records are healthy'} tone={issues.length ? 'warning' : 'success'} />
        </div>
      </section>

      {data.technicianSetup?.available === false ? <div className="flex items-start gap-3 rounded-2xl border border-warning/25 bg-warning/8 px-4 py-3 text-sm text-warning"><CircleAlert className="mt-0.5 size-4 shrink-0" /><div><strong className="block">Technician schema is not installed</strong><span className="text-xs opacity-85">Services and CRM controls remain available. Install the field-operations migration to enable technicians and dispatch.</span></div></div> : null}

      <Tabs defaultValue="catalog" className="min-w-0">
        <TabsList className="control-tabs h-auto max-w-full flex-wrap justify-start rounded-xl border bg-card/75 p-1.5 shadow-sm">
          <TabsTrigger value="catalog"><BriefcaseBusiness /> Services</TabsTrigger>
          <TabsTrigger value="team"><UsersRound /> Technicians</TabsTrigger>
          <TabsTrigger value="sla"><ShieldCheck /> SLA</TabsTrigger>
          <TabsTrigger value="targets"><Gauge /> Targets</TabsTrigger>
          <TabsTrigger value="automation"><Bot /> Automation</TabsTrigger>
          <TabsTrigger value="segments"><Tags /> Segments</TabsTrigger>
          <TabsTrigger value="quality"><Activity /> Data quality</TabsTrigger>
        </TabsList>

        <TabsContent value="catalog"><ServicePanel rows={data.services} loading={core.isLoading} onEdit={(row) => setEditor({ type: 'service', row })} onCreate={() => setEditor({ type: 'service', row: null })} onToggle={(row) => serviceMutation.mutate({ id: row.id, patch: { active: row.active === false } })} /></TabsContent>
        <TabsContent value="team">{data.technicianSetup?.available === false ? <MissingTechnicianSetup /> : <TechnicianPanel rows={data.technicians} loading={core.isLoading} onEdit={(row) => setEditor({ type: 'technician', row })} onCreate={() => setEditor({ type: 'technician', row: null })} onToggle={(row) => technicianMutation.mutate({ id: row.id, patch: { active: row.active === false } })} />}</TabsContent>
        <TabsContent value="sla"><SettingsGate query={settings}><SlaPanel rows={settings.data?.sla ?? []} mutation={settingMutation} /></SettingsGate></TabsContent>
        <TabsContent value="targets"><SettingsGate query={settings}><TargetsPanel rows={settings.data?.targets ?? []} mutation={settingMutation} /></SettingsGate></TabsContent>
        <TabsContent value="automation"><SettingsGate query={settings}><AutomationPanel rows={settings.data?.automations ?? []} mutation={settingMutation} /></SettingsGate></TabsContent>
        <TabsContent value="segments"><SegmentsPanel rows={segments} /></TabsContent>
        <TabsContent value="quality"><QualityPanel issues={issues} onOpen={(module) => setModule(module)} /></TabsContent>
      </Tabs>

      {editor?.type === 'service' ? <ServiceEditor row={editor.row} mutation={serviceMutation} onClose={() => setEditor(null)} /> : null}
      {editor?.type === 'technician' ? <TechnicianEditor row={editor.row} mutation={technicianMutation} onClose={() => setEditor(null)} /> : null}
    </ViewShell>
  );
}

function ControlMetric({ icon: Icon, label, value, detail, tone = 'primary' }) {
  return <div className="control-metric group flex items-center gap-3 rounded-2xl border border-white/55 bg-background/70 p-4 shadow-sm backdrop-blur"><span className={`grid size-11 place-items-center rounded-2xl ${tone === 'warning' ? 'bg-warning/15 text-warning' : tone === 'success' ? 'bg-success/15 text-success' : 'bg-primary/12 text-primary'}`}><Icon className="size-5" /></span><span><span className="text-muted-foreground block text-xs">{label}</span><strong className="tabular text-2xl">{formatNumber(value)}</strong><span className="text-muted-foreground ml-2 text-[10px]">{detail}</span></span></div>;
}

function ServicePanel({ rows, loading, onEdit, onCreate, onToggle }) {
  const columns = [
    { key: 'name', header: 'Service', cell: (row) => <div><strong>{row.name}</strong><div className="text-muted-foreground text-xs">{row.category || 'Uncategorised'}</div></div> },
    { key: 'base_price', header: 'Starting price', cell: (row) => formatCurrency(row.base_price) },
    { key: 'duration_minutes', header: 'Duration', cell: (row) => row.duration_minutes ? `${row.duration_minutes} min` : 'Not set' },
    { key: 'active', header: 'Available', cell: (row) => <Switch checked={row.active !== false} onCheckedChange={() => onToggle(row)} aria-label={`Toggle ${row.name}`} /> },
    { key: 'edit', header: '', sortable: false, cell: (row) => <Button variant="ghost" size="icon" onClick={() => onEdit(row)} aria-label={`Edit ${row.name}`}><Pencil /></Button> },
  ];
  return <ManagementPanel title="Service catalogue" description="Pricing, duration and customer availability" onCreate={onCreate} createLabel="Add service"><DataTable columns={columns} rows={rows} loading={loading} pageSize={15} emptyTitle="No services configured" /></ManagementPanel>;
}

function TechnicianPanel({ rows, loading, onEdit, onCreate, onToggle }) {
  const columns = [
    { key: 'name', header: 'Technician', cell: (row) => <div><strong>{row.name}</strong><div className="text-muted-foreground text-xs">{row.email || row.phone || 'No contact details'}</div></div> },
    { key: 'shift', header: 'Shift', cell: (row) => `${minutes(row.shift_start_minute)}–${minutes(row.shift_end_minute)}` },
    { key: 'weekly_capacity_minutes', header: 'Weekly capacity', cell: (row) => `${Math.round((row.weekly_capacity_minutes || 2400) / 60)}h` },
    { key: 'active', header: 'Active', cell: (row) => <Switch checked={row.active !== false} onCheckedChange={() => onToggle(row)} aria-label={`Toggle ${row.name}`} /> },
    { key: 'edit', header: '', sortable: false, cell: (row) => <Button variant="ghost" size="icon" onClick={() => onEdit(row)} aria-label={`Edit ${row.name}`}><Pencil /></Button> },
  ];
  return <ManagementPanel title="Technician directory" description="Field capacity and availability" onCreate={onCreate} createLabel="Add technician"><DataTable columns={columns} rows={rows} loading={loading} pageSize={15} emptyTitle="No technicians configured" /></ManagementPanel>;
}

function ManagementPanel({ title, description, onCreate, createLabel, children }) {
  return <Panel className="min-h-[32rem]"><PanelHeader><div><PanelTitle>{title}</PanelTitle><p className="text-muted-foreground text-xs">{description}</p></div><Button className="ml-auto" size="sm" onClick={onCreate}><Plus />{createLabel}</Button></PanelHeader><PanelBody scroll={false}>{children}</PanelBody></Panel>;
}

function SettingsGate({ query, children }) {
  if (query.isLoading) return <PanelSkeleton rows={6} />;
  if (query.isError) return <Panel><PanelBody scroll={false} className="p-8"><div className="mx-auto max-w-xl text-center"><SlidersHorizontal className="mx-auto mb-3 size-10 text-primary" /><h2 className="font-semibold">Control Centre migration required</h2><p className="text-muted-foreground mt-2 text-sm">Run <code>202609300003_crm_control_centre.sql</code> in the Supabase SQL editor, then retry.</p><Button className="mt-4" variant="outline" onClick={() => query.refetch()}>Try again</Button></div></PanelBody></Panel>;
  return children;
}

function MissingTechnicianSetup() {
  return <Panel><PanelBody scroll={false} className="p-10 text-center"><UsersRound className="mx-auto size-10 text-primary" /><h2 className="mt-3 font-semibold">Field operations setup required</h2><p className="text-muted-foreground mx-auto mt-2 max-w-xl text-sm">Run <code>api/db/migrations/2026_dashboard.sql</code> in the Supabase SQL editor. It creates the technician directory and booking assignment fields used by this workspace.</p></PanelBody></Panel>;
}

function SlaPanel({ rows, mutation }) {
  return <Panel><PanelHeader><div><PanelTitle>SLA policy matrix</PanelTitle><p className="text-muted-foreground text-xs">Warning and breach thresholds in minutes</p></div></PanelHeader><PanelBody scroll={false} className="divide-y">{rows.map((row) => <EditableSetting key={row.id} title={`${titleCase(row.entity_type)} · ${titleCase(row.priority)}`} detail="Operational response clock" fields={[['warning_minutes', 'Warn after'], ['breach_minutes', 'Breach after']]} row={row} suffix="min" onSave={(patch) => mutation.mutate({ kind: 'sla', id: row.id, patch })} pending={mutation.isPending} />)}</PanelBody></Panel>;
}

function TargetsPanel({ rows, mutation }) {
  return <Panel><PanelHeader><div><PanelTitle>Operational targets</PanelTitle><p className="text-muted-foreground text-xs">Business goals used by the management dashboard</p></div></PanelHeader><PanelBody scroll={false} className="divide-y">{rows.map((row) => <EditableSetting key={row.id} title={row.label} detail={`${titleCase(row.period)} target`} fields={[["target_value", "Target"]]} row={row} suffix={row.unit} onSave={(patch) => mutation.mutate({ kind: 'target', id: row.id, patch })} pending={mutation.isPending} />)}</PanelBody></Panel>;
}

function EditableSetting({ title, detail, fields, row, suffix, onSave, pending }) {
  const [draft, setDraft] = useState(() => Object.fromEntries(fields.map(([key]) => [key, row[key]])));
  return <div className="grid items-center gap-3 p-4 md:grid-cols-[1fr_auto_auto]"><div><div className="text-sm font-semibold">{title}</div><div className="text-muted-foreground text-xs">{detail}</div></div><div className="flex flex-wrap gap-2">{fields.map(([key, label]) => <Label key={key} className="flex items-center gap-2 text-xs">{label}<Input className="w-24" type="number" min="0" value={draft[key]} onChange={(event) => setDraft({ ...draft, [key]: Number(event.target.value) })} /><span className="text-muted-foreground">{suffix}</span></Label>)}</div><Button size="sm" variant="outline" disabled={pending} onClick={() => onSave(draft)}>Save</Button></div>;
}

function AutomationPanel({ rows, mutation }) {
  return <Panel><PanelHeader><div><PanelTitle>Automation controls</PanelTitle><p className="text-muted-foreground text-xs">Rules that protect operational follow-through</p></div></PanelHeader><PanelBody scroll={false} className="grid gap-3 p-4 md:grid-cols-2">{rows.map((row) => <div key={row.id} className="automation-card flex gap-4 rounded-2xl border p-4"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><Bot className="size-4" /></span><div className="min-w-0 flex-1"><div className="font-semibold">{row.label}</div><p className="text-muted-foreground mt-1 text-xs">{row.description}</p></div><Switch checked={row.enabled} onCheckedChange={(enabled) => mutation.mutate({ kind: 'automation', id: row.id, patch: { enabled } })} aria-label={`Toggle ${row.label}`} /></div>)}</PanelBody></Panel>;
}

function SegmentsPanel({ rows }) {
  const segments = ['VIP', 'Recurring', 'At risk', 'Inactive', 'New'];
  const columns = [
    { key: 'name', header: 'Customer', cell: (row) => <div><strong>{row.name || 'Unnamed customer'}</strong><div className="text-muted-foreground text-xs">{row.phone || 'No phone'}</div></div> },
    { key: 'segments', header: 'Segments', cell: (row) => <div className="flex flex-wrap gap-1">{row.segments.length ? row.segments.map((item) => <Badge key={item} variant={item === 'At risk' ? 'warning' : item === 'VIP' ? 'accent' : 'info'}>{item}</Badge>) : <Badge variant="neutral">Unclassified</Badge>}</div> },
    { key: 'completedCount', header: 'Completed', cell: (row) => row.completedCount },
    { key: 'lifetimeValue', header: 'Lifetime value', cell: (row) => formatCurrency(row.lifetimeValue) },
    { key: 'lastActivity', header: 'Last activity', cell: (row) => formatDate(row.lastActivity) },
  ];
  return <div className="space-y-4"><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{segments.map((segment) => <Panel key={segment}><PanelBody scroll={false} className="p-4"><span className="text-muted-foreground text-xs">{segment}</span><div className="tabular mt-1 text-2xl font-semibold">{rows.filter((row) => row.segments.includes(segment)).length}</div></PanelBody></Panel>)}</div><Panel><PanelHeader><div><PanelTitle>Live customer segments</PanelTitle><p className="text-muted-foreground text-xs">Derived from booking value, frequency, recency and open complaints</p></div></PanelHeader><PanelBody scroll={false}><DataTable columns={columns} rows={rows} pageSize={15} emptyTitle="No customers to segment" /></PanelBody></Panel></div>;
}

function QualityPanel({ issues, onOpen }) {
  const grouped = useMemo(() => Object.entries(issues.reduce((result, issue) => {
    (result[issue.type] ??= []).push(issue);
    return result;
  }, {})), [issues]);
  return <div className="grid gap-4 xl:grid-cols-[.75fr_1.25fr]"><Panel><PanelHeader><PanelTitle>Quality score</PanelTitle></PanelHeader><PanelBody scroll={false} className="p-6 text-center"><div className="quality-orb mx-auto grid size-32 place-items-center rounded-full"><div><strong className="tabular text-4xl">{Math.max(0, 100 - Math.min(100, issues.length * 3))}</strong><span className="text-muted-foreground block text-xs">out of 100</span></div></div><p className="text-muted-foreground mt-5 text-sm">{issues.length ? `${issues.length} actionable data gaps detected.` : 'Core CRM records pass all current checks.'}</p><div className="mt-5 grid grid-cols-2 gap-2">{grouped.map(([type, rows]) => <div key={type} className="rounded-xl border p-3"><strong className="tabular text-xl">{rows.length}</strong><span className="text-muted-foreground block text-xs capitalize">{type} issues</span></div>)}</div></PanelBody></Panel><Panel><PanelHeader><div><PanelTitle>Repair queue</PanelTitle><p className="text-muted-foreground text-xs">Open the source module and correct the record</p></div></PanelHeader><PanelBody className="max-h-[34rem] divide-y">{issues.length ? issues.map((issue, index) => <div key={`${issue.type}-${issue.id}-${index}`} className="flex items-center gap-3 p-4"><span className="grid size-9 place-items-center rounded-xl bg-warning/12 text-warning"><Wrench className="size-4" /></span><div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold">{issue.label}</div><div className="text-muted-foreground text-xs">{issue.issue}</div></div><Button size="sm" variant="outline" onClick={() => onOpen(issue.module)}>Open</Button></div>) : <div className="p-12 text-center"><CheckCircle2 className="mx-auto size-10 text-success" /><h3 className="mt-3 font-semibold">Everything looks healthy</h3></div>}</PanelBody></Panel></div>;
}

function ServiceEditor({ row, mutation, onClose }) {
  const [form, setForm] = useState({ name: row?.name || '', category: row?.category || '', description: row?.description || '', base_price: row?.base_price ?? '', duration_minutes: row?.duration_minutes ?? '' });
  const save = () => mutation.mutate({ id: row?.id, patch: { ...form, base_price: form.base_price === '' ? null : Number(form.base_price), duration_minutes: form.duration_minutes === '' ? null : Number(form.duration_minutes), active: row?.active ?? true } });
  return <EditorDialog title={row ? 'Edit service' : 'Add service'} description="Manage how this service appears and is scheduled." error={mutation.error} pending={mutation.isPending} onClose={onClose} onSave={save}><Field label="Service name"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field><Field label="Category"><Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} /></Field><div className="grid grid-cols-2 gap-3"><Field label="Base price (AED)"><Input type="number" value={form.base_price} onChange={(e) => setForm({ ...form, base_price: e.target.value })} /></Field><Field label="Duration (minutes)"><Input type="number" value={form.duration_minutes} onChange={(e) => setForm({ ...form, duration_minutes: e.target.value })} /></Field></div><Field label="Description"><textarea className="bg-background min-h-24 w-full rounded-md border px-3 py-2 text-sm" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field></EditorDialog>;
}

function TechnicianEditor({ row, mutation, onClose }) {
  const [form, setForm] = useState({ name: row?.name || '', phone: row?.phone || '', email: row?.email || '', shift_start_minute: row?.shift_start_minute ?? 480, shift_end_minute: row?.shift_end_minute ?? 1020, weekly_capacity_minutes: row?.weekly_capacity_minutes ?? 2400 });
  const save = () => mutation.mutate({ id: row?.id, patch: { ...form, phone: form.phone || null, email: form.email || null, shift_start_minute: Number(form.shift_start_minute), shift_end_minute: Number(form.shift_end_minute), weekly_capacity_minutes: Number(form.weekly_capacity_minutes), active: row?.active ?? true } });
  return <EditorDialog title={row ? 'Edit technician' : 'Add technician'} description="Maintain field identity and available capacity." error={mutation.error} pending={mutation.isPending} onClose={onClose} onSave={save}><Field label="Name"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field><div className="grid grid-cols-2 gap-3"><Field label="Phone"><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field><Field label="Email"><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field></div><div className="grid grid-cols-3 gap-3"><Field label="Shift start"><Input type="number" value={form.shift_start_minute} onChange={(e) => setForm({ ...form, shift_start_minute: e.target.value })} /></Field><Field label="Shift end"><Input type="number" value={form.shift_end_minute} onChange={(e) => setForm({ ...form, shift_end_minute: e.target.value })} /></Field><Field label="Weekly minutes"><Input type="number" value={form.weekly_capacity_minutes} onChange={(e) => setForm({ ...form, weekly_capacity_minutes: e.target.value })} /></Field></div></EditorDialog>;
}

function EditorDialog({ title, description, error, pending, onClose, onSave, children }) {
  return <Dialog open onOpenChange={(open) => !open && onClose()}><DialogContent className="max-w-xl"><DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader><div className="space-y-4 py-2">{children}{error ? <p className="text-xs text-destructive">{error.message}</p> : null}</div><DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={pending} onClick={onSave}>{pending ? 'Saving…' : 'Save changes'}</Button></DialogFooter></DialogContent></Dialog>;
}

function Field({ label, children }) { return <Label className="space-y-1.5 text-xs"><span>{label}</span>{children}</Label>; }
function minutes(value) { const total = Number(value ?? 0); return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`; }
function titleCase(value) { return String(value || '').replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()); }

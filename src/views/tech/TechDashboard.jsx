import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, Camera, CheckCircle2, Clock3, MapPin, Navigation, Phone, Play, RotateCcw, Signature, UserRound, Wrench } from 'lucide-react';
import { useModule } from '@/hooks/useModule';
import { useLiveUpdates } from '@/hooks/useRealtime';
import { addJobSignature, listJobPhotos, listJobSignatures, listTechnicianJobs, listTechnicians, updateJobStatus } from '@/lib/api/technicians';
import { photoUrl, uploadJobPhoto } from '@/lib/api/storage';
import { formatDate, formatDateTime, formatPhone, localDateKey } from '@/lib/utils';
import { jobStatus } from '@/lib/status';
import { ViewShell } from '@/components/layout/ViewShell';
import { Panel, PanelBody, PanelHeader, PanelTitle } from '@/components/layout/Panel';
import { KpiCard, KpiGrid } from '@/components/data/KpiCard';
import { EmptyState, ErrorState, PanelSkeleton } from '@/components/data/EmptyState';
import { StatusBadge, Tag } from '@/components/data/StatusBadge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export function TechDashboard() {
  const { active } = useModule('jobs');
  const [selectedTechnician, setSelectedTechnician] = useState('');
  const [selectedJob, setSelectedJob] = useState(null);

  useLiveUpdates(['bookings', 'job_photos', 'job_signatures']);

  const technicians = useQuery({ queryKey: ['technicians', 'field-console'], queryFn: () => listTechnicians() });
  const technicianId = selectedTechnician || technicians.data?.[0]?.id || '';
  const technician = technicians.data?.find((item) => item.id === technicianId);
  const range = active === 'schedule' ? { start: dateKey(0), end: dateKey(6) } : { start: dateKey(0), end: dateKey(0) };
  const jobs = useQuery({
    queryKey: ['jobs', 'technician', technicianId, range.start, range.end],
    queryFn: () => listTechnicianJobs({ technicianId, start: range.start, end: range.end }),
    enabled: Boolean(technicianId) && active !== 'profile',
  });

  const technicianPicker = (
    <label className="flex items-center gap-2">
      <span className="text-muted-foreground hidden text-xs sm:inline">Technician</span>
      <select value={technicianId} onChange={(event) => setSelectedTechnician(event.target.value)} className="bg-card h-9 rounded-xl border px-3 text-sm shadow-sm" aria-label="Preview technician">
        {(technicians.data ?? []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select>
    </label>
  );

  if (technicians.isError) return <ViewShell title="Field operations"><ErrorState error={technicians.error} onRetry={technicians.refetch} /></ViewShell>;
  if (active === 'profile') return <TechnicianProfile technician={technician} action={technicianPicker} />;

  const rows = jobs.data ?? [];
  const completed = rows.filter((job) => job.status === 'completed').length;
  const activeJobs = rows.filter((job) => job.status === 'in_progress').length;

  return (
    <ViewShell title={active === 'schedule' ? 'Seven-day schedule' : "Today's field plan"} description={technician ? `${technician.name} · ${formatPhone(technician.phone)}` : 'Choose a technician to load assigned work'} actions={technicianPicker}>
      <KpiGrid cols={3}>
        <KpiCard label="Assigned" value={rows.length} icon={Wrench} tone="primary" hint={active === 'schedule' ? 'Next seven days' : 'Scheduled today'} />
        <KpiCard label="In progress" value={activeJobs} icon={Play} tone="accent" hint="Jobs currently underway" />
        <KpiCard label="Completed" value={completed} icon={CheckCircle2} tone="success" hint="Finished in this view" />
      </KpiGrid>
      <Panel className="overflow-hidden">
        <PanelHeader><PanelTitle>{active === 'schedule' ? 'Upcoming assignments' : 'Route for today'}</PanelTitle><span className="text-muted-foreground ml-auto text-xs">{rows.length} jobs</span></PanelHeader>
        <PanelBody className="p-3 md:p-4" scroll={false}>
          {jobs.isLoading ? <PanelSkeleton rows={6} /> : jobs.isError ? <ErrorState error={jobs.error} onRetry={jobs.refetch} compact /> : rows.length === 0 ? <EmptyState icon={CalendarDays} title="No jobs assigned" description="Assigned bookings in this date range will appear here." compact /> : (
            <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">{rows.map((job, index) => <JobCard key={job.id} job={job} sequence={index + 1} onOpen={() => setSelectedJob(job)} />)}</div>
          )}
        </PanelBody>
      </Panel>
      <JobDialog job={selectedJob} technicianId={technicianId} onOpenChange={(open) => !open && setSelectedJob(null)} />
    </ViewShell>
  );
}

function JobCard({ job, sequence, onOpen }) {
  const meta = jobStatus(job.status);
  const address = formatAddress(job.property);
  return (
    <button type="button" onClick={onOpen} className="group bg-background/60 hover:border-primary/35 hover:bg-card relative overflow-hidden rounded-2xl border p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-lg">
      <div className="flex items-start gap-3">
        <div className="bg-primary/12 text-primary tabular flex size-9 shrink-0 items-center justify-center rounded-xl text-sm font-bold">{sequence}</div>
        <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className="tabular text-muted-foreground truncate text-[11px]">{job.reference}</span><StatusBadge tone={meta.tone} className="ml-auto">{meta.label}</StatusBadge></div><h3 className="mt-1 truncate font-semibold">{job.service?.name ?? 'Service visit'}</h3><p className="text-muted-foreground mt-1 truncate text-sm">{job.customer?.name ?? formatPhone(job.customer?.phone)}</p></div>
      </div>
      <div className="text-muted-foreground mt-4 grid gap-2 text-xs"><span className="flex items-center gap-2"><Clock3 className="size-3.5" />{job.scheduled_time?.slice(0, 5) ?? 'Time not set'} · {formatDate(job.scheduled_date)}</span><span className="flex items-center gap-2"><MapPin className="size-3.5" /><span className="truncate">{address}</span></span></div>
      <div className="text-primary mt-4 text-xs font-semibold">Open job →</div>
    </button>
  );
}

function JobDialog({ job, technicianId, onOpenChange }) {
  const queryClient = useQueryClient();
  const [feedback, setFeedback] = useState('');
  const [signerName, setSignerName] = useState('');
  const photos = useQuery({ queryKey: ['jobs', 'photos', job?.id], queryFn: () => listJobPhotos(job.id), enabled: Boolean(job) });
  const signatures = useQuery({ queryKey: ['jobs', 'signatures', job?.id], queryFn: () => listJobSignatures(job.id), enabled: Boolean(job) });
  const refreshJob = () => { queryClient.invalidateQueries({ queryKey: ['jobs'] }); queryClient.invalidateQueries({ queryKey: ['bookings'] }); };
  const statusMutation = useMutation({ mutationFn: (status) => updateJobStatus(job.id, status), onSuccess: (_, status) => { setFeedback(status === 'completed' ? 'Job completed.' : 'Job started.'); refreshJob(); }, onError: (error) => setFeedback(error.message) });
  const photoMutation = useMutation({ mutationFn: (file) => uploadJobPhoto({ bookingId: job.id, technicianId, file }), onSuccess: () => { setFeedback('Photo uploaded.'); queryClient.invalidateQueries({ queryKey: ['jobs', 'photos', job.id] }); }, onError: (error) => setFeedback(error.message) });
  const signatureMutation = useMutation({ mutationFn: (signatureData) => addJobSignature({ bookingId: job.id, technicianId, signerName, signatureData }), onSuccess: () => { setFeedback('Signature saved.'); queryClient.invalidateQueries({ queryKey: ['jobs', 'signatures', job.id] }); }, onError: (error) => setFeedback(error.message) });

  if (!job) return null;
  const meta = jobStatus(job.status);
  const address = formatAddress(job.property);
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] max-w-3xl overflow-y-auto p-0">
        <div className="from-primary/16 via-accent/8 to-card border-b bg-gradient-to-br p-6"><DialogHeader><div className="flex items-center gap-2"><Tag>{job.reference}</Tag><StatusBadge tone={meta.tone}>{meta.label}</StatusBadge></div><DialogTitle className="pt-2 text-xl">{job.service?.name ?? 'Service visit'}</DialogTitle><DialogDescription>{formatDate(job.scheduled_date)} at {job.scheduled_time?.slice(0, 5) ?? 'time not set'}</DialogDescription></DialogHeader></div>
        <div className="grid gap-5 p-6 lg:grid-cols-[1fr_.9fr]">
          <div className="space-y-4">
            <section className="bg-muted/45 space-y-3 rounded-2xl p-4"><h3 className="text-sm font-semibold">Visit details</h3><p className="flex items-start gap-2 text-sm"><UserRound className="text-muted-foreground mt-0.5 size-4" />{job.customer?.name ?? 'Customer'} · {formatPhone(job.customer?.phone)}</p><p className="flex items-start gap-2 text-sm"><MapPin className="text-muted-foreground mt-0.5 size-4" />{address}</p>{job.notes || job.agent_notes ? <p className="border-border border-t pt-3 text-sm whitespace-pre-wrap">{job.agent_notes ?? job.notes}</p> : null}<div className="flex flex-wrap gap-2 pt-1">{job.customer?.phone ? <Button asChild size="sm" variant="outline"><a href={`tel:${job.customer.phone}`}><Phone className="size-4" />Call</a></Button> : null}{address !== 'Address not provided' ? <Button asChild size="sm" variant="outline"><a target="_blank" rel="noreferrer" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`}><Navigation className="size-4" />Navigate</a></Button> : null}</div></section>
            <section className="space-y-3"><div className="flex items-center justify-between"><h3 className="text-sm font-semibold">Job evidence</h3><span className="text-muted-foreground text-xs">{photos.data?.length ?? 0} photos</span></div><div className="grid grid-cols-3 gap-2">{(photos.data ?? []).map((photo) => <img key={photo.id} src={photoUrl(photo.storage_path)} alt={photo.caption || 'Job evidence'} className="aspect-square rounded-xl object-cover" />)}<label className="border-border hover:border-primary/40 hover:bg-primary/5 flex aspect-square cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-dashed text-center"><Camera className="text-primary size-5" /><span className="text-[11px] font-medium">Add photo</span><input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(event) => event.target.files?.[0] && photoMutation.mutate(event.target.files[0])} /></label></div></section>
          </div>
          <div className="space-y-4">
            <section className="space-y-3 rounded-2xl border p-4"><h3 className="flex items-center gap-2 text-sm font-semibold"><Signature className="size-4" />Customer sign-off</h3><div><Label htmlFor="signer-name">Signer name</Label><Input id="signer-name" value={signerName} onChange={(event) => setSignerName(event.target.value)} placeholder="Customer name" className="mt-1" /></div><SignaturePad disabled={!signerName || signatureMutation.isPending} onSave={(data) => signatureMutation.mutate(data)} />{(signatures.data ?? []).length ? <p className="text-success text-xs">Signed {formatDateTime(signatures.data[0].signed_at)}</p> : <p className="text-muted-foreground text-xs">No signature captured yet.</p>}</section>
            <section className="from-muted/70 to-muted/30 rounded-2xl bg-gradient-to-br p-4"><h3 className="text-sm font-semibold">Workflow</h3><p className="text-muted-foreground mt-1 text-xs">Keep the job state accurate for dispatch and the customer.</p><div className="mt-4 grid gap-2">{job.status !== 'in_progress' && job.status !== 'completed' ? <Button onClick={() => statusMutation.mutate('in_progress')} disabled={statusMutation.isPending}><Play className="size-4" />Start job</Button> : null}{job.status !== 'completed' ? <Button variant={job.status === 'in_progress' ? 'default' : 'outline'} onClick={() => statusMutation.mutate('completed')} disabled={statusMutation.isPending}><CheckCircle2 className="size-4" />Mark complete</Button> : null}{job.status === 'completed' ? <div className="text-success flex items-center gap-2 text-sm font-medium"><CheckCircle2 className="size-4" />Completed</div> : null}</div></section>
            {feedback ? <p className="text-muted-foreground text-sm">{feedback}</p> : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SignaturePad({ onSave, disabled }) {
  const canvasRef = useRef(null);
  const drawing = useRef(false);
  const [hasInk, setHasInk] = useState(false);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = canvas.clientWidth * ratio;
    canvas.height = 150 * ratio;
    const context = canvas.getContext('2d');
    context.scale(ratio, ratio);
    context.lineWidth = 2;
    context.lineCap = 'round';
    context.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--foreground');
  }, []);
  const point = (event) => { const rect = canvasRef.current.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top }; };
  const start = (event) => { drawing.current = true; const context = canvasRef.current.getContext('2d'); const next = point(event); context.beginPath(); context.moveTo(next.x, next.y); event.currentTarget.setPointerCapture(event.pointerId); };
  const move = (event) => { if (!drawing.current) return; const next = point(event); const context = canvasRef.current.getContext('2d'); context.lineTo(next.x, next.y); context.stroke(); setHasInk(true); };
  const clear = () => { const canvas = canvasRef.current; canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height); setHasInk(false); };
  return <div className="space-y-2"><canvas ref={canvasRef} className="bg-background h-[150px] w-full touch-none rounded-xl border" onPointerDown={start} onPointerMove={move} onPointerUp={() => { drawing.current = false; }} onPointerCancel={() => { drawing.current = false; }} /><div className="flex gap-2"><Button type="button" size="sm" variant="outline" onClick={clear}><RotateCcw className="size-3.5" />Clear</Button><Button type="button" size="sm" disabled={disabled || !hasInk} onClick={() => onSave(canvasRef.current.toDataURL('image/png'))}>Save signature</Button></div></div>;
}

function TechnicianProfile({ technician, action }) {
  if (!technician) return <ViewShell title="Technician profile" actions={action}><EmptyState title="No technicians available" compact /></ViewShell>;
  return <ViewShell title="Technician profile" description="Field identity and working capacity" actions={action}><Panel className="mx-auto w-full max-w-2xl overflow-hidden"><div className="from-primary/18 via-accent/8 to-card bg-gradient-to-br p-6"><div className="bg-primary text-primary-foreground flex size-14 items-center justify-center rounded-2xl text-xl font-bold shadow-lg">{technician.name?.slice(0, 1)}</div><h2 className="mt-4 text-xl font-semibold">{technician.name}</h2><p className="text-muted-foreground text-sm">{formatPhone(technician.phone)}</p></div><PanelBody className="grid gap-4 p-6 sm:grid-cols-2" scroll={false}><ProfileField label="Email" value={technician.email ?? 'Not provided'} /><ProfileField label="Status" value={technician.active === false ? 'Inactive' : 'Active'} /><ProfileField label="Shift" value={`${minutesToTime(technician.shift_start_minute)}–${minutesToTime(technician.shift_end_minute)}`} /><ProfileField label="Weekly capacity" value={`${Math.round((technician.weekly_capacity_minutes ?? 2400) / 60)} hours`} /></PanelBody></Panel></ViewShell>;
}

function ProfileField({ label, value }) { return <div className="bg-muted/45 rounded-xl p-3"><div className="text-muted-foreground text-xs">{label}</div><div className="mt-1 text-sm font-medium">{value}</div></div>; }
function formatAddress(property) { return property ? [property.label, property.address_line, property.area, property.city].filter(Boolean).join(', ') : 'Address not provided'; }
function dateKey(offset) { return localDateKey(new Date(), offset); }
function minutesToTime(value) { const minutes = Number(value); return Number.isFinite(minutes) ? `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}` : '—'; }

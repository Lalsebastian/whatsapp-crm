import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bot, CalendarCheck, CircleAlert, Headphones, KeyRound, MessageCircle,
  Mic, RefreshCw, Sparkles, Star, TrendingDown, UsersRound, WandSparkles,
} from 'lucide-react';
import { ViewShell, ChartPanel } from '@/components/layout/ViewShell';
import { KpiCard, KpiGrid } from '@/components/data/KpiCard';
import { EmptyState, ErrorState, PanelSkeleton } from '@/components/data/EmptyState';
import { RangePicker } from '@/components/data/FilterBar';
import { Panel, PanelBody, PanelHeader, PanelTitle } from '@/components/layout/Panel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import {
  BreakdownDonut, ComparisonTrendChart, ConversationTrendChart,
} from '@/components/charts/LazyCharts';
import {
  clearChatbotAnalyticsAccessKey,
  fetchChatbotAnalytics,
  getChatbotAnalyticsAccessKey,
  setChatbotAnalyticsAccessKey,
} from '@/lib/api/chatbotAnalytics';
import {
  analyticsContentState, CHATBOT_ANALYTICS_RANGES, formatLatency, humaniseAnalyticsLabel,
} from '@/lib/chatbot-analytics';
import { formatNumber, formatPercent } from '@/lib/utils';

export function ChatbotAnalytics() {
  const queryClient = useQueryClient();
  const [range, setRange] = useState('7d');
  const [accessKey, setAccessKey] = useState(() => getChatbotAnalyticsAccessKey());
  const [draftKey, setDraftKey] = useState('');
  const analytics = useQuery({
    queryKey: ['chatbot-analytics', range],
    queryFn: () => fetchChatbotAnalytics({ range, accessKey }),
    enabled: Boolean(accessKey),
    staleTime: 60_000,
    refetchInterval: false,
  });
  const state = analyticsContentState({
    data: analytics.data,
    isLoading: analytics.isLoading,
    error: analytics.error,
    hasCredential: Boolean(accessKey),
  });

  function unlock(event) {
    event.preventDefault();
    const next = draftKey.trim();
    if (!next) return;
    setChatbotAnalyticsAccessKey(next);
    setAccessKey(next);
    setDraftKey('');
  }

  function lock() {
    clearChatbotAnalyticsAccessKey();
    setAccessKey('');
    queryClient.removeQueries({ queryKey: ['chatbot-analytics'] });
  }

  const actions = accessKey ? (
    <>
      <RangePicker value={range} onChange={setRange} ranges={CHATBOT_ANALYTICS_RANGES} />
      <Button variant="outline" size="sm" onClick={() => analytics.refetch()} disabled={analytics.isFetching}>
        <RefreshCw className={analytics.isFetching ? 'animate-spin' : ''} /> Refresh
      </Button>
      <Button variant="ghost" size="sm" onClick={lock}><KeyRound /> Lock</Button>
    </>
  ) : null;

  return (
    <ViewShell
      title="Chatbot Analytics"
      description="Customer journey, automation quality and conversation performance"
      actions={actions}
    >
      {state === 'locked' ? <AnalyticsAccessForm draftKey={draftKey} setDraftKey={setDraftKey} onSubmit={unlock} /> : null}
      {state === 'loading' ? <AnalyticsLoading /> : null}
      {state === 'error' ? (
        <ErrorState
          title="Unable to load chatbot analytics"
          error={analytics.error}
          onRetry={analytics.refetch}
        />
      ) : null}
      {state === 'empty' ? (
        <EmptyState
          icon={Bot}
          title="No chatbot activity in this period"
          description="Choose a wider date range or refresh after new conversations are recorded."
        />
      ) : null}
      {state === 'ready' ? <AnalyticsContent data={analytics.data} /> : null}
    </ViewShell>
  );
}

function AnalyticsAccessForm({ draftKey, setDraftKey, onSubmit }) {
  return (
    <Panel className="mx-auto w-full max-w-xl">
      <PanelHeader><KeyRound className="size-4 text-primary" /><PanelTitle>Secure analytics access</PanelTitle></PanelHeader>
      <PanelBody scroll={false} className="p-5">
        <p className="text-muted-foreground mb-4 text-sm leading-6">
          Enter the management analytics key. It is kept only in this browser tab’s runtime memory and is never added to the application bundle.
        </p>
        <form onSubmit={onSubmit} className="flex flex-col gap-2 sm:flex-row">
          <Input
            type="password"
            autoComplete="off"
            value={draftKey}
            onChange={(event) => setDraftKey(event.target.value)}
            placeholder="Analytics access key"
            aria-label="Analytics access key"
          />
          <Button type="submit" disabled={!draftKey.trim()}>Open analytics</Button>
        </form>
      </PanelBody>
    </Panel>
  );
}

function AnalyticsLoading() {
  return (
    <>
      <KpiGrid>{Array.from({ length: 6 }, (_, index) => <KpiCard key={index} label="Loading analytics…" value="—" loading />)}</KpiGrid>
      <div className="grid gap-4 lg:grid-cols-2"><PanelSkeleton rows={6} /><PanelSkeleton rows={6} /></div>
    </>
  );
}

function AnalyticsContent({ data }) {
  const { kpis } = data;
  return (
    <>
      {data.warnings?.map((warning) => (
        <div key={warning} className="rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning ring-1 ring-warning/25 ring-inset">{warning}</div>
      ))}

      <Panel className="overflow-hidden border-primary/20 bg-primary/[0.035]">
        <PanelBody scroll={false} className="flex gap-3 p-5">
          <div className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl bg-primary/12 text-primary"><Sparkles className="size-4" /></div>
          <div><div className="text-sm font-semibold">Management summary</div><p className="text-muted-foreground mt-1 text-sm leading-6">{data.summary}</p></div>
        </PanelBody>
      </Panel>

      <KpiGrid>
        <KpiCard label="Conversations" value={formatNumber(kpis.conversations)} icon={MessageCircle} tone="primary" hint="CONVERSATION_STARTED" />
        <KpiCard label="Bookings started" value={formatNumber(kpis.bookingsStarted)} icon={CalendarCheck} tone="info" hint="Booking journeys opened" />
        <KpiCard label="Bookings created" value={formatNumber(kpis.bookingsCreated)} icon={CalendarCheck} tone="success" hint="Successfully created bookings" />
        <KpiCard label="Booking conversion" value={formatPercent(kpis.bookingConversionRate)} icon={WandSparkles} tone="success" hint="Created ÷ started" />
        <KpiCard label="Booking abandonment" value={formatPercent(kpis.bookingAbandonmentRate)} icon={TrendingDown} tone="warning" hint="Expired or explicitly cancelled" />
        <KpiCard label="Complaints created" value={formatNumber(kpis.complaintsCreated)} icon={CircleAlert} tone="warning" hint="Registered by the chatbot" />
        <KpiCard label="Human handoff" value={formatPercent(kpis.handoffRate)} icon={Headphones} tone="accent" hint="Created handoffs ÷ conversations" />
        <KpiCard label="AI fallback" value={formatPercent(kpis.aiFallbackRate)} icon={Bot} tone="warning" hint="Fallbacks ÷ AI requests" />
        <KpiCard label="Voice usage" value={formatPercent(kpis.voiceUsageRate)} icon={Mic} tone="info" hint="Voice notes ÷ conversations" />
        <KpiCard label="Returning customers" value={formatPercent(kpis.returningCustomerRate)} icon={UsersRound} tone="primary" hint="Event-based identification rate" />
        <KpiCard label="Average CSAT" value={kpis.averageCsat == null ? '—' : `${kpis.averageCsat.toFixed(2)} / 5`} icon={Star} tone="success" hint="Average submitted rating" />
        <KpiCard label="Low-rating rate" value={formatPercent(kpis.lowRatingRate)} icon={Star} tone="warning" hint="Ratings of 3 or below" />
      </KpiGrid>

      <div className="grid gap-4 xl:grid-cols-12">
        <ChartPanel title="Conversation trend" description="Conversations started in the selected period" className="xl:col-span-8">
          <ConversationTrendChart data={data.conversationTrend} />
        </ChartPanel>
        <ChartPanel title="New vs returning" description="Event-based identification; not unique customers" className="xl:col-span-4">
          <BreakdownDonut data={[
            { label: 'New', count: data.customerType.new },
            { label: 'Returning', count: data.customerType.returning },
          ]} />
        </ChartPanel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartPanel title="Booking funnel" description="Share remaining from booking start"><FunnelList items={data.funnel} /></ChartPanel>
        <ChartPanel title="Abandonment by last step" description="Session expiry or explicit cancellation"><RankedList items={data.abandonment} showRate /></ChartPanel>
        <ChartPanel title="Most requested services" description="Demand measured at service selection"><RankedList items={data.services} /></ChartPanel>
        <ChartPanel title="Complaint categories" description={`${formatPercent(data.complaints.complaintToBookingRate)} complaint-to-booking ratio`}><BreakdownDonut data={data.complaints.categories.map(readableItem)} /></ChartPanel>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <AnalyticsStatPanel title="Human handoff" rows={[
          ['Requested', data.handoff.requested], ['Created', data.handoff.created], ['Failed', data.handoff.failed], ['Success rate', formatPercent(data.handoff.successRate)],
        ]} footer={<BreakdownGroup title="Top reasons" items={data.handoff.reasons} />} />
        <AnalyticsStatPanel title="Complaint automation" rows={[
          ['Created', data.complaints.created], ['Handoff rate', formatPercent(data.complaints.handoffRate)], ['Media usage', formatPercent(data.complaints.mediaUsageRate)],
        ]} footer={<BreakdownGroup title="Handoff priority" items={data.handoff.priorities} />} />
        <AnalyticsStatPanel title="Voice performance" rows={[
          ['Received', data.voice.received], ['Transcribed', data.voice.transcribed], ['Failed', data.voice.failed], ['Success rate', formatPercent(data.voice.successRate)], ['Average latency', formatLatency(data.voice.averageLatencyMs)],
        ]} footer={<BreakdownGroup title="Detected languages" items={data.voice.languages} />} />
      </div>

      {data.cost ? <CostPanel cost={data.cost} /> : null}

      <div className="grid gap-4 xl:grid-cols-12">
        <ChartPanel title="AI requests and fallback" description="Understanding load and deterministic recovery" className="xl:col-span-8"><ComparisonTrendChart data={data.ai.trend} /></ChartPanel>
        <AnalyticsStatPanel className="xl:col-span-4" title="AI performance" rows={[
          ['Requests', data.ai.requested], ['Resolved', data.ai.resolved], ['Low confidence', data.ai.lowConfidence], ['Fallbacks', data.ai.fallbacks], ['Errors / timeouts', data.ai.errors + data.ai.timeouts], ['Average latency', formatLatency(data.ai.averageLatencyMs)],
        ]} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <ChartPanel title="Language mix" description="Language supplied on conversation-start events"><BreakdownDonut data={data.languages} /></ChartPanel>
        <ChartPanel title="CSAT distribution" description={`${data.csat.responses} rating responses · ${data.csat.reviewOffers} review offers`}><BreakdownDonut data={data.csat.distribution} /></ChartPanel>
        <ChartPanel title="Operational errors" description="Safe categories only; no stack traces"><RankedList items={data.errors} empty="No operational errors in this period." /></ChartPanel>
      </div>

      <ChartPanel title="Latency and delivery performance" description="Percentiles appear when at least five samples are available">
        <LatencyTable latency={data.latency} />
      </ChartPanel>
    </>
  );
}

function formatCost(value, currency) {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  return `${currency} ${Number(value).toFixed(Number(value) < 1 ? 4 : 2)}`;
}

function formatAverage(value) {
  return value == null || !Number.isFinite(Number(value)) ? '—' : Number(value).toFixed(1);
}

// Message and AI cost per completed booking/complaint, from the backend's
// estimates (rates configured in api/config/costs.js).
function CostPanel({ cost }) {
  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <AnalyticsStatPanel title="Cost per booking" rows={[
        ['Bookings measured', cost.bookingsMeasured],
        ['Bot messages per booking', formatAverage(cost.averageBotMessagesPerBooking)],
        ['AI calls per booking', formatAverage(cost.averageAiCallsPerBooking)],
        ['Estimated cost per booking', formatCost(cost.averageCostPerBooking, cost.currency)],
      ]} />
      <AnalyticsStatPanel title="Cost per complaint" rows={[
        ['Complaints measured', cost.complaintsMeasured],
        ['Bot messages per complaint', formatAverage(cost.averageBotMessagesPerComplaint)],
        ['AI calls per complaint', formatAverage(cost.averageAiCallsPerComplaint)],
        ['Estimated cost per complaint', formatCost(cost.averageCostPerComplaint, cost.currency)],
      ]} />
      <AnalyticsStatPanel title="Savings" rows={[
        ['Questions skipped by fast paths', cost.messagesSavedByFastPath],
        ['AI calls avoided', cost.aiCallsAvoided],
        ['AI avoidance rate', formatPercent(cost.aiAvoidanceRate)],
        ['Template messages sent', cost.templateMessages],
        ['Estimated total cost', formatCost(cost.totalEstimatedCost, cost.currency)],
      ]} />
    </div>
  );
}

function readableItem(item) {
  return { ...item, label: humaniseAnalyticsLabel(item.label) };
}

function FunnelList({ items }) {
  return <div className="space-y-4">{items.map((item) => (
    <div key={item.eventType}>
      <div className="mb-1.5 flex items-center justify-between gap-3 text-xs"><span className="font-medium">{item.label}</span><span className="tabular text-muted-foreground">{formatNumber(item.count)} · {formatPercent(item.rate)}</span></div>
      <Progress value={Math.max(0, Math.min(100, item.rate * 100))} />
    </div>
  ))}</div>;
}

function RankedList({ items, showRate = false, empty = 'No data in this period.' }) {
  if (!items?.length) return <div className="text-muted-foreground py-10 text-center text-sm">{empty}</div>;
  const max = Math.max(...items.map((item) => item.count), 1);
  return <div className="space-y-3">{items.map((item) => (
    <div key={item.label}>
      <div className="mb-1 flex items-center justify-between gap-3 text-xs"><span className="truncate font-medium">{humaniseAnalyticsLabel(item.label)}</span><span className="tabular text-muted-foreground">{formatNumber(item.count)}{showRate ? ` · ${formatPercent(item.rate)}` : ''}</span></div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${(item.count / max) * 100}%` }} /></div>
    </div>
  ))}</div>;
}

function AnalyticsStatPanel({ title, rows, footer, className }) {
  return <Panel className={className}><PanelHeader><PanelTitle>{title}</PanelTitle></PanelHeader><PanelBody scroll={false} className="p-4"><div className="divide-y divide-border">{rows.map(([label, value]) => <div key={label} className="flex items-center justify-between gap-3 py-2.5 text-sm"><span className="text-muted-foreground">{label}</span><span className="tabular font-semibold">{typeof value === 'number' ? formatNumber(value) : value}</span></div>)}</div>{footer ? <div className="mt-4 border-t border-border pt-4">{footer}</div> : null}</PanelBody></Panel>;
}

function BreakdownGroup({ title, items }) {
  return <div><div className="mb-2 text-xs font-semibold">{title}</div><div className="flex flex-wrap gap-1.5">{items?.length ? items.slice(0, 5).map((item) => <span key={item.label} className="rounded-full bg-muted px-2 py-1 text-[11px]">{humaniseAnalyticsLabel(item.label)} · {item.count}</span>) : <span className="text-muted-foreground text-xs">No breakdown available.</span>}</div></div>;
}

function LatencyTable({ latency }) {
  const labels = { ai: 'AI', crmRead: 'CRM read', crmWrite: 'CRM write', whatsapp: 'WhatsApp send', voice: 'Voice transcription', route: 'Route completion' };
  return <div className="overflow-x-auto"><table className="w-full min-w-[34rem] text-left text-sm"><thead><tr className="text-muted-foreground border-b border-border text-xs"><th className="pb-2 font-medium">Operation</th><th className="pb-2 text-right font-medium">Samples</th><th className="pb-2 text-right font-medium">Average</th><th className="pb-2 text-right font-medium">p50</th><th className="pb-2 text-right font-medium">p95</th></tr></thead><tbody>{Object.entries(latency).map(([key, metric]) => <tr key={key} className="border-b border-border/60 last:border-0"><td className="py-3 font-medium">{labels[key] || humaniseAnalyticsLabel(key)}</td><td className="tabular py-3 text-right">{metric.samples}</td><td className="tabular py-3 text-right">{formatLatency(metric.averageMs)}</td><td className="tabular py-3 text-right">{formatLatency(metric.p50Ms)}</td><td className="tabular py-3 text-right">{formatLatency(metric.p95Ms)}</td></tr>)}</tbody></table></div>;
}

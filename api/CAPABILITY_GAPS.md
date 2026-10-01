# CRM capability gaps

## Human handoff records

The existing CRM adapter exposes only the current `escalations` fields: customer, phone, reason, conversation summary, and status. It does not provide dedicated columns or endpoints for the structured handoff sections, urgency, media metadata, bot-action history, or recent conversation context.

The chatbot therefore stores the concise staff summary and serialized structured handoff in the existing `conversation_summary` text field. This is additive and requires no database migration, but the individual structured fields cannot be filtered or reported independently until the CRM exposes first-class storage for them.

Recent conversation context is limited to the eight most recent logged messages. Test-console traffic is intentionally not written to message history.

## Customer feedback and completion events

The chatbot reuses the existing `satisfaction_surveys` table rather than creating a second feedback table. Its current columns persist the customer, booking, phone, rating, comment, complaint link, request/send/response timestamps, and creation timestamp.

The current table does not have first-class columns for `source`, `language`, `follow_up_required`, `escalation_id`, or extracted topic tags. The adapter therefore reports `source=whatsapp` in its mapped response, can persist a complaint link, and keeps other recovery metadata in the conversation/audit trail. Reporting or filtering those missing fields requires an additive CRM schema/API update. A unique constraint on `(customer_id, booking_id)` is also recommended as a database-level backstop; the chatbot currently prevents duplicates with an existing-record check, webhook deduplication, and the action idempotency guard.

## Chatbot analytics event storage

The canonical schema has no normalized analytics table. An unrelated, untracked dashboard migration currently proposes a minimal `conversation_events(phone, event, metadata)` table, but it stores a raw phone number and cannot support correlation, funnel dimensions, safe deduplication, or entity-level reporting. The chatbot analytics writer therefore targets `chatbot_analytics_events`. Until the following additive SQL is reviewed and applied, analytics writes fail safely without affecting conversations.

```sql
create table if not exists public.chatbot_analytics_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  occurred_at timestamptz not null default now(),
  correlation_id text,
  message_id text,
  dedupe_key text not null unique,
  session_id text,
  customer_id uuid references public.customers(id) on delete set null,
  phone_hash text,
  flow text,
  step text,
  service_id uuid references public.services(id) on delete set null,
  booking_id uuid references public.bookings(id) on delete set null,
  complaint_id uuid references public.complaints(id) on delete set null,
  feedback_id uuid references public.satisfaction_surveys(id) on delete set null,
  language text,
  source text,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists chatbot_analytics_events_type_time_idx
  on public.chatbot_analytics_events (event_type, occurred_at desc);
create index if not exists chatbot_analytics_events_session_time_idx
  on public.chatbot_analytics_events (session_id, occurred_at desc);
create index if not exists chatbot_analytics_events_customer_time_idx
  on public.chatbot_analytics_events (customer_id, occurred_at desc);
create index if not exists chatbot_analytics_events_phone_time_idx
  on public.chatbot_analytics_events (phone_hash, occurred_at desc)
  where phone_hash is not null;
create index if not exists chatbot_analytics_events_correlation_idx
  on public.chatbot_analytics_events (correlation_id)
  where correlation_id is not null;
create index if not exists chatbot_analytics_events_booking_idx
  on public.chatbot_analytics_events (booking_id) where booking_id is not null;
create index if not exists chatbot_analytics_events_complaint_idx
  on public.chatbot_analytics_events (complaint_id) where complaint_id is not null;

alter table public.chatbot_analytics_events enable row level security;
revoke all on table public.chatbot_analytics_events from anon, authenticated;
grant select, insert, update on table public.chatbot_analytics_events to service_role;
```

No client-facing RLS policy is required: only the server-side service role should access this table. Configure a stable `ANALYTICS_HASH_SALT` secret in the backend environment. A 180-day retention policy is recommended initially; implement deletion through an approved server-side maintenance job after reporting requirements are confirmed. No migration has been applied by this task.

`feedback.onBookingCompleted({ session, customer, booking })` is the prepared integration point for a future CRM event. The event must supply a real booking whose status is `completed`, plus the identified customer/session (including the WhatsApp phone). The chatbot does not poll the CRM and does not infer completion.

# Client CRM capabilities: status

The chatbot talks to the CRM only through the `CrmAdapter` contract
(`api/crm/CrmAdapter.js`). The REST contract the HTTP adapter expects from the
client's CRM is in [`HTTP_CRM_CONTRACT.md`](./HTTP_CRM_CONTRACT.md).

## Implemented

- **Real HTTP adapter** (`httpCrmAdapter.js`, `CRM_PROVIDER=http`): implements
  every contract method against the documented REST contract. Paths and the
  auth header are configurable. The server refuses to start with an invalid
  configuration. **Still needed from the client:** confirmation that their API
  matches the contract, or their real endpoint docs so paths and field mapping
  can be aligned.
- **Atomic multi-service booking:** `createBookings` is one all-or-nothing call
  with an idempotency key. In Supabase mode it is the `chatbot_create_bookings`
  database function, which also locks the slot so two customers cannot book
  the same time. In HTTP mode the CRM's `POST /bookings/batch` must be atomic.
- **Date discovery:** `getAvailabilityRange` lists upcoming dates that have
  open slots (`BOOKING_DATE_WINDOW_DAYS`, default 7). If the CRM cannot answer,
  the flow falls back to asking for a date.
- **Slot metadata:** slots carry id, start/end, ISO instants and timezone.
  Customers see ranges ("9:00 AM – 11:00 AM"), the CRM receives the chosen
  `slotId`, and past slots for today are never offered.
- **Booking lifecycle events:** `POST /api/crm/events` (signed) handles
  technician assigned, on the way, and completed. Completion starts the
  existing feedback flow after re-checking the booking in the CRM.
  Notifications outside the 24-hour window use approved templates. For the
  bundled Supabase dashboard, a Supabase Database Webhook on `bookings` UPDATEs
  drives the same events.
- **Location pins → addresses:** WhatsApp pins are reverse-geocoded (Google or
  Nominatim, off by default). The customer confirms the address and adds
  building/flat details, and coordinates are stored on the property.
- **Durable idempotency and cross-instance coordination:** see below.
- **Complaint updates:** "Add Details" appends text, voice notes and photos to
  an open complaint (`addComplaintDetails`) instead of opening a duplicate.
- **Complaint priority:** set from the severity check; needs the `priority`
  column from section 7 of the reliability migration (falls back without it).
- **Escalation SLA:** `api/escalation/slaMonitor.js` raises overdue handoffs one
  priority level and sends the customer one reassurance (inside the 24-hour
  window only). Bundled Supabase CRM only; with an external CRM its own queue
  owns SLAs.
- **Add-on suggestions:** use only services in the CRM catalogue that the CRM
  says are serviceable at the address; off by default.

## Still required from the client

- **OTP verification:** on hold until the client confirms the requirement
  (WhatsApp sender identity is used for customer lookup today).
- **Technician tracking data:** the bot shows technician names and ETAs only
  when lifecycle events include them. Live location is not supported.
- **Reminders** (e.g. day-before) are not implemented; they would use the same
  template mechanism as lifecycle events once the client defines them.

## Production reliability

- Apply `supabase/migrations/202610040001_chatbot_reliability_lifecycle.sql`
  and set `SUPABASE_SERVICE_ROLE_KEY`. With `COORDINATION_BACKEND=postgres`
  (the production default), these are shared by every instance through
  Postgres:
  - the per-customer conversation lock (a renewable lease row)
  - newest-message ordering
  - durable idempotency claims for bookings, complaints and feedback

  Plain `pg_advisory_lock` is not used because PostgREST runs each call on a
  pooled connection in its own transaction. Without the migration, each
  primitive falls back to process-local behaviour and logs a warning.
- Webhook message-ID deduplication uses `processed_webhook_events` from
  `api/db/schema.sql`.
- A timed-out CRM write is still treated as an uncertain outcome and never
  retried automatically. Staff get a handoff to verify it. With the HTTP
  adapter, the CRM honouring `Idempotency-Key` makes a manual retry safe.
- Circuit breakers stay per instance by design: each instance protects itself
  from a failing provider.

## Voice-note retention and privacy

- Voice bytes are processed in memory only. They are never written to disk or
  copied to Supabase storage.
- Transcripts are redacted before storage, AI processing or staff handoff
  (card numbers with a Luhn check, Emirates ID, UAE IBAN;
  `REDACT_SENSITIVE_DATA`). They can be kept out of the message log entirely
  (`STORE_VOICE_TRANSCRIPTS=false`).
- A daily job (`chatbot_apply_retention`, single-instance through a lease)
  does three things:
  - replaces stored voice transcripts older than `VOICE_TRANSCRIPT_RETENTION_DAYS`
  - deletes voice-note media references older than `VOICE_MEDIA_RETENTION_DAYS`
  - purges bookkeeping rows older than `CHATBOT_STATE_RETENTION_DAYS`
- Not covered: transcript text that a customer's own words placed into a
  complaint description or an escalation summary. Those are business records,
  and their retention follows the CRM's record policy.

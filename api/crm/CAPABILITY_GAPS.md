# Client CRM capabilities still required

The WhatsApp flow uses the existing `CrmAdapter` contract and does not invent
client endpoints. These capabilities need client API documentation before they
can be implemented safely:

- **Atomic multi-service booking:** the current API accepts one service per
  `createBooking` call. The WhatsApp session can collect several services, but
  final persistence is sequential and cannot guarantee an all-or-nothing
  transaction. A bulk endpoint with an idempotency key is recommended.
- **OTP verification:** no send/verify OTP methods or verification requirement
  are present. WhatsApp sender identity is used for customer lookup today.
- **Location/geocoding:** no API converts a WhatsApp latitude/longitude payload
  into a validated service address. Customers must select a saved address or
  type a complete address.
- **Date discovery:** availability currently accepts one service and one date.
  A date-range endpoint is needed to present upcoming dates backed by actual
  booking rules rather than guessed dates.
- **Slot metadata:** availability returns strings only. Structured start/end
  timestamps and timezone data are needed for authoritative range formatting.
- **Technician tracking:** bookings expose status but no technician name,
  assignment, live location, or ETA. Those values must come from CRM and must
  never be inferred by the chatbot.
- **Booking lifecycle webhooks/events:** assignment, on-the-way, completion,
  reminders, and feedback automation need documented CRM events or polling
  endpoints. No scheduler or n8n workflow is added by this enhancement.
- **Real HTTP adapter:** `httpCrmAdapter.js` remains intentionally unimplemented
  until the client supplies endpoint paths, authentication, request schemas,
  response schemas, and error/idempotency behavior.

## Production reliability limitations

- Apply the additive `processed_webhook_events` definition in
  `api/db/schema.sql` before deployment. Until that table exists, webhook
  message-ID deduplication falls back to a single-process, 24-hour memory cache.
- The CRM contract has no idempotency-key field or lookup-by-idempotency-key
  endpoint. Booking and complaint double-submit protection is therefore
  application-level and process-local; it cannot guarantee exactly-once writes
  across multiple instances or a process restart.
- Per-customer processing locks, out-of-order timestamp tracking, and provider
  circuit breakers are process-local. Multi-instance deployment requires a
  distributed lock/order store such as Postgres advisory locks or Redis.
- A timed-out CRM write is treated as an uncertain outcome and is never
  automatically retried. A CRM lookup by idempotency key is required for
  automated reconciliation.

## Voice-note retention and privacy

- Voice bytes are downloaded into memory for transcription and are not written
  to Render's filesystem or duplicated into Supabase storage.
- Complaint records can retain the original WhatsApp media ID as an `audio`
  attachment. Meta download URLs are short-lived, so durable playback for human
  agents requires an approved storage and retention policy that the current CRM
  contract does not provide.
- Transcripts are handled like existing inbound message text and may be stored
  in the message log or complaint description. Production policy should define
  transcript retention, agent access, deletion, and customer privacy handling.

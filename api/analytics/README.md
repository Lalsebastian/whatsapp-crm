# Chatbot analytics events

`logger.audit()` is the single source for operational audit output and durable analytics. It dispatches normalized events to `eventWriter.js` without awaiting the write, so analytics cannot delay or break a customer conversation. The writer applies a 1.5-second bound, upserts by `dedupe_key`, hashes phone identities, and removes transcript/address/comment/prompt fields from metadata.

The event table is intentionally append-oriented. CRM entities remain the source of truth; analytics stores identifiers, funnel stages, timings, categories, and flags rather than customer records or conversation history.

## Reporting definitions

- Booking funnel: distinct sessions reaching `BOOKING_STARTED`, `SERVICE_SELECTED`, `DATE_SELECTED`, and `BOOKING_CREATED` in order.
- Booking conversion: distinct sessions with `BOOKING_CREATED` / distinct sessions with `BOOKING_STARTED`.
- Booking abandonment: distinct sessions with `BOOKING_ABANDONED` / distinct sessions with `BOOKING_STARTED`. Abandonment is emitted only for explicit cancellation/reset or session expiry.
- Complaint automation: complaints with `COMPLAINT_CREATED` and no later `HUMAN_TAKEOVER_STARTED` for the complaint/session.
- Handoff rate: distinct sessions with `HANDOFF_CREATED` / distinct sessions with `CONVERSATION_STARTED`.
- AI fallback rate: `AI_FALLBACK_USED` / `AI_INTENT_REQUESTED`, optionally grouped by `metadata.taskType`.
- Voice usage: distinct sessions with `VOICE_RECEIVED` / distinct sessions with `CONVERSATION_STARTED`.
- Returning-customer rate: `RETURNING_CUSTOMER_IDENTIFIED` / `CUSTOMER_IDENTIFIED`.
- Average CSAT: average numeric `metadata.rating` for `FEEDBACK_RATING_RECEIVED`.
- Low-rating rate: ratings at or below 3 / all `FEEDBACK_RATING_RECEIVED` events.
- Latency percentiles: calculate p50/p95/p99 over `metadata.latencyMs`, grouped by `ROUTE_COMPLETED`, AI, CRM, WhatsApp, and voice events.

Use distinct `session_id`, `booking_id`, `complaint_id`, or `feedback_id` as the reporting grain instead of raw row counts. This protects metrics from retries and repeated interactions.

## Current observability boundary

`FEEDBACK_REVIEW_OFFERED` is observable. `FEEDBACK_REVIEW_CLICKED` is not currently observable because WhatsApp receives a plain external URL and no Joboy redirect endpoint records the click. Do not infer clicks from offers.

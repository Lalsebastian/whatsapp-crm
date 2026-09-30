# CRM capability gaps

## Human handoff records

The existing CRM adapter exposes only the current `escalations` fields: customer, phone, reason, conversation summary, and status. It does not provide dedicated columns or endpoints for the structured handoff sections, urgency, media metadata, bot-action history, or recent conversation context.

The chatbot therefore stores the concise staff summary and serialized structured handoff in the existing `conversation_summary` text field. This is additive and requires no database migration, but the individual structured fields cannot be filtered or reported independently until the CRM exposes first-class storage for them.

Recent conversation context is limited to the eight most recent logged messages. Test-console traffic is intentionally not written to message history.

## Customer feedback and completion events

The chatbot reuses the existing `satisfaction_surveys` table rather than creating a second feedback table. Its current columns persist the customer, booking, phone, rating, comment, complaint link, request/send/response timestamps, and creation timestamp.

The current table does not have first-class columns for `source`, `language`, `follow_up_required`, `escalation_id`, or extracted topic tags. The adapter therefore reports `source=whatsapp` in its mapped response, can persist a complaint link, and keeps other recovery metadata in the conversation/audit trail. Reporting or filtering those missing fields requires an additive CRM schema/API update. A unique constraint on `(customer_id, booking_id)` is also recommended as a database-level backstop; the chatbot currently prevents duplicates with an existing-record check, webhook deduplication, and the action idempotency guard.

`feedback.onBookingCompleted({ session, customer, booking })` is the prepared integration point for a future CRM event. The event must supply a real booking whose status is `completed`, plus the identified customer/session (including the WhatsApp phone). The chatbot does not poll the CRM and does not infer completion.

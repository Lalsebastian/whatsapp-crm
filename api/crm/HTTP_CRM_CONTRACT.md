# Client CRM integration contract

This is the API the WhatsApp chatbot calls when `CRM_PROVIDER=http`
(`api/crm/httpCrmAdapter.js`), plus the webhook the CRM calls back with
booking lifecycle events. If the client's existing API differs, most
differences are configuration (paths, auth header). Different request or
response shapes need a small change in `httpCrmAdapter.js`.

## Conventions

| Item | Rule |
|---|---|
| Base URL | `CLIENT_API_BASE_URL`, HTTPS only (plain HTTP is accepted for `localhost` only) |
| Auth | `CLIENT_API_KEY` sent as `Authorization: Bearer <key>`. Set `CLIENT_API_AUTH_HEADER=x-api-key` (or any header name) to send the raw key in that header instead |
| Paths | Defaults below. Override any of them with `CLIENT_API_ENDPOINTS`, a JSON object of method → path, e.g. `{"createBookings": "/v2/bookings/bulk"}`. `{name}` placeholders are URL-encoded |
| Bodies | JSON. Responses may be the bare value or wrapped as `{ "data": ... }`. Field names may be camelCase or snake_case |
| Timeout | `CRM_REQUEST_TIMEOUT_MS` (default 10 s). Reads are retried on timeout, 408, 429 and 5xx. **Writes are never retried automatically** |
| Idempotency | Writes that create something send an `Idempotency-Key` header. Repeating a request with the same key must return the original result and not create a duplicate |
| Dates and times | `date` is `YYYY-MM-DD`; `time` is `HH:MM`, both in the business timezone (`BUSINESS_TIMEZONE`, default `Asia/Dubai`) |

### Status codes the bot relies on

| Response | Meaning to the bot |
|---|---|
| `2xx` | Success |
| `404` on a single-resource `GET` | "Does not exist" (the bot returns `null`, not an error) |
| `409` on booking create/reschedule | The slot is no longer available. The customer is asked to pick another time; nothing was created |
| Other `4xx` | Request rejected, nothing written. Include `{ "code": "...", "message": "..." }` (or `{ "error": { "code", "message" } }`); the code is logged |
| `5xx`, timeout | Unknown outcome. Writes are treated as **uncertain**: staff get a handoff to check the CRM, and the bot never retries on its own |

## Endpoints

### Customers

| Method | Default path | Request | Response |
|---|---|---|---|
| `findCustomerByPhone` | `GET /customers?phone={phone}` | phone in WhatsApp international format without `+`, e.g. `971501234567` | Array of customers (empty if none) |
| `createCustomer` | `POST /customers` | `{ "phone": "...", "source": "whatsapp" }` | The created customer. `409` if it already exists (the bot then re-reads it) |
| `getCustomerById` | `GET /customers/{customerId}` | | Customer, or `404` |
| `getCustomerPreferences` | `GET /customers/{customerId}/preferences` | | `{ "preferredLanguage": "en", "defaultPropertyId": "..." }`, or `404` |
| `updateCustomerPreferences` | `PATCH /customers/{customerId}/preferences` | `{ "preferredLanguage"?: "en|ml|manglish|hi|hinglish", "defaultPropertyId"?: "..." }` | Updated preferences |

Customer: `{ "id", "phone", "name", "preferredLanguage" }`

### Properties (service addresses)

| Method | Default path | Request | Response |
|---|---|---|---|
| `getCustomerProperties` | `GET /customers/{customerId}/properties` | | Array of properties |
| `addProperty` | `POST /customers/{customerId}/properties` | `{ "addressLine", "label"?, "area"?, "city"?, "postalCode"?, "state"?, "latitude"?, "longitude"?, "locationSource"?, "placeId"? }` | The created property |

Property: `{ "id", "customerId", "label", "addressLine", "area", "city", "isDefault", "latitude", "longitude" }`

`latitude`/`longitude` come from a WhatsApp location pin. When geocoding is
enabled, `addressLine` is the customer-confirmed address plus their building
and flat details.

### Services and availability

| Method | Default path | Request | Response |
|---|---|---|---|
| `getServices` | `GET /services?active=true` | | Array of services |
| `getServiceDetails` | `GET /services/{serviceId}` | | Service, or `404` |
| `checkServiceability` | `POST /services/{serviceId}/serviceability` | `{ "location": Location }` | `{ "serviceable": true }` |
| `getAvailability` | `GET /services/{serviceId}/availability?date=YYYY-MM-DD` | | `{ "slots": [Slot] }` |
| `getAvailabilityRange` | `GET /services/{serviceId}/availability?from=YYYY-MM-DD&days=7[&lat=&lng=]` | | `{ "days": [{ "date": "YYYY-MM-DD", "slots": [Slot] }] }` |

Service: `{ "id", "name", "category", "description", "basePrice", "durationMinutes" }`

Location (every field optional; the bot sends what it knows):
`{ "propertyId", "address", "latitude", "longitude", "postalCode", "areaName", "city", "state", "country", "source" }`.
`source` is `whatsapp_location`, `maps_link`, `typed_address` or
`saved_property`. A new address is checked **before** it is saved, so it has
no `propertyId` yet; a saved address is sent by `propertyId`. `postalCode`
comes from Google geocoding of a pin/link, or from a 6-digit PIN code in the
typed text. Answer `{ "serviceable": false }` only when the location is known
to be outside coverage; when the CRM cannot tell (e.g. no PIN code), answer
`true`, as the booking itself is validated again on creation.

Slot: `{ "id", "start": "HH:MM", "end": "HH:MM", "startsAt"?: ISO-8601, "endsAt"?: ISO-8601, "timezone"?: "Asia/Dubai", "label"? }`.
A plain `"HH:MM"` string is also accepted. Only return slots that can still
be booked: no past times, no full slots. The bot lists only the dates that
have at least one slot, so a range response is what customers choose from.

### Bookings

| Method | Default path | Request | Response |
|---|---|---|---|
| `createBooking` | `POST /bookings` + `Idempotency-Key` | `{ "customerId", "propertyId", "serviceId", "date", "time", "slotId"?, "notes"? }` | The created booking. `409` if the slot is taken |
| `createBookings` | `POST /bookings/batch` + `Idempotency-Key` | `{ "customerId", "items": [{ "propertyId", "serviceId", "date", "time", "slotId"?, "notes"? }] }` | `{ "bookings": [Booking] }` in the same order as `items` |
| `getBookings` | `GET /customers/{customerId}/bookings?limit=10` | | Array, newest first |
| `getBookingStatus` | `GET /bookings?reference={reference}` | | Array (first match is used) |
| `getBookingById` | `GET /bookings/{bookingId}` | | Booking, or `404` |
| `rescheduleBooking` | `POST /bookings/{bookingId}/reschedule` | `{ "date", "time" }` | Updated booking. `409` if the slot is taken |
| `cancelBooking` | `POST /bookings/{bookingId}/cancel` | `{}` | Updated booking |

**`createBookings` must be all-or-nothing.** When a customer books several
services in one conversation, the bot sends one request. Either every item is
booked, or none is and an error is returned. Returning fewer bookings than
items is treated as an uncertain outcome and escalated to staff.

Booking: `{ "id", "reference", "customerId", "propertyId", "serviceId", "scheduledDate", "scheduledTime", "status", "price", "notes" }`

Statuses the bot understands: `pending`, `confirmed`, `in_progress`,
`completed`, `cancelled`, `rescheduled` (plus `technician_assigned` and
`technician_on_the_way` for display).

### Complaints, feedback and escalations

| Method | Default path | Request | Response |
|---|---|---|---|
| `createComplaint` | `POST /complaints` | `{ "customerId", "bookingId"?, "category", "description"?, "priority"?: "normal" \| "high" \| "urgent", "attachments"?: [{ "waMediaId", "mediaType" }] }` | Complaint |
| `addComplaintDetails` | `POST /complaints/{complaintId}/updates` + `Idempotency-Key` | `{ "customerId", "text"?, "attachments"?: [{ "waMediaId", "mediaType" }] }` | Complaint. `404` if the complaint is not this customer's |
| `getComplaintStatus` | `GET /complaints?reference={reference}` | | Array |
| `getOpenComplaintForBooking` | `GET /complaints?customerId=&bookingId=&status=open,in_progress,escalated&limit=1` | | Array |
| `getActiveComplaints` | `GET /customers/{customerId}/complaints?status=open,in_progress,escalated&limit=5` | | Array |
| `createFeedback` | `POST /bookings/{bookingId}/feedback` + `Idempotency-Key` | `{ "customerId", "phone", "rating": 1-5, "comment"?, "source": "whatsapp" }` | Feedback. `409` if feedback already exists (the bot then reads it) |
| `getFeedbackForBooking` | `GET /bookings/{bookingId}/feedback?customerId=` | | Feedback, or `404` |
| `markFeedbackFollowUp` | `PATCH /feedback/{feedbackId}` | `{ "complaintId" }` | Feedback |
| `escalateToHuman` | `POST /escalations` | `{ "customerId"?, "phone", "reason", "summary"?, "handoff"? }` | `{ "id" }` |

`priority` comes from the bot's severity check (safety, damage, payment,
repeat failure or technician conduct → `high`/`urgent`, and a human is
brought in). A CRM that ignores it loses nothing else.

Complaint categories: `service_not_completed`, `problem_returned`,
`technician_delayed`, `technician_behaviour`, `property_damage`,
`payment_issue`, `other`.

## Booking lifecycle events (CRM → chatbot)

The CRM calls the chatbot when a technician is assigned, is on the way, or
finishes a job. The bot then messages the customer; for a completed job it
asks for a rating.

```
POST https://<chatbot-host>/api/crm/events
Content-Type: application/json
X-CRM-Signature: sha256=<hex HMAC-SHA256 of the raw body, key = CRM_WEBHOOK_SECRET>
```

If the sender cannot sign requests, `Authorization: Bearer <CRM_WEBHOOK_SECRET>`
is accepted instead. The endpoint is disabled (`404`) until
`CRM_WEBHOOK_SECRET` is configured.

Body: one event, an array of events, or `{ "events": [...] }`.

```json
{
  "id": "evt_01J9Z4K8",
  "type": "booking.on_the_way",
  "occurredAt": "2026-10-12T05:30:00Z",
  "booking": { "id": "8b1f…", "reference": "BK-7F3K9Q" },
  "technician": { "name": "Ravi Menon" },
  "eta": "2026-10-12T05:45:00Z",
  "etaMinutes": 15
}
```

| `type` | Bot behaviour |
|---|---|
| `booking.assigned` | Tells the customer who was assigned, with the booking's date and time |
| `booking.on_the_way` | Tells the customer the technician is on the way, with the ETA if one is sent |
| `booking.completed` | Starts the rating flow, but only if `GET /bookings/{id}` also says `completed` |

Rules:

- **`id` must be unique per event and stable across retries.** Each id is
  processed once, so retrying is always safe.
- The event only says which booking changed. The bot re-reads the booking and
  customer from the CRM, so the CRM record is the source of truth.
- Technician name and ETA are shown only as sent. The bot never estimates them.
- Responses: `200` with `{ "results": [{ "id", "type", "status": "processed|skipped|duplicate", "reason"? }] }`.
  `503` means not consumed, so retry with backoff. `400` means no supported event in the body.
- Cancelled bookings, unknown bookings, a customer in the middle of another
  conversation (for ratings), or an active human takeover produce `skipped`
  with a reason.

### WhatsApp templates for these messages

Outside WhatsApp's 24-hour customer-service window, only pre-approved
templates are delivered. Create these in WhatsApp Manager and set their names
in the environment. Without them, the bot skips the message outside the
window instead of sending one that WhatsApp would drop.

| Env var | Body parameters | Buttons |
|---|---|---|
| `WHATSAPP_TEMPLATE_BOOKING_ASSIGNED` | `{{1}}` customer first name, `{{2}}` technician, `{{3}}` service, `{{4}}` date, `{{5}}` time, `{{6}}` booking reference | none |
| `WHATSAPP_TEMPLATE_TECHNICIAN_ON_THE_WAY` | `{{1}}` technician, `{{2}}` service, `{{3}}` booking reference, `{{4}}` ETA text | none |
| `WHATSAPP_TEMPLATE_FEEDBACK_REQUEST` | `{{1}}` customer name, `{{2}}` service | 3 quick replies, in order: Excellent, Good, More ratings |

For example, the body of the on-the-way template might read: *"{{1}} is on the
way for your {{2}} booking ({{3}}). Estimated arrival: {{4}}."*

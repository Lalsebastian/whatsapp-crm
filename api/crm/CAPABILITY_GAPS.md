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

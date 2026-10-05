// Deterministic CRM data for end-to-end tests. Dates are relative to "today"
// in the business timezone (the browser runs with timezoneId Asia/Dubai), so
// today's views always have work in them.
function dubaiDate(offsetDays = 0) {
  const now = new Date(Date.now() + offsetDays * 86400000)
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

function isoHoursAgo(hours) {
  return new Date(Date.now() - hours * 3600000).toISOString()
}

export function buildFixtures() {
  const today = dubaiDate(0)

  const services = [
    { id: 'svc-ac', name: 'AC Service & Repair', category: 'ac', duration_minutes: 60, base_price: 150, active: true },
    { id: 'svc-plumb', name: 'Plumbing', category: 'plumbing', duration_minutes: 60, base_price: 100, active: true },
    { id: 'svc-clean', name: 'Home Cleaning', category: 'cleaning', duration_minutes: 120, base_price: 200, active: true },
  ]
  const customers = [
    { id: 'cust-aisha', name: 'Aisha Khan', phone: '971501110001', created_at: isoHoursAgo(24 * 40), tags: [], preferred_language: 'en' },
    { id: 'cust-omar', name: 'Omar Haddad', phone: '971501110002', created_at: isoHoursAgo(24 * 5), tags: [], preferred_language: 'en' },
  ]
  const properties = [
    { id: 'prop-aisha', customer_id: 'cust-aisha', label: 'Home', address_line: 'Villa 12, Street 4', area: 'Al Barsha', city: 'Dubai' },
    { id: 'prop-omar', customer_id: 'cust-omar', label: 'Apartment', address_line: 'Marina Heights 1204', area: 'Dubai Marina', city: 'Dubai' },
  ]
  const technicians = [
    { id: 'tech-ravi', name: 'Ravi Menon', phone: '971502220001', email: 'ravi@example.com', active: true, shift_start_minute: 480, shift_end_minute: 1020, weekly_capacity_minutes: 2400, skills: [], service_areas: [] },
    { id: 'tech-sara', name: 'Sara Ali', phone: '971502220002', email: null, active: true, shift_start_minute: 540, shift_end_minute: 1080, weekly_capacity_minutes: 2400, skills: [], service_areas: [] },
  ]

  const embed = (booking) => ({
    ...booking,
    service: services.find((item) => item.id === booking.service_id) ?? null,
    customer: customers.find((item) => item.id === booking.customer_id) ?? null,
    property: properties.find((item) => item.id === booking.property_id) ?? null,
    technician: technicians.find((item) => item.id === booking.technician_id) ?? null,
  })

  const bookings = [
    { id: 'bk-1', reference: 'BK-AC1001', customer_id: 'cust-aisha', property_id: 'prop-aisha', service_id: 'svc-ac', technician_id: 'tech-ravi', scheduled_date: today, scheduled_time: '09:00:00', status: 'confirmed', price: 150, priority: 'normal', created_at: isoHoursAgo(30), updated_at: isoHoursAgo(30) },
    { id: 'bk-2', reference: 'BK-PL2002', customer_id: 'cust-omar', property_id: 'prop-omar', service_id: 'svc-plumb', technician_id: 'tech-ravi', scheduled_date: today, scheduled_time: '13:00:00', status: 'in_progress', price: 100, priority: 'high', created_at: isoHoursAgo(20), updated_at: isoHoursAgo(2) },
    { id: 'bk-3', reference: 'BK-CL3003', customer_id: 'cust-aisha', property_id: 'prop-aisha', service_id: 'svc-clean', technician_id: 'tech-sara', scheduled_date: dubaiDate(-3), scheduled_time: '11:00:00', status: 'completed', price: 200, priority: 'normal', created_at: isoHoursAgo(24 * 4), updated_at: isoHoursAgo(24 * 3), completed_at: isoHoursAgo(24 * 3) },
    { id: 'bk-4', reference: 'BK-AC4004', customer_id: 'cust-omar', property_id: 'prop-omar', service_id: 'svc-ac', technician_id: null, scheduled_date: dubaiDate(2), scheduled_time: '15:00:00', status: 'pending', price: 150, priority: 'normal', created_at: isoHoursAgo(3), updated_at: isoHoursAgo(3) },
  ].map(embed)

  const complaints = [
    {
      id: 'cm-1', reference: 'CM-LEAK01', customer_id: 'cust-omar', booking_id: 'bk-2', category: 'problem_returned',
      description: 'Kitchen tap is leaking again after yesterday\'s repair.', status: 'open', priority: 'high',
      created_at: isoHoursAgo(5), updated_at: isoHoursAgo(5),
      customer: customers[1], booking: { id: 'bk-2', reference: 'BK-PL2002', scheduled_date: today },
    },
  ]

  const escalations = [
    {
      id: 'esc-1', customer_id: 'cust-omar', phone: '971501110002', reason: 'explicit_human_request',
      conversation_summary: 'Customer wants to speak to a supervisor about the leak.', status: 'open', priority: 'high',
      created_at: isoHoursAgo(1), customer: customers[1],
    },
  ]

  const messages = [
    { id: 'msg-1', phone: '971501110002', direction: 'inbound', type: 'text', content: 'The tap is leaking again', created_at: isoHoursAgo(1.2) },
    { id: 'msg-2', phone: '971501110002', direction: 'outbound', type: 'text', content: 'I\'m sorry to hear that. Let me connect you with our team.', created_at: isoHoursAgo(1.1) },
    { id: 'msg-3', phone: '971501110001', direction: 'inbound', type: 'text', content: 'Book AC service tomorrow morning', created_at: isoHoursAgo(6) },
  ]

  const sessions = [
    { phone: '971501110002', customer_id: 'cust-omar', current_flow: null, current_step: null, context: {}, human_takeover: true, last_activity_at: isoHoursAgo(1) },
    { phone: '971501110001', customer_id: 'cust-aisha', current_flow: 'booking', current_step: 'select_date', context: {}, human_takeover: false, last_activity_at: isoHoursAgo(6) },
  ]

  return {
    services,
    customers,
    properties,
    technicians,
    bookings,
    complaints,
    escalations,
    messages,
    sessions,
    satisfaction_surveys: [
      { id: 'sv-1', booking_id: 'bk-3', customer_id: 'cust-aisha', phone: '971501110001', rating: 5, asked_at: isoHoursAgo(60), sent_at: isoHoursAgo(60), responded_at: isoHoursAgo(58), created_at: isoHoursAgo(60) },
    ],
    conversation_events: [],
    job_assignments: [],
    job_photos: [],
    job_signatures: [],
    crm_activity_log: [],
    crm_sla_policies: [],
    crm_operational_targets: [],
    crm_automation_settings: [],
  }
}

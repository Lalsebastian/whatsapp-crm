const DAY = 86_400_000;

export function buildCustomerSegments(customers = [], bookings = [], complaints = [], now = new Date()) {
  return customers.map((customer) => {
    const customerBookings = bookings.filter((row) => row.customer_id === customer.id);
    const customerComplaints = complaints.filter((row) => row.customer_id === customer.id);
    const completed = customerBookings.filter((row) => row.status === 'completed');
    const lifetimeValue = completed.reduce((sum, row) => sum + (Number(row.price) || 0), 0);
    const activity = [...customerBookings, ...customerComplaints]
      .map((row) => row.created_at || row.scheduled_date)
      .filter(Boolean)
      .sort()
      .at(-1) || customer.created_at;
    const ageDays = activity ? (now - new Date(activity)) / DAY : Infinity;
    const segments = [];
    if (lifetimeValue >= 1000) segments.push('VIP');
    if (completed.length >= 2) segments.push('Recurring');
    if (customerComplaints.some((row) => row.status !== 'resolved')) segments.push('At risk');
    if (ageDays > 90) segments.push('Inactive');
    if (customer.created_at && (now - new Date(customer.created_at)) / DAY <= 30) segments.push('New');
    return { ...customer, completedCount: completed.length, complaintCount: customerComplaints.length, lifetimeValue, lastActivity: activity, segments };
  });
}

export function findDataQualityIssues({ customers = [], bookings = [], services = [], technicians = [] } = {}) {
  const issues = [];
  for (const row of customers) {
    if (!row.name?.trim()) issues.push({ type: 'customer', id: row.id, label: row.phone || row.id, issue: 'Missing customer name', module: 'customers' });
    if (!row.phone?.trim()) issues.push({ type: 'customer', id: row.id, label: row.name || row.id, issue: 'Missing phone number', module: 'customers' });
  }
  for (const row of bookings) {
    const label = row.reference || row.id;
    if (!row.service_id && !row.service) issues.push({ type: 'booking', id: row.id, label, issue: 'Missing service', module: 'bookings' });
    if (!row.scheduled_date) issues.push({ type: 'booking', id: row.id, label, issue: 'Missing schedule date', module: 'bookings' });
    if (!row.customer_id && !row.customer) issues.push({ type: 'booking', id: row.id, label, issue: 'Missing customer', module: 'bookings' });
    if (!row.technician_id && !['completed', 'cancelled'].includes(row.status)) issues.push({ type: 'booking', id: row.id, label, issue: 'No technician assigned', module: 'dispatch' });
  }
  for (const row of services) {
    if (!(Number(row.duration_minutes) > 0)) issues.push({ type: 'service', id: row.id, label: row.name || row.id, issue: 'Missing service duration', module: 'control' });
  }
  for (const row of technicians) {
    if (!row.phone && !row.email) issues.push({ type: 'technician', id: row.id, label: row.name || row.id, issue: 'Missing contact details', module: 'control' });
  }
  return issues;
}

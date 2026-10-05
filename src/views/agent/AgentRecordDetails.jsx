import { formatDate, formatDateTime, formatPhone } from '@/lib/utils';
import { complaintStatus } from '@/lib/status';
import { RecordDrawer } from '@/components/data/RecordDrawer';
import { BookingWorkflow } from '@/components/data/BookingWorkflow';
import { humanise, BOOKING_STATUS_OPTIONS } from '@/views/agent/agentRecordUtils';
import { ServiceAddress } from '@/components/data/ServiceAddress';

// Record drawers for a single complaint or booking.

export function ComplaintDetail({ complaint, onOpenChange }) {
  return (
    <RecordDrawer
      record={complaint}
      activityEntity="complaint"
      title={complaint?.reference ?? 'Complaint details'}
      description="Complaint details and current workflow state."
      onClose={() => onOpenChange(false)}
      fields={complaint ? [
        ['Status', complaintStatus(complaint.status).label],
        ['Category', humanise(complaint.category)],
        ['Customer', complaint.customer?.name ?? formatPhone(complaint.customer?.phone)],
        ['Created', formatDateTime(complaint.created_at)],
        ['Description', complaint.description],
        ['Notes', complaint.agent_notes],
      ] : []}
      timeline={complaint ? [
        { label: 'Complaint reported', value: formatDateTime(complaint.created_at) },
        { label: `Current status · ${complaintStatus(complaint.status).label}`, value: formatDateTime(complaint.updated_at) },
      ] : []}
    />
  );
}

export function BookingDetail({ booking, onOpenChange, navigation }) {
  return (
    <RecordDrawer
      record={booking}
      activityEntity="booking"
      title={booking?.reference ?? 'Booking details'}
      description="Booking schedule, customer and service details."
      onClose={() => onOpenChange(false)}
      navigation={navigation}
      summary={booking ? <BookingWorkflow status={booking.status} /> : null}
      fields={booking ? [
        ['Service', booking.service?.name],
        ['Status', BOOKING_STATUS_OPTIONS[booking.status] ?? booking.status],
        ['Customer', booking.customer?.name ?? formatPhone(booking.customer?.phone)],
        ['Phone', formatPhone(booking.customer?.phone)],
        ['Service address', <ServiceAddress key="address" property={booking.property} />],
        ['Scheduled date', formatDate(booking.scheduled_date)],
        ['Scheduled time', booking.scheduled_time],
        ['Notes', booking.notes ?? booking.agent_notes],
      ] : []}
      timeline={booking ? [
        { label: 'Booking created', value: formatDateTime(booking.created_at) },
        { label: 'Service scheduled', value: `${formatDate(booking.scheduled_date)} ${booking.scheduled_time?.slice(0, 5) ?? ''}` },
        { label: `Current status · ${BOOKING_STATUS_OPTIONS[booking.status] ?? booking.status}`, value: formatDateTime(booking.updated_at) },
      ] : []}
    />
  );
}

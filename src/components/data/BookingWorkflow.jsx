import { Check, Circle, X } from 'lucide-react';
import { BOOKING_STATUS } from '@/lib/status';

const STAGES = ['pending', 'confirmed', 'in_progress', 'completed'];

export function BookingWorkflow({ status }) {
  const currentIndex = STAGES.indexOf(status);
  const exceptional = status === 'cancelled' || status === 'rescheduled';
  const meta = BOOKING_STATUS[status] ?? { label: status, tone: 'neutral' };

  return (
    <section className="booking-workflow" aria-label={`Booking workflow: ${meta.label}`}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <div className="text-[10px] font-bold tracking-[0.16em] text-info uppercase dark:text-primary">Service journey</div>
          <div className="mt-1 text-sm font-semibold">{exceptional ? meta.label : 'Progress to completion'}</div>
        </div>
        <span className={`workflow-current workflow-current-${meta.tone}`}>{meta.label}</span>
      </div>
      {exceptional ? (
        <div className={`workflow-exception workflow-exception-${meta.tone}`}>
          {status === 'cancelled' ? <X className="size-4" /> : <Circle className="size-4" />}
          This booking is currently {meta.label.toLowerCase()}.
        </div>
      ) : (
        <ol className="workflow-track">
          {STAGES.map((stage, index) => {
            const done = currentIndex > index || status === 'completed';
            const active = currentIndex === index;
            return (
              <li key={stage} className={`workflow-step ${done ? 'is-done' : ''} ${active ? 'is-active' : ''}`}>
                <span className="workflow-node">{done ? <Check /> : <span>{index + 1}</span>}</span>
                <span>{BOOKING_STATUS[stage].label}</span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

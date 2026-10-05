import { describe, it, expect } from 'vitest';

const { normalizeSlot, normalizeSlots, findSlot } = require('../../crm/slots');

describe('structured slots', () => {
  it('upgrades a legacy "HH:MM" string, computing the end from the service duration', () => {
    expect(normalizeSlot('9:00', { date: '2026-10-12', durationMinutes: 90 })).toEqual({
      id: '09:00',
      start: '09:00',
      end: '10:30',
      startsAt: '2026-10-12T09:00:00+04:00',
      endsAt: '2026-10-12T10:30:00+04:00',
      timezone: 'Asia/Dubai',
      label: '9:00 AM – 10:30 AM',
    });
  });

  it('parses "HH:MM-HH:MM" ranges and strips seconds', () => {
    expect(normalizeSlot('13:00:00-15:00')).toMatchObject({ start: '13:00', end: '15:00', label: '1:00 PM – 3:00 PM' });
  });

  it('keeps a CRM slot id and supplied instants', () => {
    expect(normalizeSlot({
      id: 'crm-77', start: '09:00', end: '11:00',
      startsAt: '2026-10-12T05:00:00Z', endsAt: '2026-10-12T07:00:00Z', timezone: 'UTC',
    })).toMatchObject({ id: 'crm-77', startsAt: '2026-10-12T05:00:00Z', timezone: 'UTC' });
  });

  it('drops invalid slots, de-duplicates and sorts', () => {
    const slots = normalizeSlots(['17:00', 'not-a-time', '25:00', '09:00', '09:00', { start: '11:00' }, null]);
    expect(slots.map((slot) => slot.id)).toEqual(['09:00', '11:00', '17:00']);
  });

  it('never lets a computed end time spill past midnight', () => {
    expect(normalizeSlot('23:30', { durationMinutes: 60 }).end).toBeNull();
  });

  it('finds a slot by id or by start time', () => {
    const slots = normalizeSlots([{ id: 'crm-1', start: '09:00' }, '11:00']);
    expect(findSlot(slots, 'crm-1').start).toBe('09:00');
    expect(findSlot(slots, '9:00').id).toBe('crm-1');
    expect(findSlot(slots, '13:00')).toBeNull();
  });
});

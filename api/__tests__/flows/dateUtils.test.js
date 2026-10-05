import { describe, it, expect } from 'vitest';

const {
  parseDateInput, formatDateForCustomer, formatSlotForCustomer, todayInTimeZone, addDays,
} = require('../../flows/dateUtils');

describe('customer-facing date and slot formatting', () => {
  it('formats an ISO date without exposing the raw value', () => {
    expect(formatDateForCustomer('2026-10-01')).toBe('Thursday, 1 October');
  });

  it('formats noon correctly in a time range', () => {
    expect(formatSlotForCustomer('10:00-12:00')).toBe('10:00 AM – 12:00 PM');
  });

  it('formats midnight and noon without swapping AM and PM', () => {
    expect(formatSlotForCustomer('00:00')).toBe('12:00 AM');
    expect(formatSlotForCustomer('12:00')).toBe('12:00 PM');
  });

  it('rejects impossible calendar dates', () => {
    expect(parseDateInput('2026-02-30')).toBeNull();
    expect(parseDateInput('31/13/2026')).toBeNull();
  });

  // Fixed clock: Sunday 4 October 2026, 10:00 in Dubai.
  const now = new Date('2026-10-04T06:00:00Z');

  it('understands "day after tomorrow" for voice and text input', () => {
    expect(parseDateInput('day after tomorrow', { now })).toBe('2026-10-06');
  });

  it('understands the next named weekday', () => {
    expect(parseDateInput('wednesday', { now })).toBe('2026-10-07');
    expect(parseDateInput('next sunday', { now })).toBe('2026-10-11');
  });

  it('resolves "today" in the business timezone, not the server\'s UTC date', () => {
    // 01:30 on 5 October in Dubai is still 4 October in UTC.
    const earlyMorningDubai = new Date('2026-10-04T21:30:00Z');
    expect(parseDateInput('today', { now: earlyMorningDubai })).toBe('2026-10-05');
    expect(parseDateInput('tomorrow', { now: earlyMorningDubai })).toBe('2026-10-06');
    expect(todayInTimeZone(earlyMorningDubai, 'UTC')).toBe('2026-10-04');
  });

  it('adds days across month boundaries', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
  });
});

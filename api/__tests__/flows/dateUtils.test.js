import { describe, it, expect } from 'vitest';

const { parseDateInput, formatDateForCustomer, formatSlotForCustomer } = require('../../flows/dateUtils');

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

  it('understands "day after tomorrow" for voice and text input', () => {
    const expected = new Date();
    expected.setDate(expected.getDate() + 2);
    expect(parseDateInput('day after tomorrow')).toBe(expected.toISOString().slice(0, 10));
  });
});

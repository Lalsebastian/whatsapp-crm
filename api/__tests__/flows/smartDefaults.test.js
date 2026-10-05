import { describe, it, expect } from 'vitest';

const { habitualPeriod } = require('../../flows/booking/schedule');

const withTimes = (...times) => ({ customerProfile: { recentBookings: times.map((scheduledTime) => ({ scheduledTime })) } });

describe('habitual time of day (smart default, never auto-selected)', () => {
  it('needs at least two past bookings', () => {
    expect(habitualPeriod(withTimes('09:00:00'))).toBeNull();
    expect(habitualPeriod({})).toBeNull();
  });

  it('finds a clear habit', () => {
    expect(habitualPeriod(withTimes('09:00:00', '10:30:00'))).toBe('morning');
    expect(habitualPeriod(withTimes('18:00:00', '19:00:00', '09:00:00'))).toBe('evening');
  });

  it('does not invent a habit from mixed times', () => {
    expect(habitualPeriod(withTimes('09:00:00', '14:00:00'))).toBeNull();
    expect(habitualPeriod(withTimes('09:00:00', '14:00:00', '19:00:00'))).toBeNull();
  });
});

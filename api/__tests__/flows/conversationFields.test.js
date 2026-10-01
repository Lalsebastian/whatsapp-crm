import { describe, expect, it } from 'vitest';

const { bookingFieldState, withFieldDiagnostics } = require('../../flows/conversationFields');

describe('minimal-message booking field decisions', () => {
  it('separates known, missing, ambiguous, and revalidation-required fields', () => {
    expect(bookingFieldState({
      serviceId: 'svc1',
      date: '2026-10-02',
      locationHint: 'Kakkanad home',
      preferredTime: 'evening',
      ambiguousFields: ['property'],
    })).toEqual({
      knownFields: ['service', 'date'],
      missingFields: ['property', 'time'],
      ambiguousFields: ['property'],
      requiresRevalidation: ['property', 'time'],
    });
  });

  it('clears revalidation requirements after CRM-backed values are resolved', () => {
    const resolved = withFieldDiagnostics({
      serviceId: 'svc1', propertyId: 'home', date: '2026-10-02', time: '17:00',
      preferredTime: 'evening', requiresRevalidation: ['property', 'time'],
    });
    expect(resolved.missingFields).toEqual([]);
    expect(resolved.requiresRevalidation).toEqual([]);
  });
});

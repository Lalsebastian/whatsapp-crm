import { describe, expect, it } from 'vitest';

const { normalizeCustomerMessage } = require('../../ai/messageUnderstanding');
const { recommendServices, recommendServiceableServices } = require('../../ai/serviceRecommendations');

describe('universal customer-message understanding', () => {
  it.each([
    ['kitchen', { room: 'kitchen', service: null, intent: 'NEW_BOOKING' }],
    ['kitchen sink leaking', { room: 'kitchen', service: 'Plumbing' }],
    ['kitchen light not working', { room: 'kitchen', service: 'Electrical' }],
    ['kitchen is very dirty', { room: 'kitchen', service: 'Cleaning' }],
    ['cockroaches in kitchen', { room: 'kitchen', service: 'Pest Control' }],
    ['fridge not cooling', { room: null, service: 'Appliance Repair' }],
    ['bathroom pipe leak', { room: 'bathroom', service: 'Plumbing' }],
    ['bedroom AC not cooling', { room: 'bedroom', service: 'AC Service & Repair' }],
    ['whole house deep cleaning', { room: 'entire home', service: 'Cleaning' }],
  ])('extracts fields from %s', (text, expected) => {
    expect(normalizeCustomerMessage(text)).toEqual(expect.objectContaining(expected));
  });

  it('extracts service, room, date, and location from one message', () => {
    expect(normalizeCustomerMessage('tomorrow kitchen cleaning at Kakkanad')).toEqual(expect.objectContaining({
      intent: 'NEW_BOOKING', service: 'Cleaning', room: 'kitchen',
      preferredDate: 'tomorrow', locationHint: 'Kakkanad',
    }));
  });

  it('understands a Manglish multi-field plumbing request', () => {
    expect(normalizeCustomerMessage('Nale kitchen pipe leak aanu')).toEqual(expect.objectContaining({
      intent: 'NEW_BOOKING', service: 'Plumbing', room: 'kitchen',
      preferredDate: 'tomorrow', language: 'manglish',
    }));
  });
});

describe('CRM-catalog service recommendations', () => {
  it('ranks kitchen-relevant services and never invents catalog entries', () => {
    const catalog = [
      { id: 'clean', name: 'Kitchen Cleaning', category: 'cleaning' },
      { id: 'plumb', name: 'Plumbing', category: 'plumbing' },
      { id: 'electric', name: 'Electrical', category: 'electrical' },
      { id: 'appliance', name: 'Appliance Repair', category: 'appliances' },
      { id: 'pest', name: 'Pest Control', category: 'pest-control' },
      { id: 'ac', name: 'AC Service', category: 'ac' },
    ];

    const result = recommendServices({ room: 'kitchen' }, catalog);

    expect(result.map((service) => service.id)).toEqual(['clean', 'plumb', 'electric', 'appliance', 'pest']);
    expect(result.every((service) => catalog.includes(service))).toBe(true);
  });

  it('excludes a CRM service that is unavailable at the selected location', async () => {
    const catalog = [
      { id: 'clean', name: 'Kitchen Cleaning', category: 'cleaning' },
      { id: 'plumb', name: 'Plumbing', category: 'plumbing' },
      { id: 'electric', name: 'Electrical', category: 'electrical' },
    ];
    const result = await recommendServiceableServices(
      { room: 'kitchen' },
      catalog,
      {
        location: { propertyId: 'home', areaName: 'Kakkanad', source: 'saved_property' },
        checkServiceability: async (serviceId) => ({ serviceable: serviceId !== 'clean', source: 'crm' }),
      }
    );

    expect(result.services.map((service) => service.id)).toEqual(['plumb', 'electric']);
    expect(result.excludedServiceIds).toEqual(['clean']);
    expect(result.serviceabilityFiltered).toBe(true);
  });

  it('does not hide services when serviceability cannot be determined', async () => {
    const catalog = [{ id: 'clean', name: 'Kitchen Cleaning', category: 'cleaning' }];
    const result = await recommendServiceableServices(
      { room: 'kitchen' }, catalog,
      { location: { propertyId: 'home' }, checkServiceability: async () => { throw new Error('unavailable'); } }
    );
    expect(result.services).toEqual(catalog);
    expect(result.serviceabilityFiltered).toBe(false);
  });
});

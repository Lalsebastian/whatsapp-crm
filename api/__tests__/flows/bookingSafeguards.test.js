import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { checkBooking } = require('../../flows/booking/qualityGate');
const { suggestAddOn } = require('../../flows/booking/bundles');
const { assessSeverity } = require('../../flows/complaintSeverity');
const { todayInTimeZone, addDays, minutesNowInTimeZone } = require('../../flows/dateUtils');

const DATE = addDays(todayInTimeZone(), 2);
const item = (overrides = {}) => ({ serviceId: 'svc-1', propertyId: 'prop-1', date: DATE, time: '09:00', ...overrides });

function crm(overrides = {}) {
  return {
    getServiceDetails: vi.fn(async (id) => ({ id, name: 'Plumbing' })),
    getCustomerProperties: vi.fn(async () => [{ id: 'prop-1' }]),
    getBookings: vi.fn(async () => []),
    checkServiceability: vi.fn(async () => ({ serviceable: true })),
    getAvailability: vi.fn(async () => ['09:00', '11:00']),
    ...overrides,
  };
}
const customer = { id: 'cust-1' };

describe('booking quality gate', () => {
  it('passes a valid booking', async () => {
    expect(await checkBooking(crm(), customer, [item()], { phone: '971' })).toEqual({ ok: true });
  });

  it.each([
    ['customer_unidentified', () => [crm(), null, [item()]]],
    ['missing_fields', () => [crm(), customer, [item({ time: null })]]],
    ['date_past', () => [crm(), customer, [item({ date: addDays(todayInTimeZone(), -1) })]]],
    ['duplicate_in_cart', () => [crm(), customer, [item(), item()]]],
    ['service_unavailable', () => [crm({ getServiceDetails: vi.fn(async () => null) }), customer, [item()]]],
    ['property_not_found', () => [crm({ getCustomerProperties: vi.fn(async () => [{ id: 'someone-elses' }]) }), customer, [item()]]],
    ['not_serviceable', () => [crm({ checkServiceability: vi.fn(async () => ({ serviceable: false })) }), customer, [item()]]],
    ['slot_unavailable', () => [crm({ getAvailability: vi.fn(async () => ['15:00']) }), customer, [item()]]],
  ])('refuses %s', async (problem, args) => {
    const [adapter, who, cart] = args();
    expect(await checkBooking(adapter, who, cart, { phone: '971' })).toMatchObject({ ok: false, problem });
  });

  it('refuses a slot that has already started today', async () => {
    if (minutesNowInTimeZone() === 0) return; // exactly midnight: nothing has passed yet
    const result = await checkBooking(crm(), customer, [item({ date: todayInTimeZone(), time: '00:00' })], { phone: '971' });
    expect(result).toMatchObject({ ok: false, problem: 'slot_passed' });
  });

  it('flags an active booking for the same service and day, unless the customer insists', async () => {
    const existing = { id: 'bk-old', serviceId: 'svc-1', scheduledDate: DATE, status: 'confirmed' };
    const adapter = crm({ getBookings: vi.fn(async () => [existing]) });
    expect(await checkBooking(adapter, customer, [item()], { phone: '971' })).toMatchObject({ problem: 'duplicate_booking', existing });
    expect(await checkBooking(adapter, customer, [item()], { phone: '971', allowDuplicate: true })).toEqual({ ok: true });
  });

  it('ignores cancelled bookings when looking for duplicates', async () => {
    const adapter = crm({ getBookings: vi.fn(async () => [{ serviceId: 'svc-1', scheduledDate: DATE, status: 'cancelled' }]) });
    expect(await checkBooking(adapter, customer, [item()], { phone: '971' })).toEqual({ ok: true });
  });

  it('matches by slot id or, for CRMs without ids, by start time', async () => {
    const withIds = crm({ getAvailability: vi.fn(async () => [{ id: 'slot-a', start: '09:00', end: '11:00' }]) });
    expect(await checkBooking(withIds, customer, [item({ slotId: 'slot-a' })], { phone: '971' })).toEqual({ ok: true });
    expect(await checkBooking(withIds, customer, [item({ slotId: 'stale-id' })], { phone: '971' })).toEqual({ ok: true });
  });

  it('skips a check whose CRM read fails rather than blocking a valid booking', async () => {
    const adapter = crm({
      getAvailability: vi.fn(async () => { throw Object.assign(new Error('timeout'), { code: 'CRM_TIMEOUT' }); }),
      getBookings: vi.fn(async () => { throw new Error('down'); }),
    });
    expect(await checkBooking(adapter, customer, [item()], { phone: '971' })).toEqual({ ok: true });
  });
});

describe('service bundle suggestions', () => {
  const saved = { ...process.env };
  const catalogue = [
    { id: 'clean', name: 'Home Cleaning', category: 'cleaning' },
    { id: 'pest', name: 'Pest Control', category: 'pest control' },
    { id: 'plumb', name: 'Plumbing', category: 'plumbing' },
  ];
  const adapter = (overrides = {}) => ({
    getServices: vi.fn(async () => catalogue),
    checkServiceability: vi.fn(async () => ({ serviceable: true })),
    ...overrides,
  });

  beforeEach(() => { process.env.SERVICE_BUNDLES_ENABLED = 'true'; delete process.env.SERVICE_BUNDLES; });
  afterEach(() => { process.env = { ...saved }; });

  it('is off unless the client enables cross-selling', async () => {
    delete process.env.SERVICE_BUNDLES_ENABLED;
    expect(await suggestAddOn(adapter(), [{ serviceId: 'clean', propertyId: 'p1' }])).toBeNull();
  });

  it('suggests a related catalogue service', async () => {
    const result = await suggestAddOn(adapter(), [{ serviceId: 'clean', propertyId: 'p1' }]);
    expect(result).toMatchObject({ service: { id: 'pest' }, shortLabel: 'Pest Control', bookedLabel: 'Cleaning' });
  });

  it('never suggests something already booked or unavailable at the address', async () => {
    const checkServiceability = vi.fn(async (id) => ({ serviceable: id !== 'plumb' }));
    const result = await suggestAddOn(adapter({ checkServiceability }), [
      { serviceId: 'clean', propertyId: 'p1' }, { serviceId: 'pest', propertyId: 'p1' },
    ]);
    expect(result).toBeNull();
  });

  it('uses the client\'s own pairs and survives a broken configuration', async () => {
    process.env.SERVICE_BUNDLES = JSON.stringify({ home_cleaning: ['plumbing'] });
    expect((await suggestAddOn(adapter(), [{ serviceId: 'clean', propertyId: 'p1' }])).service.id).toBe('plumb');
    process.env.SERVICE_BUNDLES = '{not json';
    expect((await suggestAddOn(adapter(), [{ serviceId: 'clean', propertyId: 'p1' }])).service.id).toBe('pest');
  });

  it('stays silent when the CRM fails', async () => {
    expect(await suggestAddOn(adapter({ getServices: vi.fn(async () => { throw new Error('down'); }) }), [{ serviceId: 'clean' }])).toBeNull();
  });
});

describe('complaint severity', () => {
  it.each([
    [{ description: 'there is a gas smell after the repair' }, 'safety', 'urgent'],
    [{ description: 'the technician was rude and I felt unsafe' }, 'safety', 'high'],
    [{ category: 'property_damage', description: 'tile' }, 'damage', 'high'],
    [{ description: 'they scratched my new floor' }, 'damage', 'high'],
    [{ description: 'I was overcharged and want a refund' }, 'payment', 'high'],
    [{ description: 'the same problem came back' }, 'repeated', 'high'],
    [{ description: 'tap is loose', openComplaintCount: 2 }, 'repeated', 'high'],
    [{ category: 'technician_behaviour', description: 'late' }, 'conduct', 'high'],
    [{ category: 'other', description: 'the invoice email had a typo in my name' }, 'payment', 'high'],
  ])('%o → %s', (input, level, priority) => {
    expect(assessSeverity(input)).toMatchObject({ level, priority, escalate: true });
  });

  it('leaves an ordinary complaint with the team at normal priority', () => {
    expect(assessSeverity({ category: 'quality_issue', description: 'the tap still drips a little' }))
      .toEqual({ level: 'normal', priority: 'normal', escalate: false, reason: null });
  });
});

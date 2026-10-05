// See ai/intentService.test.js for why require()-cache monkey-patching is
// used here instead of vi.mock. flows/booking.js accesses crm/whatsapp/
// sessionStore as namespace objects (`crm.createBooking(...)`, never
// destructured), so patching their exported function properties before
// requiring booking.js makes every call inside it hit our fakes.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const fakeCrm = require('../../crm/supabaseCrmAdapter');
fakeCrm.getServices = vi.fn();
fakeCrm.getServiceDetails = vi.fn();
fakeCrm.getCustomerProperties = vi.fn();
fakeCrm.addProperty = vi.fn();
fakeCrm.getAvailability = vi.fn();
fakeCrm.createBooking = vi.fn();
fakeCrm.checkServiceability = vi.fn();
fakeCrm.getAvailabilityRange = vi.fn();
fakeCrm.createBookings = vi.fn();
fakeCrm.getBookings = vi.fn();

const whatsapp = require('../../whatsapp/client');
whatsapp.sendText = vi.fn();
whatsapp.sendButtons = vi.fn();
whatsapp.sendListMessage = vi.fn();

const sessionStore = require('../../session/sessionStore');
sessionStore.setFlow = vi.fn();
sessionStore.clearFlow = vi.fn();

const intentService = require('../../ai/intentService');
intentService.matchServiceToCatalog = vi.fn();
intentService.analyzeBookingCorrection = vi.fn();

const escalationService = require('../../escalation/escalationService');
escalationService.triggerEscalation = vi.fn();

const actionGuard = require('../../reliability/actionGuard');
const analytics = require('../../analytics/eventWriter');
const messageBudget = require('../../analytics/messageBudget');

const booking = require('../../flows/booking');

function resetAll() {
  [fakeCrm.getServices, fakeCrm.getServiceDetails, fakeCrm.getCustomerProperties, fakeCrm.addProperty, fakeCrm.getAvailability, fakeCrm.createBooking, fakeCrm.checkServiceability, fakeCrm.getAvailabilityRange, fakeCrm.createBookings, fakeCrm.getBookings,
    whatsapp.sendText, whatsapp.sendButtons, whatsapp.sendListMessage, sessionStore.setFlow, sessionStore.clearFlow,
    intentService.matchServiceToCatalog, intentService.analyzeBookingCorrection, escalationService.triggerEscalation]
    .forEach((fn) => fn.mockReset());
  actionGuard.clearForTests();
  analytics.clearTestEvents();
  messageBudget.reset();
  intentService.matchServiceToCatalog.mockResolvedValue({ serviceId: null, confidence: 0 });
  intentService.analyzeBookingCorrection.mockResolvedValue({
    service: null, locationHint: null, preferredDate: null, preferredTime: null, confidence: 0,
  });
  fakeCrm.getCustomerProperties.mockResolvedValue([]);
  fakeCrm.checkServiceability.mockResolvedValue({ serviceable: true });
  // null = range lookup unsupported, so date prompts use the Today/Tomorrow
  // fallback unless a test opts in to CRM-backed date lists.
  fakeCrm.getAvailabilityRange.mockResolvedValue(null);
  fakeCrm.getBookings.mockResolvedValue([]);
}

// The final booking gate re-reads the CRM before writing. Give it a world in
// which the items being confirmed are valid; gate-failure tests override.
function openGate() {
  fakeCrm.getServiceDetails.mockImplementation(async (id) => ({ id, name: `Service ${id}` }));
  fakeCrm.getCustomerProperties.mockResolvedValue([{ id: 'prop1', label: 'Home', addressLine: 'Villa 1' }]);
  fakeCrm.getAvailability.mockResolvedValue(['09:00', '11:00', '13:00', '17:00']);
  fakeCrm.getBookings.mockResolvedValue([]);
}

describe('booking flow — confirm step', () => {
  beforeEach(() => { resetAll(); openGate(); });

  it('calls createBooking exactly once, only on CONFIRM_BOOKING, with all required fields', async () => {
    fakeCrm.createBooking.mockResolvedValue({ reference: 'BK-ABC123', scheduledDate: '2031-10-01', scheduledTime: '09:00' });

    const session = { phone: '971500', context: { serviceId: 'svc1', propertyId: 'prop1', date: '2031-10-01', time: '09:00' } };
    const customer = { id: 'cust1' };

    await booking.steps.confirm(session, customer, { buttonId: 'CONFIRM_BOOKING' });

    expect(fakeCrm.createBooking).toHaveBeenCalledTimes(1);
    expect(fakeCrm.createBooking).toHaveBeenCalledWith({
      customerId: 'cust1', propertyId: 'prop1', serviceId: 'svc1', date: '2031-10-01', time: '09:00',
      idempotencyKey: expect.stringMatching(/^wa-/),
    });
    expect(analytics.getTestEvents('971500').map((event) => event.eventType))
      .toEqual(expect.arrayContaining(['BOOKING_CONFIRMED', 'BOOKING_CREATED', 'CONVERSATION_COMPLETED']));
  });

  it('records privacy-safe booking turn and fast-path completion metrics', async () => {
    fakeCrm.createBooking.mockResolvedValue({ reference: 'BK-METRIC', scheduledDate: '2031-10-01', scheduledTime: '09:00' });
    messageBudget.start('971500', { fieldsExtracted: ['service', 'property', 'date', 'time', 'issue'] });
    messageBudget.botMessage('971500');
    messageBudget.botMessage('971500');
    messageBudget.customerMessage('971500');
    messageBudget.avoidQuestion('971500', 3);
    messageBudget.markFastPath('971500');

    await booking.steps.confirm(
      { phone: '971500', context: { serviceId: 'svc1', propertyId: 'prop1', date: '2031-10-01', time: '09:00' } },
      { id: 'cust1' }, { buttonId: 'CONFIRM_BOOKING' }
    );

    const events = analytics.getTestEvents('971500');
    expect(events.map((event) => event.eventType)).toEqual(expect.arrayContaining([
      'BOOKING_CUSTOMER_TURNS', 'BOOKING_BOT_TURNS', 'BOOKING_MESSAGES_TO_COMPLETE',
    ]));
    expect(events.find((event) => event.eventType === 'BOOKING_MESSAGES_TO_COMPLETE').metadata).toMatchObject({
      customerMessages: 2,
      botMessages: 2,
      totalMessages: 4,
      fieldsExtractedFirstMessage: 5,
      redundantQuestionsAvoided: 3,
      withinFourBotMessages: true,
      fastPathUsed: true,
    });
  });

  it('does not call createBooking when the customer cancels', async () => {
    const session = { phone: '971500', context: { serviceId: 'svc1', propertyId: 'prop1', date: '2031-10-01', time: '09:00' } };
    await booking.steps.confirm(session, { id: 'cust1' }, { buttonId: 'CANCEL_FLOW' });
    expect(fakeCrm.createBooking).not.toHaveBeenCalled();
  });

  it('does not call createBooking when required context fields are missing', async () => {
    const session = { phone: '971500', context: { serviceId: 'svc1' } }; // no property/date/time
    await booking.steps.confirm(session, { id: 'cust1' }, { buttonId: 'CONFIRM_BOOKING' });
    expect(fakeCrm.createBooking).not.toHaveBeenCalled();
  });

  it('does not call createBooking again on an unrelated button tap', async () => {
    const session = { phone: '971500', context: { serviceId: 'svc1', propertyId: 'prop1', date: '2031-10-01', time: '09:00' } };
    await booking.steps.confirm(session, { id: 'cust1' }, { buttonId: 'SOMETHING_ELSE' });
    expect(fakeCrm.createBooking).not.toHaveBeenCalled();
  });

  it('does not falsely confirm when CRM booking creation fails', async () => {
    fakeCrm.createBooking.mockRejectedValue(new Error('CRM unavailable'));
    const session = { phone: '971500', context: { serviceId: 'svc1', propertyId: 'prop1', date: '2031-10-01', time: '09:00' } };

    await booking.steps.confirm(session, { id: 'cust1' }, { buttonId: 'CONFIRM_BOOKING' });

    expect(whatsapp.sendText.mock.calls.at(-1)[1]).toContain("couldn't confirm your booking");
    expect(whatsapp.sendText.mock.calls.at(-1)[1]).not.toContain('is confirmed');
    expect(sessionStore.clearFlow).not.toHaveBeenCalled();
  });

  it('creates only one CRM booking when confirmation is submitted twice concurrently', async () => {
    fakeCrm.createBooking.mockResolvedValue({ reference: 'BK-ONCE', scheduledDate: '2031-10-01', scheduledTime: '09:00' });
    const session = {
      phone: '971500',
      context: {
        confirmationNonce: 'confirm-once',
        cart: [{ actionId: 'item-once', serviceId: 'svc1', serviceName: 'Plumbing', propertyId: 'prop1', propertyLabel: 'Home', date: '2031-10-01', time: '09:00' }],
      },
    };

    await Promise.all([
      booking.steps.confirm(session, { id: 'cust1' }, { buttonId: 'CONFIRM_BOOKING' }),
      booking.steps.confirm(session, { id: 'cust1' }, { buttonId: 'CONFIRM_BOOKING' }),
    ]);

    expect(fakeCrm.createBooking).toHaveBeenCalledTimes(1);
  });

  it('does not retry an uncertain booking creation outcome', async () => {
    const timeout = Object.assign(new Error('CRM.createBooking timed out'), { code: 'OPERATION_TIMEOUT', uncertain: true });
    fakeCrm.createBooking.mockRejectedValue(timeout);
    escalationService.triggerEscalation.mockResolvedValue({ id: 'esc1' });
    const session = {
      phone: '971500',
      context: {
        confirmationNonce: 'uncertain-confirm',
        cart: [{ actionId: 'uncertain-item', serviceId: 'svc1', serviceName: 'Plumbing', propertyId: 'prop1', propertyLabel: 'Home', date: '2031-10-01', time: '09:00' }],
      },
    };

    await booking.steps.confirm(session, { id: 'cust1' }, { buttonId: 'CONFIRM_BOOKING' });
    await booking.steps.confirm(session, { id: 'cust1' }, { buttonId: 'CONFIRM_BOOKING' });

    expect(fakeCrm.createBooking).toHaveBeenCalledTimes(1);
    expect(whatsapp.sendText.mock.calls.at(-1)[1]).toContain('already being checked');
    expect(sessionStore.clearFlow).not.toHaveBeenCalled();
  });
});

describe('booking flow — atomic multi-service confirmation', () => {
  beforeEach(() => { resetAll(); openGate(); });

  const cart = () => [
    { actionId: 'a1', serviceId: 'svc1', serviceName: 'Plumbing', propertyId: 'prop1', propertyLabel: 'Home', date: '2026-10-10', time: '09:00', issue: 'Leaking tap' },
    { actionId: 'a2', serviceId: 'svc2', serviceName: 'AC Service', propertyId: 'prop1', propertyLabel: 'Home', date: '2026-10-10', time: '11:00', timeEnd: '12:30', slotId: 'crm-slot-77' },
  ];

  it('books every service with one createBookings call and never calls createBooking', async () => {
    fakeCrm.createBookings.mockResolvedValue([
      { id: 'b1', reference: 'BK-ONE111', scheduledDate: '2026-10-10', scheduledTime: '09:00' },
      { id: 'b2', reference: 'BK-TWO222', scheduledDate: '2026-10-10', scheduledTime: '11:00' },
    ]);

    await booking.steps.confirm(
      { phone: '971500', context: { confirmationNonce: 'batch-1', cart: cart() } },
      { id: 'cust1' },
      { buttonId: 'CONFIRM_BOOKING' }
    );

    expect(fakeCrm.createBooking).not.toHaveBeenCalled();
    expect(fakeCrm.createBookings).toHaveBeenCalledTimes(1);
    expect(fakeCrm.createBookings).toHaveBeenCalledWith({
      customerId: 'cust1',
      idempotencyKey: 'wa-batch-1',
      items: [
        { propertyId: 'prop1', serviceId: 'svc1', date: '2026-10-10', time: '09:00', notes: 'Leaking tap' },
        { propertyId: 'prop1', serviceId: 'svc2', date: '2026-10-10', time: '11:00', slotId: 'crm-slot-77' },
      ],
    });
    const [, reply, buttons] = whatsapp.sendButtons.mock.calls.at(-1);
    expect(reply).toContain('BK-ONE111');
    expect(reply).toContain('BK-TWO222');
    // Contextual quick replies instead of a dead end.
    expect(buttons.map((button) => button.title)).toEqual(['View Bookings', 'Add Another Service', 'Main Menu']);
    expect(buttons[1].id).toBe('ADD_SERVICE:*~prop1~2026-10-10');
    expect(sessionStore.clearFlow).toHaveBeenCalledWith('971500');
  });

  it('books nothing and keeps the cart when the atomic call fails definitively', async () => {
    fakeCrm.createBookings.mockRejectedValue(Object.assign(new Error('Bad Request'), { response: { status: 400 } }));

    await booking.steps.confirm(
      { phone: '971500', context: { confirmationNonce: 'batch-2', cart: cart() } },
      { id: 'cust1' },
      { buttonId: 'CONFIRM_BOOKING' }
    );

    expect(whatsapp.sendText.mock.calls.at(-1)[1]).toContain('None of the 2 services were booked');
    expect(sessionStore.clearFlow).not.toHaveBeenCalled();
    expect(sessionStore.setFlow).not.toHaveBeenCalled();
  });

  it('tells the customer a time was taken when the CRM reports SLOT_UNAVAILABLE', async () => {
    fakeCrm.createBookings.mockRejectedValue(Object.assign(new Error('taken'), { code: 'SLOT_UNAVAILABLE' }));

    await booking.steps.confirm(
      { phone: '971500', context: { confirmationNonce: 'batch-3', cart: cart() } },
      { id: 'cust1' },
      { buttonId: 'CONFIRM_BOOKING' }
    );

    expect(whatsapp.sendText.mock.calls.at(-1)[1]).toContain('just booked by someone else');
    expect(sessionStore.clearFlow).not.toHaveBeenCalled();
  });

  it('escalates instead of retrying when the CRM returns fewer bookings than requested', async () => {
    fakeCrm.createBookings.mockResolvedValue([{ id: 'b1', reference: 'BK-ONLY1' }]);
    escalationService.triggerEscalation.mockResolvedValue({ id: 'esc1' });

    await booking.steps.confirm(
      { phone: '971500', context: { confirmationNonce: 'batch-4', cart: cart() } },
      { id: 'cust1' },
      { buttonId: 'CONFIRM_BOOKING' }
    );

    expect(escalationService.triggerEscalation).toHaveBeenCalledWith(expect.objectContaining({
      reason: 'booking_creation_uncertain',
    }));
    expect(whatsapp.sendText.mock.calls.at(-1)[1]).toContain('could not verify');
  });
});

describe('booking flow — CRM-backed dates and structured slots', () => {
  beforeEach(resetAll);

  const baseContext = { serviceId: 'svc1', serviceName: 'Plumbing', propertyId: 'prop1', propertyLabel: 'Home' };

  it('lists only upcoming dates that the CRM reports as having open times', async () => {
    fakeCrm.getAvailabilityRange.mockResolvedValue([
      { date: '2030-01-02', slots: ['09:00', '11:00'] },
      { date: '2030-01-03', slots: [] },
      { date: '2030-01-04', slots: [{ id: 's-1', start: '13:00', end: '15:00' }] },
    ]);
    fakeCrm.getServiceDetails.mockResolvedValue({ id: 'svc1', name: 'Plumbing' });
    fakeCrm.getCustomerProperties.mockResolvedValue([{ id: 'prop1', label: 'Home', addressLine: 'Villa 1', isDefault: true }]);

    await booking.steps.select_service(
      { phone: '971500', context: {} },
      { id: 'cust1' },
      { buttonId: 'SVC_svc1' }
    );

    const [, body, , sections] = whatsapp.sendListMessage.mock.calls.at(-1);
    expect(body).toContain('open appointment times');
    expect(sections[0].rows.map((row) => row.id)).toEqual(['DATE_2030-01-02', 'DATE_2030-01-04', 'DATE_OTHER']);
    expect(sections[0].rows[0].description).toBe('2 times available');
    expect(sessionStore.setFlow).toHaveBeenLastCalledWith(
      '971500', 'booking', 'select_date', expect.objectContaining({ offeredDates: ['2030-01-02', '2030-01-04'] })
    );
  });

  it('says so plainly when the CRM has no availability in the whole window', async () => {
    fakeCrm.getAvailabilityRange.mockResolvedValue([{ date: '2030-01-02', slots: [] }]);
    fakeCrm.getServiceDetails.mockResolvedValue({ id: 'svc1', name: 'Plumbing' });
    fakeCrm.getCustomerProperties.mockResolvedValue([{ id: 'prop1', label: 'Home', addressLine: 'Villa 1', isDefault: true }]);

    await booking.steps.select_service({ phone: '971500', context: {} }, { id: 'cust1' }, { buttonId: 'SVC_svc1' });

    expect(whatsapp.sendText.mock.calls.at(-1)[1]).toContain('no open appointment times in the next');
    expect(whatsapp.sendButtons).not.toHaveBeenCalledWith('971500', expect.anything(), expect.arrayContaining([
      expect.objectContaining({ id: 'DATE_TODAY' }),
    ]));
  });

  it('falls back to Today/Tomorrow when the range lookup fails', async () => {
    fakeCrm.getAvailabilityRange.mockRejectedValue(new Error('CRM down'));
    fakeCrm.getServiceDetails.mockResolvedValue({ id: 'svc1', name: 'Plumbing' });
    fakeCrm.getCustomerProperties.mockResolvedValue([{ id: 'prop1', label: 'Home', addressLine: 'Villa 1', isDefault: true }]);

    await booking.steps.select_service({ phone: '971500', context: {} }, { id: 'cust1' }, { buttonId: 'SVC_svc1' });

    expect(whatsapp.sendButtons.mock.calls.at(-1)[2].map((button) => button.id)).toEqual(['DATE_TODAY', 'DATE_TOMORROW']);
  });

  it('accepts a listed date and shows CRM time ranges with their slot ids', async () => {
    fakeCrm.getAvailability.mockResolvedValue([
      { id: 'crm-a', start: '09:00', end: '11:00' },
      { id: 'crm-b', start: '13:00', end: '15:00' },
    ]);

    await booking.steps.select_date(
      { phone: '971500', context: { ...baseContext, offeredDates: ['2030-01-02'] } },
      { id: 'cust1' },
      { buttonId: 'DATE_2030-01-02' }
    );

    expect(fakeCrm.getAvailability).toHaveBeenCalledWith('svc1', '2030-01-02');
    expect(whatsapp.sendButtons.mock.calls.at(-1)[2]).toEqual([
      { id: 'SLOT_crm-a', title: '9:00 AM – 11:00 AM' },
      { id: 'SLOT_crm-b', title: '1:00 PM – 3:00 PM' },
    ]);
  });

  it('rejects a past date without querying availability', async () => {
    await booking.steps.select_date(
      { phone: '971500', context: baseContext },
      { id: 'cust1' },
      { text: '2020-01-01' }
    );
    expect(fakeCrm.getAvailability).not.toHaveBeenCalled();
    expect(whatsapp.sendText.mock.calls.at(-1)[1]).toContain('already passed');
  });

  it('carries the chosen CRM slot id and end time into the final review', async () => {
    const slots = [
      { id: 'crm-a', start: '09:00', end: '11:00', label: '9:00 AM – 11:00 AM' },
      { id: 'crm-b', start: '13:00', end: '15:00', label: '1:00 PM – 3:00 PM' },
    ];

    await booking.steps.select_slot(
      { phone: '971500', context: { ...baseContext, date: '2030-01-02', availableSlots: slots } },
      { id: 'cust1' },
      { buttonId: 'SLOT_crm-b' }
    );

    expect(sessionStore.setFlow).toHaveBeenLastCalledWith('971500', 'booking', 'confirm', expect.objectContaining({
      cart: [expect.objectContaining({ time: '13:00', timeEnd: '15:00', slotId: 'crm-b' })],
    }));
    expect(whatsapp.sendButtons.mock.calls.at(-1)[1]).toContain('1:00 PM – 3:00 PM');
  });

  it('refuses a slot button that was not offered for the current date', async () => {
    await booking.steps.select_slot(
      { phone: '971500', context: { ...baseContext, date: '2030-01-02', availableSlots: [{ id: '09:00', start: '09:00' }] } },
      { id: 'cust1' },
      { buttonId: 'SLOT_17:00' }
    );

    expect(sessionStore.setFlow).not.toHaveBeenCalled();
    expect(whatsapp.sendText.mock.calls.at(-1)[1]).toContain('no longer on offer');
  });
});

describe('booking flow — select_service step', () => {
  beforeEach(resetAll);

  it('prompts for a new address when the customer has none on file', async () => {
    fakeCrm.getServiceDetails.mockResolvedValue({ id: 'svc1', name: 'AC Service', basePrice: 150 });
    fakeCrm.getCustomerProperties.mockResolvedValue([]);

    const session = { phone: '971500', context: {} };
    await booking.steps.select_service(session, { id: 'cust1' }, { buttonId: 'SVC_svc1' });

    expect(whatsapp.sendText).toHaveBeenCalled();
    expect(sessionStore.setFlow).toHaveBeenCalledWith(
      '971500', 'booking', 'awaiting_new_property',
      expect.objectContaining({ serviceId: 'svc1', serviceName: 'AC Service', serviceMatchSource: 'button' })
    );
    expect(intentService.matchServiceToCatalog).not.toHaveBeenCalled();
  });

  it('matches a service from free text by category, even mid-flow', async () => {
    fakeCrm.getServices.mockResolvedValue([
      { id: 'svc1', name: 'AC Service & Repair', category: 'ac', basePrice: 150 },
      { id: 'svc2', name: 'Plumbing', category: 'plumbing', basePrice: 100 },
    ]);
    fakeCrm.getCustomerProperties.mockResolvedValue([]);

    const session = { phone: '971500', context: {} };
    await booking.steps.select_service(session, { id: 'cust1' }, { text: 'enik ac service venam' });

    expect(sessionStore.setFlow).toHaveBeenCalledWith(
      '971500', 'booking', 'awaiting_new_property',
      expect.objectContaining({ serviceId: 'svc1' })
    );
  });

  it('re-shows the service list when free text matches nothing', async () => {
    fakeCrm.getServices.mockResolvedValue([{ id: 'svc1', name: 'AC Service & Repair', category: 'ac', basePrice: 150 }]);

    const session = { phone: '971500', context: {} };
    await booking.steps.select_service(session, { id: 'cust1' }, { text: 'what time do you close' });

    expect(whatsapp.sendListMessage).toHaveBeenCalledWith(
      '971500', expect.stringContaining('not sure which of our services covers that'), 'Choose service', expect.any(Array)
    );
    expect(fakeCrm.getCustomerProperties).not.toHaveBeenCalled();
  });

  it('uses an unambiguous semantic hint without calling AI', async () => {
    fakeCrm.getServices.mockResolvedValue([
      { id: 'svc-electrical', name: 'Electrical', category: 'electrical' },
      { id: 'svc-plumbing', name: 'Plumbing', category: 'plumbing' },
    ]);
    const session = { phone: '971500', context: {} };

    await booking.steps.select_service(session, { id: 'cust1' }, { text: 'light is not working' });

    expect(sessionStore.setFlow).toHaveBeenCalledWith(
      '971500', 'booking', 'awaiting_new_property',
      expect.objectContaining({ serviceId: 'svc-electrical', issue: 'light is not working', serviceMatchSource: 'semantic_hint' })
    );
    expect(intentService.matchServiceToCatalog).not.toHaveBeenCalled();
    expect(fakeCrm.createBooking).not.toHaveBeenCalled();
  });

  it('asks for confirmation on a medium-confidence Gemini match', async () => {
    fakeCrm.getServices.mockResolvedValue([{ id: 'svc-appliance', name: 'Appliance Repair', category: 'appliances' }]);
    intentService.matchServiceToCatalog.mockResolvedValue({ serviceId: 'svc-appliance', confidence: 0.74 });

    await booking.steps.select_service(
      { phone: '971500', context: {}, preferredLanguage: 'en' },
      { id: 'cust1' },
      { text: 'my machine makes an odd sound' }
    );

    expect(sessionStore.setFlow).toHaveBeenCalledWith(
      '971500', 'booking', 'confirm_service',
      expect.objectContaining({ inferredServiceId: 'svc-appliance', serviceMatchSource: 'ai', serviceMatchConfidence: 0.74 })
    );
  });

  it('continues immediately on a high-confidence Gemini catalog match', async () => {
    fakeCrm.getServices.mockResolvedValue([{ id: 'svc-appliance', name: 'Appliance Repair', category: 'appliances' }]);
    intentService.matchServiceToCatalog.mockResolvedValue({ serviceId: 'svc-appliance', confidence: 0.91 });

    await booking.steps.select_service(
      { phone: '971500', context: {}, preferredLanguage: 'en' },
      { id: 'cust1' },
      { text: 'my machine makes an odd sound' }
    );

    expect(sessionStore.setFlow).toHaveBeenCalledWith(
      '971500', 'booking', 'awaiting_new_property',
      expect.objectContaining({ serviceId: 'svc-appliance', serviceMatchSource: 'ai', serviceMatchConfidence: 0.91 })
    );
    expect(whatsapp.sendButtons).not.toHaveBeenCalled();
  });

  it('falls back to the service list for an ambiguous low-confidence request', async () => {
    fakeCrm.getServices.mockResolvedValue([
      { id: 'svc1', name: 'Electrical' },
      { id: 'svc2', name: 'Appliance Repair' },
    ]);
    intentService.matchServiceToCatalog.mockResolvedValue({ serviceId: null, confidence: 0.35 });

    await booking.steps.select_service({ phone: '971500', context: {} }, { id: 'cust1' }, { text: 'something is broken' });

    expect(sessionStore.setFlow).toHaveBeenCalledWith(
      '971500', 'booking', 'select_service', expect.objectContaining({ missingFields: expect.any(Array) })
    );
    expect(whatsapp.sendListMessage).toHaveBeenCalled();
  });
});

describe('booking flow — hybrid field collection', () => {
  beforeEach(resetAll);

  it('shows CRM-backed kitchen recommendations as one direct-button message', async () => {
    fakeCrm.getServices.mockResolvedValue([
      { id: 'clean', name: 'Kitchen Cleaning', category: 'cleaning' },
      { id: 'plumb', name: 'Plumbing', category: 'plumbing' },
      { id: 'electric', name: 'Electrical', category: 'electrical' },
      { id: 'appliance', name: 'Appliance Repair', category: 'appliances' },
      { id: 'pest', name: 'Pest Control', category: 'pest-control' },
      { id: 'ac', name: 'AC Service', category: 'ac' },
    ]);

    await booking.startBooking(
      { phone: '971500', context: {} },
      { id: 'cust1' },
      { text: 'kitchen', ai: { intent: 'NEW_BOOKING', room: 'kitchen', confidence: 0.82 } }
    );

    expect(whatsapp.sendButtons).toHaveBeenCalledTimes(1);
    expect(whatsapp.sendButtons).toHaveBeenCalledWith(
      '971500', 'I can help with your kitchen. What do you need?',
      [
        { id: 'SVC_clean', title: 'Kitchen Cleaning' },
        { id: 'SVC_plumb', title: 'Plumbing' },
        { id: 'MORE_SERVICES', title: 'More Services' },
      ]
    );
    expect(whatsapp.sendListMessage).not.toHaveBeenCalled();
  });

  it('filters kitchen recommendations by the saved location before showing them', async () => {
    fakeCrm.getServices.mockResolvedValue([
      { id: 'clean', name: 'Kitchen Cleaning', category: 'cleaning' },
      { id: 'plumb', name: 'Plumbing', category: 'plumbing' },
      { id: 'electric', name: 'Electrical', category: 'electrical' },
    ]);
    fakeCrm.getCustomerProperties.mockResolvedValue([
      { id: 'home', label: 'Kakkanad home', addressLine: 'Kakkanad', area: 'Kakkanad', isDefault: true },
    ]);
    fakeCrm.checkServiceability.mockImplementation(async (serviceId) => ({
      serviceable: serviceId !== 'clean', source: 'crm',
    }));

    await booking.startBooking(
      { phone: '971500', context: {} }, { id: 'cust1' },
      { text: 'kitchen', ai: { intent: 'NEW_BOOKING', room: 'kitchen', confidence: 0.82 } }
    );

    expect(fakeCrm.checkServiceability).toHaveBeenCalledTimes(3);
    expect(whatsapp.sendButtons).toHaveBeenCalledWith(
      '971500', 'I can help with your kitchen. What do you need?',
      [
        { id: 'SVC_plumb', title: 'Plumbing' },
        { id: 'SVC_electric', title: 'Electrical' },
      ]
    );
    expect(sessionStore.setFlow).toHaveBeenCalledWith(
      '971500', 'booking', 'select_service',
      expect.objectContaining({
        propertyId: 'home', serviceabilityFiltered: true,
        recommendedServices: [{ id: 'plumb', name: 'Plumbing' }, { id: 'electric', name: 'Electrical' }],
      })
    );
  });

  it('asks for another address when every relevant service is unavailable, then retries recommendations', async () => {
    const services = [
      { id: 'clean', name: 'Kitchen Cleaning', category: 'cleaning' },
      { id: 'plumb', name: 'Plumbing', category: 'plumbing' },
    ];
    fakeCrm.getServices.mockResolvedValue(services);
    fakeCrm.getCustomerProperties.mockResolvedValue([
      { id: 'home', label: 'Home', addressLine: 'Outside Area', area: 'Outside Area', isDefault: true },
    ]);
    fakeCrm.addProperty.mockResolvedValue({ id: 'alternate', addressLine: 'Dubai Marina', area: 'Dubai Marina' });
    fakeCrm.checkServiceability.mockImplementation(async (_serviceId, location) => ({
      serviceable: location.address === 'Dubai Marina', source: 'crm',
    }));

    await booking.startBooking(
      { phone: '971500', context: {} }, { id: 'cust1' },
      { text: 'kitchen', ai: { intent: 'NEW_BOOKING', room: 'kitchen', confidence: 0.82 } }
    );

    expect(whatsapp.sendButtons).not.toHaveBeenCalled();
    expect(whatsapp.sendListMessage).not.toHaveBeenCalled();
    expect(whatsapp.sendText).toHaveBeenCalledWith(
      '971500', expect.stringContaining('Please send another service address')
    );
    expect(sessionStore.setFlow).toHaveBeenLastCalledWith(
      '971500', 'booking', 'recommendation_location',
      expect.objectContaining({
        room: 'kitchen', propertyId: undefined, location: undefined,
        recommendedServices: [], excludedServiceIds: ['clean', 'plumb'],
      })
    );

    whatsapp.sendText.mockClear();
    await booking.steps.recommendation_location(
      { phone: '971500', context: { room: 'kitchen', issue: null } },
      { id: 'cust1' },
      { text: 'Dubai Marina' }
    );

    expect(fakeCrm.addProperty).toHaveBeenCalledWith('cust1', { addressLine: 'Dubai Marina' });
    expect(whatsapp.sendButtons).toHaveBeenCalledWith(
      '971500', 'I can help with your kitchen. What do you need?',
      [
        { id: 'SVC_clean', title: 'Kitchen Cleaning' },
        { id: 'SVC_plumb', title: 'Plumbing' },
      ]
    );
    expect(sessionStore.setFlow).toHaveBeenLastCalledWith(
      '971500', 'booking', 'select_service',
      expect.objectContaining({ propertyId: 'alternate', serviceabilityFiltered: true })
    );
  });

  it('skips service selection when the initial message says electrician', async () => {
    fakeCrm.getServices.mockResolvedValue([{ id: 'svc-electrical', name: 'Electrical', category: 'electrical' }]);

    await booking.startBooking({ phone: '971500', context: {} }, { id: 'cust1' }, {
      text: 'I want to book electrician',
      ai: { service: 'electrician', confidence: 0.96 },
    });

    expect(sessionStore.setFlow).toHaveBeenCalledWith(
      '971500', 'booking', 'awaiting_new_property',
      expect.objectContaining({ serviceId: 'svc-electrical', serviceMatchSource: 'semantic_hint' })
    );
    expect(whatsapp.sendListMessage).not.toHaveBeenCalled();
    expect(whatsapp.sendButtons).not.toHaveBeenCalled();
    expect(analytics.getTestEvents('971500').map((event) => event.eventType))
      .toEqual(expect.arrayContaining(['BOOKING_STARTED', 'SERVICE_SELECTED']));
  });

  it('prefills known fields and reuses a matching saved address without asking again', async () => {
    fakeCrm.getServices.mockResolvedValue([{ id: 'svc-plumbing', name: 'Plumbing', category: 'plumbing' }]);
    fakeCrm.getCustomerProperties.mockResolvedValue([
      { id: 'prop1', label: 'Kakkanad flat', addressLine: 'Kakkanad, Kochi', area: 'Kakkanad' },
    ]);
    fakeCrm.getAvailability.mockResolvedValue(['09:00', '17:00']);
    const session = { phone: '971500', context: {}, preferredLanguage: 'manglish' };
    await booking.startBooking(session, { id: 'cust1' }, {
      text: 'Nale evening Kakkanad flatil plumber venam, kitchen tap leak aanu',
      ai: {
        service: 'Plumbing', issue: 'Kitchen tap leaking', locationHint: 'Kakkanad flat',
        preferredDate: 'tomorrow', preferredTime: 'evening', confidence: 0.96,
      },
    });
    expect(sessionStore.setFlow).toHaveBeenCalledWith(
      '971500', 'booking', 'confirm',
      expect.objectContaining({
        cart: [expect.objectContaining({ serviceId: 'svc-plumbing', propertyId: 'prop1' })],
        issue: 'Kitchen tap leaking',
      })
    );
    expect(whatsapp.sendButtons).toHaveBeenCalledWith(
      '971500', expect.stringContaining('Kakkanad flat'), [
        expect.objectContaining({ id: 'CONFIRM_BOOKING' }),
        expect.objectContaining({ id: 'CHANGE_DETAILS' }),
        expect.objectContaining({ id: 'CANCEL_FLOW' }),
      ]
    );
    expect(whatsapp.sendText).not.toHaveBeenCalled();
    expect(whatsapp.sendListMessage).not.toHaveBeenCalled();
    expect(sessionStore.setFlow).not.toHaveBeenCalledWith(
      '971500', 'booking', 'select_date', expect.anything()
    );
  });

  it('reuses a returning customer default property and asks only for the missing time', async () => {
    fakeCrm.getServices.mockResolvedValue([{ id: 'svc-plumbing', name: 'Plumbing', category: 'plumbing' }]);
    fakeCrm.getCustomerProperties.mockResolvedValue([
      { id: 'prop-home', label: 'Kakkanad home', addressLine: 'Kakkanad, Kochi', area: 'Kakkanad', isDefault: true },
    ]);
    fakeCrm.getAvailability.mockResolvedValue(['09:00', '17:00']);

    await booking.startBooking(
      { phone: '971500', context: {} },
      { id: 'cust1', name: 'John' },
      { text: 'plumber tomorrow', ai: { service: 'Plumbing', preferredDate: 'tomorrow', confidence: 0.96 } }
    );

    expect(fakeCrm.checkServiceability).toHaveBeenCalledWith(
      'svc-plumbing', expect.objectContaining({ propertyId: 'prop-home', source: 'saved_property' })
    );
    expect(fakeCrm.getAvailability).toHaveBeenCalledTimes(1);
    expect(whatsapp.sendButtons).toHaveBeenCalledWith(
      '971500', expect.stringContaining('Certainly, John.'),
      [
        { id: 'SLOT_09:00', title: '9:00 AM' },
        { id: 'SLOT_17:00', title: '5:00 PM' },
      ]
    );
    expect(whatsapp.sendText).not.toHaveBeenCalledWith('971500', expect.stringContaining('address'));
  });

  it('uses the only available slot and goes directly to compact review', async () => {
    fakeCrm.getServices.mockResolvedValue([{ id: 'svc-plumbing', name: 'Plumbing', category: 'plumbing' }]);
    fakeCrm.getCustomerProperties.mockResolvedValue([
      { id: 'home', label: 'Home', addressLine: 'Kakkanad', area: 'Kakkanad', isDefault: true },
    ]);
    fakeCrm.getAvailability.mockResolvedValue(['17:00']);

    await booking.startBooking(
      { phone: '971500', context: {} }, { id: 'cust1', name: 'John' },
      { text: 'plumber tomorrow', ai: { service: 'Plumbing', preferredDate: 'tomorrow', confidence: 0.96 } }
    );

    expect(whatsapp.sendButtons).toHaveBeenCalledTimes(1);
    expect(whatsapp.sendButtons).toHaveBeenCalledWith(
      '971500', expect.stringContaining('Please review your booking details'),
      expect.arrayContaining([{ id: 'CONFIRM_BOOKING', title: 'Confirm Booking' }])
    );
    expect(sessionStore.setFlow).toHaveBeenCalledWith(
      '971500', 'booking', 'confirm', expect.objectContaining({ cart: [expect.objectContaining({ time: '17:00' })] })
    );
    expect(whatsapp.sendText).not.toHaveBeenCalled();
    expect(whatsapp.sendListMessage).not.toHaveBeenCalled();
  });

  it('rejects an unserviceable address before looking up slots', async () => {
    fakeCrm.getServiceDetails.mockResolvedValue({ id: 'svc1', name: 'Plumbing' });
    fakeCrm.getCustomerProperties.mockResolvedValue([
      { id: 'prop1', label: 'Home', addressLine: 'Outside Area', isDefault: true },
    ]);
    fakeCrm.checkServiceability.mockResolvedValue({ serviceable: false });

    await booking.steps.select_service(
      { phone: '971500', context: { date: '2031-10-02' } },
      { id: 'cust1' },
      { buttonId: 'SVC_svc1' }
    );

    expect(fakeCrm.checkServiceability).toHaveBeenCalledTimes(1);
    expect(fakeCrm.getAvailability).not.toHaveBeenCalled();
    expect(whatsapp.sendButtons).toHaveBeenCalledWith(
      '971500',
      expect.stringContaining('outside our service area for Plumbing'),
      // Its only saved address is the refused one, so no "Saved Addresses".
      [{ id: 'MAIN_MENU', title: 'Main Menu' }]
    );
    const [, , step, context] = sessionStore.setFlow.mock.calls.at(-1);
    expect(step).toBe('awaiting_new_property');
    expect(context.propertyId).toBeUndefined();
  });

  it('keeps the customer in the date step after invalid input', async () => {
    await booking.steps.select_date(
      { phone: '971500', context: { serviceId: 'svc1', propertyId: 'prop1' } },
      { id: 'cust1' },
      { text: 'sometime later' }
    );
    expect(fakeCrm.getAvailability).not.toHaveBeenCalled();
    expect(sessionStore.setFlow).not.toHaveBeenCalled();
    expect(whatsapp.sendText).toHaveBeenCalledWith('971500', expect.stringContaining("couldn't identify that date"));
  });

  it('matches a saved property from a voice transcript', async () => {
    fakeCrm.getCustomerProperties.mockResolvedValue([
      { id: 'prop1', label: 'Kakkanad flat', addressLine: 'Kakkanad, Kochi', area: 'Kakkanad', city: 'Kochi' },
      { id: 'prop2', label: 'Office', addressLine: 'Dubai', city: 'Dubai' },
    ]);
    await booking.steps.select_property(
      {
        phone: '971500',
        context: {
          serviceId: 'svc1', serviceName: 'Plumbing',
          propertyOptions: { prop1: 'Kakkanad flat — Kakkanad, Kochi', prop2: 'Office — Dubai' },
        },
      },
      { id: 'cust1' },
      { text: 'My Kakkanad flat', source: 'voice', voice: { mediaId: 'voice-address' } }
    );

    expect(sessionStore.setFlow).toHaveBeenCalledWith(
      '971500', 'booking', 'select_date',
      expect.objectContaining({ propertyId: 'prop1', propertyLabel: 'Kakkanad flat — Kakkanad, Kochi' })
    );
  });

  it('confirms a default property only after revalidating it against CRM', async () => {
    const property = { id: 'prop1', label: 'Home', addressLine: 'Villa 2', area: 'Jumeirah', isDefault: true };
    fakeCrm.getServiceDetails.mockResolvedValue({ id: 'svc1', name: 'AC Service' });
    fakeCrm.getCustomerProperties.mockResolvedValue([property]);

    await booking.steps.confirm_default_property(
      { phone: '971500', context: { serviceId: 'svc1', serviceName: 'AC Service', suggestedPropertyId: 'prop1' } },
      { id: 'cust1' },
      { buttonId: 'CONFIRM_DEFAULT_PROPERTY' }
    );

    expect(fakeCrm.getCustomerProperties).toHaveBeenCalledWith('cust1');
    expect(sessionStore.setFlow).toHaveBeenCalledWith(
      '971500', 'booking', 'select_date', expect.objectContaining({ propertyId: 'prop1' })
    );
  });

  it('does not use a saved property that was removed from CRM', async () => {
    fakeCrm.getServiceDetails.mockResolvedValue({ id: 'svc1', name: 'AC Service' });
    fakeCrm.getCustomerProperties.mockResolvedValue([]);

    await booking.steps.confirm_default_property(
      { phone: '971500', context: { serviceId: 'svc1', suggestedPropertyId: 'removed' } },
      { id: 'cust1' },
      { buttonId: 'CONFIRM_DEFAULT_PROPERTY' }
    );

    expect(whatsapp.sendText).toHaveBeenCalledWith('971500', expect.stringContaining('no longer available'));
    expect(sessionStore.setFlow).toHaveBeenCalledWith('971500', 'booking', 'awaiting_new_property', expect.any(Object));
  });

  it('orders alternate saved addresses by default and then recent use', async () => {
    const properties = [
      { id: 'old', label: 'Old Home', addressLine: 'Old Street' },
      { id: 'recent', label: 'Office', addressLine: 'Business Bay' },
      { id: 'default', label: 'Home', addressLine: 'Jumeirah', isDefault: true },
    ];
    fakeCrm.getServiceDetails.mockResolvedValue({ id: 'svc1', name: 'AC Service' });
    fakeCrm.getCustomerProperties.mockResolvedValue(properties);
    const session = {
      phone: '971500',
      customerProfile: { recentBookings: [{ propertyId: 'recent' }] },
      context: { serviceId: 'svc1', suggestedPropertyId: 'default' },
    };

    await booking.steps.confirm_default_property(
      session, { id: 'cust1' }, { buttonId: 'CHOOSE_ANOTHER_PROPERTY' }
    );

    const rows = whatsapp.sendListMessage.mock.calls[0][3][0].rows;
    expect(rows.slice(0, 3).map((row) => row.id)).toEqual(['PROP_default', 'PROP_recent', 'PROP_old']);
  });

  it('uses voice-extracted date and time while retaining CRM slot validation', async () => {
    fakeCrm.getAvailability.mockResolvedValue(['09:00', '17:00']);
    await booking.steps.select_date(
      {
        phone: '971500',
        context: { serviceId: 'svc1', serviceName: 'Plumbing', propertyId: 'prop1', propertyLabel: 'Home' },
      },
      { id: 'cust1' },
      {
        text: 'day after tomorrow after five in the evening',
        source: 'voice',
        voice: { mediaId: 'voice-date-time' },
        ai: { preferredDate: 'day after tomorrow', preferredTime: 'after five in the evening' },
      }
    );

    expect(sessionStore.setFlow).toHaveBeenCalledWith(
      '971500', 'booking', 'confirm',
      expect.objectContaining({ cart: [expect.objectContaining({ time: '17:00' })] })
    );
  });

  it('moves from slot selection directly to one compact confirmation message', async () => {
    await booking.steps.select_slot(
      {
        phone: '971500',
        context: {
          serviceId: 'svc1', serviceName: 'Plumbing', room: 'kitchen', issue: 'Kitchen sink leak',
          propertyId: 'prop1', propertyLabel: 'Kakkanad', date: '2031-10-02', availableSlots: ['10:00'],
        },
      },
      { id: 'cust1' },
      { buttonId: 'SLOT_10:00' }
    );

    expect(whatsapp.sendButtons).toHaveBeenCalledTimes(1);
    expect(whatsapp.sendButtons).toHaveBeenCalledWith(
      '971500', expect.stringMatching(/Plumbing[\s\S]*Kakkanad[\s\S]*Kitchen sink leak/),
      [
        { id: 'CONFIRM_BOOKING', title: 'Confirm Booking' },
        { id: 'CHANGE_DETAILS', title: 'Change Details' },
        { id: 'CANCEL_FLOW', title: 'Cancel' },
      ]
    );
    expect(sessionStore.setFlow).toHaveBeenCalledWith(
      '971500', 'booking', 'confirm', expect.objectContaining({ cart: [expect.objectContaining({ time: '10:00' })] })
    );
  });

  it('completes the button-driven path through review and explicit confirmation', async () => {
    fakeCrm.getServices.mockResolvedValue([{ id: 'svc1', name: 'Plumbing', category: 'plumbing' }]);
    fakeCrm.getServiceDetails.mockResolvedValue({ id: 'svc1', name: 'Plumbing' });
    fakeCrm.getCustomerProperties.mockResolvedValue([
      { id: 'prop1', label: 'Home', addressLine: 'Kakkanad, Kochi', area: 'Kakkanad' },
    ]);
    fakeCrm.getAvailability.mockResolvedValue(['09:00']);
    fakeCrm.createBooking.mockResolvedValue({ reference: 'BK-FULL', scheduledDate: '2031-10-01', scheduledTime: '09:00' });

    await booking.steps.select_service({ phone: '971500', context: {} }, { id: 'cust1' }, { buttonId: 'SVC_svc1' });
    await booking.steps.select_property(
      { phone: '971500', context: { serviceId: 'svc1', serviceName: 'Plumbing', propertyOptions: { prop1: 'Home — Kakkanad' } } },
      { id: 'cust1' }, { buttonId: 'PROP_prop1' }
    );
    await booking.steps.select_date(
      { phone: '971500', context: { serviceId: 'svc1', serviceName: 'Plumbing', propertyId: 'prop1', propertyLabel: 'Home — Kakkanad' } },
      { id: 'cust1' }, { text: '2031-10-01' }
    );
    await booking.steps.select_slot(
      { phone: '971500', context: { serviceId: 'svc1', serviceName: 'Plumbing', propertyId: 'prop1', propertyLabel: 'Home — Kakkanad', date: '2031-10-01' } },
      { id: 'cust1' }, { buttonId: 'SLOT_09:00' }
    );
    const item = { serviceId: 'svc1', serviceName: 'Plumbing', propertyId: 'prop1', propertyLabel: 'Home — Kakkanad', date: '2031-10-01', time: '09:00', issue: null };
    await booking.steps.review_item(
      { phone: '971500', context: { cart: [], currentItem: item } },
      { id: 'cust1' }, { buttonId: 'PROCEED_TO_BOOKING' }
    );
    await booking.steps.confirm(
      { phone: '971500', context: { cart: [item] } },
      { id: 'cust1' }, { buttonId: 'CONFIRM_BOOKING' }
    );

    expect(fakeCrm.createBooking).toHaveBeenCalledTimes(1);
    expect(whatsapp.sendButtons.mock.calls.at(-1)[1]).toContain('Your booking is confirmed');
  });

  it('adds another service to the session cart without creating a booking early', async () => {
    fakeCrm.getServices.mockResolvedValue([{ id: 'svc2', name: 'Electrical' }]);
    const item = { serviceId: 'svc1', serviceName: 'Plumbing', propertyId: 'prop1', propertyLabel: 'Home', date: '2031-10-01', time: '09:00' };

    await booking.steps.review_item(
      { phone: '971500', context: { cart: [], currentItem: item } },
      { id: 'cust1' }, { buttonId: 'ADD_ANOTHER_SERVICE' }
    );

    expect(fakeCrm.createBooking).not.toHaveBeenCalled();
    expect(sessionStore.setFlow).toHaveBeenCalledWith(
      '971500', 'booking', 'select_service',
      expect.objectContaining({ cart: [item], propertyId: 'prop1', date: '2031-10-01' })
    );
  });

  it('offers specific choices when the customer asks to change details', async () => {
    const item = { serviceId: 'svc1', serviceName: 'Plumbing', propertyId: 'prop1', propertyLabel: 'Home', date: '2031-10-01', time: '09:00' };

    await booking.steps.review_item(
      { phone: '971500', context: { cart: [], currentItem: item } },
      { id: 'cust1' }, { buttonId: 'CHANGE_BOOKING_DETAILS' }
    );

    expect(whatsapp.sendButtons).toHaveBeenCalledWith(
      '971500',
      expect.stringContaining('Which booking detail'),
      [
        { id: 'CHANGE_SERVICE', title: 'Change Service' },
        { id: 'CHANGE_PROPERTY', title: 'Change Address' },
        { id: 'CHANGE_MORE', title: 'More Changes' },
      ]
    );
    expect(sessionStore.setFlow).toHaveBeenCalledWith(
      '971500', 'booking', 'change_details', { cart: [], currentItem: item }
    );
  });
});

describe('booking flow — smart review and corrections', () => {
  const item = () => ({
    serviceId: 'svc-electrical',
    serviceName: 'Electrical',
    propertyId: 'prop-home',
    propertyLabel: 'Home — Kakkanad',
    date: '2031-10-01',
    time: '09:00',
    issue: 'Bedroom light is not working',
  });

  beforeEach(resetAll);

  it('shows the final review summary and required actions without creating a booking', async () => {
    await booking.steps.review_item(
      { phone: '971500', context: { cart: [], currentItem: item() } },
      { id: 'cust1' },
      { buttonId: 'PROCEED_TO_BOOKING' }
    );

    expect(whatsapp.sendButtons).toHaveBeenCalledWith(
      '971500',
      expect.stringMatching(/Please review your booking details:[\s\S]*Service: Electrical[\s\S]*Location: Home — Kakkanad[\s\S]*Date:[\s\S]*Time:/),
      [
        { id: 'CONFIRM_BOOKING', title: 'Confirm Booking' },
        { id: 'CHANGE_DETAILS', title: 'Change Details' },
        { id: 'CANCEL_FLOW', title: 'Cancel' },
      ]
    );
    expect(fakeCrm.createBooking).not.toHaveBeenCalled();
  });

  it('asks before cancelling and never writes a CRM booking', async () => {
    const context = { cart: [item()], confirmationNonce: 'review-1' };
    await booking.steps.confirm({ phone: '971500', context }, { id: 'cust1' }, { buttonId: 'CANCEL_FLOW' });

    expect(sessionStore.clearFlow).not.toHaveBeenCalled();
    expect(sessionStore.setFlow).toHaveBeenCalledWith('971500', 'booking', 'confirm_cancel', context);
    expect(whatsapp.sendButtons).toHaveBeenCalledWith(
      '971500',
      'Would you like to cancel this booking request?',
      [
        { id: 'CONFIRM_CANCEL_FLOW', title: 'Yes, Cancel' },
        { id: 'KEEP_BOOKING', title: 'Keep Booking' },
      ]
    );

    await booking.steps.confirm_cancel({ phone: '971500', context }, { id: 'cust1' }, { buttonId: 'CONFIRM_CANCEL_FLOW' });
    expect(sessionStore.clearFlow).toHaveBeenCalledWith('971500');
    expect(fakeCrm.createBooking).not.toHaveBeenCalled();
  });

  it('changes service while preserving address/date and invalidating the slot', async () => {
    fakeCrm.getServices.mockResolvedValue([{ id: 'svc-plumbing', name: 'Plumbing', category: 'plumbing' }]);
    await booking.steps.change_details(
      { phone: '971500', context: { cart: [], currentItem: item() } },
      { id: 'cust1' },
      { buttonId: 'CHANGE_SERVICE' }
    );
    const correctionState = sessionStore.setFlow.mock.calls.at(-1)[3];
    expect(correctionState).toMatchObject({
      propertyId: 'prop-home', date: '2031-10-01', correctionMode: true, correctionFields: ['service'],
    });
    expect(correctionState.time).toBeUndefined();

    fakeCrm.getServiceDetails.mockResolvedValue({ id: 'svc-plumbing', name: 'Plumbing' });
    fakeCrm.getAvailability.mockResolvedValue(['11:00']);
    await booking.steps.select_service(
      { phone: '971500', context: correctionState },
      { id: 'cust1' },
      { buttonId: 'SVC_svc-plumbing' }
    );

    expect(fakeCrm.getAvailability).toHaveBeenCalledWith('svc-plumbing', '2031-10-01');
    const slotState = sessionStore.setFlow.mock.calls.at(-1)[3];
    await booking.steps.select_slot(
      { phone: '971500', context: slotState },
      { id: 'cust1' },
      { buttonId: 'SLOT_11:00' }
    );
    expect(sessionStore.setFlow).toHaveBeenLastCalledWith(
      '971500', 'booking', 'confirm',
      expect.objectContaining({
        cart: [expect.objectContaining({ serviceName: 'Plumbing', propertyId: 'prop-home', date: '2031-10-01', time: '11:00' })],
        correctionDebug: expect.objectContaining({ changedField: 'service', previousValue: 'Electrical', newValue: 'Plumbing' }),
      })
    );
  });

  it('offers saved addresses and keeps service/date when changing address', async () => {
    fakeCrm.getServiceDetails.mockResolvedValue({ id: 'svc-electrical', name: 'Electrical' });
    fakeCrm.getCustomerProperties.mockResolvedValue([
      { id: 'prop-home', label: 'Home', addressLine: 'Kakkanad', area: 'Kakkanad' },
      { id: 'prop-office', label: 'Office', addressLine: 'Business Bay', area: 'Dubai' },
    ]);

    await booking.steps.change_details(
      { phone: '971500', context: { cart: [], currentItem: item() } },
      { id: 'cust1' },
      { buttonId: 'CHANGE_PROPERTY' }
    );

    expect(sessionStore.setFlow).toHaveBeenCalledWith(
      '971500', 'booking', 'select_property',
      expect.objectContaining({ serviceId: 'svc-electrical', date: '2031-10-01', time: undefined, correctionMode: true })
    );
    expect(fakeCrm.createBooking).not.toHaveBeenCalled();
  });

  it('uses the More Changes submenu for separate date and time controls', async () => {
    await booking.steps.change_details(
      { phone: '971500', context: { cart: [], currentItem: item() } },
      { id: 'cust1' },
      { buttonId: 'CHANGE_MORE' }
    );
    expect(whatsapp.sendButtons).toHaveBeenCalledWith('971500', 'What else would you like to change?', [
      { id: 'CHANGE_DATE', title: 'Change Date' },
      { id: 'CHANGE_TIME', title: 'Change Time' },
      { id: 'BACK_TO_REVIEW', title: 'Back to Review' },
    ]);

    await booking.steps.change_more(
      { phone: '971500', context: { cart: [], currentItem: item() } },
      { id: 'cust1' },
      { buttonId: 'CHANGE_DATE' }
    );
    expect(sessionStore.setFlow).toHaveBeenLastCalledWith(
      '971500', 'booking', 'select_date',
      expect.objectContaining({ serviceId: 'svc-electrical', propertyId: 'prop-home', date: undefined, time: undefined })
    );

    fakeCrm.getAvailability.mockResolvedValue(['09:00', '17:00']);
    await booking.steps.change_more(
      { phone: '971500', context: { cart: [], currentItem: item() } },
      { id: 'cust1' },
      { buttonId: 'CHANGE_TIME' }
    );
    expect(fakeCrm.getAvailability).toHaveBeenCalledWith('svc-electrical', '2031-10-01');
    expect(sessionStore.setFlow).toHaveBeenLastCalledWith(
      '971500', 'booking', 'select_slot',
      expect.objectContaining({ date: '2031-10-01', time: undefined, correctionFields: ['time'] })
    );
    const timeState = sessionStore.setFlow.mock.calls.at(-1)[3];
    await booking.steps.select_slot(
      { phone: '971500', context: timeState },
      { id: 'cust1' },
      { buttonId: 'SLOT_17:00' }
    );
    expect(sessionStore.setFlow).toHaveBeenLastCalledWith(
      '971500', 'booking', 'confirm',
      expect.objectContaining({
        cart: [expect.objectContaining({ time: '17:00' })],
        correctionDebug: { changedField: 'time', previousValue: '09:00', newValue: '17:00' },
      })
    );
  });

  it('applies a typed date correction, clears the old slot, and returns to updated review', async () => {
    intentService.analyzeBookingCorrection.mockResolvedValue({
      service: null, locationHint: null, preferredDate: 'tomorrow', preferredTime: null, confidence: 0.98,
    });
    fakeCrm.getServiceDetails.mockResolvedValue({ id: 'svc-electrical', name: 'Electrical' });
    fakeCrm.getAvailability.mockResolvedValue(['14:00']);

    await booking.steps.confirm(
      { phone: '971500', preferredLanguage: 'en', context: { cart: [item()] } },
      { id: 'cust1' },
      { text: 'actually make it tomorrow' }
    );

    const slotState = sessionStore.setFlow.mock.calls.at(-1)[3];
    expect(fakeCrm.getAvailability).toHaveBeenCalledTimes(1);
    expect(slotState.time).toBeUndefined();
    await booking.steps.select_slot(
      { phone: '971500', context: slotState },
      { id: 'cust1' },
      { buttonId: 'SLOT_14:00' }
    );
    const finalContext = sessionStore.setFlow.mock.calls.at(-1)[3];
    expect(finalContext.cart[0].time).toBe('14:00');
    expect(finalContext.cart[0].time).not.toBe('09:00');
    expect(finalContext.correctionDebug.changedField).toBe('date');
    expect(whatsapp.sendButtons.mock.calls.at(-1)[1]).toContain('Updated. Please review the booking again:');
    expect(fakeCrm.createBooking).not.toHaveBeenCalled();
  });

  it('matches a typed saved-address correction and revalidates availability', async () => {
    intentService.analyzeBookingCorrection.mockResolvedValue({
      service: null, locationHint: 'office', preferredDate: null, preferredTime: null, confidence: 0.97,
    });
    fakeCrm.getCustomerProperties.mockResolvedValue([
      { id: 'prop-home', label: 'Home', addressLine: 'Kakkanad' },
      { id: 'prop-office', label: 'Office', addressLine: 'Business Bay', area: 'Dubai' },
    ]);
    fakeCrm.getServiceDetails.mockResolvedValue({ id: 'svc-electrical', name: 'Electrical' });
    fakeCrm.getAvailability.mockResolvedValue(['15:00']);

    await booking.steps.confirm(
      { phone: '971500', context: { cart: [item()] } },
      { id: 'cust1' },
      { text: 'use my office address' }
    );

    const slotState = sessionStore.setFlow.mock.calls.at(-1)[3];
    await booking.steps.select_slot(
      { phone: '971500', context: slotState },
      { id: 'cust1' },
      { buttonId: 'SLOT_15:00' }
    );
    expect(sessionStore.setFlow).toHaveBeenLastCalledWith(
      '971500', 'booking', 'confirm',
      expect.objectContaining({ cart: [expect.objectContaining({ propertyId: 'prop-office', time: '15:00' })] })
    );
  });

  it('accepts a directly typed new address while changing the property', async () => {
    fakeCrm.addProperty.mockResolvedValue({ id: 'prop-new', addressLine: 'Villa 12, Al Barsha, Dubai' });
    fakeCrm.getAvailability.mockResolvedValue(['12:00']);
    const context = {
      ...item(), cart: [], correctionMode: true, correctionFields: ['property'],
      correctionPreviousItem: item(), time: undefined, propertyOptions: {},
    };

    await booking.steps.select_property(
      { phone: '971500', context },
      { id: 'cust1' },
      { text: 'Villa 12, Al Barsha, Dubai' }
    );

    expect(fakeCrm.addProperty).toHaveBeenCalledWith('cust1', { addressLine: 'Villa 12, Al Barsha, Dubai' });
    expect(fakeCrm.getAvailability).toHaveBeenCalledWith('svc-electrical', '2031-10-01');
    expect(fakeCrm.createBooking).not.toHaveBeenCalled();
  });

  it('changes only the service from a natural typed correction', async () => {
    intentService.analyzeBookingCorrection.mockResolvedValue({
      service: 'Plumbing', locationHint: null, preferredDate: null, preferredTime: null, confidence: 0.99,
    });
    fakeCrm.getServices.mockResolvedValue([{ id: 'svc-plumbing', name: 'Plumbing', category: 'plumbing' }]);
    fakeCrm.getAvailability.mockResolvedValue(['10:00']);

    await booking.steps.confirm(
      { phone: '971500', context: { cart: [item()] } },
      { id: 'cust1' },
      { text: 'make it plumbing instead' }
    );

    expect(fakeCrm.getAvailability).toHaveBeenCalledWith('svc-plumbing', '2031-10-01');
    const slotState = sessionStore.setFlow.mock.calls.at(-1)[3];
    expect(slotState).toMatchObject({ serviceId: 'svc-plumbing', propertyId: 'prop-home', time: undefined });
    expect(fakeCrm.createBooking).not.toHaveBeenCalled();
  });

  it('applies a multi-field service/date/time correction from text or voice', async () => {
    intentService.analyzeBookingCorrection.mockResolvedValue({
      service: 'Plumbing', locationHint: null, preferredDate: 'tomorrow', preferredTime: 'morning', confidence: 0.99,
    });
    fakeCrm.getServices.mockResolvedValue([{ id: 'svc-plumbing', name: 'Plumbing', category: 'plumbing' }]);
    fakeCrm.getAvailability.mockResolvedValue(['09:00', '17:00']);

    await booking.steps.confirm(
      { phone: '971500', preferredLanguage: 'en', context: { cart: [item()], voiceNotes: [] } },
      { id: 'cust1' },
      {
        text: 'change it to plumbing tomorrow morning',
        source: 'voice',
        voice: { mediaId: 'voice-correction', transcript: 'change it to plumbing tomorrow morning' },
      }
    );

    const finalContext = sessionStore.setFlow.mock.calls.at(-1)[3];
    expect(finalContext.cart[0]).toMatchObject({
      serviceId: 'svc-plumbing', serviceName: 'Plumbing', propertyId: 'prop-home', time: '09:00',
    });
    expect(finalContext.correctionDebug.changedField).toEqual(['service', 'date', 'time']);
    expect(fakeCrm.createBooking).not.toHaveBeenCalled();
  });
});

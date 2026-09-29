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

const whatsapp = require('../../whatsapp/client');
whatsapp.sendText = vi.fn();
whatsapp.sendButtons = vi.fn();
whatsapp.sendListMessage = vi.fn();

const sessionStore = require('../../session/sessionStore');
sessionStore.setFlow = vi.fn();
sessionStore.clearFlow = vi.fn();

const intentService = require('../../ai/intentService');
intentService.matchServiceToCatalog = vi.fn();

const booking = require('../../flows/booking');

function resetAll() {
  [fakeCrm.getServices, fakeCrm.getServiceDetails, fakeCrm.getCustomerProperties, fakeCrm.addProperty, fakeCrm.getAvailability, fakeCrm.createBooking,
    whatsapp.sendText, whatsapp.sendButtons, whatsapp.sendListMessage, sessionStore.setFlow, sessionStore.clearFlow,
    intentService.matchServiceToCatalog]
    .forEach((fn) => fn.mockReset());
  intentService.matchServiceToCatalog.mockResolvedValue({ serviceId: null, confidence: 0 });
}

describe('booking flow — confirm step', () => {
  beforeEach(resetAll);

  it('calls createBooking exactly once, only on CONFIRM_BOOKING, with all required fields', async () => {
    fakeCrm.createBooking.mockResolvedValue({ reference: 'BK-ABC123', scheduledDate: '2026-10-01', scheduledTime: '09:00' });

    const session = { phone: '971500', context: { serviceId: 'svc1', propertyId: 'prop1', date: '2026-10-01', time: '09:00' } };
    const customer = { id: 'cust1' };

    await booking.steps.confirm(session, customer, { buttonId: 'CONFIRM_BOOKING' });

    expect(fakeCrm.createBooking).toHaveBeenCalledTimes(1);
    expect(fakeCrm.createBooking).toHaveBeenCalledWith({
      customerId: 'cust1', propertyId: 'prop1', serviceId: 'svc1', date: '2026-10-01', time: '09:00',
    });
  });

  it('does not call createBooking when the customer cancels', async () => {
    const session = { phone: '971500', context: { serviceId: 'svc1', propertyId: 'prop1', date: '2026-10-01', time: '09:00' } };
    await booking.steps.confirm(session, { id: 'cust1' }, { buttonId: 'CANCEL_FLOW' });
    expect(fakeCrm.createBooking).not.toHaveBeenCalled();
  });

  it('does not call createBooking when required context fields are missing', async () => {
    const session = { phone: '971500', context: { serviceId: 'svc1' } }; // no property/date/time
    await booking.steps.confirm(session, { id: 'cust1' }, { buttonId: 'CONFIRM_BOOKING' });
    expect(fakeCrm.createBooking).not.toHaveBeenCalled();
  });

  it('does not call createBooking again on an unrelated button tap', async () => {
    const session = { phone: '971500', context: { serviceId: 'svc1', propertyId: 'prop1', date: '2026-10-01', time: '09:00' } };
    await booking.steps.confirm(session, { id: 'cust1' }, { buttonId: 'SOMETHING_ELSE' });
    expect(fakeCrm.createBooking).not.toHaveBeenCalled();
  });

  it('does not falsely confirm when CRM booking creation fails', async () => {
    fakeCrm.createBooking.mockRejectedValue(new Error('CRM unavailable'));
    const session = { phone: '971500', context: { serviceId: 'svc1', propertyId: 'prop1', date: '2026-10-01', time: '09:00' } };

    await booking.steps.confirm(session, { id: 'cust1' }, { buttonId: 'CONFIRM_BOOKING' });

    expect(whatsapp.sendText.mock.calls.at(-1)[1]).toContain("couldn't confirm your booking");
    expect(whatsapp.sendText.mock.calls.at(-1)[1]).not.toContain('is confirmed');
    expect(sessionStore.clearFlow).not.toHaveBeenCalled();
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
      expect.objectContaining({ serviceId: 'svc1', serviceName: 'AC Service' })
    );
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
      '971500', expect.stringContaining("couldn't confidently match"), 'Choose service', expect.any(Array)
    );
    expect(fakeCrm.getCustomerProperties).not.toHaveBeenCalled();
  });

  it('uses CRM-constrained semantic matching for a natural service request', async () => {
    fakeCrm.getServices.mockResolvedValue([
      { id: 'svc-electrical', name: 'Electrical', category: 'electrical' },
      { id: 'svc-plumbing', name: 'Plumbing', category: 'plumbing' },
    ]);
    intentService.matchServiceToCatalog.mockResolvedValue({ serviceId: 'svc-electrical', confidence: 0.93 });
    const session = { phone: '971500', context: {} };

    await booking.steps.select_service(session, { id: 'cust1' }, { text: 'light is not working' });

    expect(whatsapp.sendButtons).toHaveBeenCalledWith(
      '971500', expect.stringContaining('need Electrical'), expect.any(Array)
    );
    expect(sessionStore.setFlow).toHaveBeenCalledWith(
      '971500', 'booking', 'confirm_service',
      expect.objectContaining({ inferredServiceId: 'svc-electrical', issue: 'light is not working' })
    );
    expect(fakeCrm.createBooking).not.toHaveBeenCalled();
  });

  it('supports Manglish service descriptions through the same semantic matcher', async () => {
    fakeCrm.getServices.mockResolvedValue([{ id: 'svc-plumbing', name: 'Plumbing', category: 'plumbing' }]);
    intentService.matchServiceToCatalog.mockResolvedValue({ serviceId: 'svc-plumbing', confidence: 0.9 });

    await booking.steps.select_service(
      { phone: '971500', context: {}, preferredLanguage: 'manglish' },
      { id: 'cust1' },
      { text: 'Nale Kakkanad plumber venam' }
    );

    expect(sessionStore.setFlow).toHaveBeenCalledWith(
      '971500', 'booking', 'confirm_service', expect.objectContaining({ inferredServiceId: 'svc-plumbing' })
    );
  });

  it('falls back to the service list for an ambiguous low-confidence request', async () => {
    fakeCrm.getServices.mockResolvedValue([
      { id: 'svc1', name: 'Electrical' },
      { id: 'svc2', name: 'Appliance Repair' },
    ]);
    intentService.matchServiceToCatalog.mockResolvedValue({ serviceId: null, confidence: 0.35 });

    await booking.steps.select_service({ phone: '971500', context: {} }, { id: 'cust1' }, { text: 'something is broken' });

    expect(sessionStore.setFlow).toHaveBeenCalledWith('971500', 'booking', 'select_service', {});
    expect(whatsapp.sendListMessage).toHaveBeenCalled();
  });
});

describe('booking flow — hybrid field collection', () => {
  beforeEach(resetAll);

  it('prefills multiple fields and skips a matching saved address, date, and time', async () => {
    fakeCrm.getServices.mockResolvedValue([{ id: 'svc-plumbing', name: 'Plumbing', category: 'plumbing' }]);
    const session = { phone: '971500', context: {}, preferredLanguage: 'manglish' };
    await booking.startBooking(session, { id: 'cust1' }, {
      text: 'Nale evening Kakkanad flatil plumber venam, kitchen tap leak aanu',
      ai: {
        service: 'Plumbing', issue: 'Kitchen tap leaking', locationHint: 'Kakkanad flat',
        preferredDate: 'tomorrow', preferredTime: 'evening', confidence: 0.96,
      },
    });
    const confirmationContext = sessionStore.setFlow.mock.calls.at(-1)[3];
    expect(confirmationContext).toEqual(expect.objectContaining({
      locationHint: 'Kakkanad flat', issue: 'Kitchen tap leaking', preferredTime: 'evening',
    }));

    resetAll();
    fakeCrm.getServiceDetails.mockResolvedValue({ id: 'svc-plumbing', name: 'Plumbing' });
    fakeCrm.getCustomerProperties.mockResolvedValue([
      { id: 'prop1', label: 'Kakkanad flat', addressLine: 'Kakkanad, Kochi', area: 'Kakkanad' },
    ]);
    fakeCrm.getAvailability.mockResolvedValue(['09:00', '17:00']);
    await booking.steps.confirm_service(
      { phone: '971500', context: { ...confirmationContext, inferredServiceId: 'svc-plumbing' } },
      { id: 'cust1' },
      { buttonId: 'CONFIRM_INFERRED_SERVICE' }
    );

    expect(sessionStore.setFlow).toHaveBeenCalledWith(
      '971500', 'booking', 'review_item',
      expect.objectContaining({ propertyId: 'prop1', time: '17:00' })
    );
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

  it('completes the button-driven path through review and explicit confirmation', async () => {
    fakeCrm.getServices.mockResolvedValue([{ id: 'svc1', name: 'Plumbing', category: 'plumbing' }]);
    fakeCrm.getServiceDetails.mockResolvedValue({ id: 'svc1', name: 'Plumbing' });
    fakeCrm.getCustomerProperties.mockResolvedValue([
      { id: 'prop1', label: 'Home', addressLine: 'Kakkanad, Kochi', area: 'Kakkanad' },
    ]);
    fakeCrm.getAvailability.mockResolvedValue(['09:00']);
    fakeCrm.createBooking.mockResolvedValue({ reference: 'BK-FULL', scheduledDate: '2026-10-01', scheduledTime: '09:00' });

    await booking.steps.select_service({ phone: '971500', context: {} }, { id: 'cust1' }, { buttonId: 'SVC_svc1' });
    await booking.steps.select_property(
      { phone: '971500', context: { serviceId: 'svc1', serviceName: 'Plumbing', propertyOptions: { prop1: 'Home — Kakkanad' } } },
      { id: 'cust1' }, { buttonId: 'PROP_prop1' }
    );
    await booking.steps.select_date(
      { phone: '971500', context: { serviceId: 'svc1', serviceName: 'Plumbing', propertyId: 'prop1', propertyLabel: 'Home — Kakkanad' } },
      { id: 'cust1' }, { text: '2026-10-01' }
    );
    await booking.steps.select_slot(
      { phone: '971500', context: { serviceId: 'svc1', serviceName: 'Plumbing', propertyId: 'prop1', propertyLabel: 'Home — Kakkanad', date: '2026-10-01' } },
      { id: 'cust1' }, { buttonId: 'SLOT_09:00' }
    );
    const item = { serviceId: 'svc1', serviceName: 'Plumbing', propertyId: 'prop1', propertyLabel: 'Home — Kakkanad', date: '2026-10-01', time: '09:00', issue: null };
    await booking.steps.review_item(
      { phone: '971500', context: { cart: [], currentItem: item } },
      { id: 'cust1' }, { buttonId: 'PROCEED_TO_BOOKING' }
    );
    await booking.steps.confirm(
      { phone: '971500', context: { cart: [item] } },
      { id: 'cust1' }, { buttonId: 'CONFIRM_BOOKING' }
    );

    expect(fakeCrm.createBooking).toHaveBeenCalledTimes(1);
    expect(whatsapp.sendText.mock.calls.at(-1)[1]).toContain('Your booking is confirmed');
  });

  it('adds another service to the session cart without creating a booking early', async () => {
    fakeCrm.getServices.mockResolvedValue([{ id: 'svc2', name: 'Electrical' }]);
    const item = { serviceId: 'svc1', serviceName: 'Plumbing', propertyId: 'prop1', propertyLabel: 'Home', date: '2026-10-01', time: '09:00' };

    await booking.steps.review_item(
      { phone: '971500', context: { cart: [], currentItem: item } },
      { id: 'cust1' }, { buttonId: 'ADD_ANOTHER_SERVICE' }
    );

    expect(fakeCrm.createBooking).not.toHaveBeenCalled();
    expect(sessionStore.setFlow).toHaveBeenCalledWith(
      '971500', 'booking', 'select_service',
      expect.objectContaining({ cart: [item], propertyId: 'prop1', date: '2026-10-01' })
    );
  });

  it('offers specific choices when the customer asks to change details', async () => {
    const item = { serviceId: 'svc1', serviceName: 'Plumbing', propertyId: 'prop1', propertyLabel: 'Home', date: '2026-10-01', time: '09:00' };

    await booking.steps.review_item(
      { phone: '971500', context: { cart: [], currentItem: item } },
      { id: 'cust1' }, { buttonId: 'CHANGE_BOOKING_DETAILS' }
    );

    expect(whatsapp.sendButtons).toHaveBeenCalledWith(
      '971500',
      expect.stringContaining('Which booking detail'),
      [
        { id: 'CHANGE_SERVICE', title: 'Service' },
        { id: 'CHANGE_ADDRESS', title: 'Address' },
        { id: 'CHANGE_DATE_TIME', title: 'Date / Time' },
      ]
    );
    expect(sessionStore.setFlow).toHaveBeenCalledWith(
      '971500', 'booking', 'change_details', { cart: [], currentItem: item }
    );
  });
});

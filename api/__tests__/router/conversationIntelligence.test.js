// End-to-end router behaviour for the conversation-intelligence features,
// with the real flows and only the CRM, WhatsApp and session store mocked.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const sessionStore = require('../../session/sessionStore');
for (const name of ['getOrCreateSession', 'updateSession', 'clearFlow', 'setFlow', 'setHumanTakeover', 'touchActivity']) {
  sessionStore[name] = vi.fn();
}

const whatsapp = require('../../whatsapp/client');
whatsapp.sendText = vi.fn();
whatsapp.sendButtons = vi.fn();
whatsapp.sendListMessage = vi.fn();

const db = require('../../db/supabaseClient');
db.insert = vi.fn();
db.get = vi.fn();
db.patch = vi.fn();

const crm = require('../../crm/supabaseCrmAdapter');
const CRM_METHODS = [
  'findCustomerByPhone', 'getCustomerProperties', 'getBookings', 'getActiveComplaints', 'getServices',
  'getServiceDetails', 'getBookingById', 'getBookingStatus', 'getComplaintStatus', 'getAvailability',
  'getAvailabilityRange', 'checkServiceability', 'escalateToHuman', 'getOpenComplaintForBooking',
];
for (const name of CRM_METHODS) crm[name] = vi.fn();

const intentService = require('../../ai/intentService');
intentService.detectIntent = vi.fn();
intentService.assistHandoff = vi.fn();
intentService.matchServiceToCatalog = vi.fn();

const geocoder = require('../../geo/geocoder');
geocoder.reverseGeocode = vi.fn();
geocoder.geocodeAddress = vi.fn();

const dedup = require('../../router/dedup');
const messageOrder = require('../../router/messageOrder');
const keyedLock = require('../../reliability/keyedLock');
const profiles = require('../../customer/customerProfileService');
const lifecycle = require('../../analytics/conversationLifecycle');
const messageBudget = require('../../analytics/messageBudget');
const { handleInboundMessage } = require('../../router/conversationRouter');
const { todayInTimeZone, addDays } = require('../../flows/dateUtils');

const TODAY = todayInTimeZone();
const SERVICES = [
  { id: 'svc-ac', name: 'AC Service & Repair', category: 'ac' },
  { id: 'svc-clean', name: 'Home Cleaning', category: 'cleaning' },
  { id: 'svc-plumb', name: 'Plumbing', category: 'plumbing' },
];
const upcoming = (overrides = {}) => ({
  id: 'bk-up', reference: 'BK-UP1001', customerId: 'cust1', serviceId: 'svc-plumb', propertyId: 'prop1',
  scheduledDate: addDays(TODAY, 3), scheduledTime: '09:00:00', status: 'confirmed', ...overrides,
});

let messageCounter = 0;
function session(overrides = {}) {
  return {
    phone: '971500', customerId: 'cust1', currentFlow: null, currentStep: null, context: {},
    humanTakeover: false, lastActivityAt: new Date().toISOString(), ...overrides,
  };
}

async function send(inbound) {
  messageCounter += 1;
  return handleInboundMessage({
    from: '971500',
    waMessageId: `wamid-${messageCounter}`,
    timestamp: String(1700000000 + messageCounter),
    type: inbound.buttonId ? 'interactive' : 'text',
    ...inbound,
  });
}

const lastButtons = () => whatsapp.sendButtons.mock.calls.at(-1);

beforeEach(() => {
  for (const name of ['getOrCreateSession', 'updateSession', 'clearFlow', 'setFlow', 'setHumanTakeover', 'touchActivity']) {
    sessionStore[name].mockReset();
  }
  for (const fn of [whatsapp.sendText, whatsapp.sendButtons, whatsapp.sendListMessage, db.insert, db.get, db.patch,
    intentService.detectIntent, intentService.assistHandoff, intentService.matchServiceToCatalog]) fn.mockReset();
  for (const name of CRM_METHODS) crm[name].mockReset();
  sessionStore.getOrCreateSession.mockResolvedValue(session());
  db.insert.mockResolvedValue([]);
  db.get.mockResolvedValue([]);
  db.patch.mockResolvedValue([]);
  crm.findCustomerByPhone.mockResolvedValue({ id: 'cust1', name: 'Aisha', returningCustomer: true });
  crm.getCustomerProperties.mockResolvedValue([{ id: 'prop1', label: 'Home', addressLine: 'Villa 1', area: 'Kakkanad', isDefault: true }]);
  crm.getBookings.mockResolvedValue([]);
  crm.getActiveComplaints.mockResolvedValue([]);
  crm.getServices.mockResolvedValue(SERVICES);
  crm.getServiceDetails.mockImplementation(async (id) => SERVICES.find((service) => service.id === id) || null);
  crm.checkServiceability.mockResolvedValue({ serviceable: true });
  crm.getAvailability.mockResolvedValue(['09:00', '11:00', '15:00', '17:00']);
  crm.getAvailabilityRange.mockResolvedValue(null);
  intentService.assistHandoff.mockResolvedValue(null);
  geocoder.reverseGeocode.mockReset().mockResolvedValue(null);
  geocoder.geocodeAddress.mockReset().mockResolvedValue(null);
  intentService.matchServiceToCatalog.mockResolvedValue({ serviceId: null, confidence: 0 });
  dedup.clearForTests();
  messageOrder.clearForTests();
  keyedLock.clearForTests();
  profiles.clearForTests();
  lifecycle.clearForTests();
  messageBudget.reset();
});

describe('progressive disclosure: the menu fits the customer', () => {
  it('leads with the open complaint', async () => {
    crm.getActiveComplaints.mockResolvedValue([{ id: 'cm-1', reference: 'CM-OPEN01', status: 'in_progress', customerId: 'cust1' }]);
    await send({ text: 'hi' });
    const [, body, buttons] = lastButtons();
    expect(body).toContain('Your complaint CM-OPEN01 is in progress.');
    expect(buttons.map((b) => b.id)).toEqual(['COMPLAINT_STATUS:cm-1', 'ADD_COMPLAINT_DETAILS:cm-1', 'HUMAN_SUPPORT']);
  });

  it('leads with the upcoming visit, named and dated', async () => {
    crm.getBookings.mockResolvedValue([upcoming()]);
    await send({ text: 'hello' });
    const [, body, buttons] = lastButtons();
    expect(body).toMatch(/Hello Aisha 👋 Welcome back to Joboy\.\n\nYour Plumbing visit \(BK-UP1001\) is on \w+, \d+ \w+ at 9:00 AM\./);
    expect(buttons.map((b) => b.title)).toEqual(['My Booking', 'Reschedule', 'Cancel Booking']);
    expect(buttons[2].id).toBe('CANCEL_BOOKING:bk-up');
  });

  it('offers to rebook the last completed service', async () => {
    crm.getBookings.mockResolvedValue([upcoming({ status: 'completed', scheduledDate: addDays(TODAY, -10) })]);
    await send({ text: 'hi' });
    expect(lastButtons()[2][0]).toEqual({ id: 'BOOK_AGAIN:svc-plumb', title: 'Book Plumbing Again' });
  });
});

describe('intent shortcuts: no unnecessary menu navigation', () => {
  it('"cancel my booking" goes straight to confirming the one upcoming booking', async () => {
    crm.getBookings.mockResolvedValue([upcoming()]);
    await send({ text: 'cancel my booking' });
    const [, body, buttons] = lastButtons();
    expect(body).toContain('cancel your Plumbing booking BK-UP1001');
    expect(buttons.map((b) => b.id)).toEqual(['CANCEL_YES', 'CANCEL_NO']);
    expect(whatsapp.sendListMessage).not.toHaveBeenCalled();
    expect(intentService.detectIntent).not.toHaveBeenCalled();
  });

  it('lists only the changeable bookings when there is a real choice', async () => {
    crm.getBookings.mockResolvedValue([upcoming(), upcoming({ id: 'bk-2', reference: 'BK-UP2002' }), upcoming({ id: 'bk-3', reference: 'BK-DONE', status: 'completed' })]);
    await send({ text: 'I want to reschedule' });
    const [, prompt, , sections] = whatsapp.sendListMessage.mock.calls.at(-1);
    expect(prompt).toBe('Which booking would you like to reschedule?');
    expect(sections[0].rows.map((row) => row.title)).toEqual(['BK-UP1001', 'BK-UP2002']);
  });

  it('"where is my complaint CM-…" shows that complaint directly, only to its owner', async () => {
    crm.getComplaintStatus.mockResolvedValueOnce({ id: 'cm-9', reference: 'CM-MINE01', customerId: 'cust1', category: 'problem_returned', status: 'open' })
      .mockResolvedValueOnce({ id: 'cm-x', reference: 'CM-OTHER1', customerId: 'someone-else', category: 'other', status: 'open' });

    await send({ text: 'where is my complaint CM-MINE01' });
    expect(lastButtons()[1]).toContain('📋 Complaint CM-MINE01');

    await send({ text: 'status of complaint CM-OTHER1' });
    expect(whatsapp.sendText.mock.calls.at(-1)[1]).toContain('couldn\'t find that complaint on your account');
  });

  it('a gas smell gets safety guidance and a human immediately', async () => {
    crm.escalateToHuman.mockResolvedValue({ id: 'esc-1' });
    const result = await send({ text: 'there is a gas smell in my kitchen' });
    expect(whatsapp.sendText.mock.calls[0][1]).toContain('call emergency services on 112');
    expect(result).toMatchObject({ handoff: true, priority: 'URGENT' });
  });
});

describe('smart fallback and confidence-aware replies', () => {
  it('asks "AC Service or Home Cleaning?" instead of restarting', async () => {
    await send({ text: 'clean the ac' });
    const [, body, buttons] = lastButtons();
    expect(body).toBe('It sounds like this is about AC Service & Repair or Home Cleaning. Which one do you mean?');
    expect(buttons.map((b) => b.id)).toEqual(['SVC_svc-ac', 'SVC_svc-clean', 'MORE_SERVICES']);
    expect(intentService.detectIntent).not.toHaveBeenCalled();
  });

  it('confirms a medium-confidence reading with one tap', async () => {
    intentService.detectIntent.mockResolvedValue({ intent: 'MY_BOOKINGS', confidence: 0.7 });
    const result = await send({ text: 'what about the thing from last week' });
    expect(result.reply).toBe('intent_confirmation');
    expect(lastButtons()[1]).toBe('Just to check: would you like to see your bookings?');
    expect(sessionStore.setFlow).toHaveBeenCalledWith('971500', 'intent_confirm', 'confirm', expect.objectContaining({ intent: 'MY_BOOKINGS' }));
  });

  it('acts on the confirmed intent', async () => {
    crm.getBookings.mockResolvedValue([upcoming()]);
    sessionStore.getOrCreateSession.mockResolvedValue(session({
      currentFlow: 'intent_confirm', currentStep: 'confirm',
      context: { intent: 'MY_BOOKINGS', understanding: { intent: 'MY_BOOKINGS', confidence: 0.7 }, text: 'my visit' },
    }));
    await send({ buttonId: 'CONFIRM_INTENT' });
    expect(whatsapp.sendListMessage.mock.calls.at(-1)[3][0].rows[0].title).toBe('BK-UP1001');
  });

  it('offers the most likely actions, never a bare "I didn\'t understand"', async () => {
    intentService.detectIntent.mockResolvedValue({ intent: 'UNKNOWN', confidence: 0 });
    const result = await send({ text: 'zxq plorb' });
    expect(result.reply).toBe('clarification_offered');
    const [, body, buttons] = lastButtons();
    expect(body).toContain('I want to make sure I help with the right thing');
    expect(body).not.toMatch(/didn.t understand/i);
    expect(buttons).toHaveLength(3);
  });
});

describe('quick replies are ownership-checked', () => {
  it('refuses a booking id that belongs to someone else', async () => {
    crm.getBookingById.mockResolvedValue(upcoming({ customerId: 'someone-else' }));
    await send({ buttonId: 'CANCEL_BOOKING:bk-up' });
    expect(lastButtons()[1]).toContain('couldn\'t find that booking on your account');
    expect(sessionStore.setFlow).not.toHaveBeenCalledWith('971500', 'my_bookings', 'confirm_cancel', expect.anything());
  });

  it('works from inside another flow (an explicit tap wins)', async () => {
    crm.getBookingById.mockResolvedValue(upcoming());
    sessionStore.getOrCreateSession.mockResolvedValue(session({ currentFlow: 'complaint', currentStep: 'select_category' }));
    await send({ buttonId: 'CANCEL_BOOKING:bk-up' });
    expect(sessionStore.setFlow).toHaveBeenCalledWith('971500', 'my_bookings', 'confirm_cancel', expect.objectContaining({ booking: expect.objectContaining({ id: 'bk-up' }) }));
  });
});

describe('abandoned booking recovery', () => {
  const stale = (minutes) => new Date(Date.now() - minutes * 60000).toISOString();
  const draftSession = () => session({
    currentFlow: 'booking',
    currentStep: 'select_slot',
    lastActivityAt: stale(120),
    context: { serviceId: 'svc-plumb', serviceName: 'Plumbing', propertyId: 'prop1', propertyLabel: 'Home — Kakkanad', date: addDays(TODAY, 2), time: '09:00', cart: [] },
  });

  it('offers to continue with the details in plain words when the customer returns', async () => {
    sessionStore.getOrCreateSession.mockResolvedValue(draftSession());
    const result = await send({ text: 'hello' });
    expect(result.reply).toBe('booking_resume_offered');
    const [, body, buttons] = lastButtons();
    expect(body).toMatch(/^Welcome back\. You were booking Plumbing at Home — Kakkanad for \w+, \d+ \w+\. Would you like to continue/);
    expect(buttons.map((b) => b.id)).toEqual(['RESUME_DRAFT:booking', 'DISCARD_DRAFT:booking']);
  });

  it('resumes with fresh availability (the stale time is never reused)', async () => {
    const draft = draftSession();
    sessionStore.getOrCreateSession.mockResolvedValue(session({
      currentFlow: 'recovery', currentStep: 'resume_prompt',
      context: { draft: { flow: 'booking', step: 'select_slot', context: draft.context } },
    }));
    await send({ buttonId: 'RESUME_DRAFT:booking' });
    expect(crm.getAvailability).toHaveBeenCalledWith('svc-plumb', addDays(TODAY, 2));
    const slotStep = sessionStore.setFlow.mock.calls.find((call) => call[2] === 'select_slot');
    expect(slotStep[3]).not.toHaveProperty('time');
  });

  it('lets a clear new request replace the draft', async () => {
    sessionStore.getOrCreateSession.mockResolvedValue(draftSession());
    crm.getBookings.mockResolvedValue([upcoming()]);
    await send({ text: 'cancel my booking' });
    expect(lastButtons()[2].map((b) => b.id)).toEqual(['CANCEL_YES', 'CANCEL_NO']);
  });

  it('greets mid-booking with the resume offer instead of a generic line', async () => {
    sessionStore.getOrCreateSession.mockResolvedValue({ ...draftSession(), lastActivityAt: new Date().toISOString() });
    const result = await send({ text: 'hi' });
    expect(result.reply).toBe('booking_resume_offered');
  });
});

describe('attachments outside a flow', () => {
  it('offers to add a photo to the open complaint', async () => {
    crm.getActiveComplaints.mockResolvedValue([{ id: 'cm-1', reference: 'CM-OPEN01', status: 'open', customerId: 'cust1' }]);
    await send({ type: 'image', mediaId: 'media-77', mediaMimeType: 'image/jpeg' });
    const [, body, buttons] = lastButtons();
    expect(body).toContain('Shall I add it to your open complaint CM-OPEN01?');
    expect(buttons[0].id).toBe('ATTACH_MEDIA:cm-1~media-77~image');
  });

  it('links a photo to a recent visit', async () => {
    crm.getBookings.mockResolvedValue([upcoming({ status: 'completed', scheduledDate: addDays(TODAY, -2) })]);
    await send({ type: 'image', mediaId: 'media-78', mediaMimeType: 'image/jpeg' });
    expect(lastButtons()[2][0]).toEqual({ id: 'REPORT_WITH_MEDIA:bk-up~media-78~image', title: 'Yes, Report Issue' });
  });
});

describe('no duplicate complaints', () => {
  it('offers to add a photo to the open complaint for that visit instead of opening a new one', async () => {
    crm.getBookingById.mockResolvedValue(upcoming({ status: 'completed', scheduledDate: addDays(TODAY, -2) }));
    crm.getOpenComplaintForBooking.mockResolvedValue({ id: 'cm-5', reference: 'CM-DUP001', status: 'open', customerId: 'cust1' });
    await send({ buttonId: 'REPORT_WITH_MEDIA:bk-up~media-1~image' });
    const [, body, buttons] = lastButtons();
    expect(body).toContain('CM-DUP001');
    expect(buttons.map((b) => b.id)).toEqual(['DUP_ADD', 'DUP_NEW', 'HUMAN_SUPPORT']);
    const [, flow, step, context] = sessionStore.setFlow.mock.calls.at(-1);
    expect([flow, step]).toEqual(['complaint', 'duplicate_check']);

    sessionStore.getOrCreateSession.mockResolvedValue(session({ currentFlow: flow, currentStep: step, context }));
    await send({ buttonId: 'DUP_ADD' });
    expect(sessionStore.setFlow).toHaveBeenLastCalledWith('971500', 'complaint_update', 'collecting', expect.objectContaining({
      complaintId: 'cm-5',
      attachments: [{ waMediaId: 'media-1', mediaType: 'image' }],
    }));
  });
});

describe('sharing the service address', () => {
  const atAddressStep = () => session({
    currentFlow: 'booking', currentStep: 'select_property',
    context: { serviceId: 'svc-plumb', serviceName: 'Plumbing', propertyOptions: { prop1: 'Home — Villa 1, Kakkanad' } },
  });

  beforeEach(() => {
    crm.addProperty = vi.fn(async (customerId, input) => ({ id: 'prop-new', label: null, addressLine: input.addressLine, area: input.area || null }));
  });

  it('accepts a pasted Google Maps link like a location pin and keeps its coordinates', async () => {
    sessionStore.getOrCreateSession.mockResolvedValue(atAddressStep());
    await send({ text: 'https://maps.google.com/?q=25.2048,55.2708' });
    expect(whatsapp.sendText.mock.calls.at(-1)[1]).toContain('I have your location pin');
    expect(sessionStore.setFlow).toHaveBeenLastCalledWith('971500', 'booking', 'awaiting_new_property', expect.objectContaining({
      location: expect.objectContaining({ latitude: 25.2048, longitude: 55.2708 }),
    }));
  });

  it('takes a typed address instead of insisting on the list', async () => {
    sessionStore.getOrCreateSession.mockResolvedValue(atAddressStep());
    await send({ text: 'Flat 304, Al Noor Building, Al Nahda' });
    expect(crm.addProperty).toHaveBeenCalledWith('cust1', expect.objectContaining({ addressLine: 'Flat 304, Al Noor Building, Al Nahda' }));
  });

  it('explains how to share a location when the reply is neither', async () => {
    sessionStore.getOrCreateSession.mockResolvedValue(atAddressStep());
    await send({ text: 'ok' });
    expect(whatsapp.sendText.mock.calls.at(-1)[1]).toContain('📎 (attach) → Location');
    expect(crm.addProperty).not.toHaveBeenCalled();
  });
});

describe('service area', () => {
  const KAKKANAD = {
    formattedAddress: 'Infopark Rd, Kakkanad, Kochi, Kerala 682030, India',
    area: 'Kakkanad', city: 'Kochi', state: 'Kerala', postalCode: '682030', country: 'India', provider: 'google',
  };
  const atAddressStep = (step = 'select_property') => session({
    currentFlow: 'booking', currentStep: step,
    context: { serviceId: 'svc-plumb', serviceName: 'Plumbing', propertyOptions: { prop1: 'Home — Villa 1, Kakkanad' } },
  });
  const pin = { type: 'location', location: { latitude: 10.0159, longitude: 76.3419, label: null, address: null, source: 'whatsapp_location' } };

  beforeEach(() => {
    crm.addProperty = vi.fn(async (customerId, input) => ({ id: 'prop-new', label: null, addressLine: input.addressLine, area: input.area || null }));
  });

  it('refuses an out-of-area WhatsApp pin by name and PIN code, without saving it', async () => {
    sessionStore.getOrCreateSession.mockResolvedValue(atAddressStep());
    geocoder.reverseGeocode.mockResolvedValue(KAKKANAD);
    crm.checkServiceability.mockResolvedValue({ serviceable: false });

    await send(pin);

    expect(crm.checkServiceability).toHaveBeenCalledWith('svc-plumb', expect.objectContaining({
      postalCode: '682030', city: 'Kochi', state: 'Kerala', latitude: 10.0159, longitude: 76.3419,
    }));
    const [, body, buttons] = lastButtons();
    expect(body).toMatch(/^Sorry, we don't offer Plumbing in Kakkanad, Kochi \(682030\) yet\./);
    expect(body).toContain('📎 (attach) → Location');
    expect(buttons.map((b) => b.id)).toEqual(['SHOW_SAVED_ADDRESSES', 'MAIN_MENU']);
    expect(crm.addProperty).not.toHaveBeenCalled();
    expect(sessionStore.setFlow).toHaveBeenLastCalledWith('971500', 'booking', 'awaiting_new_property', expect.any(Object));
  });

  it('confirms an in-area pin, asks only for the flat, and does not check twice', async () => {
    sessionStore.getOrCreateSession.mockResolvedValue(atAddressStep());
    geocoder.reverseGeocode.mockResolvedValue(KAKKANAD);
    await send(pin);
    expect(lastButtons()[1]).toContain('📍 Infopark Rd, Kakkanad, Kochi, Kerala 682030, India');
    const [, , step, context] = sessionStore.setFlow.mock.calls.at(-1);
    expect(step).toBe('awaiting_location_details');

    sessionStore.getOrCreateSession.mockResolvedValue(session({ currentFlow: 'booking', currentStep: step, context }));
    await send({ text: 'Flat 4B, Skyline Ivy' });
    expect(crm.addProperty).toHaveBeenCalledWith('cust1', expect.objectContaining({
      addressLine: 'Flat 4B, Skyline Ivy, Infopark Rd, Kakkanad, Kochi, Kerala 682030, India',
      postalCode: '682030', state: 'Kerala', latitude: 10.0159,
    }));
    expect(crm.checkServiceability).toHaveBeenCalledTimes(1);
  });

  it('checks a typed address by the PIN code in it', async () => {
    sessionStore.getOrCreateSession.mockResolvedValue(atAddressStep('awaiting_new_property'));
    crm.checkServiceability.mockResolvedValue({ serviceable: false });
    await send({ text: '12 MG Road, Bengaluru 560 001' });
    expect(crm.checkServiceability).toHaveBeenCalledWith('svc-plumb', expect.objectContaining({ postalCode: '560001', source: 'typed_address' }));
    expect(lastButtons()[1]).toMatch(/^Sorry, we don't offer Plumbing in PIN code 560001 yet\./);
    expect(crm.addProperty).not.toHaveBeenCalled();
  });

  it('saves a serviceable typed address with what the lookup found', async () => {
    sessionStore.getOrCreateSession.mockResolvedValue(atAddressStep('awaiting_new_property'));
    geocoder.geocodeAddress.mockResolvedValue({ ...KAKKANAD, latitude: 10.01, longitude: 76.34, precision: 'APPROXIMATE' });
    await send({ text: 'Flat 4B, Skyline Ivy, Kakkanad' });
    const [, saved] = crm.addProperty.mock.calls[0];
    expect(saved).toMatchObject({ addressLine: 'Flat 4B, Skyline Ivy, Kakkanad', postalCode: '682030', city: 'Kochi' });
    expect(saved).not.toHaveProperty('latitude'); // approximate lookup coordinates are not the address
  });

  it('lets the customer go back to their saved addresses', async () => {
    sessionStore.getOrCreateSession.mockResolvedValue(atAddressStep('awaiting_new_property'));
    await send({ buttonId: 'SHOW_SAVED_ADDRESSES' });
    expect(whatsapp.sendListMessage.mock.calls.at(-1)[1]).toBe('Where would you like the Plumbing professional to visit?');
  });

  it('never blocks the booking when the area check itself fails', async () => {
    sessionStore.getOrCreateSession.mockResolvedValue(atAddressStep('awaiting_new_property'));
    crm.checkServiceability.mockRejectedValue(new Error('CRM down'));
    await send({ text: 'Flat 4B, Skyline Ivy, Kakkanad' });
    expect(crm.addProperty).toHaveBeenCalled();
  });
});

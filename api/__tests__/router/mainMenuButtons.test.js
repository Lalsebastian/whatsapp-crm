import { describe, it, expect, vi, beforeEach } from 'vitest';

const sessionStore = require('../../session/sessionStore');
sessionStore.getOrCreateSession = vi.fn();
sessionStore.updateSession = vi.fn();
sessionStore.clearFlow = vi.fn();

const whatsapp = require('../../whatsapp/client');
whatsapp.sendText = vi.fn();
whatsapp.sendButtons = vi.fn();
whatsapp.sendListMessage = vi.fn();

const db = require('../../db/supabaseClient');
db.insert = vi.fn();

const crmAdapter = require('../../crm/supabaseCrmAdapter');
crmAdapter.findCustomerByPhone = vi.fn();
crmAdapter.getCustomerProperties = vi.fn();
crmAdapter.getBookings = vi.fn();
crmAdapter.getActiveComplaints = vi.fn();

const intentService = require('../../ai/intentService');
intentService.detectIntent = vi.fn();

const flowRegistry = require('../../router/flowRegistry');
for (const key of ['BOOK_SERVICE', 'MY_BOOKINGS', 'MAKE_COMPLAINT', 'COMPLAINT_STATUS', 'SERVICE_INFO', 'HUMAN_SUPPORT']) {
  flowRegistry.entryPoints[key] = vi.fn();
}

const dedup = require('../../router/dedup');
const messageOrder = require('../../router/messageOrder');
const keyedLock = require('../../reliability/keyedLock');
const { handleInboundMessage } = require('../../router/conversationRouter');
const analytics = require('../../analytics/eventWriter');
const lifecycle = require('../../analytics/conversationLifecycle');
const profiles = require('../../customer/customerProfileService');

function idleSession() {
  return {
    phone: '971500', customerId: 'cust1', currentFlow: null, currentStep: null,
    context: {}, humanTakeover: false, lastActivityAt: new Date().toISOString(),
  };
}

async function send({ text, buttonId, id }) {
  return handleInboundMessage({
    from: '971500',
    type: buttonId ? 'interactive' : 'text',
    text,
    buttonId,
    waMessageId: id,
    timestamp: String(Date.now()),
  });
}

describe('three-button main menu', () => {
  beforeEach(() => {
    sessionStore.getOrCreateSession.mockReset().mockResolvedValue(idleSession());
    sessionStore.updateSession.mockReset();
    sessionStore.clearFlow.mockReset();
    whatsapp.sendText.mockReset();
    whatsapp.sendButtons.mockReset();
    whatsapp.sendListMessage.mockReset();
    db.insert.mockReset().mockResolvedValue([]);
    crmAdapter.findCustomerByPhone.mockReset().mockResolvedValue({ id: 'cust1' });
    crmAdapter.getCustomerProperties.mockReset().mockResolvedValue([]);
    crmAdapter.getBookings.mockReset().mockResolvedValue([]);
    crmAdapter.getActiveComplaints.mockReset().mockResolvedValue([]);
    intentService.detectIntent.mockReset();
    for (const key of ['BOOK_SERVICE', 'MY_BOOKINGS', 'MAKE_COMPLAINT', 'COMPLAINT_STATUS', 'SERVICE_INFO', 'HUMAN_SUPPORT']) {
      flowRegistry.entryPoints[key].mockReset();
    }
    dedup.clearForTests();
    messageOrder.clearForTests();
    keyedLock.clearForTests();
    analytics.clearTestEvents();
    lifecycle.clearForTests();
    profiles.clearForTests();
  });

  it.each(['Hi', 'Hello', 'Hey', 'Menu', 'Start'])('shows a new customer the three most useful actions for %s', async (greeting) => {
    await send({ text: greeting, id: `greeting-${greeting}` });

    expect(whatsapp.sendButtons).toHaveBeenCalledWith(
      '971500',
      expect.stringContaining('Hello 👋 Welcome to Joboy.'),
      [
        { id: 'BOOK_SERVICE', title: 'Book a Service' },
        { id: 'SERVICE_INFO', title: 'Our Services' },
        { id: 'HUMAN_SUPPORT', title: 'Talk to Support' },
      ]
    );
    expect(whatsapp.sendListMessage).not.toHaveBeenCalled();
  });

  it('records returning-customer identification without exposing it in the WhatsApp message', async () => {
    crmAdapter.findCustomerByPhone.mockResolvedValue({ id: 'cust1', name: 'John', returningCustomer: true });
    await send({ text: 'Hi', id: 'returning-greeting' });
    expect(analytics.getTestEvents('971500').map((event) => event.eventType))
      .toEqual(expect.arrayContaining(['CUSTOMER_IDENTIFIED', 'RETURNING_CUSTOMER_IDENTIFIED']));
  });

  it.each([
    ['BOOK_SERVICE', 'BOOK_SERVICE'],
    ['MY_BOOKINGS', 'MY_BOOKINGS'],
    ['MAKE_COMPLAINT', 'MAKE_COMPLAINT'],
    ['COMPLAINT_STATUS', 'COMPLAINT_STATUS'],
    ['HUMAN_SUPPORT', 'HUMAN_SUPPORT'],
  ])('routes %s through its existing entry point', async (buttonId, entryKey) => {
    await send({ buttonId, id: `button-${buttonId}` });
    expect(flowRegistry.entryPoints[entryKey]).toHaveBeenCalledTimes(1);
  });

  it('opens the three-button More Options submenu', async () => {
    await send({ buttonId: 'MORE_OPTIONS', id: 'button-more-options' });

    expect(whatsapp.sendButtons).toHaveBeenCalledWith(
      '971500',
      expect.stringContaining('type "services"'),
      [
        { id: 'MAKE_COMPLAINT', title: 'Make a Complaint' },
        { id: 'COMPLAINT_STATUS', title: 'Complaint Status' },
        { id: 'HUMAN_SUPPORT', title: 'Talk to Support' },
      ]
    );
    expect(whatsapp.sendListMessage).not.toHaveBeenCalled();
  });

  it.each(['services', 'service information', 'what services do you offer'])('routes typed "%s" to Service Information', async (text) => {
    await send({ text, id: `services-${text}` });
    expect(flowRegistry.entryPoints.SERVICE_INFO).toHaveBeenCalledTimes(1);
    expect(intentService.detectIntent).not.toHaveBeenCalled();
  });

  it('routes a natural support request to human support', async () => {
    await send({ text: 'I need support', id: 'typed-support' });
    expect(flowRegistry.entryPoints.HUMAN_SUPPORT).toHaveBeenCalledTimes(1);
  });

  it('returns to the main menu when the customer types menu', async () => {
    await send({ text: 'menu', id: 'typed-menu' });
    expect(whatsapp.sendButtons).toHaveBeenCalledWith(
      '971500',
      expect.any(String),
      expect.arrayContaining([{ id: 'BOOK_SERVICE', title: 'Book a Service' }])
    );
  });

  it.each([
    ['book plumber', 'NEW_BOOKING', 'BOOK_SERVICE'],
    ['I want to complain', 'COMPLAINT', 'MAKE_COMPLAINT'],
    ['show my bookings', 'MY_BOOKINGS', 'MY_BOOKINGS'],
  ])('keeps free-text routing for "%s"', async (text, intent, entryKey) => {
    intentService.detectIntent.mockResolvedValueOnce({ intent, confidence: 0.95, language: 'en' });
    await send({ text, id: `free-text-${intent}` });
    expect(flowRegistry.entryPoints[entryKey]).toHaveBeenCalledTimes(1);
  });
});

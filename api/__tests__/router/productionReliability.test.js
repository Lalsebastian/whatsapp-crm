import { describe, it, expect, vi, beforeEach } from 'vitest';

const sessionStore = require('../../session/sessionStore');
sessionStore.getOrCreateSession = vi.fn();
sessionStore.updateSession = vi.fn();
sessionStore.clearFlow = vi.fn();
sessionStore.setFlow = vi.fn();
sessionStore.setHumanTakeover = vi.fn();
sessionStore.touchActivity = vi.fn();

const whatsapp = require('../../whatsapp/client');
whatsapp.sendText = vi.fn();
whatsapp.sendButtons = vi.fn();
whatsapp.sendListMessage = vi.fn();

const db = require('../../db/supabaseClient');
db.insert = vi.fn();

const crmAdapter = require('../../crm/supabaseCrmAdapter');
crmAdapter.findCustomerByPhone = vi.fn(async () => ({ id: 'cust1' }));
crmAdapter.getCustomerProperties = vi.fn();
crmAdapter.getBookings = vi.fn();
crmAdapter.getActiveComplaints = vi.fn();

const dedup = require('../../router/dedup');
const messageOrder = require('../../router/messageOrder');
const keyedLock = require('../../reliability/keyedLock');
const { handleInboundMessage } = require('../../router/conversationRouter');
const analytics = require('../../analytics/eventWriter');
const lifecycle = require('../../analytics/conversationLifecycle');
const profiles = require('../../customer/customerProfileService');

function idleSession(overrides = {}) {
  return {
    phone: '971500', customerId: 'cust1', currentFlow: null, currentStep: null,
    context: {}, humanTakeover: false, lastActivityAt: new Date().toISOString(), ...overrides,
  };
}

describe('production conversation reliability', () => {
  beforeEach(() => {
    [sessionStore.getOrCreateSession, sessionStore.updateSession, sessionStore.clearFlow, sessionStore.setFlow,
      sessionStore.setHumanTakeover, sessionStore.touchActivity, whatsapp.sendText, whatsapp.sendButtons,
      whatsapp.sendListMessage, db.insert, crmAdapter.findCustomerByPhone, crmAdapter.getCustomerProperties,
      crmAdapter.getBookings, crmAdapter.getActiveComplaints].forEach((fn) => fn.mockReset());
    crmAdapter.findCustomerByPhone.mockResolvedValue({ id: 'cust1' });
    crmAdapter.getCustomerProperties.mockResolvedValue([]);
    crmAdapter.getBookings.mockResolvedValue([]);
    crmAdapter.getActiveComplaints.mockResolvedValue([]);
    db.insert.mockResolvedValue([]);
    dedup.clearForTests();
    messageOrder.clearForTests();
    keyedLock.clearForTests();
    analytics.clearTestEvents();
    lifecycle.clearForTests();
    profiles.clearForTests();
  });

  it('processes a duplicate WhatsApp message ID only once', async () => {
    sessionStore.getOrCreateSession.mockResolvedValue(idleSession());
    const inbound = { from: '971500', type: 'text', text: 'menu', waMessageId: 'wamid-duplicate', timestamp: '100' };

    const first = await handleInboundMessage(inbound);
    const second = await handleInboundMessage(inbound);

    expect(first.duplicate).not.toBe(true);
    expect(second.duplicate).toBe(true);
    expect(whatsapp.sendButtons).toHaveBeenCalledTimes(1);
    expect(crmAdapter.findCustomerByPhone).toHaveBeenCalledTimes(1);
    expect(analytics.getTestEvents('971500').filter((event) => event.eventType === 'CONVERSATION_STARTED'))
      .toHaveLength(1);
  });

  it('recognizes a message ID already claimed by persistent storage', async () => {
    const conflict = Object.assign(new Error('duplicate key'), {
      response: { status: 409, data: { code: '23505' } },
    });
    db.insert.mockRejectedValueOnce(conflict);

    const claim = await dedup.claimMessage({ messageId: 'wamid-persisted', phone: '971500' });

    expect(claim).toEqual({ duplicate: true, persistent: true });
  });

  it('serializes concurrent messages for the same customer', async () => {
    sessionStore.getOrCreateSession.mockResolvedValue(idleSession());
    let releaseFirst;
    whatsapp.sendButtons
      .mockImplementationOnce(() => new Promise((resolve) => { releaseFirst = resolve; }))
      .mockResolvedValueOnce();

    const first = handleInboundMessage({ from: '971500', type: 'text', text: 'menu', waMessageId: 'wamid-lock-1', timestamp: '101' });
    await vi.waitFor(() => expect(whatsapp.sendButtons).toHaveBeenCalledTimes(1));
    const second = handleInboundMessage({ from: '971500', type: 'text', text: 'menu', waMessageId: 'wamid-lock-2', timestamp: '102' });
    await Promise.resolve();
    expect(whatsapp.sendButtons).toHaveBeenCalledTimes(1);

    releaseFirst();
    await Promise.all([first, second]);
    expect(whatsapp.sendButtons).toHaveBeenCalledTimes(2);
  });

  it('resets an expired active session and shows the main menu', async () => {
    sessionStore.getOrCreateSession.mockResolvedValue(idleSession({
      currentFlow: 'booking',
      currentStep: 'select_date',
      lastActivityAt: new Date(Date.now() - 61 * 60 * 1000).toISOString(),
    }));

    const result = await handleInboundMessage({ from: '971500', type: 'text', text: 'hello', waMessageId: 'wamid-expired' });

    expect(result.reply).toBe('expired_session_menu');
    expect(whatsapp.sendText).toHaveBeenCalledWith('971500', expect.stringContaining('previous booking session has expired'));
    expect(whatsapp.sendButtons).toHaveBeenCalledTimes(1);
    expect(analytics.getTestEvents('971500').map((event) => event.eventType))
      .toEqual(expect.arrayContaining(['CONVERSATION_EXPIRED', 'BOOKING_ABANDONED']));
  });

  it('resumes a recent session instead of restarting it', async () => {
    sessionStore.getOrCreateSession.mockResolvedValue(idleSession({
      currentFlow: 'booking',
      currentStep: 'select_date',
      lastActivityAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    }));

    const result = await handleInboundMessage({ from: '971500', type: 'text', text: 'hello', waMessageId: 'wamid-recent' });

    expect(result.reply).toBe('active_flow_greeting');
    expect(whatsapp.sendText).toHaveBeenCalledWith('971500', expect.stringContaining('continue from where we left off'));
    expect(whatsapp.sendListMessage).not.toHaveBeenCalled();
  });

  it('does not expire an active human-support conversation', async () => {
    sessionStore.getOrCreateSession.mockResolvedValue(idleSession({
      currentFlow: 'support',
      currentStep: 'waiting',
      humanTakeover: true,
      lastActivityAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    }));

    const result = await handleInboundMessage({ from: '971500', type: 'text', text: 'hello', waMessageId: 'wamid-human-old' });

    expect(result.humanTakeover).toBe(true);
    expect(sessionStore.touchActivity).toHaveBeenCalledWith('971500');
    expect(whatsapp.sendListMessage).not.toHaveBeenCalled();
  });

  it('ignores a clearly stale event after a newer event was processed', async () => {
    sessionStore.getOrCreateSession.mockResolvedValue(idleSession());
    await handleInboundMessage({ from: '971500', type: 'text', text: 'menu', waMessageId: 'wamid-newer', timestamp: '200' });
    const stale = await handleInboundMessage({ from: '971500', type: 'text', text: 'menu', waMessageId: 'wamid-older', timestamp: '199' });

    expect(stale.stale).toBe(true);
    expect(whatsapp.sendButtons).toHaveBeenCalledTimes(1);
  });
});

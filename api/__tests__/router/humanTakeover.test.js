// See ai/intentService.test.js for why require()-cache monkey-patching is
// used instead of vi.mock. conversationRouter.js destructures detectIntent,
// downloadWhatsAppMedia, transcribeAudio, evaluateTriggers and
// triggerEscalation at require time, so those must be patched on their
// shared module objects BEFORE conversationRouter.js is first required here.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const sessionStore = require('../../session/sessionStore');
sessionStore.getOrCreateSession = vi.fn();
sessionStore.updateSession = vi.fn();
sessionStore.clearFlow = vi.fn();
sessionStore.setFlow = vi.fn();
sessionStore.setHumanTakeover = vi.fn();

const whatsapp = require('../../whatsapp/client');
whatsapp.sendText = vi.fn();
whatsapp.sendButtons = vi.fn();
whatsapp.sendListMessage = vi.fn();

const db = require('../../db/supabaseClient');
db.insert = vi.fn();
db.get = vi.fn();
db.upsert = vi.fn();
db.patch = vi.fn();

const crmAdapter = require('../../crm/supabaseCrmAdapter');
crmAdapter.findCustomerByPhone = vi.fn(async () => ({ id: 'cust1' }));

const aiIntentService = require('../../ai/intentService');
aiIntentService.detectIntent = vi.fn();

const mediaHandler = require('../../media/mediaHandler');
mediaHandler.downloadWhatsAppMedia = vi.fn();

const transcription = require('../../media/transcription');
transcription.transcribeAudio = vi.fn();

const escalationService = require('../../escalation/escalationService');
escalationService.triggerEscalation = vi.fn();

const { handleInboundMessage } = require('../../router/conversationRouter');

describe('human takeover', () => {
  beforeEach(() => {
    [sessionStore.getOrCreateSession, sessionStore.updateSession, sessionStore.clearFlow, sessionStore.setFlow, sessionStore.setHumanTakeover,
      whatsapp.sendText, whatsapp.sendButtons, whatsapp.sendListMessage, db.insert, db.get, db.upsert, db.patch]
      .forEach((fn) => fn.mockReset());
    escalationService.triggerEscalation.mockReset();
  });

  it('suppresses all outbound replies once human_takeover is true, but still logs the inbound message', async () => {
    sessionStore.getOrCreateSession.mockResolvedValue({
      phone: '971500', currentFlow: null, currentStep: null, context: {}, humanTakeover: true, customerId: 'cust1',
    });
    db.get.mockResolvedValue([{ id: 'esc-1', created_at: new Date(Date.now() - 3600000).toISOString() }]);

    const result = await handleInboundMessage({ from: '971500', type: 'text', text: 'hello', waMessageId: 'wamid-1' });

    expect(whatsapp.sendText).not.toHaveBeenCalled();
    expect(whatsapp.sendButtons).not.toHaveBeenCalled();
    expect(whatsapp.sendListMessage).not.toHaveBeenCalled();
    expect(result.humanTakeover).toBe(true);
    expect(db.insert).toHaveBeenCalledWith(
      'messages',
      expect.objectContaining({ phone: '971500', direction: 'inbound' }),
      expect.anything()
    );
  });

  it('processes messages normally when human_takeover is false', async () => {
    sessionStore.getOrCreateSession.mockResolvedValue({
      phone: '971500', currentFlow: null, currentStep: null, context: {}, humanTakeover: false, customerId: 'cust1',
    });

    await handleInboundMessage({ from: '971500', type: 'text', text: 'menu', waMessageId: 'wamid-2' });

    // "menu" is a greeting/menu keyword — should trigger the main menu, which sends something.
    expect(whatsapp.sendButtons).toHaveBeenCalled();
  });

  it('handles a greeting during an active flow without treating it as flow input', async () => {
    sessionStore.getOrCreateSession.mockResolvedValue({
      phone: '971500', currentFlow: 'booking', currentStep: 'select_service', context: {}, humanTakeover: false, customerId: 'cust1',
    });

    const result = await handleInboundMessage({ from: '971500', type: 'text', text: 'hello', waMessageId: 'wamid-3' });

    expect(result.reply).toBe('active_flow_greeting');
    expect(whatsapp.sendText).toHaveBeenCalledWith('971500', expect.stringContaining('continue from where we left off'));
    expect(whatsapp.sendListMessage).not.toHaveBeenCalled();
  });

  it('provides safety guidance and creates an urgent handoff during an active flow', async () => {
    const activeSession = {
      phone: '971500', currentFlow: 'booking', currentStep: 'select_slot',
      context: { serviceName: 'Electrical', propertyLabel: 'Home' },
      preferredLanguage: 'en', humanTakeover: false, customerId: 'cust1',
    };
    sessionStore.getOrCreateSession.mockResolvedValue(activeSession);
    escalationService.triggerEscalation.mockResolvedValue({ priority: 'URGENT', reason: 'electrical_safety_concern' });

    const result = await handleInboundMessage({
      from: '971500', type: 'text', text: 'There is smoke and a burning smell from the socket', waMessageId: 'wamid-safety',
    });

    expect(escalationService.triggerEscalation).toHaveBeenCalledWith(expect.objectContaining({
      session: activeSession,
      reason: 'electrical_safety_concern',
      originalCustomerMessage: 'There is smoke and a burning smell from the socket',
    }));
    expect(whatsapp.sendText.mock.calls[0][1]).toContain('avoid using');
    expect(whatsapp.sendText.mock.calls.at(-1)[1]).toContain("I've shared the details");
    expect(result).toMatchObject({ handoff: true, priority: 'URGENT', handoffReason: 'electrical_safety_concern' });
    expect(sessionStore.clearFlow).not.toHaveBeenCalled();
  });

  it('does not claim or enable a handoff when escalation fails', async () => {
    const activeSession = {
      phone: '971500', currentFlow: 'booking', currentStep: 'select_date',
      context: { serviceName: 'Plumbing' }, humanTakeover: false, customerId: 'cust1',
    };
    sessionStore.getOrCreateSession.mockResolvedValue(activeSession);
    escalationService.triggerEscalation.mockRejectedValue(new Error('CRM unavailable'));

    const result = await handleInboundMessage({
      from: '971500', type: 'text', text: 'There is flooding near the socket', waMessageId: 'wamid-safety-failed',
    });

    expect(result).toMatchObject({ handoff: false, priority: null, reply: 'escalation_failed' });
    expect(whatsapp.sendText.mock.calls.at(-1)[1]).toContain("wasn't able to connect");
    expect(sessionStore.clearFlow).not.toHaveBeenCalled();
  });

  describe('handing the conversation back to the bot', () => {
    const takenOver = (context = {}) => ({
      phone: '971500', currentFlow: null, currentStep: null, context, humanTakeover: true, customerId: 'cust1',
      lastActivityAt: new Date().toISOString(),
    });
    const released = () => sessionStore.updateSession.mock.calls.some(([, patch]) => patch.humanTakeover === false);

    it('releases once the escalation has been resolved, and replies normally', async () => {
      sessionStore.getOrCreateSession.mockResolvedValue(takenOver());
      db.get.mockResolvedValue([]);
      const result = await handleInboundMessage({ from: '971500', type: 'text', text: 'hi', waMessageId: 'wamid-r1' });
      expect(released()).toBe(true);
      expect(result.humanTakeover).not.toBe(true);
      expect(whatsapp.sendButtons).toHaveBeenCalled();
    });

    it('releases a takeover nobody closed after HUMAN_TAKEOVER_MAX_HOURS (escalation stays open)', async () => {
      sessionStore.getOrCreateSession.mockResolvedValue(takenOver());
      db.get.mockResolvedValue([{ id: 'esc-old', created_at: new Date(Date.now() - 4 * 86400000).toISOString() }]);
      await handleInboundMessage({ from: '971500', type: 'text', text: 'hello', waMessageId: 'wamid-r2' });
      expect(released()).toBe(true);
      expect(db.patch).not.toHaveBeenCalledWith('escalations', expect.anything(), expect.anything());
    });

    it('releases when the customer asks for the menu', async () => {
      sessionStore.getOrCreateSession.mockResolvedValue(takenOver());
      db.get.mockResolvedValue([{ id: 'esc-1', created_at: new Date().toISOString() }]);
      await handleInboundMessage({ from: '971500', type: 'text', text: 'Menu', waMessageId: 'wamid-r3' });
      expect(released()).toBe(true);
      expect(whatsapp.sendButtons).toHaveBeenCalled();
    });

    it('keeps the takeover when the escalation cannot be checked', async () => {
      sessionStore.getOrCreateSession.mockResolvedValue(takenOver());
      db.get.mockRejectedValue(new Error('network'));
      const result = await handleInboundMessage({ from: '971500', type: 'text', text: 'hello', waMessageId: 'wamid-r4' });
      expect(released()).toBe(false);
      expect(result.humanTakeover).toBe(true);
    });
  });
});

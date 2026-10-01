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
db.patch = vi.fn();

const crmAdapter = require('../../crm/supabaseCrmAdapter');
crmAdapter.findCustomerByPhone = vi.fn();
crmAdapter.getServices = vi.fn();
crmAdapter.getServiceDetails = vi.fn();
crmAdapter.getCustomerProperties = vi.fn();
crmAdapter.getBookings = vi.fn();
crmAdapter.createComplaint = vi.fn();

const intentService = require('../../ai/intentService');
intentService.detectIntent = vi.fn();
intentService.matchServiceToCatalog = vi.fn();
intentService.classifyComplaintCategory = vi.fn();

const mediaHandler = require('../../media/mediaHandler');
mediaHandler.downloadWhatsAppMedia = vi.fn();
const transcription = require('../../media/transcription');
transcription.transcribeAudio = vi.fn();

const dedup = require('../../router/dedup');
const messageOrder = require('../../router/messageOrder');
const keyedLock = require('../../reliability/keyedLock');
const { handleInboundMessage } = require('../../router/conversationRouter');
const analytics = require('../../analytics/eventWriter');

function session(overrides = {}) {
  return {
    phone: '971500', customerId: 'cust1', currentFlow: null, currentStep: null,
    context: {}, preferredLanguage: 'en', humanTakeover: false,
    lastActivityAt: new Date().toISOString(), ...overrides,
  };
}

function voiceResult(text, overrides = {}) {
  return {
    text,
    detectedLanguage: 'en',
    confidence: 0.95,
    provider: 'gemini',
    mimeType: 'audio/ogg',
    ...overrides,
  };
}

function inbound(id = 'wamid-voice') {
  return {
    from: '971500', type: 'audio', mediaId: `media-${id}`, mediaMimeType: 'audio/ogg; codecs=opus',
    waMessageId: id, timestamp: '1000',
  };
}

describe('voice notes through the conversation router', () => {
  beforeEach(() => {
    [sessionStore.getOrCreateSession, sessionStore.updateSession, sessionStore.clearFlow, sessionStore.setFlow,
      sessionStore.setHumanTakeover, sessionStore.touchActivity, whatsapp.sendText, whatsapp.sendButtons,
      whatsapp.sendListMessage, db.insert, db.patch, crmAdapter.findCustomerByPhone, crmAdapter.getServices,
      crmAdapter.getServiceDetails, crmAdapter.getCustomerProperties, crmAdapter.getBookings,
      crmAdapter.createComplaint,
      intentService.detectIntent, intentService.matchServiceToCatalog, intentService.classifyComplaintCategory,
      mediaHandler.downloadWhatsAppMedia, transcription.transcribeAudio].forEach((fn) => fn.mockReset());
    dedup.clearForTests();
    messageOrder.clearForTests();
    keyedLock.clearForTests();
    analytics.clearTestEvents();
    db.insert.mockResolvedValue([]);
    db.patch.mockResolvedValue([]);
    crmAdapter.findCustomerByPhone.mockResolvedValue({ id: 'cust1' });
    mediaHandler.downloadWhatsAppMedia.mockResolvedValue({ buffer: Buffer.from('audio'), mimeType: 'audio/ogg' });
    intentService.matchServiceToCatalog.mockResolvedValue({ serviceId: null, confidence: 0 });
    crmAdapter.getCustomerProperties.mockResolvedValue([]);
  });

  it('routes "I need plumber tomorrow" through the existing booking flow', async () => {
    sessionStore.getOrCreateSession.mockResolvedValue(session());
    transcription.transcribeAudio.mockResolvedValue(voiceResult('I need plumber tomorrow'));
    intentService.detectIntent.mockResolvedValue({
      intent: 'NEW_BOOKING', service: 'Plumbing', issue: null, locationHint: null,
      preferredDate: 'tomorrow', preferredTime: null, language: 'en', confidence: 0.96,
    });
    crmAdapter.getServices.mockResolvedValue([{ id: 'svc-plumbing', name: 'Plumbing', category: 'plumbing' }]);

    await handleInboundMessage(inbound('wamid-booking-voice'));

    expect(sessionStore.setFlow).toHaveBeenCalledWith(
      '971500', 'booking', 'awaiting_new_property',
      expect.objectContaining({ serviceId: 'svc-plumbing', date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) })
    );
    expect(transcription.transcribeAudio).toHaveBeenCalledWith(expect.objectContaining({
      mimeType: 'audio/ogg', languageHint: 'en',
    }));
    expect(analytics.getTestEvents('971500').map((event) => event.eventType))
      .toEqual(expect.arrayContaining(['VOICE_RECEIVED', 'VOICE_TRANSCRIBED']));
  });

  it('uses semantic service matching for "bedroom light not working" in an active booking', async () => {
    sessionStore.getOrCreateSession.mockResolvedValue(session({ currentFlow: 'booking', currentStep: 'select_service' }));
    transcription.transcribeAudio.mockResolvedValue(voiceResult('My bedroom light is not working'));
    intentService.detectIntent.mockResolvedValue({ intent: 'NEW_BOOKING', confidence: 0.9, language: 'en' });
    intentService.matchServiceToCatalog.mockResolvedValue({ serviceId: 'svc-electrical', confidence: 0.94 });
    crmAdapter.getServices.mockResolvedValue([{ id: 'svc-electrical', name: 'Electrical', category: 'electrical' }]);

    await handleInboundMessage(inbound('wamid-electrical-voice'));

    expect(sessionStore.setFlow).toHaveBeenCalledWith(
      '971500', 'booking', 'awaiting_new_property',
      expect.objectContaining({ serviceId: 'svc-electrical', issue: 'My bedroom light is not working' })
    );
  });

  it('preserves a Manglish transcript and extracted booking context', async () => {
    sessionStore.getOrCreateSession.mockResolvedValue(session({ preferredLanguage: 'manglish' }));
    transcription.transcribeAudio.mockResolvedValue(voiceResult('Nale Kakkanad plumber venam', { detectedLanguage: 'ml-Latn' }));
    intentService.detectIntent.mockResolvedValue({
      intent: 'NEW_BOOKING', service: 'Plumbing', issue: null, locationHint: 'Kakkanad',
      preferredDate: 'tomorrow', preferredTime: null, language: 'manglish', confidence: 0.95,
    });
    crmAdapter.getServices.mockResolvedValue([{ id: 'svc-plumbing', name: 'Plumbing', category: 'plumbing' }]);

    await handleInboundMessage(inbound('wamid-manglish-voice'));

    expect(sessionStore.setFlow).toHaveBeenCalledWith(
      '971500', 'booking', 'awaiting_new_property',
      expect.objectContaining({ locationHint: 'Kakkanad', voiceNotes: [expect.objectContaining({ transcript: 'Nale Kakkanad plumber venam' })] })
    );
  });

  it('uses a voice transcript as complaint details and retains the media reference', async () => {
    sessionStore.getOrCreateSession.mockResolvedValue(session({
      currentFlow: 'complaint', currentStep: 'awaiting_details', context: { category: 'other', attachments: [] },
    }));
    transcription.transcribeAudio.mockResolvedValue(voiceResult('The AC is still not cooling'));
    intentService.detectIntent.mockResolvedValue({ intent: 'COMPLAINT', confidence: 0.94, language: 'en' });

    await handleInboundMessage(inbound('wamid-complaint-voice'));

    expect(sessionStore.setFlow).toHaveBeenCalledWith(
      '971500', 'complaint', 'awaiting_media',
      expect.objectContaining({
        description: 'The AC is still not cooling',
        attachments: [{ waMediaId: 'media-wamid-complaint-voice', mediaType: 'audio' }],
        voiceNotes: [expect.objectContaining({ detectedLanguage: 'en' })],
      })
    );
  });

  it('classifies a complaint voice note and continues without automatic submission', async () => {
    sessionStore.getOrCreateSession.mockResolvedValue(session({ preferredLanguage: 'manglish' }));
    transcription.transcribeAudio.mockResolvedValue(voiceResult(
      'Innale AC service cheythu, pakshe ippolum cooling illa',
      { detectedLanguage: 'ml-Latn' }
    ));
    intentService.detectIntent.mockResolvedValue({ intent: 'COMPLAINT', confidence: 0.95, language: 'manglish' });
    intentService.classifyComplaintCategory.mockResolvedValue({ category: 'problem_returned', confidence: 0.91 });
    crmAdapter.getBookings.mockResolvedValue([]);

    await handleInboundMessage(inbound('wamid-complaint-main-voice'));

    expect(sessionStore.setFlow).toHaveBeenCalledWith(
      '971500', 'complaint', 'awaiting_media',
      expect.objectContaining({
        category: 'problem_returned',
        description: 'Innale AC service cheythu, pakshe ippolum cooling illa',
        attachments: [{ waMediaId: 'media-wamid-complaint-main-voice', mediaType: 'audio' }],
      })
    );
    expect(crmAdapter.createComplaint).not.toHaveBeenCalled();
  });

  it('asks for a retry on low-confidence transcription without changing the active flow', async () => {
    sessionStore.getOrCreateSession.mockResolvedValue(session({ currentFlow: 'booking', currentStep: 'select_date' }));
    transcription.transcribeAudio.mockResolvedValue(voiceResult('unclear', { confidence: 0.2 }));

    const result = await handleInboundMessage(inbound('wamid-low-confidence'));

    expect(result.flow).toBe('booking');
    expect(result.step).toBe('select_date');
    expect(sessionStore.setFlow).not.toHaveBeenCalled();
    expect(sessionStore.clearFlow).not.toHaveBeenCalled();
    expect(mediaHandler.downloadWhatsAppMedia).toHaveBeenCalledTimes(1);
    expect(transcription.transcribeAudio).toHaveBeenCalledTimes(1);
    expect(whatsapp.sendText).toHaveBeenCalledWith('971500', expect.stringContaining('try sending it again'));
    expect(analytics.getTestEvents('971500').map((event) => event.eventType))
      .toEqual(expect.arrayContaining(['VOICE_TRANSCRIPTION_FAILED', 'TRANSCRIPTION_ERROR']));
  });

  it('preserves an active flow after media download failure', async () => {
    sessionStore.getOrCreateSession.mockResolvedValue(session({ currentFlow: 'complaint', currentStep: 'awaiting_details' }));
    mediaHandler.downloadWhatsAppMedia.mockRejectedValue(Object.assign(new Error('timeout'), { code: 'ECONNABORTED' }));

    const result = await handleInboundMessage(inbound('wamid-download-failure'));

    expect(result.flow).toBe('complaint');
    expect(result.step).toBe('awaiting_details');
    expect(sessionStore.clearFlow).not.toHaveBeenCalled();
    expect(mediaHandler.downloadWhatsAppMedia).toHaveBeenCalledTimes(1);
    expect(transcription.transcribeAudio).not.toHaveBeenCalled();
    expect(analytics.getTestEvents('971500').map((event) => event.eventType))
      .toEqual(expect.arrayContaining(['VOICE_TRANSCRIPTION_FAILED', 'MEDIA_DOWNLOAD_ERROR']));
  });

  it('does not download or transcribe a duplicate voice webhook twice', async () => {
    sessionStore.getOrCreateSession.mockResolvedValue(session());
    transcription.transcribeAudio.mockResolvedValue(voiceResult('I need plumber tomorrow'));
    intentService.detectIntent.mockResolvedValue({
      intent: 'NEW_BOOKING', service: 'Plumbing', preferredDate: 'tomorrow', language: 'en', confidence: 0.95,
    });
    crmAdapter.getServices.mockResolvedValue([{ id: 'svc-plumbing', name: 'Plumbing', category: 'plumbing' }]);
    const message = inbound('wamid-duplicate-voice');

    await handleInboundMessage(message);
    const duplicate = await handleInboundMessage(message);

    expect(duplicate.duplicate).toBe(true);
    expect(mediaHandler.downloadWhatsAppMedia).toHaveBeenCalledTimes(1);
    expect(transcription.transcribeAudio).toHaveBeenCalledTimes(1);
  });
});

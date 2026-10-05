import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mediaHandler = require('../../media/mediaHandler');
mediaHandler.downloadWhatsAppMedia = vi.fn();

const intentService = require('../../ai/intentService');
intentService.analyzeComplaintImage = vi.fn();

const whatsapp = require('../../whatsapp/client');
whatsapp.sendButtons = vi.fn();

const { reviewAttachment, handleUnsolicitedMedia, parseMediaAction } = require('../../flows/attachments');
const { todayInTimeZone, addDays } = require('../../flows/dateUtils');

const session = { phone: '971500' };
const photo = { mediaId: 'm1', mediaType: 'image' };

describe('attachment review', () => {
  const saved = process.env.IMAGE_ANALYSIS_ENABLED;
  beforeEach(() => {
    process.env.IMAGE_ANALYSIS_ENABLED = 'true';
    mediaHandler.downloadWhatsAppMedia.mockReset().mockResolvedValue({ buffer: Buffer.from('x'), mimeType: 'image/jpeg' });
    intentService.analyzeComplaintImage.mockReset();
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.IMAGE_ANALYSIS_ENABLED;
    else process.env.IMAGE_ANALYSIS_ENABLED = saved;
  });

  it('attaches as before when review is off', async () => {
    delete process.env.IMAGE_ANALYSIS_ENABLED;
    expect(await reviewAttachment(session, photo)).toEqual({ attach: true, reply: null, review: null });
    expect(mediaHandler.downloadWhatsAppMedia).not.toHaveBeenCalled();
  });

  it('never attaches a personal document', async () => {
    intentService.analyzeComplaintImage.mockResolvedValue({ relevance: 'related', containsSensitiveDocument: true, confidence: 0.9 });
    const result = await reviewAttachment(session, photo);
    expect(result.attach).toBe(false);
    expect(result.reply).toContain('personal document');
  });

  it('declines a clearly unrelated photo but keeps a doubtful one', async () => {
    intentService.analyzeComplaintImage.mockResolvedValueOnce({ relevance: 'unrelated', confidence: 0.9 })
      .mockResolvedValueOnce({ relevance: 'unrelated', confidence: 0.5 });
    expect((await reviewAttachment(session, photo)).attach).toBe(false);
    expect((await reviewAttachment(session, photo)).attach).toBe(true);
  });

  it('asks for a clearer photo when unclear, and only describes what it sees otherwise', async () => {
    intentService.analyzeComplaintImage.mockResolvedValueOnce({ relevance: 'unclear', confidence: 0.6 })
      .mockResolvedValueOnce({ relevance: 'related', confidence: 0.9, subject: 'water stain under a sink' });
    expect((await reviewAttachment(session, photo)).reply).toContain('clearer one');
    expect((await reviewAttachment(session, photo)).reply).toBe('Thank you, I\'ve attached the photo (water stain under a sink).');
  });

  it('falls back to attaching when download or review fails', async () => {
    mediaHandler.downloadWhatsAppMedia.mockRejectedValue(Object.assign(new Error('too big'), { code: 'MEDIA_TOO_LARGE' }));
    expect(await reviewAttachment(session, photo)).toEqual({ attach: true, reply: null, review: null });
  });

  it('does not review videos or documents', async () => {
    expect((await reviewAttachment(session, { mediaId: 'm2', mediaType: 'video' })).attach).toBe(true);
    expect(intentService.analyzeComplaintImage).not.toHaveBeenCalled();
  });
});

describe('media sent outside a flow', () => {
  beforeEach(() => whatsapp.sendButtons.mockReset());

  it('falls back to a plain choice for a customer with no history', async () => {
    const result = await handleUnsolicitedMedia(session, { profile: {} }, { mediaId: 'm9', type: 'document' });
    expect(result.target).toBe('none');
    expect(whatsapp.sendButtons.mock.calls[0][2][0].id).toBe('REPORT_WITH_MEDIA:none~m9~document');
  });

  it('ignores visits older than two weeks', async () => {
    const profile = { recentBookings: [{ id: 'b', reference: 'BK-1', status: 'completed', scheduledDate: addDays(todayInTimeZone(), -30) }] };
    expect((await handleUnsolicitedMedia(session, { profile }, { mediaId: 'm9', type: 'image' })).target).toBe('none');
  });

  it('parses the media payload strictly', () => {
    expect(parseMediaAction('cm-1~m1~image')).toEqual({ recordId: 'cm-1', mediaId: 'm1', mediaType: 'image' });
    expect(parseMediaAction('none~m1~video')).toEqual({ recordId: null, mediaId: 'm1', mediaType: 'video' });
    expect(parseMediaAction('cm-1~m1~audio')).toBeNull();
    expect(parseMediaAction('cm-1')).toBeNull();
  });
});

// Customer attachment intelligence.
//
// Photos sent during a complaint can be reviewed (IMAGE_ANALYSIS_ENABLED) so
// the bot can say what it received, ask for a clearer photo, or refuse to
// attach a personal document. The review describes only what is visible: it
// never diagnoses a cause, assigns fault or estimates cost. When review is
// off or fails, every photo is attached exactly as before.
//
// A photo sent outside any flow is linked to the most likely context (an
// open complaint or a recent visit) instead of being rejected.
const whatsapp = require('../whatsapp/client');
const logger = require('../utils/logger');
const { downloadWhatsAppMedia } = require('../media/mediaHandler');
const intentService = require('../ai/intentService');
const { formatDateForCustomer, todayInTimeZone, addDays } = require('./dateUtils');
const { ACTIONS, actionId } = require('./quickActions');

function config() {
  const sizeMb = Number(process.env.IMAGE_MAX_FILE_SIZE_MB) > 0 ? Number(process.env.IMAGE_MAX_FILE_SIZE_MB) : 5;
  return {
    enabled: ['1', 'true', 'yes', 'on'].includes(String(process.env.IMAGE_ANALYSIS_ENABLED || '').toLowerCase()),
    maxBytes: Math.floor(sizeMb * 1024 * 1024),
  };
}

/**
 * @returns {Promise<{attach: boolean, reply: string|null, review: object|null}>}
 */
async function reviewAttachment(session, { mediaId, mediaType }, { issue } = {}) {
  const settings = config();
  if (mediaType !== 'image' || !settings.enabled) return { attach: true, reply: null, review: null };
  let review = null;
  try {
    const media = await downloadWhatsAppMedia(mediaId, { kind: 'image', maxBytes: settings.maxBytes });
    review = await intentService.analyzeComplaintImage({ buffer: media.buffer, mimeType: media.mimeType, issue });
  } catch (error) {
    logger.warn('ATTACHMENT', 'Image review skipped:', error.code || error.message);
  }
  if (!review) return { attach: true, reply: null, review: null };

  logger.audit('ATTACHMENT_REVIEWED', {
    phone: session.phone,
    relevance: review.relevance,
    sensitive: review.containsSensitiveDocument,
    result: 'reviewed',
  });
  if (review.containsSensitiveDocument) {
    return {
      attach: false,
      review,
      reply: 'This photo seems to show a personal document or card, so for your privacy I haven\'t attached it. Please send a photo of the problem itself instead.',
    };
  }
  if (review.relevance === 'unrelated' && review.confidence >= 0.7) {
    return {
      attach: false,
      review,
      reply: 'This photo doesn\'t seem to show the problem, so I haven\'t attached it. Please send a photo of the affected area, or tap Skip / Done to continue.',
    };
  }
  if (review.relevance === 'unclear') {
    return {
      attach: true,
      review,
      reply: 'I\'ve attached the photo, but it\'s a little hard to make out. If you can, send a clearer one taken from a step back in good light.',
    };
  }
  return {
    attach: true,
    review,
    reply: review.subject ? `Thank you, I've attached the photo (${review.subject}).` : null,
  };
}

function mediaPayload(mediaId, mediaType) {
  return `${mediaId}~${mediaType}`;
}

// "<recordId|none>~<mediaId>~<mediaType>"
function parseMediaAction(id) {
  const [recordId, mediaId, mediaType] = String(id).split('~');
  if (!mediaId || !['image', 'video', 'document'].includes(mediaType)) return null;
  return { recordId: recordId && recordId !== 'none' ? recordId : null, mediaId, mediaType };
}

function recentVisit(profile) {
  const since = addDays(todayInTimeZone(), -14);
  return ((profile && profile.recentBookings) || []).find((booking) =>
    ['completed', 'in_progress'].includes(String(booking.status || '').toLowerCase())
    && (!booking.scheduledDate || booking.scheduledDate >= since));
}

/** A photo/video/document sent when no flow is waiting for one. */
async function handleUnsolicitedMedia(session, customer, inbound) {
  const profile = customer && customer.profile;
  const media = mediaPayload(inbound.mediaId, inbound.type);
  const openComplaint = profile && (profile.activeComplaints || [])[0];
  if (openComplaint) {
    await whatsapp.sendButtons(session.phone, `Thanks for the ${inbound.type === 'image' ? 'photo' : 'file'}. Shall I add it to your open complaint ${openComplaint.reference}?`, [
      { id: actionId(ACTIONS.ATTACH_MEDIA, `${openComplaint.id}~${media}`), title: `Add to ${openComplaint.reference}`.slice(0, 20) },
      { id: actionId(ACTIONS.REPORT_WITH_MEDIA, `none~${media}`), title: 'New Problem' },
      { id: 'MAIN_MENU', title: 'Main Menu' },
    ]);
    return { reply: 'media_link_offered', target: 'open_complaint', flow: null, step: null };
  }
  const visit = recentVisit(profile);
  if (visit) {
    await whatsapp.sendButtons(session.phone, `Thanks for the ${inbound.type === 'image' ? 'photo' : 'file'}. Is this about your visit ${visit.reference} on ${formatDateForCustomer(visit.scheduledDate)}?`, [
      { id: actionId(ACTIONS.REPORT_WITH_MEDIA, `${visit.id}~${media}`), title: 'Yes, Report Issue' },
      { id: actionId(ACTIONS.REPORT_WITH_MEDIA, `none~${media}`), title: 'Something Else' },
      { id: 'MAIN_MENU', title: 'Main Menu' },
    ]);
    return { reply: 'media_link_offered', target: 'recent_visit', flow: null, step: null };
  }
  await whatsapp.sendButtons(session.phone, 'Thanks for sending this. Is it about a problem with a service, or would you like to book a service?', [
    { id: actionId(ACTIONS.REPORT_WITH_MEDIA, `none~${media}`), title: 'Report a Problem' },
    { id: 'BOOK_SERVICE', title: 'Book a Service' },
    { id: 'MAIN_MENU', title: 'Main Menu' },
  ]);
  return { reply: 'media_link_offered', target: 'none', flow: null, step: null };
}

module.exports = { reviewAttachment, handleUnsolicitedMedia, parseMediaAction, config };

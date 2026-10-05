/*
 * Handoff records store a staff summary followed by the structured handoff
 * the chatbot built (see api/crm/supabaseCrmAdapter.js escalateToHuman):
 *
 *   <summary>\n\nStructured handoff:\n<json>
 *
 * This splits them so the dashboard can show the summary as prose and the
 * agent-assist fields (suggested reply, next action) as actions.
 */
const MARKER = '\n\nStructured handoff:\n';

export function parseHandoff(conversationSummary) {
  const text = String(conversationSummary ?? '');
  const index = text.indexOf(MARKER);
  if (index < 0) return { summary: text || null, handoff: null, assist: null };
  const summary = text.slice(0, index).trim() || null;
  let handoff = null;
  try {
    handoff = JSON.parse(text.slice(index + MARKER.length));
  } catch {
    handoff = null;
  }
  const assist = handoff?.assist ?? (handoff?.suggestedNextAction ? { recommendedNextAction: handoff.suggestedNextAction } : null);
  return { summary: assist?.summary ?? summary, handoff, assist };
}

/** WhatsApp click-to-chat link with the reply prefilled for the agent to edit and send. */
export function whatsappReplyLink(phone, message) {
  const digits = String(phone ?? '').replace(/\D/g, '');
  if (!digits) return null;
  return `https://wa.me/${digits}${message ? `?text=${encodeURIComponent(message)}` : ''}`;
}

export function waitingMinutes(createdAt, now = Date.now()) {
  const created = Date.parse(createdAt);
  return Number.isFinite(created) ? Math.max(0, Math.floor((now - created) / 60000)) : null;
}

export function formatWaiting(minutes) {
  if (minutes == null) return '—';
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
  return `${Math.floor(minutes / 1440)} d`;
}

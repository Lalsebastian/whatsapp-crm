// When does a human takeover end?
//
// A handoff silences the bot for that customer so it does not talk over the
// support team. Without an end condition one escalation would silence the
// number for good, so on each inbound message during a takeover the bot
// hands the conversation back when:
//
//   * the escalation was resolved/closed (bundled Supabase CRM), or
//   * the takeover is older than HUMAN_TAKEOVER_MAX_HOURS (default 24) - the
//     escalation itself stays open for staff, or
//   * the customer explicitly asks for the menu.
//
// If the state cannot be read, the takeover stays active (never talk over an
// agent by accident).
const env = require('../config/env');
const db = require('../db/supabaseClient');
const logger = require('../utils/logger');
const sessionStore = require('../session/sessionStore');

const CLOSED_STATUSES = ['resolved', 'closed'];
const RE_BACK_TO_BOT = /^\s*(?:menu|main menu|start|restart|bot)\s*[.!]*\s*$/i;

function maxHours() {
  const value = Number(process.env.HUMAN_TAKEOVER_MAX_HOURS);
  return Number.isFinite(value) && value > 0 ? value : 24;
}

async function latestOpenEscalation(phone) {
  const rows = await db.get(
    'escalations',
    `phone=eq.${encodeURIComponent(phone)}&status=not.in.(${CLOSED_STATUSES.join(',')})&select=id,created_at&order=created_at.desc&limit=1`
  );
  return (rows || [])[0] || null;
}

/**
 * @returns {Promise<{active: boolean, reason?: string}>}
 */
async function checkTakeover(session, inbound = {}, now = Date.now()) {
  if (!session || !session.humanTakeover) return { active: false };
  if (inbound.text && RE_BACK_TO_BOT.test(inbound.text)) return { active: false, reason: 'customer_requested_menu' };

  let startedAt = Date.parse(session.context && session.context.takeoverStartedAt);
  if (env.CRM_PROVIDER === 'supabase') {
    let open;
    try {
      open = await latestOpenEscalation(session.phone);
    } catch (error) {
      logger.warn('TAKEOVER', 'Could not check the escalation; keeping the takeover:', error.message);
      return { active: true };
    }
    if (!open) return { active: false, reason: 'escalation_closed' };
    if (!Number.isFinite(startedAt)) startedAt = Date.parse(open.created_at);
  }
  if (Number.isFinite(startedAt) && now - startedAt > maxHours() * 3600000) {
    return { active: false, reason: 'takeover_timeout' };
  }
  return { active: true };
}

/** Hands the conversation back to the bot. Returns true when released. */
async function releaseIfEnded(session, inbound) {
  const { active, reason } = await checkTakeover(session, inbound);
  if (active || !reason) return false;
  try {
    await sessionStore.updateSession(session.phone, { humanTakeover: false, currentFlow: null, currentStep: null, context: {} });
  } catch (error) {
    logger.warn('TAKEOVER', 'Could not release the takeover:', error.message);
    return false;
  }
  logger.audit('HUMAN_TAKEOVER_RELEASED', { phone: session.phone, reason, result: 'released' });
  logger.log('ROUTER', `Human takeover released for ${session.phone} (${reason})`);
  return true;
}

module.exports = { checkTakeover, releaseIfEnded, maxHours };

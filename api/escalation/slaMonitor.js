// Escalation SLA monitor: watches handoffs waiting for a human.
//
// Every ESCALATION_SLA_INTERVAL_MINUTES (one instance at a time, via a lease):
//   * an open escalation waiting longer than its priority's threshold is
//     marked breached and raised one priority level (once);
//   * the customer gets one reassurance message, so a silent wait never
//     looks like being ignored. No time is promised.
//
// Thresholds (minutes): ESCALATION_SLA_URGENT_MINUTES (15),
// ESCALATION_SLA_HIGH_MINUTES (30), ESCALATION_SLA_NORMAL_MINUTES (120).
//
// Works on the bundled Supabase CRM tables; with an external CRM the CRM owns
// its support queue, so the monitor stays idle.
const env = require('../config/env');
const db = require('../db/supabaseClient');
const logger = require('../utils/logger');
const coordination = require('../reliability/coordinationStore');
const whatsapp = require('../whatsapp/client');
const { isWithinServiceWindow } = require('../whatsapp/serviceWindow');

const LEASE_KEY = 'job:escalation-sla';
const NEXT_PRIORITY = { low: 'normal', normal: 'high', high: 'urgent', urgent: 'urgent' };

function minutes(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function config() {
  return {
    enabled: process.env.ESCALATION_SLA_MONITOR_ENABLED
      ? ['1', 'true', 'yes', 'on'].includes(String(process.env.ESCALATION_SLA_MONITOR_ENABLED).toLowerCase())
      : env.NODE_ENV === 'production',
    intervalMinutes: minutes('ESCALATION_SLA_INTERVAL_MINUTES', 5),
    thresholds: {
      urgent: minutes('ESCALATION_SLA_URGENT_MINUTES', 15),
      high: minutes('ESCALATION_SLA_HIGH_MINUTES', 30),
      normal: minutes('ESCALATION_SLA_NORMAL_MINUTES', 120),
      low: minutes('ESCALATION_SLA_NORMAL_MINUTES', 120),
    },
  };
}

const REASSURANCE = 'Thank you for your patience. Your request is with our support team and has been marked as a priority. A team member will reply here as soon as possible.';

function waitingMinutes(row, now) {
  const created = Date.parse(row.created_at);
  return Number.isFinite(created) ? Math.floor((now - created) / 60000) : 0;
}

async function markBreached(row, waited) {
  const priority = String(row.priority || 'normal').toLowerCase();
  const raised = NEXT_PRIORITY[priority] || 'high';
  try {
    // Conditional on sla_breached_at being empty: concurrent runs (or the
    // database SLA sweep) never raise it twice.
    const updated = await db.patch('escalations', `id=eq.${encodeURIComponent(row.id)}&sla_breached_at=is.null`, {
      priority: raised,
      sla_breached_at: new Date().toISOString(),
    });
    if (updated && updated.length) {
      logger.audit('ESCALATION_SLA_BREACHED', {
        phone: row.phone,
        escalationId: row.id,
        waitingMinutes: waited,
        priority,
        raisedTo: raised,
        result: 'raised',
      });
    }
  } catch (error) {
    logger.warn('ESCALATION_SLA', 'Could not mark breach:', error.message);
  }
}

async function reassureCustomer(row, waited) {
  if (!row.phone) return;
  // Claim the one-time reassurance first; only the instance whose update
  // matched sends it.
  let claimed;
  try {
    claimed = await db.patch('escalations', `id=eq.${encodeURIComponent(row.id)}&customer_notified_at=is.null`, {
      customer_notified_at: new Date().toISOString(),
    });
  } catch (error) {
    // Without the column the bot cannot remember it already reassured the
    // customer, so it never sends rather than risk repeating itself.
    logger.warn('ESCALATION_SLA', 'Reassurance tracking unavailable (apply the migration); not messaging customers:', error.message);
    return;
  }
  if (!claimed || claimed.length === 0) return;
  if (await isWithinServiceWindow(row.phone) === false) {
    logger.audit('ESCALATION_REASSURANCE_SKIPPED', { phone: row.phone, escalationId: row.id, reason: 'outside_service_window', result: 'skipped' });
    return;
  }
  try {
    await whatsapp.sendText(row.phone, REASSURANCE);
    logger.audit('ESCALATION_REASSURANCE_SENT', { phone: row.phone, escalationId: row.id, waitingMinutes: waited, result: 'sent' });
  } catch (error) {
    logger.warn('ESCALATION_SLA', 'Reassurance message failed:', error.message);
  }
}

async function runSlaCheckOnce(now = Date.now()) {
  const settings = config();
  if (env.CRM_PROVIDER !== 'supabase') return { skipped: 'external_crm' };
  try {
    const acquired = await coordination.tryAcquireLease(LEASE_KEY, coordination.INSTANCE_ID, Math.floor(settings.intervalMinutes * 60000 * 0.9));
    if (!acquired) return { skipped: 'other_instance' };
  } catch (error) {
    if (!db.isMissingFunction(error)) return { skipped: 'lease_unavailable' };
  }
  let rows;
  try {
    rows = await db.get('escalations', 'status=eq.open&select=id,phone,priority,created_at,sla_breached_at,customer_notified_at&order=created_at.asc&limit=200');
  } catch (error) {
    logger.warn('ESCALATION_SLA', 'Could not load open escalations:', error.message);
    return { failed: true };
  }
  let breached = 0;
  for (const row of rows || []) {
    const waited = waitingMinutes(row, now);
    const threshold = settings.thresholds[String(row.priority || 'normal').toLowerCase()] || settings.thresholds.normal;
    if (waited < threshold) continue;
    breached += 1;
    if (!row.sla_breached_at) await markBreached(row, waited);
    if (!row.customer_notified_at) await reassureCustomer(row, waited);
  }
  return { checked: (rows || []).length, breached };
}

let timer = null;

function start() {
  const settings = config();
  if (!settings.enabled) return false;
  if (timer) return true;
  timer = setInterval(() => { void runSlaCheckOnce(); }, settings.intervalMinutes * 60000);
  if (typeof timer.unref === 'function') timer.unref();
  logger.log('ESCALATION_SLA', `Escalation SLA monitor running every ${settings.intervalMinutes} min`);
  return true;
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { start, stop, runSlaCheckOnce, config, REASSURANCE };

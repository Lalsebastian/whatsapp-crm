// Periodically applies the voice-data retention policy and purges
// operational bookkeeping, via the chatbot_apply_retention() database
// function (one transaction, set-based).
//
// With several instances running, a lease in chatbot_locks makes sure only
// one of them runs the job per interval.
const db = require('../db/supabaseClient');
const logger = require('../utils/logger');
const privacy = require('../config/privacy');
const coordination = require('../reliability/coordinationStore');

const LEASE_KEY = 'job:retention';
const INITIAL_DELAY_MS = 2 * 60 * 1000;

let timer = null;
let initialTimer = null;

async function runRetentionOnce() {
  const intervalMs = privacy.RETENTION_JOB_INTERVAL_HOURS * 60 * 60 * 1000;
  try {
    // Hold the lease for most of the interval so a second instance skips this
    // run instead of repeating it minutes later.
    const acquired = await coordination.tryAcquireLease(LEASE_KEY, coordination.INSTANCE_ID, Math.floor(intervalMs * 0.9));
    if (!acquired) {
      logger.log('RETENTION', 'Another instance ran the retention job for this interval; skipping');
      return { skipped: true };
    }
  } catch (error) {
    if (!db.isMissingFunction(error)) {
      logger.warn('RETENTION', 'Could not take the retention lease; skipping this run:', error.message);
      return { skipped: true };
    }
    // Coordination functions not deployed: single-instance behaviour.
  }

  try {
    const result = await db.rpc('chatbot_apply_retention', {
      p_transcript_days: privacy.VOICE_TRANSCRIPT_RETENTION_DAYS,
      p_media_days: privacy.VOICE_MEDIA_RETENTION_DAYS,
      p_state_days: privacy.CHATBOT_STATE_RETENTION_DAYS,
    });
    logger.log('RETENTION', 'Retention applied', result);
    logger.audit('RETENTION_APPLIED', { result: 'success', ...(result && typeof result === 'object' ? result : {}) });
    return result;
  } catch (error) {
    const reason = db.isMissingFunction(error)
      ? 'chatbot_apply_retention() is missing — apply the chatbot reliability migration'
      : error.message;
    logger.error('RETENTION', 'Retention job failed:', reason);
    logger.audit('RETENTION_FAILED', { result: 'failed', reason: db.isMissingFunction(error) ? 'missing_function' : 'error' });
    return { failed: true };
  }
}

function start() {
  if (!privacy.RETENTION_JOB_ENABLED) {
    logger.log('RETENTION', 'Retention job disabled (RETENTION_JOB_ENABLED=false)');
    return false;
  }
  if (timer) return true;
  const intervalMs = privacy.RETENTION_JOB_INTERVAL_HOURS * 60 * 60 * 1000;
  initialTimer = setTimeout(() => { void runRetentionOnce(); }, INITIAL_DELAY_MS);
  timer = setInterval(() => { void runRetentionOnce(); }, intervalMs);
  if (typeof initialTimer.unref === 'function') initialTimer.unref();
  if (typeof timer.unref === 'function') timer.unref();
  logger.log('RETENTION', `Retention job scheduled every ${privacy.RETENTION_JOB_INTERVAL_HOURS}h`);
  return true;
}

function stop() {
  if (initialTimer) clearTimeout(initialTimer);
  if (timer) clearInterval(timer);
  initialTimer = null;
  timer = null;
}

module.exports = { start, stop, runRetentionOnce };

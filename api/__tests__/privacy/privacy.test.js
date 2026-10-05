import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const db = require('../../db/supabaseClient');
const privacy = require('../../config/privacy');
const coordination = require('../../reliability/coordinationStore');
const { redactSensitive, luhnValid } = require('../../privacy/redaction');
const retention = require('../../privacy/retentionScheduler');

describe('sensitive-data redaction', () => {
  it('masks a Luhn-valid card number read out with spaces or dashes', () => {
    const { text, redactions } = redactSensitive('my card is 4111 1111 1111 1111 please charge it');
    expect(text).toBe('my card is [redacted card number] please charge it');
    expect(redactions).toEqual(['card_number']);
  });

  it('keeps long numbers that are not card numbers', () => {
    expect(redactSensitive('order 1234567890123 arrived').text).toBe('order 1234567890123 arrived');
    expect(luhnValid('1234567890123')).toBe(false);
  });

  it('masks Emirates ID and UAE IBAN numbers', () => {
    const { text, redactions } = redactSensitive('ID 784-1990-1234567-1, IBAN AE07 0331 2345 6789 0123 456');
    expect(text).toBe('ID [redacted Emirates ID], IBAN [redacted IBAN]');
    expect(redactions.sort()).toEqual(['emirates_id', 'iban']);
  });

  it('leaves ordinary booking details untouched', () => {
    const message = 'AC not cooling, villa 12, call me on +971 50 123 4567 tomorrow at 10:30';
    expect(redactSensitive(message)).toEqual({ text: message, redactions: [] });
  });
});

describe('retention job', () => {
  const originalRpc = db.rpc;

  beforeEach(() => {
    db.rpc = vi.fn();
    coordination.setBackendForTests('postgres');
  });

  afterEach(() => {
    db.rpc = originalRpc;
    coordination.setBackendForTests(null);
    retention.stop();
  });

  it('applies the configured windows in one database call when it holds the lease', async () => {
    db.rpc
      .mockResolvedValueOnce(true) // chatbot_try_lock
      .mockResolvedValueOnce({ transcriptsRedacted: 3, voiceMediaDeleted: 1, bookkeepingRowsPurged: 40 });

    const result = await retention.runRetentionOnce();

    expect(result).toEqual({ transcriptsRedacted: 3, voiceMediaDeleted: 1, bookkeepingRowsPurged: 40 });
    expect(db.rpc).toHaveBeenLastCalledWith('chatbot_apply_retention', {
      p_transcript_days: privacy.VOICE_TRANSCRIPT_RETENTION_DAYS,
      p_media_days: privacy.VOICE_MEDIA_RETENTION_DAYS,
      p_state_days: privacy.CHATBOT_STATE_RETENTION_DAYS,
    });
  });

  it('skips the run when another instance holds the lease', async () => {
    db.rpc.mockResolvedValueOnce(false);
    await expect(retention.runRetentionOnce()).resolves.toEqual({ skipped: true });
    expect(db.rpc).toHaveBeenCalledTimes(1);
  });

  it('reports (and does not throw) when the retention function is not deployed', async () => {
    const missing = Object.assign(new Error('Not Found'), { response: { status: 404, data: { code: 'PGRST202' } } });
    db.rpc.mockRejectedValue(missing);
    await expect(retention.runRetentionOnce()).resolves.toEqual({ failed: true });
  });

  it('does not schedule anything when disabled', () => {
    const enabled = privacy.RETENTION_JOB_ENABLED;
    privacy.RETENTION_JOB_ENABLED = false;
    try {
      expect(retention.start()).toBe(false);
    } finally {
      privacy.RETENTION_JOB_ENABLED = enabled;
    }
  });
});

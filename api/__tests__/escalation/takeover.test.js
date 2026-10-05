import { describe, it, expect, afterEach } from 'vitest';

const env = require('../../config/env');
const { checkTakeover } = require('../../escalation/takeover');

describe('takeover end with an external CRM (no escalation lookup)', () => {
  const provider = env.CRM_PROVIDER;
  afterEach(() => { env.CRM_PROVIDER = provider; });

  it('uses the takeover start time recorded on the session', async () => {
    env.CRM_PROVIDER = 'http';
    const now = Date.parse('2031-01-02T12:00:00Z');
    const session = (startedAt) => ({ phone: '971500', humanTakeover: true, context: { takeoverStartedAt: startedAt } });
    expect(await checkTakeover(session('2031-01-02T10:00:00Z'), { text: 'hello' }, now)).toEqual({ active: true });
    expect(await checkTakeover(session('2031-01-01T10:00:00Z'), { text: 'hello' }, now)).toEqual({ active: false, reason: 'takeover_timeout' });
    expect(await checkTakeover({ phone: '971500', humanTakeover: true, context: {} }, { text: 'hello' }, now)).toEqual({ active: true });
  });
});

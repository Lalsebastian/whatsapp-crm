import { describe, it, expect, vi } from 'vitest';

const { runWithScenario, activeScenario, describeScenarios } = require('../../simulation/scenarios');
const testChannel = require('../../whatsapp/testChannel');
const { wrapCrmAdapter } = require('../../crm/reliableCrmAdapter');

function adapter() {
  return {
    createBooking: vi.fn(async () => ({ id: 'bk-1' })),
    getServices: vi.fn(async () => [{ id: 's' }]),
    checkServiceability: vi.fn(async () => ({ serviceable: true })),
    getAvailability: vi.fn(async () => ['09:00']),
  };
}

const inConsole = (scenario, fn) => testChannel.withCapture(() => runWithScenario(scenario, fn)).then(({ result }) => result);

describe('admin simulation scenarios', () => {
  it('lists every preset with a starter message', () => {
    const ids = describeScenarios().map((scenario) => scenario.id);
    expect(ids).toEqual(['new_customer', 'returning_customer', 'service_unavailable', 'crm_timeout', 'ai_low_confidence', 'complaint_escalation']);
    expect(describeScenarios().every((scenario) => scenario.starter)).toBe(true);
  });

  it('never applies to real traffic, even inside runWithScenario', async () => {
    expect(await runWithScenario('crm_timeout', async () => activeScenario())).toBeNull();
    expect(await inConsole('crm_timeout', async () => activeScenario())).toBe('crm_timeout');
    expect(await inConsole('not_a_scenario', async () => activeScenario())).toBeNull();
  });

  it('crm_timeout makes writes uncertain without tripping the real circuit breaker', async () => {
    const real = adapter();
    const crm = wrapCrmAdapter(real, { timeoutMs: 1000, maxReadRetries: 0 });
    for (let attempt = 0; attempt < 8; attempt += 1) {
      await expect(inConsole('crm_timeout', () => crm.createBooking({}))).rejects.toMatchObject({ uncertain: true, simulated: true });
    }
    expect(real.createBooking).not.toHaveBeenCalled();
    expect(await inConsole('crm_timeout', () => crm.getServices())).toEqual([{ id: 's' }]);
    expect(await crm.createBooking({})).toEqual({ id: 'bk-1' });
  });

  it('service_unavailable closes every address and slot', async () => {
    const crm = wrapCrmAdapter(adapter(), { timeoutMs: 1000 });
    expect(await inConsole('service_unavailable', () => crm.checkServiceability('s', {}))).toMatchObject({ serviceable: false });
    expect(await inConsole('service_unavailable', () => crm.getAvailability('s', '2031-01-01'))).toEqual([]);
    expect(await crm.getAvailability('s', '2031-01-01')).toEqual(['09:00']);
  });
});

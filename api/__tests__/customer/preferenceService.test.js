import { beforeEach, describe, expect, it, vi } from 'vitest';

const crm = require('../../crm/supabaseCrmAdapter');
crm.updateCustomerPreferences = vi.fn();
crm.getCustomerProperties = vi.fn();
const whatsapp = require('../../whatsapp/client');
whatsapp.sendText = vi.fn();
const sessionStore = require('../../session/sessionStore');
sessionStore.updateSession = vi.fn();
const service = require('../../customer/preferenceService');

describe('customer preference service', () => {
  beforeEach(() => {
    crm.updateCustomerPreferences.mockReset().mockResolvedValue({});
    crm.getCustomerProperties.mockReset().mockResolvedValue([]);
    whatsapp.sendText.mockReset();
    sessionStore.updateSession.mockReset();
  });

  it('persists an explicitly requested language', async () => {
    const result = await service.handlePreferenceCommand(
      { phone: '971500' }, { id: 'cust1' }, 'Please reply to me in Malayalam'
    );
    expect(result).toMatchObject({ handled: true, value: 'ml' });
    expect(crm.updateCustomerPreferences).toHaveBeenCalledWith('cust1', { preferredLanguage: 'ml' });
  });

  it('persists an explicitly requested saved default property', async () => {
    crm.getCustomerProperties.mockResolvedValue([
      { id: 'office1', label: 'Office', addressLine: 'Business Bay' },
    ]);
    const result = await service.handlePreferenceCommand(
      { phone: '971500' }, { id: 'cust1' }, 'Use my office address by default'
    );
    expect(result.updated).toBe(true);
    expect(crm.updateCustomerPreferences).toHaveBeenCalledWith('cust1', { defaultPropertyId: 'office1' });
  });

  it('does not create or save an invalid property preference', async () => {
    const result = await service.handlePreferenceCommand(
      { phone: '971500' }, { id: 'cust1' }, 'Use Kakkanad as my main address'
    );
    expect(result).toMatchObject({ handled: true, updated: false });
    expect(crm.updateCustomerPreferences).not.toHaveBeenCalled();
  });

  it('does not save arbitrary conversation text as memory', async () => {
    const result = await service.handlePreferenceCommand(
      { phone: '971500' }, { id: 'cust1' }, 'My air conditioner is making a loud sound'
    );
    expect(result.handled).toBe(false);
    expect(crm.updateCustomerPreferences).not.toHaveBeenCalled();
  });
});

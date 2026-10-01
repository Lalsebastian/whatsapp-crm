import { beforeEach, describe, expect, it, vi } from 'vitest';

const crm = require('../../crm/supabaseCrmAdapter');
crm.getCustomerProperties = vi.fn();
crm.getBookings = vi.fn();
crm.getActiveComplaints = vi.fn();
const profiles = require('../../customer/customerProfileService');

describe('customer profile service', () => {
  beforeEach(() => {
    profiles.clearForTests();
    crm.getCustomerProperties.mockReset().mockResolvedValue([
      { id: 'p1', label: 'Home', isDefault: true },
    ]);
    crm.getBookings.mockReset().mockResolvedValue([{ id: 'b1' }]);
    crm.getActiveComplaints.mockReset().mockResolvedValue([{ id: 'c1' }]);
  });

  it('builds a lightweight CRM profile for a returning customer', async () => {
    const profile = await profiles.loadCustomerProfile({
      id: 'cust1', name: 'John', preferredLanguage: 'ml', returningCustomer: true,
    });
    expect(profile).toMatchObject({
      customerId: 'cust1', name: 'John', returningCustomer: true,
      preferredLanguage: 'ml', defaultProperty: { id: 'p1' }, profileSource: 'crm',
    });
  });

  it('uses the bounded TTL cache instead of refetching on every message', async () => {
    const customer = { id: 'cust1', returningCustomer: true };
    await profiles.loadCustomerProfile(customer);
    await profiles.loadCustomerProfile(customer);
    expect(crm.getCustomerProperties).toHaveBeenCalledTimes(1);
    expect(crm.getBookings).toHaveBeenCalledTimes(1);
    expect(crm.getActiveComplaints).toHaveBeenCalledTimes(1);
  });
});

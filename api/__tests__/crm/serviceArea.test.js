import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const db = require('../../db/supabaseClient');
db.get = vi.fn();

const { checkServiceability } = require('../../crm/supabaseCrmAdapter');

describe('bundled CRM service area', () => {
  const saved = { ...process.env };
  beforeEach(() => {
    db.get.mockReset().mockResolvedValue([]);
    delete process.env.SERVICEABLE_PINCODES;
    delete process.env.SERVICEABLE_CITIES;
  });
  afterEach(() => { process.env = { ...saved }; });

  it('serves everywhere until areas are configured', async () => {
    expect(await checkServiceability('s', { postalCode: '110001' })).toMatchObject({ serviceable: true, source: 'crm_not_configured' });
  });

  it('matches PIN codes exactly or by prefix, including one typed in the address', async () => {
    process.env.SERVICEABLE_PINCODES = '682030, 6820*';
    expect((await checkServiceability('s', { postalCode: '682030' })).serviceable).toBe(true);
    expect((await checkServiceability('s', { postalCode: '682042' })).serviceable).toBe(true);
    expect(await checkServiceability('s', { postalCode: '560001' })).toMatchObject({ serviceable: false, source: 'pincode' });
    expect((await checkServiceability('s', { address: '12 MG Road, Bengaluru 560 001' })).serviceable).toBe(false);
  });

  it('falls back to city or locality names when there is no PIN code', async () => {
    process.env.SERVICEABLE_PINCODES = '682030';
    process.env.SERVICEABLE_CITIES = 'Kochi, Kakkanad';
    expect((await checkServiceability('s', { city: 'kochi' })).serviceable).toBe(true);
    expect((await checkServiceability('s', { city: 'Mumbai', areaName: 'Andheri' })).serviceable).toBe(false);
  });

  it('never refuses without evidence', async () => {
    process.env.SERVICEABLE_PINCODES = '682030';
    expect(await checkServiceability('s', { address: 'Villa 9' })).toMatchObject({ serviceable: true, source: 'insufficient_location' });
  });

  it('looks up a saved property', async () => {
    process.env.SERVICEABLE_PINCODES = '682030';
    db.get.mockResolvedValue([{ id: 'p1', address_line: 'Villa 1', postal_code: '400001', city: 'Mumbai' }]);
    expect((await checkServiceability('s', { propertyId: 'p1', source: 'saved_property' })).serviceable).toBe(false);
  });
});

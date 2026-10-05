import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const axios = require('axios');
const geocoder = require('../../geo/geocoder');

const savedEnv = { ...process.env };

function setEnv(values) {
  for (const key of ['GEOCODING_PROVIDER', 'GOOGLE_MAPS_API_KEY', 'NOMINATIM_CONTACT_EMAIL', 'NOMINATIM_BASE_URL', 'GEOCODING_COUNTRY']) {
    delete process.env[key];
  }
  Object.assign(process.env, values);
}

describe('reverse geocoding', () => {
  let getSpy;

  beforeEach(() => {
    geocoder.clearForTests();
    getSpy = vi.spyOn(axios, 'get');
  });

  afterEach(() => {
    getSpy.mockRestore();
    process.env = { ...savedEnv };
  });

  it('is off by default and never calls a provider', async () => {
    setEnv({});
    await expect(geocoder.reverseGeocode({ latitude: 25.08, longitude: 55.14 })).resolves.toBeNull();
    expect(getSpy).not.toHaveBeenCalled();
  });

  it('requires credentials for the configured provider', () => {
    setEnv({ GEOCODING_PROVIDER: 'google' });
    expect(geocoder.isEnabled()).toBe(false);
    setEnv({ GEOCODING_PROVIDER: 'nominatim' });
    expect(geocoder.isEnabled()).toBe(false); // Nominatim policy: identify yourself
  });

  it('reads the PIN code, locality and state of an Indian address', async () => {
    setEnv({ GEOCODING_PROVIDER: 'google', GOOGLE_MAPS_API_KEY: 'g-key' });
    getSpy.mockResolvedValue({
      data: {
        status: 'OK',
        results: [{
          formatted_address: 'Infopark Rd, Kakkanad, Kochi, Kerala 682042, India',
          place_id: 'ChIJin',
          geometry: { location: { lat: 10.0159, lng: 76.3419 }, location_type: 'GEOMETRIC_CENTER' },
          address_components: [
            { long_name: 'Infopark Road', types: ['route'] },
            { long_name: 'Kakkanad', types: ['sublocality_level_1', 'sublocality', 'political'] },
            { long_name: 'Kochi', types: ['locality', 'political'] },
            { long_name: 'Ernakulam', types: ['administrative_area_level_3', 'political'] },
            { long_name: 'Kerala', types: ['administrative_area_level_1', 'political'] },
            { long_name: 'India', types: ['country', 'political'] },
            { long_name: '682042', types: ['postal_code'] },
          ],
        }],
      },
    });

    expect(await geocoder.reverseGeocode({ latitude: 10.0159, longitude: 76.3419 })).toMatchObject({
      area: 'Kakkanad', city: 'Kochi', state: 'Kerala', postalCode: '682042', country: 'India',
    });
  });

  it('looks up a typed address within the configured country (Google only)', async () => {
    setEnv({ GEOCODING_PROVIDER: 'google', GOOGLE_MAPS_API_KEY: 'g-key', GEOCODING_COUNTRY: 'in' });
    getSpy.mockResolvedValue({ data: { status: 'OK', results: [{
      formatted_address: 'Kakkanad, Kochi, Kerala 682030, India',
      geometry: { location: { lat: 10.01, lng: 76.34 }, location_type: 'APPROXIMATE' },
      address_components: [{ long_name: '682030', types: ['postal_code'] }, { long_name: 'Kochi', types: ['locality'] }],
    }] } });

    expect(await geocoder.geocodeAddress('Flat 3B, Skyline Apartments, Kakkanad')).toMatchObject({ postalCode: '682030', city: 'Kochi', latitude: 10.01 });
    expect(getSpy.mock.calls[0][1].params).toMatchObject({ address: 'Flat 3B, Skyline Apartments, Kakkanad', components: 'country:IN', region: 'in' });

    setEnv({ GEOCODING_PROVIDER: 'nominatim', NOMINATIM_CONTACT_EMAIL: 'ops@example.com' });
    expect(await geocoder.geocodeAddress('Flat 3B, Skyline Apartments, Kakkanad')).toBeNull();
  });

  it('maps a Google result to address line, area and city', async () => {
    setEnv({ GEOCODING_PROVIDER: 'google', GOOGLE_MAPS_API_KEY: 'g-key' });
    getSpy.mockResolvedValue({
      data: {
        status: 'OK',
        results: [{
          formatted_address: 'Marina Walk - Dubai Marina - Dubai - United Arab Emirates',
          place_id: 'ChIJ123',
          address_components: [
            { long_name: 'Marina Walk', types: ['route'] },
            { long_name: 'Dubai Marina', types: ['neighborhood', 'political'] },
            { long_name: 'Dubai', types: ['locality', 'political'] },
            { long_name: 'United Arab Emirates', types: ['country', 'political'] },
          ],
        }],
      },
    });

    const result = await geocoder.reverseGeocode({ latitude: 25.0805, longitude: 55.1403 });

    expect(result).toMatchObject({
      formattedAddress: 'Marina Walk - Dubai Marina - Dubai - United Arab Emirates',
      addressLine: 'Marina Walk',
      area: 'Dubai Marina',
      city: 'Dubai',
      country: 'United Arab Emirates',
      placeId: 'ChIJ123',
      provider: 'google',
    });
    expect(getSpy).toHaveBeenCalledWith('https://maps.googleapis.com/maps/api/geocode/json', expect.objectContaining({
      params: expect.objectContaining({ latlng: '25.0805,55.1403', key: 'g-key' }),
    }));
  });

  it('maps a Nominatim result and identifies itself as the usage policy requires', async () => {
    setEnv({ GEOCODING_PROVIDER: 'nominatim', NOMINATIM_CONTACT_EMAIL: 'ops@example.com' });
    getSpy.mockResolvedValue({
      data: {
        display_name: 'Al Barsha 1, Dubai, United Arab Emirates',
        place_id: 9, osm_type: 'way', osm_id: 42,
        address: { road: '23rd Street', suburb: 'Al Barsha 1', city: 'Dubai', country: 'United Arab Emirates' },
      },
    });

    const result = await geocoder.reverseGeocode({ latitude: 25.1, longitude: 55.2 });

    expect(result).toMatchObject({ addressLine: '23rd Street', area: 'Al Barsha 1', city: 'Dubai', placeId: 'osm:way:42', provider: 'nominatim' });
    expect(getSpy.mock.calls[0][1].headers['User-Agent']).toContain('ops@example.com');
  });

  it('returns null (never throws) when the provider fails, has no result, or rejects the key', async () => {
    setEnv({ GEOCODING_PROVIDER: 'google', GOOGLE_MAPS_API_KEY: 'g-key' });
    getSpy
      .mockRejectedValueOnce(Object.assign(new Error('timeout'), { code: 'ECONNABORTED' }))
      .mockResolvedValueOnce({ data: { status: 'ZERO_RESULTS', results: [] } })
      .mockResolvedValueOnce({ data: { status: 'REQUEST_DENIED' } });

    await expect(geocoder.reverseGeocode({ latitude: 25.1, longitude: 55.2 })).resolves.toBeNull();
    await expect(geocoder.reverseGeocode({ latitude: 25.2, longitude: 55.3 })).resolves.toBeNull();
    await expect(geocoder.reverseGeocode({ latitude: 25.3, longitude: 55.4 })).resolves.toBeNull();
  });

  it('rejects impossible coordinates without a network call', async () => {
    setEnv({ GEOCODING_PROVIDER: 'google', GOOGLE_MAPS_API_KEY: 'g-key' });
    await expect(geocoder.reverseGeocode({ latitude: 0, longitude: 0 })).resolves.toBeNull();
    await expect(geocoder.reverseGeocode({ latitude: 95, longitude: 55 })).resolves.toBeNull();
    await expect(geocoder.reverseGeocode({ latitude: 'abc', longitude: 55 })).resolves.toBeNull();
    expect(getSpy).not.toHaveBeenCalled();
  });

  it('caches identical pins', async () => {
    setEnv({ GEOCODING_PROVIDER: 'google', GOOGLE_MAPS_API_KEY: 'g-key' });
    getSpy.mockResolvedValue({ data: { status: 'OK', results: [{ formatted_address: 'X', address_components: [] }] } });
    await geocoder.reverseGeocode({ latitude: 25.123456, longitude: 55.123456 });
    await geocoder.reverseGeocode({ latitude: 25.123456, longitude: 55.123456 });
    expect(getSpy).toHaveBeenCalledTimes(1);
  });
});

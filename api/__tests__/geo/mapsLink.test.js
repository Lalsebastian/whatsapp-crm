import { describe, it, expect, vi, beforeEach } from 'vitest';

const axios = require('axios');
axios.get = vi.fn();

const { findMapsLink, parseMapsUrl, resolveMapsLink, locationFromMapsText } = require('../../geo/mapsLink');

const redirect = (location) => ({ status: 302, headers: { location } });

describe('Google Maps links', () => {
  beforeEach(() => axios.get.mockReset());

  it('finds a Maps link inside a message', () => {
    expect(findMapsLink('here https://maps.app.goo.gl/W1wWCbSDsp9Gx5Nm9 thanks')).toBe('https://maps.app.goo.gl/W1wWCbSDsp9Gx5Nm9');
    expect(findMapsLink('see https://www.google.com/maps/place/X/@25.1,55.2,17z).')).toBe('https://www.google.com/maps/place/X/@25.1,55.2,17z');
    expect(findMapsLink('https://example.com/maps?q=25,55')).toBeNull();
    expect(findMapsLink('Villa 12, Kakkanad')).toBeNull();
  });

  it.each([
    ['https://www.google.com/maps/place/Marina+Plaza/@25.07,55.13,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d25.0712!4d55.1389', 25.0712, 55.1389, 'Marina Plaza'],
    ['https://maps.google.com/?q=25.2048,55.2708', 25.2048, 55.2708, null],
    ['https://www.google.com/maps/search/25.204849,+55.270783?entry=tts', 25.204849, 55.270783, null],
    ['https://www.google.com/maps/@10.0159,76.3419,15z', 10.0159, 76.3419, null],
    ['https://maps.google.com/maps?q=-33.86,151.2&z=15', -33.86, 151.2, null],
  ])('reads %s', (url, latitude, longitude, placeName) => {
    expect(parseMapsUrl(url)).toMatchObject({ latitude, longitude, placeName, hasCoordinates: true });
  });

  it('keeps a place name when there are no coordinates', () => {
    expect(parseMapsUrl('https://www.google.com/maps?q=Dubai+Mall')).toMatchObject({ hasCoordinates: false, placeName: 'Dubai Mall' });
  });

  it('expands a short link by following redirects', async () => {
    axios.get.mockResolvedValueOnce(redirect('https://maps.google.com/?q=25.2048,55.2708&ftid=0x1'));
    expect(await resolveMapsLink('https://maps.app.goo.gl/abc')).toEqual({ latitude: 25.2048, longitude: 55.2708, placeName: null });
    expect(axios.get).toHaveBeenCalledTimes(1);
    expect(axios.get.mock.calls[0][1]).toMatchObject({ maxRedirects: 0 });
  });

  it('follows a consent page to its destination', async () => {
    axios.get.mockResolvedValueOnce(redirect(`https://consent.google.com/m?continue=${encodeURIComponent('https://www.google.com/maps/@25.1,55.2,15z')}`));
    expect(await resolveMapsLink('https://maps.app.goo.gl/abc')).toMatchObject({ latitude: 25.1, longitude: 55.2 });
  });

  it('never requests a non-Google host', async () => {
    axios.get.mockResolvedValueOnce(redirect('https://evil.example.com/steal'));
    expect(await resolveMapsLink('https://maps.app.goo.gl/abc')).toBeNull();
    expect(axios.get).toHaveBeenCalledTimes(1);
  });

  it('returns null when the link cannot be fetched', async () => {
    axios.get.mockRejectedValueOnce(Object.assign(new Error('timeout'), { code: 'ECONNABORTED' }));
    expect(await resolveMapsLink('https://maps.app.goo.gl/abc')).toBeNull();
  });

  it('turns a link message into a location pin, and flags links it cannot read', async () => {
    const pin = await locationFromMapsText({ type: 'text', text: 'https://maps.google.com/?q=25.2,55.3' });
    expect(pin).toMatchObject({ type: 'location', location: { latitude: 25.2, longitude: 55.3, source: 'whatsapp_location', via: 'maps_link' } });
    expect(axios.get).not.toHaveBeenCalled();

    axios.get.mockResolvedValueOnce({ status: 200, headers: {} });
    const unread = await locationFromMapsText({ type: 'text', text: 'https://maps.app.goo.gl/zzz' });
    expect(unread).toMatchObject({ type: 'text', mapsLink: { unreadable: true } });

    const plain = { type: 'text', text: 'hello' };
    expect(await locationFromMapsText(plain)).toBe(plain);
  });
});

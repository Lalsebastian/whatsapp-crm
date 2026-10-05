// Reverse geocoding for WhatsApp location pins: turns latitude/longitude into
// a street-level address, area and city.
//
// Providers (GEOCODING_PROVIDER):
//   none       default; pins without an address fall back to asking for one
//   google     Google Geocoding API (GOOGLE_MAPS_API_KEY)
//   nominatim  OpenStreetMap Nominatim. The public instance's usage policy
//              requires an identifying User-Agent/contact (NOMINATIM_CONTACT_EMAIL)
//              and at most 1 request/second; set NOMINATIM_BASE_URL for a
//              self-hosted or commercial instance.
//
// A geocoded address is a suggestion: the customer always confirms it and
// adds their building/flat details before it is saved. Coordinates are never
// written to logs.
const axios = require('axios');
const reliability = require('../config/reliability');
const logger = require('../utils/logger');
const { withTimeout } = require('../reliability/asyncPolicy');
const { CircuitBreaker } = require('../reliability/circuitBreaker');

function config() {
  return {
    provider: String(process.env.GEOCODING_PROVIDER || 'none').trim().toLowerCase(),
    googleKey: process.env.GOOGLE_MAPS_API_KEY || '',
    nominatimBaseUrl: (process.env.NOMINATIM_BASE_URL || 'https://nominatim.openstreetmap.org').replace(/\/+$/, ''),
    nominatimContact: process.env.NOMINATIM_CONTACT_EMAIL || '',
    language: process.env.GEOCODING_LANGUAGE || 'en',
    // ISO country code that typed addresses are searched in (e.g. IN), so
    // "MG Road" is not matched in another country. Empty = anywhere.
    country: String(process.env.GEOCODING_COUNTRY || '').trim().toUpperCase(),
    timeoutMs: Number(process.env.GEOCODING_TIMEOUT_MS) > 0 ? Number(process.env.GEOCODING_TIMEOUT_MS) : 5000,
  };
}

const breaker = new CircuitBreaker('Geocoding', {
  failureThreshold: reliability.PROVIDER_FAILURE_THRESHOLD,
  cooldownMs: reliability.PROVIDER_COOLDOWN_MS,
});

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX = 500;
const cache = new Map();

function isValidCoordinate(latitude, longitude) {
  return Number.isFinite(latitude) && Number.isFinite(longitude)
    && latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180
    && !(latitude === 0 && longitude === 0);
}

// ~1 m precision: identical pins share a cache entry.
function cacheKey(provider, latitude, longitude) {
  return `${provider}:${latitude.toFixed(5)},${longitude.toFixed(5)}`;
}

function fromCache(key) {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.at > CACHE_TTL_MS) {
    cache.delete(key);
    return undefined;
  }
  return entry.value;
}

function remember(key, value) {
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(key, { at: Date.now(), value });
}

function isEnabled() {
  const { provider, googleKey, nominatimContact } = config();
  if (provider === 'google') return Boolean(googleKey);
  if (provider === 'nominatim') return Boolean(nominatimContact);
  return false;
}

function component(components, ...types) {
  const match = (components || []).find((item) => types.some((type) => (item.types || []).includes(type)));
  return match ? match.long_name : null;
}

function fromGoogleResult(best) {
  const components = best.address_components;
  const street = [component(components, 'street_number'), component(components, 'route')].filter(Boolean).join(' ');
  const location = best.geometry && best.geometry.location;
  return {
    formattedAddress: best.formatted_address,
    addressLine: street || component(components, 'premise', 'establishment', 'point_of_interest') || best.formatted_address,
    area: component(components, 'neighborhood', 'sublocality_level_1', 'sublocality', 'sublocality_level_2'),
    city: component(components, 'locality', 'administrative_area_level_3', 'administrative_area_level_2'),
    state: component(components, 'administrative_area_level_1'),
    postalCode: component(components, 'postal_code'),
    country: component(components, 'country'),
    latitude: location ? Number(location.lat) : null,
    longitude: location ? Number(location.lng) : null,
    precision: (best.geometry && best.geometry.location_type) || null,
    partialMatch: !!best.partial_match,
    placeId: best.place_id || null,
    provider: 'google',
  };
}

async function googleRequest(params, settings) {
  const response = await axios.get('https://maps.googleapis.com/maps/api/geocode/json', {
    params: { ...params, key: settings.googleKey, language: settings.language },
    timeout: settings.timeoutMs,
  });
  const data = response.data || {};
  if (data.status === 'ZERO_RESULTS') return null;
  if (data.status !== 'OK') {
    const error = new Error(`Google geocoding status ${data.status}`);
    error.code = 'GEOCODING_PROVIDER_ERROR';
    throw error;
  }
  const best = (data.results || [])[0];
  return best ? fromGoogleResult(best) : null;
}

async function googleForward(text, settings) {
  return googleRequest({
    address: text,
    ...(settings.country ? { components: `country:${settings.country}`, region: settings.country.toLowerCase() } : {}),
  }, settings);
}

async function googleReverse({ latitude, longitude }, settings) {
  return googleRequest({ latlng: `${latitude},${longitude}` }, settings);
}

async function nominatimReverse({ latitude, longitude }, settings) {
  const response = await axios.get(`${settings.nominatimBaseUrl}/reverse`, {
    params: { format: 'jsonv2', lat: latitude, lon: longitude, addressdetails: 1, zoom: 18, 'accept-language': settings.language },
    headers: { 'User-Agent': `home-services-whatsapp-chatbot (${settings.nominatimContact})` },
    timeout: settings.timeoutMs,
  });
  const data = response.data || {};
  if (data.error || !data.display_name) return null;
  const address = data.address || {};
  const street = [address.house_number, address.road].filter(Boolean).join(' ');
  return {
    formattedAddress: data.display_name,
    addressLine: street || address.building || address.amenity || data.display_name.split(',')[0],
    area: address.neighbourhood || address.suburb || address.quarter || address.city_district || null,
    city: address.city || address.town || address.village || address.county || null,
    state: address.state || null,
    postalCode: address.postcode || null,
    country: address.country || null,
    latitude: Number(data.lat),
    longitude: Number(data.lon),
    placeId: data.place_id ? `osm:${data.osm_type || ''}:${data.osm_id || data.place_id}` : null,
    provider: 'nominatim',
  };
}

/**
 * @returns {Promise<{formattedAddress: string, addressLine: string, area: string|null, city: string|null, state: string|null, postalCode: string|null, country: string|null, placeId: string|null, provider: string}|null>}
 *   null when disabled, unresolvable, or the provider failed (never throws)
 */
async function reverseGeocode({ latitude, longitude }) {
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!isEnabled() || !isValidCoordinate(lat, lng)) return null;
  const settings = config();
  const key = cacheKey(settings.provider, lat, lng);
  const cached = fromCache(key);
  if (cached !== undefined) return cached;

  const startedAt = Date.now();
  try {
    breaker.assertAvailable();
    const lookup = settings.provider === 'google' ? googleReverse : nominatimReverse;
    const result = await withTimeout(() => lookup({ latitude: lat, longitude: lng }, settings), settings.timeoutMs + 500, 'geocoding.reverse');
    breaker.recordSuccess();
    remember(key, result);
    logger.audit('LOCATION_GEOCODED', {
      provider: settings.provider,
      latencyMs: Date.now() - startedAt,
      result: result ? 'success' : 'no_result',
    });
    return result;
  } catch (error) {
    if (error.code !== 'CIRCUIT_OPEN') breaker.recordFailure();
    logger.warn('GEOCODING', 'Reverse geocoding failed:', error.code || (error.response && error.response.status) || error.message);
    logger.audit('LOCATION_GEOCODING_FAILED', {
      provider: settings.provider,
      errorCategory: error.code || 'GEOCODING_PROVIDER_ERROR',
      latencyMs: Date.now() - startedAt,
      result: 'failed',
    });
    return null;
  }
}

/**
 * Looks up a typed address (Google only) to find its PIN/postal code,
 * locality and coordinates for the service-area check. A result is a hint:
 * the customer's own text stays the saved address line.
 * @returns {Promise<object|null>} same shape as reverseGeocode, or null
 */
async function geocodeAddress(text) {
  const query = String(text || '').trim();
  const settings = config();
  if (!isEnabled() || settings.provider !== 'google' || query.length < 5) return null;
  const key = `${settings.provider}:fwd:${settings.country}:${query.toLowerCase()}`;
  const cached = fromCache(key);
  if (cached !== undefined) return cached;
  const startedAt = Date.now();
  try {
    breaker.assertAvailable();
    const result = await withTimeout(() => googleForward(query, settings), settings.timeoutMs + 500, 'geocoding.forward');
    breaker.recordSuccess();
    remember(key, result);
    logger.audit('ADDRESS_GEOCODED', { provider: settings.provider, latencyMs: Date.now() - startedAt, result: result ? 'success' : 'no_result' });
    return result;
  } catch (error) {
    if (error.code !== 'CIRCUIT_OPEN') breaker.recordFailure();
    logger.warn('GEOCODING', 'Address lookup failed:', error.code || (error.response && error.response.status) || error.message);
    return null;
  }
}

function clearForTests() {
  cache.clear();
  breaker.recordSuccess();
}

module.exports = { reverseGeocode, geocodeAddress, isEnabled, isValidCoordinate, clearForTests };

// Google Maps links pasted into the chat ("https://maps.app.goo.gl/…",
// "https://www.google.com/maps/place/…/@25.2,55.3,17z", "maps.google.com/?q=…").
//
// Customers often share a location this way instead of with WhatsApp's own
// location pin. The link is turned into the same { latitude, longitude }
// shape as a pin so every step that accepts a pin accepts a link too.
//
// Short links are expanded by following redirects one hop at a time, and only
// ever to Google hosts (no request is made to any other host). Coordinates
// are never logged.
const axios = require('axios');
const logger = require('../utils/logger');

const RE_LINK = /\bhttps?:\/\/(?:maps\.app\.goo\.gl|goo\.gl\/maps|(?:www\.|maps\.)?google\.[a-z.]{2,6}\/maps|maps\.google\.[a-z.]{2,6})[^\s<>"]*/i;
const ALLOWED_HOST = /^(?:maps\.app\.goo\.gl|goo\.gl|(?:www\.|maps\.|consent\.)?google\.[a-z]{2,3}(?:\.[a-z]{2})?)$/i;
const MAX_HOPS = 5;
const NUMBER = '(-?\\d{1,3}(?:\\.\\d+)?)';

function findMapsLink(text) {
  const match = String(text || '').match(RE_LINK);
  return match ? match[0].replace(/[).,!?]+$/, '') : null;
}

function validCoordinate(latitude, longitude) {
  return Number.isFinite(latitude) && Number.isFinite(longitude)
    && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180
    && !(latitude === 0 && longitude === 0);
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

// Most precise first: a place's own pin (!3d…!4d…), an explicit query point,
// a coordinate path segment, then the map viewport centre (@lat,lng).
const COORDINATE_PATTERNS = [
  new RegExp(`!3d${NUMBER}!4d${NUMBER}`),
  new RegExp(`[?&](?:q|query|ll|destination|daddr|center)=(?:loc:)?${NUMBER},\\s*\\+?${NUMBER}`),
  new RegExp(`/(?:search|place|dir)/${NUMBER},\\s*\\+?${NUMBER}`),
  new RegExp(`@${NUMBER},${NUMBER}`),
];

/** Coordinates and place name from a full Google Maps URL (no network). */
function parseMapsUrl(url) {
  const decoded = safeDecode(String(url || '').replace(/\+/g, ' '));
  let coordinates = null;
  for (const pattern of COORDINATE_PATTERNS) {
    const match = decoded.match(pattern);
    if (match && validCoordinate(Number(match[1]), Number(match[2]))) {
      coordinates = { latitude: Number(match[1]), longitude: Number(match[2]) };
      break;
    }
  }
  let placeName = null;
  const place = decoded.match(/\/place\/([^/@?]+)/);
  const query = decoded.match(/[?&]q=([^&]+)/);
  const candidate = (place && place[1]) || (query && query[1]) || '';
  if (candidate && !/^\s*-?\d+(?:\.\d+)?\s*,/.test(candidate)) placeName = candidate.trim().slice(0, 150) || null;
  return { ...(coordinates || {}), placeName, hasCoordinates: !!coordinates };
}

function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

// A consent interstitial carries the real destination in ?continue=.
function unwrapConsent(url) {
  if (!/^consent\./i.test(hostOf(url) || '')) return url;
  try {
    return new URL(url).searchParams.get('continue') || url;
  } catch {
    return url;
  }
}

async function expand(url, timeoutMs) {
  let current = url;
  for (let hop = 0; hop < MAX_HOPS; hop += 1) {
    current = unwrapConsent(current);
    const parsed = parseMapsUrl(current);
    if (parsed.hasCoordinates) return current;
    if (!ALLOWED_HOST.test(hostOf(current) || '')) return null;
    const response = await axios.get(current, {
      maxRedirects: 0,
      timeout: timeoutMs,
      responseType: 'text',
      validateStatus: (status) => status < 400,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; WhatsAppBookingBot/1.0)' },
    });
    const next = response.headers && response.headers.location;
    if (!next) return current;
    current = new URL(next, current).toString();
  }
  return current;
}

/**
 * @returns {Promise<{latitude: number, longitude: number, placeName: string|null}
 *   | {placeName: string} | null>} null when the link could not be read
 */
async function resolveMapsLink(link, { timeoutMs = 5000 } = {}) {
  if (!link) return null;
  try {
    const finalUrl = await expand(link, timeoutMs);
    if (!finalUrl) return null;
    const parsed = parseMapsUrl(finalUrl);
    logger.audit('MAPS_LINK_RESOLVED', { result: parsed.hasCoordinates ? 'coordinates' : (parsed.placeName ? 'place_name_only' : 'unreadable') });
    if (parsed.hasCoordinates) return { latitude: parsed.latitude, longitude: parsed.longitude, placeName: parsed.placeName };
    return parsed.placeName ? { placeName: parsed.placeName } : null;
  } catch (error) {
    logger.warn('MAPS_LINK', 'Could not expand a Maps link:', error.code || error.message);
    return null;
  }
}

/**
 * Turns a text message containing a Maps link with coordinates into a
 * location inbound. Anything else is returned unchanged, flagged with
 * `mapsLink` so address steps can explain how to share a location.
 */
async function locationFromMapsText(inbound) {
  if (!inbound || inbound.type !== 'text') return inbound;
  const link = findMapsLink(inbound.text);
  if (!link) return inbound;
  const resolved = await resolveMapsLink(link);
  if (!resolved || !Number.isFinite(resolved.latitude)) {
    return { ...inbound, mapsLink: { link, placeName: (resolved && resolved.placeName) || null, unreadable: true } };
  }
  return {
    ...inbound,
    type: 'location',
    location: {
      latitude: resolved.latitude,
      longitude: resolved.longitude,
      label: null,
      address: null,
      placeName: resolved.placeName || null,
      source: 'whatsapp_location',
      via: 'maps_link',
    },
  };
}

module.exports = { findMapsLink, parseMapsUrl, resolveMapsLink, locationFromMapsText };

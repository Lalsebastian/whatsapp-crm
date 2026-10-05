/*
 * Service-address helpers. A property saved from a WhatsApp location pin (or
 * a shared Google Maps link) carries exact coordinates; those are what a
 * technician should navigate to, because the typed address ("A 23 Olive
 * Courtyard") is often not searchable on a map.
 */
function hasCoordinates(property) {
  const latitude = Number(property?.latitude);
  const longitude = Number(property?.longitude);
  return property?.latitude != null && property?.longitude != null
    && Number.isFinite(latitude) && Number.isFinite(longitude)
    && !(latitude === 0 && longitude === 0);
}

export function formatServiceAddress(property) {
  if (!property) return null;
  const parts = [property.label, property.address_line, property.area, property.city, property.state]
    .filter(Boolean)
    .filter((part, index, all) => all.indexOf(part) === index);
  const text = parts.join(', ');
  return property.postal_code ? `${text}${text ? ' ' : ''}${property.postal_code}` : text || null;
}

/** Google Maps link: the exact pin when known, otherwise an address search. */
export function mapsUrl(property) {
  if (hasCoordinates(property)) {
    return `https://www.google.com/maps/search/?api=1&query=${Number(property.latitude)},${Number(property.longitude)}`;
  }
  const address = formatServiceAddress(property);
  return address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}` : null;
}

export function locationSourceLabel(property) {
  if (!hasCoordinates(property)) return null;
  return property.location_source === 'maps_link' ? 'Pin from Google Maps link' : 'Exact pin from WhatsApp';
}

export { hasCoordinates };

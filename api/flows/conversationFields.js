function bookingFieldState(context = {}) {
  const values = {
    service: context.serviceId || null,
    property: context.propertyId || context.location || null,
    date: context.date || null,
    time: context.time || null,
    room: context.room || null,
    issue: context.issue || null,
  };
  const required = ['service', 'property', 'date', 'time'];
  const requiresRevalidation = [];
  if (!context.serviceId && (context.service || context.inferredServiceId)) requiresRevalidation.push('service');
  if (!context.propertyId && (context.locationHint || context.propertyHint || context.location)) requiresRevalidation.push('property');
  if (context.preferredTime && !context.time) requiresRevalidation.push('time');
  const unresolvedExplicit = (context.requiresRevalidation || []).filter((field) => !values[field]);
  return {
    knownFields: Object.entries(values).filter(([, value]) => value).map(([field]) => field),
    missingFields: required.filter((field) => !values[field]),
    ambiguousFields: [...new Set(context.ambiguousFields || [])],
    requiresRevalidation: [...new Set([...unresolvedExplicit, ...requiresRevalidation])],
  };
}

function withFieldDiagnostics(context = {}) {
  return { ...context, ...bookingFieldState(context) };
}

module.exports = { bookingFieldState, withFieldDiagnostics };

const { getCrmAdapter } = require('../crm');
const logger = require('../utils/logger');

const crm = getCrmAdapter();
const PROFILE_TTL_MS = 5 * 60 * 1000;
const MAX_CACHE_ENTRIES = 500;
const cache = new Map();

function trimCache() {
  while (cache.size > MAX_CACHE_ENTRIES) {
    cache.delete(cache.keys().next().value);
  }
}

function minimalProfile(customer) {
  return {
    customerId: customer.id,
    name: customer.name || null,
    returningCustomer: !!customer.returningCustomer,
    preferredLanguage: customer.preferredLanguage || 'en',
    defaultProperty: null,
    savedProperties: [],
    recentBookings: [],
    activeComplaints: [],
    profileSource: 'crm',
  };
}

async function loadCustomerProfile(customer, { forceRefresh = false } = {}) {
  if (!customer || !customer.id) return null;
  const existing = cache.get(customer.id);
  if (!forceRefresh && existing && existing.expiresAt > Date.now()) {
    existing.profile.returningCustomer = !!customer.returningCustomer;
    existing.profile.name = customer.name || existing.profile.name;
    return existing.profile;
  }

  const profile = minimalProfile(customer);
  const optionalCall = (method, args, fallback) => typeof crm[method] === 'function'
    ? crm[method](...args)
    : Promise.resolve(fallback);
  const [propertiesResult, bookingsResult, complaintsResult] = await Promise.allSettled([
    optionalCall('getCustomerProperties', [customer.id], []),
    optionalCall('getBookings', [customer.id, { limit: 5 }], []),
    optionalCall('getActiveComplaints', [customer.id, { limit: 5 }], []),
  ]);

  if (propertiesResult.status === 'fulfilled') profile.savedProperties = propertiesResult.value || [];
  if (bookingsResult.status === 'fulfilled') profile.recentBookings = bookingsResult.value || [];
  if (complaintsResult.status === 'fulfilled') profile.activeComplaints = complaintsResult.value || [];
  profile.defaultProperty = profile.savedProperties.find((property) => property.isDefault) || null;
  profile.profileIncomplete = [propertiesResult, bookingsResult, complaintsResult]
    .some((result) => result.status === 'rejected');

  cache.set(customer.id, { profile, expiresAt: Date.now() + PROFILE_TTL_MS });
  trimCache();
  logger.audit('CUSTOMER_PROFILE_LOADED', {
    customerId: customer.id,
    result: profile.profileIncomplete ? 'partial' : 'success',
    profileSource: 'crm',
  });
  return profile;
}

function invalidateCustomerProfile(customerId) {
  if (customerId) cache.delete(customerId);
}

function clearForTests() {
  cache.clear();
}

module.exports = {
  loadCustomerProfile,
  invalidateCustomerProfile,
  clearForTests,
  PROFILE_TTL_MS,
};

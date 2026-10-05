// CRM adapter for the client's own CRM over HTTPS (CRM_PROVIDER=http).
//
// Implements the REST contract in crm/HTTP_CRM_CONTRACT.md. The client's real
// API has not been documented yet, so everything that is likely to differ is
// configuration rather than code:
//   CLIENT_API_BASE_URL      e.g. https://crm.example.com/api/v1
//   CLIENT_API_KEY           credential sent on every request
//   CLIENT_API_AUTH_HEADER   "Authorization" (sends "Bearer <key>") or e.g. "x-api-key"
//   CLIENT_API_ENDPOINTS     JSON overriding any endpoint path, e.g.
//                            {"createBookings": "/v2/bookings/bulk"}
// Responses may be bare JSON or wrapped in { data: ... }, and field names may
// be camelCase or snake_case. Anything beyond that (different shapes, extra
// required fields) needs a change here once the real API is known.
//
// Error semantics the rest of the bot relies on:
//   404 on a single-resource read     -> null (not found)
//   409 on booking creation           -> code SLOT_UNAVAILABLE (definitive)
//   other 4xx                         -> definitive failure with the CRM's code
//   5xx / timeout / network           -> left as-is; the reliability wrapper
//                                        retries reads and marks writes uncertain
const axios = require('axios');
const env = require('../config/env');
const reliability = require('../config/reliability');
const logger = require('../utils/logger');

const DEFAULT_ENDPOINTS = Object.freeze({
  findCustomerByPhone: '/customers',
  createCustomer: '/customers',
  getCustomerById: '/customers/{customerId}',
  getCustomerProperties: '/customers/{customerId}/properties',
  addProperty: '/customers/{customerId}/properties',
  getCustomerPreferences: '/customers/{customerId}/preferences',
  updateCustomerPreferences: '/customers/{customerId}/preferences',
  getServices: '/services',
  getServiceDetails: '/services/{serviceId}',
  checkServiceability: '/services/{serviceId}/serviceability',
  getAvailability: '/services/{serviceId}/availability',
  getAvailabilityRange: '/services/{serviceId}/availability',
  createBooking: '/bookings',
  createBookings: '/bookings/batch',
  getBookings: '/customers/{customerId}/bookings',
  getBookingStatus: '/bookings',
  getBookingById: '/bookings/{bookingId}',
  rescheduleBooking: '/bookings/{bookingId}/reschedule',
  cancelBooking: '/bookings/{bookingId}/cancel',
  createComplaint: '/complaints',
  addComplaintDetails: '/complaints/{complaintId}/updates',
  getComplaintStatus: '/complaints',
  getOpenComplaintForBooking: '/complaints',
  getActiveComplaints: '/customers/{customerId}/complaints',
  createFeedback: '/bookings/{bookingId}/feedback',
  getFeedbackForBooking: '/bookings/{bookingId}/feedback',
  markFeedbackFollowUp: '/feedback/{feedbackId}',
  escalateToHuman: '/escalations',
});

const ACTIVE_COMPLAINT_STATUSES = 'open,in_progress,escalated';

class CrmConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CrmConfigurationError';
    this.code = 'CRM_NOT_CONFIGURED';
  }
}

function parseEndpointOverrides(raw) {
  if (!raw) return {};
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new CrmConfigurationError('CLIENT_API_ENDPOINTS is not valid JSON');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new CrmConfigurationError('CLIENT_API_ENDPOINTS must be a JSON object of method -> path');
  }
  for (const [method, path] of Object.entries(parsed)) {
    if (!DEFAULT_ENDPOINTS[method]) throw new CrmConfigurationError(`CLIENT_API_ENDPOINTS has unknown method "${method}"`);
    if (typeof path !== 'string' || !path.startsWith('/')) {
      throw new CrmConfigurationError(`CLIENT_API_ENDPOINTS.${method} must be a path starting with "/"`);
    }
  }
  return parsed;
}

function resolveConfig(overrides = {}) {
  const baseUrl = String(overrides.baseUrl ?? env.CLIENT_API_BASE_URL ?? '').replace(/\/+$/, '');
  const apiKey = overrides.apiKey ?? env.CLIENT_API_KEY ?? '';
  if (!baseUrl) throw new CrmConfigurationError('CLIENT_API_BASE_URL is required when CRM_PROVIDER=http');
  if (!/^https:\/\//i.test(baseUrl) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(baseUrl)) {
    throw new CrmConfigurationError('CLIENT_API_BASE_URL must use https (http is only allowed for localhost)');
  }
  if (!apiKey) throw new CrmConfigurationError('CLIENT_API_KEY is required when CRM_PROVIDER=http');
  return {
    baseUrl,
    apiKey,
    authHeader: overrides.authHeader ?? env.CLIENT_API_AUTH_HEADER ?? 'Authorization',
    endpoints: { ...DEFAULT_ENDPOINTS, ...parseEndpointOverrides(overrides.endpoints ?? env.CLIENT_API_ENDPOINTS) },
    timeoutMs: overrides.timeoutMs ?? reliability.CRM_REQUEST_TIMEOUT_MS,
  };
}

// ── Response mapping (camelCase or snake_case, optionally { data: ... }) ──

function unwrap(body) {
  if (body && typeof body === 'object' && !Array.isArray(body) && 'data' in body) return body.data;
  return body;
}

function pick(row, ...keys) {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null) return row[key];
  }
  return undefined;
}

function asList(body, ...keys) {
  const value = unwrap(body);
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') {
    for (const key of keys) if (Array.isArray(value[key])) return value[key];
  }
  return [];
}

function mapCustomer(row) {
  if (!row) return null;
  return {
    id: String(pick(row, 'id', 'customerId', 'customer_id')),
    phone: pick(row, 'phone', 'mobile', 'phoneNumber', 'phone_number'),
    name: pick(row, 'name', 'fullName', 'full_name') || null,
    preferredLanguage: pick(row, 'preferredLanguage', 'preferred_language') || null,
  };
}

function mapProperty(row) {
  if (!row) return null;
  return {
    id: String(pick(row, 'id', 'propertyId', 'property_id')),
    customerId: pick(row, 'customerId', 'customer_id') || null,
    label: pick(row, 'label', 'name') || null,
    addressLine: pick(row, 'addressLine', 'address_line', 'address') || '',
    area: pick(row, 'area', 'community') || null,
    city: pick(row, 'city') || null,
    isDefault: !!pick(row, 'isDefault', 'is_default'),
    latitude: pick(row, 'latitude', 'lat') ?? null,
    longitude: pick(row, 'longitude', 'lng', 'lon') ?? null,
  };
}

function mapService(row) {
  if (!row) return null;
  return {
    id: String(pick(row, 'id', 'serviceId', 'service_id')),
    name: pick(row, 'name', 'title'),
    category: pick(row, 'category') || null,
    description: pick(row, 'description') || null,
    basePrice: pick(row, 'basePrice', 'base_price', 'price') ?? null,
    durationMinutes: pick(row, 'durationMinutes', 'duration_minutes') ?? null,
  };
}

function mapBooking(row) {
  if (!row) return null;
  return {
    id: String(pick(row, 'id', 'bookingId', 'booking_id')),
    reference: pick(row, 'reference', 'bookingReference', 'booking_reference') || null,
    customerId: pick(row, 'customerId', 'customer_id') || null,
    propertyId: pick(row, 'propertyId', 'property_id') || null,
    serviceId: pick(row, 'serviceId', 'service_id') || null,
    scheduledDate: pick(row, 'scheduledDate', 'scheduled_date', 'date') || null,
    scheduledTime: pick(row, 'scheduledTime', 'scheduled_time', 'time') || null,
    status: pick(row, 'status') || null,
    price: pick(row, 'price') ?? null,
    notes: pick(row, 'notes') || null,
  };
}

function mapComplaint(row) {
  if (!row) return null;
  return {
    id: String(pick(row, 'id', 'complaintId', 'complaint_id')),
    reference: pick(row, 'reference') || null,
    customerId: pick(row, 'customerId', 'customer_id') || null,
    bookingId: pick(row, 'bookingId', 'booking_id') || null,
    category: pick(row, 'category') || null,
    description: pick(row, 'description') || null,
    status: pick(row, 'status') || null,
  };
}

function mapFeedback(row) {
  if (!row) return null;
  return {
    id: String(pick(row, 'id', 'feedbackId', 'feedback_id')),
    customerId: pick(row, 'customerId', 'customer_id') || null,
    bookingId: pick(row, 'bookingId', 'booking_id') || null,
    complaintId: pick(row, 'complaintId', 'complaint_id') || null,
    rating: pick(row, 'rating'),
    comment: pick(row, 'comment') || null,
    source: 'whatsapp',
    createdAt: pick(row, 'createdAt', 'created_at') || null,
    respondedAt: pick(row, 'respondedAt', 'responded_at') || null,
  };
}

function statusOf(error) {
  return error && error.response && error.response.status;
}

function crmErrorCode(error) {
  const data = error && error.response && error.response.data;
  const body = data && (data.error || data);
  return (body && typeof body === 'object' && (body.code || body.errorCode)) || null;
}

function definitiveError(error, fallbackCode) {
  const mapped = new Error((error.response && error.response.data && (error.response.data.message || (error.response.data.error && error.response.data.error.message))) || error.message);
  mapped.code = crmErrorCode(error) || fallbackCode;
  mapped.response = error.response;
  return mapped;
}

function createHttpCrmAdapter(overrides = {}) {
  let config = null;
  const http = overrides.http || axios;

  function settings() {
    if (!config) config = resolveConfig(overrides);
    return config;
  }

  function url(method, params = {}) {
    const { baseUrl, endpoints } = settings();
    const path = endpoints[method].replace(/\{(\w+)\}/g, (match, name) => {
      if (params[name] === undefined || params[name] === null || params[name] === '') {
        throw new Error(`Missing path parameter "${name}" for ${method}`);
      }
      return encodeURIComponent(String(params[name]));
    });
    return `${baseUrl}${path}`;
  }

  function headers(extra = {}) {
    const { authHeader, apiKey } = settings();
    const value = authHeader.toLowerCase() === 'authorization' ? `Bearer ${apiKey}` : apiKey;
    return { Accept: 'application/json', [authHeader]: value, ...extra };
  }

  async function request(method, httpMethod, { params, query, body, idempotencyKey } = {}) {
    const { timeoutMs } = settings();
    const target = url(method, params);
    try {
      const response = await http.request({
        method: httpMethod,
        url: target,
        params: query,
        data: body,
        timeout: timeoutMs,
        headers: headers({
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
        }),
      });
      return response.data;
    } catch (error) {
      logger.error(
        'CLIENT_CRM',
        `${httpMethod.toUpperCase()} ${method} failed:`,
        `status=${statusOf(error) || 'no response'}`,
        `code=${crmErrorCode(error) || error.code || 'unknown'}`
      );
      throw error;
    }
  }

  // GET of one resource: 404 means "does not exist".
  async function getOne(method, params, mapper, query) {
    try {
      return mapper(unwrap(await request(method, 'get', { params, query })));
    } catch (error) {
      if (statusOf(error) === 404) return null;
      throw error;
    }
  }

  async function write(method, httpMethod, options, { conflictCode } = {}) {
    try {
      return await request(method, httpMethod, options);
    } catch (error) {
      const status = statusOf(error);
      if (status === 409 && conflictCode) throw definitiveError(error, conflictCode);
      if (status >= 400 && status < 500 && status !== 408 && status !== 429) {
        throw definitiveError(error, 'CRM_REJECTED');
      }
      throw error;
    }
  }

  return {
    async findCustomerByPhone(phone) {
      const existing = asList(await request('findCustomerByPhone', 'get', { query: { phone } }), 'customers', 'items')[0];
      if (existing) return { ...mapCustomer(existing), returningCustomer: true };
      // Same behaviour as the Supabase adapter: a WhatsApp number is enough to
      // register a home-services customer on first contact.
      const created = await write('createCustomer', 'post', { body: { phone, source: 'whatsapp' } }, { conflictCode: 'CUSTOMER_EXISTS' })
        .catch(async (error) => {
          if (error.code !== 'CUSTOMER_EXISTS') throw error;
          // Created concurrently by another message: read it back.
          return asList(await request('findCustomerByPhone', 'get', { query: { phone } }), 'customers', 'items')[0];
        });
      return { ...mapCustomer(unwrap(created)), returningCustomer: false };
    },

    async getCustomerById(customerId) {
      return getOne('getCustomerById', { customerId }, mapCustomer);
    },

    async getCustomerProperties(customerId) {
      return asList(await request('getCustomerProperties', 'get', { params: { customerId } }), 'properties', 'items').map(mapProperty);
    },

    async getCustomerPreferences(customerId) {
      const row = await getOne('getCustomerPreferences', { customerId }, (value) => value);
      if (!row) return null;
      return {
        customerId,
        preferredLanguage: pick(row, 'preferredLanguage', 'preferred_language') || 'en',
        defaultPropertyId: pick(row, 'defaultPropertyId', 'default_property_id') || null,
      };
    },

    async updateCustomerPreferences(customerId, input = {}) {
      const body = {};
      if (input.preferredLanguage) body.preferredLanguage = input.preferredLanguage;
      if (input.defaultPropertyId) body.defaultPropertyId = input.defaultPropertyId;
      const row = unwrap(await write('updateCustomerPreferences', 'patch', { params: { customerId }, body }));
      return {
        customerId,
        preferredLanguage: (row && pick(row, 'preferredLanguage', 'preferred_language')) || input.preferredLanguage || 'en',
        defaultPropertyId: (row && pick(row, 'defaultPropertyId', 'default_property_id')) || input.defaultPropertyId || null,
      };
    },

    async addProperty(customerId, property) {
      return mapProperty(unwrap(await write('addProperty', 'post', { params: { customerId }, body: property })));
    },

    async getServices() {
      return asList(await request('getServices', 'get', { query: { active: true } }), 'services', 'items').map(mapService);
    },

    async getServiceDetails(serviceId) {
      return getOne('getServiceDetails', { serviceId }, mapService);
    },

    async checkServiceability(serviceId, location) {
      const result = unwrap(await request('checkServiceability', 'post', { params: { serviceId }, body: { location } }));
      return { serviceable: result && result.serviceable !== false, source: 'client_crm' };
    },

    async getAvailability(serviceId, date) {
      // Slots may be strings or objects; crm/slots.js normalizes either.
      return asList(await request('getAvailability', 'get', { params: { serviceId }, query: { date } }), 'slots');
    },

    async getAvailabilityRange(serviceId, { fromDate, days = 7, location } = {}) {
      const query = { from: fromDate, days };
      if (location && Number.isFinite(location.latitude)) {
        query.lat = location.latitude;
        query.lng = location.longitude;
      }
      return asList(await request('getAvailabilityRange', 'get', { params: { serviceId }, query }), 'days', 'dates')
        .map((day) => ({ date: pick(day, 'date'), slots: Array.isArray(day.slots) ? day.slots : [] }));
    },

    async createBooking({ idempotencyKey, ...input }) {
      const body = unwrap(await write('createBooking', 'post', { body: input, idempotencyKey }, { conflictCode: 'SLOT_UNAVAILABLE' }));
      return mapBooking(body && body.booking ? body.booking : body);
    },

    async createBookings({ customerId, items, idempotencyKey }) {
      const body = await write('createBookings', 'post', {
        body: { customerId, items },
        idempotencyKey,
      }, { conflictCode: 'SLOT_UNAVAILABLE' });
      return asList(body, 'bookings', 'items').map(mapBooking);
    },

    async getBookings(customerId, { limit = 10 } = {}) {
      return asList(await request('getBookings', 'get', { params: { customerId }, query: { limit } }), 'bookings', 'items').map(mapBooking);
    },

    async getBookingStatus(reference) {
      const row = asList(await request('getBookingStatus', 'get', { query: { reference } }), 'bookings', 'items')[0];
      return row ? mapBooking(row) : null;
    },

    async getBookingById(bookingId) {
      return getOne('getBookingById', { bookingId }, mapBooking);
    },

    async rescheduleBooking(bookingId, { date, time }) {
      return mapBooking(unwrap(await write('rescheduleBooking', 'post', {
        params: { bookingId },
        body: { date, time },
      }, { conflictCode: 'SLOT_UNAVAILABLE' })));
    },

    async cancelBooking(bookingId) {
      return mapBooking(unwrap(await write('cancelBooking', 'post', { params: { bookingId }, body: {} })));
    },

    async createComplaint(input) {
      return mapComplaint(unwrap(await write('createComplaint', 'post', { body: input })));
    },

    async addComplaintDetails(complaintId, { customerId, text, attachments = [], idempotencyKey } = {}) {
      return mapComplaint(unwrap(await write('addComplaintDetails', 'post', {
        params: { complaintId },
        body: { customerId, text: text || null, attachments },
        idempotencyKey,
      })));
    },

    async getComplaintStatus(reference) {
      const row = asList(await request('getComplaintStatus', 'get', { query: { reference } }), 'complaints', 'items')[0];
      return row ? mapComplaint(row) : null;
    },

    async getOpenComplaintForBooking(customerId, bookingId) {
      const row = asList(await request('getOpenComplaintForBooking', 'get', {
        query: { customerId, bookingId, status: ACTIVE_COMPLAINT_STATUSES, limit: 1 },
      }), 'complaints', 'items')[0];
      return row ? mapComplaint(row) : null;
    },

    async getActiveComplaints(customerId, { limit = 5 } = {}) {
      return asList(await request('getActiveComplaints', 'get', {
        params: { customerId },
        query: { status: ACTIVE_COMPLAINT_STATUSES, limit },
      }), 'complaints', 'items').map(mapComplaint);
    },

    async createFeedback({ customerId, bookingId, phone, rating, comment }) {
      try {
        const row = unwrap(await write('createFeedback', 'post', {
          params: { bookingId },
          body: { customerId, phone, rating, comment: comment || null, source: 'whatsapp' },
          // One feedback per customer and booking, however often it is retried.
          idempotencyKey: `feedback-${customerId}-${bookingId}`,
        }, { conflictCode: 'FEEDBACK_EXISTS' }));
        return { ...mapFeedback(row), duplicate: false, persistenceStatus: 'inserted' };
      } catch (error) {
        if (error.code !== 'FEEDBACK_EXISTS') throw error;
        const existing = await getOne('getFeedbackForBooking', { bookingId }, mapFeedback);
        if (!existing) throw error;
        return { ...existing, duplicate: true, persistenceStatus: 'existing_completed' };
      }
    },

    async getFeedbackForBooking(customerId, bookingId) {
      const feedback = await getOne('getFeedbackForBooking', { bookingId }, mapFeedback, { customerId });
      return feedback && feedback.customerId && String(feedback.customerId) !== String(customerId) ? null : feedback;
    },

    async markFeedbackFollowUp(feedbackId, { complaintId } = {}) {
      if (!complaintId) return null;
      return mapFeedback(unwrap(await write('markFeedbackFollowUp', 'patch', { params: { feedbackId }, body: { complaintId } })));
    },

    async escalateToHuman({ customerId, phone, reason, summary, handoff }) {
      const row = unwrap(await write('escalateToHuman', 'post', {
        body: { customerId: customerId || null, phone, reason, summary: summary || null, handoff: handoff || null },
      }));
      return { id: String(pick(row || {}, 'id', 'escalationId', 'escalation_id')) };
    },
  };
}

// Default instance, configured from env on first use so a missing/invalid
// config only fails when CRM_PROVIDER=http actually routes a call here.
const defaultAdapter = createHttpCrmAdapter();

// Fails fast at startup instead of on the first customer message.
function validateConfiguration() {
  resolveConfig();
}

module.exports = defaultAdapter;
module.exports.createHttpCrmAdapter = createHttpCrmAdapter;
module.exports.validateConfiguration = validateConfiguration;
module.exports.DEFAULT_ENDPOINTS = DEFAULT_ENDPOINTS;
module.exports.CrmConfigurationError = CrmConfigurationError;

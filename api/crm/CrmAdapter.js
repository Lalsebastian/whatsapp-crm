/**
 * CRM adapter contract. Every implementation (supabaseCrmAdapter, httpCrmAdapter,
 * or a future real client CRM adapter) must implement all of these methods with
 * these exact signatures, so `flows/*` never needs to know which one is active.
 *
 * Business rule enforced across the whole app: the AI layer (api/ai) NEVER calls
 * any of these methods directly. Only flow handlers (api/flows) do, after
 * validating required fields. CRM/DB responses are the only source of truth —
 * nothing here may be invented or guessed.
 *
 * @typedef {Object} Customer
 * @property {string} id
 * @property {string} phone
 * @property {string} [name]
 * @property {string} [preferredLanguage]
 *
 * @typedef {Object} Property
 * @property {string} id
 * @property {string} customerId
 * @property {string} [label]
 * @property {string} addressLine
 * @property {string} [area]
 * @property {string} [city]
 *
 * @typedef {Object} Service
 * @property {string} id
 * @property {string} name
 * @property {string} [category]
 * @property {string} [description]
 * @property {number} [basePrice]
 * @property {number} [durationMinutes]
 *
 * @typedef {Object} Booking
 * @property {string} id
 * @property {string} reference
 * @property {string} customerId
 * @property {string} propertyId
 * @property {string} serviceId
 * @property {string} scheduledDate
 * @property {string} scheduledTime
 * @property {string} status
 * @property {number} [price]
 *
 * @typedef {Object} Complaint
 * @property {string} id
 * @property {string} reference
 * @property {string} customerId
 * @property {string} [bookingId]
 * @property {string} category
 * @property {string} [description]
 * @property {string} status
 *
 * @typedef {Object} CrmAdapter
 * @property {(phone: string, options?: {profileName?: string}) => Promise<Customer>} findCustomerByPhone
 * @property {(customerId: string) => Promise<Property[]>} getCustomerProperties
 * @property {(customerId: string) => Promise<{customerId: string, preferredLanguage: string, defaultPropertyId?: string|null}|null>} getCustomerPreferences
 * @property {(customerId: string, input: {preferredLanguage?: string, defaultPropertyId?: string}) => Promise<Object>} updateCustomerPreferences
 * @property {(customerId: string, property: {label?: string, addressLine: string, area?: string, city?: string}) => Promise<Property>} addProperty
 * @property {() => Promise<Service[]>} getServices
 * @property {(serviceId: string) => Promise<Service|null>} getServiceDetails
 * @property {(serviceId: string, location: Object) => Promise<{serviceable: boolean, source: string}>} checkServiceability
 * @property {(serviceId: string, date: string) => Promise<string[]>} getAvailability
 * @property {(input: {customerId: string, propertyId: string, serviceId: string, date: string, time: string, notes?: string}) => Promise<Booking>} createBooking
 * @property {(customerId: string, opts?: {limit?: number}) => Promise<Booking[]>} getBookings
 * @property {(reference: string) => Promise<Booking|null>} getBookingStatus
 * @property {(bookingId: string) => Promise<Booking|null>} getBookingById
 * @property {(bookingId: string, input: {date: string, time: string}) => Promise<Booking>} rescheduleBooking
 * @property {(bookingId: string) => Promise<Booking>} cancelBooking
 * @property {(customerId: string) => Promise<Customer|null>} getCustomerById
 * @property {(serviceId: string, opts: {fromDate: string, days?: number, location?: Object}) => Promise<Array<{date: string, slots: Array<string|Object>}>>} [getAvailabilityRange] optional; see crm/slots.js for slot shapes
 * @property {(input: {customerId: string, items: Array<{propertyId: string, serviceId: string, date: string, time: string, slotId?: string, notes?: string}>, idempotencyKey?: string}) => Promise<Booking[]>} createBookings all-or-nothing, same order as items
 * @property {(input: {customerId: string, bookingId?: string, category: string, description?: string, priority?: string, attachments?: Array<{waMediaId: string, mediaType: string}>}) => Promise<Complaint>} createComplaint
 * @property {(complaintId: string, input: {customerId: string, text?: string, attachments?: Array<{waMediaId: string, mediaType: string}>, idempotencyKey?: string}) => Promise<Complaint>} addComplaintDetails
 * @property {(reference: string) => Promise<Complaint|null>} getComplaintStatus
 * @property {(customerId: string, bookingId: string) => Promise<Complaint|null>} getOpenComplaintForBooking
 * @property {(customerId: string, opts?: {limit?: number}) => Promise<Complaint[]>} getActiveComplaints
 * @property {(input: {customerId: string, bookingId: string, phone: string, rating: number, comment?: string}) => Promise<Object>} createFeedback
 * @property {(customerId: string, bookingId: string) => Promise<Object|null>} getFeedbackForBooking
 * @property {(feedbackId: string, input: {complaintId?: string}) => Promise<Object>} markFeedbackFollowUp
 * @property {(input: {customerId?: string, phone: string, reason: string, summary?: string, handoff?: Object}) => Promise<{id: string}>} escalateToHuman
 */

module.exports = {};

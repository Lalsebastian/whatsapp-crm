// PLACEHOLDER — wire this up once the client provides their real CRM API docs
// (Postman collection / OpenAPI spec / endpoint list + auth scheme). Every
// method below intentionally throws so it's impossible to silently run against
// a fake endpoint in production. Do not invent endpoint paths.
//
// Select this adapter with CRM_PROVIDER=http (see api/crm/index.js). Until then,
// the app runs against supabaseCrmAdapter.js.
const env = require('../config/env');

function notImplemented(method) {
  throw new Error(
    `HttpCrmAdapter.${method} not implemented — pending client CRM API docs. ` +
      `Base URL is configured (CLIENT_API_BASE_URL=${env.CLIENT_API_BASE_URL || '<unset>'}), ` +
      'but the request shape below is a placeholder only.'
  );
}

// Example of the intended shape once real docs exist:
//
// const axios = require('axios');
// async function findCustomerByPhone(phone) {
//   const res = await axios.get(`${env.CLIENT_API_BASE_URL}/customers`, {
//     params: { phone },
//     headers: { Authorization: `Bearer ${env.CLIENT_API_KEY}` },
//   });
//   return res.data;
// }

async function findCustomerByPhone() { return notImplemented('findCustomerByPhone'); }
async function getCustomerProperties() { return notImplemented('getCustomerProperties'); }
async function addProperty() { return notImplemented('addProperty'); }
async function getServices() { return notImplemented('getServices'); }
async function getServiceDetails() { return notImplemented('getServiceDetails'); }
async function getAvailability() { return notImplemented('getAvailability'); }
async function createBooking() { return notImplemented('createBooking'); }
async function getBookings() { return notImplemented('getBookings'); }
async function getBookingStatus() { return notImplemented('getBookingStatus'); }
async function rescheduleBooking() { return notImplemented('rescheduleBooking'); }
async function cancelBooking() { return notImplemented('cancelBooking'); }
async function createComplaint() { return notImplemented('createComplaint'); }
async function getComplaintStatus() { return notImplemented('getComplaintStatus'); }
async function escalateToHuman() { return notImplemented('escalateToHuman'); }

module.exports = {
  findCustomerByPhone,
  getCustomerProperties,
  addProperty,
  getServices,
  getServiceDetails,
  getAvailability,
  createBooking,
  getBookings,
  getBookingStatus,
  rescheduleBooking,
  cancelBooking,
  createComplaint,
  getComplaintStatus,
  escalateToHuman,
};

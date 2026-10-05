// Hybrid booking flow. Buttons/lists remain the fastest path, while text and
// transcribed voice notes can prefill fields. AI only interprets input; every
// service, property, date and slot is validated against CRM data before the
// backend performs any booking action.
//
// Module layering (each file only requires files listed before it, so there
// are no circular imports):
//   shared            pure helpers, constants, the CRM adapter
//   summary           item review + final confirmation prompt
//   schedule          date / time-slot selection
//   servicePrompts    service list + inferred-service confirmation
//   locationPin       geocoding WhatsApp location pins, pin-based properties
//   property          service address selection, serviceability
//   serviceSelection  entry point and service matching
//   locationDetails   confirming a geocoded pin address
//   corrections       change-details buttons and natural-language edits
//   confirm           the CRM write
const { handleConfirmDefaultProperty, handleSelectProperty, handleAwaitingNewProperty } = require('./property');
const { handleSelectDate, handleSelectSlot } = require('./schedule');
const {
  startBooking,
  startBookingForService,
  resumeBookingDraft,
  handleRecommendationLocation,
  handleSelectService,
  handleConfirmService,
} = require('./serviceSelection');
const { handleReviewItem, handleChangeDetails, handleMoreChanges } = require('./corrections');
const { handleConfirm, handleConfirmCancel } = require('./confirm');
const { handleAwaitingLocationDetails } = require('./locationDetails');

module.exports = {
  startBooking,
  startBookingForService,
  resumeBookingDraft,
  steps: {
    select_service: handleSelectService,
    recommendation_location: handleRecommendationLocation,
    confirm_service: handleConfirmService,
    select_property: handleSelectProperty,
    confirm_default_property: handleConfirmDefaultProperty,
    awaiting_new_property: handleAwaitingNewProperty,
    awaiting_location_details: handleAwaitingLocationDetails,
    select_date: handleSelectDate,
    select_slot: handleSelectSlot,
    review_item: handleReviewItem,
    change_details: handleChangeDetails,
    change_more: handleMoreChanges,
    confirm: handleConfirm,
    confirm_cancel: handleConfirmCancel,
  },
};

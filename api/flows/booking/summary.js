// Item review and the final "Confirm Booking" summary shown before any CRM write.
const { randomUUID } = require('node:crypto');
const whatsapp = require('../../whatsapp/client');
const sessionStore = require('../../session/sessionStore');
const logger = require('../../utils/logger');
const { formatDateForCustomer } = require('../dateUtils');
const { withFieldDiagnostics } = require('../conversationFields');
const {
  crm,
  FLOW,
  bookingItemFromContext,
  buildCorrectionDebug,
  itemTimeLabel,
} = require('./shared');

async function promptItemReview(session, context) {
  let serviceName = context.serviceName;
  if (!serviceName) {
    const service = await crm.getServiceDetails(context.serviceId);
    serviceName = service ? service.name : 'Service';
  }
  const currentItem = bookingItemFromContext({ ...context, serviceName });
  if (!context.correctionMode && !context.offerAdditionalService) {
    logger.audit('TIME_SELECTED', {
      phone: session.phone,
      sessionId: session.phone,
      flow: FLOW,
      step: 'select_slot',
      serviceId: currentItem.serviceId,
      time: currentItem.time,
      result: 'selected',
    });
    return promptFinalConfirmation(session, [...(context.cart || []), currentItem]);
  }
  if (context.correctionMode) {
    const correctionDebug = buildCorrectionDebug(
      context.correctionFields,
      context.correctionPreviousItem || currentItem,
      currentItem
    );
    return promptFinalConfirmation(session, [...(context.cart || []), currentItem], {
      updated: true,
      correctionDebug,
    });
  }
  const issueLine = currentItem.issue ? `\n📝 ${currentItem.issue}` : '';
  await whatsapp.sendButtons(
    session.phone,
    `Here's what I have:\n\n🔧 ${currentItem.serviceName}\n📍 ${currentItem.propertyLabel}\n📅 ${formatDateForCustomer(currentItem.date)}\n🕙 ${itemTimeLabel(currentItem)}${issueLine}\n\nWould you like to add another service or continue with this booking?`,
    [
      { id: 'ADD_ANOTHER_SERVICE', title: 'Add Another Service' },
      { id: 'PROCEED_TO_BOOKING', title: 'Proceed to Booking' },
      { id: 'CHANGE_BOOKING_DETAILS', title: 'Change Details' },
    ]
  );
  await sessionStore.setFlow(session.phone, FLOW, 'review_item', { ...context, currentItem });
  logger.audit('TIME_SELECTED', {
    phone: session.phone,
    sessionId: session.phone,
    flow: FLOW,
    step: 'select_slot',
    serviceId: currentItem.serviceId,
    time: currentItem.time,
    result: 'selected',
  });
  logger.audit('BOOKING_REVIEW_SHOWN', {
    phone: session.phone,
    sessionId: session.phone,
    flow: FLOW,
    step: 'review_item',
    serviceId: currentItem.serviceId,
    result: 'shown',
  });
}

async function promptFinalConfirmation(session, cart, options = {}) {
  const preparedCart = cart.map((item) => ({ ...item, actionId: item.actionId || randomUUID() }));
  const confirmationNonce = randomUUID();
  const suppliedDetails = preparedCart
    .map((item) => [item.room, item.issue].filter(Boolean).join(' — '))
    .filter(Boolean);
  const lines = preparedCart.map((item, index) =>
    `${preparedCart.length > 1 ? `${index + 1}. ` : ''}🔧 Service: ${item.serviceName}\n📍 Location: ${item.propertyLabel}\n📅 Date: ${formatDateForCustomer(item.date)}\n🕒 Time: ${itemTimeLabel(item)}`
  );
  await whatsapp.sendButtons(
    session.phone,
    `${options.updated ? 'Updated. Please review the booking again:' : 'Please review your booking details:'}\n\n${lines.join('\n\n')}${suppliedDetails.length ? `\n\nDetails: ${suppliedDetails.join('; ')}` : ''}\n\nWould you like me to confirm ${preparedCart.length > 1 ? 'these bookings' : 'this booking'}?`,
    [
      { id: 'CONFIRM_BOOKING', title: 'Confirm Booking' },
      { id: 'CHANGE_DETAILS', title: 'Change Details' },
      { id: 'CANCEL_FLOW', title: 'Cancel' },
    ]
  );
  await sessionStore.setFlow(session.phone, FLOW, 'confirm', withFieldDiagnostics({
    ...(preparedCart.length === 1 ? preparedCart[0] : {}),
    cart: preparedCart,
    confirmationNonce,
    correctionDebug: options.correctionDebug || null,
  }));
  logger.audit('BOOKING_REVIEW_SHOWN', {
    phone: session.phone,
    sessionId: session.phone,
    flow: FLOW,
    step: 'confirm',
    serviceId: preparedCart.length === 1 ? preparedCart[0].serviceId : null,
    itemCount: preparedCart.length,
    result: 'shown',
  });
}

module.exports = {
  promptItemReview,
  promptFinalConfirmation,
};

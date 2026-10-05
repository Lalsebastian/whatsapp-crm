// Date and time-slot selection. Every offered date and slot comes from the CRM:
// dates are only listed when the CRM reports open times on them, and slots
// carry structured start/end/timezone data when the CRM provides it.
const whatsapp = require('../../whatsapp/client');
const sessionStore = require('../../session/sessionStore');
const logger = require('../../utils/logger');
const env = require('../../config/env');
const { parseDateInput, formatDateForCustomer, todayInTimeZone } = require('../dateUtils');
const { withFieldDiagnostics } = require('../conversationFields');
const messageBudget = require('../../analytics/messageBudget');
const { normalizeSlots, findSlot } = require('../../crm/slots');
const { crm, FLOW, selectPreferredSlot, noteAvoidedQuestion } = require('./shared');
const { promptItemReview } = require('./summary');

const MAX_DATE_ROWS = 9; // WhatsApp lists hold 10 rows; one is "Another date".

// Fields copied onto the booking item for the chosen slot. Only set when the
// CRM supplied more than a bare start time, so legacy string slots keep the
// exact same context shape as before.
function slotFields(slot) {
  return {
    time: slot.start,
    ...(slot.end ? { timeEnd: slot.end } : {}),
    ...(slot.id !== slot.start ? { slotId: slot.id } : {}),
    ...(slot.startsAt && slot.end ? { slotStartsAt: slot.startsAt, slotEndsAt: slot.endsAt, timezone: slot.timezone } : {}),
  };
}

// Upcoming dates with at least one open slot, or null when the CRM cannot
// answer a range query (capability missing or the call failed). Null means
// "fall back to asking for a date", never "nothing is available".
async function upcomingAvailableDates(context) {
  if (typeof crm.getAvailabilityRange !== 'function' || !context.serviceId) return null;
  try {
    const range = await crm.getAvailabilityRange(context.serviceId, {
      fromDate: todayInTimeZone(),
      days: env.BOOKING_DATE_WINDOW_DAYS,
      location: context.location || null,
    });
    if (!Array.isArray(range)) return null;
    return range
      .map((day) => ({ date: day.date, slots: normalizeSlots(day.slots, { date: day.date }) }))
      .filter((day) => day.date && day.slots.length > 0)
      .sort((left, right) => left.date.localeCompare(right.date));
  } catch (error) {
    logger.warn('BOOKING', 'Date-range availability unavailable; asking for a date instead:', error.code || error.message);
    return null;
  }
}

function periodOf(hhmm) {
  const hour = Number(String(hhmm || '').slice(0, 2));
  if (!Number.isFinite(hour)) return null;
  if (hour < 12) return 'morning';
  return hour < 17 ? 'afternoon' : 'evening';
}

// The part of day most of this customer's recent bookings were in, when
// there is a clear habit (at least two bookings, two thirds in one period).
function habitualPeriod(session) {
  const recent = (session.customerProfile && session.customerProfile.recentBookings) || [];
  const periods = recent.map((booking) => periodOf(booking.scheduledTime)).filter(Boolean);
  if (periods.length < 2) return null;
  const counts = periods.reduce((acc, period) => ({ ...acc, [period]: (acc[period] || 0) + 1 }), {});
  const [best, count] = Object.entries(counts).sort((left, right) => right[1] - left[1])[0];
  return count / periods.length >= 2 / 3 ? best : null;
}

async function promptForDate(session, context) {
  const days = await upcomingAvailableDates(context);
  if (days && days.length > 0) {
    const rows = days.slice(0, MAX_DATE_ROWS).map((day) => ({
      id: `DATE_${day.date}`,
      title: formatDateForCustomer(day.date).slice(0, 24),
      description: `${day.slots.length} time${day.slots.length === 1 ? '' : 's'} available`,
    }));
    rows.push({ id: 'DATE_OTHER', title: 'Another date', description: 'Type the date you would prefer' });
    await whatsapp.sendListMessage(
      session.phone,
      'Which date works best? These dates have open appointment times.',
      'Choose date',
      [{ title: 'Available Dates', rows }]
    );
    await sessionStore.setFlow(session.phone, FLOW, 'select_date', withFieldDiagnostics({
      ...context,
      offeredDates: days.map((day) => day.date),
    }));
    logger.audit('AVAILABLE_DATES_OFFERED', {
      phone: session.phone,
      flow: FLOW,
      step: 'select_date',
      serviceId: context.serviceId,
      count: rows.length - 1,
      result: 'offered',
    });
    return;
  }
  if (days && days.length === 0) {
    await whatsapp.sendText(
      session.phone,
      `I'm sorry, there are no open appointment times in the next ${env.BOOKING_DATE_WINDOW_DAYS} days. Please type a later date in YYYY-MM-DD format, or type "support" and our team will help.`
    );
    await sessionStore.setFlow(session.phone, FLOW, 'select_date', withFieldDiagnostics(context));
    return;
  }
  await whatsapp.sendButtons(session.phone, 'What date would you prefer? Select an option below, or enter a date in YYYY-MM-DD format.', [
    { id: 'DATE_TODAY', title: 'Today' },
    { id: 'DATE_TOMORROW', title: 'Tomorrow' },
  ]);
  await sessionStore.setFlow(session.phone, FLOW, 'select_date', withFieldDiagnostics(context));
}

async function showAvailability(session, context, date) {
  logger.audit('DATE_SELECTED', {
    phone: session.phone,
    sessionId: session.phone,
    flow: FLOW,
    step: 'select_date',
    serviceId: context.serviceId,
    date,
    result: 'selected',
  });
  const slots = normalizeSlots(await crm.getAvailability(context.serviceId, date), { date });
  const dateLabel = formatDateForCustomer(date);
  const { offeredDates: ignoredOfferedDates, ...cleanContext } = context;
  if (slots.length === 0) {
    const { date: ignoredDate, time: ignoredTime, ...retryContext } = cleanContext;
    await whatsapp.sendText(session.phone, `I'm sorry, we don't have any available times on ${dateLabel}. Please select another date.`);
    await sessionStore.setFlow(session.phone, FLOW, 'select_date', retryContext);
    return;
  }
  if (slots.length === 1 && !cleanContext.correctionMode) {
    const singleSlotContext = noteAvoidedQuestion(session, cleanContext, 'time', 'single_available_slot');
    messageBudget.markFastPath(session.phone);
    return promptItemReview(session, { ...singleSlotContext, date, ...slotFields(slots[0]) });
  }
  const preferredStart = selectPreferredSlot(cleanContext.preferredTime, slots.map((slot) => slot.start));
  const preferredSlot = preferredStart ? findSlot(slots, preferredStart) : null;
  if (preferredSlot) {
    const preferredContext = noteAvoidedQuestion(session, cleanContext, 'time', 'time_preference_matched');
    messageBudget.markFastPath(session.phone);
    return promptItemReview(session, { ...preferredContext, date, ...slotFields(preferredSlot) });
  }
  // Smart default: lead with the part of day this customer usually books,
  // but let them choose (a time is never picked for them).
  const habit = cleanContext.preferredTime ? null : habitualPeriod(session);
  const habitual = habit ? slots.filter((slot) => periodOf(slot.start) === habit) : [];
  const ordered = habitual.length > 0 && habitual.length < slots.length
    ? [...habitual, ...slots.filter((slot) => periodOf(slot.start) !== habit)]
    : slots;
  const habitNote = ordered !== slots ? ` You usually book in the ${habit}, so those times are first.` : '';
  const prefix = cleanContext.customerName ? `Certainly, ${cleanContext.customerName}. ` : '';
  const nextContext = withFieldDiagnostics({ ...cleanContext, date, availableSlots: ordered });
  if (slots.length <= 3) {
    await whatsapp.sendButtons(
      session.phone,
      `${prefix}Available times for ${dateLabel}.${habitNote} Which time works best?`,
      ordered.map((slot) => ({ id: `SLOT_${slot.id}`, title: slot.label }))
    );
    await sessionStore.setFlow(session.phone, FLOW, 'select_slot', nextContext);
    return;
  }
  await whatsapp.sendListMessage(session.phone, `${prefix}Available times for ${dateLabel}:${habitNote}`, 'Choose time', [
    { title: 'Available Times', rows: ordered.slice(0, 10).map((slot) => ({
      id: `SLOT_${slot.id}`,
      title: slot.label,
    })) },
  ]);
  await sessionStore.setFlow(session.phone, FLOW, 'select_slot', nextContext);
}

function dateFromInput(input) {
  if (input.buttonId === 'DATE_TODAY') return parseDateInput('today');
  if (input.buttonId === 'DATE_TOMORROW') return parseDateInput('tomorrow');
  const listed = input.buttonId && input.buttonId.match(/^DATE_(\d{4}-\d{2}-\d{2})$/);
  if (listed) return parseDateInput(listed[1]);
  if (input.text) return parseDateInput(input.ai && input.ai.preferredDate) || parseDateInput(input.text);
  return null;
}

async function handleSelectDate(session, customer, input) {
  if (input.buttonId === 'DATE_OTHER') {
    await whatsapp.sendText(session.phone, 'Certainly. Please type the date you would prefer, for example "next Monday" or YYYY-MM-DD.');
    return;
  }
  const date = dateFromInput(input);
  if (!date) {
    await whatsapp.sendText(session.phone, "I couldn't identify that date. Please enter it in YYYY-MM-DD format, or select Today or Tomorrow.");
    return;
  }
  if (date < todayInTimeZone()) {
    await whatsapp.sendText(session.phone, 'That date has already passed. Please choose today or a later date.');
    return;
  }
  await showAvailability(session, {
    ...session.context,
    voiceNotes: input.voice ? [...(session.context.voiceNotes || []), input.voice] : session.context.voiceNotes,
    preferredTime: (input.ai && input.ai.preferredTime) || session.context.preferredTime,
  }, date);
}

async function handleSelectSlot(session, customer, input) {
  const offered = normalizeSlots(session.context.availableSlots, { date: session.context.date });
  let slot = null;
  const tapped = input.buttonId && input.buttonId.startsWith('SLOT_') ? input.buttonId.slice('SLOT_'.length) : null;
  if (tapped) {
    slot = offered.length > 0 ? findSlot(offered, tapped) : normalizeSlots([tapped])[0] || null;
    if (!slot && offered.length > 0) {
      // A button from an older message: that time was never offered for the
      // current date, so never book it blindly.
      await whatsapp.sendText(session.phone, 'That time is no longer on offer. Please choose one of the times from the latest list.');
      return;
    }
  } else if (input.text) {
    const preferredStart = selectPreferredSlot(
      (input.ai && input.ai.preferredTime) || input.text,
      offered.map((item) => item.start)
    );
    slot = preferredStart ? findSlot(offered, preferredStart) : null;
  }
  if (!slot) {
    await whatsapp.sendText(session.phone, 'Please select one of the available times from the list above.');
    return;
  }
  const { availableSlots, ...context } = session.context;
  await promptItemReview(session, {
    ...context,
    ...slotFields(slot),
    voiceNotes: input.voice ? [...(context.voiceNotes || []), input.voice] : context.voiceNotes,
  });
}

module.exports = {
  promptForDate,
  showAvailability,
  handleSelectDate,
  handleSelectSlot,
  slotFields,
  upcomingAvailableDates,
  habitualPeriod,
};

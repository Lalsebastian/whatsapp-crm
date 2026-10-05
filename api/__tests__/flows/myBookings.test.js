// See ai/intentService.test.js for the require()-cache patching pattern.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const fakeCrm = require('../../crm/supabaseCrmAdapter');
fakeCrm.getBookings = vi.fn();
fakeCrm.getAvailability = vi.fn();
fakeCrm.rescheduleBooking = vi.fn();
fakeCrm.cancelBooking = vi.fn();

const whatsapp = require('../../whatsapp/client');
whatsapp.sendText = vi.fn();
whatsapp.sendButtons = vi.fn();
whatsapp.sendListMessage = vi.fn();

const sessionStore = require('../../session/sessionStore');
sessionStore.setFlow = vi.fn();
sessionStore.clearFlow = vi.fn();

const myBookings = require('../../flows/myBookings');
const { todayInTimeZone, addDays } = require('../../flows/dateUtils');

const booking = {
  id: 'b1', reference: 'BK-ABC234', serviceId: 'svc1',
  scheduledDate: '2030-01-10', scheduledTime: '09:00:00', status: 'technician_assigned',
};
const customer = { id: 'cust1' };

describe('my bookings flow', () => {
  beforeEach(() => {
    [fakeCrm.getBookings, fakeCrm.getAvailability, fakeCrm.rescheduleBooking, fakeCrm.cancelBooking,
      whatsapp.sendText, whatsapp.sendButtons, whatsapp.sendListMessage, sessionStore.setFlow, sessionStore.clearFlow]
      .forEach((fn) => fn.mockReset());
  });

  it('lists recent bookings with readable dates, times and statuses', async () => {
    fakeCrm.getBookings.mockResolvedValue([booking]);

    await myBookings.showMyBookings({ phone: '971500' }, customer);

    const rows = whatsapp.sendListMessage.mock.calls[0][3][0].rows;
    expect(rows).toEqual([{
      id: 'BKG_b1',
      title: 'BK-ABC234',
      description: 'Thursday, 10 January 9:00 AM — Technician Assigned',
    }]);
  });

  it('offers to book when the customer has no bookings', async () => {
    fakeCrm.getBookings.mockResolvedValue([]);
    await myBookings.showMyBookings({ phone: '971500' }, customer);
    expect(whatsapp.sendButtons.mock.calls[0][2]).toEqual([{ id: 'BOOK_SERVICE', title: 'Book a Service' }]);
    expect(sessionStore.clearFlow).toHaveBeenCalledWith('971500');
  });

  it('shows the actions for a selected booking and re-lists an unknown one', async () => {
    await myBookings.steps.select_booking({ phone: '971500', context: { bookings: [booking] } }, customer, { buttonId: 'BKG_b1' });
    expect(whatsapp.sendButtons.mock.calls[0][2].map((button) => button.id)).toEqual(['ACTION_RESCHEDULE', 'ACTION_CANCEL', 'ACTION_BACK']);

    fakeCrm.getBookings.mockResolvedValue([booking]);
    await myBookings.steps.select_booking({ phone: '971500', context: { bookings: [booking] } }, customer, { buttonId: 'BKG_gone' });
    expect(whatsapp.sendText.mock.calls.at(-1)[1]).toContain("couldn't find that booking");
  });

  describe('cancelling', () => {
    it('asks for confirmation before cancelling', async () => {
      await myBookings.steps.select_action({ phone: '971500', context: { booking } }, customer, { buttonId: 'ACTION_CANCEL' });
      expect(fakeCrm.cancelBooking).not.toHaveBeenCalled();
      expect(sessionStore.setFlow).toHaveBeenCalledWith('971500', 'my_bookings', 'confirm_cancel', { booking });
    });

    it('cancels on confirmation and keeps the booking on "Keep Booking"', async () => {
      fakeCrm.cancelBooking.mockResolvedValue({ ...booking, status: 'cancelled' });
      await myBookings.steps.confirm_cancel({ phone: '971500', context: { booking } }, customer, { buttonId: 'CANCEL_YES' });
      expect(fakeCrm.cancelBooking).toHaveBeenCalledWith('b1');
      expect(whatsapp.sendButtons.mock.calls.at(-1)[1]).toBe('Booking BK-ABC234 has been cancelled successfully.');
    expect(whatsapp.sendButtons.mock.calls.at(-1)[2].map((button) => button.id)).toEqual(['BOOK_SERVICE', 'MAIN_MENU']);

      await myBookings.steps.confirm_cancel({ phone: '971500', context: { booking } }, customer, { buttonId: 'CANCEL_NO' });
      expect(fakeCrm.cancelBooking).toHaveBeenCalledTimes(1);
    });

    it('does not claim success when the cancellation outcome is uncertain', async () => {
      fakeCrm.cancelBooking.mockRejectedValue(Object.assign(new Error('timeout'), { uncertain: true }));
      await myBookings.steps.confirm_cancel({ phone: '971500', context: { booking } }, customer, { buttonId: 'CANCEL_YES' });
      expect(whatsapp.sendText.mock.calls.at(-1)[1]).toContain('could not verify whether booking BK-ABC234 was cancelled');
      expect(sessionStore.clearFlow).not.toHaveBeenCalled();
    });
  });

  describe('rescheduling', () => {
    const future = addDays(todayInTimeZone(), 3);

    it('offers CRM slots (structured or legacy) as buttons with stable ids', async () => {
      fakeCrm.getAvailability.mockResolvedValue([{ id: 'crm-9', start: '09:00', end: '11:00' }, '13:00']);

      await myBookings.steps.awaiting_reschedule_date({ phone: '971500', context: { booking } }, customer, { text: future });

      expect(whatsapp.sendListMessage.mock.calls[0][3][0].rows).toEqual([
        { id: 'SLOT_crm-9', title: '9:00 AM – 11:00 AM' },
        { id: 'SLOT_13:00', title: '1:00 PM' },
      ]);
      expect(sessionStore.setFlow).toHaveBeenCalledWith('971500', 'my_bookings', 'awaiting_reschedule_slot', expect.objectContaining({
        date: future, availableSlots: expect.arrayContaining([expect.objectContaining({ id: 'crm-9' })]),
      }));
    });

    it('refuses a past date and reports a day with no availability', async () => {
      await myBookings.steps.awaiting_reschedule_date({ phone: '971500', context: { booking } }, customer, { text: '2020-01-01' });
      expect(fakeCrm.getAvailability).not.toHaveBeenCalled();
      expect(whatsapp.sendText.mock.calls.at(-1)[1]).toContain('already passed');

      fakeCrm.getAvailability.mockResolvedValue([]);
      await myBookings.steps.awaiting_reschedule_date({ phone: '971500', context: { booking } }, customer, { text: future });
      expect(whatsapp.sendText.mock.calls.at(-1)[1]).toContain("don't have any available times");
    });

    it('reschedules to the chosen slot\'s start time', async () => {
      fakeCrm.rescheduleBooking.mockResolvedValue({ ...booking, scheduledDate: future, scheduledTime: '13:00:00' });
      const availableSlots = [{ id: 'crm-9', start: '09:00' }, { id: '13:00', start: '13:00' }];

      await myBookings.steps.awaiting_reschedule_slot(
        { phone: '971500', context: { booking, date: future, availableSlots } },
        customer,
        { buttonId: 'SLOT_crm-9' }
      );

      expect(fakeCrm.rescheduleBooking).toHaveBeenCalledWith('b1', { date: future, time: '09:00' });
      const [, confirmation, buttons] = whatsapp.sendButtons.mock.calls.at(-1);
    expect(confirmation).toContain('1:00 PM');
    expect(buttons[0]).toEqual({ id: 'VIEW_BOOKING:b1', title: 'View Booking' });
    });

    it('refuses a slot button that was not offered for this date', async () => {
      await myBookings.steps.awaiting_reschedule_slot(
        { phone: '971500', context: { booking, date: future, availableSlots: [{ id: '09:00', start: '09:00' }] } },
        customer,
        { buttonId: 'SLOT_17:00' }
      );
      expect(fakeCrm.rescheduleBooking).not.toHaveBeenCalled();
      expect(whatsapp.sendText.mock.calls.at(-1)[1]).toContain('no longer on offer');
    });

    it('explains a slot that was just taken without saying "system error"', async () => {
      fakeCrm.rescheduleBooking.mockRejectedValue(Object.assign(new Error('taken'), { code: 'SLOT_UNAVAILABLE' }));
      await myBookings.steps.awaiting_reschedule_slot(
        { phone: '971500', context: { booking, date: future, availableSlots: [{ id: '09:00', start: '09:00' }] } },
        customer,
        { buttonId: 'SLOT_09:00' }
      );
      expect(whatsapp.sendText.mock.calls.at(-1)[1]).toContain('just booked by someone else');
    });
  });
});

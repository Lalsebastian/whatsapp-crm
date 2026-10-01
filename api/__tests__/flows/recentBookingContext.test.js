import { beforeEach, describe, expect, it, vi } from 'vitest';

const crm = require('../../crm/supabaseCrmAdapter');
crm.getServiceDetails = vi.fn();
const whatsapp = require('../../whatsapp/client');
whatsapp.sendButtons = vi.fn();
const sessionStore = require('../../session/sessionStore');
sessionStore.setFlow = vi.fn();
const flow = require('../../flows/recentBookingContext');

describe('recent booking context', () => {
  beforeEach(() => {
    crm.getServiceDetails.mockReset().mockResolvedValue({ id: 'svc-ac', name: 'AC Service', category: 'ac' });
    whatsapp.sendButtons.mockReset();
    sessionStore.setFlow.mockReset();
  });

  it('asks before linking a matching recent booking', async () => {
    const customer = {
      id: 'cust1',
      profile: { recentBookings: [{ id: 'b1', reference: 'BK-ONE', serviceId: 'svc-ac' }] },
    };
    const handled = await flow.tryStartRecentBookingContext(
      { phone: '971500' }, customer, { text: 'The same AC issue is back again' }
    );
    expect(handled).toBe(true);
    expect(whatsapp.sendButtons).toHaveBeenCalledWith(
      '971500', expect.stringContaining('BK-ONE'), expect.arrayContaining([
        expect.objectContaining({ id: 'CONFIRM_RECENT_BOOKING' }),
        expect.objectContaining({ id: 'CHOOSE_OTHER_BOOKING' }),
        expect.objectContaining({ id: 'TALK_TO_SUPPORT' }),
      ])
    );
  });

  it('combines empathy, recent-booking recognition, and three actions in one message', async () => {
    const customer = {
      id: 'cust1',
      profile: { recentBookings: [{ id: 'b1', reference: 'BK-PLUMB', serviceId: 'svc-plumbing' }] },
    };
    crm.getServiceDetails.mockResolvedValue({ id: 'svc-plumbing', name: 'Plumbing', category: 'plumbing' });

    const handled = await flow.tryStartRecentBookingContext(
      { phone: '971500' }, customer, { text: 'Yesterday plumber came but the kitchen pipe is still leaking' }
    );

    expect(handled).toBe(true);
    expect(whatsapp.sendButtons).toHaveBeenCalledTimes(1);
    expect(whatsapp.sendButtons).toHaveBeenCalledWith(
      '971500', expect.stringMatching(/sorry[\s\S]*returned[\s\S]*BK-PLUMB/i),
      [
        { id: 'CONFIRM_RECENT_BOOKING', title: 'Yes' },
        { id: 'CHOOSE_OTHER_BOOKING', title: 'Not This Booking' },
        { id: 'TALK_TO_SUPPORT', title: 'Talk to Support' },
      ]
    );
    expect(sessionStore.setFlow).toHaveBeenCalledWith(
      '971500', 'recent_booking_context', 'confirm_booking',
      expect.objectContaining({ bookingId: 'b1', room: 'kitchen', category: 'problem_returned' })
    );
  });

  it('does not infer a link without a relevant recent booking', async () => {
    const handled = await flow.tryStartRecentBookingContext(
      { phone: '971500' }, { id: 'cust1', profile: { recentBookings: [] } }, { text: 'same AC issue again' }
    );
    expect(handled).toBe(false);
    expect(whatsapp.sendButtons).not.toHaveBeenCalled();
  });
});

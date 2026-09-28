// See ai/intentService.test.js for why require()-cache monkey-patching is
// used instead of vi.mock. flows/complaint.js DESTRUCTURES evaluateTriggers/
// triggerEscalation from escalation/escalationService at require time, so
// those must be patched on the shared module object BEFORE complaint.js is
// first required here — otherwise its local bindings would already point at
// the real functions.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const fakeCrm = require('../../crm/supabaseCrmAdapter');
fakeCrm.getBookings = vi.fn();
fakeCrm.createComplaint = vi.fn();

const whatsapp = require('../../whatsapp/client');
whatsapp.sendText = vi.fn();
whatsapp.sendButtons = vi.fn();
whatsapp.sendListMessage = vi.fn();

const sessionStore = require('../../session/sessionStore');
sessionStore.setFlow = vi.fn();
sessionStore.clearFlow = vi.fn();

const escalationService = require('../../escalation/escalationService');
escalationService.evaluateTriggers = vi.fn(() => ({ escalate: false, reason: null }));
escalationService.triggerEscalation = vi.fn();

const complaint = require('../../flows/complaint');

function resetAll() {
  [fakeCrm.getBookings, fakeCrm.createComplaint, whatsapp.sendText, whatsapp.sendButtons, whatsapp.sendListMessage,
    sessionStore.setFlow, sessionStore.clearFlow, escalationService.triggerEscalation]
    .forEach((fn) => fn.mockReset());
  escalationService.evaluateTriggers.mockReset().mockReturnValue({ escalate: false, reason: null });
}

describe('complaint flow', () => {
  beforeEach(resetAll);

  it('"other" category requires a description before moving to the media step', async () => {
    const session = { phone: '971500', context: {} };
    await complaint.steps.select_category(session, {}, { buttonId: 'CAT_other' });

    expect(whatsapp.sendText).toHaveBeenCalledWith('971500', expect.stringContaining('describe the issue'));
    expect(sessionStore.setFlow).toHaveBeenCalledWith('971500', 'complaint', 'awaiting_details', expect.objectContaining({ category: 'other' }));
  });

  it('non-"other" categories skip straight to the media step', async () => {
    const session = { phone: '971500', context: {} };
    await complaint.steps.select_category(session, {}, { buttonId: 'CAT_technician_delayed' });

    expect(sessionStore.setFlow).toHaveBeenCalledWith('971500', 'complaint', 'awaiting_media', expect.objectContaining({ category: 'technician_delayed' }));
  });

  it('accumulates attachments in context across multiple media messages', async () => {
    const session = { phone: '971500', context: { attachments: [{ waMediaId: 'w1', mediaType: 'image' }] } };
    await complaint.steps.awaiting_media(session, {}, { mediaId: 'w2', mediaType: 'video' });

    expect(sessionStore.setFlow).toHaveBeenCalledWith(
      '971500', 'complaint', 'awaiting_media',
      expect.objectContaining({ attachments: [{ waMediaId: 'w1', mediaType: 'image' }, { waMediaId: 'w2', mediaType: 'video' }] })
    );
  });

  it('calls createComplaint exactly once, only on CONFIRM_COMPLAINT, including accumulated attachments', async () => {
    fakeCrm.createComplaint.mockResolvedValue({ reference: 'CM-ABC123', id: 'c1' });
    const session = {
      phone: '971500',
      context: { category: 'other', description: 'leak under sink', bookingId: null, attachments: [{ waMediaId: 'w1', mediaType: 'image' }] },
    };

    await complaint.steps.confirm(session, { id: 'cust1' }, { buttonId: 'CONFIRM_COMPLAINT' });

    expect(fakeCrm.createComplaint).toHaveBeenCalledTimes(1);
    expect(fakeCrm.createComplaint).toHaveBeenCalledWith(expect.objectContaining({
      customerId: 'cust1', category: 'other', description: 'leak under sink', attachments: [{ waMediaId: 'w1', mediaType: 'image' }],
    }));
  });

  it('does not call createComplaint when the customer cancels', async () => {
    const session = { phone: '971500', context: { category: 'other', attachments: [] } };
    await complaint.steps.confirm(session, { id: 'cust1' }, { buttonId: 'CANCEL_FLOW' });
    expect(fakeCrm.createComplaint).not.toHaveBeenCalled();
  });
});

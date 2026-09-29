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

const intentService = require('../../ai/intentService');
intentService.classifyComplaintCategory = vi.fn();

const actionGuard = require('../../reliability/actionGuard');

const complaint = require('../../flows/complaint');

function resetAll() {
  [fakeCrm.getBookings, fakeCrm.createComplaint, whatsapp.sendText, whatsapp.sendButtons, whatsapp.sendListMessage,
    sessionStore.setFlow, sessionStore.clearFlow, escalationService.triggerEscalation, intentService.classifyComplaintCategory]
    .forEach((fn) => fn.mockReset());
  escalationService.evaluateTriggers.mockReset().mockReturnValue({ escalate: false, reason: null });
  intentService.classifyComplaintCategory.mockResolvedValue({ category: null, confidence: 0 });
  actionGuard.clearForTests();
}

describe('complaint flow', () => {
  beforeEach(resetAll);

  it('"other" category requires a description before moving to the media step', async () => {
    const session = { phone: '971500', context: {} };
    await complaint.steps.select_category(session, {}, { buttonId: 'CAT_other' });

    expect(whatsapp.sendText).toHaveBeenCalledWith('971500', expect.stringContaining('tell me what happened'));
    expect(sessionStore.setFlow).toHaveBeenCalledWith('971500', 'complaint', 'awaiting_details', expect.objectContaining({ category: 'other' }));
  });

  it('non-"other" categories skip straight to the media step', async () => {
    const session = { phone: '971500', context: {} };
    await complaint.steps.select_category(session, {}, { buttonId: 'CAT_technician_delayed' });

    expect(sessionStore.setFlow).toHaveBeenCalledWith('971500', 'complaint', 'awaiting_media', expect.objectContaining({ category: 'technician_delayed' }));
  });

  it('uses empathetic wording for a technician delay', async () => {
    const session = { phone: '971500', context: {} };
    await complaint.steps.select_category(session, {}, { buttonId: 'CAT_technician_delayed' });

    expect(whatsapp.sendText).toHaveBeenCalledWith(
      '971500',
      expect.stringContaining('sorry you had to wait for the technician')
    );
  });

  it('uses appropriately reassuring wording for property damage', async () => {
    const session = { phone: '971500', context: {} };
    await complaint.steps.select_category(session, {}, { buttonId: 'CAT_property_damage' });

    expect(whatsapp.sendText).toHaveBeenCalledWith(
      '971500',
      expect.stringContaining('understand this requires attention')
    );
  });

  it('classifies a free-text complaint without submitting it directly', async () => {
    intentService.classifyComplaintCategory.mockResolvedValue({ category: 'technician_delayed', confidence: 0.92 });
    const session = { phone: '971500', context: {}, preferredLanguage: 'en' };

    await complaint.steps.select_category(session, {}, { text: 'The technician arrived very late' });

    expect(intentService.classifyComplaintCategory).toHaveBeenCalled();
    expect(sessionStore.setFlow).toHaveBeenCalledWith(
      '971500',
      'complaint',
      'awaiting_media',
      expect.objectContaining({
        category: 'technician_delayed',
        description: 'The technician arrived very late',
      })
    );
    expect(fakeCrm.createComplaint).not.toHaveBeenCalled();
  });

  it('accumulates attachments in context across multiple media messages', async () => {
    const session = { phone: '971500', context: { attachments: [{ waMediaId: 'w1', mediaType: 'image' }] } };
    await complaint.steps.awaiting_media(session, {}, { mediaId: 'w2', mediaType: 'video' });

    expect(sessionStore.setFlow).toHaveBeenCalledWith(
      '971500', 'complaint', 'awaiting_media',
      expect.objectContaining({ attachments: [{ waMediaId: 'w1', mediaType: 'image' }, { waMediaId: 'w2', mediaType: 'video' }] })
    );
    expect(whatsapp.sendText).toHaveBeenCalledWith(
      '971500',
      expect.stringContaining("I've received 2 attachments")
    );
  });

  it('shows a customer-friendly review summary and keeps the existing button IDs', async () => {
    const session = {
      phone: '971500',
      context: {
        category: 'technician_delayed',
        description: 'The technician arrived an hour late',
        attachments: [{ waMediaId: 'w1', mediaType: 'image' }],
      },
    };

    await complaint.steps.awaiting_media(session, {}, { buttonId: 'MEDIA_DONE' });

    expect(whatsapp.sendButtons).toHaveBeenCalledWith(
      '971500',
      expect.stringContaining('Issue: Technician delay\nDetails: The technician arrived an hour late\nAttachments received: 1'),
      [
        { id: 'CONFIRM_COMPLAINT', title: 'Submit Complaint' },
        { id: 'CANCEL_FLOW', title: 'Cancel Request' },
      ]
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
    expect(whatsapp.sendText).toHaveBeenCalledWith(
      '971500',
      expect.stringContaining("I've registered your complaint with our support team")
    );
  });

  it('mentions priority review only when escalation succeeds', async () => {
    fakeCrm.createComplaint.mockResolvedValue({ reference: 'CM-PRIORITY', id: 'c2' });
    escalationService.evaluateTriggers.mockReturnValue({ escalate: true, reason: 'property_damage' });
    escalationService.triggerEscalation.mockResolvedValue();
    const session = { phone: '971500', context: { category: 'property_damage', attachments: [] } };

    await complaint.steps.confirm(session, { id: 'cust1' }, { buttonId: 'CONFIRM_COMPLAINT' });

    expect(whatsapp.sendText).toHaveBeenCalledWith(
      '971500',
      expect.stringContaining("I've also marked this for priority review")
    );
  });

  it('still confirms registration but does not claim priority review when escalation fails', async () => {
    fakeCrm.createComplaint.mockResolvedValue({ reference: 'CM-REGISTERED', id: 'c3' });
    escalationService.evaluateTriggers.mockReturnValue({ escalate: true, reason: 'property_damage' });
    escalationService.triggerEscalation.mockRejectedValue(new Error('escalation unavailable'));
    const session = { phone: '971500', context: { category: 'property_damage', attachments: [] } };

    await complaint.steps.confirm(session, { id: 'cust1' }, { buttonId: 'CONFIRM_COMPLAINT' });

    const message = whatsapp.sendText.mock.calls.at(-1)[1];
    expect(message).toContain("I've registered your complaint with our support team");
    expect(message).not.toContain('priority review');
  });

  it('does not claim submission succeeded when complaint creation fails', async () => {
    fakeCrm.createComplaint.mockRejectedValue(new Error('CRM unavailable'));
    const session = {
      phone: '971500',
      context: { category: 'other', description: 'leak under sink', attachments: [] },
    };

    await complaint.steps.confirm(session, { id: 'cust1' }, { buttonId: 'CONFIRM_COMPLAINT' });

    const message = whatsapp.sendText.mock.calls.at(-1)[1];
    expect(message).toContain("wasn't able to register the complaint");
    expect(message).toContain('details are still saved in this conversation');
    expect(message).not.toContain("I've registered your complaint");
    expect(sessionStore.clearFlow).not.toHaveBeenCalled();
  });

  it('creates only one CRM complaint when submission is repeated concurrently', async () => {
    fakeCrm.createComplaint.mockResolvedValue({ reference: 'CM-ONCE', id: 'c-once' });
    const session = {
      phone: '971500',
      context: { submissionNonce: 'complaint-once', category: 'other', description: 'leak', attachments: [] },
    };

    await Promise.all([
      complaint.steps.confirm(session, { id: 'cust1' }, { buttonId: 'CONFIRM_COMPLAINT' }),
      complaint.steps.confirm(session, { id: 'cust1' }, { buttonId: 'CONFIRM_COMPLAINT' }),
    ]);

    expect(fakeCrm.createComplaint).toHaveBeenCalledTimes(1);
  });

  it('does not call createComplaint when the customer cancels', async () => {
    const session = { phone: '971500', context: { category: 'other', attachments: [] } };
    await complaint.steps.confirm(session, { id: 'cust1' }, { buttonId: 'CANCEL_FLOW' });
    expect(fakeCrm.createComplaint).not.toHaveBeenCalled();
  });
});

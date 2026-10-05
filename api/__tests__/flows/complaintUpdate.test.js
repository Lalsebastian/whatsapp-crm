import { describe, it, expect, vi, beforeEach } from 'vitest';

const sessionStore = require('../../session/sessionStore');
sessionStore.setFlow = vi.fn();
sessionStore.clearFlow = vi.fn();

const whatsapp = require('../../whatsapp/client');
whatsapp.sendText = vi.fn();
whatsapp.sendButtons = vi.fn();

const crm = require('../../crm/supabaseCrmAdapter');
crm.addComplaintDetails = vi.fn();

const actionGuard = require('../../reliability/actionGuard');
const { startComplaintUpdate, steps } = require('../../flows/complaintUpdate');

const customer = { id: 'cust-1' };
const complaint = { id: 'cm-1', reference: 'CM-ABC123' };
const collecting = (context) => ({ phone: '971500', context: { complaintId: 'cm-1', reference: 'CM-ABC123', nonce: 'n1', notes: [], attachments: [], ...context } });
const lastBody = () => whatsapp.sendButtons.mock.calls.at(-1)[1];

describe('adding details to an open complaint', () => {
  beforeEach(() => {
    sessionStore.setFlow.mockReset();
    sessionStore.clearFlow.mockReset();
    whatsapp.sendText.mockReset();
    whatsapp.sendButtons.mockReset();
    crm.addComplaintDetails.mockReset().mockResolvedValue({ ok: true });
    actionGuard.clearForTests();
  });

  it('keeps what the customer already said and asks for anything else', async () => {
    await startComplaintUpdate({ phone: '971500' }, customer, complaint, { text: 'it is leaking again' });
    expect(lastBody()).toContain('I\'ve noted that for complaint CM-ABC123');
    expect(sessionStore.setFlow).toHaveBeenCalledWith('971500', 'complaint_update', 'collecting', expect.objectContaining({ notes: ['it is leaking again'] }));
  });

  it('collects notes, photos and voice notes, then sends them in one CRM call', async () => {
    await steps.collecting(collecting(), customer, { text: 'water under the sink' });
    expect(lastBody()).toBe('Got it (1 item so far). Send more, or tap Done to add it to CM-ABC123.');

    await steps.collecting(collecting({ notes: ['water under the sink'] }), customer, { mediaId: 'img-1', mediaType: 'image' });
    expect(lastBody()).toContain('2 items so far');

    await steps.collecting(collecting({ notes: ['water under the sink'], attachments: [{ waMediaId: 'img-1', mediaType: 'image' }] }), customer, { buttonId: 'UPDATE_DONE' });
    expect(crm.addComplaintDetails).toHaveBeenCalledWith('cm-1', {
      customerId: 'cust-1', text: 'water under the sink', attachments: [{ waMediaId: 'img-1', mediaType: 'image' }],
      idempotencyKey: 'complaint-update:cm-1:n1',
    });
    expect(lastBody()).toContain('I\'ve added your update to complaint CM-ABC123');
    expect(sessionStore.clearFlow).toHaveBeenCalled();
  });

  it('does not submit an empty update', async () => {
    await steps.collecting(collecting(), customer, { buttonId: 'UPDATE_DONE' });
    expect(crm.addComplaintDetails).not.toHaveBeenCalled();
    expect(lastBody()).toContain('haven\'t received any new details');
  });

  it('keeps the details for a retry when the CRM refuses', async () => {
    crm.addComplaintDetails.mockRejectedValue(new Error('500'));
    await steps.collecting(collecting({ notes: ['x'] }), customer, { text: 'done' });
    expect(lastBody()).toContain('Your details are still here');
    expect(sessionStore.clearFlow).not.toHaveBeenCalled();
  });

  it('asks the customer not to resend when the outcome is uncertain', async () => {
    crm.addComplaintDetails.mockRejectedValue(Object.assign(new Error('timeout'), { uncertain: true }));
    await steps.collecting(collecting({ notes: ['x'] }), customer, { buttonId: 'UPDATE_DONE' });
    expect(lastBody()).toContain('Please don\'t resend it yet');
  });

  it('caps the number of files in one update', async () => {
    const attachments = Array.from({ length: 10 }, (_, index) => ({ waMediaId: `m${index}`, mediaType: 'image' }));
    await steps.collecting(collecting({ attachments }), customer, { mediaId: 'm11', mediaType: 'image' });
    expect(lastBody()).toContain('maximum of 10 files');
    expect(sessionStore.setFlow).not.toHaveBeenCalled();
  });

  it('cancels without touching the complaint', async () => {
    await steps.collecting(collecting({ notes: ['x'] }), customer, { buttonId: 'UPDATE_CANCEL' });
    expect(whatsapp.sendText).toHaveBeenCalledWith('971500', 'Okay, nothing has been added to complaint CM-ABC123.');
    expect(crm.addComplaintDetails).not.toHaveBeenCalled();
  });
});

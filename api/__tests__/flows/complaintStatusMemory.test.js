import { beforeEach, describe, expect, it, vi } from 'vitest';

const crm = require('../../crm/supabaseCrmAdapter');
crm.getActiveComplaints = vi.fn();
const whatsapp = require('../../whatsapp/client');
whatsapp.sendText = vi.fn();
whatsapp.sendButtons = vi.fn();
whatsapp.sendListMessage = vi.fn();
const sessionStore = require('../../session/sessionStore');
sessionStore.setFlow = vi.fn();
sessionStore.clearFlow = vi.fn();
const flow = require('../../flows/complaintStatus');

describe('complaint status CRM context', () => {
  beforeEach(() => {
    crm.getActiveComplaints.mockReset().mockResolvedValue([]);
    whatsapp.sendText.mockReset();
    whatsapp.sendButtons.mockReset();
    whatsapp.sendListMessage.mockReset();
    sessionStore.setFlow.mockReset();
    sessionStore.clearFlow.mockReset();
  });

  it('offers the only active complaint directly', async () => {
    crm.getActiveComplaints.mockResolvedValue([{ id: 'c1', reference: 'CM-ONE', status: 'open' }]);
    await flow.promptForReference({ phone: '971500' }, { id: 'cust1' });
    expect(whatsapp.sendButtons).toHaveBeenCalledWith(
      '971500', expect.stringContaining('CM-ONE'), expect.arrayContaining([
        expect.objectContaining({ id: 'CHECK_ACTIVE_COMPLAINT' }),
      ])
    );
  });

  it('shows a selection when multiple complaints are active', async () => {
    crm.getActiveComplaints.mockResolvedValue([
      { id: 'c1', reference: 'CM-ONE', status: 'open', category: 'other' },
      { id: 'c2', reference: 'CM-TWO', status: 'in_progress', category: 'service_quality' },
    ]);
    await flow.promptForReference({ phone: '971500' }, { id: 'cust1' });
    expect(whatsapp.sendListMessage).toHaveBeenCalledWith(
      '971500', expect.any(String), expect.any(String), expect.any(Array)
    );
  });
});

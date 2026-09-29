import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.RETRY_BASE_DELAY_MS = '1';
process.env.WHATSAPP_MAX_RETRIES = '2';

const axios = require('axios');
axios.post = vi.fn();
const whatsapp = require('../../whatsapp/client');

describe('WhatsApp outbound retry policy', () => {
  beforeEach(() => { axios.post.mockReset(); });

  it('retries transient Meta failures and succeeds', async () => {
    const transient = Object.assign(new Error('rate limited'), { response: { status: 429, data: {} } });
    axios.post.mockRejectedValueOnce(transient).mockResolvedValueOnce({ data: { messages: [{ id: 'wamid-out' }] } });

    await expect(whatsapp.post({ messaging_product: 'whatsapp' })).resolves.toBeTruthy();
    expect(axios.post).toHaveBeenCalledTimes(2);
  });

  it('does not retry permanent authentication failures', async () => {
    const permanent = Object.assign(new Error('unauthorized'), { response: { status: 401, data: { error: 'unauthorized' } } });
    axios.post.mockRejectedValue(permanent);

    await expect(whatsapp.post({ messaging_product: 'whatsapp' })).rejects.toBe(permanent);
    expect(axios.post).toHaveBeenCalledTimes(1);
  });

  it('rejects a malformed success response without retrying it', async () => {
    axios.post.mockResolvedValue({ data: {} });

    await expect(whatsapp.post({ messaging_product: 'whatsapp' })).rejects.toMatchObject({
      code: 'WHATSAPP_MALFORMED_RESPONSE',
    });
    expect(axios.post).toHaveBeenCalledTimes(1);
  });
});

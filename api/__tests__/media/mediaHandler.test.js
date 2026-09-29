import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.MAX_READ_RETRIES = '1';
process.env.RETRY_BASE_DELAY_MS = '1';

const axios = require('axios');
axios.get = vi.fn();
const { downloadWhatsAppMedia } = require('../../media/mediaHandler');

describe('WhatsApp media download', () => {
  beforeEach(() => { axios.get.mockReset(); });

  it('resolves Meta metadata and downloads audio bytes securely', async () => {
    axios.get
      .mockResolvedValueOnce({ data: { url: 'https://lookaside.fbsbx.com/audio', mime_type: 'audio/ogg; codecs=opus', file_size: 4 } })
      .mockResolvedValueOnce({ data: Buffer.from('opus'), headers: { 'content-type': 'audio/ogg' } });

    const result = await downloadWhatsAppMedia('media-1', { maxBytes: 100 });

    expect(result.buffer.equals(Buffer.from('opus'))).toBe(true);
    expect(result.mimeType).toBe('audio/ogg; codecs=opus');
    expect(axios.get.mock.calls[0][1].headers.Authorization).toMatch(/^Bearer /);
    expect(axios.get.mock.calls[1][1]).toEqual(expect.objectContaining({
      responseType: 'arraybuffer', timeout: expect.any(Number), maxContentLength: 100,
    }));
  });

  it('retries a transient metadata timeout and then succeeds', async () => {
    const timeout = Object.assign(new Error('timeout'), { code: 'ECONNABORTED' });
    axios.get
      .mockRejectedValueOnce(timeout)
      .mockResolvedValueOnce({ data: { url: 'https://lookaside.fbsbx.com/audio', mime_type: 'audio/ogg' } })
      .mockResolvedValueOnce({ data: Buffer.from('ok'), headers: { 'content-type': 'audio/ogg' } });

    await expect(downloadWhatsAppMedia('media-2', { maxBytes: 100 })).resolves.toMatchObject({ mimeType: 'audio/ogg' });
    expect(axios.get).toHaveBeenCalledTimes(3);
  });

  it('surfaces a media timeout after the bounded retry is exhausted', async () => {
    const timeout = Object.assign(new Error('timeout'), { code: 'ECONNABORTED' });
    axios.get.mockRejectedValue(timeout);

    await expect(downloadWhatsAppMedia('media-timeout', { maxBytes: 100 })).rejects.toBe(timeout);
    expect(axios.get).toHaveBeenCalledTimes(2);
  });

  it('rejects media declared above the configured size before downloading bytes', async () => {
    axios.get.mockResolvedValueOnce({
      data: { url: 'https://lookaside.fbsbx.com/audio', mime_type: 'audio/ogg', file_size: 101 },
    });

    await expect(downloadWhatsAppMedia('media-3', { maxBytes: 100 })).rejects.toMatchObject({ code: 'MEDIA_TOO_LARGE' });
    expect(axios.get).toHaveBeenCalledTimes(1);
  });
});

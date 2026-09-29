import { describe, it, expect } from 'vitest';

const { normalizeInboundMessage } = require('../../whatsapp/parseInbound');

describe('WhatsApp audio normalization', () => {
  it('normalizes an incoming voice note with its media reference and MIME type', () => {
    const inbound = normalizeInboundMessage({
      entry: [{ changes: [{ value: { messages: [{
        id: 'wamid.voice-1',
        from: '971500',
        timestamp: '12345',
        type: 'audio',
        audio: { id: 'media-audio-1', mime_type: 'audio/ogg; codecs=opus', voice: true },
      }] } }] }],
    });

    expect(inbound).toEqual({
      from: '971500',
      waMessageId: 'wamid.voice-1',
      timestamp: '12345',
      type: 'audio',
      mediaId: 'media-audio-1',
      mediaMimeType: 'audio/ogg; codecs=opus',
      caption: undefined,
    });
  });
});

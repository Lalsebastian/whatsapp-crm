import { describe, it, expect, vi, beforeEach } from 'vitest';

const geminiProvider = require('../../ai/providers/geminiProvider');
geminiProvider.callGeminiAudio = vi.fn();

const { transcribeAudio, normalizeAudioMimeType } = require('../../media/transcription');

describe('voice transcription service', () => {
  beforeEach(() => { geminiProvider.callGeminiAudio.mockReset(); });

  it('transcribes OGG/Opus audio and preserves multilingual text', async () => {
    geminiProvider.callGeminiAudio.mockResolvedValue(JSON.stringify({
      text: 'Nale Kakkanad plumber venam', detectedLanguage: 'ml-Latn', confidence: 0.94,
    }));

    await expect(transcribeAudio({
      buffer: Buffer.from('audio'), mimeType: 'audio/ogg; codecs=opus', languageHint: 'manglish',
    })).resolves.toEqual({
      text: 'Nale Kakkanad plumber venam',
      detectedLanguage: 'ml-Latn',
      confidence: 0.94,
      provider: 'gemini',
      mimeType: 'audio/ogg',
    });
    expect(normalizeAudioMimeType('audio/ogg; codecs=opus')).toBe('audio/ogg');
  });

  it('rejects an empty transcription response', async () => {
    geminiProvider.callGeminiAudio.mockResolvedValue(JSON.stringify({ text: '', confidence: 0.1 }));
    await expect(transcribeAudio({ buffer: Buffer.from('audio'), mimeType: 'audio/ogg' }))
      .rejects.toMatchObject({ code: 'VOICE_EMPTY_TRANSCRIPT' });
  });

  it('rejects unsupported audio without calling the provider', async () => {
    await expect(transcribeAudio({ buffer: Buffer.from('audio'), mimeType: 'audio/amr' }))
      .rejects.toMatchObject({ code: 'VOICE_UNSUPPORTED_MIME' });
    expect(geminiProvider.callGeminiAudio).not.toHaveBeenCalled();
  });
});

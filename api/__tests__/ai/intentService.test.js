// This project is plain CommonJS. Node's require() cache guarantees every
// require('../../ai/providers/geminiProvider') call — ours here, and the one
// inside ai/intentService.js — returns the SAME cached object, so mutating
// its callGemini method before intentService.js is first required reliably
// substitutes it everywhere, without depending on vi.mock's module-graph
// interception (which does not reach transitive require() calls here).
import { describe, it, expect, vi, beforeEach } from 'vitest';

const geminiProvider = require('../../ai/providers/geminiProvider');
geminiProvider.callGemini = vi.fn();

const { detectIntent } = require('../../ai/intentService');
const { callGemini } = geminiProvider;

describe('detectIntent', () => {
  beforeEach(() => { callGemini.mockReset(); });

  it('returns a validated result for well-formed JSON', async () => {
    callGemini.mockResolvedValueOnce(JSON.stringify({
      intent: 'NEW_BOOKING', service: 'AC', preferredDate: 'tomorrow', preferredTime: 'evening', language: 'manglish', confidence: 0.94,
    }));

    const result = await detectIntent('Nale evening AC service venam');
    expect(result).toEqual({
      intent: 'NEW_BOOKING', service: 'AC', preferredDate: 'tomorrow', preferredTime: 'evening', language: 'manglish', confidence: 0.94,
    });
  });

  it('falls back to UNKNOWN on malformed JSON rather than throwing', async () => {
    callGemini.mockResolvedValueOnce('not json at all');
    const result = await detectIntent('asdkjaslkd');
    expect(result.intent).toBe('UNKNOWN');
    expect(result.confidence).toBe(0);
  });

  it('falls back to UNKNOWN when the model invents an intent outside the enum', async () => {
    callGemini.mockResolvedValueOnce(JSON.stringify({ intent: 'DELETE_ALL_BOOKINGS', confidence: 0.9 }));
    const result = await detectIntent('do something');
    expect(result.intent).toBe('UNKNOWN');
  });

  it('falls back to UNKNOWN when the provider call throws (e.g. network error)', async () => {
    callGemini.mockRejectedValueOnce(new Error('network error'));
    const result = await detectIntent('hello');
    expect(result.intent).toBe('UNKNOWN');
    expect(result.confidence).toBe(0);
  });

  it('clamps an out-of-range confidence into [0,1]', async () => {
    callGemini.mockResolvedValueOnce(JSON.stringify({ intent: 'GENERAL_QUERY', confidence: 5 }));
    const result = await detectIntent('hi');
    expect(result.confidence).toBe(1);
  });

  it('strips accidental markdown code fences before parsing', async () => {
    callGemini.mockResolvedValueOnce('```json\n{"intent":"HUMAN_AGENT","confidence":0.8}\n```');
    const result = await detectIntent('let me talk to someone');
    expect(result.intent).toBe('HUMAN_AGENT');
  });
});

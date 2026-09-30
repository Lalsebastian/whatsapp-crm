// This project is plain CommonJS. Node's require() cache guarantees every
// require('../../ai/providers/geminiProvider') call — ours here, and the one
// inside ai/intentService.js — returns the SAME cached object, so mutating
// its callGemini method before intentService.js is first required reliably
// substitutes it everywhere, without depending on vi.mock's module-graph
// interception (which does not reach transitive require() calls here).
import { describe, it, expect, vi, beforeEach } from 'vitest';

const geminiProvider = require('../../ai/providers/geminiProvider');
geminiProvider.callGemini = vi.fn();

const {
  detectIntent,
  classifyComplaintCategory,
  matchServiceToCatalog,
  analyzeBookingCorrection,
  summarizeHandoff,
} = require('../../ai/intentService');
const { callGemini } = geminiProvider;

describe('detectIntent', () => {
  beforeEach(() => { callGemini.mockReset(); });

  it('returns a validated result for well-formed JSON', async () => {
    callGemini.mockResolvedValueOnce(JSON.stringify({
      intent: 'NEW_BOOKING', service: 'AC', preferredDate: 'tomorrow', preferredTime: 'evening', language: 'manglish', confidence: 0.94,
    }));

    const result = await detectIntent('Nale evening AC service venam');
    expect(result).toEqual({
      intent: 'NEW_BOOKING', service: 'AC', issue: null, locationHint: null,
      preferredDate: 'tomorrow', preferredTime: 'evening', language: 'manglish', confidence: 0.94,
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

  it('falls back to UNKNOWN when the AI provider times out', async () => {
    const timeout = Object.assign(new Error('timeout'), { code: 'ECONNABORTED' });
    callGemini.mockRejectedValueOnce(timeout);
    const result = await detectIntent('light not working');
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

  it('accepts the dedicated feedback intent', async () => {
    callGemini.mockResolvedValueOnce(JSON.stringify({ intent: 'FEEDBACK', confidence: 0.93 }));
    const result = await detectIntent('I want to review my booking');
    expect(result.intent).toBe('FEEDBACK');
  });
});

describe('matchServiceToCatalog', () => {
  beforeEach(() => { callGemini.mockReset(); });

  const services = [
    { id: 'svc-electrical', name: 'Electrical', category: 'electrical' },
    { id: 'svc-plumbing', name: 'Plumbing', category: 'plumbing' },
  ];

  it('accepts only a service ID supplied by CRM', async () => {
    callGemini.mockResolvedValueOnce(JSON.stringify({ serviceId: 'svc-electrical', confidence: 0.93 }));
    await expect(matchServiceToCatalog('light is not working', services)).resolves.toEqual({
      serviceId: 'svc-electrical', confidence: 0.93,
    });
  });

  it('rejects an invented service ID', async () => {
    callGemini.mockResolvedValueOnce(JSON.stringify({ serviceId: 'svc-invented', confidence: 0.99 }));
    await expect(matchServiceToCatalog('fix something', services)).resolves.toEqual({
      serviceId: null, confidence: 0,
    });
  });
});

describe('classifyComplaintCategory', () => {
  beforeEach(() => { callGemini.mockReset(); });

  it('returns a validated complaint category for natural language', async () => {
    callGemini.mockResolvedValueOnce(JSON.stringify({ category: 'technician_delayed', confidence: 0.91 }));

    const result = await classifyComplaintCategory('The technician arrived very late');

    expect(result).toEqual({ category: 'technician_delayed', confidence: 0.91 });
  });

  it('falls back safely when the model returns an invalid category', async () => {
    callGemini.mockResolvedValueOnce(JSON.stringify({ category: 'technician_rude', confidence: 0.95 }));

    const result = await classifyComplaintCategory('The technician was rude');

    expect(result).toEqual({ category: null, confidence: 0 });
  });
});

describe('analyzeBookingCorrection', () => {
  beforeEach(() => { callGemini.mockReset(); });

  it('extracts multiple changed fields without inventing unchanged details', async () => {
    callGemini.mockResolvedValueOnce(JSON.stringify({
      service: 'Plumbing', locationHint: null, preferredDate: 'tomorrow', preferredTime: 'morning', confidence: 0.97,
    }));

    await expect(analyzeBookingCorrection('change it to plumbing tomorrow morning')).resolves.toEqual({
      service: 'Plumbing', locationHint: null, preferredDate: 'tomorrow', preferredTime: 'morning', confidence: 0.97,
    });
  });

  it('falls back safely when correction analysis is unavailable', async () => {
    callGemini.mockRejectedValueOnce(new Error('network error'));
    await expect(analyzeBookingCorrection('make it plumbing instead')).resolves.toEqual({
      service: null, locationHint: null, preferredDate: null, preferredTime: null, confidence: 0,
    });
  });
});

describe('summarizeHandoff', () => {
  beforeEach(() => { callGemini.mockReset(); });

  it('returns a concise AI-generated staff summary', async () => {
    callGemini.mockResolvedValueOnce(JSON.stringify({
      summary: 'Customer reports repeat AC cooling failure and supplied one image.',
    }));
    await expect(summarizeHandoff({ complaint: { category: 'problem_returned' } })).resolves.toBe(
      'Customer reports repeat AC cooling failure and supplied one image.'
    );
  });

  it('returns null so the handoff service can use its deterministic fallback', async () => {
    callGemini.mockRejectedValueOnce(new Error('AI unavailable'));
    await expect(summarizeHandoff({ issue: { reasonForEscalation: 'payment_dispute' } })).resolves.toBeNull();
  });
});

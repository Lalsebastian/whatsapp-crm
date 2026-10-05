import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const geminiProvider = require('../../ai/providers/geminiProvider');
geminiProvider.callGemini = vi.fn();

const intentService = require('../../ai/intentService');
const { detectShortcut } = require('../../ai/shortcuts');
const { rankFamilies, clearFamily, urgentReason } = require('../../ai/serviceSynonyms');
const { rankServiceCandidates } = require('../../ai/serviceResolver');
const { understandFreeText, unexplainedWords } = require('../../ai/understanding');
const messageBudget = require('../../analytics/messageBudget');
const { runWithRequestContext } = require('../../reliability/requestContext');

describe('intent shortcut engine', () => {
  it.each([
    ['book AC tomorrow', 'NEW_BOOKING'],
    ['cancel my booking', 'CANCEL_BOOKING'],
    ['I don\'t need the technician anymore', 'CANCEL_BOOKING'],
    ['same problem again', 'COMPLAINT'],
    ['the AC is still not cooling', 'COMPLAINT'],
    ['where is my complaint', 'COMPLAINT_STATUS'],
    ['CM-4H2M8X', 'COMPLAINT_STATUS'],
    ['talk to human', 'HUMAN_AGENT'],
    ['can I speak with someone', 'HUMAN_AGENT'],
    ['reschedule to friday', 'RESCHEDULE_BOOKING'],
    ['booking status', 'BOOKING_STATUS'],
    ['technician has not arrived yet', 'BOOKING_STATUS'],
    ['show my bookings', 'MY_BOOKINGS'],
    ['what services do you offer', 'GENERAL_QUERY'],
  ])('"%s" → %s', (text, intent) => {
    expect(detectShortcut(text).intent).toBe(intent);
  });

  it.each([
    'I need to change the light bulb this time',
    'can you book it again',
  ])('does not misfire on "%s"', (text) => {
    const result = detectShortcut(text);
    expect(['RESCHEDULE_BOOKING', 'COMPLAINT']).not.toContain(result && result.intent);
  });

  it('ignores small talk', () => {
    expect(detectShortcut('ok thanks')).toBeNull();
    expect(detectShortcut('')).toBeNull();
  });
});

describe('service synonym dictionary', () => {
  it.each([
    ['water leak in the kitchen', 'plumbing'],
    ['current problem in the hall', 'electrical'],
    ['washing machine not spinning', 'appliance_repair'],
    ['ac leaking water', 'ac'],
    ['fridge not cooling', 'appliance_repair'],
    ['cockroaches everywhere', 'pest_control'],
    ['paani leak under sink', 'plumbing'],
  ])('maps "%s" to %s', (text, key) => {
    expect(clearFamily(text).key).toBe(key);
  });

  it('lets the longest phrase win ("ac leaking" is AC, not plumbing)', () => {
    expect(rankFamilies('ac leaking')[0].key).toBe('ac');
  });

  it('counts spelling variants once ("a/c" and "ac")', () => {
    expect(rankFamilies('clean the a/c')).toEqual([
      expect.objectContaining({ key: 'ac', score: 1 }),
      expect.objectContaining({ key: 'home_cleaning', score: 1 }),
    ]);
    expect(clearFamily('clean the ac')).toBeNull();
  });

  it('flags urgent wording such as a gas smell', () => {
    expect(urgentReason('there is a gas smell in the kitchen')).toBe('immediate_safety_concern');
    expect(urgentReason('my gas bill is high')).toBeNull();
  });

  it('ranks only services that exist in the CRM catalogue', () => {
    const catalogue = [
      { id: 'p', name: 'Plumbing', category: 'plumbing' },
      { id: 'e', name: 'Electrical', category: 'electrical' },
    ];
    expect(rankServiceCandidates('water dripping from the light', catalogue).map((s) => s.id)).toEqual(['p', 'e']);
    expect(rankServiceCandidates('cockroaches', catalogue)).toEqual([]);
  });
});

describe('cost-aware understanding', () => {
  beforeEach(() => {
    geminiProvider.callGemini.mockReset();
    messageBudget.reset();
  });

  const understand = (text) => runWithRequestContext({ phone: '971500' }, () => understandFreeText(text, { session: { phone: '971500' } }));

  it.each([
    'book AC tomorrow morning',
    'cancel my booking',
    'talk to a human',
    'where is my complaint',
    'washing machine not spinning',
  ])('answers "%s" from rules, without an AI call', async (text) => {
    const result = await understand(text);
    expect(result.aiUsed).toBe(false);
    expect(geminiProvider.callGemini).not.toHaveBeenCalled();
    expect(messageBudget.get('971500').aiCallsAvoided).toBe(1);
  });

  it('asks the model only when words are left unexplained (e.g. a place name)', async () => {
    geminiProvider.callGemini.mockResolvedValue(JSON.stringify({ intent: 'NEW_BOOKING', service: 'Plumbing', locationHint: 'Kakkanad', confidence: 0.93 }));
    expect(unexplainedWords('plumber at Kakkanad tomorrow')).toEqual(['kakkanad']);

    const result = await understand('plumber at Kakkanad tomorrow');

    expect(result.aiUsed).toBe(true);
    expect(result.locationHint).toBe('Kakkanad');
    expect(messageBudget.get('971500').aiCalls).toBe(1);
  });

  it('asks the model for messages the rules cannot place at all', async () => {
    geminiProvider.callGemini.mockResolvedValue(JSON.stringify({ intent: 'GENERAL_QUERY', confidence: 0.9 }));
    const result = await understand('do your people wear uniforms');
    expect(result.aiUsed).toBe(true);
    expect(result.intent).toBe('GENERAL_QUERY');
  });

  it('does not call the model for an ambiguous service; the customer is asked instead', async () => {
    const result = await understand('clean the ac');
    expect(result.aiUsed).toBe(false);
    expect(result.ambiguousService).toBe(true);
    expect(result.serviceCandidates).toEqual(['AC Service & Repair', 'Cleaning']);
  });
});

describe('model fallback for difficult cases', () => {
  const original = process.env.GEMINI_FALLBACK_MODEL;

  beforeEach(() => {
    geminiProvider.callGemini.mockReset();
    process.env.GEMINI_FALLBACK_MODEL = 'gemini-fallback-test';
  });

  afterEach(() => {
    if (original === undefined) delete process.env.GEMINI_FALLBACK_MODEL;
    else process.env.GEMINI_FALLBACK_MODEL = original;
  });

  it('retries an unparseable answer once, then uses the fallback model', async () => {
    geminiProvider.callGemini
      .mockResolvedValueOnce('not json')
      .mockResolvedValueOnce('still not json')
      .mockResolvedValueOnce(JSON.stringify({ intent: 'COMPLAINT', confidence: 0.9 }));

    const result = await intentService.detectIntent('the man you sent was impolite and left mud');

    expect(result).toMatchObject({ intent: 'COMPLAINT', model: 'gemini-fallback-test' });
    expect(geminiProvider.callGemini).toHaveBeenCalledTimes(3);
    expect(geminiProvider.callGemini.mock.calls[2][1]).toEqual({ model: 'gemini-fallback-test' });
  });

  it('uses the fallback model for a very low-confidence answer and keeps the better one', async () => {
    geminiProvider.callGemini
      .mockResolvedValueOnce(JSON.stringify({ intent: 'UNKNOWN', confidence: 0.1 }))
      .mockResolvedValueOnce(JSON.stringify({ intent: 'NEW_BOOKING', confidence: 0.8 }));
    const result = await intentService.detectIntent('vague message');
    expect(result.intent).toBe('NEW_BOOKING');
  });

  it('never pays twice for a confident primary answer', async () => {
    geminiProvider.callGemini.mockResolvedValueOnce(JSON.stringify({ intent: 'NEW_BOOKING', confidence: 0.92 }));
    await intentService.detectIntent('book a deep clean for my villa');
    expect(geminiProvider.callGemini).toHaveBeenCalledTimes(1);
  });

  it('is off when no fallback model is configured', async () => {
    delete process.env.GEMINI_FALLBACK_MODEL;
    geminiProvider.callGemini.mockRejectedValueOnce(new Error('primary down'));
    const result = await intentService.detectIntent('anything');
    expect(result.intent).toBe('UNKNOWN');
    expect(geminiProvider.callGemini).toHaveBeenCalledTimes(1);
  });
});

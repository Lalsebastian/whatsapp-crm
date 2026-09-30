import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = require('../../db/supabaseClient');
db.get = vi.fn();
const sessionStore = require('../../session/sessionStore');
sessionStore.setHumanTakeover = vi.fn();
const intentService = require('../../ai/intentService');
intentService.summarizeHandoff = vi.fn();

const {
  evaluateTriggers,
  triggerEscalation,
  buildHandoff,
  priorityFor,
  safetyGuidanceFor,
  HISTORY_LIMIT,
} = require('../../escalation/escalationService');

beforeEach(() => {
  db.get.mockReset().mockResolvedValue([]);
  sessionStore.setHumanTakeover.mockReset().mockResolvedValue({});
  intentService.summarizeHandoff.mockReset().mockResolvedValue(null);
});

describe('evaluateTriggers', () => {
  it('escalates on explicit HUMAN_AGENT intent', () => {
    expect(evaluateTriggers({ intent: 'HUMAN_AGENT' })).toEqual({ escalate: true, reason: 'explicit_human_request' });
  });

  it('escalates on property_damage complaint category', () => {
    const result = evaluateTriggers({ category: 'property_damage' });
    expect(result).toEqual({ escalate: true, reason: 'property_damage' });
  });

  it('escalates on payment_issue complaint category', () => {
    expect(evaluateTriggers({ category: 'payment_issue' }).reason).toBe('payment_dispute');
  });

  it('escalates technician behaviour and repeat-service complaints', () => {
    expect(evaluateTriggers({ category: 'technician_behaviour' }).reason).toBe('technician_behaviour');
    expect(evaluateTriggers({ category: 'problem_returned' }).reason).toBe('repeat_service_failure');
  });

  it('escalates on safety keywords in free text', () => {
    expect(evaluateTriggers({ text: 'I feel unsafe with this technician in my house' }).reason).toBe('safety_concern');
  });

  it('escalates on payment dispute keywords in free text', () => {
    expect(evaluateTriggers({ text: 'I want a refund, this feels like a scam' }).reason).toBe('payment_dispute');
  });

  it('escalates on property damage keywords in free text', () => {
    expect(evaluateTriggers({ text: 'the technician broke my window' }).reason).toBe('property_damage');
  });

  it('escalates on repeated unresolved complaints', () => {
    expect(evaluateTriggers({ repeatedComplaintCount: 3 }).reason).toBe('repeated_unresolved_complaint');
  });

  it('does NOT escalate a single low-confidence message, even with a determined intent', () => {
    // A single so-so confidence score from the AI on an otherwise-clear
    // message shouldn't permanently silence the bot — only repeated
    // struggling (see the streak tests below) should.
    expect(evaluateTriggers({ intent: 'NEW_BOOKING', confidence: 0.2, struggleStreak: 1 }).escalate).toBe(false);
  });

  it('escalates once low-confidence responses repeat past the streak threshold', () => {
    expect(evaluateTriggers({ intent: 'NEW_BOOKING', confidence: 0.2, struggleStreak: 3 }).reason).toBe('intent_undetermined');
  });

  it('escalates once UNKNOWN intent repeats past the streak threshold', () => {
    expect(evaluateTriggers({ intent: 'UNKNOWN', struggleStreak: 3 }).reason).toBe('intent_undetermined');
  });

  it('does NOT escalate a single UNKNOWN intent', () => {
    expect(evaluateTriggers({ intent: 'UNKNOWN', struggleStreak: 1 }).escalate).toBe(false);
  });

  it('does NOT escalate a normal, confident booking message', () => {
    expect(evaluateTriggers({ text: 'I need AC service tomorrow', intent: 'NEW_BOOKING', confidence: 0.9 }).escalate).toBe(false);
    expect(evaluateTriggers({ text: 'My AC is broken', intent: 'NEW_BOOKING', confidence: 0.9 }).escalate).toBe(false);
  });

  it('assigns deterministic priority and provides safe urgent guidance', () => {
    expect(priorityFor('explicit_human_request')).toBe('NORMAL');
    expect(priorityFor('payment_dispute')).toBe('HIGH');
    expect(priorityFor('electrical_safety_concern')).toBe('URGENT');
    expect(evaluateTriggers({ text: 'There is a burning smell and smoke from the socket' }).reason).toBe('electrical_safety_concern');
    expect(safetyGuidanceFor('There is a burning smell from the socket')).toContain('avoid using');
  });

  it('builds a factual booking handoff with voice/media and bounded recent history', async () => {
    db.get.mockResolvedValue(Array.from({ length: 12 }, (_, index) => ({
      direction: index % 2 ? 'outbound' : 'inbound',
      type: 'text',
      content: `message-${index}`,
      created_at: `2026-09-30T00:00:${String(index).padStart(2, '0')}Z`,
    })));
    intentService.summarizeHandoff.mockResolvedValue('Customer needs electrical service and supplied a voice note.');

    const handoff = await buildHandoff({
      phone: '971500',
      customerId: 'cust1',
      customer: { id: 'cust1', name: 'Asha' },
      reason: 'explicit_human_request',
      originalCustomerMessage: 'Please let me talk to a person',
      session: {
        currentFlow: 'booking', currentStep: 'select_slot', preferredLanguage: 'manglish',
        context: {
          serviceId: 'svc-electrical', serviceName: 'Electrical', propertyLabel: 'Home — Kakkanad',
          date: '2026-10-01', preferredTime: 'evening', issue: 'socket not working',
          attachments: [
            { waMediaId: 'voice-1', mediaType: 'audio' },
            { waMediaId: 'image-1', mediaType: 'image' },
          ],
          voiceNotes: [{ mediaId: 'voice-1', transcript: 'socket work aakunnilla', detectedLanguage: 'ml-Latn', confidence: 0.94 }],
        },
      },
    });

    expect(handoff.customer).toEqual({ id: 'cust1', name: 'Asha', phone: '971500' });
    expect(handoff.context).toMatchObject({ flow: 'booking', step: 'select_slot', preferredLanguage: 'manglish' });
    expect(handoff.booking).toMatchObject({ service: 'Electrical', property: 'Home — Kakkanad', date: '2026-10-01' });
    expect(handoff.issue).toMatchObject({
      originalCustomerMessage: 'Please let me talk to a person',
      summary: 'Customer needs electrical service and supplied a voice note.',
      urgency: 'NORMAL',
    });
    expect(handoff.media).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'audio', mediaId: 'voice-1', transcript: 'socket work aakunnilla',
        detectedLanguage: 'ml-Latn', transcriptionConfidence: 0.94,
      }),
      { type: 'image', mediaId: 'image-1' },
    ]));
    expect(handoff.recentMessages).toHaveLength(HISTORY_LIMIT);
  });

  it('uses a deterministic summary when AI summarization fails', async () => {
    intentService.summarizeHandoff.mockResolvedValue(null);
    const handoff = await buildHandoff({
      phone: '971500', customerId: 'cust1', reason: 'payment_dispute',
      originalCustomerMessage: 'I was charged twice',
      session: { currentFlow: 'complaint', currentStep: 'confirm', context: { category: 'payment_issue' } },
    });
    expect(handoff.issue.summary).toContain('I was charged twice');
    expect(handoff.issue.summary).toContain('payment_dispute');
    expect(handoff.issue.urgency).toBe('HIGH');
  });

  it('sets takeover only after the CRM handoff succeeds', async () => {
    const crm = { escalateToHuman: vi.fn().mockResolvedValue({ id: 'handoff-1' }) };
    const result = await triggerEscalation({
      crm, phone: '971500', customerId: 'cust1', reason: 'property_damage',
      originalCustomerMessage: 'The technician damaged my wall',
      session: { currentFlow: 'complaint', currentStep: 'confirm', context: { category: 'property_damage' } },
    });
    expect(crm.escalateToHuman).toHaveBeenCalledWith(expect.objectContaining({
      reason: 'property_damage',
      handoff: expect.objectContaining({ complaint: expect.objectContaining({ category: 'property_damage' }) }),
    }));
    expect(sessionStore.setHumanTakeover).toHaveBeenCalledWith('971500', true);
    expect(result.priority).toBe('HIGH');
  });

  it('does not set takeover when CRM handoff creation fails', async () => {
    const crm = { escalateToHuman: vi.fn().mockRejectedValue(new Error('CRM unavailable')) };
    await expect(triggerEscalation({
      crm, phone: '971500', customerId: 'cust1', reason: 'explicit_human_request', session: { context: {} },
    })).rejects.toThrow('CRM unavailable');
    expect(sessionStore.setHumanTakeover).not.toHaveBeenCalled();
  });
});

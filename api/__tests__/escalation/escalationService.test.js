import { describe, it, expect } from 'vitest';
import { evaluateTriggers } from '../../escalation/escalationService';

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

  it('escalates on low AI confidence for a determined (non-UNKNOWN) intent', () => {
    expect(evaluateTriggers({ intent: 'NEW_BOOKING', confidence: 0.2 }).reason).toBe('low_ai_confidence');
  });

  it('escalates once UNKNOWN intent repeats past the streak threshold', () => {
    expect(evaluateTriggers({ intent: 'UNKNOWN', unknownStreak: 3 }).reason).toBe('intent_undetermined');
  });

  it('does NOT escalate a single UNKNOWN intent', () => {
    expect(evaluateTriggers({ intent: 'UNKNOWN', unknownStreak: 1 }).escalate).toBe(false);
  });

  it('does NOT escalate a normal, confident booking message', () => {
    expect(evaluateTriggers({ text: 'I need AC service tomorrow', intent: 'NEW_BOOKING', confidence: 0.9 }).escalate).toBe(false);
  });
});

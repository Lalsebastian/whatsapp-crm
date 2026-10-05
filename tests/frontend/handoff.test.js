import { describe, it, expect } from 'vitest';
import { formatWaiting, parseHandoff, waitingMinutes, whatsappReplyLink } from '@/lib/handoff';

describe('handoff parsing', () => {
  it('keeps a plain summary as is', () => {
    expect(parseHandoff('Customer asked for a human')).toEqual({ summary: 'Customer asked for a human', handoff: null, assist: null });
    expect(parseHandoff(null)).toEqual({ summary: null, handoff: null, assist: null });
  });

  it('splits the structured handoff and prefers the assist summary', () => {
    const text = `Staff note\n\nStructured handoff:\n${JSON.stringify({ assist: { summary: 'Short AI summary', suggestedReply: 'Hi' } })}`;
    expect(parseHandoff(text)).toMatchObject({ summary: 'Short AI summary', assist: { suggestedReply: 'Hi' } });
  });

  it('falls back to the next action for older handoffs, and survives broken JSON', () => {
    const older = `Note\n\nStructured handoff:\n${JSON.stringify({ suggestedNextAction: 'Call back' })}`;
    expect(parseHandoff(older).assist).toEqual({ recommendedNextAction: 'Call back' });
    expect(parseHandoff('Note\n\nStructured handoff:\n{broken')).toEqual({ summary: 'Note', handoff: null, assist: null });
  });
});

describe('reply link and waiting time', () => {
  it('builds a click-to-chat link with the reply prefilled', () => {
    expect(whatsappReplyLink('+971 50 123 4567', 'Hi & welcome')).toBe('https://wa.me/971501234567?text=Hi%20%26%20welcome');
    expect(whatsappReplyLink('', 'x')).toBeNull();
  });

  it('formats how long the customer has waited', () => {
    const now = Date.parse('2031-01-01T12:00:00Z');
    expect(waitingMinutes('2031-01-01T11:15:00Z', now)).toBe(45);
    expect(waitingMinutes('not a date', now)).toBeNull();
    expect(formatWaiting(45)).toBe('45 min');
    expect(formatWaiting(135)).toBe('2 h 15 min');
    expect(formatWaiting(3000)).toBe('2 d');
    expect(formatWaiting(null)).toBe('—');
  });
});

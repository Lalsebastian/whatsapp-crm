import { describe, it, expect, vi, beforeEach } from 'vitest';

const whatsapp = require('../../whatsapp/client');
whatsapp.sendText = vi.fn();

const escalationService = require('../../escalation/escalationService');
escalationService.triggerEscalation = vi.fn();

const support = require('../../flows/support');

describe('professional human support handoff', () => {
  beforeEach(() => {
    whatsapp.sendText.mockReset();
    escalationService.triggerEscalation.mockReset();
  });

  it('passes the existing session context and confirms a successful handoff truthfully', async () => {
    escalationService.triggerEscalation.mockResolvedValue({ priority: 'NORMAL', reason: 'explicit_human_request' });
    const session = {
      phone: '971500', currentFlow: 'booking', currentStep: 'select_date', preferredLanguage: 'en',
      context: { serviceName: 'Electrical', propertyLabel: 'Home', date: '2026-10-01' },
    };
    const customer = { id: 'cust1', name: 'Asha' };

    const result = await support.startSupport(session, customer, { text: 'I want to talk to a human' });

    expect(escalationService.triggerEscalation).toHaveBeenCalledWith(expect.objectContaining({
      customer,
      session,
      originalCustomerMessage: 'I want to talk to a human',
      reason: 'explicit_human_request',
    }));
    expect(whatsapp.sendText).toHaveBeenCalledWith(
      '971500',
      expect.stringContaining("you won't need to explain everything again")
    );
    expect(result).toEqual({ handoff: true, priority: 'NORMAL', reason: 'explicit_human_request' });
  });

  it('does not claim success when handoff creation fails', async () => {
    escalationService.triggerEscalation.mockRejectedValue(new Error('CRM unavailable'));
    const result = await support.startSupport(
      { phone: '971500', currentFlow: 'complaint', currentStep: 'confirm', context: { category: 'payment_issue' } },
      { id: 'cust1' },
      { text: 'agent please' }
    );

    const message = whatsapp.sendText.mock.calls.at(-1)[1];
    expect(message).toContain("wasn't able to connect");
    expect(message).not.toContain("I've shared");
    expect(result.handoff).toBe(false);
  });
});

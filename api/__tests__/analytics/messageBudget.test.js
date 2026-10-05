import { beforeEach, describe, expect, it } from 'vitest';

const messageBudget = require('../../analytics/messageBudget');
const costs = require('../../config/costs');

describe('booking message budget', () => {
  beforeEach(() => messageBudget.reset());

  it('counts customer and bot messages and clears the completed journey', () => {
    messageBudget.start('971500', { fieldsExtracted: ['service', 'date', 'date'] });
    messageBudget.botMessage('971500');
    messageBudget.customerMessage('971500');
    messageBudget.botMessage('971500');
    messageBudget.avoidQuestion('971500', 2);
    messageBudget.markFastPath('971500');

    expect(messageBudget.complete('971500')).toEqual({
      customerMessages: 2,
      botMessages: 2,
      templateMessages: 0,
      fieldsExtractedFirstMessage: 2,
      redundantQuestionsAvoided: 2,
      aiCalls: 0,
      aiCallsAvoided: 0,
      fastPathUsed: true,
      estimatedCost: 0,
      currency: costs.CURRENCY,
    });
    expect(messageBudget.get('971500')).toMatchObject({ customerMessages: 0, botMessages: 0, fastPathUsed: false });
  });

  it('charges the AI call that recognised the request to the flow it started', () => {
    messageBudget.aiCall('971500');
    messageBudget.aiAvoided('971500');
    messageBudget.start('971500');
    messageBudget.aiAvoided('971500');

    expect(messageBudget.get('971500')).toMatchObject({ aiCalls: 1, aiCallsAvoided: 2, customerMessages: 1 });
  });

  it('estimates cost from AI calls and template messages, not free session replies', () => {
    messageBudget.start('971500');
    messageBudget.aiCall('971500');
    messageBudget.aiCall('971500');
    messageBudget.botMessage('971500', 'template');
    messageBudget.botMessage('971500', 'buttons');

    const result = messageBudget.complete('971500');
    expect(result.templateMessages).toBe(1);
    expect(result.estimatedCost).toBeCloseTo(2 * costs.AI_CALL + costs.TEMPLATE_MESSAGE + costs.SESSION_MESSAGE, 6);
  });

  it('ignores calls without a phone (system work outside a conversation)', () => {
    expect(messageBudget.aiCall(undefined)).toBeNull();
  });
});

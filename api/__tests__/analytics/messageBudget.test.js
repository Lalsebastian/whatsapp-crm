import { beforeEach, describe, expect, it } from 'vitest';

const messageBudget = require('../../analytics/messageBudget');

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
      fieldsExtractedFirstMessage: 2,
      redundantQuestionsAvoided: 2,
      fastPathUsed: true,
    });
    expect(messageBudget.get('971500')).toEqual({
      customerMessages: 0,
      botMessages: 0,
      fieldsExtractedFirstMessage: 0,
      redundantQuestionsAvoided: 0,
      fastPathUsed: false,
    });
  });
});

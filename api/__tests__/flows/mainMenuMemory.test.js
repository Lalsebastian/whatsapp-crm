import { beforeEach, describe, expect, it, vi } from 'vitest';

const whatsapp = require('../../whatsapp/client');
whatsapp.sendButtons = vi.fn();
const sessionStore = require('../../session/sessionStore');
sessionStore.clearFlow = vi.fn();
const mainMenu = require('../../flows/mainMenu');

describe('returning customer greeting', () => {
  beforeEach(() => {
    whatsapp.sendButtons.mockReset();
    sessionStore.clearFlow.mockReset();
  });

  it('uses a verified returning customer name', async () => {
    await mainMenu.sendMainMenu(
      { phone: '971500' },
      { profile: { returningCustomer: true, name: 'John' } }
    );
    expect(whatsapp.sendButtons).toHaveBeenCalledWith(
      '971500', expect.stringContaining('Hello John 👋 Welcome back'), expect.any(Array)
    );
  });

  it('keeps the generic greeting for a new customer', async () => {
    await mainMenu.sendMainMenu(
      { phone: '971500' },
      { profile: { returningCustomer: false, name: 'John' } }
    );
    expect(whatsapp.sendButtons).toHaveBeenCalledWith(
      '971500', expect.not.stringContaining('John'), expect.any(Array)
    );
  });
});

const whatsapp = require('../whatsapp/client');
const sessionStore = require('../session/sessionStore');
const { getCrmAdapter } = require('../crm');

const crm = getCrmAdapter();

async function showServiceInfo(session) {
  const services = await crm.getServices();
  await sessionStore.clearFlow(session.phone);

  if (!services || services.length === 0) {
    await whatsapp.sendText(session.phone, 'I\'m sorry, service information is temporarily unavailable. Please try again shortly.');
    return;
  }

  const lines = services.map((s) => {
    const price = s.basePrice ? `AED ${s.basePrice}` : 'Pricing available on request';
    const duration = s.durationMinutes ? ` · Approx. ${s.durationMinutes} minutes` : '';
    return `• *${s.name}* — ${price}${duration}`;
  });

  await whatsapp.sendButtons(session.phone, `🔧 *Our Available Services*\n\n${lines.join('\n')}`, [
    { id: 'BOOK_SERVICE', title: 'Book a Service' },
    { id: 'MAIN_MENU', title: 'Main Menu' },
  ]);
}

module.exports = { showServiceInfo, steps: {} };

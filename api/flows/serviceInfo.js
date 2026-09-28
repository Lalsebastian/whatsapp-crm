const whatsapp = require('../whatsapp/client');
const sessionStore = require('../session/sessionStore');
const { getCrmAdapter } = require('../crm');

const crm = getCrmAdapter();

async function showServiceInfo(session) {
  const services = await crm.getServices();
  await sessionStore.clearFlow(session.phone);

  if (!services || services.length === 0) {
    await whatsapp.sendText(session.phone, 'Service information is unavailable right now — please try again shortly.');
    return;
  }

  const lines = services.map((s) => {
    const price = s.basePrice ? `AED ${s.basePrice}` : 'Price on request';
    const duration = s.durationMinutes ? ` · ~${s.durationMinutes} mins` : '';
    return `• *${s.name}* — ${price}${duration}`;
  });

  await whatsapp.sendButtons(session.phone, `🔧 *Our Services:*\n\n${lines.join('\n')}`, [
    { id: 'BOOK_SERVICE', title: 'Book Now' },
    { id: 'MAIN_MENU', title: 'Main Menu' },
  ]);
}

module.exports = { showServiceInfo, steps: {} };

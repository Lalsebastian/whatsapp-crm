const axios = require('axios');

const PHONE_NUMBER_ID = '1026663817198120';
const TOKEN = process.env.WHATSAPP_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

async function handler(req, res) {
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    console.log(`[WEBHOOK] Verification request — mode: ${mode}, token_match: ${token === VERIFY_TOKEN}`);
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      console.log('[WEBHOOK] Verification successful');
      return res.status(200).send(challenge);
    }
    console.warn('[WEBHOOK] Verification FAILED — token mismatch or wrong mode');
    return res.status(403).end();
  }
  if (req.method === 'POST') {
    res.status(200).end();
    (async () => {
      try {
        console.log('[WEBHOOK] Incoming POST body:', JSON.stringify(req.body, null, 2));
        const value = req.body && req.body.entry && req.body.entry[0] && req.body.entry[0].changes && req.body.entry[0].changes[0] && req.body.entry[0].changes[0].value;
        if (!value || !value.messages || !value.messages[0]) {
          console.log('[WEBHOOK] No message in payload — ignoring (could be status update)');
          return;
        }
        const msg = value.messages[0];
        const from = msg.from;
        console.log(`[MSG] From: ${from} | Type: ${msg.type}`);
        const session = await getSession(from);
        console.log(`[SESSION] Phone: ${from} | State: ${session.state} | Data: ${JSON.stringify(session.data)}`);
        if (msg.type === 'interactive') {
          const buttonId = msg.interactive && msg.interactive.button_reply && msg.interactive.button_reply.id;
          console.log(`[BUTTON] From: ${from} | Button ID: ${buttonId}`);
          await handleButton(from, buttonId, session);
        } else if (msg.type === 'text') {
          const text = msg.text.body.trim();
          console.log(`[TEXT] From: ${from} | Text: "${text}"`);
          await handleText(from, text, session);
        } else {
          console.log(`[MSG] Unsupported message type: ${msg.type} — ignoring`);
        }
      } catch (err) {
        console.error('[BOT ERROR]', err.message, err.stack);
      }
    })();
  }
}

async function getSession(phone) {
  const res = await axios.get(
    SUPABASE_URL + '/rest/v1/sessions?phone=eq.' + phone + '&select=*',
    { headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY } }
  );
  if (res.data && res.data.length > 0) {
    console.log(`[SESSION] Loaded existing session for ${phone}: state=${res.data[0].state}`);
    return res.data[0];
  }
  console.log(`[SESSION] No session found for ${phone} — starting fresh (IDLE)`);
  return { phone: phone, state: 'IDLE', data: {} };
}

async function setState(phone, state, data) {
  if (!data) data = {};
  console.log(`[STATE] ${phone} → ${state} | data: ${JSON.stringify(data)}`);
  await axios.post(
    SUPABASE_URL + '/rest/v1/sessions',
    { phone: phone, state: state, data: data, updated_at: new Date().toISOString() },
    {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: 'Bearer ' + SUPABASE_KEY,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates',
      }
    }
  );
}

async function saveLead(leadData) {
  console.log(`[LEAD] Saving lead: ${JSON.stringify(leadData)}`);
  await axios.post(
    SUPABASE_URL + '/rest/v1/leads',
    leadData,
    {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: 'Bearer ' + SUPABASE_KEY,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal'
      }
    }
  );
}

async function handleButton(from, id, session) {
  if (id === 'RESTAURANT')    return startRestaurant(from);
  if (id === 'HOME_SERVICES') return startHomeServices(from);
  if (id === 'SALON')         return startSalon(from);
  if (id === 'REAL_ESTATE')   return startRealEstate(from);
  if (id === 'REST_MENU')     return sendRestaurantMenu(from);
  if (id === 'REST_BOOK')     return startRestaurantBooking(from);
  if (id === 'REST_CONTACT')  return sendRestaurantContact(from);
  if (id === 'HOME_PLUMBING')   return sendServiceInfo(from, 'Plumbing', '500-2000', 'HOME_BOOK_PLUMBING');
  if (id === 'HOME_ELECTRICAL') return sendServiceInfo(from, 'Electrical', '800-3000', 'HOME_BOOK_ELECTRICAL');
  if (id === 'HOME_CLEANING')   return sendServiceInfo(from, 'Cleaning', '1200-4000', 'HOME_BOOK_CLEANING');
  if (id && id.startsWith('HOME_BOOK')) return startHomeBooking(from, id);
  if (id === 'SALON_HAIRCUT') return sendSalonInfo(from, 'Haircut', '300', '45 mins');
  if (id === 'SALON_FACIAL')  return sendSalonInfo(from, 'Facial', '800', '60 mins');
  if (id === 'SALON_NAILS')   return sendSalonInfo(from, 'Nails', '400', '30 mins');
  if (id === 'SALON_BOOK')    return startSalonBooking(from, session.data && session.data.service);
  if (id === 'RE_BUY')    return startRealEstateLead(from, 'Buy');
  if (id === 'RE_RENT')   return startRealEstateLead(from, 'Rent');
  if (id === 'RE_SELL')   return startRealEstateLead(from, 'Sell');
  if (id === 'RE_YES')    return askRealEstateDetails(from, session);
  if (id === 'RE_NO')     return sendText(from, 'No problem! Type menu anytime.');
  if (id === 'MAIN_MENU') return sendMainMenu(from);
}

async function handleText(from, text, session) {
  const cmd = text.toLowerCase();
  if (cmd.includes('restaurant')) return startRestaurant(from);
  if (cmd.includes('salon')) return startSalon(from);
  if (cmd.includes('real estate')) return startRealEstate(from);
  if (cmd.includes('service') || cmd.includes('home')) return startHomeServices(from);
  return sendMainMenu(from);
}

async function sendText(from, body) {
  console.log(`[SEND TEXT] To: ${from} | Message: "${body.substring(0, 80)}${body.length > 80 ? '...' : ''}"`);
  return axios.post(
    `https://graph.instagram.com/v18.0/${PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: 'whatsapp',
      to: from,
      type: 'text',
      text: { body: body }
    },
    { headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' } }
  );
}

async function sendButtons(from, body, buttons) {
  console.log(`[SEND BUTTONS] To: ${from} | Buttons: [${buttons.map(b => b.reply.id).join(', ')}]`);
  return axios.post(
    `https://graph.instagram.com/v18.0/${PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: 'whatsapp',
      to: from,
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: body },
        action: {
          buttons: buttons
        }
      }
    },
    { headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' } }
  );
}

async function sendMainMenu(from) {
  await setState(from, 'MENU', {});
  return sendButtons(from, '👋 Welcome to our WhatsApp CRM! Select a category:', [
    { type: 'reply', reply: { id: 'RESTAURANT', title: '🍽️ Restaurants' } },
    { type: 'reply', reply: { id: 'HOME_SERVICES', title: '🔧 Services' } },
    { type: 'reply', reply: { id: 'SALON', title: '💅 Salon' } },
    { type: 'reply', reply: { id: 'REAL_ESTATE', title: '🏠 Real Estate' } }
  ]);
}

async function startRestaurant(from) {
  await setState(from, 'RESTAURANT', {});
  return sendButtons(from, '🍽️ Restaurant Services:', [
    { type: 'reply', reply: { id: 'REST_MENU', title: '📋 View Menu' } },
    { type: 'reply', reply: { id: 'REST_BOOK', title: '📅 Book Table' } },
    { type: 'reply', reply: { id: 'REST_CONTACT', title: '📞 Contact Info' } },
    { type: 'reply', reply: { id: 'MAIN_MENU', title: '↩️ Main Menu' } }
  ]);
}

async function startHomeServices(from) {
  await setState(from, 'HOME_SERVICES', {});
  return sendButtons(from, '🔧 Home Services:', [
    { type: 'reply', reply: { id: 'HOME_PLUMBING', title: '🚰 Plumbing' } },
    { type: 'reply', reply: { id: 'HOME_ELECTRICAL', title: '⚡ Electrical' } },
    { type: 'reply', reply: { id: 'HOME_CLEANING', title: '🧹 Cleaning' } },
    { type: 'reply', reply: { id: 'MAIN_MENU', title: '↩️ Main Menu' } }
  ]);
}

async function startSalon(from) {
  await setState(from, 'SALON', {});
  return sendButtons(from, '💅 Salon Services:', [
    { type: 'reply', reply: { id: 'SALON_HAIRCUT', title: '✂️ Haircut' } },
    { type: 'reply', reply: { id: 'SALON_FACIAL', title: '💆 Facial' } },
    { type: 'reply', reply: { id: 'SALON_NAILS', title: '💅 Nails' } },
    { type: 'reply', reply: { id: 'MAIN_MENU', title: '↩️ Main Menu' } }
  ]);
}

async function startRealEstate(from) {
  await setState(from, 'REAL_ESTATE', {});
  return sendButtons(from, '🏠 Real Estate Services:', [
    { type: 'reply', reply: { id: 'RE_BUY', title: '🛒 Buy' } },
    { type: 'reply', reply: { id: 'RE_RENT', title: '🔑 Rent' } },
    { type: 'reply', reply: { id: 'RE_SELL', title: '💰 Sell' } },
    { type: 'reply', reply: { id: 'MAIN_MENU', title: '↩️ Main Menu' } }
  ]);
}

async function sendRestaurantMenu(from) {
  return sendText(from, '📋 Restaurant Menu:\n\n🥘 Appetizers: 50-150 AED\n🍝 Main Courses: 80-250 AED\n🍰 Desserts: 30-80 AED\n🥤 Beverages: 15-50 AED\n\nReply MAIN_MENU to go back');
}

async function sendRestaurantContact(from) {
  return sendText(from, '📞 Restaurant Contact Info:\n\n📍 Location: Downtown Dubai\n☎️ Phone: +971-4-123-4567\n⏰ Hours: 11 AM - 11 PM Daily\n🌐 Website: www.restaurant.ae\n\nReply MAIN_MENU to go back');
}

async function startRestaurantBooking(from) {
  await setState(from, 'RESTAURANT_BOOKING', { started: true });
  return sendText(from, '📅 Restaurant Booking\n\nPlease reply with:\n- Number of guests\n- Preferred date (DD/MM/YYYY)\n- Preferred time (HH:MM)');
}

async function sendServiceInfo(from, service, price, bookAction) {
  await setState(from, 'SERVICE_INFO', { service: service });
  return sendButtons(from, `${service} Service:\n\n💰 Price Range: ${price} AED\n⏱️ Duration: 1-2 hours\n\nWould you like to book?`, [
    { type: 'reply', reply: { id: bookAction, title: '✓ Book Now' } },
    { type: 'reply', reply: { id: 'HOME_SERVICES', title: '↩️ Back' } }
  ]);
}

async function startHomeBooking(from, service) {
  const services = {
    'HOME_BOOK_PLUMBING': 'Plumbing',
    'HOME_BOOK_ELECTRICAL': 'Electrical',
    'HOME_BOOK_CLEANING': 'Cleaning'
  };
  await setState(from, 'HOME_BOOKING', { service: services[service] });
  return sendText(from, `📅 ${services[service]} Service Booking\n\nPlease reply with your preferred date and time (DD/MM/YYYY HH:MM)`);
}

async function sendSalonInfo(from, service, price, duration) {
  await setState(from, 'SALON_INFO', { service: service });
  return sendButtons(from, `${service}\n\n💰 Price: ${price} AED\n⏱️ Duration: ${duration}\n\nBook now?`, [
    { type: 'reply', reply: { id: 'SALON_BOOK', title: '✓ Book' } },
    { type: 'reply', reply: { id: 'SALON', title: '↩️ Back' } }
  ]);
}

async function startSalonBooking(from, service) {
  await setState(from, 'SALON_BOOKING', { service: service });
  return sendText(from, `💅 Booking ${service}\n\nPlease reply with preferred date and time (DD/MM/YYYY HH:MM)`);
}

async function startRealEstateLead(from, type) {
  await setState(from, 'REAL_ESTATE_LEAD', { type: type });
  return sendButtons(from, `Are you looking to ${type.toLowerCase()}?`, [
    { type: 'reply', reply: { id: 'RE_YES', title: '✓ Yes' } },
    { type: 'reply', reply: { id: 'RE_NO', title: '✗ No' } }
  ]);
}

async function askRealEstateDetails(from, session) {
  await saveLead({
    name: 'WhatsApp Lead',
    phone: from,
    business_type: 'Real Estate',
    service_type: session.data.type,
    created_at: new Date().toISOString()
  });
  return sendText(from, `✓ Thank you! We're interested in helping you ${session.data.type.toLowerCase()}.\n\nOur team will contact you shortly to discuss your requirements.\n\n🙏 Appreciate your interest!`);
}

module.exports = handler;

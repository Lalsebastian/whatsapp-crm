import express from 'express';
import axios from 'axios';
import * as dotenv from 'dotenv';
dotenv.config();

const app = express();
app.use(express.json());

const PHONE_NUMBER_ID = '1026663817198120';
const TOKEN = process.env.WHATSAPP_TOKEN;
const SUPABASE_URL = 'https://faadfckdtjkqeqfhtcgi.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZhYWRmY2tkdGprcWVxZmh0Y2dpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM0NjUzNDUsImV4cCI6MjA4OTA0MTM0NX0.LypDChCOPsF9W3C5WIM99Yfsz2Gj8_DZ9vVQehE03tk';
const VERIFY_TOKEN = 'chatbot_demo';

// ─── Webhook verification ──────────────────────────────────────────────────
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('Webhook verified');
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// ─── Webhook receiver ──────────────────────────────────────────────────────
app.post('/webhook', async (req, res) => {
  res.sendStatus(200);
  try {
    const value = req.body?.entry?.[0]?.changes?.[0]?.value;
    if (!value?.messages?.[0]) return;

    const msg = value.messages[0];
    const from = msg.from;
    const session = await getSession(from);

    if (msg.type === 'interactive') {
      const id = msg.interactive?.button_reply?.id;
      await handleButton(from, id, session);
    } else if (msg.type === 'text') {
      await handleText(from, msg.text.body.trim(), session);
    }
  } catch (err) {
    console.error('Error:', err.message);
  }
});

// ─── Supabase session helpers ──────────────────────────────────────────────
async function getSession(phone) {
  const res = await axios.get(
    `${SUPABASE_URL}/rest/v1/sessions?phone=eq.${phone}&select=*`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
  );
  if (res.data?.length > 0) return res.data[0];
  return { phone, state: 'IDLE', data: {} };
}

async function setState(phone, state, data = {}) {
  await axios.post(
    `${SUPABASE_URL}/rest/v1/sessions`,
    { phone, state, data, updated_at: new Date().toISOString() },
    {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates',
      }
    }
  );
}

// ─── Save lead ─────────────────────────────────────────────────────────────
async function saveLead(leadData) {
  await axios.post(
    `${SUPABASE_URL}/rest/v1/leads`,
    leadData,
    {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal'
      }
    }
  );
}

// ─── Button router ─────────────────────────────────────────────────────────
async function handleButton(from, id, session) {
  if (id === 'RESTAURANT')    return startRestaurant(from);
  if (id === 'HOME_SERVICES') return startHomeServices(from);
  if (id === 'SALON')         return startSalon(from);
  if (id === 'REAL_ESTATE')   return startRealEstate(from);

  if (id === 'REST_MENU')     return sendRestaurantMenu(from);
  if (id === 'REST_BOOK')     return startRestaurantBooking(from);
  if (id === 'REST_CONTACT')  return sendRestaurantContact(from);

  if (id === 'HOME_PLUMBING')     return sendServiceInfo(from, 'Plumbing', '₹500–₹2000', 'HOME_BOOK_PLUMBING');
  if (id === 'HOME_ELECTRICAL')   return sendServiceInfo(from, 'Electrical', '₹800–₹3000', 'HOME_BOOK_ELECTRICAL');
  if (id === 'HOME_CLEANING')     return sendServiceInfo(from, 'Cleaning', '₹1200–₹4000', 'HOME_BOOK_CLEANING');
  if (id?.startsWith('HOME_BOOK')) return startHomeBooking(from, id);

  if (id === 'SALON_HAIRCUT') return sendSalonInfo(from, 'Haircut', '₹300', '45 mins');
  if (id === 'SALON_FACIAL')  return sendSalonInfo(from, 'Facial', '₹800', '60 mins');
  if (id === 'SALON_NAILS')   return sendSalonInfo(from, 'Nails', '₹400', '30 mins');
  if (id === 'SALON_BOOK')    return startSalonBooking(from, session.data?.service);

  if (id === 'RE_BUY')    return startRealEstateLead(from, 'Buy');
  if (id === 'RE_RENT')   return startRealEstateLead(from, 'Rent');
  if (id === 'RE_SELL')   return startRealEstateLead(from, 'Sell');
  if (id === 'RE_YES')    return askRealEstateDetails(from, session);
  if (id === 'RE_NO')     return sendText(from, '👍 No problem! Type *menu* anytime.');
  if (id === 'MAIN_MENU') return sendMainMenu(from);
}

// ─── Text router ───────────────────────────────────────────────────────────
async function handleText(from, text, session) {
  const lower = text.toLowerCase();
  if (['hi','hello','hey','menu','start','hii'].includes(lower)) {
    return sendMainMenu(from);
  }

  const { state, data } = session;

  if (state === 'AWAIT_REST_NAME') {
    await setState(from, 'AWAIT_REST_DATE', { ...data, name: text });
    return sendText(from, `Great, *${text}*! 📅 What date? (e.g. 15 March)`);
  }
  if (state === 'AWAIT_REST_DATE') {
    await setState(from, 'AWAIT_REST_GUESTS', { ...data, date: text });
    return sendText(from, `👥 How many guests?`);
  }
  if (state === 'AWAIT_REST_GUESTS') {
    const { name, date } = data;
    await setState(from, 'IDLE', {});
    await saveLead({ phone: from, name, business_type: 'RESTAURANT', service: 'Table Booking', booking_date: date, guests: text, status: 'new', raw_data: { name, date, guests: text } });
    return sendText(from, `✅ *Booking Confirmed!*\n\n👤 Name: ${name}\n📅 Date: ${date}\n👥 Guests: ${text}\n\nWe'll confirm shortly! Type *menu* to go back.`);
  }

  if (state === 'AWAIT_HOME_NAME') {
    await setState(from, 'AWAIT_HOME_ADDRESS', { ...data, name: text });
    return sendText(from, `Thanks *${text}*! 📍 Your address?`);
  }
  if (state === 'AWAIT_HOME_ADDRESS') {
    await setState(from, 'AWAIT_HOME_DATE', { ...data, address: text });
    return sendText(from, `📅 Preferred date & time?`);
  }
  if (state === 'AWAIT_HOME_DATE') {
    const { name, address, service } = data;
    await setState(from, 'IDLE', {});
    await saveLead({ phone: from, name, business_type: 'HOME_SERVICES', service, address, booking_date: text, status: 'new', raw_data: { name, address, date: text, service } });
    return sendText(from, `✅ *Service Booked!*\n\n🔧 ${service}\n👤 ${name}\n📍 ${address}\n📅 ${text}\n\nOur team will call to confirm. Type *menu* to go back.`);
  }

  if (state === 'AWAIT_SALON_NAME') {
    await setState(from, 'AWAIT_SALON_DATE', { ...data, name: text });
    return sendText(from, `📅 What date & time works for you?`);
  }
  if (state === 'AWAIT_SALON_DATE') {
    const { name, service } = data;
    await setState(from, 'IDLE', {});
    await saveLead({ phone: from, name, business_type: 'SALON', service, booking_date: text, status: 'new', raw_data: { name, service, date: text } });
    return sendText(from, `✅ *Appointment Booked!*\n\n💅 ${service}\n👤 ${name}\n📅 ${text}\n\nSee you soon! Type *menu* to go back.`);
  }

  if (state === 'AWAIT_RE_NAME') {
    await setState(from, 'AWAIT_RE_BUDGET', { ...data, name: text });
    return sendText(from, `💰 Your budget? (e.g. ₹50–80 lakhs)`);
  }
  if (state === 'AWAIT_RE_BUDGET') {
    await setState(from, 'AWAIT_RE_LOCATION', { ...data, budget: text });
    return sendText(from, `📍 Preferred location?`);
  }
  if (state === 'AWAIT_RE_LOCATION') {
    const { name, budget, intent } = data;
    await setState(from, 'IDLE', {});
    await saveLead({ phone: from, name, business_type: 'REAL_ESTATE', intent, budget, location: text, status: 'new', raw_data: { name, intent, budget, location: text } });
    return sendText(from, `✅ *Lead Captured!*\n\n🏠 ${intent}\n👤 ${name}\n💰 ${budget}\n📍 ${text}\n\nOur agent will reach out shortly! Type *menu* to go back.`);
  }

  return sendMainMenu(from);
}

// ─── Flow functions ────────────────────────────────────────────────────────
async function sendMainMenu(from) {
  await setState(from, 'IDLE', {});
  await sendButtons(from,
    `👋 *Welcome to our Demo Hub!*\n\nSmart WhatsApp automation for businesses.\n\n✨ Choose a demo:`,
    [{ id: 'RESTAURANT', title: '🍽 Restaurant' }, { id: 'HOME_SERVICES', title: '🔧 Home services' }]
  );
  await sendButtons(from, `More options:`,
    [{ id: 'SALON', title: '💅 Salon & beauty' }, { id: 'REAL_ESTATE', title: '🏠 Real estate' }]
  );
}

async function startRestaurant(from) {
  await sendButtons(from,
    `🍽 *Spice Garden Restaurant*\n\nAuthentic Indian cuisine.\n⭐ 4.8 rated | 📍 MG Road, Kozhikode`,
    [{ id: 'REST_MENU', title: '📋 View menu' }, { id: 'REST_BOOK', title: '📅 Book a table' }, { id: 'REST_CONTACT', title: '📞 Contact us' }]
  );
}

async function sendRestaurantMenu(from) {
  await sendText(from,
    `📋 *Our Menu*\n\n🥗 *Starters*\n• Paneer Tikka — ₹180\n• Chicken 65 — ₹220\n\n🍛 *Mains*\n• Butter Chicken — ₹320\n• Dal Makhani — ₹240\n• Biryani — ₹280/₹350\n\n🍨 *Desserts*\n• Gulab Jamun — ₹120\n\nType *book* to reserve a table.`
  );
}

async function startRestaurantBooking(from) {
  await setState(from, 'AWAIT_REST_NAME', {});
  await sendText(from, `📅 *Table Booking*\n\n👤 What is your name?`);
}

async function sendRestaurantContact(from) {
  await sendText(from, `📞 *Contact Spice Garden*\n\n📱 +91 98765 43210\n📍 MG Road, Kozhikode\n🕐 11am – 11pm daily`);
}

async function startHomeServices(from) {
  await sendButtons(from,
    `🔧 *QuickFix Home Services*\n\nFast reliable repairs.\n⭐ 500+ customers | Same-day service`,
    [{ id: 'HOME_PLUMBING', title: '🚿 Plumbing' }, { id: 'HOME_ELECTRICAL', title: '⚡ Electrical' }, { id: 'HOME_CLEANING', title: '🧹 Cleaning' }]
  );
}

async function sendServiceInfo(from, service, price, bookId) {
  await sendButtons(from,
    `✅ *${service}*\n\n💰 ${price}\n⏱ Within 2 hours\n🔒 Insured & verified`,
    [{ id: bookId, title: '📅 Book now' }, { id: 'MAIN_MENU', title: '🔙 Back to menu' }]
  );
}

async function startHomeBooking(from, id) {
  const map = { HOME_BOOK_PLUMBING: 'Plumbing', HOME_BOOK_ELECTRICAL: 'Electrical', HOME_BOOK_CLEANING: 'Cleaning' };
  const service = map[id] || 'Service';
  await setState(from, 'AWAIT_HOME_NAME', { service });
  await sendText(from, `📋 *Booking ${service}*\n\n👤 Your full name?`);
}

async function startSalon(from) {
  await sendButtons(from,
    `💅 *Glamour Studio*\n\nPremium beauty treatments.\n⭐ 4.9 rated | 📍 Calicut Beach Road`,
    [{ id: 'SALON_HAIRCUT', title: '✂ Haircut' }, { id: 'SALON_FACIAL', title: '✨ Facial' }, { id: 'SALON_NAILS', title: '💅 Nails' }]
  );
}

async function sendSalonInfo(from, service, price, duration) {
  await setState(from, 'IDLE', { service });
  await sendButtons(from,
    `✨ *${service}*\n\n💰 ${price}\n⏱ ${duration}\n👩‍🎨 Expert stylists`,
    [{ id: 'SALON_BOOK', title: '📅 Book appointment' }, { id: 'MAIN_MENU', title: '🔙 Back to menu' }]
  );
}

async function startSalonBooking(from, service) {
  await setState(from, 'AWAIT_SALON_NAME', { service: service || 'Service' });
  await sendText(from, `📋 *Booking ${service || 'appointment'}*\n\n👤 Your name?`);
}

async function startRealEstate(from) {
  await sendButtons(from,
    `🏠 *DreamHome Realty*\n\n500+ listings in Kerala.\n Expert agents ready to help`,
    [{ id: 'RE_BUY', title: '🏠 Buy property' }, { id: 'RE_RENT', title: '🔑 Rent property' }, { id: 'RE_SELL', title: '💰 Sell property' }]
  );
}

async function startRealEstateLead(from, intent) {
  await setState(from, 'IDLE', { intent });
  await sendButtons(from,
    `🏠 *${intent} Property*\n\n200+ properties available.\n\nSchedule a viewing?`,
    [{ id: 'RE_YES', title: '✅ Yes, schedule' }, { id: 'RE_NO', title: '❌ Not now' }]
  );
}

async function askRealEstateDetails(from, session) {
  const intent = session?.data?.intent || 'Buy';
  await setState(from, 'AWAIT_RE_NAME', { intent });
  await sendText(from, `📋 *Schedule a viewing*\n\n👤 Your name?`);
}

// ─── API helpers ───────────────────────────────────────────────────────────
async function sendButtons(to, bodyText, buttons) {
  await axios.post(
    `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: 'whatsapp', to,
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: bodyText },
        action: {
          buttons: buttons.map(b => ({
            type: 'reply',
            reply: { id: b.id, title: b.title.substring(0, 20) }
          }))
        }
      }
    },
    { headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' } }
  );
}

async function sendText(to, text) {
  await axios.post(
    `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`,
    { messaging_product: 'whatsapp', to, type: 'text', text: { body: text } },
    { headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' } }
  );
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Bot running on port ${PORT}`));
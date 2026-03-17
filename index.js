import express from 'express';
import axios from 'axios';
import * as dotenv from 'dotenv';
dotenv.config();

const app = express();
app.use(express.json());

const PHONE_NUMBER_ID = '1026663817198120';
const TOKEN = process.env.WHATSAPP_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

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
      const id = msg.interactive?.button_reply?.id || msg.interactive?.list_reply?.id;
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

// ─── Save lead to Supabase ─────────────────────────────────────────────────
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

  // Start / main
  if (id === 'gents_salon') return showGentsSalon(from);

  // Gents salon menu
  if (id === 'services')     return showServices(from);
  if (id === 'appointments') return startAppointment(from);
  if (id === 'locations')    return showLocations(from);
  if (id === 'products')     return showProducts(from);
  if (id === 'offers')       return showOffers(from);

  // Service categories
  if (id === 'hair')         return showHair(from);
  if (id === 'straightening') return showStraightening(from);
  if (id === 'facial')       return showFacial(from);
  if (id === 'manicure')     return showManicure(from);
  if (id === 'threading')    return showThreading(from);

  // Appointment - select service
  if (id === 'srv_haircut')  return saveService(from, session, 'Haircut / Beard');
  if (id === 'srv_coloring') return saveService(from, session, 'Hair Coloring');
  if (id === 'srv_facial')   return saveService(from, session, 'Facial');
  if (id === 'srv_manicure') return saveService(from, session, 'Manicure & Pedicure');
  if (id === 'srv_wax')      return saveService(from, session, 'Waxing / Threading');

  // Appointment - select branch
  if (id === 'branch_satwa')   return saveBranch(from, session, 'Al Satwa');
  if (id === 'branch_jafliya') return saveBranch(from, session, 'Al Jafliya');
  if (id === 'branch_jebel')   return saveBranch(from, session, 'Jebel Ali');
  if (id === 'branch_deira')   return saveBranch(from, session, 'Deira');
  if (id === 'branch_sharjah') return saveBranch(from, session, 'Sharjah');

  // Appointment - select time
  if (id === 'time_9')  return saveTime(from, session, '09-10 AM');
  if (id === 'time_10') return saveTime(from, session, '10-11 AM');
  if (id === 'time_11') return saveTime(from, session, '11-12 PM');
  if (id === 'time_12') return saveTime(from, session, '12-01 PM');
  if (id === 'time_1')  return saveTime(from, session, '01-02 PM');
}

// ─── Text router ───────────────────────────────────────────────────────────
async function handleText(from, text, session) {
  const lower = text.toLowerCase();

  // Always allow restart
  if (['hi', 'hello', 'hey', 'start', 'menu', 'hii'].includes(lower)) {
    return showWelcome(from);
  }

  const { state, data } = session;

  // Collecting name for appointment
  if (state === 'AWAIT_NAME') {
    await setState(from, 'SELECT_SERVICE', { ...data, name: text });
    return showSelectService(from);
  }

  // Fallback
  return showWelcome(from);
}

// ─── Welcome ───────────────────────────────────────────────────────────────
async function showWelcome(from) {
  await setState(from, 'IDLE', {});
  await sendButtons(from,
    `Welcome to Madina Saloon! We're excited to help you look and feel your best.\n\nTo help us assist you faster, please let us know which service you are interested in by choosing from the options below:`,
    [{ id: 'gents_salon', title: 'Gents Salon' }]
  );
}

// ─── Gents salon main menu ─────────────────────────────────────────────────
async function showGentsSalon(from) {
  await sendListMessage(from,
    'Please choose an option:',
    'View options',
    [
      {
        title: 'Main Menu',
        rows: [
          { id: 'services',     title: 'SERVICES',           description: 'View all services & prices' },
          { id: 'appointments', title: 'APPOINTMENTS',        description: 'Book an appointment' },
          { id: 'locations',    title: 'LOCATIONS & TIMING',  description: 'Find our branches' },
          { id: 'products',     title: 'PRODUCTS',            description: 'View our products' },
          { id: 'offers',       title: 'OFFERS',              description: 'Special packages & deals' },
        ]
      }
    ]
  );
}

// ─── Services menu ─────────────────────────────────────────────────────────
async function showServices(from) {
  await sendListMessage(from,
    'Select a service category:',
    'View services',
    [
      {
        title: 'Service Categories',
        rows: [
          { id: 'hair',          title: 'Hair Cut & Coloring',    description: 'Cuts, shaving, coloring' },
          { id: 'straightening', title: 'Hair Straightening',     description: 'Spa, botox, keratin' },
          { id: 'facial',        title: 'Facial & Bleaching',     description: 'Facials, massage, scrubs' },
          { id: 'manicure',      title: 'Manicure & Pedicure',    description: 'Full service 30 AED' },
          { id: 'threading',     title: 'Threading & Waxing',     description: 'Threading, waxing options' },
        ]
      }
    ]
  );
}

// ─── Individual service pages ──────────────────────────────────────────────
async function showHair(from) {
  await sendButtons(from,
    `💇 Hair Services:\n\n• Hair Cutting: 5 AED\n• Shaving / Beard Trim: 5 AED\n• Hair Coloring: 10 / 15 / 20 / 25 AED`,
    [{ id: 'appointments', title: 'Book appointment' }, { id: 'services', title: 'Back' }]
  );
}

async function showStraightening(from) {
  await sendButtons(from,
    `✨ Hair Treatments:\n\n• Hair Spa: 15 AED\n• Hair Straightening: 25 AED\n• Hair Botox: 100 AED\n• Keratin: 80 AED\n• Protein: 80 AED\n• Smoothing / Rebonding: 80 AED`,
    [{ id: 'appointments', title: 'Book appointment' }, { id: 'services', title: 'Back' }]
  );
}

async function showFacial(from) {
  await sendButtons(from,
    `🧴 Facial & Skin Care:\n\n• Facial: 30 AED\n• Collagen Facial: 40 AED\n• Face Massage: 10 AED\n• Face + Neck Bleach: 20 AED\n• Face Scrub: 5 AED`,
    [{ id: 'appointments', title: 'Book appointment' }, { id: 'services', title: 'Back' }]
  );
}

async function showManicure(from) {
  await sendButtons(from,
    `💅 Manicure & Pedicure:\n\n• Full Service: 30 AED`,
    [{ id: 'appointments', title: 'Book appointment' }, { id: 'services', title: 'Back' }]
  );
}

async function showThreading(from) {
  await sendButtons(from,
    `🧵 Threading & Waxing:\n\n• Full Face Threading: 5 AED\n• Hand Wax: 10 AED\n• Underarm: 15 AED\n• Full Arm: 40 AED\n• Half Arm: 20 AED\n• Chest: 50 AED\n• Face Wax: 10 AED\n• Nose Wax: 3 AED`,
    [{ id: 'appointments', title: 'Book appointment' }, { id: 'services', title: 'Back' }]
  );
}

// ─── Locations ─────────────────────────────────────────────────────────────
async function showLocations(from) {
  await sendButtons(from,
    `📍 Our Locations:\n\n• Al Satwa\n• Al Jafliya\n• Jebel Ali\n• Hor Al Anz\n• Deira\n• Al Qusais\n• Muhaisnah\n• DIP-2\n• Sharjah\n\nReply with your preferred area for the exact location link.`,
    [{ id: 'gents_salon', title: 'Back to menu' }]
  );
}

// ─── Products ──────────────────────────────────────────────────────────────
async function showProducts(from) {
  await sendButtons(from,
    `🛍️ Product Categories:\n\n• Hair Care Products\n• Skin Care Products\n• Scrubs & Massage Creams\n• Facial Kits\n• Wax Products\n• Tools & Equipment`,
    [{ id: 'gents_salon', title: 'Back to menu' }]
  );
}

// ─── Offers ────────────────────────────────────────────────────────────────
async function showOffers(from) {
  await sendButtons(from,
    `🔥 Special Offers:\n\n💥 25 AED Package:\nHaircut + Beard + Face Wax + Head Massage\n\n💥 30 AED Package:\nHaircut + Beard + Face Massage + Hair Color\n\n💥 40 AED Package:\nHaircut + Beard + Facial + Head Massage`,
    [{ id: 'appointments', title: 'Book now' }, { id: 'gents_salon', title: 'Back to menu' }]
  );
}

// ─── Appointment flow ──────────────────────────────────────────────────────
async function startAppointment(from) {
  await setState(from, 'AWAIT_NAME', {});
  await sendText(from, `Great choice! 👍\nLet's book your appointment.\n\nPlease enter your *Name*:`);
}

async function showSelectService(from) {
  await sendListMessage(from,
    'Please select the service:',
    'Choose service',
    [
      {
        title: 'Services',
        rows: [
          { id: 'srv_haircut',  title: 'Haircut / Beard',       description: 'Cut & beard trim' },
          { id: 'srv_coloring', title: 'Hair Coloring',          description: 'Color & highlights' },
          { id: 'srv_facial',   title: 'Facial',                 description: 'Facial & skin care' },
          { id: 'srv_manicure', title: 'Manicure & Pedicure',    description: 'Full service' },
          { id: 'srv_wax',      title: 'Waxing / Threading',     description: 'Threading & waxing' },
        ]
      }
    ]
  );
}

async function saveService(from, session, service) {
  const data = { ...session.data, service };
  await setState(from, 'SELECT_BRANCH', data);
  await sendListMessage(from,
    'Select your preferred branch:',
    'Choose branch',
    [
      {
        title: 'Our Branches',
        rows: [
          { id: 'branch_satwa',   title: 'Al Satwa',   description: 'Dubai' },
          { id: 'branch_jafliya', title: 'Al Jafliya', description: 'Dubai' },
          { id: 'branch_jebel',   title: 'Jebel Ali',  description: 'Dubai' },
          { id: 'branch_deira',   title: 'Deira',      description: 'Dubai' },
          { id: 'branch_sharjah', title: 'Sharjah',    description: 'Sharjah' },
        ]
      }
    ]
  );
}

async function saveBranch(from, session, branch) {
  const data = { ...session.data, branch };
  await setState(from, 'SELECT_TIME', data);
  await sendListMessage(from,
    'Choose your preferred time slot:',
    'Choose time',
    [
      {
        title: 'Available Time Slots',
        rows: [
          { id: 'time_9',  title: '09-10 AM', description: 'Morning slot' },
          { id: 'time_10', title: '10-11 AM', description: 'Morning slot' },
          { id: 'time_11', title: '11-12 PM', description: 'Late morning' },
          { id: 'time_12', title: '12-01 PM', description: 'Afternoon slot' },
          { id: 'time_1',  title: '01-02 PM', description: 'Afternoon slot' },
        ]
      }
    ]
  );
}

async function saveTime(from, session, time) {
  const { name, service, branch } = session.data;
  await setState(from, 'IDLE', {});

  // Save to Supabase
  await saveLead({
    phone: from,
    name,
    business_type: 'SALON',
    service,
    booking_date: time,
    address: branch,
    status: 'new',
    raw_data: { name, service, branch, time, phone: from }
  });

  // Send confirmation
  await sendText(from,
    `✅ *Appointment Confirmed!*\n\n` +
    `📌 Name: ${name}\n` +
    `💇 Service: ${service}\n` +
    `📍 Branch: ${branch}\n` +
    `⏰ Time: ${time}\n\n` +
    `Please arrive 15 minutes early.\n\n` +
    `Thank you for choosing Madina Saloon! 🙏`
  );

  // Show menu again after 2 seconds
  setTimeout(async () => {
    await showWelcome(from);
  }, 2000);
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

async function sendListMessage(to, bodyText, buttonText, sections) {
  await axios.post(
    `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: 'whatsapp', to,
      type: 'interactive',
      interactive: {
        type: 'list',
        body: { text: bodyText },
        action: {
          button: buttonText.substring(0, 20),
          sections: sections.map(s => ({
            title: s.title.substring(0, 24),
            rows: s.rows.map(r => ({
              id: r.id,
              title: r.title.substring(0, 24),
              description: (r.description || '').substring(0, 72)
            }))
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
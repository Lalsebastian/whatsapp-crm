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

// ─── Supabase helpers ──────────────────────────────────────────────────────
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

  // Welcome
  if (id === 'gents_main')  return showGentsMain(from);
  if (id === 'ladies_main') return showLadiesMain(from);

  // ── Gents main menu ──
  if (id === 'gents_services')     return showGentsServices(from);
  if (id === 'gents_appointments') return showGentsBranches(from, session);
  if (id === 'gents_location')     return showGentsLocation(from);
  if (id === 'gents_products')     return showGentsProducts(from);
  if (id === 'gents_offers')       return showGentsOffers(from);

  // Gents services
  if (id === 'g_hair')      return showGentsHair(from);
  if (id === 'g_straight')  return showGentsStraightening(from);
  if (id === 'g_facial')    return showGentsFacial(from);
  if (id === 'g_manicure')  return showGentsManicure(from);
  if (id === 'g_threading') return showGentsThreading(from);

  // Gents branches
  if (id === 'g_branch_muteena') return saveBranch(from, session, 'Gents - Muteena');
  if (id === 'g_branch_dip')     return saveBranch(from, session, 'Gents - DIP');

  // ── Ladies main menu ──
  if (id === 'ladies_services')     return showLadiesServices(from);
  if (id === 'ladies_appointments') return showLadiesBranches(from, session);
  if (id === 'ladies_location')     return showLadiesLocation(from);
  if (id === 'ladies_products')     return showLadiesProducts(from);
  if (id === 'ladies_offers')       return showLadiesOffers(from);

  // Ladies services
  if (id === 'l_threading') return showLadiesThreading(from);
  if (id === 'l_waxing')    return showLadiesWaxing(from);
  if (id === 'l_hair')      return showLadiesHair(from);
  if (id === 'l_facial')    return showLadiesFacial(from);
  if (id === 'l_body')      return showLadiesBody(from);
  if (id === 'l_nails')     return showLadiesNails(from);
  if (id === 'l_henna')     return showLadiesHenna(from);

  // Ladies branches
  if (id === 'l_branch_muteena') return saveBranch(from, session, 'Ladies - Muteena');
  if (id === 'l_branch_dip')     return saveBranch(from, session, 'Ladies - DIP');

  // Time slots (shared)
  if (id === 'time1') return saveTime(from, session, '09-10 AM');
  if (id === 'time2') return saveTime(from, session, '10-11 AM');
  if (id === 'time3') return saveTime(from, session, '11-12 PM');
  if (id === 'time4') return saveTime(from, session, '12-01 PM');
}

// ─── Text router ───────────────────────────────────────────────────────────
async function handleText(from, text, session) {
  const lower = text.toLowerCase();

  if (['hi', 'hello', 'hey', 'start', 'menu', 'hii'].includes(lower)) {
    return showWelcome(from);
  }

  const { state, data } = session;

  // Collecting name
  if (state === 'AWAIT_NAME') {
    const newData = { ...data, name: text };
    await setState(from, 'SELECT_TIME', newData);
    return showTimeSlots(from);
  }

  return showWelcome(from);
}

// ─── Welcome ───────────────────────────────────────────────────────────────
async function showWelcome(from) {
  await setState(from, 'IDLE', {});
  await sendButtons(from,
    `Welcome to Madina Saloon! We're excited to help you look and feel your best.\n\nTo help us assist you faster, please choose your preferred salon:`,
    [
      { id: 'gents_main', title: 'Gents Saloon' },
      { id: 'ladies_main', title: 'Ladies Saloon' },
    ]
  );
}

// ═══════════════════════════════════════════════════════
// GENTS FLOWS
// ═══════════════════════════════════════════════════════

async function showGentsMain(from) {
  await sendListMessage(from,
    `Welcome to Madina Gents Saloon!\nPlease choose an option:`,
    'View options',
    [{
      title: 'Gents Saloon',
      rows: [
        { id: 'gents_services',     title: 'Services',          description: 'View all services & prices' },
        { id: 'gents_appointments', title: 'Appointments',       description: 'Book an appointment' },
        { id: 'gents_location',     title: 'Locations & Timing', description: 'Find our branches' },
        { id: 'gents_products',     title: 'Products',           description: 'View our products' },
        { id: 'gents_offers',       title: 'Offers',             description: 'Special packages & deals' },
      ]
    }]
  );
}

async function showGentsServices(from) {
  await sendListMessage(from,
    'Select a service category:',
    'Choose service',
    [{
      title: 'Gents Services',
      rows: [
        { id: 'g_hair',      title: 'Hair Cut & Coloring',  description: 'Cuts, shaving, coloring' },
        { id: 'g_straight',  title: 'Hair Straightening',   description: 'Keratin, botox, protein' },
        { id: 'g_facial',    title: 'Facial & Bleaching',   description: 'Facials, massage, scrubs' },
        { id: 'g_manicure',  title: 'Manicure & Pedicure',  description: 'Full service available' },
        { id: 'g_threading', title: 'Threading & Waxing',   description: 'Threading & waxing options' },
      ]
    }]
  );
}

async function showGentsHair(from) {
  await sendButtons(from,
    `Hair Services:\n\n• Hair Cutting: 5 AED\n• Shaving / Beard Trim: 5 AED\n• Hair Coloring: 10 / 15 / 20 / 25 AED`,
    [{ id: 'gents_appointments', title: 'Book appointment' }, { id: 'gents_services', title: 'Back' }]
  );
}

async function showGentsStraightening(from) {
  await sendButtons(from,
    `Hair Treatments:\n\n• Hair Spa: 15 AED\n• Hair Straightening: 25 AED\n• Hair Botox: 100 AED\n• Keratin: 80 AED\n• Protein: 80 AED\n• Smoothing / Rebonding: 80 AED`,
    [{ id: 'gents_appointments', title: 'Book appointment' }, { id: 'gents_services', title: 'Back' }]
  );
}

async function showGentsFacial(from) {
  await sendButtons(from,
    `Facial & Skin Care:\n\n• Facial: 30 AED\n• Collagen Facial: 40 AED\n• Face Massage: 10 AED\n• Face + Neck Bleach: 20 AED\n• Face Scrub: 5 AED`,
    [{ id: 'gents_appointments', title: 'Book appointment' }, { id: 'gents_services', title: 'Back' }]
  );
}

async function showGentsManicure(from) {
  await sendButtons(from,
    `Manicure & Pedicure:\n\n• Full Service: 30 AED`,
    [{ id: 'gents_appointments', title: 'Book appointment' }, { id: 'gents_services', title: 'Back' }]
  );
}

async function showGentsThreading(from) {
  await sendButtons(from,
    `Threading & Waxing:\n\n• Full Face Threading: 5 AED\n• Hand Wax: 10 AED\n• Underarm: 15 AED\n• Full Arm: 40 AED\n• Half Arm: 20 AED\n• Chest: 50 AED\n• Face Wax: 10 AED\n• Nose Wax: 3 AED`,
    [{ id: 'gents_appointments', title: 'Book appointment' }, { id: 'gents_services', title: 'Back' }]
  );
}

async function showGentsLocation(from) {
  await sendButtons(from,
    `📍 Gents Saloon Locations:\n\n• Muteena Branch\n• DIP Branch\n\nTiming: 9:00 AM - 10:00 PM\nDays: Monday to Sunday`,
    [{ id: 'gents_main', title: 'Back to menu' }]
  );
}

async function showGentsProducts(from) {
  await sendButtons(from,
    `🛍️ Gents Products:\n\n• Hair Care Products\n• Skin Care Products\n• Beard Care\n• Styling Products\n• Tools & Equipment`,
    [{ id: 'gents_main', title: 'Back to menu' }]
  );
}

async function showGentsOffers(from) {
  await sendButtons(from,
    `🔥 Gents Special Offers:\n\n💥 25 AED Package:\nHaircut + Beard + Face Wax + Head Massage\n\n💥 30 AED Package:\nHaircut + Beard + Face Massage + Hair Color\n\n💥 40 AED Package:\nHaircut + Beard + Facial + Head Massage`,
    [{ id: 'gents_appointments', title: 'Book now' }, { id: 'gents_main', title: 'Back to menu' }]
  );
}

async function showGentsBranches(from, session) {
  await setState(from, 'IDLE', { ...session.data, type: 'Gents' });
  await sendButtons(from,
    `Please select your preferred branch:`,
    [
      { id: 'g_branch_muteena', title: 'Muteena' },
      { id: 'g_branch_dip', title: 'DIP' },
    ]
  );
}

// ═══════════════════════════════════════════════════════
// LADIES FLOWS
// ═══════════════════════════════════════════════════════

async function showLadiesMain(from) {
  await sendListMessage(from,
    `Welcome to Madina Ladies Saloon!\nPlease choose an option:`,
    'View options',
    [{
      title: 'Ladies Saloon',
      rows: [
        { id: 'ladies_services',     title: 'Services',          description: 'View all services & prices' },
        { id: 'ladies_appointments', title: 'Appointments',       description: 'Book an appointment' },
        { id: 'ladies_location',     title: 'Locations & Timing', description: 'Find our branches' },
        { id: 'ladies_products',     title: 'Products',           description: 'View our products' },
        { id: 'ladies_offers',       title: 'Offers',             description: 'Special packages & deals' },
      ]
    }]
  );
}

async function showLadiesServices(from) {
  await sendListMessage(from,
    'Select a service category:',
    'Choose service',
    [{
      title: 'Ladies Services',
      rows: [
        { id: 'l_threading', title: 'Threading',  description: 'Eyebrow, face, upper lips' },
        { id: 'l_waxing',    title: 'Waxing',     description: 'Full body, underarms, bikini' },
        { id: 'l_hair',      title: 'Hair',       description: 'Cut, spa, keratin' },
        { id: 'l_facial',    title: 'Facial',     description: 'Hydra, gold facial' },
        { id: 'l_body',      title: 'Body Care',  description: 'Moroccan bath, polish' },
        { id: 'l_nails',     title: 'Nails',      description: 'Manicure & pedicure' },
        { id: 'l_henna',     title: 'Henna',      description: 'Hands & hair henna' },
      ]
    }]
  );
}

async function showLadiesThreading(from) {
  await sendButtons(from,
    `Threading:\n\n• Upper Lips: 5 AED\n• Chin: 5 AED\n• Eyebrow: 10 AED\n• Full Face: 30 AED`,
    [{ id: 'ladies_appointments', title: 'Book appointment' }, { id: 'ladies_services', title: 'Back' }]
  );
}

async function showLadiesWaxing(from) {
  await sendButtons(from,
    `Waxing:\n\n• Full Body: 150 AED\n• Underarms: 20 AED\n• Bikini: 50 AED`,
    [{ id: 'ladies_appointments', title: 'Book appointment' }, { id: 'ladies_services', title: 'Back' }]
  );
}

async function showLadiesHair(from) {
  await sendButtons(from,
    `Hair Services:\n\n• Hair Cut: 10 AED\n• Hair Spa: 30 AED\n• Keratin: 300 AED`,
    [{ id: 'ladies_appointments', title: 'Book appointment' }, { id: 'ladies_services', title: 'Back' }]
  );
}

async function showLadiesFacial(from) {
  await sendButtons(from,
    `Facial:\n\n• Hydra Facial: 200 AED\n• Gold Facial: 180 AED`,
    [{ id: 'ladies_appointments', title: 'Book appointment' }, { id: 'ladies_services', title: 'Back' }]
  );
}

async function showLadiesBody(from) {
  await sendButtons(from,
    `Body Care:\n\n• Moroccan Bath: 80 AED\n• Body Polish: 150 AED`,
    [{ id: 'ladies_appointments', title: 'Book appointment' }, { id: 'ladies_services', title: 'Back' }]
  );
}

async function showLadiesNails(from) {
  await sendButtons(from,
    `Nails:\n\n• Manicure: 30 AED\n• Pedicure: 40 AED`,
    [{ id: 'ladies_appointments', title: 'Book appointment' }, { id: 'ladies_services', title: 'Back' }]
  );
}

async function showLadiesHenna(from) {
  await sendButtons(from,
    `Henna:\n\n• Hands: 25 AED\n• Hair Henna: 40 AED`,
    [{ id: 'ladies_appointments', title: 'Book appointment' }, { id: 'ladies_services', title: 'Back' }]
  );
}

async function showLadiesLocation(from) {
  await sendButtons(from,
    `📍 Ladies Saloon Locations:\n\n• Muteena Branch\n• DIP Branch\n\nTiming: 9:00 AM - 10:00 PM\nDays: Monday to Sunday`,
    [{ id: 'ladies_main', title: 'Back to menu' }]
  );
}

async function showLadiesProducts(from) {
  await sendButtons(from,
    `🛍️ Ladies Products:\n\n• Hair Care Products\n• Skin Care Products\n• Scrubs & Massage Creams\n• Facial Kits\n• Wax Products\n• Nail Products`,
    [{ id: 'ladies_main', title: 'Back to menu' }]
  );
}

async function showLadiesOffers(from) {
  await sendButtons(from,
    `🔥 Ladies Special Offers:\n\n💥 Bridal Package:\nFull Body Wax + Facial + Henna\n\n💥 Glow Package:\nFacial + Body Polish + Nails\n\n💥 Refresh Package:\nMoroccan Bath + Hair Spa + Threading`,
    [{ id: 'ladies_appointments', title: 'Book now' }, { id: 'ladies_main', title: 'Back to menu' }]
  );
}

async function showLadiesBranches(from, session) {
  await setState(from, 'IDLE', { ...session.data, type: 'Ladies' });
  await sendButtons(from,
    `Please select your preferred branch:`,
    [
      { id: 'l_branch_muteena', title: 'Muteena' },
      { id: 'l_branch_dip', title: 'DIP' },
    ]
  );
}

// ═══════════════════════════════════════════════════════
// SHARED APPOINTMENT FLOW
// ═══════════════════════════════════════════════════════

async function saveBranch(from, session, branch) {
  const newData = { ...session.data, branch };
  await setState(from, 'AWAIT_NAME', newData);
  await sendText(from, `Please enter your *Name*:`);
}

async function showTimeSlots(from) {
  await sendButtons(from,
    `Select your preferred time slot:`,
    [
      { id: 'time1', title: '09-10 AM' },
      { id: 'time2', title: '10-11 AM' },
      { id: 'time3', title: '11-12 PM' },
    ]
  );
  await sendButtons(from,
    `More time slots:`,
    [
      { id: 'time4', title: '12-01 PM' },
    ]
  );
}

async function saveTime(from, session, time) {
  const { name, branch, type } = session.data;
  await setState(from, 'IDLE', {});

  await saveLead({
    phone: from,
    name: name || 'Unknown',
    business_type: 'SALON',
    service: type || 'Saloon',
    address: branch,
    booking_date: time,
    status: 'new',
    raw_data: { name, branch, time, type, phone: from }
  });

  await sendText(from,
    `✅ *Appointment Confirmed!*\n\n` +
    `📌 Name: ${name}\n` +
    `💇 Saloon: ${type}\n` +
    `📍 Branch: ${branch}\n` +
    `⏰ Time: ${time}\n\n` +
    `Please arrive 15 minutes early.\n\n` +
    `Thank you for choosing Madina Saloon! 🙏`
  );

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

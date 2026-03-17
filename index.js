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

app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

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

async function getSession(phone) {
  try {
    const res = await axios.get(
      `${SUPABASE_URL}/rest/v1/sessions?phone=eq.${phone}&select=*`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
    );
    if (res.data?.length > 0) return res.data[0];
  } catch (e) {
    console.error('getSession error:', e.message);
  }
  return { phone, state: 'IDLE', data: {} };
}

async function setState(phone, state, data = {}) {
  try {
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
  } catch (e) {
    console.error('setState error:', e.message);
  }
}

async function saveLead(leadData) {
  try {
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
  } catch (e) {
    console.error('saveLead error:', e.message);
  }
}

const BRANCH_ADDRESSES = {
  'Hor Al Anz':       'Shop #1, Aysha Masjid, Hor Al Anz, Dubai',
  'Muteena':          '61 Al Mateena St, AlSerkal Building, Deira, Dubai',
  'Al Satwa':         'Shop No#3, Al Tayer Building, Al Satwa, Dubai',
  'Jebel Ali':        'Shop#2, Near Haji Cafe, Mina Jebel Ali, Dubai',
  'DIP-2':            'Town Mall, 11 17 Street, Dubai Investment Park 2, Dubai',
  'Al Muhaisnah':     'Near Qaser Al Muhaisnah Restaurant, 26 18th St, Dubai',
  'Al Qusais':        'Opposite Dubai Residential Oasis, Al Qusais, Dubai',
  'Sharjah':          'Near Madina Market, Al Ghuwair, Sharjah',
  'Ladies - Muteena': 'Muteena Park 01, Next to Nasrin Cafe, Deira, Dubai',
  'Ladies - DIP-2':   'The Town Mall (Mango Market), DIP 02, Dubai',
};

// ─── Button router ─────────────────────────────────────
async function handleButton(from, id, session) {
  if (id === 'gents_main')  return showGentsMain(from);
  if (id === 'ladies_main') return showLadiesMain(from);
  if (id === 'main_menu')   return showWelcome(from);

  if (id === 'gents_services')     return showGentsServices(from);
  if (id === 'gents_appointments') return showGentsApptServices(from);
  if (id === 'gents_location')     return showGentsLocations(from);
  if (id === 'gents_products')     return showGentsProducts(from);
  if (id === 'gents_offers')       return showGentsOffers(from);

  if (id === 'g_hair')      return showGentsHair(from);
  if (id === 'g_straight')  return showGentsStraightening(from);
  if (id === 'g_facial')    return showGentsFacial(from);
  if (id === 'g_manicure')  return showGentsManicure(from);
  if (id === 'g_threading') return showGentsThreading(from);

  if (id === 'ga_hair')      return addService(from, 'Hair Cut - 5 AED', 'Gents');
  if (id === 'ga_beard')     return addService(from, 'Shaving/Beard Trim - 5 AED', 'Gents');
  if (id === 'ga_color')     return addService(from, 'Hair Coloring - 10/15/20/25 AED', 'Gents');
  if (id === 'ga_spa')       return addService(from, 'Hair Spa - 15 AED', 'Gents');
  if (id === 'ga_straight')  return addService(from, 'Hair Straightening - 25 AED', 'Gents');
  if (id === 'ga_keratin')   return addService(from, 'Hair Keratin - 80 AED', 'Gents');
  if (id === 'ga_botox')     return addService(from, 'Hair Botox - 100 AED', 'Gents');
  if (id === 'ga_facial')    return addService(from, 'Facial & Bleaching - 30 AED', 'Gents');
  if (id === 'ga_manicure')  return addService(from, 'Manicure & Pedicure - 30 AED', 'Gents');
  if (id === 'ga_threading') return addService(from, 'Threading & Waxing - from 5 AED', 'Gents');
  if (id === 'ga_pkg25')     return addService(from, 'Package 25 AED: Haircut+Beard+Face Wax+Head Massage+Nose Wax+Strip', 'Gents');
  if (id === 'ga_pkg30')     return addService(from, 'Package 30 AED: Haircut+Beard+Face Massage+Hair Color', 'Gents');
  if (id === 'ga_pkg40')     return addService(from, 'Package 40 AED: Haircut+Beard+Face Facial+Head Massage', 'Gents');

  if (id === 'add_more_g')  return showGentsApptServicesMore(from);
  if (id === 'done_g')      return showGentsApptBranches(from);

  if (id === 'loc_horAlAnz')   return showLocHorAlAnz(from);
  if (id === 'loc_muteena')    return showLocMuteena(from);
  if (id === 'loc_satwa')      return showLocSatwa(from);
  if (id === 'loc_jebelAli')   return showLocJebelAli(from);
  if (id === 'loc_dip')        return showLocDip(from);
  if (id === 'loc_muhaisnah')  return showLocMuhaisnah(from);
  if (id === 'loc_alQusais')   return showLocAlQusais(from);
  if (id === 'loc_sharjah')    return showLocSharjah(from);

  if (id === 'g_branch_horAlAnz')  return saveBranch(from, 'Hor Al Anz');
  if (id === 'g_branch_muteena')   return saveBranch(from, 'Muteena');
  if (id === 'g_branch_satwa')     return saveBranch(from, 'Al Satwa');
  if (id === 'g_branch_jebelAli')  return saveBranch(from, 'Jebel Ali');
  if (id === 'g_branch_dip')       return saveBranch(from, 'DIP-2');
  if (id === 'g_branch_muhaisnah') return saveBranch(from, 'Al Muhaisnah');
  if (id === 'g_branch_alQusais')  return saveBranch(from, 'Al Qusais');
  if (id === 'g_branch_sharjah')   return saveBranch(from, 'Sharjah');

  if (id === 'prod_hair')   return showProdHairCare(from, 'gents_products');
  if (id === 'prod_skin')   return showProdSkinCare(from, 'gents_products');
  if (id === 'prod_scrubs') return showProdScrubs(from, 'gents_products');
  if (id === 'prod_facial') return showProdFacialKits(from, 'gents_products');
  if (id === 'prod_wax')    return showProdWax(from, 'gents_products');
  if (id === 'prod_tools')  return showProdTools(from, 'gents_products');

  if (id === 'lprod_hair')   return showProdHairCare(from, 'ladies_products');
  if (id === 'lprod_skin')   return showProdSkinCare(from, 'ladies_products');
  if (id === 'lprod_scrubs') return showProdScrubs(from, 'ladies_products');
  if (id === 'lprod_facial') return showProdFacialKits(from, 'ladies_products');
  if (id === 'lprod_wax')    return showProdWax(from, 'ladies_products');
  if (id === 'lprod_tools')  return showProdTools(from, 'ladies_products');

  if (id === 'ladies_services')     return showLadiesServices(from);
  if (id === 'ladies_appointments') return showLadiesApptServices(from);
  if (id === 'ladies_location')     return showLadiesLocations(from);
  if (id === 'ladies_products')     return showLadiesProducts(from);
  if (id === 'ladies_offers')       return showLadiesOffers(from);

  if (id === 'l_threading') return showLadiesThreading(from);
  if (id === 'l_waxing')    return showLadiesWaxing(from);
  if (id === 'l_hair')      return showLadiesHair(from);
  if (id === 'l_facial')    return showLadiesFacial(from);
  if (id === 'l_body')      return showLadiesBody(from);
  if (id === 'l_nails')     return showLadiesNails(from);
  if (id === 'l_henna')     return showLadiesHenna(from);

  if (id === 'la_threading') return addService(from, 'Threading - from 5 AED', 'Ladies');
  if (id === 'la_waxing')    return addService(from, 'Waxing - from 10 AED', 'Ladies');
  if (id === 'la_haircut')   return addService(from, 'Hair Cut - from 10 AED', 'Ladies');
  if (id === 'la_hairspa')   return addService(from, 'Hair Spa / Hot Oil - 30 AED', 'Ladies');
  if (id === 'la_keratin')   return addService(from, 'Keratin (Any Length) - 300 AED', 'Ladies');
  if (id === 'la_botox')     return addService(from, 'Botox (Any Length) - 300 AED', 'Ladies');
  if (id === 'la_rebond')    return addService(from, 'Rebonding (Any Length) - 250 AED', 'Ladies');
  if (id === 'la_facial')    return addService(from, 'Facial - from 100 AED', 'Ladies');
  if (id === 'la_body')      return addService(from, 'Body Care - from 40 AED', 'Ladies');
  if (id === 'la_nails')     return addService(from, 'Nails - from 30 AED', 'Ladies');
  if (id === 'la_henna')     return addService(from, 'Henna - from 25 AED', 'Ladies');
  if (id === 'la_combo')     return addService(from, 'Combo Offer', 'Ladies');
  if (id === 'la_bday')      return addService(from, 'Birthday Offer - 100 AED (Any 10 Services)', 'Ladies');
  if (id === 'la_pkg120')    return addService(from, 'Package 120 AED: Head+Neck Massage+Full Face Wax+Fruit Facial', 'Ladies');
  if (id === 'la_pkg150')    return addService(from, 'Package 150 AED: Mani+Pedi+Moroccan Bath+Body Massage', 'Ladies');

  if (id === 'add_more_l') return showLadiesApptServicesMore(from);
  if (id === 'done_l')     return showLadiesApptBranches(from);

  if (id === 'l_loc_muteena') return showLadiesLocMuteena(from);
  if (id === 'l_loc_dip')     return showLadiesLocDip(from);

  if (id === 'l_branch_muteena') return saveBranch(from, 'Ladies - Muteena');
  if (id === 'l_branch_dip')     return saveBranch(from, 'Ladies - DIP-2');

  if (id === 'time_9_10')   return saveTime(from, '09-10 AM');
  if (id === 'time_10_11')  return saveTime(from, '10-11 AM');
  if (id === 'time_11_12')  return saveTime(from, '11-12 PM');
  if (id === 'time_12_1')   return saveTime(from, '12-01 PM');
  if (id === 'time_1_2')    return saveTime(from, '01-02 PM');
  if (id === 'time_2_3')    return saveTime(from, '02-03 PM');
  if (id === 'time_3_4')    return saveTime(from, '03-04 PM');
  if (id === 'time_4_5')    return saveTime(from, '04-05 PM');
  if (id === 'time_5_6')    return saveTime(from, '05-06 PM');
  if (id === 'time_6_7')    return saveTime(from, '06-07 PM');
  if (id === 'time_7_8')    return saveTime(from, '07-08 PM');
  if (id === 'time_8_9')    return saveTime(from, '08-09 PM');
  if (id === 'time_9_10pm') return saveTime(from, '09-10 PM');
}

async function handleText(from, text, session) {
  const lower = text.toLowerCase();
  if (['hi', 'hello', 'hey', 'start', 'menu', 'hii'].includes(lower)) {
    return showWelcome(from);
  }
  if (session.state === 'AWAIT_NAME') {
    const newData = { ...session.data, name: text };
    await setState(from, 'SELECT_TIME', newData);
    return showTimeSlots(from);
  }
  return showWelcome(from);
}

// ─── WELCOME ───────────────────────────────────────────
async function showWelcome(from) {
  await setState(from, 'IDLE', {});
  await sendButtons(from,
    `Welcome to Madina Saloon! We're excited to help you look and feel your best.\n\nPlease choose your preferred salon:`,
    [
      { id: 'gents_main', title: 'Gents Saloon' },
      { id: 'ladies_main', title: 'Ladies Saloon' },
    ]
  );
}

// ═══════════════════════════════════════════════════════
// MULTI-SERVICE LOGIC — always reads fresh from Supabase
// ═══════════════════════════════════════════════════════
async function addService(from, newService, type) {
  const fresh = await getSession(from);
  const data = fresh.data || {};
  const existing = Array.isArray(data.services) ? data.services : [];

  if (!existing.includes(newService)) {
    existing.push(newService);
  }

  await setState(from, 'IDLE', { ...data, type, services: existing });

  const servicesList = existing.map((s, i) => `${i + 1}. ${s}`).join('\n');

  const addMoreId = type === 'Ladies' ? 'add_more_l' : 'add_more_g';
  const doneId    = type === 'Ladies' ? 'done_l'     : 'done_g';

  await sendButtons(from,
    `✅ *Added!*\n\n*Your selected services:*\n${servicesList}\n\nWould you like to add another service?`,
    [
      { id: addMoreId,   title: 'Add another' },
      { id: doneId,      title: 'Done, continue' },
      { id: 'main_menu', title: 'Main menu' },
    ]
  );
}

// ═══════════════════════════════════════════════════════
// GENTS
// ═══════════════════════════════════════════════════════
async function showGentsMain(from) {
  await sendListMessage(from,
    `Welcome to Madina Gents Saloon!\nPlease choose an option:`,
    'View options',
    [{ title: 'Gents Saloon', rows: [
      { id: 'gents_services',     title: 'Services',           description: 'View all services & prices' },
      { id: 'gents_appointments', title: 'Appointments',        description: 'Book an appointment' },
      { id: 'gents_location',     title: 'Locations & Timing',  description: 'Find our branches' },
      { id: 'gents_products',     title: 'Products',            description: 'View our products' },
      { id: 'gents_offers',       title: 'Offers',              description: 'Special packages & deals' },
    ]}]
  );
}

async function showGentsServices(from) {
  await sendListMessage(from, 'Select a service category:', 'Choose service',
    [{ title: 'Gents Services', rows: [
      { id: 'g_hair',      title: 'Hair Cut & Coloring',  description: 'Cuts, shaving, coloring' },
      { id: 'g_straight',  title: 'Hair Straightening',   description: 'Keratin, botox, protein' },
      { id: 'g_facial',    title: 'Facial & Bleaching',   description: 'Facials, massage, scrubs' },
      { id: 'g_manicure',  title: 'Manicure & Pedicure',  description: 'Full service 30 AED' },
      { id: 'g_threading', title: 'Threading & Waxing',   description: 'Threading & waxing options' },
    ]}]
  );
}

async function showGentsHair(from) {
  await sendButtons(from,
    `✂️ *Hair Cut & Coloring:*\n\n• Hair Cutting: 5 AED\n• Shaving / Beard Trimming: 5 AED\n• Hair Coloring (Free Head Wash): 10 / 15 / 20 / 25 AED\n• Skin Free Beard Coloring: 15 AED`,
    [{ id: 'gents_appointments', title: 'Book appointment' }, { id: 'gents_services', title: 'Back' }, { id: 'main_menu', title: 'Main menu' }]
  );
}

async function showGentsStraightening(from) {
  await sendButtons(from,
    `✨ *Hair Straightening & Treatments:*\n\n• Hair Spa: 15 AED\n• Hair Straightening: 25 AED\n• Hair Botox Treatment: 100 AED\n• Hair Keratin Treatment: 80 AED\n• Hair Protein Treatment: 80 AED\n• Hair Smoothing & Rebonding: 80 AED\n• Hot Oil Treatment: 15 AED`,
    [{ id: 'gents_appointments', title: 'Book appointment' }, { id: 'gents_services', title: 'Back' }, { id: 'main_menu', title: 'Main menu' }]
  );
}

async function showGentsFacial(from) {
  await sendButtons(from,
    `🧴 *Facial & Bleaching:*\n\n• Face Facial: 30 AED\n• Facial with Collagen Mask: 40 AED\n• Face Massage: 10 AED\n• Face + Neck Bleaching: 20 AED\n• Face Scrub: 5 AED\n• Nose Strip: 5 AED\n• Black Mask: 10 AED\n• Jelly Mask: 15 AED`,
    [{ id: 'gents_appointments', title: 'Book appointment' }, { id: 'gents_services', title: 'Back' }, { id: 'main_menu', title: 'Main menu' }]
  );
}

async function showGentsManicure(from) {
  await sendButtons(from,
    `💅 *Manicure & Pedicure:*\n\n• Manicure & Pedicure: 30 AED`,
    [{ id: 'gents_appointments', title: 'Book appointment' }, { id: 'gents_services', title: 'Back' }, { id: 'main_menu', title: 'Main menu' }]
  );
}

async function showGentsThreading(from) {
  await sendButtons(from,
    `🧵 *Threading & Waxing:*\n\n• Full Face Threading: 5 AED\n• Hand Waxing: 10 AED\n• Under Arm Wax: 15 AED\n• Full Arm Wax: 40 AED\n• Half Arm Wax: 20 AED\n• Chest Wax: 50 AED\n• Face Wax: 10 AED\n• Nose Wax: 3 AED`,
    [{ id: 'gents_appointments', title: 'Book appointment' }, { id: 'gents_services', title: 'Back' }, { id: 'main_menu', title: 'Main menu' }]
  );
}

async function showGentsApptServices(from) {
  await setState(from, 'IDLE', { type: 'Gents', services: [] });
  await sendListMessage(from,
    `📋 *Book Appointment - Gents Saloon*\n\nSelect your first service.\nYou can add multiple services!`,
    'Choose service',
    [
      { title: 'Hair Services', rows: [
        { id: 'ga_hair',      title: 'Hair Cut',           description: '5 AED' },
        { id: 'ga_beard',     title: 'Shaving/Beard Trim', description: '5 AED' },
        { id: 'ga_color',     title: 'Hair Coloring',      description: 'Free Head Wash - 10/15/20/25 AED' },
        { id: 'ga_spa',       title: 'Hair Spa',           description: '15 AED' },
        { id: 'ga_straight',  title: 'Hair Straightening', description: '25 AED' },
        { id: 'ga_keratin',   title: 'Hair Keratin',       description: '80 AED' },
        { id: 'ga_botox',     title: 'Hair Botox',         description: '100 AED' },
        { id: 'ga_facial',    title: 'Facial & Bleaching', description: '30 AED' },
        { id: 'ga_manicure',  title: 'Manicure & Pedicure',description: '30 AED' },
        { id: 'ga_threading', title: 'Threading & Waxing', description: 'From 5 AED' },
      ]},
      { title: 'Package Offers', rows: [
        { id: 'ga_pkg25', title: 'Package 25 AED', description: 'Haircut+Beard+Face Wax+Head Massage' },
        { id: 'ga_pkg30', title: 'Package 30 AED', description: 'Haircut+Beard+Face Massage+Hair Color' },
        { id: 'ga_pkg40', title: 'Package 40 AED', description: 'Haircut+Beard+Face Facial+Head Massage' },
      ]}
    ]
  );
}

async function showGentsApptServicesMore(from) {
  await sendListMessage(from, `Add another service:`, 'Choose service',
    [
      { title: 'Hair Services', rows: [
        { id: 'ga_hair',      title: 'Hair Cut',           description: '5 AED' },
        { id: 'ga_beard',     title: 'Shaving/Beard Trim', description: '5 AED' },
        { id: 'ga_color',     title: 'Hair Coloring',      description: 'Free Head Wash - 10/15/20/25 AED' },
        { id: 'ga_spa',       title: 'Hair Spa',           description: '15 AED' },
        { id: 'ga_straight',  title: 'Hair Straightening', description: '25 AED' },
        { id: 'ga_keratin',   title: 'Hair Keratin',       description: '80 AED' },
        { id: 'ga_botox',     title: 'Hair Botox',         description: '100 AED' },
        { id: 'ga_facial',    title: 'Facial & Bleaching', description: '30 AED' },
        { id: 'ga_manicure',  title: 'Manicure & Pedicure',description: '30 AED' },
        { id: 'ga_threading', title: 'Threading & Waxing', description: 'From 5 AED' },
      ]},
      { title: 'Package Offers', rows: [
        { id: 'ga_pkg25', title: 'Package 25 AED', description: 'Haircut+Beard+Face Wax+Head Massage' },
        { id: 'ga_pkg30', title: 'Package 30 AED', description: 'Haircut+Beard+Face Massage+Hair Color' },
        { id: 'ga_pkg40', title: 'Package 40 AED', description: 'Haircut+Beard+Face Facial+Head Massage' },
      ]}
    ]
  );
}

async function showGentsApptBranches(from) {
  const fresh = await getSession(from);
  const services = fresh.data?.services || [];
  const servicesList = services.map((s, i) => `${i + 1}. ${s}`).join('\n');
  await sendText(from, `✅ *Services confirmed:*\n${servicesList}\n\nNow select your preferred branch:`);
  await sendListMessage(from, 'Select your preferred branch:', 'Choose branch',
    [{ title: 'Our Locations', rows: [
      { id: 'g_branch_horAlAnz',  title: 'Hor Al Anz',  description: 'Dubai' },
      { id: 'g_branch_muteena',   title: 'Muteena',      description: 'Dubai' },
      { id: 'g_branch_satwa',     title: 'Al Satwa',     description: 'Dubai' },
      { id: 'g_branch_jebelAli',  title: 'Jebel Ali',    description: 'Dubai' },
      { id: 'g_branch_dip',       title: 'DIP-2',        description: 'Dubai' },
      { id: 'g_branch_muhaisnah', title: 'Al Muhaisnah', description: 'Dubai' },
      { id: 'g_branch_alQusais',  title: 'Al Qusais',    description: 'Dubai' },
      { id: 'g_branch_sharjah',   title: 'Sharjah',      description: 'Sharjah' },
    ]}]
  );
}

async function showGentsLocations(from) {
  await sendListMessage(from, '📍 Select your area to view branch details:', 'Choose area',
    [{ title: 'Our Areas', rows: [
      { id: 'loc_horAlAnz',  title: 'Hor Al Anz',  description: 'Dubai' },
      { id: 'loc_muteena',   title: 'Muteena',      description: 'Dubai' },
      { id: 'loc_satwa',     title: 'Al Satwa',     description: 'Dubai' },
      { id: 'loc_jebelAli',  title: 'Jebel Ali',    description: 'Dubai' },
      { id: 'loc_dip',       title: 'DIP-2',        description: 'Dubai' },
      { id: 'loc_muhaisnah', title: 'Al Muhaisnah', description: 'Dubai' },
      { id: 'loc_alQusais',  title: 'Al Qusais',    description: 'Dubai' },
      { id: 'loc_sharjah',   title: 'Sharjah',      description: 'Sharjah' },
    ]}]
  );
}

async function showLocSatwa(from) {
  await sendText(from, `📍 *Al Satwa Branches:*\n\n*Branch 1*\nShop No#3, Al Tayer Building, Al Satwa, Dubai\nhttps://maps.app.goo.gl/GfHgwnnrjetWrpcn8\n\n*Branch 2*\nShop No#9, Satwa RoundAbout, Near Public Kitchen, Al Satwa, Dubai\nhttps://maps.app.goo.gl/9FigxGSPThy7m8XW7\n\n*Branch 3*\nShop No#4, Near Qadri Masjid, Al Satwa, Dubai\nhttps://maps.app.goo.gl/cTj7o8D8cFUYuvQE9\n\n*Branch 4*\nShop No#6-7, Al Satwa, Dubai\nhttps://maps.app.goo.gl/EVvb7jhqTfNnP8jh9\n\n*Branch 5*\nShop No#18, Satwa Star Building, Al Satwa, Dubai\nhttps://maps.app.goo.gl/w5NouJjsimvbXUu76`);
  await sendText(from, `*Branch 6*\nShop No#03, Opposite Pak Special Restaurant, Al Jafliya, Dubai\nhttps://maps.app.goo.gl/wEgfsaDbKKEPjuc28\n\n*Branch 7*\nShop No#2, Near ENBD ATM, Al Jafliya, Dubai\nhttps://maps.app.goo.gl/NsUS3Spdo4M8YyQG6\n\n*Branch 8*\nShop No#1, Satwa RoundAbout, Opposite Aura Fakhree Centre, Al Jafliya, Dubai\nhttps://maps.app.goo.gl/5GKY8UcY94Fer1re9\n\n*Branch 9*\nShop No#3, Next to Pak Sweet Cafe, Satwa, Dubai\nhttps://maps.app.goo.gl/RPoojirjxhYujmRUA\n\n*Branch 10*\nShop No#12, Near ENBD ATM, Al Jafliya, Dubai`);
  await sendButtons(from, `⏰ Timing: 9:00 AM - 10:00 PM\n📅 Open 7 days a week`, [{ id: 'gents_location', title: 'Back to areas' }, { id: 'main_menu', title: 'Main menu' }]);
}

async function showLocJebelAli(from) {
  await sendText(from, `📍 *Jebel Ali Branches:*\n\n*Branch 1*\nShop#2, Near Haji Cafe, Mina Jebel Ali, Industrial 1, Dubai\nhttps://maps.app.goo.gl/MQPEXPXdteAhpx7Y7\n\n*Branch 2*\nSt 95, Jebel Ali Industrial Area, Opposite ENOC Warehouse, Dubai\nhttps://maps.app.goo.gl/B71Z8dsRs5SdrjN36\n\n*Branch 3*\nPlot 509-109, Jebel Ali Industrial Area, Dubai\nhttps://maps.app.goo.gl/s9onDQTJFZahueWu7\n\n*Branch 4*\nInside Build Well Building, Jebel Ali Industrial Area 1, Dubai\nhttps://maps.app.goo.gl/3nN1iP5q3H1WmLs68\n\n*Branch 5*\nInside Jebel Ali Mall, Jebel Ali Industrial Area, Dubai\nhttps://maps.app.goo.gl/PXbGdS7uqLbibCmA6`);
  await sendText(from, `*Branch 6*\nNear Parsons Mall, Mina Jebel Ali, Dubai\nhttps://maps.app.goo.gl/n4xwVBZs6HVFamB58\n\n*Branch 7*\nNear Lifeguard General Clinic, Mina Jebel Ali, Dubai\nhttps://maps.app.goo.gl/pmNU48u3BDUFa2Mr9\n\n*Branch 8*\nPlot 509-109, Jebel Ali Industrial Area, Dubai\nhttps://maps.app.goo.gl/i8F62JCKu9WWnTj76\n\n*Branch 9*\nNear Emirates Flight Catering, Mina Jebel Ali, Dubai\nhttps://maps.app.goo.gl/QUv7nZV3cmQmPRKW6`);
  await sendButtons(from, `⏰ Timing: 9:00 AM - 10:00 PM\n📅 Open 7 days a week`, [{ id: 'gents_location', title: 'Back to areas' }, { id: 'main_menu', title: 'Main menu' }]);
}

async function showLocHorAlAnz(from) {
  await sendText(from, `📍 *Hor Al Anz Branches:*\n\n*Branch 1*\nShop #1, Aysha Masjid, Hor Al Anz, Dubai\nhttps://maps.app.goo.gl/2RKywgzHcFbjtLs29\n\n*Branch 2*\n53 34A St, Near Karachi Golden Restaurant, Hor Al Anz, Dubai\nhttps://maps.app.goo.gl/k3LtfZ5P5pvAWnPU6\n\n*Branch 3*\n23 38A St, Kokan Plaza Building, Hor Al Anz, Dubai\nhttps://maps.app.goo.gl/LnRuijRyECanJ7dT7\n\n*Branch 4*\nOpposite Amiruddin Clinic, Hor Al Anz, Dubai`);
  await sendButtons(from, `⏰ Timing: 9:00 AM - 10:00 PM\n📅 Open 7 days a week`, [{ id: 'gents_location', title: 'Back to areas' }, { id: 'main_menu', title: 'Main menu' }]);
}

async function showLocMuteena(from) {
  await sendText(from, `📍 *Muteena Branch:*\n\n*Branch 1*\n61 Al Mateena St, AlSerkal Building, Deira, Dubai\nhttps://maps.app.goo.gl/QSRDGRqhiryHDxa29`);
  await sendButtons(from, `⏰ Timing: 9:00 AM - 10:00 PM\n📅 Open 7 days a week`, [{ id: 'gents_location', title: 'Back to areas' }, { id: 'main_menu', title: 'Main menu' }]);
}

async function showLocAlQusais(from) {
  await sendText(from, `📍 *Al Qusais Branches:*\n\n*Branch 1*\nOpposite Dubai Residential Oasis, Al Qusais, Dubai\nhttps://maps.app.goo.gl/rL8ah8LBMiqsiEdK7\n\n*Branch 2*\nNear Fast Link Technical Services, Damascus Street, Al Qusais Industrial Area, Dubai\nhttps://maps.app.goo.gl/GhuSoCRW7veHMKyAA\n\n*Branch 3*\nHamad Lootah Building, Muhaisnah 4, Dubai\nhttps://maps.app.goo.gl/kzhhfUgRVxyve9gq9`);
  await sendButtons(from, `⏰ Timing: 9:00 AM - 10:00 PM\n📅 Open 7 days a week`, [{ id: 'gents_location', title: 'Back to areas' }, { id: 'main_menu', title: 'Main menu' }]);
}

async function showLocMuhaisnah(from) {
  await sendText(from, `📍 *Al Muhaisnah Branches:*\n\n*Branch 1*\nNear Qaser Al Muhaisnah Restaurant, 26 18th St, Muhaisanah 2, Dubai\nhttps://maps.app.goo.gl/sec1WspDaag798TF6\n\n*Branch 2*\nNear Manar Al Madeena Supermarket, Pepco Engineering Building, Muhaisnah, Dubai\nhttps://maps.app.goo.gl/JKowGgWKVqopTwSK9\n\n*Branch 3*\nNear Gospel Camp, Muhaisanah 2, Dubai\nhttps://maps.app.goo.gl/X1w6QLFspBPwmEUTA`);
  await sendButtons(from, `⏰ Timing: 9:00 AM - 10:00 PM\n📅 Open 7 days a week`, [{ id: 'gents_location', title: 'Back to areas' }, { id: 'main_menu', title: 'Main menu' }]);
}

async function showLocDip(from) {
  await sendText(from, `📍 *DIP-2 Branches:*\n\n*Branch 1*\nTown Mall, 11 17 Street, Dubai Investment Park 2, Dubai\nhttps://maps.app.goo.gl/6xTR4R8DJ3gbQFu47\n\n*Branch 2*\nAl Suwaid Staff Accommodation, Dubai Investment Park 2, Dubai\nhttps://maps.app.goo.gl/NMw5u1xSpbVRMC1m6\n\n*Branch 3*\nRuman Market, Near AXA Mall, Dubai Investment Park 2, Dubai\nhttps://maps.app.goo.gl/Lddkxek9xqntLxh1A\n\n*Branch 4*\nShop No#5, Backside Parsons, Galadari Mall, DIP-2, Dubai\nhttps://maps.app.goo.gl/PdHscRBqmc4d68mx7`);
  await sendButtons(from, `⏰ Timing: 9:00 AM - 10:00 PM\n📅 Open 7 days a week`, [{ id: 'gents_location', title: 'Back to areas' }, { id: 'main_menu', title: 'Main menu' }]);
}

async function showLocSharjah(from) {
  await sendText(from, `📍 *Sharjah Branches:*\n\n*Branch 1*\nNear Madina Market, Al Ghuwair, Sharjah\nhttps://maps.app.goo.gl/rL8ah8LBMiqsiEdK7\n\n*Branch 2*\nShop No#06, Naseem Residency, Community Centre, Tilal City, Sharjah\nhttps://maps.app.goo.gl/jeF8bBVwtsiDMrdp8\n\n*Branch 3*\nBeside Damas Jewellers, Rolla Bus Stand, Sharjah\nhttps://maps.app.goo.gl/cDW1WCE2sSK3DSuh7`);
  await sendText(from, `*Branch 4*\nNear Clock Tower, Al Zahra St, Al Mussalla, Sharjah\nhttps://maps.app.goo.gl/a6dDL7kvBe5UUUKL8\n\n*Branch 5*\nAl Rolla St 12, Al Ghuwair, Hay Al Gharb, Sharjah\nhttps://maps.app.goo.gl/kmn2BqvDDcAACvaL7\n\n*Branch 6*\nFire Station Street, Muwaileh Commercial, Industrial Area, Sharjah\nhttps://maps.app.goo.gl/ySXL4aDmEYrYtocA9`);
  await sendButtons(from, `⏰ Timing: 9:00 AM - 10:00 PM\n📅 Open 7 days a week`, [{ id: 'gents_location', title: 'Back to areas' }, { id: 'main_menu', title: 'Main menu' }]);
}

async function showGentsProducts(from) {
  await sendListMessage(from, '🛍️ Select a product category:', 'View products',
    [{ title: 'Product Categories', rows: [
      { id: 'prod_hair',   title: 'Hair Care Products',      description: 'Shampoo, conditioner, oils' },
      { id: 'prod_skin',   title: 'Skin Care Products',      description: 'Cleansers, bleach' },
      { id: 'prod_scrubs', title: 'Scrubs & Massage Creams', description: 'Face & body scrubs' },
      { id: 'prod_facial', title: 'Facial Kits',             description: 'Gold, vitamin C kits' },
      { id: 'prod_wax',    title: 'Wax Products',            description: 'Hair wax range' },
      { id: 'prod_tools',  title: 'Tools & Equipment',       description: 'Chairs, clippers, steamers' },
    ]}]
  );
}

async function showGentsOffers(from) {
  await sendText(from, `🔥 *Gents Special Packages:*\n\n💥 *25 AED Package:*\nHair Cut + Shaving/Beard + Full Face Wax + Head Massage + Nose Wax + Nose Strip\n\n💥 *30 AED Package:*\nHair Cut + Shaving/Beard + Face Massage + Hair Color\n\n💥 *40 AED Package:*\nHair Cut + Shaving/Beard + Face Facial + Head Massage`);
  await sendButtons(from, `Tap below to book any package:`, [{ id: 'gents_appointments', title: 'Book now' }, { id: 'gents_main', title: 'Back to menu' }, { id: 'main_menu', title: 'Main menu' }]);
}

// ═══════════════════════════════════════════════════════
// SHARED PRODUCTS
// ═══════════════════════════════════════════════════════
async function showProdHairCare(from, backId) {
  await sendText(from, `💆 *Hair Care Products:*\n\n1. Hair Botox Keratin, Hair Serum, Shampoo & Conditioner Set\n2. Hair Botox Shampoo & Conditioner Set\n3. Keratin Queen Brazilian Shampoo 500ml + Protein 500ml + Conditioner 500ml\n4. Keratin Queen Protein Brazilian Treatment 800ml\n5. Keratin Queen Protein Brazilian Shampoo 800ml\n6. Keratin Queen Protein Brazilian Conditioner 800ml\n7. Keratin Queen Protein Brazilian Hair Mask 1000ml\n8. Keratin Queen Moisturizing Brazilian Hair Oil\n9. Beauty Track Keratin Queen Repairing & Nourishing Mask Brazil Nut 1000ml\n10. Beauty Track Keratin Queen Hair Care Balance Hair Mask Nut 1000ml`);
  await sendText(from, `11. Keratin Queen Coffee 01 - 1000ml\n12. Keratin Queen Coffee 02 - 1000ml\n13. Keratin Queen Coffee 03 - 1000ml\n14. Professional Hair Care Keratin Queen 01 - 1000ml\n15. Professional Hair Care Keratin Queen 02 - 1000ml\n16. Professional Hair Care Keratin Queen 03 - 1000ml\n17. Keratin Queen Treatment Argan Hair Oil (Serum) 100ml\n18. Augeas Keratin Deep Curl Treatment For Straight Hair\n19. Augeas Argan Ali Hair Mask 850ml\n20. Augeas Keratin Hair Mask 1000ml`);
  await sendText(from, `21. Keratin Creamy Hair Mask 1000ml\n22. Vatika Hair Oil Almond 200ml\n23. Vatika Hair Oil Garlic\n24. Navratna Herbal Oil 300ml\n25. Beauty Sun Queen Coconut Moisturizing Body Lotion 500ml\n26. TCB Hair Relaxer 425g\n27. Parachute Coconut Oil 450ml\n28. Augeas Bleaching Powder Bag 500ml\n29. Augeas Bleaching Powder Jar 500ml\n30. Dexe Anti Hair Loss Shampoo 500ml`);
  await sendText(from, `31. Dexe Hair Loss Shampoo\n32. Sofnfree Hair Relaxer 1L\n33. Dark & Lovely Relaxer Kit\n34. Augeas Ginger Conditioner 500ml\n35. Augeas Ginger Shampoo 500ml\n36. Augeas Olive Shampoo 500ml\n37. Augeas Olive Conditioner\n38. Hair Soften Essence Hair Capsule 60pcs\n39. Augeas So Easy Hair 180ml\n40. Carthaea Hair Straightening 800ml\n41. Augeas Hair Straightening 100ml\n42. ENZO Hair Mask 1000ml\n43. Jiessia Shower Gel 750ml\n44. Johnny Andrean Styling Cream\n45. Anti-Dandruff Hair Cream 500ml\n46. BC & Care Shampoo 5L`);
  await sendButtons(from, `For orders or enquiries contact us directly.`, [{ id: backId, title: 'Back to products' }, { id: 'main_menu', title: 'Main menu' }]);
}

async function showProdSkinCare(from, backId) {
  await sendText(from, `🧴 *Skin Care Products:*\n\n1. Beauty Track Lemon Facial Cleanser 225ml\n2. Beauty Track Gold Bleach 300g\n3. Beauty Track Diamond Bleach 300g`);
  await sendButtons(from, `For orders or enquiries contact us directly.`, [{ id: backId, title: 'Back to products' }, { id: 'main_menu', title: 'Main menu' }]);
}

async function showProdScrubs(from, backId) {
  await sendText(from, `🧼 *Scrubs & Massage Creams:*\n\n1. Face & Body Scrub Gold 500ml\n2. Face & Body Scrub Lemon 500ml\n3. Face & Body Scrub Mix Fruit 500ml\n4. Face & Body Scrub Whitening 500ml\n5. Face Massage Cream Coconut 500ml\n6. Face Massage Cream Milk & Honey 500ml\n7. Mud Mask Neem & Mint 500ml\n8. Mud Mask Saffron 500ml`);
  await sendButtons(from, `For orders or enquiries contact us directly.`, [{ id: backId, title: 'Back to products' }, { id: 'main_menu', title: 'Main menu' }]);
}

async function showProdFacialKits(from, backId) {
  await sendText(from, `✨ *Facial Kits:*\n\n1. Beauty Track 24K Gold Facial Kit 1100ml\n2. Beauty Track D-Tan Vitamin-C Facial Kit 1100ml`);
  await sendButtons(from, `For orders or enquiries contact us directly.`, [{ id: backId, title: 'Back to products' }, { id: 'main_menu', title: 'Main menu' }]);
}

async function showProdWax(from, backId) {
  await sendText(from, `🪮 *Wax Products:*\n\n1. Augeas Hair Wax Blue 130g\n2. Augeas Hair Wax Green 130g\n3. Augeas Hair Wax Purple 130g\n4. Augeas Hair Wax Red 130g\n5. Augeas Hair Wax Yellow 130g`);
  await sendButtons(from, `For orders or enquiries contact us directly.`, [{ id: backId, title: 'Back to products' }, { id: 'main_menu', title: 'Main menu' }]);
}

async function showProdTools(from, backId) {
  await sendText(from, `🔧 *Tools & Equipment:*\n\n1. 2-in-1 Head Steamer – Hair and Facial Care\n2. Head Steamer\n3. Facial Steamer LQ-08\n4. Facial Steamer Glass\n5. Hydra Facial Machine\n6. Barber Chair Black YN-05\n7. Barber Chair Gold YN-7A\n8. Barber Chair Mat\n9. Barber Chair Jack\n10. Beauty Track Hair Trimmer\n11. Beauty Track Hair Clipper\n12. Yandu Shaver\n13. Water Shower Elegant Style Black\n14. Water Shower H20\n15. Water Shower Plastic Gold\n16. Water Shower Plastic Slim Silver\n17. Plastic Hair Clips\n18. Hair Comb 8135\n19. African Comb\n20. Hair Round Brush`);
  await sendButtons(from, `For orders or enquiries contact us directly.`, [{ id: backId, title: 'Back to products' }, { id: 'main_menu', title: 'Main menu' }]);
}

// ═══════════════════════════════════════════════════════
// LADIES
// ═══════════════════════════════════════════════════════
async function showLadiesMain(from) {
  await sendListMessage(from,
    `Welcome to Madina Ladies Saloon!\nPlease choose an option:`,
    'View options',
    [{ title: 'Ladies Saloon', rows: [
      { id: 'ladies_services',     title: 'Services',           description: 'View all services & prices' },
      { id: 'ladies_appointments', title: 'Appointments',        description: 'Book an appointment' },
      { id: 'ladies_location',     title: 'Locations & Timing',  description: 'Find our branches' },
      { id: 'ladies_products',     title: 'Products',            description: 'View our products' },
      { id: 'ladies_offers',       title: 'Offers',              description: 'Special packages & deals' },
    ]}]
  );
}

async function showLadiesServices(from) {
  await sendListMessage(from, 'Select a service category:', 'Choose service',
    [{ title: 'Ladies Services', rows: [
      { id: 'l_threading', title: 'Threading',  description: 'Upper lips, eyebrow, full face' },
      { id: 'l_waxing',    title: 'Waxing',     description: 'Full body, arms, bikini' },
      { id: 'l_hair',      title: 'Hair',       description: 'Cut, spa, keratin, botox' },
      { id: 'l_facial',    title: 'Facial',     description: 'Hydra, gold, diamond facials' },
      { id: 'l_body',      title: 'Body Care',  description: 'Moroccan bath, massage, bleach' },
      { id: 'l_nails',     title: 'Nails',      description: 'Manicure, pedicure, gellish' },
      { id: 'l_henna',     title: 'Henna',      description: 'Hands & hair henna' },
    ]}]
  );
}

async function showLadiesThreading(from) {
  await sendButtons(from,
    `🧵 *Threading:*\n\n• Upper Lips: 5 AED\n• Chin: 5 AED\n• Eyebrow: 10 AED\n• Full Face (+Neck): 30 AED`,
    [{ id: 'ladies_appointments', title: 'Book appointment' }, { id: 'ladies_services', title: 'Back' }, { id: 'main_menu', title: 'Main menu' }]
  );
}

async function showLadiesWaxing(from) {
  await sendText(from, `🪮 *Waxing:*\n\n• Upper Lips: 10 AED\n• Chin: 10 AED\n• Eyebrows: 15 AED\n• Under Arms: 20 AED\n• Full Face (+Neck): 40 AED\n• Half Arms: 25 AED / Full Arms: 40 AED\n• Half Legs: 30 AED / Full Legs: 50 AED\n• Bikini Wax: 50 AED\n• Full Body Waxing: 150 AED\n• Back: 40 AED\n• Stomach: 30 AED`);
  await sendButtons(from, `Ready to book?`, [{ id: 'ladies_appointments', title: 'Book appointment' }, { id: 'ladies_services', title: 'Back' }, { id: 'main_menu', title: 'Main menu' }]);
}

async function showLadiesHair(from) {
  await sendText(from, `💇‍♀️ *Hair Services:*\n\n• Hair Cut (Normal): 10 AED\n• Stylish Hair Cut with Wash: 30 AED\n• Hair Spa: 30 AED\n• Hot Oil: 30 AED\n• Wash & Dry: 20 AED\n• Blow Dry: 15 AED\n• Roots Colour: 40 AED\n• Protein (Any Length): 250 AED\n• Keratin (Any Length): 300 AED\n• Rebonding (Any Length): 250 AED\n• Botox (Any Length): 300 AED\n• Hair Style: 30 AED`);
  await sendButtons(from, `Ready to book?`, [{ id: 'ladies_appointments', title: 'Book appointment' }, { id: 'ladies_services', title: 'Back' }, { id: 'main_menu', title: 'Main menu' }]);
}

async function showLadiesFacial(from) {
  await sendText(from, `🧴 *Facial Services:*\n\n• Hydra Facial: 200 AED\n• Eyelashes (Extension): 100 AED\n• Glow Facial: 100 AED\n• Diamond Facial: 150 AED\n• Pearl Facial: 150 AED\n• Fruits Facial: 160 AED\n• Gold Facial: 180 AED\n• Full Face Bleach: 30 AED`);
  await sendButtons(from, `Ready to book?`, [{ id: 'ladies_appointments', title: 'Book appointment' }, { id: 'ladies_services', title: 'Back' }, { id: 'main_menu', title: 'Main menu' }]);
}

async function showLadiesBody(from) {
  await sendText(from, `🛁 *Body Care:*\n\n• Head Massage + Arm + Shoulder: 40 AED\n• Moroccan Bath: 80 AED\n• Full Body Bleach: 100 AED\n• Body Polishing + Moroccan Bath: 150 AED`);
  await sendButtons(from, `Ready to book?`, [{ id: 'ladies_appointments', title: 'Book appointment' }, { id: 'ladies_services', title: 'Back' }, { id: 'main_menu', title: 'Main menu' }]);
}

async function showLadiesNails(from) {
  await sendText(from, `💅 *Nails:*\n\n• Manicure: 30 AED\n• Pedicure: 40 AED\n• Manicure with Gellish: 80 AED\n• Pedicure with Gellish: 80 AED\n• Foot Spa: 30 AED\n• Nail Hard Gellish: 250 AED\n• Paraffin (Hand): 30 AED\n• Paraffin (Feet): 30 AED\n• Acrylic Nails: 200 AED`);
  await sendButtons(from, `Ready to book?`, [{ id: 'ladies_appointments', title: 'Book appointment' }, { id: 'ladies_services', title: 'Back' }, { id: 'main_menu', title: 'Main menu' }]);
}

async function showLadiesHenna(from) {
  await sendText(from, `🌿 *Henna:*\n\n• Hands Henna: 25 AED\n• Hands & Elbow Henna: 40 AED\n• Henna for Hair (Black & Brown): 40 AED`);
  await sendButtons(from, `Ready to book?`, [{ id: 'ladies_appointments', title: 'Book appointment' }, { id: 'ladies_services', title: 'Back' }, { id: 'main_menu', title: 'Main menu' }]);
}

async function showLadiesApptServices(from) {
  await setState(from, 'IDLE', { type: 'Ladies', services: [] });
  await sendListMessage(from,
    `📋 *Book Appointment - Ladies Saloon*\n\nSelect your first service.\nYou can add multiple services!`,
    'Choose service',
    [
      { title: 'Beauty Services', rows: [
        { id: 'la_threading', title: 'Threading',          description: 'From 5 AED' },
        { id: 'la_waxing',    title: 'Waxing',             description: 'From 10 AED' },
        { id: 'la_haircut',   title: 'Hair Cut',           description: 'From 10 AED' },
        { id: 'la_hairspa',   title: 'Hair Spa / Hot Oil', description: '30 AED' },
        { id: 'la_keratin',   title: 'Keratin',            description: 'Any Length - 300 AED' },
        { id: 'la_botox',     title: 'Botox',              description: 'Any Length - 300 AED' },
        { id: 'la_rebond',    title: 'Rebonding',          description: 'Any Length - 250 AED' },
        { id: 'la_facial',    title: 'Facial',             description: 'From 100 AED' },
        { id: 'la_body',      title: 'Body Care',          description: 'From 40 AED' },
        { id: 'la_nails',     title: 'Nails',              description: 'From 30 AED' },
        { id: 'la_henna',     title: 'Henna',              description: 'From 25 AED' },
      ]},
      { title: 'Package Offers', rows: [
        { id: 'la_combo',  title: 'Combo Offers',    description: 'Multiple combo deals' },
        { id: 'la_bday',   title: 'Birthday Offer',  description: 'Any 10 services - 100 AED' },
        { id: 'la_pkg120', title: 'Package 120 AED', description: 'Head Massage+Face Wax+Fruit Facial' },
        { id: 'la_pkg150', title: 'Package 150 AED', description: 'Mani+Pedi+Moroccan Bath+Massage' },
      ]}
    ]
  );
}

async function showLadiesApptServicesMore(from) {
  await sendListMessage(from, `Add another service:`, 'Choose service',
    [
      { title: 'Beauty Services', rows: [
        { id: 'la_threading', title: 'Threading',          description: 'From 5 AED' },
        { id: 'la_waxing',    title: 'Waxing',             description: 'From 10 AED' },
        { id: 'la_haircut',   title: 'Hair Cut',           description: 'From 10 AED' },
        { id: 'la_hairspa',   title: 'Hair Spa / Hot Oil', description: '30 AED' },
        { id: 'la_keratin',   title: 'Keratin',            description: 'Any Length - 300 AED' },
        { id: 'la_botox',     title: 'Botox',              description: 'Any Length - 300 AED' },
        { id: 'la_rebond',    title: 'Rebonding',          description: 'Any Length - 250 AED' },
        { id: 'la_facial',    title: 'Facial',             description: 'From 100 AED' },
        { id: 'la_body',      title: 'Body Care',          description: 'From 40 AED' },
        { id: 'la_nails',     title: 'Nails',              description: 'From 30 AED' },
        { id: 'la_henna',     title: 'Henna',              description: 'From 25 AED' },
      ]},
      { title: 'Package Offers', rows: [
        { id: 'la_combo',  title: 'Combo Offers',    description: 'Multiple combo deals' },
        { id: 'la_bday',   title: 'Birthday Offer',  description: 'Any 10 services - 100 AED' },
        { id: 'la_pkg120', title: 'Package 120 AED', description: 'Head Massage+Face Wax+Fruit Facial' },
        { id: 'la_pkg150', title: 'Package 150 AED', description: 'Mani+Pedi+Moroccan Bath+Massage' },
      ]}
    ]
  );
}

async function showLadiesApptBranches(from) {
  const fresh = await getSession(from);
  const services = fresh.data?.services || [];
  const servicesList = services.map((s, i) => `${i + 1}. ${s}`).join('\n');
  await sendText(from, `✅ *Services confirmed:*\n${servicesList}\n\nNow select your preferred branch:`);
  await sendButtons(from, `Choose your branch:`,
    [
      { id: 'l_branch_muteena', title: 'Muteena' },
      { id: 'l_branch_dip',     title: 'DIP-2' },
    ]
  );
}

async function showLadiesLocations(from) {
  await sendButtons(from, `📍 *Ladies Saloon Locations:*\n\nSelect your branch to view address:`,
    [{ id: 'l_loc_muteena', title: 'Muteena' }, { id: 'l_loc_dip', title: 'DIP-2' }]
  );
}

async function showLadiesLocMuteena(from) {
  await sendText(from, `📍 *Ladies - Muteena Branch:*\n\n*Shop #1*\nMuteena Park 01, Next to Nasrin Cafe, Deira, Dubai UAE\nhttps://maps.app.goo.gl/2iBeusQFMUcQwYi29`);
  await sendButtons(from, `⏰ Timing: 9:00 AM - 10:00 PM\n📅 Open 7 days a week`, [{ id: 'ladies_location', title: 'Back to locations' }, { id: 'main_menu', title: 'Main menu' }]);
}

async function showLadiesLocDip(from) {
  await sendText(from, `📍 *Ladies - DIP-2 Branch:*\n\n*Shop #2*\nThe Town Mall (Mango Market), DIP 02, Dubai, UAE\nhttps://share.google/G3ssFpSGb2uDa2aBt`);
  await sendButtons(from, `⏰ Timing: 9:00 AM - 10:00 PM\n📅 Open 7 days a week`, [{ id: 'ladies_location', title: 'Back to locations' }, { id: 'main_menu', title: 'Main menu' }]);
}

async function showLadiesProducts(from) {
  await sendListMessage(from, '🛍️ Select a product category:', 'View products',
    [{ title: 'Product Categories', rows: [
      { id: 'lprod_hair',   title: 'Hair Care Products',      description: 'Shampoo, conditioner, oils' },
      { id: 'lprod_skin',   title: 'Skin Care Products',      description: 'Cleansers, bleach' },
      { id: 'lprod_scrubs', title: 'Scrubs & Massage Creams', description: 'Face & body scrubs' },
      { id: 'lprod_facial', title: 'Facial Kits',             description: 'Gold, vitamin C kits' },
      { id: 'lprod_wax',    title: 'Wax Products',            description: 'Hair wax range' },
      { id: 'lprod_tools',  title: 'Tools & Equipment',       description: 'Chairs, clippers, steamers' },
    ]}]
  );
}

async function showLadiesOffers(from) {
  await sendText(from, `🔥 *Ladies Combo Offers:*\n\n• Hair Cutting + Free Iron: 10 AED\n• Iron + Eyebrow: 10/10 AED\n• Hair Spa / Hot Oil + Free Head Wash + Hair Dry: 30 AED\n• Color + Free Iron: 40 AED\n• Eyelash Curly + Free Eyebrow Threading: 50 AED\n• Half Legs Wax + Free Underarm Waxing: 50 AED\n• Manicure Pedicure + Free Foot Spa: 60 AED\n• Rebonding + Free Hair Trimming: 250 AED\n• Protein + Hair Trimming + Free Peel Off Mask: 250 AED\n• Botox + Free Hair Trimming + Free Black Mask: 300 AED\n• Keratin + Free Hair Trimming + Free Black Mask: 300 AED\n• Moroccan Bath + Manicure Pedicure: 110 AED`);
  await sendText(from, `🎂 *Birthday Offer — Any 10 Services for 100 AED:*\n\nChoose any 10 from:\nHalf Leg Wax • Eyebrow Threading • Half Arm Wax • Upper Lip Threading • Under Arm Wax • Full Face Threading • Hand Henna • D Tan • Special Facial • Manicure Pedicure • Hair Spa • Eyebrow Color • Hair Cutting • Head Massage (5 min) • Hair Style • Hair Ironing • Body Massage • Hair Curl • Hand Spa • Foot Spa • Face Tan • Bleach\n\n📦 *Package 120 AED:*\nHead & Neck Massage + Full Face Waxing + Fruit Facial\n\n📦 *Package 150 AED:*\nManicure & Pedicure + Moroccan Bath + Body Massage (20 mins)`);
  await sendButtons(from, `Tap below to book any offer:`, [{ id: 'ladies_appointments', title: 'Book now' }, { id: 'ladies_main', title: 'Back to menu' }, { id: 'main_menu', title: 'Main menu' }]);
}

// ═══════════════════════════════════════════════════════
// SHARED APPOINTMENT FLOW
// ═══════════════════════════════════════════════════════
async function saveBranch(from, branch) {
  const fresh = await getSession(from);
  const newData = { ...fresh.data, branch };
  await setState(from, 'AWAIT_NAME', newData);
  await sendText(from, `Please enter your *Name*:`);
}

async function showTimeSlots(from) {
  await sendListMessage(from,
    `Select your preferred time slot:\n⏰ Available: 09 AM - 10 PM`,
    'Choose time',
    [{ title: 'Available Time Slots', rows: [
      { id: 'time_9_10',   title: '09-10 AM', description: 'Morning' },
      { id: 'time_10_11',  title: '10-11 AM', description: 'Morning' },
      { id: 'time_11_12',  title: '11-12 PM', description: 'Late morning' },
      { id: 'time_12_1',   title: '12-01 PM', description: 'Afternoon' },
      { id: 'time_1_2',    title: '01-02 PM', description: 'Afternoon' },
      { id: 'time_2_3',    title: '02-03 PM', description: 'Afternoon' },
      { id: 'time_3_4',    title: '03-04 PM', description: 'Afternoon' },
      { id: 'time_4_5',    title: '04-05 PM', description: 'Evening' },
      { id: 'time_5_6',    title: '05-06 PM', description: 'Evening' },
      { id: 'time_6_7',    title: '06-07 PM', description: 'Evening' },
      { id: 'time_7_8',    title: '07-08 PM', description: 'Evening' },
      { id: 'time_8_9',    title: '08-09 PM', description: 'Evening' },
      { id: 'time_9_10pm', title: '09-10 PM', description: 'Night' },
    ]}]
  );
}

async function saveTime(from, time) {
  const fresh = await getSession(from);
  const { name, branch, type, services } = fresh.data || {};
  const servicesList = (services || []).join(', ');
  const branchAddress = BRANCH_ADDRESSES[branch] || branch;
  await setState(from, 'IDLE', {});
  await saveLead({
    phone: from,
    name: name || 'Unknown',
    business_type: 'SALON',
    service: servicesList || type || 'Saloon',
    address: branch,
    booking_date: time,
    status: 'new',
    raw_data: { name, branch, time, type, services, phone: from }
  });
  const servicesDisplay = (services || []).map((s, i) => `   ${i + 1}. ${s}`).join('\n');
  await sendText(from,
    `✅ *Appointment Confirmed!*\n\n` +
    `📌 *Name:* ${name}\n` +
    `💇 *Services:*\n${servicesDisplay}\n` +
    `📍 *Branch:* ${branch}\n` +
    `🏠 *Address:* ${branchAddress}\n` +
    `⏰ *Time:* ${time}\n\n` +
    `Please arrive 15 minutes early.\n\n` +
    `Thank you for choosing Madina Saloon! 🙏`
  );
  setTimeout(async () => { await showWelcome(from); }, 2000);
}

// ─── API helpers ───────────────────────────────────────
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
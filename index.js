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

async function handleButton(from, id, session) {
  if (id === 'gents_main')  return showGentsMain(from);
  if (id === 'ladies_main') return showLadiesMain(from);

  if (id === 'gents_services')     return showGentsServices(from);
  if (id === 'gents_appointments') return showGentsAppointmentServices(from, session);
  if (id === 'gents_location')     return showGentsLocations(from);
  if (id === 'gents_products')     return showGentsProducts(from);
  if (id === 'gents_offers')       return showGentsOffers(from);

  if (id === 'g_hair')      return showGentsHair(from);
  if (id === 'g_straight')  return showGentsStraightening(from);
  if (id === 'g_facial')    return showGentsFacial(from);
  if (id === 'g_manicure')  return showGentsManicure(from);
  if (id === 'g_threading') return showGentsThreading(from);

  if (id === 'appt_hair')      return saveApptService(from, session, 'Hair Cut & Coloring');
  if (id === 'appt_straight')  return saveApptService(from, session, 'Hair Straightening');
  if (id === 'appt_facial')    return saveApptService(from, session, 'Facial & Bleaching');
  if (id === 'appt_manicure')  return saveApptService(from, session, 'Manicure & Pedicure');
  if (id === 'appt_threading') return saveApptService(from, session, 'Threading & Waxing');

  if (id === 'loc_horAlAnz')   return showLocHorAlAnz(from);
  if (id === 'loc_muteena')    return showLocMuteena(from);
  if (id === 'loc_satwa')      return showLocSatwa(from);
  if (id === 'loc_jebelAli')   return showLocJebelAli(from);
  if (id === 'loc_dip')        return showLocDip(from);
  if (id === 'loc_muhaisnah')  return showLocMuhaisnah(from);
  if (id === 'loc_alQusais')   return showLocAlQusais(from);
  if (id === 'loc_sharjah')    return showLocSharjah(from);

  if (id === 'g_branch_horAlAnz')  return saveBranch(from, session, 'Hor Al Anz');
  if (id === 'g_branch_muteena')   return saveBranch(from, session, 'Muteena');
  if (id === 'g_branch_satwa')     return saveBranch(from, session, 'Al Satwa');
  if (id === 'g_branch_jebelAli')  return saveBranch(from, session, 'Jebel Ali');
  if (id === 'g_branch_dip')       return saveBranch(from, session, 'DIP-2');
  if (id === 'g_branch_muhaisnah') return saveBranch(from, session, 'Al Muhaisnah');
  if (id === 'g_branch_alQusais')  return saveBranch(from, session, 'Al Qusais');
  if (id === 'g_branch_sharjah')   return saveBranch(from, session, 'Sharjah');

  if (id === 'prod_hair')     return showProdHairCare(from);
  if (id === 'prod_skin')     return showProdSkinCare(from);
  if (id === 'prod_scrubs')   return showProdScrubs(from);
  if (id === 'prod_facial')   return showProdFacialKits(from);
  if (id === 'prod_wax')      return showProdWax(from);
  if (id === 'prod_tools')    return showProdTools(from);

  if (id === 'ladies_services')     return showLadiesServices(from);
  if (id === 'ladies_appointments') return showLadiesBranches(from, session);
  if (id === 'ladies_location')     return showLadiesLocation(from);
  if (id === 'ladies_products')     return showLadiesProducts(from);
  if (id === 'ladies_offers')       return showLadiesOffers(from);

  if (id === 'l_threading') return showLadiesThreading(from);
  if (id === 'l_waxing')    return showLadiesWaxing(from);
  if (id === 'l_hair')      return showLadiesHair(from);
  if (id === 'l_facial')    return showLadiesFacial(from);
  if (id === 'l_body')      return showLadiesBody(from);
  if (id === 'l_nails')     return showLadiesNails(from);
  if (id === 'l_henna')     return showLadiesHenna(from);

  if (id === 'l_branch_muteena') return saveBranch(from, session, 'Ladies - Muteena');
  if (id === 'l_branch_dip')     return saveBranch(from, session, 'Ladies - DIP');

  if (id === 'time1') return saveTime(from, session, '09-10 AM');
  if (id === 'time2') return saveTime(from, session, '10-11 AM');
  if (id === 'time3') return saveTime(from, session, '11-12 PM');
  if (id === 'time4') return saveTime(from, session, '12-01 PM');
}

async function handleText(from, text, session) {
  const lower = text.toLowerCase();
  if (['hi', 'hello', 'hey', 'start', 'menu', 'hii'].includes(lower)) {
    return showWelcome(from);
  }
  const { state, data } = session;
  if (state === 'AWAIT_NAME') {
    const newData = { ...data, name: text };
    await setState(from, 'SELECT_TIME', newData);
    return showTimeSlots(from);
  }
  return showWelcome(from);
}

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

async function showGentsMain(from) {
  await sendListMessage(from,
    `Welcome to Madina Gents Saloon!\nPlease choose an option:`,
    'View options',
    [{
      title: 'Gents Saloon',
      rows: [
        { id: 'gents_services',     title: 'Services',           description: 'View all services & prices' },
        { id: 'gents_appointments', title: 'Appointments',        description: 'Book an appointment' },
        { id: 'gents_location',     title: 'Locations & Timing',  description: 'Find our branches' },
        { id: 'gents_products',     title: 'Products',            description: 'View our products' },
        { id: 'gents_offers',       title: 'Offers',              description: 'Special packages & deals' },
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
        { id: 'g_manicure',  title: 'Manicure & Pedicure',  description: 'Full service 30 AED' },
        { id: 'g_threading', title: 'Threading & Waxing',   description: 'Threading & waxing options' },
      ]
    }]
  );
}

async function showGentsHair(from) {
  await sendButtons(from,
    `✂️ *Hair Cut & Coloring:*\n\n• Hair Cutting: 5 AED\n• Shaving / Beard Trimming: 5 AED\n• Hair Coloring (Free Head Wash):\n  - 10 AED\n  - 15 AED\n  - 20 AED\n  - 25 AED`,
    [{ id: 'gents_appointments', title: 'Book appointment' }, { id: 'gents_services', title: 'Back' }]
  );
}

async function showGentsStraightening(from) {
  await sendButtons(from,
    `✨ *Hair Straightening & Treatments:*\n\n• Hair Spa: 15 AED\n• Hair Straightening: 25 AED\n• Hair Botox Treatment: 100 AED\n• Hair Keratin Treatment: 80 AED\n• Hair Protein Treatment: 80 AED\n• Hair Smoothing & Rebonding: 80 AED`,
    [{ id: 'gents_appointments', title: 'Book appointment' }, { id: 'gents_services', title: 'Back' }]
  );
}

async function showGentsFacial(from) {
  await sendButtons(from,
    `🧴 *Facial & Bleaching:*\n\n• Face Facial: 30 AED\n• Facial with Collagen Mask: 40 AED\n• Face Massage: 10 AED\n• Face + Neck Bleaching: 20 AED\n• Face Scrub: 5 AED\n• Nose Strip: 5 AED\n• Black Mask: 10 AED\n• Jelly Mask: 15 AED`,
    [{ id: 'gents_appointments', title: 'Book appointment' }, { id: 'gents_services', title: 'Back' }]
  );
}

async function showGentsManicure(from) {
  await sendButtons(from,
    `💅 *Manicure & Pedicure:*\n\n• Manicure & Pedicure: 30 AED`,
    [{ id: 'gents_appointments', title: 'Book appointment' }, { id: 'gents_services', title: 'Back' }]
  );
}

async function showGentsThreading(from) {
  await sendButtons(from,
    `🧵 *Threading & Waxing:*\n\n• Full Face Threading: 5 AED\n• Hand Waxing: 10 AED\n• Under Arm Wax: 15 AED\n• Full Arm Wax: 40 AED\n• Half Arm Wax: 20 AED\n• Chest Wax: 50 AED\n• Face Wax: 10 AED\n• Nose Wax: 3 AED`,
    [{ id: 'gents_appointments', title: 'Book appointment' }, { id: 'gents_services', title: 'Back' }]
  );
}

async function showGentsAppointmentServices(from, session) {
  await setState(from, 'IDLE', { ...session.data, type: 'Gents' });
  await sendListMessage(from,
    'Please select the service you want to book:',
    'Choose service',
    [{
      title: 'Gents Services',
      rows: [
        { id: 'appt_hair',      title: 'Hair Cut & Coloring',  description: 'Cuts, shaving, coloring' },
        { id: 'appt_straight',  title: 'Hair Straightening',   description: 'Keratin, botox, protein' },
        { id: 'appt_facial',    title: 'Facial & Bleaching',   description: 'Facials, massage, scrubs' },
        { id: 'appt_manicure',  title: 'Manicure & Pedicure',  description: 'Full service 30 AED' },
        { id: 'appt_threading', title: 'Threading & Waxing',   description: 'Threading & waxing options' },
      ]
    }]
  );
}

async function saveApptService(from, session, service) {
  await setState(from, 'IDLE', { ...session.data, service, type: 'Gents' });
  await showGentsAppointmentBranches(from);
}

async function showGentsAppointmentBranches(from) {
  await sendListMessage(from,
    'Please select your preferred branch:',
    'Choose branch',
    [{
      title: 'Our Locations',
      rows: [
        { id: 'g_branch_horAlAnz',  title: 'Hor Al Anz',   description: 'Dubai' },
        { id: 'g_branch_muteena',   title: 'Muteena',       description: 'Dubai' },
        { id: 'g_branch_satwa',     title: 'Al Satwa',      description: 'Dubai' },
        { id: 'g_branch_jebelAli',  title: 'Jebel Ali',     description: 'Dubai' },
        { id: 'g_branch_dip',       title: 'DIP-2',         description: 'Dubai' },
        { id: 'g_branch_muhaisnah', title: 'Al Muhaisnah',  description: 'Dubai' },
        { id: 'g_branch_alQusais',  title: 'Al Qusais',     description: 'Dubai' },
        { id: 'g_branch_sharjah',   title: 'Sharjah',       description: 'Sharjah' },
      ]
    }]
  );
}

async function showGentsLocations(from) {
  await sendListMessage(from,
    '📍 Select your area to view branch details:',
    'Choose area',
    [{
      title: 'Our Areas',
      rows: [
        { id: 'loc_horAlAnz',  title: 'Hor Al Anz',   description: 'Dubai' },
        { id: 'loc_muteena',   title: 'Muteena',       description: 'Dubai' },
        { id: 'loc_satwa',     title: 'Al Satwa',      description: 'Dubai' },
        { id: 'loc_jebelAli',  title: 'Jebel Ali',     description: 'Dubai' },
        { id: 'loc_dip',       title: 'DIP-2',         description: 'Dubai' },
        { id: 'loc_muhaisnah', title: 'Al Muhaisnah',  description: 'Dubai' },
        { id: 'loc_alQusais',  title: 'Al Qusais',     description: 'Dubai' },
        { id: 'loc_sharjah',   title: 'Sharjah',       description: 'Sharjah' },
      ]
    }]
  );
}

async function showLocSatwa(from) {
  await sendText(from,
    `📍 *Al Satwa Branches:*\n\n` +
    `*Branch 1*\nShop No#3, Al Tayer Building, Al Satwa, Dubai\nhttps://maps.app.goo.gl/GfHgwnnrjetWrpcn8\n\n` +
    `*Branch 2*\nShop No#9, Satwa RoundAbout, Near Public Kitchen, Al Satwa, Dubai\nhttps://maps.app.goo.gl/9FigxGSPThy7m8XW7\n\n` +
    `*Branch 3*\nShop No#4, Near Qadri Masjid, Al Satwa, Dubai\nhttps://maps.app.goo.gl/cTj7o8D8cFUYuvQE9\n\n` +
    `*Branch 4*\nShop No#6-7, Al Satwa, Dubai\nhttps://maps.app.goo.gl/EVvb7jhqTfNnP8jh9\n\n` +
    `*Branch 5*\nShop No#18, Satwa Star Building, Al Satwa, Dubai\nhttps://maps.app.goo.gl/w5NouJjsimvbXUu76`
  );
  await sendText(from,
    `*Branch 6*\nShop No#03, Opposite Pak Special Restaurant, Al Jafliya, Dubai\nhttps://maps.app.goo.gl/wEgfsaDbKKEPjuc28\n\n` +
    `*Branch 7*\nShop No#2, Near ENBD ATM, Al Jafliya, Dubai\nhttps://maps.app.goo.gl/NsUS3Spdo4M8YyQG6\n\n` +
    `*Branch 8*\nShop No#1, Satwa RoundAbout, Opposite Aura Fakhree Centre, Al Jafliya, Dubai\nhttps://maps.app.goo.gl/5GKY8UcY94Fer1re9\n\n` +
    `*Branch 9*\nShop No#3, Next to Pak Sweet Cafe, Satwa, Dubai\nhttps://maps.app.goo.gl/RPoojirjxhYujmRUA\n\n` +
    `*Branch 10*\nShop No#12, Near ENBD ATM, Al Jafliya, Dubai`
  );
  await sendButtons(from, `⏰ Timing: 9:00 AM - 10:00 PM\n📅 Open 7 days a week`, [{ id: 'gents_location', title: 'Back to areas' }]);
}

async function showLocJebelAli(from) {
  await sendText(from,
    `📍 *Jebel Ali Branches:*\n\n` +
    `*Branch 1*\nShop#2, Near Haji Cafe, Mina Jebel Ali, Industrial 1, Dubai\nhttps://maps.app.goo.gl/MQPEXPXdteAhpx7Y7\n\n` +
    `*Branch 2*\nSt 95, Jebel Ali Industrial Area, Opposite ENOC Warehouse, Dubai\nhttps://maps.app.goo.gl/B71Z8dsRs5SdrjN36\n\n` +
    `*Branch 3*\nPlot 509-109, Jebel Ali Industrial Area, Dubai\nhttps://maps.app.goo.gl/s9onDQTJFZahueWu7\n\n` +
    `*Branch 4*\nInside Build Well Building, Jebel Ali Industrial Area 1, Dubai\nhttps://maps.app.goo.gl/3nN1iP5q3H1WmLs68\n\n` +
    `*Branch 5*\nInside Jebel Ali Mall, Jebel Ali Industrial Area, Dubai\nhttps://maps.app.goo.gl/PXbGdS7uqLbibCmA6`
  );
  await sendText(from,
    `*Branch 6*\nNear Parsons Mall, Mina Jebel Ali, Dubai\nhttps://maps.app.goo.gl/n4xwVBZs6HVFamB58\n\n` +
    `*Branch 7*\nNear Lifeguard General Clinic, Mina Jebel Ali, Dubai\nhttps://maps.app.goo.gl/pmNU48u3BDUFa2Mr9\n\n` +
    `*Branch 8*\nPlot 509-109, Jebel Ali Industrial Area, Dubai\nhttps://maps.app.goo.gl/i8F62JCKu9WWnTj76\n\n` +
    `*Branch 9*\nNear Emirates Flight Catering, Mina Jebel Ali, Dubai\nhttps://maps.app.goo.gl/QUv7nZV3cmQmPRKW6`
  );
  await sendButtons(from, `⏰ Timing: 9:00 AM - 10:00 PM\n📅 Open 7 days a week`, [{ id: 'gents_location', title: 'Back to areas' }]);
}

async function showLocHorAlAnz(from) {
  await sendText(from,
    `📍 *Hor Al Anz Branches:*\n\n` +
    `*Branch 1*\nShop #1, Aysha Masjid, Hor Al Anz, Dubai\nhttps://maps.app.goo.gl/2RKywgzHcFbjtLs29\n\n` +
    `*Branch 2*\n53 34A St, Near Karachi Golden Restaurant, Hor Al Anz, Dubai\nhttps://maps.app.goo.gl/k3LtfZ5P5pvAWnPU6\n\n` +
    `*Branch 3*\n23 38A St, Kokan Plaza Building, Hor Al Anz, Dubai\nhttps://maps.app.goo.gl/LnRuijRyECanJ7dT7\n\n` +
    `*Branch 4*\nOpposite Amiruddin Clinic, Hor Al Anz, Dubai`
  );
  await sendButtons(from, `⏰ Timing: 9:00 AM - 10:00 PM\n📅 Open 7 days a week`, [{ id: 'gents_location', title: 'Back to areas' }]);
}

async function showLocMuteena(from) {
  await sendText(from,
    `📍 *Muteena Branch:*\n\n` +
    `*Branch 1*\n61 Al Mateena St, AlSerkal Building, Deira, Dubai\nhttps://maps.app.goo.gl/QSRDGRqhiryHDxa29`
  );
  await sendButtons(from, `⏰ Timing: 9:00 AM - 10:00 PM\n📅 Open 7 days a week`, [{ id: 'gents_location', title: 'Back to areas' }]);
}

async function showLocAlQusais(from) {
  await sendText(from,
    `📍 *Al Qusais Branches:*\n\n` +
    `*Branch 1*\nOpposite Dubai Residential Oasis, Al Qusais, Dubai\nhttps://maps.app.goo.gl/rL8ah8LBMiqsiEdK7\n\n` +
    `*Branch 2*\nNear Fast Link Technical Services, Damascus Street, Al Qusais Industrial Area, Dubai\nhttps://maps.app.goo.gl/GhuSoCRW7veHMKyAA\n\n` +
    `*Branch 3*\nHamad Lootah Building, Muhaisnah 4, Dubai\nhttps://maps.app.goo.gl/kzhhfUgRVxyve9gq9`
  );
  await sendButtons(from, `⏰ Timing: 9:00 AM - 10:00 PM\n📅 Open 7 days a week`, [{ id: 'gents_location', title: 'Back to areas' }]);
}

async function showLocMuhaisnah(from) {
  await sendText(from,
    `📍 *Al Muhaisnah Branches:*\n\n` +
    `*Branch 1*\nNear Qaser Al Muhaisnah Restaurant, 26 18th St, Muhaisanah 2, Dubai\nhttps://maps.app.goo.gl/sec1WspDaag798TF6\n\n` +
    `*Branch 2*\nNear Manar Al Madeena Supermarket, Pepco Engineering Building, Muhaisnah, Dubai\nhttps://maps.app.goo.gl/JKowGgWKVqopTwSK9\n\n` +
    `*Branch 3*\nNear Gospel Camp, Muhaisanah 2, Dubai\nhttps://maps.app.goo.gl/X1w6QLFspBPwmEUTA`
  );
  await sendButtons(from, `⏰ Timing: 9:00 AM - 10:00 PM\n📅 Open 7 days a week`, [{ id: 'gents_location', title: 'Back to areas' }]);
}

async function showLocDip(from) {
  await sendText(from,
    `📍 *DIP-2 Branches:*\n\n` +
    `*Branch 1*\nTown Mall, 11 17 Street, Dubai Investment Park 2, Dubai\nhttps://maps.app.goo.gl/6xTR4R8DJ3gbQFu47\n\n` +
    `*Branch 2*\nAl Suwaid Staff Accommodation, Dubai Investment Park 2, Dubai\nhttps://maps.app.goo.gl/NMw5u1xSpbVRMC1m6\n\n` +
    `*Branch 3*\nRuman Market, Near AXA Mall, Dubai Investment Park 2, Dubai\nhttps://maps.app.goo.gl/Lddkxek9xqntLxh1A\n\n` +
    `*Branch 4*\nShop No#5, Backside Parsons, Galadari Mall, DIP-2, Dubai\nhttps://maps.app.goo.gl/PdHscRBqmc4d68mx7`
  );
  await sendButtons(from, `⏰ Timing: 9:00 AM - 10:00 PM\n📅 Open 7 days a week`, [{ id: 'gents_location', title: 'Back to areas' }]);
}

async function showLocSharjah(from) {
  await sendText(from,
    `📍 *Sharjah Branches:*\n\n` +
    `*Branch 1*\nNear Madina Market, Al Ghuwair, Sharjah\nhttps://maps.app.goo.gl/rL8ah8LBMiqsiEdK7\n\n` +
    `*Branch 2*\nShop No#06, Naseem Residency, Community Centre, Tilal City, Sharjah\nhttps://maps.app.goo.gl/jeF8bBVwtsiDMrdp8\n\n` +
    `*Branch 3*\nBeside Damas Jewellers, Rolla Bus Stand, Sharjah\nhttps://maps.app.goo.gl/cDW1WCE2sSK3DSuh7`
  );
  await sendText(from,
    `*Branch 4*\nNear Clock Tower, Al Zahra St, Al Mussalla, Sharjah\nhttps://maps.app.goo.gl/a6dDL7kvBe5UUUKL8\n\n` +
    `*Branch 5*\nAl Rolla St 12, Al Ghuwair, Hay Al Gharb, Sharjah\nhttps://maps.app.goo.gl/kmn2BqvDDcAACvaL7\n\n` +
    `*Branch 6*\nFire Station Street, Muwaileh Commercial, Industrial Area, Sharjah\nhttps://maps.app.goo.gl/ySXL4aDmEYrYtocA9`
  );
  await sendButtons(from, `⏰ Timing: 9:00 AM - 10:00 PM\n📅 Open 7 days a week`, [{ id: 'gents_location', title: 'Back to areas' }]);
}

async function showGentsProducts(from) {
  await sendListMessage(from,
    '🛍️ Select a product category:',
    'View products',
    [{
      title: 'Product Categories',
      rows: [
        { id: 'prod_hair',   title: 'Hair Care Products',       description: 'Shampoo, conditioner, oils' },
        { id: 'prod_skin',   title: 'Skin Care Products',       description: 'Cleansers, bleach' },
        { id: 'prod_scrubs', title: 'Scrubs & Massage Creams',  description: 'Face & body scrubs' },
        { id: 'prod_facial', title: 'Facial Kits',              description: 'Gold, vitamin C kits' },
        { id: 'prod_wax',    title: 'Wax Products',             description: 'Hair wax range' },
        { id: 'prod_tools',  title: 'Tools & Equipment',        description: 'Chairs, clippers, steamers' },
      ]
    }]
  );
}

async function showProdHairCare(from) {
  await sendText(from,
    `💆 *Hair Care Products:*\n\n` +
    `1. Hair Botox Keratin, Hair Serum, Shampoo & Conditioner Set\n` +
    `2. Hair Botox Shampoo & Conditioner Set\n` +
    `3. Keratin Queen Brazilian Shampoo 500ml + Protein 500ml + Conditioner 500ml\n` +
    `4. Keratin Queen Protein Brazilian Treatment 800ml\n` +
    `5. Keratin Queen Protein Brazilian Shampoo 800ml\n` +
    `6. Keratin Queen Protein Brazilian Conditioner 800ml\n` +
    `7. Keratin Queen Protein Brazilian Hair Mask 1000ml\n` +
    `8. Keratin Queen Moisturizing Brazilian Hair Oil\n` +
    `9. Beauty Track Keratin Queen Repairing & Nourishing Mask Brazil Nut 1000ml\n` +
    `10. Beauty Track Keratin Queen Hair Care Balance Hair Mask Nut 1000ml`
  );
  await sendText(from,
    `11. Keratin Queen Coffee 01 - 1000ml\n` +
    `12. Keratin Queen Coffee 02 - 1000ml\n` +
    `13. Keratin Queen Coffee 03 - 1000ml\n` +
    `14. Professional Hair Care Keratin Queen 01 - 1000ml\n` +
    `15. Professional Hair Care Keratin Queen 02 - 1000ml\n` +
    `16. Professional Hair Care Keratin Queen 03 - 1000ml\n` +
    `17. Keratin Queen Treatment Argan Hair Oil (Serum) 100ml\n` +
    `18. Augeas Keratin Deep Curl Treatment For Straight Hair\n` +
    `19. Augeas Argan Ali Hair Mask 850ml\n` +
    `20. Augeas Keratin Hair Mask 1000ml`
  );
  await sendText(from,
    `21. Keratin Creamy Hair Mask 1000ml\n` +
    `22. Vatika Hair Oil Almond 200ml\n` +
    `23. Vatika Hair Oil Garlic\n` +
    `24. Navratna Herbal Oil 300ml\n` +
    `25. Beauty Sun Queen Coconut Moisturizing Body Lotion 500ml\n` +
    `26. TCB Hair Relaxer 425g\n` +
    `27. Parachute Coconut Oil 450ml\n` +
    `28. Augeas Bleaching Powder Bag 500ml\n` +
    `29. Augeas Bleaching Powder Jar 500ml\n` +
    `30. Dexe Anti Hair Loss Shampoo 500ml`
  );
  await sendText(from,
    `31. Dexe Hair Loss Shampoo\n` +
    `32. Sofnfree Hair Relaxer 1L\n` +
    `33. Dark & Lovely Relaxer Kit\n` +
    `34. Augeas Ginger Conditioner 500ml\n` +
    `35. Augeas Ginger Shampoo 500ml\n` +
    `36. Augeas Olive Shampoo 500ml\n` +
    `37. Augeas Olive Conditioner\n` +
    `38. Hair Soften Essence Hair Capsule 60pcs\n` +
    `39. Augeas So Easy Hair 180ml\n` +
    `40. Carthaea Hair Straightening 800ml`
  );
  await sendText(from,
    `41. Augeas Hair Straightening 100ml\n` +
    `42. ENZO Hair Mask 1000ml\n` +
    `43. Jiessia Shower Gel 750ml\n` +
    `44. Johnny Andrean Styling Cream\n` +
    `45. Anti-Dandruff Hair Cream 500ml\n` +
    `46. BC & Care Shampoo 5L`
  );
  await sendButtons(from, `For orders or enquiries please contact us directly.`, [{ id: 'gents_products', title: 'Back to products' }]);
}

async function showProdSkinCare(from) {
  await sendText(from,
    `🧴 *Skin Care Products:*\n\n` +
    `1. Beauty Track Lemon Facial Cleanser 225ml\n` +
    `2. Beauty Track Gold Bleach 300g\n` +
    `3. Beauty Track Diamond Bleach 300g`
  );
  await sendButtons(from, `For orders or enquiries please contact us directly.`, [{ id: 'gents_products', title: 'Back to products' }]);
}

async function showProdScrubs(from) {
  await sendText(from,
    `🧼 *Scrubs & Massage Creams:*\n\n` +
    `1. Face & Body Scrub Gold 500ml\n` +
    `2. Face & Body Scrub Lemon 500ml\n` +
    `3. Face & Body Scrub Mix Fruit 500ml\n` +
    `4. Face & Body Scrub Whitening 500ml\n` +
    `5. Face Massage Cream Coconut 500ml\n` +
    `6. Face Massage Cream Milk & Honey 500ml\n` +
    `7. Mud Mask Neem & Mint 500ml\n` +
    `8. Mud Mask Saffron 500ml`
  );
  await sendButtons(from, `For orders or enquiries please contact us directly.`, [{ id: 'gents_products', title: 'Back to products' }]);
}

async function showProdFacialKits(from) {
  await sendText(from,
    `✨ *Facial Kits:*\n\n` +
    `1. Beauty Track 24K Gold Facial Kit 1100ml\n` +
    `2. Beauty Track D-Tan Vitamin-C Facial Kit 1100ml`
  );
  await sendButtons(from, `For orders or enquiries please contact us directly.`, [{ id: 'gents_products', title: 'Back to products' }]);
}

async function showProdWax(from) {
  await sendText(from,
    `🪮 *Wax Products:*\n\n` +
    `1. Augeas Hair Wax Blue 130g\n` +
    `2. Augeas Hair Wax Green 130g\n` +
    `3. Augeas Hair Wax Purple 130g\n` +
    `4. Augeas Hair Wax Red 130g\n` +
    `5. Augeas Hair Wax Yellow 130g`
  );
  await sendButtons(from, `For orders or enquiries please contact us directly.`, [{ id: 'gents_products', title: 'Back to products' }]);
}

async function showProdTools(from) {
  await sendText(from,
    `🔧 *Tools & Equipment:*\n\n` +
    `1. 2-in-1 Head Steamer – Hair and Facial Care\n` +
    `2. Head Steamer\n` +
    `3. Facial Steamer LQ-08\n` +
    `4. Facial Steamer Glass\n` +
    `5. Hydra Facial Machine\n` +
    `6. Barber Chair Black YN-05\n` +
    `7. Barber Chair Gold YN-7A\n` +
    `8. Barber Chair Mat\n` +
    `9. Barber Chair Jack\n` +
    `10. Beauty Track Hair Trimmer`
  );
  await sendText(from,
    `11. Beauty Track Hair Clipper\n` +
    `12. Yandu Shaver\n` +
    `13. Water Shower Elegant Style Black\n` +
    `14. Water Shower H20\n` +
    `15. Water Shower Plastic Gold\n` +
    `16. Water Shower Plastic Slim Silver\n` +
    `17. Plastic Hair Clips\n` +
    `18. Hair Comb 8135\n` +
    `19. African Comb\n` +
    `20. Hair Round Brush`
  );
  await sendButtons(from, `For orders or enquiries please contact us directly.`, [{ id: 'gents_products', title: 'Back to products' }]);
}

async function showGentsOffers(from) {
  await sendText(from,
    `🔥 *Gents Special Packages:*\n\n` +
    `💥 *25 AED Package:*\n` +
    `Hair Cut + Shaving/Beard + Full Face Wax + Head Massage + Nose Wax + Nose Strip\n\n` +
    `💥 *30 AED Package:*\n` +
    `Hair Cut + Shaving/Beard + Face Massage + Hair Color\n\n` +
    `💥 *40 AED Package:*\n` +
    `Hair Cut + Shaving/Beard + Face Facial + Head Massage`
  );
  await sendButtons(from,
    `Tap below to book any package:`,
    [{ id: 'gents_appointments', title: 'Book now' }, { id: 'gents_main', title: 'Back to menu' }]
  );
}

async function showLadiesMain(from) {
  await sendListMessage(from,
    `Welcome to Madina Ladies Saloon!\nPlease choose an option:`,
    'View options',
    [{
      title: 'Ladies Saloon',
      rows: [
        { id: 'ladies_services',     title: 'Services',           description: 'View all services & prices' },
        { id: 'ladies_appointments', title: 'Appointments',        description: 'Book an appointment' },
        { id: 'ladies_location',     title: 'Locations & Timing',  description: 'Find our branches' },
        { id: 'ladies_products',     title: 'Products',            description: 'View our products' },
        { id: 'ladies_offers',       title: 'Offers',              description: 'Special packages & deals' },
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
    `🧵 *Threading:*\n\n• Upper Lips: 5 AED\n• Chin: 5 AED\n• Eyebrow: 10 AED\n• Full Face: 30 AED`,
    [{ id: 'ladies_appointments', title: 'Book appointment' }, { id: 'ladies_services', title: 'Back' }]
  );
}

async function showLadiesWaxing(from) {
  await sendButtons(from,
    `🪮 *Waxing:*\n\n• Full Body: 150 AED\n• Underarms: 20 AED\n• Bikini: 50 AED`,
    [{ id: 'ladies_appointments', title: 'Book appointment' }, { id: 'ladies_services', title: 'Back' }]
  );
}

async function showLadiesHair(from) {
  await sendButtons(from,
    `💇‍♀️ *Hair Services:*\n\n• Hair Cut: 10 AED\n• Hair Spa: 30 AED\n• Keratin: 300 AED`,
    [{ id: 'ladies_appointments', title: 'Book appointment' }, { id: 'ladies_services', title: 'Back' }]
  );
}

async function showLadiesFacial(from) {
  await sendButtons(from,
    `🧴 *Facial:*\n\n• Hydra Facial: 200 AED\n• Gold Facial: 180 AED`,
    [{ id: 'ladies_appointments', title: 'Book appointment' }, { id: 'ladies_services', title: 'Back' }]
  );
}

async function showLadiesBody(from) {
  await sendButtons(from,
    `🛁 *Body Care:*\n\n• Moroccan Bath: 80 AED\n• Body Polish: 150 AED`,
    [{ id: 'ladies_appointments', title: 'Book appointment' }, { id: 'ladies_services', title: 'Back' }]
  );
}

async function showLadiesNails(from) {
  await sendButtons(from,
    `💅 *Nails:*\n\n• Manicure: 30 AED\n• Pedicure: 40 AED`,
    [{ id: 'ladies_appointments', title: 'Book appointment' }, { id: 'ladies_services', title: 'Back' }]
  );
}

async function showLadiesHenna(from) {
  await sendButtons(from,
    `🌿 *Henna:*\n\n• Hands: 25 AED\n• Hair Henna: 40 AED`,
    [{ id: 'ladies_appointments', title: 'Book appointment' }, { id: 'ladies_services', title: 'Back' }]
  );
}

async function showLadiesLocation(from) {
  await sendButtons(from,
    `📍 *Ladies Saloon Locations:*\n\n• Muteena Branch\n• DIP Branch\n\n⏰ Timing: 9:00 AM - 10:00 PM\n📅 Open 7 days a week`,
    [{ id: 'ladies_main', title: 'Back to menu' }]
  );
}

async function showLadiesProducts(from) {
  await sendButtons(from,
    `🛍️ *Ladies Products:*\n\n• Hair Care Products\n• Skin Care Products\n• Scrubs & Massage Creams\n• Facial Kits\n• Wax Products\n• Nail Products`,
    [{ id: 'ladies_main', title: 'Back to menu' }]
  );
}

async function showLadiesOffers(from) {
  await sendButtons(from,
    `🔥 *Ladies Special Offers:*\n\n💥 Bridal Package:\nFull Body Wax + Facial + Henna\n\n💥 Glow Package:\nFacial + Body Polish + Nails\n\n💥 Refresh Package:\nMoroccan Bath + Hair Spa + Threading`,
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
  await sendButtons(from, `More slots:`,
    [{ id: 'time4', title: '12-01 PM' }]
  );
}

async function saveTime(from, session, time) {
  const { name, branch, type, service } = session.data;
  await setState(from, 'IDLE', {});
  await saveLead({
    phone: from,
    name: name || 'Unknown',
    business_type: 'SALON',
    service: service || type || 'Saloon',
    address: branch,
    booking_date: time,
    status: 'new',
    raw_data: { name, branch, time, type, service, phone: from }
  });
  await sendText(from,
    `✅ *Appointment Confirmed!*\n\n` +
    `📌 Name: ${name}\n` +
    `💇 Service: ${service || type}\n` +
    `📍 Branch: ${branch}\n` +
    `⏰ Time: ${time}\n\n` +
    `Please arrive 15 minutes early.\n\n` +
    `Thank you for choosing Madina Saloon! 🙏`
  );
  setTimeout(async () => { await showWelcome(from); }, 2000);
}

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
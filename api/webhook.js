const axios = require('axios');

const PHONE_NUMBER_ID = '1026663817198120';
const TOKEN = process.env.WHATSAPP_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.status(403).end();
  }
  if (req.method === 'POST') {
    res.status(200).end();
    try {
      const value = req.body && req.body.entry && req.body.entry[0] && req.body.entry[0].changes && req.body.entry[0].changes[0] && req.body.entry[0].changes[0].value;
      if (!value || !value.messages || !value.messages[0]) return;
      const msg = value.messages[0];
      const from = msg.from;
      const session = await getSession(from);
      if (msg.type === 'interactive') {
        await handleButton(from, msg.interactive && msg.interactive.button_reply && msg.interactive.button_reply.id, session);
      } else if (msg.type === 'text') {
        await handleText(from, msg.text.body.trim(), session);
      }
    } catch (err) {
      console.error('Bot error:', err.message);
    }
  }
};

async function getSession(phone) {
  const res = await axios.get(
    SUPABASE_URL + '/rest/v1/sessions?phone=eq.' + phone + '&select=*',
    { headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY } }
  );
  if (res.data && res.data.length > 0) return res.data[0];
  return { phone: phone, state: 'IDLE', data: {} };
}

async function setState(phone, state, data) {
  if (!data) data = {};
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
  const lower = text.toLowerCase();
  if (['hi','hello','hey','menu','start','hii'].includes(lower)) {
    return sendMainMenu(from);
  }
  const state = session.state;
  const data = session.data || {};

  if (state === 'AWAIT_REST_NAME') {
    await setState(from, 'AWAIT_REST_DATE', Object.assign({}, data, { name: text }));
    return sendText(from, 'Great, ' + text + '! What date? (e.g. 15 March)');
  }
  if (state === 'AWAIT_REST_DATE') {
    await setState(from, 'AWAIT_REST_GUESTS', Object.assign({}, data, { date: text }));
    return sendText(from, 'How many guests?');
  }
  if (state === 'AWAIT_REST_GUESTS') {
    await setState(from, 'IDLE', {});
    await saveLead({ phone: from, name: data.name, business_type: 'RESTAURANT', service: 'Table Booking', booking_date: data.date, guests: text, status: 'new', raw_data: { name: data.name, date: data.date, guests: text } });
    return sendText(from, 'Booking Confirmed!\n\nName: ' + data.name + '\nDate: ' + data.date + '\nGuests: ' + text + '\n\nWe will confirm shortly! Type menu to go back.');
  }
  if (state === 'AWAIT_HOME_NAME') {
    await setState(from, 'AWAIT_HOME_ADDRESS', Object.assign({}, data, { name: text }));
    return sendText(from, 'Thanks ' + text + '! Your address?');
  }
  if (state === 'AWAIT_HOME_ADDRESS') {
    await setState(from, 'AWAIT_HOME_DATE', Object.assign({}, data, { address: text }));
    return sendText(from, 'Preferred date and time?');
  }
  if (state === 'AWAIT_HOME_DATE') {
    await setState(from, 'IDLE', {});
    await saveLead({ phone: from, name: data.name, business_type: 'HOME_SERVICES', service: data.service, address: data.address, booking_date: text, status: 'new', raw_data: { name: data.name, address: data.address, date: text, service: data.service } });
    return sendText(from, 'Service Booked!\n\nService: ' + data.service + '\nName: ' + data.name + '\nAddress: ' + data.address + '\nDate: ' + text + '\n\nOur team will call to confirm. Type menu to go back.');
  }
  if (state === 'AWAIT_SALON_NAME') {
    await setState(from, 'AWAIT_SALON_DATE', Object.assign({}, data, { name: text }));
    return sendText(from, 'What date and time works for you?');
  }
  if (state === 'AWAIT_SALON_DATE') {
    await setState(from, 'IDLE', {});
    await saveLead({ phone: from, name: data.name, business_type: 'SALON', service: data.service, booking_date: text, status: 'new', raw_data: { name: data.name, service: data.service, date: text } });
    return sendText(from, 'Appointment Booked!\n\nService: ' + data.service + '\nName: ' + data.name + '\nDate: ' + text + '\n\nSee you soon! Type menu to go back.');
  }
  if (state === 'AWAIT_RE_NAME') {
    await setState(from, 'AWAIT_RE_BUDGET', Object.assign({}, data, { name: text }));
    return sendText(from, 'What is your budget? (e.g. 50 to 80 lakhs)');
  }
  if (state === 'AWAIT_RE_BUDGET') {
    await setState(from, 'AWAIT_RE_LOCATION', Object.assign({}, data, { budget: text }));
    return sendText(from, 'Preferred location?');
  }
  if (state === 'AWAIT_RE_LOCATION') {
    await setState(from, 'IDLE', {});
    await saveLead({ phone: from, name: data.name, business_type: 'REAL_ESTATE', intent: data.intent, budget: data.budget, location: text, status: 'new', raw_data: { name: data.name, intent: data.intent, budget: data.budget, location: text } });
    return sendText(from, 'Lead Captured!\n\nIntent: ' + data.intent + '\nName: ' + data.name + '\nBudget: ' + data.budget + '\nLocation: ' + text + '\n\nOur agent will reach out shortly! Type menu to go back.');
  }
  return sendMainMenu(from);
}

async function sendMainMenu(from) {
  await setState(from, 'IDLE', {});
  await sendButtons(from,
    'Welcome to our Demo Hub!\n\nSmart WhatsApp automation for businesses.\n\nChoose a demo:',
    [{ id: 'RESTAURANT', title: 'Restaurant' }, { id: 'HOME_SERVICES', title: 'Home services' }]
  );
  await sendButtons(from, 'More options:',
    [{ id: 'SALON', title: 'Salon and beauty' }, { id: 'REAL_ESTATE', title: 'Real estate' }]
  );
}

async function startRestaurant(from) {
  await sendButtons(from,
    'Spice Garden Restaurant\n\nAuthentic Indian cuisine.\nRated 4.8 | MG Road, Kozhikode',
    [{ id: 'REST_MENU', title: 'View menu' }, { id: 'REST_BOOK', title: 'Book a table' }, { id: 'REST_CONTACT', title: 'Contact us' }]
  );
}

async function sendRestaurantMenu(from) {
  await sendText(from, 'Our Menu\n\nStarters\nPaneer Tikka - 180\nChicken 65 - 220\n\nMains\nButter Chicken - 320\nDal Makhani - 240\nBiryani - 280 or 350\n\nDesserts\nGulab Jamun - 120\n\nType book to reserve a table.');
}

async function startRestaurantBooking(from) {
  await setState(from, 'AWAIT_REST_NAME', {});
  await sendText(from, 'Table Booking\n\nWhat is your name?');
}

async function sendRestaurantContact(from) {
  await sendText(from, 'Contact Spice Garden\n\nPhone: +91 98765 43210\nAddress: MG Road, Kozhikode\nHours: 11am to 11pm daily');
}

async function startHomeServices(from) {
  await sendButtons(from,
    'QuickFix Home Services\n\nFast reliable repairs.\n500+ customers | Same-day service',
    [{ id: 'HOME_PLUMBING', title: 'Plumbing' }, { id: 'HOME_ELECTRICAL', title: 'Electrical' }, { id: 'HOME_CLEANING', title: 'Cleaning' }]
  );
}

async function sendServiceInfo(from, service, price, bookId) {
  await sendButtons(from,
    service + '\n\nPrice: ' + price + '\nResponse: Within 2 hours\nInsured and verified',
    [{ id: bookId, title: 'Book now' }, { id: 'MAIN_MENU', title: 'Back to menu' }]
  );
}

async function startHomeBooking(from, id) {
  const map = { HOME_BOOK_PLUMBING: 'Plumbing', HOME_BOOK_ELECTRICAL: 'Electrical', HOME_BOOK_CLEANING: 'Cleaning' };
  const service = map[id] || 'Service';
  await setState(from, 'AWAIT_HOME_NAME', { service: service });
  await sendText(from, 'Booking ' + service + '\n\nYour full name?');
}

async function startSalon(from) {
  await sendButtons(from,
    'Glamour Studio\n\nPremium beauty treatments.\nRated 4.9 | Calicut Beach Road',
    [{ id: 'SALON_HAIRCUT', title: 'Haircut' }, { id: 'SALON_FACIAL', title: 'Facial' }, { id: 'SALON_NAILS', title: 'Nails' }]
  );
}

async function sendSalonInfo(from, service, price, duration) {
  await setState(from, 'IDLE', { service: service });
  await sendButtons(from,
    service + '\n\nPrice: ' + price + '\nDuration: ' + duration + '\nExpert stylists',
    [{ id: 'SALON_BOOK', title: 'Book appointment' }, { id: 'MAIN_MENU', title: 'Back to menu' }]
  );
}

async function startSalonBooking(from, service) {
  await setState(from, 'AWAIT_SALON_NAME', { service: service || 'Service' });
  await sendText(from, 'Booking ' + (service || 'appointment') + '\n\nYour name?');
}

async function startRealEstate(from) {
  await sendButtons(from,
    'DreamHome Realty\n\n500+ listings in Kerala.\nExpert agents ready to help',
    [{ id: 'RE_BUY', title: 'Buy property' }, { id: 'RE_RENT', title: 'Rent property' }, { id: 'RE_SELL', title: 'Sell property' }]
  );
}

async function startRealEstateLead(from, intent) {
  await setState(from, 'IDLE', { intent: intent });
  await sendButtons(from,
    intent + ' Property\n\n200+ properties available.\n\nSchedule a viewing?',
    [{ id: 'RE_YES', title: 'Yes schedule' }, { id: 'RE_NO', title: 'Not now' }]
  );
}

async function askRealEstateDetails(from, session) {
  const intent = (session && session.data && session.data.intent) || 'Buy';
  await setState(from, 'AWAIT_RE_NAME', { intent: intent });
  await sendText(from, 'Schedule a viewing\n\nYour name?');
}

async function sendButtons(to, bodyText, buttons) {
  await axios.post(
    'https://graph.facebook.com/v19.0/' + PHONE_NUMBER_ID + '/messages',
    {
      messaging_product: 'whatsapp',
      to: to,
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: bodyText },
        action: {
          buttons: buttons.map(function(b) {
            return { type: 'reply', reply: { id: b.id, title: b.title.substring(0, 20) } };
          })
        }
      }
    },
    { headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' } }
  );
}

async function sendText(to, text) {
  await axios.post(
    'https://graph.facebook.com/v19.0/' + PHONE_NUMBER_ID + '/messages',
    { messaging_product: 'whatsapp', to: to, type: 'text', text: { body: text } },
    { headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' } }
  );
}
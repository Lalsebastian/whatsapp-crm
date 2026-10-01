const { getCrmAdapter } = require('../crm');
const whatsapp = require('../whatsapp/client');
const sessionStore = require('../session/sessionStore');
const logger = require('../utils/logger');
const { invalidateCustomerProfile } = require('./customerProfileService');

const crm = getCrmAdapter();
const LANGUAGES = {
  english: { code: 'en', label: 'English' },
  malayalam: { code: 'ml', label: 'Malayalam' },
  manglish: { code: 'manglish', label: 'Manglish' },
  hindi: { code: 'hi', label: 'Hindi' },
  hinglish: { code: 'hinglish', label: 'Hinglish' },
};

function parseLanguagePreference(text) {
  const match = String(text || '').trim().match(
    /\b(?:please\s+)?(?:reply|respond|speak|talk|use)\s+(?:to\s+me\s+)?(?:in\s+)?(english|malayalam|manglish|hindi|hinglish)\b/i
  );
  return match ? LANGUAGES[match[1].toLowerCase()] : null;
}

function parseDefaultPropertyPreference(text) {
  const value = String(text || '').trim();
  const patterns = [
    /\buse\s+(?:my\s+)?(.+?)\s+(?:address\s+)?(?:by\s+default|as\s+(?:my\s+)?(?:main|default)\s+address)\b/i,
    /\bmake\s+(?:my\s+)?(.+?)\s+(?:address\s+)?(?:my\s+)?(?:main|default)\s+address\b/i,
  ];
  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (match) return match[1].replace(/\baddress\b/gi, '').trim();
  }
  return null;
}

function matchProperty(query, properties) {
  const wanted = String(query || '').toLowerCase().trim();
  if (!wanted) return null;
  const exact = properties.filter((property) =>
    [property.label, property.area, property.addressLine]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().trim() === wanted)
  );
  if (exact.length === 1) return exact[0];
  const partial = properties.filter((property) =>
    [property.label, property.area, property.addressLine, property.city]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(wanted))
  );
  return partial.length === 1 ? partial[0] : null;
}

function propertyName(property) {
  return property.label || property.area || property.addressLine;
}

async function applyPreferenceCommand(session, customer, text) {
  const language = parseLanguagePreference(text);
  if (language) {
    await crm.updateCustomerPreferences(customer.id, { preferredLanguage: language.code });
    await sessionStore.updateSession(session.phone, { preferredLanguage: language.code });
    if (customer.profile) customer.profile.preferredLanguage = language.code;
    invalidateCustomerProfile(customer.id);
    logger.audit('CUSTOMER_PREFERENCE_UPDATED', {
      customerId: customer.id,
      preference: 'preferred_language',
      result: 'success',
    });
    await whatsapp.sendText(session.phone, `Certainly. I'll use ${language.label} for future conversations.`);
    return { handled: true, preference: 'preferredLanguage', value: language.code };
  }

  const propertyQuery = parseDefaultPropertyPreference(text);
  if (!propertyQuery) return { handled: false };
  const properties = await crm.getCustomerProperties(customer.id);
  const property = matchProperty(propertyQuery, properties);
  if (!property) {
    await whatsapp.sendText(
      session.phone,
      `I couldn't match “${propertyQuery}” to one saved address. Please use the exact saved address label.`
    );
    return { handled: true, preference: 'defaultProperty', updated: false };
  }

  await crm.updateCustomerPreferences(customer.id, { defaultPropertyId: property.id });
  if (customer.profile) customer.profile.defaultProperty = { ...property, isDefault: true };
  invalidateCustomerProfile(customer.id);
  logger.audit('CUSTOMER_PREFERENCE_UPDATED', {
    customerId: customer.id,
    preference: 'default_property',
    propertyId: property.id,
    result: 'success',
  });
  await whatsapp.sendText(session.phone, `Certainly. I'll use your ${propertyName(property)} address as the default.`);
  return { handled: true, preference: 'defaultProperty', value: property.id, updated: true };
}

async function handlePreferenceCommand(session, customer, text) {
  const isPreferenceCommand = !!(parseLanguagePreference(text) || parseDefaultPropertyPreference(text));
  if (!isPreferenceCommand) return { handled: false };
  try {
    return await applyPreferenceCommand(session, customer, text);
  } catch (error) {
    logger.error('CUSTOMER_PREFERENCE', 'Unable to save customer preference:', error.message);
    logger.audit('CUSTOMER_PREFERENCE_UPDATED', {
      customerId: customer && customer.id,
      result: 'failed',
      reason: error.code || error.message,
    });
    await whatsapp.sendText(
      session.phone,
      "I'm sorry, I couldn't save that preference right now. Please try again shortly."
    );
    return { handled: true, updated: false, error: true };
  }
}

module.exports = {
  handlePreferenceCommand,
  parseLanguagePreference,
  parseDefaultPropertyPreference,
  matchProperty,
};

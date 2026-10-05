// Location pins in the booking flow, with the geocoder replaced by a stub.
// See ai/intentService.test.js for the require()-cache patching pattern.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const geocoder = require('../../geo/geocoder');
geocoder.reverseGeocode = vi.fn();

const fakeCrm = require('../../crm/supabaseCrmAdapter');
fakeCrm.addProperty = vi.fn();
fakeCrm.checkServiceability = vi.fn();
fakeCrm.getAvailabilityRange = vi.fn();
fakeCrm.getServices = vi.fn();
fakeCrm.getServiceDetails = vi.fn();

const whatsapp = require('../../whatsapp/client');
whatsapp.sendText = vi.fn();
whatsapp.sendButtons = vi.fn();
whatsapp.sendListMessage = vi.fn();

const sessionStore = require('../../session/sessionStore');
sessionStore.setFlow = vi.fn();

const booking = require('../../flows/booking');

const pin = { latitude: 25.0805, longitude: 55.1403, label: null, address: null, source: 'whatsapp_location' };
const geocoded = {
  formattedAddress: 'Marina Walk, Dubai Marina, Dubai, United Arab Emirates',
  addressLine: 'Marina Walk',
  area: 'Dubai Marina',
  city: 'Dubai',
  country: 'United Arab Emirates',
  placeId: 'ChIJ123',
  provider: 'google',
};
const context = { serviceId: 'svc1', serviceName: 'AC Service' };

describe('booking flow — WhatsApp location pins', () => {
  beforeEach(() => {
    [geocoder.reverseGeocode, fakeCrm.addProperty, fakeCrm.checkServiceability, fakeCrm.getAvailabilityRange,
      fakeCrm.getServices, fakeCrm.getServiceDetails, whatsapp.sendText, whatsapp.sendButtons,
      whatsapp.sendListMessage, sessionStore.setFlow].forEach((fn) => fn.mockReset());
    fakeCrm.checkServiceability.mockResolvedValue({ serviceable: true });
    fakeCrm.getAvailabilityRange.mockResolvedValue(null);
    fakeCrm.addProperty.mockImplementation(async (customerId, property) => ({
      id: 'prop-new', customerId, label: property.label || null, addressLine: property.addressLine,
      area: property.area || null, city: property.city || 'Dubai',
    }));
  });

  it('suggests the geocoded address for a bare pin and asks for unit details', async () => {
    geocoder.reverseGeocode.mockResolvedValue(geocoded);

    await booking.steps.select_property({ phone: '971500', context }, { id: 'cust1' }, { location: pin });

    expect(fakeCrm.addProperty).not.toHaveBeenCalled();
    const [, body, buttons] = whatsapp.sendButtons.mock.calls[0];
    expect(body).toContain('Marina Walk, Dubai Marina, Dubai');
    expect(body).toContain('flat/villa number');
    expect(buttons).toEqual([{ id: 'USE_PIN_ADDRESS', title: 'Use This Address' }]);
    expect(sessionStore.setFlow).toHaveBeenCalledWith('971500', 'booking', 'awaiting_location_details', expect.objectContaining({
      pendingLocation: expect.objectContaining({ latitude: 25.0805, longitude: 55.1403, purpose: 'booking', area: 'Dubai Marina' }),
    }));
  });

  it('saves the customer\'s unit details with the geocoded address and the pin coordinates', async () => {
    const pendingLocation = { ...pin, formattedAddress: geocoded.formattedAddress, area: 'Dubai Marina', city: 'Dubai', placeId: 'ChIJ123', purpose: 'booking' };

    await booking.steps.awaiting_location_details(
      { phone: '971500', context: { ...context, pendingLocation } },
      { id: 'cust1' },
      { text: 'Marina Heights tower, flat 1204' }
    );

    expect(fakeCrm.addProperty).toHaveBeenCalledWith('cust1', {
      addressLine: 'Marina Heights tower, flat 1204, Marina Walk, Dubai Marina, Dubai, United Arab Emirates',
      area: 'Dubai Marina',
      city: 'Dubai',
      latitude: 25.0805,
      longitude: 55.1403,
      locationSource: 'whatsapp_location',
      placeId: 'ChIJ123',
    });
    // Continues to scheduling with the coordinates in the booking context.
    expect(sessionStore.setFlow).toHaveBeenLastCalledWith('971500', 'booking', 'select_date', expect.objectContaining({
      propertyId: 'prop-new',
      location: expect.objectContaining({ latitude: 25.0805, longitude: 55.1403, source: 'whatsapp_location' }),
    }));
    expect(JSON.stringify(sessionStore.setFlow.mock.calls.at(-1)[3])).not.toContain('pendingLocation');
  });

  it('accepts the geocoded address as is with the button', async () => {
    const pendingLocation = { ...pin, formattedAddress: 'Villa 7, Al Barsha 2, Dubai', purpose: 'booking' };
    await booking.steps.awaiting_location_details(
      { phone: '971500', context: { ...context, pendingLocation } },
      { id: 'cust1' },
      { buttonId: 'USE_PIN_ADDRESS' }
    );
    expect(fakeCrm.addProperty).toHaveBeenCalledWith('cust1', expect.objectContaining({ addressLine: 'Villa 7, Al Barsha 2, Dubai' }));
  });

  it('asks again for a too-short reply instead of saving it', async () => {
    const pendingLocation = { ...pin, formattedAddress: 'X', purpose: 'booking' };
    await booking.steps.awaiting_location_details(
      { phone: '971500', context: { ...context, pendingLocation } },
      { id: 'cust1' },
      { text: 'a' }
    );
    expect(fakeCrm.addProperty).not.toHaveBeenCalled();
    expect(whatsapp.sendText.mock.calls[0][1]).toContain('building or villa name');
  });

  it('falls back to asking for the full address when geocoding is unavailable', async () => {
    geocoder.reverseGeocode.mockResolvedValue(null);

    await booking.steps.select_property({ phone: '971500', context }, { id: 'cust1' }, { location: pin });

    expect(whatsapp.sendText.mock.calls[0][1]).toContain('building or villa name, flat/villa number');
    expect(sessionStore.setFlow).toHaveBeenCalledWith('971500', 'booking', 'awaiting_new_property', expect.objectContaining({
      location: expect.objectContaining({ latitude: 25.0805 }),
    }));
  });

  it('keeps the pin coordinates when the customer then types the address', async () => {
    await booking.steps.awaiting_new_property(
      { phone: '971500', context: { ...context, location: pin } },
      { id: 'cust1' },
      { text: 'Villa 12, Al Barsha, Dubai' }
    );
    expect(fakeCrm.addProperty).toHaveBeenCalledWith('cust1', {
      addressLine: 'Villa 12, Al Barsha, Dubai', latitude: 25.0805, longitude: 55.1403, locationSource: 'whatsapp_location',
    });
  });

  it('continues to service suggestions when the pin was sent for recommendations', async () => {
    fakeCrm.getServices.mockResolvedValue([{ id: 'svc-clean', name: 'Kitchen Cleaning' }]);
    const pendingLocation = { ...pin, formattedAddress: 'Dubai Marina', purpose: 'recommendation' };

    await booking.steps.awaiting_location_details(
      { phone: '971500', context: { room: 'kitchen', pendingLocation } },
      { id: 'cust1' },
      { text: 'Tower B, 801' }
    );

    expect(fakeCrm.getServices).toHaveBeenCalled();
    expect(fakeCrm.checkServiceability).toHaveBeenCalledWith('svc-clean', expect.objectContaining({ latitude: 25.0805 }));
  });
});

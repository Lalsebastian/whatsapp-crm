import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { formatServiceAddress, locationSourceLabel, mapsUrl } from '@/lib/location';
import { ServiceAddress } from '@/components/data/ServiceAddress';

const pinned = {
  address_line: 'A 23 Olive Courtyard, Thevakkal', area: 'Kakkanad', city: 'Kochi', state: 'Kerala', postal_code: '682021',
  latitude: 10.0473, longitude: 76.3315, location_source: 'whatsapp_location',
};

describe('service address', () => {
  it('formats the address with locality, city, state and PIN code', () => {
    expect(formatServiceAddress(pinned)).toBe('A 23 Olive Courtyard, Thevakkal, Kakkanad, Kochi, Kerala 682021');
    expect(formatServiceAddress({ address_line: 'Villa 1', city: 'Kochi' })).toBe('Villa 1, Kochi');
    expect(formatServiceAddress(null)).toBeNull();
  });

  it('links to the exact pin when there is one, otherwise searches the address', () => {
    expect(mapsUrl(pinned)).toBe('https://www.google.com/maps/search/?api=1&query=10.0473,76.3315');
    expect(mapsUrl({ address_line: 'Villa 1, Kakkanad' })).toBe('https://www.google.com/maps/search/?api=1&query=Villa%201%2C%20Kakkanad');
    expect(mapsUrl({ latitude: 0, longitude: 0 })).toBeNull();
    expect(mapsUrl(null)).toBeNull();
  });

  it('says where the pin came from', () => {
    expect(locationSourceLabel(pinned)).toBe('Exact pin from WhatsApp');
    expect(locationSourceLabel({ ...pinned, location_source: 'maps_link' })).toBe('Pin from Google Maps link');
    expect(locationSourceLabel({ address_line: 'x' })).toBeNull();
  });

  it('renders the address with an Open in Google Maps link', () => {
    render(<ServiceAddress property={pinned} />);
    expect(screen.getByText('Exact pin from WhatsApp')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Open in Google Maps/ })).toHaveAttribute('href', 'https://www.google.com/maps/search/?api=1&query=10.0473,76.3315');
  });

  it('handles a booking with no address', () => {
    render(<ServiceAddress property={null} />);
    expect(screen.getByText('Address not provided')).toBeInTheDocument();
  });
});

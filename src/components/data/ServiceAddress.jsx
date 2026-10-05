import { MapPin, Navigation } from 'lucide-react';
import { formatServiceAddress, locationSourceLabel, mapsUrl } from '@/lib/location';

/* The service address with a one-click Google Maps link (exact pin when the
 * customer shared a location). */
export function ServiceAddress({ property }) {
  const address = formatServiceAddress(property);
  const url = mapsUrl(property);
  const source = locationSourceLabel(property);
  if (!address && !url) return <span className="text-muted-foreground">Address not provided</span>;
  return (
    <span className="flex flex-col gap-1">
      <span>{address ?? 'Location pin only'}</span>
      {source ? (
        <span className="text-muted-foreground flex items-center gap-1 text-[11px]"><MapPin className="size-3" />{source}</span>
      ) : null}
      {url ? (
        <a href={url} target="_blank" rel="noreferrer" className="text-primary inline-flex w-fit items-center gap-1 text-xs font-medium hover:underline">
          <Navigation className="size-3" /> Open in Google Maps
        </a>
      ) : null}
    </span>
  );
}

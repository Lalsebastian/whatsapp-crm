-- Service-area facts on saved addresses (PIN/postal code and state), used by
-- the chatbot's serviceability check (SERVICEABLE_PINCODES / SERVICEABLE_CITIES
-- for the bundled CRM). Safe to run more than once. Without it the bot still
-- saves addresses, just without these two fields.

alter table public.properties add column if not exists postal_code text;
alter table public.properties add column if not exists state text;

create index if not exists properties_postal_code_idx
  on public.properties (postal_code)
  where postal_code is not null;

-- Addresses saved before this change: take a 6-digit Indian PIN code from the
-- address text where one is present.
update public.properties
set postal_code = substring(address_line from '(?:^|\D)([1-9]\d{5})(?:\D|$)')
where postal_code is null
  and address_line ~ '(?:^|\D)[1-9]\d{5}(?:\D|$)';

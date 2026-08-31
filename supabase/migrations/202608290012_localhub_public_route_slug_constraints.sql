-- Keep every database value used as a public path segment aligned with the
-- application route contract. NOT VALID minimizes the initial table lock while
-- still enforcing the constraint for new rows before validation completes.

alter table public.markets
  add constraint markets_public_route_slug_format
  check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$') not valid;

alter table public.market_locations
  add constraint market_locations_public_route_slug_format
  check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$') not valid;

alter table public.businesses
  add constraint businesses_public_route_slug_format
  check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$') not valid;

alter table public.categories
  add constraint categories_public_route_slug_format
  check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$') not valid;

alter table public.listings
  add constraint listings_public_route_slug_format
  check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$') not valid;

alter table public.markets
  validate constraint markets_public_route_slug_format;

alter table public.market_locations
  validate constraint market_locations_public_route_slug_format;

alter table public.businesses
  validate constraint businesses_public_route_slug_format;

alter table public.categories
  validate constraint categories_public_route_slug_format;

alter table public.listings
  validate constraint listings_public_route_slug_format;

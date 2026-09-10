-- Stage 1 of the public-catalogue boundary. This migration introduces the
-- bounded projection contract without changing legacy source-table or media
-- access. Deploy the application adapter, then apply migration 040 to lock
-- down the legacy public surface. Derivative delivery is intentionally absent.

begin;

set local lock_timeout = '10s';
set local statement_timeout = '120s';

create function private.catalog_public_text(
  p_value jsonb,
  p_max_length integer
)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  normalized_value text;
begin
  if p_value is null
    or p_max_length not between 1 and 500
    or pg_catalog.jsonb_typeof(p_value) <> 'string'
  then
    return null;
  end if;

  normalized_value := pg_catalog.btrim(p_value #>> '{}');
  if normalized_value = ''
    or pg_catalog.char_length(normalized_value) > p_max_length
  then
    return null;
  end if;

  return normalized_value;
end;
$$;
alter function private.catalog_public_text(jsonb, integer) owner to postgres;
revoke all on function private.catalog_public_text(jsonb, integer)
  from public, anon, authenticated, service_role;

create function private.catalog_public_color(p_value jsonb)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  normalized_value text;
begin
  normalized_value := private.catalog_public_text(p_value, 7);
  if normalized_value is null
    or normalized_value !~ '^#[0-9A-Fa-f]{6}$'
  then
    return null;
  end if;

  return normalized_value;
end;
$$;
alter function private.catalog_public_color(jsonb) owner to postgres;
revoke all on function private.catalog_public_color(jsonb)
  from public, anon, authenticated, service_role;

create function private.catalog_public_text_array(
  p_value jsonb,
  p_item_max_length integer,
  p_max_items integer
)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  array_item jsonb;
  normalized_item text;
begin
  if p_value is null then
    return null;
  end if;

  if p_item_max_length not between 1 and 500
    or p_max_items not between 1 and 24
    or pg_catalog.jsonb_typeof(p_value) <> 'array'
    or pg_catalog.jsonb_array_length(p_value) > p_max_items
  then
    return '[]'::jsonb;
  end if;

  for array_item in select value from pg_catalog.jsonb_array_elements(p_value)
  loop
    normalized_item := private.catalog_public_text(
      array_item, p_item_max_length
    );
    if normalized_item is null then
      return '[]'::jsonb;
    end if;
  end loop;

  return coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(item.value)
      order by item.first_ordinal)
    from (
      select normalized.value, min(normalized.ordinality) as first_ordinal
      from (
        select
          private.catalog_public_text(value, p_item_max_length) as value,
          ordinality
        from pg_catalog.jsonb_array_elements(p_value) with ordinality
      ) normalized
      group by normalized.value
    ) item
  ), '[]'::jsonb);
end;
$$;
alter function private.catalog_public_text_array(jsonb, integer, integer)
  owner to postgres;
revoke all on function private.catalog_public_text_array(jsonb, integer, integer)
  from public, anon, authenticated, service_role;

create function public.list_public_catalog_businesses(
  p_market_id uuid,
  p_limit integer default 250
)
returns table (
  id uuid,
  market_id uuid,
  location_id uuid,
  slug text,
  name text,
  metadata jsonb,
  status text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_market_id is null or p_limit is null or p_limit not between 1 and 250 then
    return;
  end if;

  return query
  select
    business_record.id,
    business_record.market_id,
    business_record.location_id,
    business_record.slug,
    business_record.name,
    pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
      'summary', private.catalog_public_text(
        business_record.metadata -> 'summary', 500
      ),
      'serviceAreas', private.catalog_public_text_array(coalesce(
        business_record.metadata -> 'serviceAreas',
        business_record.metadata -> 'service_areas'
      ), 96, 24),
      'capabilityTags', private.catalog_public_text_array(coalesce(
        business_record.metadata -> 'capabilityTags',
        business_record.metadata -> 'capability_tags'
      ), 64, 24),
      'color', private.catalog_public_color(business_record.metadata -> 'color')
    )),
    business_record.status::text
  from public.markets market_record
  join public.businesses business_record
    on business_record.market_id = market_record.id
    and business_record.status = 'active'
  where market_record.id = p_market_id
    and market_record.is_active
  order by business_record.name, business_record.id
  limit p_limit;
end;
$$;
alter function public.list_public_catalog_businesses(uuid, integer)
  owner to postgres;
revoke all on function public.list_public_catalog_businesses(uuid, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.list_public_catalog_businesses(uuid, integer)
  to anon, authenticated;

create function public.list_public_catalog_listings(
  p_market_id uuid,
  p_limit integer default 500
)
returns table (
  id uuid,
  market_id uuid,
  business_id uuid,
  category_id uuid,
  location_id uuid,
  slug text,
  title text,
  description text,
  attributes jsonb,
  is_orderable boolean,
  price_minor bigint,
  currency_code text,
  published_at timestamptz,
  status public.listing_status,
  has_active_variant boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_market_id is null or p_limit is null or p_limit not between 1 and 500 then
    return;
  end if;

  return query
  with eligible_businesses as (
    select business_record.id, business_record.market_id
    from public.markets market_record
    join public.businesses business_record
      on business_record.market_id = market_record.id
      and business_record.status = 'active'
    where market_record.id = p_market_id
      and market_record.is_active
    order by business_record.name, business_record.id
    limit 250
  )
  select
    listing_record.id,
    listing_record.market_id,
    listing_record.business_id,
    listing_record.category_id,
    listing_record.location_id,
    listing_record.slug,
    listing_record.title,
    listing_record.description,
    pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
      'availabilityNote', private.catalog_public_text(coalesce(
        listing_record.attributes -> 'availabilityNote',
        listing_record.attributes -> 'availability_note'
      ), 240),
      'availabilityWindows', private.catalog_public_text_array(coalesce(
        listing_record.attributes -> 'availabilityWindows',
        listing_record.attributes -> 'availability_windows'
      ), 32, 8),
      'capabilityTags', private.catalog_public_text_array(coalesce(
        listing_record.attributes -> 'capabilityTags',
        listing_record.attributes -> 'capability_tags'
      ), 64, 24),
      'color', private.catalog_public_color(listing_record.attributes -> 'color'),
      'priceNote', private.catalog_public_text(coalesce(
        listing_record.attributes -> 'priceNote',
        listing_record.attributes -> 'price_note'
      ), 240),
      'serviceAreas', private.catalog_public_text_array(coalesce(
        listing_record.attributes -> 'serviceAreas',
        listing_record.attributes -> 'service_areas'
      ), 96, 24)
    )),
    listing_record.is_orderable,
    listing_record.price_minor,
    listing_record.currency_code::text,
    listing_record.published_at,
    listing_record.status,
    exists (
      select 1
      from public.listing_variants variant_record
      where variant_record.listing_id = listing_record.id
        and variant_record.is_active
    )
  from eligible_businesses eligible_business
  join public.listings listing_record
    on listing_record.business_id = eligible_business.id
    and listing_record.market_id = eligible_business.market_id
    and listing_record.status = 'active'
    and listing_record.published_at is not null
  join public.categories category_record
    on category_record.id = listing_record.category_id
    and category_record.is_active
    and (
      category_record.market_id is null
      or category_record.market_id = listing_record.market_id
    )
  order by listing_record.published_at desc, listing_record.id
  limit p_limit;
end;
$$;
alter function public.list_public_catalog_listings(uuid, integer)
  owner to postgres;
revoke all on function public.list_public_catalog_listings(uuid, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.list_public_catalog_listings(uuid, integer)
  to anon, authenticated;

do $$
declare
  function_name text;
begin
  foreach function_name in array array[
    'public.list_public_catalog_businesses(uuid,integer)',
    'public.list_public_catalog_listings(uuid,integer)'
  ] loop
    if not pg_catalog.has_function_privilege('anon', function_name, 'execute')
      or not pg_catalog.has_function_privilege(
        'authenticated', function_name, 'execute'
      )
      or pg_catalog.has_function_privilege(
        'service_role', function_name, 'execute'
      )
    then
      raise exception 'public catalogue RPC ACL postcondition failed'
        using errcode = '55000';
    end if;
  end loop;

end;
$$;

comment on function public.list_public_catalog_businesses(uuid, integer) is
  'Phase 0 bounded public catalogue projection. Emits only active businesses in one active market and canonical allowlisted metadata keys.';
comment on function public.list_public_catalog_listings(uuid, integer) is
  'Phase 0 bounded public catalogue projection. Emits only compatible active published listings and canonical allowlisted attribute keys; no media delivery is exposed.';

notify pgrst, 'reload schema';

commit;

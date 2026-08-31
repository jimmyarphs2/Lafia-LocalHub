-- Protected, server-authoritative snapshot creation for one explicitly
-- orderable base listing. This migration deliberately excludes payment,
-- fulfilment, inventory, notification, and vendor status transitions.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create or replace function private.is_bounded_visible_order_text(
  p_value text,
  p_minimum_length integer,
  p_maximum_length integer
)
returns boolean
language sql
immutable
parallel safe
security invoker
set search_path = ''
as $$
  select p_value is not null
    and p_minimum_length >= 1
    and p_maximum_length >= p_minimum_length
    and pg_catalog.char_length(p_value)
      between p_minimum_length and p_maximum_length
    and p_value = pg_catalog.btrim(
      p_value,
      E' \t\n\r\f' || pg_catalog.chr(11)
        || U&'\00A0\1680\180E\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\200B\200C\200D\200E\200F\2028\2029\202A\202B\202C\202D\202E\202F\205F\2060\2061\2062\2063\2064\2066\2067\2068\2069\3000\FEFF'
    )
    and p_value !~ '[[:cntrl:]]'
    and p_value !~ U&'[\00AD\034F\061C\115F-\1160\17B4-\17B5\180B-\180F\200B-\200F\202A-\202E\2060-\206F\3164\FE00-\FE0F\FEFF\FFA0\FFF0-\FFF8\+01BCA0-\+01BCA3\+01D173-\+01D17A\+0E0000-\+0E0FFF]'
    and pg_catalog.regexp_replace(p_value, '[^[:alnum:]]', '', 'g') <> ''
$$;
revoke all on function private.is_bounded_visible_order_text(text, integer, integer)
  from public, anon, authenticated, service_role;

alter table public.listings
  add column if not exists is_orderable boolean not null default false;

alter table public.orders
  add column if not exists guest_intent_id uuid
    references public.guest_intents(id) on delete set null,
  add column if not exists snapshot_source text,
  add column if not exists vendor_name_snapshot text,
  add column if not exists listing_route_snapshot text;

alter table public.orders
  add constraint orders_listing_order_snapshot_shape
  check (
    snapshot_source is null
    or (
      snapshot_source = 'listing_order'
      and status = 'placed'
      and placed_at is not null
      and subtotal_minor > 0
      and total_minor > 0
      and subtotal_minor <= 9007199254740991
      and total_minor <= 9007199254740991
      and subtotal_minor = total_minor
      and private.is_bounded_visible_order_text(
        vendor_name_snapshot, 2, 160
      )
      and listing_route_snapshot is not null
      and pg_catalog.char_length(listing_route_snapshot) between 3 and 201
      and listing_route_snapshot ~ '^[a-z0-9]+(-[a-z0-9]+)*~[a-z0-9]+(-[a-z0-9]+)*$'
    )
  ) not valid;
alter table public.orders
  validate constraint orders_listing_order_snapshot_shape;

alter table public.order_items
  add constraint order_items_authoritative_total
    check (
      total_minor::numeric = unit_price_minor::numeric * quantity::numeric
    ) not valid,
  add constraint order_items_positive_snapshot_amount
    check (
      unit_price_minor > 0
      and total_minor > 0
      and unit_price_minor <= 9007199254740991
      and total_minor <= 9007199254740991
    ) not valid;
alter table public.order_items
  validate constraint order_items_authoritative_total;
alter table public.order_items
  validate constraint order_items_positive_snapshot_amount;

create unique index if not exists orders_one_order_per_guest_intent_idx
  on public.orders(guest_intent_id)
  where guest_intent_id is not null;
create index if not exists orders_business_created_idx
  on public.orders(business_id, created_at desc, id desc);
create index if not exists guest_intents_listing_order_expiry_idx
  on public.guest_intents(expires_at, id)
  where kind = 'listing_order' and consumed_at is null;
create index if not exists guest_intents_consumed_listing_order_prune_idx
  on public.guest_intents(consumed_at, expires_at, id)
  where kind = 'listing_order' and consumed_at is not null;
create index if not exists auth_rate_limits_listing_order_prune_idx
  on public.auth_rate_limits(updated_at)
  where scope in (
    'listing_order_intent', 'listing_order_place', 'listing_order_replay'
  );

create sequence if not exists public.localhub_order_number_sequence
  as bigint start with 1 increment by 1 minvalue 1 maxvalue 9999999999;
revoke all on sequence public.localhub_order_number_sequence
  from public, anon, authenticated, service_role;

create table private.listing_order_quotes (
  intent_id uuid primary key
    references public.guest_intents(id) on delete cascade,
  listing_id uuid not null references public.listings(id) on delete restrict,
  business_id uuid not null references public.businesses(id) on delete restrict,
  market_id uuid not null references public.markets(id) on delete restrict,
  category_id uuid not null references public.categories(id) on delete restrict,
  quantity integer not null check (quantity between 1 and 100),
  listing_title text not null,
  vendor_name text not null,
  market_slug text not null,
  listing_route text not null,
  currency_code char(3) not null,
  unit_price_minor bigint not null check (
    unit_price_minor between 1 and 9007199254740991
  ),
  total_minor bigint not null check (
    total_minor between 1 and 9007199254740991
    and total_minor::numeric = unit_price_minor::numeric * quantity::numeric
  ),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  check (private.is_bounded_visible_order_text(listing_title, 2, 160)),
  check (private.is_bounded_visible_order_text(vendor_name, 2, 160)),
  check (
    pg_catalog.char_length(market_slug) between 1 and 80
    and market_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
  ),
  check (
    pg_catalog.char_length(listing_route) between 3 and 201
    and listing_route ~ '^[a-z0-9]+(-[a-z0-9]+)*~[a-z0-9]+(-[a-z0-9]+)*$'
  )
);
create index listing_order_quotes_expiry_idx
  on private.listing_order_quotes(expires_at, intent_id);
create index listing_order_quotes_listing_idx
  on private.listing_order_quotes(listing_id);
create index listing_order_quotes_business_idx
  on private.listing_order_quotes(business_id);
create index listing_order_quotes_market_idx
  on private.listing_order_quotes(market_id);
create index listing_order_quotes_category_idx
  on private.listing_order_quotes(category_id);
alter table private.listing_order_quotes enable row level security;
revoke all on table private.listing_order_quotes
  from public, anon, authenticated, service_role;

-- Every variant INSERT/UPDATE takes the same exclusive parent-row lock used by
-- base-order quoting and placement. This closes both active-row phantoms and
-- inactive-to-active races. DELETE is intentionally excluded: removing a
-- variant cannot introduce an active variant, and a DELETE trigger would also
-- interfere with the listing FK's ON DELETE CASCADE path.
create or replace function public.serialize_listing_variant_parent()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  first_listing_id uuid;
  second_listing_id uuid;
begin
  if tg_op = 'INSERT' then
    first_listing_id := new.listing_id;
  else
    first_listing_id := least(old.listing_id, new.listing_id);
    second_listing_id := greatest(old.listing_id, new.listing_id);
  end if;

  perform 1
  from public.listings l
  where l.id = first_listing_id
  for update;
  if not found then
    raise exception 'variant listing does not exist';
  end if;

  if second_listing_id is distinct from first_listing_id then
    perform 1
    from public.listings l
    where l.id = second_listing_id
    for update;
    if not found then
      raise exception 'variant listing does not exist';
    end if;
  end if;

  return new;
end;
$$;
revoke all on function public.serialize_listing_variant_parent()
  from public, anon, authenticated, service_role;
drop trigger if exists listing_variants_serialize_parent
  on public.listing_variants;
create trigger listing_variants_serialize_parent
before insert or update on public.listing_variants
for each row execute function public.serialize_listing_variant_parent();

-- The final limiter definition is a union of every previously approved scope
-- plus two isolated order scopes. Replacing it must not regress auth,
-- onboarding, or listing-request paths.
create or replace function public.consume_auth_rate_limit(
  p_scope text,
  p_identifier text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  max_requests integer;
  window_seconds integer;
  current_count integer;
begin
  if p_identifier !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid rate-limit identifier';
  end if;

  case p_scope
    when 'guest_intent' then max_requests := 10; window_seconds := 600;
    when 'listing_request_intent' then max_requests := 8; window_seconds := 600;
    when 'listing_order_intent' then max_requests := 8; window_seconds := 600;
    when 'listing_order_place' then max_requests := 20; window_seconds := 3600;
    when 'listing_order_replay' then max_requests := 120; window_seconds := 3600;
    when 'email_sign_in' then max_requests := 5; window_seconds := 900;
    when 'oauth_sign_in' then max_requests := 10; window_seconds := 600;
    when 'auth_callback' then max_requests := 20; window_seconds := 600;
    when 'intent_resume' then max_requests := 20; window_seconds := 600;
    when 'business_onboarding' then max_requests := 3; window_seconds := 86400;
    when 'business_onboarding_save' then max_requests := 120; window_seconds := 3600;
    else raise exception 'invalid rate-limit scope';
  end case;

  insert into public.auth_rate_limits as limits(
    scope, identifier_hash, window_started_at, request_count, updated_at
  )
  values (p_scope, p_identifier, now(), 1, now())
  on conflict(scope, identifier_hash) do update set
    window_started_at = case
      when limits.window_started_at <= now() - make_interval(secs => window_seconds)
        then now()
      else limits.window_started_at
    end,
    request_count = case
      when limits.window_started_at <= now() - make_interval(secs => window_seconds)
        then 1
      else limits.request_count + 1
    end,
    updated_at = now()
  returning request_count into current_count;

  return current_count <= max_requests;
end;
$$;

-- Preserve generic and listing-request claim semantics while making order
-- capabilities claimable-but-unconsumed until the explicit placement RPC.
create or replace function public.claim_guest_intent(
  p_intent_id uuid,
  p_secret text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  intent public.guest_intents%rowtype;
begin
  if actor is null or not public.is_active_profile(actor) then
    return jsonb_build_object('outcome', 'invalid', 'retryable', false);
  end if;

  select * into intent
  from public.guest_intents g
  where g.id = p_intent_id
  for update;

  if not found then
    return jsonb_build_object('outcome', 'invalid', 'retryable', false);
  end if;

  if intent.claimed_by is not null then
    if intent.claimed_by <> actor then
      return jsonb_build_object('outcome', 'claimed_by_other', 'retryable', false);
    end if;
    if intent.kind in ('listing_request', 'listing_order')
      and intent.consumed_at is null
      and intent.expires_at <= now() then
      return jsonb_build_object('outcome', 'expired', 'retryable', false);
    end if;
    return jsonb_build_object(
      'outcome', 'replayed',
      'retryable', false,
      'intent_id', intent.id,
      'kind', intent.kind,
      'return_to', intent.return_to
    );
  end if;

  if intent.expires_at <= now() then
    return jsonb_build_object('outcome', 'expired', 'retryable', false);
  end if;
  if intent.consumed_at is not null
    or intent.secret_hash is null
    or p_secret is null
    or char_length(p_secret) not between 32 and 256
    or intent.secret_hash <> encode(extensions.digest(p_secret, 'sha256'), 'hex') then
    return jsonb_build_object('outcome', 'invalid', 'retryable', false);
  end if;

  update public.guest_intents
  set claimed_by = actor,
      claimed_at = now(),
      expires_at = case
        when intent.kind in ('listing_request', 'listing_order')
          then now() + interval '15 minutes'
        else intent.expires_at
      end,
      secret_hash = null,
      consumed_at = case
        when intent.kind in ('listing_request', 'listing_order') then null
        else now()
      end,
      updated_at = now()
  where id = intent.id;

  if intent.kind = 'listing_order' then
    update private.listing_order_quotes
    set expires_at = now()
      + interval '15 minutes'
    where intent_id = intent.id;
  end if;

  return jsonb_build_object(
    'outcome', 'claimed',
    'retryable', false,
    'intent_id', intent.id,
    'kind', intent.kind,
    'return_to', intent.return_to
  );
end;
$$;

create or replace function public.create_listing_order_intent(
  p_listing_id uuid,
  p_quantity integer,
  p_rate_limit_key text
)
returns table(id uuid, secret text, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  raw_secret text := replace(extensions.gen_random_uuid()::text, '-', '')
    || replace(extensions.gen_random_uuid()::text, '-', '');
  listing_row public.listings%rowtype;
  business_row public.businesses%rowtype;
  market_row public.markets%rowtype;
  category_row public.categories%rowtype;
  new_intent_id uuid := extensions.gen_random_uuid();
  new_expires_at timestamptz := now() + interval '15 minutes';
  route_key text;
  return_path text;
  quoted_total bigint;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'service role is required';
  end if;
  if p_listing_id is null
    or p_quantity is null
    or p_quantity not between 1 and 100
    or p_rate_limit_key is null
    or p_rate_limit_key !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid listing order intent';
  end if;
  if not public.consume_auth_rate_limit('listing_order_intent', p_rate_limit_key) then
    raise exception 'listing order intent rate limit exceeded';
  end if;

  -- Fixed lock order: listing, business, market, then category. The exclusive
  -- parent-row lock also serializes listing-variant FK checks, so an active
  -- variant cannot appear between the base-listing check and quote creation.
  select l.* into listing_row
  from public.listings l
  where l.id = p_listing_id
  for update;
  if not found
    or listing_row.status <> 'active'
    or listing_row.published_at is null
    or not listing_row.is_orderable
    or listing_row.category_id is null
    or listing_row.price_minor is null
    or listing_row.price_minor <= 0 then
    raise exception 'listing is not available for orders';
  end if;

  select b.* into business_row
  from public.businesses b
  where b.id = listing_row.business_id
  for share;
  if not found or business_row.status <> 'active'
    or business_row.market_id <> listing_row.market_id then
    raise exception 'listing is not available for orders';
  end if;

  select m.* into market_row
  from public.markets m
  where m.id = listing_row.market_id
  for share;
  if not found or not market_row.is_active then
    raise exception 'listing is not available for orders';
  end if;

  select c.* into category_row
  from public.categories c
  where c.id = listing_row.category_id
  for share;
  if not found or not category_row.is_active
    or (category_row.market_id is not null
      and category_row.market_id <> listing_row.market_id) then
    raise exception 'listing is not available for orders';
  end if;

  if listing_row.currency_code <> market_row.currency_code
    or listing_row.price_minor > 9007199254740991
    or listing_row.price_minor::numeric * p_quantity::numeric
      > 9007199254740991::numeric
    or exists (
      select 1 from public.listing_variants v
      where v.listing_id = listing_row.id and v.is_active
    ) then
    raise exception 'listing is not available for base orders';
  end if;

  if not private.is_bounded_visible_order_text(listing_row.title, 2, 160)
    or not private.is_bounded_visible_order_text(business_row.name, 2, 160)
    or pg_catalog.char_length(market_row.slug) not between 1 and 80 then
    raise exception 'listing is not available for orders';
  end if;

  route_key := format('%s~%s', business_row.slug, listing_row.slug);
  if pg_catalog.char_length(route_key) not between 3 and 201 then
    raise exception 'listing is not available for orders';
  end if;
  return_path := format('/%s/listings/%s/order', market_row.slug, route_key);
  quoted_total := listing_row.price_minor * p_quantity::bigint;

  insert into public.guest_intents(
    id, market_id, secret_hash, kind, return_to, payload, expires_at
  ) values (
    new_intent_id,
    listing_row.market_id,
    encode(extensions.digest(raw_secret, 'sha256'), 'hex'),
    'listing_order',
    return_path,
    jsonb_build_object(
      'type', 'listing_order',
      'listing_id', listing_row.id,
      'business_id', business_row.id,
      'market_id', market_row.id,
      'category_id', category_row.id,
      'quantity', p_quantity,
      'listing_route', route_key
    ),
    new_expires_at
  );

  insert into private.listing_order_quotes(
    intent_id, listing_id, business_id, market_id, category_id, quantity,
    listing_title, vendor_name, market_slug, listing_route, currency_code,
    unit_price_minor, total_minor, expires_at
  ) values (
    new_intent_id, listing_row.id, business_row.id, market_row.id,
    category_row.id, p_quantity, listing_row.title, business_row.name,
    market_row.slug, route_key, listing_row.currency_code,
    listing_row.price_minor, quoted_total, new_expires_at
  );

  return query select new_intent_id, raw_secret, new_expires_at;
end;
$$;

create or replace function public.get_listing_order_intent(
  p_intent_id uuid
)
returns table(
  intent_id uuid,
  listing_id uuid,
  business_id uuid,
  market_id uuid,
  quantity integer,
  return_to text,
  market_slug text,
  listing_route text,
  listing_title text,
  vendor_name text,
  currency_code text,
  unit_price_minor bigint,
  total_minor bigint,
  claimed_at timestamptz,
  expires_at timestamptz,
  consumed_at timestamptz,
  order_id uuid,
  order_number text,
  order_status text,
  order_created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    g.id,
    q.listing_id,
    q.business_id,
    q.market_id,
    q.quantity,
    g.return_to,
    q.market_slug,
    q.listing_route,
    q.listing_title,
    q.vendor_name,
    q.currency_code::text,
    q.unit_price_minor,
    q.total_minor,
    g.claimed_at,
    g.expires_at,
    g.consumed_at,
    o.id,
    o.order_number,
    o.status::text,
    o.created_at
  from public.guest_intents g
  join private.listing_order_quotes q on q.intent_id = g.id
  left join public.orders o on o.guest_intent_id = g.id
  where g.id = p_intent_id
    and g.kind = 'listing_order'
    and g.claimed_by = (select auth.uid())
    and (select public.is_current_profile_active())
    and (g.consumed_at is not null or g.expires_at > now())
    and q.expires_at = g.expires_at
    and g.market_id = q.market_id
    and g.return_to = format('/%s/listings/%s/order', q.market_slug, q.listing_route)
    and g.payload = jsonb_build_object(
      'type', 'listing_order',
      'listing_id', q.listing_id,
      'business_id', q.business_id,
      'market_id', q.market_id,
      'category_id', q.category_id,
      'quantity', q.quantity,
      'listing_route', q.listing_route
    )
$$;

create or replace function public.prevent_listing_order_snapshot_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  protected_intent uuid;
  parent_order public.orders%rowtype;
begin
  if tg_table_name = 'orders' then
    -- FK retention cleanup may clear only the capability pointer. The durable
    -- source marker keeps every commerce snapshot field protected afterward.
    if tg_op = 'UPDATE'
      and old.snapshot_source = 'listing_order'
      and old.guest_intent_id is not null
      and new.guest_intent_id is null
      and row(
        new.id, new.order_number, new.buyer_id, new.business_id,
        new.market_id, new.status, new.currency_code, new.subtotal_minor,
        new.total_minor, new.placed_at, new.created_at, new.snapshot_source,
        new.vendor_name_snapshot, new.listing_route_snapshot
      ) is not distinct from row(
        old.id, old.order_number, old.buyer_id, old.business_id,
        old.market_id, old.status, old.currency_code, old.subtotal_minor,
        old.total_minor, old.placed_at, old.created_at, old.snapshot_source,
        old.vendor_name_snapshot, old.listing_route_snapshot
      ) then
      return new;
    end if;
    if old.snapshot_source = 'listing_order' then
      protected_intent := old.id;
    end if;
  elsif tg_table_name = 'order_items' and tg_op = 'INSERT' then
    select o.* into parent_order
    from public.orders o
    where o.id = new.order_id
    for update;
    if parent_order.id is null or parent_order.snapshot_source <> 'listing_order' then
      return new;
    end if;
    if exists (
      select 1 from public.order_items i where i.order_id = new.order_id
    ) then
      raise exception 'listing order snapshots are immutable';
    end if;
    if not private.is_bounded_visible_order_text(new.title_snapshot, 2, 160)
      or new.listing_id is null
      or new.variant_id is not null
      or new.quantity not between 1 and 100
      or new.unit_price_minor not between 1 and 9007199254740991
      or new.total_minor not between 1 and 9007199254740991
      or new.total_minor::numeric
        <> new.unit_price_minor::numeric * new.quantity::numeric then
      raise exception 'invalid listing order item snapshot';
    end if;
    return new;
  elsif tg_table_name = 'order_items' then
    select o.id into protected_intent
    from public.orders o where o.id = old.order_id;
    if not exists (
      select 1 from public.orders o
      where o.id = old.order_id and o.snapshot_source = 'listing_order'
    ) then
      protected_intent := null;
    end if;
  elsif tg_table_name = 'order_status_events' and tg_op = 'INSERT' then
    select o.* into parent_order
    from public.orders o
    where o.id = new.order_id
    for update;
    if parent_order.id is null or parent_order.snapshot_source <> 'listing_order' then
      return new;
    end if;
    if exists (
      select 1 from public.order_status_events e where e.order_id = new.order_id
    ) then
      raise exception 'listing order snapshots are immutable';
    end if;
    if new.status <> 'placed'
      or new.actor_id is distinct from parent_order.buyer_id
      or new.note is not null
      or new.occurred_at is distinct from parent_order.placed_at then
      raise exception 'invalid listing order placed event';
    end if;
    return new;
  elsif tg_table_name = 'order_status_events' then
    select o.id into protected_intent
    from public.orders o where o.id = old.order_id;
    if not exists (
      select 1 from public.orders o
      where o.id = old.order_id and o.snapshot_source = 'listing_order'
    ) then
      protected_intent := null;
    end if;
  else
    raise exception 'unsupported order snapshot trigger target';
  end if;

  if protected_intent is not null then
    raise exception 'listing order snapshots are immutable';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;
revoke all on function public.prevent_listing_order_snapshot_mutation()
  from public, anon, authenticated, service_role;

drop trigger if exists orders_protect_listing_order_snapshot on public.orders;
create trigger orders_protect_listing_order_snapshot
  before update or delete on public.orders
  for each row execute function public.prevent_listing_order_snapshot_mutation();
drop trigger if exists order_items_protect_listing_order_snapshot on public.order_items;
create trigger order_items_protect_listing_order_snapshot
  before insert or update or delete on public.order_items
  for each row execute function public.prevent_listing_order_snapshot_mutation();
drop trigger if exists order_events_protect_listing_order_snapshot on public.order_status_events;
create trigger order_events_protect_listing_order_snapshot
  before insert or update or delete on public.order_status_events
  for each row execute function public.prevent_listing_order_snapshot_mutation();

create or replace function public.create_listing_order_from_intent(
  p_intent_id uuid
)
returns table(
  outcome text,
  retryable boolean,
  order_id uuid,
  order_number text,
  status text,
  created_at timestamptz,
  placed_at timestamptz,
  business_id uuid,
  vendor_name text,
  market_slug text,
  listing_id uuid,
  listing_route text,
  listing_title text,
  quantity integer,
  currency_code text,
  unit_price_minor bigint,
  total_minor bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  active_actor uuid;
  actor_rate_key text;
  intent public.guest_intents%rowtype;
  quote private.listing_order_quotes%rowtype;
  existing_order public.orders%rowtype;
  existing_item public.order_items%rowtype;
  listing_row public.listings%rowtype;
  business_row public.businesses%rowtype;
  market_row public.markets%rowtype;
  category_row public.categories%rowtype;
  new_order_id uuid := extensions.gen_random_uuid();
  new_order_number text;
  placement_time timestamptz := clock_timestamp();
  item_count integer;
  event_count integer;
  owned_replay_candidate boolean;
begin
  if actor is null or (select auth.role()) is distinct from 'authenticated'
    or p_intent_id is null then
    return query select 'invalid', false, null::uuid, null::text, null::text,
      null::timestamptz, null::timestamptz, null::uuid, null::text,
      null::text, null::uuid, null::text, null::text, null::integer,
      null::text, null::bigint, null::bigint;
    return;
  end if;

  -- Fixed lock order begins with the active actor. A committed order owned by
  -- this actor is a replay candidate and bypasses the placement limiter only
  -- after the normal intent/quote/order verification below succeeds.
  select p.id into active_actor
  from public.profiles p
  where p.id = actor and not p.is_suspended
  for share;
  if active_actor is null then
    return query select 'invalid', false, null::uuid, null::text, null::text,
      null::timestamptz, null::timestamptz, null::uuid, null::text,
      null::text, null::uuid, null::text, null::text, null::integer,
      null::text, null::bigint, null::bigint;
    return;
  end if;

  select exists (
    select 1
    from public.orders o
    where o.guest_intent_id = p_intent_id and o.buyer_id = actor
  ) into owned_replay_candidate;

  actor_rate_key := encode(extensions.digest(actor::text, 'sha256'), 'hex');
  if owned_replay_candidate then
    if not public.consume_auth_rate_limit('listing_order_replay', actor_rate_key) then
      return query select 'rate_limited', true, null::uuid, null::text, null::text,
        null::timestamptz, null::timestamptz, null::uuid, null::text,
        null::text, null::uuid, null::text, null::text, null::integer,
        null::text, null::bigint, null::bigint;
      return;
    end if;
  else
    if not public.consume_auth_rate_limit('listing_order_place', actor_rate_key) then
      return query select 'rate_limited', true, null::uuid, null::text, null::text,
        null::timestamptz, null::timestamptz, null::uuid, null::text,
        null::text, null::uuid, null::text, null::text, null::integer,
        null::text, null::bigint, null::bigint;
      return;
    end if;
  end if;

  select g.* into intent
  from public.guest_intents g
  where g.id = p_intent_id
  for update;
  if not found
    or intent.kind <> 'listing_order'
    or intent.claimed_by is distinct from actor
    or intent.claimed_at is null then
    return query select 'invalid', false, null::uuid, null::text, null::text,
      null::timestamptz, null::timestamptz, null::uuid, null::text,
      null::text, null::uuid, null::text, null::text, null::integer,
      null::text, null::bigint, null::bigint;
    return;
  end if;

  select q.* into quote
  from private.listing_order_quotes q
  where q.intent_id = intent.id
  for share;
  if not found then
    return query select 'invalid', false, null::uuid, null::text, null::text,
      null::timestamptz, null::timestamptz, null::uuid, null::text,
      null::text, null::uuid, null::text, null::text, null::integer,
      null::text, null::bigint, null::bigint;
    return;
  end if;

  select o.* into existing_order
  from public.orders o
  where o.guest_intent_id = intent.id
  for share;
  if found then
    select i.* into existing_item
    from public.order_items i
    where i.order_id = existing_order.id
    for share;
    select count(*)::integer into item_count
    from public.order_items i
    where i.order_id = existing_order.id;
    select count(*)::integer into event_count
    from public.order_status_events e
    where e.order_id = existing_order.id;
    if intent.consumed_at is null
      or existing_order.buyer_id <> actor
      or existing_order.business_id <> quote.business_id
      or existing_order.market_id <> quote.market_id
      or existing_order.status <> 'placed'
      or existing_order.placed_at is null
      or existing_order.currency_code <> quote.currency_code
      or existing_order.subtotal_minor <> quote.total_minor
      or existing_order.total_minor <> quote.total_minor
      or existing_order.vendor_name_snapshot <> quote.vendor_name
      or existing_order.listing_route_snapshot <> quote.listing_route
      or item_count <> 1
      or existing_item.id is null
      or existing_item.listing_id <> quote.listing_id
      or existing_item.variant_id is not null
      or existing_item.title_snapshot <> quote.listing_title
      or existing_item.quantity <> quote.quantity
      or existing_item.unit_price_minor <> quote.unit_price_minor
      or existing_item.total_minor <> quote.total_minor
      or event_count <> 1
      or not exists (
        select 1 from public.order_status_events e
        where e.order_id = existing_order.id
          and e.status = 'placed'
          and e.actor_id = actor
      ) then
      raise exception 'listing order replay state is inconsistent';
    end if;
    return query select
      'replayed', false, existing_order.id, existing_order.order_number,
      existing_order.status::text, existing_order.created_at,
      existing_order.placed_at, quote.business_id, quote.vendor_name,
      quote.market_slug, quote.listing_id, quote.listing_route,
      quote.listing_title, quote.quantity, quote.currency_code::text,
      quote.unit_price_minor, quote.total_minor;
    return;
  end if;

  if intent.consumed_at is not null then
    raise exception 'listing order intent was consumed without an order';
  end if;
  if intent.expires_at <= now() or quote.expires_at <= now() then
    return query select 'expired', false, null::uuid, null::text, null::text,
      null::timestamptz, null::timestamptz, null::uuid, null::text,
      null::text, null::uuid, null::text, null::text, null::integer,
      null::text, null::bigint, null::bigint;
    return;
  end if;
  if quote.expires_at <> intent.expires_at
    or intent.market_id <> quote.market_id
    or intent.return_to <> format('/%s/listings/%s/order', quote.market_slug, quote.listing_route)
    or intent.payload <> jsonb_build_object(
      'type', 'listing_order',
      'listing_id', quote.listing_id,
      'business_id', quote.business_id,
      'market_id', quote.market_id,
      'category_id', quote.category_id,
      'quantity', quote.quantity,
      'listing_route', quote.listing_route
    ) then
    return query select 'invalid', false, null::uuid, null::text, null::text,
      null::timestamptz, null::timestamptz, null::uuid, null::text,
      null::text, null::uuid, null::text, null::text, null::integer,
      null::text, null::bigint, null::bigint;
    return;
  end if;

  -- Continue the global lock order with listing, business, market, category.
  -- FOR UPDATE conflicts with the KEY SHARE lock required by concurrent
  -- listing-variant inserts and closes the base-listing eligibility race.
  select l.* into listing_row
  from public.listings l where l.id = quote.listing_id for update;
  if not found
    or listing_row.status <> 'active'
    or listing_row.published_at is null
    or not listing_row.is_orderable
    or listing_row.price_minor is null
    or listing_row.price_minor <= 0
    or listing_row.price_minor > 9007199254740991
    or exists (
      select 1 from public.listing_variants v
      where v.listing_id = quote.listing_id and v.is_active
    ) then
    return query select 'unavailable', false, null::uuid, null::text, null::text,
      null::timestamptz, null::timestamptz, null::uuid, null::text,
      null::text, null::uuid, null::text, null::text, null::integer,
      null::text, null::bigint, null::bigint;
    return;
  end if;

  select b.* into business_row
  from public.businesses b where b.id = quote.business_id for share;
  select m.* into market_row
  from public.markets m where m.id = quote.market_id for share;
  select c.* into category_row
  from public.categories c where c.id = quote.category_id for share;
  if business_row.id is null or business_row.status <> 'active'
    or market_row.id is null or not market_row.is_active
    or category_row.id is null or not category_row.is_active
    or (category_row.market_id is not null and category_row.market_id <> quote.market_id)
    or listing_row.business_id <> quote.business_id
    or listing_row.market_id <> quote.market_id
    or listing_row.category_id <> quote.category_id
    or business_row.market_id <> quote.market_id then
    return query select 'unavailable', false, null::uuid, null::text, null::text,
      null::timestamptz, null::timestamptz, null::uuid, null::text,
      null::text, null::uuid, null::text, null::text, null::integer,
      null::text, null::bigint, null::bigint;
    return;
  end if;

  if listing_row.title <> quote.listing_title
    or business_row.name <> quote.vendor_name
    or market_row.slug <> quote.market_slug
    or format('%s~%s', business_row.slug, listing_row.slug) <> quote.listing_route
    or listing_row.currency_code <> quote.currency_code
    or market_row.currency_code <> quote.currency_code
    or listing_row.price_minor <> quote.unit_price_minor
    or listing_row.price_minor::numeric * quote.quantity::numeric
      <> quote.total_minor::numeric then
    return query select 'quote_changed', false, null::uuid, null::text, null::text,
      null::timestamptz, null::timestamptz, null::uuid, null::text,
      null::text, null::uuid, null::text, null::text, null::integer,
      null::text, null::bigint, null::bigint;
    return;
  end if;

  new_order_number := format(
    'LO-%s-%s',
    to_char(current_date, 'YYMMDD'),
    lpad(nextval('public.localhub_order_number_sequence')::text, 10, '0')
  );

  insert into public.orders(
    id, order_number, buyer_id, business_id, market_id, status,
    currency_code, subtotal_minor, total_minor, guest_intent_id, snapshot_source,
    vendor_name_snapshot, listing_route_snapshot, placed_at, created_at, updated_at
  ) values (
    new_order_id, new_order_number, actor, quote.business_id, quote.market_id,
    'placed', quote.currency_code, quote.total_minor, quote.total_minor,
    intent.id, 'listing_order', quote.vendor_name, quote.listing_route, placement_time,
    placement_time, placement_time
  );
  insert into public.order_items(
    order_id, listing_id, variant_id, title_snapshot, quantity,
    unit_price_minor, total_minor, created_at
  ) values (
    new_order_id, quote.listing_id, null, quote.listing_title, quote.quantity,
    quote.unit_price_minor, quote.total_minor, placement_time
  );
  insert into public.order_status_events(
    order_id, status, actor_id, note, occurred_at
  ) values (new_order_id, 'placed', actor, null, placement_time);
  insert into public.audit_events(
    actor_id, subject_type, subject_id, action, metadata, created_at
  ) values (
    actor, 'order', new_order_id, 'order.placed',
    jsonb_build_object(
      'business_id', quote.business_id,
      'listing_id', quote.listing_id
    ),
    placement_time
  );
  update public.guest_intents
  set consumed_at = placement_time, updated_at = placement_time
  where id = intent.id and consumed_at is null;
  if not found then
    raise exception 'listing order intent consumption failed';
  end if;

  return query select
    'created', false, new_order_id, new_order_number, 'placed', placement_time,
    placement_time, quote.business_id, quote.vendor_name, quote.market_slug,
    quote.listing_id, quote.listing_route, quote.listing_title, quote.quantity,
    quote.currency_code::text, quote.unit_price_minor, quote.total_minor;
end;
$$;

-- Bounded, presentation-safe projections. Every read checks current active
-- profile state; vendor reads also re-check accepted exact-business membership.
create or replace function public.list_customer_orders(p_market_slug text)
returns table(
  order_id uuid, order_number text, status text, created_at timestamptz,
  placed_at timestamptz, business_id uuid, vendor_name text, market_slug text,
  listing_id uuid, listing_route text, listing_title text, quantity integer,
  currency_code text, unit_price_minor bigint, total_minor bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_market_slug is null
    or p_market_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    or char_length(p_market_slug) > 80
    or not (select public.is_current_profile_active()) then
    return;
  end if;
  return query
  select o.id, o.order_number, o.status::text, o.created_at, o.placed_at,
    o.business_id, o.vendor_name_snapshot, m.slug, i.listing_id,
    o.listing_route_snapshot, i.title_snapshot, i.quantity,
    o.currency_code::text, i.unit_price_minor, o.total_minor
  from public.orders o
  join public.order_items i on i.order_id = o.id
  join public.markets m on m.id = o.market_id
  where o.buyer_id = (select auth.uid())
    and o.snapshot_source = 'listing_order'
    and m.slug = p_market_slug
    and not exists (
      select 1 from public.order_items extra
      where extra.order_id = o.id and extra.id <> i.id
    )
  order by o.created_at desc, o.id desc
  limit 100;
end;
$$;

create or replace function public.get_customer_order(
  p_market_slug text,
  p_order_number text
)
returns table(
  order_id uuid, order_number text, status text, created_at timestamptz,
  placed_at timestamptz, business_id uuid, vendor_name text, market_slug text,
  listing_id uuid, listing_route text, listing_title text, quantity integer,
  currency_code text, unit_price_minor bigint, total_minor bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select o.id, o.order_number, o.status::text, o.created_at, o.placed_at,
    o.business_id, o.vendor_name_snapshot, m.slug, i.listing_id,
    o.listing_route_snapshot, i.title_snapshot, i.quantity,
    o.currency_code::text, i.unit_price_minor, o.total_minor
  from public.orders o
  join public.order_items i on i.order_id = o.id
  join public.markets m on m.id = o.market_id
  where p_market_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    and char_length(p_market_slug) <= 80
    and p_order_number ~ '^LO-[0-9]{6}-[0-9]{10}$'
    and o.order_number = p_order_number
    and o.buyer_id = (select auth.uid())
    and o.snapshot_source = 'listing_order'
    and m.slug = p_market_slug
    and not exists (
      select 1 from public.order_items extra
      where extra.order_id = o.id and extra.id <> i.id
    )
    and (select public.is_current_profile_active())
$$;

create or replace function public.list_vendor_orders()
returns table(
  order_id uuid, order_number text, status text, created_at timestamptz,
  placed_at timestamptz, business_id uuid, vendor_name text, market_slug text,
  listing_id uuid, listing_route text, listing_title text, quantity integer,
  currency_code text, unit_price_minor bigint, total_minor bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select o.id, o.order_number, o.status::text, o.created_at, o.placed_at,
    o.business_id, o.vendor_name_snapshot, m.slug, i.listing_id,
    o.listing_route_snapshot, i.title_snapshot, i.quantity,
    o.currency_code::text, i.unit_price_minor, o.total_minor
  from public.orders o
  join public.order_items i on i.order_id = o.id
  join public.markets m on m.id = o.market_id
  where o.snapshot_source = 'listing_order'
    and (select public.is_current_profile_active())
    and not exists (
      select 1 from public.order_items extra
      where extra.order_id = o.id and extra.id <> i.id
    )
    and exists (
      select 1 from public.business_memberships membership
      where membership.business_id = o.business_id
        and membership.profile_id = (select auth.uid())
        and membership.accepted_at is not null
    )
  order by o.created_at desc, o.id desc
  limit 100
$$;

create or replace function public.get_vendor_order(p_order_number text)
returns table(
  order_id uuid, order_number text, status text, created_at timestamptz,
  placed_at timestamptz, business_id uuid, vendor_name text, market_slug text,
  listing_id uuid, listing_route text, listing_title text, quantity integer,
  currency_code text, unit_price_minor bigint, total_minor bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select o.id, o.order_number, o.status::text, o.created_at, o.placed_at,
    o.business_id, o.vendor_name_snapshot, m.slug, i.listing_id,
    o.listing_route_snapshot, i.title_snapshot, i.quantity,
    o.currency_code::text, i.unit_price_minor, o.total_minor
  from public.orders o
  join public.order_items i on i.order_id = o.id
  join public.markets m on m.id = o.market_id
  where p_order_number ~ '^LO-[0-9]{6}-[0-9]{10}$'
    and o.order_number = p_order_number
    and o.snapshot_source = 'listing_order'
    and (select public.is_current_profile_active())
    and not exists (
      select 1 from public.order_items extra
      where extra.order_id = o.id and extra.id <> i.id
    )
    and exists (
      select 1 from public.business_memberships membership
      where membership.business_id = o.business_id
        and membership.profile_id = (select auth.uid())
        and membership.accepted_at is not null
    )
$$;

create or replace function public.prune_listing_order_intents(
  p_batch_size integer default 500
)
returns table(
  listing_order_intents_pruned integer,
  auth_rate_limits_pruned integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  intents_pruned integer;
  limits_pruned integer;
begin
  if p_batch_size is null or p_batch_size not between 1 and 2000 then
    raise exception 'invalid listing order intent prune batch size';
  end if;
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'service role is required';
  end if;

  with candidates as (
    select g.id
    from public.guest_intents g
    where g.kind = 'listing_order'
      and (
        (g.consumed_at is null and g.expires_at <= now() - interval '24 hours')
        or (g.consumed_at is not null and g.consumed_at <= now() - interval '30 days')
      )
      and (
        g.consumed_at is not null
        or not exists (
          select 1 from public.orders o where o.guest_intent_id = g.id
        )
      )
    order by g.expires_at, g.id
    limit p_batch_size
    for update skip locked
  ), deleted as (
    delete from public.guest_intents g
    using candidates c
    where g.id = c.id
    returning g.id
  )
  select count(*)::integer into intents_pruned from deleted;

  with candidates as (
    select limits.ctid
    from public.auth_rate_limits limits
    where limits.scope in (
      'listing_order_intent', 'listing_order_place', 'listing_order_replay'
    )
      and limits.updated_at <= now() - interval '48 hours'
    order by limits.updated_at, limits.ctid
    limit p_batch_size
    for update skip locked
  ), deleted as (
    delete from public.auth_rate_limits limits
    using candidates c
    where limits.ctid = c.ctid
    returning limits.ctid
  )
  select count(*)::integer into limits_pruned from deleted;

  return query select intents_pruned, limits_pruned;
end;
$$;

-- Child-table RLS must not query orders.buyer_id as the authenticated caller:
-- that identity column is deliberately absent from the public column grant.
-- This narrow definer helper performs the authorization check without exposing
-- customer identity and keeps direct SELECT/Realtime authorization usable.
create or replace function public.can_current_actor_view_order(p_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_order_id is not null
    and public.is_current_profile_active()
    and exists (
      select 1
      from public.orders o
      where o.id = p_order_id
        and (
          o.buyer_id = (select auth.uid())
          or exists (
            select 1
            from public.business_memberships membership
            where membership.business_id = o.business_id
              and membership.profile_id = (select auth.uid())
              and membership.accepted_at is not null
          )
        )
    )
$$;
revoke all on function public.can_current_actor_view_order(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.can_current_actor_view_order(uuid)
  to authenticated;

-- Active profile state and exact accepted membership are immediate RLS
-- backstops for Realtime-compatible direct SELECT.
drop policy if exists orders_buyer_create on public.orders;
drop policy if exists orders_buyer_or_business on public.orders;
create policy orders_active_customer_or_vendor_select
  on public.orders for select to authenticated
  using (
    (select public.is_current_profile_active())
    and (
      buyer_id = (select auth.uid())
      or exists (
        select 1 from public.business_memberships membership
        where membership.business_id = orders.business_id
          and membership.profile_id = (select auth.uid())
          and membership.accepted_at is not null
      )
    )
  );

drop policy if exists order_items_visible on public.order_items;
create policy order_items_active_customer_or_vendor_select
  on public.order_items for select to authenticated
  using ((select public.can_current_actor_view_order(order_items.order_id)));

drop policy if exists order_events_visible on public.order_status_events;
create policy order_events_active_customer_or_vendor_select
  on public.order_status_events for select to authenticated
  using ((select public.can_current_actor_view_order(order_status_events.order_id)));

-- Application and service roles have no direct mutation route. Authenticated
-- column grants omit buyer_id, guest_intent_id, and event actor_id so accepted
-- vendors cannot extract customer identity outside the safe RPC projections.
revoke all on table public.orders, public.order_items, public.order_status_events
  from public, anon, authenticated, service_role;
grant select (
  id, order_number, business_id, market_id, status, currency_code,
  subtotal_minor, total_minor, snapshot_source, vendor_name_snapshot, listing_route_snapshot,
  placed_at, created_at, updated_at
) on public.orders to authenticated;
grant select on public.order_items to authenticated;
grant select (id, order_id, status, occurred_at)
  on public.order_status_events to authenticated;
grant select on public.orders, public.order_items, public.order_status_events
  to service_role;

revoke all on function public.create_listing_order_intent(uuid, integer, text)
  from public, anon, authenticated, service_role;
grant execute on function public.create_listing_order_intent(uuid, integer, text)
  to service_role;
revoke all on function public.get_listing_order_intent(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_listing_order_intent(uuid)
  to authenticated;
revoke all on function public.create_listing_order_from_intent(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.create_listing_order_from_intent(uuid)
  to authenticated;
revoke all on function public.list_customer_orders(text)
  from public, anon, authenticated, service_role;
grant execute on function public.list_customer_orders(text) to authenticated;
revoke all on function public.get_customer_order(text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.get_customer_order(text, text) to authenticated;
revoke all on function public.list_vendor_orders()
  from public, anon, authenticated, service_role;
grant execute on function public.list_vendor_orders() to authenticated;
revoke all on function public.get_vendor_order(text)
  from public, anon, authenticated, service_role;
grant execute on function public.get_vendor_order(text) to authenticated;
revoke all on function public.prune_listing_order_intents(integer)
  from public, anon, authenticated, service_role;
grant execute on function public.prune_listing_order_intents(integer)
  to service_role;
revoke execute on function public.consume_auth_rate_limit(text, text)
  from public, anon, authenticated;
grant execute on function public.consume_auth_rate_limit(text, text)
  to service_role;
revoke execute on function public.claim_guest_intent(uuid, text)
  from public, anon;
grant execute on function public.claim_guest_intent(uuid, text)
  to authenticated;

comment on column public.listings.is_orderable is
  'Deny-by-default explicit switch for the protected base-listing order path.';
comment on function public.create_listing_order_from_intent(uuid) is
  'Creates one immutable placed order snapshot from a claimed listing_order capability; no payment, fulfilment, notification, or vendor transition.';

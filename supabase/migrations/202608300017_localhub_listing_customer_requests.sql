-- Authenticated customer requests for a single published LocalHub listing.
-- This is deliberately a request/intent boundary only: it never creates an
-- order, payment, booking, or vendor-response state transition.

alter table public.guest_intents
  add column if not exists claimed_at timestamptz;

alter table public.requests
  add column if not exists listing_id uuid references public.listings(id) on delete restrict,
  add column if not exists business_id uuid references public.businesses(id) on delete restrict,
  add column if not exists requested_action text,
  add column if not exists request_number text,
  add column if not exists search_context text;

-- Legacy, unlinked requests remain readable as historical records. Every new
-- listing request must carry the complete authoritative linkage.
alter table public.requests
  add constraint requests_listing_request_shape
  check (
    (listing_id is null and business_id is null and requested_action is null
      and request_number is null and search_context is null)
    or (
      listing_id is not null and business_id is not null
      and requested_action is not null
      and requested_action in ('enquire', 'request-booking')
      and request_number is not null
      and request_number ~ '^LR-[0-9]{6}-[0-9]{10}$'
      and search_context is not null
      and char_length(search_context) <= 160
      and search_context !~ '[[:cntrl:]]'
    )
  ) not valid;
alter table public.requests
  validate constraint requests_listing_request_shape;

create unique index if not exists requests_request_number_unique_idx
  on public.requests(request_number)
  where request_number is not null;
create unique index if not exists requests_one_request_per_intent_idx
  on public.requests(guest_intent_id)
  where guest_intent_id is not null;
create index if not exists requests_listing_customer_created_idx
  on public.requests(listing_id, requester_id, created_at desc)
  where listing_id is not null;
create index if not exists requests_business_created_idx
  on public.requests(business_id, created_at desc)
  where business_id is not null;
create index if not exists guest_intents_listing_request_expiry_idx
  on public.guest_intents(expires_at, id)
  where kind = 'listing_request' and consumed_at is null;
create index if not exists auth_rate_limits_listing_request_prune_idx
  on public.auth_rate_limits(updated_at)
  where scope = 'listing_request_intent';

create sequence if not exists public.listing_request_number_sequence
  as bigint start with 1 increment by 1 minvalue 1;
revoke all on sequence public.listing_request_number_sequence
  from public, anon, authenticated, service_role;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create table private.listing_request_actor_rate_limits (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  window_started_at timestamptz not null default now(),
  request_count integer not null default 0 check (request_count >= 0),
  updated_at timestamptz not null default now()
);
alter table private.listing_request_actor_rate_limits enable row level security;
create index listing_request_actor_rate_limits_prune_idx
  on private.listing_request_actor_rate_limits(updated_at);
revoke all on table private.listing_request_actor_rate_limits
  from public, anon, authenticated, service_role;

create or replace function private.consume_listing_request_actor_rate_limit()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  current_count integer;
begin
  if actor is null or not public.is_active_profile(actor) then
    raise exception 'active authentication is required';
  end if;
  insert into private.listing_request_actor_rate_limits as limits(
    profile_id, window_started_at, request_count, updated_at
  )
  values (actor, now(), 1, now())
  on conflict(profile_id) do update set
    window_started_at = case
      when limits.window_started_at <= now() - interval '1 hour' then now()
      else limits.window_started_at
    end,
    request_count = case
      when limits.window_started_at <= now() - interval '1 hour' then 1
      else limits.request_count + 1
    end,
    updated_at = now()
  returning request_count into current_count;
  return current_count <= 20;
end;
$$;
revoke all on function private.consume_listing_request_actor_rate_limit()
  from public, anon, authenticated, service_role;

create or replace function public.validate_listing_request_linkage()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.listing_id is not null and not exists (
    select 1
    from public.listings l
    join public.businesses b on b.id = l.business_id
    join public.markets m on m.id = l.market_id
    left join public.categories c on c.id = l.category_id
    where l.id = new.listing_id
      and l.business_id = new.business_id
      and l.market_id = new.market_id
      and new.category_id is not distinct from l.category_id
      and b.market_id = l.market_id
      and (c.id is null or c.market_id is null or c.market_id = l.market_id)
  ) then
    raise exception 'listing request linkage mismatch';
  end if;
  return new;
end;
$$;
revoke all on function public.validate_listing_request_linkage()
  from public, anon, authenticated, service_role;

drop trigger if exists requests_validate_listing_request_linkage on public.requests;
create trigger requests_validate_listing_request_linkage
  before insert or update of listing_id, business_id, market_id, category_id,
    requested_action, request_number, search_context
  on public.requests
  for each row execute function public.validate_listing_request_linkage();

-- Keep the existing shared auth limiter, but give service-created listing
-- intents their own bounded bucket.
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
    when 'email_sign_in' then max_requests := 5; window_seconds := 900;
    when 'oauth_sign_in' then max_requests := 10; window_seconds := 600;
    when 'auth_callback' then max_requests := 20; window_seconds := 600;
    when 'intent_resume' then max_requests := 20; window_seconds := 600;
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

create or replace function public.create_listing_request_intent(
  p_listing_id uuid,
  p_requested_action text,
  p_search_context text,
  p_rate_limit_key text
)
returns table(id uuid, secret text, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  raw_secret text := replace(gen_random_uuid()::text, '-', '')
    || replace(gen_random_uuid()::text, '-', '');
  normalized_context text := pg_catalog.btrim(coalesce(p_search_context, ''));
  target record;
  route_key text;
  return_path text;
  new_id uuid;
  new_expires_at timestamptz;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'service role is required';
  end if;
  if p_listing_id is null
    or p_requested_action is null
    or p_requested_action not in ('enquire', 'request-booking')
    or char_length(normalized_context) > 160
    or normalized_context ~ '[[:cntrl:]]'
    or p_rate_limit_key !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid listing request intent';
  end if;
  if not public.consume_auth_rate_limit('listing_request_intent', p_rate_limit_key) then
    raise exception 'listing request intent rate limit exceeded';
  end if;

  select
    l.id as listing_id,
    l.business_id,
    l.market_id,
    l.category_id,
    l.slug as listing_slug,
    m.slug as market_slug,
    b.slug as business_slug
  into target
  from public.listings l
  join public.businesses b on b.id = l.business_id
  join public.markets m on m.id = l.market_id
  join public.categories c on c.id = l.category_id
  where l.id = p_listing_id
    and l.status = 'active'
    and l.published_at is not null
    and b.status = 'active'
    and b.market_id = l.market_id
    and m.is_active
    and c.is_active
    and (c.market_id is null or c.market_id = l.market_id)
  for key share of l, b, m, c;

  if not found then
    raise exception 'listing is not available for requests';
  end if;

  route_key := format('%s~%s', target.business_slug, target.listing_slug);
  return_path := format('/%s/listings/%s/request', target.market_slug, route_key);
  insert into public.guest_intents(
    market_id, secret_hash, kind, return_to, payload, expires_at
  )
  values (
    target.market_id,
    encode(extensions.digest(raw_secret, 'sha256'), 'hex'),
    'listing_request',
    return_path,
    jsonb_build_object(
      'type', 'listing_request',
      'listing_id', target.listing_id,
      'business_id', target.business_id,
      'market_id', target.market_id,
      'category_id', target.category_id,
      'listing_route', route_key,
      'requested_action', p_requested_action,
      'search_context', normalized_context
    ),
    now() + interval '15 minutes'
  )
  returning guest_intents.id, guest_intents.expires_at into new_id, new_expires_at;

  id := new_id;
  secret := raw_secret;
  expires_at := new_expires_at;
  return next;
end;
$$;

-- One cookie claim RPC supports both generic continuation intents and the new
-- listing request intent. It never returns the stored payload.
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
  result_outcome text;
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
    if intent.kind = 'listing_request'
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

  result_outcome := 'claimed';
  update public.guest_intents
  set claimed_by = actor,
      claimed_at = now(),
      expires_at = case
        when intent.kind = 'listing_request' then now() + interval '15 minutes'
        else intent.expires_at
      end,
      secret_hash = null,
      consumed_at = case when intent.kind = 'listing_request' then null else now() end,
      updated_at = now()
  where id = intent.id;

  return jsonb_build_object(
    'outcome', result_outcome,
    'retryable', false,
    'intent_id', intent.id,
    'kind', intent.kind,
    'return_to', intent.return_to
  );
end;
$$;

create or replace function public.get_listing_request_intent(p_intent_id uuid)
returns table(
  intent_id uuid,
  listing_id uuid,
  business_id uuid,
  market_id uuid,
  category_id uuid,
  requested_action text,
  search_context text,
  return_to text,
  market_slug text,
  listing_route text,
  listing_title text,
  vendor_name text,
  claimed_at timestamptz,
  expires_at timestamptz,
  consumed_at timestamptz,
  request_id uuid,
  request_number text,
  request_status text,
  request_created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    g.id,
    l.id,
    b.id,
    m.id,
    c.id,
    g.payload->>'requested_action',
    g.payload->>'search_context',
    g.return_to,
    m.slug,
    g.payload->>'listing_route',
    l.title,
    b.name,
    g.claimed_at,
    g.expires_at,
    g.consumed_at,
    r.id,
    r.request_number,
    r.status,
    r.created_at
  from public.guest_intents g
  join public.listings l on l.id = case
    when g.payload->>'listing_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then (g.payload->>'listing_id')::uuid
    else null
  end
  join public.businesses b on b.id = l.business_id
  join public.markets m on m.id = l.market_id
  join public.categories c on c.id = l.category_id
  left join public.requests r on r.guest_intent_id = g.id
  where g.id = p_intent_id
    and g.kind = 'listing_request'
    and g.claimed_by = (select auth.uid())
    and (select public.is_current_profile_active())
    and l.status = 'active'
    and l.published_at is not null
    and b.status = 'active'
    and b.market_id = l.market_id
    and m.is_active
    and (g.consumed_at is not null or g.expires_at > now())
    and c.is_active
    and (c.market_id is null or c.market_id = l.market_id)
    and g.return_to = format('/%s/listings/%s~%s/request', m.slug, b.slug, l.slug)
    and (g.payload->>'requested_action') in ('enquire', 'request-booking')
    and char_length(coalesce(g.payload->>'search_context', '')) <= 160
    and coalesce(g.payload->>'search_context', '') !~ '[[:cntrl:]]'
    and g.payload = jsonb_build_object(
      'type', 'listing_request',
      'listing_id', l.id,
      'business_id', b.id,
      'market_id', m.id,
      'category_id', c.id,
      'listing_route', format('%s~%s', b.slug, l.slug),
      'requested_action', g.payload->>'requested_action',
      'search_context', g.payload->>'search_context'
    )
$$;

create or replace function public.create_listing_request_from_intent(
  p_intent_id uuid,
  p_details text
)
returns table(
  outcome text,
  retryable boolean,
  request_id uuid,
  request_number text,
  status text,
  created_at timestamptz,
  listing_title text,
  vendor_name text,
  market_slug text,
  listing_route text,
  listing_id uuid,
  requested_action text,
  details text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  intent public.guest_intents%rowtype;
  existing_request public.requests%rowtype;
  normalized_details text := pg_catalog.btrim(coalesce(p_details, ''));
  target record;
  payload_listing_id uuid;
  expected_route_key text;
  expected_return_to text;
  new_request_id uuid;
  new_request_number text;
  new_request_created_at timestamptz;
begin
  if actor is null or not public.is_active_profile(actor) then
    return query select 'invalid', false, null::uuid, null::text, null::text,
      null::timestamptz, null::text, null::text, null::text, null::text,
      null::uuid, null::text, null::text;
    return;
  end if;
  if p_intent_id is null
    or char_length(normalized_details) > 2000
    or normalized_details ~ E'[\001-\010\013\014\016-\037\177]' then
    raise exception 'invalid listing request details';
  end if;

  select * into intent
  from public.guest_intents g
  where g.id = p_intent_id
  for update;

  if not found
    or intent.kind <> 'listing_request'
    or intent.claimed_by is distinct from actor
    or intent.claimed_at is null then
    return query select 'invalid', false, null::uuid, null::text, null::text,
      null::timestamptz, null::text, null::text, null::text, null::text,
      null::uuid, null::text, null::text;
    return;
  end if;
  if intent.expires_at <= now() and intent.consumed_at is null then
    return query select 'expired', false, null::uuid, null::text, null::text,
      null::timestamptz, null::text, null::text, null::text, null::text,
      null::uuid, null::text, null::text;
    return;
  end if;

  select * into existing_request
  from public.requests r
  where r.guest_intent_id = intent.id
  for update;

  if found then
    if existing_request.requester_id is distinct from actor
      or coalesce(existing_request.details, '') <> normalized_details then
      raise exception 'conflicting listing request replay';
    end if;
    if intent.consumed_at is null then
      update public.guest_intents
      set consumed_at = now(), updated_at = now()
      where id = intent.id;
    end if;
    return query
    select
      'replayed', false, existing_request.id, existing_request.request_number,
      existing_request.status, existing_request.created_at, l.title, b.name,
      m.slug, format('%s~%s', b.slug, l.slug), l.id,
      existing_request.requested_action, coalesce(existing_request.details, '')
    from public.listings l
    join public.businesses b on b.id = l.business_id
    join public.markets m on m.id = l.market_id
    where l.id = existing_request.listing_id;
    return;
  end if;

  if not private.consume_listing_request_actor_rate_limit() then
    raise exception 'listing request creation rate limit exceeded';
  end if;

  if jsonb_typeof(intent.payload) <> 'object'
    or intent.payload->>'listing_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    return query select 'invalid', false, null::uuid, null::text, null::text,
      null::timestamptz, null::text, null::text, null::text, null::text,
      null::uuid, null::text, null::text;
    return;
  end if;
  payload_listing_id := (intent.payload->>'listing_id')::uuid;

  select
    l.id as listing_id,
    l.business_id,
    l.market_id,
    l.category_id,
    l.title as listing_title,
    l.slug as listing_slug,
    b.name as business_name,
    b.slug as business_slug,
    m.slug as market_slug
  into target
  from public.listings l
  join public.businesses b on b.id = l.business_id
  join public.markets m on m.id = l.market_id
  join public.categories c on c.id = l.category_id
  where l.id = payload_listing_id
    and l.status = 'active'
    and l.published_at is not null
    and b.status = 'active'
    and b.market_id = l.market_id
    and m.is_active
    and c.is_active
    and (c.market_id is null or c.market_id = l.market_id)
  for key share of l, b, m, c;

  if not found then
    return query select 'listing_unavailable', false, null::uuid, null::text, null::text,
      null::timestamptz, null::text, null::text, null::text, null::text,
      null::uuid, null::text, null::text;
    return;
  end if;

  expected_route_key := format('%s~%s', target.business_slug, target.listing_slug);
  expected_return_to := format('/%s/listings/%s/request', target.market_slug, expected_route_key);
  if intent.market_id is distinct from target.market_id
    or intent.return_to <> expected_return_to
    or jsonb_typeof(intent.payload) <> 'object'
    or intent.payload <> jsonb_build_object(
      'type', 'listing_request',
      'listing_id', target.listing_id,
      'business_id', target.business_id,
      'market_id', target.market_id,
      'category_id', target.category_id,
      'listing_route', expected_route_key,
      'requested_action', intent.payload->>'requested_action',
      'search_context', intent.payload->>'search_context'
    )
    or (intent.payload->>'requested_action') is null
    or (intent.payload->>'requested_action') not in ('enquire', 'request-booking')
    or char_length(coalesce(intent.payload->>'search_context', '')) > 160
    or coalesce(intent.payload->>'search_context', '') ~ '[[:cntrl:]]' then
    return query select 'invalid', false, null::uuid, null::text, null::text,
      null::timestamptz, null::text, null::text, null::text, null::text,
      null::uuid, null::text, null::text;
    return;
  end if;

  new_request_number := format(
    'LR-%s-%s',
    to_char(current_date, 'YYMMDD'),
    lpad(nextval('public.listing_request_number_sequence')::text, 10, '0')
  );
  insert into public.requests as request(
    requester_id, guest_intent_id, market_id, category_id, listing_id,
    business_id, requested_action, request_number, search_context, title,
    details, status
  )
  values (
    actor, intent.id, target.market_id, target.category_id, target.listing_id,
    target.business_id, intent.payload->>'requested_action', new_request_number,
    coalesce(intent.payload->>'search_context', ''), target.listing_title,
    nullif(normalized_details, ''), 'open'
  )
  returning request.id, request.created_at into new_request_id, new_request_created_at;

  update public.guest_intents
  set consumed_at = now(), updated_at = now()
  where id = intent.id;

  return query select
    'created', false, new_request_id, new_request_number, 'open', new_request_created_at,
    target.listing_title, target.business_name, target.market_slug, expected_route_key,
    target.listing_id, intent.payload->>'requested_action', normalized_details;
end;
$$;

-- These read RPCs return a bounded, presentation-safe request projection. The
-- table RLS policies remain the authoritative backstop for direct reads.
create or replace function public.list_customer_listing_requests(
  p_market_slug text
)
returns table(
  request_id uuid,
  request_number text,
  status text,
  requested_action text,
  created_at timestamptz,
  listing_id uuid,
  listing_title text,
  business_id uuid,
  vendor_name text,
  market_id uuid,
  market_slug text,
  listing_route text,
  search_context text,
  details text
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
  select
    r.id, r.request_number, r.status, r.requested_action, r.created_at,
    l.id, r.title, b.id, b.name, m.id, m.slug,
    format('%s~%s', b.slug, l.slug),
    r.search_context, r.details
  from public.requests r
  join public.listings l on l.id = r.listing_id
  join public.businesses b on b.id = r.business_id
  join public.markets m on m.id = r.market_id
  where r.requester_id = (select auth.uid())
    and r.listing_id is not null
    and m.slug = p_market_slug
  order by r.created_at desc, r.id desc
  limit 100;
end;
$$;

create or replace function public.get_customer_listing_request(
  p_request_id uuid
)
returns table(
  request_id uuid,
  request_number text,
  status text,
  requested_action text,
  created_at timestamptz,
  listing_id uuid,
  listing_title text,
  business_id uuid,
  vendor_name text,
  market_id uuid,
  market_slug text,
  listing_route text,
  search_context text,
  details text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    r.id, r.request_number, r.status, r.requested_action, r.created_at,
    l.id, r.title, b.id, b.name, m.id, m.slug,
    format('%s~%s', b.slug, l.slug),
    r.search_context, r.details
  from public.requests r
  join public.listings l on l.id = r.listing_id
  join public.businesses b on b.id = r.business_id
  join public.markets m on m.id = r.market_id
  where r.id = p_request_id
    and r.requester_id = (select auth.uid())
    and r.listing_id is not null
    and (select public.is_current_profile_active())
$$;

create or replace function public.list_vendor_listing_requests()
returns table(
  request_id uuid,
  request_number text,
  status text,
  requested_action text,
  created_at timestamptz,
  listing_id uuid,
  listing_title text,
  business_id uuid,
  vendor_name text,
  market_id uuid,
  market_slug text,
  listing_route text,
  search_context text,
  details text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    r.id, r.request_number, r.status, r.requested_action, r.created_at,
    l.id, r.title, b.id, b.name, m.id, m.slug,
    format('%s~%s', b.slug, l.slug),
    r.search_context, r.details
  from public.requests r
  join public.listings l on l.id = r.listing_id
  join public.businesses b on b.id = r.business_id
  join public.markets m on m.id = r.market_id
  where r.listing_id is not null
    and (select public.is_business_member(r.business_id))
    and (select public.is_current_profile_active())
  order by r.created_at desc, r.id desc
  limit 100
$$;

create or replace function public.prune_listing_request_intents(
  p_batch_size integer default 500
)
returns table(
  listing_request_intents_pruned integer,
  auth_rate_limits_pruned integer,
  actor_rate_limits_pruned integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  intents_pruned integer;
  limits_pruned integer;
  actor_limits_pruned integer;
begin
  if p_batch_size is null or p_batch_size not between 1 and 2000 then
    raise exception 'invalid listing request intent prune batch size';
  end if;
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'service role is required';
  end if;

  with candidates as (
    select g.id
    from public.guest_intents g
    where g.kind = 'listing_request'
      and (
        (g.consumed_at is null and g.expires_at <= now() - interval '24 hours')
        or (g.consumed_at is not null and g.consumed_at <= now() - interval '30 days')
      )
      and not exists (
        select 1
        from public.requests r
        where r.guest_intent_id = g.id
          and r.requester_id is null
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
    where limits.scope = 'listing_request_intent'
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

  with candidates as (
    select limits.profile_id
    from private.listing_request_actor_rate_limits limits
    where limits.updated_at <= now() - interval '48 hours'
    order by limits.updated_at, limits.profile_id
    limit p_batch_size
    for update skip locked
  ), deleted as (
    delete from private.listing_request_actor_rate_limits limits
    using candidates c
    where limits.profile_id = c.profile_id
    returning limits.profile_id
  )
  select count(*)::integer into actor_limits_pruned from deleted;

  return query select intents_pruned, limits_pruned, actor_limits_pruned;
end;
$$;

revoke insert on public.requests from authenticated;
drop policy if exists requests_owner_insert on public.requests;
drop policy if exists requests_owner_read on public.requests;
create policy requests_customer_select
  on public.requests for select to authenticated
  using (
    requester_id = (select auth.uid())
    and (select public.is_current_profile_active())
  );
create policy requests_selected_business_member_select
  on public.requests for select to authenticated
  using (
    (select public.is_business_member(business_id))
    and (select public.is_current_profile_active())
  );

revoke all on function public.create_listing_request_intent(uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.create_listing_request_intent(uuid, text, text, text)
  to service_role;
revoke execute on function public.claim_guest_intent(uuid, text)
  from public, anon;
grant execute on function public.claim_guest_intent(uuid, text)
  to authenticated;
revoke all on function public.get_listing_request_intent(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_listing_request_intent(uuid)
  to authenticated;
revoke all on function public.create_listing_request_from_intent(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.create_listing_request_from_intent(uuid, text)
  to authenticated;
revoke all on function public.list_customer_listing_requests(text)
  from public, anon, authenticated, service_role;
grant execute on function public.list_customer_listing_requests(text)
  to authenticated;
revoke all on function public.get_customer_listing_request(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_customer_listing_request(uuid)
  to authenticated;
revoke all on function public.list_vendor_listing_requests()
  from public, anon, authenticated, service_role;
grant execute on function public.list_vendor_listing_requests()
  to authenticated;
revoke all on function public.prune_listing_request_intents(integer)
  from public, anon, authenticated;
grant execute on function public.prune_listing_request_intents(integer)
  to service_role;
revoke execute on function public.consume_auth_rate_limit(text, text)
  from public, anon, authenticated;
grant execute on function public.consume_auth_rate_limit(text, text)
  to service_role;

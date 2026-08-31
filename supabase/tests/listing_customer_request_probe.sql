-- Live regression probe for 202608300017_localhub_listing_customer_requests.sql.
-- Run only after migrations 017 and 018 are live.  It creates an isolated
-- fixture, exercises the service/authenticated boundary, and always rolls
-- everything back.  It intentionally never selects or prints the capability
-- secret returned by create_listing_request_intent.

begin;

create temporary table listing_customer_request_probe_state (
  customer_id uuid not null,
  vendor_id uuid not null,
  foreign_id uuid not null,
  market_id uuid not null,
  category_id uuid not null,
  listing_type_id uuid not null,
  listing_schema_id uuid not null,
  business_id uuid not null,
  listing_id uuid not null,
  intent_id uuid,
  secret text,
  return_to text,
  request_id uuid,
  request_number text,
  baseline_auth_users bigint not null,
  baseline_profiles bigint not null,
  baseline_markets bigint not null,
  baseline_categories bigint not null,
  baseline_listing_types bigint not null,
  baseline_listing_schemas bigint not null,
  baseline_mappings bigint not null,
  baseline_businesses bigint not null,
  baseline_memberships bigint not null,
  baseline_listings bigint not null,
  baseline_intents bigint not null,
  baseline_requests bigint not null,
  baseline_auth_rate_limits bigint not null,
  baseline_actor_rate_limits bigint not null
) on commit drop;
grant all on table listing_customer_request_probe_state to authenticated, service_role;

do $$
declare
  customer_id uuid := extensions.gen_random_uuid();
  vendor_id uuid := extensions.gen_random_uuid();
  foreign_id uuid := extensions.gen_random_uuid();
  market_id uuid := extensions.gen_random_uuid();
  category_id uuid := extensions.gen_random_uuid();
  listing_type_id uuid := extensions.gen_random_uuid();
  listing_schema_id uuid := extensions.gen_random_uuid();
  business_id uuid := extensions.gen_random_uuid();
  listing_id uuid := extensions.gen_random_uuid();
  fixture_key text := replace(extensions.gen_random_uuid()::text, '-', '');
  ale_schema jsonb := jsonb_build_object(
    'contractVersion', '1.1',
    'schemaVersion', 1,
    'schemaKey', 'request_probe_v1',
    'listingKind', 'product',
    'terminology', jsonb_build_object(
      'singular', 'product', 'plural', 'products',
      'createAction', 'Add product'
    ),
    'bindings', jsonb_build_object('title', 'title'),
    'fields', jsonb_build_array(jsonb_build_object(
      'key', 'title', 'label', 'Product name',
      'required', true, 'type', 'short_text',
      'minLength', 2, 'maxLength', 120
    ))
  );
begin
  insert into listing_customer_request_probe_state(
    customer_id, vendor_id, foreign_id, market_id, category_id,
    listing_type_id, listing_schema_id, business_id, listing_id,
    baseline_auth_users, baseline_profiles, baseline_markets,
    baseline_categories, baseline_listing_types, baseline_listing_schemas,
    baseline_mappings, baseline_businesses, baseline_memberships,
    baseline_listings, baseline_intents, baseline_requests,
    baseline_auth_rate_limits, baseline_actor_rate_limits
  )
  select
    customer_id, vendor_id, foreign_id, market_id, category_id,
    listing_type_id, listing_schema_id, business_id, listing_id,
    (select count(*) from auth.users),
    (select count(*) from public.profiles),
    (select count(*) from public.markets),
    (select count(*) from public.categories),
    (select count(*) from public.listing_types),
    (select count(*) from public.listing_schemas),
    (select count(*) from public.category_listing_type_mappings),
    (select count(*) from public.businesses),
    (select count(*) from public.business_memberships),
    (select count(*) from public.listings),
    (select count(*) from public.guest_intents),
    (select count(*) from public.requests),
    (select count(*) from public.auth_rate_limits),
    (select count(*) from private.listing_request_actor_rate_limits);

  insert into auth.users(
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values
    (customer_id, '00000000-0000-0000-0000-000000000000', 'authenticated',
      'authenticated', 'listing-request-probe-customer-' || fixture_key || '@example.test', '', now(),
      '{"provider":"email","providers":["email"]}'::jsonb, '{}', now(), now()),
    (vendor_id, '00000000-0000-0000-0000-000000000000', 'authenticated',
      'authenticated', 'listing-request-probe-vendor-' || fixture_key || '@example.test', '', now(),
      '{"provider":"email","providers":["email"]}'::jsonb, '{}', now(), now()),
    (foreign_id, '00000000-0000-0000-0000-000000000000', 'authenticated',
      'authenticated', 'listing-request-probe-foreign-' || fixture_key || '@example.test', '', now(),
      '{"provider":"email","providers":["email"]}'::jsonb, '{}', now(), now());

  if (select count(*) from public.profiles where id in (customer_id, vendor_id, foreign_id) and not is_suspended) <> 3 then
    raise exception 'probe auth profiles were not created as active';
  end if;

  insert into public.markets(id, slug, name)
    values (market_id, 'listing-request-probe-' || fixture_key, 'Listing Request Probe');
  insert into public.categories(id, market_id, slug, name)
    values (category_id, market_id, 'request-probe-' || fixture_key, 'Request Probe');
  insert into public.listing_types(id, code, name)
    values (listing_type_id, 'product', 'Request Probe Product');
  insert into public.listing_schemas(
    id, listing_type_id, version, status, schema, published_at
  ) values (listing_schema_id, listing_type_id, 1, 'published', ale_schema, now());
  insert into public.category_listing_type_mappings(
    category_id, listing_type_id, listing_schema_id, is_default
  ) values (category_id, listing_type_id, listing_schema_id, true);
  insert into public.businesses(id, market_id, name, slug, status)
    values (business_id, market_id, 'Listing Request Probe Vendor',
      'listing-request-probe-vendor-' || fixture_key, 'active');
  insert into public.business_memberships(business_id, profile_id, role, accepted_at)
    values (business_id, vendor_id, 'owner', now());
  insert into public.listings(
    id, business_id, market_id, category_id, listing_type_id, listing_schema_id,
    slug, title, status, published_at, created_by
  ) values (
    listing_id, business_id, market_id, category_id, listing_type_id, listing_schema_id,
    'listing-request-probe-' || fixture_key, 'Listing Request Probe Item',
    'active', now(), vendor_id
  );

  if not private.is_supported_listing_schema_document(ale_schema, 1, 'product') then
    raise exception 'probe ALE 1.1 schema is not valid';
  end if;
end;
$$;

-- The creation endpoint is service-only.  Keep the opaque secret in the
-- transaction-local fixture table, not in query output or an exception.
set local role service_role;
do $$
begin
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claim.sub', '', true);
end;
$$;

with created as (
  select created.id, created.secret
  from listing_customer_request_probe_state state
  cross join lateral public.create_listing_request_intent(
    state.listing_id,
    'enquire',
    'Need delivery in Lagos',
    encode(extensions.digest('listing-request-probe-rate-limit', 'sha256'), 'hex')
  ) as created
)
update listing_customer_request_probe_state state
set intent_id = created.id, secret = created.secret
from created;

do $$
declare
  state listing_customer_request_probe_state%rowtype;
  intent public.guest_intents%rowtype;
  expected_route text;
begin
  select * into state from listing_customer_request_probe_state;
  select * into intent from public.guest_intents where id = state.intent_id;
  expected_route := format('/%s/listings/%s~%s/request',
    (select slug from public.markets where id = state.market_id),
    (select slug from public.businesses where id = state.business_id),
    (select slug from public.listings where id = state.listing_id));

  if state.intent_id is null
    or state.secret is null
    or state.secret !~ '^[a-f0-9]{64}$'
    or intent.kind <> 'listing_request'
    or intent.return_to <> expected_route
    or intent.secret_hash <> encode(extensions.digest(state.secret, 'sha256'), 'hex')
    or intent.payload <> jsonb_build_object(
      'type', 'listing_request',
      'listing_id', state.listing_id,
      'business_id', state.business_id,
      'market_id', state.market_id,
      'category_id', state.category_id,
      'listing_route', format('%s~%s',
        (select slug from public.businesses where id = state.business_id),
        (select slug from public.listings where id = state.listing_id)),
      'requested_action', 'enquire',
      'search_context', 'Need delivery in Lagos'
    ) then
    raise exception 'service intent was not canonical or opaque';
  end if;
  update listing_customer_request_probe_state set return_to = expected_route;
end;
$$;

-- Customer claims, sees confirmation context, and materializes exactly one
-- request.  RLS checks below use this same authenticated session identity.
set local role authenticated;
do $$
declare
  state listing_customer_request_probe_state%rowtype;
  claim_result jsonb;
  replay_result jsonb;
  context_count integer;
  created record;
  replayed record;
begin
  select * into state from listing_customer_request_probe_state;
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', state.customer_id::text, true);

  select public.claim_guest_intent(state.intent_id, state.secret) into claim_result;
  if claim_result <> jsonb_build_object(
    'outcome', 'claimed', 'retryable', false,
    'intent_id', state.intent_id, 'kind', 'listing_request',
    'return_to', state.return_to
  ) then
    raise exception 'customer claim did not succeed';
  end if;
  select public.claim_guest_intent(state.intent_id, state.secret) into replay_result;
  if replay_result->>'outcome' <> 'replayed'
    or replay_result->>'intent_id' <> state.intent_id::text
    or replay_result->>'return_to' <> state.return_to then
    raise exception 'customer claim replay was not idempotent';
  end if;
  select count(*) into context_count from public.get_listing_request_intent(state.intent_id);
  if context_count <> 1 then raise exception 'customer confirmation context is not owner-readable'; end if;

  select * into created
  from public.create_listing_request_from_intent(state.intent_id, 'Please confirm availability.')
  limit 1;
  if created.outcome <> 'created' or created.request_id is null
    or created.request_number !~ '^LR-[0-9]{6}-[0-9]{10}$'
    or created.status <> 'open'
    or created.listing_id <> state.listing_id
    or created.requested_action <> 'enquire'
    or created.details <> 'Please confirm availability.' then
    raise exception 'listing request materialization was not correct';
  end if;
  update listing_customer_request_probe_state
  set request_id = created.request_id, request_number = created.request_number;

  select * into replayed
  from public.create_listing_request_from_intent(state.intent_id, 'Please confirm availability.')
  limit 1;
  if replayed.outcome <> 'replayed'
    or replayed.request_id <> created.request_id
    or replayed.request_number <> created.request_number then
    raise exception 'same-details materialization replay was not idempotent';
  end if;
  begin
    perform * from public.create_listing_request_from_intent(
      state.intent_id, 'Different probe details.'
    );
    raise exception 'expected conflicting listing request replay';
  exception when others then
    if sqlerrm <> 'conflicting listing request replay' then raise; end if;
  end;

  if (select count(*) from public.list_customer_listing_requests(
      (select slug from public.markets where id = state.market_id))) <> 1
    or (select count(*) from public.get_customer_listing_request(created.request_id)) <> 1
    or (select count(*) from public.requests where id = created.request_id) <> 1 then
    raise exception 'customer request visibility was not correct';
  end if;
  if has_table_privilege('authenticated', 'public.requests', 'INSERT') then
    raise exception 'authenticated retains direct request insert privilege';
  end if;
end;
$$;

-- Only the service role can inspect the protected token column; verify that
-- the customer claim irreversibly cleared it before switching identities.
set local role service_role;
do $$
declare
  state listing_customer_request_probe_state%rowtype;
begin
  select * into state from listing_customer_request_probe_state;
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claim.sub', '', true);
  if exists (
    select 1 from public.guest_intents
    where id = state.intent_id
      and (secret_hash is not null or claimed_by <> state.customer_id or claimed_at is null)
  ) then
    raise exception 'claim did not clear the secret hash';
  end if;
end;
$$;

-- A foreign customer gets neither claim authority nor any customer context.
set local role authenticated;
do $$
declare
  state listing_customer_request_probe_state%rowtype;
  foreign_claim jsonb;
begin
  select * into state from listing_customer_request_probe_state;
  perform set_config('request.jwt.claim.sub', state.foreign_id::text, true);
  select public.claim_guest_intent(state.intent_id, repeat('0', 64)) into foreign_claim;
  if foreign_claim <> jsonb_build_object('outcome', 'claimed_by_other', 'retryable', false) then
    raise exception 'foreign claim was not rejected';
  end if;
  if (select count(*) from public.get_listing_request_intent(state.intent_id)) <> 0
    or (select count(*) from public.list_customer_listing_requests(
      (select slug from public.markets where id = state.market_id))) <> 0
    or (select count(*) from public.get_customer_listing_request(state.request_id)) <> 0
    or (select count(*) from public.list_vendor_listing_requests()) <> 0
    or (select count(*) from public.requests where id = state.request_id) <> 0 then
    raise exception 'foreign request read was not blocked';
  end if;
end;
$$;

-- The accepted business member has vendor context and direct RLS visibility.
do $$
declare
  state listing_customer_request_probe_state%rowtype;
begin
  select * into state from listing_customer_request_probe_state;
  perform set_config('request.jwt.claim.sub', state.vendor_id::text, true);
  if (select count(*) from public.list_vendor_listing_requests()) <> 1
    or (select count(*) from public.requests where id = state.request_id) <> 1 then
    raise exception 'vendor member request visibility was not correct';
  end if;
end;
$$;

-- Before rollback, verify the expected per-table fixture deltas.  Rollback
-- then restores these counts (and all fixture rows) to their original values.
set local role postgres;
do $$
declare
  state listing_customer_request_probe_state%rowtype;
begin
  select * into state from listing_customer_request_probe_state;
  if (select count(*) from auth.users) <> state.baseline_auth_users + 3
    or (select count(*) from public.profiles) <> state.baseline_profiles + 3
    or (select count(*) from public.markets) <> state.baseline_markets + 1
    or (select count(*) from public.categories) <> state.baseline_categories + 1
    or (select count(*) from public.listing_types) <> state.baseline_listing_types + 1
    or (select count(*) from public.listing_schemas) <> state.baseline_listing_schemas + 1
    or (select count(*) from public.category_listing_type_mappings) <> state.baseline_mappings + 1
    or (select count(*) from public.businesses) <> state.baseline_businesses + 1
    or (select count(*) from public.business_memberships) <> state.baseline_memberships + 1
    or (select count(*) from public.listings) <> state.baseline_listings + 1
    or (select count(*) from public.guest_intents) <> state.baseline_intents + 1
    or (select count(*) from public.requests) <> state.baseline_requests + 1
    or (select count(*) from public.auth_rate_limits) <> state.baseline_auth_rate_limits + 1
    or (select count(*) from private.listing_request_actor_rate_limits) <> state.baseline_actor_rate_limits + 1 then
    raise exception 'probe fixture changed an unexpected production count';
  end if;
  if not exists (
    select 1 from public.requests r
    where r.id = state.request_id
      and r.request_number = state.request_number
      and r.request_number ~ '^LR-[0-9]{6}-[0-9]{10}$'
      and r.listing_id = state.listing_id
      and r.business_id = state.business_id
      and r.market_id = state.market_id
      and r.category_id = state.category_id
      and r.requested_action = 'enquire'
      and r.search_context = 'Need delivery in Lagos'
      and r.status = 'open'
  ) then
    raise exception 'materialized request shape is invalid';
  end if;
end;
$$;

rollback;

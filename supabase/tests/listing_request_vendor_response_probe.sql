-- Live rollback-only regression probe for migrations 019-020. Run in one session
-- after migrations 017-020. It deliberately does not exercise concurrency:
-- advisory/row locking is covered structurally here, while multi-session races
-- require a separate harness.

begin;

create temporary table listing_request_vendor_response_probe_state (
  customer_id uuid not null,
  owner_id uuid not null,
  manager_id uuid not null,
  staff_id uuid not null,
  pending_id uuid not null,
  foreign_id uuid not null,
  suspended_id uuid not null,
  market_id uuid not null,
  category_id uuid not null,
  listing_type_id uuid not null,
  listing_schema_id uuid not null,
  business_id uuid not null,
  inactive_business_id uuid not null,
  listing_id uuid not null,
  inactive_listing_id uuid not null,
  owner_request_id uuid,
  manager_request_id uuid,
  staff_request_id uuid,
  immutable_request_id uuid,
  inactive_request_id uuid,
  legacy_request_id uuid,
  cleanup_intent_id uuid,
  cleanup_request_id uuid,
  owner_key uuid not null,
  baseline_requests bigint not null,
  baseline_responses bigint not null,
  baseline_response_rate_limits bigint not null,
  baseline_audits bigint not null,
  baseline_orders bigint not null,
  baseline_payments bigint not null,
  baseline_fulfilment bigint not null,
  baseline_notifications bigint not null,
  baseline_matches bigint not null
) on commit drop;
grant all on table listing_request_vendor_response_probe_state to authenticated, service_role;

do $$
declare
  state listing_request_vendor_response_probe_state%rowtype;
  fixture_key text := replace(extensions.gen_random_uuid()::text, '-', '');
  schema_version integer;
  new_listing_type_id uuid;
  request_number_seed bigint := floor(random() * 8999999995 + 1000000000)::bigint;
  schema_document jsonb := jsonb_build_object(
    'contractVersion', '1.1', 'schemaVersion', 1,
    'schemaKey', 'vendor_response_probe_v1', 'listingKind', 'product',
    'terminology', jsonb_build_object('singular', 'product', 'plural', 'products', 'createAction', 'Add product'),
    'bindings', jsonb_build_object('title', 'title'),
    'fields', jsonb_build_array(jsonb_build_object('key', 'title', 'label', 'Product name', 'required', true, 'type', 'short_text', 'minLength', 2, 'maxLength', 120))
  );
begin
  insert into listing_request_vendor_response_probe_state(
    customer_id, owner_id, manager_id, staff_id, pending_id, foreign_id, suspended_id,
    market_id, category_id, listing_type_id, listing_schema_id, business_id,
    inactive_business_id, listing_id, inactive_listing_id, owner_key,
    baseline_requests, baseline_responses, baseline_response_rate_limits,
    baseline_audits, baseline_orders,
    baseline_payments, baseline_fulfilment, baseline_notifications, baseline_matches
  ) values (
    extensions.gen_random_uuid(), extensions.gen_random_uuid(), extensions.gen_random_uuid(),
    extensions.gen_random_uuid(), extensions.gen_random_uuid(), extensions.gen_random_uuid(),
    extensions.gen_random_uuid(), extensions.gen_random_uuid(), extensions.gen_random_uuid(),
    extensions.gen_random_uuid(), extensions.gen_random_uuid(), extensions.gen_random_uuid(),
    extensions.gen_random_uuid(), extensions.gen_random_uuid(), extensions.gen_random_uuid(),
    extensions.gen_random_uuid(),
    (select count(*) from public.requests),
    (select count(*) from private.listing_request_vendor_responses),
    (select count(*) from private.listing_request_vendor_response_rate_limits),
    (select count(*) from public.audit_events), (select count(*) from public.orders),
    (select count(*) from public.payments), (select count(*) from public.fulfilment_events),
    (select count(*) from public.notifications), (select count(*) from public.request_matches)
  ) returning * into state;
  new_listing_type_id := state.listing_type_id;

  insert into auth.users(
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  )
  select profile_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    'listing-response-probe-' || label || '-' || fixture_key || '@example.test', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}', now(), now()
  from (values
    (state.customer_id, 'customer'), (state.owner_id, 'owner'), (state.manager_id, 'manager'),
    (state.staff_id, 'staff'), (state.pending_id, 'pending'), (state.foreign_id, 'foreign'),
    (state.suspended_id, 'suspended')
  ) as users(profile_id, label);

  -- Exercise the real system-field guard instead of disabling triggers. The
  -- temporary capability and claim are removed immediately and the outer
  -- transaction still rolls back every fixture row.
  insert into public.profile_capabilities(profile_id, capability)
    values (state.owner_id, 'super_admin');
  perform set_config('request.jwt.claim.sub', state.owner_id::text, true);
  update public.profiles set is_suspended = true where id = state.suspended_id;
  perform set_config('request.jwt.claim.sub', '', true);
  delete from public.profile_capabilities
  where profile_id = state.owner_id and capability = 'super_admin';

  insert into public.markets(id, slug, name)
    values (state.market_id, 'listing-response-probe-' || fixture_key, 'Listing response probe');
  insert into public.categories(id, market_id, slug, name)
    values (state.category_id, state.market_id, 'listing-response-' || fixture_key, 'Listing response probe');
  select listing_type.id into state.listing_type_id
  from public.listing_types listing_type
  where listing_type.code = 'product'
  for share;
  if state.listing_type_id is null then
    insert into public.listing_types(id, code, name)
      values (new_listing_type_id, 'product', 'Listing response product')
      returning id into state.listing_type_id;
  end if;
  select coalesce(max(listing_schema.version), 0) + 1 into schema_version
  from public.listing_schemas listing_schema
  where listing_schema.listing_type_id = state.listing_type_id;
  schema_document := jsonb_set(schema_document, '{schemaVersion}', to_jsonb(schema_version));
  insert into public.listing_schemas(id, listing_type_id, version, status, schema, published_at)
    values (state.listing_schema_id, state.listing_type_id, schema_version, 'published', schema_document, now());
  insert into public.category_listing_type_mappings(category_id, listing_type_id, listing_schema_id, is_default)
    values (state.category_id, state.listing_type_id, state.listing_schema_id, true);
  insert into public.businesses(id, market_id, name, slug, status) values
    (state.business_id, state.market_id, 'Response Probe Active', 'response-active-' || fixture_key, 'active'),
    (state.inactive_business_id, state.market_id, 'Response Probe Inactive', 'response-inactive-' || fixture_key, 'suspended');
  insert into public.business_memberships(business_id, profile_id, role, accepted_at) values
    (state.business_id, state.owner_id, 'owner', now()),
    (state.business_id, state.manager_id, 'manager', now()),
    (state.business_id, state.staff_id, 'staff', now()),
    (state.business_id, state.pending_id, 'staff', null),
    (state.business_id, state.suspended_id, 'staff', now()),
    (state.inactive_business_id, state.owner_id, 'owner', now());
  insert into public.listings(
    id, business_id, market_id, category_id, listing_type_id, listing_schema_id,
    slug, title, status, published_at, created_by
  ) values
    (state.listing_id, state.business_id, state.market_id, state.category_id, state.listing_type_id, state.listing_schema_id,
      'response-active-' || fixture_key, 'Response probe active listing', 'active', now(), state.owner_id),
    (state.inactive_listing_id, state.inactive_business_id, state.market_id, state.category_id, state.listing_type_id, state.listing_schema_id,
      'response-inactive-' || fixture_key, 'Response probe inactive listing', 'active', now(), state.owner_id);

  state.cleanup_intent_id := extensions.gen_random_uuid();
  state.cleanup_request_id := extensions.gen_random_uuid();
  insert into public.guest_intents(
    id, market_id, kind, return_to, payload, claimed_by, claimed_at,
    expires_at, consumed_at
  ) values (
    state.cleanup_intent_id, state.market_id, 'listing_request', '/probe',
    '{}'::jsonb, state.customer_id, timestamptz '1900-01-01 00:00:00+00',
    timestamptz '1900-01-01 00:00:00+00',
    timestamptz '1900-01-01 00:00:00+00'
  );

  insert into public.requests(
    requester_id, market_id, category_id, title, details, status, listing_id, business_id,
    requested_action, request_number, search_context
  ) values
    (state.customer_id, state.market_id, state.category_id, 'Owner response', 'Owner request', 'open', state.listing_id, state.business_id, 'enquire', 'LR-' || to_char(current_date, 'YYMMDD') || '-' || lpad(request_number_seed::text, 10, '0'), 'Owner probe'),
    (state.customer_id, state.market_id, state.category_id, 'Manager response', 'Manager request', 'open', state.listing_id, state.business_id, 'enquire', 'LR-' || to_char(current_date, 'YYMMDD') || '-' || lpad((request_number_seed + 1)::text, 10, '0'), 'Manager probe'),
    (state.customer_id, state.market_id, state.category_id, 'Staff response', 'Staff request', 'open', state.listing_id, state.business_id, 'enquire', 'LR-' || to_char(current_date, 'YYMMDD') || '-' || lpad((request_number_seed + 2)::text, 10, '0'), 'Staff probe'),
    (state.customer_id, state.market_id, state.category_id, 'Immutable response', 'Immutable request', 'open', state.listing_id, state.business_id, 'enquire', 'LR-' || to_char(current_date, 'YYMMDD') || '-' || lpad((request_number_seed + 3)::text, 10, '0'), 'Immutable probe'),
    (state.customer_id, state.market_id, state.category_id, 'Inactive response', 'Inactive request', 'open', state.inactive_listing_id, state.inactive_business_id, 'enquire', 'LR-' || to_char(current_date, 'YYMMDD') || '-' || lpad((request_number_seed + 4)::text, 10, '0'), 'Inactive probe'),
    (state.customer_id, state.market_id, state.category_id, 'Legacy response', 'Legacy request', 'open', null, null, null, null, null);
  insert into public.requests(
    id, requester_id, guest_intent_id, market_id, category_id, title, details,
    status, listing_id, business_id, requested_action, request_number,
    search_context
  ) values (
    state.cleanup_request_id, state.customer_id, state.cleanup_intent_id,
    state.market_id, state.category_id, 'Intent cleanup response',
    'Authenticated cleanup request', 'open', state.listing_id,
    state.business_id, 'enquire',
    'LR-' || to_char(current_date, 'YYMMDD') || '-' || lpad((request_number_seed + 5)::text, 10, '0'),
    'Intent cleanup probe'
  );
  -- Scope lookups to this fixture customer so the live probe never binds an
  -- unrelated request with an identical human-readable title.
  update listing_request_vendor_response_probe_state probe set
    owner_request_id = (select id from public.requests where requester_id = state.customer_id and title = 'Owner response'),
    manager_request_id = (select id from public.requests where requester_id = state.customer_id and title = 'Manager response'),
    staff_request_id = (select id from public.requests where requester_id = state.customer_id and title = 'Staff response'),
    immutable_request_id = (select id from public.requests where requester_id = state.customer_id and title = 'Immutable response'),
    inactive_request_id = (select id from public.requests where requester_id = state.customer_id and title = 'Inactive response'),
    legacy_request_id = (select id from public.requests where requester_id = state.customer_id and title = 'Legacy response' and details = 'Legacy request'),
    cleanup_intent_id = state.cleanup_intent_id,
    cleanup_request_id = state.cleanup_request_id;
end;
$$;

-- Owner accepts, the same key replays, a changed use of that key is rejected,
-- then terminal same/opposite decisions return their distinct outcomes.
set local role authenticated;
do $$
declare
  state listing_request_vendor_response_probe_state%rowtype;
  result record;
begin
  select * into state from listing_request_vendor_response_probe_state;
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', state.owner_id::text, true);
  select * into result from public.respond_to_listing_request(state.owner_request_id, 'accept', state.owner_key);
  if result.outcome <> 'transitioned' or result.status <> 'accepted' or result.vendor_responded_at is null then
    raise exception 'owner acceptance did not transition';
  end if;
  select * into result from public.respond_to_listing_request(state.owner_request_id, 'accept', state.owner_key);
  if result.outcome <> 'replayed' or result.status <> 'accepted' then raise exception 'same-key replay failed'; end if;
  select * into result from public.respond_to_listing_request(state.manager_request_id, 'accept', state.owner_key);
  if result.outcome <> 'idempotency_key_reused' then raise exception 'idempotency key reuse was not rejected'; end if;
  select * into result from public.respond_to_listing_request(state.owner_request_id, 'accept', extensions.gen_random_uuid());
  if result.outcome <> 'already_transitioned' then raise exception 'fresh same decision was not terminal'; end if;
  select * into result from public.respond_to_listing_request(state.owner_request_id, 'decline', extensions.gen_random_uuid());
  if result.outcome <> 'conflict' then raise exception 'opposite decision did not conflict'; end if;
end;
$$;

-- A manager and staff member are both accepted responders; staff declines.
do $$
declare
  state listing_request_vendor_response_probe_state%rowtype;
  result record;
begin
  select * into state from listing_request_vendor_response_probe_state;
  perform set_config('request.jwt.claim.sub', state.manager_id::text, true);
  select * into result from public.respond_to_listing_request(state.manager_request_id, 'accept', extensions.gen_random_uuid());
  if result.outcome <> 'transitioned' or result.status <> 'accepted' then raise exception 'manager was not accepted'; end if;
  perform set_config('request.jwt.claim.sub', state.staff_id::text, true);
  select * into result from public.respond_to_listing_request(state.staff_request_id, 'decline', extensions.gen_random_uuid());
  if result.outcome <> 'transitioned' or result.status <> 'declined' then raise exception 'staff decline did not transition'; end if;
end;
$$;

-- Pending, foreign, suspended, inactive-business, and non-listing requests all
-- fail without exposing the reason. Anonymous execution itself is denied.
do $$
declare
  state listing_request_vendor_response_probe_state%rowtype;
  result record;
begin
  select * into state from listing_request_vendor_response_probe_state;
  perform set_config('request.jwt.claim.sub', state.pending_id::text, true);
  select * into result from public.respond_to_listing_request(state.immutable_request_id, 'accept', extensions.gen_random_uuid());
  if result.outcome <> 'not_found' then raise exception 'pending membership leaked response authority'; end if;
  perform set_config('request.jwt.claim.sub', state.foreign_id::text, true);
  select * into result from public.respond_to_listing_request(state.immutable_request_id, 'accept', extensions.gen_random_uuid());
  if result.outcome <> 'not_found' then raise exception 'foreign actor leaked response authority'; end if;
  perform set_config('request.jwt.claim.sub', state.suspended_id::text, true);
  select * into result from public.respond_to_listing_request(state.immutable_request_id, 'accept', extensions.gen_random_uuid());
  if result.outcome <> 'not_found' then raise exception 'suspended actor leaked response authority'; end if;
  perform set_config('request.jwt.claim.sub', state.owner_id::text, true);
  select * into result from public.respond_to_listing_request(state.inactive_request_id, 'accept', extensions.gen_random_uuid());
  if result.outcome <> 'not_found' then raise exception 'inactive business leaked response authority'; end if;
  select * into result from public.respond_to_listing_request(state.legacy_request_id, 'accept', extensions.gen_random_uuid());
  if result.outcome <> 'not_found' then raise exception 'unlinked request leaked response authority'; end if;
  perform set_config('request.jwt.claim.sub', state.owner_id::text, true);
  select * into result from public.respond_to_listing_request(state.immutable_request_id, null::text, extensions.gen_random_uuid());
  if result.outcome <> 'invalid' or result.request_id is not null
    or not exists (select 1 from public.requests request where request.id = state.immutable_request_id and request.status = 'open' and request.vendor_responded_at is null) then
    raise exception 'null decision was not rejected without side effects';
  end if;
  if has_function_privilege('anon', 'public.respond_to_listing_request(uuid, text, uuid)', 'EXECUTE') then
    raise exception 'anonymous callers retain response RPC execute';
  end if;
end;
$$;

-- The public RPC is directly callable, so enforce its actor window in the
-- database before attacker-selected request lookup and prove stale limiter
-- state is service-role prunable.
set local role postgres;
delete from private.listing_request_vendor_response_rate_limits limits
where limits.actor_id = (select foreign_id from listing_request_vendor_response_probe_state);
set local role authenticated;
do $$
declare
  state listing_request_vendor_response_probe_state%rowtype;
  result record;
  attempt integer;
begin
  select * into state from listing_request_vendor_response_probe_state;
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', state.foreign_id::text, true);
  for attempt in 1..120 loop
    select * into result from public.respond_to_listing_request(
      extensions.gen_random_uuid(), 'accept', extensions.gen_random_uuid()
    );
    if result.outcome <> 'not_found' then
      raise exception 'vendor response rate limit activated before the documented bound';
    end if;
  end loop;
  select * into result from public.respond_to_listing_request(
    extensions.gen_random_uuid(), 'accept', extensions.gen_random_uuid()
  );
  if result.outcome <> 'rate_limited'
    or not result.retryable
    or result.request_id is not null
    or result.status is not null
    or result.vendor_responded_at is not null
    or result.updated_at is not null then
    raise exception 'vendor response rate limit did not fail closed';
  end if;
end;
$$;
set local role postgres;
update private.listing_request_vendor_response_rate_limits limits
set updated_at = timestamptz '1900-01-01 00:00:00+00'
where limits.actor_id = (select foreign_id from listing_request_vendor_response_probe_state);
set local role service_role;
do $$
declare pruned integer;
begin
  perform set_config('request.jwt.claim.role', 'service_role', true);
  select public.prune_listing_request_vendor_response_rate_limits(1) into pruned;
  if pruned <> 1 then
    raise exception 'vendor response rate limit row was not pruned';
  end if;
end;
$$;
set local role postgres;
do $$
declare state listing_request_vendor_response_probe_state%rowtype;
begin
  select * into state from listing_request_vendor_response_probe_state;
  if exists (
    select 1 from private.listing_request_vendor_response_rate_limits limits
    where limits.actor_id = state.foreign_id
  ) then
    raise exception 'vendor response rate-limit prune retained the fixture row';
  end if;
end;
$$;

-- Replay keys do not bypass current authorization after membership revocation
-- or business suspension.
set local role postgres;
update public.business_memberships membership
set accepted_at = null
where membership.business_id = (select business_id from listing_request_vendor_response_probe_state)
  and membership.profile_id = (select owner_id from listing_request_vendor_response_probe_state);
set local role authenticated;
do $$
declare state listing_request_vendor_response_probe_state%rowtype; result record;
begin
  select * into state from listing_request_vendor_response_probe_state;
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', state.owner_id::text, true);
  select * into result from public.respond_to_listing_request(state.owner_request_id, 'accept', state.owner_key);
  if result.outcome <> 'not_found' then raise exception 'revoked member replay leaked request state'; end if;
end;
$$;
set local role postgres;
update public.business_memberships membership
set accepted_at = now()
where membership.business_id = (select business_id from listing_request_vendor_response_probe_state)
  and membership.profile_id = (select owner_id from listing_request_vendor_response_probe_state);
update public.businesses business set status = 'suspended'
where business.id = (select business_id from listing_request_vendor_response_probe_state);
set local role authenticated;
do $$
declare state listing_request_vendor_response_probe_state%rowtype; result record;
begin
  select * into state from listing_request_vendor_response_probe_state;
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', state.owner_id::text, true);
  select * into result from public.respond_to_listing_request(state.owner_request_id, 'accept', state.owner_key);
  if result.outcome <> 'not_found' then raise exception 'suspended business replay leaked request state'; end if;
end;
$$;
set local role postgres;
update public.businesses business set status = 'active'
where business.id = (select business_id from listing_request_vendor_response_probe_state);

-- Migration 017 deliberately prunes claimed intents for authenticated listing
-- requests after 30 days. Its FK SET NULL maintenance must remain compatible
-- with the response-transition immutability trigger.
set local role service_role;
do $$
declare
  state listing_request_vendor_response_probe_state%rowtype;
  prune_result record;
begin
  select * into state from listing_request_vendor_response_probe_state;
  perform set_config('request.jwt.claim.role', 'service_role', true);
  select * into prune_result from public.prune_listing_request_intents(1);
  if prune_result.listing_request_intents_pruned <> 1 then
    raise exception 'claimed listing request intent was not pruned';
  end if;
end;
$$;
set local role postgres;
do $$
declare state listing_request_vendor_response_probe_state%rowtype;
begin
  select * into state from listing_request_vendor_response_probe_state;
  if exists (select 1 from public.guest_intents intent where intent.id = state.cleanup_intent_id)
    or not exists (
      select 1 from public.requests request
      where request.id = state.cleanup_request_id
        and request.requester_id = state.customer_id
        and request.guest_intent_id is null
        and request.status = 'open'
        and request.vendor_responded_at is null
    ) then
    raise exception 'intent prune did not preserve the authenticated request';
  end if;
end;
$$;

-- service_role may invoke service-only maintenance functions but must not be
-- able to forge the response GUC and update requests directly.
set local role service_role;
do $$
declare
  state listing_request_vendor_response_probe_state%rowtype;
  forged_at timestamptz := clock_timestamp();
begin
  select * into state from listing_request_vendor_response_probe_state;
  if has_table_privilege('service_role', 'public.requests', 'UPDATE') then
    raise exception 'service role retains direct request UPDATE';
  end if;
  perform set_config('localhub.listing_request_response', '1', true);
  perform set_config('localhub.listing_request_response_request_id', state.immutable_request_id::text, true);
  perform set_config('localhub.listing_request_response_at', forged_at::text, true);
  begin
    update public.requests
    set status = 'accepted', vendor_responded_at = forged_at
    where id = state.immutable_request_id;
    raise exception 'service role forged a request response';
  exception when insufficient_privilege then
    null;
  end;
  perform set_config('localhub.listing_request_response', '', true);
  perform set_config('localhub.listing_request_response_request_id', '', true);
  perform set_config('localhub.listing_request_response_at', '', true);
end;
$$;
set local role postgres;

-- Exercise adversarial direct/forged mutation attempts as postgres, which is
-- intentionally stronger than application roles. Each must be rejected.
set local role postgres;
do $$
declare state listing_request_vendor_response_probe_state%rowtype;
begin
  select * into state from listing_request_vendor_response_probe_state;
  begin
    update public.requests set details = 'forged payload' where id = state.immutable_request_id;
    raise exception 'direct payload update unexpectedly succeeded';
  exception when others then
    if sqlerrm <> 'listing request response updates must use respond_to_listing_request' then raise; end if;
  end;
  perform set_config('localhub.listing_request_response', '1', true);
  perform set_config('localhub.listing_request_response_request_id', state.immutable_request_id::text, true);
  perform set_config('localhub.listing_request_response_at', now()::text, true);
  begin
    update public.requests set status = 'accepted', vendor_responded_at = now() - interval '1 minute' where id = state.immutable_request_id;
    raise exception 'forged response timestamp unexpectedly succeeded';
  exception when others then
    if sqlerrm <> 'invalid listing request response transition' then raise; end if;
  end;
  begin
    update public.requests set status = 'accepted', vendor_responded_at = now(), listing_id = state.inactive_listing_id where id = state.immutable_request_id;
    raise exception 'linkage mutation unexpectedly succeeded';
  exception when others then
    if sqlerrm <> 'listing request response cannot mutate request content' then raise; end if;
  end;
end;
$$;

-- Customer/vendor projections agree on state and timestamp; an unrelated user
-- gets no request projections.
set local role authenticated;
do $$
declare
  state listing_request_vendor_response_probe_state%rowtype;
  customer_response_at timestamptz;
  vendor_response_at timestamptz;
begin
  select * into state from listing_request_vendor_response_probe_state;
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', state.customer_id::text, true);
  select vendor_responded_at into customer_response_at
  from public.get_customer_listing_request(state.owner_request_id);
  if customer_response_at is null
    or not exists (select 1 from public.list_customer_listing_requests((select slug from public.markets where id = state.market_id)) where request_id = state.owner_request_id and status = 'accepted' and vendor_responded_at = customer_response_at) then
    raise exception 'customer projection is not synchronized';
  end if;
  perform set_config('request.jwt.claim.sub', state.owner_id::text, true);
  select vendor_responded_at into vendor_response_at
  from public.list_vendor_listing_requests() where request_id = state.owner_request_id;
  if vendor_response_at is distinct from customer_response_at then raise exception 'vendor projection is not synchronized'; end if;
  perform set_config('request.jwt.claim.sub', state.foreign_id::text, true);
  if exists (select 1 from public.list_vendor_listing_requests())
    or exists (select 1 from public.get_customer_listing_request(state.owner_request_id)) then
    raise exception 'request projection isolation failed';
  end if;
end;
$$;

set local role postgres;
do $$
declare state listing_request_vendor_response_probe_state%rowtype;
begin
  select * into state from listing_request_vendor_response_probe_state;
  if (select count(*) from private.listing_request_vendor_responses) <> state.baseline_responses + 3
    or (select count(*) from public.audit_events where subject_type = 'listing_request' and subject_id in (state.owner_request_id, state.manager_request_id, state.staff_request_id)) <> 3 then
    raise exception 'transitions did not write exactly one replay and audit row each';
  end if;
  if (select count(*) from public.orders) <> state.baseline_orders
    or (select count(*) from public.payments) <> state.baseline_payments
    or (select count(*) from public.fulfilment_events) <> state.baseline_fulfilment
    or (select count(*) from public.notifications) <> state.baseline_notifications
    or (select count(*) from public.request_matches) <> state.baseline_matches then
    raise exception 'vendor response wrote an excluded workflow table';
  end if;
  if has_table_privilege('authenticated', 'public.requests', 'UPDATE') then
    raise exception 'authenticated retains direct request UPDATE';
  end if;
  if has_table_privilege('service_role', 'public.requests', 'UPDATE') then
    raise exception 'service role retains direct request UPDATE';
  end if;
  if has_function_privilege('authenticated', 'private.respond_to_listing_request(uuid, text, uuid)', 'EXECUTE')
    or has_table_privilege('authenticated', 'private.listing_request_vendor_response_rate_limits', 'SELECT') then
    raise exception 'authenticated can bypass or inspect vendor response rate limiting';
  end if;
end;
$$;

rollback;

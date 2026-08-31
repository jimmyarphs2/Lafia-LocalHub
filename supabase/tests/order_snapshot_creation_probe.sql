-- Rollback-only live regression probe for
-- 202608300021_localhub_order_snapshot_creation.sql and
-- 202608300022_localhub_order_rls_helper_hardening.sql.
--
-- This probe never selects or prints an order capability secret. It creates
-- synthetic fixtures, exercises service/authenticated/Postgres boundaries,
-- and rolls every row back.

begin;

create temporary table order_snapshot_probe_state (
  customer_id uuid not null,
  vendor_id uuid not null,
  foreign_id uuid not null,
  suspended_id uuid not null,
  market_id uuid not null,
  category_id uuid not null,
  listing_type_id uuid not null,
  listing_schema_id uuid not null,
  business_id uuid not null,
  foreign_business_id uuid not null,
  listing_id uuid not null,
  nonorderable_listing_id uuid not null,
  unpublished_listing_id uuid not null,
  unpriced_listing_id uuid not null,
  paused_listing_id uuid not null,
  foreign_listing_id uuid not null,
  intent_id uuid,
  intent_secret text,
  changed_intent_id uuid,
  changed_intent_secret text,
  cleanup_intent_id uuid,
  cleanup_rate_key text not null,
  return_to text,
  order_id uuid,
  order_number text,
  baseline_orders bigint not null,
  baseline_items bigint not null,
  baseline_events bigint not null,
  baseline_audits bigint not null,
  baseline_payments bigint not null,
  baseline_payment_events bigint not null,
  baseline_fulfilment bigint not null,
  baseline_notifications bigint not null,
  baseline_ledgers bigint not null
) on commit drop;
grant all on table order_snapshot_probe_state to authenticated, service_role;

do $$
declare
  customer_id uuid := extensions.gen_random_uuid();
  vendor_id uuid := extensions.gen_random_uuid();
  foreign_id uuid := extensions.gen_random_uuid();
  suspended_id uuid := extensions.gen_random_uuid();
  market_id uuid := extensions.gen_random_uuid();
  category_id uuid := extensions.gen_random_uuid();
  listing_type_id uuid := extensions.gen_random_uuid();
  listing_schema_id uuid := extensions.gen_random_uuid();
  business_id uuid := extensions.gen_random_uuid();
  foreign_business_id uuid := extensions.gen_random_uuid();
  listing_id uuid := extensions.gen_random_uuid();
  nonorderable_listing_id uuid := extensions.gen_random_uuid();
  unpublished_listing_id uuid := extensions.gen_random_uuid();
  unpriced_listing_id uuid := extensions.gen_random_uuid();
  paused_listing_id uuid := extensions.gen_random_uuid();
  foreign_listing_id uuid := extensions.gen_random_uuid();
  fixture_key text := replace(extensions.gen_random_uuid()::text, '-', '');
  cleanup_key text := encode(
    extensions.digest('order-probe-cleanup-' || fixture_key, 'sha256'),
    'hex'
  );
  ale_schema jsonb := jsonb_build_object(
    'contractVersion', '1.1',
    'schemaVersion', 1,
    'schemaKey', 'order_probe_v1',
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
  insert into order_snapshot_probe_state(
    customer_id, vendor_id, foreign_id, suspended_id, market_id, category_id,
    listing_type_id, listing_schema_id, business_id, foreign_business_id,
    listing_id, nonorderable_listing_id, unpublished_listing_id,
    unpriced_listing_id, paused_listing_id, foreign_listing_id,
    cleanup_rate_key, baseline_orders, baseline_items, baseline_events,
    baseline_audits, baseline_payments, baseline_payment_events,
    baseline_fulfilment, baseline_notifications, baseline_ledgers
  ) select
    customer_id, vendor_id, foreign_id, suspended_id, market_id, category_id,
    listing_type_id, listing_schema_id, business_id, foreign_business_id,
    listing_id, nonorderable_listing_id, unpublished_listing_id,
    unpriced_listing_id, paused_listing_id, foreign_listing_id,
    cleanup_key,
    (select count(*) from public.orders),
    (select count(*) from public.order_items),
    (select count(*) from public.order_status_events),
    (select count(*) from public.audit_events),
    (select count(*) from public.payments),
    (select count(*) from public.payment_events),
    (select count(*) from public.fulfilment_events),
    (select count(*) from public.notifications),
    (select count(*) from public.ledger_journals);

  insert into auth.users(
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values
    (customer_id, '00000000-0000-0000-0000-000000000000', 'authenticated',
      'authenticated', 'order-probe-customer-' || fixture_key || '@example.test', '', now(),
      '{"provider":"email","providers":["email"]}'::jsonb, '{}', now(), now()),
    (vendor_id, '00000000-0000-0000-0000-000000000000', 'authenticated',
      'authenticated', 'order-probe-vendor-' || fixture_key || '@example.test', '', now(),
      '{"provider":"email","providers":["email"]}'::jsonb, '{}', now(), now()),
    (foreign_id, '00000000-0000-0000-0000-000000000000', 'authenticated',
      'authenticated', 'order-probe-foreign-' || fixture_key || '@example.test', '', now(),
      '{"provider":"email","providers":["email"]}'::jsonb, '{}', now(), now()),
    (suspended_id, '00000000-0000-0000-0000-000000000000', 'authenticated',
      'authenticated', 'order-probe-suspended-' || fixture_key || '@example.test', '', now(),
      '{"provider":"email","providers":["email"]}'::jsonb, '{}', now(), now());
  insert into public.profile_capabilities(profile_id, capability)
    values (vendor_id, 'super_admin');
  perform set_config('request.jwt.claim.sub', vendor_id::text, true);
  update public.profiles set is_suspended = true where id = suspended_id;
  perform set_config('request.jwt.claim.sub', '', true);
  delete from public.profile_capabilities
  where profile_id = vendor_id and capability = 'super_admin';

  insert into public.markets(id, slug, name, currency_code)
  values (market_id, 'order-probe-' || fixture_key, 'Order Probe', 'NGN');
  insert into public.categories(id, market_id, slug, name)
  values (category_id, market_id, 'products-' || fixture_key, 'Probe products');
  insert into public.listing_types(id, code, name)
  values (listing_type_id, 'product', 'Order Probe Product');
  insert into public.listing_schemas(
    id, listing_type_id, version, status, schema, published_at
  ) values (listing_schema_id, listing_type_id, 1, 'published', ale_schema, now());
  insert into public.category_listing_type_mappings(
    category_id, listing_type_id, listing_schema_id, is_default
  ) values (category_id, listing_type_id, listing_schema_id, true);
  insert into public.businesses(id, market_id, name, slug, status) values
    (business_id, market_id, 'Order Probe Vendor',
      'order-probe-vendor-' || fixture_key, 'active'),
    (foreign_business_id, market_id, 'Foreign Order Probe Vendor',
      'foreign-order-probe-vendor-' || fixture_key, 'active');
  insert into public.business_memberships(
    business_id, profile_id, role, accepted_at
  ) values
    (business_id, vendor_id, 'owner', now()),
    (foreign_business_id, foreign_id, 'owner', now());

  insert into public.listings(
    id, business_id, market_id, category_id, listing_type_id,
    listing_schema_id, slug, title, status, price_minor, currency_code,
    published_at, created_by, is_orderable
  ) values
    (listing_id, business_id, market_id, category_id, listing_type_id,
      listing_schema_id, 'main-' || fixture_key, 'Order Probe Item', 'active',
      12500, 'NGN', now(), vendor_id, true),
    (unpublished_listing_id, business_id, market_id, category_id, listing_type_id,
      listing_schema_id, 'unpublished-' || fixture_key, 'Unpublished Probe', 'active',
      12500, 'NGN', null, vendor_id, true),
    (unpriced_listing_id, business_id, market_id, category_id, listing_type_id,
      listing_schema_id, 'unpriced-' || fixture_key, 'Unpriced Probe', 'active',
      null, 'NGN', now(), vendor_id, true),
    (paused_listing_id, business_id, market_id, category_id, listing_type_id,
      listing_schema_id, 'paused-' || fixture_key, 'Paused Probe', 'paused',
      12500, 'NGN', now(), vendor_id, true),
    (foreign_listing_id, foreign_business_id, market_id, category_id,
      listing_type_id, listing_schema_id, 'foreign-' || fixture_key,
      'Foreign Business Probe', 'active', 12500, 'NGN', now(), foreign_id, true);

  -- Omit is_orderable to prove the column's default is deny-by-default.
  insert into public.listings(
    id, business_id, market_id, category_id, listing_type_id,
    listing_schema_id, slug, title, status, price_minor, currency_code,
    published_at, created_by
  ) values (
    nonorderable_listing_id, business_id, market_id, category_id,
    listing_type_id, listing_schema_id, 'nonorderable-' || fixture_key,
    'Non-orderable Probe', 'active', 12500, 'NGN', now(), vendor_id
  );

  if (select is_orderable from public.listings where id = nonorderable_listing_id) then
    raise exception 'is_orderable did not default to false';
  end if;
end;
$$;

-- Only the service role creates opaque, server-derived capabilities. Secrets
-- remain in the transaction-local state table and never enter query output.
set local role service_role;
do $$ begin
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claim.sub', '', true);
end $$;

with created as (
  select created.id, created.secret
  from order_snapshot_probe_state state
  cross join lateral public.create_listing_order_intent(
    state.listing_id, 3,
    encode(extensions.digest('order-probe-main', 'sha256'), 'hex')
  ) created
)
update order_snapshot_probe_state state
set intent_id = created.id, intent_secret = created.secret
from created;

with created as (
  select created.id, created.secret
  from order_snapshot_probe_state state
  cross join lateral public.create_listing_order_intent(
    state.listing_id, 2,
    encode(extensions.digest('order-probe-changed', 'sha256'), 'hex')
  ) created
)
update order_snapshot_probe_state state
set changed_intent_id = created.id, changed_intent_secret = created.secret
from created;

with created as (
  select created.id
  from order_snapshot_probe_state state
  cross join lateral public.create_listing_order_intent(
    state.listing_id, 1, state.cleanup_rate_key
  ) created
)
update order_snapshot_probe_state state
set cleanup_intent_id = created.id
from created;

-- Every unavailable or non-orderable fixture fails before capability creation.
do $$
declare
  state order_snapshot_probe_state%rowtype;
  target uuid;
begin
  select * into state from order_snapshot_probe_state;
  foreach target in array array[
    state.nonorderable_listing_id,
    state.unpublished_listing_id,
    state.unpriced_listing_id,
    state.paused_listing_id
  ] loop
    begin
      perform * from public.create_listing_order_intent(
        target, 1, encode(extensions.digest(target::text, 'sha256'), 'hex')
      );
      raise exception 'unavailable listing unexpectedly created an order intent';
    exception when others then
      if sqlerrm not in (
        'listing is not available for orders',
        'listing is not available for base orders'
      ) then raise; end if;
    end;
  end loop;
end;
$$;

-- Database-valid but non-displayable source text and overlong route values are
-- rejected before a capability or quote can persist.
set local role postgres;
do $$
declare
  state order_snapshot_probe_state%rowtype;
  original_value text;
begin
  select * into state from order_snapshot_probe_state;
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claim.sub', '', true);

  select title into original_value
  from public.listings where id = state.listing_id;
  update public.listings set title = U&'\034F\034F' where id = state.listing_id;
  begin
    perform * from public.create_listing_order_intent(
      state.listing_id, 1,
      encode(extensions.digest('order-probe-invisible-title', 'sha256'), 'hex')
    );
    raise exception 'invisible listing title unexpectedly created an intent';
  exception when others then
    if sqlerrm <> 'listing is not available for orders' then raise; end if;
  end;
  update public.listings set title = original_value where id = state.listing_id;

  select name into original_value
  from public.businesses where id = state.business_id;
  update public.businesses set name = U&'\034F\034F' where id = state.business_id;
  begin
    perform * from public.create_listing_order_intent(
      state.listing_id, 1,
      encode(extensions.digest('order-probe-invisible-vendor', 'sha256'), 'hex')
    );
    raise exception 'invisible vendor name unexpectedly created an intent';
  exception when others then
    if sqlerrm <> 'listing is not available for orders' then raise; end if;
  end;
  update public.businesses set name = original_value where id = state.business_id;

  select slug into original_value
  from public.markets where id = state.market_id;
  update public.markets set slug = repeat('a', 81) where id = state.market_id;
  begin
    perform * from public.create_listing_order_intent(
      state.listing_id, 1,
      encode(extensions.digest('order-probe-overlong-market', 'sha256'), 'hex')
    );
    raise exception 'overlong market slug unexpectedly created an intent';
  exception when others then
    if sqlerrm <> 'listing is not available for orders' then raise; end if;
  end;
  update public.markets set slug = original_value where id = state.market_id;
end;
$$;

do $$
declare
  state order_snapshot_probe_state%rowtype;
  intent public.guest_intents%rowtype;
  quote private.listing_order_quotes%rowtype;
  expected_return text;
begin
  select * into state from order_snapshot_probe_state;
  select * into intent from public.guest_intents where id = state.intent_id;
  select * into quote from private.listing_order_quotes where intent_id = state.intent_id;
  expected_return := format('/%s/listings/%s~%s/order',
    (select slug from public.markets where id = state.market_id),
    (select slug from public.businesses where id = state.business_id),
    (select slug from public.listings where id = state.listing_id));
  if state.intent_secret !~ '^[a-f0-9]{64}$'
    or intent.kind <> 'listing_order'
    or intent.return_to <> expected_return
    or intent.return_to like '%' || state.intent_secret || '%'
    or intent.payload::text like '%' || state.intent_secret || '%'
    or quote.quantity <> 3
    or quote.unit_price_minor <> 12500
    or quote.total_minor <> 37500
    or quote.currency_code <> 'NGN' then
    raise exception 'server quote or opaque capability is not canonical';
  end if;
  update order_snapshot_probe_state set return_to = expected_return;
end;
$$;

-- Claim both protected order intents. Claim extends both capability and quote
-- to the same 15-minute authenticated placement window.
set local role authenticated;
do $$
declare
  state order_snapshot_probe_state%rowtype;
  result jsonb;
begin
  select * into state from order_snapshot_probe_state;
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', state.customer_id::text, true);
  select public.claim_guest_intent(state.intent_id, state.intent_secret) into result;
  if result->>'outcome' <> 'claimed'
    or result->>'kind' <> 'listing_order'
    or result->>'return_to' <> state.return_to then
    raise exception 'listing order claim failed';
  end if;
  select public.claim_guest_intent(
    state.changed_intent_id, state.changed_intent_secret
  ) into result;
  if result->>'outcome' <> 'claimed' then
    raise exception 'quote-change intent claim failed';
  end if;
end;
$$;

set local role postgres;
do $$
declare state order_snapshot_probe_state%rowtype;
begin
  select * into state from order_snapshot_probe_state;
  if (select count(*)
      from public.guest_intents g
      join private.listing_order_quotes q on q.intent_id = g.id
      where g.id in (state.intent_id, state.changed_intent_id)
        and g.expires_at = q.expires_at
        and g.claimed_by = state.customer_id
        and g.secret_hash is null
        and g.consumed_at is null) <> 2 then
    raise exception 'claim did not preserve exact protected quote windows';
  end if;
end;
$$;
set local role authenticated;

-- A foreign actor cannot take over or inspect the claimed capability.
do $$
declare state order_snapshot_probe_state%rowtype; result jsonb;
begin
  select * into state from order_snapshot_probe_state;
  perform set_config('request.jwt.claim.sub', state.foreign_id::text, true);
  select public.claim_guest_intent(state.intent_id, repeat('0', 64)) into result;
  if result->>'outcome' <> 'claimed_by_other'
    or exists (select 1 from public.get_listing_order_intent(state.intent_id)) then
    raise exception 'foreign capability isolation failed';
  end if;
end;
$$;

-- The customer places one exact snapshot; retry serializes on the intent and
-- returns that same order without a second item/event/audit.
do $$
declare
  state order_snapshot_probe_state%rowtype;
  result record;
  replay record;
begin
  select * into state from order_snapshot_probe_state;
  perform set_config('request.jwt.claim.sub', state.customer_id::text, true);
  if (select count(*) from public.get_listing_order_intent(state.intent_id)) <> 1 then
    raise exception 'customer cannot read claimed order context';
  end if;
  select * into result
  from public.create_listing_order_from_intent(state.intent_id);
  if result.outcome <> 'created' or result.retryable
    or result.order_id is null
    or result.order_number !~ '^LO-[0-9]{6}-[0-9]{10}$'
    or result.status <> 'placed'
    or result.placed_at is null
    or result.listing_id <> state.listing_id
    or result.quantity <> 3
    or result.unit_price_minor <> 12500
    or result.total_minor <> 37500 then
    raise exception 'authoritative order snapshot was not created';
  end if;
  update order_snapshot_probe_state
    set order_id = result.order_id, order_number = result.order_number;

  select * into replay
  from public.create_listing_order_from_intent(state.intent_id);
  if replay.outcome <> 'replayed' or replay.retryable
    or replay.order_id <> result.order_id
    or replay.order_number <> result.order_number then
    raise exception 'same-owner placement replay was not idempotent';
  end if;

end;
$$;

-- Change an authoritative quote source after intent creation. Existing-order
-- replay still works, while the unused changed quote creates nothing.
set local role postgres;
update public.listings set price_minor = 13000
where id = (select listing_id from order_snapshot_probe_state);
set local role authenticated;
do $$
declare
  state order_snapshot_probe_state%rowtype;
  result record;
  replay record;
begin
  select * into state from order_snapshot_probe_state;
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', state.customer_id::text, true);
  select * into replay from public.create_listing_order_from_intent(state.intent_id);
  if replay.outcome <> 'replayed' or replay.order_id <> state.order_id then
    raise exception 'source change broke existing-order replay';
  end if;
  select * into result
  from public.create_listing_order_from_intent(state.changed_intent_id);
  if result.outcome <> 'quote_changed' or result.retryable
    or result.order_id is not null then
    raise exception 'changed quote did not fail atomically';
  end if;
end;
$$;
set local role postgres;
update public.listings set price_minor = 12500
where id = (select listing_id from order_snapshot_probe_state);

-- Exhaust the new-placement limiter through its service-only boundary after
-- all unconsumed-placement cases. A fully verified, committed same-owner replay
-- must still return the original order.
set local role service_role;
do $$
declare
  state order_snapshot_probe_state%rowtype;
  attempt integer;
  allowed boolean;
  replay_limit_key text := encode(
    extensions.digest('order-probe-replay-limit', 'sha256'), 'hex'
  );
begin
  select * into state from order_snapshot_probe_state;
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claim.sub', '', true);
  for attempt in 1..25 loop
    perform public.consume_auth_rate_limit(
      'listing_order_place',
      encode(extensions.digest(state.customer_id::text, 'sha256'), 'hex')
    );
  end loop;
  for attempt in 1..120 loop
    select public.consume_auth_rate_limit(
      'listing_order_replay', replay_limit_key
    ) into allowed;
    if not allowed then
      raise exception 'replay limiter rejected an in-budget request';
    end if;
  end loop;
  if public.consume_auth_rate_limit('listing_order_replay', replay_limit_key) then
    raise exception 'replay limiter exceeded its exact budget';
  end if;
end;
$$;
set local role authenticated;
do $$
declare state order_snapshot_probe_state%rowtype; replay record;
begin
  select * into state from order_snapshot_probe_state;
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', state.customer_id::text, true);
  select * into replay from public.create_listing_order_from_intent(state.intent_id);
  if replay.outcome <> 'replayed' or replay.retryable
    or replay.order_id <> state.order_id then
    raise exception 'rate limiting overrode an idempotent replay';
  end if;
end;
$$;

-- Customer and exact accepted vendor projections see one safe flat row.
set local role authenticated;
do $$
declare state order_snapshot_probe_state%rowtype;
begin
  select * into state from order_snapshot_probe_state;
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', state.customer_id::text, true);
  if (select count(*) from public.list_customer_orders(
      (select slug from public.markets where id = state.market_id))) <> 1
    or (select count(*) from public.get_customer_order(
      (select slug from public.markets where id = state.market_id),
      state.order_number)) <> 1
    or (select count(id) from public.orders where id = state.order_id) <> 1
    or (select count(id) from public.order_items where order_id = state.order_id) <> 1
    or (select count(id) from public.order_status_events
        where order_id = state.order_id) <> 1 then
    raise exception 'customer order projection or RLS failed';
  end if;

  perform set_config('request.jwt.claim.sub', state.vendor_id::text, true);
  if (select count(*) from public.list_vendor_orders()) <> 1
    or (select count(*) from public.get_vendor_order(state.order_number)) <> 1
    or (select count(id) from public.orders where id = state.order_id) <> 1
    or (select count(id) from public.order_items where order_id = state.order_id) <> 1
    or (select count(id) from public.order_status_events
        where order_id = state.order_id) <> 1 then
    raise exception 'exact accepted vendor projection or RLS failed';
  end if;

  perform set_config('request.jwt.claim.sub', state.foreign_id::text, true);
  if exists (select 1 from public.list_vendor_orders())
    or exists (select 1 from public.get_vendor_order(state.order_number))
    or (select count(id) from public.orders where id = state.order_id) <> 0
    or (select count(id) from public.order_items where order_id = state.order_id) <> 0
    or (select count(id) from public.order_status_events
        where order_id = state.order_id) <> 0 then
    raise exception 'foreign-business isolation failed';
  end if;
end;
$$;

-- Revocation and suspension remove access immediately.
set local role postgres;
update public.business_memberships set accepted_at = null
where business_id = (select business_id from order_snapshot_probe_state)
  and profile_id = (select vendor_id from order_snapshot_probe_state);
set local role authenticated;
do $$
declare state order_snapshot_probe_state%rowtype;
begin
  select * into state from order_snapshot_probe_state;
  perform set_config('request.jwt.claim.sub', state.vendor_id::text, true);
  if exists (select 1 from public.list_vendor_orders())
    or (select count(id) from public.orders where id = state.order_id) <> 0
    or (select count(id) from public.order_items where order_id = state.order_id) <> 0
    or (select count(id) from public.order_status_events
        where order_id = state.order_id) <> 0 then
    raise exception 'revoked vendor retained order access';
  end if;
end;
$$;
set local role postgres;
update public.business_memberships set accepted_at = now()
where business_id = (select business_id from order_snapshot_probe_state)
  and profile_id = (select vendor_id from order_snapshot_probe_state);
insert into public.profile_capabilities(profile_id, capability)
select vendor_id, 'super_admin' from order_snapshot_probe_state;
select set_config(
  'request.jwt.claim.sub',
  (select vendor_id::text from order_snapshot_probe_state),
  true
);
update public.profiles set is_suspended = true
where id = (select customer_id from order_snapshot_probe_state);
select set_config('request.jwt.claim.sub', '', true);
delete from public.profile_capabilities
where profile_id = (select vendor_id from order_snapshot_probe_state)
  and capability = 'super_admin';
set local role authenticated;
do $$
declare state order_snapshot_probe_state%rowtype;
begin
  select * into state from order_snapshot_probe_state;
  perform set_config('request.jwt.claim.sub', state.customer_id::text, true);
  if exists (select 1 from public.list_customer_orders(
      (select slug from public.markets where id = state.market_id)))
    or (select count(id) from public.orders where id = state.order_id) <> 0
    or (select count(id) from public.order_items where order_id = state.order_id) <> 0
    or (select count(id) from public.order_status_events
        where order_id = state.order_id) <> 0 then
    raise exception 'suspended customer retained order access';
  end if;
end;
$$;
set local role postgres;
insert into public.profile_capabilities(profile_id, capability)
select vendor_id, 'super_admin' from order_snapshot_probe_state;
select set_config(
  'request.jwt.claim.sub',
  (select vendor_id::text from order_snapshot_probe_state),
  true
);
update public.profiles set is_suspended = false
where id = (select customer_id from order_snapshot_probe_state);
select set_config('request.jwt.claim.sub', '', true);
delete from public.profile_capabilities
where profile_id = (select vendor_id from order_snapshot_probe_state)
  and capability = 'super_admin';

-- App and service roles cannot directly mutate snapshots or read buyer/event
-- actor identity through column grants.
set local role service_role;
do $$
begin
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claim.sub', '', true);
  if has_table_privilege('service_role', 'public.orders', 'INSERT')
    or has_table_privilege('service_role', 'public.orders', 'UPDATE')
    or has_table_privilege('service_role', 'public.order_items', 'DELETE')
    or has_table_privilege('service_role', 'public.order_status_events', 'INSERT')
    or has_column_privilege('authenticated', 'public.orders', 'buyer_id', 'SELECT')
    or has_column_privilege('authenticated', 'public.orders', 'guest_intent_id', 'SELECT')
    or has_column_privilege('authenticated', 'public.order_status_events', 'actor_id', 'SELECT') then
    raise exception 'order privilege boundary is too broad';
  end if;
end;
$$;

-- Even a privileged mutation attempt is rejected by immutable snapshot
-- triggers; a later reviewed transition migration must deliberately replace
-- this boundary.
set local role postgres;
do $$
begin
  if has_table_privilege('authenticated', 'private.listing_order_quotes', 'SELECT')
    or not has_schema_privilege('authenticated', 'private', 'USAGE')
    or not has_function_privilege(
      'authenticated', 'private.can_current_actor_view_order(uuid)', 'EXECUTE'
    )
    or has_function_privilege(
      'anon', 'private.can_current_actor_view_order(uuid)', 'EXECUTE'
    )
    or to_regprocedure('public.can_current_actor_view_order(uuid)') is not null then
    raise exception 'private order RLS helper boundary is incorrect';
  end if;
end;
$$;
do $$
declare state order_snapshot_probe_state%rowtype;
begin
  select * into state from order_snapshot_probe_state;
  begin
    insert into public.order_items(
      order_id, listing_id, variant_id, title_snapshot, quantity,
      unit_price_minor, total_minor
    ) values (
      state.order_id, state.listing_id, null, 'Extra Probe Item', 1, 12500, 12500
    );
    raise exception 'second order item unexpectedly succeeded';
  exception when others then
    if sqlerrm <> 'listing order snapshots are immutable' then raise; end if;
  end;
  begin
    insert into public.order_status_events(
      order_id, status, actor_id, note, occurred_at
    ) values (state.order_id, 'placed', state.customer_id, null, now());
    raise exception 'second placed event unexpectedly succeeded';
  exception when others then
    if sqlerrm <> 'listing order snapshots are immutable' then raise; end if;
  end;
  begin
    update public.orders set total_minor = total_minor + 1 where id = state.order_id;
    raise exception 'order snapshot update unexpectedly succeeded';
  exception when others then
    if sqlerrm <> 'listing order snapshots are immutable' then raise; end if;
  end;
  begin
    update public.order_items set quantity = 4 where order_id = state.order_id;
    raise exception 'item snapshot update unexpectedly succeeded';
  exception when others then
    if sqlerrm <> 'listing order snapshots are immutable' then raise; end if;
  end;
  begin
    delete from public.order_status_events where order_id = state.order_id;
    raise exception 'placed event deletion unexpectedly succeeded';
  exception when others then
    if sqlerrm <> 'listing order snapshots are immutable' then raise; end if;
  end;
end;
$$;

-- Bounded service-only cleanup removes one stale unconsumed capability and
-- one stale order limiter row, but never the consumed capability linked to an
-- order.
update public.guest_intents
set expires_at = now() - interval '2 days', updated_at = now() - interval '2 days'
where id = (select cleanup_intent_id from order_snapshot_probe_state);
update private.listing_order_quotes
set expires_at = now() - interval '2 days'
where intent_id = (select cleanup_intent_id from order_snapshot_probe_state);
update public.auth_rate_limits
set updated_at = timestamptz '1900-01-01 00:00:00+00'
where scope = 'listing_order_intent'
  and identifier_hash = (select cleanup_rate_key from order_snapshot_probe_state);

set local role service_role;
do $$
declare result record;
begin
  perform set_config('request.jwt.claim.role', 'service_role', true);
  select * into result from public.prune_listing_order_intents(1);
  if result.listing_order_intents_pruned <> 1
    or result.auth_rate_limits_pruned <> 1 then
    raise exception 'bounded listing order cleanup failed';
  end if;
end;
$$;

-- Consumed capabilities remain replayable during their 30-day retention, then
-- cleanup clears only the nullable pointer while the durable snapshot remains.
set local role postgres;
update public.guest_intents
set consumed_at = now() - interval '31 days',
    expires_at = now() - interval '31 days',
    updated_at = now() - interval '31 days'
where id = (select intent_id from order_snapshot_probe_state);
update private.listing_order_quotes
set expires_at = now() - interval '31 days'
where intent_id = (select intent_id from order_snapshot_probe_state);
set local role service_role;
do $$
declare result record;
begin
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claim.sub', '', true);
  select * into result from public.prune_listing_order_intents(1);
  if result.listing_order_intents_pruned <> 1 then
    raise exception 'consumed listing order capability was not pruned';
  end if;
end;
$$;

set local role postgres;
do $$
declare state order_snapshot_probe_state%rowtype;
begin
  select * into state from order_snapshot_probe_state;
  if exists (select 1 from public.guest_intents where id = state.cleanup_intent_id)
    or exists (select 1 from public.guest_intents where id = state.intent_id)
    or not exists (
      select 1 from public.orders
      where id = state.order_id
        and guest_intent_id is null
        and snapshot_source = 'listing_order'
    )
    or (select count(*) from public.orders) <> state.baseline_orders + 1
    or (select count(*) from public.order_items) <> state.baseline_items + 1
    or (select count(*) from public.order_status_events) <> state.baseline_events + 1
    or (select count(*) from public.audit_events) <> state.baseline_audits + 1 then
    raise exception 'order snapshot cardinality or provenance is incorrect';
  end if;
  if exists (
    select 1 from public.audit_events
    where subject_type = 'order' and subject_id = state.order_id
      and (
        action <> 'order.placed'
        or metadata <> jsonb_build_object(
          'business_id', state.business_id,
          'listing_id', state.listing_id
        )
      )
  ) then
    raise exception 'order audit metadata is not minimized';
  end if;
  if (select count(*) from public.payments) <> state.baseline_payments
    or (select count(*) from public.payment_events) <> state.baseline_payment_events
    or (select count(*) from public.fulfilment_events) <> state.baseline_fulfilment
    or (select count(*) from public.notifications) <> state.baseline_notifications
    or (select count(*) from public.ledger_journals) <> state.baseline_ledgers then
    raise exception 'order placement wrote an excluded workflow table';
  end if;
end;
$$;

rollback;

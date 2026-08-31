-- Rollback-only live regression probe for
-- 202608300023_localhub_order_vendor_transitions.sql.
--
-- This intentionally uses one session and sequential calls. It does not fake
-- concurrency; a separate multi-session harness must hold competing locks and
-- prove commit serialization. Every fixture and every mutation is rolled back.

begin;

create temporary table vendor_order_transition_probe_state (
  customer_id uuid not null,
  owner_id uuid not null,
  manager_id uuid not null,
  staff_id uuid not null,
  pending_id uuid not null,
  foreign_id uuid not null,
  suspended_id uuid not null,
  rate_id uuid not null,
  market_id uuid not null,
  category_id uuid not null,
  listing_type_id uuid not null,
  listing_schema_id uuid not null,
  business_id uuid not null,
  inactive_business_id uuid not null,
  foreign_business_id uuid not null,
  listing_id uuid not null,
  inactive_listing_id uuid not null,
  confirm_order_id uuid not null,
  cancel_order_id uuid not null,
  staff_order_id uuid not null,
  inactive_order_id uuid not null,
  confirm_intent_id uuid not null,
  cancel_intent_id uuid not null,
  staff_intent_id uuid not null,
  inactive_intent_id uuid not null,
  confirm_key uuid not null,
  cancel_key uuid not null,
  staff_key uuid not null,
  market_slug text not null,
  confirm_order_number text not null,
  cancel_order_number text not null,
  staff_order_number text not null,
  baseline_orders bigint not null,
  baseline_items bigint not null,
  baseline_events bigint not null,
  baseline_audits bigint not null,
  baseline_payments bigint not null,
  baseline_payment_events bigint not null,
  baseline_fulfilment bigint not null,
  baseline_notifications bigint not null,
  baseline_inventory bigint not null,
  baseline_ledger_journals bigint not null,
  baseline_ledger_entries bigint not null
) on commit drop;
grant all on table vendor_order_transition_probe_state to authenticated, service_role;

-- Synthetic active users, exact memberships, listings, quotes, and four
-- protected placed orders. No capability secret is selected or printed.
do $$
declare
  fixture_key text := replace(extensions.gen_random_uuid()::text, '-', '');
  state vendor_order_transition_probe_state%rowtype;
  expires_at timestamptz := clock_timestamp() + interval '1 hour';
  placed_at timestamptz;
  route text;
  payload jsonb;
  ale_schema jsonb := jsonb_build_object(
    'contractVersion', '1.1',
    'schemaVersion', 1,
    'schemaKey', 'vendor_transition_probe_v1',
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
  state := row(
    extensions.gen_random_uuid(), extensions.gen_random_uuid(),
    extensions.gen_random_uuid(), extensions.gen_random_uuid(),
    extensions.gen_random_uuid(), extensions.gen_random_uuid(),
    extensions.gen_random_uuid(), extensions.gen_random_uuid(),
    extensions.gen_random_uuid(), extensions.gen_random_uuid(),
    extensions.gen_random_uuid(), extensions.gen_random_uuid(),
    extensions.gen_random_uuid(), extensions.gen_random_uuid(),
    extensions.gen_random_uuid(), extensions.gen_random_uuid(),
    extensions.gen_random_uuid(), extensions.gen_random_uuid(),
    extensions.gen_random_uuid(), extensions.gen_random_uuid(),
    extensions.gen_random_uuid(), extensions.gen_random_uuid(),
    extensions.gen_random_uuid(), extensions.gen_random_uuid(),
    extensions.gen_random_uuid(), extensions.gen_random_uuid(),
    extensions.gen_random_uuid(),
    extensions.gen_random_uuid(),
    'vendor-transition-probe-' || fixture_key,
    null, null, null,
    (select count(*) from public.orders),
    (select count(*) from public.order_items),
    (select count(*) from public.order_status_events),
    (select count(*) from public.audit_events),
    (select count(*) from public.payments),
    (select count(*) from public.payment_events),
    (select count(*) from public.fulfilment_events),
    (select count(*) from public.notifications),
    (select count(*) from public.inventory_levels),
    (select count(*) from public.ledger_journals),
    (select count(*) from public.ledger_entries)
  );
  state.confirm_order_number := format('LO-%s-%s', to_char(current_date, 'YYMMDD'), lpad(nextval('public.localhub_order_number_sequence')::text, 10, '0'));
  state.cancel_order_number := format('LO-%s-%s', to_char(current_date, 'YYMMDD'), lpad(nextval('public.localhub_order_number_sequence')::text, 10, '0'));
  state.staff_order_number := format('LO-%s-%s', to_char(current_date, 'YYMMDD'), lpad(nextval('public.localhub_order_number_sequence')::text, 10, '0'));
  insert into vendor_order_transition_probe_state select state.*;

  insert into auth.users(
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
  )
  select profile_id, '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'vendor-transition-' || label || '-' || fixture_key || '@example.test',
    '', now(), '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb, now(), now()
  from (values
    (state.customer_id, 'customer'), (state.owner_id, 'owner'),
    (state.manager_id, 'manager'), (state.staff_id, 'staff'),
    (state.pending_id, 'pending'), (state.foreign_id, 'foreign'),
    (state.suspended_id, 'suspended'), (state.rate_id, 'rate')
  ) as users(profile_id, label);

  -- Use the real profile guard for the suspended denial fixture.
  insert into public.profile_capabilities(profile_id, capability)
    values (state.owner_id, 'super_admin');
  perform set_config('request.jwt.claim.sub', state.owner_id::text, true);
  update public.profiles set is_suspended = true where id = state.suspended_id;
  perform set_config('request.jwt.claim.sub', '', true);
  delete from public.profile_capabilities
  where profile_id = state.owner_id and capability = 'super_admin';

  insert into public.markets(id, slug, name, currency_code)
    values (state.market_id, state.market_slug, 'Vendor transition probe', 'NGN');
  insert into public.categories(id, market_id, slug, name)
    values (state.category_id, state.market_id, 'transition-products-' || fixture_key, 'Transition products');
  insert into public.listing_types(id, code, name)
    values (state.listing_type_id, 'product', 'Transition probe product');
  insert into public.listing_schemas(
    id, listing_type_id, version, status, schema, published_at
  ) values (
    state.listing_schema_id, state.listing_type_id, 1, 'published',
    ale_schema, now()
  );
  insert into public.category_listing_type_mappings(
    category_id, listing_type_id, listing_schema_id, is_default
  ) values (state.category_id, state.listing_type_id, state.listing_schema_id, true);

  insert into public.businesses(id, market_id, name, slug, status) values
    (state.business_id, state.market_id, 'Transition Probe Vendor', 'transition-vendor-' || fixture_key, 'active'),
    (state.inactive_business_id, state.market_id, 'Inactive Transition Vendor', 'inactive-transition-vendor-' || fixture_key, 'suspended'),
    (state.foreign_business_id, state.market_id, 'Foreign Transition Vendor', 'foreign-transition-vendor-' || fixture_key, 'active');
  insert into public.business_memberships(business_id, profile_id, role, accepted_at) values
    (state.business_id, state.owner_id, 'owner', now()),
    (state.business_id, state.manager_id, 'manager', now()),
    (state.business_id, state.staff_id, 'staff', now()),
    (state.business_id, state.pending_id, 'staff', null),
    (state.business_id, state.suspended_id, 'staff', now()),
    (state.inactive_business_id, state.owner_id, 'owner', now()),
    (state.foreign_business_id, state.foreign_id, 'owner', now());
  insert into public.listings(
    id, business_id, market_id, category_id, listing_type_id,
    listing_schema_id, slug, title, status, price_minor, currency_code,
    published_at, created_by, is_orderable
  ) values
    (state.listing_id, state.business_id, state.market_id, state.category_id,
      state.listing_type_id, state.listing_schema_id, 'transition-item-' || fixture_key,
      'Transition Probe Item', 'active', 12500, 'NGN', now(), state.owner_id, true),
    (state.inactive_listing_id, state.inactive_business_id, state.market_id, state.category_id,
      state.listing_type_id, state.listing_schema_id, 'inactive-transition-item-' || fixture_key,
      'Inactive Transition Item', 'active', 12500, 'NGN', now(), state.owner_id, true);

  route := 'transition-vendor-' || fixture_key || '~transition-item-' || fixture_key;
  payload := jsonb_build_object(
    'type', 'listing_order', 'listing_id', state.listing_id,
    'business_id', state.business_id, 'market_id', state.market_id,
    'category_id', state.category_id, 'quantity', 1,
    'listing_route', route
  );
  insert into public.guest_intents(
    id, market_id, kind, return_to, payload, claimed_by, claimed_at,
    expires_at, consumed_at
  ) values
    (state.confirm_intent_id, state.market_id, 'listing_order', '/' || state.market_slug || '/listings/' || route || '/order', payload, state.customer_id, now(), expires_at, now()),
    (state.cancel_intent_id, state.market_id, 'listing_order', '/' || state.market_slug || '/listings/' || route || '/order', payload, state.customer_id, now(), expires_at, now()),
    (state.staff_intent_id, state.market_id, 'listing_order', '/' || state.market_slug || '/listings/' || route || '/order', payload, state.customer_id, now(), expires_at, now());
  insert into private.listing_order_quotes(
    intent_id, listing_id, business_id, market_id, category_id,
    quantity, listing_title, vendor_name, market_slug, listing_route,
    currency_code, unit_price_minor, total_minor, expires_at
  ) values
    (state.confirm_intent_id, state.listing_id, state.business_id, state.market_id, state.category_id, 1, 'Transition Probe Item', 'Transition Probe Vendor', state.market_slug, route, 'NGN', 12500, 12500, expires_at),
    (state.cancel_intent_id, state.listing_id, state.business_id, state.market_id, state.category_id, 1, 'Transition Probe Item', 'Transition Probe Vendor', state.market_slug, route, 'NGN', 12500, 12500, expires_at),
    (state.staff_intent_id, state.listing_id, state.business_id, state.market_id, state.category_id, 1, 'Transition Probe Item', 'Transition Probe Vendor', state.market_slug, route, 'NGN', 12500, 12500, expires_at);

  insert into public.guest_intents(
    id, market_id, kind, return_to, payload, claimed_by, claimed_at,
    expires_at, consumed_at
  ) values (
    state.inactive_intent_id, state.market_id, 'listing_order', '/' || state.market_slug || '/listings/inactive/order',
    jsonb_build_object('type', 'listing_order', 'listing_id', state.inactive_listing_id),
    state.customer_id, now(), expires_at, now()
  );
  placed_at := clock_timestamp() - interval '10 seconds';
  insert into public.orders(
    id, order_number, buyer_id, business_id, market_id, status, currency_code,
    subtotal_minor, total_minor, guest_intent_id, snapshot_source,
    vendor_name_snapshot, listing_route_snapshot, placed_at, created_at, updated_at
  ) values
    (state.confirm_order_id, state.confirm_order_number, state.customer_id, state.business_id, state.market_id, 'placed', 'NGN', 12500, 12500, state.confirm_intent_id, 'listing_order', 'Transition Probe Vendor', route, placed_at, placed_at, placed_at),
    (state.cancel_order_id, state.cancel_order_number, state.customer_id, state.business_id, state.market_id, 'placed', 'NGN', 12500, 12500, state.cancel_intent_id, 'listing_order', 'Transition Probe Vendor', route, placed_at + interval '1 second', placed_at + interval '1 second', placed_at + interval '1 second'),
    (state.staff_order_id, state.staff_order_number, state.customer_id, state.business_id, state.market_id, 'placed', 'NGN', 12500, 12500, state.staff_intent_id, 'listing_order', 'Transition Probe Vendor', route, placed_at + interval '2 seconds', placed_at + interval '2 seconds', placed_at + interval '2 seconds'),
    (state.inactive_order_id, format('LO-%s-%s', to_char(current_date, 'YYMMDD'), lpad(nextval('public.localhub_order_number_sequence')::text, 10, '0')), state.customer_id, state.inactive_business_id, state.market_id, 'placed', 'NGN', 12500, 12500, state.inactive_intent_id, 'listing_order', 'Inactive Transition Vendor', 'inactive-transition-vendor-' || fixture_key || '~inactive-transition-item-' || fixture_key, placed_at + interval '3 seconds', placed_at + interval '3 seconds', placed_at + interval '3 seconds');
  insert into public.order_items(order_id, listing_id, variant_id, title_snapshot, quantity, unit_price_minor, total_minor, created_at)
  select order_id, state.listing_id, null, 'Transition Probe Item', 1, 12500, 12500, placed_at
  from (values (state.confirm_order_id), (state.cancel_order_id), (state.staff_order_id)) items(order_id);
  insert into public.order_items(order_id, listing_id, variant_id, title_snapshot, quantity, unit_price_minor, total_minor, created_at)
    values (state.inactive_order_id, state.inactive_listing_id, null, 'Inactive Transition Item', 1, 12500, 12500, placed_at + interval '3 seconds');
  insert into public.order_status_events(order_id, status, actor_id, note, occurred_at)
  select order_id, 'placed', state.customer_id, null, placed_at + delta
  from (values (state.confirm_order_id, interval '0 seconds'), (state.cancel_order_id, interval '1 second'), (state.staff_order_id, interval '2 seconds'), (state.inactive_order_id, interval '3 seconds')) events(order_id, delta);
  insert into public.audit_events(actor_id, subject_type, subject_id, action, metadata, created_at)
  select state.customer_id, 'order', order_id, 'order.placed',
    jsonb_build_object('business_id', business_id, 'listing_id', listing_id),
    placed_at + delta
  from (values
    (state.confirm_order_id, state.business_id, state.listing_id, interval '0 seconds'),
    (state.cancel_order_id, state.business_id, state.listing_id, interval '1 second'),
    (state.staff_order_id, state.business_id, state.listing_id, interval '2 seconds'),
    (state.inactive_order_id, state.inactive_business_id, state.inactive_listing_id, interval '3 seconds')
  ) audits(order_id, business_id, listing_id, delta);
end;
$$;

-- Denials are deliberately indistinguishable and happen before any terminal
-- decision: pending, foreign-business, suspended-profile, inactive-business,
-- and customer actors cannot transition a placed listing order.
set local role authenticated;
do $$
declare
  state vendor_order_transition_probe_state%rowtype;
  denied_actor record;
  result record;
begin
  select * into state from vendor_order_transition_probe_state;
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  for denied_actor in
    select * from (values
      (state.pending_id, state.confirm_order_id, 'pending'),
      (state.foreign_id, state.confirm_order_id, 'foreign'),
      (state.suspended_id, state.confirm_order_id, 'suspended'),
      (state.owner_id, state.inactive_order_id, 'inactive'),
      (state.customer_id, state.staff_order_id, 'customer')
    ) denied(actor_id, order_id, label)
  loop
    perform set_config('request.jwt.claim.sub', denied_actor.actor_id::text, true);
    select * into result from public.respond_to_listing_order(
      denied_actor.order_id, 'confirm', extensions.gen_random_uuid()
    );
    if result.outcome <> 'not_found' or result.order_id is not null then
      raise exception 'denied % actor reached a transition outcome', denied_actor.label;
    end if;
  end loop;
  perform set_config('request.jwt.claim.sub', state.owner_id::text, true);
  select * into result from public.respond_to_listing_order(
    state.confirm_order_id, null::text, state.confirm_key
  );
  if result.outcome <> 'invalid' then raise exception 'null decision was not invalid'; end if;
end;
$$;

-- Owner confirms, manager cancels, and staff confirms a separate sequential
-- order. The exact same key replays; another order reusing it is rejected.
do $$
declare
  state vendor_order_transition_probe_state%rowtype;
  result record;
begin
  select * into state from vendor_order_transition_probe_state;
  perform set_config('request.jwt.claim.sub', state.owner_id::text, true);
  select * into result from public.respond_to_listing_order(state.confirm_order_id, 'confirm', state.confirm_key);
  if result.outcome <> 'transitioned' or result.status <> 'confirmed' or result.vendor_decided_at is null then raise exception 'owner confirm failed'; end if;
  select * into result from public.respond_to_listing_order(state.confirm_order_id, 'confirm', state.confirm_key);
  if result.outcome <> 'replayed' or result.status <> 'confirmed'
    or result.vendor_decided_at is null or result.updated_at is null then raise exception 'same-key replay failed'; end if;
  select * into result from public.respond_to_listing_order(state.cancel_order_id, 'confirm', state.confirm_key);
  if result.outcome <> 'idempotency_key_reused' then raise exception 'key reuse was accepted'; end if;
  select * into result from public.respond_to_listing_order(state.confirm_order_id, 'confirm', extensions.gen_random_uuid());
  if result.outcome <> 'already_transitioned' or result.vendor_decided_at is null
    or result.updated_at is null then raise exception 'same terminal decision was not already_transitioned'; end if;
  select * into result from public.respond_to_listing_order(state.confirm_order_id, 'cancel', extensions.gen_random_uuid());
  if result.outcome <> 'conflict' or result.vendor_decided_at is null
    or result.updated_at is null then raise exception 'opposite terminal decision was not conflict'; end if;

  perform set_config('request.jwt.claim.sub', state.manager_id::text, true);
  select * into result from public.respond_to_listing_order(state.cancel_order_id, 'cancel', state.cancel_key);
  if result.outcome <> 'transitioned' or result.status <> 'cancelled' then raise exception 'manager cancel failed'; end if;
  perform set_config('request.jwt.claim.sub', state.staff_id::text, true);
  select * into result from public.respond_to_listing_order(state.staff_order_id, 'confirm', state.staff_key);
  if result.outcome <> 'transitioned' or result.status <> 'confirmed' then raise exception 'staff confirm failed'; end if;
end;
$$;

-- Exact-key replay repeats current authorization. A now-revoked member, an
-- inactive business, or a now-suspended actor cannot use a durable key as a
-- stale capability to recover terminal order state.
set local role postgres;
update public.business_memberships
set accepted_at = null
where business_id = (select business_id from vendor_order_transition_probe_state)
  and profile_id = (select staff_id from vendor_order_transition_probe_state);
set local role authenticated;
do $$
declare state vendor_order_transition_probe_state%rowtype; result record;
begin
  select * into state from vendor_order_transition_probe_state;
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', state.staff_id::text, true);
  select * into result from public.respond_to_listing_order(
    state.staff_order_id, 'confirm', state.staff_key
  );
  if result.outcome <> 'not_found' or result.order_id is not null then
    raise exception 'revoked member replay was authorized';
  end if;
end;
$$;
set local role postgres;
update public.business_memberships
set accepted_at = clock_timestamp()
where business_id = (select business_id from vendor_order_transition_probe_state)
  and profile_id = (select staff_id from vendor_order_transition_probe_state);
update public.businesses
set status = 'suspended'
where id = (select business_id from vendor_order_transition_probe_state);
set local role authenticated;
do $$
declare state vendor_order_transition_probe_state%rowtype; result record;
begin
  select * into state from vendor_order_transition_probe_state;
  perform set_config('request.jwt.claim.sub', state.staff_id::text, true);
  select * into result from public.respond_to_listing_order(
    state.staff_order_id, 'confirm', state.staff_key
  );
  if result.outcome <> 'not_found' or result.order_id is not null then
    raise exception 'inactive business replay was authorized';
  end if;
end;
$$;
set local role postgres;
update public.businesses
set status = 'active'
where id = (select business_id from vendor_order_transition_probe_state);
do $$
declare state vendor_order_transition_probe_state%rowtype;
begin
  select * into state from vendor_order_transition_probe_state;
  insert into public.profile_capabilities(profile_id, capability)
  values (state.owner_id, 'super_admin');
  perform set_config('request.jwt.claim.sub', state.owner_id::text, true);
  update public.profiles set is_suspended = true where id = state.staff_id;
end;
$$;
set local role authenticated;
do $$
declare state vendor_order_transition_probe_state%rowtype; result record;
begin
  select * into state from vendor_order_transition_probe_state;
  perform set_config('request.jwt.claim.sub', state.staff_id::text, true);
  select * into result from public.respond_to_listing_order(
    state.staff_order_id, 'confirm', state.staff_key
  );
  if result.outcome <> 'not_found' or result.order_id is not null then
    raise exception 'suspended actor replay was authorized';
  end if;
end;
$$;
set local role postgres;
do $$
declare state vendor_order_transition_probe_state%rowtype;
begin
  select * into state from vendor_order_transition_probe_state;
  perform set_config('request.jwt.claim.sub', state.owner_id::text, true);
  update public.profiles set is_suspended = false where id = state.staff_id;
  delete from public.profile_capabilities
  where profile_id = state.owner_id and capability = 'super_admin';
end;
$$;
set local role authenticated;

-- Both customer and exact-business vendor projections read the same terminal
-- row, expose the dedicated timestamp, and contain no PII or private state.
do $$
declare
  state vendor_order_transition_probe_state%rowtype;
  customer_view record;
  vendor_view record;
begin
  select * into state from vendor_order_transition_probe_state;
  perform set_config('request.jwt.claim.sub', state.customer_id::text, true);
  if (select count(*) from public.list_customer_orders(state.market_slug)) <> 4
    or (select count(*) from public.orders where id = state.confirm_order_id) <> 1 then
    raise exception 'customer projection or RLS failed';
  end if;
  select * into customer_view from public.get_customer_order(state.market_slug, state.confirm_order_number);
  if customer_view.status <> 'confirmed' or customer_view.vendor_decided_at is null
    or customer_view.order_id <> state.confirm_order_id
    or row_to_json(customer_view)::jsonb ? 'buyer_id'
    or row_to_json(customer_view)::jsonb ? 'phone_e164'
    or row_to_json(customer_view)::jsonb ? 'secret_hash' then
    raise exception 'customer projection is not canonical or minimized';
  end if;
  perform set_config('request.jwt.claim.sub', state.owner_id::text, true);
  if (select count(*) from public.list_vendor_orders()) <> 4
    or (select count(*) from public.orders where id = state.confirm_order_id) <> 1 then
    raise exception 'vendor projection or RLS failed';
  end if;
  select * into vendor_view from public.get_vendor_order(state.confirm_order_number);
  if vendor_view.status <> customer_view.status
    or vendor_view.vendor_decided_at <> customer_view.vendor_decided_at
    or vendor_view.order_id <> customer_view.order_id
    or row_to_json(vendor_view)::jsonb ? 'buyer_id'
    or row_to_json(vendor_view)::jsonb ? 'phone_e164' then
    raise exception 'customer and vendor projections diverged or disclosed PII';
  end if;
  perform set_config('request.jwt.claim.sub', state.foreign_id::text, true);
  if exists (select 1 from public.list_vendor_orders()) then raise exception 'foreign vendor saw orders'; end if;
end;
$$;

-- Placement replay is durable and survives a vendor decision; it uses the
-- immutable item/event/audit chain rather than trusting the transition ledger,
-- while the consumed capability remains inside its bounded retention window.
do $$
declare
  state vendor_order_transition_probe_state%rowtype;
  result record;
begin
  select * into state from vendor_order_transition_probe_state;
  perform set_config('request.jwt.claim.sub', state.customer_id::text, true);
  select * into result from public.create_listing_order_from_intent(state.confirm_intent_id);
  if result.outcome <> 'replayed' or result.status <> 'confirmed' or result.vendor_decided_at is null or result.order_id <> state.confirm_order_id then raise exception 'confirmed terminal placement replay failed'; end if;
  select * into result from public.create_listing_order_from_intent(state.cancel_intent_id);
  if result.outcome <> 'replayed' or result.status <> 'cancelled' or result.vendor_decided_at is null or result.order_id <> state.cancel_order_id then raise exception 'cancelled terminal placement replay failed'; end if;
end;
$$;

-- Existing consumed-capability cleanup may retire replay after 30 days. The
-- ON DELETE SET NULL maintenance update must not falsify the order's last
-- authoritative commerce timestamp.
set local role postgres;
do $$
declare
  state vendor_order_transition_probe_state%rowtype;
  before_cleanup timestamptz;
  after_cleanup timestamptz;
  remaining_intent uuid;
begin
  select * into state from vendor_order_transition_probe_state;
  select o.updated_at into strict before_cleanup
  from public.orders o
  where o.id = state.confirm_order_id;

  delete from public.guest_intents g where g.id = state.confirm_intent_id;

  select o.updated_at, o.guest_intent_id
  into strict after_cleanup, remaining_intent
  from public.orders o
  where o.id = state.confirm_order_id;
  if remaining_intent is not null
    or after_cleanup is distinct from before_cleanup then
    raise exception 'capability cleanup changed authoritative order time';
  end if;
end;
$$;

-- Exact event/audit cardinality and timestamp provenance for all three
-- decisions; no payment, fulfilment, notification, inventory, or ledger write.
set local role postgres;
do $$
declare
  state vendor_order_transition_probe_state%rowtype;
  probe_order_id uuid;
  terminal_status text;
  decided_at timestamptz;
  event_at timestamptz;
begin
  select * into state from vendor_order_transition_probe_state;
  for probe_order_id, terminal_status in
    select state.confirm_order_id, 'confirmed'
    union all select state.cancel_order_id, 'cancelled'
    union all select state.staff_order_id, 'confirmed'
  loop
    select o.vendor_decided_at into decided_at from public.orders o where o.id = probe_order_id;
    select e.occurred_at into event_at from public.order_status_events e where e.order_id = probe_order_id and e.status::text = terminal_status;
    if (select count(*) from public.order_status_events where order_status_events.order_id = probe_order_id) <> 2
      or decided_at is null or event_at is distinct from decided_at
      or (select updated_at from public.orders where id = probe_order_id) is distinct from decided_at
      or (select count(*) from public.audit_events where subject_type = 'order' and subject_id = probe_order_id and action = 'order.placed') <> 1
      or (select count(*) from public.audit_events where subject_type = 'order' and subject_id = probe_order_id and action = case when terminal_status = 'confirmed' then 'order.confirmed' else 'order.cancelled' end) <> 1
      or exists (select 1 from public.audit_events where subject_id = probe_order_id and action = case when terminal_status = 'confirmed' then 'order.confirmed' else 'order.cancelled' end and created_at is distinct from decided_at)
      or exists (select 1 from public.audit_events where subject_id = probe_order_id and action = case when terminal_status = 'confirmed' then 'order.confirmed' else 'order.cancelled' end and metadata <> jsonb_build_object('from_status', 'placed', 'to_status', terminal_status, 'business_id', state.business_id)) then
      raise exception 'terminal event/audit chain is not exact';
    end if;
  end loop;
  if (select count(*) from private.listing_order_vendor_transitions where order_id in (state.confirm_order_id, state.cancel_order_id, state.staff_order_id)) <> 3 then raise exception 'transition ledger cardinality is incorrect'; end if;
  if (select count(*) from public.payments) <> state.baseline_payments
    or (select count(*) from public.payment_events) <> state.baseline_payment_events
    or (select count(*) from public.fulfilment_events) <> state.baseline_fulfilment
    or (select count(*) from public.notifications) <> state.baseline_notifications
    or (select count(*) from public.inventory_levels) <> state.baseline_inventory
    or (select count(*) from public.ledger_journals) <> state.baseline_ledger_journals
    or (select count(*) from public.ledger_entries) <> state.baseline_ledger_entries then raise exception 'excluded workflow table changed'; end if;
end;
$$;

-- Application/service roles cannot directly mutate protected tables. A
-- postgres-level attempt is also rejected by the immutable trigger.
set local role postgres;
do $$
begin
  perform set_config('request.jwt.claim.role', 'service_role', true);
  if has_table_privilege('service_role', 'public.orders', 'UPDATE')
    or has_table_privilege('service_role', 'public.order_items', 'DELETE')
    or has_table_privilege('service_role', 'public.order_status_events', 'INSERT')
    or has_table_privilege('authenticated', 'private.listing_order_vendor_transitions', 'SELECT')
    or has_function_privilege('authenticated', 'private.respond_to_listing_order(uuid, text, uuid)', 'EXECUTE') then
    raise exception 'direct mutation or private transition privilege is too broad';
  end if;
end;
$$;
set local role postgres;
do $$
declare state vendor_order_transition_probe_state%rowtype;
begin
  select * into state from vendor_order_transition_probe_state;
  begin
    update public.orders set total_minor = total_minor + 1 where id = state.confirm_order_id;
    raise exception 'direct order DML unexpectedly succeeded';
  exception when others then
    if sqlerrm <> 'listing order snapshots are immutable' then raise; end if;
  end;
  begin
    update public.order_items set quantity = 2 where order_id = state.confirm_order_id;
    raise exception 'direct item DML unexpectedly succeeded';
  exception when others then
    if sqlerrm <> 'listing order snapshots are immutable' then raise; end if;
  end;
  begin
    delete from public.order_status_events where order_id = state.confirm_order_id;
    raise exception 'direct event DML unexpectedly succeeded';
  exception when others then
    if sqlerrm <> 'listing order snapshots are immutable' then raise; end if;
  end;
end;
$$;

-- The actor-first limiter allows 120 attempts, then fails closed without order
-- lookup. A separate rate fixture avoids consuming this exact boundary earlier.
set local role authenticated;
do $$
declare
  state vendor_order_transition_probe_state%rowtype;
  result record;
  attempt integer;
begin
  select * into state from vendor_order_transition_probe_state;
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', state.rate_id::text, true);
  for attempt in 1..120 loop
    select * into result from public.respond_to_listing_order(extensions.gen_random_uuid(), 'confirm', extensions.gen_random_uuid());
    if result.outcome <> 'not_found' then raise exception 'rate limit activated before 120 loop boundary'; end if;
  end loop;
  select * into result from public.respond_to_listing_order(extensions.gen_random_uuid(), 'confirm', extensions.gen_random_uuid());
  if result.outcome <> 'rate_limited' or not result.retryable or result.order_id is not null then raise exception '120/hour limiter did not fail closed'; end if;
end;
$$;

-- Stale private transition/rate rows are pruned only by the bounded service
-- helper. This is intentionally exercised after replay verification.
set local role postgres;
update private.listing_order_vendor_transitions
set created_at = timestamptz '1900-01-01 00:00:00+00'
where actor_id = (select owner_id from vendor_order_transition_probe_state);
update private.listing_order_vendor_transition_rate_limits
set updated_at = timestamptz '1900-01-01 00:00:00+00'
where actor_id = (select owner_id from vendor_order_transition_probe_state);
set local role service_role;
do $$
declare
  state vendor_order_transition_probe_state%rowtype;
  result record;
begin
  select * into state from vendor_order_transition_probe_state;
  perform set_config('request.jwt.claim.role', 'service_role', true);
  select * into result from public.prune_listing_order_vendor_transitions(2000);
  if result.transitions_pruned < 1 or result.rate_limits_pruned < 1 then
    raise exception 'bounded vendor transition cleanup failed';
  end if;
end;
$$;

set local role postgres;
do $$
declare state vendor_order_transition_probe_state%rowtype;
begin
  select * into state from vendor_order_transition_probe_state;
  if exists (select 1 from private.listing_order_vendor_transitions where actor_id = state.owner_id)
    or exists (select 1 from private.listing_order_vendor_transition_rate_limits where actor_id = state.owner_id) then
    raise exception 'bounded vendor transition cleanup retained fixture rows';
  end if;
  if (select count(*) from public.orders) <> state.baseline_orders + 4
    or (select count(*) from public.order_items) <> state.baseline_items + 4
    or (select count(*) from public.order_status_events) <> state.baseline_events + 7
    or (select count(*) from public.audit_events) <> state.baseline_audits + 7
    or (select count(*) from public.payments) <> state.baseline_payments
    or (select count(*) from public.payment_events) <> state.baseline_payment_events
    or (select count(*) from public.fulfilment_events) <> state.baseline_fulfilment
    or (select count(*) from public.notifications) <> state.baseline_notifications
    or (select count(*) from public.inventory_levels) <> state.baseline_inventory
    or (select count(*) from public.ledger_journals) <> state.baseline_ledger_journals
    or (select count(*) from public.ledger_entries) <> state.baseline_ledger_entries then
    raise exception 'vendor transition probe changed unexpected rows';
  end if;
end;
$$;

rollback;

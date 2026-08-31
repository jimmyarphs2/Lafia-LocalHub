-- Rollback-only live regression probe for
-- 202608300024_localhub_order_fulfilment_processing.sql.
--
-- This intentionally uses one session and sequential calls. It does not fake
-- concurrency; a separate multi-session harness must prove lock contention.
-- Every fixture and every mutation is rolled back.

begin;

create temporary table order_fulfilment_processing_probe_state (
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
  owner_order_id uuid not null,
  manager_order_id uuid not null,
  staff_order_id uuid not null,
  inactive_order_id uuid not null,
  owner_intent_id uuid not null,
  manager_intent_id uuid not null,
  staff_intent_id uuid not null,
  owner_key uuid not null,
  manager_key uuid not null,
  staff_key uuid not null,
  market_slug text not null,
  owner_order_number text not null,
  owner_fulfilment_id uuid,
  baseline_orders bigint not null,
  baseline_items bigint not null,
  baseline_order_events bigint not null,
  baseline_fulfilment_aggregates bigint not null,
  baseline_fulfilment_events bigint not null,
  baseline_audits bigint not null,
  baseline_payments bigint not null,
  baseline_payment_events bigint not null,
  baseline_notifications bigint not null,
  baseline_inventory bigint not null,
  baseline_ledger_journals bigint not null,
  baseline_ledger_entries bigint not null
) on commit drop;
grant all on table order_fulfilment_processing_probe_state
  to authenticated, service_role;

-- Create synthetic users, a valid catalog, and four immutable placed orders.
-- No intent/capability secret is selected or printed.
do $$
declare
  fixture_key text := replace(extensions.gen_random_uuid()::text, '-', '');
  state order_fulfilment_processing_probe_state%rowtype;
  expires_at timestamptz := clock_timestamp() + interval '1 hour';
  placement_time timestamptz := clock_timestamp() - interval '20 seconds';
  route text;
  payload jsonb;
  ale_schema jsonb := jsonb_build_object(
    'contractVersion', '1.1', 'schemaVersion', 1,
    'schemaKey', 'fulfilment_processing_probe_v1', 'listingKind', 'product',
    'terminology', jsonb_build_object('singular', 'product', 'plural', 'products', 'createAction', 'Add product'),
    'bindings', jsonb_build_object('title', 'title'),
    'fields', jsonb_build_array(jsonb_build_object(
      'key', 'title', 'label', 'Product name', 'required', true,
      'type', 'short_text', 'minLength', 2, 'maxLength', 120
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
    'fulfilment-processing-probe-' || fixture_key,
    null,
    null,
    (select count(*) from public.orders),
    (select count(*) from public.order_items),
    (select count(*) from public.order_status_events),
    (select count(*) from public.order_fulfilments),
    (select count(*) from public.fulfilment_events),
    (select count(*) from public.audit_events),
    (select count(*) from public.payments),
    (select count(*) from public.payment_events),
    (select count(*) from public.notifications),
    (select count(*) from public.inventory_levels),
    (select count(*) from public.ledger_journals),
    (select count(*) from public.ledger_entries)
  );
  state.owner_order_number := format(
    'LO-%s-%s', to_char(current_date, 'YYMMDD'),
    lpad((('x' || substr(md5(fixture_key || ':owner'), 1, 8))::bit(32)::bigint)::text, 10, '0')
  );
  insert into order_fulfilment_processing_probe_state select state.*;

  insert into auth.users(
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) select profile_id, '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'fulfilment-processing-' || label || '-' || fixture_key || '@example.test',
    '', now(), '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb, now(), now()
  from (values
    (state.customer_id, 'customer'), (state.owner_id, 'owner'),
    (state.manager_id, 'manager'), (state.staff_id, 'staff'),
    (state.pending_id, 'pending'), (state.foreign_id, 'foreign'),
    (state.suspended_id, 'suspended'), (state.rate_id, 'rate')
  ) as users(profile_id, label);

  insert into public.profile_capabilities(profile_id, capability)
    values (state.owner_id, 'super_admin');
  perform set_config('request.jwt.claim.sub', state.owner_id::text, true);
  update public.profiles set is_suspended = true where id = state.suspended_id;
  perform set_config('request.jwt.claim.sub', '', true);
  delete from public.profile_capabilities
  where profile_id = state.owner_id and capability = 'super_admin';

  insert into public.markets(id, slug, name, currency_code)
    values (state.market_id, state.market_slug, 'Fulfilment processing probe', 'NGN');
  insert into public.categories(id, market_id, slug, name)
    values (state.category_id, state.market_id, 'processing-products-' || fixture_key, 'Processing products');
  insert into public.listing_types(id, code, name)
    values (state.listing_type_id, 'product', 'Processing probe product');
  insert into public.listing_schemas(id, listing_type_id, version, status, schema, published_at)
    values (state.listing_schema_id, state.listing_type_id, 1, 'published', ale_schema, now());
  insert into public.category_listing_type_mappings(category_id, listing_type_id, listing_schema_id, is_default)
    values (state.category_id, state.listing_type_id, state.listing_schema_id, true);
  insert into public.businesses(id, market_id, name, slug, status) values
    (state.business_id, state.market_id, 'Processing Probe Vendor', 'processing-vendor-' || fixture_key, 'active'),
    (state.inactive_business_id, state.market_id, 'Inactive Processing Vendor', 'inactive-processing-vendor-' || fixture_key, 'suspended'),
    (state.foreign_business_id, state.market_id, 'Foreign Processing Vendor', 'foreign-processing-vendor-' || fixture_key, 'active');
  insert into public.business_memberships(business_id, profile_id, role, accepted_at) values
    (state.business_id, state.owner_id, 'owner', now()),
    (state.business_id, state.manager_id, 'manager', now()),
    (state.business_id, state.staff_id, 'staff', now()),
    (state.business_id, state.pending_id, 'staff', null),
    (state.business_id, state.suspended_id, 'staff', now()),
    (state.inactive_business_id, state.owner_id, 'owner', now()),
    (state.foreign_business_id, state.foreign_id, 'owner', now());
  insert into public.listings(
    id, business_id, market_id, category_id, listing_type_id, listing_schema_id,
    slug, title, status, price_minor, currency_code, published_at, created_by, is_orderable
  ) values
    (state.listing_id, state.business_id, state.market_id, state.category_id,
      state.listing_type_id, state.listing_schema_id, 'processing-item-' || fixture_key,
      'Processing Probe Item', 'active', 12500, 'NGN', now(), state.owner_id, true),
    (state.inactive_listing_id, state.inactive_business_id, state.market_id, state.category_id,
      state.listing_type_id, state.listing_schema_id, 'inactive-processing-item-' || fixture_key,
      'Inactive Processing Item', 'active', 12500, 'NGN', now(), state.owner_id, true);
  route := 'processing-vendor-' || fixture_key || '~processing-item-' || fixture_key;
  payload := jsonb_build_object(
    'type', 'listing_order', 'listing_id', state.listing_id,
    'business_id', state.business_id, 'market_id', state.market_id,
    'category_id', state.category_id, 'quantity', 1, 'listing_route', route
  );
  insert into public.guest_intents(
    id, market_id, kind, return_to, payload, claimed_by, claimed_at, expires_at, consumed_at
  ) values
    (state.owner_intent_id, state.market_id, 'listing_order', '/' || state.market_slug || '/listings/' || route || '/order', payload, state.customer_id, now(), expires_at, now()),
    (state.manager_intent_id, state.market_id, 'listing_order', '/' || state.market_slug || '/listings/' || route || '/order', payload, state.customer_id, now(), expires_at, now()),
    (state.staff_intent_id, state.market_id, 'listing_order', '/' || state.market_slug || '/listings/' || route || '/order', payload, state.customer_id, now(), expires_at, now());
  insert into private.listing_order_quotes(
    intent_id, listing_id, business_id, market_id, category_id, quantity,
    listing_title, vendor_name, market_slug, listing_route, currency_code,
    unit_price_minor, total_minor, expires_at
  ) values
    (state.owner_intent_id, state.listing_id, state.business_id, state.market_id, state.category_id, 1, 'Processing Probe Item', 'Processing Probe Vendor', state.market_slug, route, 'NGN', 12500, 12500, expires_at),
    (state.manager_intent_id, state.listing_id, state.business_id, state.market_id, state.category_id, 1, 'Processing Probe Item', 'Processing Probe Vendor', state.market_slug, route, 'NGN', 12500, 12500, expires_at),
    (state.staff_intent_id, state.listing_id, state.business_id, state.market_id, state.category_id, 1, 'Processing Probe Item', 'Processing Probe Vendor', state.market_slug, route, 'NGN', 12500, 12500, expires_at);
  insert into public.orders(
    id, order_number, buyer_id, business_id, market_id, status, currency_code,
    subtotal_minor, total_minor, guest_intent_id, snapshot_source,
    vendor_name_snapshot, listing_route_snapshot, placed_at, created_at, updated_at
  ) values
    (state.owner_order_id, state.owner_order_number, state.customer_id, state.business_id, state.market_id, 'placed', 'NGN', 12500, 12500, state.owner_intent_id, 'listing_order', 'Processing Probe Vendor', route, placement_time, placement_time, placement_time),
    (state.manager_order_id, format('LO-%s-%s', to_char(current_date, 'YYMMDD'), lpad((('x' || substr(md5(fixture_key || ':manager'), 1, 8))::bit(32)::bigint)::text, 10, '0')), state.customer_id, state.business_id, state.market_id, 'placed', 'NGN', 12500, 12500, state.manager_intent_id, 'listing_order', 'Processing Probe Vendor', route, placement_time + interval '1 second', placement_time + interval '1 second', placement_time + interval '1 second'),
    (state.staff_order_id, format('LO-%s-%s', to_char(current_date, 'YYMMDD'), lpad((('x' || substr(md5(fixture_key || ':staff'), 1, 8))::bit(32)::bigint)::text, 10, '0')), state.customer_id, state.business_id, state.market_id, 'placed', 'NGN', 12500, 12500, state.staff_intent_id, 'listing_order', 'Processing Probe Vendor', route, placement_time + interval '2 seconds', placement_time + interval '2 seconds', placement_time + interval '2 seconds'),
    (state.inactive_order_id, format('LO-%s-%s', to_char(current_date, 'YYMMDD'), lpad((('x' || substr(md5(fixture_key || ':inactive'), 1, 8))::bit(32)::bigint)::text, 10, '0')), state.customer_id, state.inactive_business_id, state.market_id, 'placed', 'NGN', 12500, 12500, null, 'listing_order', 'Inactive Processing Vendor', 'inactive-processing-vendor-' || fixture_key || '~inactive-processing-item-' || fixture_key, placement_time + interval '3 seconds', placement_time + interval '3 seconds', placement_time + interval '3 seconds');
  insert into public.order_items(order_id, listing_id, variant_id, title_snapshot, quantity, unit_price_minor, total_minor, created_at)
  select order_id, state.listing_id, null, 'Processing Probe Item', 1, 12500, 12500, placement_time + delta
  from (values (state.owner_order_id, interval '0 seconds'), (state.manager_order_id, interval '1 second'), (state.staff_order_id, interval '2 seconds')) items(order_id, delta);
  insert into public.order_items(order_id, listing_id, variant_id, title_snapshot, quantity, unit_price_minor, total_minor, created_at)
    values (state.inactive_order_id, state.inactive_listing_id, null, 'Inactive Processing Item', 1, 12500, 12500, placement_time + interval '3 seconds');
  insert into public.order_status_events(order_id, status, actor_id, note, occurred_at)
  select order_id, 'placed', state.customer_id, null, placement_time + delta
  from (values (state.owner_order_id, interval '0 seconds'), (state.manager_order_id, interval '1 second'), (state.staff_order_id, interval '2 seconds'), (state.inactive_order_id, interval '3 seconds')) events(order_id, delta);
  insert into public.audit_events(actor_id, subject_type, subject_id, action, metadata, created_at)
  select state.customer_id, 'order', order_id, 'order.placed',
    jsonb_build_object('business_id', business_id, 'listing_id', listing_id), placement_time + delta
  from (values
    (state.owner_order_id, state.business_id, state.listing_id, interval '0 seconds'),
    (state.manager_order_id, state.business_id, state.listing_id, interval '1 second'),
    (state.staff_order_id, state.business_id, state.listing_id, interval '2 seconds'),
    (state.inactive_order_id, state.inactive_business_id, state.inactive_listing_id, interval '3 seconds')
  ) audits(order_id, business_id, listing_id, delta);
end;
$$;

-- An active-business order in the placed pre-state fails closed before the
-- protected confirmation boundary runs.
set local role authenticated;
do $$
declare state order_fulfilment_processing_probe_state%rowtype; result record;
begin
  select * into state from order_fulfilment_processing_probe_state;
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', state.owner_id::text, true);
  select * into result from public.start_listing_order_fulfilment(
    state.owner_order_id, extensions.gen_random_uuid()
  );
  if result.outcome <> 'not_found' or result.order_id is not null
    or result.fulfilment_id is not null or result.retryable then
    raise exception 'active-business placed order did not fail closed';
  end if;
end;
$$;

-- Confirm three exact orders with the preceding protected boundary. This is
-- precondition setup, not fulfilment behavior.
set local role authenticated;
do $$
declare state order_fulfilment_processing_probe_state%rowtype; result record;
begin
  select * into state from order_fulfilment_processing_probe_state;
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', state.owner_id::text, true);
  select * into result from public.respond_to_listing_order(state.owner_order_id, 'confirm', extensions.gen_random_uuid());
  if result.outcome <> 'transitioned' or result.status <> 'confirmed' then raise exception 'owner confirmation setup failed'; end if;
  perform set_config('request.jwt.claim.sub', state.manager_id::text, true);
  select * into result from public.respond_to_listing_order(state.manager_order_id, 'confirm', extensions.gen_random_uuid());
  if result.outcome <> 'transitioned' or result.status <> 'confirmed' then raise exception 'manager confirmation setup failed'; end if;
  perform set_config('request.jwt.claim.sub', state.staff_id::text, true);
  select * into result from public.respond_to_listing_order(state.staff_order_id, 'confirm', extensions.gen_random_uuid());
  if result.outcome <> 'transitioned' or result.status <> 'confirmed' then raise exception 'staff confirmation setup failed'; end if;
end;
$$;

-- Customer, foreign, pending, suspended, and inactive-business actors fail
-- closed without receiving an order or fulfilment projection.
do $$
declare state order_fulfilment_processing_probe_state%rowtype; result record; denied record;
begin
  select * into state from order_fulfilment_processing_probe_state;
  for denied in select * from (values
    (state.customer_id, state.owner_order_id), (state.foreign_id, state.owner_order_id),
    (state.pending_id, state.owner_order_id), (state.suspended_id, state.owner_order_id),
    (state.owner_id, state.inactive_order_id)
  ) as actors(profile_id, order_id) loop
    perform set_config('request.jwt.claim.sub', denied.profile_id::text, true);
    select * into result from public.start_listing_order_fulfilment(denied.order_id, extensions.gen_random_uuid());
    if result.outcome <> 'not_found' or result.order_id is not null
      or result.fulfilment_id is not null or result.retryable then
      raise exception 'unauthorized fulfilment start leaked state';
    end if;
  end loop;
end;
$$;

-- Owner, manager, and staff each start one processing aggregate. Same-key
-- retry replays; different key/actor sees the durable already_started result.
do $$
declare state order_fulfilment_processing_probe_state%rowtype; result record; replay record;
begin
  select * into state from order_fulfilment_processing_probe_state;
  perform set_config('request.jwt.claim.sub', state.owner_id::text, true);
  select * into result from public.start_listing_order_fulfilment(state.owner_order_id, state.owner_key);
  if result.outcome <> 'started' or result.order_status <> 'confirmed'
    or result.fulfilment_status <> 'processing' or result.fulfilment_id is null
    or result.fulfilment_started_at is null
    or result.fulfilment_updated_at <> result.fulfilment_started_at then
    raise exception 'owner processing start failed';
  end if;
  update order_fulfilment_processing_probe_state set owner_fulfilment_id = result.fulfilment_id;
  select * into replay from public.start_listing_order_fulfilment(state.owner_order_id, state.owner_key);
  if replay.outcome <> 'replayed' or replay.fulfilment_id <> result.fulfilment_id
    or replay.fulfilment_started_at <> result.fulfilment_started_at
    or replay.fulfilment_updated_at <> result.fulfilment_updated_at then
    raise exception 'same-key processing replay failed';
  end if;
  select * into replay from public.start_listing_order_fulfilment(state.owner_order_id, extensions.gen_random_uuid());
  if replay.outcome <> 'already_started' or replay.fulfilment_id <> result.fulfilment_id then
    raise exception 'different-key processing start did not report already_started';
  end if;
  perform set_config('request.jwt.claim.sub', state.manager_id::text, true);
  select * into replay from public.start_listing_order_fulfilment(
    state.owner_order_id, extensions.gen_random_uuid()
  );
  if replay.outcome <> 'already_started' or replay.fulfilment_id <> result.fulfilment_id then
    raise exception 'different-employee processing start did not report already_started';
  end if;
  select * into replay from public.start_listing_order_fulfilment(state.manager_order_id, state.manager_key);
  if replay.outcome <> 'started' then raise exception 'manager processing start failed'; end if;
  perform set_config('request.jwt.claim.sub', state.staff_id::text, true);
  select * into replay from public.start_listing_order_fulfilment(state.staff_order_id, state.staff_key);
  if replay.outcome <> 'started' then raise exception 'staff processing start failed'; end if;
end;
$$;

-- Current authority is rechecked on replay after an accepted membership is
-- revoked; the durable processing state remains but is not disclosed.
set local role postgres;
delete from public.business_memberships
where business_id = (select business_id from order_fulfilment_processing_probe_state)
  and profile_id = (select staff_id from order_fulfilment_processing_probe_state);
set local role authenticated;
do $$
declare state order_fulfilment_processing_probe_state%rowtype; result record;
begin
  select * into state from order_fulfilment_processing_probe_state;
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', state.staff_id::text, true);
  select * into result from public.start_listing_order_fulfilment(
    state.staff_order_id, state.staff_key
  );
  if result.outcome <> 'not_found' or result.order_id is not null
    or result.fulfilment_id is not null or result.retryable then
    raise exception 'revoked membership replay disclosed processing state';
  end if;
end;
$$;

-- An actor key cannot be rebound to another order after the first durable start.
do $$
declare state order_fulfilment_processing_probe_state%rowtype; result record;
begin
  select * into state from order_fulfilment_processing_probe_state;
  perform set_config('request.jwt.claim.sub', state.owner_id::text, true);
  select * into result from public.start_listing_order_fulfilment(state.manager_order_id, state.owner_key);
  if result.outcome <> 'idempotency_key_reused' or result.order_id is not null
    or result.fulfilment_id is not null then
    raise exception 'processing idempotency key reuse was not rejected';
  end if;
end;
$$;

-- Exact durable provenance, no order mutation, and no excluded workflow write.
set local role postgres;
do $$
declare state order_fulfilment_processing_probe_state%rowtype; processing_at timestamptz; decision_at timestamptz; order_updated_at timestamptz;
begin
  select * into state from order_fulfilment_processing_probe_state;
  select f.started_at into processing_at from public.order_fulfilments f where f.id = state.owner_fulfilment_id;
  select o.vendor_decided_at, o.updated_at into decision_at, order_updated_at from public.orders o where o.id = state.owner_order_id;
  if processing_at is null or decision_at is null or order_updated_at <> decision_at
    or (select count(*) from public.order_status_events where order_id = state.owner_order_id) <> 2
    or (select count(*) from public.order_fulfilments where order_id = state.owner_order_id) <> 1
    or (select count(*) from public.fulfilment_events where order_id = state.owner_order_id) <> 1
    or not exists (select 1 from public.fulfilment_events e
      where e.order_id = state.owner_order_id and e.fulfilment_id = state.owner_fulfilment_id
        and e.event_type = 'processing_started' and e.status = 'processing'
        and e.actor_id = state.owner_id and e.payload = '{}'::jsonb and e.occurred_at = processing_at)
    or not exists (select 1 from public.audit_events a
      where a.subject_type = 'order' and a.subject_id = state.owner_order_id
        and a.action = 'order.fulfilment_processing_started' and a.actor_id = state.owner_id
        and a.created_at = processing_at and a.metadata = jsonb_build_object(
          'business_id', state.business_id, 'fulfilment_id', state.owner_fulfilment_id,
          'to_status', 'processing')) then
    raise exception 'processing durable provenance is inconsistent';
  end if;
  if (select count(*) from public.payments) <> state.baseline_payments
    or (select count(*) from public.payment_events) <> state.baseline_payment_events
    or (select count(*) from public.notifications) <> state.baseline_notifications
    or (select count(*) from public.inventory_levels) <> state.baseline_inventory
    or (select count(*) from public.ledger_journals) <> state.baseline_ledger_journals
    or (select count(*) from public.ledger_entries) <> state.baseline_ledger_entries then
    raise exception 'processing wrote an excluded workflow table';
  end if;
end;
$$;

-- Customer and exact vendor see the same bounded aggregate/event; suspended
-- and foreign actors see neither. Buyer identity and event payload/actor are
-- absent from authenticated column grants.
set local role authenticated;
do $$
declare
  state order_fulfilment_processing_probe_state%rowtype;
  customer_row record;
  vendor_row record;
begin
  select * into state from order_fulfilment_processing_probe_state;
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', state.customer_id::text, true);
  select * into customer_row
  from public.get_customer_order(state.market_slug, state.owner_order_number);
  if (select count(*) from public.order_fulfilments where order_id = state.owner_order_id) <> 1
    or (select count(*) from public.fulfilment_events where order_id = state.owner_order_id) <> 1
    or customer_row.order_id is distinct from state.owner_order_id
    or customer_row.fulfilment_id is distinct from state.owner_fulfilment_id
    or customer_row.fulfilment_status is distinct from 'processing'
    or customer_row.fulfilment_started_at is null
    or customer_row.fulfilment_updated_at is distinct from customer_row.fulfilment_started_at then
    raise exception 'customer processing read failed'; end if;
  perform set_config('request.jwt.claim.sub', state.manager_id::text, true);
  select * into vendor_row from public.get_vendor_order(state.owner_order_number);
  if (select count(*) from public.order_fulfilments where order_id = state.owner_order_id) <> 1
    or (select count(*) from public.fulfilment_events where order_id = state.owner_order_id) <> 1
    or vendor_row.order_id is distinct from state.owner_order_id
    or vendor_row.fulfilment_id is distinct from state.owner_fulfilment_id
    or vendor_row.fulfilment_status is distinct from 'processing'
    or vendor_row.fulfilment_started_at is null
    or vendor_row.fulfilment_updated_at is distinct from vendor_row.fulfilment_started_at
    or customer_row.fulfilment_id is distinct from vendor_row.fulfilment_id
    or customer_row.fulfilment_status is distinct from vendor_row.fulfilment_status
    or customer_row.fulfilment_started_at is distinct from vendor_row.fulfilment_started_at
    or customer_row.fulfilment_updated_at is distinct from vendor_row.fulfilment_updated_at
    or to_jsonb(vendor_row) ? 'buyer_id'
    or to_jsonb(vendor_row) ? 'buyer_email' then
    raise exception 'vendor processing read failed'; end if;
  perform set_config('request.jwt.claim.sub', state.suspended_id::text, true);
  if exists (select 1 from public.order_fulfilments where order_id = state.owner_order_id)
    or exists (select 1 from public.fulfilment_events where order_id = state.owner_order_id)
    or exists (select 1 from public.get_vendor_order(state.owner_order_number)) then
    raise exception 'suspended vendor saw processing state'; end if;
  perform set_config('request.jwt.claim.sub', state.foreign_id::text, true);
  if exists (select 1 from public.order_fulfilments where order_id = state.owner_order_id)
    or exists (select 1 from public.fulfilment_events where order_id = state.owner_order_id)
    or exists (select 1 from public.get_vendor_order(state.owner_order_number)) then
    raise exception 'foreign vendor saw processing state'; end if;
end;
$$;

-- Placement replay remains a bounded customer capability result with an exact
-- complete processing quartet after the vendor starts handling the order.
do $$
declare state order_fulfilment_processing_probe_state%rowtype; result record;
begin
  select * into state from order_fulfilment_processing_probe_state;
  perform set_config('request.jwt.claim.sub', state.customer_id::text, true);
  select * into result from public.create_listing_order_from_intent(state.owner_intent_id);
  if result.outcome <> 'replayed' or result.status <> 'confirmed'
    or result.fulfilment_id <> state.owner_fulfilment_id
    or result.fulfilment_status <> 'processing'
    or result.fulfilment_started_at is null
    or result.fulfilment_updated_at <> result.fulfilment_started_at then
    raise exception 'processing placement replay projection failed';
  end if;
end;
$$;

-- Direct DML is unavailable to app/service roles and remains rejected even in
-- a PostgreSQL probe without the capability-bound transaction context.
set local role postgres;
do $$
declare state order_fulfilment_processing_probe_state%rowtype;
begin
  select * into state from order_fulfilment_processing_probe_state;
  if has_table_privilege('authenticated', 'public.order_fulfilments', 'INSERT')
    or has_table_privilege('service_role', 'public.order_fulfilments', 'UPDATE')
    or has_table_privilege('authenticated', 'public.fulfilment_events', 'INSERT')
    or has_table_privilege('service_role', 'public.fulfilment_events', 'DELETE')
    or has_column_privilege('authenticated', 'public.fulfilment_events', 'actor_id', 'SELECT')
    or has_column_privilege('authenticated', 'public.fulfilment_events', 'payload', 'SELECT')
    or has_table_privilege('authenticated', 'private.listing_order_fulfilment_processing', 'SELECT')
    or has_table_privilege('service_role', 'public.audit_events', 'INSERT')
    or has_table_privilege('service_role', 'public.audit_events', 'UPDATE')
    or has_table_privilege('service_role', 'public.audit_events', 'DELETE')
    or has_function_privilege('authenticated', 'private.start_listing_order_fulfilment(uuid, uuid)', 'EXECUTE')
    or has_function_privilege('anon', 'public.start_listing_order_fulfilment(uuid, uuid)', 'EXECUTE')
    or has_function_privilege('service_role', 'public.start_listing_order_fulfilment(uuid, uuid)', 'EXECUTE') then
    raise exception 'fulfilment privilege boundary is too broad';
  end if;
  begin
    insert into public.order_fulfilments(order_id, status, started_at, created_at, updated_at)
    values (state.owner_order_id, 'processing', now(), now(), now());
    raise exception 'direct aggregate insert unexpectedly succeeded';
  exception when others then
    if sqlerrm <> 'invalid listing order fulfilment processing insert' then raise; end if;
  end;
  begin
    update public.order_fulfilments set status = 'processing'
    where order_id = state.owner_order_id;
    raise exception 'direct aggregate update unexpectedly succeeded';
  exception when others then
    if sqlerrm <> 'listing order fulfilment history is immutable' then raise; end if;
  end;
  begin
    delete from public.order_fulfilments where order_id = state.owner_order_id;
    raise exception 'direct aggregate delete unexpectedly succeeded';
  exception when others then
    if sqlerrm <> 'listing order fulfilment history is immutable' then raise; end if;
  end;
  begin
    insert into public.fulfilment_events(
      order_id, fulfilment_id, event_type, status, actor_id, payload, occurred_at
    ) values (
      state.owner_order_id, state.owner_fulfilment_id, 'processing_started',
      'processing', state.owner_id, '{}'::jsonb, now()
    );
    raise exception 'direct event insert unexpectedly succeeded';
  exception when others then
    if sqlerrm <> 'invalid listing order fulfilment processing event' then raise; end if;
  end;
  begin
    update public.fulfilment_events set event_type = 'processing_started'
    where order_id = state.owner_order_id;
    raise exception 'direct event update unexpectedly succeeded';
  exception when others then
    if sqlerrm <> 'listing order fulfilment history is immutable' then raise; end if;
  end;
  begin
    delete from public.fulfilment_events where order_id = state.owner_order_id;
    raise exception 'direct event delete unexpectedly succeeded';
  exception when others then
    if sqlerrm <> 'listing order fulfilment history is immutable' then raise; end if;
  end;
  begin
    update public.audit_events set metadata = metadata
    where subject_type = 'order' and subject_id = state.owner_order_id
      and action = 'order.fulfilment_processing_started';
    raise exception 'direct processing audit update unexpectedly succeeded';
  exception when others then
    if sqlerrm <> 'listing order fulfilment audit evidence is immutable' then raise; end if;
  end;
  begin
    delete from public.audit_events
    where subject_type = 'order' and subject_id = state.owner_order_id
      and action = 'order.fulfilment_processing_started';
    raise exception 'direct processing audit delete unexpectedly succeeded';
  exception when others then
    if sqlerrm <> 'listing order fulfilment audit evidence is immutable' then raise; end if;
  end;
end;
$$;

-- Forging the transaction GUCs does not grant service_role an aggregate/event
-- mutation route. Only the authenticated public RPC has the necessary write
-- authority, and its core rechecks current actor authorization.
set local role service_role;
do $$
declare state order_fulfilment_processing_probe_state%rowtype;
begin
  select * into state from order_fulfilment_processing_probe_state;
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', state.owner_id::text, true);
  perform set_config('localhub.listing_order_fulfilment_processing', '1', true);
  perform set_config('localhub.listing_order_fulfilment_order_id', state.owner_order_id::text, true);
  perform set_config('localhub.listing_order_fulfilment_id', extensions.gen_random_uuid()::text, true);
  perform set_config('localhub.listing_order_fulfilment_actor', state.owner_id::text, true);
  perform set_config('localhub.listing_order_fulfilment_at', clock_timestamp()::text, true);
  begin
    insert into public.order_fulfilments(order_id, status, started_at, created_at, updated_at)
    values (state.manager_order_id, 'processing', clock_timestamp(), clock_timestamp(), clock_timestamp());
    raise exception 'GUC-forged service aggregate insert unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.audit_events(
      actor_id, subject_type, subject_id, action, metadata, created_at
    ) values (
      state.owner_id, 'order', state.owner_order_id,
      'order.fulfilment_processing_started', '{}'::jsonb, clock_timestamp()
    );
    raise exception 'GUC-forged service processing audit insert unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
end;
$$;

-- Actor-first limiter permits 120 attempts before order lookup, then fails
-- closed. This separate actor never receives a usable processing projection.
set local role authenticated;
do $$
declare state order_fulfilment_processing_probe_state%rowtype; result record; attempt integer;
begin
  select * into state from order_fulfilment_processing_probe_state;
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', state.rate_id::text, true);
  for attempt in 1..120 loop
    select * into result from public.start_listing_order_fulfilment(extensions.gen_random_uuid(), extensions.gen_random_uuid());
    if result.outcome <> 'not_found' or result.retryable then
      raise exception 'processing rate limit activated before 120 loop boundary';
    end if;
  end loop;
  select * into result from public.start_listing_order_fulfilment(extensions.gen_random_uuid(), extensions.gen_random_uuid());
  if result.outcome <> 'rate_limited' or not result.retryable or result.order_id is not null then
    raise exception '120/hour processing limiter did not fail closed';
  end if;
end;
$$;

-- Ledger/rate cleanup is bounded and cannot erase durable aggregate/event/audit
-- evidence. Repeating after ledger expiry returns already_started, not a write.
set local role postgres;
update private.listing_order_fulfilment_processing set created_at = timestamptz '1900-01-01 00:00:00+00'
where actor_id = (select owner_id from order_fulfilment_processing_probe_state);
update private.listing_order_fulfilment_processing_rate_limits set updated_at = timestamptz '1900-01-01 00:00:00+00'
where actor_id = (select owner_id from order_fulfilment_processing_probe_state);
set local role service_role;
do $$
declare result record; invalid_batch integer;
begin
  perform set_config('request.jwt.claim.role', 'service_role', true);
  for invalid_batch in select batch_size from (values
    (null::integer), (0), (2001)
  ) as batches(batch_size) loop
    begin
      perform * from public.prune_listing_order_fulfilment_processing(invalid_batch);
      raise exception 'invalid cleanup batch unexpectedly succeeded';
    exception when others then
      if sqlerrm <> 'invalid listing order fulfilment processing prune batch size' then
        raise;
      end if;
    end;
  end loop;
  select * into result from public.prune_listing_order_fulfilment_processing(2000);
  if result.processing_rows_pruned < 1 or result.rate_limits_pruned < 1 then
    raise exception 'bounded fulfilment processing cleanup failed';
  end if;
end;
$$;
set local role authenticated;
do $$
declare state order_fulfilment_processing_probe_state%rowtype; result record;
begin
  select * into state from order_fulfilment_processing_probe_state;
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', state.owner_id::text, true);
  select * into result from public.start_listing_order_fulfilment(state.owner_order_id, state.owner_key);
  if result.outcome <> 'already_started' or result.fulfilment_id <> state.owner_fulfilment_id then
    raise exception 'post-prune processing durability failed';
  end if;
end;
$$;

set local role postgres;
do $$
declare state order_fulfilment_processing_probe_state%rowtype;
begin
  select * into state from order_fulfilment_processing_probe_state;
  if exists (select 1 from private.listing_order_fulfilment_processing where actor_id = state.owner_id)
    or (select count(*) from private.listing_order_fulfilment_processing_rate_limits
        where actor_id = state.owner_id) > 1
    or (select count(*) from public.orders) <> state.baseline_orders + 4
    or (select count(*) from public.order_items) <> state.baseline_items + 4
    or (select count(*) from public.order_status_events) <> state.baseline_order_events + 7
    or (select count(*) from public.order_fulfilments) <> state.baseline_fulfilment_aggregates + 3
    or (select count(*) from public.fulfilment_events) <> state.baseline_fulfilment_events + 3
    or (select count(*) from public.audit_events) <> state.baseline_audits + 10
    or (select count(*) from public.payments) <> state.baseline_payments
    or (select count(*) from public.payment_events) <> state.baseline_payment_events
    or (select count(*) from public.notifications) <> state.baseline_notifications
    or (select count(*) from public.inventory_levels) <> state.baseline_inventory
    or (select count(*) from public.ledger_journals) <> state.baseline_ledger_journals
    or (select count(*) from public.ledger_entries) <> state.baseline_ledger_entries then
    raise exception 'fulfilment processing probe changed unexpected rows';
  end if;
end;
$$;

rollback;

-- Rollback-only hosted regression probe for migration 036. It exercises the
-- approved public boundaries, fixed fan-out, replay, atomicity, RLS, orphaning,
-- and dormant delivery. Opaque secrets remain transaction-local.
begin;

set local lock_timeout = '10s';
set local statement_timeout = '180s';
set local transaction_timeout = '240s';

lock table public.profiles, public.markets, public.businesses,
  public.business_memberships, public.listings, public.guest_intents,
  public.requests, public.orders, public.order_fulfilments,
  public.notifications, private.notification_deliveries
  in share row exclusive mode;

create temporary table notification_producer_probe_state (
  fixture_key text not null,
  request_customer_id uuid not null,
  order_customer_id uuid not null,
  owner_id uuid not null,
  manager_id uuid not null,
  invited_id uuid not null,
  suspended_id uuid not null,
  foreign_id uuid not null,
  market_id uuid not null,
  market_slug text not null,
  category_id uuid not null,
  listing_type_id uuid not null,
  listing_schema_id uuid not null,
  business_id uuid not null,
  foreign_business_id uuid not null,
  listing_id uuid not null,
  request_accept_intent_id uuid,
  request_accept_secret text,
  request_decline_intent_id uuid,
  request_decline_secret text,
  request_atomic_intent_id uuid,
  request_atomic_secret text,
  request_accept_id uuid,
  request_decline_id uuid,
  request_suspended_id uuid,
  orphan_notification_id uuid,
  request_accept_key uuid not null,
  request_decline_key uuid not null,
  request_suspended_key uuid not null,
  order_confirm_intent_id uuid,
  order_confirm_secret text,
  order_cancel_intent_id uuid,
  order_cancel_secret text,
  order_confirm_id uuid,
  order_confirm_number text,
  order_cancel_id uuid,
  order_cancel_number text,
  order_suspended_intent_id uuid,
  order_suspended_secret text,
  order_suspended_id uuid,
  order_suspended_number text,
  order_confirm_key uuid not null,
  order_cancel_key uuid not null,
  order_suspended_key uuid not null,
  fulfilment_key uuid not null,
  fulfilment_id uuid,
  suspended_fulfilment_key uuid not null,
  suspended_fulfilment_id uuid
) on commit drop;
grant all on table notification_producer_probe_state
  to authenticated, service_role;

do $$
declare
  fixture_key text := replace(extensions.gen_random_uuid()::text, '-', '');
  request_customer_id uuid := extensions.gen_random_uuid();
  order_customer_id uuid := extensions.gen_random_uuid();
  owner_id uuid := extensions.gen_random_uuid();
  manager_id uuid := extensions.gen_random_uuid();
  invited_id uuid := extensions.gen_random_uuid();
  suspended_id uuid := extensions.gen_random_uuid();
  foreign_id uuid := extensions.gen_random_uuid();
  market_id uuid := extensions.gen_random_uuid();
  category_id uuid := extensions.gen_random_uuid();
  listing_type_id uuid := extensions.gen_random_uuid();
  listing_schema_id uuid := extensions.gen_random_uuid();
  business_id uuid := extensions.gen_random_uuid();
  foreign_business_id uuid := extensions.gen_random_uuid();
  listing_id uuid := extensions.gen_random_uuid();
  market_slug text := 'notification-probe-' || fixture_key;
  ale_schema jsonb := jsonb_build_object(
    'contractVersion', '1.1', 'schemaVersion', 1,
    'schemaKey', 'notification_probe_v1', 'listingKind', 'product',
    'terminology', jsonb_build_object(
      'singular', 'product', 'plural', 'products',
      'createAction', 'Add product'
    ),
    'bindings', jsonb_build_object('title', 'title'),
    'fields', jsonb_build_array(jsonb_build_object(
      'key', 'title', 'label', 'Product name', 'required', true,
      'type', 'short_text', 'minLength', 2, 'maxLength', 120
    ))
  );
begin
  insert into notification_producer_probe_state(
    fixture_key, request_customer_id, order_customer_id, owner_id, manager_id,
    invited_id, suspended_id, foreign_id, market_id, market_slug, category_id,
    listing_type_id, listing_schema_id, business_id, foreign_business_id,
    listing_id, request_accept_key, request_decline_key, request_suspended_key,
    order_confirm_key, order_cancel_key, order_suspended_key, fulfilment_key,
    suspended_fulfilment_key
  ) values (
    fixture_key, request_customer_id, order_customer_id, owner_id, manager_id,
    invited_id, suspended_id, foreign_id, market_id, market_slug, category_id,
    listing_type_id, listing_schema_id, business_id, foreign_business_id,
    listing_id, extensions.gen_random_uuid(), extensions.gen_random_uuid(),
    extensions.gen_random_uuid(), extensions.gen_random_uuid(),
    extensions.gen_random_uuid(), extensions.gen_random_uuid(),
    extensions.gen_random_uuid(), extensions.gen_random_uuid()
  );

  insert into auth.users(
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) select
    user_id, '00000000-0000-0000-0000-000000000000', 'authenticated',
    'authenticated',
    'notification-producer-' || label || '-' || fixture_key || '@example.test',
    '', now(), '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb, now(), now()
  from (values
    (request_customer_id, 'request-customer'),
    (order_customer_id, 'order-customer'),
    (owner_id, 'owner'), (manager_id, 'manager'),
    (invited_id, 'invited'), (suspended_id, 'suspended'),
    (foreign_id, 'foreign')
  ) as users(user_id, label);
  insert into public.profile_capabilities(profile_id, capability)
  values (owner_id, 'super_admin');
  perform set_config('request.jwt.claim.sub', owner_id::text, true);
  update public.profiles set is_suspended = true where id = suspended_id;
  perform set_config('request.jwt.claim.sub', '', true);
  delete from public.profile_capabilities
  where profile_id = owner_id and capability = 'super_admin';

  insert into public.markets(id, slug, name, currency_code)
  values (market_id, market_slug, 'Notification producer probe', 'NGN');
  insert into public.categories(id, market_id, slug, name)
  values (category_id, market_id, 'notification-products-' || fixture_key,
    'Notification products');
  insert into public.listing_types(id, code, name)
  values (listing_type_id, 'product', 'Notification product');
  insert into public.listing_schemas(
    id, listing_type_id, version, status, schema, published_at
  ) values (listing_schema_id, listing_type_id, 1, 'published', ale_schema, now());
  insert into public.category_listing_type_mappings(
    category_id, listing_type_id, listing_schema_id, is_default
  ) values (category_id, listing_type_id, listing_schema_id, true);
  insert into public.businesses(id, market_id, name, slug, status) values
    (business_id, market_id, 'Notification Probe Vendor',
      'notification-vendor-' || fixture_key, 'active'),
    (foreign_business_id, market_id, 'Foreign Notification Vendor',
      'foreign-notification-vendor-' || fixture_key, 'active');
  insert into public.business_memberships(
    business_id, profile_id, role, accepted_at
  ) values
    (business_id, owner_id, 'owner', now()),
    (business_id, manager_id, 'manager', now()),
    (business_id, invited_id, 'staff', null),
    (business_id, suspended_id, 'staff', now()),
    (foreign_business_id, foreign_id, 'owner', now());
  insert into public.listings(
    id, business_id, market_id, category_id, listing_type_id,
    listing_schema_id, slug, title, status, price_minor, currency_code,
    published_at, created_by, is_orderable
  ) values (
    listing_id, business_id, market_id, category_id, listing_type_id,
    listing_schema_id, 'notification-item-' || fixture_key,
    'Notification Probe Item', 'active', 12500, 'NGN', now(), owner_id, true
  );
end;
$$;

set local role service_role;
do $$
declare state notification_producer_probe_state%rowtype; created record;
begin
  select * into state from notification_producer_probe_state;
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claim.sub', '', true);

  select * into created from public.create_listing_request_intent(
    state.listing_id, 'enquire', 'Accepted notification probe',
    encode(extensions.digest('request-accept-' || state.fixture_key, 'sha256'), 'hex')
  );
  update notification_producer_probe_state set
    request_accept_intent_id = created.id, request_accept_secret = created.secret;
  select * into created from public.create_listing_request_intent(
    state.listing_id, 'enquire', 'Declined notification probe',
    encode(extensions.digest('request-decline-' || state.fixture_key, 'sha256'), 'hex')
  );
  update notification_producer_probe_state set
    request_decline_intent_id = created.id, request_decline_secret = created.secret;
  select * into created from public.create_listing_request_intent(
    state.listing_id, 'enquire', 'Atomic notification probe',
    encode(extensions.digest('request-atomic-' || state.fixture_key, 'sha256'), 'hex')
  );
  update notification_producer_probe_state set
    request_atomic_intent_id = created.id, request_atomic_secret = created.secret;

  select * into created from public.create_listing_order_intent(
    state.listing_id, 1,
    encode(extensions.digest('order-confirm-' || state.fixture_key, 'sha256'), 'hex')
  );
  update notification_producer_probe_state set
    order_confirm_intent_id = created.id, order_confirm_secret = created.secret;
  select * into created from public.create_listing_order_intent(
    state.listing_id, 2,
    encode(extensions.digest('order-cancel-' || state.fixture_key, 'sha256'), 'hex')
  );
  update notification_producer_probe_state set
    order_cancel_intent_id = created.id, order_cancel_secret = created.secret;
  select * into created from public.create_listing_order_intent(
    state.listing_id, 3,
    encode(extensions.digest('order-suspended-' || state.fixture_key, 'sha256'), 'hex')
  );
  update notification_producer_probe_state set
    order_suspended_intent_id = created.id,
    order_suspended_secret = created.secret;
end;
$$;

set local role authenticated;
do $$
declare state notification_producer_probe_state%rowtype; claimed jsonb;
begin
  select * into state from notification_producer_probe_state;
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', state.request_customer_id::text, true);
  select public.claim_guest_intent(
    state.request_accept_intent_id, state.request_accept_secret
  ) into claimed;
  if claimed->>'outcome' <> 'claimed' then raise exception 'request accept intent claim failed'; end if;
  select public.claim_guest_intent(
    state.request_decline_intent_id, state.request_decline_secret
  ) into claimed;
  if claimed->>'outcome' <> 'claimed' then raise exception 'request decline intent claim failed'; end if;
  select public.claim_guest_intent(
    state.request_atomic_intent_id, state.request_atomic_secret
  ) into claimed;
  if claimed->>'outcome' <> 'claimed' then raise exception 'request atomic intent claim failed'; end if;

  perform set_config('request.jwt.claim.sub', state.order_customer_id::text, true);
  select public.claim_guest_intent(
    state.order_confirm_intent_id, state.order_confirm_secret
  ) into claimed;
  if claimed->>'outcome' <> 'claimed' then raise exception 'order confirm intent claim failed'; end if;
  select public.claim_guest_intent(
    state.order_cancel_intent_id, state.order_cancel_secret
  ) into claimed;
  if claimed->>'outcome' <> 'claimed' then raise exception 'order cancel intent claim failed'; end if;
  select public.claim_guest_intent(
    state.order_suspended_intent_id, state.order_suspended_secret
  ) into claimed;
  if claimed->>'outcome' <> 'claimed' then raise exception 'order suspended intent claim failed'; end if;
end;
$$;

-- Exercise order producers before the request atomicity branch.
set local role authenticated;
do $$
declare state notification_producer_probe_state%rowtype; created record; replayed record;
begin
  select * into state from notification_producer_probe_state;
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', state.order_customer_id::text, true);

  select * into created from public.create_listing_order_from_intent(
    state.order_confirm_intent_id
  );
  if created.outcome <> 'created' or created.order_id is null
    or created.order_number !~ '^LO-[0-9]{6}-[0-9]{10}$'
    or created.quantity <> 1 then
    raise exception 'confirmed order source creation failed';
  end if;
  update notification_producer_probe_state set
    order_confirm_id = created.order_id, order_confirm_number = created.order_number;
  select * into replayed from public.create_listing_order_from_intent(
    state.order_confirm_intent_id
  );
  if replayed.outcome <> 'replayed' or replayed.order_id <> created.order_id then
    raise exception 'notification replay duplicated confirmed order';
  end if;

  select * into created from public.create_listing_order_from_intent(
    state.order_cancel_intent_id
  );
  if created.outcome <> 'created' or created.order_id is null
    or created.quantity <> 2 then raise exception 'cancelled order source creation failed'; end if;
  update notification_producer_probe_state set
    order_cancel_id = created.order_id, order_cancel_number = created.order_number;
  select * into replayed from public.create_listing_order_from_intent(
    state.order_cancel_intent_id
  );
  if replayed.outcome <> 'replayed' or replayed.order_id <> created.order_id then
    raise exception 'notification replay duplicated cancelled order';
  end if;

  select * into created from public.create_listing_order_from_intent(
    state.order_suspended_intent_id
  );
  if created.outcome <> 'created' or created.order_id is null
    or created.quantity <> 3 then raise exception 'suspended order source creation failed'; end if;
  update notification_producer_probe_state set
    order_suspended_id = created.order_id,
    order_suspended_number = created.order_number;
end;
$$;

set local role postgres;
do $$
declare state notification_producer_probe_state%rowtype;
begin
  select * into state from notification_producer_probe_state;
  if (select count(*) from public.notifications notification
      where notification.template_key = 'vendor_order_placed'
        and notification.source_id in (
          state.order_confirm_id, state.order_cancel_id,
          state.order_suspended_id
        )) <> 6 then
    raise exception 'vendor order notification cardinality failed';
  end if;
  if (select count(*) from public.notifications notification
      where notification.template_key = 'vendor_order_placed'
        and notification.profile_id = state.owner_id) <> 3
    or (select count(*) from public.notifications notification
      where notification.template_key = 'vendor_order_placed'
        and notification.profile_id = state.manager_id) <> 3 then
    raise exception 'vendor order deterministic recipient fan-out failed';
  end if;
  if exists (
    select 1
    from (values
      (state.order_confirm_id, state.order_confirm_number),
      (state.order_cancel_id, state.order_cancel_number),
      (state.order_suspended_id, state.order_suspended_number)
    ) source(order_id, order_number)
    where (select count(*) from public.notifications notification
      where notification.source_id = source.order_id
        and notification.template_key = 'vendor_order_placed'
        and notification.action_path =
          '/vendor/orders/' || source.order_number) <> 2
  ) then
    raise exception 'vendor order canonical route cardinality failed';
  end if;
end;
$$;

set local role authenticated;
do $$
declare state notification_producer_probe_state%rowtype; response record; replayed record;
begin
  select * into state from notification_producer_probe_state;
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', state.owner_id::text, true);
  select * into response from public.respond_to_listing_order(
    state.order_confirm_id, 'confirm', state.order_confirm_key
  );
  if response.outcome <> 'transitioned' or response.status <> 'confirmed' then
    raise exception 'confirmed order transition failed';
  end if;
  select * into replayed from public.respond_to_listing_order(
    state.order_confirm_id, 'confirm', state.order_confirm_key
  );
  if replayed.outcome <> 'replayed' then
    raise exception 'notification replay duplicated confirmed response';
  end if;
  select * into response from public.respond_to_listing_order(
    state.order_cancel_id, 'cancel', state.order_cancel_key
  );
  if response.outcome <> 'transitioned' or response.status <> 'cancelled' then
    raise exception 'cancelled order transition failed';
  end if;
  select * into replayed from public.respond_to_listing_order(
    state.order_cancel_id, 'cancel', state.order_cancel_key
  );
  if replayed.outcome <> 'replayed' then
    raise exception 'notification replay duplicated cancelled response';
  end if;
  select * into response from public.start_listing_order_fulfilment(
    state.order_confirm_id, state.fulfilment_key
  );
  if response.outcome <> 'started' or response.fulfilment_id is null then
    raise exception 'processing fulfilment source creation failed';
  end if;
  update notification_producer_probe_state set fulfilment_id = response.fulfilment_id;
  select * into replayed from public.start_listing_order_fulfilment(
    state.order_confirm_id, state.fulfilment_key
  );
  if replayed.outcome <> 'replayed'
    or replayed.fulfilment_id <> response.fulfilment_id then
    raise exception 'notification replay duplicated processing notification';
  end if;
end;
$$;

set local role postgres;
insert into public.profile_capabilities(profile_id, capability)
values ((select owner_id from notification_producer_probe_state), 'super_admin');
select set_config(
  'request.jwt.claim.sub',
  (select owner_id::text from notification_producer_probe_state), true
);
update public.profiles set is_suspended = true
where id = (select order_customer_id from notification_producer_probe_state);
select set_config('request.jwt.claim.sub', '', true);
delete from public.profile_capabilities
where profile_id = (select owner_id from notification_producer_probe_state)
  and capability = 'super_admin';
set local role authenticated;
do $$
declare state notification_producer_probe_state%rowtype; response record;
begin
  select * into state from notification_producer_probe_state;
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', state.owner_id::text, true);
  select * into response from public.respond_to_listing_order(
    state.order_suspended_id, 'confirm', state.order_suspended_key
  );
  if response.outcome <> 'transitioned' or response.status <> 'confirmed' then
    raise exception 'suspended customer order transition was vetoed';
  end if;
  select * into response from public.start_listing_order_fulfilment(
    state.order_suspended_id, state.suspended_fulfilment_key
  );
  if response.outcome <> 'started' or response.fulfilment_id is null then
    raise exception 'suspended customer fulfilment transition was vetoed';
  end if;
  update notification_producer_probe_state
  set suspended_fulfilment_id = response.fulfilment_id;
end;
$$;
set local role postgres;
insert into public.profile_capabilities(profile_id, capability)
values ((select owner_id from notification_producer_probe_state), 'super_admin');
select set_config(
  'request.jwt.claim.sub',
  (select owner_id::text from notification_producer_probe_state), true
);
update public.profiles set is_suspended = false
where id = (select order_customer_id from notification_producer_probe_state);
select set_config('request.jwt.claim.sub', '', true);
delete from public.profile_capabilities
where profile_id = (select owner_id from notification_producer_probe_state)
  and capability = 'super_admin';

do $$
declare state notification_producer_probe_state%rowtype;
begin
  select * into state from notification_producer_probe_state;
  if (select count(*) from public.notifications notification
      where notification.source_id = state.order_confirm_id
        and notification.template_key = 'customer_order_confirmed'
        and notification.action_path = '/' || state.market_slug || '/orders/'
          || state.order_confirm_number) <> 1 then
    raise exception 'confirmed order notification cardinality failed';
  end if;
  if (select count(*) from public.notifications notification
      where notification.source_id = state.order_cancel_id
        and notification.template_key = 'customer_order_cancelled'
        and notification.action_path = '/' || state.market_slug || '/orders/'
          || state.order_cancel_number) <> 1 then
    raise exception 'cancelled order notification cardinality failed';
  end if;
  if (select count(*) from public.notifications notification
      where notification.source_id = state.fulfilment_id
        and notification.template_key = 'customer_order_processing'
        and notification.action_path = '/' || state.market_slug || '/orders/'
          || state.order_confirm_number) <> 1 then
    raise exception 'processing notification cardinality failed';
  end if;
  if exists (select 1 from public.notifications notification
      where notification.source_id in (
        state.order_suspended_id, state.suspended_fulfilment_id
      ) and notification.template_key in (
        'customer_order_confirmed', 'customer_order_processing'
      )) then
    raise exception 'suspended order customer unexpectedly notified';
  end if;
  if (select count(*) from public.notifications notification
      where notification.source_kind in (
        'listing_order', 'listing_order_fulfilment'
      )) <> 9 then
    raise exception 'notification replay duplicated order notifications';
  end if;
end;
$$;

-- Exercise request producer atomicity, fan-out, and response paths.
set local role postgres;
create function private.fail_notification_producer_probe()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if current_setting('localhub.notification_probe_fail', true) = '1' then
    raise exception 'forced notification producer probe failure';
  end if;
  return new;
end;
$$;
create trigger notifications_force_producer_probe_failure
  before insert on public.notifications
  for each row execute function private.fail_notification_producer_probe();

set local role authenticated;
do $$
declare state notification_producer_probe_state%rowtype;
begin
  select * into state from notification_producer_probe_state;
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', state.request_customer_id::text, true);
  perform set_config('localhub.notification_probe_fail', '1', true);
  begin
    perform * from public.create_listing_request_from_intent(
      state.request_atomic_intent_id, 'This source must roll back.'
    );
    raise exception 'forced producer failure unexpectedly succeeded';
  exception when others then
    if sqlerrm <> 'forced notification producer probe failure' then raise; end if;
  end;
  perform set_config('localhub.notification_probe_fail', '', true);
end;
$$;
set local role postgres;
do $$
declare state notification_producer_probe_state%rowtype;
begin
  select * into state from notification_producer_probe_state;
  if exists (select 1 from public.requests request
      where request.guest_intent_id = state.request_atomic_intent_id)
    or exists (select 1 from public.guest_intents intent
      where intent.id = state.request_atomic_intent_id
        and intent.consumed_at is not null) then
    raise exception 'source transaction survived notification failure';
  end if;
end;
$$;
drop trigger notifications_force_producer_probe_failure on public.notifications;
drop function private.fail_notification_producer_probe();

set local role authenticated;
do $$
declare state notification_producer_probe_state%rowtype; created record; replayed record;
begin
  select * into state from notification_producer_probe_state;
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', state.request_customer_id::text, true);

  select * into created from public.create_listing_request_from_intent(
    state.request_accept_intent_id, 'Please confirm availability.'
  );
  if created.outcome <> 'created' or created.request_id is null
    or created.request_number !~ '^LR-[0-9]{6}-[0-9]{10}$'
    or created.status <> 'open' then
    raise exception 'accepted request source creation failed';
  end if;
  update notification_producer_probe_state set request_accept_id = created.request_id;
  select * into replayed from public.create_listing_request_from_intent(
    state.request_accept_intent_id, 'Please confirm availability.'
  );
  if replayed.outcome <> 'replayed' or replayed.request_id <> created.request_id then
    raise exception 'notification replay duplicated accepted request';
  end if;

  select * into created from public.create_listing_request_from_intent(
    state.request_decline_intent_id, 'Please confirm the alternate date.'
  );
  if created.outcome <> 'created' or created.request_id is null then
    raise exception 'declined request source creation failed';
  end if;
  update notification_producer_probe_state set request_decline_id = created.request_id;
  select * into replayed from public.create_listing_request_from_intent(
    state.request_decline_intent_id, 'Please confirm the alternate date.'
  );
  if replayed.outcome <> 'replayed' or replayed.request_id <> created.request_id then
    raise exception 'notification replay duplicated declined request';
  end if;

  select * into created from public.create_listing_request_from_intent(
    state.request_atomic_intent_id, 'Suspended recipient transition.'
  );
  if created.outcome <> 'created' or created.request_id is null then
    raise exception 'suspended-recipient request source creation failed';
  end if;
  update notification_producer_probe_state set request_suspended_id = created.request_id;
end;
$$;

set local role postgres;
do $$
declare state notification_producer_probe_state%rowtype;
begin
  select * into state from notification_producer_probe_state;
  if (select count(*) from public.notifications notification
      where notification.template_key = 'vendor_request_created'
        and notification.source_id in (
          state.request_accept_id, state.request_decline_id,
          state.request_suspended_id
        )) <> 6 then
    raise exception 'vendor request notification cardinality failed';
  end if;
  if (select count(*) from public.notifications notification
      where notification.template_key = 'vendor_request_created'
        and notification.profile_id = state.owner_id) <> 3
    or (select count(*) from public.notifications notification
      where notification.template_key = 'vendor_request_created'
        and notification.profile_id = state.manager_id) <> 3 then
    raise exception 'vendor request deterministic recipient fan-out failed';
  end if;
  if exists (select 1 from public.notifications notification
      where notification.profile_id in (
        state.invited_id, state.suspended_id, state.foreign_id
      )) then
    if exists (select 1 from public.notifications notification
        where notification.profile_id = state.suspended_id) then
      raise exception 'suspended recipient unexpectedly notified';
    elsif exists (select 1 from public.notifications notification
        where notification.profile_id = state.invited_id) then
      raise exception 'invited member unexpectedly notified';
    else
      raise exception 'foreign business member unexpectedly notified';
    end if;
  end if;
end;
$$;

set local role authenticated;
do $$
declare state notification_producer_probe_state%rowtype; response record; replayed record;
begin
  select * into state from notification_producer_probe_state;
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', state.owner_id::text, true);
  select * into response from public.respond_to_listing_request(
    state.request_accept_id, 'accept', state.request_accept_key
  );
  if response.outcome <> 'transitioned' or response.status <> 'accepted' then
    raise exception 'accepted request transition failed';
  end if;
  select * into replayed from public.respond_to_listing_request(
    state.request_accept_id, 'accept', state.request_accept_key
  );
  if replayed.outcome <> 'replayed' then
    raise exception 'notification replay duplicated accepted response';
  end if;
  select * into response from public.respond_to_listing_request(
    state.request_decline_id, 'decline', state.request_decline_key
  );
  if response.outcome <> 'transitioned' or response.status <> 'declined' then
    raise exception 'declined request transition failed';
  end if;
  select * into replayed from public.respond_to_listing_request(
    state.request_decline_id, 'decline', state.request_decline_key
  );
  if replayed.outcome <> 'replayed' then
    raise exception 'notification replay duplicated declined response';
  end if;
end;
$$;

set local role postgres;
insert into public.profile_capabilities(profile_id, capability)
values ((select owner_id from notification_producer_probe_state), 'super_admin');
select set_config(
  'request.jwt.claim.sub',
  (select owner_id::text from notification_producer_probe_state), true
);
update public.profiles set is_suspended = true
where id = (select request_customer_id from notification_producer_probe_state);
select set_config('request.jwt.claim.sub', '', true);
delete from public.profile_capabilities
where profile_id = (select owner_id from notification_producer_probe_state)
  and capability = 'super_admin';
set local role authenticated;
do $$
declare state notification_producer_probe_state%rowtype; response record;
begin
  select * into state from notification_producer_probe_state;
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', state.owner_id::text, true);
  select * into response from public.respond_to_listing_request(
    state.request_suspended_id, 'accept', state.request_suspended_key
  );
  if response.outcome <> 'transitioned' or response.status <> 'accepted' then
    raise exception 'suspended customer request transition was vetoed';
  end if;
end;
$$;
set local role postgres;
insert into public.profile_capabilities(profile_id, capability)
values ((select owner_id from notification_producer_probe_state), 'super_admin');
select set_config(
  'request.jwt.claim.sub',
  (select owner_id::text from notification_producer_probe_state), true
);
update public.profiles set is_suspended = false
where id = (select request_customer_id from notification_producer_probe_state);
select set_config('request.jwt.claim.sub', '', true);
delete from public.profile_capabilities
where profile_id = (select owner_id from notification_producer_probe_state)
  and capability = 'super_admin';

do $$
declare state notification_producer_probe_state%rowtype;
begin
  select * into state from notification_producer_probe_state;
  if (select count(*) from public.notifications notification
      where notification.source_id = state.request_accept_id
        and notification.template_key = 'customer_request_accepted'
        and notification.profile_id = state.request_customer_id) <> 1 then
    raise exception 'accepted request notification cardinality failed';
  end if;
  if (select count(*) from public.notifications notification
      where notification.source_id = state.request_decline_id
        and notification.template_key = 'customer_request_declined'
        and notification.profile_id = state.request_customer_id) <> 1 then
    raise exception 'declined request notification cardinality failed';
  end if;
  if exists (select 1 from public.notifications notification
      where notification.source_id = state.request_suspended_id
        and notification.template_key = 'customer_request_accepted') then
    raise exception 'suspended request customer unexpectedly notified';
  end if;
  if (select count(*) from public.notifications notification
      where notification.source_kind = 'listing_request') <> 8 then
    raise exception 'notification replay duplicated request notifications';
  end if;
end;
$$;

-- Verify authenticated visibility is recipient-scoped and active-profile gated.
set local role authenticated;
do $$
declare
  state notification_producer_probe_state%rowtype;
  visible_count bigint;
begin
  select * into state from notification_producer_probe_state;
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  perform set_config('request.jwt.claim.sub', state.owner_id::text, true);
  select count(*) into visible_count
  from public.list_my_notifications(50, null::timestamptz, null::uuid, false);
  if visible_count <> 6 then
    raise exception 'owner notification visibility cardinality failed';
  end if;

  perform set_config('request.jwt.claim.sub', state.manager_id::text, true);
  select count(*) into visible_count
  from public.list_my_notifications(50, null::timestamptz, null::uuid, false);
  if visible_count <> 6 then
    raise exception 'manager notification visibility cardinality failed';
  end if;

  perform set_config('request.jwt.claim.sub', state.request_customer_id::text, true);
  select count(*) into visible_count
  from public.list_my_notifications(50, null::timestamptz, null::uuid, false);
  if visible_count <> 2 then
    raise exception 'request customer notification visibility cardinality failed';
  end if;

  perform set_config('request.jwt.claim.sub', state.order_customer_id::text, true);
  select count(*) into visible_count
  from public.list_my_notifications(50, null::timestamptz, null::uuid, false);
  if visible_count <> 3 then
    raise exception 'order customer notification visibility cardinality failed';
  end if;

  perform set_config('request.jwt.claim.sub', state.foreign_id::text, true);
  select count(*) into visible_count
  from public.list_my_notifications(50, null::timestamptz, null::uuid, false);
  if visible_count <> 0 then
    raise exception 'foreign profile observed another recipient notification';
  end if;
  select count(notification.id) into visible_count
  from public.notifications notification;
  if visible_count <> 0 then
    raise exception 'notification RLS exposed another recipient row';
  end if;
end;
$$;

set local role postgres;
insert into public.profile_capabilities(profile_id, capability)
values ((select manager_id from notification_producer_probe_state), 'super_admin');
select set_config(
  'request.jwt.claim.sub',
  (select manager_id::text from notification_producer_probe_state), true
);
update public.profiles set is_suspended = true
where id = (select owner_id from notification_producer_probe_state);
select set_config('request.jwt.claim.sub', '', true);
delete from public.profile_capabilities
where profile_id = (select manager_id from notification_producer_probe_state)
  and capability = 'super_admin';

set local role authenticated;
do $$
declare
  state notification_producer_probe_state%rowtype;
  visible_count bigint;
begin
  select * into state from notification_producer_probe_state;
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', state.owner_id::text, true);
  begin
    perform *
    from public.list_my_notifications(50, null::timestamptz, null::uuid, false);
    raise exception 'suspended profile unexpectedly listed notifications';
  exception when insufficient_privilege then
    null;
  end;
  select count(notification.id) into visible_count
  from public.notifications notification;
  if visible_count <> 0 then
    raise exception 'suspended profile observed notifications through RLS';
  end if;
end;
$$;

set local role postgres;
insert into public.profile_capabilities(profile_id, capability)
values ((select manager_id from notification_producer_probe_state), 'super_admin');
select set_config(
  'request.jwt.claim.sub',
  (select manager_id::text from notification_producer_probe_state), true
);
update public.profiles set is_suspended = false
where id = (select owner_id from notification_producer_probe_state);
select set_config('request.jwt.claim.sub', '', true);
delete from public.profile_capabilities
where profile_id = (select manager_id from notification_producer_probe_state)
  and capability = 'super_admin';

-- Authenticated and service roles must not bypass the approved RPC boundaries.
set local role authenticated;
do $$
declare state notification_producer_probe_state%rowtype;
begin
  select * into state from notification_producer_probe_state;
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', state.foreign_id::text, true);
  begin
    insert into public.notifications(
      profile_id, market_id, source_kind, source_id, template_key,
      title, body
    ) values (
      state.foreign_id, state.market_id, 'probe_source',
      extensions.gen_random_uuid(), 'probe_forbidden_insert',
      'Forbidden insert', 'This insert must not cross the inbox boundary.'
    );
    raise exception 'authenticated direct notification insert unexpectedly succeeded';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;

set local role service_role;
do $$
begin
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claim.sub', '', true);
  begin
    insert into public.requests(id) values (extensions.gen_random_uuid());
    raise exception 'service role direct request insert unexpectedly succeeded';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;

-- Profile deletion must preserve immutable, hidden notification evidence.
set local role postgres;
do $$
declare state notification_producer_probe_state%rowtype;
begin
  select * into state from notification_producer_probe_state;
  update notification_producer_probe_state
  set orphan_notification_id = (
    select notification.id
    from public.notifications notification
    where notification.profile_id = state.request_customer_id
      and notification.template_key = 'customer_request_accepted'
  );
  select * into state from notification_producer_probe_state;
  if state.orphan_notification_id is null then
    raise exception 'orphan notification fixture was not found';
  end if;

  begin
    insert into public.notifications(
      profile_id, market_id, source_kind, source_id, template_key,
      title, body
    ) values (
      null, state.market_id, 'probe_source', extensions.gen_random_uuid(),
      'probe_null_recipient', 'Null recipient',
      'New notifications must always have a recipient.'
    );
    raise exception 'null-recipient notification unexpectedly succeeded';
  exception when check_violation then
    null;
  end;

  delete from auth.users where id = state.request_customer_id;

  if exists (select 1 from public.profiles profile
      where profile.id = state.request_customer_id)
    or (select count(*) from public.notifications notification
      where notification.profile_id is null) <> 2
    or (select count(*) from public.notifications notification
      where notification.profile_id is null
        and notification.source_id in (
          state.request_accept_id, state.request_decline_id
        )
        and notification.template_key in (
          'customer_request_accepted', 'customer_request_declined'
        )) <> 2 then
    raise exception 'notification orphan preservation cardinality failed';
  end if;

  begin
    update public.notifications
    set profile_id = state.foreign_id
    where id = state.orphan_notification_id;
    raise exception 'orphan notification reattachment unexpectedly succeeded';
  exception when others then
    if sqlstate <> '55000' or sqlerrm <> 'orphan notifications are immutable' then
      raise;
    end if;
  end;

  begin
    update public.notifications
    set read_at = pg_catalog.statement_timestamp()
    where id = state.orphan_notification_id;
    raise exception 'orphan notification mutation unexpectedly succeeded';
  exception when others then
    if sqlstate <> '55000' or sqlerrm <> 'orphan notifications are immutable' then
      raise;
    end if;
  end;
end;
$$;

set local role authenticated;
do $$
declare
  state notification_producer_probe_state%rowtype;
  marked record;
  visible_count bigint;
begin
  select * into state from notification_producer_probe_state;
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', state.foreign_id::text, true);
  select * into marked
  from public.mark_my_notification_read(state.orphan_notification_id);
  if marked.outcome <> 'not_found' or marked.notification_id is not null
    or marked.read_at is not null then
    raise exception 'foreign profile mutated an orphan notification';
  end if;
  select count(notification.id) into visible_count
  from public.notifications notification;
  if visible_count <> 0 then
    raise exception 'notification RLS exposed an orphan row';
  end if;

  perform set_config('request.jwt.claim.sub', state.request_customer_id::text, true);
  begin
    perform *
    from public.list_my_notifications(50, null::timestamptz, null::uuid, false);
    raise exception 'deleted profile unexpectedly listed notifications';
  exception when insufficient_privilege then
    null;
  end;
  select count(notification.id) into visible_count
  from public.notifications notification;
  if visible_count <> 0 then
    raise exception 'deleted profile observed orphan notifications through RLS';
  end if;
end;
$$;

-- External delivery remains structurally dormant even for postgres.
set local role postgres;
do $$
declare
  state notification_producer_probe_state%rowtype;
  notification_id uuid;
begin
  select * into state from notification_producer_probe_state;
  select notification.id into notification_id
  from public.notifications notification
  where notification.profile_id = state.owner_id
  order by notification.created_at, notification.id
  limit 1;

  if exists (select 1 from private.notification_deliveries) then
    raise exception 'notification delivery state was not dormant before probe';
  end if;
  begin
    insert into private.notification_deliveries(
      notification_id, channel, idempotency_key_sha256
    ) values (
      notification_id, 'email',
      encode(extensions.digest('delivery-' || state.fixture_key, 'sha256'), 'hex')
    );
    raise exception 'dormant notification delivery insert unexpectedly succeeded';
  exception when others then
    if sqlstate <> '55000' or sqlerrm <> 'notification deliveries are dormant' then
      raise;
    end if;
  end;
  if exists (select 1 from private.notification_deliveries) then
    raise exception 'notification deliveries are dormant but retained a row';
  end if;
end;
$$;

-- Any mismatch here would mean the transaction left notification producer fixture residue.
do $$
declare state notification_producer_probe_state%rowtype;
begin
  select * into state from notification_producer_probe_state;
  if (select count(*) from public.requests request
      where request.id in (
        state.request_accept_id, state.request_decline_id,
        state.request_suspended_id
      )) <> 3
    or (select count(*) from public.orders orders
      where orders.id in (
        state.order_confirm_id, state.order_cancel_id,
        state.order_suspended_id
      )) <> 3
    or (select count(*) from public.order_fulfilments fulfilment
      where fulfilment.id in (
        state.fulfilment_id, state.suspended_fulfilment_id
      )) <> 2
    or (select count(*) from public.notifications) <> 17
    or (select count(*) from public.notifications notification
      where notification.profile_id is null) <> 2
    or (select count(*) from public.notifications notification
      where notification.profile_id = state.owner_id) <> 6
    or (select count(*) from public.notifications notification
      where notification.profile_id = state.manager_id) <> 6
    or (select count(*) from public.notifications notification
      where notification.profile_id = state.order_customer_id) <> 3
    or exists (select 1 from public.notifications notification
      where notification.profile_id in (
        state.invited_id, state.suspended_id, state.foreign_id
      ))
    or exists (select 1 from private.notification_deliveries) then
    raise exception 'left notification producer fixture residue';
  end if;
end;
$$;

-- Realtime publication membership is verified by migration postconditions.
-- An actual hosted WebSocket delete event remains a separate identity-backed check.
-- Order-number sequence gaps are expected because nextval is non-transactional;
-- this shared-project probe must never rewind the sequence with setval.
rollback;

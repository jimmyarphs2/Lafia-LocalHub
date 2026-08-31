-- Protected, one-way vendor availability decisions for listing orders.
-- Payment, fulfilment, inventory, notifications, and ledger effects remain
-- deliberately outside this migration.

alter table public.orders
  add column if not exists vendor_decided_at timestamptz;

alter table public.orders
  drop constraint if exists orders_listing_order_snapshot_shape;
alter table public.orders
  add constraint orders_listing_order_snapshot_shape
  check (
    (snapshot_source is null and vendor_decided_at is null)
    or (
      snapshot_source = 'listing_order'
      and status in ('placed', 'confirmed', 'cancelled')
      and placed_at is not null
      and (
        (status = 'placed' and vendor_decided_at is null)
        or (
          status in ('confirmed', 'cancelled')
          and vendor_decided_at is not null
          and vendor_decided_at >= placed_at
        )
      )
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

create table private.listing_order_vendor_transitions (
  actor_id uuid not null references public.profiles(id) on delete restrict,
  idempotency_key uuid not null,
  order_id uuid not null references public.orders(id) on delete restrict,
  decision text not null check (decision in ('confirm', 'cancel')),
  result_status public.order_status not null
    check (result_status in ('confirmed', 'cancelled')),
  transitioned_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (actor_id, idempotency_key),
  unique (order_id),
  check (
    (decision = 'confirm' and result_status = 'confirmed')
    or (decision = 'cancel' and result_status = 'cancelled')
  )
);
create index listing_order_vendor_transitions_prune_idx
  on private.listing_order_vendor_transitions(created_at, order_id);
alter table private.listing_order_vendor_transitions enable row level security;
revoke all on table private.listing_order_vendor_transitions
  from public, anon, authenticated, service_role;

create table private.listing_order_vendor_transition_rate_limits (
  actor_id uuid primary key references public.profiles(id) on delete cascade,
  window_started_at timestamptz not null default now(),
  request_count integer not null default 0
    check (request_count between 0 and 121),
  updated_at timestamptz not null default now()
);
create index listing_order_vendor_transition_rate_limits_prune_idx
  on private.listing_order_vendor_transition_rate_limits(updated_at, actor_id);
alter table private.listing_order_vendor_transition_rate_limits
  enable row level security;
revoke all on table private.listing_order_vendor_transition_rate_limits
  from public, anon, authenticated, service_role;

-- Durable consistency helpers intentionally use the immutable order item,
-- event, and audit histories rather than the prunable idempotency ledger.
create or replace function private.is_consistent_placed_listing_order(
  p_order_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_order_id is not null and exists (
    select 1
    from public.orders o
    join public.order_items i on i.order_id = o.id
    where o.id = p_order_id
      and o.snapshot_source = 'listing_order'
      and o.status = 'placed'
      and o.placed_at is not null
      and o.vendor_decided_at is null
      and o.subtotal_minor = i.total_minor
      and o.total_minor = i.total_minor
      and not exists (
        select 1
        from public.order_items extra
        where extra.order_id = o.id and extra.id <> i.id
      )
      and (
        select count(*)
        from public.order_status_events event
        where event.order_id = o.id
      ) = 1
      and exists (
        select 1
        from public.order_status_events event
        where event.order_id = o.id
          and event.status = 'placed'
          and event.actor_id = o.buyer_id
          and event.note is null
          and event.occurred_at = o.placed_at
      )
      and (
        select count(*)
        from public.audit_events audit
        where audit.subject_type = 'order'
          and audit.subject_id = o.id
          and audit.action = 'order.placed'
      ) = 1
      and exists (
        select 1
        from public.audit_events audit
        where audit.subject_type = 'order'
          and audit.subject_id = o.id
          and audit.action = 'order.placed'
          and audit.actor_id = o.buyer_id
          and audit.created_at = o.placed_at
          and audit.metadata = jsonb_build_object(
            'business_id', o.business_id,
            'listing_id', i.listing_id
          )
      )
      and (
        select count(*)
        from public.audit_events audit
        where audit.subject_type = 'order'
          and audit.subject_id = o.id
          and audit.action in ('order.confirmed', 'order.cancelled')
      ) = 0
  )
$$;
revoke all on function private.is_consistent_placed_listing_order(uuid)
  from public, anon, authenticated, service_role;

create or replace function private.is_consistent_terminal_listing_order(
  p_order_id uuid,
  p_status text,
  p_vendor_decided_at timestamptz,
  p_transition_actor uuid default null
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_order_id is not null
    and p_status is not null
    and p_status in ('confirmed', 'cancelled')
    and p_vendor_decided_at is not null
    and exists (
      select 1
      from public.orders o
      join public.order_items i on i.order_id = o.id
      where o.id = p_order_id
        and o.snapshot_source = 'listing_order'
        and o.status::text = p_status
        and o.placed_at is not null
        and o.vendor_decided_at = p_vendor_decided_at
        and o.vendor_decided_at >= o.placed_at
        and o.subtotal_minor = i.total_minor
        and o.total_minor = i.total_minor
        and not exists (
          select 1
          from public.order_items extra
          where extra.order_id = o.id and extra.id <> i.id
        )
        and (
          select count(*)
          from public.order_status_events event
          where event.order_id = o.id
        ) = 2
        and exists (
          select 1
          from public.order_status_events event
          where event.order_id = o.id
            and event.status = 'placed'
            and event.actor_id = o.buyer_id
            and event.note is null
            and event.occurred_at = o.placed_at
        )
        and exists (
          select 1
          from public.order_status_events event
          where event.order_id = o.id
            and event.status::text = p_status
            and event.note is null
            and event.occurred_at = p_vendor_decided_at
            and (
              p_transition_actor is null
              or event.actor_id = p_transition_actor
            )
        )
        and (
          select count(*)
          from public.audit_events audit
          where audit.subject_type = 'order'
            and audit.subject_id = o.id
            and audit.action = 'order.placed'
        ) = 1
        and exists (
          select 1
          from public.audit_events audit
          where audit.subject_type = 'order'
            and audit.subject_id = o.id
            and audit.action = 'order.placed'
            and audit.actor_id = o.buyer_id
            and audit.created_at = o.placed_at
            and audit.metadata = jsonb_build_object(
              'business_id', o.business_id,
              'listing_id', i.listing_id
            )
        )
        and (
          select count(*)
          from public.audit_events audit
          where audit.subject_type = 'order'
            and audit.subject_id = o.id
            and audit.action in ('order.confirmed', 'order.cancelled')
        ) = 1
        and exists (
          select 1
          from public.audit_events audit
          join public.order_status_events terminal_event
            on terminal_event.order_id = o.id
            and terminal_event.status::text = p_status
            and terminal_event.note is null
            and terminal_event.occurred_at = p_vendor_decided_at
          where audit.subject_type = 'order'
            and audit.subject_id = o.id
            and audit.action = case p_status
              when 'confirmed' then 'order.confirmed'
              else 'order.cancelled'
            end
            and audit.created_at = p_vendor_decided_at
            and audit.metadata = jsonb_build_object(
              'from_status', 'placed',
              'to_status', p_status,
              'business_id', o.business_id
            )
            and terminal_event.actor_id is not distinct from audit.actor_id
            and (
              p_transition_actor is null
              or terminal_event.actor_id = p_transition_actor
            )
        )
    )
$$;
revoke all on function private.is_consistent_terminal_listing_order(
  uuid, text, timestamptz, uuid
) from public, anon, authenticated, service_role;

-- Replace migration 021's immutable guard with one that permits exactly one
-- transaction-gated placed-to-terminal change while preserving every other
-- listing-order field, item, and historical event.
create or replace function public.prevent_listing_order_snapshot_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  protected_order uuid;
  parent_order public.orders%rowtype;
  event_count integer;
  transition_order_id text := nullif(
    current_setting('localhub.listing_order_transition_order_id', true), ''
  );
  transition_status text := nullif(
    current_setting('localhub.listing_order_transition_status', true), ''
  );
  transition_actor text := nullif(
    current_setting('localhub.listing_order_transition_actor', true), ''
  );
  transition_at text := nullif(
    current_setting('localhub.listing_order_transition_at', true), ''
  );
begin
  if tg_table_name = 'orders' then
    if tg_op = 'UPDATE'
      and old.snapshot_source = 'listing_order'
      and old.guest_intent_id is not null
      and new.guest_intent_id is null
      and (
        to_jsonb(new) - array['guest_intent_id', 'updated_at']::text[]
      ) is not distinct from (
        to_jsonb(old) - array['guest_intent_id', 'updated_at']::text[]
      ) then
      return new;
    end if;

    if tg_op = 'UPDATE'
      and old.snapshot_source = 'listing_order'
      and current_setting('localhub.listing_order_transition', true) = '1'
      and transition_order_id = old.id::text
      and transition_actor = (select auth.uid())::text
      and transition_status in ('confirmed', 'cancelled')
      and transition_at is not null
      and old.status = 'placed'
      and old.vendor_decided_at is null
      and new.status::text = transition_status
      and new.vendor_decided_at = transition_at::timestamptz
      and (
        to_jsonb(new) - array[
          'status', 'vendor_decided_at', 'updated_at'
        ]::text[]
      ) is not distinct from (
        to_jsonb(old) - array[
          'status', 'vendor_decided_at', 'updated_at'
        ]::text[]
      ) then
      return new;
    end if;

    if old.snapshot_source = 'listing_order'
      or (
        tg_op = 'UPDATE'
        and new.snapshot_source = 'listing_order'
      ) then
      protected_order := old.id;
    end if;
  elsif tg_table_name = 'order_items' and tg_op = 'INSERT' then
    select o.* into parent_order
    from public.orders o
    where o.id = new.order_id
    for update;
    if parent_order.id is null
      or parent_order.snapshot_source <> 'listing_order' then
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
    if tg_op = 'UPDATE' and exists (
      select 1
      from public.orders o
      where o.snapshot_source = 'listing_order'
        and (o.id = old.order_id or o.id = new.order_id)
    ) then
      protected_order := old.order_id;
    elsif tg_op = 'DELETE' and exists (
      select 1
      from public.orders o
      where o.snapshot_source = 'listing_order'
        and o.id = old.order_id
    ) then
      protected_order := old.order_id;
    end if;
  elsif tg_table_name = 'order_status_events' and tg_op = 'INSERT' then
    select o.* into parent_order
    from public.orders o
    where o.id = new.order_id
    for update;
    if parent_order.id is null
      or parent_order.snapshot_source <> 'listing_order' then
      return new;
    end if;

    select count(*)::integer into event_count
    from public.order_status_events event
    where event.order_id = new.order_id;

    if event_count = 0 then
      if parent_order.status <> 'placed'
        or parent_order.vendor_decided_at is not null
        or new.status <> 'placed'
        or new.actor_id is distinct from parent_order.buyer_id
        or new.note is not null
        or new.occurred_at is distinct from parent_order.placed_at then
        raise exception 'invalid listing order placed event';
      end if;
      return new;
    end if;

    if event_count = 1
      and current_setting('localhub.listing_order_transition', true) = '1'
      and transition_order_id = parent_order.id::text
      and transition_actor = (select auth.uid())::text
      and transition_status in ('confirmed', 'cancelled')
      and transition_at is not null
      and parent_order.status::text = transition_status
      and parent_order.vendor_decided_at = transition_at::timestamptz
      and new.status::text = transition_status
      and new.actor_id::text = transition_actor
      and new.note is null
      and new.occurred_at = transition_at::timestamptz
      and exists (
        select 1
        from public.order_status_events placed_event
        where placed_event.order_id = parent_order.id
          and placed_event.status = 'placed'
          and placed_event.actor_id = parent_order.buyer_id
          and placed_event.note is null
          and placed_event.occurred_at = parent_order.placed_at
      ) then
      return new;
    end if;

    raise exception 'listing order snapshots are immutable';
  elsif tg_table_name = 'order_status_events' then
    -- Preserve the foundation's ON DELETE SET NULL actor retention behavior.
    -- Application and service roles still have no direct UPDATE grant.
    if tg_op = 'UPDATE'
      and old.actor_id is not null
      and new.actor_id is null
      and (
        to_jsonb(new) - 'actor_id'
      ) is not distinct from (
        to_jsonb(old) - 'actor_id'
      ) then
      return new;
    end if;
    if tg_op = 'UPDATE' and exists (
      select 1
      from public.orders o
      where o.snapshot_source = 'listing_order'
        and (o.id = old.order_id or o.id = new.order_id)
    ) then
      protected_order := old.order_id;
    elsif tg_op = 'DELETE' and exists (
      select 1
      from public.orders o
      where o.snapshot_source = 'listing_order'
        and o.id = old.order_id
    ) then
      protected_order := old.order_id;
    end if;
  else
    raise exception 'unsupported order snapshot trigger target';
  end if;

  if protected_order is not null then
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

-- The foundation's generic updater uses transaction-start time. A vendor
-- decision must be causally later than placement even when the caller's
-- transaction began before placement committed, so the orders trigger copies
-- the gated wall-clock transition instant for this one path.
create or replace function private.set_order_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  transition_order_id text := nullif(
    current_setting('localhub.listing_order_transition_order_id', true), ''
  );
  transition_at text := nullif(
    current_setting('localhub.listing_order_transition_at', true), ''
  );
begin
  if old.snapshot_source = 'listing_order'
    and old.guest_intent_id is not null
    and new.guest_intent_id is null then
    -- Retiring an expired/consumed capability is retention housekeeping, not
    -- a commerce mutation. Preserve the order's last authoritative timestamp.
    new.updated_at := old.updated_at;
  elsif old.snapshot_source = 'listing_order'
    and current_setting('localhub.listing_order_transition', true) = '1'
    and transition_order_id = old.id::text
    and transition_at is not null then
    new.updated_at := transition_at::timestamptz;
  else
    new.updated_at := now();
  end if;
  return new;
end;
$$;
revoke all on function private.set_order_updated_at()
  from public, anon, authenticated, service_role;

drop trigger if exists orders_set_updated_at on public.orders;
create trigger orders_set_updated_at
  before update on public.orders
  for each row execute function private.set_order_updated_at();

create or replace function private.consume_listing_order_vendor_transition_rate_limit()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  current_count integer;
begin
  if actor is null or (select auth.role()) is distinct from 'authenticated' then
    return false;
  end if;

  insert into private.listing_order_vendor_transition_rate_limits as limits(
    actor_id, window_started_at, request_count, updated_at
  ) values (
    actor, now(), 1, now()
  )
  on conflict(actor_id) do update set
    window_started_at = case
      when limits.window_started_at <= now() - interval '1 hour' then now()
      else limits.window_started_at
    end,
    request_count = case
      when limits.window_started_at <= now() - interval '1 hour' then 1
      else least(limits.request_count + 1, 121)
    end,
    updated_at = now()
  returning request_count into current_count;

  return current_count <= 120;
end;
$$;
revoke all on function private.consume_listing_order_vendor_transition_rate_limit()
  from public, anon, authenticated, service_role;

create or replace function private.respond_to_listing_order(
  p_order_id uuid,
  p_decision text,
  p_idempotency_key uuid
)
returns table(
  order_id uuid,
  outcome text,
  status text,
  vendor_decided_at timestamptz,
  updated_at timestamptz,
  retryable boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  active_actor uuid;
  order_row public.orders%rowtype;
  existing_transition private.listing_order_vendor_transitions%rowtype;
  active_business uuid;
  active_membership uuid;
  target_status text;
  transition_time timestamptz;
  transition_updated_at timestamptz;
begin
  if actor is null
    or (select auth.role()) is distinct from 'authenticated'
    or p_order_id is null
    or p_decision is null
    or p_decision not in ('confirm', 'cancel')
    or p_idempotency_key is null
    or p_idempotency_key::text
      !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    return query select null::uuid, 'invalid', null::text,
      null::timestamptz, null::timestamptz, false;
    return;
  end if;

  select profile.id into active_actor
  from public.profiles profile
  where profile.id = actor and not profile.is_suspended
  for share;
  if active_actor is null then
    return query select null::uuid, 'not_found', null::text,
      null::timestamptz, null::timestamptz, false;
    return;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      'listing_order_vendor_transition:'
        || actor::text || ':' || p_idempotency_key::text,
      0
    )
  );

  select transition.* into existing_transition
  from private.listing_order_vendor_transitions transition
  where transition.actor_id = actor
    and transition.idempotency_key = p_idempotency_key
  for share;

  select orders.* into order_row
  from public.orders orders
  where orders.id = p_order_id
    and orders.snapshot_source = 'listing_order'
  for no key update;
  if not found then
    return query select null::uuid, 'not_found', null::text,
      null::timestamptz, null::timestamptz, false;
    return;
  end if;

  select business.id into active_business
  from public.businesses business
  where business.id = order_row.business_id
    and business.status = 'active'
  for share;
  if active_business is null then
    return query select null::uuid, 'not_found', null::text,
      null::timestamptz, null::timestamptz, false;
    return;
  end if;

  select membership.business_id into active_membership
  from public.business_memberships membership
  where membership.business_id = order_row.business_id
    and membership.profile_id = actor
    and membership.accepted_at is not null
    and membership.role in ('owner', 'manager', 'staff')
  for share;
  if active_membership is null then
    return query select null::uuid, 'not_found', null::text,
      null::timestamptz, null::timestamptz, false;
    return;
  end if;

  target_status := case p_decision
    when 'confirm' then 'confirmed'
    when 'cancel' then 'cancelled'
  end;

  if existing_transition.actor_id is not null then
    if existing_transition.order_id = p_order_id
      and existing_transition.decision = p_decision then
      if order_row.status::text is distinct from existing_transition.result_status::text
        or order_row.vendor_decided_at
          is distinct from existing_transition.transitioned_at
        or not private.is_consistent_terminal_listing_order(
          order_row.id,
          existing_transition.result_status::text,
          existing_transition.transitioned_at,
          actor
        ) then
        raise exception 'listing order vendor transition replay state is inconsistent';
      end if;
      return query select order_row.id, 'replayed', order_row.status::text,
        order_row.vendor_decided_at, existing_transition.transitioned_at,
        false;
    else
      return query select null::uuid, 'idempotency_key_reused', null::text,
        null::timestamptz, null::timestamptz, false;
    end if;
    return;
  end if;

  if order_row.status in ('confirmed', 'cancelled') then
    if not private.is_consistent_terminal_listing_order(
      order_row.id,
      order_row.status::text,
      order_row.vendor_decided_at,
      null
    ) then
      raise exception 'listing order terminal state is inconsistent';
    end if;
    if order_row.status::text = target_status then
      return query select order_row.id, 'already_transitioned',
        order_row.status::text, order_row.vendor_decided_at,
        order_row.vendor_decided_at, false;
    else
      return query select order_row.id, 'conflict', order_row.status::text,
        order_row.vendor_decided_at, order_row.vendor_decided_at, false;
    end if;
    return;
  end if;

  if order_row.status <> 'placed'
    or order_row.vendor_decided_at is not null
    or not private.is_consistent_placed_listing_order(order_row.id) then
    return query select null::uuid, 'not_found', null::text,
      null::timestamptz, null::timestamptz, false;
    return;
  end if;

  transition_time := clock_timestamp();
  perform set_config('localhub.listing_order_transition', '1', true);
  perform set_config(
    'localhub.listing_order_transition_order_id', order_row.id::text, true
  );
  perform set_config(
    'localhub.listing_order_transition_status', target_status, true
  );
  perform set_config(
    'localhub.listing_order_transition_actor', actor::text, true
  );
  perform set_config(
    'localhub.listing_order_transition_at', transition_time::text, true
  );

  update public.orders orders
  set status = target_status::public.order_status,
      vendor_decided_at = transition_time
  where orders.id = order_row.id
    and orders.status = 'placed'
    and orders.vendor_decided_at is null
  returning orders.updated_at into transition_updated_at;
  if not found then
    raise exception 'listing order vendor transition was not applied';
  end if;
  if transition_updated_at is distinct from transition_time then
    raise exception 'listing order vendor transition timestamp is inconsistent';
  end if;

  insert into public.order_status_events(
    order_id, status, actor_id, note, occurred_at
  ) values (
    order_row.id, target_status::public.order_status,
    actor, null, transition_time
  );

  insert into private.listing_order_vendor_transitions(
    actor_id, idempotency_key, order_id, decision,
    result_status, transitioned_at
  ) values (
    actor, p_idempotency_key, order_row.id, p_decision,
    target_status::public.order_status, transition_time
  );

  insert into public.audit_events(
    actor_id, subject_type, subject_id, action, metadata, created_at
  ) values (
    actor,
    'order',
    order_row.id,
    case target_status
      when 'confirmed' then 'order.confirmed'
      else 'order.cancelled'
    end,
    jsonb_build_object(
      'from_status', 'placed',
      'to_status', target_status,
      'business_id', order_row.business_id
    ),
    transition_time
  );

  perform set_config('localhub.listing_order_transition', '', true);
  perform set_config('localhub.listing_order_transition_order_id', '', true);
  perform set_config('localhub.listing_order_transition_status', '', true);
  perform set_config('localhub.listing_order_transition_actor', '', true);
  perform set_config('localhub.listing_order_transition_at', '', true);

  if not private.is_consistent_terminal_listing_order(
    order_row.id,
    target_status,
    transition_time,
    actor
  ) then
    raise exception 'listing order vendor transition state is inconsistent';
  end if;

  return query select order_row.id, 'transitioned', target_status,
    transition_time, transition_time, false;
end;
$$;
revoke all on function private.respond_to_listing_order(uuid, text, uuid)
  from public, anon, authenticated, service_role;

create or replace function public.respond_to_listing_order(
  p_order_id uuid,
  p_decision text,
  p_idempotency_key uuid
)
returns table(
  order_id uuid,
  outcome text,
  status text,
  vendor_decided_at timestamptz,
  updated_at timestamptz,
  retryable boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  active_actor uuid;
begin
  if p_order_id is null
    or p_decision is null
    or p_decision not in ('confirm', 'cancel')
    or p_idempotency_key is null
    or p_idempotency_key::text
      !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    return query select null::uuid, 'invalid', null::text,
      null::timestamptz, null::timestamptz, false;
    return;
  end if;

  if actor is null or (select auth.role()) is distinct from 'authenticated' then
    return query select null::uuid, 'not_found', null::text,
      null::timestamptz, null::timestamptz, false;
    return;
  end if;

  -- Lock the actor before the actor-owned limiter row. This keeps the lock
  -- order aligned with profile deletion and still limits before order lookup.
  select profile.id into active_actor
  from public.profiles profile
  where profile.id = actor and not profile.is_suspended
  for share;
  if active_actor is null then
    return query select null::uuid, 'not_found', null::text,
      null::timestamptz, null::timestamptz, false;
    return;
  end if;

  if not private.consume_listing_order_vendor_transition_rate_limit() then
    return query select null::uuid, 'rate_limited', null::text,
      null::timestamptz, null::timestamptz, true;
    return;
  end if;

  return query
  select response.order_id,
         response.outcome,
         response.status,
         response.vendor_decided_at,
         response.updated_at,
         response.retryable
  from private.respond_to_listing_order(
    p_order_id, p_decision, p_idempotency_key
  ) response;
end;
$$;
revoke all on function public.respond_to_listing_order(uuid, text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.respond_to_listing_order(uuid, text, uuid)
  to authenticated;

-- Preserve placement replay after a legitimate terminal vendor decision.
-- The original implementation remains the creation/placed-replay core; this
-- public wrapper intercepts only durable confirmed/cancelled replay states.
alter function public.create_listing_order_from_intent(uuid)
  set schema private;
revoke all on function private.create_listing_order_from_intent(uuid)
  from public, anon, authenticated, service_role;

create function private.forward_listing_order_placement(
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
  vendor_decided_at timestamptz,
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
  placement record;
begin
  select * into strict placement
  from private.create_listing_order_from_intent(p_intent_id);

  if placement.outcome in ('created', 'replayed')
    and (
      placement.order_id is null
      or placement.status <> 'placed'
      or not private.is_consistent_placed_listing_order(placement.order_id)
    ) then
    raise exception 'listing order placed replay state is inconsistent';
  end if;

  return query select placement.outcome, placement.retryable,
    placement.order_id, placement.order_number, placement.status,
    placement.created_at, placement.placed_at, null::timestamptz,
    placement.business_id, placement.vendor_name, placement.market_slug,
    placement.listing_id, placement.listing_route, placement.listing_title,
    placement.quantity, placement.currency_code, placement.unit_price_minor,
    placement.total_minor;
end;
$$;
revoke all on function private.forward_listing_order_placement(uuid)
  from public, anon, authenticated, service_role;

create function public.create_listing_order_from_intent(
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
  vendor_decided_at timestamptz,
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
  item_count integer;
begin
  if actor is null
    or (select auth.role()) is distinct from 'authenticated'
    or p_intent_id is null then
    return query
    select * from private.forward_listing_order_placement(p_intent_id);
    return;
  end if;

  select profile.id into active_actor
  from public.profiles profile
  where profile.id = actor and not profile.is_suspended
  for share;
  if active_actor is null then
    return query
    select * from private.forward_listing_order_placement(p_intent_id);
    return;
  end if;

  select orders.* into existing_order
  from public.orders orders
  where orders.guest_intent_id = p_intent_id
    and orders.buyer_id = actor
    and orders.snapshot_source = 'listing_order'
    and orders.status in ('confirmed', 'cancelled');
  if not found then
    begin
      return query
      select * from private.forward_listing_order_placement(p_intent_id);
      return;
    exception
      when raise_exception then
        -- A vendor decision can commit after the unlocked terminal-state
        -- pre-check but before migration 021's placed-only replay verifier.
        -- Its exact consistency exception is retried below against the now
        -- locked durable terminal state; all other failures propagate.
        if sqlerrm <> 'listing order replay state is inconsistent' then
          raise;
        end if;
    end;

    select orders.* into existing_order
    from public.orders orders
    where orders.guest_intent_id = p_intent_id
      and orders.buyer_id = actor
      and orders.snapshot_source = 'listing_order'
      and orders.status in ('confirmed', 'cancelled');
    if not found then
      raise exception 'listing order replay state is inconsistent';
    end if;
  end if;

  actor_rate_key := encode(
    extensions.digest(actor::text, 'sha256'), 'hex'
  );
  if not public.consume_auth_rate_limit(
    'listing_order_replay', actor_rate_key
  ) then
    return query select 'rate_limited', true, null::uuid, null::text,
      null::text, null::timestamptz, null::timestamptz,
      null::timestamptz, null::uuid,
      null::text, null::text, null::uuid, null::text, null::text,
      null::integer, null::text, null::bigint, null::bigint;
    return;
  end if;

  select guest.* into intent
  from public.guest_intents guest
  where guest.id = p_intent_id
  for update;
  if not found
    or intent.kind <> 'listing_order'
    or intent.claimed_by is distinct from actor
    or intent.claimed_at is null
    or intent.consumed_at is null then
    return query select 'invalid', false, null::uuid, null::text,
      null::text, null::timestamptz, null::timestamptz,
      null::timestamptz, null::uuid,
      null::text, null::text, null::uuid, null::text, null::text,
      null::integer, null::text, null::bigint, null::bigint;
    return;
  end if;

  select order_quote.* into quote
  from private.listing_order_quotes order_quote
  where order_quote.intent_id = intent.id
  for share;
  if not found
    or quote.expires_at <> intent.expires_at
    or intent.market_id <> quote.market_id
    or intent.return_to <> format(
      '/%s/listings/%s/order', quote.market_slug, quote.listing_route
    )
    or intent.payload <> jsonb_build_object(
      'type', 'listing_order',
      'listing_id', quote.listing_id,
      'business_id', quote.business_id,
      'market_id', quote.market_id,
      'category_id', quote.category_id,
      'quantity', quote.quantity,
      'listing_route', quote.listing_route
    ) then
    return query select 'invalid', false, null::uuid, null::text,
      null::text, null::timestamptz, null::timestamptz,
      null::timestamptz, null::uuid,
      null::text, null::text, null::uuid, null::text, null::text,
      null::integer, null::text, null::bigint, null::bigint;
    return;
  end if;

  select orders.* into existing_order
  from public.orders orders
  where orders.guest_intent_id = intent.id
  for share;
  if not found then
    raise exception 'listing order terminal replay lost its order';
  end if;

  select item.* into existing_item
  from public.order_items item
  where item.order_id = existing_order.id
  for share;
  select count(*)::integer into item_count
  from public.order_items item
  where item.order_id = existing_order.id;

  if existing_order.buyer_id <> actor
    or existing_order.business_id <> quote.business_id
    or existing_order.market_id <> quote.market_id
    or existing_order.status not in ('confirmed', 'cancelled')
    or existing_order.placed_at is null
    or existing_order.vendor_decided_at is null
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
    or not private.is_consistent_terminal_listing_order(
      existing_order.id,
      existing_order.status::text,
      existing_order.vendor_decided_at,
      null
    ) then
    raise exception 'listing order terminal replay state is inconsistent';
  end if;

  return query select
    'replayed', false, existing_order.id, existing_order.order_number,
    existing_order.status::text, existing_order.created_at,
    existing_order.placed_at, existing_order.vendor_decided_at,
    quote.business_id, quote.vendor_name, quote.market_slug, quote.listing_id,
    quote.listing_route, quote.listing_title, quote.quantity,
    quote.currency_code::text, quote.unit_price_minor, quote.total_minor;
end;
$$;
revoke all on function public.create_listing_order_from_intent(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.create_listing_order_from_intent(uuid)
  to authenticated;

-- PostgreSQL cannot change a RETURNS TABLE shape with CREATE OR REPLACE.
-- Recreate the four safe projections with the dedicated decision timestamp.
drop function public.list_customer_orders(text);
create function public.list_customer_orders(p_market_slug text)
returns table(
  order_id uuid, order_number text, status text, created_at timestamptz,
  placed_at timestamptz, vendor_decided_at timestamptz, business_id uuid,
  vendor_name text, market_slug text, listing_id uuid, listing_route text,
  listing_title text, quantity integer, currency_code text,
  unit_price_minor bigint, total_minor bigint
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
    o.vendor_decided_at, o.business_id, o.vendor_name_snapshot, m.slug,
    i.listing_id, o.listing_route_snapshot, i.title_snapshot, i.quantity,
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

drop function public.get_customer_order(text, text);
create function public.get_customer_order(
  p_market_slug text,
  p_order_number text
)
returns table(
  order_id uuid, order_number text, status text, created_at timestamptz,
  placed_at timestamptz, vendor_decided_at timestamptz, business_id uuid,
  vendor_name text, market_slug text, listing_id uuid, listing_route text,
  listing_title text, quantity integer, currency_code text,
  unit_price_minor bigint, total_minor bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select o.id, o.order_number, o.status::text, o.created_at, o.placed_at,
    o.vendor_decided_at, o.business_id, o.vendor_name_snapshot, m.slug,
    i.listing_id, o.listing_route_snapshot, i.title_snapshot, i.quantity,
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

drop function public.list_vendor_orders();
create function public.list_vendor_orders()
returns table(
  order_id uuid, order_number text, status text, created_at timestamptz,
  placed_at timestamptz, vendor_decided_at timestamptz, business_id uuid,
  vendor_name text, market_slug text, listing_id uuid, listing_route text,
  listing_title text, quantity integer, currency_code text,
  unit_price_minor bigint, total_minor bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select o.id, o.order_number, o.status::text, o.created_at, o.placed_at,
    o.vendor_decided_at, o.business_id, o.vendor_name_snapshot, m.slug,
    i.listing_id, o.listing_route_snapshot, i.title_snapshot, i.quantity,
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

drop function public.get_vendor_order(text);
create function public.get_vendor_order(p_order_number text)
returns table(
  order_id uuid, order_number text, status text, created_at timestamptz,
  placed_at timestamptz, vendor_decided_at timestamptz, business_id uuid,
  vendor_name text, market_slug text, listing_id uuid, listing_route text,
  listing_title text, quantity integer, currency_code text,
  unit_price_minor bigint, total_minor bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select o.id, o.order_number, o.status::text, o.created_at, o.placed_at,
    o.vendor_decided_at, o.business_id, o.vendor_name_snapshot, m.slug,
    i.listing_id, o.listing_route_snapshot, i.title_snapshot, i.quantity,
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

create or replace function public.prune_listing_order_vendor_transitions(
  p_batch_size integer default 500
)
returns table(
  transitions_pruned integer,
  rate_limits_pruned integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  transition_count integer;
  limit_count integer;
begin
  if p_batch_size is null or p_batch_size not between 1 and 2000 then
    raise exception 'invalid listing order vendor transition prune batch size';
  end if;
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'service role is required';
  end if;

  with candidates as (
    select transition.ctid
    from private.listing_order_vendor_transitions transition
    where transition.created_at <= now() - interval '30 days'
    order by transition.created_at, transition.order_id
    limit p_batch_size
    for update skip locked
  ), deleted as (
    delete from private.listing_order_vendor_transitions transition
    using candidates
    where transition.ctid = candidates.ctid
    returning transition.ctid
  )
  select count(*)::integer into transition_count from deleted;

  with candidates as (
    select limits.ctid
    from private.listing_order_vendor_transition_rate_limits limits
    where limits.updated_at <= now() - interval '48 hours'
    order by limits.updated_at, limits.actor_id
    limit p_batch_size
    for update skip locked
  ), deleted as (
    delete from private.listing_order_vendor_transition_rate_limits limits
    using candidates
    where limits.ctid = candidates.ctid
    returning limits.ctid
  )
  select count(*)::integer into limit_count from deleted;

  return query select transition_count, limit_count;
end;
$$;

-- Reassert bounded public access after projection recreation and the new
-- transition column. Buyer identity and event actor identity stay omitted.
revoke all on table public.orders, public.order_items,
  public.order_status_events
  from public, anon, authenticated, service_role;
grant select (
  id, order_number, business_id, market_id, status, currency_code,
  subtotal_minor, total_minor, snapshot_source, vendor_name_snapshot,
  listing_route_snapshot, placed_at, vendor_decided_at, created_at, updated_at
) on public.orders to authenticated;
grant select on public.order_items to authenticated;
grant select (id, order_id, status, occurred_at)
  on public.order_status_events to authenticated;
grant select on public.orders, public.order_items, public.order_status_events
  to service_role;

revoke all on function public.list_customer_orders(text)
  from public, anon, authenticated, service_role;
grant execute on function public.list_customer_orders(text) to authenticated;
revoke all on function public.get_customer_order(text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.get_customer_order(text, text)
  to authenticated;
revoke all on function public.list_vendor_orders()
  from public, anon, authenticated, service_role;
grant execute on function public.list_vendor_orders() to authenticated;
revoke all on function public.get_vendor_order(text)
  from public, anon, authenticated, service_role;
grant execute on function public.get_vendor_order(text) to authenticated;
revoke all on function public.prune_listing_order_vendor_transitions(integer)
  from public, anon, authenticated, service_role;
grant execute on function public.prune_listing_order_vendor_transitions(integer)
  to service_role;

revoke execute on function private.is_consistent_placed_listing_order(uuid)
  from public, anon, authenticated, service_role;
revoke execute on function private.is_consistent_terminal_listing_order(
  uuid, text, timestamptz, uuid
) from public, anon, authenticated, service_role;
revoke execute on function private.consume_listing_order_vendor_transition_rate_limit()
  from public, anon, authenticated, service_role;
revoke execute on function private.respond_to_listing_order(uuid, text, uuid)
  from public, anon, authenticated, service_role;

comment on column public.orders.vendor_decided_at is
  'Immutable timestamp of the one protected vendor availability decision; not a payment or fulfilment timestamp.';
comment on function public.respond_to_listing_order(uuid, text, uuid) is
  'Authenticated exact-business vendor availability decision, limited to 120 attempts per active actor per hour before order lookup.';
comment on function public.create_listing_order_from_intent(uuid) is
  'Protected listing-order placement boundary with durable terminal-state replay support.';

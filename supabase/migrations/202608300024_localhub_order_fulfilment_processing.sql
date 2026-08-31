-- Protected processing-start boundary for confirmed listing orders.
-- This records only vendor handling. It deliberately does not change the
-- order state or create payment, stock, delivery, notification, or ledger work.

create table public.order_fulfilments (
  id uuid primary key default extensions.gen_random_uuid(),
  order_id uuid not null unique references public.orders(id) on delete restrict,
  status text not null check (status = 'processing'),
  started_at timestamptz not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  unique (id, order_id),
  check (started_at = created_at and created_at = updated_at)
);
create index order_fulfilments_processing_started_idx
  on public.order_fulfilments(started_at, order_id);

-- The foundation event table existed before it had a canonical aggregate. The
-- deployed table is empty; make the normalized processing shape mandatory now.
do $$
begin
  if exists (select 1 from public.fulfilment_events) then
    raise exception 'legacy fulfilment events must be reconciled before processing migration';
  end if;
end;
$$;
alter table public.fulfilment_events
  add column if not exists fulfilment_id uuid
    references public.order_fulfilments(id) on delete restrict,
  add column if not exists status text,
  add column if not exists actor_id uuid
    references public.profiles(id) on delete set null;
alter table public.fulfilment_events
  alter column fulfilment_id set not null,
  alter column status set not null;
alter table public.fulfilment_events
  add constraint fulfilment_events_processing_shape check (
    event_type = 'processing_started'
    and status = 'processing'
    and payload = '{}'::jsonb
  ) not valid;
alter table public.fulfilment_events
  validate constraint fulfilment_events_processing_shape;
alter table public.fulfilment_events
  drop constraint if exists fulfilment_events_fulfilment_id_fkey,
  add constraint fulfilment_events_fulfilment_order_fkey
    foreign key (fulfilment_id, order_id)
    references public.order_fulfilments(id, order_id) on delete restrict;
create unique index fulfilment_events_one_processing_started_per_fulfilment_idx
  on public.fulfilment_events(fulfilment_id)
  where event_type = 'processing_started' and status = 'processing';
create index fulfilment_events_fulfilment_occurred_idx
  on public.fulfilment_events(fulfilment_id, occurred_at desc);
create index fulfilment_events_actor_idx
  on public.fulfilment_events(actor_id) where actor_id is not null;

create table private.listing_order_fulfilment_processing (
  actor_id uuid not null references public.profiles(id) on delete restrict,
  idempotency_key uuid not null,
  order_id uuid not null references public.orders(id) on delete restrict,
  fulfilment_id uuid not null,
  command text not null check (command = 'start_processing'),
  result_status text not null check (result_status = 'processing'),
  started_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (actor_id, idempotency_key),
  unique (order_id),
  unique (fulfilment_id),
  constraint listing_order_fulfilment_processing_fulfilment_order_fkey
    foreign key (fulfilment_id, order_id)
    references public.order_fulfilments(id, order_id) on delete restrict
);
create index listing_order_fulfilment_processing_prune_idx
  on private.listing_order_fulfilment_processing(created_at, order_id);
alter table private.listing_order_fulfilment_processing enable row level security;
revoke all on table private.listing_order_fulfilment_processing
  from public, anon, authenticated, service_role;

create table private.listing_order_fulfilment_processing_rate_limits (
  actor_id uuid primary key references public.profiles(id) on delete cascade,
  window_started_at timestamptz not null default now(),
  request_count integer not null default 0 check (request_count between 0 and 121),
  updated_at timestamptz not null default now()
);
create index listing_order_fulfilment_processing_rate_limits_prune_idx
  on private.listing_order_fulfilment_processing_rate_limits(updated_at, actor_id);
alter table private.listing_order_fulfilment_processing_rate_limits
  enable row level security;
revoke all on table private.listing_order_fulfilment_processing_rate_limits
  from public, anon, authenticated, service_role;

-- This helper treats the immutable placed->confirmed chain from migration 023
-- as the only admissible pre-state. It intentionally does not rely on the
-- prunable idempotency ledger.
create or replace function private.is_consistent_confirmed_listing_order(
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
    where o.id = p_order_id
      and o.snapshot_source = 'listing_order'
      and o.status = 'confirmed'
      and o.vendor_decided_at is not null
      and private.is_consistent_terminal_listing_order(
        o.id, 'confirmed', o.vendor_decided_at, null
      )
  )
$$;
revoke all on function private.is_consistent_confirmed_listing_order(uuid)
  from public, anon, authenticated, service_role;

create or replace function private.is_consistent_processing_listing_order(
  p_order_id uuid,
  p_fulfilment_id uuid,
  p_started_at timestamptz,
  p_processing_actor uuid default null
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_order_id is not null
    and p_fulfilment_id is not null
    and p_started_at is not null
    and exists (
      select 1
      from public.orders o
      join public.order_fulfilments f on f.order_id = o.id
      where o.id = p_order_id
        and f.id = p_fulfilment_id
        and f.status = 'processing'
        and f.started_at = p_started_at
        and f.created_at = p_started_at
        and f.updated_at = p_started_at
        and f.started_at >= o.vendor_decided_at
        and private.is_consistent_confirmed_listing_order(o.id)
        and (
          select count(*)
          from public.fulfilment_events event
          where event.order_id = o.id
        ) = 1
        and exists (
          select 1
          from public.fulfilment_events event
          where event.order_id = o.id
            and event.fulfilment_id = f.id
            and event.status = 'processing'
            and event.event_type = 'processing_started'
            and event.payload = '{}'::jsonb
            and event.occurred_at = p_started_at
            and (
              p_processing_actor is null
              or event.actor_id = p_processing_actor
            )
        )
        and (
          select count(*)
          from public.audit_events audit
          where audit.subject_type = 'order'
            and audit.subject_id = o.id
            and audit.action = 'order.fulfilment_processing_started'
        ) = 1
        and exists (
          select 1
          from public.audit_events audit
          join public.fulfilment_events event
            on event.order_id = o.id
            and event.fulfilment_id = f.id
            and event.status = 'processing'
            and event.event_type = 'processing_started'
            and event.payload = '{}'::jsonb
            and event.occurred_at = p_started_at
          where audit.subject_type = 'order'
            and audit.subject_id = o.id
            and audit.action = 'order.fulfilment_processing_started'
            and audit.created_at = p_started_at
            and audit.metadata = jsonb_build_object(
              'business_id', o.business_id,
              'fulfilment_id', f.id,
              'to_status', 'processing'
            )
            and event.actor_id is not distinct from audit.actor_id
            and (
              p_processing_actor is null
              or event.actor_id = p_processing_actor
            )
        )
    )
$$;
revoke all on function private.is_consistent_processing_listing_order(
  uuid, uuid, timestamptz, uuid
) from public, anon, authenticated, service_role;

-- Both aggregate and event histories are append-only. The transaction GUCs
-- bind a permitted insert to the authenticated vendor and exact canonical time.
create or replace function public.prevent_listing_order_fulfilment_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  processing_order_id text := nullif(
    current_setting('localhub.listing_order_fulfilment_order_id', true), ''
  );
  processing_fulfilment_id text := nullif(
    current_setting('localhub.listing_order_fulfilment_id', true), ''
  );
  processing_actor text := nullif(
    current_setting('localhub.listing_order_fulfilment_actor', true), ''
  );
  processing_at text := nullif(
    current_setting('localhub.listing_order_fulfilment_at', true), ''
  );
  parent_order public.orders%rowtype;
  aggregate public.order_fulfilments%rowtype;
begin
  if tg_table_name = 'order_fulfilments' then
    if tg_op <> 'INSERT' then
      raise exception 'listing order fulfilment history is immutable';
    end if;
    select orders.* into parent_order
    from public.orders orders
    where orders.id = new.order_id
    for key share;
    if parent_order.id is null
      or parent_order.snapshot_source is distinct from 'listing_order'
      or parent_order.status is distinct from 'confirmed'
      or parent_order.vendor_decided_at is null
      or not private.is_consistent_confirmed_listing_order(new.order_id)
      or current_setting('localhub.listing_order_fulfilment_processing', true) is distinct from '1'
      or processing_order_id is distinct from new.order_id::text
      or processing_fulfilment_id is distinct from new.id::text
      or processing_actor is distinct from (select auth.uid())::text
      or processing_at is null
      or new.status is distinct from 'processing'
      or new.started_at is distinct from processing_at::timestamptz
      or new.created_at is distinct from processing_at::timestamptz
      or new.updated_at is distinct from processing_at::timestamptz
      or new.started_at < parent_order.vendor_decided_at
      or exists (
        select 1 from public.order_fulfilments existing
        where existing.order_id = new.order_id
      ) then
      raise exception 'invalid listing order fulfilment processing insert';
    end if;
    return new;
  end if;

  if tg_table_name = 'fulfilment_events' then
    -- Preserve ON DELETE SET NULL for actor provenance without allowing an
    -- application mutation of the event itself.
    if tg_op = 'UPDATE'
      and old.actor_id is not null
      and new.actor_id is null
      and (to_jsonb(new) - 'actor_id') is not distinct from
          (to_jsonb(old) - 'actor_id') then
      return new;
    end if;
    if tg_op <> 'INSERT' then
      raise exception 'listing order fulfilment history is immutable';
    end if;
    select f.* into aggregate
    from public.order_fulfilments f
    where f.id = new.fulfilment_id
    for key share;
    if aggregate.id is null
      or aggregate.order_id is distinct from new.order_id
      or current_setting('localhub.listing_order_fulfilment_processing', true) is distinct from '1'
      or processing_order_id is distinct from new.order_id::text
      or processing_fulfilment_id is distinct from new.fulfilment_id::text
      or processing_actor is distinct from (select auth.uid())::text
      or processing_actor is distinct from new.actor_id::text
      or processing_at is null
      or new.status is distinct from 'processing'
      or new.event_type is distinct from 'processing_started'
      or new.payload is distinct from '{}'::jsonb
      or new.occurred_at is distinct from processing_at::timestamptz
      or aggregate.status is distinct from 'processing'
      or aggregate.started_at is distinct from processing_at::timestamptz
      or exists (
        select 1 from public.fulfilment_events event
        where event.order_id = new.order_id
           or event.fulfilment_id = new.fulfilment_id
      ) then
      raise exception 'invalid listing order fulfilment processing event';
    end if;
    return new;
  end if;

  raise exception 'unsupported listing order fulfilment trigger target';
end;
$$;
revoke all on function public.prevent_listing_order_fulfilment_mutation()
  from public, anon, authenticated, service_role;
drop trigger if exists order_fulfilments_protect_listing_order_processing
  on public.order_fulfilments;
create trigger order_fulfilments_protect_listing_order_processing
  before insert or update or delete on public.order_fulfilments
  for each row execute function public.prevent_listing_order_fulfilment_mutation();
drop trigger if exists fulfilment_events_protect_listing_order_processing
  on public.fulfilment_events;
create trigger fulfilment_events_protect_listing_order_processing
  before insert or update or delete on public.fulfilment_events
  for each row execute function public.prevent_listing_order_fulfilment_mutation();

create or replace function private.consume_listing_order_fulfilment_processing_rate_limit()
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
  insert into private.listing_order_fulfilment_processing_rate_limits as limits(
    actor_id, window_started_at, request_count, updated_at
  ) values (actor, now(), 1, now())
  on conflict (actor_id) do update
  set window_started_at = case
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
revoke all on function private.consume_listing_order_fulfilment_processing_rate_limit()
  from public, anon, authenticated, service_role;

create or replace function private.start_listing_order_fulfilment(
  p_order_id uuid,
  p_idempotency_key uuid
)
returns table(
  order_id uuid,
  outcome text,
  order_status text,
  fulfilment_id uuid,
  fulfilment_status text,
  fulfilment_started_at timestamptz,
  fulfilment_updated_at timestamptz,
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
  active_business uuid;
  active_membership uuid;
  existing_ledger private.listing_order_fulfilment_processing%rowtype;
  existing_fulfilment public.order_fulfilments%rowtype;
  processing_fulfilment_id uuid;
  processing_time timestamptz;
begin
  if actor is null
    or (select auth.role()) is distinct from 'authenticated'
    or p_order_id is null
    or p_idempotency_key is null
    or p_idempotency_key::text
      !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    return query select null::uuid, 'invalid', null::text, null::uuid,
      null::text, null::timestamptz, null::timestamptz, false;
    return;
  end if;

  select profile.id into active_actor
  from public.profiles profile
  where profile.id = actor and not profile.is_suspended
  for share;
  if active_actor is null then
    return query select null::uuid, 'not_found', null::text, null::uuid,
      null::text, null::timestamptz, null::timestamptz, false;
    return;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      'listing_order_fulfilment_processing:'
        || actor::text || ':' || p_idempotency_key::text,
      0
    )
  );
  select ledger.* into existing_ledger
  from private.listing_order_fulfilment_processing ledger
  where ledger.actor_id = actor
    and ledger.idempotency_key = p_idempotency_key
  for share;

  select orders.* into order_row
  from public.orders orders
  where orders.id = p_order_id
    and orders.snapshot_source = 'listing_order'
  for no key update;
  if not found then
    return query select null::uuid, 'not_found', null::text, null::uuid,
      null::text, null::timestamptz, null::timestamptz, false;
    return;
  end if;

  select business.id into active_business
  from public.businesses business
  where business.id = order_row.business_id
    and business.status = 'active'
  for share;
  if active_business is null then
    return query select null::uuid, 'not_found', null::text, null::uuid,
      null::text, null::timestamptz, null::timestamptz, false;
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
    return query select null::uuid, 'not_found', null::text, null::uuid,
      null::text, null::timestamptz, null::timestamptz, false;
    return;
  end if;

  select fulfilment.* into existing_fulfilment
  from public.order_fulfilments fulfilment
  where fulfilment.order_id = order_row.id
  for no key update;

  if existing_ledger.actor_id is not null then
    if existing_ledger.order_id <> p_order_id then
      return query select null::uuid, 'idempotency_key_reused', null::text,
        null::uuid, null::text, null::timestamptz, null::timestamptz, false;
      return;
    end if;
    if existing_fulfilment.id is distinct from existing_ledger.fulfilment_id
      or existing_ledger.command <> 'start_processing'
      or existing_ledger.result_status <> 'processing'
      or existing_fulfilment.started_at is distinct from existing_ledger.started_at
      or not private.is_consistent_processing_listing_order(
        order_row.id, existing_ledger.fulfilment_id, existing_ledger.started_at, actor
      ) then
      raise exception 'listing order fulfilment replay state is inconsistent';
    end if;
    return query select order_row.id, 'replayed', 'confirmed',
      existing_fulfilment.id, 'processing', existing_fulfilment.started_at,
      existing_fulfilment.updated_at, false;
    return;
  end if;

  if existing_fulfilment.id is not null then
    if not private.is_consistent_processing_listing_order(
      order_row.id, existing_fulfilment.id, existing_fulfilment.started_at, null
    ) then
      raise exception 'listing order fulfilment state is inconsistent';
    end if;
    return query select order_row.id, 'already_started', 'confirmed',
      existing_fulfilment.id, 'processing', existing_fulfilment.started_at,
      existing_fulfilment.updated_at, false;
    return;
  end if;

  if order_row.status <> 'confirmed'
    or order_row.vendor_decided_at is null
    or not private.is_consistent_confirmed_listing_order(order_row.id) then
    return query select null::uuid, 'not_found', null::text, null::uuid,
      null::text, null::timestamptz, null::timestamptz, false;
    return;
  end if;

  processing_fulfilment_id := extensions.gen_random_uuid();
  processing_time := clock_timestamp();
  perform set_config('localhub.listing_order_fulfilment_processing', '1', true);
  perform set_config(
    'localhub.listing_order_fulfilment_order_id', order_row.id::text, true
  );
  perform set_config(
    'localhub.listing_order_fulfilment_id', processing_fulfilment_id::text, true
  );
  perform set_config(
    'localhub.listing_order_fulfilment_actor', actor::text, true
  );
  perform set_config(
    'localhub.listing_order_fulfilment_at', processing_time::text, true
  );

  insert into public.order_fulfilments(
    id, order_id, status, started_at, created_at, updated_at
  ) values (
    processing_fulfilment_id, order_row.id, 'processing', processing_time,
    processing_time, processing_time
  );
  insert into public.fulfilment_events(
    order_id, fulfilment_id, status, event_type, actor_id, payload, occurred_at
  ) values (
    order_row.id, processing_fulfilment_id, 'processing', 'processing_started',
    actor, '{}'::jsonb, processing_time
  );
  insert into private.listing_order_fulfilment_processing(
    actor_id, idempotency_key, order_id, fulfilment_id, command,
    result_status, started_at
  ) values (
    actor, p_idempotency_key, order_row.id, processing_fulfilment_id,
    'start_processing', 'processing', processing_time
  );
  insert into public.audit_events(
    actor_id, subject_type, subject_id, action, metadata, created_at
  ) values (
    actor, 'order', order_row.id, 'order.fulfilment_processing_started',
    jsonb_build_object(
      'business_id', order_row.business_id,
      'fulfilment_id', processing_fulfilment_id,
      'to_status', 'processing'
    ), processing_time
  );
  perform set_config('localhub.listing_order_fulfilment_processing', '', true);
  perform set_config('localhub.listing_order_fulfilment_order_id', '', true);
  perform set_config('localhub.listing_order_fulfilment_id', '', true);
  perform set_config('localhub.listing_order_fulfilment_actor', '', true);
  perform set_config('localhub.listing_order_fulfilment_at', '', true);

  if not private.is_consistent_processing_listing_order(
    order_row.id, processing_fulfilment_id, processing_time, actor
  ) then
    raise exception 'listing order fulfilment state is inconsistent';
  end if;
  return query select order_row.id, 'started', 'confirmed',
    processing_fulfilment_id, 'processing', processing_time, processing_time, false;
end;
$$;
revoke all on function private.start_listing_order_fulfilment(uuid, uuid)
  from public, anon, authenticated, service_role;

-- The shared audit table is otherwise mutable by privileged server code. Guard
-- only this slice's evidence rows so unrelated audit workflows remain intact.
create or replace function public.prevent_listing_order_fulfilment_audit_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_action constant text := 'order.fulfilment_processing_started';
  processing_order_id text := nullif(
    current_setting('localhub.listing_order_fulfilment_order_id', true), ''
  );
  processing_fulfilment_id text := nullif(
    current_setting('localhub.listing_order_fulfilment_id', true), ''
  );
  processing_actor text := nullif(
    current_setting('localhub.listing_order_fulfilment_actor', true), ''
  );
  processing_at text := nullif(
    current_setting('localhub.listing_order_fulfilment_at', true), ''
  );
begin
  if tg_op = 'INSERT' and new.action is distinct from target_action then
    return new;
  end if;
  if tg_op = 'UPDATE'
    and old.action is distinct from target_action
    and new.action is distinct from target_action then
    return new;
  end if;
  if tg_op = 'DELETE' and old.action is distinct from target_action then
    return old;
  end if;

  -- Referential actor erasure is allowed only after the referenced profile has
  -- actually disappeared. All other protected audit mutations remain denied.
  if tg_op = 'UPDATE'
    and old.action = target_action
    and new.action = target_action
    and old.actor_id is not null
    and new.actor_id is null
    and (to_jsonb(new) - 'actor_id') is not distinct from
        (to_jsonb(old) - 'actor_id')
    and not exists (
      select 1 from public.profiles profile where profile.id = old.actor_id
    ) then
    return new;
  end if;
  if tg_op <> 'INSERT' then
    raise exception 'listing order fulfilment audit evidence is immutable';
  end if;

  if current_user is distinct from pg_catalog.pg_get_userbyid((
      select routine.proowner
      from pg_catalog.pg_proc routine
      where routine.oid =
        'private.start_listing_order_fulfilment(uuid,uuid)'::pg_catalog.regprocedure
    ))
    or current_setting('localhub.listing_order_fulfilment_processing', true)
      is distinct from '1'
    or processing_order_id is distinct from new.subject_id::text
    or processing_fulfilment_id is null
    or processing_actor is distinct from new.actor_id::text
    or processing_at is null
    or new.subject_type is distinct from 'order'
    or new.action is distinct from target_action
    or new.created_at is distinct from processing_at::timestamptz
    or exists (
      select 1
      from public.audit_events audit
      where audit.subject_type = 'order'
        and audit.subject_id = new.subject_id
        and audit.action = target_action
    )
    or not exists (
      select 1
      from public.orders orders
      join public.order_fulfilments fulfilment
        on fulfilment.order_id = orders.id
      join public.fulfilment_events event
        on event.order_id = orders.id
        and event.fulfilment_id = fulfilment.id
      where orders.id = new.subject_id
        and fulfilment.id::text = processing_fulfilment_id
        and fulfilment.status = 'processing'
        and fulfilment.started_at = processing_at::timestamptz
        and event.event_type = 'processing_started'
        and event.status = 'processing'
        and event.actor_id = new.actor_id
        and event.payload = '{}'::jsonb
        and event.occurred_at = processing_at::timestamptz
        and new.metadata = jsonb_build_object(
          'business_id', orders.business_id,
          'fulfilment_id', fulfilment.id,
          'to_status', 'processing'
        )
    ) then
    raise exception 'invalid listing order fulfilment processing audit insert';
  end if;
  return new;
end;
$$;
revoke all on function public.prevent_listing_order_fulfilment_audit_mutation()
  from public, anon, authenticated, service_role;
drop trigger if exists audit_events_protect_listing_order_fulfilment_processing
  on public.audit_events;
create trigger audit_events_protect_listing_order_fulfilment_processing
  before insert or update or delete on public.audit_events
  for each row execute function public.prevent_listing_order_fulfilment_audit_mutation();

create or replace function public.start_listing_order_fulfilment(
  p_order_id uuid,
  p_idempotency_key uuid
)
returns table(
  order_id uuid,
  outcome text,
  order_status text,
  fulfilment_id uuid,
  fulfilment_status text,
  fulfilment_started_at timestamptz,
  fulfilment_updated_at timestamptz,
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
    or p_idempotency_key is null
    or p_idempotency_key::text
      !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    return query select null::uuid, 'invalid', null::text, null::uuid,
      null::text, null::timestamptz, null::timestamptz, false;
    return;
  end if;
  if actor is null or (select auth.role()) is distinct from 'authenticated' then
    return query select null::uuid, 'not_found', null::text, null::uuid,
      null::text, null::timestamptz, null::timestamptz, false;
    return;
  end if;
  select profile.id into active_actor
  from public.profiles profile
  where profile.id = actor and not profile.is_suspended
  for share;
  if active_actor is null then
    return query select null::uuid, 'not_found', null::text, null::uuid,
      null::text, null::timestamptz, null::timestamptz, false;
    return;
  end if;
  if not private.consume_listing_order_fulfilment_processing_rate_limit() then
    return query select null::uuid, 'rate_limited', null::text, null::uuid,
      null::text, null::timestamptz, null::timestamptz, true;
    return;
  end if;
  return query
  select response.order_id, response.outcome, response.order_status,
    response.fulfilment_id, response.fulfilment_status,
    response.fulfilment_started_at, response.fulfilment_updated_at,
    response.retryable
  from private.start_listing_order_fulfilment(p_order_id, p_idempotency_key) response;
end;
$$;
revoke all on function public.start_listing_order_fulfilment(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.start_listing_order_fulfilment(uuid, uuid)
  to authenticated;

-- PostgreSQL cannot change RETURNS TABLE shapes in place. The protected
-- placement wrapper is recreated with an all-null or all-complete fulfilment
-- quartet, while its original private placed-order core remains unchanged.
drop function public.create_listing_order_from_intent(uuid);
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
  fulfilment_id uuid,
  fulfilment_status text,
  fulfilment_started_at timestamptz,
  fulfilment_updated_at timestamptz,
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
  existing_fulfilment public.order_fulfilments%rowtype;
  item_count integer;
begin
  if actor is null
    or (select auth.role()) is distinct from 'authenticated'
    or p_intent_id is null then
    return query select placement.outcome, placement.retryable,
      placement.order_id, placement.order_number, placement.status,
      placement.created_at, placement.placed_at, placement.vendor_decided_at,
      null::uuid, null::text, null::timestamptz, null::timestamptz,
      placement.business_id, placement.vendor_name, placement.market_slug,
      placement.listing_id, placement.listing_route, placement.listing_title,
      placement.quantity, placement.currency_code, placement.unit_price_minor,
      placement.total_minor
    from private.forward_listing_order_placement(p_intent_id) placement;
    return;
  end if;
  select profile.id into active_actor
  from public.profiles profile
  where profile.id = actor and not profile.is_suspended
  for share;
  if active_actor is null then
    return query select placement.outcome, placement.retryable,
      placement.order_id, placement.order_number, placement.status,
      placement.created_at, placement.placed_at, placement.vendor_decided_at,
      null::uuid, null::text, null::timestamptz, null::timestamptz,
      placement.business_id, placement.vendor_name, placement.market_slug,
      placement.listing_id, placement.listing_route, placement.listing_title,
      placement.quantity, placement.currency_code, placement.unit_price_minor,
      placement.total_minor
    from private.forward_listing_order_placement(p_intent_id) placement;
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
      return query select placement.outcome, placement.retryable,
        placement.order_id, placement.order_number, placement.status,
        placement.created_at, placement.placed_at, placement.vendor_decided_at,
        null::uuid, null::text, null::timestamptz, null::timestamptz,
        placement.business_id, placement.vendor_name, placement.market_slug,
        placement.listing_id, placement.listing_route, placement.listing_title,
        placement.quantity, placement.currency_code, placement.unit_price_minor,
        placement.total_minor
      from private.forward_listing_order_placement(p_intent_id) placement;
      return;
    exception when raise_exception then
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
  actor_rate_key := encode(extensions.digest(actor::text, 'sha256'), 'hex');
  if not public.consume_auth_rate_limit('listing_order_replay', actor_rate_key) then
    return query select 'rate_limited', true, null::uuid, null::text,
      null::text, null::timestamptz, null::timestamptz, null::timestamptz,
      null::uuid, null::text, null::timestamptz, null::timestamptz,
      null::uuid, null::text, null::text, null::uuid, null::text, null::text,
      null::integer, null::text, null::bigint, null::bigint;
    return;
  end if;
  select guest.* into intent from public.guest_intents guest
  where guest.id = p_intent_id for update;
  if not found or intent.kind <> 'listing_order'
    or intent.claimed_by is distinct from actor
    or intent.claimed_at is null or intent.consumed_at is null then
    return query select 'invalid', false, null::uuid, null::text,
      null::text, null::timestamptz, null::timestamptz, null::timestamptz,
      null::uuid, null::text, null::timestamptz, null::timestamptz,
      null::uuid, null::text, null::text, null::uuid, null::text, null::text,
      null::integer, null::text, null::bigint, null::bigint;
    return;
  end if;
  select order_quote.* into quote from private.listing_order_quotes order_quote
  where order_quote.intent_id = intent.id for share;
  if not found or quote.expires_at <> intent.expires_at
    or intent.market_id <> quote.market_id
    or intent.return_to <> format('/%s/listings/%s/order', quote.market_slug, quote.listing_route)
    or intent.payload <> jsonb_build_object(
      'type', 'listing_order', 'listing_id', quote.listing_id,
      'business_id', quote.business_id, 'market_id', quote.market_id,
      'category_id', quote.category_id, 'quantity', quote.quantity,
      'listing_route', quote.listing_route
    ) then
    return query select 'invalid', false, null::uuid, null::text,
      null::text, null::timestamptz, null::timestamptz, null::timestamptz,
      null::uuid, null::text, null::timestamptz, null::timestamptz,
      null::uuid, null::text, null::text, null::uuid, null::text, null::text,
      null::integer, null::text, null::bigint, null::bigint;
    return;
  end if;
  select orders.* into existing_order from public.orders orders
  where orders.guest_intent_id = intent.id for share;
  if not found then
    raise exception 'listing order terminal replay lost its order';
  end if;
  select item.* into existing_item from public.order_items item
  where item.order_id = existing_order.id for share;
  select count(*)::integer into item_count from public.order_items item
  where item.order_id = existing_order.id;
  select fulfilment.* into existing_fulfilment
  from public.order_fulfilments fulfilment
  where fulfilment.order_id = existing_order.id
  for share;
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
    or item_count <> 1 or existing_item.id is null
    or existing_item.listing_id <> quote.listing_id
    or existing_item.variant_id is not null
    or existing_item.title_snapshot <> quote.listing_title
    or existing_item.quantity <> quote.quantity
    or existing_item.unit_price_minor <> quote.unit_price_minor
    or existing_item.total_minor <> quote.total_minor
    or not private.is_consistent_terminal_listing_order(
      existing_order.id, existing_order.status::text,
      existing_order.vendor_decided_at, null
    )
    or (existing_order.status = 'cancelled' and existing_fulfilment.id is not null)
    or (existing_fulfilment.id is not null and not private.is_consistent_processing_listing_order(
      existing_order.id, existing_fulfilment.id, existing_fulfilment.started_at, null
    )) then
    raise exception 'listing order terminal replay state is inconsistent';
  end if;
  return query select 'replayed', false, existing_order.id,
    existing_order.order_number, existing_order.status::text,
    existing_order.created_at, existing_order.placed_at,
    existing_order.vendor_decided_at, existing_fulfilment.id,
    existing_fulfilment.status, existing_fulfilment.started_at,
    existing_fulfilment.updated_at, quote.business_id, quote.vendor_name,
    quote.market_slug, quote.listing_id, quote.listing_route, quote.listing_title,
    quote.quantity, quote.currency_code::text, quote.unit_price_minor,
    quote.total_minor;
end;
$$;
revoke all on function public.create_listing_order_from_intent(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.create_listing_order_from_intent(uuid)
  to authenticated;

-- Recreate safe customer/vendor projections with a complete-or-null aggregate
-- quartet. The aggregate unique constraint rules out plural joins.
drop function public.list_customer_orders(text);
create function public.list_customer_orders(p_market_slug text)
returns table(
  order_id uuid, order_number text, status text, created_at timestamptz,
  placed_at timestamptz, vendor_decided_at timestamptz, fulfilment_id uuid,
  fulfilment_status text, fulfilment_started_at timestamptz,
  fulfilment_updated_at timestamptz, business_id uuid, vendor_name text,
  market_slug text, listing_id uuid, listing_route text, listing_title text,
  quantity integer, currency_code text, unit_price_minor bigint, total_minor bigint
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_market_slug is null or p_market_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    or char_length(p_market_slug) > 80
    or not (select public.is_current_profile_active()) then return; end if;
  return query select o.id, o.order_number, o.status::text, o.created_at,
    o.placed_at, o.vendor_decided_at, f.id, f.status, f.started_at, f.updated_at,
    o.business_id, o.vendor_name_snapshot, m.slug, i.listing_id,
    o.listing_route_snapshot, i.title_snapshot, i.quantity, o.currency_code::text,
    i.unit_price_minor, o.total_minor
  from public.orders o join public.order_items i on i.order_id = o.id
  join public.markets m on m.id = o.market_id
  left join public.order_fulfilments f on f.order_id = o.id
  where o.buyer_id = (select auth.uid()) and o.snapshot_source = 'listing_order'
    and m.slug = p_market_slug
    and not exists (select 1 from public.order_items extra where extra.order_id = o.id and extra.id <> i.id)
  order by o.created_at desc, o.id desc limit 100;
end;
$$;

drop function public.get_customer_order(text, text);
create function public.get_customer_order(p_market_slug text, p_order_number text)
returns table(
  order_id uuid, order_number text, status text, created_at timestamptz,
  placed_at timestamptz, vendor_decided_at timestamptz, fulfilment_id uuid,
  fulfilment_status text, fulfilment_started_at timestamptz,
  fulfilment_updated_at timestamptz, business_id uuid, vendor_name text,
  market_slug text, listing_id uuid, listing_route text, listing_title text,
  quantity integer, currency_code text, unit_price_minor bigint, total_minor bigint
)
language sql stable security definer set search_path = '' as $$
  select o.id, o.order_number, o.status::text, o.created_at, o.placed_at,
    o.vendor_decided_at, f.id, f.status, f.started_at, f.updated_at,
    o.business_id, o.vendor_name_snapshot, m.slug, i.listing_id,
    o.listing_route_snapshot, i.title_snapshot, i.quantity, o.currency_code::text,
    i.unit_price_minor, o.total_minor
  from public.orders o join public.order_items i on i.order_id = o.id
  join public.markets m on m.id = o.market_id
  left join public.order_fulfilments f on f.order_id = o.id
  where p_market_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    and char_length(p_market_slug) <= 80
    and p_order_number ~ '^LO-[0-9]{6}-[0-9]{10}$'
    and o.order_number = p_order_number and o.buyer_id = (select auth.uid())
    and o.snapshot_source = 'listing_order' and m.slug = p_market_slug
    and not exists (select 1 from public.order_items extra where extra.order_id = o.id and extra.id <> i.id)
    and (select public.is_current_profile_active())
$$;

drop function public.list_vendor_orders();
create function public.list_vendor_orders()
returns table(
  order_id uuid, order_number text, status text, created_at timestamptz,
  placed_at timestamptz, vendor_decided_at timestamptz, fulfilment_id uuid,
  fulfilment_status text, fulfilment_started_at timestamptz,
  fulfilment_updated_at timestamptz, business_id uuid, vendor_name text,
  market_slug text, listing_id uuid, listing_route text, listing_title text,
  quantity integer, currency_code text, unit_price_minor bigint, total_minor bigint
)
language sql stable security definer set search_path = '' as $$
  select o.id, o.order_number, o.status::text, o.created_at, o.placed_at,
    o.vendor_decided_at, f.id, f.status, f.started_at, f.updated_at,
    o.business_id, o.vendor_name_snapshot, m.slug, i.listing_id,
    o.listing_route_snapshot, i.title_snapshot, i.quantity, o.currency_code::text,
    i.unit_price_minor, o.total_minor
  from public.orders o join public.order_items i on i.order_id = o.id
  join public.markets m on m.id = o.market_id
  left join public.order_fulfilments f on f.order_id = o.id
  where o.snapshot_source = 'listing_order'
    and (select public.is_current_profile_active())
    and not exists (select 1 from public.order_items extra where extra.order_id = o.id and extra.id <> i.id)
    and exists (select 1 from public.business_memberships membership
      where membership.business_id = o.business_id
        and membership.profile_id = (select auth.uid())
        and membership.accepted_at is not null)
  order by o.created_at desc, o.id desc limit 100
$$;

drop function public.get_vendor_order(text);
create function public.get_vendor_order(p_order_number text)
returns table(
  order_id uuid, order_number text, status text, created_at timestamptz,
  placed_at timestamptz, vendor_decided_at timestamptz, fulfilment_id uuid,
  fulfilment_status text, fulfilment_started_at timestamptz,
  fulfilment_updated_at timestamptz, business_id uuid, vendor_name text,
  market_slug text, listing_id uuid, listing_route text, listing_title text,
  quantity integer, currency_code text, unit_price_minor bigint, total_minor bigint
)
language sql stable security definer set search_path = '' as $$
  select o.id, o.order_number, o.status::text, o.created_at, o.placed_at,
    o.vendor_decided_at, f.id, f.status, f.started_at, f.updated_at,
    o.business_id, o.vendor_name_snapshot, m.slug, i.listing_id,
    o.listing_route_snapshot, i.title_snapshot, i.quantity, o.currency_code::text,
    i.unit_price_minor, o.total_minor
  from public.orders o join public.order_items i on i.order_id = o.id
  join public.markets m on m.id = o.market_id
  left join public.order_fulfilments f on f.order_id = o.id
  where p_order_number ~ '^LO-[0-9]{6}-[0-9]{10}$'
    and o.order_number = p_order_number and o.snapshot_source = 'listing_order'
    and (select public.is_current_profile_active())
    and not exists (select 1 from public.order_items extra where extra.order_id = o.id and extra.id <> i.id)
    and exists (select 1 from public.business_memberships membership
      where membership.business_id = o.business_id
        and membership.profile_id = (select auth.uid())
        and membership.accepted_at is not null)
$$;

create or replace function public.prune_listing_order_fulfilment_processing(
  p_batch_size integer default 500
)
returns table(processing_rows_pruned integer, rate_limits_pruned integer)
language plpgsql security definer set search_path = '' as $$
declare processing_count integer; limit_count integer;
begin
  if p_batch_size is null or p_batch_size not between 1 and 2000 then
    raise exception 'invalid listing order fulfilment processing prune batch size';
  end if;
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'service role is required';
  end if;
  with candidates as (
    select ledger.ctid from private.listing_order_fulfilment_processing ledger
    where ledger.created_at <= now() - interval '30 days'
    order by ledger.created_at, ledger.order_id limit p_batch_size for update skip locked
  ), deleted as (
    delete from private.listing_order_fulfilment_processing ledger
    using candidates where ledger.ctid = candidates.ctid returning ledger.ctid
  ) select count(*)::integer into processing_count from deleted;
  with candidates as (
    select limits.ctid from private.listing_order_fulfilment_processing_rate_limits limits
    where limits.updated_at <= now() - interval '48 hours'
    order by limits.updated_at, limits.actor_id limit p_batch_size for update skip locked
  ), deleted as (
    delete from private.listing_order_fulfilment_processing_rate_limits limits
    using candidates where limits.ctid = candidates.ctid returning limits.ctid
  ) select count(*)::integer into limit_count from deleted;
  return query select processing_count, limit_count;
end;
$$;

-- Active-profile-aware read policies and narrow non-PII projections. Do not
-- add order_fulfilments to Realtime; fulfilment_events already remains in the
-- existing publication but no subscription behavior is introduced here.
alter table public.order_fulfilments enable row level security;
drop policy if exists order_fulfilments_active_customer_or_vendor_select
  on public.order_fulfilments;
create policy order_fulfilments_active_customer_or_vendor_select
  on public.order_fulfilments for select to authenticated
  using ((select private.can_current_actor_view_order(order_fulfilments.order_id)));
drop policy if exists fulfilment_visible on public.fulfilment_events;
drop policy if exists fulfilment_events_active_customer_or_vendor_select
  on public.fulfilment_events;
create policy fulfilment_events_active_customer_or_vendor_select
  on public.fulfilment_events for select to authenticated
  using ((select private.can_current_actor_view_order(fulfilment_events.order_id)));

revoke all on table public.order_fulfilments, public.fulfilment_events
  from public, anon, authenticated, service_role;
revoke insert, update, delete, truncate on table public.audit_events
  from public, anon, authenticated, service_role;
grant select (id, order_id, status, started_at, created_at, updated_at)
  on public.order_fulfilments to authenticated;
grant select (id, order_id, fulfilment_id, status, event_type, occurred_at)
  on public.fulfilment_events to authenticated;
grant select on public.order_fulfilments, public.fulfilment_events to service_role;
grant select on public.audit_events to service_role;

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
revoke all on function public.prune_listing_order_fulfilment_processing(integer)
  from public, anon, authenticated, service_role;
grant execute on function public.prune_listing_order_fulfilment_processing(integer)
  to service_role;

revoke execute on function private.is_consistent_confirmed_listing_order(uuid)
  from public, anon, authenticated, service_role;
revoke execute on function private.is_consistent_processing_listing_order(
  uuid, uuid, timestamptz, uuid
) from public, anon, authenticated, service_role;
revoke execute on function private.consume_listing_order_fulfilment_processing_rate_limit()
  from public, anon, authenticated, service_role;
revoke execute on function private.start_listing_order_fulfilment(uuid, uuid)
  from public, anon, authenticated, service_role;

comment on table public.order_fulfilments is
  'Canonical protected listing-order fulfilment aggregate; processing means vendor handling started only.';
comment on function public.start_listing_order_fulfilment(uuid, uuid) is
  'Authenticated exact-business start-processing command for confirmed listing orders; no payment, inventory, delivery, or completion transition.';

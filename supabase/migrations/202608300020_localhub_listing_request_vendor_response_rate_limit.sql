-- Bound direct authenticated calls to the vendor-response RPC before any
-- attacker-selected request lookup. The original transition implementation is
-- moved behind a private wrapper so migration 019 remains immutable.

create table private.listing_request_vendor_response_rate_limits (
  actor_id uuid primary key references public.profiles(id) on delete cascade,
  window_started_at timestamptz not null default now(),
  request_count integer not null default 0 check (request_count >= 0),
  updated_at timestamptz not null default now()
);
create index listing_request_vendor_response_rate_limits_prune_idx
  on private.listing_request_vendor_response_rate_limits(updated_at, actor_id);
alter table private.listing_request_vendor_response_rate_limits enable row level security;
revoke all on table private.listing_request_vendor_response_rate_limits
  from public, anon, authenticated, service_role;

create or replace function private.consume_listing_request_vendor_response_rate_limit()
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

  insert into private.listing_request_vendor_response_rate_limits as limits(
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
      else limits.request_count + 1
    end,
    updated_at = now()
  returning request_count into current_count;

  return current_count <= 120;
end;
$$;
revoke all on function private.consume_listing_request_vendor_response_rate_limit()
  from public, anon, authenticated, service_role;

alter function public.respond_to_listing_request(uuid, text, uuid)
  set schema private;
revoke all on function private.respond_to_listing_request(uuid, text, uuid)
  from public, anon, authenticated, service_role;

create function public.respond_to_listing_request(
  p_request_id uuid,
  p_decision text,
  p_idempotency_key uuid
)
returns table(
  request_id uuid,
  outcome text,
  status text,
  vendor_responded_at timestamptz,
  updated_at timestamptz,
  retryable boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
begin
  if p_request_id is null
    or p_decision is null
    or p_decision not in ('accept', 'decline')
    or p_idempotency_key is null
    or p_idempotency_key::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    return query select null::uuid, 'invalid', null::text, null::timestamptz, null::timestamptz, false;
    return;
  end if;

  if actor is null
    or (select auth.role()) is distinct from 'authenticated'
    or not public.is_active_profile(actor) then
    return query select null::uuid, 'not_found', null::text, null::timestamptz, null::timestamptz, false;
    return;
  end if;

  if not private.consume_listing_request_vendor_response_rate_limit() then
    return query select null::uuid, 'rate_limited', null::text, null::timestamptz, null::timestamptz, true;
    return;
  end if;

  return query
  select response.request_id,
         response.outcome,
         response.status,
         response.vendor_responded_at,
         response.updated_at,
         response.retryable
  from private.respond_to_listing_request(
    p_request_id,
    p_decision,
    p_idempotency_key
  ) response;
end;
$$;
revoke all on function public.respond_to_listing_request(uuid, text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.respond_to_listing_request(uuid, text, uuid)
  to authenticated;

create or replace function public.prune_listing_request_vendor_response_rate_limits(
  p_batch_size integer default 500
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  pruned integer;
begin
  if p_batch_size is null or p_batch_size not between 1 and 2000 then
    raise exception 'invalid listing request vendor response rate-limit prune batch size';
  end if;
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'service role is required';
  end if;

  with candidates as (
    select limits.ctid
    from private.listing_request_vendor_response_rate_limits limits
    where limits.updated_at <= now() - interval '48 hours'
    order by limits.updated_at, limits.actor_id
    limit p_batch_size
    for update skip locked
  ), deleted as (
    delete from private.listing_request_vendor_response_rate_limits limits
    using candidates
    where limits.ctid = candidates.ctid
    returning limits.ctid
  )
  select count(*)::integer into pruned from deleted;

  return pruned;
end;
$$;
revoke all on function public.prune_listing_request_vendor_response_rate_limits(integer)
  from public, anon, authenticated;
grant execute on function public.prune_listing_request_vendor_response_rate_limits(integer)
  to service_role;

comment on function public.respond_to_listing_request(uuid, text, uuid) is
  'Authenticated vendor request response boundary, limited to 120 calls per active actor per hour before request lookup.';

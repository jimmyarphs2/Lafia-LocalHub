-- Vendor decisions for listing-linked requests are a one-way, auditable
-- transition.  Legacy unlinked requests keep their historical state model.

alter table public.requests
  add column if not exists vendor_responded_at timestamptz;

alter table public.requests
  drop constraint if exists requests_status_check;
alter table public.requests
  add constraint requests_status_domain
  check (
    (listing_id is null and vendor_responded_at is null and status in ('open', 'matched', 'closed', 'cancelled'))
    or (listing_id is not null and status in ('open', 'accepted', 'declined'))
  ) not valid;
alter table public.requests
  validate constraint requests_status_domain;

alter table public.requests
  add constraint requests_listing_response_consistency
  check (
    listing_id is null
    or (status = 'open' and vendor_responded_at is null)
    or (status in ('accepted', 'declined') and vendor_responded_at is not null)
  ) not valid;
alter table public.requests
  validate constraint requests_listing_response_consistency;

create or replace function public.enforce_listing_request_response_transition()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  response_request_id text := current_setting('localhub.listing_request_response_request_id', true);
  response_at text := current_setting('localhub.listing_request_response_at', true);
begin
  -- Historical, unlinked requests retain their legacy workflow.  They cannot
  -- be converted into a listing request through an UPDATE.
  if old.listing_id is null and new.listing_id is null then
    return new;
  end if;

  -- Preserve the nullable-foreign-key maintenance designed into the
  -- foundation schema. PostgreSQL's ON DELETE SET NULL actions fire row
  -- triggers, so allow only removals of those references with every workflow
  -- and customer-authored field unchanged. Application roles have no direct
  -- UPDATE grant; this path exists for FK maintenance, not vendor responses.
  if old.listing_id is not null
    and (
      (old.requester_id is not null and new.requester_id is null)
      or (old.guest_intent_id is not null and new.guest_intent_id is null)
      or (old.category_id is not null and new.category_id is null)
    )
    and (new.requester_id is not distinct from old.requester_id or new.requester_id is null)
    and (new.guest_intent_id is not distinct from old.guest_intent_id or new.guest_intent_id is null)
    and (new.category_id is not distinct from old.category_id or new.category_id is null)
    and old.id is not distinct from new.id
    and old.market_id is not distinct from new.market_id
    and old.title is not distinct from new.title
    and old.details is not distinct from new.details
    and old.status is not distinct from new.status
    and old.listing_id is not distinct from new.listing_id
    and old.business_id is not distinct from new.business_id
    and old.requested_action is not distinct from new.requested_action
    and old.request_number is not distinct from new.request_number
    and old.search_context is not distinct from new.search_context
    and old.vendor_responded_at is not distinct from new.vendor_responded_at
    and old.created_at is not distinct from new.created_at then
    return new;
  end if;

  if current_setting('localhub.listing_request_response', true) is distinct from '1' then
    raise exception 'listing request response updates must use respond_to_listing_request';
  end if;
  if response_request_id is null
    or response_request_id = ''
    or response_at is null
    or response_at = ''
    or response_request_id <> old.id::text then
    raise exception 'listing request response updates must use respond_to_listing_request';
  end if;

  if old.listing_id is null
    or new.listing_id is null
    or old.status <> 'open'
    or old.vendor_responded_at is not null
    or new.status not in ('accepted', 'declined')
    or new.vendor_responded_at is null
    or new.vendor_responded_at is distinct from response_at::timestamptz then
    raise exception 'invalid listing request response transition';
  end if;

  if old.id is distinct from new.id
    or old.requester_id is distinct from new.requester_id
    or old.guest_intent_id is distinct from new.guest_intent_id
    or old.market_id is distinct from new.market_id
    or old.category_id is distinct from new.category_id
    or old.title is distinct from new.title
    or old.details is distinct from new.details
    or old.listing_id is distinct from new.listing_id
    or old.business_id is distinct from new.business_id
    or old.requested_action is distinct from new.requested_action
    or old.request_number is distinct from new.request_number
    or old.search_context is distinct from new.search_context
    or old.created_at is distinct from new.created_at then
    raise exception 'listing request response cannot mutate request content';
  end if;

  return new;
end;
$$;
revoke all on function public.enforce_listing_request_response_transition()
  from public, anon, authenticated, service_role;

drop trigger if exists requests_enforce_listing_request_response_transition on public.requests;
create trigger requests_enforce_listing_request_response_transition
  before update on public.requests
  for each row execute function public.enforce_listing_request_response_transition();

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create table private.listing_request_vendor_responses (
  actor_id uuid not null references public.profiles(id) on delete restrict,
  idempotency_key uuid not null,
  request_id uuid not null references public.requests(id) on delete restrict,
  decision text not null check (decision in ('accept', 'decline')),
  result_status text not null check (result_status in ('accepted', 'declined')),
  responded_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (actor_id, idempotency_key),
  unique (request_id),
  check (
    (decision = 'accept' and result_status = 'accepted')
    or (decision = 'decline' and result_status = 'declined')
  )
);
create index listing_request_vendor_responses_prune_idx
  on private.listing_request_vendor_responses(created_at, request_id);
alter table private.listing_request_vendor_responses enable row level security;
revoke all on table private.listing_request_vendor_responses
  from public, anon, authenticated, service_role;

create or replace function public.respond_to_listing_request(
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
  active_actor uuid;
  request_row public.requests%rowtype;
  existing_response private.listing_request_vendor_responses%rowtype;
  active_business uuid;
  active_membership uuid;
  exact_listing uuid;
  target_status text;
  response_at timestamptz;
  response_updated_at timestamptz;
begin
  if p_request_id is null
    or p_decision is null
    or p_decision not in ('accept', 'decline')
    or p_idempotency_key is null
    or p_idempotency_key::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    return query select null::uuid, 'invalid', null::text, null::timestamptz, null::timestamptz, false;
    return;
  end if;

  -- Do not distinguish authentication, suspension, membership, linkage, or
  -- business-state failures to callers.
  if actor is null or (select auth.role()) is distinct from 'authenticated' then
    return query select null::uuid, 'not_found', null::text, null::timestamptz, null::timestamptz, false;
    return;
  end if;

  select p.id into active_actor
  from public.profiles p
  where p.id = actor
    and not p.is_suspended
  for share;
  if active_actor is null then
    return query select null::uuid, 'not_found', null::text, null::timestamptz, null::timestamptz, false;
    return;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(actor::text || ':' || p_idempotency_key::text, 0)
  );

  select response.* into existing_response
  from private.listing_request_vendor_responses response
  where response.actor_id = actor
    and response.idempotency_key = p_idempotency_key;
  -- Lock order is deliberate: actor profile, actor/key advisory lock, request,
  -- business, exact membership, then listing.
  select r.* into request_row
  from public.requests r
  where r.id = p_request_id
  for no key update;
  if not found or request_row.listing_id is null or request_row.business_id is null then
    return query select null::uuid, 'not_found', null::text, null::timestamptz, null::timestamptz, false;
    return;
  end if;

  select business.id into active_business
  from public.businesses business
  where business.id = request_row.business_id
    and business.status = 'active'
  for share;
  if active_business is null then
    return query select null::uuid, 'not_found', null::text, null::timestamptz, null::timestamptz, false;
    return;
  end if;

  select membership.business_id into active_membership
  from public.business_memberships membership
  where membership.business_id = request_row.business_id
    and membership.profile_id = actor
    and membership.accepted_at is not null
    and membership.role in ('owner', 'manager', 'staff')
  for share;
  if active_membership is null then
    return query select null::uuid, 'not_found', null::text, null::timestamptz, null::timestamptz, false;
    return;
  end if;

  select listing.id into exact_listing
  from public.listings listing
  where listing.id = request_row.listing_id
    and listing.business_id = request_row.business_id
  for share;
  if exact_listing is null then
    return query select null::uuid, 'not_found', null::text, null::timestamptz, null::timestamptz, false;
    return;
  end if;

  -- A stored key is only a replay for a currently authorized actor.  This
  -- check intentionally comes after the request/business/membership locks.
  if existing_response.actor_id is not null then
    if existing_response.request_id = p_request_id
      and existing_response.decision = p_decision then
      if request_row.status is distinct from existing_response.result_status
        or request_row.vendor_responded_at is distinct from existing_response.responded_at then
        raise exception 'listing request response replay state is inconsistent';
      end if;
      return query select
        existing_response.request_id,
        'replayed',
        existing_response.result_status,
        existing_response.responded_at,
        request_row.updated_at,
        false;
    else
      return query select null::uuid, 'idempotency_key_reused', null::text, null::timestamptz, null::timestamptz, false;
    end if;
    return;
  end if;

  case p_decision
    when 'accept' then target_status := 'accepted';
    when 'decline' then target_status := 'declined';
    else
      return query select null::uuid, 'invalid', null::text, null::timestamptz, null::timestamptz, false;
      return;
  end case;

  if request_row.status in ('accepted', 'declined') then
    if request_row.status = target_status then
      return query select request_row.id, 'already_transitioned', request_row.status, request_row.vendor_responded_at, request_row.updated_at, false;
    else
      return query select request_row.id, 'conflict', request_row.status, request_row.vendor_responded_at, request_row.updated_at, false;
    end if;
    return;
  end if;
  if request_row.status <> 'open' or request_row.vendor_responded_at is not null then
    return query select null::uuid, 'not_found', null::text, null::timestamptz, null::timestamptz, false;
    return;
  end if;

  response_at := clock_timestamp();
  perform set_config('localhub.listing_request_response', '1', true);
  perform set_config('localhub.listing_request_response_request_id', request_row.id::text, true);
  perform set_config('localhub.listing_request_response_at', response_at::text, true);
  update public.requests request
  set status = target_status,
      vendor_responded_at = response_at
  where request.id = request_row.id
    and request.status = 'open'
    and request.vendor_responded_at is null
  returning request.updated_at into response_updated_at;
  if not found then
    raise exception 'listing request response transition was not applied';
  end if;
  perform set_config('localhub.listing_request_response', '', true);
  perform set_config('localhub.listing_request_response_request_id', '', true);
  perform set_config('localhub.listing_request_response_at', '', true);

  insert into private.listing_request_vendor_responses(
    actor_id, idempotency_key, request_id, decision, result_status, responded_at
  ) values (
    actor, p_idempotency_key, request_row.id, p_decision, target_status, response_at
  );

  insert into public.audit_events(actor_id, subject_type, subject_id, action, metadata)
  values (
    actor,
    'listing_request',
    request_row.id,
    case target_status
      when 'accepted' then 'listing_request.accepted'
      else 'listing_request.declined'
    end,
    jsonb_build_object(
      'from_status', 'open',
      'to_status', target_status,
      'business_id', request_row.business_id
    )
  );

  return query select request_row.id, 'transitioned', target_status, response_at, response_updated_at, false;
end;
$$;

create or replace function public.prune_listing_request_vendor_responses(
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
    raise exception 'invalid listing request vendor response prune batch size';
  end if;
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'service role is required';
  end if;

  with candidates as (
    select response.ctid
    from private.listing_request_vendor_responses response
    where response.created_at <= now() - interval '30 days'
    order by response.created_at, response.ctid
    limit p_batch_size
    for update skip locked
  ), deleted as (
    delete from private.listing_request_vendor_responses response
    using candidates
    where response.ctid = candidates.ctid
    returning response.ctid
  )
  select count(*)::integer into pruned from deleted;

  return pruned;
end;
$$;

-- PostgreSQL cannot replace a RETURNS TABLE signature in-place.  Recreate the
-- bounded request projections with the vendor response timestamp included.
drop function if exists public.list_customer_listing_requests(text);
create function public.list_customer_listing_requests(
  p_market_slug text
)
returns table(
  request_id uuid,
  request_number text,
  status text,
  vendor_responded_at timestamptz,
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
    r.id, r.request_number, r.status, r.vendor_responded_at, r.requested_action, r.created_at,
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

drop function if exists public.get_customer_listing_request(uuid);
create function public.get_customer_listing_request(
  p_request_id uuid
)
returns table(
  request_id uuid,
  request_number text,
  status text,
  vendor_responded_at timestamptz,
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
    r.id, r.request_number, r.status, r.vendor_responded_at, r.requested_action, r.created_at,
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

drop function if exists public.list_vendor_listing_requests();
create function public.list_vendor_listing_requests()
returns table(
  request_id uuid,
  request_number text,
  status text,
  vendor_responded_at timestamptz,
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
    r.id, r.request_number, r.status, r.vendor_responded_at, r.requested_action, r.created_at,
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

revoke update on public.requests from public, anon, authenticated, service_role;
drop policy if exists requests_owner_update on public.requests;
drop policy if exists requests_vendor_update on public.requests;

revoke all on function public.respond_to_listing_request(uuid, text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.respond_to_listing_request(uuid, text, uuid)
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
revoke all on function public.prune_listing_request_vendor_responses(integer)
  from public, anon, authenticated;
grant execute on function public.prune_listing_request_vendor_responses(integer)
  to service_role;

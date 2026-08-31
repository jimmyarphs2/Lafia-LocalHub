-- Bound authenticated draft writes, retain idempotency state for 30 days, and
-- hold the exact active taxonomy snapshot through each draft transaction.
-- Migrations 013-015 are already deployed and remain immutable.

do $$
declare
  save_definition text;
  taxonomy_definition text;
begin
  select pg_catalog.pg_get_functiondef(
    'public.save_listing_draft(uuid,integer,jsonb,uuid,uuid,uuid,bigint)'
      ::regprocedure
  )
  into save_definition;

  select pg_catalog.pg_get_functiondef(
    'private.resolve_listing_draft_taxonomy(uuid)'::regprocedure
  )
  into taxonomy_definition;

  if save_definition is null
    or pg_catalog.strpos(save_definition, 'idempotency_key_reused') = 0
    or pg_catalog.strpos(save_definition, 'draft_revision_conflict') = 0
    or pg_catalog.strpos(
      save_definition,
      'private.resolve_listing_draft_taxonomy'
    ) = 0
  then
    raise exception 'unexpected save_listing_draft baseline';
  end if;

  if taxonomy_definition is null
    or pg_catalog.strpos(
      taxonomy_definition,
      'private.is_supported_listing_schema_document'
    ) = 0
    or pg_catalog.strpos(taxonomy_definition, 'taxonomy_unavailable') = 0
  then
    raise exception 'unexpected listing taxonomy baseline';
  end if;
end;
$$;

create table private.listing_draft_actor_rate_limits (
  actor_id uuid not null
    references public.profiles(id) on delete cascade,
  scope text not null
    check (scope in ('listing_draft_create', 'listing_draft_save')),
  window_started_at timestamptz not null default now(),
  request_count integer not null default 0 check (request_count >= 0),
  updated_at timestamptz not null default now(),
  primary key (actor_id, scope)
);

alter table private.listing_draft_actor_rate_limits enable row level security;
revoke all on table private.listing_draft_actor_rate_limits
  from public, anon, authenticated, service_role;

create index listing_draft_actor_rate_limits_retention_idx
  on private.listing_draft_actor_rate_limits(updated_at);

create index listing_draft_create_requests_completed_retention_idx
  on private.listing_draft_create_requests(completed_at)
  where completed_at is not null;

create index listing_draft_create_requests_incomplete_retention_idx
  on private.listing_draft_create_requests(created_at)
  where completed_at is null;

create index listing_draft_create_requests_missing_result_retention_idx
  on private.listing_draft_create_requests(created_at)
  where listing_id is null;

create or replace function private.consume_listing_draft_rate_limit(
  p_scope text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  max_requests integer;
  window_seconds integer;
  current_count integer;
begin
  if actor is null or not public.is_active_profile(actor) then
    raise exception using errcode = '42501',
      message = 'active authentication is required';
  end if;

  case p_scope
    when 'listing_draft_create' then
      max_requests := 30;
      window_seconds := 86400;
    when 'listing_draft_save' then
      max_requests := 240;
      window_seconds := 3600;
    else
      raise exception 'invalid listing draft rate-limit scope';
  end case;

  insert into private.listing_draft_actor_rate_limits as limits (
    actor_id,
    scope,
    window_started_at,
    request_count,
    updated_at
  )
  values (actor, p_scope, now(), 1, now())
  on conflict (actor_id, scope) do update set
    window_started_at = case
      when limits.window_started_at
        <= now() - pg_catalog.make_interval(secs => window_seconds)
      then now()
      else limits.window_started_at
    end,
    request_count = case
      when limits.window_started_at
        <= now() - pg_catalog.make_interval(secs => window_seconds)
      then 1
      else limits.request_count + 1
    end,
    updated_at = now()
  returning request_count into current_count;

  return current_count <= max_requests;
end;
$$;

revoke all on function private.consume_listing_draft_rate_limit(text)
  from public, anon, authenticated, service_role;

create or replace function private.lock_active_listing_draft_taxonomy(
  p_market_id uuid,
  p_category_id uuid,
  p_listing_type_id uuid,
  p_listing_schema_id uuid,
  p_expected_schema_version integer,
  p_currency_code text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  locked_listing_type_code text;
  locked_schema_version integer;
  locked_schema_document jsonb;
begin
  perform 1
  from public.categories c
  where c.id = p_category_id
    and c.is_active
    and (c.market_id = p_market_id or c.market_id is null)
  for share of c;
  if not found then raise exception 'taxonomy_stale'; end if;

  perform 1
  from public.category_listing_type_mappings mapping
  where mapping.category_id = p_category_id
    and mapping.listing_type_id = p_listing_type_id
    and mapping.listing_schema_id = p_listing_schema_id
    and mapping.is_default
  for share of mapping;
  if not found then raise exception 'taxonomy_stale'; end if;

  select lt.code
  into locked_listing_type_code
  from public.listing_types lt
  where lt.id = p_listing_type_id
    and lt.is_active
  for share of lt;
  if not found then raise exception 'taxonomy_stale'; end if;

  select s.version, s.schema
  into locked_schema_version, locked_schema_document
  from public.listing_schemas s
  where s.id = p_listing_schema_id
    and s.listing_type_id = p_listing_type_id
    and s.status = 'published'
    and s.published_at is not null
  for share of s;
  if not found then raise exception 'taxonomy_stale'; end if;

  if locked_schema_version <> p_expected_schema_version then
    raise exception 'schema_stale';
  end if;
  if not private.is_supported_listing_schema_document(
    locked_schema_document,
    locked_schema_version,
    locked_listing_type_code
  ) then
    raise exception 'taxonomy_stale';
  end if;
  if p_currency_code is null
    or p_currency_code !~ '^[A-Z]{3}$'
    or exists (
      select 1
      from jsonb_array_elements(
        locked_schema_document -> 'fields'
      ) as fields(field)
      where fields.field ->> 'type' = 'money'
        and coalesce(fields.field ->> 'currency', p_currency_code)
          <> p_currency_code
    )
  then
    raise exception 'taxonomy_stale';
  end if;
end;
$$;

revoke all on function private.lock_active_listing_draft_taxonomy(
  uuid,
  uuid,
  uuid,
  uuid,
  integer,
  text
) from public, anon, authenticated, service_role;

alter function private.resolve_listing_draft_taxonomy(uuid)
  rename to resolve_listing_draft_taxonomy_core;

revoke all on function private.resolve_listing_draft_taxonomy_core(uuid)
  from public, anon, authenticated, service_role;

create or replace function private.resolve_listing_draft_taxonomy(
  p_business_id uuid
)
returns table (
  business_id uuid,
  business_name text,
  market_id uuid,
  location_id uuid,
  currency_code text,
  category_id uuid,
  category_slug text,
  listing_type_id uuid,
  listing_type_code text,
  listing_schema_id uuid,
  schema_key text,
  schema_version integer,
  schema_document jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  resolved record;
begin
  select * into resolved
  from private.resolve_listing_draft_taxonomy_core(p_business_id);
  if not found then raise exception 'taxonomy_unavailable'; end if;

  perform private.lock_active_listing_draft_taxonomy(
    resolved.market_id,
    resolved.category_id,
    resolved.listing_type_id,
    resolved.listing_schema_id,
    resolved.schema_version,
    resolved.currency_code
  );

  return query select
    resolved.business_id,
    resolved.business_name,
    resolved.market_id,
    resolved.location_id,
    resolved.currency_code,
    resolved.category_id,
    resolved.category_slug,
    resolved.listing_type_id,
    resolved.listing_type_code,
    resolved.listing_schema_id,
    resolved.schema_key,
    resolved.schema_version,
    resolved.schema_document;
end;
$$;

revoke all on function private.resolve_listing_draft_taxonomy(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.prune_listing_draft_internal_state(
  p_batch_size integer default 500
)
returns table (
  idempotency_rows_pruned integer,
  rate_limit_rows_pruned integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  removed_idempotency_rows integer := 0;
  removed_rate_limit_rows integer := 0;
begin
  if p_batch_size is null or p_batch_size not between 1 and 2000 then
    raise exception 'invalid listing draft cleanup batch size';
  end if;

  with victims as (
    select request.actor_id, request.idempotency_key
    from private.listing_draft_create_requests request
    where request.completed_at < now() - interval '30 days'
      or (
        request.completed_at is null
        and request.created_at < now() - interval '24 hours'
      )
      or (
        request.listing_id is null
        and request.completed_at is not null
        and request.completed_at < now() - interval '24 hours'
      )
    order by coalesce(request.completed_at, request.created_at)
    limit p_batch_size
    for update skip locked
  ), removed as (
    delete from private.listing_draft_create_requests request
    using victims
    where request.actor_id = victims.actor_id
      and request.idempotency_key = victims.idempotency_key
    returning request.actor_id
  )
  select count(*)::integer
  into removed_idempotency_rows
  from removed;

  with victims as (
    select limits.actor_id, limits.scope
    from private.listing_draft_actor_rate_limits limits
    where limits.updated_at < now() - interval '48 hours'
    order by limits.updated_at
    limit p_batch_size
    for update skip locked
  ), removed as (
    delete from private.listing_draft_actor_rate_limits limits
    using victims
    where limits.actor_id = victims.actor_id
      and limits.scope = victims.scope
    returning limits.actor_id
  )
  select count(*)::integer
  into removed_rate_limit_rows
  from removed;

  return query select
    removed_idempotency_rows,
    removed_rate_limit_rows;
end;
$$;

revoke execute on function public.prune_listing_draft_internal_state(integer)
  from public, anon, authenticated;
grant execute on function public.prune_listing_draft_internal_state(integer)
  to service_role;

alter function public.save_listing_draft(
  uuid,
  integer,
  jsonb,
  uuid,
  uuid,
  uuid,
  bigint
) rename to save_listing_draft_core;

alter function public.save_listing_draft_core(
  uuid,
  integer,
  jsonb,
  uuid,
  uuid,
  uuid,
  bigint
) set schema private;

revoke all on function private.save_listing_draft_core(
  uuid,
  integer,
  jsonb,
  uuid,
  uuid,
  uuid,
  bigint
) from public, anon, authenticated, service_role;

create or replace function public.save_listing_draft(
  p_expected_schema_id uuid,
  p_expected_schema_version integer,
  p_payload jsonb,
  p_listing_id uuid default null,
  p_business_id uuid default null,
  p_idempotency_key uuid default null,
  p_expected_revision bigint default null
)
returns table (
  listing_id uuid,
  business_id uuid,
  draft_revision bigint,
  listing_schema_id uuid,
  schema_key text,
  schema_version integer,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  locked_draft public.listings%rowtype;
  locked_currency_code text;
  open_draft_count integer;
begin
  if actor is null
    or not public.is_active_profile(actor)
    or jsonb_typeof(p_payload) <> 'object'
    or pg_column_size(p_payload) > 131072
    or (select count(*) from jsonb_object_keys(p_payload)) <> 2
    or exists (
      select 1 from jsonb_object_keys(p_payload) as keys(key)
      where keys.key not in ('slug', 'values')
    )
    or jsonb_typeof(p_payload -> 'slug') <> 'string'
    or coalesce(p_payload ->> 'slug', '')
      !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
    or char_length(p_payload ->> 'slug') > 100
    or jsonb_typeof(p_payload -> 'values') <> 'object'
    or p_expected_schema_id is null
    or p_expected_schema_version is null
  then
    raise exception 'invalid_draft_payload';
  end if;

  if p_listing_id is null then
    if p_business_id is null
      or p_idempotency_key is null
      or p_expected_revision is not null
      or not private.lock_active_business_manager(p_business_id, actor)
    then
      raise exception using errcode = '42501', message = 'draft_unavailable';
    end if;

    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        actor::text || ':' || p_idempotency_key::text,
        16016
      )
    );

    perform 1
    from private.listing_draft_create_requests request
    where request.actor_id = actor
      and request.idempotency_key = p_idempotency_key
    for update;
    if found then
      return query
      select
        result.listing_id,
        result.business_id,
        result.draft_revision,
        result.listing_schema_id,
        result.schema_key,
        result.schema_version,
        result.created_at,
        result.updated_at
      from private.save_listing_draft_core(
        p_expected_schema_id,
        p_expected_schema_version,
        p_payload,
        p_listing_id,
        p_business_id,
        p_idempotency_key,
        p_expected_revision
      ) as result;
      return;
    end if;

    if not private.consume_listing_draft_rate_limit(
      'listing_draft_create'
    ) then
      raise exception 'draft_create_rate_limit_exceeded';
    end if;

    select count(*)::integer
    into open_draft_count
    from public.listings listing
    where listing.business_id = p_business_id
      and listing.status = 'draft';
    if open_draft_count >= 50 then
      raise exception 'draft_open_limit_exceeded';
    end if;

    perform 1
    from private.resolve_listing_draft_taxonomy(p_business_id);

    perform 1
    from public.prune_listing_draft_internal_state(25);
  else
    if p_business_id is not null
      or p_idempotency_key is not null
      or p_expected_revision is null
      or p_expected_revision <= 0
    then
      raise exception 'invalid_draft_mode';
    end if;

    select listing.*
    into locked_draft
    from public.listings listing
    where listing.id = p_listing_id
      and listing.status = 'draft'
    for no key update of listing;
    if not found
      or not private.lock_active_business_manager(
        locked_draft.business_id,
        actor
      )
    then
      raise exception using errcode = '42501', message = 'draft_unavailable';
    end if;

    select market.currency_code::text
    into locked_currency_code
    from public.businesses business
    join public.markets market
      on market.id = business.market_id
      and market.id = locked_draft.market_id
      and market.is_active
    where business.id = locked_draft.business_id
      and business.status in ('pending_review', 'active');
    if not found then
      raise exception using errcode = '42501', message = 'draft_unavailable';
    end if;

    if not private.consume_listing_draft_rate_limit(
      'listing_draft_save'
    ) then
      raise exception 'draft_save_rate_limit_exceeded';
    end if;

    perform private.lock_active_listing_draft_taxonomy(
      locked_draft.market_id,
      locked_draft.category_id,
      locked_draft.listing_type_id,
      locked_draft.listing_schema_id,
      p_expected_schema_version,
      locked_currency_code
    );

    perform 1
    from public.prune_listing_draft_internal_state(25);
  end if;

  return query
  select
    result.listing_id,
    result.business_id,
    result.draft_revision,
    result.listing_schema_id,
    result.schema_key,
    result.schema_version,
    result.created_at,
    result.updated_at
  from private.save_listing_draft_core(
    p_expected_schema_id,
    p_expected_schema_version,
    p_payload,
    p_listing_id,
    p_business_id,
    p_idempotency_key,
    p_expected_revision
  ) as result;
end;
$$;

revoke execute on function public.save_listing_draft(
  uuid,
  integer,
  jsonb,
  uuid,
  uuid,
  uuid,
  bigint
) from public, anon, authenticated;
grant execute on function public.save_listing_draft(
  uuid,
  integer,
  jsonb,
  uuid,
  uuid,
  uuid,
  bigint
) to authenticated;

notify pgrst, 'reload schema';

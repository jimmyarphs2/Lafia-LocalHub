-- Step 28A establishes one internal, provider-neutral GREEN tool boundary. The
-- tool is a market-scoped public-catalogue footprint, not an operational
-- dashboard. No route, AI/provider call, external action, or domain mutation is
-- introduced by this migration.

begin;

set local lock_timeout = '10s';
set local statement_timeout = '120s';

lock table
  public.profiles,
  public.profile_capabilities,
  public.markets,
  public.categories,
  public.businesses,
  public.listings,
  public.listing_variants,
  public.audit_events
in share row exclusive mode;

do $$
begin
  if pg_catalog.to_regclass(
      'private.tool_gateway_actor_rate_limits'
    ) is not null
    or pg_catalog.to_regprocedure(
      'private.consume_tool_gateway_read_rate_limit(uuid,timestamptz)'
    ) is not null
    or pg_catalog.to_regprocedure(
      'private.prevent_tool_gateway_platform_summary_audit_mutation()'
    ) is not null
    or pg_catalog.to_regprocedure(
      'public.get_tool_gateway_platform_summary(uuid,text)'
    ) is not null
    or exists (
      select 1
      from pg_catalog.pg_trigger trigger_record
      where trigger_record.tgname =
        'audit_events_protect_tool_gateway_platform_summary'
        and not trigger_record.tgisinternal
    )
    or pg_catalog.to_regclass(
      'public.audit_events_tool_gateway_platform_summary_invocation_idx'
    ) is not null
  then
    raise exception
      'tool-gateway precondition failed: no partial Step 28A objects'
      using errcode = '55000';
  end if;

  if exists (
    select 1
    from public.audit_events audit_record
    where audit_record.action = 'tool_gateway.get_platform_summary'
  ) then
    raise exception
      'tool-gateway precondition failed: protected action already exists'
      using errcode = '55000';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_class relation_record
    where relation_record.oid = 'public.audit_events'::pg_catalog.regclass
      and relation_record.relkind = 'r'
      and relation_record.relrowsecurity
      and pg_catalog.pg_get_userbyid(relation_record.relowner) = 'postgres'
  ) or not exists (
    select 1
    from pg_catalog.pg_trigger trigger_record
    where trigger_record.tgrelid = 'public.audit_events'::pg_catalog.regclass
      and trigger_record.tgname =
        'audit_events_protect_listing_order_fulfilment_processing'
      and trigger_record.tgenabled in ('O', 'A')
      and not trigger_record.tgisinternal
  ) then
    raise exception 'tool-gateway requires the intact shared audit foundation'
      using errcode = '55000';
  end if;
end;
$$;

create table private.tool_gateway_actor_rate_limits (
  actor_id uuid primary key
    references public.profiles(id) on delete cascade,
  window_started_at timestamptz not null,
  request_count smallint not null
    check (request_count >= 1 and request_count <= 61),
  updated_at timestamptz not null,
  check (updated_at >= window_started_at)
);

alter table private.tool_gateway_actor_rate_limits owner to postgres;
alter table private.tool_gateway_actor_rate_limits enable row level security;
alter table private.tool_gateway_actor_rate_limits force row level security;
revoke all on table private.tool_gateway_actor_rate_limits
  from public, anon, authenticated, service_role;

create function private.consume_tool_gateway_read_rate_limit(
  p_actor uuid,
  p_observed_at timestamptz
)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_window timestamptz := pg_catalog.date_trunc(
    'hour', p_observed_at, 'UTC'
  );
  existing private.tool_gateway_actor_rate_limits%rowtype;
  inserted_count integer;
begin
  if p_actor is null or p_observed_at is null then
    raise exception 'invalid tool-gateway limiter request'
      using errcode = '22023';
  end if;

  insert into private.tool_gateway_actor_rate_limits(
    actor_id, window_started_at, request_count, updated_at
  ) values (p_actor, current_window, 1, p_observed_at)
  on conflict (actor_id) do nothing;
  get diagnostics inserted_count = row_count;
  if inserted_count = 1 then
    return 'allowed';
  end if;

  select limit_record.*
  into strict existing
  from private.tool_gateway_actor_rate_limits limit_record
  where limit_record.actor_id = p_actor
  for update;

  if existing.window_started_at < current_window then
    update private.tool_gateway_actor_rate_limits limit_record
    set window_started_at = current_window,
        request_count = 1,
        updated_at = p_observed_at
    where limit_record.actor_id = p_actor;
    return 'allowed';
  end if;
  if existing.window_started_at > current_window then
    raise exception 'tool-gateway limiter clock moved backwards'
      using errcode = '55000';
  end if;
  if existing.request_count < 60 then
    update private.tool_gateway_actor_rate_limits limit_record
    set request_count = limit_record.request_count + 1,
        updated_at = p_observed_at
    where limit_record.actor_id = p_actor;
    return 'allowed';
  end if;
  if existing.request_count = 60 then
    update private.tool_gateway_actor_rate_limits limit_record
    set request_count = 61,
        updated_at = p_observed_at
    where limit_record.actor_id = p_actor;
    return 'first_limited';
  end if;
  return 'limited';
end;
$$;
alter function private.consume_tool_gateway_read_rate_limit(uuid, timestamptz)
  owner to postgres;
revoke all on function private.consume_tool_gateway_read_rate_limit(
  uuid, timestamptz
) from public, anon, authenticated, service_role;

create function private.prevent_tool_gateway_platform_summary_audit_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_action constant text := 'tool_gateway.get_platform_summary';
  expected_audit_id text := nullif(
    current_setting('localhub.tool_gateway_audit_id', true), ''
  );
  expected_actor text := nullif(
    current_setting('localhub.tool_gateway_actor', true), ''
  );
  expected_invocation text := nullif(
    current_setting('localhub.tool_gateway_invocation_id', true), ''
  );
  expected_outcome text := nullif(
    current_setting('localhub.tool_gateway_outcome', true), ''
  );
  expected_subject_id text := nullif(
    current_setting('localhub.tool_gateway_subject_id', true), ''
  );
  expected_subject_type text := nullif(
    current_setting('localhub.tool_gateway_subject_type', true), ''
  );
  expected_time text := nullif(
    current_setting('localhub.tool_gateway_observed_at', true), ''
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

  if tg_op = 'UPDATE'
    and old.action = target_action
    and new.action = target_action
    and old.actor_id is not null
    and new.actor_id is null
    and (pg_catalog.to_jsonb(new) - 'actor_id') is not distinct from
        (pg_catalog.to_jsonb(old) - 'actor_id')
    and not exists (
      select 1
      from public.profiles profile_record
      where profile_record.id = old.actor_id
    ) then
    return new;
  end if;
  if tg_op <> 'INSERT' then
    raise exception 'tool-gateway audit evidence is immutable';
  end if;

  if current_user is distinct from pg_catalog.pg_get_userbyid((
      select routine_record.proowner
      from pg_catalog.pg_proc routine_record
      where routine_record.oid =
        'public.get_tool_gateway_platform_summary(uuid,text)'
          ::pg_catalog.regprocedure
    ))
    or current_setting('localhub.tool_gateway_platform_summary', true)
      is distinct from '1'
    or expected_audit_id is distinct from new.id::text
    or expected_actor is distinct from new.actor_id::text
    or expected_invocation is null
    or expected_outcome not in (
      'succeeded', 'invalid_input', 'market_not_found', 'rate_limited'
    )
    or expected_subject_id is distinct from new.subject_id::text
    or expected_subject_type is distinct from new.subject_type
    or expected_time is null
    or new.action is distinct from target_action
    or new.created_at is distinct from expected_time::timestamptz
    or new.metadata is distinct from pg_catalog.jsonb_build_object(
      'contract_version', 1,
      'invocation_id', expected_invocation,
      'outcome', expected_outcome,
      'tool_name', 'get_platform_summary'
    )
    or (
      expected_outcome = 'succeeded'
      and expected_subject_type is distinct from 'market'
    )
    or (
      expected_outcome <> 'succeeded'
      and (
        expected_subject_type is distinct from 'tool_gateway_invocation'
        or expected_subject_id is distinct from expected_invocation
      )
    )
  then
    raise exception 'invalid tool-gateway platform-summary audit insert';
  end if;
  return new;
end;
$$;
alter function private.prevent_tool_gateway_platform_summary_audit_mutation()
  owner to postgres;
revoke all on function
  private.prevent_tool_gateway_platform_summary_audit_mutation()
  from public, anon, authenticated, service_role;

create trigger audit_events_protect_tool_gateway_platform_summary
  before insert or update or delete on public.audit_events
  for each row execute function
    private.prevent_tool_gateway_platform_summary_audit_mutation();
alter table public.audit_events enable always trigger
  audit_events_protect_tool_gateway_platform_summary;

create unique index
  audit_events_tool_gateway_platform_summary_invocation_idx
on public.audit_events ((metadata ->> 'invocation_id'))
where action = 'tool_gateway.get_platform_summary';

create function public.get_tool_gateway_platform_summary(
  p_invocation_id uuid,
  p_market_slug text
)
returns table(
  invocation_id uuid,
  audit_event_id uuid,
  outcome text,
  observed_at timestamptz,
  market_id uuid,
  market_slug text,
  market_name text,
  country_code text,
  currency_code text,
  timezone text,
  active_category_count bigint,
  active_vendor_count bigint,
  published_listing_count bigint,
  orderable_listing_count bigint
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  audit_id uuid;
  selected_market public.markets%rowtype;
  selected_market_id uuid;
  observed_time timestamptz := pg_catalog.statement_timestamp();
  rate_outcome text;
  result_outcome text;
  result_category_count bigint;
  result_vendor_count bigint;
  result_listing_count bigint;
  result_orderable_count bigint;
  audit_subject_id uuid;
  audit_subject_type text;
begin
  if (select auth.role()) is distinct from 'authenticated' or actor is null then
    raise exception 'tool authorization failed' using errcode = '42501';
  end if;

  perform 1
  from public.profiles profile_record
  where profile_record.id = actor
    and not profile_record.is_suspended
  for share;
  if not found then
    raise exception 'tool authorization failed' using errcode = '42501';
  end if;

  perform 1
  from public.profile_capabilities capability_record
  where capability_record.profile_id = actor
    and capability_record.capability = 'super_admin'
  for share;
  if not found then
    raise exception 'tool authorization failed' using errcode = '42501';
  end if;

  if p_invocation_id is null
    or p_invocation_id::text !~
      '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  then
    raise exception 'invalid tool invocation identifier' using errcode = '22023';
  end if;

  select private.consume_tool_gateway_read_rate_limit(actor, observed_time)
  into strict rate_outcome;

  if rate_outcome = 'limited' then
    return query select
      p_invocation_id, null::uuid, 'rate_limited', observed_time,
      null::uuid, null::text, null::text, null::text, null::text, null::text,
      null::bigint, null::bigint, null::bigint, null::bigint;
    return;
  end if;

  if rate_outcome = 'first_limited' then
    result_outcome := 'rate_limited';
  elsif p_market_slug is null
    or pg_catalog.octet_length(p_market_slug) not between 1 and 63
    or p_market_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
  then
    result_outcome := 'invalid_input';
  else
    select market_record.*
    into selected_market
    from public.markets market_record
    where market_record.slug = p_market_slug
      and market_record.is_active
    for share;

    if not found then
      result_outcome := 'market_not_found';
    else
      selected_market_id := selected_market.id;
      result_outcome := 'succeeded';

      -- All aggregates share this one SQL statement snapshot and use the same
      -- explicit public-catalogue predicates as the live read model.
      select
        (
          select pg_catalog.count(*)
          from public.categories category_record
          where category_record.is_active
            and (
              category_record.market_id is null
              or category_record.market_id = selected_market_id
            )
        ),
        (
          select pg_catalog.count(*)
          from public.businesses business_record
          where business_record.market_id = selected_market_id
            and business_record.status = 'active'
        ),
        (
          select pg_catalog.count(*)
          from public.listings listing_record
          join public.businesses business_record
            on business_record.id = listing_record.business_id
            and business_record.market_id = selected_market_id
            and business_record.status = 'active'
          join public.categories category_record
            on category_record.id = listing_record.category_id
            and category_record.is_active
            and (
              category_record.market_id is null
              or category_record.market_id = selected_market_id
            )
          where listing_record.market_id = selected_market_id
            and listing_record.status = 'active'
            and listing_record.published_at is not null
        ),
        (
          select pg_catalog.count(*)
          from public.listings listing_record
          join public.businesses business_record
            on business_record.id = listing_record.business_id
            and business_record.market_id = selected_market_id
            and business_record.status = 'active'
          join public.categories category_record
            on category_record.id = listing_record.category_id
            and category_record.is_active
            and (
              category_record.market_id is null
              or category_record.market_id = selected_market_id
            )
          where listing_record.market_id = selected_market_id
            and listing_record.status = 'active'
            and listing_record.published_at is not null
            and listing_record.is_orderable
            and listing_record.price_minor > 0
            and listing_record.currency_code = selected_market.currency_code
            and not exists (
              select 1
              from public.listing_variants variant_record
              where variant_record.listing_id = listing_record.id
                and variant_record.is_active
            )
        )
      into
        result_category_count,
        result_vendor_count,
        result_listing_count,
        result_orderable_count;
    end if;
  end if;

  audit_id := extensions.gen_random_uuid();
  if result_outcome = 'succeeded' then
    audit_subject_type := 'market';
    audit_subject_id := selected_market_id;
  else
    audit_subject_type := 'tool_gateway_invocation';
    audit_subject_id := p_invocation_id;
  end if;

  perform pg_catalog.set_config(
    'localhub.tool_gateway_platform_summary', '1', true
  );
  perform pg_catalog.set_config(
    'localhub.tool_gateway_audit_id', audit_id::text, true
  );
  perform pg_catalog.set_config(
    'localhub.tool_gateway_actor', actor::text, true
  );
  perform pg_catalog.set_config(
    'localhub.tool_gateway_invocation_id', p_invocation_id::text, true
  );
  perform pg_catalog.set_config(
    'localhub.tool_gateway_outcome', result_outcome, true
  );
  perform pg_catalog.set_config(
    'localhub.tool_gateway_subject_id', audit_subject_id::text, true
  );
  perform pg_catalog.set_config(
    'localhub.tool_gateway_subject_type', audit_subject_type, true
  );
  perform pg_catalog.set_config(
    'localhub.tool_gateway_observed_at', observed_time::text, true
  );

  insert into public.audit_events(
    id, actor_id, subject_type, subject_id, action, metadata, created_at
  ) values (
    audit_id,
    actor,
    audit_subject_type,
    audit_subject_id,
    'tool_gateway.get_platform_summary',
    pg_catalog.jsonb_build_object(
      'contract_version', 1,
      'invocation_id', p_invocation_id::text,
      'outcome', result_outcome,
      'tool_name', 'get_platform_summary'
    ),
    observed_time
  );

  perform pg_catalog.set_config(
    'localhub.tool_gateway_platform_summary', '', true
  );
  perform pg_catalog.set_config('localhub.tool_gateway_audit_id', '', true);
  perform pg_catalog.set_config('localhub.tool_gateway_actor', '', true);
  perform pg_catalog.set_config(
    'localhub.tool_gateway_invocation_id', '', true
  );
  perform pg_catalog.set_config('localhub.tool_gateway_outcome', '', true);
  perform pg_catalog.set_config('localhub.tool_gateway_subject_id', '', true);
  perform pg_catalog.set_config('localhub.tool_gateway_subject_type', '', true);
  perform pg_catalog.set_config('localhub.tool_gateway_observed_at', '', true);

  if result_outcome = 'succeeded' then
    return query select
      p_invocation_id,
      audit_id,
      result_outcome,
      observed_time,
      selected_market.id,
      selected_market.slug,
      selected_market.name,
      selected_market.country_code::text,
      selected_market.currency_code::text,
      selected_market.timezone,
      result_category_count,
      result_vendor_count,
      result_listing_count,
      result_orderable_count;
  else
    return query select
      p_invocation_id, audit_id, result_outcome, observed_time,
      null::uuid, null::text, null::text, null::text, null::text, null::text,
      null::bigint, null::bigint, null::bigint, null::bigint;
  end if;
end;
$$;
alter function public.get_tool_gateway_platform_summary(uuid, text)
  owner to postgres;
revoke all on function public.get_tool_gateway_platform_summary(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.get_tool_gateway_platform_summary(uuid, text)
  to authenticated;

do $$
declare
  function_record pg_catalog.pg_proc%rowtype;
  privilege_name text;
  role_name text;
begin
  if not exists (
    select 1
    from pg_catalog.pg_class relation_record
    where relation_record.oid =
        'private.tool_gateway_actor_rate_limits'::pg_catalog.regclass
      and relation_record.relrowsecurity
      and relation_record.relforcerowsecurity
      and pg_catalog.pg_get_userbyid(relation_record.relowner) = 'postgres'
  ) or exists (
    select 1
    from pg_catalog.pg_policies policy_record
    where policy_record.schemaname = 'private'
      and policy_record.tablename = 'tool_gateway_actor_rate_limits'
  ) or exists (
    select 1
    from private.tool_gateway_actor_rate_limits
  ) then
    raise exception 'tool-gateway limiter postcondition failed'
      using errcode = '55000';
  end if;

  foreach role_name in array array['anon', 'authenticated', 'service_role'] loop
    foreach privilege_name in array array[
      'select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger'
    ] loop
      if pg_catalog.has_table_privilege(
        role_name,
        'private.tool_gateway_actor_rate_limits',
        privilege_name
      ) then
        raise exception 'tool-gateway limiter ACL postcondition failed'
          using errcode = '55000';
      end if;
    end loop;
  end loop;

  select routine_record.*
  into strict function_record
  from pg_catalog.pg_proc routine_record
  where routine_record.oid =
    'public.get_tool_gateway_platform_summary(uuid,text)'
      ::pg_catalog.regprocedure;
  if not function_record.prosecdef
    or function_record.provolatile <> 'v'
    or pg_catalog.pg_get_userbyid(function_record.proowner) <> 'postgres'
    or not pg_catalog.coalesce(function_record.proconfig, array[]::text[])
      @> array['search_path=""']::text[]
  then
    raise exception 'tool-gateway RPC postcondition failed'
      using errcode = '55000';
  end if;

  if not pg_catalog.has_function_privilege(
      'authenticated',
      'public.get_tool_gateway_platform_summary(uuid,text)',
      'execute'
    ) or pg_catalog.has_function_privilege(
      'anon',
      'public.get_tool_gateway_platform_summary(uuid,text)',
      'execute'
    ) or pg_catalog.has_function_privilege(
      'service_role',
      'public.get_tool_gateway_platform_summary(uuid,text)',
      'execute'
    )
  then
    raise exception 'tool-gateway RPC grant postcondition failed'
      using errcode = '55000';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_trigger trigger_record
    where trigger_record.tgrelid = 'public.audit_events'::pg_catalog.regclass
      and trigger_record.tgname =
        'audit_events_protect_tool_gateway_platform_summary'
      and trigger_record.tgenabled = 'A'
      and not trigger_record.tgisinternal
  ) or exists (
    select 1
    from pg_catalog.pg_publication_tables publication_record
    where publication_record.schemaname = 'private'
      and publication_record.tablename = 'tool_gateway_actor_rate_limits'
  ) then
    raise exception 'tool-gateway audit or Realtime postcondition failed'
      using errcode = '55000';
  end if;
end;
$$;

comment on table private.tool_gateway_actor_rate_limits is
  'Bounded one-row-per-actor fixed-window state for internal LocalHub GREEN read tools.';
comment on function public.get_tool_gateway_platform_summary(uuid, text) is
  'Step 28A authenticated super-admin, one-market public-catalogue footprint with bounded rate and immutable audit evidence.';

commit;

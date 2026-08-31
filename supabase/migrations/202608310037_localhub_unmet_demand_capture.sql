-- Step 27 records only an explicitly confirmed, private, category-level daily
-- zero-supply marker. It does not activate legacy demand relations, dormant
-- definitions, missions, referrals, economics, providers, delivery, or AI.

begin;

set local lock_timeout = '10s';
set local statement_timeout = '120s';

lock table
  public.profiles,
  public.markets,
  public.categories,
  public.businesses,
  public.listings,
  public.searches,
  public.search_intents,
  public.demand_signals,
  public.unmet_demand,
  public.missions,
  public.mission_progress,
  private.demand_gap_definitions,
  private.referral_mission_definitions
in share row exclusive mode;

do $$
declare
  blocker_function pg_catalog.pg_proc%rowtype;
  privilege_name text;
  relation_name text;
  role_name text;
begin
  if exists (select 1 from public.searches)
    or exists (select 1 from public.search_intents)
    or exists (select 1 from public.demand_signals)
    or exists (select 1 from public.unmet_demand)
    or exists (select 1 from public.missions)
    or exists (select 1 from public.mission_progress)
    or exists (select 1 from private.demand_gap_definitions)
    or exists (select 1 from private.referral_mission_definitions)
  then
    raise exception
      'unmet-demand capture requires empty quarantined and dormant relations'
      using errcode = '55000';
  end if;

  if pg_catalog.to_regclass(
      'private.unmet_demand_zero_result_days'
    ) is not null
    or pg_catalog.to_regprocedure(
      'private.prevent_unmet_demand_zero_result_change()'
    ) is not null
    or pg_catalog.to_regprocedure(
      'public.record_my_unmet_demand_zero_result(text,uuid)'
    ) is not null
    or exists (
      select 1
      from pg_catalog.pg_trigger trigger_record
      where trigger_record.tgname = any (array[
        'unmet_demand_zero_result_days_immutable_rows',
        'unmet_demand_zero_result_days_immutable_truncate'
      ])
        and not trigger_record.tgisinternal
    )
  then
    raise exception
      'unmet-demand capture precondition failed: no partial unmet-demand capture objects'
      using errcode = '55000';
  end if;

  if pg_catalog.to_regprocedure(
      'private.prevent_dormant_demand_mission_mutation()'
    ) is null
    or pg_catalog.to_regprocedure(
      'private.prevent_dormant_demand_referral_mission_mutation()'
    ) is null
  then
    raise exception 'unmet-demand capture requires intact mutation blockers'
      using errcode = '55000';
  end if;

  select routine_record.*
  into strict blocker_function
  from pg_catalog.pg_proc routine_record
  where routine_record.oid =
    'private.prevent_dormant_demand_mission_mutation()'::pg_catalog.regprocedure;

  foreach relation_name in array array[
    'public.searches',
    'public.search_intents',
    'public.demand_signals',
    'public.unmet_demand',
    'public.missions',
    'public.mission_progress'
  ] loop
    if not exists (
      select 1
      from pg_catalog.pg_class relation_record
      where relation_record.oid = relation_name::pg_catalog.regclass
        and relation_record.relkind = 'r'
        and relation_record.relrowsecurity
        and relation_record.relforcerowsecurity
        and pg_catalog.pg_get_userbyid(relation_record.relowner) = 'postgres'
    ) or exists (
      select 1
      from pg_catalog.pg_policies policy_record
      where policy_record.schemaname = 'public'
        and policy_record.tablename = pg_catalog.split_part(relation_name, '.', 2)
    ) or (
      select count(*)
      from pg_catalog.pg_trigger trigger_record
      where trigger_record.tgrelid = relation_name::pg_catalog.regclass
        and trigger_record.tgfoid = blocker_function.oid
        and trigger_record.tgenabled = 'A'
        and not trigger_record.tgisinternal
    ) <> 2 then
      raise exception 'unmet-demand capture requires intact legacy demand quarantine'
        using errcode = '55000';
    end if;
  end loop;

  select routine_record.*
  into strict blocker_function
  from pg_catalog.pg_proc routine_record
  where routine_record.oid =
    'private.prevent_dormant_demand_referral_mission_mutation()'::pg_catalog.regprocedure;

  foreach relation_name in array array[
    'private.demand_gap_definitions',
    'private.referral_mission_definitions'
  ] loop
    if not exists (
      select 1
      from pg_catalog.pg_class relation_record
      where relation_record.oid = relation_name::pg_catalog.regclass
        and relation_record.relkind = 'r'
        and relation_record.relrowsecurity
        and relation_record.relforcerowsecurity
        and pg_catalog.pg_get_userbyid(relation_record.relowner) = 'postgres'
    ) or exists (
      select 1
      from pg_catalog.pg_policies policy_record
      where policy_record.schemaname = 'private'
        and policy_record.tablename = pg_catalog.split_part(relation_name, '.', 2)
    ) or (
      select count(*)
      from pg_catalog.pg_trigger trigger_record
      where trigger_record.tgrelid = relation_name::pg_catalog.regclass
        and trigger_record.tgfoid = blocker_function.oid
        and trigger_record.tgenabled = 'A'
        and not trigger_record.tgisinternal
    ) <> 2 then
      raise exception 'unmet-demand capture requires intact dormant definitions'
        using errcode = '55000';
    end if;
  end loop;

  foreach relation_name in array array[
    'public.searches',
    'public.search_intents',
    'public.demand_signals',
    'public.unmet_demand',
    'public.missions',
    'public.mission_progress',
    'private.demand_gap_definitions',
    'private.referral_mission_definitions'
  ] loop
    foreach role_name in array array['anon', 'authenticated', 'service_role'] loop
      foreach privilege_name in array array[
        'select',
        'insert',
        'update',
        'delete',
        'truncate',
        'maintain',
        'references',
        'trigger'
      ] loop
        if pg_catalog.has_table_privilege(
          role_name,
          relation_name,
          privilege_name
        ) then
          raise exception 'unmet-demand capture requires closed quarantine ACLs'
            using errcode = '55000';
        end if;
      end loop;

      foreach privilege_name in array array[
        'select', 'insert', 'update', 'references'
      ] loop
        if pg_catalog.has_any_column_privilege(
          role_name,
          relation_name,
          privilege_name
        ) then
          raise exception 'unmet-demand capture requires closed column ACLs'
            using errcode = '55000';
        end if;
      end loop;
    end loop;
  end loop;
end;
$$;

create table private.unmet_demand_zero_result_days (
  market_id uuid not null
    references public.markets(id) on delete restrict,
  category_id uuid not null
    references public.categories(id) on delete restrict,
  observed_on date not null,
  created_at timestamptz not null default pg_catalog.statement_timestamp(),
  primary key (market_id, category_id, observed_on)
);

alter table private.unmet_demand_zero_result_days owner to postgres;
alter table private.unmet_demand_zero_result_days enable row level security;
alter table private.unmet_demand_zero_result_days force row level security;

revoke all on table private.unmet_demand_zero_result_days
  from public, anon, authenticated, service_role;
revoke all privileges (
  market_id,
  category_id,
  observed_on,
  created_at
) on table private.unmet_demand_zero_result_days
  from public, anon, authenticated, service_role;

create function private.prevent_unmet_demand_zero_result_change()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'unmet-demand observations are immutable'
    using errcode = '55000';
end;
$$;

alter function private.prevent_unmet_demand_zero_result_change()
  owner to postgres;
revoke all on function private.prevent_unmet_demand_zero_result_change()
  from public, anon, authenticated, service_role;

create trigger unmet_demand_zero_result_days_immutable_rows
before update or delete on private.unmet_demand_zero_result_days
for each row
execute function private.prevent_unmet_demand_zero_result_change();

create trigger unmet_demand_zero_result_days_immutable_truncate
before truncate on private.unmet_demand_zero_result_days
for each statement
execute function private.prevent_unmet_demand_zero_result_change();

alter table private.unmet_demand_zero_result_days
  enable always trigger unmet_demand_zero_result_days_immutable_rows;
alter table private.unmet_demand_zero_result_days
  enable always trigger unmet_demand_zero_result_days_immutable_truncate;

create function public.record_my_unmet_demand_zero_result(
  p_market_slug text,
  p_category_id uuid
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  eligible boolean;
  inserted boolean;
begin
  with eligibility as materialized (
    select
      market_record.id as market_id,
      category_record.id as category_id,
      pg_catalog.timezone(
        market_record.timezone,
        pg_catalog.statement_timestamp()
      )::date as observed_on
    from public.profiles profile_record
    join public.markets market_record
      on market_record.slug = p_market_slug
      and market_record.is_active
    join pg_catalog.pg_timezone_names timezone_record
      on timezone_record.name = market_record.timezone
    join public.categories category_record
      on category_record.id = p_category_id
      and category_record.is_active
      and (
        category_record.market_id is null
        or category_record.market_id = market_record.id
      )
    where profile_record.id = (select auth.uid())
      and not profile_record.is_suspended
      and not exists (
        select 1
        from public.listings listing_record
        join public.businesses business_record
          on business_record.id = listing_record.business_id
          and business_record.market_id = market_record.id
          and business_record.status = 'active'
        where listing_record.market_id = market_record.id
          and listing_record.category_id = category_record.id
          and listing_record.status = 'active'
          and listing_record.published_at is not null
      )
  ), write_result as (
    insert into private.unmet_demand_zero_result_days (
      market_id,
      category_id,
      observed_on
    )
    select
      eligibility.market_id,
      eligibility.category_id,
      eligibility.observed_on
    from eligibility
    on conflict (market_id, category_id, observed_on) do nothing
    returning true
  )
  select
    exists (select 1 from eligibility),
    exists (select 1 from write_result)
  into eligible, inserted;

  if not eligible then
    raise exception 'unmet-demand observation unavailable'
      using errcode = 'P0001';
  end if;

  -- `inserted` is intentionally not returned. A first write and an eligible
  -- replay have the same non-oracular result.
  return true;
end;
$$;

alter function public.record_my_unmet_demand_zero_result(text, uuid)
  owner to postgres;
revoke all on function public.record_my_unmet_demand_zero_result(text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.record_my_unmet_demand_zero_result(text, uuid)
  to authenticated;

comment on table private.unmet_demand_zero_result_days is
  'Private low-trust binary market/category/day zero-supply observations. No actor, text, count, reader, or automated consumer.';
comment on function public.record_my_unmet_demand_zero_result(text, uuid) is
  'Authenticated fixed-input writer. Returns the same success for an eligible first write or replay.';

do $$
declare
  actual_columns text[];
  function_record pg_catalog.pg_proc%rowtype;
  privilege_name text;
  role_name text;
begin
  select pg_catalog.array_agg(
    attribute_record.attname || ':' ||
      pg_catalog.format_type(
        attribute_record.atttypid,
        attribute_record.atttypmod
      )
    order by attribute_record.attnum
  )
  into actual_columns
  from pg_catalog.pg_attribute attribute_record
  where attribute_record.attrelid =
      'private.unmet_demand_zero_result_days'::pg_catalog.regclass
    and attribute_record.attnum > 0
    and not attribute_record.attisdropped;

  if actual_columns is distinct from array[
    'market_id:uuid',
    'category_id:uuid',
    'observed_on:date',
    'created_at:timestamp with time zone'
  ]::text[] then
    raise exception 'unmet-demand capture postcondition failed: columns drifted'
      using errcode = '55000';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_class relation_record
    where relation_record.oid =
        'private.unmet_demand_zero_result_days'::pg_catalog.regclass
      and relation_record.relkind = 'r'
      and relation_record.relrowsecurity
      and relation_record.relforcerowsecurity
      and pg_catalog.pg_get_userbyid(relation_record.relowner) = 'postgres'
  ) or exists (
    select 1
    from pg_catalog.pg_policies policy_record
    where policy_record.schemaname = 'private'
      and policy_record.tablename = 'unmet_demand_zero_result_days'
  ) or exists (
    select 1
    from pg_catalog.pg_publication_tables publication_record
    where publication_record.schemaname = 'private'
      and publication_record.tablename = 'unmet_demand_zero_result_days'
  ) or exists (
    select 1
    from private.unmet_demand_zero_result_days
  ) then
    raise exception 'unmet-demand capture postcondition failed: relation safety drifted'
      using errcode = '55000';
  end if;

  foreach role_name in array array['anon', 'authenticated', 'service_role'] loop
    foreach privilege_name in array array[
      'select',
      'insert',
      'update',
      'delete',
      'truncate',
      'maintain',
      'references',
      'trigger'
    ] loop
      if pg_catalog.has_table_privilege(
        role_name,
        'private.unmet_demand_zero_result_days',
        privilege_name
      ) then
        raise exception 'unmet-demand capture postcondition failed: table ACL drifted'
          using errcode = '55000';
      end if;
    end loop;

    foreach privilege_name in array array[
      'select', 'insert', 'update', 'references'
    ] loop
      if pg_catalog.has_any_column_privilege(
        role_name,
        'private.unmet_demand_zero_result_days',
        privilege_name
      ) then
        raise exception 'unmet-demand capture postcondition failed: column ACL drifted'
          using errcode = '55000';
      end if;
    end loop;
  end loop;

  if (
    select count(*)
    from pg_catalog.pg_trigger trigger_record
    where trigger_record.tgrelid =
        'private.unmet_demand_zero_result_days'::pg_catalog.regclass
      and not trigger_record.tgisinternal
      and trigger_record.tgenabled = 'A'
      and trigger_record.tgfoid =
        'private.prevent_unmet_demand_zero_result_change()'::pg_catalog.regprocedure
      and trigger_record.tgname = any (array[
        'unmet_demand_zero_result_days_immutable_rows',
        'unmet_demand_zero_result_days_immutable_truncate'
      ])
  ) <> 2 or (
    select count(*)
    from pg_catalog.pg_trigger trigger_record
    where trigger_record.tgrelid =
        'private.unmet_demand_zero_result_days'::pg_catalog.regclass
      and not trigger_record.tgisinternal
  ) <> 2 then
    raise exception 'unmet-demand capture postcondition failed: trigger drifted'
      using errcode = '55000';
  end if;

  select routine_record.*
  into strict function_record
  from pg_catalog.pg_proc routine_record
  where routine_record.oid =
    'public.record_my_unmet_demand_zero_result(text,uuid)'::pg_catalog.regprocedure;

  if not function_record.prosecdef
    or function_record.provolatile <> 'v'
    or function_record.prorettype <> 'boolean'::pg_catalog.regtype
    or pg_catalog.pg_get_userbyid(function_record.proowner) <> 'postgres'
    or not coalesce(function_record.proconfig, array[]::text[])
      @> array['search_path=""']::text[]
    or not pg_catalog.has_function_privilege(
      'authenticated',
      'public.record_my_unmet_demand_zero_result(text,uuid)',
      'execute'
    )
    or pg_catalog.has_function_privilege(
      'anon',
      'public.record_my_unmet_demand_zero_result(text,uuid)',
      'execute'
    )
    or pg_catalog.has_function_privilege(
      'service_role',
      'public.record_my_unmet_demand_zero_result(text,uuid)',
      'execute'
    )
    or exists (
      select 1
      from pg_catalog.aclexplode(
        coalesce(
          function_record.proacl,
          pg_catalog.acldefault('f', function_record.proowner)
        )
      ) privilege_record
      where privilege_record.grantee = 0
        and privilege_record.privilege_type = 'EXECUTE'
    )
  then
    raise exception 'unmet-demand capture postcondition failed: function ACL drifted'
      using errcode = '55000';
  end if;

  if function_record.prosrc !~* 'with[[:space:]]+eligibility[[:space:]]+as[[:space:]]+materialized'
    or function_record.prosrc !~* 'insert[[:space:]]+into[[:space:]]+private[.]unmet_demand_zero_result_days'
    or function_record.prosrc ~* 'public[.](searches|search_intents|demand_signals|unmet_demand|missions|mission_progress)'
    or function_record.prosrc ~* 'private[.](demand_gap_definitions|referral_mission_definitions)'
  then
    raise exception 'unmet-demand capture postcondition failed: function source drifted'
      using errcode = '55000';
  end if;
end;
$$;

commit;

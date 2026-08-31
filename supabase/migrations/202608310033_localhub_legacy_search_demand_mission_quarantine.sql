-- Step 26 begins with a security-only quarantine of unused legacy search,
-- demand, and mission relations. This migration preserves their structures but
-- creates no capture, aggregation, mission, assignment, progress, or referral
-- product behavior.

set local lock_timeout = '10s';
set local statement_timeout = '120s';

-- DDL below needs ACCESS EXCLUSIVE. Take every lock once in a fixed
-- parent-before-child order so the zero-row and catalog checks cannot race a
-- legacy writer or require a later lock upgrade.
lock table
  public.searches,
  public.search_intents,
  public.demand_signals,
  public.unmet_demand,
  public.missions,
  public.mission_progress
in access exclusive mode;

do $$
declare
  actual_policies text[];
  expected_allowed boolean;
  privilege_name text;
  role_name text;
  table_name text;
begin
  if exists (select 1 from public.searches)
    or exists (select 1 from public.search_intents)
    or exists (select 1 from public.demand_signals)
    or exists (select 1 from public.unmet_demand)
    or exists (select 1 from public.missions)
    or exists (select 1 from public.mission_progress)
  then
    raise exception
      'legacy quarantine requires empty legacy state; reconciliation is required'
      using errcode = '55000';
  end if;

  if (
    select count(*)
    from pg_catalog.pg_class relation_record
    join pg_catalog.pg_namespace namespace_record
      on namespace_record.oid = relation_record.relnamespace
    where namespace_record.nspname = 'public'
      and relation_record.relname = any (array[
        'searches',
        'search_intents',
        'demand_signals',
        'unmet_demand',
        'missions',
        'mission_progress'
      ])
      and relation_record.relkind = 'r'
      and relation_record.relrowsecurity
      and not relation_record.relforcerowsecurity
      and pg_catalog.pg_get_userbyid(relation_record.relowner) = 'postgres'
  ) <> 6 then
    raise exception
      'legacy quarantine requires the exact legacy relation baseline'
      using errcode = '55000';
  end if;

  select pg_catalog.array_agg(
    pg_catalog.format(
      '%s|%s|%s|%s',
      policy_record.tablename,
      policy_record.policyname,
      policy_record.cmd,
      pg_catalog.array_to_string(policy_record.roles, ',')
    )
    order by policy_record.tablename, policy_record.policyname
  )
  into actual_policies
  from pg_catalog.pg_policies policy_record
  where policy_record.schemaname = 'public'
    and policy_record.tablename = any (array[
      'searches',
      'search_intents',
      'demand_signals',
      'unmet_demand',
      'missions',
      'mission_progress'
    ]);

  if actual_policies is distinct from array[
    'mission_progress|mission_progress_owner|SELECT|authenticated',
    'search_intents|search_intents_owner|SELECT|authenticated',
    'search_intents|search_intents_owner_insert|INSERT|authenticated',
    'searches|searches_owner_insert|INSERT|authenticated',
    'searches|searches_owner_select|SELECT|authenticated'
  ]::text[] then
    raise exception
      'legacy quarantine requires the exact legacy policy baseline'
      using errcode = '55000';
  end if;

  if exists (
    select 1
    from (
      values
        ('demand_signals_category_id_fkey', 'public.demand_signals', 'public.categories', 'n'),
        ('demand_signals_market_id_fkey', 'public.demand_signals', 'public.markets', 'c'),
        ('demand_signals_source_search_id_fkey', 'public.demand_signals', 'public.searches', 'n'),
        ('mission_progress_mission_id_fkey', 'public.mission_progress', 'public.missions', 'c'),
        ('mission_progress_profile_id_fkey', 'public.mission_progress', 'public.profiles', 'c'),
        ('missions_market_id_fkey', 'public.missions', 'public.markets', 'c'),
        ('search_intents_category_id_fkey', 'public.search_intents', 'public.categories', 'n'),
        ('search_intents_search_id_fkey', 'public.search_intents', 'public.searches', 'c'),
        ('searches_actor_id_fkey', 'public.searches', 'public.profiles', 'n'),
        ('searches_guest_intent_id_fkey', 'public.searches', 'public.guest_intents', 'n'),
        ('searches_market_id_fkey', 'public.searches', 'public.markets', 'n'),
        ('unmet_demand_category_id_fkey', 'public.unmet_demand', 'public.categories', 'n'),
        ('unmet_demand_market_id_fkey', 'public.unmet_demand', 'public.markets', 'c')
    ) expected_fk(constraint_name, source_name, target_name, delete_action)
    where not exists (
      select 1
      from pg_catalog.pg_constraint constraint_record
      where constraint_record.conname = expected_fk.constraint_name
        and constraint_record.conrelid =
          expected_fk.source_name::pg_catalog.regclass
        and constraint_record.confrelid =
          expected_fk.target_name::pg_catalog.regclass
        and constraint_record.contype = 'f'
        and constraint_record.confdeltype::text = expected_fk.delete_action
        and constraint_record.convalidated
    )
  ) or (
    select count(*)
    from pg_catalog.pg_constraint constraint_record
    where constraint_record.contype = 'f'
      and constraint_record.conrelid in (
        'public.searches'::pg_catalog.regclass,
        'public.search_intents'::pg_catalog.regclass,
        'public.demand_signals'::pg_catalog.regclass,
        'public.unmet_demand'::pg_catalog.regclass,
        'public.missions'::pg_catalog.regclass,
        'public.mission_progress'::pg_catalog.regclass
      )
  ) <> 13 or exists (
    select 1
    from pg_catalog.pg_constraint constraint_record
    where constraint_record.contype = 'f'
      and constraint_record.confrelid in (
        'public.searches'::pg_catalog.regclass,
        'public.search_intents'::pg_catalog.regclass,
        'public.demand_signals'::pg_catalog.regclass,
        'public.unmet_demand'::pg_catalog.regclass,
        'public.missions'::pg_catalog.regclass,
        'public.mission_progress'::pg_catalog.regclass
      )
      and constraint_record.conrelid not in (
        'public.searches'::pg_catalog.regclass,
        'public.search_intents'::pg_catalog.regclass,
        'public.demand_signals'::pg_catalog.regclass,
        'public.unmet_demand'::pg_catalog.regclass,
        'public.missions'::pg_catalog.regclass,
        'public.mission_progress'::pg_catalog.regclass
      )
  ) then
    raise exception
      'legacy quarantine requires the exact legacy foreign-key baseline'
      using errcode = '55000';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_attribute attribute_record
    where attribute_record.attrelid in (
      'public.searches'::pg_catalog.regclass,
      'public.search_intents'::pg_catalog.regclass,
      'public.demand_signals'::pg_catalog.regclass,
      'public.unmet_demand'::pg_catalog.regclass,
      'public.missions'::pg_catalog.regclass,
      'public.mission_progress'::pg_catalog.regclass
    )
      and attribute_record.attnum > 0
      and not attribute_record.attisdropped
      and attribute_record.attacl is not null
  ) then
    raise exception
      'legacy quarantine requires no legacy column ACL drift'
      using errcode = '55000';
  end if;

  foreach table_name in array array[
    'searches',
    'search_intents',
    'demand_signals',
    'unmet_demand',
    'missions',
    'mission_progress'
  ] loop
    if exists (
      select 1
      from pg_catalog.pg_class relation_record
      cross join lateral pg_catalog.aclexplode(
        coalesce(
          relation_record.relacl,
          pg_catalog.acldefault('r', relation_record.relowner)
        )
      ) privilege
      where relation_record.oid =
        ('public.' || table_name)::pg_catalog.regclass
        and privilege.grantee = 0
    ) then
      raise exception
        'legacy quarantine requires the exact legacy ACL baseline'
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
        expected_allowed := role_name = 'service_role'
          or (
            role_name = 'authenticated'
            and table_name in ('searches', 'search_intents')
            and privilege_name in ('select', 'insert')
          );

        if pg_catalog.has_table_privilege(
          role_name,
          'public.' || table_name,
          privilege_name
        ) is distinct from expected_allowed then
          raise exception
            'legacy quarantine requires the exact legacy ACL baseline'
            using errcode = '55000';
        end if;
      end loop;
    end loop;
  end loop;

  if pg_catalog.to_regprocedure(
    'private.prevent_dormant_demand_mission_mutation()'
  ) is not null or exists (
    select 1
    from pg_catalog.pg_trigger trigger_record
    where trigger_record.tgname = any (array[
      'searches_dormant_rows',
      'searches_dormant_truncate',
      'search_intents_dormant_rows',
      'search_intents_dormant_truncate',
      'demand_signals_dormant_rows',
      'demand_signals_dormant_truncate',
      'unmet_demand_dormant_rows',
      'unmet_demand_dormant_truncate',
      'missions_dormant_rows',
      'missions_dormant_truncate',
      'mission_progress_dormant_rows',
      'mission_progress_dormant_truncate'
    ])
      and not trigger_record.tgisinternal
  ) then
    raise exception
      'legacy quarantine requires no partial quarantine objects'
      using errcode = '55000';
  end if;

  if exists (
    select 1
    from (
      values
        (
          'public.search_intents',
          'search_intents_validate_market',
          'public.validate_market_integrity()',
          23
        ),
        (
          'public.demand_signals',
          'demand_signals_validate_market',
          'public.validate_market_integrity()',
          23
        ),
        (
          'public.unmet_demand',
          'unmet_demand_validate_market',
          'public.validate_market_integrity()',
          23
        ),
        (
          'public.unmet_demand',
          'unmet_demand_set_updated_at',
          'public.set_updated_at()',
          19
        ),
        (
          'public.missions',
          'missions_set_updated_at',
          'public.set_updated_at()',
          19
        ),
        (
          'public.mission_progress',
          'mission_progress_set_updated_at',
          'public.set_updated_at()',
          19
        )
    ) expected_trigger(
      relation_name,
      trigger_name,
      function_name,
      trigger_type
    )
    where not exists (
      select 1
      from pg_catalog.pg_trigger trigger_record
      where trigger_record.tgrelid =
          expected_trigger.relation_name::pg_catalog.regclass
        and trigger_record.tgname = expected_trigger.trigger_name
        and trigger_record.tgfoid =
          expected_trigger.function_name::pg_catalog.regprocedure
        and trigger_record.tgtype = expected_trigger.trigger_type
        and trigger_record.tgenabled = 'O'
        and not trigger_record.tgisinternal
    )
  ) or (
    select count(*)
    from pg_catalog.pg_trigger trigger_record
    where trigger_record.tgrelid in (
      'public.searches'::pg_catalog.regclass,
      'public.search_intents'::pg_catalog.regclass,
      'public.demand_signals'::pg_catalog.regclass,
      'public.unmet_demand'::pg_catalog.regclass,
      'public.missions'::pg_catalog.regclass,
      'public.mission_progress'::pg_catalog.regclass
    )
      and not trigger_record.tgisinternal
  ) <> 6 then
    raise exception
      'legacy quarantine requires the exact legacy trigger baseline'
      using errcode = '55000';
  end if;

  -- The shared validator remains required by active catalog/commerce tables.
  -- Permit that one known trigger routine, but reject any other public routine
  -- whose body has gained a dependency on the relations being quarantined.
  if exists (
    select 1
    from pg_catalog.pg_proc routine_record
    join pg_catalog.pg_namespace namespace_record
      on namespace_record.oid = routine_record.pronamespace
    where namespace_record.nspname = 'public'
      and routine_record.prosrc ~
        E'\\m(searches|search_intents|demand_signals|unmet_demand|missions|mission_progress)\\M'
      and routine_record.oid <>
        'public.validate_market_integrity()'::pg_catalog.regprocedure
  ) then
    raise exception
      'legacy quarantine requires no legacy callable writer drift'
      using errcode = '55000';
  end if;
end;
$$;

drop policy searches_owner_select on public.searches;
drop policy searches_owner_insert on public.searches;
drop policy search_intents_owner on public.search_intents;
drop policy search_intents_owner_insert on public.search_intents;
drop policy mission_progress_owner on public.mission_progress;

alter table public.searches enable row level security;
alter table public.searches force row level security;
alter table public.search_intents enable row level security;
alter table public.search_intents force row level security;
alter table public.demand_signals enable row level security;
alter table public.demand_signals force row level security;
alter table public.unmet_demand enable row level security;
alter table public.unmet_demand force row level security;
alter table public.missions enable row level security;
alter table public.missions force row level security;
alter table public.mission_progress enable row level security;
alter table public.mission_progress force row level security;

revoke all privileges on table public.searches
  from public, anon, authenticated, service_role;
revoke all privileges on table public.search_intents
  from public, anon, authenticated, service_role;
revoke all privileges on table public.demand_signals
  from public, anon, authenticated, service_role;
revoke all privileges on table public.unmet_demand
  from public, anon, authenticated, service_role;
revoke all privileges on table public.missions
  from public, anon, authenticated, service_role;
revoke all privileges on table public.mission_progress
  from public, anon, authenticated, service_role;

-- Table-level revocation does not erase independently granted column ACLs.
-- Enumerate the current schema explicitly so this boundary stays complete.
revoke all privileges (
  id,
  actor_id,
  guest_intent_id,
  market_id,
  query_text,
  normalized_query,
  deterministic_key,
  filters,
  result_count,
  created_at
) on table public.searches from public, anon, authenticated, service_role;
revoke all privileges (
  id,
  search_id,
  category_id,
  intent_kind,
  confidence,
  extracted,
  created_at
) on table public.search_intents from public, anon, authenticated, service_role;
revoke all privileges (
  id,
  market_id,
  category_id,
  source_search_id,
  signal_type,
  weight,
  observed_at
) on table public.demand_signals from public, anon, authenticated, service_role;
revoke all privileges (
  id,
  market_id,
  category_id,
  deterministic_key,
  evidence_count,
  status,
  created_at,
  updated_at
) on table public.unmet_demand from public, anon, authenticated, service_role;
revoke all privileges (
  id,
  market_id,
  name,
  status,
  definition,
  created_at,
  updated_at
) on table public.missions from public, anon, authenticated, service_role;
revoke all privileges (
  mission_id,
  profile_id,
  progress,
  completed_at,
  updated_at
) on table public.mission_progress
  from public, anon, authenticated, service_role;

create function private.prevent_dormant_demand_mission_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'legacy search, demand, and mission state is dormant'
    using errcode = '55000';
end;
$$;

alter function private.prevent_dormant_demand_mission_mutation()
  owner to postgres;
revoke all on function private.prevent_dormant_demand_mission_mutation()
  from public, anon, authenticated, service_role;

create trigger searches_dormant_rows
before insert or update or delete on public.searches
for each row
execute function private.prevent_dormant_demand_mission_mutation();
create trigger searches_dormant_truncate
before truncate on public.searches
for each statement
execute function private.prevent_dormant_demand_mission_mutation();
alter table public.searches enable always trigger searches_dormant_rows;
alter table public.searches enable always trigger searches_dormant_truncate;

create trigger search_intents_dormant_rows
before insert or update or delete on public.search_intents
for each row
execute function private.prevent_dormant_demand_mission_mutation();
create trigger search_intents_dormant_truncate
before truncate on public.search_intents
for each statement
execute function private.prevent_dormant_demand_mission_mutation();
alter table public.search_intents
  enable always trigger search_intents_dormant_rows;
alter table public.search_intents
  enable always trigger search_intents_dormant_truncate;

create trigger demand_signals_dormant_rows
before insert or update or delete on public.demand_signals
for each row
execute function private.prevent_dormant_demand_mission_mutation();
create trigger demand_signals_dormant_truncate
before truncate on public.demand_signals
for each statement
execute function private.prevent_dormant_demand_mission_mutation();
alter table public.demand_signals
  enable always trigger demand_signals_dormant_rows;
alter table public.demand_signals
  enable always trigger demand_signals_dormant_truncate;

create trigger unmet_demand_dormant_rows
before insert or update or delete on public.unmet_demand
for each row
execute function private.prevent_dormant_demand_mission_mutation();
create trigger unmet_demand_dormant_truncate
before truncate on public.unmet_demand
for each statement
execute function private.prevent_dormant_demand_mission_mutation();
alter table public.unmet_demand
  enable always trigger unmet_demand_dormant_rows;
alter table public.unmet_demand
  enable always trigger unmet_demand_dormant_truncate;

create trigger missions_dormant_rows
before insert or update or delete on public.missions
for each row
execute function private.prevent_dormant_demand_mission_mutation();
create trigger missions_dormant_truncate
before truncate on public.missions
for each statement
execute function private.prevent_dormant_demand_mission_mutation();
alter table public.missions enable always trigger missions_dormant_rows;
alter table public.missions enable always trigger missions_dormant_truncate;

create trigger mission_progress_dormant_rows
before insert or update or delete on public.mission_progress
for each row
execute function private.prevent_dormant_demand_mission_mutation();
create trigger mission_progress_dormant_truncate
before truncate on public.mission_progress
for each statement
execute function private.prevent_dormant_demand_mission_mutation();
alter table public.mission_progress
  enable always trigger mission_progress_dormant_rows;
alter table public.mission_progress
  enable always trigger mission_progress_dormant_truncate;

comment on table public.searches is
  'Empty dormant legacy search capture. No raw-query writer or retention policy is active.';
comment on table public.search_intents is
  'Empty dormant legacy search-intent capture. No extraction writer is active.';
comment on table public.demand_signals is
  'Empty dormant legacy demand signal relation. No evidence-ingestion writer is active.';
comment on table public.unmet_demand is
  'Empty dormant legacy demand aggregate. No aggregation writer is active.';
comment on table public.missions is
  'Empty dormant legacy mission relation. A separately reviewed typed replacement is required.';
comment on table public.mission_progress is
  'Empty dormant legacy mission progress relation. No assignment or progress writer is active.';

-- Treat these as executable postconditions. A catalog or privilege mismatch
-- aborts the transaction instead of leaving a partially closed boundary.
do $$
declare
  blocker_function pg_catalog.pg_proc%rowtype;
  owner_name text;
  privilege_name text;
  role_name text;
  table_name text;
begin
  select routine_record.*
  into strict blocker_function
  from pg_catalog.pg_proc routine_record
  where routine_record.oid =
    'private.prevent_dormant_demand_mission_mutation()'::pg_catalog.regprocedure;

  select role_record.rolname
  into strict owner_name
  from pg_catalog.pg_roles role_record
  where role_record.oid = blocker_function.proowner;

  if blocker_function.prosecdef
    or owner_name <> 'postgres'
    or not coalesce(blocker_function.proconfig, array[]::text[])
      @> array['search_path=""']::text[]
    or exists (
      select 1
      from pg_catalog.aclexplode(
        coalesce(
          blocker_function.proacl,
          pg_catalog.acldefault('f', blocker_function.proowner)
        )
      ) privilege
      where privilege.grantee = 0
        and privilege.privilege_type = 'EXECUTE'
    )
  then
    raise exception
      'legacy quarantine postcondition failed: blocker metadata changed'
      using errcode = '55000';
  end if;

  foreach role_name in array array['anon', 'authenticated', 'service_role'] loop
    if pg_catalog.has_function_privilege(
      role_name,
      'private.prevent_dormant_demand_mission_mutation()',
      'execute'
    ) then
      raise exception
        'legacy quarantine postcondition failed: blocker execute remains'
        using errcode = '55000';
    end if;
  end loop;

  foreach table_name in array array[
    'searches',
    'search_intents',
    'demand_signals',
    'unmet_demand',
    'missions',
    'mission_progress'
  ] loop
    if exists (
      select 1
      from pg_catalog.pg_class relation_record
      where relation_record.oid =
        ('public.' || table_name)::pg_catalog.regclass
        and (
          not relation_record.relrowsecurity
          or not relation_record.relforcerowsecurity
        )
    ) or exists (
      select 1
      from pg_catalog.pg_policies policy_record
      where policy_record.schemaname = 'public'
        and policy_record.tablename = table_name
    ) then
      raise exception
        'legacy quarantine postcondition failed: RLS or policy state changed'
        using errcode = '55000';
    end if;

    execute pg_catalog.format(
      'select exists (select 1 from public.%I)',
      table_name
    ) into strict role_name;
    if role_name::boolean then
      raise exception
        'legacy quarantine postcondition failed: row remains'
        using errcode = '55000';
    end if;

    if exists (
      select 1
      from pg_catalog.pg_class relation_record
      cross join lateral pg_catalog.aclexplode(
        coalesce(
          relation_record.relacl,
          pg_catalog.acldefault('r', relation_record.relowner)
        )
      ) privilege
      where relation_record.oid =
        ('public.' || table_name)::pg_catalog.regclass
        and privilege.grantee = 0
    ) or exists (
      select 1
      from pg_catalog.pg_attribute attribute_record
      cross join lateral pg_catalog.aclexplode(attribute_record.attacl) privilege
      where attribute_record.attrelid =
        ('public.' || table_name)::pg_catalog.regclass
        and attribute_record.attnum > 0
        and not attribute_record.attisdropped
        and privilege.grantee = 0
    ) then
      raise exception
        'legacy quarantine postcondition failed: PUBLIC ACL remains'
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
          'public.' || table_name,
          privilege_name
        ) then
          raise exception
            'legacy quarantine postcondition failed: table privilege remains'
            using errcode = '55000';
        end if;
      end loop;

      foreach privilege_name in array array[
        'select',
        'insert',
        'update',
        'references'
      ] loop
        if pg_catalog.has_any_column_privilege(
          role_name,
          'public.' || table_name,
          privilege_name
        ) then
          raise exception
            'legacy quarantine postcondition failed: column privilege remains'
            using errcode = '55000';
        end if;
      end loop;
    end loop;

    if (
      select count(*)
      from pg_catalog.pg_trigger trigger_record
      where trigger_record.tgrelid =
          ('public.' || table_name)::pg_catalog.regclass
        and trigger_record.tgname = any (array[
          table_name || '_dormant_rows',
          table_name || '_dormant_truncate'
        ])
        and not trigger_record.tgisinternal
        and trigger_record.tgenabled = 'A'
        and trigger_record.tgfoid = blocker_function.oid
        and (
          (
            trigger_record.tgname = table_name || '_dormant_rows'
            and trigger_record.tgtype = 31
          )
          or (
            trigger_record.tgname = table_name || '_dormant_truncate'
            and trigger_record.tgtype = 34
          )
        )
    ) <> 2 then
      raise exception
        'legacy quarantine postcondition failed: blocker attachment changed'
        using errcode = '55000';
    end if;
  end loop;

  if (
    select count(*)
    from pg_catalog.pg_trigger trigger_record
    where not trigger_record.tgisinternal
      and trigger_record.tgenabled = 'A'
      and trigger_record.tgfoid = blocker_function.oid
  ) <> 12 then
    raise exception
      'legacy quarantine postcondition failed: blocker count changed'
      using errcode = '55000';
  end if;
end;
$$;

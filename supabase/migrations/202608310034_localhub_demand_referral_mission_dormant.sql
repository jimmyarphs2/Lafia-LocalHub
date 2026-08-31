-- Step 26 adds only private, immutable, version-one definition structure for
-- future merchant-supply demand gaps and merchant-recruitment missions.
-- No evidence capture, assignment, progress, attribution, reward, financial,
-- AI, public RPC, or application writer is activated by this migration.

set local lock_timeout = '10s';
set local statement_timeout = '120s';

-- Parent relations precede the quarantined legacy children. Taking every lock
-- once prevents the preconditions from racing a catalog or legacy-data change.
lock table
  public.markets,
  public.categories,
  public.searches,
  public.search_intents,
  public.demand_signals,
  public.unmet_demand,
  public.missions,
  public.mission_progress
in share row exclusive mode;

do $$
declare
  actual_labels text[];
  blocker_function pg_catalog.pg_proc%rowtype;
  privilege_name text;
  relation_name text;
  role_name text;
  target_type pg_catalog.pg_type%rowtype;
begin
  if exists (select 1 from public.searches)
    or exists (select 1 from public.search_intents)
    or exists (select 1 from public.demand_signals)
    or exists (select 1 from public.unmet_demand)
    or exists (select 1 from public.missions)
    or exists (select 1 from public.mission_progress)
  then
    raise exception
      'dormant definitions require empty legacy search, demand, and mission quarantine'
      using errcode = '55000';
  end if;

  if pg_catalog.to_regprocedure(
    'private.prevent_dormant_demand_mission_mutation()'
  ) is null then
    raise exception
      'dormant definition foundation requires legacy search, demand, and mission quarantine'
      using errcode = '55000';
  end if;

  select routine_record.*
  into strict blocker_function
  from pg_catalog.pg_proc routine_record
  where routine_record.oid =
    'private.prevent_dormant_demand_mission_mutation()'::pg_catalog.regprocedure;

  if blocker_function.prosecdef
    or pg_catalog.pg_get_userbyid(blocker_function.proowner) <> 'postgres'
    or not coalesce(blocker_function.proconfig, array[]::text[])
      @> array['search_path=""']::text[]
    or exists (
      select 1
      from pg_catalog.aclexplode(
        coalesce(
          blocker_function.proacl,
          pg_catalog.acldefault('f', blocker_function.proowner)
        )
      ) privilege_record
      where privilege_record.grantee = 0
        and privilege_record.privilege_type = 'EXECUTE'
    )
  then
    raise exception
      'dormant definitions require legacy search, demand, and mission quarantine'
      using errcode = '55000';
  end if;

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
      where policy_record.schemaname = pg_catalog.split_part(relation_name, '.', 1)
        and policy_record.tablename = pg_catalog.split_part(relation_name, '.', 2)
    ) then
      raise exception
        'dormant definitions require legacy search, demand, and mission quarantine'
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
      ) privilege_record
      where relation_record.oid = relation_name::pg_catalog.regclass
        and privilege_record.grantee = 0
    ) or exists (
      select 1
      from pg_catalog.pg_attribute attribute_record
      cross join lateral pg_catalog.aclexplode(attribute_record.attacl)
        privilege_record
      where attribute_record.attrelid = relation_name::pg_catalog.regclass
        and attribute_record.attnum > 0
        and not attribute_record.attisdropped
        and privilege_record.grantee = 0
    ) then
      raise exception
        'dormant definitions require legacy search, demand, and mission quarantine'
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
          relation_name,
          privilege_name
        ) then
          raise exception
            'dormant definitions require legacy search, demand, and mission quarantine'
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
          raise exception
            'dormant definitions require legacy search, demand, and mission quarantine'
            using errcode = '55000';
        end if;
      end loop;
    end loop;

    if (
      select count(*)
      from pg_catalog.pg_trigger trigger_record
      where trigger_record.tgrelid = relation_name::pg_catalog.regclass
        and trigger_record.tgfoid = blocker_function.oid
        and trigger_record.tgenabled = 'A'
        and not trigger_record.tgisinternal
        and (
          (
            trigger_record.tgname =
              pg_catalog.split_part(relation_name, '.', 2) || '_dormant_rows'
            and trigger_record.tgtype = 31
          )
          or (
            trigger_record.tgname =
              pg_catalog.split_part(relation_name, '.', 2) || '_dormant_truncate'
            and trigger_record.tgtype = 34
          )
        )
    ) <> 2 then
      raise exception
        'dormant definitions require legacy search, demand, and mission quarantine'
        using errcode = '55000';
    end if;
  end loop;

  if (
    select count(*)
    from pg_catalog.pg_trigger trigger_record
    where trigger_record.tgfoid = blocker_function.oid
      and trigger_record.tgenabled = 'A'
      and not trigger_record.tgisinternal
  ) <> 12 then
    raise exception
      'dormant definitions require legacy search, demand, and mission quarantine'
      using errcode = '55000';
  end if;

  foreach role_name in array array['anon', 'authenticated', 'service_role'] loop
    if pg_catalog.has_function_privilege(
      role_name,
      'private.prevent_dormant_demand_mission_mutation()',
      'execute'
    ) then
      raise exception
        'dormant definitions require legacy search, demand, and mission quarantine'
        using errcode = '55000';
    end if;
  end loop;

  if pg_catalog.to_regtype('private.referral_target_code') is null then
    raise exception
      'dormant definitions require the fixed referral acquisition target'
      using errcode = '55000';
  end if;

  select type_record.*
  into strict target_type
  from pg_catalog.pg_type type_record
  where type_record.oid =
    'private.referral_target_code'::pg_catalog.regtype;

  select pg_catalog.array_agg(
    enum_record.enumlabel
    order by enum_record.enumsortorder
  )
  into actual_labels
  from pg_catalog.pg_enum enum_record
  where enum_record.enumtypid = target_type.oid;

  if target_type.typtype <> 'e'
    or pg_catalog.pg_get_userbyid(target_type.typowner) <> 'postgres'
    or actual_labels is distinct from array['merchant_onboarding']::text[]
    or exists (
      select 1
      from pg_catalog.aclexplode(
        coalesce(
          target_type.typacl,
          pg_catalog.acldefault('T', target_type.typowner)
        )
      ) privilege_record
      where privilege_record.grantee = 0
        and privilege_record.privilege_type = 'USAGE'
    )
  then
    raise exception
      'dormant definitions require the fixed referral acquisition target'
      using errcode = '55000';
  end if;

  foreach role_name in array array['anon', 'authenticated', 'service_role'] loop
    if pg_catalog.has_type_privilege(
      role_name,
      'private.referral_target_code',
      'usage'
    ) then
      raise exception
        'dormant definitions require the fixed referral acquisition target'
        using errcode = '55000';
    end if;
  end loop;

  if pg_catalog.to_regclass('private.demand_gap_definitions') is not null
    or pg_catalog.to_regclass('private.referral_mission_definitions') is not null
    or pg_catalog.to_regclass(
      'private.demand_gap_definitions_category_fkey_idx'
    ) is not null
    or pg_catalog.to_regtype(
      'private.dormant_definition_status_code'
    ) is not null
    or pg_catalog.to_regtype('private.demand_gap_kind_code') is not null
    or pg_catalog.to_regtype('private.referral_mission_kind_code') is not null
    or pg_catalog.to_regprocedure(
      'private.validate_demand_gap_market_category()'
    ) is not null
    or pg_catalog.to_regprocedure(
      'private.prevent_dormant_demand_referral_mission_mutation()'
    ) is not null
    or exists (
      select 1
      from pg_catalog.pg_trigger trigger_record
      where trigger_record.tgname = any (array[
        'demand_gap_definitions_validate_market_category',
        'demand_gap_definitions_dormant_rows',
        'demand_gap_definitions_dormant_truncate',
        'referral_mission_definitions_dormant_rows',
        'referral_mission_definitions_dormant_truncate'
      ])
        and not trigger_record.tgisinternal
    )
  then
    raise exception
      'dormant definitions require no partial replacement objects'
      using errcode = '55000';
  end if;
end;
$$;

create type private.dormant_definition_status_code as enum ('draft', 'retired');
create type private.demand_gap_kind_code as enum ('merchant_supply_gap');
create type private.referral_mission_kind_code as enum ('merchant_recruitment');

alter type private.dormant_definition_status_code owner to postgres;
alter type private.demand_gap_kind_code owner to postgres;
alter type private.referral_mission_kind_code owner to postgres;

revoke all on type private.dormant_definition_status_code from public, anon, authenticated, service_role;
revoke all on type private.demand_gap_kind_code from public, anon, authenticated, service_role;
revoke all on type private.referral_mission_kind_code from public, anon, authenticated, service_role;

create table private.demand_gap_definitions (
  id uuid primary key default extensions.gen_random_uuid(),
  market_id uuid not null references public.markets(id) on delete restrict,
  category_id uuid not null references public.categories(id) on delete restrict,
  kind private.demand_gap_kind_code not null default 'merchant_supply_gap',
  demand_key text not null,
  status private.dormant_definition_status_code not null default 'draft',
  definition_version smallint not null default 1 check (definition_version = 1),
  created_at timestamptz not null default now(),
  retired_at timestamptz,
  constraint demand_gap_definitions_kind_fixed
    check (kind = 'merchant_supply_gap'),
  constraint demand_gap_definitions_key_shape check (
    octet_length(demand_key) between 3 and 96
    and demand_key ~ '^[a-z0-9][a-z0-9_-]{1,94}[a-z0-9]$'
  ),
  constraint demand_gap_definitions_state_shape check (
    (status = 'draft' and retired_at is null)
    or (
      status = 'retired'
      and retired_at is not null
      and retired_at >= created_at
    )
  ),
  constraint demand_gap_definitions_identity_unique
    unique (market_id, category_id, kind, demand_key, definition_version)
);

create index demand_gap_definitions_category_fkey_idx on private.demand_gap_definitions(category_id);

create table private.referral_mission_definitions (
  id uuid primary key default extensions.gen_random_uuid(),
  demand_gap_id uuid not null references private.demand_gap_definitions(id) on delete restrict,
  kind private.referral_mission_kind_code not null default 'merchant_recruitment',
  target private.referral_target_code not null default 'merchant_onboarding',
  status private.dormant_definition_status_code not null default 'draft',
  definition_version smallint not null default 1 check (definition_version = 1),
  created_at timestamptz not null default now(),
  retired_at timestamptz,
  constraint referral_mission_definitions_kind_fixed
    check (kind = 'merchant_recruitment'),
  constraint referral_mission_definitions_target_fixed
    check (target = 'merchant_onboarding'),
  constraint referral_mission_definitions_state_shape check (
    (status = 'draft' and retired_at is null)
    or (
      status = 'retired'
      and retired_at is not null
      and retired_at >= created_at
    )
  ),
  constraint referral_mission_definitions_identity_unique
    unique (demand_gap_id, kind, target, definition_version)
);

alter table private.demand_gap_definitions owner to postgres;
alter table private.referral_mission_definitions owner to postgres;

alter table private.demand_gap_definitions enable row level security;
alter table private.demand_gap_definitions force row level security;
alter table private.referral_mission_definitions enable row level security;
alter table private.referral_mission_definitions force row level security;

revoke all on table private.demand_gap_definitions from public, anon, authenticated, service_role;
revoke all on table private.referral_mission_definitions from public, anon, authenticated, service_role;

revoke all privileges (
  id,
  market_id,
  category_id,
  kind,
  demand_key,
  status,
  definition_version,
  created_at,
  retired_at
) on table private.demand_gap_definitions
  from public, anon, authenticated, service_role;
revoke all privileges (
  id,
  demand_gap_id,
  kind,
  target,
  status,
  definition_version,
  created_at,
  retired_at
) on table private.referral_mission_definitions
  from public, anon, authenticated, service_role;

create function private.validate_demand_gap_market_category()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.markets market_record
    where market_record.id = new.market_id
      and market_record.is_active
  ) or not exists (
    select 1
    from public.categories category_record
    where category_record.id = new.category_id
      and category_record.is_active
      and (
        category_record.market_id is null
        or category_record.market_id = new.market_id
      )
  ) then
    raise exception 'category market mismatch'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

alter function private.validate_demand_gap_market_category() owner to postgres;
revoke all on function private.validate_demand_gap_market_category()
  from public, anon, authenticated, service_role;

create trigger demand_gap_definitions_validate_market_category
before insert or update of market_id, category_id on private.demand_gap_definitions
for each row
execute function private.validate_demand_gap_market_category();

create function private.prevent_dormant_demand_referral_mission_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'demand-gap and referral-mission definitions are dormant'
    using errcode = '55000';
end;
$$;

alter function private.prevent_dormant_demand_referral_mission_mutation()
  owner to postgres;
revoke all on function private.prevent_dormant_demand_referral_mission_mutation()
  from public, anon, authenticated, service_role;

create trigger demand_gap_definitions_dormant_rows
before insert or update or delete on private.demand_gap_definitions
for each row
execute function private.prevent_dormant_demand_referral_mission_mutation();
create trigger demand_gap_definitions_dormant_truncate
before truncate on private.demand_gap_definitions
for each statement
execute function private.prevent_dormant_demand_referral_mission_mutation();
alter table private.demand_gap_definitions
  enable always trigger demand_gap_definitions_dormant_rows;
alter table private.demand_gap_definitions
  enable always trigger demand_gap_definitions_dormant_truncate;

create trigger referral_mission_definitions_dormant_rows
before insert or update or delete on private.referral_mission_definitions
for each row
execute function private.prevent_dormant_demand_referral_mission_mutation();
create trigger referral_mission_definitions_dormant_truncate
before truncate on private.referral_mission_definitions
for each statement
execute function private.prevent_dormant_demand_referral_mission_mutation();
alter table private.referral_mission_definitions
  enable always trigger referral_mission_definitions_dormant_rows;
alter table private.referral_mission_definitions
  enable always trigger referral_mission_definitions_dormant_truncate;

comment on table private.demand_gap_definitions is
  'Dormant version-one merchant-supply gap definitions. No evidence or writer is active.';
comment on table private.referral_mission_definitions is
  'Dormant version-one merchant-recruitment definitions. No assignment, progress, attribution, or reward is active.';

-- Executable postconditions make privilege or catalog drift fail the migration.
do $$
declare
  actual_labels text[];
  function_name text;
  privilege_name text;
  relation_name text;
  role_name text;
  type_name text;
begin
  if exists (select 1 from private.demand_gap_definitions)
    or exists (select 1 from private.referral_mission_definitions)
  then
    raise exception 'dormant definitions postcondition failed: relation is not empty'
      using errcode = '55000';
  end if;

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
    ) then
      raise exception 'dormant definitions postcondition failed: RLS or owner drift'
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
      ) privilege_record
      where relation_record.oid = relation_name::pg_catalog.regclass
        and privilege_record.grantee = 0
    ) or exists (
      select 1
      from pg_catalog.pg_attribute attribute_record
      cross join lateral pg_catalog.aclexplode(attribute_record.attacl)
        privilege_record
      where attribute_record.attrelid = relation_name::pg_catalog.regclass
        and attribute_record.attnum > 0
        and not attribute_record.attisdropped
        and privilege_record.grantee = 0
    ) then
      raise exception 'dormant definitions postcondition failed: PUBLIC ACL remains'
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
          relation_name,
          privilege_name
        ) then
          raise exception 'dormant definitions postcondition failed: table ACL remains'
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
          raise exception 'dormant definitions postcondition failed: column ACL remains'
            using errcode = '55000';
        end if;
      end loop;
    end loop;
  end loop;

  if (
    select count(*)
    from pg_catalog.pg_trigger trigger_record
    where trigger_record.tgrelid =
        'private.demand_gap_definitions'::pg_catalog.regclass
      and not trigger_record.tgisinternal
      and (
        (
          trigger_record.tgname = 'demand_gap_definitions_dormant_rows'
          and trigger_record.tgtype = 31
          and trigger_record.tgenabled = 'A'
          and trigger_record.tgfoid =
            'private.prevent_dormant_demand_referral_mission_mutation()'::pg_catalog.regprocedure
        )
        or (
          trigger_record.tgname = 'demand_gap_definitions_dormant_truncate'
          and trigger_record.tgtype = 34
          and trigger_record.tgenabled = 'A'
          and trigger_record.tgfoid =
            'private.prevent_dormant_demand_referral_mission_mutation()'::pg_catalog.regprocedure
        )
        or (
          trigger_record.tgname = 'demand_gap_definitions_validate_market_category'
          and trigger_record.tgtype = 23
          and trigger_record.tgenabled = 'O'
          and trigger_record.tgfoid =
            'private.validate_demand_gap_market_category()'::pg_catalog.regprocedure
        )
      )
  ) <> 3 or (
    select count(*)
    from pg_catalog.pg_trigger trigger_record
    where trigger_record.tgrelid =
        'private.demand_gap_definitions'::pg_catalog.regclass
      and not trigger_record.tgisinternal
  ) <> 3 or (
    select count(*)
    from pg_catalog.pg_trigger trigger_record
    where trigger_record.tgrelid =
        'private.referral_mission_definitions'::pg_catalog.regclass
      and not trigger_record.tgisinternal
      and (
        (
          trigger_record.tgname = 'referral_mission_definitions_dormant_rows'
          and trigger_record.tgtype = 31
          and trigger_record.tgenabled = 'A'
          and trigger_record.tgfoid =
            'private.prevent_dormant_demand_referral_mission_mutation()'::pg_catalog.regprocedure
        )
        or (
          trigger_record.tgname = 'referral_mission_definitions_dormant_truncate'
          and trigger_record.tgtype = 34
          and trigger_record.tgenabled = 'A'
          and trigger_record.tgfoid =
            'private.prevent_dormant_demand_referral_mission_mutation()'::pg_catalog.regprocedure
        )
      )
  ) <> 2 or (
    select count(*)
    from pg_catalog.pg_trigger trigger_record
    where trigger_record.tgrelid =
        'private.referral_mission_definitions'::pg_catalog.regclass
      and not trigger_record.tgisinternal
  ) <> 2 then
    raise exception 'dormant definitions postcondition failed: trigger drift'
      using errcode = '55000';
  end if;

  foreach function_name in array array[
    'private.validate_demand_gap_market_category()',
    'private.prevent_dormant_demand_referral_mission_mutation()'
  ] loop
    if exists (
      select 1
      from pg_catalog.pg_proc routine_record
      where routine_record.oid = function_name::pg_catalog.regprocedure
        and (
          routine_record.prosecdef
          or pg_catalog.pg_get_userbyid(routine_record.proowner) <> 'postgres'
          or not coalesce(routine_record.proconfig, array[]::text[])
            @> array['search_path=""']::text[]
        )
    ) or exists (
      select 1
      from pg_catalog.pg_proc routine_record
      cross join lateral pg_catalog.aclexplode(
        coalesce(
          routine_record.proacl,
          pg_catalog.acldefault('f', routine_record.proowner)
        )
      ) privilege_record
      where routine_record.oid = function_name::pg_catalog.regprocedure
        and privilege_record.grantee = 0
        and privilege_record.privilege_type = 'EXECUTE'
    ) then
      raise exception 'dormant definitions postcondition failed: function drift'
        using errcode = '55000';
    end if;

    foreach role_name in array array['anon', 'authenticated', 'service_role'] loop
      if pg_catalog.has_function_privilege(role_name, function_name, 'execute') then
        raise exception 'dormant definitions postcondition failed: function ACL remains'
          using errcode = '55000';
      end if;
    end loop;
  end loop;

  foreach type_name in array array[
    'private.dormant_definition_status_code',
    'private.demand_gap_kind_code',
    'private.referral_mission_kind_code'
  ] loop
    if exists (
      select 1
      from pg_catalog.pg_type type_record
      cross join lateral pg_catalog.aclexplode(
        coalesce(
          type_record.typacl,
          pg_catalog.acldefault('T', type_record.typowner)
        )
      ) privilege_record
      where type_record.oid = type_name::pg_catalog.regtype
        and (
          pg_catalog.pg_get_userbyid(type_record.typowner) <> 'postgres'
          or (
            privilege_record.grantee = 0
            and privilege_record.privilege_type = 'USAGE'
          )
        )
    ) then
      raise exception 'dormant definitions postcondition failed: type drift'
        using errcode = '55000';
    end if;

    foreach role_name in array array['anon', 'authenticated', 'service_role'] loop
      if pg_catalog.has_type_privilege(role_name, type_name, 'usage') then
        raise exception 'dormant definitions postcondition failed: type ACL remains'
          using errcode = '55000';
      end if;
    end loop;
  end loop;

  select pg_catalog.array_agg(
    enum_record.enumlabel
    order by enum_record.enumsortorder
  )
  into actual_labels
  from pg_catalog.pg_enum enum_record
  where enum_record.enumtypid =
    'private.dormant_definition_status_code'::pg_catalog.regtype;
  if actual_labels is distinct from array['draft', 'retired']::text[] then
    raise exception 'dormant definitions postcondition failed: status labels changed'
      using errcode = '55000';
  end if;

  select pg_catalog.array_agg(
    enum_record.enumlabel
    order by enum_record.enumsortorder
  )
  into actual_labels
  from pg_catalog.pg_enum enum_record
  where enum_record.enumtypid =
    'private.demand_gap_kind_code'::pg_catalog.regtype;
  if actual_labels is distinct from array['merchant_supply_gap']::text[] then
    raise exception 'dormant definitions postcondition failed: gap labels changed'
      using errcode = '55000';
  end if;

  select pg_catalog.array_agg(
    enum_record.enumlabel
    order by enum_record.enumsortorder
  )
  into actual_labels
  from pg_catalog.pg_enum enum_record
  where enum_record.enumtypid =
    'private.referral_mission_kind_code'::pg_catalog.regtype;
  if actual_labels is distinct from array['merchant_recruitment']::text[] then
    raise exception 'dormant definitions postcondition failed: mission labels changed'
      using errcode = '55000';
  end if;
end;
$$;

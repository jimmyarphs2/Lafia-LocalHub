begin;

set local lock_timeout = '10s';
set local statement_timeout = '120s';
set local transaction_timeout = '300s';

-- Only the two dormant relations need a stable catalog/runtime observation.
-- Probe parents use transaction-local UUIDs and ordinary row locks, so this
-- avoids blocking unrelated marketplace reads or writes.
lock table
  private.demand_gap_definitions,
  private.referral_mission_definitions
in access exclusive mode;

do $$
declare
  actual_columns text[];
  actual_labels text[];
  function_name text;
  privilege_name text;
  relation_name text;
  role_name text;
  type_name text;
begin
  if (select count(*) from private.demand_gap_definitions) <> 0
    or (select count(*) from private.referral_mission_definitions) <> 0
  then
    raise exception 'dormant definition probe requires empty relations';
  end if;

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
      'private.demand_gap_definitions'::pg_catalog.regclass
    and attribute_record.attnum > 0
    and not attribute_record.attisdropped;

  if actual_columns is distinct from array[
    'id:uuid',
    'market_id:uuid',
    'category_id:uuid',
    'kind:private.demand_gap_kind_code',
    'demand_key:text',
    'status:private.dormant_definition_status_code',
    'definition_version:smallint',
    'created_at:timestamp with time zone',
    'retired_at:timestamp with time zone'
  ]::text[] then
    raise exception 'demand gap definition columns changed';
  end if;

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
      'private.referral_mission_definitions'::pg_catalog.regclass
    and attribute_record.attnum > 0
    and not attribute_record.attisdropped;

  if actual_columns is distinct from array[
    'id:uuid',
    'demand_gap_id:uuid',
    'kind:private.referral_mission_kind_code',
    'target:private.referral_target_code',
    'status:private.dormant_definition_status_code',
    'definition_version:smallint',
    'created_at:timestamp with time zone',
    'retired_at:timestamp with time zone'
  ]::text[] then
    raise exception 'referral mission definition columns changed';
  end if;

  if (
    select count(*)
    from pg_catalog.pg_constraint constraint_record
    where constraint_record.conrelid =
        'private.demand_gap_definitions'::pg_catalog.regclass
      and constraint_record.convalidated
  ) <> 8 or (
    select count(*)
    from pg_catalog.pg_constraint constraint_record
    where constraint_record.conrelid =
        'private.referral_mission_definitions'::pg_catalog.regclass
      and constraint_record.convalidated
  ) <> 7 then
    raise exception 'dormant definition constraint count changed';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_record
    where constraint_record.conname = 'demand_gap_definitions_market_id_fkey'
      and constraint_record.conrelid =
        'private.demand_gap_definitions'::pg_catalog.regclass
      and constraint_record.confrelid = 'public.markets'::pg_catalog.regclass
      and constraint_record.contype = 'f'
      and constraint_record.confdeltype = 'r'
      and constraint_record.conkey = array[
        (
          select attribute_record.attnum
          from pg_catalog.pg_attribute attribute_record
          where attribute_record.attrelid =
              'private.demand_gap_definitions'::pg_catalog.regclass
            and attribute_record.attname = 'market_id'
        )
      ]::smallint[]
      and constraint_record.confkey = array[
        (
          select attribute_record.attnum
          from pg_catalog.pg_attribute attribute_record
          where attribute_record.attrelid = 'public.markets'::pg_catalog.regclass
            and attribute_record.attname = 'id'
        )
      ]::smallint[]
      and constraint_record.convalidated
  ) or not exists (
    select 1
    from pg_catalog.pg_constraint constraint_record
    where constraint_record.conname = 'demand_gap_definitions_category_id_fkey'
      and constraint_record.conrelid =
        'private.demand_gap_definitions'::pg_catalog.regclass
      and constraint_record.confrelid = 'public.categories'::pg_catalog.regclass
      and constraint_record.contype = 'f'
      and constraint_record.confdeltype = 'r'
      and constraint_record.conkey = array[
        (
          select attribute_record.attnum
          from pg_catalog.pg_attribute attribute_record
          where attribute_record.attrelid =
              'private.demand_gap_definitions'::pg_catalog.regclass
            and attribute_record.attname = 'category_id'
        )
      ]::smallint[]
      and constraint_record.confkey = array[
        (
          select attribute_record.attnum
          from pg_catalog.pg_attribute attribute_record
          where attribute_record.attrelid =
              'public.categories'::pg_catalog.regclass
            and attribute_record.attname = 'id'
        )
      ]::smallint[]
      and constraint_record.convalidated
  ) or not exists (
    select 1
    from pg_catalog.pg_constraint constraint_record
    where constraint_record.conname =
        'referral_mission_definitions_demand_gap_id_fkey'
      and constraint_record.conrelid =
        'private.referral_mission_definitions'::pg_catalog.regclass
      and constraint_record.confrelid =
        'private.demand_gap_definitions'::pg_catalog.regclass
      and constraint_record.contype = 'f'
      and constraint_record.confdeltype = 'r'
      and constraint_record.conkey = array[
        (
          select attribute_record.attnum
          from pg_catalog.pg_attribute attribute_record
          where attribute_record.attrelid =
              'private.referral_mission_definitions'::pg_catalog.regclass
            and attribute_record.attname = 'demand_gap_id'
        )
      ]::smallint[]
      and constraint_record.confkey = array[
        (
          select attribute_record.attnum
          from pg_catalog.pg_attribute attribute_record
          where attribute_record.attrelid =
              'private.demand_gap_definitions'::pg_catalog.regclass
            and attribute_record.attname = 'id'
        )
      ]::smallint[]
      and constraint_record.convalidated
  ) then
    raise exception 'dormant definition foreign-key contract changed';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_record
    where constraint_record.conname =
        'demand_gap_definitions_identity_unique'
      and constraint_record.conrelid =
        'private.demand_gap_definitions'::pg_catalog.regclass
      and constraint_record.contype = 'u'
      and pg_catalog.pg_get_constraintdef(constraint_record.oid) =
        'UNIQUE (market_id, category_id, kind, demand_key, definition_version)'
  ) or not exists (
    select 1
    from pg_catalog.pg_constraint constraint_record
    where constraint_record.conname =
        'referral_mission_definitions_identity_unique'
      and constraint_record.conrelid =
        'private.referral_mission_definitions'::pg_catalog.regclass
      and constraint_record.contype = 'u'
      and pg_catalog.pg_get_constraintdef(constraint_record.oid) =
        'UNIQUE (demand_gap_id, kind, target, definition_version)'
  ) then
    raise exception 'dormant definition identity contract changed';
  end if;

  if (
    select count(*)
    from pg_catalog.pg_index index_record
    where index_record.indrelid =
        'private.demand_gap_definitions'::pg_catalog.regclass
      and index_record.indisvalid
      and index_record.indisready
  ) <> 3 or (
    select count(*)
    from pg_catalog.pg_index index_record
    where index_record.indrelid =
        'private.referral_mission_definitions'::pg_catalog.regclass
      and index_record.indisvalid
      and index_record.indisready
  ) <> 2 or not exists (
    select 1
    from pg_catalog.pg_index index_record
    where index_record.indexrelid =
        'private.demand_gap_definitions_category_fkey_idx'::pg_catalog.regclass
      and index_record.indrelid =
        'private.demand_gap_definitions'::pg_catalog.regclass
      and not index_record.indisunique
      and index_record.indisvalid
      and index_record.indisready
      and index_record.indpred is null
      and index_record.indexprs is null
      and pg_catalog.pg_get_indexdef(index_record.indexrelid) =
        'CREATE INDEX demand_gap_definitions_category_fkey_idx ON private.demand_gap_definitions USING btree (category_id)'
  ) then
    raise exception 'dormant definition index contract changed';
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
      raise exception '% RLS, owner, or policy state changed', relation_name;
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
      raise exception 'PUBLIC retained a dormant definition ACL';
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
          raise exception '% retained % on %',
            role_name, privilege_name, relation_name;
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
          raise exception '% retained column % on %',
            role_name, privilege_name, relation_name;
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
          and pg_catalog.pg_get_triggerdef(trigger_record.oid) like
            '%UPDATE OF market_id, category_id%'
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
    raise exception 'dormant definition trigger contract changed';
  end if;

  foreach function_name in array array[
    'private.validate_demand_gap_market_category()',
    'private.prevent_dormant_demand_referral_mission_mutation()'
  ] loop
    if not exists (
      select 1
      from pg_catalog.pg_proc routine_record
      where routine_record.oid = function_name::pg_catalog.regprocedure
        and not routine_record.prosecdef
        and pg_catalog.pg_get_userbyid(routine_record.proowner) = 'postgres'
        and coalesce(routine_record.proconfig, array[]::text[])
          @> array['search_path=""']::text[]
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
      raise exception 'dormant definition function metadata changed';
    end if;

    foreach role_name in array array['anon', 'authenticated', 'service_role'] loop
      if pg_catalog.has_function_privilege(role_name, function_name, 'execute') then
        raise exception '% retained execute on %', role_name, function_name;
      end if;
    end loop;
  end loop;

  foreach type_name in array array[
    'private.dormant_definition_status_code',
    'private.demand_gap_kind_code',
    'private.referral_mission_kind_code',
    'private.referral_target_code'
  ] loop
    if not exists (
      select 1
      from pg_catalog.pg_type type_record
      where type_record.oid = type_name::pg_catalog.regtype
        and type_record.typtype = 'e'
        and pg_catalog.pg_get_userbyid(type_record.typowner) = 'postgres'
    ) or exists (
      select 1
      from pg_catalog.pg_type type_record
      cross join lateral pg_catalog.aclexplode(
        coalesce(
          type_record.typacl,
          pg_catalog.acldefault('T', type_record.typowner)
        )
      ) privilege_record
      where type_record.oid = type_name::pg_catalog.regtype
        and privilege_record.grantee = 0
        and privilege_record.privilege_type = 'USAGE'
    ) then
      raise exception 'dormant definition type metadata changed';
    end if;

    foreach role_name in array array['anon', 'authenticated', 'service_role'] loop
      if pg_catalog.has_type_privilege(role_name, type_name, 'usage') then
        raise exception '% retained type usage on %', role_name, type_name;
      end if;
    end loop;
  end loop;

  select pg_catalog.array_agg(
    enum_record.enumlabel order by enum_record.enumsortorder
  ) into actual_labels
  from pg_catalog.pg_enum enum_record
  where enum_record.enumtypid =
    'private.dormant_definition_status_code'::pg_catalog.regtype;
  if actual_labels is distinct from array['draft', 'retired']::text[] then
    raise exception 'dormant definition status labels changed';
  end if;

  select pg_catalog.array_agg(
    enum_record.enumlabel order by enum_record.enumsortorder
  ) into actual_labels
  from pg_catalog.pg_enum enum_record
  where enum_record.enumtypid =
    'private.demand_gap_kind_code'::pg_catalog.regtype;
  if actual_labels is distinct from array['merchant_supply_gap']::text[] then
    raise exception 'demand gap kind labels changed';
  end if;

  select pg_catalog.array_agg(
    enum_record.enumlabel order by enum_record.enumsortorder
  ) into actual_labels
  from pg_catalog.pg_enum enum_record
  where enum_record.enumtypid =
    'private.referral_mission_kind_code'::pg_catalog.regtype;
  if actual_labels is distinct from array['merchant_recruitment']::text[] then
    raise exception 'referral mission kind labels changed';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_type type_record
    join pg_catalog.pg_namespace namespace_record
      on namespace_record.oid = type_record.typnamespace
    where namespace_record.nspname = 'public'
      and type_record.typname in (
        'dormant_definition_status_code',
        'demand_gap_kind_code',
        'referral_mission_kind_code',
        'demand_gap_definitions',
        'referral_mission_definitions'
      )
  ) then
    raise exception 'generated public types unexpectedly include dormant definitions';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc routine_record
    join pg_catalog.pg_namespace namespace_record
      on namespace_record.oid = routine_record.pronamespace
    where namespace_record.nspname = 'public'
      and routine_record.prosrc ~
        E'\\m(demand_gap_definitions|referral_mission_definitions)\\M'
  ) then
    raise exception 'public RPC unexpectedly references dormant definitions';
  end if;
end;
$$;

-- Every application role must fail at the ACL boundary, not merely observe an
-- empty RLS result.
set local role anon;
do $$
declare relation_name text;
begin
  foreach relation_name in array array[
    'private.demand_gap_definitions',
    'private.referral_mission_definitions'
  ] loop
    begin
      execute pg_catalog.format('select 1 from %s limit 1', relation_name);
      raise exception 'anon read unexpectedly worked on %', relation_name;
    exception when insufficient_privilege then null;
    end;
    begin
      execute pg_catalog.format('insert into %s default values', relation_name);
      raise exception 'anon insert unexpectedly worked on %', relation_name;
    exception when insufficient_privilege then null;
    end;
    begin
      execute pg_catalog.format('delete from %s', relation_name);
      raise exception 'anon delete unexpectedly worked on %', relation_name;
    exception when insufficient_privilege then null;
    end;
    begin
      execute pg_catalog.format('truncate table %s cascade', relation_name);
      raise exception 'anon truncate unexpectedly worked on %', relation_name;
    exception when insufficient_privilege then null;
    end;
  end loop;
end;
$$;

set local role authenticated;
do $$
declare relation_name text;
begin
  foreach relation_name in array array[
    'private.demand_gap_definitions',
    'private.referral_mission_definitions'
  ] loop
    begin
      execute pg_catalog.format('select 1 from %s limit 1', relation_name);
      raise exception 'authenticated read unexpectedly worked on %', relation_name;
    exception when insufficient_privilege then null;
    end;
    begin
      execute pg_catalog.format('insert into %s default values', relation_name);
      raise exception 'authenticated insert unexpectedly worked on %', relation_name;
    exception when insufficient_privilege then null;
    end;
    begin
      execute pg_catalog.format('delete from %s', relation_name);
      raise exception 'authenticated delete unexpectedly worked on %', relation_name;
    exception when insufficient_privilege then null;
    end;
    begin
      execute pg_catalog.format('truncate table %s cascade', relation_name);
      raise exception 'authenticated truncate unexpectedly worked on %', relation_name;
    exception when insufficient_privilege then null;
    end;
  end loop;
end;
$$;

set local role service_role;
do $$
declare relation_name text;
begin
  foreach relation_name in array array[
    'private.demand_gap_definitions',
    'private.referral_mission_definitions'
  ] loop
    begin
      execute pg_catalog.format('select 1 from %s limit 1', relation_name);
      raise exception 'service read unexpectedly worked on %', relation_name;
    exception when insufficient_privilege then null;
    end;
    begin
      execute pg_catalog.format('insert into %s default values', relation_name);
      raise exception 'service insert unexpectedly worked on %', relation_name;
    exception when insufficient_privilege then null;
    end;
    begin
      execute pg_catalog.format('delete from %s', relation_name);
      raise exception 'service delete unexpectedly worked on %', relation_name;
    exception when insufficient_privilege then null;
    end;
    begin
      execute pg_catalog.format('truncate table %s cascade', relation_name);
      raise exception 'service truncate unexpectedly worked on %', relation_name;
    exception when insufficient_privilege then null;
    end;
  end loop;
end;
$$;

set local role postgres;

-- Owner attempts are also blocked before ordinary row constraints can become
-- an accidental writer path.
do $$
declare
  expected_message constant text :=
    'demand-gap and referral-mission definitions are dormant';
begin
  begin
    insert into private.demand_gap_definitions default values;
    raise exception 'owner demand gap insert unexpectedly worked';
  exception when others then
    if sqlstate <> '55000' or sqlerrm <> expected_message then raise; end if;
  end;

  begin
    insert into private.referral_mission_definitions default values;
    raise exception 'owner referral mission insert unexpectedly worked';
  exception when others then
    if sqlstate <> '55000' or sqlerrm <> expected_message then raise; end if;
  end;

  begin
    truncate private.demand_gap_definitions cascade;
    raise exception 'owner demand gap truncate unexpectedly worked';
  exception when others then
    if sqlstate <> '55000' or sqlerrm <> expected_message then raise; end if;
  end;

  begin
    truncate private.referral_mission_definitions cascade;
    raise exception 'owner referral mission truncate unexpectedly worked';
  exception when others then
    if sqlstate <> '55000' or sqlerrm <> expected_message then raise; end if;
  end;
end;
$$;

create temporary table demand_referral_mission_probe_state (
  active_market_id uuid not null,
  other_market_id uuid not null,
  inactive_market_id uuid not null,
  active_category_id uuid not null,
  global_category_id uuid not null,
  other_category_id uuid not null,
  inactive_category_id uuid not null,
  demand_gap_id uuid not null,
  global_demand_gap_id uuid not null,
  referral_mission_id uuid not null
) on commit drop;

insert into demand_referral_mission_probe_state
select
  extensions.gen_random_uuid(),
  extensions.gen_random_uuid(),
  extensions.gen_random_uuid(),
  extensions.gen_random_uuid(),
  extensions.gen_random_uuid(),
  extensions.gen_random_uuid(),
  extensions.gen_random_uuid(),
  extensions.gen_random_uuid(),
  extensions.gen_random_uuid(),
  extensions.gen_random_uuid();

insert into public.markets(id, slug, name, is_active)
select
  active_market_id,
  'dormant-demand-' || replace(active_market_id::text, '-', ''),
  'Dormant demand active market',
  true
from demand_referral_mission_probe_state
union all
select
  other_market_id,
  'dormant-demand-' || replace(other_market_id::text, '-', ''),
  'Dormant demand other market',
  true
from demand_referral_mission_probe_state
union all
select
  inactive_market_id,
  'dormant-demand-' || replace(inactive_market_id::text, '-', ''),
  'Dormant demand inactive market',
  false
from demand_referral_mission_probe_state;

insert into public.categories(id, market_id, slug, name, is_active)
select
  active_category_id,
  active_market_id,
  'dormant-demand-active',
  'Dormant demand active category',
  true
from demand_referral_mission_probe_state
union all
select
  global_category_id,
  null,
  'dormant-demand-global-' || replace(global_category_id::text, '-', ''),
  'Dormant demand global category',
  true
from demand_referral_mission_probe_state
union all
select
  other_category_id,
  other_market_id,
  'dormant-demand-other',
  'Dormant demand other category',
  true
from demand_referral_mission_probe_state
union all
select
  inactive_category_id,
  active_market_id,
  'dormant-demand-inactive',
  'Dormant demand inactive category',
  false
from demand_referral_mission_probe_state;

alter table private.demand_gap_definitions
  disable trigger demand_gap_definitions_dormant_rows;
alter table private.referral_mission_definitions
  disable trigger referral_mission_definitions_dormant_rows;

insert into private.demand_gap_definitions(
  id, market_id, category_id, demand_key
)
select demand_gap_id, active_market_id, active_category_id, 'merchant-supply-gap'
from demand_referral_mission_probe_state;

insert into private.demand_gap_definitions(
  id, market_id, category_id, demand_key
)
select global_demand_gap_id, active_market_id, global_category_id, 'global_supply_gap'
from demand_referral_mission_probe_state;

insert into private.referral_mission_definitions(id, demand_gap_id)
select referral_mission_id, demand_gap_id
from demand_referral_mission_probe_state;

do $$
declare
  invalid_key text;
  probe demand_referral_mission_probe_state%rowtype;
begin
  select * into strict probe from demand_referral_mission_probe_state;

  foreach invalid_key in array array[
    'ab',
    'Invalid-Key',
    'bad/key',
    'bad key',
    pg_catalog.repeat('a', 97)
  ] loop
    begin
      insert into private.demand_gap_definitions(
        market_id, category_id, demand_key
      ) values (probe.active_market_id, probe.active_category_id, invalid_key);
      raise exception 'invalid demand key unexpectedly worked: %', invalid_key;
    exception when check_violation then null;
    end;
  end loop;

  begin
    insert into private.demand_gap_definitions(
      market_id, category_id, demand_key
    ) values (
      probe.active_market_id,
      probe.other_category_id,
      'cross-market-gap'
    );
    raise exception 'cross-market category unexpectedly worked';
  exception when others then
    if sqlstate <> '23514' or sqlerrm <> 'category market mismatch' then
      raise;
    end if;
  end;

  begin
    insert into private.demand_gap_definitions(
      market_id, category_id, demand_key
    ) values (
      probe.inactive_market_id,
      probe.global_category_id,
      'inactive-market-gap'
    );
    raise exception 'inactive market unexpectedly worked';
  exception when others then
    if sqlstate <> '23514' or sqlerrm <> 'category market mismatch' then
      raise;
    end if;
  end;

  begin
    insert into private.demand_gap_definitions(
      market_id, category_id, demand_key
    ) values (
      probe.active_market_id,
      probe.inactive_category_id,
      'inactive-category-gap'
    );
    raise exception 'inactive category unexpectedly worked';
  exception when others then
    if sqlstate <> '23514' or sqlerrm <> 'category market mismatch' then
      raise;
    end if;
  end;

  begin
    insert into private.demand_gap_definitions(
      market_id, category_id, demand_key
    ) values (
      probe.active_market_id,
      probe.active_category_id,
      'merchant-supply-gap'
    );
    raise exception 'duplicate demand gap definition version unexpectedly worked';
  exception when unique_violation then null;
  end;

  begin
    insert into private.referral_mission_definitions(demand_gap_id)
    values (probe.demand_gap_id);
    raise exception 'duplicate referral mission definition version unexpectedly worked';
  exception when unique_violation then null;
  end;

  begin
    insert into private.demand_gap_definitions(
      market_id, category_id, demand_key, definition_version
    ) values (
      probe.active_market_id,
      probe.active_category_id,
      'version-two-gap',
      2
    );
    raise exception 'demand gap definition version two unexpectedly worked';
  exception when check_violation then null;
  end;

  begin
    insert into private.referral_mission_definitions(
      demand_gap_id, definition_version
    ) values (probe.global_demand_gap_id, 2);
    raise exception 'referral mission definition version two unexpectedly worked';
  exception when check_violation then null;
  end;

  begin
    insert into private.demand_gap_definitions(
      market_id, category_id, demand_key, status, retired_at
    ) values (
      probe.active_market_id,
      probe.active_category_id,
      'invalid-draft-state',
      'draft',
      now()
    );
    raise exception 'draft demand gap with retired timestamp unexpectedly worked';
  exception when check_violation then null;
  end;

  begin
    insert into private.referral_mission_definitions(
      demand_gap_id, status, retired_at
    ) values (probe.global_demand_gap_id, 'retired', null);
    raise exception 'retired mission without timestamp unexpectedly worked';
  exception when check_violation then null;
  end;

  begin
    delete from private.demand_gap_definitions
    where id = probe.demand_gap_id;
    raise exception 'referenced demand gap delete unexpectedly worked';
  exception when foreign_key_violation then null;
  end;
end;
$$;

do $$
begin
  if (select count(*) from private.demand_gap_definitions) <> 2
    or (select count(*) from private.referral_mission_definitions) <> 1
  then
    raise exception 'adversarial definition checks changed fixture rows';
  end if;
end;
$$;

alter table private.demand_gap_definitions
  enable always trigger demand_gap_definitions_dormant_rows;
alter table private.referral_mission_definitions
  enable always trigger referral_mission_definitions_dormant_rows;

do $$
declare
  expected_message constant text :=
    'demand-gap and referral-mission definitions are dormant';
begin
  begin
    update private.demand_gap_definitions set demand_key = demand_key;
    raise exception 'owner demand gap update unexpectedly worked';
  exception when others then
    if sqlstate <> '55000' or sqlerrm <> expected_message then raise; end if;
  end;

  begin
    delete from private.demand_gap_definitions;
    raise exception 'owner demand gap delete unexpectedly worked';
  exception when others then
    if sqlstate <> '55000' or sqlerrm <> expected_message then raise; end if;
  end;

  begin
    update private.referral_mission_definitions set status = status;
    raise exception 'owner referral mission update unexpectedly worked';
  exception when others then
    if sqlstate <> '55000' or sqlerrm <> expected_message then raise; end if;
  end;

  begin
    delete from private.referral_mission_definitions;
    raise exception 'owner referral mission delete unexpectedly worked';
  exception when others then
    if sqlstate <> '55000' or sqlerrm <> expected_message then raise; end if;
  end;
end;
$$;

alter table private.demand_gap_definitions
  disable trigger demand_gap_definitions_dormant_rows;
alter table private.referral_mission_definitions
  disable trigger referral_mission_definitions_dormant_rows;

delete from private.referral_mission_definitions;
delete from private.demand_gap_definitions;

alter table private.demand_gap_definitions
  enable always trigger demand_gap_definitions_dormant_rows;
alter table private.referral_mission_definitions
  enable always trigger referral_mission_definitions_dormant_rows;

do $$
begin
  if (select count(*) from private.demand_gap_definitions) <> 0
    or (select count(*) from private.referral_mission_definitions) <> 0
  then
    raise exception 'probe left demand-gap or referral-mission fixture residue';
  end if;
end;
$$;

rollback;

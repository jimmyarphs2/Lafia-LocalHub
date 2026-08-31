-- Rollback-only live regression probe for Step 26 migration 033.
begin;

set local lock_timeout = '10s';
set local statement_timeout = '120s';

lock table
  public.searches,
  public.search_intents,
  public.demand_signals,
  public.unmet_demand,
  public.missions,
  public.mission_progress
in access exclusive mode;

-- The quarantined relations must remain empty, force-RLS, policy-free, and
-- unreachable through direct application table or column privileges.
do $$
declare
  blocker_function pg_catalog.pg_proc%rowtype;
  owner_name text;
  privilege_name text;
  role_name text;
  table_name text;
begin
  if (select count(*) from public.searches) <> 0
    or (select count(*) from public.search_intents) <> 0
    or (select count(*) from public.demand_signals) <> 0
    or (select count(*) from public.unmet_demand) <> 0
    or (select count(*) from public.missions) <> 0
    or (select count(*) from public.mission_progress) <> 0
  then
    raise exception 'legacy quarantine was not empty before probe';
  end if;

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
    raise exception 'legacy quarantine blocker metadata changed';
  end if;

  foreach role_name in array array['anon', 'authenticated', 'service_role'] loop
    if pg_catalog.has_function_privilege(
      role_name,
      'private.prevent_dormant_demand_mission_mutation()',
      'execute'
    ) then
      raise exception '% retained blocker execute', role_name;
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
      raise exception '% RLS or policy state changed', table_name;
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
      raise exception 'PUBLIC retained an ACL on %', table_name;
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
          raise exception '% retained % on %',
            role_name, privilege_name, table_name;
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
          raise exception '% retained column % on %',
            role_name, privilege_name, table_name;
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
      raise exception '% blocker attachment changed', table_name;
    end if;
  end loop;

  if (
    select count(*)
    from pg_catalog.pg_trigger trigger_record
    where not trigger_record.tgisinternal
      and trigger_record.tgenabled = 'A'
      and trigger_record.tgfoid = blocker_function.oid
  ) <> 12 then
    raise exception 'legacy quarantine blocker count changed';
  end if;

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
    raise exception 'legacy quarantine unexpectedly has a public callable writer';
  end if;
end;
$$;

-- Each application role must fail at the ACL before either an empty result or
-- a row-level constraint can disclose anything about these relations.
set local role anon;
do $$
declare table_name text;
begin
  foreach table_name in array array[
    'searches', 'search_intents', 'demand_signals',
    'unmet_demand', 'missions', 'mission_progress'
  ] loop
    begin
      execute pg_catalog.format('select 1 from public.%I limit 1', table_name);
      raise exception 'anon read unexpectedly worked on %', table_name;
    exception when insufficient_privilege then null;
    end;
    begin
      execute pg_catalog.format('insert into public.%I default values', table_name);
      raise exception 'anon insert unexpectedly worked on %', table_name;
    exception when insufficient_privilege then null;
    end;
    begin
      execute pg_catalog.format('delete from public.%I', table_name);
      raise exception 'anon delete unexpectedly worked on %', table_name;
    exception when insufficient_privilege then null;
    end;
    begin
      execute pg_catalog.format('truncate table public.%I cascade', table_name);
      raise exception 'anon truncate unexpectedly worked on %', table_name;
    exception when insufficient_privilege then null;
    end;
  end loop;
end;
$$;

set local role authenticated;
do $$
declare table_name text;
begin
  foreach table_name in array array[
    'searches', 'search_intents', 'demand_signals',
    'unmet_demand', 'missions', 'mission_progress'
  ] loop
    begin
      execute pg_catalog.format('select 1 from public.%I limit 1', table_name);
      raise exception 'authenticated read unexpectedly worked on %', table_name;
    exception when insufficient_privilege then null;
    end;
    begin
      execute pg_catalog.format('insert into public.%I default values', table_name);
      raise exception 'authenticated insert unexpectedly worked on %', table_name;
    exception when insufficient_privilege then null;
    end;
    begin
      execute pg_catalog.format('delete from public.%I', table_name);
      raise exception 'authenticated delete unexpectedly worked on %', table_name;
    exception when insufficient_privilege then null;
    end;
    begin
      execute pg_catalog.format('truncate table public.%I cascade', table_name);
      raise exception 'authenticated truncate unexpectedly worked on %', table_name;
    exception when insufficient_privilege then null;
    end;
  end loop;
end;
$$;

set local role service_role;
do $$
declare table_name text;
begin
  foreach table_name in array array[
    'searches', 'search_intents', 'demand_signals',
    'unmet_demand', 'missions', 'mission_progress'
  ] loop
    begin
      execute pg_catalog.format('select 1 from public.%I limit 1', table_name);
      raise exception 'service read unexpectedly worked on %', table_name;
    exception when insufficient_privilege then null;
    end;
    begin
      execute pg_catalog.format('insert into public.%I default values', table_name);
      raise exception 'service insert unexpectedly worked on %', table_name;
    exception when insufficient_privilege then null;
    end;
    begin
      execute pg_catalog.format('delete from public.%I', table_name);
      raise exception 'service delete unexpectedly worked on %', table_name;
    exception when insufficient_privilege then null;
    end;
    begin
      execute pg_catalog.format('truncate table public.%I cascade', table_name);
      raise exception 'service truncate unexpectedly worked on %', table_name;
    exception when insufficient_privilege then null;
    end;
  end loop;
end;
$$;

-- Seed valid transaction-local parent identities, then temporarily disable only
-- the six row guards. RI and market-integrity triggers stay enabled throughout;
-- the quarantine guards return to ALWAYS before adversarial mutation begins.
set local role postgres;
create temporary table demand_mission_quarantine_probe_state (
  search_id uuid not null,
  search_intent_id uuid not null,
  demand_signal_id uuid not null,
  unmet_demand_id uuid not null,
  mission_id uuid not null,
  profile_id uuid not null,
  market_id uuid not null
) on commit drop;

insert into demand_mission_quarantine_probe_state
select
  extensions.gen_random_uuid(),
  extensions.gen_random_uuid(),
  extensions.gen_random_uuid(),
  extensions.gen_random_uuid(),
  extensions.gen_random_uuid(),
  extensions.gen_random_uuid(),
  extensions.gen_random_uuid();

insert into auth.users(
  id,
  instance_id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
select
  profile_id,
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'demand-quarantine-' || replace(profile_id::text, '-', '') || '@example.test',
  '',
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,
  now(),
  now()
from demand_mission_quarantine_probe_state;
insert into public.profiles(id, display_name)
select profile_id, 'Demand quarantine probe'
from demand_mission_quarantine_probe_state
on conflict (id) do nothing;
insert into public.markets(id, slug, name, is_active)
select
  market_id,
  'demand-quarantine-' || replace(market_id::text, '-', ''),
  'Demand quarantine probe',
  true
from demand_mission_quarantine_probe_state;

alter table public.searches disable trigger searches_dormant_rows;
alter table public.search_intents disable trigger search_intents_dormant_rows;
alter table public.demand_signals disable trigger demand_signals_dormant_rows;
alter table public.unmet_demand disable trigger unmet_demand_dormant_rows;
alter table public.missions disable trigger missions_dormant_rows;
alter table public.mission_progress disable trigger mission_progress_dormant_rows;

insert into public.searches(
  id, actor_id, market_id, query_text, normalized_query, deterministic_key
)
select search_id, profile_id, market_id, 'probe', 'probe', 'probe'
from demand_mission_quarantine_probe_state;
insert into public.search_intents(id, search_id, intent_kind)
select search_intent_id, search_id, 'probe'
from demand_mission_quarantine_probe_state;
insert into public.demand_signals(
  id, market_id, source_search_id, signal_type
)
select demand_signal_id, market_id, search_id, 'probe'
from demand_mission_quarantine_probe_state;
insert into public.unmet_demand(
  id, market_id, deterministic_key, evidence_count
)
select unmet_demand_id, market_id, 'probe', 1
from demand_mission_quarantine_probe_state;
insert into public.missions(id, market_id, name)
select mission_id, market_id, 'probe'
from demand_mission_quarantine_probe_state;
insert into public.mission_progress(mission_id, profile_id)
select mission_id, profile_id
from demand_mission_quarantine_probe_state;

alter table public.searches enable always trigger searches_dormant_rows;
alter table public.search_intents enable always trigger search_intents_dormant_rows;
alter table public.demand_signals enable always trigger demand_signals_dormant_rows;
alter table public.unmet_demand enable always trigger unmet_demand_dormant_rows;
alter table public.missions enable always trigger missions_dormant_rows;
alter table public.mission_progress enable always trigger mission_progress_dormant_rows;

-- Owner INSERT attempts hit the guard before FK or validation behavior.
do $$
declare
  expected_message constant text :=
    'legacy search, demand, and mission state is dormant';
begin
  begin
    insert into public.searches(
      actor_id, market_id, query_text, normalized_query, deterministic_key
    ) values (
      extensions.gen_random_uuid(), extensions.gen_random_uuid(),
      'blocked', 'blocked', 'blocked'
    );
    raise exception 'owner search insert unexpectedly worked';
  exception when others then
    if sqlstate <> '55000' or sqlerrm <> expected_message then raise; end if;
  end;
  begin
    insert into public.search_intents(search_id, category_id, intent_kind)
    values (extensions.gen_random_uuid(), extensions.gen_random_uuid(), 'blocked');
    raise exception 'owner search intent insert unexpectedly worked';
  exception when others then
    if sqlstate <> '55000' or sqlerrm <> expected_message then raise; end if;
  end;
  begin
    insert into public.demand_signals(market_id, category_id, signal_type)
    values (extensions.gen_random_uuid(), extensions.gen_random_uuid(), 'blocked');
    raise exception 'owner demand signal insert unexpectedly worked';
  exception when others then
    if sqlstate <> '55000' or sqlerrm <> expected_message then raise; end if;
  end;
  begin
    insert into public.unmet_demand(market_id, category_id, deterministic_key)
    values (extensions.gen_random_uuid(), extensions.gen_random_uuid(), 'blocked');
    raise exception 'owner unmet demand insert unexpectedly worked';
  exception when others then
    if sqlstate <> '55000' or sqlerrm <> expected_message then raise; end if;
  end;
  begin
    insert into public.missions(market_id, name)
    values (extensions.gen_random_uuid(), 'blocked');
    raise exception 'owner mission insert unexpectedly worked';
  exception when others then
    if sqlstate <> '55000' or sqlerrm <> expected_message then raise; end if;
  end;
  begin
    insert into public.mission_progress(mission_id, profile_id)
    values (extensions.gen_random_uuid(), extensions.gen_random_uuid());
    raise exception 'owner mission progress insert unexpectedly worked';
  exception when others then
    if sqlstate <> '55000' or sqlerrm <> expected_message then raise; end if;
  end;
end;
$$;

-- Every owner row blocker must reject UPDATE and DELETE against a real row.
do $$
declare
  expected_message constant text :=
    'legacy search, demand, and mission state is dormant';
begin
  begin
    update public.searches set query_text = query_text;
    raise exception 'owner search update unexpectedly worked';
  exception when others then
    if sqlstate <> '55000' or sqlerrm <> expected_message then raise; end if;
  end;
  begin
    delete from public.searches;
    raise exception 'owner search delete unexpectedly worked';
  exception when others then
    if sqlstate <> '55000' or sqlerrm <> expected_message then raise; end if;
  end;
  begin
    update public.search_intents set intent_kind = intent_kind;
    raise exception 'owner search intent update unexpectedly worked';
  exception when others then
    if sqlstate <> '55000' or sqlerrm <> expected_message then raise; end if;
  end;
  begin
    delete from public.search_intents;
    raise exception 'owner search intent delete unexpectedly worked';
  exception when others then
    if sqlstate <> '55000' or sqlerrm <> expected_message then raise; end if;
  end;
  begin
    update public.demand_signals set signal_type = signal_type;
    raise exception 'owner demand signal update unexpectedly worked';
  exception when others then
    if sqlstate <> '55000' or sqlerrm <> expected_message then raise; end if;
  end;
  begin
    delete from public.demand_signals;
    raise exception 'owner demand signal delete unexpectedly worked';
  exception when others then
    if sqlstate <> '55000' or sqlerrm <> expected_message then raise; end if;
  end;
  begin
    update public.unmet_demand set evidence_count = evidence_count;
    raise exception 'owner unmet demand update unexpectedly worked';
  exception when others then
    if sqlstate <> '55000' or sqlerrm <> expected_message then raise; end if;
  end;
  begin
    delete from public.unmet_demand;
    raise exception 'owner unmet demand delete unexpectedly worked';
  exception when others then
    if sqlstate <> '55000' or sqlerrm <> expected_message then raise; end if;
  end;
  begin
    update public.missions set name = name;
    raise exception 'owner mission update unexpectedly worked';
  exception when others then
    if sqlstate <> '55000' or sqlerrm <> expected_message then raise; end if;
  end;
  begin
    delete from public.missions;
    raise exception 'owner mission delete unexpectedly worked';
  exception when others then
    if sqlstate <> '55000' or sqlerrm <> expected_message then raise; end if;
  end;
  begin
    update public.mission_progress set progress = progress;
    raise exception 'owner mission progress update unexpectedly worked';
  exception when others then
    if sqlstate <> '55000' or sqlerrm <> expected_message then raise; end if;
  end;
  begin
    delete from public.mission_progress;
    raise exception 'owner mission progress delete unexpectedly worked';
  exception when others then
    if sqlstate <> '55000' or sqlerrm <> expected_message then raise; end if;
  end;
end;
$$;

-- Statement blockers must also survive targeted CASCADE requests.
do $$
declare
  expected_message constant text :=
    'legacy search, demand, and mission state is dormant';
begin
  begin
    truncate public.searches cascade;
    raise exception 'owner search truncate unexpectedly worked';
  exception when others then
    if sqlstate <> '55000' or sqlerrm <> expected_message then raise; end if;
  end;
  begin
    truncate public.search_intents cascade;
    raise exception 'owner search intent truncate unexpectedly worked';
  exception when others then
    if sqlstate <> '55000' or sqlerrm <> expected_message then raise; end if;
  end;
  begin
    truncate public.demand_signals cascade;
    raise exception 'owner demand signal truncate unexpectedly worked';
  exception when others then
    if sqlstate <> '55000' or sqlerrm <> expected_message then raise; end if;
  end;
  begin
    truncate public.unmet_demand cascade;
    raise exception 'owner unmet demand truncate unexpectedly worked';
  exception when others then
    if sqlstate <> '55000' or sqlerrm <> expected_message then raise; end if;
  end;
  begin
    truncate public.missions cascade;
    raise exception 'owner mission truncate unexpectedly worked';
  exception when others then
    if sqlstate <> '55000' or sqlerrm <> expected_message then raise; end if;
  end;
  begin
    truncate public.mission_progress cascade;
    raise exception 'owner mission progress truncate unexpectedly worked';
  exception when others then
    if sqlstate <> '55000' or sqlerrm <> expected_message then raise; end if;
  end;
end;
$$;

do $$
begin
  if (select count(*) from public.searches) <> 1
    or (select count(*) from public.search_intents) <> 1
    or (select count(*) from public.demand_signals) <> 1
    or (select count(*) from public.unmet_demand) <> 1
    or (select count(*) from public.missions) <> 1
    or (select count(*) from public.mission_progress) <> 1
  then
    raise exception 'legacy quarantine adversarial probe changed fixture rows';
  end if;
end;
$$;

rollback;

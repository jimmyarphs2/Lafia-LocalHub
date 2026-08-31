-- Rollback-only hosted regression probe for migration 037.
begin;

set local lock_timeout = '10s';
set local statement_timeout = '120s';
set local transaction_timeout = '300s';

create temporary table demand_capture_probe_state (
  actor_one uuid not null,
  actor_two uuid not null,
  suspended_actor uuid not null,
  market_id uuid not null,
  foreign_market_id uuid not null,
  invalid_timezone_market_id uuid not null,
  category_id uuid not null,
  foreign_category_id uuid not null,
  invalid_timezone_category_id uuid not null,
  inactive_category_id uuid not null,
  supplied_category_id uuid not null,
  business_id uuid not null,
  listing_type_id uuid not null,
  listing_schema_id uuid not null,
  supplied_listing_id uuid not null,
  activated_listing_id uuid not null,
  suspended_category_id uuid not null,
  fixture_key text not null,
  baseline_auth_users bigint not null,
  baseline_profiles bigint not null,
  baseline_markets bigint not null,
  baseline_categories bigint not null,
  baseline_businesses bigint not null,
  baseline_listing_types bigint not null,
  baseline_listing_schemas bigint not null,
  baseline_mappings bigint not null,
  baseline_listings bigint not null,
  baseline_observations bigint not null
) on commit drop;

insert into demand_capture_probe_state
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
  extensions.gen_random_uuid(),
  extensions.gen_random_uuid(),
  extensions.gen_random_uuid(),
  extensions.gen_random_uuid(),
  extensions.gen_random_uuid(),
  extensions.gen_random_uuid(),
  extensions.gen_random_uuid(),
  extensions.gen_random_uuid(),
  pg_catalog.replace(extensions.gen_random_uuid()::text, '-', ''),
  (select count(*) from auth.users),
  (select count(*) from public.profiles),
  (select count(*) from public.markets),
  (select count(*) from public.categories),
  (select count(*) from public.businesses),
  (select count(*) from public.listing_types),
  (select count(*) from public.listing_schemas),
  (select count(*) from public.category_listing_type_mappings),
  (select count(*) from public.listings),
  (select count(*) from private.unmet_demand_zero_result_days);

grant select on table demand_capture_probe_state
  to anon, authenticated, service_role;

do $$
declare
  function_record pg_catalog.pg_proc%rowtype;
  privilege_name text;
  role_name text;
begin
  if (select baseline_observations from demand_capture_probe_state) <> 0 then
    raise exception 'unmet-demand probe requires an empty observation relation';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_class relation_record
    where relation_record.oid =
        'private.unmet_demand_zero_result_days'::pg_catalog.regclass
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
  ) then
    raise exception 'unmet-demand relation RLS, policy, owner, or Realtime drifted';
  end if;

  foreach role_name in array array['anon', 'authenticated', 'service_role'] loop
    foreach privilege_name in array array[
      'select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger'
    ] loop
      if pg_catalog.has_table_privilege(
        role_name,
        'private.unmet_demand_zero_result_days',
        privilege_name
      ) then
        raise exception 'direct table access unexpectedly succeeded';
      end if;
    end loop;
  end loop;

  select routine_record.*
  into strict function_record
  from pg_catalog.pg_proc routine_record
  where routine_record.oid =
    'public.record_my_unmet_demand_zero_result(text,uuid)'::pg_catalog.regprocedure;

  if not function_record.prosecdef
    or pg_catalog.pg_get_userbyid(function_record.proowner) <> 'postgres'
    or not coalesce(function_record.proconfig, array[]::text[])
      @> array['search_path=""']::text[]
    or function_record.prosrc !~* 'with[[:space:]]+eligibility[[:space:]]+as[[:space:]]+materialized'
    or function_record.prosrc !~* 'write_result[[:space:]]+as[[:space:]]*[(][[:space:]]*insert'
  then
    raise exception 'eligibility and insert do not share one statement snapshot';
  end if;

  if not pg_catalog.has_function_privilege(
      'authenticated',
      'public.record_my_unmet_demand_zero_result(text,uuid)',
      'execute'
    ) or pg_catalog.has_function_privilege(
      'anon',
      'public.record_my_unmet_demand_zero_result(text,uuid)',
      'execute'
    ) or pg_catalog.has_function_privilege(
      'service_role',
      'public.record_my_unmet_demand_zero_result(text,uuid)',
      'execute'
    )
  then
    raise exception 'unmet-demand RPC grant surface drifted';
  end if;
end;
$$;

savepoint demand_capture_fixture;

do $$
declare
  state demand_capture_probe_state%rowtype;
  ale_schema jsonb;
begin
  select * into strict state from demand_capture_probe_state;
  ale_schema := pg_catalog.jsonb_build_object(
    'contractVersion', '1.1',
    'schemaVersion', 1,
    'schemaKey', 'demand_probe_v1',
    'listingKind', 'service',
    'terminology', pg_catalog.jsonb_build_object(
      'singular', 'service',
      'plural', 'services',
      'createAction', 'Add service'
    ),
    'bindings', pg_catalog.jsonb_build_object('title', 'title'),
    'fields', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'key', 'title',
      'label', 'Service name',
      'required', true,
      'type', 'short_text',
      'minLength', 2,
      'maxLength', 120
    ))
  );

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
  ) values
    (
      state.actor_one,
      '00000000-0000-0000-0000-000000000000',
      'authenticated',
      'authenticated',
      'demand-one-' || state.fixture_key || '@example.test',
      '',
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{}'::jsonb,
      now(),
      now()
    ),
    (
      state.actor_two,
      '00000000-0000-0000-0000-000000000000',
      'authenticated',
      'authenticated',
      'demand-two-' || state.fixture_key || '@example.test',
      '',
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{}'::jsonb,
      now(),
      now()
    ),
    (
      state.suspended_actor,
      '00000000-0000-0000-0000-000000000000',
      'authenticated',
      'authenticated',
      'demand-suspended-' || state.fixture_key || '@example.test',
      '',
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{}'::jsonb,
      now(),
      now()
    );

  insert into public.profile_capabilities(profile_id, capability)
  values (state.actor_one, 'super_admin');
  perform pg_catalog.set_config(
    'request.jwt.claim.role',
    'authenticated',
    true
  );
  perform pg_catalog.set_config(
    'request.jwt.claim.sub',
    state.actor_one::text,
    true
  );
  update public.profiles
  set is_suspended = true
  where id = state.suspended_actor;
  perform pg_catalog.set_config('request.jwt.claim.sub', '', true);
  delete from public.profile_capabilities
  where profile_id = state.actor_one
    and capability = 'super_admin';

  insert into public.markets(id, slug, name, timezone, is_active) values
    (
      state.market_id,
      'demand-probe-' || state.fixture_key,
      'Demand probe market',
      'Africa/Lagos',
      true
    ),
    (
      state.foreign_market_id,
      'demand-foreign-' || state.fixture_key,
      'Demand foreign market',
      'Africa/Lagos',
      true
    ),
    (
      state.invalid_timezone_market_id,
      'demand-timezone-' || state.fixture_key,
      'Demand invalid timezone market',
      'Invalid/Timezone',
      true
    );

  insert into public.categories(
    id, market_id, slug, name, is_active
  ) values
    (
      state.category_id,
      state.market_id,
      'demand-gap-' || state.fixture_key,
      'Demand gap category',
      true
    ),
    (
      state.foreign_category_id,
      state.foreign_market_id,
      'demand-foreign-' || state.fixture_key,
      'Demand foreign category',
      true
    ),
    (
      state.invalid_timezone_category_id,
      state.invalid_timezone_market_id,
      'demand-timezone-' || state.fixture_key,
      'Demand invalid timezone category',
      true
    ),
    (
      state.inactive_category_id,
      state.market_id,
      'demand-inactive-' || state.fixture_key,
      'Demand inactive category',
      false
    ),
    (
      state.supplied_category_id,
      state.market_id,
      'demand-supplied-' || state.fixture_key,
      'Demand supplied category',
      true
    ),
    (
      state.suspended_category_id,
      state.market_id,
      'demand-suspended-' || state.fixture_key,
      'Demand suspended-actor category',
      true
    );

  insert into public.listing_types(id, code, name) values (
    state.listing_type_id,
    'service',
    'Demand probe service'
  );
  insert into public.listing_schemas(
    id, listing_type_id, version, status, schema, published_at
  ) values (
    state.listing_schema_id,
    state.listing_type_id,
    1,
    'published',
    ale_schema,
    now()
  );
  insert into public.category_listing_type_mappings(
    category_id,
    listing_type_id,
    listing_schema_id,
    is_default
  ) values
    (state.category_id, state.listing_type_id, state.listing_schema_id, true),
    (
      state.supplied_category_id,
      state.listing_type_id,
      state.listing_schema_id,
      true
    );
  insert into public.businesses(
    id, market_id, name, slug, status
  ) values (
    state.business_id,
    state.market_id,
    'Demand probe business',
    'demand-probe-business-' || state.fixture_key,
    'active'
  );
  insert into public.listings(
    id,
    business_id,
    market_id,
    category_id,
    listing_type_id,
    listing_schema_id,
    slug,
    title,
    status,
    published_at,
    created_by
  ) values (
    state.supplied_listing_id,
    state.business_id,
    state.market_id,
    state.supplied_category_id,
    state.listing_type_id,
    state.listing_schema_id,
    'demand-supplied-' || state.fixture_key,
    'Published demand probe service',
    'active',
    now(),
    state.actor_one
  );
end;
$$;

set local role anon;
do $$
declare
  state demand_capture_probe_state%rowtype;
begin
  select * into strict state from demand_capture_probe_state;
  begin
    perform public.record_my_unmet_demand_zero_result(
      'demand-probe-' || state.fixture_key,
      state.category_id
    );
    raise exception 'anonymous rpc execution unexpectedly succeeded';
  exception
    when insufficient_privilege then null;
  end;
  begin
    perform 1 from private.unmet_demand_zero_result_days;
    raise exception 'direct table access unexpectedly succeeded';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;

reset role;
set local role service_role;
do $$
declare
  state demand_capture_probe_state%rowtype;
begin
  select * into strict state from demand_capture_probe_state;
  begin
    perform public.record_my_unmet_demand_zero_result(
      'demand-probe-' || state.fixture_key,
      state.category_id
    );
    raise exception 'service-role rpc execution unexpectedly succeeded';
  exception
    when insufficient_privilege then null;
  end;
  begin
    perform 1 from private.unmet_demand_zero_result_days;
    raise exception 'direct table access unexpectedly succeeded';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;

reset role;
set local role authenticated;
do $$
declare
  accepted boolean;
  state demand_capture_probe_state%rowtype;
begin
  select * into strict state from demand_capture_probe_state;
  perform pg_catalog.set_config(
    'request.jwt.claim.role',
    'authenticated',
    true
  );
  perform pg_catalog.set_config(
    'request.jwt.claim.sub',
    state.actor_one::text,
    true
  );

  select public.record_my_unmet_demand_zero_result(
    'demand-probe-' || state.fixture_key,
    state.category_id
  ) into accepted;
  if accepted is distinct from true then
    raise exception 'first demand observation was not accepted';
  end if;

  select public.record_my_unmet_demand_zero_result(
    'demand-probe-' || state.fixture_key,
    state.category_id
  ) into accepted;
  if accepted is distinct from true then
    raise exception 'demand observation replay was not accepted';
  end if;

  perform pg_catalog.set_config(
    'request.jwt.claim.sub',
    state.actor_two::text,
    true
  );
  select public.record_my_unmet_demand_zero_result(
    'demand-probe-' || state.fixture_key,
    state.category_id
  ) into accepted;
  if accepted is distinct from true then
    raise exception 'cross-actor demand observation replay was not accepted';
  end if;

  perform pg_catalog.set_config(
    'request.jwt.claim.sub',
    state.suspended_actor::text,
    true
  );
  begin
    perform public.record_my_unmet_demand_zero_result(
      'demand-probe-' || state.fixture_key,
      state.suspended_category_id
    );
    raise exception using
      errcode = '55000',
      message = 'suspended actor unexpectedly recorded demand';
  exception
    when sqlstate 'P0001' then null;
  end;

  perform pg_catalog.set_config(
    'request.jwt.claim.sub',
    state.actor_one::text,
    true
  );
  begin
    perform public.record_my_unmet_demand_zero_result(
      'demand-probe-' || state.fixture_key,
      state.foreign_category_id
    );
    raise exception using
      errcode = '55000',
      message = 'foreign category unexpectedly recorded demand';
  exception
    when sqlstate 'P0001' then null;
  end;
  begin
    perform public.record_my_unmet_demand_zero_result(
      'demand-probe-' || state.fixture_key,
      state.inactive_category_id
    );
    raise exception using
      errcode = '55000',
      message = 'inactive category unexpectedly recorded demand';
  exception
    when sqlstate 'P0001' then null;
  end;
  begin
    perform public.record_my_unmet_demand_zero_result(
      'demand-probe-' || state.fixture_key,
      state.supplied_category_id
    );
    raise exception using
      errcode = '55000',
      message = 'supplied category unexpectedly recorded demand';
  exception
    when sqlstate 'P0001' then null;
  end;
  begin
    perform public.record_my_unmet_demand_zero_result(
      'demand-timezone-' || state.fixture_key,
      state.invalid_timezone_category_id
    );
    raise exception using
      errcode = '55000',
      message = 'invalid timezone market unexpectedly recorded demand';
  exception
    when sqlstate 'P0001' then null;
  end;
end;
$$;

reset role;
do $$
declare
  state demand_capture_probe_state%rowtype;
begin
  select * into strict state from demand_capture_probe_state;
  if (
    select count(*)
    from private.unmet_demand_zero_result_days observation_record
    where observation_record.market_id = state.market_id
      and observation_record.category_id = state.category_id
  ) <> 1 then
    raise exception 'demand observation replay created more than one row';
  end if;

  if exists (
    select 1
    from private.unmet_demand_zero_result_days observation_record
    where observation_record.category_id in (
      state.suspended_category_id,
      state.foreign_category_id,
      state.inactive_category_id,
      state.supplied_category_id,
      state.invalid_timezone_category_id
    )
  ) then
    raise exception 'rejected demand request left an observation';
  end if;

  begin
    update private.unmet_demand_zero_result_days
    set created_at = created_at
    where market_id = state.market_id
      and category_id = state.category_id;
    raise exception 'immutable observation update unexpectedly succeeded';
  exception
    when sqlstate '55000' then null;
  end;
  begin
    delete from private.unmet_demand_zero_result_days
    where market_id = state.market_id
      and category_id = state.category_id;
    raise exception 'immutable observation delete unexpectedly succeeded';
  exception
    when sqlstate '55000' then null;
  end;
  begin
    truncate table private.unmet_demand_zero_result_days;
    raise exception 'immutable observation truncate unexpectedly succeeded';
  exception
    when sqlstate '55000' then null;
  end;

  insert into public.listings(
    id,
    business_id,
    market_id,
    category_id,
    listing_type_id,
    listing_schema_id,
    slug,
    title,
    status,
    published_at,
    created_by
  ) values (
    state.activated_listing_id,
    state.business_id,
    state.market_id,
    state.category_id,
    state.listing_type_id,
    state.listing_schema_id,
    'demand-activated-' || state.fixture_key,
    'Newly activated demand probe service',
    'active',
    now(),
    state.actor_one
  );
end;
$$;

set local role authenticated;
do $$
declare
  state demand_capture_probe_state%rowtype;
begin
  select * into strict state from demand_capture_probe_state;
  perform pg_catalog.set_config(
    'request.jwt.claim.role',
    'authenticated',
    true
  );
  perform pg_catalog.set_config(
    'request.jwt.claim.sub',
    state.actor_one::text,
    true
  );
  begin
    perform public.record_my_unmet_demand_zero_result(
      'demand-probe-' || state.fixture_key,
      state.category_id
    );
    raise exception using
      errcode = '55000',
      message = 'replay after supply activation unexpectedly succeeded';
  exception
    when sqlstate 'P0001' then null;
  end;
end;
$$;

reset role;
do $$
begin
  if exists (select 1 from public.searches)
    or exists (select 1 from public.search_intents)
    or exists (select 1 from public.demand_signals)
    or exists (select 1 from public.unmet_demand)
    or exists (select 1 from public.missions)
    or exists (select 1 from public.mission_progress)
  then
    raise exception 'legacy demand quarantine drifted';
  end if;
  if exists (select 1 from private.demand_gap_definitions)
    or exists (select 1 from private.referral_mission_definitions)
  then
    raise exception 'dormant demand definition foundation drifted';
  end if;
end;
$$;

rollback to savepoint demand_capture_fixture;

do $$
declare
  state demand_capture_probe_state%rowtype;
begin
  select * into strict state from demand_capture_probe_state;
  if (select count(*) from auth.users) <> state.baseline_auth_users
    or (select count(*) from public.profiles) <> state.baseline_profiles
    or (select count(*) from public.markets) <> state.baseline_markets
    or (select count(*) from public.categories) <> state.baseline_categories
    or (select count(*) from public.businesses) <> state.baseline_businesses
    or (select count(*) from public.listing_types) <> state.baseline_listing_types
    or (select count(*) from public.listing_schemas) <> state.baseline_listing_schemas
    or (
      select count(*) from public.category_listing_type_mappings
    ) <> state.baseline_mappings
    or (select count(*) from public.listings) <> state.baseline_listings
    or (
      select count(*) from private.unmet_demand_zero_result_days
    ) <> state.baseline_observations
  then
    raise exception 'left unmet-demand probe fixture residue';
  end if;
end;
$$;

-- This probe never calls nextval and never rewinds a shared sequence.
rollback;

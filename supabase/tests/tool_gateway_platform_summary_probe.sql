-- Rollback-only hosted regression probe for migration 038. Synthetic fixtures,
-- limiter state, and audit evidence are removed before the transaction ends.
begin;

set local lock_timeout = '10s';
set local statement_timeout = '180s';
set local transaction_timeout = '360s';

create temporary table tool_gateway_probe_state (
  super_admin_id uuid not null,
  rate_admin_id uuid not null,
  ordinary_id uuid not null,
  suspended_admin_id uuid not null,
  market_id uuid not null,
  foreign_market_id uuid not null,
  global_category_id uuid not null,
  local_category_id uuid not null,
  inactive_category_id uuid not null,
  foreign_category_id uuid not null,
  active_business_id uuid not null,
  second_business_id uuid not null,
  suspended_business_id uuid not null,
  foreign_business_id uuid not null,
  listing_type_id uuid not null,
  listing_schema_id uuid not null,
  fixture_key text not null,
  market_slug text not null,
  missing_market_slug text not null,
  baseline_auth_users bigint not null,
  baseline_profiles bigint not null,
  baseline_capabilities bigint not null,
  baseline_markets bigint not null,
  baseline_categories bigint not null,
  baseline_businesses bigint not null,
  baseline_listing_types bigint not null,
  baseline_listing_schemas bigint not null,
  baseline_mappings bigint not null,
  baseline_listings bigint not null,
  baseline_variants bigint not null,
  baseline_audits bigint not null,
  baseline_limits bigint not null
) on commit drop;

create temporary table tool_gateway_probe_results (
  label text not null,
  payload jsonb not null
) on commit drop;

create temporary table tool_gateway_domain_snapshot (
  markets bigint not null,
  categories bigint not null,
  businesses bigint not null,
  listings bigint not null,
  orders bigint not null,
  requests bigint not null,
  notifications bigint not null,
  demand_signals bigint not null,
  ai_actions bigint not null
) on commit drop;

insert into tool_gateway_probe_state
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
  fixture_key,
  'tool-probe-' || fixture_key,
  'tool-missing-' || fixture_key,
  (select pg_catalog.count(*) from auth.users),
  (select pg_catalog.count(*) from public.profiles),
  (select pg_catalog.count(*) from public.profile_capabilities),
  (select pg_catalog.count(*) from public.markets),
  (select pg_catalog.count(*) from public.categories),
  (select pg_catalog.count(*) from public.businesses),
  (select pg_catalog.count(*) from public.listing_types),
  (select pg_catalog.count(*) from public.listing_schemas),
  (select pg_catalog.count(*) from public.category_listing_type_mappings),
  (select pg_catalog.count(*) from public.listings),
  (select pg_catalog.count(*) from public.listing_variants),
  (select pg_catalog.count(*) from public.audit_events),
  (select pg_catalog.count(*) from private.tool_gateway_actor_rate_limits)
from (
  select pg_catalog.replace(
    extensions.gen_random_uuid()::text, '-', ''
  ) as fixture_key
) fixture;

grant select on table tool_gateway_probe_state
  to anon, authenticated, service_role;
grant all on table tool_gateway_probe_results
  to anon, authenticated, service_role;
grant select on table tool_gateway_domain_snapshot
  to anon, authenticated, service_role;

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
    from pg_catalog.pg_publication_tables publication_record
    where publication_record.schemaname = 'private'
      and publication_record.tablename = 'tool_gateway_actor_rate_limits'
  ) then
    raise exception 'tool-gateway limiter security boundary drifted';
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
        raise exception 'direct tool-gateway control-table access unexpectedly succeeded';
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
    or pg_catalog.pg_get_userbyid(function_record.proowner) <> 'postgres'
    or not pg_catalog.coalesce(function_record.proconfig, array[]::text[])
      @> array['search_path=""']::text[]
    or function_record.prosrc !~* 'for[[:space:]]+share'
    or function_record.prosrc !~* 'consume_tool_gateway_read_rate_limit'
  then
    raise exception 'tool-gateway RPC authorization boundary drifted';
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
    raise exception 'tool-gateway RPC grant boundary drifted';
  end if;
end;
$$;

savepoint tool_gateway_fixture;

do $$
declare
  state tool_gateway_probe_state%rowtype;
  ale_schema jsonb;
begin
  select * into strict state from tool_gateway_probe_state;
  ale_schema := pg_catalog.jsonb_build_object(
    'contractVersion', '1.1',
    'schemaVersion', 1,
    'schemaKey', 'tool_probe_' || state.fixture_key,
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
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
  )
  select profile_id, '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'tool-probe-' || label || '-' || state.fixture_key || '@example.test',
    '', now(), '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb, now(), now()
  from (values
    (state.super_admin_id, 'super'),
    (state.rate_admin_id, 'rate'),
    (state.ordinary_id, 'ordinary'),
    (state.suspended_admin_id, 'suspended')
  ) users(profile_id, label);

  insert into public.profile_capabilities(profile_id, capability) values
    (state.super_admin_id, 'super_admin'),
    (state.rate_admin_id, 'super_admin'),
    (state.suspended_admin_id, 'super_admin');

  perform pg_catalog.set_config(
    'request.jwt.claim.role', 'authenticated', true
  );
  perform pg_catalog.set_config(
    'request.jwt.claim.sub', state.super_admin_id::text, true
  );
  update public.profiles
  set is_suspended = true
  where id = state.suspended_admin_id;
  perform pg_catalog.set_config('request.jwt.claim.sub', '', true);

  insert into public.markets(
    id, slug, name, country_code, currency_code, timezone, is_active
  ) values
    (
      state.market_id, state.market_slug, 'Tool probe market',
      'NG', 'NGN', 'Africa/Lagos', true
    ),
    (
      state.foreign_market_id, 'tool-foreign-' || state.fixture_key,
      'Tool foreign market', 'NG', 'NGN', 'Africa/Lagos', true
    );

  insert into public.categories(
    id, market_id, slug, name, kind, is_active
  ) values
    (
      state.global_category_id, null,
      'tool-global-' || state.fixture_key, 'Tool global', 'standard', true
    ),
    (
      state.local_category_id, state.market_id,
      'tool-local-' || state.fixture_key, 'Tool local', 'standard', true
    ),
    (
      state.inactive_category_id, state.market_id,
      'tool-inactive-' || state.fixture_key, 'Tool inactive', 'standard', false
    ),
    (
      state.foreign_category_id, state.foreign_market_id,
      'tool-foreign-' || state.fixture_key, 'Tool foreign', 'standard', true
    );

  insert into public.listing_types(id, code, name, is_active)
  values (
    state.listing_type_id,
    'tool_probe_' || pg_catalog.substr(state.fixture_key, 1, 24),
    'Tool probe type',
    true
  );
  insert into public.listing_schemas(
    id, listing_type_id, version, status, schema, published_at
  ) values (
    state.listing_schema_id, state.listing_type_id, 1, 'published',
    ale_schema, now()
  );
  insert into public.category_listing_type_mappings(
    category_id, listing_type_id, listing_schema_id, is_default
  ) values
    (state.global_category_id, state.listing_type_id,
      state.listing_schema_id, true),
    (state.local_category_id, state.listing_type_id,
      state.listing_schema_id, true),
    (state.inactive_category_id, state.listing_type_id,
      state.listing_schema_id, true),
    (state.foreign_category_id, state.listing_type_id,
      state.listing_schema_id, true);

  insert into public.businesses(
    id, market_id, name, slug, status
  ) values
    (
      state.active_business_id, state.market_id, 'Tool active vendor',
      'tool-active-' || state.fixture_key, 'active'
    ),
    (
      state.second_business_id, state.market_id, 'Tool second vendor',
      'tool-second-' || state.fixture_key, 'active'
    ),
    (
      state.suspended_business_id, state.market_id, 'Tool suspended vendor',
      'tool-suspended-' || state.fixture_key, 'suspended'
    ),
    (
      state.foreign_business_id, state.foreign_market_id,
      'Tool foreign vendor', 'tool-foreign-' || state.fixture_key, 'active'
    );

  insert into public.listings(
    id, business_id, market_id, category_id, listing_type_id,
    listing_schema_id, slug, title, status, is_orderable, price_minor,
    currency_code, published_at
  ) values
    (
      extensions.gen_random_uuid(), state.active_business_id, state.market_id,
      state.local_category_id, state.listing_type_id, state.listing_schema_id,
      'tool-orderable-' || state.fixture_key, 'Orderable tool fixture',
      'active', true, 10000, 'NGN', now()
    ),
    (
      extensions.gen_random_uuid(), state.second_business_id, state.market_id,
      state.global_category_id, state.listing_type_id, state.listing_schema_id,
      'tool-request-' || state.fixture_key, 'Request tool fixture',
      'active', false, null, 'NGN', now()
    ),
    (
      extensions.gen_random_uuid(), state.suspended_business_id,
      state.market_id, state.local_category_id, state.listing_type_id,
      state.listing_schema_id, 'tool-suspended-' || state.fixture_key,
      'Suspended vendor fixture', 'active', true, 10000, 'NGN', now()
    ),
    (
      extensions.gen_random_uuid(), state.active_business_id, state.market_id,
      state.inactive_category_id, state.listing_type_id,
      state.listing_schema_id, 'tool-inactive-' || state.fixture_key,
      'Inactive category fixture', 'active', true, 10000, 'NGN', now()
    ),
    (
      extensions.gen_random_uuid(), state.active_business_id, state.market_id,
      state.local_category_id, state.listing_type_id, state.listing_schema_id,
      'tool-unpublished-' || state.fixture_key, 'Unpublished fixture',
      'active', true, 10000, 'NGN', null
    ),
    (
      extensions.gen_random_uuid(), state.foreign_business_id,
      state.foreign_market_id, state.foreign_category_id,
      state.listing_type_id, state.listing_schema_id,
      'tool-foreign-' || state.fixture_key, 'Foreign fixture',
      'active', true, 10000, 'NGN', now()
    );

  insert into tool_gateway_domain_snapshot
  select
    (select pg_catalog.count(*) from public.markets),
    (select pg_catalog.count(*) from public.categories),
    (select pg_catalog.count(*) from public.businesses),
    (select pg_catalog.count(*) from public.listings),
    (select pg_catalog.count(*) from public.orders),
    (select pg_catalog.count(*) from public.requests),
    (select pg_catalog.count(*) from public.notifications),
    (select pg_catalog.count(*) from public.demand_signals),
    (select pg_catalog.count(*) from public.ai_actions);
end;
$$;

-- ACL denial for anonymous and service-role callers occurs before any data can
-- be returned. These messages are stable evidence labels, not expected output.
select pg_catalog.set_config('request.jwt.claim.role', 'anon', true);
select pg_catalog.set_config('request.jwt.claim.sub', '', true);
set local role anon;
do $$
declare state tool_gateway_probe_state%rowtype;
begin
  select * into strict state from tool_gateway_probe_state;
  begin
    perform * from public.get_tool_gateway_platform_summary(
      extensions.gen_random_uuid(), state.market_slug
    );
    raise exception 'anonymous tool execution unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

select pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
set local role service_role;
do $$
declare state tool_gateway_probe_state%rowtype;
begin
  select * into strict state from tool_gateway_probe_state;
  begin
    perform * from public.get_tool_gateway_platform_summary(
      extensions.gen_random_uuid(), state.market_slug
    );
    raise exception 'service-role tool execution unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

-- Authenticated but unauthorized identities reach the RPC and fail identically.
do $$
declare state tool_gateway_probe_state%rowtype;
begin
  select * into strict state from tool_gateway_probe_state;
  perform pg_catalog.set_config(
    'request.jwt.claim.role', 'authenticated', true
  );
  perform pg_catalog.set_config(
    'request.jwt.claim.sub', state.ordinary_id::text, true
  );
end;
$$;
set local role authenticated;
do $$
declare state tool_gateway_probe_state%rowtype;
begin
  select * into strict state from tool_gateway_probe_state;
  begin
    perform * from public.get_tool_gateway_platform_summary(
      extensions.gen_random_uuid(), state.market_slug
    );
    raise exception 'ordinary profile tool execution unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

do $$
declare state tool_gateway_probe_state%rowtype;
begin
  select * into strict state from tool_gateway_probe_state;
  perform pg_catalog.set_config(
    'request.jwt.claim.sub', state.suspended_admin_id::text, true
  );
end;
$$;
set local role authenticated;
do $$
declare state tool_gateway_probe_state%rowtype;
begin
  select * into strict state from tool_gateway_probe_state;
  begin
    perform * from public.get_tool_gateway_platform_summary(
      extensions.gen_random_uuid(), state.market_slug
    );
    raise exception
      'suspended administrator tool execution unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

-- The primary administrator exercises success, missing-market, and direct-RPC
-- invalid-input outcomes without exposing the raw rejected selectors.
do $$
declare state tool_gateway_probe_state%rowtype;
begin
  select * into strict state from tool_gateway_probe_state;
  perform pg_catalog.set_config(
    'request.jwt.claim.sub', state.super_admin_id::text, true
  );
end;
$$;
set local role authenticated;
insert into tool_gateway_probe_results(label, payload)
select 'success', pg_catalog.to_jsonb(result_record)
from tool_gateway_probe_state state
cross join lateral public.get_tool_gateway_platform_summary(
  extensions.gen_random_uuid(), state.market_slug
) result_record;
insert into tool_gateway_probe_results(label, payload)
select 'missing', pg_catalog.to_jsonb(result_record)
from tool_gateway_probe_state state
cross join lateral public.get_tool_gateway_platform_summary(
  extensions.gen_random_uuid(), state.missing_market_slug
) result_record;
insert into tool_gateway_probe_results(label, payload)
select 'invalid', pg_catalog.to_jsonb(result_record)
from tool_gateway_probe_state state
cross join lateral public.get_tool_gateway_platform_summary(
  extensions.gen_random_uuid(), 'INVALID RAW SELECTOR'
) result_record;
reset role;

do $$
declare
  state tool_gateway_probe_state%rowtype;
  success_payload jsonb;
  missing_payload jsonb;
  invalid_payload jsonb;
  expected_global_categories bigint;
  success_audit public.audit_events%rowtype;
  missing_audit public.audit_events%rowtype;
begin
  select * into strict state from tool_gateway_probe_state;
  select payload into strict success_payload
  from tool_gateway_probe_results where label = 'success';
  select payload into strict missing_payload
  from tool_gateway_probe_results where label = 'missing';
  select payload into strict invalid_payload
  from tool_gateway_probe_results where label = 'invalid';

  select pg_catalog.count(*) into expected_global_categories
  from public.categories category_record
  where category_record.is_active
    and (
      category_record.market_id is null
      or category_record.market_id = state.market_id
    );

  if success_payload ->> 'outcome' <> 'succeeded'
    or (success_payload ->> 'market_id')::uuid <> state.market_id
    or success_payload ->> 'market_slug' <> state.market_slug
    or success_payload ->> 'market_name' <> 'Tool probe market'
    or success_payload ->> 'country_code' <> 'NG'
    or success_payload ->> 'currency_code' <> 'NGN'
    or success_payload ->> 'timezone' <> 'Africa/Lagos'
    or (success_payload ->> 'active_category_count')::bigint
      <> expected_global_categories
    or (success_payload ->> 'active_vendor_count')::bigint <> 2
    or (success_payload ->> 'published_listing_count')::bigint <> 2
    or (success_payload ->> 'orderable_listing_count')::bigint <> 1
  then
    raise exception
      'platform summary did not match the market-scoped public catalog';
  end if;

  if success_payload - array[
      'invocation_id', 'audit_event_id', 'outcome', 'observed_at',
      'market_id', 'market_slug', 'market_name', 'country_code',
      'currency_code', 'timezone', 'active_category_count',
      'active_vendor_count', 'published_listing_count',
      'orderable_listing_count'
    ] <> '{}'::jsonb
    or pg_catalog.jsonb_object_length(success_payload) <> 14
  then
    raise exception 'platform summary exposed an unexpected output column';
  end if;

  if missing_payload ->> 'outcome' <> 'market_not_found'
    or exists (
      select 1
      from pg_catalog.jsonb_each(missing_payload) item(key, value)
      where item.key in (
        'market_id', 'market_slug', 'market_name', 'country_code',
        'currency_code', 'timezone', 'active_category_count',
        'active_vendor_count', 'published_listing_count',
        'orderable_listing_count'
      ) and item.value <> 'null'::jsonb
    )
  then
    raise exception 'market-not-found response became an oracle';
  end if;
  if invalid_payload ->> 'outcome' <> 'invalid_input'
    or invalid_payload::text like '%INVALID RAW SELECTOR%'
  then
    raise exception 'invalid tool input leaked its raw selector';
  end if;

  select audit_record.* into strict success_audit
  from public.audit_events audit_record
  where audit_record.id = (success_payload ->> 'audit_event_id')::uuid;
  if success_audit.actor_id <> state.super_admin_id
    or success_audit.subject_type <> 'market'
    or success_audit.subject_id <> state.market_id
    or success_audit.action <> 'tool_gateway.get_platform_summary'
    or success_audit.metadata <> pg_catalog.jsonb_build_object(
      'contract_version', 1,
      'invocation_id', success_payload ->> 'invocation_id',
      'outcome', 'succeeded',
      'tool_name', 'get_platform_summary'
    )
  then
    raise exception 'tool audit metadata was not exact';
  end if;

  select audit_record.* into strict missing_audit
  from public.audit_events audit_record
  where audit_record.id = (missing_payload ->> 'audit_event_id')::uuid;
  if missing_audit.subject_type <> 'tool_gateway_invocation'
    or missing_audit.subject_id <>
      (missing_payload ->> 'invocation_id')::uuid
    or missing_audit.metadata::text like '%' || state.missing_market_slug || '%'
  then
    raise exception 'market-not-found audit leaked the selected market';
  end if;
end;
$$;

-- A distinct actor proves the fixed 60/hour boundary. The 61st invocation is
-- first-limited and audited once; every later denial performs no write.
do $$
declare state tool_gateway_probe_state%rowtype;
begin
  select * into strict state from tool_gateway_probe_state;
  perform pg_catalog.set_config(
    'request.jwt.claim.sub', state.rate_admin_id::text, true
  );
end;
$$;
set local role authenticated;
do $$
declare
  state tool_gateway_probe_state%rowtype;
  item integer;
  payload jsonb;
begin
  select * into strict state from tool_gateway_probe_state;
  for item in 1..66 loop
    select pg_catalog.to_jsonb(result_record)
    into strict payload
    from public.get_tool_gateway_platform_summary(
      extensions.gen_random_uuid(), state.market_slug
    ) result_record;
    insert into tool_gateway_probe_results(label, payload)
    values ('rate-' || item, payload);
  end loop;
end;
$$;
reset role;

do $$
declare
  state tool_gateway_probe_state%rowtype;
  rate_audit_count bigint;
  rate_result_count bigint;
  first_limit_payload jsonb;
begin
  select * into strict state from tool_gateway_probe_state;
  select pg_catalog.count(*) into rate_result_count
  from tool_gateway_probe_results result_record
  where result_record.label like 'rate-%'
    and result_record.payload ->> 'outcome' = 'succeeded';
  select payload into strict first_limit_payload
  from tool_gateway_probe_results where label = 'rate-61';
  select pg_catalog.count(*) into rate_audit_count
  from public.audit_events audit_record
  where audit_record.actor_id = state.rate_admin_id
    and audit_record.action = 'tool_gateway.get_platform_summary';

  if rate_result_count <> 60
    or first_limit_payload ->> 'outcome' <> 'rate_limited'
    or first_limit_payload ->> 'audit_event_id' is null
    or exists (
      select 1 from tool_gateway_probe_results result_record
      where result_record.label in (
        'rate-62', 'rate-63', 'rate-64', 'rate-65', 'rate-66'
      ) and (
        result_record.payload ->> 'outcome' <> 'rate_limited'
        or result_record.payload ->> 'audit_event_id' is not null
      )
    )
  then
    raise exception 'rate limiter admitted more than sixty calls';
  end if;
  if rate_audit_count <> 61
    or not exists (
      select 1
      from private.tool_gateway_actor_rate_limits limit_record
      where limit_record.actor_id = state.rate_admin_id
        and limit_record.request_count = 61
    )
  then
    raise exception 'rate limiting amplified audit writes';
  end if;
end;
$$;

-- Protected evidence cannot be forged, changed, or removed outside the exact
-- RPC transaction context, even by the table owner running this probe.
do $$
declare
  state tool_gateway_probe_state%rowtype;
  audit_id uuid;
begin
  select * into strict state from tool_gateway_probe_state;
  select (payload ->> 'audit_event_id')::uuid into strict audit_id
  from tool_gateway_probe_results where label = 'success';

  begin
    update public.audit_events set metadata = '{}'::jsonb where id = audit_id;
    raise exception 'tool audit evidence was mutable';
  exception when raise_exception then
    if sqlerrm <> 'tool-gateway audit evidence is immutable' then raise; end if;
  end;
  begin
    delete from public.audit_events where id = audit_id;
    raise exception 'tool audit evidence was mutable';
  exception when raise_exception then
    if sqlerrm <> 'tool-gateway audit evidence is immutable' then raise; end if;
  end;
  begin
    insert into public.audit_events(
      actor_id, subject_type, subject_id, action, metadata
    ) values (
      state.super_admin_id, 'market', state.market_id,
      'tool_gateway.get_platform_summary', '{}'::jsonb
    );
    raise exception 'tool audit evidence was mutable';
  exception when raise_exception then
    if sqlerrm <> 'invalid tool-gateway platform-summary audit insert' then
      raise;
    end if;
  end;
end;
$$;

do $$
declare snapshot tool_gateway_domain_snapshot%rowtype;
begin
  select * into strict snapshot from tool_gateway_domain_snapshot;
  if snapshot.markets <> (select pg_catalog.count(*) from public.markets)
    or snapshot.categories <> (select pg_catalog.count(*) from public.categories)
    or snapshot.businesses <> (select pg_catalog.count(*) from public.businesses)
    or snapshot.listings <> (select pg_catalog.count(*) from public.listings)
    or snapshot.orders <> (select pg_catalog.count(*) from public.orders)
    or snapshot.requests <> (select pg_catalog.count(*) from public.requests)
    or snapshot.notifications <> (
      select pg_catalog.count(*) from public.notifications
    )
    or snapshot.demand_signals <> (
      select pg_catalog.count(*) from public.demand_signals
    )
    or snapshot.ai_actions <> (select pg_catalog.count(*) from public.ai_actions)
  then
    raise exception 'tool gateway mutated domain relations';
  end if;
end;
$$;

rollback to savepoint tool_gateway_fixture;

do $$
declare state tool_gateway_probe_state%rowtype;
begin
  select * into strict state from tool_gateway_probe_state;
  if state.baseline_auth_users <> (select pg_catalog.count(*) from auth.users)
    or state.baseline_profiles <> (select pg_catalog.count(*) from public.profiles)
    or state.baseline_capabilities <> (
      select pg_catalog.count(*) from public.profile_capabilities
    )
    or state.baseline_markets <> (select pg_catalog.count(*) from public.markets)
    or state.baseline_categories <> (
      select pg_catalog.count(*) from public.categories
    )
    or state.baseline_businesses <> (
      select pg_catalog.count(*) from public.businesses
    )
    or state.baseline_listing_types <> (
      select pg_catalog.count(*) from public.listing_types
    )
    or state.baseline_listing_schemas <> (
      select pg_catalog.count(*) from public.listing_schemas
    )
    or state.baseline_mappings <> (
      select pg_catalog.count(*) from public.category_listing_type_mappings
    )
    or state.baseline_listings <> (select pg_catalog.count(*) from public.listings)
    or state.baseline_variants <> (
      select pg_catalog.count(*) from public.listing_variants
    )
    or state.baseline_audits <> (
      select pg_catalog.count(*) from public.audit_events
    )
    or state.baseline_limits <> (
      select pg_catalog.count(*) from private.tool_gateway_actor_rate_limits
    )
  then
    raise exception 'left tool-gateway probe fixture residue';
  end if;
end;
$$;

rollback;

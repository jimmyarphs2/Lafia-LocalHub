-- Rollback-only live regression probe for
-- 202608300026_localhub_admin_business_triage.sql.
-- Every fixture and mutation is rolled back. No production row or sequence is
-- changed, and no credential or merchant contact value is selected or printed.

begin;

create temporary table admin_business_triage_probe_state (
  super_admin_id uuid not null,
  admin_id uuid not null,
  customer_id uuid not null,
  suspended_super_admin_id uuid not null,
  owner_id uuid not null,
  suspension_target_id uuid not null,
  market_a_id uuid not null,
  market_b_id uuid not null,
  inactive_market_id uuid not null,
  own_business_id uuid not null,
  market_a_slug text not null,
  market_b_slug text not null,
  baseline_businesses bigint not null,
  baseline_drafts bigint not null,
  baseline_capabilities bigint not null,
  baseline_memberships bigint not null,
  baseline_admin_events bigint not null
) on commit drop;
grant all on table admin_business_triage_probe_state
  to anon, authenticated, service_role;

do $$
declare
  fixture_key text := replace(extensions.gen_random_uuid()::text, '-', '');
  state admin_business_triage_probe_state%rowtype;
  business_id uuid;
  business_status text;
  draft_step text;
  draft_submitted_at timestamptz;
  draft_data jsonb;
  base_submission timestamptz := clock_timestamp() - interval '2 days';
begin
  state := row(
    extensions.gen_random_uuid(), extensions.gen_random_uuid(),
    extensions.gen_random_uuid(), extensions.gen_random_uuid(),
    extensions.gen_random_uuid(), extensions.gen_random_uuid(),
    extensions.gen_random_uuid(), extensions.gen_random_uuid(),
    extensions.gen_random_uuid(), extensions.gen_random_uuid(),
    'triage-a-' || fixture_key, 'triage-b-' || fixture_key,
    (select count(*) from public.businesses),
    (select count(*) from public.business_onboarding_drafts),
    (select count(*) from public.profile_capabilities),
    (select count(*) from public.business_memberships),
    (select count(*) from public.admin_events)
  );
  insert into admin_business_triage_probe_state select state.*;

  insert into auth.users(
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
  )
  select profile_id, '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'admin-triage-' || label || '-' || fixture_key || '@example.test',
    '', now(), '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb, now(), now()
  from (values
    (state.super_admin_id, 'super'),
    (state.admin_id, 'admin'),
    (state.customer_id, 'customer'),
    (state.suspended_super_admin_id, 'suspended-super'),
    (state.owner_id, 'owner'),
    (state.suspension_target_id, 'target')
  ) as users(profile_id, label);

  insert into public.profile_capabilities(profile_id, capability) values
    (state.super_admin_id, 'super_admin'),
    (state.admin_id, 'admin'),
    (state.suspended_super_admin_id, 'super_admin'),
    (state.owner_id, 'merchant');

  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', state.super_admin_id::text, true);
  update public.profiles
  set is_suspended = true
  where id = state.suspended_super_admin_id;
  perform set_config('request.jwt.claim.sub', '', true);

  insert into public.markets(id, slug, name, is_active) values
    (state.market_a_id, state.market_a_slug, 'Triage active market A', true),
    (state.market_b_id, state.market_b_slug, 'Triage active market B', true),
    (state.inactive_market_id, 'triage-inactive-' || fixture_key,
      'Triage inactive market', false);

  -- Twenty-seven eligible records prove the 25 + sentinel page boundary.
  -- Groups of three deliberately share one timestamp so UUID is the tiebreak.
  for item in 1..27 loop
    business_id := extensions.gen_random_uuid();
    draft_submitted_at := base_submission
      + (floor((item - 1) / 3.0)::integer * interval '1 minute');
    draft_data := jsonb_build_object(
      'onboardingVersion', 1,
      'values', jsonb_build_object(
        'businessName', 'Eligible Triage Business ' || item,
        'originalOffering', 'Safe fixture offering ' || item,
        'categorySlug', 'food-catering',
        'categoryConfidence', 'high',
        'description', 'A complete synthetic business description for triage.',
        'phone', '+234 800 000 0000',
        'whatsapp', '',
        'email', '',
        'marketSlug', state.market_a_slug,
        'area', 'Synthetic area',
        'address', 'PII-MARKER-ADDRESS-' || item
      )
    );
    insert into public.businesses(
      id, market_id, name, slug, legal_name, status, phone_e164, metadata
    ) values (
      business_id, state.market_a_id, 'Eligible Triage Business ' || item,
      'eligible-triage-' || item || '-' || fixture_key,
      'PII-MARKER-LEGAL-' || item, 'pending_review',
      '+2348000000000', jsonb_build_object('pii_marker', item)
    );
    insert into public.business_memberships(
      business_id, profile_id, role, accepted_at
    ) values (business_id, state.owner_id, 'owner', now());
    insert into public.business_onboarding_drafts(
      business_id, owner_id, step, data, submitted_at
    ) values (
      business_id, state.owner_id, 'complete', draft_data,
      draft_submitted_at
    );
  end loop;

  -- One valid row in market B proves exact selected-market isolation.
  business_id := extensions.gen_random_uuid();
  draft_data := jsonb_build_object(
    'onboardingVersion', 1,
    'values', jsonb_build_object(
      'businessName', 'Market B Business',
      'originalOffering', 'Market B fixture offering',
      'categorySlug', 'electronics-repair',
      'categoryConfidence', 'medium',
      'description', 'A complete synthetic business description for market B.',
      'phone', '', 'whatsapp', '', 'email', 'market-b@example.test',
      'marketSlug', state.market_b_slug, 'area', 'Market B area', 'address', ''
    )
  );
  insert into public.businesses(id, market_id, name, slug, status)
  values (business_id, state.market_b_id, 'Market B Business',
    'market-b-business-' || fixture_key, 'pending_review');
  insert into public.business_onboarding_drafts(
    business_id, owner_id, step, data, submitted_at
  ) values (business_id, state.owner_id, 'complete', draft_data, base_submission);

  -- A super-admin-owned business is valid but must be excluded from self-review.
  draft_data := jsonb_set(
    draft_data,
    '{values,marketSlug}',
    to_jsonb(state.market_a_slug)
  );
  draft_data := jsonb_set(
    draft_data,
    '{values,businessName}',
    to_jsonb('Self review business'::text)
  );
  insert into public.businesses(id, market_id, name, slug, status)
  values (state.own_business_id, state.market_a_id, 'Self review business',
    'self-review-business-' || fixture_key, 'pending_review');
  insert into public.business_memberships(
    business_id, profile_id, role, accepted_at
  ) values (state.own_business_id, state.super_admin_id, 'owner', now());
  insert into public.business_onboarding_drafts(
    business_id, owner_id, step, data, submitted_at
  ) values (
    state.own_business_id, state.super_admin_id, 'complete', draft_data,
    base_submission - interval '1 hour'
  );

  -- Inactive market, wrong status, wrong step, unsubmitted and malformed rows
  -- must never enter the queue.
  for item in 1..7 loop
    business_id := extensions.gen_random_uuid();
    business_status := case item
      when 2 then 'draft'
      when 3 then 'active'
      when 4 then 'suspended'
      else 'pending_review'
    end;
    draft_step := case when item = 5 then 'review' else 'complete' end;
    draft_submitted_at := case when item = 6 then null else base_submission end;
    draft_data := jsonb_build_object(
      'onboardingVersion', 1,
      'values', jsonb_build_object(
        'businessName', 'Excluded Triage Business ' || item,
        'originalOffering', 'Excluded fixture offering',
        'categorySlug', 'other-local-trade',
        'categoryConfidence', 'unknown',
        'description', 'A complete synthetic excluded business description.',
        'phone', '', 'whatsapp', '+234 800 000 0000', 'email', '',
        'marketSlug', case when item = 1
          then 'triage-inactive-' || fixture_key else state.market_a_slug end,
        'area', 'Excluded area', 'address', ''
      )
    );
    if item = 7 then draft_data := '{}'::jsonb; end if;
    insert into public.businesses(id, market_id, name, slug, status)
    values (
      business_id,
      case when item = 1 then state.inactive_market_id else state.market_a_id end,
      'Excluded Triage Business ' || item,
      'excluded-triage-' || item || '-' || fixture_key,
      business_status
    );
    insert into public.business_onboarding_drafts(
      business_id, owner_id, step, data, submitted_at
    ) values (
      business_id, state.owner_id, draft_step, draft_data,
      draft_submitted_at
    );
  end loop;
end;
$$;

-- The public wire projection is exact and contains no contact, owner, legal,
-- address, description, metadata, raw JSON, capability or membership field.
do $$
declare
  result_signature text;
begin
  select pg_catalog.pg_get_function_result(routine.oid)
  into result_signature
  from pg_catalog.pg_proc routine
  where routine.oid =
    'public.list_super_admin_pending_businesses(uuid,timestamptz,uuid,integer)'::pg_catalog.regprocedure;
  if result_signature is distinct from
    'TABLE(business_id uuid, business_name text, market_id uuid, market_slug text, market_name text, category_slug text, submitted_at timestamp with time zone, has_more boolean)'
  then
    raise exception 'admin triage projection changed: %', result_signature;
  end if;
end;
$$;

create temporary table admin_business_triage_page_one as
select * from public.list_super_admin_pending_businesses(null, null, null, 25)
where false;
create temporary table admin_business_triage_page_two
  (like admin_business_triage_page_one including all);
grant all on table admin_business_triage_page_one,
  admin_business_triage_page_two to authenticated;

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claim.sub',
  (select super_admin_id::text from admin_business_triage_probe_state),
  true
);

insert into admin_business_triage_page_one
select *
from public.list_super_admin_pending_businesses(
  (select market_a_id from admin_business_triage_probe_state),
  null, null, 25
);

do $$
declare
  state admin_business_triage_probe_state%rowtype;
  cursor_at timestamptz;
  cursor_id uuid;
  page_count bigint;
  raw_keys text[];
begin
  select * into strict state from admin_business_triage_probe_state;
  select count(*) into page_count from admin_business_triage_page_one;
  if page_count <> 25
    or exists (select 1 from admin_business_triage_page_one where not has_more)
    or exists (
      select 1
      from (
        select submitted_at, business_id,
          lag(submitted_at) over (order by submitted_at, business_id) as prior_at,
          lag(business_id) over (order by submitted_at, business_id) as prior_id
        from admin_business_triage_page_one
      ) ordered
      where prior_at is not null
        and (submitted_at, business_id) <= (prior_at, prior_id)
    )
  then
    raise exception 'first admin triage page did not enforce 25 + sentinel';
  end if;
  if exists (
    select 1 from admin_business_triage_page_one
    where market_id <> state.market_a_id
      or business_id = state.own_business_id
      or category_slug <> 'food-catering'
  ) then
    raise exception 'admin triage market, self-review or category isolation failed';
  end if;
  select array_agg(key order by key) into raw_keys
  from jsonb_object_keys(to_jsonb((select row_value
    from admin_business_triage_page_one row_value limit 1))) key;
  if raw_keys is distinct from array[
    'business_id', 'business_name', 'category_slug', 'has_more',
    'market_id', 'market_name', 'market_slug', 'submitted_at'
  ]::text[] then
    raise exception 'admin triage serialized projection exposed an extra key';
  end if;

  select submitted_at, business_id into cursor_at, cursor_id
  from admin_business_triage_page_one
  order by submitted_at, business_id
  offset 24 limit 1;
  insert into admin_business_triage_page_two
  select * from public.list_super_admin_pending_businesses(
    state.market_a_id, cursor_at, cursor_id, 25
  );
  if (select count(*) from admin_business_triage_page_two) <> 2
    or exists (select 1 from admin_business_triage_page_two where has_more)
    or exists (
      select 1 from admin_business_triage_page_one first_page
      join admin_business_triage_page_two second_page using (business_id)
    )
    or exists (
      select 1 from admin_business_triage_page_two
      where (submitted_at, business_id) <= (cursor_at, cursor_id)
    )
  then
    raise exception 'admin triage keyset pagination duplicated or omitted rows';
  end if;

  if (select count(*) from public.list_super_admin_pending_businesses(
      state.market_a_id, null, null, 1)) <> 1
    or (select count(*) from public.list_super_admin_pending_businesses(
      state.market_a_id, null, null, 50)) <> 27
    or (select count(*) from public.list_super_admin_pending_businesses(
      state.market_b_id, null, null, 25)) <> 1
  then
    raise exception 'admin triage bounded limit or selected-market contract failed';
  end if;

  if exists (select 1 from public.list_super_admin_pending_businesses(
      null, null, null, 25))
    or exists (select 1 from public.list_super_admin_pending_businesses(
      state.market_a_id, clock_timestamp(), null, 25))
    or exists (select 1 from public.list_super_admin_pending_businesses(
      state.market_a_id, null, extensions.gen_random_uuid(), 25))
    or exists (select 1 from public.list_super_admin_pending_businesses(
      state.market_a_id, null, null, 0))
    or exists (select 1 from public.list_super_admin_pending_businesses(
      state.market_a_id, null, null, 51))
    or exists (select 1 from public.list_super_admin_pending_businesses(
      state.inactive_market_id, null, null, 25))
    or exists (select 1 from public.list_super_admin_pending_businesses(
      extensions.gen_random_uuid(), null, null, 25))
  then
    raise exception 'invalid admin triage input disclosed rows';
  end if;
end;
$$;

-- Ordinary admin, customer and suspended super-admin retain function execute
-- only long enough for the database's internal authorization to return no rows.
do $$
declare
  state admin_business_triage_probe_state%rowtype;
  denied_id uuid;
begin
  select * into strict state from admin_business_triage_probe_state;
  foreach denied_id in array array[
    state.admin_id, state.customer_id, state.suspended_super_admin_id
  ] loop
    perform set_config('request.jwt.claim.sub', denied_id::text, true);
    if exists (select 1 from public.list_super_admin_pending_businesses(
      state.market_a_id, null, null, 25
    )) then
      raise exception 'non-super-admin received admin triage data';
    end if;
  end loop;
  perform set_config('request.jwt.claim.sub', state.super_admin_id::text, true);
end;
$$;

-- The retired global transition is unavailable even to a super-admin.
do $$
declare state admin_business_triage_probe_state%rowtype;
begin
  select * into strict state from admin_business_triage_probe_state;
  begin
    perform public.transition_business_status(
      state.own_business_id, 'active', 'probe must remain denied'
    );
    raise exception 'legacy business transition unexpectedly executed';
  exception when insufficient_privilege then null;
  end;
  if exists (
    select 1 from public.businesses
    where id = state.own_business_id and status <> 'pending_review'
  )
  then raise exception 'denied legacy transition changed business state'; end if;
end;
$$;

-- Anonymous/PUBLIC-derived execution is unavailable at the function ACL.
set local role anon;
select set_config('request.jwt.claim.role', 'anon', true);
select set_config('request.jwt.claim.sub', '', true);
do $$
begin
  begin
    perform public.transition_business_status(
      (select own_business_id from admin_business_triage_probe_state),
      'active',
      'anonymous probe must remain denied'
    );
    raise exception 'anonymous legacy business transition unexpectedly executed';
  exception when insufficient_privilege then null;
  end;
end;
$$;

set local role postgres;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', '', true);

do $$
declare
  state admin_business_triage_probe_state%rowtype;
  role_name text;
begin
  select * into strict state from admin_business_triage_probe_state;
  if (select count(*) from public.admin_events) <> state.baseline_admin_events
  then raise exception 'admin triage read or denied transition wrote an admin event'; end if;
  if pg_catalog.has_function_privilege(
      'anon',
      'public.transition_business_status(uuid,text,text)', 'execute')
    or pg_catalog.has_function_privilege(
      'authenticated',
      'public.transition_business_status(uuid,text,text)', 'execute')
    or pg_catalog.has_function_privilege(
      'service_role',
      'public.transition_business_status(uuid,text,text)', 'execute')
    or pg_catalog.has_function_privilege(
      'service_role',
      'public.set_profile_suspension(uuid,boolean,text)', 'execute')
  then
    raise exception 'legacy administrative execute privilege remains';
  end if;
  if not pg_catalog.has_function_privilege(
      'authenticated',
      'public.set_profile_suspension(uuid,boolean,text)', 'execute')
  then
    raise exception 'authenticated super-admin suspension boundary was removed';
  end if;
  if not pg_catalog.has_function_privilege(
      'authenticated',
      'public.list_super_admin_pending_businesses(uuid,timestamptz,uuid,integer)',
      'execute')
    or pg_catalog.has_function_privilege(
      'anon',
      'public.list_super_admin_pending_businesses(uuid,timestamptz,uuid,integer)',
      'execute')
    or pg_catalog.has_function_privilege(
      'service_role',
      'public.list_super_admin_pending_businesses(uuid,timestamptz,uuid,integer)',
      'execute')
  then
    raise exception 'admin triage RPC execute grants are not least privilege';
  end if;

  foreach role_name in array array['anon', 'authenticated', 'service_role'] loop
    if exists (
      select 1
      from unnest(array['insert','update','delete','truncate']) privilege_name
      where pg_catalog.has_table_privilege(
        role_name, 'public.admin_events', privilege_name
      )
    ) then
      raise exception '% retained direct admin audit DML', role_name;
    end if;
  end loop;
end;
$$;

-- The remaining trusted definer can still create one canonical admin event.
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claim.sub',
  (select super_admin_id::text from admin_business_triage_probe_state),
  true
);
select public.set_profile_suspension(
  (select suspension_target_id from admin_business_triage_probe_state),
  true,
  'Rollback probe verifies trusted administrative audit insertion'
);

set local role postgres;
select set_config('request.jwt.claim.role', '', true);
select set_config('request.jwt.claim.sub', '', true);
do $$
declare state admin_business_triage_probe_state%rowtype;
begin
  select * into strict state from admin_business_triage_probe_state;
  if not exists (
      select 1 from public.profiles
      where id = state.suspension_target_id and is_suspended
    ) or (select count(*) from public.admin_events) <>
      state.baseline_admin_events + 1
    or not exists (
      select 1 from public.admin_events
      where admin_id = state.super_admin_id
        and action = 'profile_suspended'
        and subject_type = 'profile'
        and subject_id = state.suspension_target_id
    )
  then
    raise exception 'trusted super-admin definer did not write canonical audit';
  end if;
end;
$$;

-- Application roles cannot insert, update, delete or truncate the audit table.
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claim.sub',
  (select super_admin_id::text from admin_business_triage_probe_state),
  true
);
do $$
begin
  begin
    insert into public.admin_events(admin_id, action, subject_type)
    values ((select super_admin_id from admin_business_triage_probe_state),
      'forged', 'profile');
    raise exception 'authenticated direct admin audit insert unexpectedly worked';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.admin_events set reason = reason;
    raise exception 'authenticated direct admin audit update unexpectedly worked';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.admin_events;
    raise exception 'authenticated direct admin audit delete unexpectedly worked';
  exception when insufficient_privilege then null;
  end;
  begin
    truncate public.admin_events;
    raise exception 'authenticated direct admin audit truncate unexpectedly worked';
  exception when insufficient_privilege then null;
  end;
end;
$$;

set local role service_role;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claim.sub',
  (select super_admin_id::text from admin_business_triage_probe_state),
  true
);
do $$
begin
  begin
    perform public.list_super_admin_pending_businesses(
      (select market_a_id from admin_business_triage_probe_state),
      null, null, 25
    );
    raise exception 'forged service triage execute unexpectedly worked';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.set_profile_suspension(
      (select suspension_target_id from admin_business_triage_probe_state),
      false, 'forged service call must remain denied'
    );
    raise exception 'forged service suspension execute unexpectedly worked';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.admin_events(admin_id, action, subject_type)
    values ((select super_admin_id from admin_business_triage_probe_state),
      'forged-service', 'profile');
    raise exception 'service direct admin audit insert unexpectedly worked';
  exception when insufficient_privilege then null;
  end;
end;
$$;

-- The owner-level trigger is a final backstop even for no-op mutation.
set local role postgres;
select set_config('request.jwt.claim.role', '', true);
select set_config('request.jwt.claim.sub', '', true);
do $$
declare
  expected_message constant text := 'administrative audit evidence is immutable';
begin
  begin
    update public.admin_events set reason = reason;
    raise exception 'owner no-op admin audit update unexpectedly worked';
  exception when others then
    if sqlerrm <> expected_message then raise; end if;
  end;
  begin
    delete from public.admin_events;
    raise exception 'owner admin audit delete unexpectedly worked';
  exception when others then
    if sqlerrm <> expected_message then raise; end if;
  end;
  begin
    truncate public.admin_events;
    raise exception 'owner admin audit truncate unexpectedly worked';
  exception when others then
    if sqlerrm <> expected_message then raise; end if;
  end;
end;
$$;

do $$
declare
  owner_name text;
begin
  select owner_role.rolname into owner_name
  from pg_catalog.pg_proc routine
  join pg_catalog.pg_roles owner_role on owner_role.oid = routine.proowner
  where routine.oid =
    'public.list_super_admin_pending_businesses(uuid,timestamptz,uuid,integer)'::pg_catalog.regprocedure;
  if owner_name is null or owner_name in (
    'anon', 'authenticated', 'authenticator', 'service_role'
  ) then
    raise exception 'admin triage RPC owner is not a trusted migration role';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = 'admin_events'
      and relation.relrowsecurity
  ) or exists (
    select 1 from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'admin_events'
  ) then
    raise exception 'admin audit deny-by-default RLS contract changed';
  end if;
end;
$$;

-- Baselines are intentionally stored so the combined migration/probe runner
-- can verify full rollback and zero fixture residue after this transaction.
rollback;

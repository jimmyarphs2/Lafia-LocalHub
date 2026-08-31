-- Rollback-only live regression probe for referral migrations 031 and 032.
begin;

-- Both new and legacy referral relations must be force-RLS, policy-free, and
-- unreachable through direct application table or column privileges.
do $$
declare
  table_name text;
  role_name text;
  privilege_name text;
begin
  foreach table_name in array array[
    'public.referral_rules',
    'public.referral_codes',
    'public.referral_attributions',
    'public.referral_commissions',
    'private.referrer_identities',
    'private.referral_acquisition_links'
  ] loop
    if not exists (
      select 1
      from pg_catalog.pg_class relation_record
      where relation_record.oid = table_name::pg_catalog.regclass
        and relation_record.relrowsecurity
        and relation_record.relforcerowsecurity
    ) or exists (
      select 1
      from pg_catalog.pg_policies policy_record
      where policy_record.schemaname = pg_catalog.split_part(table_name, '.', 1)
        and policy_record.tablename = pg_catalog.split_part(table_name, '.', 2)
    ) then
      raise exception '% is not force-RLS and policy-free', table_name;
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
      where relation_record.oid = table_name::pg_catalog.regclass
        and privilege_record.grantee = 0
    ) or exists (
      select 1
      from pg_catalog.pg_attribute attribute_record
      cross join lateral pg_catalog.aclexplode(
        attribute_record.attacl
      ) privilege_record
      where attribute_record.attrelid = table_name::pg_catalog.regclass
        and attribute_record.attnum > 0
        and not attribute_record.attisdropped
        and attribute_record.attacl is not null
        and privilege_record.grantee = 0
    ) then
      raise exception 'PUBLIC retained direct privilege on %', table_name;
    end if;

    foreach role_name in array array['anon', 'authenticated', 'service_role'] loop
      foreach privilege_name in array array[
        'select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger'
      ] loop
        if pg_catalog.has_table_privilege(
          role_name,
          table_name,
          privilege_name
        ) then
          raise exception '% retained % on %', role_name, privilege_name, table_name;
        end if;
      end loop;
      foreach privilege_name in array array[
        'select', 'insert', 'update', 'references'
      ] loop
        if pg_catalog.has_any_column_privilege(
          role_name,
          table_name,
          privilege_name
        ) then
          raise exception '% retained column % on %', role_name, privilege_name, table_name;
        end if;
      end loop;
    end loop;
  end loop;
end;
$$;

-- Every callable wrapper is a trusted fixed-path definer with only its exact
-- intended grants. The owner-level legacy blocker remains an uncallable invoker.
do $$
declare
  routine_record pg_catalog.pg_proc%rowtype;
  signature text;
  owner_name text;
  role_name text;
  anon_expected boolean;
begin
  select * into strict routine_record
  from pg_catalog.pg_proc
  where oid =
    'private.prevent_dormant_referral_legacy_mutation()'::pg_catalog.regprocedure;
  select owner_role.rolname into strict owner_name
  from pg_catalog.pg_roles owner_role
  where owner_role.oid = routine_record.proowner;
  if routine_record.prosecdef
    or owner_name <> 'postgres'
    or not coalesce(routine_record.proconfig, array[]::text[])
      @> array['search_path=""']::text[]
    or exists (
      select 1
      from pg_catalog.aclexplode(
        coalesce(
          routine_record.proacl,
          pg_catalog.acldefault('f', routine_record.proowner)
        )
      ) privilege_record
      where privilege_record.grantee = 0
        and privilege_record.privilege_type = 'EXECUTE'
    )
  then
    raise exception 'legacy referral blocker is not a trusted fixed-path invoker';
  end if;
  foreach role_name in array array['anon', 'authenticated', 'service_role'] loop
    if pg_catalog.has_function_privilege(
      role_name,
      'private.prevent_dormant_referral_legacy_mutation()',
      'execute'
    ) then
      raise exception '% retained legacy referral blocker execute', role_name;
    end if;
  end loop;

  foreach signature in array array[
    'public.ensure_my_referrer_identity()',
    'public.create_or_get_my_referral_link(uuid)',
    'public.list_my_referral_links()',
    'public.set_my_referral_link_enabled(uuid,boolean)',
    'public.resolve_referral_acquisition_link(text)'
  ] loop
    select * into strict routine_record
    from pg_catalog.pg_proc
    where oid = signature::pg_catalog.regprocedure;
    select owner_role.rolname into strict owner_name
    from pg_catalog.pg_roles owner_role
    where owner_role.oid = routine_record.proowner;
    if not routine_record.prosecdef
      or owner_name <> 'postgres'
      or not coalesce(routine_record.proconfig, array[]::text[])
        @> array['search_path=""']::text[]
      or exists (
        select 1
        from pg_catalog.aclexplode(
          coalesce(
            routine_record.proacl,
            pg_catalog.acldefault('f', routine_record.proowner)
          )
        ) privilege_record
        where privilege_record.grantee = 0
          and privilege_record.privilege_type = 'EXECUTE'
      )
    then
      raise exception '% is not a trusted fixed-path definer', signature;
    end if;

    anon_expected := signature =
      'public.resolve_referral_acquisition_link(text)';
    if not pg_catalog.has_function_privilege(
      'authenticated', signature, 'execute'
    ) or pg_catalog.has_function_privilege(
      'anon', signature, 'execute'
    ) is distinct from anon_expected
      or pg_catalog.has_function_privilege(
        'service_role', signature, 'execute'
      )
    then
      raise exception '% has incorrect application execute grants', signature;
    end if;
  end loop;
end;
$$;

-- The private schema has only the intended non-financial shapes, restrictive
-- foreign keys, supporting indexes, and all eight legacy mutation blockers.
do $$
begin
  if exists (
    select 1
    from pg_catalog.pg_attribute attribute_record
    where attribute_record.attrelid in (
      'private.referrer_identities'::pg_catalog.regclass,
      'private.referral_acquisition_links'::pg_catalog.regclass
    )
      and attribute_record.attname in (
        'balance', 'reward', 'commission', 'payment', 'bank', 'email', 'phone'
      )
  ) then
    raise exception 'sensitive or financial referral column found';
  end if;
  if (
    select count(*)
    from pg_catalog.pg_constraint constraint_record
    where constraint_record.conrelid in (
      'private.referrer_identities'::pg_catalog.regclass,
      'private.referral_acquisition_links'::pg_catalog.regclass
    )
      and constraint_record.contype = 'f'
      and constraint_record.confdeltype = 'r'
      and constraint_record.convalidated
  ) <> 3 then
    raise exception 'referral foreign keys are not all validated and restrictive';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_indexes
    where schemaname = 'private'
      and indexname = 'referral_acquisition_links_referrer_fkey_idx'
  ) or not exists (
    select 1 from pg_catalog.pg_indexes
    where schemaname = 'private'
      and indexname = 'referral_acquisition_links_market_fkey_idx'
  ) or not exists (
    select 1 from pg_catalog.pg_indexes
    where schemaname = 'private'
      and indexname = 'referral_acquisition_links_one_active_idx'
  ) then
    raise exception 'referral supporting index is missing';
  end if;
  if (
    select count(*)
    from pg_catalog.pg_trigger trigger_record
    where trigger_record.tgrelid in (
      'public.referral_rules'::pg_catalog.regclass,
      'public.referral_codes'::pg_catalog.regclass,
      'public.referral_attributions'::pg_catalog.regclass,
      'public.referral_commissions'::pg_catalog.regclass
    )
      and not trigger_record.tgisinternal
      and trigger_record.tgfoid =
        'private.prevent_dormant_referral_legacy_mutation()'::pg_catalog.regprocedure
      and trigger_record.tgenabled = 'O'
  ) <> 8 then
    raise exception 'legacy referral blocker attachment changed';
  end if;
  if exists (select 1 from private.referrer_identities)
    or exists (select 1 from private.referral_acquisition_links)
  then
    raise exception 'referral acquisition foundation was not empty before probe';
  end if;
end;
$$;

create temporary table referral_probe_state (
  one_id uuid not null,
  two_id uuid not null,
  active_market uuid not null,
  second_market uuid not null,
  inactive_market uuid not null,
  one_link_id uuid,
  one_code text,
  two_link_id uuid,
  two_code text
) on commit drop;

do $$
declare
  one_id uuid := extensions.gen_random_uuid();
  two_id uuid := extensions.gen_random_uuid();
  active_market uuid := extensions.gen_random_uuid();
  second_market uuid := extensions.gen_random_uuid();
  inactive_market uuid := extensions.gen_random_uuid();
begin
  insert into auth.users(
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
  ) values
    (
      one_id,
      '00000000-0000-0000-0000-000000000000',
      'authenticated',
      'authenticated',
      'referral-one-' || pg_catalog.replace(one_id::text, '-', '') || '@example.test',
      '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()
    ),
    (
      two_id,
      '00000000-0000-0000-0000-000000000000',
      'authenticated',
      'authenticated',
      'referral-two-' || pg_catalog.replace(two_id::text, '-', '') || '@example.test',
      '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()
    );
  insert into public.profile_capabilities(profile_id, capability)
  values (one_id, 'super_admin') on conflict do nothing;
  insert into public.markets(id, slug, name, is_active) values
    (
      active_market,
      'referral-active-' || pg_catalog.replace(active_market::text, '-', ''),
      'Referral active',
      true
    ),
    (
      second_market,
      'referral-second-' || pg_catalog.replace(second_market::text, '-', ''),
      'Referral second',
      true
    ),
    (
      inactive_market,
      'referral-inactive-' || pg_catalog.replace(inactive_market::text, '-', ''),
      'Referral inactive',
      false
    );
  insert into referral_probe_state(
    one_id, two_id, active_market, second_market, inactive_market
  ) values (
    one_id, two_id, active_market, second_market, inactive_market
  );
end;
$$;

-- Exercise fresh creation, exact replay, bounded owner listing, malformed input,
-- disabled/expired/inactive/suspended resolution, identity kill switch, and IDOR.
do $$
declare
  state referral_probe_state%rowtype;
  created record;
  replay record;
  second_link record;
  toggled record;
  resolved record;
begin
  select * into strict state from referral_probe_state;
  perform pg_catalog.set_config('request.jwt.claim.sub', state.one_id::text, true);

  select * into strict created
  from public.create_or_get_my_referral_link(state.active_market);
  if created.link_id is null
    or created.code !~ '^[0-9a-f]{32}$'
    or created.market_id <> state.active_market
    or created.target <> 'merchant_onboarding'
    or created.status <> 'active'
    or created.expires_at is not null
  then
    raise exception 'fresh owner referral link creation failed';
  end if;
  select * into strict replay
  from public.create_or_get_my_referral_link(state.active_market);
  if replay.link_id <> created.link_id or replay.code <> created.code then
    raise exception 'owner referral link replay changed identity';
  end if;
  select * into strict second_link
  from public.create_or_get_my_referral_link(state.second_market);
  if second_link.link_id = created.link_id
    or second_link.code = created.code
    or second_link.code !~ '^[0-9a-f]{32}$'
  then
    raise exception 'second market referral link creation failed';
  end if;
  if (select count(*) from public.list_my_referral_links()) <> 2 then
    raise exception 'owner referral link list is incomplete';
  end if;
  begin
    perform *
    from public.create_or_get_my_referral_link(state.inactive_market);
    raise exception 'inactive market referral link unexpectedly worked';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform *
    from public.set_my_referral_link_enabled(created.link_id, null);
    raise exception 'nullable toggle unexpectedly mutated referral state';
  exception when invalid_parameter_value then null;
  end;

  update referral_probe_state
  set one_link_id = created.link_id,
      one_code = created.code;
  select * into strict state from referral_probe_state;

  perform pg_catalog.set_config('request.jwt.claim.sub', state.two_id::text, true);
  select * into strict created
  from public.create_or_get_my_referral_link(state.active_market);
  if created.code !~ '^[0-9a-f]{32}$' then
    raise exception 'second owner referral link creation failed';
  end if;
  update referral_probe_state
  set two_link_id = created.link_id,
      two_code = created.code;
  begin
    perform *
    from public.set_my_referral_link_enabled(state.one_link_id, false);
    raise exception 'cross-user referral link update unexpectedly worked';
  exception when insufficient_privilege then null;
  end;

  select * into strict state from referral_probe_state;
  select * into strict resolved
  from public.resolve_referral_acquisition_link(state.one_code);
  if resolved.outcome <> 'valid'
    or resolved.market_slug is null
    or resolved.target <> 'merchant_onboarding'
    or resolved.canonical_target_path <>
      '/' || resolved.market_slug || '/vendor/onboarding/referral'
    or resolved.expires_at is not null
  then
    raise exception 'valid resolver projection changed';
  end if;
  select * into strict resolved
  from public.resolve_referral_acquisition_link(null);
  if resolved.outcome <> 'invalid'
    or resolved.market_slug is not null
    or resolved.target is not null
    or resolved.canonical_target_path is not null
    or resolved.expires_at is not null
  then
    raise exception 'null resolver input was not fully redacted';
  end if;
  select * into strict resolved
  from public.resolve_referral_acquisition_link(pg_catalog.repeat('a', 4096));
  if resolved.outcome <> 'invalid'
    or resolved.market_slug is not null
    or resolved.target is not null
    or resolved.canonical_target_path is not null
    or resolved.expires_at is not null
  then
    raise exception 'oversized resolver input was not fully redacted';
  end if;
  select * into strict resolved
  from public.resolve_referral_acquisition_link(
    'A' || pg_catalog.substr(state.one_code, 2)
  );
  if resolved.outcome <> 'invalid'
    or resolved.market_slug is not null
    or resolved.target is not null
    or resolved.canonical_target_path is not null
    or resolved.expires_at is not null
  then
    raise exception 'non-canonical resolver input was not fully redacted';
  end if;

  perform pg_catalog.set_config('request.jwt.claim.sub', state.one_id::text, true);
  select * into strict toggled
  from public.set_my_referral_link_enabled(state.one_link_id, false);
  if toggled.status <> 'disabled' then
    raise exception 'referral link disable failed';
  end if;
  select * into strict toggled
  from public.set_my_referral_link_enabled(state.one_link_id, false);
  if toggled.status <> 'disabled' then
    raise exception 'referral link repeat disable failed';
  end if;
  select * into strict resolved
  from public.resolve_referral_acquisition_link(state.one_code);
  if resolved.outcome <> 'invalid'
    or resolved.market_slug is not null
    or resolved.target is not null
    or resolved.canonical_target_path is not null
    or resolved.expires_at is not null
  then
    raise exception 'disabled referral link was not fully redacted';
  end if;
  select * into strict toggled
  from public.set_my_referral_link_enabled(state.one_link_id, true);
  if toggled.status <> 'active' then
    raise exception 'referral link re-enable failed';
  end if;

  update private.referral_acquisition_links
  set status = 'expired',
      expires_at = now() + interval '1 hour',
      disabled_at = null
  where id = state.one_link_id;
  select * into strict resolved
  from public.resolve_referral_acquisition_link(state.one_code);
  if resolved.outcome <> 'expired'
    or resolved.market_slug is null
    or resolved.target <> 'merchant_onboarding'
    or resolved.canonical_target_path <>
      '/' || resolved.market_slug || '/vendor/onboarding/referral'
    or resolved.expires_at is null
  then
    raise exception 'stored expired referral link resolution failed';
  end if;
  begin
    perform *
    from public.set_my_referral_link_enabled(state.one_link_id, true);
    raise exception 'stored expired referral link unexpectedly re-enabled';
  exception when object_not_in_prerequisite_state then null;
  end;
  begin
    perform *
    from public.set_my_referral_link_enabled(state.one_link_id, false);
    raise exception 'stored expired referral link unexpectedly disabled';
  exception when object_not_in_prerequisite_state then null;
  end;
  if not exists (
    select 1
    from private.referral_acquisition_links
    where id = state.one_link_id
      and status = 'expired'
  ) then
    raise exception 'stored expired referral link state changed';
  end if;

  update private.referral_acquisition_links
  set status = 'active',
      created_at = now() - interval '2 days',
      expires_at = now() - interval '1 day',
      disabled_at = null
  where id = state.one_link_id;
  select * into strict resolved
  from public.resolve_referral_acquisition_link(state.one_code);
  if resolved.outcome <> 'expired' then
    raise exception 'elapsed active referral link did not expire';
  end if;
  begin
    perform *
    from public.set_my_referral_link_enabled(state.one_link_id, true);
    raise exception 'elapsed referral link unexpectedly re-enabled';
  exception when object_not_in_prerequisite_state then null;
  end;
  begin
    perform *
    from public.set_my_referral_link_enabled(state.one_link_id, false);
    raise exception 'elapsed referral link unexpectedly disabled';
  exception when object_not_in_prerequisite_state then null;
  end;
  if not exists (
    select 1
    from private.referral_acquisition_links
    where id = state.one_link_id
      and status = 'active'
      and expires_at <= now()
  ) then
    raise exception 'elapsed referral link state changed';
  end if;
  update private.referral_acquisition_links
  set expires_at = null
  where id = state.one_link_id;

  update public.markets set is_active = false where id = state.active_market;
  select * into strict resolved
  from public.resolve_referral_acquisition_link(state.one_code);
  if resolved.outcome <> 'invalid'
    or resolved.market_slug is not null
    or resolved.target is not null
    or resolved.canonical_target_path is not null
    or resolved.expires_at is not null
  then
    raise exception 'inactive market referral link was not fully redacted';
  end if;
  update public.markets set is_active = true where id = state.active_market;

  update private.referrer_identities
  set status = 'disabled', disabled_at = now()
  where profile_id = state.one_id;
  if not exists (
    select 1 from private.referral_acquisition_links
    where id = state.one_link_id
  ) then
    raise exception 'identity disable removed retained referral links';
  end if;
  select * into strict resolved
  from public.resolve_referral_acquisition_link(state.one_code);
  if resolved.outcome <> 'invalid'
    or resolved.market_slug is not null
    or resolved.target is not null
    or resolved.canonical_target_path is not null
    or resolved.expires_at is not null
  then
    raise exception 'disabled referrer identity was not fully redacted';
  end if;
  begin
    perform *
    from public.create_or_get_my_referral_link(state.active_market);
    raise exception 'disabled referrer identity unexpectedly created a link';
  exception when object_not_in_prerequisite_state then null;
  end;
  update private.referrer_identities
  set status = 'active', disabled_at = null
  where profile_id = state.one_id;

  update public.profiles set is_suspended = true where id = state.two_id;
  select * into strict resolved
  from public.resolve_referral_acquisition_link(state.two_code);
  if resolved.outcome <> 'invalid'
    or resolved.market_slug is not null
    or resolved.target is not null
    or resolved.canonical_target_path is not null
    or resolved.expires_at is not null
  then
    raise exception 'suspended referrer profile was not fully redacted';
  end if;
  perform pg_catalog.set_config('request.jwt.claim.sub', state.two_id::text, true);
  begin
    perform * from public.list_my_referral_links();
    raise exception 'suspended referrer profile retained owner access';
  exception when insufficient_privilege then null;
  end;
  perform pg_catalog.set_config('request.jwt.claim.sub', state.one_id::text, true);
  update public.profiles set is_suspended = false where id = state.two_id;

  perform pg_catalog.set_config('request.jwt.claim.sub', '', true);
  begin
    perform * from public.list_my_referral_links();
    raise exception 'unauthenticated owner list unexpectedly worked';
  exception when insufficient_privilege then null;
  end;
end;
$$;

-- Invoke every row and statement blocker. No legacy referral row may survive.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'public.referral_rules',
    'public.referral_codes',
    'public.referral_attributions',
    'public.referral_commissions'
  ] loop
    begin
      execute pg_catalog.format('insert into %s default values', table_name);
      raise exception '% row blocker unexpectedly allowed insert', table_name;
    exception when others then
      if sqlstate <> '55000' then raise; end if;
    end;
    begin
      execute pg_catalog.format('truncate table %s cascade', table_name);
      raise exception '% statement blocker unexpectedly allowed truncate', table_name;
    exception when others then
      if sqlstate <> '55000' then raise; end if;
    end;
  end loop;
end;
$$;

-- Remove private fixtures explicitly, then prove referral and every dormant
-- finance/payment/provider/ledger relation remains empty before final rollback.
do $$
declare
  state referral_probe_state%rowtype;
  relation_name text;
  has_rows boolean;
begin
  select * into strict state from referral_probe_state;
  perform pg_catalog.set_config('request.jwt.claim.sub', '', true);
  delete from private.referral_acquisition_links
  where referrer_profile_id in (state.one_id, state.two_id);
  delete from private.referrer_identities
  where profile_id in (state.one_id, state.two_id);
  delete from public.markets
  where id in (state.active_market, state.second_market, state.inactive_market);
  delete from auth.users where id in (state.one_id, state.two_id);

  if exists (select 1 from private.referrer_identities)
    or exists (select 1 from private.referral_acquisition_links)
    or exists (select 1 from public.referral_rules)
    or exists (select 1 from public.referral_codes)
    or exists (select 1 from public.referral_attributions)
    or exists (select 1 from public.referral_commissions)
  then
    raise exception 'referral probe residue remained before rollback';
  end if;

  foreach relation_name in array array[
    'public.payments',
    'public.payment_events',
    'public.webhook_inbox',
    'public.ledger_accounts',
    'public.ledger_journals',
    'public.ledger_entries',
    'private.order_payment_states',
    'private.payment_attempts',
    'private.payment_applications',
    'private.provider_evidence_deliveries',
    'private.provider_evidence_raw_payloads',
    'private.provider_normalized_events',
    'private.commerce_ledger_accounts',
    'private.commerce_ledger_journals',
    'private.commerce_ledger_posting_pairs'
  ] loop
    execute pg_catalog.format(
      'select exists (select 1 from %s)', relation_name
    ) into has_rows;
    if has_rows then
      raise exception '% gained finance residue', relation_name;
    end if;
  end loop;
end;
$$;

rollback;

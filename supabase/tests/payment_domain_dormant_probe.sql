-- Rollback-only live regression probe for
-- 202608310028_localhub_payment_domain_dormant.sql. All fixtures and owner-
-- level trigger exercises are reverted, leaving every finance table empty.

begin;

do $$
declare
  table_name text;
  role_name text;
  privilege_name text;
  signature text;
begin
  if exists (select 1 from public.payments)
    or exists (select 1 from public.payment_events)
    or exists (select 1 from public.webhook_inbox)
    or exists (select 1 from public.ledger_accounts)
    or exists (select 1 from public.ledger_journals)
    or exists (select 1 from public.ledger_entries)
    or exists (select 1 from public.referral_commissions)
  then
    raise exception 'legacy finance quarantine is no longer empty';
  end if;

  foreach table_name in array array[
    'payments',
    'payment_events',
    'webhook_inbox',
    'ledger_accounts',
    'ledger_journals',
    'ledger_entries',
    'referral_commissions'
  ] loop
    foreach role_name in array array['anon', 'authenticated', 'service_role'] loop
      foreach privilege_name in array array[
        'select',
        'insert',
        'update',
        'delete',
        'truncate',
        'references',
        'trigger'
      ] loop
        if pg_catalog.has_table_privilege(
          role_name,
          'public.' || table_name,
          privilege_name
        ) then
          raise exception '% regained legacy finance % on %',
            role_name, privilege_name, table_name;
        end if;
      end loop;

      foreach privilege_name in array array[
        'select', 'insert', 'update', 'references'
      ] loop
        if pg_catalog.has_any_column_privilege(
          role_name,
          'public.' || table_name,
          privilege_name
        ) then
          raise exception '% regained legacy finance column % on %',
            role_name, privilege_name, table_name;
        end if;
      end loop;
    end loop;
  end loop;

  foreach signature in array array[
    'public.post_journal(text,text,uuid,text,jsonb)',
    'public.reverse_posted_journal(uuid,text,text)',
    'public.journal_matches_lines(uuid,jsonb)',
    'public.reversal_matches_original(uuid,uuid)'
  ] loop
    foreach role_name in array array['anon', 'authenticated', 'service_role'] loop
      if pg_catalog.has_function_privilege(role_name, signature, 'execute') then
        raise exception '% regained generic finance execute on %',
          role_name, signature;
      end if;
    end loop;
  end loop;

  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_record
    where constraint_record.conname = 'payment_events_payment_id_fkey'
      and constraint_record.conrelid = 'public.payment_events'::pg_catalog.regclass
      and constraint_record.confrelid = 'public.payments'::pg_catalog.regclass
      and constraint_record.contype = 'f'
      and constraint_record.confdeltype = 'r'
      and constraint_record.convalidated
  ) or not exists (
    select 1
    from pg_catalog.pg_trigger trigger_record
    where trigger_record.tgrelid = 'public.payment_events'::pg_catalog.regclass
      and trigger_record.tgname = 'payment_events_append_only'
      and trigger_record.tgenabled = 'O'
      and not trigger_record.tgisinternal
  ) then
    raise exception 'legacy payment evidence quarantine changed';
  end if;
end;
$$;

do $$
declare
  actual_labels text[];
  role_name text;
  type_name text;
begin
  select pg_catalog.array_agg(enum_record.enumlabel order by enum_record.enumsortorder)
  into actual_labels
  from pg_catalog.pg_enum enum_record
  where enum_record.enumtypid =
    'private.order_payment_state_code'::pg_catalog.regtype;
  if actual_labels is distinct from array[
    'unpaid', 'payment_pending', 'paid', 'partially_refunded', 'refunded'
  ]::text[] then
    raise exception 'order payment state enum changed';
  end if;

  select pg_catalog.array_agg(enum_record.enumlabel order by enum_record.enumsortorder)
  into actual_labels
  from pg_catalog.pg_enum enum_record
  where enum_record.enumtypid =
    'private.payment_attempt_state_code'::pg_catalog.regtype;
  if actual_labels is distinct from array[
    'created', 'initialization_pending', 'awaiting_customer',
    'verification_pending', 'succeeded', 'init_failed', 'init_unknown',
    'failed', 'cancelled', 'expired', 'manual_review'
  ]::text[] then
    raise exception 'payment attempt state enum changed';
  end if;

  select pg_catalog.array_agg(enum_record.enumlabel order by enum_record.enumsortorder)
  into actual_labels
  from pg_catalog.pg_enum enum_record
  where enum_record.enumtypid =
    'private.payment_environment_code'::pg_catalog.regtype;
  if actual_labels is distinct from array['test', 'live']::text[] then
    raise exception 'payment environment enum changed';
  end if;

  select pg_catalog.array_agg(enum_record.enumlabel order by enum_record.enumsortorder)
  into actual_labels
  from pg_catalog.pg_enum enum_record
  where enum_record.enumtypid =
    'private.payment_application_kind'::pg_catalog.regtype;
  if actual_labels is distinct from array[
    'primary_order_payment', 'unapplied_excess'
  ]::text[] then
    raise exception 'payment application kind enum changed';
  end if;

  foreach type_name in array array[
    'private.order_payment_state_code',
    'private.payment_attempt_state_code',
    'private.payment_environment_code',
    'private.payment_application_kind'
  ] loop
    foreach role_name in array array['anon', 'authenticated', 'service_role'] loop
      if pg_catalog.has_type_privilege(role_name, type_name, 'usage') then
        raise exception '% retained usage on %', role_name, type_name;
      end if;
    end loop;
  end loop;
end;
$$;

do $$
declare
  table_name text;
  role_name text;
  privilege_name text;
  has_rows boolean;
  actual_columns text[];
begin
  foreach table_name in array array[
    'order_payment_states', 'payment_attempts', 'payment_applications'
  ] loop
    if not exists (
      select 1
      from pg_catalog.pg_class relation
      join pg_catalog.pg_namespace namespace
        on namespace.oid = relation.relnamespace
      where namespace.nspname = 'private'
        and relation.relname = table_name
        and relation.relkind = 'r'
        and relation.relrowsecurity
        and relation.relforcerowsecurity
    ) or exists (
      select 1
      from pg_catalog.pg_policies
      where schemaname = 'private' and tablename = table_name
    ) then
      raise exception '% is not force-RLS deny-by-default', table_name;
    end if;

    foreach role_name in array array['anon', 'authenticated', 'service_role'] loop
      foreach privilege_name in array array[
        'select',
        'insert',
        'update',
        'delete',
        'truncate',
        'references',
        'trigger'
      ] loop
        if pg_catalog.has_table_privilege(
          role_name,
          'private.' || table_name,
          privilege_name
        ) then
          raise exception '% retained % on private.%',
            role_name, privilege_name, table_name;
        end if;
      end loop;

      foreach privilege_name in array array[
        'select', 'insert', 'update', 'references'
      ] loop
        if pg_catalog.has_any_column_privilege(
          role_name,
          'private.' || table_name,
          privilege_name
        ) then
          raise exception '% retained column % on private.%',
            role_name, privilege_name, table_name;
        end if;
      end loop;
    end loop;

    execute pg_catalog.format(
      'select exists (select 1 from private.%I)', table_name
    ) into has_rows;
    if has_rows then raise exception 'private.% is not empty', table_name; end if;
  end loop;

  select pg_catalog.array_agg(attribute.attname order by attribute.attnum)
  into actual_columns
  from pg_catalog.pg_attribute attribute
  where attribute.attrelid = 'private.order_payment_states'::pg_catalog.regclass
    and attribute.attnum > 0 and not attribute.attisdropped;
  if actual_columns is distinct from array[
    'id', 'order_id', 'payer_id', 'business_id', 'market_id', 'state',
    'expected_amount_minor', 'currency_code', 'order_snapshot_version',
    'order_snapshot_sha256', 'version', 'created_at', 'updated_at'
  ]::text[] then
    raise exception 'order payment state columns changed';
  end if;

  select pg_catalog.array_agg(attribute.attname order by attribute.attnum)
  into actual_columns
  from pg_catalog.pg_attribute attribute
  where attribute.attrelid = 'private.payment_attempts'::pg_catalog.regclass
    and attribute.attnum > 0 and not attribute.attisdropped;
  if actual_columns is distinct from array[
    'id', 'order_payment_state_id', 'provider_code', 'provider_environment',
    'provider_reference', 'idempotency_key_sha256', 'status',
    'expected_amount_minor', 'currency_code', 'order_snapshot_version',
    'order_snapshot_sha256', 'version', 'created_at', 'updated_at'
  ]::text[] then
    raise exception 'payment attempt columns changed';
  end if;

  select pg_catalog.array_agg(attribute.attname order by attribute.attnum)
  into actual_columns
  from pg_catalog.pg_attribute attribute
  where attribute.attrelid = 'private.payment_applications'::pg_catalog.regclass
    and attribute.attnum > 0 and not attribute.attisdropped;
  if actual_columns is distinct from array[
    'id', 'order_payment_state_id', 'payment_attempt_id', 'attempt_status',
    'kind', 'expected_amount_minor', 'currency_code',
    'order_snapshot_version', 'order_snapshot_sha256', 'created_at'
  ]::text[] then
    raise exception 'payment application columns changed';
  end if;
end;
$$;

do $$
declare
  constraint_definition text;
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_record
    where constraint_record.conrelid = 'public.orders'::pg_catalog.regclass
      and constraint_record.conname = 'orders_payment_identity_unique'
      and constraint_record.contype = 'u'
      and constraint_record.convalidated
  ) then
    raise exception 'order payment identity key is missing';
  end if;

  if (
    select count(*)
    from pg_catalog.pg_constraint constraint_record
    where constraint_record.conrelid in (
      'private.order_payment_states'::pg_catalog.regclass,
      'private.payment_attempts'::pg_catalog.regclass,
      'private.payment_applications'::pg_catalog.regclass
    )
      and constraint_record.contype = 'f'
      and constraint_record.convalidated
      and constraint_record.confdeltype = 'r'
  ) <> 6 or exists (
    select 1
    from pg_catalog.pg_constraint constraint_record
    where constraint_record.conrelid in (
      'private.order_payment_states'::pg_catalog.regclass,
      'private.payment_attempts'::pg_catalog.regclass,
      'private.payment_applications'::pg_catalog.regclass
    )
      and constraint_record.contype = 'f'
      and (
        not constraint_record.convalidated
        or constraint_record.confdeltype <> 'r'
      )
  ) then
    raise exception 'payment domain restrictive FK contract changed';
  end if;

  select pg_catalog.pg_get_constraintdef(constraint_record.oid)
  into strict constraint_definition
  from pg_catalog.pg_constraint constraint_record
  where constraint_record.conrelid =
      'private.order_payment_states'::pg_catalog.regclass
    and constraint_record.conname = 'order_payment_states_order_identity_fkey';
  if constraint_definition not like
    'FOREIGN KEY (order_id, payer_id, business_id, market_id, expected_amount_minor, currency_code) REFERENCES orders(id, buyer_id, business_id, market_id, total_minor, currency_code) ON DELETE RESTRICT'
  then
    raise exception 'order identity FK changed: %', constraint_definition;
  end if;

  select pg_catalog.pg_get_constraintdef(constraint_record.oid)
  into strict constraint_definition
  from pg_catalog.pg_constraint constraint_record
  where constraint_record.conrelid = 'private.payment_attempts'::pg_catalog.regclass
    and constraint_record.conname = 'payment_attempts_state_snapshot_fkey';
  if constraint_definition not like
    'FOREIGN KEY (order_payment_state_id, expected_amount_minor, currency_code, order_snapshot_version, order_snapshot_sha256) REFERENCES private.order_payment_states(id, expected_amount_minor, currency_code, order_snapshot_version, order_snapshot_sha256) ON DELETE RESTRICT'
  then
    raise exception 'attempt snapshot FK changed: %', constraint_definition;
  end if;

  select pg_catalog.pg_get_constraintdef(constraint_record.oid)
  into strict constraint_definition
  from pg_catalog.pg_constraint constraint_record
  where constraint_record.conrelid =
      'private.payment_applications'::pg_catalog.regclass
    and constraint_record.conname = 'payment_applications_succeeded_attempt_fkey';
  if constraint_definition not like
    'FOREIGN KEY (payment_attempt_id, order_payment_state_id, attempt_status, expected_amount_minor, currency_code, order_snapshot_version, order_snapshot_sha256) REFERENCES private.payment_attempts(id, order_payment_state_id, status, expected_amount_minor, currency_code, order_snapshot_version, order_snapshot_sha256) ON DELETE RESTRICT'
  then
    raise exception 'application success FK changed: %', constraint_definition;
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_indexes index_record
    where index_record.schemaname = 'private'
      and index_record.indexname = 'payment_applications_one_primary_idx'
      and index_record.indexdef like
        '%UNIQUE INDEX%ON private.payment_applications%WHERE (kind = ''primary_order_payment''::private.payment_application_kind)%'
  ) or exists (
    select 1
    from pg_catalog.pg_indexes index_record
    where index_record.schemaname = 'private'
      and index_record.tablename = 'payment_attempts'
      and index_record.indexdef like '%WHERE%status%succeeded%'
  ) then
    raise exception 'payment success uniqueness contract changed';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_indexes
    where schemaname = 'private'
      and indexname = 'order_payment_states_payer_idx'
  ) or not exists (
    select 1 from pg_catalog.pg_indexes
    where schemaname = 'private'
      and indexname = 'order_payment_states_business_state_created_idx'
  ) or not exists (
    select 1 from pg_catalog.pg_indexes
    where schemaname = 'private'
      and indexname = 'order_payment_states_market_idx'
  ) or not exists (
    select 1 from pg_catalog.pg_indexes
    where schemaname = 'private'
      and indexname = 'payment_attempts_state_created_idx'
  ) or not exists (
    select 1 from pg_catalog.pg_indexes
    where schemaname = 'private'
      and indexname = 'payment_applications_state_kind_created_idx'
  ) then
    raise exception 'payment domain supporting index is missing';
  end if;
end;
$$;

do $$
declare
  trigger_function pg_catalog.pg_proc%rowtype;
  owner_name text;
  role_name text;
begin
  select * into strict trigger_function
  from pg_catalog.pg_proc
  where oid =
    'private.prevent_dormant_payment_domain_mutation()'::pg_catalog.regprocedure;
  if trigger_function.prosecdef
    or not coalesce(trigger_function.proconfig, array[]::text[])
      @> array['search_path=""']::text[]
  then
    raise exception 'dormant trigger is not a fixed-path invoker';
  end if;

  select owner_role.rolname into owner_name
  from pg_catalog.pg_roles owner_role
  where owner_role.oid = trigger_function.proowner;
  if owner_name is null or owner_name in (
    'anon', 'authenticated', 'authenticator', 'service_role'
  ) then
    raise exception 'dormant trigger owner is not trusted';
  end if;

  foreach role_name in array array['anon', 'authenticated', 'service_role'] loop
    if pg_catalog.has_function_privilege(
      role_name,
      'private.prevent_dormant_payment_domain_mutation()',
      'execute'
    ) then
      raise exception '% retained dormant trigger execute', role_name;
    end if;
  end loop;

  if exists (
    select 1
    from pg_catalog.aclexplode(
      coalesce(
        trigger_function.proacl,
        pg_catalog.acldefault('f', trigger_function.proowner)
      )
    ) privilege
    where privilege.grantee = 0
      and privilege.privilege_type = 'EXECUTE'
  ) or (
    select count(*)
    from pg_catalog.pg_trigger trigger_record
    where trigger_record.tgrelid in (
      'private.order_payment_states'::pg_catalog.regclass,
      'private.payment_attempts'::pg_catalog.regclass,
      'private.payment_applications'::pg_catalog.regclass
    )
      and not trigger_record.tgisinternal
      and trigger_record.tgenabled = 'O'
      and trigger_record.tgfoid = trigger_function.oid
  ) <> 6 then
    raise exception 'dormant trigger ACL or attachment changed';
  end if;
end;
$$;

-- Every owner-level insert is blocked before a foreign-key lookup can reveal
-- whether a referenced commerce identity exists.
do $$
declare
  expected_message constant text := 'payment domain is dormant';
begin
  begin
    insert into private.order_payment_states(
      order_id, payer_id, business_id, market_id,
      expected_amount_minor, currency_code,
      order_snapshot_version, order_snapshot_sha256
    ) values (
      extensions.gen_random_uuid(), extensions.gen_random_uuid(),
      extensions.gen_random_uuid(), extensions.gen_random_uuid(),
      1, 'NGN', 1, repeat('a', 64)
    );
    raise exception 'dormant payment state insert unexpectedly worked';
  exception when others then
    if sqlstate <> '55000' or sqlerrm <> expected_message then raise; end if;
  end;

  begin
    insert into private.payment_attempts(
      order_payment_state_id, provider_code, provider_environment,
      provider_reference, idempotency_key_sha256,
      expected_amount_minor, currency_code,
      order_snapshot_version, order_snapshot_sha256
    ) values (
      extensions.gen_random_uuid(), 'probe', 'test',
      'probe-reference', repeat('b', 64), 1, 'NGN', 1, repeat('a', 64)
    );
    raise exception 'dormant payment attempt insert unexpectedly worked';
  exception when others then
    if sqlstate <> '55000' or sqlerrm <> expected_message then raise; end if;
  end;

  begin
    insert into private.payment_applications(
      order_payment_state_id, payment_attempt_id, kind,
      expected_amount_minor, currency_code,
      order_snapshot_version, order_snapshot_sha256
    ) values (
      extensions.gen_random_uuid(), extensions.gen_random_uuid(),
      'primary_order_payment', 1, 'NGN', 1, repeat('a', 64)
    );
    raise exception 'dormant payment application insert unexpectedly worked';
  exception when others then
    if sqlstate <> '55000' or sqlerrm <> expected_message then raise; end if;
  end;
end;
$$;

create temporary table payment_domain_dormant_probe_state (
  profile_id uuid not null,
  market_id uuid not null,
  business_id uuid not null,
  order_id uuid not null,
  state_id uuid not null,
  attempt_id uuid not null,
  application_id uuid not null
) on commit drop;

do $$
declare
  fixture_key text := replace(extensions.gen_random_uuid()::text, '-', '');
  profile_id uuid := extensions.gen_random_uuid();
  market_id uuid := extensions.gen_random_uuid();
  business_id uuid := extensions.gen_random_uuid();
  order_id uuid := extensions.gen_random_uuid();
  state_id uuid := extensions.gen_random_uuid();
  attempt_id uuid := extensions.gen_random_uuid();
  application_id uuid := extensions.gen_random_uuid();
begin
  insert into auth.users(
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
  ) values (
    profile_id, '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'payment-domain-probe-' || fixture_key || '@example.test',
    '', now(), '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb, now(), now()
  );
  insert into public.markets(id, slug, name, is_active)
  values (market_id, 'payment-probe-' || fixture_key,
    'Payment domain probe market', true);
  insert into public.businesses(id, market_id, name, slug, status)
  values (business_id, market_id, 'Payment domain probe business',
    'payment-probe-business-' || fixture_key, 'active');
  insert into public.orders(
    id, order_number, buyer_id, business_id, market_id,
    status, currency_code, subtotal_minor, total_minor
  ) values (
    order_id, 'PAYMENT-PROBE-' || fixture_key, profile_id, business_id,
    market_id, 'placed', 'NGN', 100, 100
  );

  execute 'alter table private.order_payment_states '
    || 'disable trigger order_payment_states_dormant_rows';
  insert into private.order_payment_states(
    id, order_id, payer_id, business_id, market_id, state,
    expected_amount_minor, currency_code,
    order_snapshot_version, order_snapshot_sha256
  ) values (
    state_id, order_id, profile_id, business_id, market_id, 'unpaid',
    100, 'NGN', 1, repeat('a', 64)
  );
  execute 'alter table private.order_payment_states '
    || 'enable trigger order_payment_states_dormant_rows';

  execute 'alter table private.payment_attempts '
    || 'disable trigger payment_attempts_dormant_rows';
  insert into private.payment_attempts(
    id, order_payment_state_id, provider_code, provider_environment,
    provider_reference, idempotency_key_sha256, status,
    expected_amount_minor, currency_code,
    order_snapshot_version, order_snapshot_sha256
  ) values (
    attempt_id, state_id, 'probe', 'test',
    'probe-reference-' || fixture_key, repeat('b', 64), 'succeeded',
    100, 'NGN', 1, repeat('a', 64)
  );
  execute 'alter table private.payment_attempts '
    || 'enable trigger payment_attempts_dormant_rows';

  execute 'alter table private.payment_applications '
    || 'disable trigger payment_applications_dormant_rows';
  insert into private.payment_applications(
    id, order_payment_state_id, payment_attempt_id, attempt_status, kind,
    expected_amount_minor, currency_code,
    order_snapshot_version, order_snapshot_sha256
  ) values (
    application_id, state_id, attempt_id, 'succeeded',
    'primary_order_payment', 100, 'NGN', 1, repeat('a', 64)
  );
  execute 'alter table private.payment_applications '
    || 'enable trigger payment_applications_dormant_rows';

  insert into payment_domain_dormant_probe_state values (
    profile_id, market_id, business_id, order_id,
    state_id, attempt_id, application_id
  );
end;
$$;

do $$
declare
  state payment_domain_dormant_probe_state%rowtype;
  expected_message constant text := 'payment domain is dormant';
begin
  select * into strict state from payment_domain_dormant_probe_state;

  begin
    update private.order_payment_states
    set version = version where id = state.state_id;
    raise exception 'dormant payment state update unexpectedly worked';
  exception when others then
    if sqlstate <> '55000' or sqlerrm <> expected_message then raise; end if;
  end;
  begin
    delete from private.order_payment_states where id = state.state_id;
    raise exception 'dormant payment state delete unexpectedly worked';
  exception when others then
    if sqlstate <> '55000' or sqlerrm <> expected_message then raise; end if;
  end;

  begin
    update private.payment_attempts
    set version = version where id = state.attempt_id;
    raise exception 'dormant payment attempt update unexpectedly worked';
  exception when others then
    if sqlstate <> '55000' or sqlerrm <> expected_message then raise; end if;
  end;
  begin
    delete from private.payment_attempts where id = state.attempt_id;
    raise exception 'dormant payment attempt delete unexpectedly worked';
  exception when others then
    if sqlstate <> '55000' or sqlerrm <> expected_message then raise; end if;
  end;

  begin
    update private.payment_applications
    set kind = kind where id = state.application_id;
    raise exception 'dormant payment application update unexpectedly worked';
  exception when others then
    if sqlstate <> '55000' or sqlerrm <> expected_message then raise; end if;
  end;
  begin
    delete from private.payment_applications where id = state.application_id;
    raise exception 'dormant payment application delete unexpectedly worked';
  exception when others then
    if sqlstate <> '55000' or sqlerrm <> expected_message then raise; end if;
  end;

  if (select count(*) from private.order_payment_states) <> 1
    or (select count(*) from private.payment_attempts) <> 1
    or (select count(*) from private.payment_applications) <> 1
  then
    raise exception 'dormant row mutation changed fixture cardinality';
  end if;
end;
$$;

do $$
declare expected_message constant text := 'payment domain is dormant';
begin
  begin
    truncate private.payment_applications;
    raise exception 'dormant payment application truncate unexpectedly worked';
  exception when others then
    if sqlstate <> '55000' or sqlerrm <> expected_message then raise; end if;
  end;
  begin
    truncate private.payment_attempts;
    raise exception 'dormant payment attempt truncate unexpectedly worked';
  exception when others then
    if sqlstate = '55000' then
      if sqlerrm <> expected_message then raise; end if;
    elsif sqlstate = '0A000' then
      if sqlerrm <> 'cannot truncate a table referenced in a foreign key constraint'
      then raise; end if;
    else
      raise;
    end if;
  end;
  begin
    truncate private.order_payment_states;
    raise exception 'dormant payment state truncate unexpectedly worked';
  exception when others then
    if sqlstate = '55000' then
      if sqlerrm <> expected_message then raise; end if;
    elsif sqlstate = '0A000' then
      if sqlerrm <> 'cannot truncate a table referenced in a foreign key constraint'
      then raise; end if;
    else
      raise;
    end if;
  end;

  if (select count(*) from private.order_payment_states) <> 1
    or (select count(*) from private.payment_attempts) <> 1
    or (select count(*) from private.payment_applications) <> 1
  then
    raise exception 'dormant truncate changed fixture cardinality';
  end if;
end;
$$;

rollback;

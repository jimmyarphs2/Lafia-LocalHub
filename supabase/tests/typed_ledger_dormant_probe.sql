-- Rollback-only live regression probe for
-- 202608310030_localhub_typed_ledger_dormant.sql. Fixtures exercise only the
-- dormant structure and are removed before ROLLBACK.

begin;

do $$
declare
  table_name text;
  role_name text;
  privilege_name text;
  actual_labels text[];
  expected record;
begin
  if exists (select 1 from public.payments)
    or exists (select 1 from public.payment_events)
    or exists (select 1 from public.webhook_inbox)
    or exists (select 1 from public.ledger_accounts)
    or exists (select 1 from public.ledger_journals)
    or exists (select 1 from public.ledger_entries)
    or exists (select 1 from public.referral_commissions)
    or exists (select 1 from private.order_payment_states)
    or exists (select 1 from private.payment_attempts)
    or exists (select 1 from private.payment_applications)
    or exists (select 1 from private.provider_evidence_deliveries)
    or exists (select 1 from private.provider_evidence_raw_payloads)
    or exists (select 1 from private.provider_normalized_events)
    or exists (select 1 from private.commerce_ledger_accounts)
    or exists (select 1 from private.commerce_ledger_journals)
    or exists (select 1 from private.commerce_ledger_posting_pairs)
  then
    raise exception 'typed ledger hosted baseline is not empty';
  end if;

  foreach table_name in array array[
    'private.commerce_ledger_accounts',
    'private.commerce_ledger_journals',
    'private.commerce_ledger_posting_pairs'
  ] loop
    if not exists (
      select 1 from pg_catalog.pg_class c
      where c.oid = table_name::pg_catalog.regclass
        and c.relrowsecurity and c.relforcerowsecurity
    ) or exists (
      select 1 from pg_catalog.pg_policies p
      where p.schemaname = 'private'
        and p.tablename = pg_catalog.split_part(table_name, '.', 2)
    ) then
      raise exception '% is not forced deny-by-default RLS', table_name;
    end if;
    foreach role_name in array array['anon', 'authenticated', 'service_role'] loop
      foreach privilege_name in array array[
        'select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger'
      ] loop
        if pg_catalog.has_table_privilege(role_name, table_name, privilege_name) then
          raise exception '% retained % on %', role_name, privilege_name, table_name;
        end if;
      end loop;
      foreach privilege_name in array array['select', 'insert', 'update', 'references'] loop
        if pg_catalog.has_any_column_privilege(role_name, table_name, privilege_name) then
          raise exception '% retained column % on %', role_name, privilege_name, table_name;
        end if;
      end loop;
    end loop;
  end loop;

  foreach table_name in array array[
    'commerce_account_class_code', 'commerce_account_owner_code',
    'commerce_account_scope_code', 'commerce_account_purpose_code',
    'commerce_journal_kind_code'
  ] loop
    foreach role_name in array array['anon', 'authenticated', 'service_role'] loop
      if pg_catalog.has_type_privilege(role_name, 'private.' || table_name, 'usage') then
        raise exception '% retained type use on %', role_name, table_name;
      end if;
    end loop;
  end loop;

  for expected in
    select * from (values
      ('private.commerce_account_class_code'::pg_catalog.regtype,
        array['asset', 'liability']::text[]),
      ('private.commerce_account_owner_code'::pg_catalog.regtype,
        array['localhub', 'business']::text[]),
      ('private.commerce_account_scope_code'::pg_catalog.regtype,
        array['platform', 'provider_environment', 'business']::text[]),
      ('private.commerce_account_purpose_code'::pg_catalog.regtype,
        array['provider_clearing', 'unapplied_customer_funds',
          'order_funds_payable']::text[]),
      ('private.commerce_journal_kind_code'::pg_catalog.regtype,
        array['verified_charge', 'order_payment_application', 'reversal']::text[])
    ) as expected_contract(type_oid, labels)
  loop
    select pg_catalog.array_agg(e.enumlabel order by e.enumsortorder)
    into actual_labels
    from pg_catalog.pg_enum e
    where e.enumtypid = expected.type_oid;
    if actual_labels is distinct from expected.labels then
      raise exception 'typed ledger enum labels changed';
    end if;
  end loop;

  if exists (
    select 1 from pg_catalog.pg_attribute a
    where a.attrelid in (
      'private.commerce_ledger_accounts'::pg_catalog.regclass,
      'private.commerce_ledger_journals'::pg_catalog.regclass,
      'private.commerce_ledger_posting_pairs'::pg_catalog.regclass
    ) and a.attnum > 0 and not a.attisdropped
      and a.attname in ('balance', 'is_active', 'metadata', 'payload', 'json')
  ) then raise exception 'typed ledger gained a sensitive or generic column'; end if;

  if exists (
    select 1
    from (values
      ('private.commerce_ledger_accounts'::pg_catalog.regclass,
        'commerce_ledger_accounts_dormant_rows', 31::int2),
      ('private.commerce_ledger_accounts'::pg_catalog.regclass,
        'commerce_ledger_accounts_dormant_truncate', 34::int2),
      ('private.commerce_ledger_journals'::pg_catalog.regclass,
        'commerce_ledger_journals_dormant_rows', 31::int2),
      ('private.commerce_ledger_journals'::pg_catalog.regclass,
        'commerce_ledger_journals_dormant_truncate', 34::int2),
      ('private.commerce_ledger_posting_pairs'::pg_catalog.regclass,
        'commerce_ledger_posting_pairs_dormant_rows', 31::int2),
      ('private.commerce_ledger_posting_pairs'::pg_catalog.regclass,
        'commerce_ledger_posting_pairs_dormant_truncate', 34::int2)
    ) as wanted(relid, trigger_name, trigger_type)
    left join pg_catalog.pg_trigger t
      on t.tgrelid = wanted.relid
      and t.tgname = wanted.trigger_name
      and t.tgtype = wanted.trigger_type
      and t.tgfoid =
        'private.prevent_dormant_commerce_ledger_mutation()'::pg_catalog.regprocedure
      and t.tgenabled = 'O'
      and not t.tgisinternal
    where t.oid is null
  ) or (
    select count(*) from pg_catalog.pg_trigger t
    where t.tgrelid in (
      'private.commerce_ledger_accounts'::pg_catalog.regclass,
      'private.commerce_ledger_journals'::pg_catalog.regclass,
      'private.commerce_ledger_posting_pairs'::pg_catalog.regclass
    ) and not t.tgisinternal and t.tgenabled = 'O'
      and t.tgfoid =
        'private.prevent_dormant_commerce_ledger_mutation()'::pg_catalog.regprocedure
  ) <> 6 then
    raise exception 'typed ledger blocker trigger metadata changed';
  end if;

  foreach role_name in array array['anon', 'authenticated', 'service_role'] loop
    if pg_catalog.has_function_privilege(
      role_name, 'private.prevent_dormant_commerce_ledger_mutation()', 'execute'
    ) then raise exception '% retained dormant blocker execute', role_name; end if;
  end loop;

  if exists (
    select 1 from pg_catalog.pg_constraint c
    where c.conrelid in (
      'private.commerce_ledger_accounts'::pg_catalog.regclass,
      'private.commerce_ledger_journals'::pg_catalog.regclass,
      'private.commerce_ledger_posting_pairs'::pg_catalog.regclass
    ) and c.contype = 'f' and (c.confdeltype <> 'r' or not c.convalidated)
  ) then raise exception 'typed ledger has a nonrestrictive or unvalidated FK'; end if;
end;
$$;

-- All direct writes must be stopped even for the table owner.
do $$
begin
  begin
    insert into private.commerce_ledger_accounts(
      account_class, purpose, owner_type, scope, currency_code
    ) values ('liability', 'unapplied_customer_funds', 'localhub', 'platform', 'NGN');
    raise exception 'dormant commerce account insert unexpectedly worked';
  exception when others then
    if sqlstate <> '55000' or sqlerrm <> 'commerce ledger is dormant' then raise; end if;
  end;
end;
$$;

create temporary table typed_ledger_dormant_probe_state (
  profile_id uuid not null, market_id uuid not null, business_id uuid not null,
  order_id uuid not null, payment_state_id uuid not null, attempt_id uuid not null,
  application_id uuid not null, delivery_id uuid not null, event_id uuid not null,
  clearing_id uuid not null, unapplied_id uuid not null, payable_id uuid not null,
  journal_id uuid not null, pair_id uuid not null, reversal_journal_id uuid not null,
  reversal_pair_id uuid not null
) on commit drop;

do $$
declare
  fixture_key text := replace(extensions.gen_random_uuid()::text, '-', '');
  profile_id uuid := extensions.gen_random_uuid();
  market_id uuid := extensions.gen_random_uuid();
  business_id uuid := extensions.gen_random_uuid();
  order_id uuid := extensions.gen_random_uuid();
  payment_state_id uuid := extensions.gen_random_uuid();
  attempt_id uuid := extensions.gen_random_uuid();
  application_id uuid := extensions.gen_random_uuid();
  delivery_id uuid := extensions.gen_random_uuid();
  event_id uuid := extensions.gen_random_uuid();
  quarantined_event_id uuid := extensions.gen_random_uuid();
  missing_money_event_id uuid := extensions.gen_random_uuid();
  clearing_id uuid := extensions.gen_random_uuid();
  unapplied_id uuid := extensions.gen_random_uuid();
  payable_id uuid := extensions.gen_random_uuid();
  journal_id uuid := extensions.gen_random_uuid();
  application_journal_id uuid := extensions.gen_random_uuid();
  self_reversal_id uuid := extensions.gen_random_uuid();
  pair_id uuid := extensions.gen_random_uuid();
  reversal_journal_id uuid := extensions.gen_random_uuid();
  reversal_pair_id uuid := extensions.gen_random_uuid();
  body bytea := pg_catalog.convert_to('typed-ledger-probe', 'UTF8');
  body_sha text;
begin
  body_sha := encode(extensions.digest(body, 'sha256'), 'hex');
  insert into auth.users(
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values (
    profile_id, '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'typed-ledger-' || fixture_key || '@example.test',
    '', now(), '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb, now(), now()
  );
  insert into public.markets(id, slug, name, is_active)
  values (market_id, 'typed-ledger-' || fixture_key, 'Typed ledger probe', true);
  insert into public.businesses(id, market_id, name, slug, status)
  values (business_id, market_id, 'Typed ledger probe business',
    'typed-ledger-business-' || fixture_key, 'active');
  insert into public.orders(
    id, order_number, buyer_id, business_id, market_id, status,
    currency_code, subtotal_minor, total_minor
  ) values (order_id, 'TLEDGER-' || fixture_key, profile_id, business_id, market_id,
    'placed', 'NGN', 100, 100);

  execute 'alter table private.order_payment_states disable trigger order_payment_states_dormant_rows';
  execute 'alter table private.payment_attempts disable trigger payment_attempts_dormant_rows';
  execute 'alter table private.payment_applications disable trigger payment_applications_dormant_rows';
  insert into private.order_payment_states(
    id, order_id, payer_id, business_id, market_id, expected_amount_minor,
    currency_code, order_snapshot_version, order_snapshot_sha256
  ) values (payment_state_id, order_id, profile_id, business_id, market_id,
    100, 'NGN', 1, repeat('a', 64));
  insert into private.payment_attempts(
    id, order_payment_state_id, provider_code, provider_environment,
    provider_reference, idempotency_key_sha256, status, expected_amount_minor,
    currency_code, order_snapshot_version, order_snapshot_sha256
  ) values (attempt_id, payment_state_id, 'probe', 'test',
    'typed-ledger-reference-' || fixture_key, repeat('b', 64), 'succeeded',
    100, 'NGN', 1, repeat('a', 64));
  insert into private.payment_applications(
    id, order_payment_state_id, payment_attempt_id, attempt_status, kind,
    expected_amount_minor, currency_code, order_snapshot_version, order_snapshot_sha256
  ) values (application_id, payment_state_id, attempt_id, 'succeeded',
    'primary_order_payment', 100, 'NGN', 1, repeat('a', 64));
  execute 'alter table private.payment_applications enable trigger payment_applications_dormant_rows';
  execute 'alter table private.payment_attempts enable trigger payment_attempts_dormant_rows';
  execute 'alter table private.order_payment_states enable trigger order_payment_states_dormant_rows';

  execute 'alter table private.provider_evidence_deliveries disable trigger provider_evidence_deliveries_dormant_rows';
  execute 'alter table private.provider_normalized_events disable trigger provider_normalized_events_dormant_rows';
  insert into private.provider_evidence_deliveries(
    id, provider_code, provider_environment, digest_version, raw_body_sha256,
    raw_body_bytes, signature_method, signature_sha256, signature_key_version,
    verifier_version, content_type, received_at, signature_verified_at
  ) values (delivery_id, 'probe', 'test', 1, body_sha, octet_length(body),
    'hmac_sha512', repeat('c', 64), 'v1', 1, 'application/octet-stream',
    now() - interval '2 seconds', now() - interval '1 second');
  insert into private.provider_normalized_events(
    id, delivery_id, event_index, normalizer_version, provider_code,
    provider_environment, normalization_outcome, provider_event_kind,
    provider_resource_kind, provider_reference, payment_attempt_id,
    observed_amount_minor, observed_currency_code, semantic_key_version,
    semantic_key_sha256
  ) values (event_id, delivery_id, 0, 1, 'probe', 'test', 'matched_attempt',
    'charge.success', 'charge', 'typed-ledger-reference-' || fixture_key,
    attempt_id, 100, 'NGN', 1, repeat('d', 64));
  insert into private.provider_normalized_events(
    id, delivery_id, event_index, normalizer_version, provider_code,
    provider_environment, normalization_outcome, provider_event_kind,
    provider_resource_kind, provider_reference, observed_amount_minor,
    observed_currency_code
  ) values (quarantined_event_id, delivery_id, 1, 1, 'probe', 'test',
    'quarantined_unknown_reference', 'charge.success', 'charge',
    'unknown-reference-' || fixture_key, 100, 'NGN');
  insert into private.provider_normalized_events(
    id, delivery_id, event_index, normalizer_version, provider_code,
    provider_environment, normalization_outcome, provider_event_kind,
    provider_resource_kind, provider_reference, payment_attempt_id,
    semantic_key_version, semantic_key_sha256
  ) values (missing_money_event_id, delivery_id, 2, 1, 'probe', 'test',
    'matched_attempt', 'charge.success', 'charge',
    'typed-ledger-reference-' || fixture_key, attempt_id, 1, repeat('4', 64));
  execute 'alter table private.provider_normalized_events enable trigger provider_normalized_events_dormant_rows';
  execute 'alter table private.provider_evidence_deliveries enable trigger provider_evidence_deliveries_dormant_rows';

  execute 'alter table private.commerce_ledger_accounts disable trigger commerce_ledger_accounts_dormant_rows';
  execute 'alter table private.commerce_ledger_journals disable trigger commerce_ledger_journals_dormant_rows';
  execute 'alter table private.commerce_ledger_posting_pairs disable trigger commerce_ledger_posting_pairs_dormant_rows';

  begin
    insert into private.commerce_ledger_accounts(
      account_class, purpose, owner_type, scope, currency_code
    ) values ('asset', 'provider_clearing', 'localhub', 'platform', 'NGN');
    raise exception 'invalid provider clearing account unexpectedly worked';
  exception when check_violation then null;
  end;
  begin
    insert into private.commerce_ledger_accounts(
      account_class, purpose, owner_type, scope, provider_code,
      payment_environment, currency_code
    ) values ('liability', 'unapplied_customer_funds', 'localhub', 'platform',
      'probe', 'test', 'NGN');
    raise exception 'invalid unapplied account unexpectedly worked';
  exception when check_violation then null;
  end;
  begin
    insert into private.commerce_ledger_accounts(
      account_class, purpose, owner_type, scope, currency_code
    ) values ('liability', 'order_funds_payable', 'business', 'business', 'NGN');
    raise exception 'invalid payable account unexpectedly worked';
  exception when check_violation then null;
  end;
  insert into private.commerce_ledger_accounts(
    id, account_class, purpose, owner_type, scope, provider_code,
    payment_environment, currency_code
  ) values (clearing_id, 'asset', 'provider_clearing', 'localhub',
    'provider_environment', 'probe', 'test', 'NGN');
  insert into private.commerce_ledger_accounts(
    id, account_class, purpose, owner_type, scope, currency_code
  ) values (unapplied_id, 'liability', 'unapplied_customer_funds', 'localhub',
    'platform', 'NGN');
  insert into private.commerce_ledger_accounts(
    id, account_class, purpose, owner_type, owner_id, scope, currency_code
  ) values (payable_id, 'liability', 'order_funds_payable', 'business', business_id,
    'business', 'NGN');

  begin
    insert into private.commerce_ledger_journals(
      kind, currency_code, amount_minor, posting_key_sha256, policy_version,
      source_evidence_sha256, normalized_event_id, effective_at, recorded_at,
      reason_code
    ) values ('verified_charge', 'NGN', 100, repeat('5', 64), 1, body_sha,
      event_id, now(), now(), 'probe.missing-outcome');
    raise exception 'missing normalization outcome unexpectedly worked';
  exception when check_violation then null;
  end;
  begin
    insert into private.commerce_ledger_journals(
      kind, currency_code, amount_minor, posting_key_sha256, policy_version,
      source_evidence_sha256, normalized_event_id, normalization_outcome,
      effective_at, recorded_at, reason_code
    ) values ('verified_charge', 'NGN', 100, repeat('6', 64), 1, body_sha,
      quarantined_event_id, 'quarantined_unknown_reference', now(), now(),
      'probe.quarantined');
    raise exception 'quarantined evidence unexpectedly worked';
  exception when check_violation then null;
  end;
  begin
    insert into private.commerce_ledger_journals(
      kind, currency_code, amount_minor, posting_key_sha256, policy_version,
      source_evidence_sha256, normalized_event_id, normalization_outcome,
      effective_at, recorded_at, reason_code
    ) values ('verified_charge', 'NGN', 100, repeat('7', 64), 1, body_sha,
      missing_money_event_id, 'matched_attempt', now(), now(),
      'probe.missing-money');
    raise exception 'missing evidence money unexpectedly worked';
  exception when foreign_key_violation then null;
  end;
  begin
    insert into private.commerce_ledger_journals(
      kind, currency_code, amount_minor, posting_key_sha256, policy_version,
      source_evidence_sha256, normalized_event_id, normalization_outcome,
      effective_at, recorded_at, reason_code
    ) values ('verified_charge', 'NGN', 99, repeat('e', 64), 1, body_sha,
      event_id, 'matched_attempt', now(), now(), 'probe.charge');
    raise exception 'evidence amount mismatch unexpectedly worked';
  exception when foreign_key_violation then null;
  end;
  begin
    insert into private.commerce_ledger_journals(
      kind, currency_code, amount_minor, posting_key_sha256, policy_version,
      source_evidence_sha256, normalized_event_id, normalization_outcome,
      effective_at, recorded_at, reason_code
    ) values ('verified_charge', 'USD', 100, repeat('8', 64), 1, body_sha,
      event_id, 'matched_attempt', now(), now(), 'probe.event-currency');
    raise exception 'evidence currency mismatch unexpectedly worked';
  exception when foreign_key_violation then null;
  end;
  begin
    insert into private.commerce_ledger_journals(
      kind, currency_code, amount_minor, posting_key_sha256, policy_version,
      source_evidence_sha256, payment_application_id, effective_at, recorded_at, reason_code
    ) values ('order_payment_application', 'NGN', 99, repeat('f', 64), 1,
      body_sha, application_id, now(), now(), 'probe.application');
    raise exception 'application amount mismatch unexpectedly worked';
  exception when foreign_key_violation then null;
  end;
  begin
    insert into private.commerce_ledger_journals(
      kind, currency_code, amount_minor, posting_key_sha256, policy_version,
      source_evidence_sha256, payment_application_id, effective_at, recorded_at,
      reason_code
    ) values ('order_payment_application', 'USD', 100, repeat('9', 64), 1,
      body_sha, application_id, now(), now(), 'probe.application-currency');
    raise exception 'application currency mismatch unexpectedly worked';
  exception when foreign_key_violation then null;
  end;
  begin
    insert into private.commerce_ledger_journals(
      kind, currency_code, amount_minor, posting_key_sha256, policy_version,
      source_evidence_sha256, normalized_event_id, normalization_outcome,
      effective_at, recorded_at, reason_code
    ) values ('verified_charge', 'NGN', 0, repeat('a', 64), 1, body_sha,
      event_id, 'matched_attempt', now(), now(), 'probe.zero');
    raise exception 'zero journal amount unexpectedly worked';
  exception when check_violation then null;
  end;
  begin
    insert into private.commerce_ledger_journals(
      kind, currency_code, amount_minor, posting_key_sha256, policy_version,
      source_evidence_sha256, normalized_event_id, normalization_outcome,
      effective_at, recorded_at, reason_code
    ) values ('verified_charge', 'NGN', -1, repeat('b', 64), 1, body_sha,
      event_id, 'matched_attempt', now(), now(), 'probe.negative');
    raise exception 'negative journal amount unexpectedly worked';
  exception when check_violation then null;
  end;
  insert into private.commerce_ledger_journals(
    id, kind, currency_code, amount_minor, posting_key_sha256, policy_version,
    source_evidence_sha256, normalized_event_id, normalization_outcome,
    effective_at, recorded_at, actor_id, reason_code
  ) values (journal_id, 'verified_charge', 'NGN', 100, repeat('1', 64), 1,
    body_sha, event_id, 'matched_attempt', now(), now(), profile_id, 'probe.charge');
  begin
    insert into private.commerce_ledger_journals(
      kind, currency_code, amount_minor, posting_key_sha256, policy_version,
      source_evidence_sha256, normalized_event_id, normalization_outcome,
      reversal_of_journal_id, reversal_amount_minor, reversal_currency_code,
      effective_at, recorded_at, reason_code
    ) values ('verified_charge', 'NGN', 100, repeat('c', 64), 1, body_sha,
      event_id, 'matched_attempt', journal_id, 100, 'NGN', now(), now(),
      'probe.normal-reversal-link');
    raise exception 'normal journal reversal linkage unexpectedly worked';
  exception when check_violation then null;
  end;
  begin
    insert into private.commerce_ledger_journals(
      kind, currency_code, amount_minor, posting_key_sha256, policy_version,
      source_evidence_sha256, effective_at, recorded_at, reason_code
    ) values ('reversal', 'NGN', 100, repeat('d', 64), 1, body_sha,
      now(), now(), 'probe.missing-reversal-link');
    raise exception 'reversal journal without linkage unexpectedly worked';
  exception when check_violation then null;
  end;
  begin
    insert into private.commerce_ledger_journals(
      id, kind, currency_code, amount_minor, posting_key_sha256, policy_version,
      source_evidence_sha256, reversal_of_journal_id, reversal_amount_minor,
      reversal_currency_code, effective_at, recorded_at, reason_code
    ) values (self_reversal_id, 'reversal', 'NGN', 100, repeat('e', 64), 1,
      body_sha, self_reversal_id, 100, 'NGN', now(), now(),
      'probe.self-reversal');
    raise exception 'self-reversing journal unexpectedly worked';
  exception when check_violation then null;
  end;
  begin
    insert into private.commerce_ledger_journals(
      kind, currency_code, amount_minor, posting_key_sha256, policy_version,
      source_evidence_sha256, normalized_event_id, normalization_outcome,
      effective_at, recorded_at, reason_code
    ) values ('verified_charge', 'NGN', 100, repeat('1', 64), 1, body_sha,
      event_id, 'matched_attempt', now(), now(), 'probe.duplicate');
    raise exception 'duplicate posting key unexpectedly worked';
  exception when unique_violation then null;
  end;

  insert into private.commerce_ledger_journals(
    id, kind, currency_code, amount_minor, posting_key_sha256, policy_version,
    source_evidence_sha256, payment_application_id, effective_at, recorded_at,
    reason_code
  ) values (application_journal_id, 'order_payment_application', 'NGN', 100,
    repeat('0', 64), 1, body_sha, application_id, now(), now(),
    'probe.application');

  begin
    insert into private.commerce_ledger_posting_pairs(
      journal_id, journal_kind, pair_index, debit_account_id,
      debit_account_purpose, credit_account_id, credit_account_purpose,
      amount_minor, currency_code
    ) values (journal_id, 'verified_charge', 0, clearing_id,
      'provider_clearing', clearing_id, 'provider_clearing', 100, 'NGN');
    raise exception 'same debit and credit account unexpectedly worked';
  exception when check_violation then null;
  end;
  begin
    insert into private.commerce_ledger_posting_pairs(
      journal_id, journal_kind, pair_index, debit_account_id,
      debit_account_purpose, credit_account_id, credit_account_purpose,
      amount_minor, currency_code
    ) values (journal_id, 'verified_charge', 0, clearing_id,
      'provider_clearing', unapplied_id, 'unapplied_customer_funds', 0, 'NGN');
    raise exception 'nonpositive pair amount unexpectedly worked';
  exception when check_violation then null;
  end;
  begin
    insert into private.commerce_ledger_posting_pairs(
      journal_id, journal_kind, pair_index, debit_account_id,
      debit_account_purpose, credit_account_id, credit_account_purpose,
      amount_minor, currency_code
    ) values (journal_id, 'verified_charge', 0, clearing_id,
      'provider_clearing', unapplied_id, 'unapplied_customer_funds', 100, 'USD');
    raise exception 'cross-currency pair unexpectedly worked';
  exception when foreign_key_violation then null;
  end;
  begin
    insert into private.commerce_ledger_posting_pairs(
      journal_id, journal_kind, pair_index, debit_account_id,
      debit_account_purpose, credit_account_id, credit_account_purpose,
      amount_minor, currency_code
    ) values (journal_id, 'verified_charge', 0, payable_id,
      'order_funds_payable', clearing_id, 'provider_clearing', 100, 'NGN');
    raise exception 'wrong posting template unexpectedly worked';
  exception when check_violation then null;
  end;
  insert into private.commerce_ledger_posting_pairs(
    id, journal_id, journal_kind, pair_index, debit_account_id,
    debit_account_purpose, credit_account_id, credit_account_purpose,
    amount_minor, currency_code
  ) values (pair_id, journal_id, 'verified_charge', 0, clearing_id,
    'provider_clearing', unapplied_id, 'unapplied_customer_funds', 100, 'NGN');
  insert into private.commerce_ledger_posting_pairs(
    journal_id, journal_kind, pair_index, debit_account_id,
    debit_account_purpose, credit_account_id, credit_account_purpose,
    amount_minor, currency_code
  ) values (application_journal_id, 'order_payment_application', 0, unapplied_id,
    'unapplied_customer_funds', payable_id, 'order_funds_payable', 100, 'NGN');

  insert into private.commerce_ledger_journals(
    id, kind, currency_code, amount_minor, posting_key_sha256, policy_version,
    source_evidence_sha256, reversal_of_journal_id, reversal_amount_minor,
    reversal_currency_code, effective_at, recorded_at, reason_code
  ) values (reversal_journal_id, 'reversal', 'NGN', 100, repeat('2', 64), 1,
    body_sha, journal_id, 100, 'NGN', now(), now(), 'probe.reversal');
  begin
    insert into private.commerce_ledger_journals(
      kind, currency_code, amount_minor, posting_key_sha256, policy_version,
      source_evidence_sha256, reversal_of_journal_id, reversal_amount_minor,
      reversal_currency_code, effective_at, recorded_at, reason_code
    ) values ('reversal', 'NGN', 100, repeat('3', 64), 1, body_sha,
      journal_id, 100, 'NGN', now(), now(), 'probe.second-reversal');
    raise exception 'second reversal unexpectedly worked';
  exception when unique_violation then null;
  end;
  begin
    insert into private.commerce_ledger_posting_pairs(
      journal_id, journal_kind, pair_index, debit_account_id,
      debit_account_purpose, credit_account_id, credit_account_purpose,
      amount_minor, currency_code
    ) values (reversal_journal_id, 'reversal', 0, unapplied_id,
      'unapplied_customer_funds', clearing_id, 'provider_clearing', 100, 'NGN');
    raise exception 'unmapped reversal pair unexpectedly worked';
  exception when check_violation then null;
  end;
  begin
    insert into private.commerce_ledger_posting_pairs(
      journal_id, journal_kind, journal_reversal_of_id, pair_index,
      debit_account_id, debit_account_purpose, credit_account_id,
      credit_account_purpose, amount_minor, currency_code, reverses_pair_id
    ) values (reversal_journal_id, 'reversal', journal_id, 0, clearing_id,
      'provider_clearing', unapplied_id, 'unapplied_customer_funds', 100, 'NGN',
      pair_id);
    raise exception 'exact reversal account swap unexpectedly worked';
  exception when foreign_key_violation then null;
  end;
  insert into private.commerce_ledger_posting_pairs(
    id, journal_id, journal_kind, journal_reversal_of_id, pair_index,
    debit_account_id, debit_account_purpose, credit_account_id,
    credit_account_purpose, amount_minor, currency_code, reverses_pair_id
  ) values (reversal_pair_id, reversal_journal_id, 'reversal', journal_id, 0,
    unapplied_id, 'unapplied_customer_funds', clearing_id, 'provider_clearing',
    100, 'NGN', pair_id);
  begin
    insert into private.commerce_ledger_posting_pairs(
      journal_id, journal_kind, journal_reversal_of_id, pair_index,
      debit_account_id, debit_account_purpose, credit_account_id,
      credit_account_purpose, amount_minor, currency_code, reverses_pair_id
    ) values (reversal_journal_id, 'reversal', journal_id, 1, unapplied_id,
      'unapplied_customer_funds', clearing_id, 'provider_clearing', 100, 'NGN',
      pair_id);
    raise exception 'second reversal pair unexpectedly worked';
  exception when unique_violation then null;
  end;

  execute 'alter table private.commerce_ledger_posting_pairs enable trigger commerce_ledger_posting_pairs_dormant_rows';
  execute 'alter table private.commerce_ledger_journals enable trigger commerce_ledger_journals_dormant_rows';
  execute 'alter table private.commerce_ledger_accounts enable trigger commerce_ledger_accounts_dormant_rows';
  insert into typed_ledger_dormant_probe_state values (
    profile_id, market_id, business_id, order_id, payment_state_id, attempt_id,
    application_id, delivery_id, event_id, clearing_id, unapplied_id, payable_id,
    journal_id, pair_id, reversal_journal_id, reversal_pair_id
  );
end;
$$;

do $$
declare
  state typed_ledger_dormant_probe_state%rowtype;
  expected_message constant text := 'commerce ledger is dormant';
begin
  select * into strict state from typed_ledger_dormant_probe_state;
  begin
    insert into private.commerce_ledger_journals(
      kind, currency_code, amount_minor, posting_key_sha256, policy_version,
      source_evidence_sha256, normalized_event_id, normalization_outcome,
      effective_at, recorded_at, reason_code
    ) values ('verified_charge', 'NGN', 100, repeat('f', 64), 1,
      repeat('0', 64), state.event_id, 'matched_attempt', now(), now(),
      'probe.dormant-journal');
    raise exception 'dormant journal insert unexpectedly worked';
  exception when others then if sqlstate <> '55000' or sqlerrm <> expected_message then raise; end if; end;
  begin
    insert into private.commerce_ledger_posting_pairs(
      journal_id, journal_kind, pair_index, debit_account_id,
      debit_account_purpose, credit_account_id, credit_account_purpose,
      amount_minor, currency_code
    ) values (state.journal_id, 'verified_charge', 9, state.clearing_id,
      'provider_clearing', state.unapplied_id, 'unapplied_customer_funds',
      100, 'NGN');
    raise exception 'dormant posting pair insert unexpectedly worked';
  exception when others then if sqlstate <> '55000' or sqlerrm <> expected_message then raise; end if; end;
  begin update private.commerce_ledger_accounts set currency_code = currency_code where id = state.clearing_id;
    raise exception 'dormant account update unexpectedly worked';
  exception when others then if sqlstate <> '55000' or sqlerrm <> expected_message then raise; end if; end;
  begin delete from private.commerce_ledger_journals where id = state.journal_id;
    raise exception 'dormant journal delete unexpectedly worked';
  exception when others then if sqlstate <> '55000' or sqlerrm <> expected_message then raise; end if; end;
  begin update private.commerce_ledger_posting_pairs set pair_index = pair_index where id = state.pair_id;
    raise exception 'dormant posting pair update unexpectedly worked';
  exception when others then if sqlstate <> '55000' or sqlerrm <> expected_message then raise; end if; end;
  begin truncate private.commerce_ledger_posting_pairs;
    raise exception 'dormant posting pair truncate unexpectedly worked';
  exception when others then if sqlstate <> '55000' or sqlerrm <> expected_message then raise; end if; end;
  begin truncate private.commerce_ledger_journals;
    raise exception 'dormant journal truncate unexpectedly worked';
  exception when others then if sqlstate not in ('55000', '0A000') then raise; end if; end;
  begin truncate private.commerce_ledger_accounts;
    raise exception 'dormant account truncate unexpectedly worked';
  exception when others then if sqlstate not in ('55000', '0A000') then raise; end if; end;
end;
$$;

-- Disable only rollback fixtures, clean every layer in dependency order, then
-- assert all sixteen protected tables are empty before ROLLBACK.
do $$
declare state typed_ledger_dormant_probe_state%rowtype;
begin
  select * into strict state from typed_ledger_dormant_probe_state;
  execute 'alter table private.commerce_ledger_posting_pairs disable trigger commerce_ledger_posting_pairs_dormant_rows';
  execute 'alter table private.commerce_ledger_journals disable trigger commerce_ledger_journals_dormant_rows';
  execute 'alter table private.commerce_ledger_accounts disable trigger commerce_ledger_accounts_dormant_rows';
  delete from private.commerce_ledger_posting_pairs;
  delete from private.commerce_ledger_journals;
  delete from private.commerce_ledger_accounts;
  execute 'alter table private.commerce_ledger_accounts enable trigger commerce_ledger_accounts_dormant_rows';
  execute 'alter table private.commerce_ledger_journals enable trigger commerce_ledger_journals_dormant_rows';
  execute 'alter table private.commerce_ledger_posting_pairs enable trigger commerce_ledger_posting_pairs_dormant_rows';

  execute 'alter table private.provider_normalized_events disable trigger provider_normalized_events_dormant_rows';
  execute 'alter table private.provider_evidence_deliveries disable trigger provider_evidence_deliveries_dormant_rows';
  delete from private.provider_normalized_events;
  delete from private.provider_evidence_deliveries;
  execute 'alter table private.provider_evidence_deliveries enable trigger provider_evidence_deliveries_dormant_rows';
  execute 'alter table private.provider_normalized_events enable trigger provider_normalized_events_dormant_rows';

  execute 'alter table private.payment_applications disable trigger payment_applications_dormant_rows';
  execute 'alter table private.payment_attempts disable trigger payment_attempts_dormant_rows';
  execute 'alter table private.order_payment_states disable trigger order_payment_states_dormant_rows';
  delete from private.payment_applications;
  delete from private.payment_attempts;
  delete from private.order_payment_states;
  execute 'alter table private.order_payment_states enable trigger order_payment_states_dormant_rows';
  execute 'alter table private.payment_attempts enable trigger payment_attempts_dormant_rows';
  execute 'alter table private.payment_applications enable trigger payment_applications_dormant_rows';

  delete from public.orders where id = state.order_id;
  delete from public.businesses where id = state.business_id;
  delete from public.markets where id = state.market_id;
  delete from auth.users where id = state.profile_id;
  if exists (select 1 from auth.users where id = state.profile_id)
    or exists (select 1 from public.profiles where id = state.profile_id)
    or exists (select 1 from public.markets where id = state.market_id)
    or exists (select 1 from public.businesses where id = state.business_id)
    or exists (select 1 from public.orders where id = state.order_id)
  then raise exception 'typed ledger probe left application fixture residue'; end if;
  if exists (select 1 from public.payments) or exists (select 1 from public.payment_events)
    or exists (select 1 from public.webhook_inbox) or exists (select 1 from public.ledger_accounts)
    or exists (select 1 from public.ledger_journals) or exists (select 1 from public.ledger_entries)
    or exists (select 1 from public.referral_commissions) or exists (select 1 from private.order_payment_states)
    or exists (select 1 from private.payment_attempts) or exists (select 1 from private.payment_applications)
    or exists (select 1 from private.provider_evidence_deliveries) or exists (select 1 from private.provider_evidence_raw_payloads)
    or exists (select 1 from private.provider_normalized_events) or exists (select 1 from private.commerce_ledger_accounts)
    or exists (select 1 from private.commerce_ledger_journals) or exists (select 1 from private.commerce_ledger_posting_pairs)
  then raise exception 'typed ledger probe left residue'; end if;
end;
$$;

rollback;

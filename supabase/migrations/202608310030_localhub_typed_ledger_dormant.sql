-- Step 23 Slice B3 adds dormant typed commerce-ledger structure only.
-- It does not replace legacy public ledger tables or activate any money flow.

lock table
  public.payments,
  public.payment_events,
  public.webhook_inbox,
  public.ledger_accounts,
  public.ledger_journals,
  public.ledger_entries,
  public.referral_commissions,
  private.order_payment_states,
  private.payment_attempts,
  private.payment_applications,
  private.provider_evidence_deliveries,
  private.provider_evidence_raw_payloads,
  private.provider_normalized_events
in share row exclusive mode;

do $$
declare
  table_name text;
  role_name text;
  privilege_name text;
  protected_function record;
  expected record;
  actual_labels text[];
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
  then
    raise exception 'commerce ledger migration requires quarantine; reconciliation is required'
      using errcode = '55000';
  end if;

  if pg_catalog.to_regclass('private.commerce_ledger_accounts') is not null
    or pg_catalog.to_regclass('private.commerce_ledger_journals') is not null
    or pg_catalog.to_regclass('private.commerce_ledger_posting_pairs') is not null
    or pg_catalog.to_regtype('private.commerce_account_class_code') is not null
    or pg_catalog.to_regtype('private.commerce_account_owner_code') is not null
    or pg_catalog.to_regtype('private.commerce_account_scope_code') is not null
    or pg_catalog.to_regtype('private.commerce_account_purpose_code') is not null
    or pg_catalog.to_regtype('private.commerce_journal_kind_code') is not null
    or pg_catalog.to_regprocedure(
      'private.prevent_dormant_commerce_ledger_mutation()'
    ) is not null
    or exists (
      select 1 from pg_catalog.pg_constraint c
      where c.conname in (
        'provider_normalized_events_commerce_identity_unique',
        'payment_applications_commerce_identity_unique'
      )
    )
  then
    raise exception 'commerce ledger migration requires quarantine; partial objects exist'
      using errcode = '55000';
  end if;

  foreach table_name in array array[
    'public.payments', 'public.payment_events', 'public.webhook_inbox',
    'public.ledger_accounts', 'public.ledger_journals',
    'public.ledger_entries', 'public.referral_commissions',
    'private.order_payment_states', 'private.payment_attempts',
    'private.payment_applications', 'private.provider_evidence_deliveries',
    'private.provider_evidence_raw_payloads',
    'private.provider_normalized_events'
  ] loop
    foreach role_name in array array['anon', 'authenticated', 'service_role'] loop
      foreach privilege_name in array array[
        'select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger'
      ] loop
        if pg_catalog.has_table_privilege(role_name, table_name, privilege_name) then
          raise exception 'commerce ledger migration requires quarantine; % retains % on %',
            role_name, privilege_name, table_name using errcode = '55000';
        end if;
      end loop;
      foreach privilege_name in array array['select', 'insert', 'update', 'references'] loop
        if pg_catalog.has_any_column_privilege(role_name, table_name, privilege_name) then
          raise exception 'commerce ledger migration requires quarantine; % retains column % on %',
            role_name, privilege_name, table_name using errcode = '55000';
        end if;
      end loop;
    end loop;
  end loop;

  foreach table_name in array array[
    'private.order_payment_states', 'private.payment_attempts',
    'private.payment_applications', 'private.provider_evidence_deliveries',
    'private.provider_evidence_raw_payloads',
    'private.provider_normalized_events'
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
      raise exception 'commerce ledger migration requires quarantine; predecessor RLS changed on %',
        table_name using errcode = '55000';
    end if;
  end loop;

  for protected_function in
    select p.oid, p.proname
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'post_journal', 'reverse_posted_journal', 'journal_matches_lines',
        'reversal_matches_original'
      )
  loop
    foreach role_name in array array['anon', 'authenticated', 'service_role'] loop
      if pg_catalog.has_function_privilege(role_name, protected_function.oid, 'execute') then
        raise exception 'commerce ledger migration requires quarantine; % retains execute on %',
          role_name, protected_function.proname using errcode = '55000';
      end if;
    end loop;
  end loop;

  if not exists (
    select 1 from pg_catalog.pg_constraint c
    where c.conrelid = 'public.payment_events'::pg_catalog.regclass
      and c.conname = 'payment_events_payment_id_fkey'
      and c.confrelid = 'public.payments'::pg_catalog.regclass
      and c.contype = 'f' and c.confdeltype = 'r' and c.convalidated
      and (
        select pg_catalog.array_agg(a.attname::text order by k.ordinality)
        from pg_catalog.unnest(c.conkey) with ordinality k(attnum, ordinality)
        join pg_catalog.pg_attribute a
          on a.attrelid = c.conrelid and a.attnum = k.attnum
      ) = array['payment_id']::text[]
      and (
        select pg_catalog.array_agg(a.attname::text order by k.ordinality)
        from pg_catalog.unnest(c.confkey) with ordinality k(attnum, ordinality)
        join pg_catalog.pg_attribute a
          on a.attrelid = c.confrelid and a.attnum = k.attnum
      ) = array['id']::text[]
  ) or not exists (
    select 1 from pg_catalog.pg_trigger t
    where t.tgrelid = 'public.payment_events'::pg_catalog.regclass
      and t.tgname = 'payment_events_append_only' and t.tgenabled = 'O'
      and not t.tgisinternal
      and t.tgtype = 27
      and t.tgfoid =
        'private.prevent_payment_event_mutation()'::pg_catalog.regprocedure
  ) then
    raise exception 'commerce ledger migration requires quarantine; legacy finance guard changed'
      using errcode = '55000';
  end if;

  if (
    select count(*)
    from pg_catalog.pg_class c
    where c.oid in (
      'public.payments'::pg_catalog.regclass,
      'public.payment_events'::pg_catalog.regclass,
      'public.webhook_inbox'::pg_catalog.regclass,
      'public.ledger_accounts'::pg_catalog.regclass,
      'public.ledger_journals'::pg_catalog.regclass,
      'public.ledger_entries'::pg_catalog.regclass,
      'public.referral_commissions'::pg_catalog.regclass
    ) and c.relrowsecurity
  ) <> 7 or exists (
    select 1 from pg_catalog.pg_policies p
    where p.schemaname = 'public'
      and p.tablename in (
        'payments', 'payment_events', 'webhook_inbox', 'ledger_accounts',
        'ledger_journals', 'ledger_entries', 'referral_commissions'
      )
  ) then
    raise exception 'commerce ledger migration requires quarantine; finance RLS changed'
      using errcode = '55000';
  end if;

  for expected in
    select * from (values
      ('private.order_payment_state_code'::pg_catalog.regtype,
       array['unpaid', 'payment_pending', 'paid', 'partially_refunded', 'refunded']::text[]),
      ('private.payment_attempt_state_code'::pg_catalog.regtype,
       array['created', 'initialization_pending', 'awaiting_customer', 'verification_pending', 'succeeded', 'init_failed', 'init_unknown', 'failed', 'cancelled', 'expired', 'manual_review']::text[]),
      ('private.payment_environment_code'::pg_catalog.regtype,
       array['test', 'live']::text[]),
      ('private.payment_application_kind'::pg_catalog.regtype,
       array['primary_order_payment', 'unapplied_excess']::text[]),
      ('private.provider_normalization_outcome_code'::pg_catalog.regtype,
       array['matched_attempt', 'quarantined_unknown_reference', 'quarantined_missing_reference', 'quarantined_malformed_reference', 'quarantined_unsupported_event']::text[])
    ) as expected_contract(type_oid, labels)
  loop
    select pg_catalog.array_agg(e.enumlabel order by e.enumsortorder)
    into actual_labels
    from pg_catalog.pg_enum e
    where e.enumtypid = expected.type_oid;
    if actual_labels is distinct from expected.labels then
      raise exception 'commerce ledger migration requires quarantine; predecessor enum changed'
        using errcode = '55000';
    end if;
  end loop;

  for expected in
    select * from (values
      (
        'order_payment_states_order_identity_fkey',
        'private.order_payment_states'::pg_catalog.regclass,
        'public.orders'::pg_catalog.regclass,
        array['order_id', 'payer_id', 'business_id', 'market_id',
          'expected_amount_minor', 'currency_code']::text[],
        array['id', 'buyer_id', 'business_id', 'market_id',
          'total_minor', 'currency_code']::text[]
      ),
      (
        'payment_attempts_state_snapshot_fkey',
        'private.payment_attempts'::pg_catalog.regclass,
        'private.order_payment_states'::pg_catalog.regclass,
        array['order_payment_state_id', 'expected_amount_minor', 'currency_code',
          'order_snapshot_version', 'order_snapshot_sha256']::text[],
        array['id', 'expected_amount_minor', 'currency_code',
          'order_snapshot_version', 'order_snapshot_sha256']::text[]
      ),
      (
        'payment_applications_succeeded_attempt_fkey',
        'private.payment_applications'::pg_catalog.regclass,
        'private.payment_attempts'::pg_catalog.regclass,
        array['payment_attempt_id', 'order_payment_state_id', 'attempt_status',
          'expected_amount_minor', 'currency_code', 'order_snapshot_version',
          'order_snapshot_sha256']::text[],
        array['id', 'order_payment_state_id', 'status', 'expected_amount_minor',
          'currency_code', 'order_snapshot_version',
          'order_snapshot_sha256']::text[]
      ),
      (
        'provider_evidence_raw_payloads_delivery_fkey',
        'private.provider_evidence_raw_payloads'::pg_catalog.regclass,
        'private.provider_evidence_deliveries'::pg_catalog.regclass,
        array['delivery_id', 'digest_version', 'raw_body_sha256',
          'raw_body_bytes']::text[],
        array['id', 'digest_version', 'raw_body_sha256',
          'raw_body_bytes']::text[]
      ),
      (
        'provider_normalized_events_delivery_fkey',
        'private.provider_normalized_events'::pg_catalog.regclass,
        'private.provider_evidence_deliveries'::pg_catalog.regclass,
        array['delivery_id', 'provider_code', 'provider_environment']::text[],
        array['id', 'provider_code', 'provider_environment']::text[]
      ),
      (
        'provider_normalized_events_attempt_fkey',
        'private.provider_normalized_events'::pg_catalog.regclass,
        'private.payment_attempts'::pg_catalog.regclass,
        array['payment_attempt_id', 'provider_code', 'provider_environment',
          'provider_reference']::text[],
        array['id', 'provider_code', 'provider_environment',
          'provider_reference']::text[]
      )
    ) as expected_contract(
      constraint_name, child_table, parent_table, child_columns, parent_columns
    )
  loop
    if not exists (
      select 1
      from pg_catalog.pg_constraint c
      where c.conname = expected.constraint_name
        and c.conrelid = expected.child_table
        and c.confrelid = expected.parent_table
        and c.contype = 'f'
        and c.confdeltype = 'r'
        and c.convalidated
        and (
          select pg_catalog.array_agg(a.attname::text order by k.ordinality)
          from pg_catalog.unnest(c.conkey) with ordinality k(attnum, ordinality)
          join pg_catalog.pg_attribute a
            on a.attrelid = c.conrelid and a.attnum = k.attnum
        ) = expected.child_columns
        and (
          select pg_catalog.array_agg(a.attname::text order by k.ordinality)
          from pg_catalog.unnest(c.confkey) with ordinality k(attnum, ordinality)
          join pg_catalog.pg_attribute a
            on a.attrelid = c.confrelid and a.attnum = k.attnum
        ) = expected.parent_columns
    ) then
      raise exception
        'commerce ledger migration requires quarantine; predecessor FK % changed',
        expected.constraint_name using errcode = '55000';
    end if;
  end loop;

  if (
    select count(*) from pg_catalog.pg_trigger t
    where t.tgrelid in (
      'private.order_payment_states'::pg_catalog.regclass,
      'private.payment_attempts'::pg_catalog.regclass,
      'private.payment_applications'::pg_catalog.regclass
    ) and not t.tgisinternal and t.tgenabled = 'O'
      and t.tgfoid =
        'private.prevent_dormant_payment_domain_mutation()'::pg_catalog.regprocedure
  ) <> 6 or (
    select count(*) from pg_catalog.pg_trigger t
    where t.tgrelid in (
      'private.provider_evidence_deliveries'::pg_catalog.regclass,
      'private.provider_evidence_raw_payloads'::pg_catalog.regclass,
      'private.provider_normalized_events'::pg_catalog.regclass
    ) and not t.tgisinternal and t.tgenabled = 'O'
      and t.tgfoid =
        'private.prevent_dormant_provider_evidence_mutation()'::pg_catalog.regprocedure
  ) <> 6 or exists (
    select 1
    from (values
      ('private.order_payment_states'::pg_catalog.regclass, 'order_payment_states_dormant_rows', 'private.prevent_dormant_payment_domain_mutation()'::pg_catalog.regprocedure, 31::int2),
      ('private.order_payment_states'::pg_catalog.regclass, 'order_payment_states_dormant_truncate', 'private.prevent_dormant_payment_domain_mutation()'::pg_catalog.regprocedure, 34::int2),
      ('private.payment_attempts'::pg_catalog.regclass, 'payment_attempts_dormant_rows', 'private.prevent_dormant_payment_domain_mutation()'::pg_catalog.regprocedure, 31::int2),
      ('private.payment_attempts'::pg_catalog.regclass, 'payment_attempts_dormant_truncate', 'private.prevent_dormant_payment_domain_mutation()'::pg_catalog.regprocedure, 34::int2),
      ('private.payment_applications'::pg_catalog.regclass, 'payment_applications_dormant_rows', 'private.prevent_dormant_payment_domain_mutation()'::pg_catalog.regprocedure, 31::int2),
      ('private.payment_applications'::pg_catalog.regclass, 'payment_applications_dormant_truncate', 'private.prevent_dormant_payment_domain_mutation()'::pg_catalog.regprocedure, 34::int2),
      ('private.provider_evidence_deliveries'::pg_catalog.regclass, 'provider_evidence_deliveries_dormant_rows', 'private.prevent_dormant_provider_evidence_mutation()'::pg_catalog.regprocedure, 31::int2),
      ('private.provider_evidence_deliveries'::pg_catalog.regclass, 'provider_evidence_deliveries_dormant_truncate', 'private.prevent_dormant_provider_evidence_mutation()'::pg_catalog.regprocedure, 34::int2),
      ('private.provider_evidence_raw_payloads'::pg_catalog.regclass, 'provider_evidence_raw_payloads_dormant_rows', 'private.prevent_dormant_provider_evidence_mutation()'::pg_catalog.regprocedure, 31::int2),
      ('private.provider_evidence_raw_payloads'::pg_catalog.regclass, 'provider_evidence_raw_payloads_dormant_truncate', 'private.prevent_dormant_provider_evidence_mutation()'::pg_catalog.regprocedure, 34::int2),
      ('private.provider_normalized_events'::pg_catalog.regclass, 'provider_normalized_events_dormant_rows', 'private.prevent_dormant_provider_evidence_mutation()'::pg_catalog.regprocedure, 31::int2),
      ('private.provider_normalized_events'::pg_catalog.regclass, 'provider_normalized_events_dormant_truncate', 'private.prevent_dormant_provider_evidence_mutation()'::pg_catalog.regprocedure, 34::int2)
    ) as wanted(relid, trigger_name, function_oid, trigger_type)
    left join pg_catalog.pg_trigger t
      on t.tgrelid = wanted.relid and t.tgname = wanted.trigger_name
      and t.tgfoid = wanted.function_oid and t.tgtype = wanted.trigger_type
      and t.tgenabled = 'O' and not t.tgisinternal
    where t.oid is null
  ) then
    raise exception 'commerce ledger migration requires quarantine; dormant predecessor guard changed'
      using errcode = '55000';
  end if;

  foreach role_name in array array['anon', 'authenticated', 'service_role'] loop
    if pg_catalog.has_function_privilege(
      role_name, 'private.prevent_dormant_payment_domain_mutation()', 'execute'
    ) or pg_catalog.has_function_privilege(
      role_name, 'private.prevent_dormant_provider_evidence_mutation()', 'execute'
    ) then
      raise exception 'commerce ledger migration requires quarantine; % can bypass predecessor dormancy',
        role_name using errcode = '55000';
    end if;
  end loop;
end;
$$;

create type private.commerce_account_class_code as enum ('asset', 'liability');
create type private.commerce_account_owner_code as enum ('localhub', 'business');
create type private.commerce_account_scope_code as enum (
  'platform', 'provider_environment', 'business'
);
create type private.commerce_account_purpose_code as enum (
  'provider_clearing', 'unapplied_customer_funds', 'order_funds_payable'
);
create type private.commerce_journal_kind_code as enum (
  'verified_charge', 'order_payment_application', 'reversal'
);

revoke all on type private.commerce_account_class_code
  from public, anon, authenticated, service_role;
revoke all on type private.commerce_account_owner_code
  from public, anon, authenticated, service_role;
revoke all on type private.commerce_account_scope_code
  from public, anon, authenticated, service_role;
revoke all on type private.commerce_account_purpose_code
  from public, anon, authenticated, service_role;
revoke all on type private.commerce_journal_kind_code
  from public, anon, authenticated, service_role;

alter table private.provider_normalized_events
  add constraint provider_normalized_events_commerce_identity_unique unique (
    id, normalization_outcome, observed_amount_minor, observed_currency_code
  );
alter table private.payment_applications
  add constraint payment_applications_commerce_identity_unique unique (
    id, expected_amount_minor, currency_code
  );

create table private.commerce_ledger_accounts (
  id uuid primary key default extensions.gen_random_uuid(),
  account_class private.commerce_account_class_code not null,
  purpose private.commerce_account_purpose_code not null,
  owner_type private.commerce_account_owner_code not null,
  owner_id uuid references public.businesses(id) on delete restrict,
  scope private.commerce_account_scope_code not null,
  provider_code text check (provider_code is null or provider_code ~ '^[a-z][a-z0-9_-]{1,31}$'),
  payment_environment private.payment_environment_code,
  currency_code char(3) not null check (currency_code ~ '^[A-Z]{3}$'),
  identity_version smallint not null default 1 check (identity_version = 1),
  created_at timestamptz not null default now(),
  constraint commerce_ledger_accounts_identity_unique unique nulls not distinct (
    purpose, owner_type, owner_id, scope, provider_code, payment_environment,
    currency_code, identity_version
  ),
  constraint commerce_ledger_accounts_pair_identity_unique unique (
    id, currency_code, purpose, owner_type, owner_id
  ),
  constraint commerce_ledger_accounts_purpose_identity_unique unique (
    id, currency_code, purpose
  ),
  constraint commerce_ledger_accounts_currency_identity_unique unique (id, currency_code),
  constraint commerce_ledger_accounts_shape check (
    (purpose = 'provider_clearing' and account_class = 'asset'
      and owner_type = 'localhub' and owner_id is null
      and scope = 'provider_environment' and provider_code is not null
      and payment_environment is not null)
    or (purpose = 'unapplied_customer_funds' and account_class = 'liability'
      and owner_type = 'localhub' and owner_id is null and scope = 'platform'
      and provider_code is null and payment_environment is null)
    or (purpose = 'order_funds_payable' and account_class = 'liability'
      and owner_type = 'business' and owner_id is not null and scope = 'business'
      and provider_code is null and payment_environment is null)
  )
);

create index commerce_ledger_accounts_owner_fkey_idx
  on private.commerce_ledger_accounts(owner_id);

create table private.commerce_ledger_journals (
  id uuid primary key default extensions.gen_random_uuid(),
  kind private.commerce_journal_kind_code not null,
  currency_code char(3) not null check (currency_code ~ '^[A-Z]{3}$'),
  amount_minor bigint not null check (
    amount_minor > 0 and amount_minor <= 9007199254740991
  ),
  posting_key_version smallint not null default 1 check (posting_key_version = 1),
  posting_key_sha256 text not null check (posting_key_sha256 ~ '^[0-9a-f]{64}$'),
  policy_version smallint not null check (policy_version > 0),
  source_evidence_sha256 text not null check (source_evidence_sha256 ~ '^[0-9a-f]{64}$'),
  normalized_event_id uuid,
  normalization_outcome private.provider_normalization_outcome_code,
  payment_application_id uuid,
  effective_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  actor_id uuid references public.profiles(id) on delete restrict,
  reason_code text not null check (reason_code ~ '^[a-z][a-z0-9_.-]{1,63}$'),
  reversal_of_journal_id uuid,
  reversal_amount_minor bigint,
  reversal_currency_code char(3),
  created_at timestamptz not null default now(),
  constraint commerce_ledger_journals_posting_key_unique unique (
    posting_key_version, posting_key_sha256
  ),
  constraint commerce_ledger_journals_source_identity_unique unique (
    id, amount_minor, currency_code
  ),
  constraint commerce_ledger_journals_pair_identity_unique unique (
    id, reversal_of_journal_id, amount_minor, currency_code
  ),
  constraint commerce_ledger_journals_template_identity_unique unique (
    id, kind, amount_minor, currency_code
  ),
  constraint commerce_ledger_journals_pair_relationship_unique unique (
    id, kind, reversal_of_journal_id
  ),
  constraint commerce_ledger_journals_one_direct_reversal_unique unique (
    reversal_of_journal_id
  ),
  constraint commerce_ledger_journals_event_fkey foreign key (
    normalized_event_id, normalization_outcome, amount_minor, currency_code
  ) references private.provider_normalized_events(
    id, normalization_outcome, observed_amount_minor, observed_currency_code
  ) on delete restrict,
  constraint commerce_ledger_journals_application_fkey foreign key (
    payment_application_id, amount_minor, currency_code
  ) references private.payment_applications(
    id, expected_amount_minor, currency_code
  ) on delete restrict,
  constraint commerce_ledger_journals_reversal_fkey foreign key (
    reversal_of_journal_id, reversal_amount_minor, reversal_currency_code
  ) references private.commerce_ledger_journals(id, amount_minor, currency_code)
    match full on delete restrict,
  constraint commerce_ledger_journals_timestamps check (recorded_at >= effective_at),
  constraint commerce_ledger_journals_reversal_money_pair check (
    (reversal_of_journal_id is null) = (reversal_amount_minor is null)
    and (reversal_of_journal_id is null) = (reversal_currency_code is null)
  ),
  constraint commerce_ledger_journals_reversal_envelope check (
    reversal_of_journal_id is null
    or (amount_minor = reversal_amount_minor and currency_code = reversal_currency_code)
  ),
  constraint commerce_ledger_journals_not_self_reversing check (
    reversal_of_journal_id is null or reversal_of_journal_id <> id
  ),
  constraint commerce_ledger_journals_source_shape check (
    (kind = 'verified_charge' and normalized_event_id is not null
      and normalization_outcome is not null
      and normalization_outcome = 'matched_attempt'
      and payment_application_id is null
      and reversal_of_journal_id is null)
    or (kind = 'order_payment_application' and normalized_event_id is null
      and normalization_outcome is null and payment_application_id is not null
      and reversal_of_journal_id is null)
    or (kind = 'reversal' and normalized_event_id is null
      and normalization_outcome is null and payment_application_id is null
      and reversal_of_journal_id is not null)
  )
);

create index commerce_ledger_journals_event_fkey_idx
  on private.commerce_ledger_journals(
    normalized_event_id, normalization_outcome, amount_minor, currency_code
  );
create index commerce_ledger_journals_application_fkey_idx
  on private.commerce_ledger_journals(
    payment_application_id, amount_minor, currency_code
  );
create index commerce_ledger_journals_actor_fkey_idx
  on private.commerce_ledger_journals(actor_id);
create index commerce_ledger_journals_reversal_fkey_idx
  on private.commerce_ledger_journals(
    reversal_of_journal_id, reversal_amount_minor, reversal_currency_code
  );

create table private.commerce_ledger_posting_pairs (
  id uuid primary key default extensions.gen_random_uuid(),
  journal_id uuid not null,
  journal_kind private.commerce_journal_kind_code not null,
  journal_reversal_of_id uuid,
  pair_index smallint not null check (pair_index >= 0),
  debit_account_id uuid not null,
  debit_account_purpose private.commerce_account_purpose_code not null,
  credit_account_id uuid not null,
  credit_account_purpose private.commerce_account_purpose_code not null,
  amount_minor bigint not null check (
    amount_minor > 0 and amount_minor <= 9007199254740991
  ),
  currency_code char(3) not null check (currency_code ~ '^[A-Z]{3}$'),
  reverses_pair_id uuid,
  created_at timestamptz not null default now(),
  constraint commerce_ledger_posting_pairs_journal_index_unique unique (journal_id, pair_index),
  constraint commerce_ledger_posting_pairs_reverses_pair_unique unique (reverses_pair_id),
  constraint commerce_ledger_posting_pairs_original_identity_unique unique (
    id, journal_id, debit_account_id, credit_account_id, amount_minor, currency_code
  ),
  constraint commerce_ledger_posting_pairs_journal_fkey foreign key (
    journal_id, journal_kind, amount_minor, currency_code
  ) references private.commerce_ledger_journals(
    id, kind, amount_minor, currency_code
  )
    on delete restrict,
  constraint commerce_ledger_posting_pairs_journal_relationship_fkey foreign key (
    journal_id, journal_kind, journal_reversal_of_id
  ) references private.commerce_ledger_journals(
    id, kind, reversal_of_journal_id
  )
    on delete restrict,
  constraint commerce_ledger_posting_pairs_debit_account_fkey foreign key (
    debit_account_id, currency_code, debit_account_purpose
  ) references private.commerce_ledger_accounts(
    id, currency_code, purpose
  ) on delete restrict,
  constraint commerce_ledger_posting_pairs_credit_account_fkey foreign key (
    credit_account_id, currency_code, credit_account_purpose
  ) references private.commerce_ledger_accounts(
    id, currency_code, purpose
  ) on delete restrict,
  constraint commerce_ledger_posting_pairs_reversal_fkey foreign key (
    reverses_pair_id, journal_reversal_of_id, credit_account_id, debit_account_id,
    amount_minor, currency_code
  ) references private.commerce_ledger_posting_pairs(
    id, journal_id, debit_account_id, credit_account_id, amount_minor, currency_code
  ) on delete restrict,
  constraint commerce_ledger_posting_pairs_accounts_distinct check (
    debit_account_id <> credit_account_id
  ),
  constraint commerce_ledger_posting_pairs_reversal_shape check (
    (journal_kind <> 'reversal' and journal_reversal_of_id is null
      and reverses_pair_id is null)
    or (journal_kind = 'reversal' and journal_reversal_of_id is not null
      and reverses_pair_id is not null)
  ),
  constraint commerce_ledger_posting_pairs_template check (
    (journal_kind = 'verified_charge'
      and debit_account_purpose = 'provider_clearing'
      and credit_account_purpose = 'unapplied_customer_funds')
    or (journal_kind = 'order_payment_application'
      and debit_account_purpose = 'unapplied_customer_funds'
      and credit_account_purpose = 'order_funds_payable')
    or journal_kind = 'reversal'
  )
);

create index commerce_ledger_posting_pairs_journal_fkey_idx
  on private.commerce_ledger_posting_pairs(
    journal_id, journal_kind, amount_minor, currency_code
  );
create index commerce_ledger_posting_pairs_journal_relationship_fkey_idx
  on private.commerce_ledger_posting_pairs(
    journal_id, journal_kind, journal_reversal_of_id
  );
create index commerce_ledger_posting_pairs_debit_account_fkey_idx
  on private.commerce_ledger_posting_pairs(
    debit_account_id, currency_code, debit_account_purpose
  );
create index commerce_ledger_posting_pairs_credit_account_fkey_idx
  on private.commerce_ledger_posting_pairs(
    credit_account_id, currency_code, credit_account_purpose
  );
create index commerce_ledger_posting_pairs_reversal_fkey_idx
  on private.commerce_ledger_posting_pairs(
    reverses_pair_id, journal_reversal_of_id, credit_account_id, debit_account_id,
    amount_minor, currency_code
  );

alter table private.commerce_ledger_accounts enable row level security;
alter table private.commerce_ledger_accounts force row level security;
alter table private.commerce_ledger_journals enable row level security;
alter table private.commerce_ledger_journals force row level security;
alter table private.commerce_ledger_posting_pairs enable row level security;
alter table private.commerce_ledger_posting_pairs force row level security;

revoke all on table private.commerce_ledger_accounts
  from public, anon, authenticated, service_role;
revoke all on table private.commerce_ledger_journals
  from public, anon, authenticated, service_role;
revoke all on table private.commerce_ledger_posting_pairs
  from public, anon, authenticated, service_role;

create or replace function private.prevent_dormant_commerce_ledger_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'commerce ledger is dormant' using errcode = '55000';
end;
$$;

revoke all on function private.prevent_dormant_commerce_ledger_mutation()
  from public, anon, authenticated, service_role;

create trigger commerce_ledger_accounts_dormant_rows
before insert or update or delete on private.commerce_ledger_accounts
for each row execute function private.prevent_dormant_commerce_ledger_mutation();
create trigger commerce_ledger_accounts_dormant_truncate
before truncate on private.commerce_ledger_accounts
for each statement execute function private.prevent_dormant_commerce_ledger_mutation();

create trigger commerce_ledger_journals_dormant_rows
before insert or update or delete on private.commerce_ledger_journals
for each row execute function private.prevent_dormant_commerce_ledger_mutation();
create trigger commerce_ledger_journals_dormant_truncate
before truncate on private.commerce_ledger_journals
for each statement execute function private.prevent_dormant_commerce_ledger_mutation();

create trigger commerce_ledger_posting_pairs_dormant_rows
before insert or update or delete on private.commerce_ledger_posting_pairs
for each row execute function private.prevent_dormant_commerce_ledger_mutation();
create trigger commerce_ledger_posting_pairs_dormant_truncate
before truncate on private.commerce_ledger_posting_pairs
for each statement execute function private.prevent_dormant_commerce_ledger_mutation();

comment on table private.commerce_ledger_accounts is
  'Dormant typed commerce account taxonomy. No writer or activation path exists.';
comment on table private.commerce_ledger_journals is
  'Dormant typed commerce journal identity. No posting command is active.';
comment on table private.commerce_ledger_posting_pairs is
  'Dormant intrinsically balanced debit-credit pair structure. No writer is active.';

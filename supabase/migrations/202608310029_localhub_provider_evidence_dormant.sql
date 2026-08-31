-- Step 23 Slice B2 adds provider-neutral signed-delivery evidence structure.
-- Every new table remains empty, inaccessible and mutation-blocked. This
-- migration creates no provider route, callable ingestion command or payment.

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
  private.payment_applications
in share row exclusive mode;

do $$
declare
  table_name text;
  role_name text;
  privilege_name text;
  type_name text;
  protected_function record;
  payment_blocker pg_catalog.pg_proc%rowtype;
  payment_blocker_owner text;
  payment_event_blocker pg_catalog.pg_proc%rowtype;
  payment_event_blocker_owner text;
  enum_labels text[];
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
  then
    raise exception
      'provider evidence migration requires quarantine; reconciliation is required'
      using errcode = '55000';
  end if;

  if pg_catalog.to_regclass('private.provider_evidence_deliveries') is not null
    or pg_catalog.to_regclass('private.provider_evidence_raw_payloads') is not null
    or pg_catalog.to_regclass('private.provider_normalized_events') is not null
    or pg_catalog.to_regtype(
      'private.provider_normalization_outcome_code'
    ) is not null
    or pg_catalog.to_regprocedure(
      'private.prevent_dormant_provider_evidence_mutation()'
    ) is not null
    or exists (
      select 1
      from pg_catalog.pg_constraint constraint_record
      where constraint_record.conrelid =
          'private.payment_attempts'::pg_catalog.regclass
        and constraint_record.conname =
          'payment_attempts_provider_evidence_identity_unique'
    )
  then
    raise exception
      'provider evidence migration requires quarantine; partial objects exist'
      using errcode = '55000';
  end if;

  if pg_catalog.to_regtype('private.order_payment_state_code') is null
    or pg_catalog.to_regtype('private.payment_attempt_state_code') is null
    or pg_catalog.to_regtype('private.payment_environment_code') is null
    or pg_catalog.to_regtype('private.payment_application_kind') is null
    or pg_catalog.to_regprocedure(
      'private.prevent_dormant_payment_domain_mutation()'
    ) is null
  then
    raise exception
      'provider evidence migration requires quarantine; payment domain is incomplete'
      using errcode = '55000';
  end if;

  select pg_catalog.array_agg(enum_record.enumlabel order by enum_record.enumsortorder)
  into enum_labels
  from pg_catalog.pg_enum enum_record
  where enum_record.enumtypid =
    'private.order_payment_state_code'::pg_catalog.regtype;
  if enum_labels is distinct from array[
    'unpaid', 'payment_pending', 'paid', 'partially_refunded', 'refunded'
  ]::text[] then
    raise exception
      'provider evidence migration requires quarantine; payment state labels changed'
      using errcode = '55000';
  end if;

  select pg_catalog.array_agg(enum_record.enumlabel order by enum_record.enumsortorder)
  into enum_labels
  from pg_catalog.pg_enum enum_record
  where enum_record.enumtypid =
    'private.payment_attempt_state_code'::pg_catalog.regtype;
  if enum_labels is distinct from array[
    'created',
    'initialization_pending',
    'awaiting_customer',
    'verification_pending',
    'succeeded',
    'init_failed',
    'init_unknown',
    'failed',
    'cancelled',
    'expired',
    'manual_review'
  ]::text[] then
    raise exception
      'provider evidence migration requires quarantine; attempt state labels changed'
      using errcode = '55000';
  end if;

  select pg_catalog.array_agg(enum_record.enumlabel order by enum_record.enumsortorder)
  into enum_labels
  from pg_catalog.pg_enum enum_record
  where enum_record.enumtypid =
    'private.payment_environment_code'::pg_catalog.regtype;
  if enum_labels is distinct from array['test', 'live']::text[] then
    raise exception
      'provider evidence migration requires quarantine; environment labels changed'
      using errcode = '55000';
  end if;

  select pg_catalog.array_agg(enum_record.enumlabel order by enum_record.enumsortorder)
  into enum_labels
  from pg_catalog.pg_enum enum_record
  where enum_record.enumtypid =
    'private.payment_application_kind'::pg_catalog.regtype;
  if enum_labels is distinct from array[
    'primary_order_payment', 'unapplied_excess'
  ]::text[] then
    raise exception
      'provider evidence migration requires quarantine; application labels changed'
      using errcode = '55000';
  end if;

  foreach table_name in array array[
    'public.payments',
    'public.payment_events',
    'public.webhook_inbox',
    'public.ledger_accounts',
    'public.ledger_journals',
    'public.ledger_entries',
    'public.referral_commissions',
    'private.order_payment_states',
    'private.payment_attempts',
    'private.payment_applications'
  ] loop
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
    ) then
      raise exception
        'provider evidence migration requires quarantine; PUBLIC retains access on %',
        table_name
        using errcode = '55000';
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
          table_name,
          privilege_name
        ) then
          raise exception
            'provider evidence migration requires quarantine; % retains % on %',
            role_name, privilege_name, table_name
            using errcode = '55000';
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
          raise exception
            'provider evidence migration requires quarantine; % retains column % on %',
            role_name, privilege_name, table_name
            using errcode = '55000';
        end if;
      end loop;
    end loop;
  end loop;

  foreach type_name in array array[
    'private.order_payment_state_code',
    'private.payment_attempt_state_code',
    'private.payment_environment_code',
    'private.payment_application_kind'
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
        and privilege_record.grantee = 0
        and privilege_record.privilege_type = 'USAGE'
    ) then
      raise exception
        'provider evidence migration requires quarantine; PUBLIC retains type usage on %',
        type_name
        using errcode = '55000';
    end if;

    foreach role_name in array array['anon', 'authenticated', 'service_role'] loop
      if pg_catalog.has_type_privilege(role_name, type_name, 'usage') then
        raise exception
          'provider evidence migration requires quarantine; % retains type usage on %',
          role_name, type_name
          using errcode = '55000';
      end if;
    end loop;
  end loop;

  for protected_function in
    select function_record.oid, function_record.proname
    from pg_catalog.pg_proc function_record
    join pg_catalog.pg_namespace namespace_record
      on namespace_record.oid = function_record.pronamespace
    where namespace_record.nspname = 'public'
      and function_record.proname in (
        'post_journal',
        'reverse_posted_journal',
        'journal_matches_lines',
        'reversal_matches_original'
      )
  loop
    foreach role_name in array array['anon', 'authenticated', 'service_role'] loop
      if pg_catalog.has_function_privilege(
        role_name,
        protected_function.oid,
        'execute'
      ) then
        raise exception
          'provider evidence migration requires quarantine; % retains execute on %',
          role_name, protected_function.proname
          using errcode = '55000';
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
      and trigger_record.tgfoid =
        'private.prevent_payment_event_mutation()'::pg_catalog.regprocedure
  ) then
    raise exception
      'provider evidence migration requires quarantine; evidence guard is missing'
      using errcode = '55000';
  end if;

  select * into strict payment_event_blocker
  from pg_catalog.pg_proc function_record
  where function_record.oid =
    'private.prevent_payment_event_mutation()'::pg_catalog.regprocedure;
  select owner_role.rolname into strict payment_event_blocker_owner
  from pg_catalog.pg_roles owner_role
  where owner_role.oid = payment_event_blocker.proowner;
  if not payment_event_blocker.prosecdef
    or not coalesce(payment_event_blocker.proconfig, array[]::text[])
      @> array['search_path=""']::text[]
    or payment_event_blocker_owner in (
      'anon', 'authenticated', 'authenticator', 'service_role'
    )
    or exists (
      select 1
      from pg_catalog.aclexplode(
        coalesce(
          payment_event_blocker.proacl,
          pg_catalog.acldefault('f', payment_event_blocker.proowner)
        )
      ) privilege_record
      where privilege_record.grantee = 0
        and privilege_record.privilege_type = 'EXECUTE'
    )
  then
    raise exception
      'provider evidence migration requires quarantine; evidence blocker changed'
      using errcode = '55000';
  end if;
  foreach role_name in array array['anon', 'authenticated', 'service_role'] loop
    if pg_catalog.has_function_privilege(
      role_name,
      'private.prevent_payment_event_mutation()',
      'execute'
    ) then
      raise exception
        'provider evidence migration requires quarantine; % can bypass evidence blocker',
        role_name
        using errcode = '55000';
    end if;
  end loop;

  if (
    select count(*)
    from pg_catalog.pg_class relation_record
    where relation_record.oid in (
      'public.payments'::pg_catalog.regclass,
      'public.payment_events'::pg_catalog.regclass,
      'public.webhook_inbox'::pg_catalog.regclass,
      'public.ledger_accounts'::pg_catalog.regclass,
      'public.ledger_journals'::pg_catalog.regclass,
      'public.ledger_entries'::pg_catalog.regclass,
      'public.referral_commissions'::pg_catalog.regclass
    )
      and relation_record.relrowsecurity
  ) <> 7 or exists (
    select 1
    from pg_catalog.pg_policies policy_record
    where policy_record.schemaname = 'public'
      and policy_record.tablename in (
        'payments',
        'payment_events',
        'webhook_inbox',
        'ledger_accounts',
        'ledger_journals',
        'ledger_entries',
        'referral_commissions'
      )
  ) then
    raise exception
      'provider evidence migration requires quarantine; finance RLS changed'
      using errcode = '55000';
  end if;

  if (
    select count(*)
    from pg_catalog.pg_class relation_record
    where relation_record.oid in (
      'private.order_payment_states'::pg_catalog.regclass,
      'private.payment_attempts'::pg_catalog.regclass,
      'private.payment_applications'::pg_catalog.regclass
    )
      and relation_record.relrowsecurity
      and relation_record.relforcerowsecurity
  ) <> 3 or exists (
    select 1
    from pg_catalog.pg_policies policy_record
    where policy_record.schemaname = 'private'
      and policy_record.tablename in (
        'order_payment_states',
        'payment_attempts',
        'payment_applications'
      )
  ) then
    raise exception
      'provider evidence migration requires quarantine; payment domain access changed'
      using errcode = '55000';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_record
    where constraint_record.conrelid = 'public.orders'::pg_catalog.regclass
      and constraint_record.conname = 'orders_payment_identity_unique'
      and constraint_record.contype = 'u'
      and constraint_record.convalidated
  ) or not exists (
    select 1
    from pg_catalog.pg_constraint constraint_record
    where constraint_record.conrelid =
        'private.order_payment_states'::pg_catalog.regclass
      and constraint_record.conname = 'order_payment_states_order_identity_fkey'
      and constraint_record.contype = 'f'
      and constraint_record.confrelid = 'public.orders'::pg_catalog.regclass
      and constraint_record.confdeltype = 'r'
      and constraint_record.convalidated
  ) or not exists (
    select 1
    from pg_catalog.pg_constraint constraint_record
    where constraint_record.conrelid =
        'private.payment_attempts'::pg_catalog.regclass
      and constraint_record.conname = 'payment_attempts_state_snapshot_fkey'
      and constraint_record.contype = 'f'
      and constraint_record.confrelid =
        'private.order_payment_states'::pg_catalog.regclass
      and constraint_record.confdeltype = 'r'
      and constraint_record.convalidated
  ) or not exists (
    select 1
    from pg_catalog.pg_constraint constraint_record
    where constraint_record.conrelid =
        'private.payment_applications'::pg_catalog.regclass
      and constraint_record.conname =
        'payment_applications_succeeded_attempt_fkey'
      and constraint_record.contype = 'f'
      and constraint_record.confrelid =
        'private.payment_attempts'::pg_catalog.regclass
      and constraint_record.confdeltype = 'r'
      and constraint_record.convalidated
  ) or not exists (
    select 1
    from pg_catalog.pg_indexes index_record
    where index_record.schemaname = 'private'
      and index_record.indexname = 'payment_applications_one_primary_idx'
      and index_record.indexdef like
        '%UNIQUE INDEX%ON private.payment_applications%WHERE (kind = ''primary_order_payment''::private.payment_application_kind)%'
  ) then
    raise exception
      'provider evidence migration requires quarantine; payment invariants changed'
      using errcode = '55000';
  end if;

  select * into strict payment_blocker
  from pg_catalog.pg_proc function_record
  where function_record.oid =
    'private.prevent_dormant_payment_domain_mutation()'::pg_catalog.regprocedure;

  select owner_role.rolname into strict payment_blocker_owner
  from pg_catalog.pg_roles owner_role
  where owner_role.oid = payment_blocker.proowner;

  if payment_blocker.prosecdef
    or not coalesce(payment_blocker.proconfig, array[]::text[])
      @> array['search_path=""']::text[]
    or payment_blocker_owner in (
      'anon', 'authenticated', 'authenticator', 'service_role'
    )
    or exists (
      select 1
      from pg_catalog.aclexplode(
        coalesce(
          payment_blocker.proacl,
          pg_catalog.acldefault('f', payment_blocker.proowner)
        )
      ) privilege_record
      where privilege_record.grantee = 0
        and privilege_record.privilege_type = 'EXECUTE'
    )
  then
    raise exception
      'provider evidence migration requires quarantine; payment blocker changed'
      using errcode = '55000';
  end if;

  if (
    select count(*)
    from pg_catalog.pg_trigger trigger_record
    where trigger_record.tgrelid in (
      'private.order_payment_states'::pg_catalog.regclass,
      'private.payment_attempts'::pg_catalog.regclass,
      'private.payment_applications'::pg_catalog.regclass
    )
      and not trigger_record.tgisinternal
      and trigger_record.tgenabled = 'O'
      and trigger_record.tgfoid =
        'private.prevent_dormant_payment_domain_mutation()'::pg_catalog.regprocedure
  ) <> 6 then
    raise exception
      'provider evidence migration requires quarantine; payment dormancy changed'
      using errcode = '55000';
  end if;

  foreach role_name in array array['anon', 'authenticated', 'service_role'] loop
    if pg_catalog.has_function_privilege(
      role_name,
      'private.prevent_dormant_payment_domain_mutation()',
      'execute'
    ) then
      raise exception
        'provider evidence migration requires quarantine; % can bypass payment dormancy',
        role_name
        using errcode = '55000';
    end if;
  end loop;
end;
$$;

create type private.provider_normalization_outcome_code as enum (
  'matched_attempt',
  'quarantined_unknown_reference',
  'quarantined_missing_reference',
  'quarantined_malformed_reference',
  'quarantined_unsupported_event'
);

revoke all on type private.provider_normalization_outcome_code
  from public, anon, authenticated, service_role;

alter table private.payment_attempts
  add constraint payment_attempts_provider_evidence_identity_unique
  unique (id, provider_code, provider_environment, provider_reference);

create table private.provider_evidence_deliveries (
  id uuid primary key default extensions.gen_random_uuid(),
  provider_code text not null check (
    provider_code ~ '^[a-z][a-z0-9_-]{1,31}$'
  ),
  provider_environment private.payment_environment_code not null,
  digest_version smallint not null default 1 check (digest_version = 1),
  raw_body_sha256 text not null check (
    raw_body_sha256 ~ '^[0-9a-f]{64}$'
  ),
  raw_body_bytes integer not null check (
    raw_body_bytes between 1 and 1048576
  ),
  signature_method text not null check (
    signature_method ~ '^[a-z][a-z0-9_.-]{1,31}$'
  ),
  signature_sha256 text not null check (
    signature_sha256 ~ '^[0-9a-f]{64}$'
  ),
  signature_key_version text not null check (
    signature_key_version ~ '^[a-z0-9][a-z0-9_.:-]{0,63}$'
  ),
  verifier_version smallint not null check (
    verifier_version > 0
  ),
  provider_delivery_id text check (
    provider_delivery_id is null
    or (
      pg_catalog.char_length(provider_delivery_id) between 1 and 160
      and provider_delivery_id = pg_catalog.btrim(provider_delivery_id)
      and provider_delivery_id !~ '[[:cntrl:]]'
    )
  ),
  content_type text not null check (
    pg_catalog.char_length(content_type) between 1 and 128
    and content_type = pg_catalog.btrim(content_type)
    and content_type !~ '[[:cntrl:]]'
  ),
  received_at timestamptz not null,
  signature_verified_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint provider_evidence_deliveries_exact_dedupe_unique unique (
    provider_code,
    provider_environment,
    digest_version,
    raw_body_sha256
  ),
  constraint provider_evidence_deliveries_provider_identity_unique unique (
    id,
    provider_code,
    provider_environment
  ),
  constraint provider_evidence_deliveries_payload_identity_unique unique (
    id,
    digest_version,
    raw_body_sha256,
    raw_body_bytes
  ),
  constraint provider_evidence_deliveries_timestamps check (
    signature_verified_at >= received_at
    and created_at >= signature_verified_at
  )
);

create index provider_evidence_deliveries_provider_id_observation_idx
  on private.provider_evidence_deliveries(
    provider_code,
    provider_environment,
    provider_delivery_id
  ) where provider_delivery_id is not null;
create index provider_evidence_deliveries_provider_received_idx
  on private.provider_evidence_deliveries(
    provider_code,
    provider_environment,
    received_at desc
  );
create index provider_evidence_deliveries_received_idx
  on private.provider_evidence_deliveries(received_at);

create table private.provider_evidence_raw_payloads (
  delivery_id uuid primary key,
  digest_version smallint not null check (digest_version = 1),
  raw_body_sha256 text not null check (
    raw_body_sha256 ~ '^[0-9a-f]{64}$'
  ),
  raw_body_bytes integer not null check (
    raw_body_bytes between 1 and 1048576
  ),
  raw_body bytea not null,
  stored_at timestamptz not null default now(),
  purge_after timestamptz not null,
  constraint provider_evidence_raw_payloads_delivery_fkey foreign key (
    delivery_id,
    digest_version,
    raw_body_sha256,
    raw_body_bytes
  ) references private.provider_evidence_deliveries(
    id,
    digest_version,
    raw_body_sha256,
    raw_body_bytes
  ) on delete restrict,
  constraint provider_evidence_raw_payloads_exact_bytes check (
    pg_catalog.octet_length(raw_body) = raw_body_bytes
    and encode(extensions.digest(raw_body, 'sha256'), 'hex') = raw_body_sha256
  ),
  constraint provider_evidence_raw_payloads_retention check (
    purge_after > stored_at
  )
);

create index provider_evidence_raw_payloads_delivery_fkey_idx
  on private.provider_evidence_raw_payloads(
    delivery_id,
    digest_version,
    raw_body_sha256,
    raw_body_bytes
  );
create index provider_evidence_raw_payloads_purge_after_idx
  on private.provider_evidence_raw_payloads(purge_after);

create table private.provider_normalized_events (
  id uuid primary key default extensions.gen_random_uuid(),
  delivery_id uuid not null,
  event_index smallint not null check (event_index >= 0),
  normalizer_version smallint not null check (normalizer_version > 0),
  provider_code text not null check (
    provider_code ~ '^[a-z][a-z0-9_-]{1,31}$'
  ),
  provider_environment private.payment_environment_code not null,
  normalization_outcome private.provider_normalization_outcome_code not null,
  provider_event_kind text not null check (
    provider_event_kind ~ '^[a-z][a-z0-9_.-]{1,63}$'
  ),
  provider_resource_kind text not null check (
    provider_resource_kind ~ '^[a-z][a-z0-9_.-]{1,63}$'
  ),
  provider_resource_id text check (
    provider_resource_id is null
    or (
      pg_catalog.char_length(provider_resource_id) between 1 and 160
      and provider_resource_id = pg_catalog.btrim(provider_resource_id)
      and provider_resource_id !~ '[[:cntrl:]]'
    )
  ),
  provider_reference text check (
    provider_reference is null
    or (
      pg_catalog.char_length(provider_reference) between 8 and 160
      and provider_reference = pg_catalog.btrim(provider_reference)
      and provider_reference !~ '[[:cntrl:]]'
    )
  ),
  payment_attempt_id uuid,
  provider_status text check (
    provider_status is null
    or provider_status ~ '^[a-z][a-z0-9_.-]{0,63}$'
  ),
  observed_amount_minor bigint check (
    observed_amount_minor is null
    or (
      observed_amount_minor >= 0
      and observed_amount_minor <= 9007199254740991
    )
  ),
  observed_currency_code char(3) check (
    observed_currency_code is null
    or observed_currency_code ~ '^[A-Z]{3}$'
  ),
  provider_occurred_at timestamptz,
  semantic_key_version smallint check (
    semantic_key_version is null or semantic_key_version > 0
  ),
  semantic_key_sha256 text check (
    semantic_key_sha256 is null
    or semantic_key_sha256 ~ '^[0-9a-f]{64}$'
  ),
  normalized_at timestamptz not null default now(),
  constraint provider_normalized_events_delivery_event_unique unique (
    delivery_id,
    event_index,
    normalizer_version
  ),
  constraint provider_normalized_events_delivery_fkey foreign key (
    delivery_id,
    provider_code,
    provider_environment
  ) references private.provider_evidence_deliveries(
    id,
    provider_code,
    provider_environment
  ) on delete restrict,
  constraint provider_normalized_events_attempt_fkey foreign key (
    payment_attempt_id,
    provider_code,
    provider_environment,
    provider_reference
  ) references private.payment_attempts(
    id,
    provider_code,
    provider_environment,
    provider_reference
  ) on delete restrict,
  constraint provider_normalized_events_observed_money_pair check (
    (observed_amount_minor is null) = (observed_currency_code is null)
  ),
  constraint provider_normalized_events_semantic_key_pair check (
    (semantic_key_version is null) = (semantic_key_sha256 is null)
  ),
  constraint provider_normalized_events_outcome_shape check (
    (
      normalization_outcome = 'matched_attempt'
      and payment_attempt_id is not null
      and provider_reference is not null
      and semantic_key_sha256 is not null
    ) or (
      normalization_outcome = 'quarantined_unknown_reference'
      and payment_attempt_id is null
      and provider_reference is not null
    ) or (
      normalization_outcome in (
        'quarantined_missing_reference',
        'quarantined_malformed_reference'
      )
      and payment_attempt_id is null
      and provider_reference is null
    ) or (
      normalization_outcome = 'quarantined_unsupported_event'
      and payment_attempt_id is null
    )
  )
);

create unique index provider_normalized_events_semantic_dedupe_idx
  on private.provider_normalized_events(
    provider_code,
    provider_environment,
    semantic_key_version,
    semantic_key_sha256
  ) where semantic_key_sha256 is not null;
create index provider_normalized_events_delivery_fkey_idx
  on private.provider_normalized_events(
    delivery_id,
    provider_code,
    provider_environment
  );
create index provider_normalized_events_attempt_fkey_idx
  on private.provider_normalized_events(
    payment_attempt_id,
    provider_code,
    provider_environment,
    provider_reference
  );
create index provider_normalized_events_attempt_created_idx
  on private.provider_normalized_events(payment_attempt_id, normalized_at desc)
  where payment_attempt_id is not null;
create index provider_normalized_events_reference_idx
  on private.provider_normalized_events(
    provider_code,
    provider_environment,
    provider_reference
  );
create index provider_normalized_events_outcome_normalized_idx
  on private.provider_normalized_events(
    normalization_outcome,
    normalized_at desc
  );

alter table private.provider_evidence_deliveries enable row level security;
alter table private.provider_evidence_deliveries force row level security;
alter table private.provider_evidence_raw_payloads enable row level security;
alter table private.provider_evidence_raw_payloads force row level security;
alter table private.provider_normalized_events enable row level security;
alter table private.provider_normalized_events force row level security;

revoke all on table private.provider_evidence_deliveries
  from public, anon, authenticated, service_role;
revoke all on table private.provider_evidence_raw_payloads
  from public, anon, authenticated, service_role;
revoke all on table private.provider_normalized_events
  from public, anon, authenticated, service_role;

create or replace function private.prevent_dormant_provider_evidence_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'provider evidence is dormant' using errcode = '55000';
end;
$$;

revoke all on function private.prevent_dormant_provider_evidence_mutation()
  from public, anon, authenticated, service_role;

create trigger provider_evidence_deliveries_dormant_rows
before insert or update or delete on private.provider_evidence_deliveries
for each row execute function private.prevent_dormant_provider_evidence_mutation();
create trigger provider_evidence_deliveries_dormant_truncate
before truncate on private.provider_evidence_deliveries
for each statement execute function private.prevent_dormant_provider_evidence_mutation();

create trigger provider_evidence_raw_payloads_dormant_rows
before insert or update or delete on private.provider_evidence_raw_payloads
for each row execute function private.prevent_dormant_provider_evidence_mutation();
create trigger provider_evidence_raw_payloads_dormant_truncate
before truncate on private.provider_evidence_raw_payloads
for each statement execute function private.prevent_dormant_provider_evidence_mutation();

create trigger provider_normalized_events_dormant_rows
before insert or update or delete on private.provider_normalized_events
for each row execute function private.prevent_dormant_provider_evidence_mutation();
create trigger provider_normalized_events_dormant_truncate
before truncate on private.provider_normalized_events
for each statement execute function private.prevent_dormant_provider_evidence_mutation();

comment on table private.provider_evidence_deliveries is
  'Dormant immutable verified-delivery envelope. No receiver or writer is active.';
comment on table private.provider_evidence_raw_payloads is
  'Dormant separately purgeable exact-byte evidence. No retention job is active.';
comment on table private.provider_normalized_events is
  'Dormant minimized normalized provider evidence. No domain transition is active.';

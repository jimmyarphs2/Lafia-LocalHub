-- Rollback-only live regression probe for
-- 202608310029_localhub_provider_evidence_dormant.sql. Every fixture and
-- owner-level guard exercise is reverted, leaving all finance domains empty.

begin;

do $$
declare
  table_name text;
  role_name text;
  privilege_name text;
  relation_schema text;
  relation_name text;
  protected_function record;
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
    raise exception 'provider evidence hosted baseline is not empty';
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
    'private.payment_applications',
    'private.provider_evidence_deliveries',
    'private.provider_evidence_raw_payloads',
    'private.provider_normalized_events'
  ] loop
    relation_schema := pg_catalog.split_part(table_name, '.', 1);
    relation_name := pg_catalog.split_part(table_name, '.', 2);

    if not exists (
      select 1
      from pg_catalog.pg_class relation_record
      join pg_catalog.pg_namespace namespace_record
        on namespace_record.oid = relation_record.relnamespace
      where namespace_record.nspname = relation_schema
        and relation_record.relname = relation_name
        and relation_record.relrowsecurity
        and (
          relation_schema = 'public'
          or relation_record.relforcerowsecurity
        )
    ) or exists (
      select 1
      from pg_catalog.pg_policies policy_record
      where policy_record.schemaname = relation_schema
        and policy_record.tablename = relation_name
    ) then
      raise exception '% is not deny-by-default under RLS', table_name;
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
    ) then
      raise exception 'PUBLIC retained access on %', table_name;
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
          raise exception '% retained % on %',
            role_name, privilege_name, table_name;
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
          raise exception '% retained column % on %',
            role_name, privilege_name, table_name;
        end if;
      end loop;
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
        raise exception '% regained generic execute on %',
          role_name, protected_function.proname;
      end if;
    end loop;
  end loop;
end;
$$;

do $$
declare
  actual_labels text[];
  role_name text;
begin
  select pg_catalog.array_agg(enum_record.enumlabel order by enum_record.enumsortorder)
  into actual_labels
  from pg_catalog.pg_enum enum_record
  where enum_record.enumtypid =
    'private.provider_normalization_outcome_code'::pg_catalog.regtype;

  if actual_labels is distinct from array[
    'matched_attempt',
    'quarantined_unknown_reference',
    'quarantined_missing_reference',
    'quarantined_malformed_reference',
    'quarantined_unsupported_event'
  ]::text[] then
    raise exception 'provider normalization outcome labels changed';
  end if;

  select pg_catalog.array_agg(enum_record.enumlabel order by enum_record.enumsortorder)
  into actual_labels
  from pg_catalog.pg_enum enum_record
  where enum_record.enumtypid =
    'private.order_payment_state_code'::pg_catalog.regtype;
  if actual_labels is distinct from array[
    'unpaid', 'payment_pending', 'paid', 'partially_refunded', 'refunded'
  ]::text[] then
    raise exception 'order payment state labels changed';
  end if;

  select pg_catalog.array_agg(enum_record.enumlabel order by enum_record.enumsortorder)
  into actual_labels
  from pg_catalog.pg_enum enum_record
  where enum_record.enumtypid =
    'private.payment_attempt_state_code'::pg_catalog.regtype;
  if actual_labels is distinct from array[
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
    raise exception 'payment attempt state labels changed';
  end if;

  select pg_catalog.array_agg(enum_record.enumlabel order by enum_record.enumsortorder)
  into actual_labels
  from pg_catalog.pg_enum enum_record
  where enum_record.enumtypid =
    'private.payment_environment_code'::pg_catalog.regtype;
  if actual_labels is distinct from array['test', 'live']::text[] then
    raise exception 'payment environment labels changed';
  end if;

  select pg_catalog.array_agg(enum_record.enumlabel order by enum_record.enumsortorder)
  into actual_labels
  from pg_catalog.pg_enum enum_record
  where enum_record.enumtypid =
    'private.payment_application_kind'::pg_catalog.regtype;
  if actual_labels is distinct from array[
    'primary_order_payment', 'unapplied_excess'
  ]::text[] then
    raise exception 'payment application labels changed';
  end if;

  foreach role_name in array array['anon', 'authenticated', 'service_role'] loop
    if pg_catalog.has_type_privilege(
      role_name,
      'private.provider_normalization_outcome_code',
      'usage'
    ) then
      raise exception '% retained provider outcome type usage', role_name;
    end if;
  end loop;

  if exists (
    select 1
    from pg_catalog.pg_type type_record
    cross join lateral pg_catalog.aclexplode(
      coalesce(
        type_record.typacl,
        pg_catalog.acldefault('T', type_record.typowner)
      )
    ) privilege_record
    where type_record.oid =
        'private.provider_normalization_outcome_code'::pg_catalog.regtype
      and privilege_record.grantee = 0
      and privilege_record.privilege_type = 'USAGE'
  ) then
    raise exception 'PUBLIC retained provider outcome type usage';
  end if;
end;
$$;

do $$
declare
  actual_columns text[];
begin
  select pg_catalog.array_agg(attribute_record.attname order by attribute_record.attnum)
  into actual_columns
  from pg_catalog.pg_attribute attribute_record
  where attribute_record.attrelid =
      'private.provider_evidence_deliveries'::pg_catalog.regclass
    and attribute_record.attnum > 0
    and not attribute_record.attisdropped;
  if actual_columns is distinct from array[
    'id', 'provider_code', 'provider_environment', 'digest_version',
    'raw_body_sha256', 'raw_body_bytes', 'signature_method',
    'signature_sha256', 'signature_key_version', 'verifier_version',
    'provider_delivery_id', 'content_type', 'received_at',
    'signature_verified_at', 'created_at'
  ]::text[] then
    raise exception 'provider delivery columns changed';
  end if;

  select pg_catalog.array_agg(attribute_record.attname order by attribute_record.attnum)
  into actual_columns
  from pg_catalog.pg_attribute attribute_record
  where attribute_record.attrelid =
      'private.provider_evidence_raw_payloads'::pg_catalog.regclass
    and attribute_record.attnum > 0
    and not attribute_record.attisdropped;
  if actual_columns is distinct from array[
    'delivery_id', 'digest_version', 'raw_body_sha256', 'raw_body_bytes',
    'raw_body', 'stored_at', 'purge_after'
  ]::text[] then
    raise exception 'provider raw payload columns changed';
  end if;

  select pg_catalog.array_agg(attribute_record.attname order by attribute_record.attnum)
  into actual_columns
  from pg_catalog.pg_attribute attribute_record
  where attribute_record.attrelid =
      'private.provider_normalized_events'::pg_catalog.regclass
    and attribute_record.attnum > 0
    and not attribute_record.attisdropped;
  if actual_columns is distinct from array[
    'id', 'delivery_id', 'event_index', 'normalizer_version',
    'provider_code', 'provider_environment', 'normalization_outcome',
    'provider_event_kind', 'provider_resource_kind', 'provider_resource_id',
    'provider_reference', 'payment_attempt_id', 'provider_status',
    'observed_amount_minor', 'observed_currency_code',
    'provider_occurred_at', 'semantic_key_version', 'semantic_key_sha256',
    'normalized_at'
  ]::text[] then
    raise exception 'provider normalized event columns changed';
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
    where constraint_record.conrelid = 'public.payment_events'::pg_catalog.regclass
      and constraint_record.conname = 'payment_events_payment_id_fkey'
      and constraint_record.contype = 'f'
      and constraint_record.confrelid = 'public.payments'::pg_catalog.regclass
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
    raise exception 'legacy payment evidence guard changed';
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
    raise exception 'payment-domain prerequisite changed';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_record
    where constraint_record.conrelid =
        'private.payment_attempts'::pg_catalog.regclass
      and constraint_record.conname =
        'payment_attempts_provider_evidence_identity_unique'
      and constraint_record.contype = 'u'
      and constraint_record.convalidated
  ) then
    raise exception 'payment-attempt evidence identity is missing';
  end if;

  if (
    select count(*)
    from pg_catalog.pg_constraint constraint_record
    where constraint_record.conrelid in (
      'private.provider_evidence_raw_payloads'::pg_catalog.regclass,
      'private.provider_normalized_events'::pg_catalog.regclass
    )
      and constraint_record.contype = 'f'
      and constraint_record.convalidated
      and constraint_record.confdeltype = 'r'
  ) <> 3 or exists (
    select 1
    from pg_catalog.pg_constraint constraint_record
    where constraint_record.conrelid in (
      'private.provider_evidence_raw_payloads'::pg_catalog.regclass,
      'private.provider_normalized_events'::pg_catalog.regclass
    )
      and constraint_record.contype = 'f'
      and (
        not constraint_record.convalidated
        or constraint_record.confdeltype <> 'r'
      )
  ) then
    raise exception 'provider evidence restrictive FK contract changed';
  end if;

  select pg_catalog.pg_get_constraintdef(constraint_record.oid)
  into strict constraint_definition
  from pg_catalog.pg_constraint constraint_record
  where constraint_record.conrelid =
      'private.provider_evidence_raw_payloads'::pg_catalog.regclass
    and constraint_record.conname =
      'provider_evidence_raw_payloads_delivery_fkey';
  if constraint_definition not like
    'FOREIGN KEY (delivery_id, digest_version, raw_body_sha256, raw_body_bytes) REFERENCES private.provider_evidence_deliveries(id, digest_version, raw_body_sha256, raw_body_bytes) ON DELETE RESTRICT'
  then
    raise exception 'raw payload identity FK changed: %', constraint_definition;
  end if;

  select pg_catalog.pg_get_constraintdef(constraint_record.oid)
  into strict constraint_definition
  from pg_catalog.pg_constraint constraint_record
  where constraint_record.conrelid =
      'private.provider_normalized_events'::pg_catalog.regclass
    and constraint_record.conname = 'provider_normalized_events_delivery_fkey';
  if constraint_definition not like
    'FOREIGN KEY (delivery_id, provider_code, provider_environment) REFERENCES private.provider_evidence_deliveries(id, provider_code, provider_environment) ON DELETE RESTRICT'
  then
    raise exception 'normalized delivery FK changed: %', constraint_definition;
  end if;

  select pg_catalog.pg_get_constraintdef(constraint_record.oid)
  into strict constraint_definition
  from pg_catalog.pg_constraint constraint_record
  where constraint_record.conrelid =
      'private.provider_normalized_events'::pg_catalog.regclass
    and constraint_record.conname = 'provider_normalized_events_attempt_fkey';
  if constraint_definition not like
    'FOREIGN KEY (payment_attempt_id, provider_code, provider_environment, provider_reference) REFERENCES private.payment_attempts(id, provider_code, provider_environment, provider_reference) ON DELETE RESTRICT'
  then
    raise exception 'normalized attempt FK changed: %', constraint_definition;
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_record
    where constraint_record.conrelid =
        'private.provider_evidence_deliveries'::pg_catalog.regclass
      and constraint_record.conname =
        'provider_evidence_deliveries_exact_dedupe_unique'
      and constraint_record.contype = 'u'
      and constraint_record.convalidated
  ) or not exists (
    select 1
    from pg_catalog.pg_constraint constraint_record
    where constraint_record.conrelid =
        'private.provider_normalized_events'::pg_catalog.regclass
      and constraint_record.conname =
        'provider_normalized_events_delivery_event_unique'
      and constraint_record.contype = 'u'
      and constraint_record.convalidated
  ) or not exists (
    select 1
    from pg_catalog.pg_index index_record
    join pg_catalog.pg_class index_relation
      on index_relation.oid = index_record.indexrelid
    where index_relation.relname =
        'provider_normalized_events_semantic_dedupe_idx'
      and index_record.indrelid =
        'private.provider_normalized_events'::pg_catalog.regclass
      and index_record.indisunique
      and index_record.indpred is not null
      and pg_catalog.pg_get_expr(
        index_record.indpred,
        index_record.indrelid
      ) like '%semantic_key_sha256 IS NOT NULL%'
  ) then
    raise exception 'provider evidence dedupe contract changed';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_indexes
    where schemaname = 'private'
      and indexname = 'provider_evidence_raw_payloads_delivery_fkey_idx'
  ) or not exists (
    select 1 from pg_catalog.pg_indexes
    where schemaname = 'private'
      and indexname = 'provider_normalized_events_delivery_fkey_idx'
  ) or not exists (
    select 1 from pg_catalog.pg_indexes
    where schemaname = 'private'
      and indexname = 'provider_normalized_events_attempt_fkey_idx'
  ) or not exists (
    select 1 from pg_catalog.pg_indexes
    where schemaname = 'private'
      and indexname =
        'provider_evidence_deliveries_provider_id_observation_idx'
  ) or not exists (
    select 1 from pg_catalog.pg_indexes
    where schemaname = 'private'
      and indexname = 'provider_evidence_deliveries_provider_received_idx'
  ) or not exists (
    select 1 from pg_catalog.pg_indexes
    where schemaname = 'private'
      and indexname = 'provider_evidence_deliveries_received_idx'
  ) or not exists (
    select 1 from pg_catalog.pg_indexes
    where schemaname = 'private'
      and indexname = 'provider_normalized_events_reference_idx'
  ) or not exists (
    select 1 from pg_catalog.pg_indexes
    where schemaname = 'private'
      and indexname = 'provider_normalized_events_outcome_normalized_idx'
  ) then
    raise exception 'provider evidence supporting index is missing';
  end if;
end;
$$;

do $$
declare
  trigger_function pg_catalog.pg_proc%rowtype;
  prerequisite_function pg_catalog.pg_proc%rowtype;
  owner_name text;
  role_name text;
begin
  select * into strict prerequisite_function
  from pg_catalog.pg_proc function_record
  where function_record.oid =
    'private.prevent_payment_event_mutation()'::pg_catalog.regprocedure;
  select owner_role.rolname into strict owner_name
  from pg_catalog.pg_roles owner_role
  where owner_role.oid = prerequisite_function.proowner;
  if not prerequisite_function.prosecdef
    or not coalesce(prerequisite_function.proconfig, array[]::text[])
      @> array['search_path=""']::text[]
    or owner_name in (
      'anon', 'authenticated', 'authenticator', 'service_role'
    )
    or exists (
      select 1
      from pg_catalog.aclexplode(
        coalesce(
          prerequisite_function.proacl,
          pg_catalog.acldefault('f', prerequisite_function.proowner)
        )
      ) privilege_record
      where privilege_record.grantee = 0
        and privilege_record.privilege_type = 'EXECUTE'
    )
  then
    raise exception 'payment evidence blocker changed';
  end if;
  foreach role_name in array array['anon', 'authenticated', 'service_role'] loop
    if pg_catalog.has_function_privilege(
      role_name,
      'private.prevent_payment_event_mutation()',
      'execute'
    ) then
      raise exception '% retained payment evidence blocker execute', role_name;
    end if;
  end loop;

  select * into strict prerequisite_function
  from pg_catalog.pg_proc function_record
  where function_record.oid =
    'private.prevent_dormant_payment_domain_mutation()'::pg_catalog.regprocedure;
  select owner_role.rolname into strict owner_name
  from pg_catalog.pg_roles owner_role
  where owner_role.oid = prerequisite_function.proowner;
  if prerequisite_function.prosecdef
    or not coalesce(prerequisite_function.proconfig, array[]::text[])
      @> array['search_path=""']::text[]
    or owner_name in (
      'anon', 'authenticated', 'authenticator', 'service_role'
    )
    or exists (
      select 1
      from pg_catalog.aclexplode(
        coalesce(
          prerequisite_function.proacl,
          pg_catalog.acldefault('f', prerequisite_function.proowner)
        )
      ) privilege_record
      where privilege_record.grantee = 0
        and privilege_record.privilege_type = 'EXECUTE'
    )
  then
    raise exception 'payment-domain blocker changed';
  end if;
  foreach role_name in array array['anon', 'authenticated', 'service_role'] loop
    if pg_catalog.has_function_privilege(
      role_name,
      'private.prevent_dormant_payment_domain_mutation()',
      'execute'
    ) then
      raise exception '% retained payment-domain blocker execute', role_name;
    end if;
  end loop;

  select * into strict trigger_function
  from pg_catalog.pg_proc function_record
  where function_record.oid =
    'private.prevent_dormant_provider_evidence_mutation()'::pg_catalog.regprocedure;

  select owner_role.rolname into strict owner_name
  from pg_catalog.pg_roles owner_role
  where owner_role.oid = trigger_function.proowner;

  if trigger_function.prosecdef
    or not coalesce(trigger_function.proconfig, array[]::text[])
      @> array['search_path=""']::text[]
    or owner_name in (
      'anon', 'authenticated', 'authenticator', 'service_role'
    )
  then
    raise exception 'provider evidence blocker is not a trusted fixed-path invoker';
  end if;

  foreach role_name in array array['anon', 'authenticated', 'service_role'] loop
    if pg_catalog.has_function_privilege(
      role_name,
      'private.prevent_dormant_provider_evidence_mutation()',
      'execute'
    ) then
      raise exception '% retained provider evidence blocker execute', role_name;
    end if;
  end loop;

  if exists (
    select 1
    from pg_catalog.aclexplode(
      coalesce(
        trigger_function.proacl,
        pg_catalog.acldefault('f', trigger_function.proowner)
      )
    ) privilege_record
    where privilege_record.grantee = 0
      and privilege_record.privilege_type = 'EXECUTE'
  ) or (
    select count(*)
    from pg_catalog.pg_trigger trigger_record
    where trigger_record.tgrelid in (
      'private.provider_evidence_deliveries'::pg_catalog.regclass,
      'private.provider_evidence_raw_payloads'::pg_catalog.regclass,
      'private.provider_normalized_events'::pg_catalog.regclass
    )
      and not trigger_record.tgisinternal
      and trigger_record.tgenabled = 'O'
      and trigger_record.tgfoid = trigger_function.oid
  ) <> 6 then
    raise exception 'provider evidence blocker ACL or attachment changed';
  end if;
end;
$$;

-- Owner-level inserts fail before a foreign-key lookup can reveal identity.
do $$
declare
  expected_message constant text := 'provider evidence is dormant';
begin
  begin
    insert into private.provider_evidence_deliveries(
      provider_code, provider_environment, raw_body_sha256, raw_body_bytes,
      signature_method, signature_sha256, signature_key_version,
      verifier_version, content_type, received_at, signature_verified_at
    ) values (
      'probe', 'test', repeat('a', 64), 1,
      'hmac_sha512', repeat('b', 64), 'v1',
      1, 'application/json', now(), now()
    );
    raise exception 'dormant provider delivery insert unexpectedly worked';
  exception when others then
    if sqlstate <> '55000' or sqlerrm <> expected_message then raise; end if;
  end;

  begin
    insert into private.provider_evidence_raw_payloads(
      delivery_id, digest_version, raw_body_sha256, raw_body_bytes,
      raw_body, purge_after
    ) values (
      extensions.gen_random_uuid(), 1, repeat('a', 64), 1,
      pg_catalog.convert_to('x', 'UTF8'), now() + interval '1 day'
    );
    raise exception 'dormant raw evidence insert unexpectedly worked';
  exception when others then
    if sqlstate <> '55000' or sqlerrm <> expected_message then raise; end if;
  end;

  begin
    insert into private.provider_normalized_events(
      delivery_id, event_index, normalizer_version,
      provider_code, provider_environment, normalization_outcome,
      provider_event_kind, provider_resource_kind
    ) values (
      extensions.gen_random_uuid(), 0, 1,
      'probe', 'test', 'quarantined_missing_reference', 'unknown.event',
      'unknown'
    );
    raise exception 'dormant normalized event insert unexpectedly worked';
  exception when others then
    if sqlstate <> '55000' or sqlerrm <> expected_message then raise; end if;
  end;
end;
$$;

create temporary table provider_evidence_dormant_probe_state (
  profile_id uuid not null,
  market_id uuid not null,
  business_id uuid not null,
  order_id uuid not null,
  payment_state_id uuid not null,
  attempt_id uuid not null,
  delivery_id uuid not null,
  raw_body_sha256 text not null,
  raw_body_bytes integer not null,
  normalized_event_id uuid not null
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
  attempt_two_id uuid := extensions.gen_random_uuid();
  delivery_one_id uuid := extensions.gen_random_uuid();
  delivery_live_id uuid := extensions.gen_random_uuid();
  delivery_other_id uuid := extensions.gen_random_uuid();
  delivery_length_id uuid := extensions.gen_random_uuid();
  normalized_event_id uuid := extensions.gen_random_uuid();
  provider_reference text := 'probe-reference-' || fixture_key;
  body_one bytea := pg_catalog.convert_to(
    '{"event":"charge.success","probe":"one"}', 'UTF8'
  );
  body_other bytea := pg_catalog.convert_to(
    '{"event":"charge.success","probe":"other"}', 'UTF8'
  );
  body_wrong_digest bytea := pg_catalog.convert_to(
    '{"event":"charge.success","probe":"othfr"}', 'UTF8'
  );
  body_length bytea := pg_catalog.convert_to(
    '{"event":"charge.success","probe":"length"}', 'UTF8'
  );
  digest_one text;
  digest_other text;
  digest_length text;
  semantic_one text := repeat('d', 64);
begin
  digest_one := encode(extensions.digest(body_one, 'sha256'), 'hex');
  digest_other := encode(extensions.digest(body_other, 'sha256'), 'hex');
  digest_length := encode(extensions.digest(body_length, 'sha256'), 'hex');
  if pg_catalog.octet_length(body_wrong_digest) <>
      pg_catalog.octet_length(body_other)
    or encode(extensions.digest(body_wrong_digest, 'sha256'), 'hex') =
      digest_other
  then
    raise exception 'wrong digest fixture is not isolated';
  end if;

  insert into auth.users(
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
  ) values (
    profile_id, '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'provider-evidence-probe-' || fixture_key || '@example.test',
    '', now(), '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb, now(), now()
  );
  insert into public.markets(id, slug, name, is_active)
  values (
    market_id, 'evidence-probe-' || fixture_key,
    'Provider evidence probe market', true
  );
  insert into public.businesses(id, market_id, name, slug, status)
  values (
    business_id, market_id, 'Provider evidence probe business',
    'evidence-probe-business-' || fixture_key, 'active'
  );
  insert into public.orders(
    id, order_number, buyer_id, business_id, market_id,
    status, currency_code, subtotal_minor, total_minor
  ) values (
    order_id, 'EVIDENCE-PROBE-' || fixture_key,
    profile_id, business_id, market_id, 'placed', 'NGN', 100, 100
  );

  execute 'alter table private.order_payment_states '
    || 'disable trigger order_payment_states_dormant_rows';
  insert into private.order_payment_states(
    id, order_id, payer_id, business_id, market_id, state,
    expected_amount_minor, currency_code,
    order_snapshot_version, order_snapshot_sha256
  ) values (
    payment_state_id, order_id, profile_id, business_id, market_id, 'unpaid',
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
    attempt_id, payment_state_id, 'probe', 'test', provider_reference,
    repeat('b', 64), 'succeeded', 100, 'NGN', 1, repeat('a', 64)
  );
  execute 'alter table private.payment_attempts '
    || 'enable trigger payment_attempts_dormant_rows';

  -- B1 must continue to preserve every real success while allowing only one
  -- primary application. A second success remains representable as excess.
  execute 'alter table private.payment_attempts '
    || 'disable trigger payment_attempts_dormant_rows';
  insert into private.payment_attempts(
    id, order_payment_state_id, provider_code, provider_environment,
    provider_reference, idempotency_key_sha256, status,
    expected_amount_minor, currency_code,
    order_snapshot_version, order_snapshot_sha256
  ) values (
    attempt_two_id, payment_state_id, 'probe', 'test',
    'probe-reference-two-' || fixture_key, repeat('9', 64), 'succeeded',
    100, 'NGN', 1, repeat('a', 64)
  );
  execute 'alter table private.payment_attempts '
    || 'enable trigger payment_attempts_dormant_rows';

  execute 'alter table private.payment_applications '
    || 'disable trigger payment_applications_dormant_rows';
  insert into private.payment_applications(
    order_payment_state_id, payment_attempt_id, attempt_status, kind,
    expected_amount_minor, currency_code,
    order_snapshot_version, order_snapshot_sha256
  ) values (
    payment_state_id, attempt_id, 'succeeded', 'primary_order_payment',
    100, 'NGN', 1, repeat('a', 64)
  );
  begin
    insert into private.payment_applications(
      order_payment_state_id, payment_attempt_id, attempt_status, kind,
      expected_amount_minor, currency_code,
      order_snapshot_version, order_snapshot_sha256
    ) values (
      payment_state_id, attempt_two_id, 'succeeded', 'primary_order_payment',
      100, 'NGN', 1, repeat('a', 64)
    );
    raise exception 'second primary application unexpectedly worked';
  exception when unique_violation then null;
  end;
  insert into private.payment_applications(
    order_payment_state_id, payment_attempt_id, attempt_status, kind,
    expected_amount_minor, currency_code,
    order_snapshot_version, order_snapshot_sha256
  ) values (
    payment_state_id, attempt_two_id, 'succeeded', 'unapplied_excess',
    100, 'NGN', 1, repeat('a', 64)
  );
  execute 'alter table private.payment_applications '
    || 'enable trigger payment_applications_dormant_rows';

  execute 'alter table private.provider_evidence_deliveries '
    || 'disable trigger provider_evidence_deliveries_dormant_rows';
  execute 'alter table private.provider_evidence_raw_payloads '
    || 'disable trigger provider_evidence_raw_payloads_dormant_rows';
  execute 'alter table private.provider_normalized_events '
    || 'disable trigger provider_normalized_events_dormant_rows';

  insert into private.provider_evidence_deliveries(
    id, provider_code, provider_environment, digest_version,
    raw_body_sha256, raw_body_bytes, signature_method, signature_sha256,
    signature_key_version, verifier_version, provider_delivery_id,
    content_type, received_at, signature_verified_at
  ) values (
    delivery_one_id, 'probe', 'test', 1,
    digest_one, pg_catalog.octet_length(body_one),
    'hmac_sha512', repeat('c', 64), 'v1', 1, 'probe-delivery-one',
    'application/json', now() - interval '2 seconds',
    now() - interval '1 second'
  );

  -- The same exact body is a distinct delivery in a different environment.
  insert into private.provider_evidence_deliveries(
    id, provider_code, provider_environment, digest_version,
    raw_body_sha256, raw_body_bytes, signature_method, signature_sha256,
    signature_key_version, verifier_version, provider_delivery_id,
    content_type, received_at, signature_verified_at
  ) values (
    delivery_live_id, 'probe', 'live', 1,
    digest_one, pg_catalog.octet_length(body_one),
    'hmac_sha512', repeat('c', 64), 'v1', 1, 'probe-delivery-live',
    'application/json', now() - interval '2 seconds',
    now() - interval '1 second'
  );

  insert into private.provider_evidence_deliveries(
    id, provider_code, provider_environment, digest_version,
    raw_body_sha256, raw_body_bytes, signature_method, signature_sha256,
    signature_key_version, verifier_version, provider_delivery_id,
    content_type, received_at, signature_verified_at
  ) values (
    delivery_other_id, 'probe', 'test', 1,
    digest_other, pg_catalog.octet_length(body_other),
    'hmac_sha512', repeat('e', 64), 'v1', 1, 'probe-delivery-other',
    'application/json', now() - interval '2 seconds',
    now() - interval '1 second'
  );

  insert into private.provider_evidence_deliveries(
    id, provider_code, provider_environment, digest_version,
    raw_body_sha256, raw_body_bytes, signature_method, signature_sha256,
    signature_key_version, verifier_version, provider_delivery_id,
    content_type, received_at, signature_verified_at
  ) values (
    delivery_length_id, 'probe', 'test', 1,
    digest_length, pg_catalog.octet_length(body_length) + 1,
    'hmac_sha512', repeat('f', 64), 'v1', 1, 'probe-delivery-length',
    'application/json', now() - interval '2 seconds',
    now() - interval '1 second'
  );

  begin
    insert into private.provider_evidence_deliveries(
      provider_code, provider_environment, digest_version,
      raw_body_sha256, raw_body_bytes, signature_method, signature_sha256,
      signature_key_version, verifier_version, provider_delivery_id,
      content_type, received_at, signature_verified_at
    ) values (
      'probe', 'test', 1, digest_one, pg_catalog.octet_length(body_one),
      'hmac_sha512', repeat('1', 64), 'v2', 2, 'different-delivery-id',
      'application/json', now() - interval '2 seconds',
      now() - interval '1 second'
    );
    raise exception 'duplicate exact delivery unexpectedly worked';
  exception when unique_violation then null;
  end;

  if (
    select count(*)
    from private.provider_evidence_deliveries
    where provider_code = 'probe'
      and raw_body_sha256 = digest_one
      and provider_environment in ('test', 'live')
  ) <> 2 then
    raise exception 'provider environment distinction failed';
  end if;

  insert into private.provider_evidence_raw_payloads(
    delivery_id, digest_version, raw_body_sha256, raw_body_bytes,
    raw_body, purge_after
  ) values (
    delivery_one_id, 1, digest_one, pg_catalog.octet_length(body_one),
    body_one, now() + interval '1 day'
  );
  insert into private.provider_evidence_raw_payloads(
    delivery_id, digest_version, raw_body_sha256, raw_body_bytes,
    raw_body, purge_after
  ) values (
    delivery_live_id, 1, digest_one, pg_catalog.octet_length(body_one),
    body_one, now() + interval '1 day'
  );

  begin
    insert into private.provider_evidence_raw_payloads(
      delivery_id, digest_version, raw_body_sha256, raw_body_bytes,
      raw_body, purge_after
    ) values (
      delivery_other_id, 1, digest_other, pg_catalog.octet_length(body_other),
      body_wrong_digest, now() + interval '1 day'
    );
    raise exception 'wrong digest unexpectedly worked';
  exception when check_violation then null;
  end;
  insert into private.provider_evidence_raw_payloads(
    delivery_id, digest_version, raw_body_sha256, raw_body_bytes,
    raw_body, purge_after
  ) values (
    delivery_other_id, 1, digest_other, pg_catalog.octet_length(body_other),
    body_other, now() + interval '1 day'
  );

  begin
    insert into private.provider_evidence_raw_payloads(
      delivery_id, digest_version, raw_body_sha256, raw_body_bytes,
      raw_body, purge_after
    ) values (
      delivery_length_id, 1, digest_length,
      pg_catalog.octet_length(body_length) + 1,
      body_length, now() + interval '1 day'
    );
    raise exception 'wrong byte length unexpectedly worked';
  exception when check_violation then null;
  end;

  insert into private.provider_normalized_events(
    id, delivery_id, event_index, normalizer_version,
    provider_code, provider_environment, normalization_outcome,
    provider_event_kind, provider_resource_kind, provider_resource_id,
    provider_reference, payment_attempt_id, provider_status,
    observed_amount_minor, observed_currency_code,
    semantic_key_version, semantic_key_sha256
  ) values (
    normalized_event_id, delivery_one_id, 0, 1,
    'probe', 'test', 'matched_attempt',
    'charge.success', 'charge', 'probe-resource-one',
    provider_reference, attempt_id, 'success', 100, 'NGN',
    1, semantic_one
  );

  begin
    insert into private.provider_normalized_events(
      delivery_id, event_index, normalizer_version,
      provider_code, provider_environment, normalization_outcome,
      provider_event_kind, provider_resource_kind,
      provider_reference, payment_attempt_id,
      semantic_key_version, semantic_key_sha256
    ) values (
      delivery_one_id, 0, 1,
      'probe', 'test', 'matched_attempt',
      'charge.success', 'charge', provider_reference, attempt_id,
      1, repeat('2', 64)
    );
    raise exception 'duplicate exact delivery event unexpectedly worked';
  exception when unique_violation then null;
  end;

  begin
    insert into private.provider_normalized_events(
      delivery_id, event_index, normalizer_version,
      provider_code, provider_environment, normalization_outcome,
      provider_event_kind, provider_resource_kind,
      provider_reference, payment_attempt_id,
      semantic_key_version, semantic_key_sha256
    ) values (
      delivery_other_id, 0, 1,
      'probe', 'test', 'matched_attempt',
      'charge.success', 'charge', provider_reference, attempt_id,
      1, semantic_one
    );
    raise exception 'semantic duplicate unexpectedly worked';
  exception when unique_violation then null;
  end;

  insert into private.provider_normalized_events(
    delivery_id, event_index, normalizer_version,
    provider_code, provider_environment, normalization_outcome,
    provider_event_kind, provider_resource_kind, provider_reference,
    semantic_key_version, semantic_key_sha256
  ) values (
    delivery_other_id, 1, 1,
    'probe', 'test', 'quarantined_unknown_reference',
    'charge.success', 'charge', 'unknown-reference-' || fixture_key,
    1, repeat('3', 64)
  );
  insert into private.provider_normalized_events(
    delivery_id, event_index, normalizer_version,
    provider_code, provider_environment, normalization_outcome,
    provider_event_kind, provider_resource_kind
  ) values (
    delivery_other_id, 2, 1,
    'probe', 'test', 'quarantined_missing_reference',
    'charge.success', 'charge'
  );
  insert into private.provider_normalized_events(
    delivery_id, event_index, normalizer_version,
    provider_code, provider_environment, normalization_outcome,
    provider_event_kind, provider_resource_kind
  ) values (
    delivery_other_id, 3, 1,
    'probe', 'test', 'quarantined_malformed_reference',
    'charge.success', 'charge'
  );
  insert into private.provider_normalized_events(
    delivery_id, event_index, normalizer_version,
    provider_code, provider_environment, normalization_outcome,
    provider_event_kind, provider_resource_kind, provider_reference,
    observed_amount_minor, observed_currency_code
  ) values (
    delivery_other_id, 4, 1,
    'probe', 'test', 'quarantined_unsupported_event',
    'future.event', 'charge', provider_reference, 0, 'NGN'
  );

  begin
    insert into private.provider_normalized_events(
      delivery_id, event_index, normalizer_version,
      provider_code, provider_environment, normalization_outcome,
      provider_event_kind, provider_resource_kind,
      provider_reference, payment_attempt_id,
      semantic_key_version, semantic_key_sha256
    ) values (
      delivery_other_id, 5, 1,
      'probe', 'test', 'matched_attempt',
      'charge.success', 'charge', 'wrong-reference-' || fixture_key, attempt_id,
      1, repeat('4', 64)
    );
    raise exception 'wrong exact attempt binding unexpectedly worked';
  exception when foreign_key_violation then null;
  end;

  begin
    insert into private.provider_normalized_events(
      delivery_id, event_index, normalizer_version,
      provider_code, provider_environment, normalization_outcome,
      provider_event_kind, provider_resource_kind,
      provider_reference, payment_attempt_id
    ) values (
      delivery_other_id, 6, 1,
      'probe', 'test', 'matched_attempt',
      'charge.success', 'charge', provider_reference, attempt_id
    );
    raise exception 'matched attempt without semantic key unexpectedly worked';
  exception when check_violation then null;
  end;

  begin
    insert into private.provider_normalized_events(
      delivery_id, event_index, normalizer_version,
      provider_code, provider_environment, normalization_outcome,
      provider_event_kind, provider_resource_kind,
      provider_reference, payment_attempt_id
    ) values (
      delivery_other_id, 9, 1,
      'probe', 'test', 'quarantined_unsupported_event',
      'future.event', 'charge', provider_reference, attempt_id
    );
    raise exception 'non-matched outcome with attempt id unexpectedly worked';
  exception when check_violation then null;
  end;

  begin
    insert into private.provider_normalized_events(
      delivery_id, event_index, normalizer_version,
      provider_code, provider_environment, normalization_outcome,
      provider_event_kind, provider_resource_kind, observed_currency_code
    ) values (
      delivery_other_id, 10, 1,
      'probe', 'test', 'quarantined_missing_reference',
      'charge.success', 'charge', 'NGN'
    );
    raise exception 'currency without amount unexpectedly worked';
  exception when check_violation then null;
  end;

  begin
    insert into private.provider_normalized_events(
      delivery_id, event_index, normalizer_version,
      provider_code, provider_environment, normalization_outcome,
      provider_event_kind, provider_resource_kind, observed_amount_minor
    ) values (
      delivery_other_id, 7, 1,
      'probe', 'test', 'quarantined_missing_reference',
      'charge.success', 'charge', 0
    );
    raise exception 'amount without currency unexpectedly worked';
  exception when check_violation then null;
  end;

  begin
    insert into private.provider_normalized_events(
      delivery_id, event_index, normalizer_version,
      provider_code, provider_environment, normalization_outcome,
      provider_event_kind, provider_resource_kind, semantic_key_version
    ) values (
      delivery_other_id, 8, 1,
      'probe', 'test', 'quarantined_missing_reference',
      'charge.success', 'charge', 1
    );
    raise exception 'semantic version without digest unexpectedly worked';
  exception when check_violation then null;
  end;

  -- Exact bytes are separately purgeable without deleting the envelope.
  delete from private.provider_evidence_raw_payloads
  where delivery_id = delivery_one_id;
  if not exists (
    select 1 from private.provider_evidence_deliveries
    where id = delivery_one_id
  ) then
    raise exception 'payload purge removed its delivery envelope';
  end if;
  insert into private.provider_evidence_raw_payloads(
    delivery_id, digest_version, raw_body_sha256, raw_body_bytes,
    raw_body, purge_after
  ) values (
    delivery_one_id, 1, digest_one, pg_catalog.octet_length(body_one),
    body_one, now() + interval '1 day'
  );

  execute 'alter table private.provider_evidence_deliveries '
    || 'enable trigger provider_evidence_deliveries_dormant_rows';
  execute 'alter table private.provider_evidence_raw_payloads '
    || 'enable trigger provider_evidence_raw_payloads_dormant_rows';
  execute 'alter table private.provider_normalized_events '
    || 'enable trigger provider_normalized_events_dormant_rows';

  insert into provider_evidence_dormant_probe_state values (
    profile_id, market_id, business_id, order_id,
    payment_state_id, attempt_id, delivery_one_id,
    digest_one, pg_catalog.octet_length(body_one), normalized_event_id
  );
end;
$$;

do $$
declare
  state provider_evidence_dormant_probe_state%rowtype;
  expected_message constant text := 'provider evidence is dormant';
begin
  select * into strict state from provider_evidence_dormant_probe_state;

  begin
    update private.provider_evidence_deliveries
    set content_type = content_type where id = state.delivery_id;
    raise exception 'dormant provider delivery update unexpectedly worked';
  exception when others then
    if sqlstate <> '55000' or sqlerrm <> expected_message then raise; end if;
  end;
  begin
    delete from private.provider_evidence_deliveries
    where id = state.delivery_id;
    raise exception 'dormant provider delivery delete unexpectedly worked';
  exception when others then
    if sqlstate <> '55000' or sqlerrm <> expected_message then raise; end if;
  end;

  begin
    update private.provider_evidence_raw_payloads
    set purge_after = purge_after where delivery_id = state.delivery_id;
    raise exception 'dormant raw payload update unexpectedly worked';
  exception when others then
    if sqlstate <> '55000' or sqlerrm <> expected_message then raise; end if;
  end;
  begin
    delete from private.provider_evidence_raw_payloads
    where delivery_id = state.delivery_id;
    raise exception 'dormant raw payload delete unexpectedly worked';
  exception when others then
    if sqlstate <> '55000' or sqlerrm <> expected_message then raise; end if;
  end;

  begin
    update private.provider_normalized_events
    set provider_status = provider_status where id = state.normalized_event_id;
    raise exception 'dormant normalized event update unexpectedly worked';
  exception when others then
    if sqlstate <> '55000' or sqlerrm <> expected_message then raise; end if;
  end;
  begin
    delete from private.provider_normalized_events
    where id = state.normalized_event_id;
    raise exception 'dormant normalized event delete unexpectedly worked';
  exception when others then
    if sqlstate <> '55000' or sqlerrm <> expected_message then raise; end if;
  end;

  begin
    truncate private.provider_normalized_events;
    raise exception 'dormant normalized event truncate unexpectedly worked';
  exception when others then
    if sqlstate <> '55000' or sqlerrm <> expected_message then raise; end if;
  end;
  begin
    truncate private.provider_evidence_raw_payloads;
    raise exception 'dormant raw payload truncate unexpectedly worked';
  exception when others then
    if sqlstate <> '55000' or sqlerrm <> expected_message then raise; end if;
  end;
  begin
    truncate private.provider_evidence_deliveries;
    raise exception 'dormant provider delivery truncate unexpectedly worked';
  exception when others then
    if sqlstate = '55000' then
      if sqlerrm <> expected_message then raise; end if;
    elsif sqlstate <> '0A000' then
      raise;
    end if;
  end;
end;
$$;

-- Remove every fixture before rollback as a zero-residue assertion.
do $$
declare
  state provider_evidence_dormant_probe_state%rowtype;
begin
  select * into strict state from provider_evidence_dormant_probe_state;

  execute 'alter table private.provider_normalized_events '
    || 'disable trigger provider_normalized_events_dormant_rows';
  execute 'alter table private.provider_evidence_raw_payloads '
    || 'disable trigger provider_evidence_raw_payloads_dormant_rows';
  execute 'alter table private.provider_evidence_deliveries '
    || 'disable trigger provider_evidence_deliveries_dormant_rows';
  delete from private.provider_normalized_events;
  delete from private.provider_evidence_raw_payloads;
  delete from private.provider_evidence_deliveries;
  execute 'alter table private.provider_normalized_events '
    || 'enable trigger provider_normalized_events_dormant_rows';
  execute 'alter table private.provider_evidence_raw_payloads '
    || 'enable trigger provider_evidence_raw_payloads_dormant_rows';
  execute 'alter table private.provider_evidence_deliveries '
    || 'enable trigger provider_evidence_deliveries_dormant_rows';

  execute 'alter table private.payment_attempts '
    || 'disable trigger payment_attempts_dormant_rows';
  execute 'alter table private.payment_applications '
    || 'disable trigger payment_applications_dormant_rows';
  execute 'alter table private.order_payment_states '
    || 'disable trigger order_payment_states_dormant_rows';
  delete from private.payment_applications
  where order_payment_state_id = state.payment_state_id;
  delete from private.payment_attempts
  where order_payment_state_id = state.payment_state_id;
  delete from private.order_payment_states where id = state.payment_state_id;
  execute 'alter table private.payment_applications '
    || 'enable trigger payment_applications_dormant_rows';
  execute 'alter table private.payment_attempts '
    || 'enable trigger payment_attempts_dormant_rows';
  execute 'alter table private.order_payment_states '
    || 'enable trigger order_payment_states_dormant_rows';

  delete from public.orders where id = state.order_id;
  delete from public.businesses where id = state.business_id;
  delete from public.markets where id = state.market_id;
  delete from auth.users where id = state.profile_id;

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
    raise exception 'provider evidence probe left finance residue';
  end if;
end;
$$;

rollback;

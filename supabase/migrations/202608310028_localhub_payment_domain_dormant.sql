-- Step 23 Slice B1 adds typed provider-neutral payment-domain structure only.
-- Every new table is empty, inaccessible and mutation-blocked. This migration
-- creates no external integration, account, journal or callable money command.

lock table
  public.payments,
  public.payment_events,
  public.webhook_inbox,
  public.ledger_accounts,
  public.ledger_journals,
  public.ledger_entries,
  public.referral_commissions
in share row exclusive mode;

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
    raise exception
      'payment domain migration requires quarantine; reconciliation is required'
      using errcode = '55000';
  end if;

  if pg_catalog.to_regclass('private.order_payment_states') is not null
    or pg_catalog.to_regclass('private.payment_attempts') is not null
    or pg_catalog.to_regclass('private.payment_applications') is not null
    or pg_catalog.to_regtype('private.order_payment_state_code') is not null
    or pg_catalog.to_regtype('private.payment_attempt_state_code') is not null
    or pg_catalog.to_regtype('private.payment_environment_code') is not null
    or pg_catalog.to_regtype('private.payment_application_kind') is not null
    or pg_catalog.to_regprocedure(
      'private.prevent_dormant_payment_domain_mutation()'
    ) is not null
    or exists (
      select 1
      from pg_catalog.pg_constraint constraint_record
      where constraint_record.conrelid = 'public.orders'::pg_catalog.regclass
        and constraint_record.conname = 'orders_payment_identity_unique'
    )
  then
    raise exception
      'payment domain migration requires quarantine; partial objects exist'
      using errcode = '55000';
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
          raise exception
            'payment domain migration requires quarantine; % retains % on %',
            role_name, privilege_name, table_name
            using errcode = '55000';
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
          raise exception
            'payment domain migration requires quarantine; % retains column % on %',
            role_name, privilege_name, table_name
            using errcode = '55000';
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
        raise exception
          'payment domain migration requires quarantine; % retains execute on %',
          role_name, signature
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
  ) then
    raise exception
      'payment domain migration requires quarantine; evidence guard is missing'
      using errcode = '55000';
  end if;
end;
$$;

create type private.order_payment_state_code as enum (
  'unpaid',
  'payment_pending',
  'paid',
  'partially_refunded',
  'refunded'
);
create type private.payment_attempt_state_code as enum (
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
);
create type private.payment_environment_code as enum ('test', 'live');
create type private.payment_application_kind as enum (
  'primary_order_payment',
  'unapplied_excess'
);

revoke all on type private.order_payment_state_code
  from public, anon, authenticated, service_role;
revoke all on type private.payment_attempt_state_code
  from public, anon, authenticated, service_role;
revoke all on type private.payment_environment_code
  from public, anon, authenticated, service_role;
revoke all on type private.payment_application_kind
  from public, anon, authenticated, service_role;

alter table public.orders
  add constraint orders_payment_identity_unique
  unique (id, buyer_id, business_id, market_id, total_minor, currency_code);

create table private.order_payment_states (
  id uuid primary key default extensions.gen_random_uuid(),
  order_id uuid not null,
  payer_id uuid not null references public.profiles(id) on delete restrict,
  business_id uuid not null references public.businesses(id) on delete restrict,
  market_id uuid not null references public.markets(id) on delete restrict,
  state private.order_payment_state_code not null default 'unpaid',
  expected_amount_minor bigint not null check (
    expected_amount_minor > 0
    and expected_amount_minor <= 9007199254740991
  ),
  currency_code char(3) not null check (currency_code ~ '^[A-Z]{3}$'),
  order_snapshot_version smallint not null check (order_snapshot_version > 0),
  order_snapshot_sha256 text not null check (
    order_snapshot_sha256 ~ '^[0-9a-f]{64}$'
  ),
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint order_payment_states_order_unique unique (order_id),
  constraint order_payment_states_snapshot_identity_unique unique (
    id,
    expected_amount_minor,
    currency_code,
    order_snapshot_version,
    order_snapshot_sha256
  ),
  constraint order_payment_states_order_identity_fkey foreign key (
    order_id,
    payer_id,
    business_id,
    market_id,
    expected_amount_minor,
    currency_code
  ) references public.orders(
    id,
    buyer_id,
    business_id,
    market_id,
    total_minor,
    currency_code
  ) on delete restrict,
  constraint order_payment_states_timestamps check (updated_at >= created_at)
);

create index order_payment_states_payer_idx
  on private.order_payment_states(payer_id);
create index order_payment_states_business_state_created_idx
  on private.order_payment_states(business_id, state, created_at desc);
create index order_payment_states_market_idx
  on private.order_payment_states(market_id);

create table private.payment_attempts (
  id uuid primary key default extensions.gen_random_uuid(),
  order_payment_state_id uuid not null,
  provider_code text not null check (
    provider_code ~ '^[a-z][a-z0-9_-]{1,31}$'
  ),
  provider_environment private.payment_environment_code not null,
  provider_reference text not null check (
    pg_catalog.char_length(provider_reference) between 8 and 160
    and provider_reference = pg_catalog.btrim(provider_reference)
    and provider_reference !~ '[[:cntrl:]]'
  ),
  idempotency_key_sha256 text not null check (
    idempotency_key_sha256 ~ '^[0-9a-f]{64}$'
  ),
  status private.payment_attempt_state_code not null default 'created',
  expected_amount_minor bigint not null check (
    expected_amount_minor > 0
    and expected_amount_minor <= 9007199254740991
  ),
  currency_code char(3) not null check (currency_code ~ '^[A-Z]{3}$'),
  order_snapshot_version smallint not null check (order_snapshot_version > 0),
  order_snapshot_sha256 text not null check (
    order_snapshot_sha256 ~ '^[0-9a-f]{64}$'
  ),
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payment_attempts_provider_reference_unique unique (
    provider_code,
    provider_environment,
    provider_reference
  ),
  constraint payment_attempts_idempotency_unique unique (
    order_payment_state_id,
    idempotency_key_sha256
  ),
  constraint payment_attempts_application_identity_unique unique (
    id,
    order_payment_state_id,
    status,
    expected_amount_minor,
    currency_code,
    order_snapshot_version,
    order_snapshot_sha256
  ),
  constraint payment_attempts_state_snapshot_fkey foreign key (
    order_payment_state_id,
    expected_amount_minor,
    currency_code,
    order_snapshot_version,
    order_snapshot_sha256
  ) references private.order_payment_states(
    id,
    expected_amount_minor,
    currency_code,
    order_snapshot_version,
    order_snapshot_sha256
  ) on delete restrict,
  constraint payment_attempts_timestamps check (updated_at >= created_at)
);

create index payment_attempts_state_created_idx
  on private.payment_attempts(order_payment_state_id, created_at desc);

create table private.payment_applications (
  id uuid primary key default extensions.gen_random_uuid(),
  order_payment_state_id uuid not null,
  payment_attempt_id uuid not null,
  attempt_status private.payment_attempt_state_code not null
    default 'succeeded'
    check (attempt_status = 'succeeded'),
  kind private.payment_application_kind not null,
  expected_amount_minor bigint not null check (
    expected_amount_minor > 0
    and expected_amount_minor <= 9007199254740991
  ),
  currency_code char(3) not null check (currency_code ~ '^[A-Z]{3}$'),
  order_snapshot_version smallint not null check (order_snapshot_version > 0),
  order_snapshot_sha256 text not null check (
    order_snapshot_sha256 ~ '^[0-9a-f]{64}$'
  ),
  created_at timestamptz not null default now(),
  constraint payment_applications_attempt_unique unique (payment_attempt_id),
  constraint payment_applications_succeeded_attempt_fkey foreign key (
    payment_attempt_id,
    order_payment_state_id,
    attempt_status,
    expected_amount_minor,
    currency_code,
    order_snapshot_version,
    order_snapshot_sha256
  ) references private.payment_attempts(
    id,
    order_payment_state_id,
    status,
    expected_amount_minor,
    currency_code,
    order_snapshot_version,
    order_snapshot_sha256
  ) on delete restrict
);

create unique index payment_applications_one_primary_idx
  on private.payment_applications(order_payment_state_id)
  where kind = 'primary_order_payment';
create index payment_applications_state_kind_created_idx
  on private.payment_applications(order_payment_state_id, kind, created_at desc);

alter table private.order_payment_states enable row level security;
alter table private.order_payment_states force row level security;
alter table private.payment_attempts enable row level security;
alter table private.payment_attempts force row level security;
alter table private.payment_applications enable row level security;
alter table private.payment_applications force row level security;

revoke all on table private.order_payment_states
  from public, anon, authenticated, service_role;
revoke all on table private.payment_attempts
  from public, anon, authenticated, service_role;
revoke all on table private.payment_applications
  from public, anon, authenticated, service_role;

create or replace function private.prevent_dormant_payment_domain_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'payment domain is dormant' using errcode = '55000';
end;
$$;

revoke all on function private.prevent_dormant_payment_domain_mutation()
  from public, anon, authenticated, service_role;

create trigger order_payment_states_dormant_rows
before insert or update or delete on private.order_payment_states
for each row execute function private.prevent_dormant_payment_domain_mutation();
create trigger order_payment_states_dormant_truncate
before truncate on private.order_payment_states
for each statement execute function private.prevent_dormant_payment_domain_mutation();

create trigger payment_attempts_dormant_rows
before insert or update or delete on private.payment_attempts
for each row execute function private.prevent_dormant_payment_domain_mutation();
create trigger payment_attempts_dormant_truncate
before truncate on private.payment_attempts
for each statement execute function private.prevent_dormant_payment_domain_mutation();

create trigger payment_applications_dormant_rows
before insert or update or delete on private.payment_applications
for each row execute function private.prevent_dormant_payment_domain_mutation();
create trigger payment_applications_dormant_truncate
before truncate on private.payment_applications
for each statement execute function private.prevent_dormant_payment_domain_mutation();

comment on table private.order_payment_states is
  'Dormant provider-neutral order payment state. No writer or projection is active.';
comment on table private.payment_attempts is
  'Dormant provider-neutral payment attempt identity. No adapter or writer is active.';
comment on table private.payment_applications is
  'Dormant successful-attempt application structure. No order value is advanced.';

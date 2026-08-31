-- Rollback-only live regression probe for
-- 202608300027_localhub_finance_quarantine.sql. It verifies the dormant
-- boundary without retaining a finance row or activating a provider path.

begin;

do $$
declare
  table_name text;
  role_name text;
  privilege_name text;
begin
  foreach table_name in array array[
    'payments',
    'payment_events',
    'webhook_inbox',
    'ledger_accounts',
    'ledger_journals',
    'ledger_entries',
    'referral_commissions'
  ] loop
    if exists (
      select 1
      from pg_catalog.pg_class relation
      join pg_catalog.pg_namespace namespace
        on namespace.oid = relation.relnamespace
      where namespace.nspname = 'public'
        and relation.relname = table_name
        and not relation.relrowsecurity
    ) or exists (
      select 1
      from pg_catalog.pg_policies
      where schemaname = 'public' and tablename = table_name
    ) then
      raise exception '% is not deny-by-default under RLS', table_name;
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
          role_name, 'public.' || table_name, privilege_name
        ) then
          raise exception '% retained direct % on %',
            role_name, privilege_name, table_name;
        end if;
      end loop;

      foreach privilege_name in array array[
        'select', 'insert', 'update', 'references'
      ] loop
        if pg_catalog.has_any_column_privilege(
          role_name, 'public.' || table_name, privilege_name
        ) then
          raise exception '% retained effective column % on %',
            role_name, privilege_name, table_name;
        end if;
      end loop;
    end loop;
  end loop;

  if exists (select 1 from public.payments)
    or exists (select 1 from public.payment_events)
    or exists (select 1 from public.webhook_inbox)
    or exists (select 1 from public.ledger_accounts)
    or exists (select 1 from public.ledger_journals)
    or exists (select 1 from public.ledger_entries)
    or exists (select 1 from public.referral_commissions)
  then
    raise exception 'hosted finance baseline is not empty';
  end if;
end;
$$;

do $$
declare
  signature text;
  role_name text;
  routine pg_catalog.pg_proc%rowtype;
begin
  foreach signature in array array[
    'public.post_journal(text,text,uuid,text,jsonb)',
    'public.reverse_posted_journal(uuid,text,text)',
    'public.journal_matches_lines(uuid,jsonb)',
    'public.reversal_matches_original(uuid,uuid)'
  ] loop
    select * into strict routine
    from pg_catalog.pg_proc
    where oid = signature::pg_catalog.regprocedure;

    if not routine.prosecdef
      or not coalesce(routine.proconfig, array[]::text[])
        @> array['search_path=""']::text[]
    then
      raise exception '% lost its fixed-path definer metadata', signature;
    end if;

    foreach role_name in array array['anon', 'authenticated', 'service_role'] loop
      if pg_catalog.has_function_privilege(role_name, signature, 'execute') then
        raise exception '% retained execute on %', role_name, signature;
      end if;
    end loop;
  end loop;

  if exists (
    select 1
    from pg_catalog.pg_proc function
    cross join lateral pg_catalog.aclexplode(
      coalesce(
        function.proacl,
        pg_catalog.acldefault('f', function.proowner)
      )
    ) privilege
    where function.oid in (
      'public.post_journal(text,text,uuid,text,jsonb)'::pg_catalog.regprocedure,
      'public.reverse_posted_journal(uuid,text,text)'::pg_catalog.regprocedure,
      'public.journal_matches_lines(uuid,jsonb)'::pg_catalog.regprocedure,
      'public.reversal_matches_original(uuid,uuid)'::pg_catalog.regprocedure
    )
      and privilege.grantee = 0
      and privilege.privilege_type = 'EXECUTE'
  ) then
    raise exception 'PUBLIC retained generic ledger execute';
  end if;
end;
$$;

do $$
declare
  trigger_function pg_catalog.pg_proc%rowtype;
  owner_name text;
  role_name text;
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_record
    where constraint_record.conname = 'payment_events_payment_id_fkey'
      and constraint_record.conrelid = 'public.payment_events'::pg_catalog.regclass
      and constraint_record.confrelid = 'public.payments'::pg_catalog.regclass
      and constraint_record.contype = 'f'
      and constraint_record.confdeltype = 'r'
      and constraint_record.convalidated
  ) then
    raise exception 'payment evidence foreign key is not restrictive';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_trigger trigger_record
    where trigger_record.tgrelid = 'public.payment_events'::pg_catalog.regclass
      and trigger_record.tgname = 'payment_events_append_only'
      and trigger_record.tgenabled = 'O'
      and not trigger_record.tgisinternal
  ) then
    raise exception 'payment evidence append-only trigger is missing';
  end if;

  select * into strict trigger_function
  from pg_catalog.pg_proc
  where oid = 'private.prevent_payment_event_mutation()'::pg_catalog.regprocedure;
  if not trigger_function.prosecdef
    or not coalesce(trigger_function.proconfig, array[]::text[])
      @> array['search_path=""']::text[]
  then
    raise exception 'payment evidence trigger is not a fixed-path definer';
  end if;

  select owner_role.rolname into owner_name
  from pg_catalog.pg_roles owner_role
  where owner_role.oid = trigger_function.proowner;
  if owner_name is null or owner_name in (
    'anon', 'authenticated', 'authenticator', 'service_role'
  ) then
    raise exception 'payment evidence trigger owner is not trusted';
  end if;

  foreach role_name in array array['anon', 'authenticated', 'service_role'] loop
    if pg_catalog.has_function_privilege(
      role_name,
      'private.prevent_payment_event_mutation()',
      'execute'
    ) then
      raise exception '% retained payment evidence trigger execute', role_name;
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
  ) then
    raise exception 'PUBLIC retained payment evidence trigger execute';
  end if;
end;
$$;

-- Direct service mutation and generic journal execution must remain closed.
set local role service_role;
do $$
begin
  begin
    insert into public.payments(provider, amount_minor)
    values ('quarantine-probe', 1);
    raise exception 'service finance insert unexpectedly worked';
  exception when insufficient_privilege then null;
  end;

  begin
    perform public.post_journal(
      'quarantine-probe-posting-key',
      'quarantine_probe',
      null,
      'must not execute',
      '[]'::jsonb
    );
    raise exception 'generic service journal execution unexpectedly worked';
  exception when insufficient_privilege then null;
  end;
end;
$$;

-- The migration owner can create rollback-only evidence, but cannot mutate or
-- delete it. The restrictive FK also prevents deleting its payment parent.
set local role postgres;
create temporary table finance_quarantine_probe_state (
  payment_id uuid not null,
  event_id uuid not null
) on commit drop;

with payment as (
  insert into public.payments(provider, amount_minor)
  values ('quarantine-probe', 1)
  returning id
), event as (
  insert into public.payment_events(
    payment_id, provider_event_id, event_type, payload
  )
  select id, 'quarantine-probe-event', 'probe', '{}'::jsonb
  from payment
  returning id, payment_id
)
insert into finance_quarantine_probe_state(payment_id, event_id)
select payment_id, id from event;

do $$
declare
  state finance_quarantine_probe_state%rowtype;
  expected_message constant text := 'payment events are append-only';
begin
  select * into strict state from finance_quarantine_probe_state;

  begin
    update public.payment_events
    set event_type = event_type
    where id = state.event_id;
    raise exception 'payment event update unexpectedly worked';
  exception when others then
    if sqlerrm <> expected_message then raise; end if;
  end;

  begin
    delete from public.payment_events where id = state.event_id;
    raise exception 'payment event delete unexpectedly worked';
  exception when others then
    if sqlerrm <> expected_message then raise; end if;
  end;

  begin
    delete from public.payments where id = state.payment_id;
    raise exception 'payment parent delete unexpectedly worked';
  exception when foreign_key_violation then null;
  end;
end;
$$;

rollback;

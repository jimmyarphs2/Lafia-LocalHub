-- Serialize financial state transitions, force journal writes through the
-- audited RPCs, narrow profile updates, and make root location slugs unique.

revoke update on public.profiles from authenticated;
grant update(display_name, avatar_path, default_market_id, phone_e164)
  on public.profiles to authenticated;

alter table public.market_locations
  drop constraint if exists market_locations_market_id_parent_id_slug_key;
alter table public.market_locations
  add constraint market_locations_market_id_parent_id_slug_key
  unique nulls not distinct (market_id, parent_id, slug);

create or replace function public.post_journal(
  p_posting_key text,
  p_reference_type text,
  p_reference_id uuid,
  p_description text,
  p_lines jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_journal_id uuid;
  line jsonb;
  account_ids uuid[];
begin
  if char_length(p_posting_key) not between 16 and 160
    or jsonb_typeof(p_lines) <> 'array'
    or jsonb_array_length(p_lines) not between 2 and 1000
    or pg_column_size(p_lines) > 1048576
  then
    raise exception 'invalid journal';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_posting_key, 0)
  );

  select j.id
  into new_journal_id
  from public.ledger_journals j
  where j.posting_key = p_posting_key
  for no key update;

  if found then
    if not exists (
      select 1
      from public.ledger_journals j
      where j.id = new_journal_id
        and j.posted_at is not null
        and j.reference_type is not distinct from p_reference_type
        and j.reference_id is not distinct from p_reference_id
        and j.description is not distinct from p_description
    ) or not public.journal_matches_lines(new_journal_id, p_lines)
    then
      raise exception 'posting key collision';
    end if;
    return new_journal_id;
  end if;

  for line in select value from jsonb_array_elements(p_lines)
  loop
    if coalesce(line->>'direction', '') not in ('debit', 'credit')
      or coalesce((line->>'amount_minor')::bigint, 0) <= 0
      or coalesce(line->>'currency_code', '') !~ '^[A-Z]{3}$'
    then
      raise exception 'invalid journal line';
    end if;
    begin
      perform (line->>'account_id')::uuid;
    exception when invalid_text_representation then
      raise exception 'invalid journal line';
    end;
  end loop;

  select array_agg(account_id order by account_id)
  into account_ids
  from (
    select distinct (item.value->>'account_id')::uuid as account_id
    from jsonb_array_elements(p_lines) item
  ) requested_accounts;

  perform 1
  from public.ledger_accounts a
  where a.id = any(account_ids)
  order by a.id
  for no key update;

  if exists (
    select 1
    from jsonb_array_elements(p_lines) item
    left join public.ledger_accounts a
      on a.id = (item.value->>'account_id')::uuid
    where a.id is null
      or not a.is_active
      or (
        a.currency_code is not null
        and a.currency_code <> item.value->>'currency_code'
      )
  ) then
    raise exception 'invalid journal account';
  end if;

  insert into public.ledger_journals(
    posting_key,
    reference_type,
    reference_id,
    description
  )
  values (
    p_posting_key,
    p_reference_type,
    p_reference_id,
    p_description
  )
  returning id into new_journal_id;

  for line in select value from jsonb_array_elements(p_lines)
  loop
    insert into public.ledger_entries(
      journal_id,
      account_id,
      direction,
      amount_minor,
      currency_code
    )
    values (
      new_journal_id,
      (line->>'account_id')::uuid,
      (line->>'direction')::public.ledger_direction,
      (line->>'amount_minor')::bigint,
      line->>'currency_code'
    );
  end loop;

  if exists (
    select 1
    from public.ledger_entries e
    where e.journal_id = new_journal_id
    group by e.currency_code
    having count(*) < 2
      or coalesce(
        sum(e.amount_minor) filter (where e.direction = 'debit'),
        0
      ) <> coalesce(
        sum(e.amount_minor) filter (where e.direction = 'credit'),
        0
      )
  ) then
    raise exception 'journal is unbalanced';
  end if;

  update public.ledger_journals
  set posted_at = now()
  where id = new_journal_id;

  return new_journal_id;
end;
$$;

create or replace function public.reverse_posted_journal(
  p_original_journal uuid,
  p_posting_key text,
  p_description text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  original public.ledger_journals%rowtype;
  reversal_id uuid;
  account_ids uuid[];
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_posting_key, 0)
  );

  select *
  into original
  from public.ledger_journals j
  where j.id = p_original_journal
  for no key update;

  if not found or original.posted_at is null then
    raise exception 'only posted journals may be reversed';
  end if;

  select j.id
  into reversal_id
  from public.ledger_journals j
  where j.posting_key = p_posting_key
  for no key update;

  if found then
    if not exists (
      select 1
      from public.ledger_journals j
      where j.id = reversal_id
        and j.posted_at is not null
        and j.reference_type = 'ledger_reversal'
        and j.reference_id is not distinct from original.id
        and j.reversal_of = original.id
        and j.description is not distinct from p_description
    ) or not public.reversal_matches_original(reversal_id, original.id)
    then
      raise exception 'posting key collision';
    end if;
    return reversal_id;
  end if;

  if exists (
    select 1 from public.ledger_journals j
    where j.reversal_of = original.id
  ) then
    raise exception 'journal already reversed';
  end if;

  select array_agg(account_id order by account_id)
  into account_ids
  from (
    select distinct e.account_id
    from public.ledger_entries e
    where e.journal_id = original.id
  ) original_accounts;

  perform 1
  from public.ledger_accounts a
  where a.id = any(account_ids)
  order by a.id
  for no key update;

  insert into public.ledger_journals(
    posting_key,
    reference_type,
    reference_id,
    description,
    reversal_of
  )
  values (
    p_posting_key,
    'ledger_reversal',
    original.id,
    p_description,
    original.id
  )
  returning id into reversal_id;

  insert into public.ledger_entries(
    journal_id,
    account_id,
    direction,
    amount_minor,
    currency_code
  )
  select
    reversal_id,
    e.account_id,
    case
      when e.direction = 'debit' then 'credit'::public.ledger_direction
      else 'debit'::public.ledger_direction
    end,
    e.amount_minor,
    e.currency_code
  from public.ledger_entries e
  where e.journal_id = original.id;

  update public.ledger_journals
  set posted_at = now()
  where id = reversal_id;

  return reversal_id;
end;
$$;

create or replace function public.prevent_posted_ledger_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'ledger_journals'
    and old.posted_at is not null
  then
    raise exception 'posted journals are immutable; post a reversal';
  end if;

  if tg_table_name = 'ledger_entries' then
    if tg_op = 'INSERT' then
      perform 1
      from public.ledger_journals j
      where j.id = new.journal_id
      for no key update;
    elsif tg_op = 'DELETE' then
      perform 1
      from public.ledger_journals j
      where j.id = old.journal_id
      for no key update;
    else
      perform 1
      from public.ledger_journals j
      where j.id in (old.journal_id, new.journal_id)
      order by j.id
      for no key update;
    end if;

    if tg_op = 'INSERT' and exists (
      select 1 from public.ledger_journals j
      where j.id = new.journal_id and j.posted_at is not null
    ) then
      raise exception 'posted entries are immutable; post a reversal';
    end if;
    if tg_op = 'DELETE' and exists (
      select 1 from public.ledger_journals j
      where j.id = old.journal_id and j.posted_at is not null
    ) then
      raise exception 'posted entries are immutable; post a reversal';
    end if;
    if tg_op = 'UPDATE' and (
      exists (
        select 1 from public.ledger_journals j
        where j.id = old.journal_id and j.posted_at is not null
      )
      or exists (
        select 1 from public.ledger_journals j
        where j.id = new.journal_id and j.posted_at is not null
      )
    ) then
      raise exception 'posted entries are immutable; post a reversal';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create or replace function public.validate_ledger_currency()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'ledger_entries' then
    if tg_op = 'UPDATE' then
      perform 1
      from public.ledger_accounts a
      where a.id in (old.account_id, new.account_id)
      order by a.id
      for no key update;
    else
      perform 1
      from public.ledger_accounts a
      where a.id = new.account_id
      for no key update;
    end if;

    if exists (
      select 1
      from public.ledger_accounts a
      where a.id = new.account_id
        and a.currency_code is not null
        and a.currency_code <> new.currency_code
    ) then
      raise exception 'ledger entry currency must match its account';
    end if;
  end if;

  if tg_table_name = 'ledger_accounts'
    and new.currency_code is not null
    and exists (
      select 1
      from public.ledger_entries e
      where e.account_id = new.id
        and e.currency_code <> new.currency_code
    )
  then
    raise exception 'ledger account currency conflicts with existing entries';
  end if;

  return new;
end;
$$;

revoke all privileges on public.ledger_journals, public.ledger_entries
  from service_role;
grant select on public.ledger_journals, public.ledger_entries
  to service_role;

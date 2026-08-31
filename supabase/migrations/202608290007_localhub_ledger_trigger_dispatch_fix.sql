-- PL/pgSQL resolves record fields before boolean short-circuiting. Dispatch by
-- trigger table first so ledger-entry rows never resolve OLD.posted_at.

create or replace function public.prevent_posted_ledger_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'ledger_journals' then
    if old.posted_at is not null then
      raise exception 'posted journals are immutable; post a reversal';
    end if;
  elsif tg_table_name = 'ledger_entries' then
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

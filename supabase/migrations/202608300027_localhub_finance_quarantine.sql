-- Step 23 begins by quarantining the dormant finance foundation. This change
-- deliberately creates no provider route, account, payment, ledger posting or
-- other money-moving capability.

-- The migration runner executes each migration transactionally. Acquire every
-- affected table in one fixed order before checking the zero-data precondition
-- so an in-flight finance writer cannot race the check and later ACL revokes.
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
      'finance quarantine requires empty finance tables; reconciliation is required'
      using errcode = '55000';
  end if;
end;
$$;

revoke all privileges on table
  public.payments,
  public.payment_events,
  public.webhook_inbox,
  public.ledger_accounts,
  public.ledger_journals,
  public.ledger_entries,
  public.referral_commissions
from public, anon, authenticated, service_role;

revoke execute on function public.post_journal(text, text, uuid, text, jsonb)
  from public, anon, authenticated, service_role;
revoke execute on function public.reverse_posted_journal(uuid, text, text)
  from public, anon, authenticated, service_role;
revoke execute on function public.journal_matches_lines(uuid, jsonb)
  from public, anon, authenticated, service_role;
revoke execute on function public.reversal_matches_original(uuid, uuid)
  from public, anon, authenticated, service_role;

alter table public.payment_events
  drop constraint payment_events_payment_id_fkey;
alter table public.payment_events
  add constraint payment_events_payment_id_fkey
  foreign key (payment_id)
  references public.payments(id)
  on delete restrict;

create or replace function private.prevent_payment_event_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'payment events are append-only';
end;
$$;

revoke all on function private.prevent_payment_event_mutation()
  from public, anon, authenticated, service_role;

drop trigger if exists payment_events_append_only on public.payment_events;
create trigger payment_events_append_only
before update or delete on public.payment_events
for each row
execute function private.prevent_payment_event_mutation();

comment on table public.payments is
  'Payment execution remains dormant. No application role may mutate this legacy foundation.';
comment on table public.payment_events is
  'Append-only dormant payment evidence. No provider adapter or application writer is active.';
comment on table public.webhook_inbox is
  'Provider ingress remains dormant. This legacy parsed-payload table is not an active webhook boundary.';
comment on table public.ledger_accounts is
  'Dormant ledger foundation. Account taxonomy and typed posting commands are not active.';
comment on table public.ledger_journals is
  'Dormant ledger foundation. Generic caller-composed journal execution is quarantined.';
comment on table public.ledger_entries is
  'Dormant ledger foundation. Entries may only be produced by a future reviewed typed command.';
comment on table public.referral_commissions is
  'Dormant financial projection. Referral earning, approval and payout are not active.';

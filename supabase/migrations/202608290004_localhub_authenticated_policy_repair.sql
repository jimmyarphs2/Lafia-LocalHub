-- Repair authenticated RLS helper access and operational Realtime reads without
-- exposing arbitrary profile suspension state or writable notification content.

create or replace function public.is_current_profile_active()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and not p.is_suspended
  )
$$;

revoke execute on function public.is_current_profile_active()
  from public, anon, authenticated;
grant execute on function public.is_current_profile_active()
  to authenticated;

drop policy if exists profiles_self_update on public.profiles;
create policy profiles_self_update
  on public.profiles for update to authenticated
  using (
    id = (select auth.uid())
    and (select public.is_current_profile_active())
  )
  with check (id = (select auth.uid()));

drop policy if exists guest_intents_claimed_owner_select on public.guest_intents;
create policy guest_intents_claimed_owner_select
  on public.guest_intents for select to authenticated
  using (
    claimed_by = (select auth.uid())
    and (select public.is_current_profile_active())
  );

drop policy if exists searches_owner_insert on public.searches;
create policy searches_owner_insert
  on public.searches for insert to authenticated
  with check (
    actor_id = (select auth.uid())
    and (select public.is_current_profile_active())
  );

drop policy if exists requests_owner_insert on public.requests;
create policy requests_owner_insert
  on public.requests for insert to authenticated
  with check (
    requester_id = (select auth.uid())
    and (select public.is_current_profile_active())
  );

grant select on public.orders,
  public.order_items,
  public.order_status_events,
  public.fulfilment_events,
  public.notifications
to authenticated;

revoke update on public.notifications from authenticated;
grant update(status, read_at) on public.notifications to authenticated;

drop policy if exists notifications_self_update on public.notifications;
create policy notifications_self_update
  on public.notifications for update to authenticated
  using (profile_id = (select auth.uid()))
  with check (
    profile_id = (select auth.uid())
    and status = 'read'
    and read_at is not null
  );

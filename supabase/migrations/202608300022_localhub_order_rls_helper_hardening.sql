-- Keep the order child-table RLS helper outside every Data API exposed schema.
-- Authenticated callers receive schema USAGE and this one function's EXECUTE
-- privilege only; private tables remain inaccessible.

create or replace function private.can_current_actor_view_order(p_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_order_id is not null
    and public.is_current_profile_active()
    and exists (
      select 1
      from public.orders o
      where o.id = p_order_id
        and (
          o.buyer_id = (select auth.uid())
          or exists (
            select 1
            from public.business_memberships membership
            where membership.business_id = o.business_id
              and membership.profile_id = (select auth.uid())
              and membership.accepted_at is not null
          )
        )
    )
$$;

revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;
revoke all on function private.can_current_actor_view_order(uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.can_current_actor_view_order(uuid)
  to authenticated;

drop policy if exists order_items_active_customer_or_vendor_select
  on public.order_items;
create policy order_items_active_customer_or_vendor_select
  on public.order_items for select to authenticated
  using ((select private.can_current_actor_view_order(order_items.order_id)));

drop policy if exists order_events_active_customer_or_vendor_select
  on public.order_status_events;
create policy order_events_active_customer_or_vendor_select
  on public.order_status_events for select to authenticated
  using ((select private.can_current_actor_view_order(order_status_events.order_id)));

revoke all on function public.can_current_actor_view_order(uuid)
  from public, anon, authenticated, service_role;
drop function public.can_current_actor_view_order(uuid);

comment on function private.can_current_actor_view_order(uuid) is
  'RLS-only active customer or exact accepted-business authorization helper; intentionally outside Data API exposed schemas.';

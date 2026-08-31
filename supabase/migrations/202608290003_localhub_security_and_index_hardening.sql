-- Remove implicit RPC exposure, consolidate overlapping read policies, and
-- index every currently uncovered foreign-key path.

-- Function EXECUTE defaults are global in PostgreSQL. Keep every future RPC
-- private until its migration grants an explicit caller role.
alter default privileges revoke execute on functions from public, anon, authenticated;

revoke execute on function public.transition_business_status(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.transition_business_status(uuid, text, text)
  to authenticated;

revoke execute on function public.set_profile_suspension(uuid, boolean, text)
  from public, anon, authenticated;
grant execute on function public.set_profile_suspension(uuid, boolean, text)
  to authenticated;

-- Keep one permissive SELECT policy per role/action. These expressions preserve
-- the original public and membership visibility while avoiding duplicate work.
drop policy if exists guest_intents_claimed_read on public.guest_intents;

drop policy if exists public_active_businesses on public.businesses;
drop policy if exists businesses_members_select on public.businesses;
create policy public_active_businesses_anon
  on public.businesses for select to anon
  using (
    status = 'active'
    and exists (
      select 1 from public.markets m
      where m.id = market_id and m.is_active
    )
  );
create policy businesses_authenticated_select
  on public.businesses for select to authenticated
  using (
    (
      status = 'active'
      and exists (
        select 1 from public.markets m
        where m.id = market_id and m.is_active
      )
    )
    or (select public.is_business_member(id))
  );

drop policy if exists public_active_listings on public.listings;
drop policy if exists listings_manager_select on public.listings;
create policy public_active_listings_anon
  on public.listings for select to anon
  using (
    status = 'active'
    and exists (
      select 1
      from public.businesses b
      join public.markets m on m.id = b.market_id
      where b.id = business_id
        and b.status = 'active'
        and m.is_active
    )
  );
create policy listings_authenticated_select
  on public.listings for select to authenticated
  using (
    (
      status = 'active'
      and exists (
        select 1
        from public.businesses b
        join public.markets m on m.id = b.market_id
        where b.id = business_id
          and b.status = 'active'
          and m.is_active
      )
    )
    or (select public.is_business_member(business_id))
  );

create index if not exists admin_events_admin_idx
  on public.admin_events(admin_id);
create index if not exists ai_actions_actor_idx
  on public.ai_actions(actor_id);
create index if not exists ai_usage_action_idx
  on public.ai_usage(ai_action_id);
create index if not exists audit_events_actor_idx
  on public.audit_events(actor_id);
create index if not exists business_memberships_invited_by_idx
  on public.business_memberships(invited_by);
create index if not exists business_onboarding_drafts_owner_idx
  on public.business_onboarding_drafts(owner_id);
create index if not exists category_listing_type_mappings_listing_type_idx
  on public.category_listing_type_mappings(listing_type_id);
create index if not exists demand_signals_category_idx
  on public.demand_signals(category_id);
create index if not exists guest_intents_claimed_by_idx
  on public.guest_intents(claimed_by);
create index if not exists guest_intents_market_idx
  on public.guest_intents(market_id);
create index if not exists listings_created_by_idx
  on public.listings(created_by);
create index if not exists mission_progress_profile_idx
  on public.mission_progress(profile_id);
create index if not exists missions_market_idx
  on public.missions(market_id);
create index if not exists order_status_events_actor_idx
  on public.order_status_events(actor_id);
create index if not exists orders_market_idx
  on public.orders(market_id);
create index if not exists payments_payer_idx
  on public.payments(payer_id);
create index if not exists profile_capabilities_granted_by_idx
  on public.profile_capabilities(granted_by);
create index if not exists referral_attributions_guest_intent_idx
  on public.referral_attributions(guest_intent_id);
create index if not exists referral_attributions_referred_profile_idx
  on public.referral_attributions(referred_profile_id);
create index if not exists referral_codes_rule_idx
  on public.referral_codes(rule_id);
create index if not exists referral_commissions_attribution_idx
  on public.referral_commissions(attribution_id);
create index if not exists referral_commissions_order_idx
  on public.referral_commissions(order_id);
create index if not exists referral_commissions_rule_idx
  on public.referral_commissions(rule_id);
create index if not exists referral_rules_market_idx
  on public.referral_rules(market_id);
create index if not exists requests_category_idx
  on public.requests(category_id);
create index if not exists requests_guest_intent_idx
  on public.requests(guest_intent_id);
create index if not exists search_intents_category_idx
  on public.search_intents(category_id);
create index if not exists searches_guest_intent_idx
  on public.searches(guest_intent_id);
create index if not exists unmet_demand_category_idx
  on public.unmet_demand(category_id);

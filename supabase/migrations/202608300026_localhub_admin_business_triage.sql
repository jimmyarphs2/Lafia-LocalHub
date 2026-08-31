-- First Step 22 admin slice: a bounded read-only pending-business queue.
-- No merchant decision or publication mutation is introduced here.

-- Repair the existing strict onboarding validator before reusing it. PostgreSQL
-- exposes jsonb_object_keys but has no jsonb_object_length function; the prior
-- qualified call stayed latent while the hosted onboarding tables were empty.
create or replace function public.is_valid_completed_onboarding_draft(
  target_business uuid,
  draft_data jsonb
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  payload jsonb;
  trim_chars constant text := E' \t\n\r\f' || pg_catalog.chr(11);
begin
  if draft_data is null
    or pg_catalog.jsonb_typeof(draft_data) is distinct from 'object'
  then
    return false;
  end if;
  if (select count(*) from pg_catalog.jsonb_object_keys(draft_data)) <> 2
    or not (draft_data ?& array['onboardingVersion', 'values'])
    or draft_data->'onboardingVersion' is distinct from '1'::jsonb
  then
    return false;
  end if;

  payload := draft_data->'values';
  if pg_catalog.jsonb_typeof(payload) is distinct from 'object' then
    return false;
  end if;
  if (select count(*) from pg_catalog.jsonb_object_keys(payload)) <> 11
    or not (
      payload ?& array[
        'businessName',
        'originalOffering',
        'categorySlug',
        'categoryConfidence',
        'description',
        'phone',
        'whatsapp',
        'email',
        'marketSlug',
        'area',
        'address'
      ]
    )
  then
    return false;
  end if;
  if pg_catalog.jsonb_typeof(payload->'businessName') is distinct from 'string'
    or pg_catalog.jsonb_typeof(payload->'originalOffering') is distinct from 'string'
    or pg_catalog.jsonb_typeof(payload->'categorySlug') is distinct from 'string'
    or pg_catalog.jsonb_typeof(payload->'categoryConfidence') is distinct from 'string'
    or pg_catalog.jsonb_typeof(payload->'description') is distinct from 'string'
    or pg_catalog.jsonb_typeof(payload->'phone') is distinct from 'string'
    or pg_catalog.jsonb_typeof(payload->'whatsapp') is distinct from 'string'
    or pg_catalog.jsonb_typeof(payload->'email') is distinct from 'string'
    or pg_catalog.jsonb_typeof(payload->'marketSlug') is distinct from 'string'
    or pg_catalog.jsonb_typeof(payload->'area') is distinct from 'string'
    or pg_catalog.jsonb_typeof(payload->'address') is distinct from 'string'
  then
    return false;
  end if;

  if char_length(pg_catalog.btrim(payload->>'businessName', trim_chars))
      not between 2 and 120
    or char_length(pg_catalog.btrim(payload->>'originalOffering', trim_chars))
      not between 3 and 240
    or payload->>'categorySlug' not in (
      'food-catering',
      'electronics-repair',
      'photography-media',
      'fashion-tailoring',
      'beauty-personal-care',
      'home-building-services',
      'events-venues',
      'transport-logistics',
      'education-training',
      'other-local-trade'
    )
    or payload->>'categoryConfidence' not in (
      'high',
      'medium',
      'low',
      'unknown'
    )
    or char_length(pg_catalog.btrim(payload->>'description', trim_chars))
      not between 20 and 1500
    or char_length(pg_catalog.btrim(payload->>'phone', trim_chars)) > 30
    or (
      pg_catalog.btrim(payload->>'phone', trim_chars) <> ''
      and pg_catalog.btrim(payload->>'phone', trim_chars)
        !~ '^[+]?[0-9][0-9 ()-]{6,28}$'
    )
    or char_length(pg_catalog.btrim(payload->>'whatsapp', trim_chars)) > 30
    or (
      pg_catalog.btrim(payload->>'whatsapp', trim_chars) <> ''
      and pg_catalog.btrim(payload->>'whatsapp', trim_chars)
        !~ '^[+]?[0-9][0-9 ()-]{6,28}$'
    )
    or char_length(pg_catalog.btrim(payload->>'email', trim_chars)) > 254
    or (
      pg_catalog.btrim(payload->>'email', trim_chars) <> ''
      and pg_catalog.btrim(payload->>'email', trim_chars)
        !~ '^[A-Za-z0-9.!#$%&''*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,63}$'
    )
    or (
      char_length(pg_catalog.btrim(payload->>'phone', trim_chars))
      + char_length(pg_catalog.btrim(payload->>'whatsapp', trim_chars))
      + char_length(pg_catalog.btrim(payload->>'email', trim_chars))
    ) = 0
    or char_length(pg_catalog.btrim(payload->>'area', trim_chars))
      not between 2 and 120
    or char_length(pg_catalog.btrim(payload->>'address', trim_chars)) > 240
  then
    return false;
  end if;

  return exists (
    select 1
    from public.businesses business
    join public.markets market on market.id = business.market_id
    where business.id = target_business
      and market.slug = payload->>'marketSlug'
      and market.is_active
  );
end;
$$;
revoke all on function public.is_valid_completed_onboarding_draft(uuid, jsonb)
  from public, anon, authenticated, service_role;

create index if not exists business_onboarding_drafts_submitted_keyset_idx
  on public.business_onboarding_drafts(submitted_at, business_id)
  where submitted_at is not null and step = 'complete';

-- Retire the legacy global business mutation until an authoritative scoped,
-- expected-state, idempotent and concurrency-safe replacement is approved.
revoke execute on function public.transition_business_status(uuid, text, text)
  from public, anon, authenticated, service_role;

-- Profile suspension remains an authenticated super-admin boundary. It is not
-- a service-role operation and is not exposed by this admin slice.
revoke execute on function public.set_profile_suspension(uuid, boolean, text)
  from service_role;

create or replace function public.prevent_admin_event_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'administrative audit evidence is immutable';
end;
$$;
revoke all on function public.prevent_admin_event_mutation()
  from public, anon, authenticated, service_role;

drop trigger if exists admin_events_deny_mutation on public.admin_events;
create trigger admin_events_deny_mutation
  before update or delete or truncate on public.admin_events
  for each statement execute function public.prevent_admin_event_mutation();

revoke insert, update, delete, truncate on table public.admin_events
  from public, anon, authenticated, service_role;

create or replace function public.list_super_admin_pending_businesses(
  p_market_id uuid,
  p_after_submitted_at timestamptz default null,
  p_after_business_id uuid default null,
  p_limit integer default 25
)
returns table(
  business_id uuid,
  business_name text,
  market_id uuid,
  market_slug text,
  market_name text,
  category_slug text,
  submitted_at timestamptz,
  has_more boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
begin
  if (select auth.role()) is distinct from 'authenticated'
    or actor is null
    or not public.is_current_profile_active()
    or not public.has_capability('super_admin')
    or p_market_id is null
    or p_limit is null
    or p_limit not between 1 and 50
    or ((p_after_submitted_at is null) <> (p_after_business_id is null))
  then
    return;
  end if;

  return query
  with eligible as materialized (
    select
      business.id as business_id,
      business.name as business_name,
      market.id as market_id,
      market.slug as market_slug,
      market.name as market_name,
      draft.data->'values'->>'categorySlug' as category_slug,
      draft.submitted_at as submitted_at
    from public.business_onboarding_drafts draft
    join public.businesses business on business.id = draft.business_id
    join public.markets market on market.id = business.market_id
    where business.market_id = p_market_id
      and business.status = 'pending_review'
      and market.is_active
      and draft.step = 'complete'
      and draft.submitted_at is not null
      and public.is_valid_completed_onboarding_draft(business.id, draft.data)
      and not exists (
        select 1
        from public.business_memberships membership
        where membership.business_id = business.id
          and membership.profile_id = actor
          and membership.accepted_at is not null
      )
      and (
        p_after_submitted_at is null
        or (draft.submitted_at, business.id)
          > (p_after_submitted_at, p_after_business_id)
      )
    order by draft.submitted_at, business.id
    limit p_limit + 1
  ), page as (
    select eligible.*
    from eligible
    order by eligible.submitted_at, eligible.business_id
    limit p_limit
  )
  select
    page.business_id,
    page.business_name,
    page.market_id,
    page.market_slug,
    page.market_name,
    page.category_slug,
    page.submitted_at,
    (select count(*) from eligible) > p_limit as has_more
  from page
  order by page.submitted_at, page.business_id;
end;
$$;

revoke all on function public.list_super_admin_pending_businesses(
  uuid, timestamptz, uuid, integer
) from public, anon, authenticated, service_role;
grant execute on function public.list_super_admin_pending_businesses(
  uuid, timestamptz, uuid, integer
) to authenticated;

comment on function public.list_super_admin_pending_businesses(
  uuid, timestamptz, uuid, integer
) is 'Returns one PII-minimized, read-only pending-business page for an active super-admin and one active market; performs no merchant decision.';

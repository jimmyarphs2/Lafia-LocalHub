-- Bound authenticated tenant creation and draft-write load while preserving a
-- frictionless first onboarding attempt.

create unique index if not exists business_onboarding_drafts_owner_open_idx
  on public.business_onboarding_drafts(owner_id)
  where submitted_at is null;

create or replace function public.consume_auth_rate_limit(
  p_scope text,
  p_identifier text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  max_requests integer;
  window_seconds integer;
  current_count integer;
begin
  if p_identifier !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid rate-limit identifier';
  end if;

  case p_scope
    when 'guest_intent' then max_requests := 10; window_seconds := 600;
    when 'email_sign_in' then max_requests := 5; window_seconds := 900;
    when 'oauth_sign_in' then max_requests := 10; window_seconds := 600;
    when 'auth_callback' then max_requests := 20; window_seconds := 600;
    when 'intent_resume' then max_requests := 20; window_seconds := 600;
    when 'business_onboarding' then max_requests := 3; window_seconds := 86400;
    when 'business_onboarding_save' then max_requests := 120; window_seconds := 3600;
    else raise exception 'invalid rate-limit scope';
  end case;

  insert into public.auth_rate_limits as limits(
    scope,
    identifier_hash,
    window_started_at,
    request_count,
    updated_at
  )
  values (p_scope, p_identifier, now(), 1, now())
  on conflict(scope, identifier_hash) do update set
    window_started_at = case
      when limits.window_started_at <= now() - make_interval(secs => window_seconds)
        then now()
      else limits.window_started_at
    end,
    request_count = case
      when limits.window_started_at <= now() - make_interval(secs => window_seconds)
        then 1
      else limits.request_count + 1
    end,
    updated_at = now()
  returning request_count into current_count;

  return current_count <= max_requests;
end;
$$;

create or replace function public.start_business_onboarding(
  target_market uuid,
  business_name text,
  business_slug text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  new_business uuid;
  actor_hash text;
  trim_chars constant text := E' \t\n\r\f' || pg_catalog.chr(11);
  normalized_business_name text := pg_catalog.btrim(
    business_name,
    trim_chars
  );
begin
  if not public.is_active_profile(actor) then
    raise exception 'active authentication is required';
  end if;
  if business_name is null
    or char_length(normalized_business_name) not between 2 and 160
    or business_slug is null
    or char_length(business_slug) not between 2 and 80
    or business_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
  then
    raise exception 'invalid business details';
  end if;
  perform 1
  from public.markets m
  where m.id = target_market and m.is_active
  for share;
  if not found then
    raise exception 'inactive market';
  end if;
  if exists (
    select 1
    from public.business_onboarding_drafts d
    where d.owner_id = actor and d.submitted_at is null
  ) then
    raise exception 'complete the existing onboarding first';
  end if;

  actor_hash := encode(extensions.digest(actor::text, 'sha256'), 'hex');
  if not public.consume_auth_rate_limit('business_onboarding', actor_hash) then
    raise exception 'business onboarding rate limit exceeded';
  end if;

  insert into public.businesses(market_id, name, slug, status)
  values (target_market, normalized_business_name, business_slug, 'draft')
  returning id into new_business;
  insert into public.business_memberships(
    business_id,
    profile_id,
    role,
    accepted_at
  )
  values (new_business, actor, 'owner', now());
  insert into public.business_onboarding_drafts(business_id, owner_id)
  values (new_business, actor);
  insert into public.profile_capabilities(profile_id, capability)
  values (actor, 'merchant')
  on conflict do nothing;

  return new_business;
end;
$$;

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
    or jsonb_typeof(draft_data) is distinct from 'object'
  then
    return false;
  end if;
  if pg_catalog.jsonb_object_length(draft_data) <> 2
    or not (draft_data ?& array['onboardingVersion', 'values'])
    or draft_data->'onboardingVersion' is distinct from '1'::jsonb
  then
    return false;
  end if;

  payload := draft_data->'values';
  if jsonb_typeof(payload) is distinct from 'object' then
    return false;
  end if;
  if pg_catalog.jsonb_object_length(payload) <> 11
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
  if jsonb_typeof(payload->'businessName') is distinct from 'string'
    or jsonb_typeof(payload->'originalOffering') is distinct from 'string'
    or jsonb_typeof(payload->'categorySlug') is distinct from 'string'
    or jsonb_typeof(payload->'categoryConfidence') is distinct from 'string'
    or jsonb_typeof(payload->'description') is distinct from 'string'
    or jsonb_typeof(payload->'phone') is distinct from 'string'
    or jsonb_typeof(payload->'whatsapp') is distinct from 'string'
    or jsonb_typeof(payload->'email') is distinct from 'string'
    or jsonb_typeof(payload->'marketSlug') is distinct from 'string'
    or jsonb_typeof(payload->'area') is distinct from 'string'
    or jsonb_typeof(payload->'address') is distinct from 'string'
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
    from public.businesses b
    join public.markets m on m.id = b.market_id
    where b.id = target_business
      and m.slug = payload->>'marketSlug'
      and m.is_active
  );
end;
$$;

create or replace function public.save_business_onboarding_draft(
  target_business uuid,
  next_step text,
  draft_data jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  actor_hash text;
  locked_market_id uuid;
  trim_chars constant text := E' \t\n\r\f' || pg_catalog.chr(11);
begin
  if not public.is_business_manager(target_business)
    or not exists (
      select 1
      from public.business_memberships bm
      where bm.business_id = target_business
        and bm.profile_id = actor
        and bm.role = 'owner'
        and bm.accepted_at is not null
    )
  then
    raise exception 'owner access is required';
  end if;
  if jsonb_typeof(draft_data) is distinct from 'object'
    or pg_column_size(draft_data) > 65536
    or next_step is null
    or next_step not in (
      'business',
      'category',
      'profile',
      'location',
      'review',
      'complete'
    )
  then
    raise exception 'invalid draft';
  end if;
  perform 1
  from public.business_onboarding_drafts d
  where d.business_id = target_business and d.owner_id = actor
  for update;
  if not found then
    raise exception 'draft not found';
  end if;

  if exists (
    select 1
    from public.business_onboarding_drafts d
    where d.business_id = target_business
      and d.owner_id = actor
      and d.submitted_at is not null
  ) then
    if next_step = 'complete' and exists (
      select 1
      from public.business_onboarding_drafts d
      join public.businesses b on b.id = d.business_id
      where d.business_id = target_business
        and d.owner_id = actor
        and d.step = 'complete'
        and d.data = draft_data
        and b.status in ('pending_review', 'active', 'suspended')
    ) then
      return;
    end if;
    raise exception 'draft already submitted';
  end if;

  actor_hash := encode(extensions.digest(actor::text, 'sha256'), 'hex');
  if not public.consume_auth_rate_limit('business_onboarding_save', actor_hash) then
    raise exception 'onboarding save rate limit exceeded';
  end if;

  if next_step = 'complete' then
    select b.market_id
    into locked_market_id
    from public.businesses b
    join public.markets m on m.id = b.market_id
    where b.id = target_business and b.status = 'draft'
    for no key update of b
    for share of m;
    if not found then
      raise exception 'business cannot be submitted';
    end if;
    if not public.is_valid_completed_onboarding_draft(
      target_business,
      draft_data
    ) then
      raise exception 'invalid completed onboarding';
    end if;
  end if;

  update public.business_onboarding_drafts d
  set
    step = next_step,
    data = draft_data,
    submitted_at = case
      when next_step = 'complete' then coalesce(d.submitted_at, now())
      else d.submitted_at
    end
  where d.business_id = target_business
    and d.owner_id = actor
    and d.submitted_at is null;
  if not found then
    raise exception 'draft not found';
  end if;

  if next_step = 'complete' then
    update public.businesses
    set
      name = pg_catalog.btrim(
        draft_data->'values'->>'businessName',
        trim_chars
      ),
      status = 'pending_review'
    where id = target_business
      and market_id = locked_market_id
      and status = 'draft';
    if not found then
      raise exception 'business cannot be submitted';
    end if;
  end if;
end;
$$;

revoke execute on function public.start_business_onboarding(uuid, text, text),
  public.save_business_onboarding_draft(uuid, text, jsonb),
  public.is_valid_completed_onboarding_draft(uuid, jsonb)
from public, anon, authenticated;
grant execute on function public.start_business_onboarding(uuid, text, text),
  public.save_business_onboarding_draft(uuid, text, jsonb)
to authenticated;

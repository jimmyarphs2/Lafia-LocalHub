-- Step 25 corrective boundary: terminal referral-link states cannot be revived.

do $$
begin
  if pg_catalog.to_regprocedure(
    'public.set_my_referral_link_enabled(uuid,boolean)'
  ) is null then
    raise exception 'referral link toggle boundary is missing';
  end if;
end;
$$;

create or replace function public.set_my_referral_link_enabled(
  p_link_id uuid,
  p_enabled boolean
)
returns table(
  link_id uuid,
  code text,
  market_id uuid,
  target text,
  status text,
  expires_at timestamptz
)
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  stored_status private.referral_link_status_code;
  stored_expires_at timestamptz;
  stored_market_id uuid;
begin
  if actor is null or not exists (
    select 1
    from public.profiles profile_record
    where profile_record.id = actor
      and not profile_record.is_suspended
  ) then
    raise exception 'active authentication is required' using errcode='42501';
  end if;
  if p_link_id is null or p_enabled is null then
    raise exception 'invalid referral link change' using errcode='22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'referral-toggle:' || actor::text || ':' || p_link_id::text,
      0
    )
  );

  select link_record.status,
         link_record.expires_at,
         link_record.market_id
  into stored_status, stored_expires_at, stored_market_id
  from private.referral_acquisition_links link_record
  where link_record.id = p_link_id
    and link_record.referrer_profile_id = actor
  for update;

  if not found then
    raise exception 'referral link not found' using errcode='42501';
  end if;
  if stored_status = 'expired'
    or (
      stored_expires_at is not null
      and stored_expires_at <= now()
    )
  then
    raise exception 'referral link cannot be changed' using errcode='55000';
  end if;
  if p_enabled and (
    not exists (
      select 1
      from private.referrer_identities identity_record
      where identity_record.profile_id = actor
        and identity_record.status = 'active'
    )
    or not exists (
      select 1
      from public.markets market_record
      where market_record.id = stored_market_id
        and market_record.is_active
    )
  ) then
    raise exception 'referral link cannot be enabled' using errcode='55000';
  end if;

  update private.referral_acquisition_links link_record
  set status = case
        when p_enabled then 'active'::private.referral_link_status_code
        else 'disabled'::private.referral_link_status_code
      end,
      disabled_at = case when p_enabled then null else now() end
  where link_record.id = p_link_id
    and link_record.referrer_profile_id = actor
    and link_record.status is distinct from case
      when p_enabled then 'active'::private.referral_link_status_code
      else 'disabled'::private.referral_link_status_code
    end;

  return query
  select link_record.id,
         link_record.code,
         link_record.market_id,
         link_record.target::text,
         link_record.status::text,
         link_record.expires_at
  from private.referral_acquisition_links link_record
  where link_record.id = p_link_id
    and link_record.referrer_profile_id = actor;
end;
$$;

alter function public.set_my_referral_link_enabled(uuid, boolean)
  owner to postgres;
revoke all on function public.set_my_referral_link_enabled(uuid, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.set_my_referral_link_enabled(uuid, boolean)
  to authenticated;

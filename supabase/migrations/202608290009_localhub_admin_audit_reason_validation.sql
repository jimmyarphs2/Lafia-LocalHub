-- Administrative state changes require a useful, bounded audit reason.

create or replace function public.transition_business_status(
  target_business uuid,
  next_status text,
  reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Include Unicode separators and common invisible formatting characters.
  trim_chars constant text := E' \t\n\r\f' || pg_catalog.chr(11) || U&'\00A0\1680\180E\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\200B\200C\200D\200E\200F\2028\2029\202A\202B\202C\202D\202E\202F\205F\2060\2061\2062\2063\2064\2066\2067\2068\2069\3000\FEFF';
  default_ignorable_pattern constant text := U&'[\00AD\034F\061C\115F-\1160\17B4-\17B5\180B-\180F\200B-\200F\202A-\202E\2060-\206F\3164\FE00-\FE0F\FEFF\FFA0\FFF0-\FFF8\+01BCA0-\+01BCA3\+01D173-\+01D17A\+0E0000-\+0E0FFF]';
  normalized_reason text := pg_catalog.btrim(reason, trim_chars);
  visible_reason text := pg_catalog.regexp_replace(normalized_reason, default_ignorable_pattern, '', 'g');
  meaningful_reason text := pg_catalog.regexp_replace(visible_reason, '[^[:alnum:]]', '', 'g');
begin
  if not (
    public.has_capability('admin')
    or public.has_capability('super_admin')
  ) then
    raise exception 'administrator access is required';
  end if;
  if next_status not in ('pending_review', 'active', 'suspended')
    or reason is null
    or char_length(normalized_reason) not between 3 and 500
    or char_length(meaningful_reason) < 3
    or exists (
      select 1
      from public.business_memberships bm
      where bm.business_id = target_business
        and bm.profile_id = (select auth.uid())
        and bm.accepted_at is not null
    )
  then
    raise exception 'invalid transition';
  end if;

  update public.businesses
  set status = next_status
  where id = target_business;
  if not found then
    raise exception 'business not found';
  end if;

  insert into public.admin_events(
    admin_id,
    action,
    subject_type,
    subject_id,
    reason
  )
  values (
    (select auth.uid()),
    'business_status_transition',
    'business',
    target_business,
    normalized_reason
  );
end;
$$;

revoke execute on function public.transition_business_status(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.transition_business_status(uuid, text, text)
  to authenticated;

create or replace function public.set_profile_suspension(
  target_profile uuid,
  should_suspend boolean,
  reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  -- Include Unicode separators and common invisible formatting characters.
  trim_chars constant text := E' \t\n\r\f' || pg_catalog.chr(11) || U&'\00A0\1680\180E\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\200B\200C\200D\200E\200F\2028\2029\202A\202B\202C\202D\202E\202F\205F\2060\2061\2062\2063\2064\2066\2067\2068\2069\3000\FEFF';
  default_ignorable_pattern constant text := U&'[\00AD\034F\061C\115F-\1160\17B4-\17B5\180B-\180F\200B-\200F\202A-\202E\2060-\206F\3164\FE00-\FE0F\FEFF\FFA0\FFF0-\FFF8\+01BCA0-\+01BCA3\+01D173-\+01D17A\+0E0000-\+0E0FFF]';
  normalized_reason text := pg_catalog.btrim(reason, trim_chars);
  visible_reason text := pg_catalog.regexp_replace(normalized_reason, default_ignorable_pattern, '', 'g');
  meaningful_reason text := pg_catalog.regexp_replace(visible_reason, '[^[:alnum:]]', '', 'g');
begin
  if actor is null
    or not public.has_capability('super_admin')
    or actor = target_profile
    or reason is null
    or char_length(normalized_reason) not between 3 and 500
    or char_length(meaningful_reason) < 3
  then
    raise exception 'invalid profile suspension request';
  end if;

  update public.profiles
  set is_suspended = should_suspend
  where id = target_profile;
  if not found then
    raise exception 'profile not found';
  end if;

  insert into public.admin_events(
    admin_id,
    action,
    subject_type,
    subject_id,
    reason
  )
  values (
    actor,
    case
      when should_suspend then 'profile_suspended'
      else 'profile_unsuspended'
    end,
    'profile',
    target_profile,
    normalized_reason
  );
end;
$$;

revoke execute on function public.set_profile_suspension(uuid, boolean, text)
  from public, anon, authenticated;
grant execute on function public.set_profile_suspension(uuid, boolean, text)
  to authenticated;

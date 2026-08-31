-- New media registration belongs to editable drafts only. Cancellation,
-- removal, and orphan cleanup deliberately remain status-agnostic so a later
-- publication transition cannot strand private storage objects.

create or replace function private.lock_listing_draft(
  p_listing_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  locked boolean := false;
begin
  select true into locked
  from public.listings l
  where l.id = p_listing_id
    and l.status = 'draft'
  for no key update of l;

  return coalesce(locked, false);
end;
$$;

create or replace function private.lock_managed_listing_draft(
  p_listing_id uuid,
  p_actor_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_business_id uuid;
begin
  if not private.lock_listing_draft(p_listing_id) then
    return false;
  end if;

  select l.business_id into target_business_id
  from public.listings l
  where l.id = p_listing_id;

  return target_business_id is not null
    and private.lock_active_business_manager(target_business_id, p_actor_id);
end;
$$;

create or replace function public.reserve_listing_media_upload(
  p_listing_id uuid,
  p_storage_path text
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  reservation_expiry timestamptz := now() + interval '3 hours';
  result_expiry timestamptz;
begin
  if actor is null
    or not public.is_active_profile(actor)
    or p_storage_path !~ (
      '^' || p_listing_id::text
      || '/[0-9a-f]{32}\.(jpg|jpeg|png|webp|mp4|pdf)$'
    )
  then
    raise exception 'invalid media reservation';
  end if;
  if not private.lock_managed_listing_draft(p_listing_id, actor) then
    raise exception 'invalid media reservation';
  end if;
  if not public.consume_media_upload_rate_limit() then
    raise exception 'media upload rate limit exceeded';
  end if;

  insert into public.listing_media_upload_reservations as reservations(
    storage_path,
    listing_id,
    profile_id,
    status,
    expires_at
  )
  values (
    p_storage_path,
    p_listing_id,
    actor,
    'reserved',
    reservation_expiry
  )
  on conflict(storage_path) do nothing
  returning expires_at into result_expiry;

  if result_expiry is null then
    select r.expires_at
    into result_expiry
    from public.listing_media_upload_reservations r
    where r.storage_path = p_storage_path
      and r.listing_id = p_listing_id
      and r.profile_id = actor
      and r.status = 'reserved'
      and r.expires_at > now()
      and r.cleanup_state = 'none'
    for update of r;
  end if;
  if result_expiry is null then
    raise exception 'media reservation conflict';
  end if;

  return result_expiry;
end;
$$;

create or replace function public.confirm_listing_media_upload(
  p_listing_id uuid,
  p_storage_path text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
begin
  if actor is null
    or not public.is_active_profile(actor)
    or p_storage_path !~ (
      '^' || p_listing_id::text
      || '/[0-9a-f]{32}\.(jpg|jpeg|png|webp|mp4|pdf)$'
    )
  then
    raise exception 'active authentication is required';
  end if;
  if not private.lock_managed_listing_draft(p_listing_id, actor) then
    raise exception 'draft media access is required';
  end if;
  update public.listing_media_upload_reservations r
  set status = 'confirmed', confirmed_at = now(), updated_at = now()
  where r.storage_path = p_storage_path
    and r.listing_id = p_listing_id
    and r.profile_id = actor
    and r.status = 'reserved'
    and r.expires_at > now()
    and exists (
      select 1
      from storage.objects o
      where o.bucket_id = 'listing-media'
        and o.name = p_storage_path
        and coalesce(o.metadata ->> 'mimetype', '') in (
          'image/jpeg', 'image/png', 'image/webp', 'video/mp4',
          'application/pdf'
        )
        and coalesce(o.metadata ->> 'size', '') ~ '^[0-9]+$'
        and (o.metadata ->> 'size')::bigint between 1 and 20971520
    );
  if found then return true; end if;
  return exists (
    select 1
    from public.listing_media_upload_reservations r
    where r.storage_path = p_storage_path
      and r.listing_id = p_listing_id
      and r.profile_id = actor
      and r.status = 'confirmed'
  );
end;
$$;

create or replace function public.has_reserved_listing_media_upload(
  p_storage_path text
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  allowed boolean := false;
  listing_id uuid;
begin
  if actor is null
    or p_storage_path !~ (
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-'
      || '[89ab][0-9a-f]{3}-[0-9a-f]{12}/'
      || '[0-9a-f]{32}\.(jpg|jpeg|png|webp|mp4|pdf)$'
    )
  then
    return false;
  end if;
  listing_id := (storage.foldername(p_storage_path))[1]::uuid;
  if not private.lock_managed_listing_draft(listing_id, actor) then
    return false;
  end if;
  select true into allowed
  from public.listing_media_upload_reservations r
  where r.storage_path = p_storage_path
    and r.listing_id = listing_id
    and r.profile_id = actor
    and r.status = 'reserved'
    and r.expires_at > now()
    and r.cleanup_state = 'none'
  limit 1
  for key share of r;
  return coalesce(allowed, false);
end;
$$;

create or replace function public.has_confirmed_listing_media_upload(
  p_listing_id uuid,
  p_storage_path text
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  allowed boolean := false;
begin
  if actor is null
    or p_storage_path !~ (
      '^' || p_listing_id::text
      || '/[0-9a-f]{32}\.(jpg|jpeg|png|webp|mp4|pdf)$'
    )
  then
    return false;
  end if;
  if not private.lock_managed_listing_draft(p_listing_id, actor) then
    return false;
  end if;
  select true into allowed
  from public.listing_media_upload_reservations r
  where r.storage_path = p_storage_path
    and r.listing_id = p_listing_id
    and r.profile_id = actor
    and r.status = 'confirmed'
    and r.cleanup_state in ('none', 'failed')
    and exists (
      select 1
      from storage.objects o
      where o.bucket_id = 'listing-media'
        and o.name = p_storage_path
        and coalesce(o.metadata ->> 'mimetype', '') in (
          'image/jpeg', 'image/png', 'image/webp', 'video/mp4',
          'application/pdf'
        )
        and coalesce(o.metadata ->> 'size', '') ~ '^[0-9]+$'
        and (o.metadata ->> 'size')::bigint between 1 and 20971520
    )
  limit 1
  for key share of r;
  return coalesce(allowed, false);
end;
$$;

create or replace function public.record_listing_media_registration()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.lock_listing_draft(new.listing_id) then
    raise exception 'confirmed draft media reservation is required';
  end if;

  update public.listing_media_upload_reservations r
  set
    registered_at = coalesce(r.registered_at, now()),
    cleanup_state = case
      when r.cleanup_state = 'failed' then 'none'
      else r.cleanup_state
    end,
    cleanup_claim_token = case
      when r.cleanup_state = 'failed' then null
      else r.cleanup_claim_token
    end,
    cleanup_claimed_at = case
      when r.cleanup_state = 'failed' then null
      else r.cleanup_claimed_at
    end,
    cleanup_failed_at = case
      when r.cleanup_state = 'failed' then null
      else r.cleanup_failed_at
    end,
    cleanup_error = case
      when r.cleanup_state = 'failed' then null
      else r.cleanup_error
    end,
    updated_at = now()
  where r.storage_path = new.storage_path
    and r.listing_id = new.listing_id
    and r.status = 'confirmed'
    and r.cleanup_state in ('none', 'failed')
    and exists (
      select 1
      from storage.objects o
      where o.bucket_id = 'listing-media'
        and o.name = new.storage_path
        and coalesce(o.metadata ->> 'mimetype', '') in (
          'image/jpeg', 'image/png', 'image/webp', 'video/mp4',
          'application/pdf'
        )
        and coalesce(o.metadata ->> 'size', '') ~ '^[0-9]+$'
        and (o.metadata ->> 'size')::bigint between 1 and 20971520
    );
  if not found then
    raise exception 'confirmed draft media reservation is required';
  end if;
  return new;
end;
$$;

revoke execute on function private.lock_listing_draft(uuid)
  from public, anon, authenticated;
revoke execute on function private.lock_managed_listing_draft(uuid, uuid)
  from public, anon, authenticated;

revoke execute on function public.reserve_listing_media_upload(uuid, text)
  from public, anon, authenticated;
revoke execute on function public.confirm_listing_media_upload(uuid, text)
  from public, anon, authenticated;
revoke execute on function public.cancel_listing_media_upload(uuid, text)
  from public, anon, authenticated;
revoke execute on function public.mark_listing_media_upload_removed(uuid, text)
  from public, anon, authenticated;
revoke execute on function public.has_reserved_listing_media_upload(text)
  from public, anon, authenticated;
revoke execute on function public.has_confirmed_listing_media_upload(uuid, text)
  from public, anon, authenticated;
revoke execute on function public.record_listing_media_registration()
  from public, anon, authenticated;

grant execute on function public.reserve_listing_media_upload(uuid, text)
  to authenticated;
grant execute on function public.confirm_listing_media_upload(uuid, text)
  to authenticated;
grant execute on function public.cancel_listing_media_upload(uuid, text)
  to authenticated;
grant execute on function public.mark_listing_media_upload_removed(uuid, text)
  to authenticated;
grant execute on function public.has_reserved_listing_media_upload(text)
  to authenticated;
grant execute on function public.has_confirmed_listing_media_upload(uuid, text)
  to authenticated;

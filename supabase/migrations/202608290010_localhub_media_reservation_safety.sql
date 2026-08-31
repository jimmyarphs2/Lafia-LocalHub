-- Keep the database reservation alive beyond the storage provider's signed
-- upload-token lifetime so cleanup cannot finish while a token is still valid.

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
    or not exists (
      select 1
      from public.listings l
      where l.id = p_listing_id
        and public.is_business_manager(l.business_id)
    )
  then
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
    for update;
  end if;
  if result_expiry is null then
    raise exception 'media reservation conflict';
  end if;

  return result_expiry;
end;
$$;

revoke execute on function public.reserve_listing_media_upload(uuid, text)
  from public, anon, authenticated;
grant execute on function public.reserve_listing_media_upload(uuid, text)
  to authenticated;

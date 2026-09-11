-- Stage 2 of the public-catalogue boundary. Apply only after the application
-- adapter reads public catalogue projections from migration 039.

begin;

set local lock_timeout = '10s';
set local statement_timeout = '120s';

drop policy if exists public_active_businesses_anon on public.businesses;
drop policy if exists businesses_authenticated_select on public.businesses;
drop policy if exists public_active_listings_anon on public.listings;
drop policy if exists listings_authenticated_select on public.listings;
drop policy if exists public_listing_media on public.listing_media;
drop policy if exists public_variants on public.listing_variants;
drop policy if exists public_availability on public.listing_availability;
drop policy if exists listing_media_object_read on storage.objects;
drop policy if exists listing_media_object_public_read on storage.objects;
drop policy if exists listing_media_object_manager_read on storage.objects;

revoke select on public.businesses, public.listings, public.listing_media,
  public.listing_variants, public.listing_availability from anon;

create policy businesses_authenticated_members_select
  on public.businesses for select to authenticated
  using ((select public.is_business_member(id)));

create policy listings_authenticated_members_select
  on public.listings for select to authenticated
  using ((select public.is_business_member(business_id)));

create policy listing_media_authenticated_managers_select
  on public.listing_media for select to authenticated
  using (
    exists (
      select 1
      from public.listings listing_record
      where listing_record.id = listing_id
        and (select public.is_business_manager(listing_record.business_id))
    )
  );

create policy listing_variants_authenticated_members_select
  on public.listing_variants for select to authenticated
  using (
    exists (
      select 1
      from public.listings listing_record
      where listing_record.id = listing_id
        and (select public.is_business_member(listing_record.business_id))
    )
  );

create policy listing_availability_authenticated_members_select
  on public.listing_availability for select to authenticated
  using (
    exists (
      select 1
      from public.listings listing_record
      where listing_record.id = listing_id
        and (select public.is_business_member(listing_record.business_id))
    )
  );

create policy listing_media_object_manager_read
  on storage.objects for select to authenticated
  using (
    bucket_id = 'listing-media'
    and storage.objects.name ~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{32}\.(jpg|jpeg|png|webp|mp4|pdf)$'
    and exists (
      select 1
      from public.listings listing_record
      where listing_record.id::text =
          (storage.foldername(storage.objects.name))[1]
        and (select public.is_business_manager(listing_record.business_id))
    )
  );

do $$
begin
  if pg_catalog.has_table_privilege('anon', 'public.businesses', 'select')
    or pg_catalog.has_table_privilege('anon', 'public.listings', 'select')
    or pg_catalog.has_table_privilege('anon', 'public.listing_media', 'select')
    or pg_catalog.has_table_privilege('anon', 'public.listing_variants', 'select')
    or pg_catalog.has_table_privilege('anon', 'public.listing_availability', 'select')
    or not pg_catalog.has_table_privilege(
      'authenticated', 'public.businesses', 'select'
    )
    or not pg_catalog.has_table_privilege(
      'authenticated', 'public.listings', 'select'
    )
    or not pg_catalog.has_table_privilege(
      'authenticated', 'public.listing_media', 'select'
    )
    or not pg_catalog.has_table_privilege(
      'authenticated', 'public.listing_variants', 'select'
    )
    or not pg_catalog.has_table_privilege(
      'authenticated', 'public.listing_availability', 'select'
    ) then
    raise exception 'catalogue source-table ACL postcondition failed'
      using errcode = '55000';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_policies policy_record
    where (
      policy_record.schemaname = 'public'
      and policy_record.tablename in (
        'businesses', 'listings', 'listing_media',
        'listing_variants', 'listing_availability'
      )
      and policy_record.policyname in (
        'public_active_businesses_anon', 'businesses_authenticated_select',
        'public_active_listings_anon', 'listings_authenticated_select',
        'public_listing_media', 'public_variants', 'public_availability'
      )
    ) or (
      policy_record.schemaname = 'storage'
      and policy_record.tablename = 'objects'
      and policy_record.policyname in (
        'listing_media_object_read', 'listing_media_object_public_read'
      )
    )
  ) then
    raise exception 'public catalogue policy removal postcondition failed'
      using errcode = '55000';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_policies policy_record
    where policy_record.schemaname = 'public'
      and policy_record.tablename = 'businesses'
      and policy_record.policyname = 'businesses_authenticated_members_select'
      and policy_record.cmd = 'SELECT'
      and policy_record.roles = array['authenticated']::name[]
  ) or not exists (
    select 1
    from pg_catalog.pg_policies policy_record
    where policy_record.schemaname = 'public'
      and policy_record.tablename = 'listings'
      and policy_record.policyname = 'listings_authenticated_members_select'
      and policy_record.cmd = 'SELECT'
      and policy_record.roles = array['authenticated']::name[]
  ) or not exists (
    select 1
    from pg_catalog.pg_policies policy_record
    where policy_record.schemaname = 'public'
      and policy_record.tablename = 'listing_media'
      and policy_record.policyname = 'listing_media_authenticated_managers_select'
      and policy_record.cmd = 'SELECT'
      and policy_record.roles = array['authenticated']::name[]
  ) or not exists (
    select 1
    from pg_catalog.pg_policies policy_record
    where policy_record.schemaname = 'public'
      and policy_record.tablename = 'listing_variants'
      and policy_record.policyname = 'listing_variants_authenticated_members_select'
      and policy_record.cmd = 'SELECT'
      and policy_record.roles = array['authenticated']::name[]
  ) or not exists (
    select 1
    from pg_catalog.pg_policies policy_record
    where policy_record.schemaname = 'public'
      and policy_record.tablename = 'listing_availability'
      and policy_record.policyname = 'listing_availability_authenticated_members_select'
      and policy_record.cmd = 'SELECT'
      and policy_record.roles = array['authenticated']::name[]
  ) or not exists (
    select 1
    from pg_catalog.pg_policies policy_record
    where policy_record.schemaname = 'storage'
      and policy_record.tablename = 'objects'
      and policy_record.policyname = 'listing_media_object_manager_read'
      and policy_record.cmd = 'SELECT'
      and policy_record.roles = array['authenticated']::name[]
  ) then
    raise exception 'catalogue member policy postcondition failed'
      using errcode = '55000';
  end if;
end;
$$;

notify pgrst, 'reload schema';

commit;

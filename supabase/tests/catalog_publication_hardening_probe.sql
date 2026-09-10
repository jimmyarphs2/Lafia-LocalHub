-- Rollback-only catalogue boundary probe. Run after migrations 039 and 040.
begin;

create temporary table catalog_phase_zero_state (
  manager_id uuid not null,
  staff_id uuid not null,
  rejected_id uuid not null,
  outsider_id uuid not null,
  suspended_id uuid not null,
  foreign_manager_id uuid not null,
  market_id uuid not null,
  inactive_market_id uuid not null,
  business_id uuid not null,
  foreign_business_id uuid not null,
  inactive_business_id uuid not null,
  listing_type_id uuid not null,
  listing_schema_id uuid not null,
  category_id uuid not null,
  inactive_category_id uuid not null,
  foreign_category_id uuid not null,
  fixture_key text not null
) on commit drop;

create temporary table catalog_phase_zero_listings (
  label text primary key,
  listing_id uuid not null,
  source_path text
) on commit drop;

insert into catalog_phase_zero_state
select
  extensions.gen_random_uuid(), extensions.gen_random_uuid(),
  extensions.gen_random_uuid(), extensions.gen_random_uuid(),
  extensions.gen_random_uuid(),
  extensions.gen_random_uuid(), extensions.gen_random_uuid(),
  extensions.gen_random_uuid(), extensions.gen_random_uuid(),
  extensions.gen_random_uuid(), extensions.gen_random_uuid(),
  extensions.gen_random_uuid(), extensions.gen_random_uuid(),
  extensions.gen_random_uuid(), extensions.gen_random_uuid(),
  extensions.gen_random_uuid(),
  pg_catalog.replace(extensions.gen_random_uuid()::text, '-', '');

grant select on catalog_phase_zero_state, catalog_phase_zero_listings
  to anon, authenticated, service_role;

do $$
declare
  state catalog_phase_zero_state%rowtype;
  schema_version integer;
  schema_document jsonb := jsonb_build_object(
    'contractVersion', '1.1',
    'schemaVersion', 1,
    'schemaKey', 'catalog_phase_zero_probe',
    'listingKind', 'product',
    'terminology', jsonb_build_object(
      'singular', 'product', 'plural', 'products',
      'createAction', 'Add product'
    ),
    'bindings', jsonb_build_object('title', 'title'),
    'fields', jsonb_build_array(jsonb_build_object(
      'key', 'title', 'label', 'Product name',
      'required', true, 'type', 'short_text',
      'minLength', 2, 'maxLength', 120
    ))
  );
begin
  select * into strict state from catalog_phase_zero_state;
  insert into auth.users(
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
  )
  select profile_id, '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    state.fixture_key || '-' || label || '@example.test', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb, now(), now()
  from (values
    (state.manager_id, 'manager'), (state.staff_id, 'staff'),
    (state.rejected_id, 'rejected'),
    (state.outsider_id, 'outsider'), (state.suspended_id, 'suspended'),
    (state.foreign_manager_id, 'foreign')
  ) as users(profile_id, label);
  if (select count(*) from public.profiles profile_record where profile_record.id in (
      state.manager_id, state.staff_id, state.rejected_id, state.outsider_id, state.suspended_id,
      state.foreign_manager_id
    )) <> 6 then
    raise exception 'auth user trigger did not create probe profiles';
  end if;

  insert into public.markets(id, slug, name, is_active) values
    (state.market_id, 'catalog-phase-zero-' || state.fixture_key, 'Catalogue', true),
    (state.inactive_market_id, 'catalog-inactive-' || state.fixture_key, 'Inactive', false);
  insert into public.categories(id, market_id, slug, name, is_active) values
    (state.category_id, state.market_id, 'catalog-' || state.fixture_key, 'Catalogue', true),
    (state.inactive_category_id, state.market_id, 'catalog-inactive-' || state.fixture_key, 'Inactive', false),
    (state.foreign_category_id, state.inactive_market_id, 'catalog-foreign-' || state.fixture_key, 'Foreign', true);

  select listing_type.id, listing_schema.id
  into state.listing_type_id, state.listing_schema_id
  from public.listing_types listing_type
  join public.listing_schemas listing_schema
    on listing_schema.listing_type_id = listing_type.id
  where listing_type.code in ('product', 'service', 'place')
    and listing_type.is_active
    and listing_schema.status = 'published'
    and listing_schema.published_at is not null
    and private.is_supported_listing_schema_document(
      listing_schema.schema, listing_schema.version, listing_type.code
    )
  order by listing_type.code, listing_schema.version desc
  limit 1;
  if not found then
    select id into state.listing_type_id
    from public.listing_types
    where code = 'product' and is_active;
    if not found then
      insert into public.listing_types(id, code, name)
      values (state.listing_type_id, 'product', 'Catalogue probe product');
    end if;
    if exists (
      select 1 from public.listing_schemas
      where listing_type_id = state.listing_type_id and status = 'published'
    ) then
      raise exception 'catalogue probe requires an existing supported published schema';
    end if;
    select coalesce(max(version), 0) + 1 into schema_version
    from public.listing_schemas where listing_type_id = state.listing_type_id;
    state.listing_schema_id := extensions.gen_random_uuid();
    schema_document := jsonb_set(
      jsonb_set(schema_document, '{schemaVersion}', to_jsonb(schema_version)),
      '{schemaKey}', to_jsonb('catalogphase' || pg_catalog.substr(state.fixture_key, 1, 20))
    );
    insert into public.listing_schemas(
      id, listing_type_id, version, status, schema, published_at
    ) values (
      state.listing_schema_id, state.listing_type_id, schema_version,
      'published', schema_document, now()
    );
  end if;
  update catalog_phase_zero_state
  set listing_type_id = state.listing_type_id,
      listing_schema_id = state.listing_schema_id;
  insert into public.category_listing_type_mappings(
    category_id, listing_type_id, listing_schema_id, is_default
  ) values
    (state.category_id, state.listing_type_id, state.listing_schema_id, true),
    (state.inactive_category_id, state.listing_type_id, state.listing_schema_id, true),
    (state.foreign_category_id, state.listing_type_id, state.listing_schema_id, true);
  insert into public.businesses(id, market_id, name, slug, status, metadata) values
    (state.business_id, state.market_id, 'Public business', 'public-' || state.fixture_key, 'active',
      '{"summary":"Safe summary","serviceAreas":["Jos"],"capabilityTags":["delivery"],"color":"blue","email":"private@example.test"}'::jsonb),
    (state.foreign_business_id, state.market_id, 'Foreign business', 'foreign-' || state.fixture_key, 'active', '{}'::jsonb),
    (state.inactive_business_id, state.market_id, 'Inactive business', 'inactive-' || state.fixture_key, 'suspended', '{}'::jsonb);
  insert into public.business_memberships(business_id, profile_id, role, accepted_at) values
    (state.business_id, state.manager_id, 'manager', now()),
    (state.business_id, state.staff_id, 'staff', now()),
    (state.business_id, state.rejected_id, 'staff', null),
    (state.business_id, state.suspended_id, 'manager', now()),
    (state.foreign_business_id, state.foreign_manager_id, 'manager', now());
end;
$$;

do $$
declare
  state catalog_phase_zero_state%rowtype;
  item record;
  listing_id uuid;
  media_source_path text;
begin
  select * into strict state from catalog_phase_zero_state;
  for item in select * from (values
    ('published'::text, state.business_id, state.market_id, state.category_id, now()),
    ('unpublished'::text, state.business_id, state.market_id, state.category_id, null::timestamptz),
    ('inactive_category'::text, state.business_id, state.market_id, state.inactive_category_id, now()),
    ('cross_market_category'::text, state.business_id, state.market_id, state.foreign_category_id, now()),
    ('inactive_business'::text, state.inactive_business_id, state.market_id, state.category_id, now())
  ) as fixtures(label, business_id, market_id, category_id, published_at)
  loop
    insert into public.listings(
      business_id, market_id, category_id, listing_type_id, listing_schema_id,
      slug, title, attributes, status, published_at
    ) values (
      item.business_id, item.market_id, item.category_id,
      state.listing_type_id, state.listing_schema_id, item.label || '-' || state.fixture_key,
      item.label || ' listing',
      '{"availabilityNote":"Call first","availabilityWindows":["today"],"capabilityTags":["delivery"],"color":"blue","priceNote":"From ₦500","serviceAreas":["Jos"],"email":"private@example.test"}'::jsonb,
      'draft', item.published_at
    ) returning id into listing_id;
    insert into catalog_phase_zero_listings(label, listing_id) values (item.label, listing_id);
    if item.label = 'published' then
      media_source_path := listing_id::text || '/' || pg_catalog.md5('source' || state.fixture_key) || '.jpg';
      insert into storage.objects(bucket_id, name, metadata)
      values ('listing-media', media_source_path, '{"mimetype":"image/jpeg","size":"1024"}'::jsonb);
      insert into public.listing_media_upload_reservations(
        storage_path, listing_id, profile_id, status, expires_at, confirmed_at
      ) values (
        media_source_path, listing_id, state.manager_id, 'confirmed',
        now() + interval '3 hours', now()
      );
      update catalog_phase_zero_listings
      set source_path = media_source_path
      where label = 'published';
      insert into public.listing_variants(listing_id, name, is_active)
      values (listing_id, 'Active', true), (listing_id, 'Inactive', false);
      insert into public.listing_availability(listing_id, is_available)
      values (listing_id, true), (listing_id, false);
    end if;
  end loop;
end;
$$;

do $$
declare state catalog_phase_zero_state%rowtype;
begin
  select * into strict state from catalog_phase_zero_state;
  insert into public.profile_capabilities(profile_id, capability)
  values (state.manager_id, 'super_admin');
  perform pg_catalog.set_config('request.jwt.claim.sub', state.manager_id::text, true);
  update public.profiles set is_suspended = true where id = state.suspended_id;
  perform pg_catalog.set_config('request.jwt.claim.sub', '', true);
  delete from public.profile_capabilities
  where profile_id = state.manager_id and capability = 'super_admin';
end;
$$;

select pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
select pg_catalog.set_config(
  'request.jwt.claim.sub', (select manager_id::text from catalog_phase_zero_state), true
);
set local role authenticated;
do $$
begin
  if (select count(*) from storage.objects object_record
      where object_record.bucket_id = 'listing-media'
        and object_record.name = (
          select source_path from catalog_phase_zero_listings where label = 'published'
        )) <> 1
    or exists (
      select 1 from public.listing_media media_record
      join catalog_phase_zero_listings fixture on fixture.listing_id = media_record.listing_id
    ) then
    raise exception 'manager reserved original pre-registration access failed';
  end if;
end;
$$;
do $$
declare
  state catalog_phase_zero_state%rowtype;
  actor_id uuid;
begin
  select * into strict state from catalog_phase_zero_state;
  foreach actor_id in array array[
    state.staff_id, state.rejected_id, state.suspended_id,
    state.outsider_id, state.foreign_manager_id
  ] loop
    perform pg_catalog.set_config('request.jwt.claim.sub', actor_id::text, true);
    if exists (
      select 1 from storage.objects object_record
      where object_record.bucket_id = 'listing-media'
        and object_record.name = (
          select source_path from catalog_phase_zero_listings where label = 'published'
        )
    ) then
      raise exception 'non-manager reserved original pre-registration access succeeded';
    end if;
  end loop;
end;
$$;
reset role;

do $$
declare state catalog_phase_zero_state%rowtype;
begin
  select * into strict state from catalog_phase_zero_state;
  insert into public.listing_media(listing_id, storage_path, media_type)
  select fixture.listing_id, fixture.source_path, 'image'
  from catalog_phase_zero_listings fixture
  where fixture.label = 'published';
  update public.listings listing_record set status = 'active'
  from catalog_phase_zero_listings fixture where fixture.listing_id = listing_record.id;
  update public.businesses
  set metadata = jsonb_build_object(
    'summary', jsonb_build_object('secretMarker', 'business-secret'),
    'service_areas', jsonb_build_array('Jos'),
    'capability_tags', jsonb_build_array('delivery'),
    'color', '#123456',
    'email', 'private@example.test'
  )
  where id = state.business_id;
  update public.listings listing_record
  set attributes = jsonb_build_object(
    'availability_note', jsonb_build_object('secretMarker', 'note-secret'),
    'availability_windows', jsonb_build_array('today'),
    'capability_tags', jsonb_build_array('delivery'),
    'color', '#112233',
    'price_note', pg_catalog.repeat('x', 241),
    'service_areas', jsonb_build_array(
      'Jos', jsonb_build_object('secretMarker', 'area-secret')
    ),
    'email', 'private@example.test'
  )
  from catalog_phase_zero_listings fixture
  where listing_record.id = fixture.listing_id
    and fixture.label = 'published';
end;
$$;

select pg_catalog.set_config('request.jwt.claim.role', 'anon', true);
select pg_catalog.set_config('request.jwt.claim.sub', '', true);
set local role anon;
do $$
begin
  if not pg_catalog.has_function_privilege(
      'anon', 'public.list_public_catalog_businesses(uuid,integer)', 'execute'
    )
    or not pg_catalog.has_function_privilege(
      'authenticated', 'public.list_public_catalog_businesses(uuid,integer)', 'execute'
    )
    or pg_catalog.has_function_privilege(
      'service_role', 'public.list_public_catalog_businesses(uuid,integer)', 'execute'
    )
    or not pg_catalog.has_function_privilege(
      'anon', 'public.list_public_catalog_listings(uuid,integer)', 'execute'
    )
    or not pg_catalog.has_function_privilege(
      'authenticated', 'public.list_public_catalog_listings(uuid,integer)', 'execute'
    )
    or pg_catalog.has_function_privilege(
      'service_role', 'public.list_public_catalog_listings(uuid,integer)', 'execute'
    ) then
    raise exception 'catalogue RPC ACL contract failed';
  end if;
end;
$$;

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'public.businesses', 'public.listings', 'public.listing_media',
    'public.listing_variants', 'public.listing_availability'
  ] loop
    begin
      execute 'select 1 from ' || table_name || ' limit 1';
      raise exception 'anonymous source table read unexpectedly succeeded: %', table_name;
    exception when insufficient_privilege then null;
    end;
  end loop;
end;
$$;
select count(*) = 1 as anon_public_businesses_only
from public.list_public_catalog_businesses(
  (select market_id from catalog_phase_zero_state), 250
);
select count(*) = 1 as anon_public_listings_only
from public.list_public_catalog_listings(
  (select market_id from catalog_phase_zero_state), 500
);
do $$
begin
  if (select count(*) from public.list_public_catalog_businesses(
      (select market_id from catalog_phase_zero_state), 250
    )) <> 1
    or (select count(*) from public.list_public_catalog_listings(
      (select market_id from catalog_phase_zero_state), 500
    )) <> 1
    or exists (
    select 1 from public.list_public_catalog_businesses(
      (select market_id from catalog_phase_zero_state), 250
    ) where metadata ? 'email'
      or metadata::text like '%secretMarker%'
      or metadata ? 'summary'
      or metadata ? 'service_areas'
      or metadata ? 'capability_tags'
      or metadata - array['serviceAreas', 'capabilityTags', 'color'] <> '{}'::jsonb
      or metadata -> 'serviceAreas' <> '["Jos"]'::jsonb
      or metadata -> 'capabilityTags' <> '["delivery"]'::jsonb
  ) or exists (
    select 1 from public.list_public_catalog_listings(
      (select market_id from catalog_phase_zero_state), 500
    ) where attributes ? 'email'
      or attributes::text like '%secretMarker%'
      or attributes ? 'availabilityNote'
      or attributes ? 'priceNote'
      or attributes ? 'availability_note'
      or attributes ? 'availability_windows'
      or attributes ? 'capability_tags'
      or attributes ? 'price_note'
      or attributes ? 'service_areas'
      or attributes - array[
        'availabilityWindows', 'capabilityTags', 'color', 'serviceAreas'
      ] <> '{}'::jsonb
      or attributes -> 'availabilityWindows' <> '["today"]'::jsonb
      or attributes -> 'capabilityTags' <> '["delivery"]'::jsonb
      or attributes -> 'serviceAreas' <> '[]'::jsonb
  ) or exists (
    select 1 from public.list_public_catalog_businesses(
      (select market_id from catalog_phase_zero_state), 0
    )
  ) or exists (
    select 1 from public.list_public_catalog_listings(
      (select market_id from catalog_phase_zero_state), 501
    )
  ) then
    raise exception 'anonymous catalogue projection allowlist or limit boundary failed';
  end if;
end;
$$;
do $$
begin
  if exists (
    select 1
    from storage.objects object_record
    where object_record.bucket_id = 'listing-media'
      and object_record.name = (
        select source_path from catalog_phase_zero_listings where label = 'published'
      )
  ) then
    raise exception 'anonymous source object read unexpectedly succeeded';
  end if;
end;
$$;
reset role;

select pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
select pg_catalog.set_config('request.jwt.claim.sub', '', true);
set local role service_role;
do $$
begin
  begin
    perform 1
    from public.list_public_catalog_businesses(
      (select market_id from catalog_phase_zero_state), 1
    );
    raise exception 'service role catalogue RPC unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;

  begin
    perform 1
    from public.list_public_catalog_listings(
      (select market_id from catalog_phase_zero_state), 1
    );
    raise exception 'service role catalogue RPC unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

do $$
declare state catalog_phase_zero_state%rowtype;
begin
  select * into strict state from catalog_phase_zero_state;
  perform pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
  perform pg_catalog.set_config('request.jwt.claim.sub', state.outsider_id::text, true);
end;
$$;
set local role authenticated;
do $$
begin
  if (select count(*) from public.businesses business_record
      where business_record.id in (
        select business_id from catalog_phase_zero_state
        union all select foreign_business_id from catalog_phase_zero_state
        union all select inactive_business_id from catalog_phase_zero_state
      )) <> 0
    or (select count(*) from public.listings listing_record
        join catalog_phase_zero_listings fixture on fixture.listing_id = listing_record.id) <> 0
    or (select count(*) from public.listing_variants variant_record
        join catalog_phase_zero_listings fixture on fixture.listing_id = variant_record.listing_id) <> 0
    or (select count(*) from public.listing_availability availability_record
        join catalog_phase_zero_listings fixture on fixture.listing_id = availability_record.listing_id) <> 0
    or (select count(*) from public.listing_media media_record
        join catalog_phase_zero_listings fixture on fixture.listing_id = media_record.listing_id) <> 0 then
    raise exception 'authenticated outsider source read unexpectedly succeeded';
  end if;
end;
$$;
reset role;

do $$
declare state catalog_phase_zero_state%rowtype;
begin
  select * into strict state from catalog_phase_zero_state;
  perform pg_catalog.set_config('request.jwt.claim.sub', state.staff_id::text, true);
end;
$$;
set local role authenticated;
do $$
begin
  if (select count(*) from public.businesses business_record
      where business_record.id = (select business_id from catalog_phase_zero_state)) <> 1
    or (select count(*) from public.listings listing_record
        join catalog_phase_zero_listings fixture on fixture.listing_id = listing_record.id
        where listing_record.business_id = (select business_id from catalog_phase_zero_state)) <> 4
    or (select count(*) from public.listing_variants variant_record
        join catalog_phase_zero_listings fixture on fixture.listing_id = variant_record.listing_id) <> 2
    or (select count(*) from public.listing_availability availability_record
        join catalog_phase_zero_listings fixture on fixture.listing_id = availability_record.listing_id) <> 2
    or (select count(*) from public.listing_media media_record
        join catalog_phase_zero_listings fixture on fixture.listing_id = media_record.listing_id) <> 0
    or (select count(*) from storage.objects object_record
        where object_record.bucket_id = 'listing-media'
          and object_record.name = (
            select source_path from catalog_phase_zero_listings where label = 'published'
          )) <> 0 then
    raise exception 'staff source boundary failed';
  end if;
end;
$$;
reset role;

do $$
declare state catalog_phase_zero_state%rowtype;
begin
  select * into strict state from catalog_phase_zero_state;
  perform pg_catalog.set_config('request.jwt.claim.sub', state.rejected_id::text, true);
end;
$$;
set local role authenticated;
do $$
begin
  if exists (
    select 1 from public.businesses business_record
    where business_record.id = (select business_id from catalog_phase_zero_state)
  ) or exists (
    select 1 from public.listing_media media_record
    join catalog_phase_zero_listings fixture on fixture.listing_id = media_record.listing_id
  ) or exists (
    select 1 from storage.objects object_record
    where object_record.bucket_id = 'listing-media'
      and object_record.name = (
        select source_path from catalog_phase_zero_listings where label = 'published'
      )
  ) then
    raise exception 'unaccepted membership source access unexpectedly succeeded';
  end if;
end;
$$;
reset role;

do $$
declare state catalog_phase_zero_state%rowtype;
begin
  select * into strict state from catalog_phase_zero_state;
  perform pg_catalog.set_config('request.jwt.claim.sub', state.manager_id::text, true);
end;
$$;
set local role authenticated;
do $$
begin
  if (select count(*) from public.listing_media media_record
      join catalog_phase_zero_listings fixture on fixture.listing_id = media_record.listing_id
      where fixture.label = 'published') <> 1
    or (select count(*) from storage.objects object_record
        where object_record.bucket_id = 'listing-media'
          and object_record.name = (
            select source_path from catalog_phase_zero_listings where label = 'published'
          )) <> 1 then
    raise exception 'manager original media access failed';
  end if;
end;
$$;
reset role;

do $$
declare state catalog_phase_zero_state%rowtype;
begin
  select * into strict state from catalog_phase_zero_state;
  perform pg_catalog.set_config('request.jwt.claim.sub', state.foreign_manager_id::text, true);
end;
$$;
set local role authenticated;
do $$
begin
  if (select count(*) from public.listing_media media_record
      join catalog_phase_zero_listings fixture on fixture.listing_id = media_record.listing_id) <> 0
    or (select count(*) from storage.objects object_record
        where object_record.bucket_id = 'listing-media'
          and object_record.name = (
            select source_path from catalog_phase_zero_listings where label = 'published'
          )) <> 0 then
    raise exception 'cross-business manager media access unexpectedly succeeded';
  end if;
end;
$$;
reset role;

do $$
declare state catalog_phase_zero_state%rowtype;
begin
  select * into strict state from catalog_phase_zero_state;
  perform pg_catalog.set_config('request.jwt.claim.sub', state.suspended_id::text, true);
end;
$$;
set local role authenticated;
do $$
begin
  if exists (
    select 1 from public.businesses business_record
    where business_record.id = (select business_id from catalog_phase_zero_state)
  ) or exists (
    select 1 from public.listing_media media_record
    join catalog_phase_zero_listings fixture on fixture.listing_id = media_record.listing_id
  ) or exists (
    select 1 from storage.objects object_record
    where object_record.bucket_id = 'listing-media'
      and object_record.name = (
        select source_path from catalog_phase_zero_listings where label = 'published'
      )
  ) then
    raise exception 'suspended manager source access unexpectedly succeeded';
  end if;
end;
$$;
reset role;

rollback;

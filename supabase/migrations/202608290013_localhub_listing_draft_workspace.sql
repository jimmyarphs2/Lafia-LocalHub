-- Authenticated listing drafts use one database-authoritative ALE document,
-- transaction-bound idempotency, optimistic concurrency, and RPC-only writes.
-- Rollback is a new forward migration that removes the RPCs only after callers
-- stop using them; restoring broad table DML is intentionally not automatic.

alter table public.listings
  add column draft_revision bigint not null default 1;

alter table public.listings
  add constraint listings_draft_revision_positive
  check (draft_revision > 0);

create unique index category_listing_type_mappings_one_default_idx
  on public.category_listing_type_mappings(category_id)
  where is_default;

create unique index listing_schemas_ale_schema_key_idx
  on public.listing_schemas ((schema ->> 'schemaKey'))
  where schema ? 'schemaKey';

create index listings_business_draft_updated_idx
  on public.listings(business_id, updated_at desc)
  where status = 'draft';

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table private.listing_draft_create_requests (
  actor_id uuid not null references public.profiles(id) on delete restrict,
  idempotency_key uuid not null,
  request_hash bytea not null check (octet_length(request_hash) = 32),
  business_id uuid not null references public.businesses(id) on delete restrict,
  listing_id uuid unique references public.listings(id) on delete set null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (actor_id, idempotency_key),
  check (listing_id is null or completed_at is not null)
);

alter table private.listing_draft_create_requests enable row level security;
revoke all on table private.listing_draft_create_requests
  from public, anon, authenticated;

create or replace function private.is_supported_listing_schema_document(
  p_schema jsonb,
  p_relational_version integer,
  p_listing_type_code text
)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  field jsonb;
  field_key text;
  field_type text;
  option_value jsonb;
  binding_key text;
  binding_value jsonb;
  seen_field_keys text[] := array[]::text[];
  seen_option_values text[];
begin
  if jsonb_typeof(p_schema) is distinct from 'object'
    or pg_column_size(p_schema) > 65536
    or (select count(*) from jsonb_object_keys(p_schema)) <> 7
    or exists (
      select 1
      from jsonb_object_keys(p_schema) as keys(key)
      where keys.key not in (
        'contractVersion', 'schemaVersion', 'schemaKey', 'listingKind',
        'terminology', 'bindings', 'fields'
      )
    )
    or p_schema ->> 'contractVersion' is distinct from '1.1'
    or jsonb_typeof(p_schema -> 'schemaVersion') is distinct from 'number'
    or (p_schema ->> 'schemaVersion')::numeric <> p_relational_version
    or (p_schema ->> 'schemaVersion')::numeric % 1 <> 0
    or coalesce(p_schema ->> 'schemaKey', '') !~ '^[a-z][a-z0-9_]{1,62}$'
    or p_schema ->> 'listingKind' not in ('product', 'service', 'place')
    or p_schema ->> 'listingKind' is distinct from p_listing_type_code
    or jsonb_typeof(p_schema -> 'terminology') is distinct from 'object'
    or (select count(*) from jsonb_object_keys(p_schema -> 'terminology')) <> 3
    or exists (
      select 1
      from jsonb_object_keys(p_schema -> 'terminology') as keys(key)
      where keys.key not in ('singular', 'plural', 'createAction')
    )
    or jsonb_typeof(p_schema #> '{terminology,singular}') is distinct from 'string'
    or char_length(btrim(p_schema #>> '{terminology,singular}')) not between 1 and 60
    or jsonb_typeof(p_schema #> '{terminology,plural}') is distinct from 'string'
    or char_length(btrim(p_schema #>> '{terminology,plural}')) not between 1 and 60
    or jsonb_typeof(p_schema #> '{terminology,createAction}') is distinct from 'string'
    or char_length(btrim(p_schema #>> '{terminology,createAction}')) not between 1 and 80
    or jsonb_typeof(p_schema -> 'bindings') is distinct from 'object'
    or exists (
      select 1
      from jsonb_object_keys(p_schema -> 'bindings') as keys(key)
      where keys.key not in ('title', 'description', 'price', 'fulfilmentMethods')
    )
    or (
      select count(value) <> count(distinct value)
      from jsonb_each_text(p_schema -> 'bindings')
      where value is not null
    )
    or jsonb_typeof(p_schema #> '{bindings,title}') is distinct from 'string'
    or jsonb_typeof(p_schema -> 'fields') is distinct from 'array'
    or jsonb_array_length(p_schema -> 'fields') not between 1 and 40
  then
    return false;
  end if;

  for field in select value from jsonb_array_elements(p_schema -> 'fields') loop
    if jsonb_typeof(field) is distinct from 'object'
      or not (field ?& array['key', 'label', 'required', 'type'])
      or exists (
        select 1
        from jsonb_object_keys(field) as keys(key)
        where keys.key not in (
          'key', 'label', 'helpText', 'required', 'type', 'minLength',
          'maxLength', 'placeholder', 'min', 'max', 'step', 'currency',
          'options'
        )
      )
      or jsonb_typeof(field -> 'key') is distinct from 'string'
      or jsonb_typeof(field -> 'label') is distinct from 'string'
      or jsonb_typeof(field -> 'required') is distinct from 'boolean'
      or jsonb_typeof(field -> 'type') is distinct from 'string'
    then
      return false;
    end if;

    field_key := field ->> 'key';
    field_type := field ->> 'type';
    if field_key !~ '^[a-z][a-zA-Z0-9]{0,62}$'
      or field_key = any(seen_field_keys)
      or char_length(btrim(field ->> 'label')) not between 1 and 100
      or field_type not in (
        'short_text', 'long_text', 'location', 'number', 'money', 'duration',
        'select', 'multi_select', 'boolean', 'date', 'time'
      )
      or (field ? 'helpText' and (
        jsonb_typeof(field -> 'helpText') <> 'string'
        or char_length(field ->> 'helpText') > 240
      ))
    then
      return false;
    end if;
    seen_field_keys := array_append(seen_field_keys, field_key);

    if field_type in ('short_text', 'long_text', 'location') then
      if exists (
        select 1
        from jsonb_object_keys(field) as keys(key)
        where keys.key not in (
          'key', 'label', 'helpText', 'required', 'type', 'minLength',
          'maxLength', 'placeholder'
        )
      )
        or (field ? 'minLength' and (
          jsonb_typeof(field -> 'minLength') <> 'number'
          or (field ->> 'minLength')::numeric % 1 <> 0
          or (field ->> 'minLength')::numeric < 0
        ))
        or (field ? 'maxLength' and (
          jsonb_typeof(field -> 'maxLength') <> 'number'
          or (field ->> 'maxLength')::numeric % 1 <> 0
          or (field ->> 'maxLength')::numeric not between 1 and 5000
        ))
        or (
          field ? 'minLength' and field ? 'maxLength'
          and (field ->> 'minLength')::numeric > (field ->> 'maxLength')::numeric
        )
        or (field ? 'placeholder' and (
          jsonb_typeof(field -> 'placeholder') <> 'string'
          or char_length(field ->> 'placeholder') > 160
        ))
      then
        return false;
      end if;
    elsif field_type in ('number', 'money', 'duration') then
      if exists (
        select 1
        from jsonb_object_keys(field) as keys(key)
        where keys.key not in (
          'key', 'label', 'helpText', 'required', 'type', 'min', 'max',
          'step', 'currency'
        )
      )
        or (field ? 'min' and jsonb_typeof(field -> 'min') <> 'number')
        or (field ? 'max' and jsonb_typeof(field -> 'max') <> 'number')
        or (field ? 'step' and (
          jsonb_typeof(field -> 'step') <> 'number'
          or (field ->> 'step')::numeric <= 0
        ))
        or (
          field ? 'min' and field ? 'max'
          and (field ->> 'min')::numeric > (field ->> 'max')::numeric
        )
        or (field ? 'currency' and (
          field_type <> 'money'
          or jsonb_typeof(field -> 'currency') <> 'string'
          or field ->> 'currency' !~ '^[A-Z]{3}$'
        ))
      then
        return false;
      end if;
    elsif field_type in ('select', 'multi_select') then
      if exists (
        select 1
        from jsonb_object_keys(field) as keys(key)
        where keys.key not in (
          'key', 'label', 'helpText', 'required', 'type', 'options'
        )
      )
        or jsonb_typeof(field -> 'options') is distinct from 'array'
        or jsonb_array_length(field -> 'options') not between 1 and 30
      then
        return false;
      end if;
      seen_option_values := array[]::text[];
      for option_value in
        select value from jsonb_array_elements(field -> 'options')
      loop
        if jsonb_typeof(option_value) is distinct from 'object'
          or (select count(*) from jsonb_object_keys(option_value)) <> 2
          or exists (
            select 1
            from jsonb_object_keys(option_value) as keys(key)
            where keys.key not in ('label', 'value')
          )
          or jsonb_typeof(option_value -> 'label') is distinct from 'string'
          or jsonb_typeof(option_value -> 'value') is distinct from 'string'
          or char_length(btrim(option_value ->> 'label')) not between 1 and 80
          or char_length(option_value ->> 'value') not between 1 and 80
          or option_value ->> 'value' = any(seen_option_values)
        then
          return false;
        end if;
        seen_option_values := array_append(
          seen_option_values,
          option_value ->> 'value'
        );
      end loop;
    elsif exists (
      select 1
      from jsonb_object_keys(field) as keys(key)
      where keys.key not in ('key', 'label', 'helpText', 'required', 'type')
    ) then
      return false;
    end if;
  end loop;

  for binding_key, binding_value in
    select key, value from jsonb_each(p_schema -> 'bindings')
  loop
    if jsonb_typeof(binding_value) is distinct from 'string'
      or not (binding_value #>> '{}') = any(seen_field_keys)
      or not exists (
        select 1
        from jsonb_array_elements(p_schema -> 'fields') as fields(field)
        where fields.field ->> 'key' = binding_value #>> '{}'
          and (
            (binding_key = 'title' and fields.field ->> 'type' = 'short_text')
            or (
              binding_key = 'description'
              and fields.field ->> 'type' in ('short_text', 'long_text')
            )
            or (binding_key = 'price' and fields.field ->> 'type' = 'money')
            or (
              binding_key = 'fulfilmentMethods'
              and fields.field ->> 'type' = 'multi_select'
            )
          )
          and (
            binding_key <> 'title'
            or (fields.field ->> 'required')::boolean
          )
      )
    then
      return false;
    end if;
  end loop;

  return true;
exception
  when others then
    return false;
end;
$$;

create or replace function private.listing_draft_values_are_valid(
  p_schema jsonb,
  p_relational_version integer,
  p_listing_type_code text,
  p_values jsonb
)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  field jsonb;
  field_key text;
  field_type text;
  submitted_value jsonb;
  numeric_value numeric;
  minimum_value numeric;
  step_value numeric;
begin
  if not private.is_supported_listing_schema_document(
      p_schema,
      p_relational_version,
      p_listing_type_code
    )
    or jsonb_typeof(p_values) is distinct from 'object'
    or pg_column_size(p_values) > 65536
    or exists (
      select 1
      from jsonb_object_keys(p_values) as submitted(key)
      where not exists (
        select 1
        from jsonb_array_elements(p_schema -> 'fields') as fields(field)
        where fields.field ->> 'key' = submitted.key
      )
    )
  then
    return false;
  end if;

  for field in select value from jsonb_array_elements(p_schema -> 'fields') loop
    field_key := field ->> 'key';
    field_type := field ->> 'type';
    if not (p_values ? field_key) then
      if (field ->> 'required')::boolean then return false; end if;
      continue;
    end if;
    submitted_value := p_values -> field_key;
    if submitted_value = 'null'::jsonb then return false; end if;

    if field_type in ('short_text', 'long_text', 'location') then
      if jsonb_typeof(submitted_value) <> 'string'
        or (
          (field ->> 'required')::boolean
          and char_length(btrim(submitted_value #>> '{}')) = 0
        )
        or (
          field ? 'minLength'
          and char_length(btrim(submitted_value #>> '{}'))
            < (field ->> 'minLength')::integer
        )
        or (
          field ? 'maxLength'
          and char_length(btrim(submitted_value #>> '{}'))
            > (field ->> 'maxLength')::integer
        )
      then
        return false;
      end if;
    elsif field_type in ('number', 'money', 'duration') then
      if jsonb_typeof(submitted_value) <> 'number' then return false; end if;
      numeric_value := (submitted_value #>> '{}')::numeric;
      if (field ? 'min' and numeric_value < (field ->> 'min')::numeric)
        or (field ? 'max' and numeric_value > (field ->> 'max')::numeric)
        or (field_type = 'money' and (
          numeric_value < 0 or scale(numeric_value) > 2
          or numeric_value > 90000000000000000
        ))
      then
        return false;
      end if;
      if field ? 'step' then
        step_value := (field ->> 'step')::numeric;
        minimum_value := case
          when field ? 'min' then (field ->> 'min')::numeric
          else 0
        end;
        if mod(numeric_value - minimum_value, step_value) <> 0 then
          return false;
        end if;
      end if;
    elsif field_type = 'boolean' then
      if jsonb_typeof(submitted_value) <> 'boolean' then return false; end if;
    elsif field_type = 'date' then
      if jsonb_typeof(submitted_value) <> 'string'
        or submitted_value #>> '{}' !~ '^\d{4}-\d{2}-\d{2}$'
      then
        return false;
      end if;
      perform (submitted_value #>> '{}')::date;
    elsif field_type = 'time' then
      if jsonb_typeof(submitted_value) <> 'string'
        or submitted_value #>> '{}' !~ '^([01]\d|2[0-3]):[0-5]\d$'
      then
        return false;
      end if;
    elsif field_type = 'select' then
      if jsonb_typeof(submitted_value) <> 'string'
        or not exists (
          select 1
          from jsonb_array_elements(field -> 'options') as options(option)
          where options.option ->> 'value' = submitted_value #>> '{}'
        )
      then
        return false;
      end if;
    elsif field_type = 'multi_select' then
      if jsonb_typeof(submitted_value) <> 'array'
        or jsonb_array_length(submitted_value)
          > jsonb_array_length(field -> 'options')
        or (
          (field ->> 'required')::boolean
          and jsonb_array_length(submitted_value) = 0
        )
        or exists (
          select 1
          from jsonb_array_elements(submitted_value) as choices(choice)
          where jsonb_typeof(choices.choice) <> 'string'
            or not exists (
              select 1
              from jsonb_array_elements(field -> 'options') as options(option)
              where options.option ->> 'value' = choices.choice #>> '{}'
            )
        )
        or (
          select count(*) <> count(distinct choices.choice #>> '{}')
          from jsonb_array_elements(submitted_value) as choices(choice)
        )
      then
        return false;
      end if;
    else
      return false;
    end if;
  end loop;

  return true;
exception
  when others then
    return false;
end;
$$;

create or replace function private.enforce_listing_schema_document()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  listing_type_code text;
begin
  if old.published_at is not null and (
    new.schema is distinct from old.schema
    or new.version is distinct from old.version
    or new.listing_type_id is distinct from old.listing_type_id
    or new.published_at is distinct from old.published_at
  ) then
    raise exception 'published listing schema identity is immutable';
  end if;

  if new.status = 'published' then
    select lt.code into listing_type_code
    from public.listing_types lt
    where lt.id = new.listing_type_id;
    if new.published_at is null
      or not private.is_supported_listing_schema_document(
        new.schema,
        new.version,
        listing_type_code
      )
    then
      raise exception 'invalid published listing schema';
    end if;
  end if;
  return new;
end;
$$;

create trigger listing_schemas_enforce_ale_document
before insert or update on public.listing_schemas
for each row execute function private.enforce_listing_schema_document();

create or replace function private.lock_active_business_manager(
  p_business_id uuid,
  p_actor_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  allowed boolean := false;
begin
  select true into allowed
  from public.profiles p
  join public.business_memberships membership
    on membership.profile_id = p.id
  join public.businesses b on b.id = membership.business_id
  join public.markets m on m.id = b.market_id
  where p.id = p_actor_id
    and not p.is_suspended
    and membership.business_id = p_business_id
    and membership.accepted_at is not null
    and membership.role in ('owner', 'manager')
    and b.status in ('pending_review', 'active')
    and m.is_active
  for no key update of p, membership, b, m;
  return coalesce(allowed, false);
end;
$$;

create or replace function private.resolve_listing_draft_taxonomy(
  p_business_id uuid
)
returns table (
  business_id uuid,
  business_name text,
  market_id uuid,
  location_id uuid,
  currency_code text,
  category_id uuid,
  category_slug text,
  listing_type_id uuid,
  listing_type_code text,
  listing_schema_id uuid,
  schema_key text,
  schema_version integer,
  schema_document jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  stored_category_slug text;
  category_count integer;
begin
  select d.data #>> '{values,categorySlug}'
  into stored_category_slug
  from public.business_onboarding_drafts d
  where d.business_id = p_business_id
    and d.step = 'complete'
    and d.submitted_at is not null;

  if stored_category_slug is null
    or stored_category_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
  then
    raise exception 'taxonomy_unavailable';
  end if;

  select count(*) into category_count
  from public.businesses b
  join public.markets m on m.id = b.market_id and m.is_active
  join public.categories c
    on c.market_id = b.market_id
    and c.slug = stored_category_slug
    and c.is_active
  where b.id = p_business_id
    and b.status in ('pending_review', 'active');

  if category_count = 0 then
    select count(*) into category_count
    from public.businesses b
    join public.markets m on m.id = b.market_id and m.is_active
    join public.categories c
      on c.market_id is null
      and c.slug = stored_category_slug
      and c.is_active
    where b.id = p_business_id
      and b.status in ('pending_review', 'active');
  end if;

  if category_count <> 1 then raise exception 'taxonomy_unavailable'; end if;

  return query
  with target_business as (
    select b.id, b.name, b.market_id, b.location_id, m.currency_code
    from public.businesses b
    join public.markets m on m.id = b.market_id and m.is_active
    where b.id = p_business_id
      and b.status in ('pending_review', 'active')
  ), target_category as (
    select c.id, c.slug
    from target_business b
    join public.categories c
      on c.slug = stored_category_slug
      and c.is_active
      and (c.market_id = b.market_id or c.market_id is null)
    order by (c.market_id = b.market_id) desc
    limit 1
  )
  select
    b.id,
    b.name,
    b.market_id,
    b.location_id,
    b.currency_code::text,
    c.id,
    c.slug,
    lt.id,
    lt.code,
    s.id,
    s.schema ->> 'schemaKey',
    s.version,
    s.schema
  from target_business b
  join target_category c on true
  join public.category_listing_type_mappings mapping
    on mapping.category_id = c.id and mapping.is_default
  join public.listing_types lt
    on lt.id = mapping.listing_type_id and lt.is_active
  join public.listing_schemas s
    on s.id = mapping.listing_schema_id
    and s.listing_type_id = lt.id
    and s.status = 'published'
    and s.published_at is not null
  where private.is_supported_listing_schema_document(
    s.schema,
    s.version,
    lt.code
  )
    and not exists (
      select 1
      from jsonb_array_elements(s.schema -> 'fields') as fields(field)
      where fields.field ->> 'type' = 'money'
        and coalesce(fields.field ->> 'currency', b.currency_code)
          <> b.currency_code
    );

  if not found then raise exception 'taxonomy_unavailable'; end if;
end;
$$;

create or replace function public.get_listing_draft_context(
  p_business_id uuid default null,
  p_listing_id uuid default null
)
returns table (
  mode text,
  listing_id uuid,
  business_id uuid,
  draft_revision bigint,
  slug text,
  category_id uuid,
  category_slug text,
  listing_type_id uuid,
  listing_type_code text,
  listing_schema_id uuid,
  schema_key text,
  schema_version integer,
  schema_document jsonb,
  "values" jsonb,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  taxonomy record;
  draft public.listings%rowtype;
  binding_keys jsonb;
  reconstructed_values jsonb;
begin
  if actor is null
    or not public.is_active_profile(actor)
    or ((p_business_id is null) = (p_listing_id is null))
  then
    raise exception using errcode = '42501', message = 'draft_unavailable';
  end if;

  if p_listing_id is null then
    if not public.is_business_manager(p_business_id) then
      raise exception using errcode = '42501', message = 'draft_unavailable';
    end if;
    select * into taxonomy
    from private.resolve_listing_draft_taxonomy(p_business_id);
    return query select
      'create'::text,
      null::uuid,
      taxonomy.business_id,
      null::bigint,
      null::text,
      taxonomy.category_id,
      taxonomy.category_slug,
      taxonomy.listing_type_id,
      taxonomy.listing_type_code,
      taxonomy.listing_schema_id,
      taxonomy.schema_key,
      taxonomy.schema_version,
      taxonomy.schema_document,
      null::jsonb,
      null::timestamptz;
    return;
  end if;

  select l.* into draft
  from public.listings l
  join public.businesses b
    on b.id = l.business_id and b.status in ('pending_review', 'active')
  join public.markets m on m.id = l.market_id and m.is_active
  where l.id = p_listing_id
    and l.status = 'draft'
    and public.is_business_manager(l.business_id);
  if not found then
    raise exception using errcode = '42501', message = 'draft_unavailable';
  end if;

  select
    draft.business_id as business_id,
    b.name as business_name,
    draft.market_id as market_id,
    draft.location_id as location_id,
    m.currency_code as currency_code,
    draft.category_id as category_id,
    c.slug as category_slug,
    draft.listing_type_id as listing_type_id,
    lt.code as listing_type_code,
    draft.listing_schema_id as listing_schema_id,
    s.schema ->> 'schemaKey' as schema_key,
    s.version as schema_version,
    s.schema as schema_document
  into taxonomy
  from public.businesses b
  join public.markets m on m.id = draft.market_id and m.is_active
  join public.categories c
    on c.id = draft.category_id
    and c.is_active
    and (c.market_id = draft.market_id or c.market_id is null)
  join public.category_listing_type_mappings mapping
    on mapping.category_id = draft.category_id
    and mapping.listing_type_id = draft.listing_type_id
    and mapping.listing_schema_id = draft.listing_schema_id
    and mapping.is_default
  join public.listing_types lt
    on lt.id = draft.listing_type_id and lt.is_active
  join public.listing_schemas s
    on s.id = draft.listing_schema_id
    and s.listing_type_id = draft.listing_type_id
    and s.status = 'published'
    and s.published_at is not null
  where b.id = draft.business_id
    and private.is_supported_listing_schema_document(s.schema, s.version, lt.code)
    and not exists (
      select 1
      from jsonb_array_elements(s.schema -> 'fields') as fields(field)
      where fields.field ->> 'type' = 'money'
        and coalesce(fields.field ->> 'currency', m.currency_code)
          <> m.currency_code
    );
  if not found then raise exception 'taxonomy_stale'; end if;

  binding_keys := taxonomy.schema_document -> 'bindings';
  reconstructed_values := draft.attributes
    || jsonb_build_object(binding_keys ->> 'title', draft.title);
  if nullif(binding_keys ->> 'description', '') is not null
    and draft.description is not null
  then
    reconstructed_values := reconstructed_values
      || jsonb_build_object(binding_keys ->> 'description', draft.description);
  end if;
  if nullif(binding_keys ->> 'price', '') is not null
    and draft.price_minor is not null
  then
    reconstructed_values := reconstructed_values
      || jsonb_build_object(
        binding_keys ->> 'price',
        draft.price_minor::numeric / 100
      );
  end if;
  if nullif(binding_keys ->> 'fulfilmentMethods', '') is not null then
    reconstructed_values := reconstructed_values
      || jsonb_build_object(
        binding_keys ->> 'fulfilmentMethods',
        draft.fulfilment_methods
      );
  end if;

  if not private.listing_draft_values_are_valid(
    taxonomy.schema_document,
    taxonomy.schema_version,
    taxonomy.listing_type_code,
    reconstructed_values
  ) then
    raise exception 'draft_values_invalid';
  end if;

  return query select
    'edit'::text,
    draft.id,
    draft.business_id,
    draft.draft_revision,
    draft.slug,
    draft.category_id,
    taxonomy.category_slug,
    draft.listing_type_id,
    taxonomy.listing_type_code,
    draft.listing_schema_id,
    taxonomy.schema_key,
    taxonomy.schema_version,
    taxonomy.schema_document,
    reconstructed_values,
    draft.updated_at;
end;
$$;

create or replace function public.save_listing_draft(
  p_expected_schema_id uuid,
  p_expected_schema_version integer,
  p_payload jsonb,
  p_listing_id uuid default null,
  p_business_id uuid default null,
  p_idempotency_key uuid default null,
  p_expected_revision bigint default null
)
returns table (
  listing_id uuid,
  business_id uuid,
  draft_revision bigint,
  listing_schema_id uuid,
  schema_key text,
  schema_version integer,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  taxonomy record;
  draft public.listings%rowtype;
  saved public.listings%rowtype;
  values_document jsonb;
  bindings jsonb;
  title_value text;
  description_value text;
  price_value bigint;
  currency_value text := 'NGN';
  fulfilment_value jsonb := '[]'::jsonb;
  attributes_value jsonb;
  bound_keys text[];
  slug_base text;
  request_digest bytea;
  request_record private.listing_draft_create_requests%rowtype;
  inserted_request_count integer := 0;
  new_listing_id uuid;
  money_field jsonb;
  replay_schema_key text;
  replay_schema_version integer;
begin
  if actor is null
    or not public.is_active_profile(actor)
    or jsonb_typeof(p_payload) <> 'object'
    or (select count(*) from jsonb_object_keys(p_payload)) <> 2
    or exists (
      select 1 from jsonb_object_keys(p_payload) as keys(key)
      where keys.key not in ('slug', 'values')
    )
    or jsonb_typeof(p_payload -> 'slug') <> 'string'
    or coalesce(p_payload ->> 'slug', '') !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
    or char_length(p_payload ->> 'slug') > 100
    or jsonb_typeof(p_payload -> 'values') <> 'object'
    or p_expected_schema_id is null
    or p_expected_schema_version is null
  then
    raise exception 'invalid_draft_payload';
  end if;
  values_document := p_payload -> 'values';
  slug_base := p_payload ->> 'slug';

  if p_listing_id is null then
    if p_business_id is null
      or p_idempotency_key is null
      or p_expected_revision is not null
      or not private.lock_active_business_manager(p_business_id, actor)
    then
      raise exception using errcode = '42501', message = 'draft_unavailable';
    end if;
    request_digest := extensions.digest(
      convert_to(
        jsonb_build_object(
          'actorId', actor,
          'businessId', p_business_id,
          'schemaId', p_expected_schema_id,
          'schemaVersion', p_expected_schema_version,
          'slug', slug_base,
          'values', values_document
        )::text,
        'UTF8'
      ),
      'sha256'
    );
    select request.* into request_record
    from private.listing_draft_create_requests request
    where request.actor_id = actor
      and request.idempotency_key = p_idempotency_key
    for update;
    if found then
      if request_record.request_hash <> request_digest
        or request_record.business_id <> p_business_id
      then
        raise exception 'idempotency_key_reused';
      end if;
      if request_record.listing_id is null
        or request_record.completed_at is null
      then
        raise exception 'idempotency_result_unavailable';
      end if;
      select l.* into saved
      from public.listings l
      where l.id = request_record.listing_id
        and l.business_id = p_business_id;
      if not found then raise exception 'idempotency_result_unavailable'; end if;
      select s.schema ->> 'schemaKey', s.version
      into replay_schema_key, replay_schema_version
      from public.listing_schemas s
      where s.id = saved.listing_schema_id;
      if not found then raise exception 'idempotency_result_unavailable'; end if;
      return query select
        saved.id,
        saved.business_id,
        saved.draft_revision,
        saved.listing_schema_id,
        replay_schema_key,
        replay_schema_version,
        saved.created_at,
        saved.updated_at;
      return;
    end if;
    select * into taxonomy
    from private.resolve_listing_draft_taxonomy(p_business_id);
  else
    if p_business_id is not null
      or p_idempotency_key is not null
      or p_expected_revision is null
      or p_expected_revision <= 0
    then
      raise exception 'invalid_draft_mode';
    end if;
    select l.* into draft
    from public.listings l
    join public.businesses b
      on b.id = l.business_id and b.status in ('pending_review', 'active')
    join public.markets m on m.id = l.market_id and m.is_active
    where l.id = p_listing_id
      and l.status = 'draft'
      and public.is_business_manager(l.business_id)
    for update of l;
    if not found then
      raise exception using errcode = '42501', message = 'draft_unavailable';
    end if;
    if not private.lock_active_business_manager(draft.business_id, actor) then
      raise exception using errcode = '42501', message = 'draft_unavailable';
    end if;

    select
      draft.business_id as business_id,
      b.name as business_name,
      draft.market_id as market_id,
      draft.location_id as location_id,
      m.currency_code as currency_code,
      draft.category_id as category_id,
      c.slug as category_slug,
      draft.listing_type_id as listing_type_id,
      lt.code as listing_type_code,
      draft.listing_schema_id as listing_schema_id,
      s.schema ->> 'schemaKey' as schema_key,
      s.version as schema_version,
      s.schema as schema_document
    into taxonomy
    from public.businesses b
    join public.markets m on m.id = draft.market_id and m.is_active
    join public.categories c
      on c.id = draft.category_id
      and c.is_active
      and (c.market_id = draft.market_id or c.market_id is null)
    join public.category_listing_type_mappings mapping
      on mapping.category_id = draft.category_id
      and mapping.listing_type_id = draft.listing_type_id
      and mapping.listing_schema_id = draft.listing_schema_id
      and mapping.is_default
    join public.listing_types lt
      on lt.id = draft.listing_type_id and lt.is_active
    join public.listing_schemas s
      on s.id = draft.listing_schema_id
      and s.listing_type_id = draft.listing_type_id
      and s.status = 'published'
      and s.published_at is not null
    where b.id = draft.business_id
      and private.is_supported_listing_schema_document(
        s.schema,
        s.version,
        lt.code
      )
      and not exists (
        select 1
        from jsonb_array_elements(s.schema -> 'fields') as fields(field)
        where fields.field ->> 'type' = 'money'
          and coalesce(fields.field ->> 'currency', m.currency_code)
            <> m.currency_code
      );
    if not found then raise exception 'taxonomy_stale'; end if;
  end if;

  if taxonomy.listing_schema_id <> p_expected_schema_id
    or taxonomy.schema_version <> p_expected_schema_version
  then
    raise exception 'schema_stale';
  end if;
  if p_listing_id is not null and draft.draft_revision <> p_expected_revision then
    raise exception 'draft_revision_conflict';
  end if;

  if not private.listing_draft_values_are_valid(
    taxonomy.schema_document,
    taxonomy.schema_version,
    taxonomy.listing_type_code,
    values_document
  ) then
    raise exception 'draft_values_invalid';
  end if;

  bindings := taxonomy.schema_document -> 'bindings';
  currency_value := taxonomy.currency_code;
  title_value := btrim(values_document ->> (bindings ->> 'title'));
  if char_length(title_value) not between 2 and 160 then
    raise exception 'draft_values_invalid';
  end if;
  if nullif(bindings ->> 'description', '') is not null
    and values_document ? (bindings ->> 'description')
  then
    description_value := btrim(
      values_document ->> (bindings ->> 'description')
    );
  end if;
  if nullif(bindings ->> 'price', '') is not null
    and values_document ? (bindings ->> 'price')
  then
    price_value := (
      (values_document ->> (bindings ->> 'price'))::numeric * 100
    )::bigint;
    select field into money_field
    from jsonb_array_elements(taxonomy.schema_document -> 'fields') as fields(field)
    where fields.field ->> 'key' = bindings ->> 'price';
    if coalesce(money_field ->> 'currency', currency_value)
      <> currency_value
    then
      raise exception 'taxonomy_stale';
    end if;
  end if;
  if nullif(bindings ->> 'fulfilmentMethods', '') is not null
    and values_document ? (bindings ->> 'fulfilmentMethods')
  then
    fulfilment_value := values_document -> (bindings ->> 'fulfilmentMethods');
  end if;
  select coalesce(array_agg(value), array[]::text[]) into bound_keys
  from jsonb_each_text(bindings)
  where value is not null and value <> '';
  attributes_value := values_document - bound_keys;
  if pg_column_size(attributes_value) > 65536 then
    raise exception 'draft_values_invalid';
  end if;
  if p_listing_id is null then
    insert into private.listing_draft_create_requests(
      actor_id,
      idempotency_key,
      request_hash,
      business_id
    ) values (
      actor,
      p_idempotency_key,
      request_digest,
      taxonomy.business_id
    ) on conflict do nothing;
    get diagnostics inserted_request_count = row_count;

    select request.* into request_record
    from private.listing_draft_create_requests request
    where request.actor_id = actor
      and request.idempotency_key = p_idempotency_key
    for update;
    if request_record.request_hash <> request_digest
      or request_record.business_id <> taxonomy.business_id
    then
      raise exception 'idempotency_key_reused';
    end if;
    if inserted_request_count = 0 then
      if request_record.listing_id is null
        or request_record.completed_at is null
      then
        raise exception 'idempotency_result_unavailable';
      end if;
      select l.* into saved
      from public.listings l
      where l.id = request_record.listing_id
        and l.business_id = taxonomy.business_id
        and public.is_business_manager(l.business_id);
      if not found then raise exception 'idempotency_result_unavailable'; end if;
      return query select
        saved.id,
        saved.business_id,
        saved.draft_revision,
        saved.listing_schema_id,
        taxonomy.schema_key,
        taxonomy.schema_version,
        saved.created_at,
        saved.updated_at;
      return;
    end if;

    new_listing_id := gen_random_uuid();
    insert into public.listings(
      id,
      business_id,
      market_id,
      category_id,
      listing_type_id,
      listing_schema_id,
      slug,
      title,
      description,
      status,
      location_id,
      attributes,
      price_minor,
      currency_code,
      fulfilment_methods,
      published_at,
      created_by
    ) values (
      new_listing_id,
      taxonomy.business_id,
      taxonomy.market_id,
      taxonomy.category_id,
      taxonomy.listing_type_id,
      taxonomy.listing_schema_id,
      slug_base || '-' || left(new_listing_id::text, 8),
      title_value,
      description_value,
      'draft',
      taxonomy.location_id,
      attributes_value,
      price_value,
      currency_value,
      fulfilment_value,
      null,
      actor
    ) returning * into saved;
    update private.listing_draft_create_requests
    set listing_id = saved.id, completed_at = now()
    where actor_id = actor and idempotency_key = p_idempotency_key;
  else
    update public.listings l
    set
      slug = slug_base || '-' || left(l.id::text, 8),
      title = title_value,
      description = description_value,
      attributes = attributes_value,
      price_minor = price_value,
      currency_code = currency_value,
      fulfilment_methods = fulfilment_value,
      draft_revision = l.draft_revision + 1
    where l.id = draft.id
      and l.status = 'draft'
      and l.draft_revision = p_expected_revision
    returning l.* into saved;
    if not found then raise exception 'draft_revision_conflict'; end if;
  end if;

  return query select
    saved.id,
    saved.business_id,
    saved.draft_revision,
    saved.listing_schema_id,
    taxonomy.schema_key,
    taxonomy.schema_version,
    saved.created_at,
    saved.updated_at;
end;
$$;

revoke insert, update, delete on public.listings
  from public, anon, authenticated;

drop policy if exists listings_manager_insert on public.listings;
drop policy if exists listings_manager_update on public.listings;
drop policy if exists listings_manager_delete on public.listings;

revoke execute on function private.is_supported_listing_schema_document(
  jsonb,
  integer,
  text
) from public, anon, authenticated;
revoke execute on function private.listing_draft_values_are_valid(
  jsonb,
  integer,
  text,
  jsonb
) from public, anon, authenticated;
revoke execute on function private.enforce_listing_schema_document()
  from public, anon, authenticated;
revoke execute on function private.lock_active_business_manager(uuid, uuid)
  from public, anon, authenticated;
revoke execute on function private.resolve_listing_draft_taxonomy(uuid)
  from public, anon, authenticated;

revoke execute on function public.get_listing_draft_context(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.get_listing_draft_context(uuid, uuid)
  to authenticated;

revoke execute on function public.save_listing_draft(
  uuid,
  integer,
  jsonb,
  uuid,
  uuid,
  uuid,
  bigint
) from public, anon, authenticated;
grant execute on function public.save_listing_draft(
  uuid,
  integer,
  jsonb,
  uuid,
  uuid,
  uuid,
  bigint
) to authenticated;

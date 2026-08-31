-- Step 25A1 creates a private, non-financial referral acquisition identity.
-- Legacy referral relations remain preserved, empty, and owner-dormant.

lock table
  public.referral_rules,
  public.referral_codes,
  public.referral_attributions,
  public.referral_commissions
in share row exclusive mode;

do $$
declare
  table_name text;
  role_name text;
  privilege_name text;
begin
  if exists (select 1 from public.referral_rules)
    or exists (select 1 from public.referral_codes)
    or exists (select 1 from public.referral_attributions)
    or exists (select 1 from public.referral_commissions) then
    raise exception 'referral acquisition migration requires empty legacy referral state'
      using errcode = '55000';
  end if;
  if pg_catalog.to_regclass('private.referrer_identities') is not null
    or pg_catalog.to_regclass('private.referral_acquisition_links') is not null
    or pg_catalog.to_regtype('private.referrer_status_code') is not null
    or pg_catalog.to_regtype('private.referral_link_status_code') is not null
    or pg_catalog.to_regtype('private.referral_target_code') is not null
    or pg_catalog.to_regprocedure('private.prevent_dormant_referral_legacy_mutation()') is not null
    or pg_catalog.to_regprocedure('public.ensure_my_referrer_identity()') is not null
    or pg_catalog.to_regprocedure('public.create_or_get_my_referral_link(uuid)') is not null
    or pg_catalog.to_regprocedure('public.list_my_referral_links()') is not null
    or pg_catalog.to_regprocedure('public.set_my_referral_link_enabled(uuid, boolean)') is not null
    or pg_catalog.to_regprocedure('public.resolve_referral_acquisition_link(text)') is not null then
    raise exception 'referral acquisition migration requires no partial objects'
      using errcode = '55000';
  end if;
  foreach table_name in array array[
    'public.referral_rules', 'public.referral_codes',
    'public.referral_attributions', 'public.referral_commissions'
  ] loop
    if not exists (select 1 from pg_catalog.pg_class c
      where c.oid = table_name::pg_catalog.regclass and c.relrowsecurity)
    then raise exception 'referral acquisition migration requires legacy RLS on %', table_name using errcode = '55000'; end if;
    foreach role_name in array array['anon', 'authenticated', 'service_role'] loop
      foreach privilege_name in array array['select','insert','update','delete','truncate','references','trigger'] loop
        if table_name = 'public.referral_commissions'
          and pg_catalog.has_table_privilege(role_name, table_name, privilege_name) then
          raise exception 'referral acquisition migration requires closed legacy ACLs' using errcode = '55000';
        end if;
      end loop;
      foreach privilege_name in array array['select','insert','update','references'] loop
        if table_name = 'public.referral_commissions'
          and pg_catalog.has_any_column_privilege(role_name, table_name, privilege_name) then
          raise exception 'referral acquisition migration requires closed legacy column ACLs' using errcode = '55000';
        end if;
      end loop;
    end loop;
  end loop;
  if exists (select 1 from pg_catalog.pg_policies p
    where p.schemaname = 'public' and p.tablename in ('referral_rules','referral_attributions','referral_commissions')) then
    raise exception 'referral acquisition migration requires legacy referral quarantine' using errcode = '55000';
  end if;
  if exists (select 1 from pg_catalog.pg_policies p
    where p.schemaname = 'public' and p.tablename = 'referral_codes'
      and p.policyname <> 'referral_codes_owner') then
    raise exception 'referral acquisition migration requires the lone legacy code policy' using errcode = '55000';
  end if;
  if exists (select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname ilike '%commission%') then
    raise exception 'referral acquisition migration requires generic commission closure' using errcode = '55000';
  end if;
  if exists (
    select 1
    from pg_catalog.pg_attribute attribute_record
    where attribute_record.attrelid in (
      'public.referral_rules'::pg_catalog.regclass,
      'public.referral_codes'::pg_catalog.regclass,
      'public.referral_attributions'::pg_catalog.regclass,
      'public.referral_commissions'::pg_catalog.regclass
    )
      and attribute_record.attnum > 0
      and not attribute_record.attisdropped
      and attribute_record.attacl is not null
  ) then
    raise exception 'referral acquisition migration requires no legacy column ACL drift'
      using errcode = '55000';
  end if;
end;
$$;

drop policy if exists referral_codes_owner on public.referral_codes;
alter table public.referral_rules enable row level security;
alter table public.referral_rules force row level security;
alter table public.referral_codes enable row level security;
alter table public.referral_codes force row level security;
alter table public.referral_attributions enable row level security;
alter table public.referral_attributions force row level security;
alter table public.referral_commissions enable row level security;
alter table public.referral_commissions force row level security;
revoke all on table public.referral_rules from public, anon, authenticated, service_role;
revoke all on table public.referral_codes from public, anon, authenticated, service_role;
revoke all on table public.referral_attributions from public, anon, authenticated, service_role;
revoke all on table public.referral_commissions from public, anon, authenticated, service_role;

create or replace function private.prevent_dormant_referral_legacy_mutation()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  raise exception 'legacy referral state is dormant' using errcode = '55000';
end;
$$;
alter function private.prevent_dormant_referral_legacy_mutation() owner to postgres;
revoke all on function private.prevent_dormant_referral_legacy_mutation()
  from public, anon, authenticated, service_role;

create trigger referral_rules_dormant_rows before insert or update or delete on public.referral_rules for each row execute function private.prevent_dormant_referral_legacy_mutation();
create trigger referral_rules_dormant_truncate before truncate on public.referral_rules for each statement execute function private.prevent_dormant_referral_legacy_mutation();
create trigger referral_codes_dormant_rows before insert or update or delete on public.referral_codes for each row execute function private.prevent_dormant_referral_legacy_mutation();
create trigger referral_codes_dormant_truncate before truncate on public.referral_codes for each statement execute function private.prevent_dormant_referral_legacy_mutation();
create trigger referral_attributions_dormant_rows before insert or update or delete on public.referral_attributions for each row execute function private.prevent_dormant_referral_legacy_mutation();
create trigger referral_attributions_dormant_truncate before truncate on public.referral_attributions for each statement execute function private.prevent_dormant_referral_legacy_mutation();
create trigger referral_commissions_dormant_rows before insert or update or delete on public.referral_commissions for each row execute function private.prevent_dormant_referral_legacy_mutation();
create trigger referral_commissions_dormant_truncate before truncate on public.referral_commissions for each statement execute function private.prevent_dormant_referral_legacy_mutation();

create type private.referrer_status_code as enum ('active', 'disabled');
create type private.referral_link_status_code as enum ('active', 'disabled', 'expired');
create type private.referral_target_code as enum ('merchant_onboarding');
revoke all on type private.referrer_status_code from public, anon, authenticated, service_role;
revoke all on type private.referral_link_status_code from public, anon, authenticated, service_role;
revoke all on type private.referral_target_code from public, anon, authenticated, service_role;

create table private.referrer_identities (
  profile_id uuid primary key references public.profiles(id) on delete restrict,
  status private.referrer_status_code not null default 'active',
  created_at timestamptz not null default now(),
  disabled_at timestamptz,
  constraint referrer_identities_state_shape check (
    (status = 'active' and disabled_at is null) or (status = 'disabled' and disabled_at is not null)
  )
);

create table private.referral_acquisition_links (
  id uuid primary key default extensions.gen_random_uuid(),
  referrer_profile_id uuid not null references private.referrer_identities(profile_id) on delete restrict,
  market_id uuid not null references public.markets(id) on delete restrict,
  target private.referral_target_code not null default 'merchant_onboarding' check (target = 'merchant_onboarding'),
  code text not null unique check (code ~ '^[0-9a-f]{32}$'),
  status private.referral_link_status_code not null default 'active',
  generation_version smallint not null default 1 check (generation_version = 1),
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  disabled_at timestamptz,
  constraint referral_acquisition_links_identity_unique unique (referrer_profile_id, market_id, target, generation_version),
  constraint referral_acquisition_links_status_shape check (
    (status = 'active' and disabled_at is null)
    or (status = 'disabled' and disabled_at is not null)
    or (status = 'expired' and expires_at is not null and disabled_at is null)
  ),
  constraint referral_acquisition_links_expiry_shape check (expires_at is null or expires_at > created_at)
);
create unique index referral_acquisition_links_one_active_idx on private.referral_acquisition_links(referrer_profile_id, market_id, target) where status = 'active';
create index referral_acquisition_links_referrer_fkey_idx on private.referral_acquisition_links(referrer_profile_id);
create index referral_acquisition_links_market_fkey_idx on private.referral_acquisition_links(market_id);

alter table private.referrer_identities enable row level security;
alter table private.referrer_identities force row level security;
alter table private.referral_acquisition_links enable row level security;
alter table private.referral_acquisition_links force row level security;
revoke all on table private.referrer_identities from public, anon, authenticated, service_role;
revoke all on table private.referral_acquisition_links from public, anon, authenticated, service_role;

create or replace function public.ensure_my_referrer_identity()
returns table(profile_id uuid, status text, created_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid();
begin
  if actor is null or not exists (select 1 from public.profiles p where p.id = actor and not p.is_suspended) then raise exception 'active authentication is required' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('referrer:' || actor::text, 0));
  insert into private.referrer_identities(profile_id) values (actor)
    on conflict on constraint referrer_identities_pkey do nothing;
  if exists (select 1 from private.referrer_identities i where i.profile_id = actor and i.status = 'disabled') then raise exception 'referrer identity is disabled' using errcode = '55000'; end if;
  return query select i.profile_id, i.status::text, i.created_at from private.referrer_identities i where i.profile_id = actor;
end;
$$;
alter function public.ensure_my_referrer_identity() owner to postgres;

create or replace function public.create_or_get_my_referral_link(p_market_id uuid)
returns table(link_id uuid, code text, market_id uuid, target text, status text, expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); generated_code text; tries integer := 0;
begin
  if actor is null or not exists (select 1 from public.profiles p where p.id=actor and not p.is_suspended) then raise exception 'active authentication is required' using errcode='42501'; end if;
  if not exists (select 1 from public.markets m where m.id=p_market_id and m.is_active) then raise exception 'inactive market' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('referral-link:' || actor::text || ':' || p_market_id::text, 0));
  perform public.ensure_my_referrer_identity();
  return query select l.id,l.code,l.market_id,l.target::text,l.status::text,l.expires_at from private.referral_acquisition_links l where l.referrer_profile_id=actor and l.market_id=p_market_id and l.target='merchant_onboarding' and l.generation_version=1;
  if found then return; end if;
  loop
    tries := tries + 1; generated_code := encode(extensions.gen_random_bytes(16), 'hex');
    begin
      insert into private.referral_acquisition_links(referrer_profile_id,market_id,code) values(actor,p_market_id,generated_code);
      exit;
    exception when unique_violation then if tries >= 3 then raise exception 'referral link retry required' using errcode='40001'; end if; end;
  end loop;
  return query select l.id,l.code,l.market_id,l.target::text,l.status::text,l.expires_at from private.referral_acquisition_links l where l.referrer_profile_id=actor and l.market_id=p_market_id and l.target='merchant_onboarding' and l.generation_version=1;
end;
$$;
alter function public.create_or_get_my_referral_link(uuid) owner to postgres;

create or replace function public.list_my_referral_links()
returns table(link_id uuid, code text, market_id uuid, target text, status text, expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid();
begin
  if actor is null or not exists (select 1 from public.profiles p where p.id=actor and not p.is_suspended) then raise exception 'active authentication is required' using errcode='42501'; end if;
  return query select l.id,l.code,l.market_id,l.target::text,l.status::text,l.expires_at from private.referral_acquisition_links l where l.referrer_profile_id=actor order by l.created_at,l.id;
end;
$$;
alter function public.list_my_referral_links() owner to postgres;

create or replace function public.set_my_referral_link_enabled(p_link_id uuid, p_enabled boolean)
returns table(link_id uuid, code text, market_id uuid, target text, status text, expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid();
begin
  if actor is null or not exists (select 1 from public.profiles p where p.id=actor and not p.is_suspended) then raise exception 'active authentication is required' using errcode='42501'; end if;
  if p_link_id is null or p_enabled is null then raise exception 'invalid referral link change' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('referral-toggle:' || actor::text || ':' || p_link_id::text, 0));
  if p_enabled and (not exists (select 1 from private.referrer_identities i where i.profile_id=actor and i.status='active') or not exists (select 1 from private.referral_acquisition_links l join public.markets m on m.id=l.market_id where l.id=p_link_id and l.referrer_profile_id=actor and m.is_active and (l.expires_at is null or l.expires_at>now()))) then raise exception 'referral link cannot be enabled' using errcode='55000'; end if;
  update private.referral_acquisition_links l set status=case when p_enabled then 'active'::private.referral_link_status_code else 'disabled'::private.referral_link_status_code end, disabled_at=case when p_enabled then null else now() end where l.id=p_link_id and l.referrer_profile_id=actor and l.status is distinct from case when p_enabled then 'active'::private.referral_link_status_code else 'disabled'::private.referral_link_status_code end;
  if not found and not exists(select 1 from private.referral_acquisition_links l where l.id=p_link_id and l.referrer_profile_id=actor) then raise exception 'referral link not found' using errcode='42501'; end if;
  return query select l.id,l.code,l.market_id,l.target::text,l.status::text,l.expires_at from private.referral_acquisition_links l where l.id=p_link_id and l.referrer_profile_id=actor;
end;
$$;
alter function public.set_my_referral_link_enabled(uuid, boolean) owner to postgres;

create or replace function public.resolve_referral_acquisition_link(p_code text)
returns table(outcome text, market_slug text, target text, canonical_target_path text, expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
begin
  if p_code is null or octet_length(p_code) <> 32 then return query select 'invalid'::text,null::text,null::text,null::text,null::timestamptz; return; end if;
  if p_code !~ '^[0-9a-f]{32}$' then return query select 'invalid'::text,null::text,null::text,null::text,null::timestamptz; return; end if;
  return query select case when l.status='expired' or (l.expires_at is not null and l.expires_at <= now()) then 'expired' else 'valid' end, m.slug, l.target::text, '/' || m.slug || '/vendor/onboarding/referral', l.expires_at from private.referral_acquisition_links l join private.referrer_identities i on i.profile_id=l.referrer_profile_id and i.status='active' join public.profiles p on p.id=i.profile_id and not p.is_suspended join public.markets m on m.id=l.market_id and m.is_active where l.code=p_code and l.status in ('active','expired');
  if not found then return query select 'invalid'::text,null::text,null::text,null::text,null::timestamptz; end if;
end;
$$;
alter function public.resolve_referral_acquisition_link(text) owner to postgres;

revoke all on function public.ensure_my_referrer_identity() from public, anon, authenticated, service_role;
revoke all on function public.create_or_get_my_referral_link(uuid) from public, anon, authenticated, service_role;
revoke all on function public.list_my_referral_links() from public, anon, authenticated, service_role;
revoke all on function public.set_my_referral_link_enabled(uuid, boolean) from public, anon, authenticated, service_role;
revoke all on function public.resolve_referral_acquisition_link(text) from public, anon, authenticated, service_role;
grant execute on function public.ensure_my_referrer_identity() to authenticated;
grant execute on function public.create_or_get_my_referral_link(uuid) to authenticated;
grant execute on function public.list_my_referral_links() to authenticated;
grant execute on function public.set_my_referral_link_enabled(uuid, boolean) to authenticated;
grant execute on function public.resolve_referral_acquisition_link(text) to anon, authenticated;

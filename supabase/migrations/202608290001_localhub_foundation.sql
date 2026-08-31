-- LocalHub foundation. Forward-only schema migration; fictional demo data lives in seed.sql.
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- Deterministic least-privilege baseline; later grants are intentionally explicit.
revoke all on schema public from public, anon, authenticated;
alter default privileges in schema public revoke all on tables from public, anon, authenticated;
alter default privileges in schema public revoke all on sequences from public, anon, authenticated;
-- Function EXECUTE defaults are global; a schema-scoped REVOKE cannot remove
-- PostgreSQL's built-in PUBLIC function grant.
alter default privileges revoke execute on functions from public, anon, authenticated;

create type public.profile_capability as enum ('customer', 'merchant', 'referrer', 'support', 'admin', 'super_admin');
create type public.business_member_role as enum ('owner', 'manager', 'staff');
create type public.listing_status as enum ('draft', 'active', 'paused', 'archived');
create type public.order_status as enum ('draft', 'placed', 'confirmed', 'fulfilled', 'cancelled', 'refunded');
create type public.payment_status as enum ('pending', 'authorized', 'succeeded', 'failed', 'refunded', 'cancelled');
create type public.ledger_direction as enum ('debit', 'credit');

create table public.markets (
  id uuid primary key default gen_random_uuid(), slug text not null unique check (slug ~ '^[a-z0-9-]+$'),
  name text not null, country_code char(2) not null default 'NG', currency_code char(3) not null default 'NGN',
  timezone text not null default 'Africa/Lagos', is_active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.market_locations (
  id uuid primary key default gen_random_uuid(), market_id uuid not null references public.markets(id) on delete cascade,
  parent_id uuid references public.market_locations(id) on delete restrict, kind text not null check (kind in ('state','lga','district','neighborhood','landmark','delivery_zone')),
  name text not null, slug text not null, latitude numeric(9,6), longitude numeric(9,6), boundary jsonb not null default '{}'::jsonb,
  is_active boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique nulls not distinct (market_id, parent_id, slug)
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade, display_name text, avatar_path text,
  default_market_id uuid references public.markets(id) on delete set null, phone_e164 text,
  is_suspended boolean not null default false, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.profile_capabilities (
  profile_id uuid not null references public.profiles(id) on delete cascade, capability public.profile_capability not null,
  granted_by uuid references public.profiles(id) on delete set null, granted_at timestamptz not null default now(), primary key (profile_id, capability)
);
create table public.businesses (
  id uuid primary key default gen_random_uuid(), market_id uuid not null references public.markets(id) on delete restrict,
  name text not null, slug text not null unique, legal_name text, status text not null default 'draft' check (status in ('draft','pending_review','active','suspended')),
  location_id uuid references public.market_locations(id) on delete set null, address_text text, phone_e164 text, metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.business_memberships (
  business_id uuid not null references public.businesses(id) on delete cascade, profile_id uuid not null references public.profiles(id) on delete cascade,
  role public.business_member_role not null, invited_by uuid references public.profiles(id) on delete set null, accepted_at timestamptz, created_at timestamptz not null default now(),
  primary key (business_id, profile_id)
);
create table public.business_onboarding_drafts (
  business_id uuid primary key references public.businesses(id) on delete cascade, owner_id uuid not null references public.profiles(id) on delete restrict,
  step text not null default 'business_details', data jsonb not null default '{}'::jsonb, submitted_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table public.categories (
  id uuid primary key default gen_random_uuid(), market_id uuid references public.markets(id) on delete cascade,
  parent_id uuid references public.categories(id) on delete restrict, slug text not null, name text not null, kind text not null default 'standard' check (kind in ('standard','emerging')),
  is_active boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique nulls not distinct (market_id, parent_id, slug)
);
create table public.category_aliases (
  id uuid primary key default gen_random_uuid(), category_id uuid not null references public.categories(id) on delete cascade,
  market_id uuid references public.markets(id) on delete cascade, alias text not null, normalized_alias text not null,
  created_at timestamptz not null default now(), unique nulls not distinct (market_id, normalized_alias)
);

create table public.listing_types (
  id uuid primary key default gen_random_uuid(), code text not null unique check (code ~ '^[a-z][a-z0-9_]{1,62}$'),
  name text not null, description text, is_active boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.listing_schemas (
  id uuid primary key default gen_random_uuid(), listing_type_id uuid not null references public.listing_types(id) on delete restrict,
  version integer not null check (version > 0), status text not null default 'draft' check (status in ('draft','published','retired')),
  schema jsonb not null default '{}'::jsonb check (jsonb_typeof(schema) = 'object'), published_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(listing_type_id, version)
);
create unique index listing_schemas_one_published_idx on public.listing_schemas(listing_type_id) where status = 'published';
create table public.schema_fields (
  id uuid primary key default gen_random_uuid(), listing_schema_id uuid not null references public.listing_schemas(id) on delete cascade,
  key text not null check (key ~ '^[a-z][a-z0-9_]{0,62}$'), label text not null, data_type text not null check (data_type in ('text','rich_text','number','money','boolean','date','datetime','select','multiselect','json','reference','media')),
  is_required boolean not null default false, is_filterable boolean not null default false, validation jsonb not null default '{}'::jsonb check (jsonb_typeof(validation) = 'object'), display_order integer not null default 0,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(listing_schema_id, key)
);
create table public.category_listing_type_mappings (
  category_id uuid not null references public.categories(id) on delete cascade, listing_type_id uuid not null references public.listing_types(id) on delete restrict,
  listing_schema_id uuid not null references public.listing_schemas(id) on delete restrict, is_default boolean not null default false, created_at timestamptz not null default now(),
  primary key (category_id, listing_type_id, listing_schema_id)
);
create table public.listings (
  id uuid primary key default gen_random_uuid(), business_id uuid not null references public.businesses(id) on delete cascade,
  market_id uuid not null references public.markets(id) on delete restrict, category_id uuid references public.categories(id) on delete set null,
  listing_type_id uuid not null references public.listing_types(id) on delete restrict, listing_schema_id uuid not null references public.listing_schemas(id) on delete restrict,
  slug text not null check (slug ~ '^[a-z0-9-]+$'), title text not null check (char_length(title) between 2 and 160), description text, status public.listing_status not null default 'draft',
  location_id uuid references public.market_locations(id) on delete set null, attributes jsonb not null default '{}'::jsonb check (jsonb_typeof(attributes) = 'object'),
  price_minor bigint check (price_minor >= 0), currency_code char(3) not null default 'NGN', fulfilment_methods jsonb not null default '[]'::jsonb check (jsonb_typeof(fulfilment_methods) = 'array'),
  published_at timestamptz, created_by uuid references public.profiles(id) on delete set null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(business_id, slug)
);
create table public.listing_media (
  id uuid primary key default gen_random_uuid(), listing_id uuid not null references public.listings(id) on delete cascade,
  storage_path text not null unique check (storage_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{32}\.(jpg|jpeg|png|webp|mp4|pdf)$'), media_type text not null check (media_type in ('image','video','document')), alt_text text, sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create table public.listing_variants (
  id uuid primary key default gen_random_uuid(), listing_id uuid not null references public.listings(id) on delete cascade,
  sku text, name text not null, price_minor bigint check (price_minor >= 0), currency_code char(3) not null default 'NGN', attributes jsonb not null default '{}'::jsonb check (jsonb_typeof(attributes) = 'object'),
  is_active boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(listing_id, sku)
);
create table public.inventory_levels (
  variant_id uuid primary key references public.listing_variants(id) on delete cascade, quantity_on_hand integer not null default 0 check (quantity_on_hand >= 0),
  quantity_reserved integer not null default 0 check (quantity_reserved >= 0 and quantity_reserved <= quantity_on_hand), updated_at timestamptz not null default now()
);
create table public.listing_availability (
  id uuid primary key default gen_random_uuid(), listing_id uuid not null references public.listings(id) on delete cascade,
  starts_at timestamptz, ends_at timestamptz, weekday smallint check (weekday between 0 and 6), is_available boolean not null default true,
  created_at timestamptz not null default now(), check (ends_at is null or starts_at is null or ends_at > starts_at)
);

create table public.guest_intents (
  id uuid primary key default gen_random_uuid(), market_id uuid references public.markets(id) on delete set null, secret_hash text,
  kind text not null, return_to text not null check (return_to ~ '^/[^/\\]*'), payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'), claimed_by uuid references public.profiles(id) on delete set null,
  expires_at timestamptz not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), consumed_at timestamptz
);
create table public.auth_rate_limits (
  scope text not null,
  identifier_hash text not null check (identifier_hash ~ '^[a-f0-9]{64}$'),
  window_started_at timestamptz not null default now(),
  request_count integer not null default 0 check (request_count >= 0),
  updated_at timestamptz not null default now(),
  primary key (scope, identifier_hash)
);
create table public.media_upload_rate_limits (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  window_started_at timestamptz not null default now(),
  request_count integer not null default 0 check (request_count >= 0),
  updated_at timestamptz not null default now()
);
create table public.listing_media_upload_reservations (
  storage_path text primary key check (storage_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{32}\.(jpg|jpeg|png|webp|mp4|pdf)$'),
  listing_id uuid references public.listings(id) on delete set null,
  profile_id uuid references public.profiles(id) on delete set null,
  status text not null default 'reserved' check (status in ('reserved','confirmed','expired','cancelled','removed')),
  expires_at timestamptz not null,
  confirmed_at timestamptz,
  registered_at timestamptz,
  removed_at timestamptz,
  cleanup_state text not null default 'none' check (cleanup_state in ('none','claimed','completed','failed')),
  cleanup_claim_token uuid,
  cleanup_claimed_at timestamptz,
  cleanup_completed_at timestamptz,
  cleanup_failed_at timestamptz,
  cleanup_error text,
  cleanup_attempt_count integer not null default 0 check (cleanup_attempt_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status in ('confirmed','removed')) = (confirmed_at is not null)),
  check ((status = 'removed') = (removed_at is not null))
);
create table public.searches (
  id uuid primary key default gen_random_uuid(), actor_id uuid references public.profiles(id) on delete set null, guest_intent_id uuid references public.guest_intents(id) on delete set null,
  market_id uuid references public.markets(id) on delete set null, query_text text not null, normalized_query text not null, deterministic_key text not null,
  filters jsonb not null default '{}'::jsonb check (jsonb_typeof(filters) = 'object'), result_count integer not null default 0 check (result_count >= 0), created_at timestamptz not null default now(),
  unique (actor_id, deterministic_key, created_at)
);
create table public.search_intents (
  id uuid primary key default gen_random_uuid(), search_id uuid not null unique references public.searches(id) on delete cascade,
  category_id uuid references public.categories(id) on delete set null, intent_kind text not null, confidence numeric(4,3) check (confidence between 0 and 1), extracted jsonb not null default '{}'::jsonb check (jsonb_typeof(extracted) = 'object'), created_at timestamptz not null default now()
);
create table public.demand_signals (
  id uuid primary key default gen_random_uuid(), market_id uuid not null references public.markets(id) on delete cascade, category_id uuid references public.categories(id) on delete set null,
  source_search_id uuid unique references public.searches(id) on delete set null, signal_type text not null, weight numeric(12,4) not null default 1 check (weight >= 0), observed_at timestamptz not null default now()
);
create table public.unmet_demand (
  id uuid primary key default gen_random_uuid(), market_id uuid not null references public.markets(id) on delete cascade, category_id uuid references public.categories(id) on delete set null,
  deterministic_key text not null, evidence_count integer not null default 0 check (evidence_count >= 0), status text not null default 'open' check (status in ('open','addressed','dismissed')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(market_id, deterministic_key)
);

create table public.requests (
  id uuid primary key default gen_random_uuid(), requester_id uuid references public.profiles(id) on delete set null, guest_intent_id uuid references public.guest_intents(id) on delete set null,
  market_id uuid not null references public.markets(id) on delete restrict, category_id uuid references public.categories(id) on delete set null, title text not null, details text,
  status text not null default 'open' check (status in ('open','matched','closed','cancelled')), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), check (requester_id is not null or guest_intent_id is not null)
);
create table public.request_matches (
  id uuid primary key default gen_random_uuid(), request_id uuid not null references public.requests(id) on delete cascade, listing_id uuid not null references public.listings(id) on delete cascade,
  score numeric(8,5) not null check (score between 0 and 1), rationale jsonb not null default '{}'::jsonb, status text not null default 'suggested' check (status in ('suggested','accepted','rejected')),
  created_at timestamptz not null default now(), unique(request_id, listing_id)
);

create table public.orders (
  id uuid primary key default gen_random_uuid(), order_number text not null unique, buyer_id uuid not null references public.profiles(id) on delete restrict,
  business_id uuid not null references public.businesses(id) on delete restrict, market_id uuid not null references public.markets(id) on delete restrict,
  status public.order_status not null default 'draft', currency_code char(3) not null default 'NGN', subtotal_minor bigint not null default 0 check (subtotal_minor >= 0), total_minor bigint not null default 0 check (total_minor >= 0),
  placed_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.order_items (
  id uuid primary key default gen_random_uuid(), order_id uuid not null references public.orders(id) on delete cascade, listing_id uuid not null references public.listings(id) on delete restrict,
  variant_id uuid references public.listing_variants(id) on delete restrict, title_snapshot text not null, quantity integer not null check (quantity > 0), unit_price_minor bigint not null check (unit_price_minor >= 0), total_minor bigint not null check (total_minor >= 0), created_at timestamptz not null default now()
);
create table public.order_status_events (
  id uuid primary key default gen_random_uuid(), order_id uuid not null references public.orders(id) on delete cascade, status public.order_status not null, actor_id uuid references public.profiles(id) on delete set null, note text, occurred_at timestamptz not null default now()
);
create table public.fulfilment_events (
  id uuid primary key default gen_random_uuid(), order_id uuid not null references public.orders(id) on delete cascade, event_type text not null, payload jsonb not null default '{}'::jsonb, occurred_at timestamptz not null default now()
);

create table public.payments (
  id uuid primary key default gen_random_uuid(), order_id uuid references public.orders(id) on delete restrict, payer_id uuid references public.profiles(id) on delete set null,
  provider text not null, provider_reference text, status public.payment_status not null default 'pending', currency_code char(3) not null default 'NGN', amount_minor bigint not null check (amount_minor >= 0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.payment_events (
  id uuid primary key default gen_random_uuid(), payment_id uuid not null references public.payments(id) on delete cascade, provider_event_id text not null,
  event_type text not null, payload jsonb not null default '{}'::jsonb, occurred_at timestamptz not null default now(), unique(payment_id, provider_event_id)
);
create table public.webhook_inbox (
  id uuid primary key default gen_random_uuid(), provider text not null, provider_event_id text not null,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'), received_at timestamptz not null default now(), processed_at timestamptz, processing_error text,
  unique(provider, provider_event_id)
);
create table public.ledger_accounts (
  id uuid primary key default gen_random_uuid(), code text not null unique, name text not null, account_type text not null check (account_type in ('asset','liability','equity','revenue','expense')), currency_code char(3), is_active boolean not null default true, created_at timestamptz not null default now()
);
create table public.ledger_journals (
  id uuid primary key default gen_random_uuid(), posting_key text not null unique check (char_length(posting_key) between 16 and 160), reference_type text not null, reference_id uuid, description text, posted_at timestamptz, reversal_of uuid unique references public.ledger_journals(id) on delete restrict, created_at timestamptz not null default now()
);
create table public.ledger_entries (
  id uuid primary key default gen_random_uuid(), journal_id uuid not null references public.ledger_journals(id) on delete restrict, account_id uuid not null references public.ledger_accounts(id) on delete restrict,
  direction public.ledger_direction not null, amount_minor bigint not null check (amount_minor > 0), currency_code char(3) not null default 'NGN', created_at timestamptz not null default now()
);

create table public.referral_rules (
  id uuid primary key default gen_random_uuid(), market_id uuid references public.markets(id) on delete cascade, name text not null, status text not null default 'draft' check (status in ('draft','active','retired')),
  conditions jsonb not null default '{}'::jsonb, reward_definition jsonb not null default '{}'::jsonb, starts_at timestamptz, ends_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), check (ends_at is null or starts_at is null or ends_at > starts_at)
);
create table public.referral_codes (
  id uuid primary key default gen_random_uuid(), profile_id uuid not null references public.profiles(id) on delete cascade, code text not null unique check (code ~ '^[A-Z0-9_-]{4,32}$'), rule_id uuid references public.referral_rules(id) on delete set null, is_active boolean not null default true, created_at timestamptz not null default now()
);
create table public.referral_attributions (
  id uuid primary key default gen_random_uuid(), referral_code_id uuid not null references public.referral_codes(id) on delete restrict, referred_profile_id uuid references public.profiles(id) on delete set null, guest_intent_id uuid references public.guest_intents(id) on delete set null,
  attributed_at timestamptz not null default now(), unique(referral_code_id, referred_profile_id), check (referred_profile_id is not null or guest_intent_id is not null)
);
create table public.referral_commissions (
  id uuid primary key default gen_random_uuid(), attribution_id uuid not null references public.referral_attributions(id) on delete restrict, rule_id uuid references public.referral_rules(id) on delete set null,
  order_id uuid references public.orders(id) on delete set null, status text not null default 'pending' check (status in ('pending','approved','paid','void')), amount_minor bigint check (amount_minor >= 0), currency_code char(3) not null default 'NGN', calculated_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.missions (
  id uuid primary key default gen_random_uuid(), market_id uuid references public.markets(id) on delete cascade, name text not null, status text not null default 'draft' check (status in ('draft','active','retired')), definition jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.mission_progress (
  mission_id uuid not null references public.missions(id) on delete cascade, profile_id uuid not null references public.profiles(id) on delete cascade, progress jsonb not null default '{}'::jsonb, completed_at timestamptz, updated_at timestamptz not null default now(), primary key(mission_id, profile_id)
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(), profile_id uuid not null references public.profiles(id) on delete cascade, channel text not null check (channel in ('in_app','email','sms','push')), template_key text not null, payload jsonb not null default '{}'::jsonb, status text not null default 'queued' check (status in ('queued','sent','failed','read')), sent_at timestamptz, read_at timestamptz, created_at timestamptz not null default now()
);
create table public.ai_actions (
  id uuid primary key default gen_random_uuid(), actor_id uuid references public.profiles(id) on delete set null, action_type text not null, input_redacted jsonb not null default '{}'::jsonb, output_redacted jsonb not null default '{}'::jsonb, status text not null, created_at timestamptz not null default now()
);
create table public.ai_usage (
  id uuid primary key default gen_random_uuid(), ai_action_id uuid references public.ai_actions(id) on delete cascade, provider text not null, model text not null, input_tokens integer not null default 0 check (input_tokens >= 0), output_tokens integer not null default 0 check (output_tokens >= 0), created_at timestamptz not null default now()
);
create table public.audit_events (
  id uuid primary key default gen_random_uuid(), actor_id uuid references public.profiles(id) on delete set null, subject_type text not null, subject_id uuid, action text not null, metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);
create table public.system_events (
  id uuid primary key default gen_random_uuid(), event_type text not null, source text not null, payload jsonb not null default '{}'::jsonb, occurred_at timestamptz not null default now()
);
create table public.admin_events (
  id uuid primary key default gen_random_uuid(), admin_id uuid not null references public.profiles(id) on delete restrict, action text not null, subject_type text not null, subject_id uuid, reason text, metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);

-- Query/RLS foreign-key indexes and bounded JSONB indexing for controlled listing attributes.
create index market_locations_market_parent_idx on public.market_locations(market_id, parent_id);
create index profiles_default_market_idx on public.profiles(default_market_id);
create index business_memberships_profile_idx on public.business_memberships(profile_id, business_id);
create index businesses_market_status_idx on public.businesses(market_id, status);
create index categories_market_parent_idx on public.categories(market_id, parent_id);
create index category_aliases_category_idx on public.category_aliases(category_id);
create index listing_schemas_type_status_idx on public.listing_schemas(listing_type_id, status);
create index schema_fields_schema_idx on public.schema_fields(listing_schema_id, display_order);
create index listings_market_active_idx on public.listings(market_id, category_id, listing_type_id) where status = 'active';
create index listings_business_idx on public.listings(business_id, status);
create index market_locations_parent_idx on public.market_locations(parent_id) where parent_id is not null;
create index businesses_location_idx on public.businesses(location_id) where location_id is not null;
create index categories_parent_idx on public.categories(parent_id) where parent_id is not null;
create index listings_category_idx on public.listings(category_id) where category_id is not null;
create index listings_type_idx on public.listings(listing_type_id);
create index listings_schema_idx on public.listings(listing_schema_id);
create index listings_location_idx on public.listings(location_id) where location_id is not null;
create index listings_attributes_gin_idx on public.listings using gin(attributes jsonb_path_ops);
create index listing_media_listing_idx on public.listing_media(listing_id, sort_order);
create index listing_variants_listing_idx on public.listing_variants(listing_id) where is_active;
create index listing_availability_listing_idx on public.listing_availability(listing_id, starts_at, ends_at);
create index guest_intents_secret_expiry_idx on public.guest_intents(secret_hash, expires_at) where claimed_by is null;
create index auth_rate_limits_updated_at_idx on public.auth_rate_limits(updated_at);
create index listing_media_upload_reservations_expiry_idx on public.listing_media_upload_reservations(expires_at) where status = 'reserved';
create index listing_media_upload_reservations_cleanup_idx on public.listing_media_upload_reservations(cleanup_state,expires_at,confirmed_at) where cleanup_state <> 'completed';
create index listing_media_upload_reservations_listing_idx on public.listing_media_upload_reservations(listing_id) where listing_id is not null;
create index listing_media_upload_reservations_profile_idx on public.listing_media_upload_reservations(profile_id) where profile_id is not null;
create index searches_actor_created_idx on public.searches(actor_id, created_at desc);
create index searches_market_key_idx on public.searches(market_id, deterministic_key);
create index demand_signals_market_category_idx on public.demand_signals(market_id, category_id, observed_at desc);
create index requests_market_status_idx on public.requests(market_id, category_id, status);
create index requests_requester_idx on public.requests(requester_id, created_at desc);
create index request_matches_listing_idx on public.request_matches(listing_id);
create index orders_buyer_created_idx on public.orders(buyer_id, created_at desc);
create index orders_business_status_idx on public.orders(business_id, status);
create index order_items_listing_idx on public.order_items(listing_id);
create index order_items_variant_idx on public.order_items(variant_id) where variant_id is not null;
create index order_items_order_idx on public.order_items(order_id);
create index order_status_events_order_idx on public.order_status_events(order_id, occurred_at desc);
create index fulfilment_events_order_idx on public.fulfilment_events(order_id, occurred_at desc);
create index payments_order_idx on public.payments(order_id);
create index payment_events_payment_idx on public.payment_events(payment_id, occurred_at desc);
create index webhook_inbox_unprocessed_idx on public.webhook_inbox(received_at) where processed_at is null;
create index ledger_entries_journal_idx on public.ledger_entries(journal_id);
create index ledger_entries_account_idx on public.ledger_entries(account_id);
create index referral_codes_profile_idx on public.referral_codes(profile_id);
create index notifications_profile_status_idx on public.notifications(profile_id, status, created_at desc);
create index audit_events_subject_idx on public.audit_events(subject_type, subject_id, created_at desc);

create or replace function public.set_updated_at() returns trigger language plpgsql security invoker set search_path = public as $$ begin new.updated_at = now(); return new; end; $$;
create or replace function public.handle_new_auth_user() returns trigger language plpgsql security definer set search_path = '' as $$
begin insert into public.profiles(id, display_name) values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name')); insert into public.profile_capabilities(profile_id, capability) values (new.id, 'customer') on conflict do nothing; return new; end; $$;
create or replace function public.has_capability(required public.profile_capability) returns boolean language sql stable security definer set search_path = '' as $$ select exists (select 1 from public.profile_capabilities where profile_id = (select auth.uid()) and capability = required); $$;
create or replace function public.is_business_member(target_business uuid) returns boolean language sql stable security definer set search_path = '' as $$ select exists (select 1 from public.business_memberships where business_id = target_business and profile_id = (select auth.uid()) and accepted_at is not null); $$;
create or replace function public.is_business_manager(target_business uuid) returns boolean language sql stable security definer set search_path = '' as $$ select exists (select 1 from public.business_memberships where business_id = target_business and profile_id = (select auth.uid()) and accepted_at is not null and role in ('owner','manager')); $$;
create or replace function public.protect_profile_system_fields() returns trigger language plpgsql security invoker set search_path = public as $$ begin if old.is_suspended is distinct from new.is_suspended and not (select public.has_capability('super_admin')) then raise exception 'only super administrators can change suspension status'; end if; return new; end; $$;
create or replace function public.validate_journal_balance() returns trigger language plpgsql security invoker set search_path = public as $$
declare journal uuid := coalesce(new.journal_id, old.journal_id); debits bigint; credits bigint;
begin select coalesce(sum(amount_minor) filter (where direction = 'debit'),0), coalesce(sum(amount_minor) filter (where direction = 'credit'),0) into debits, credits from public.ledger_entries where journal_id = journal; if exists(select 1 from public.ledger_journals where id = journal and posted_at is not null) and debits <> credits then raise exception 'posted journal % is not balanced', journal; end if; return null; end; $$;
create or replace function public.start_business_onboarding(target_market uuid, business_name text, business_slug text) returns uuid language plpgsql security definer set search_path = '' as $$
declare actor uuid := (select auth.uid()); new_business uuid;
begin
  if actor is null then raise exception 'authentication is required'; end if;
  if business_name is null or char_length(trim(business_name)) < 2 or business_slug !~ '^[a-z0-9-]+$' then raise exception 'invalid business details'; end if;
  insert into public.businesses(market_id, name, slug, status) values (target_market, trim(business_name), business_slug, 'draft') returning id into new_business;
  insert into public.business_memberships(business_id, profile_id, role, accepted_at) values (new_business, actor, 'owner', now());
  insert into public.business_onboarding_drafts(business_id, owner_id) values (new_business, actor);
  insert into public.profile_capabilities(profile_id, capability) values (actor, 'merchant') on conflict do nothing;
  return new_business;
end; $$;

create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_auth_user();
create trigger profiles_protect_system_fields before update on public.profiles for each row execute function public.protect_profile_system_fields();
create constraint trigger ledger_entries_balanced after insert or update or delete on public.ledger_entries deferrable initially deferred for each row execute function public.validate_journal_balance();
do $$ declare tbl text; begin foreach tbl in array array['markets','market_locations','profiles','businesses','business_onboarding_drafts','categories','listing_types','listing_schemas','schema_fields','listings','listing_variants','guest_intents','unmet_demand','requests','orders','payments','referral_rules','referral_commissions','missions','mission_progress'] loop execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()', tbl || '_set_updated_at', tbl); end loop; end; $$;


-- RLS: public discovery stays readable; all tenant/workflow writes are scoped by auth.uid().
alter table public.profiles enable row level security; create policy profiles_self on public.profiles for select to authenticated using (id = (select auth.uid()));
alter table public.profile_capabilities enable row level security; create policy capabilities_self_read on public.profile_capabilities for select to authenticated using (profile_id = (select auth.uid()));
alter table public.businesses enable row level security; create policy businesses_public_read on public.businesses for select to anon, authenticated using (status = 'active' or (select public.is_business_member(id))); create policy businesses_member_write on public.businesses for update to authenticated using ((select public.is_business_manager(id))) with check ((select public.is_business_manager(id)));
alter table public.business_memberships enable row level security; create policy memberships_member_read on public.business_memberships for select to authenticated using (profile_id = (select auth.uid()) or (select public.is_business_member(business_id)));
alter table public.business_onboarding_drafts enable row level security; create policy drafts_owner on public.business_onboarding_drafts for select to authenticated using (owner_id = (select auth.uid()));
alter table public.guest_intents enable row level security; create policy guest_intents_claimed_read on public.guest_intents for select to authenticated using (claimed_by = (select auth.uid())); create policy guest_intents_claim on public.guest_intents for select to authenticated using (false);
alter table public.searches enable row level security; create policy searches_owner on public.searches for select to authenticated using (actor_id = (select auth.uid()));
alter table public.search_intents enable row level security; create policy search_intents_owner on public.search_intents for select to authenticated using (exists(select 1 from public.searches s where s.id = search_id and s.actor_id = (select auth.uid())));
alter table public.requests enable row level security; create policy requests_owner_read on public.requests for select to authenticated using (requester_id = (select auth.uid())); create policy requests_owner_write on public.requests for insert to authenticated with check (requester_id = (select auth.uid()));
alter table public.request_matches enable row level security; create policy request_matches_owner on public.request_matches for select to authenticated using (exists(select 1 from public.requests r where r.id = request_id and r.requester_id = (select auth.uid())));
alter table public.orders enable row level security; create policy orders_buyer_or_business on public.orders for select to authenticated using (buyer_id = (select auth.uid()) or (select public.is_business_member(business_id))); create policy orders_buyer_create on public.orders for insert to authenticated with check (buyer_id = (select auth.uid()));
alter table public.order_items enable row level security; create policy order_items_visible on public.order_items for select to authenticated using (exists(select 1 from public.orders o where o.id = order_id and (o.buyer_id = (select auth.uid()) or (select public.is_business_member(o.business_id)))));
alter table public.order_status_events enable row level security; create policy order_events_visible on public.order_status_events for select to authenticated using (exists(select 1 from public.orders o where o.id = order_id and (o.buyer_id = (select auth.uid()) or (select public.is_business_member(o.business_id)))));
alter table public.fulfilment_events enable row level security; create policy fulfilment_visible on public.fulfilment_events for select to authenticated using (exists(select 1 from public.orders o where o.id = order_id and (o.buyer_id = (select auth.uid()) or (select public.is_business_member(o.business_id)))));
alter table public.notifications enable row level security; create policy notifications_self on public.notifications for select to authenticated using (profile_id = (select auth.uid()));
-- Tables not granted to app roles remain deny-by-default under RLS/privileges.
do $$ declare tbl text; begin foreach tbl in array array['markets','market_locations','categories','category_aliases','listing_types','listing_schemas','schema_fields','category_listing_type_mappings','listings','listing_media','listing_variants','inventory_levels','listing_availability','demand_signals','unmet_demand','payments','payment_events','webhook_inbox','ledger_accounts','ledger_journals','ledger_entries','referral_rules','referral_codes','referral_attributions','referral_commissions','missions','mission_progress','ai_actions','ai_usage','audit_events','system_events','admin_events'] loop execute format('alter table public.%I enable row level security', tbl); end loop; end; $$;
create policy public_active_listings on public.listings for select to anon, authenticated using (status = 'active');
create policy listings_manager_write on public.listings for update to authenticated using ((select public.is_business_manager(business_id))) with check ((select public.is_business_manager(business_id)));
create policy public_listing_media on public.listing_media for select to anon, authenticated using (exists(select 1 from public.listings l where l.id = listing_id and l.status = 'active'));
create policy listing_media_manager_write on public.listing_media for update to authenticated using (exists(select 1 from public.listings l where l.id = listing_id and (select public.is_business_manager(l.business_id)))) with check (exists(select 1 from public.listings l where l.id = listing_id and (select public.is_business_manager(l.business_id))));
create policy public_variants on public.listing_variants for select to anon, authenticated using (is_active and exists(select 1 from public.listings l where l.id = listing_id and l.status = 'active'));
create policy variants_manager_write on public.listing_variants for update to authenticated using (exists(select 1 from public.listings l where l.id = listing_id and (select public.is_business_manager(l.business_id)))) with check (exists(select 1 from public.listings l where l.id = listing_id and (select public.is_business_manager(l.business_id))));
create policy public_availability on public.listing_availability for select to anon, authenticated using (exists(select 1 from public.listings l where l.id = listing_id and l.status = 'active'));
create policy availability_manager_write on public.listing_availability for update to authenticated using (exists(select 1 from public.listings l where l.id = listing_id and (select public.is_business_manager(l.business_id)))) with check (exists(select 1 from public.listings l where l.id = listing_id and (select public.is_business_manager(l.business_id))));
create policy referral_codes_owner on public.referral_codes for select to authenticated using (profile_id = (select auth.uid()));
create policy mission_progress_owner on public.mission_progress for select to authenticated using (profile_id = (select auth.uid()));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values ('listing-media','listing-media',false,20971520,array['image/jpeg','image/png','image/webp','video/mp4','application/pdf']) on conflict (id) do nothing;
create policy listing_media_object_read on storage.objects for select to anon, authenticated using (bucket_id = 'listing-media' and exists(select 1 from public.listing_media m join public.listings l on l.id = m.listing_id where m.storage_path = storage.objects.name and l.status = 'active'));
create policy listing_media_object_insert on storage.objects for insert to authenticated with check (bucket_id = 'listing-media' and exists(select 1 from public.listings l where l.id::text = (storage.foldername(storage.objects.name))[1] and (select public.is_business_manager(l.business_id))));
create policy listing_media_object_update on storage.objects for update to authenticated using (bucket_id = 'listing-media' and exists(select 1 from public.listings l where l.id::text = (storage.foldername(storage.objects.name))[1] and (select public.is_business_manager(l.business_id)))) with check (bucket_id = 'listing-media');
create policy listing_media_object_delete on storage.objects for delete to authenticated using (bucket_id = 'listing-media' and exists(select 1 from public.listings l where l.id::text = (storage.foldername(storage.objects.name))[1] and (select public.is_business_manager(l.business_id))));

-- Security hardening for the initial (unapplied) migration.
create unique index payments_provider_reference_present_idx on public.payments(provider, provider_reference) where provider_reference is not null;
create index category_listing_type_mappings_schema_idx on public.category_listing_type_mappings(listing_schema_id);

create or replace function public.is_active_profile(target_profile uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.id = target_profile and not p.is_suspended)
$$;
create or replace function public.is_current_profile_active() returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.id = (select auth.uid()) and not p.is_suspended)
$$;
create or replace function public.has_capability(required public.profile_capability) returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_active_profile((select auth.uid())) and exists (select 1 from public.profile_capabilities pc where pc.profile_id = (select auth.uid()) and pc.capability = required)
$$;
create or replace function public.is_business_member(target_business uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_active_profile((select auth.uid())) and exists (select 1 from public.business_memberships bm where bm.business_id = target_business and bm.profile_id = (select auth.uid()) and bm.accepted_at is not null)
$$;
create or replace function public.is_business_manager(target_business uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_active_profile((select auth.uid())) and exists (select 1 from public.business_memberships bm where bm.business_id = target_business and bm.profile_id = (select auth.uid()) and bm.accepted_at is not null and bm.role in ('owner','manager'))
$$;
create or replace function public.start_business_onboarding(target_market uuid, business_name text, business_slug text) returns uuid language plpgsql security definer set search_path = '' as $$
declare actor uuid := (select auth.uid()); new_business uuid;
begin
  if not public.is_active_profile(actor) then raise exception 'active authentication is required'; end if;
  if business_name is null or char_length(trim(business_name)) < 2 or business_slug !~ '^[a-z0-9-]+$' then raise exception 'invalid business details'; end if;
  if not exists(select 1 from public.markets m where m.id = target_market and m.is_active) then raise exception 'inactive market'; end if;
  insert into public.businesses(market_id,name,slug,status) values(target_market,trim(business_name),business_slug,'draft') returning id into new_business;
  insert into public.business_memberships(business_id,profile_id,role,accepted_at) values(new_business,actor,'owner',now());
  insert into public.business_onboarding_drafts(business_id,owner_id) values(new_business,actor);
  insert into public.profile_capabilities(profile_id,capability) values(actor,'merchant') on conflict do nothing;
  return new_business;
end; $$;
create or replace function public.save_business_onboarding_draft(target_business uuid, next_step text, draft_data jsonb) returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_business_manager(target_business) or not exists(select 1 from public.business_memberships bm where bm.business_id = target_business and bm.profile_id = (select auth.uid()) and bm.role = 'owner' and bm.accepted_at is not null) then raise exception 'owner access is required'; end if;
  if jsonb_typeof(draft_data) <> 'object' or pg_column_size(draft_data) > 65536 or char_length(next_step) > 80 then raise exception 'invalid draft'; end if;
  update public.business_onboarding_drafts d set step = next_step, data = draft_data where d.business_id = target_business and d.owner_id = (select auth.uid());
  if not found then raise exception 'draft not found'; end if;
end; $$;
create or replace function public.consume_auth_rate_limit(p_scope text, p_identifier text) returns boolean language plpgsql security definer set search_path = '' as $$
declare max_requests integer; window_seconds integer; current_count integer;
begin
  if p_identifier !~ '^[a-f0-9]{64}$' then raise exception 'invalid rate-limit identifier'; end if;
  case p_scope
    when 'guest_intent' then max_requests := 10; window_seconds := 600;
    when 'email_sign_in' then max_requests := 5; window_seconds := 900;
    when 'oauth_sign_in' then max_requests := 10; window_seconds := 600;
    when 'auth_callback' then max_requests := 20; window_seconds := 600;
    when 'intent_resume' then max_requests := 20; window_seconds := 600;
    else raise exception 'invalid rate-limit scope';
  end case;
  insert into public.auth_rate_limits as limits(scope,identifier_hash,window_started_at,request_count,updated_at)
  values(p_scope,p_identifier,now(),1,now())
  on conflict(scope,identifier_hash) do update set
    window_started_at = case when limits.window_started_at <= now() - make_interval(secs => window_seconds) then now() else limits.window_started_at end,
    request_count = case when limits.window_started_at <= now() - make_interval(secs => window_seconds) then 1 else limits.request_count + 1 end,
    updated_at = now()
  returning request_count into current_count;
  return current_count <= max_requests;
end; $$;
create or replace function public.consume_media_upload_rate_limit() returns boolean language plpgsql security definer set search_path = '' as $$
declare actor uuid := (select auth.uid()); current_count integer;
begin
  if actor is null or not public.is_active_profile(actor) then raise exception 'active authentication is required'; end if;
  insert into public.media_upload_rate_limits as limits(profile_id,window_started_at,request_count,updated_at)
  values(actor,now(),1,now())
  on conflict(profile_id) do update set
    window_started_at = case when limits.window_started_at <= now() - interval '10 minutes' then now() else limits.window_started_at end,
    request_count = case when limits.window_started_at <= now() - interval '10 minutes' then 1 else limits.request_count + 1 end,
    updated_at = now()
  returning request_count into current_count;
  return current_count <= 20;
end; $$;
create or replace function public.reserve_listing_media_upload(p_listing_id uuid, p_storage_path text) returns timestamptz language plpgsql security definer set search_path = '' as $$
declare actor uuid := (select auth.uid()); reservation_expiry timestamptz := now() + interval '3 hours'; result_expiry timestamptz;
begin
  if actor is null or not public.is_active_profile(actor) or p_storage_path !~ ('^' || p_listing_id::text || '/[0-9a-f]{32}\.(jpg|jpeg|png|webp|mp4|pdf)$') or not exists(select 1 from public.listings l where l.id = p_listing_id and public.is_business_manager(l.business_id)) then raise exception 'invalid media reservation'; end if;
  if not public.consume_media_upload_rate_limit() then raise exception 'media upload rate limit exceeded'; end if;
  insert into public.listing_media_upload_reservations as reservations(storage_path,listing_id,profile_id,status,expires_at)
  values(p_storage_path,p_listing_id,actor,'reserved',reservation_expiry)
  on conflict(storage_path) do nothing
  returning expires_at into result_expiry;
  if result_expiry is null then
    select r.expires_at into result_expiry
    from public.listing_media_upload_reservations r
    where r.storage_path = p_storage_path and r.listing_id = p_listing_id and r.profile_id = actor and r.status = 'reserved' and r.expires_at > now() and r.cleanup_state = 'none'
    for update;
  end if;
  if result_expiry is null then raise exception 'media reservation conflict'; end if;
  return result_expiry;
end; $$;
create or replace function public.confirm_listing_media_upload(p_listing_id uuid, p_storage_path text) returns boolean language plpgsql security definer set search_path = '' as $$
declare actor uuid := (select auth.uid());
begin
  if actor is null or not public.is_active_profile(actor) then raise exception 'active authentication is required'; end if;
  update public.listing_media_upload_reservations set status = 'confirmed', confirmed_at = now(), updated_at = now()
  where storage_path = p_storage_path and listing_id = p_listing_id and profile_id = actor and status = 'reserved' and expires_at > now() and p_storage_path ~ ('^' || p_listing_id::text || '/[0-9a-f]{32}\.(jpg|jpeg|png|webp|mp4|pdf)$') and exists(select 1 from public.listings l where l.id = p_listing_id and public.is_business_manager(l.business_id)) and exists(select 1 from storage.objects o where o.bucket_id = 'listing-media' and o.name = p_storage_path and coalesce(o.metadata->>'mimetype','') in ('image/jpeg','image/png','image/webp','video/mp4','application/pdf') and coalesce(o.metadata->>'size','') ~ '^[0-9]+$' and (o.metadata->>'size')::bigint between 1 and 20971520);
  if found then return true; end if;
  return exists(select 1 from public.listing_media_upload_reservations r join public.listings l on l.id = r.listing_id where r.storage_path = p_storage_path and r.listing_id = p_listing_id and r.profile_id = actor and r.status = 'confirmed' and public.is_business_manager(l.business_id));
end; $$;
create or replace function public.mark_listing_media_upload_removed(p_listing_id uuid, p_storage_path text) returns boolean language plpgsql security definer set search_path = '' as $$
declare actor uuid := (select auth.uid());
begin
  if actor is null or not public.is_active_profile(actor) then raise exception 'active authentication is required'; end if;
  update public.listing_media_upload_reservations set status = 'removed', removed_at = now(), updated_at = now()
  where storage_path = p_storage_path and listing_id = p_listing_id and status = 'confirmed' and exists(select 1 from public.listings l where l.id = p_listing_id and public.is_business_manager(l.business_id)) and not exists(select 1 from public.listing_media lm where lm.storage_path = p_storage_path) and not exists(select 1 from storage.objects o where o.bucket_id = 'listing-media' and o.name = p_storage_path);
  if found then return true; end if;
  return exists(select 1 from public.listing_media_upload_reservations r join public.listings l on l.id = r.listing_id where r.storage_path = p_storage_path and r.listing_id = p_listing_id and r.status = 'removed' and public.is_business_manager(l.business_id));
end; $$;
create or replace function public.cancel_listing_media_upload(p_listing_id uuid, p_storage_path text) returns boolean language plpgsql security definer set search_path = '' as $$
declare actor uuid := (select auth.uid());
begin
  if actor is null or not public.is_active_profile(actor) then raise exception 'active authentication is required'; end if;
  update public.listing_media_upload_reservations set status = 'cancelled', updated_at = now()
  where storage_path = p_storage_path and listing_id = p_listing_id and status = 'reserved' and exists(select 1 from public.listings l where l.id = p_listing_id and public.is_business_manager(l.business_id)) and not exists(select 1 from public.listing_media lm where lm.storage_path = p_storage_path) and not exists(select 1 from storage.objects o where o.bucket_id = 'listing-media' and o.name = p_storage_path);
  if found then return true; end if;
  return exists(select 1 from public.listing_media_upload_reservations r join public.listings l on l.id = r.listing_id where r.storage_path = p_storage_path and r.listing_id = p_listing_id and r.status = 'cancelled' and public.is_business_manager(l.business_id));
end; $$;
create or replace function public.expire_listing_media_upload_reservations() returns integer language plpgsql security definer set search_path = '' as $$
declare changed integer;
begin
  update public.listing_media_upload_reservations set status = 'expired', updated_at = now() where status = 'reserved' and expires_at <= now();
  get diagnostics changed = row_count;
  return changed;
end; $$;
create or replace function public.claim_orphan_listing_media_cleanup(p_batch_size integer default 25) returns table(storage_path text, cleanup_claim_token uuid) language plpgsql security definer set search_path = '' as $$
begin
  if p_batch_size not between 1 and 100 then raise exception 'invalid cleanup batch size'; end if;
  return query
  with candidates as (
    select r.storage_path
    from public.listing_media_upload_reservations r
    where not exists(select 1 from public.listing_media lm where lm.storage_path = r.storage_path)
      and (
        (r.cleanup_state = 'none' and (r.listing_id is null or r.profile_id is null or (r.status in ('reserved','expired','cancelled','removed') and r.expires_at <= now()) or (r.status = 'confirmed' and r.confirmed_at <= now() - interval '24 hours')))
        or (r.cleanup_state = 'claimed' and r.cleanup_claimed_at <= now() - interval '15 minutes')
        or (r.cleanup_state = 'failed' and r.cleanup_failed_at <= now() - interval '5 minutes')
      )
    order by r.expires_at, r.confirmed_at nulls first
    limit p_batch_size
    for update skip locked
  )
  update public.listing_media_upload_reservations r
  set status = case when r.status = 'reserved' then 'expired' else r.status end, cleanup_state = 'claimed', cleanup_claim_token = gen_random_uuid(), cleanup_claimed_at = now(), cleanup_failed_at = null, cleanup_error = null, cleanup_attempt_count = r.cleanup_attempt_count + 1, updated_at = now()
  from candidates c
  where r.storage_path = c.storage_path
  returning r.storage_path, r.cleanup_claim_token;
end; $$;
create or replace function public.complete_orphan_listing_media_cleanup(p_storage_path text, p_cleanup_claim_token uuid) returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if p_storage_path is null or p_cleanup_claim_token is null then raise exception 'invalid cleanup completion'; end if;
  update public.listing_media_upload_reservations
  set status = case when status = 'confirmed' then 'removed' else status end, removed_at = case when status = 'confirmed' then now() else removed_at end, cleanup_state = 'completed', cleanup_completed_at = now(), updated_at = now()
  where storage_path = p_storage_path and cleanup_state = 'claimed' and cleanup_claim_token = p_cleanup_claim_token and not exists(select 1 from public.listing_media lm where lm.storage_path = p_storage_path);
  if found then return true; end if;
  return exists(select 1 from public.listing_media_upload_reservations r where r.storage_path = p_storage_path and r.cleanup_state = 'completed' and r.cleanup_claim_token = p_cleanup_claim_token);
end; $$;
create or replace function public.fail_orphan_listing_media_cleanup(p_storage_path text, p_cleanup_claim_token uuid, p_error text) returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if p_storage_path is null or p_cleanup_claim_token is null or p_error is null or char_length(trim(p_error)) not between 1 and 500 then raise exception 'invalid cleanup failure'; end if;
  update public.listing_media_upload_reservations
  set cleanup_state = 'failed', cleanup_failed_at = now(), cleanup_error = trim(p_error), updated_at = now()
  where storage_path = p_storage_path and cleanup_state = 'claimed' and cleanup_claim_token = p_cleanup_claim_token;
  if found then return true; end if;
  return exists(select 1 from public.listing_media_upload_reservations r where r.storage_path = p_storage_path and r.cleanup_state = 'failed' and r.cleanup_claim_token = p_cleanup_claim_token);
end; $$;
create or replace function public.has_reserved_listing_media_upload(p_storage_path text) returns boolean language plpgsql volatile security definer set search_path = '' as $$
declare allowed boolean := false;
begin
  if (select auth.uid()) is null or p_storage_path !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{32}\.(jpg|jpeg|png|webp|mp4|pdf)$' then return false; end if;
  select true into allowed
  from public.listing_media_upload_reservations r
  join public.listings l on l.id = r.listing_id
  where r.storage_path = p_storage_path and r.listing_id::text = (storage.foldername(p_storage_path))[1] and r.profile_id = (select auth.uid()) and r.status = 'reserved' and r.expires_at > now() and r.cleanup_state = 'none' and public.is_business_manager(l.business_id)
  limit 1 for key share of r;
  return coalesce(allowed,false);
end; $$;
create or replace function public.has_confirmed_listing_media_upload(p_listing_id uuid, p_storage_path text) returns boolean language plpgsql volatile security definer set search_path = '' as $$
declare allowed boolean := false;
begin
  if (select auth.uid()) is null or p_storage_path !~ ('^' || p_listing_id::text || '/[0-9a-f]{32}\.(jpg|jpeg|png|webp|mp4|pdf)$') then return false; end if;
  select true into allowed
  from public.listing_media_upload_reservations r
  join public.listings l on l.id = r.listing_id
  where r.storage_path = p_storage_path and r.listing_id = p_listing_id and r.profile_id = (select auth.uid()) and r.status = 'confirmed' and r.cleanup_state in ('none','failed') and public.is_business_manager(l.business_id) and exists(select 1 from storage.objects o where o.bucket_id = 'listing-media' and o.name = p_storage_path and coalesce(o.metadata->>'mimetype','') in ('image/jpeg','image/png','image/webp','video/mp4','application/pdf') and coalesce(o.metadata->>'size','') ~ '^[0-9]+$' and (o.metadata->>'size')::bigint between 1 and 20971520)
  limit 1 for key share of r;
  return coalesce(allowed,false);
end; $$;
create or replace function public.record_listing_media_registration() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.listing_media_upload_reservations
  set registered_at = coalesce(registered_at,now()), cleanup_state = case when cleanup_state = 'failed' then 'none' else cleanup_state end, cleanup_claim_token = case when cleanup_state = 'failed' then null else cleanup_claim_token end, cleanup_claimed_at = case when cleanup_state = 'failed' then null else cleanup_claimed_at end, cleanup_failed_at = case when cleanup_state = 'failed' then null else cleanup_failed_at end, cleanup_error = case when cleanup_state = 'failed' then null else cleanup_error end, updated_at = now()
  where storage_path = new.storage_path and listing_id = new.listing_id and status = 'confirmed' and cleanup_state in ('none','failed') and exists(select 1 from storage.objects o where o.bucket_id = 'listing-media' and o.name = new.storage_path and coalesce(o.metadata->>'mimetype','') in ('image/jpeg','image/png','image/webp','video/mp4','application/pdf') and coalesce(o.metadata->>'size','') ~ '^[0-9]+$' and (o.metadata->>'size')::bigint between 1 and 20971520);
  if not found then raise exception 'confirmed media reservation is required'; end if;
  return new;
end; $$;
create trigger listing_media_record_registration after insert on public.listing_media for each row execute function public.record_listing_media_registration();
create or replace function public.create_guest_intent(p_kind text, p_return_to text, p_payload jsonb, p_rate_limit_key text) returns table(id uuid, secret text, expires_at timestamptz) language plpgsql security definer set search_path = '' as $$
declare raw_secret text := replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-',''); new_id uuid;
begin
  if p_kind not in ('continue','sign_in') or p_return_to !~ '^/[^/\\]*' or char_length(p_return_to) > 2048 or jsonb_typeof(p_payload) <> 'object' or pg_column_size(p_payload) > 8192 then raise exception 'invalid guest intent'; end if;
  if not public.consume_auth_rate_limit('guest_intent', p_rate_limit_key) then raise exception 'rate limit exceeded'; end if;
  insert into public.guest_intents(secret_hash,kind,return_to,payload,expires_at) values(encode(extensions.digest(raw_secret,'sha256'),'hex'),p_kind,p_return_to,p_payload,now() + interval '15 minutes') returning guest_intents.id into new_id;
  return query select new_id, raw_secret, (select g.expires_at from public.guest_intents g where g.id = new_id);
end; $$;
create or replace function public.claim_guest_intent(p_intent_id uuid, p_secret text) returns jsonb language plpgsql security definer set search_path = '' as $$
declare intent public.guest_intents%rowtype;
begin
  if not public.is_active_profile((select auth.uid())) or char_length(p_secret) not between 32 and 256 then raise exception 'invalid claim'; end if;
  select * into intent from public.guest_intents g where g.id = p_intent_id for update;
  if not found or intent.claimed_by is not null or intent.consumed_at is not null or intent.expires_at <= now() or intent.secret_hash is null or intent.secret_hash <> encode(extensions.digest(p_secret,'sha256'),'hex') then raise exception 'invalid claim'; end if;
  update public.guest_intents set claimed_by = (select auth.uid()), secret_hash = null, consumed_at = now() where id = intent.id;
  return jsonb_build_object('kind',intent.kind,'return_to',intent.return_to,'payload',intent.payload);
end; $$;
create or replace function public.journal_matches_lines(p_journal_id uuid, p_lines jsonb) returns boolean language sql stable security definer set search_path = '' as $$
  select jsonb_typeof(p_lines) = 'array' and not exists(
    (select e.account_id, e.direction, e.amount_minor, e.currency_code, count(*) as line_count from public.ledger_entries e where e.journal_id = p_journal_id group by e.account_id,e.direction,e.amount_minor,e.currency_code
     except all
     select (line.value->>'account_id')::uuid, (line.value->>'direction')::public.ledger_direction, (line.value->>'amount_minor')::bigint, line.value->>'currency_code', count(*) from jsonb_array_elements(p_lines) line group by 1,2,3,4)
    union all
    (select (line.value->>'account_id')::uuid, (line.value->>'direction')::public.ledger_direction, (line.value->>'amount_minor')::bigint, line.value->>'currency_code', count(*) from jsonb_array_elements(p_lines) line group by 1,2,3,4
     except all
     select e.account_id, e.direction, e.amount_minor, e.currency_code, count(*) as line_count from public.ledger_entries e where e.journal_id = p_journal_id group by e.account_id,e.direction,e.amount_minor,e.currency_code)
  )
$$;
create or replace function public.reversal_matches_original(p_reversal_id uuid, p_original_id uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select not exists(
    (select r.account_id,r.direction,r.amount_minor,r.currency_code,count(*) from public.ledger_entries r where r.journal_id = p_reversal_id group by r.account_id,r.direction,r.amount_minor,r.currency_code
     except all
     select o.account_id,case when o.direction = 'debit' then 'credit'::public.ledger_direction else 'debit'::public.ledger_direction end,o.amount_minor,o.currency_code,count(*) from public.ledger_entries o where o.journal_id = p_original_id group by o.account_id,o.direction,o.amount_minor,o.currency_code)
    union all
    (select o.account_id,case when o.direction = 'debit' then 'credit'::public.ledger_direction else 'debit'::public.ledger_direction end,o.amount_minor,o.currency_code,count(*) from public.ledger_entries o where o.journal_id = p_original_id group by o.account_id,o.direction,o.amount_minor,o.currency_code
     except all
     select r.account_id,r.direction,r.amount_minor,r.currency_code,count(*) from public.ledger_entries r where r.journal_id = p_reversal_id group by r.account_id,r.direction,r.amount_minor,r.currency_code)
  )
$$;
create or replace function public.post_journal(p_posting_key text, p_reference_type text, p_reference_id uuid, p_description text, p_lines jsonb) returns uuid language plpgsql security definer set search_path = '' as $$
declare new_journal_id uuid; line jsonb;
begin
  if char_length(p_posting_key) not between 16 and 160 or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) < 2 then raise exception 'invalid journal'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_posting_key, 0));
  select j.id into new_journal_id from public.ledger_journals j where j.posting_key = p_posting_key for update;
  if found then
    if not exists(select 1 from public.ledger_journals j where j.id = new_journal_id and j.reference_type is not distinct from p_reference_type and j.reference_id is not distinct from p_reference_id and j.description is not distinct from p_description) or not public.journal_matches_lines(new_journal_id,p_lines) then raise exception 'posting key collision'; end if;
    return new_journal_id;
  end if;
  insert into public.ledger_journals(posting_key,reference_type,reference_id,description) values(p_posting_key,p_reference_type,p_reference_id,p_description) returning id into new_journal_id;
  for line in select value from jsonb_array_elements(p_lines) loop
    if (line->>'direction') not in ('debit','credit') or coalesce((line->>'amount_minor')::bigint,0) <= 0 or (line->>'currency_code') !~ '^[A-Z]{3}$' then raise exception 'invalid journal line'; end if;
    insert into public.ledger_entries(journal_id,account_id,direction,amount_minor,currency_code) values(new_journal_id,(line->>'account_id')::uuid,(line->>'direction')::public.ledger_direction,(line->>'amount_minor')::bigint,line->>'currency_code');
  end loop;
  if exists (select 1 from public.ledger_entries e where e.journal_id = new_journal_id group by e.currency_code having count(*) < 2 or coalesce(sum(e.amount_minor) filter(where e.direction = 'debit'),0) <> coalesce(sum(e.amount_minor) filter(where e.direction = 'credit'),0)) then raise exception 'journal is unbalanced'; end if;
  update public.ledger_journals set posted_at = now() where id = new_journal_id;
  return new_journal_id;
end; $$;
create or replace function public.reverse_posted_journal(p_original_journal uuid, p_posting_key text, p_description text) returns uuid language plpgsql security definer set search_path = '' as $$
declare original public.ledger_journals%rowtype; reversal_id uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_posting_key, 0));
  select * into original from public.ledger_journals j where j.id = p_original_journal for update;
  if not found or original.posted_at is null then raise exception 'only posted journals may be reversed'; end if;
  select j.id into reversal_id from public.ledger_journals j where j.posting_key = p_posting_key for update;
  if found then
    if not exists(select 1 from public.ledger_journals j where j.id = reversal_id and j.reference_type = 'ledger_reversal' and j.reference_id is not distinct from original.id and j.reversal_of = original.id and j.description is not distinct from p_description) or not public.reversal_matches_original(reversal_id,original.id) then raise exception 'posting key collision'; end if;
    return reversal_id;
  end if;
  if exists(select 1 from public.ledger_journals j where j.reversal_of = original.id) then raise exception 'journal already reversed'; end if;
  insert into public.ledger_journals(posting_key,reference_type,reference_id,description,reversal_of) values(p_posting_key,'ledger_reversal',original.id,p_description,original.id) returning id into reversal_id;
  insert into public.ledger_entries(journal_id,account_id,direction,amount_minor,currency_code) select reversal_id,e.account_id,case when e.direction = 'debit' then 'credit'::public.ledger_direction else 'debit'::public.ledger_direction end,e.amount_minor,e.currency_code from public.ledger_entries e where e.journal_id = original.id;
  update public.ledger_journals set posted_at = now() where id = reversal_id;
  return reversal_id;
end; $$;
create or replace function public.prevent_posted_ledger_mutation() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'ledger_journals' and old.posted_at is not null then raise exception 'posted journals are immutable; post a reversal'; end if;
  if tg_table_name = 'ledger_entries' then
    if tg_op = 'INSERT' and exists(select 1 from public.ledger_journals j where j.id = new.journal_id and j.posted_at is not null) then raise exception 'posted entries are immutable; post a reversal'; end if;
    if tg_op = 'DELETE' and exists(select 1 from public.ledger_journals j where j.id = old.journal_id and j.posted_at is not null) then raise exception 'posted entries are immutable; post a reversal'; end if;
    if tg_op = 'UPDATE' and (exists(select 1 from public.ledger_journals j where j.id = old.journal_id and j.posted_at is not null) or exists(select 1 from public.ledger_journals j where j.id = new.journal_id and j.posted_at is not null)) then raise exception 'posted entries are immutable; post a reversal'; end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end; $$;
create or replace function public.validate_posted_journal() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.posted_at is not null and (not exists(select 1 from public.ledger_entries e where e.journal_id = new.id) or exists(select 1 from public.ledger_entries e where e.journal_id = new.id group by e.currency_code having count(*) < 2 or coalesce(sum(e.amount_minor) filter(where e.direction = 'debit'),0) <> coalesce(sum(e.amount_minor) filter(where e.direction = 'credit'),0))) then raise exception 'posted journals require balanced entries'; end if;
  return new;
end; $$;
create or replace function public.validate_ledger_currency() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'ledger_entries' and exists(select 1 from public.ledger_accounts a where a.id = new.account_id and a.currency_code is not null and a.currency_code <> new.currency_code) then raise exception 'ledger entry currency must match its account'; end if;
  if tg_table_name = 'ledger_accounts' and new.currency_code is not null and exists(select 1 from public.ledger_entries e where e.account_id = new.id and e.currency_code <> new.currency_code) then raise exception 'ledger account currency conflicts with existing entries'; end if;
  return new;
end; $$;
create trigger ledger_journals_posted_immutable before update or delete on public.ledger_journals for each row execute function public.prevent_posted_ledger_mutation();
create trigger ledger_entries_posted_immutable before insert or update or delete on public.ledger_entries for each row execute function public.prevent_posted_ledger_mutation();
create trigger ledger_journals_validate_posting before insert or update of posted_at on public.ledger_journals for each row execute function public.validate_posted_journal();
create trigger ledger_entries_validate_currency before insert or update of account_id, currency_code on public.ledger_entries for each row execute function public.validate_ledger_currency();
create trigger ledger_accounts_validate_currency before update of currency_code on public.ledger_accounts for each row execute function public.validate_ledger_currency();

-- Validation triggers preserve market/parent integrity and prevent app-role tenant mutation.
create or replace function public.validate_market_integrity() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'market_locations' and new.parent_id is not null and (new.parent_id = new.id or not exists(select 1 from public.market_locations p where p.id = new.parent_id and p.market_id = new.market_id) or exists(with recursive ancestors as (select p.id,p.parent_id from public.market_locations p where p.id = new.parent_id union select p.id,p.parent_id from public.market_locations p join ancestors a on p.id = a.parent_id) select 1 from ancestors where id = new.id)) then raise exception 'location parent is invalid'; end if;
  if tg_table_name = 'categories' and new.parent_id is not null and (new.parent_id = new.id or not exists(select 1 from public.categories p where p.id = new.parent_id and p.market_id is not distinct from new.market_id) or exists(with recursive ancestors as (select p.id,p.parent_id from public.categories p where p.id = new.parent_id union select p.id,p.parent_id from public.categories p join ancestors a on p.id = a.parent_id) select 1 from ancestors where id = new.id)) then raise exception 'category parent is invalid'; end if;
  if tg_table_name = 'category_aliases' and not exists(select 1 from public.categories c where c.id = new.category_id and c.market_id is not distinct from new.market_id) then raise exception 'category alias market mismatch'; end if;
  if tg_table_name = 'category_listing_type_mappings' and not exists(select 1 from public.listing_schemas s where s.id = new.listing_schema_id and s.listing_type_id = new.listing_type_id) then raise exception 'category mapping schema mismatch'; end if;
  if tg_table_name = 'businesses' and new.location_id is not null and not exists(select 1 from public.market_locations l where l.id = new.location_id and l.market_id = new.market_id) then raise exception 'business location market mismatch'; end if;
  if tg_table_name = 'listings' then
    if not exists(select 1 from public.businesses b where b.id = new.business_id and b.market_id = new.market_id) then raise exception 'listing business market mismatch'; end if;
    if new.location_id is not null and not exists(select 1 from public.market_locations l where l.id = new.location_id and l.market_id = new.market_id) then raise exception 'listing location market mismatch'; end if;
    if new.category_id is not null and not exists(select 1 from public.categories c where c.id = new.category_id and (c.market_id is null or c.market_id = new.market_id)) then raise exception 'listing category market mismatch'; end if;
    if not exists(select 1 from public.listing_schemas s where s.id = new.listing_schema_id and s.listing_type_id = new.listing_type_id) then raise exception 'listing schema type mismatch'; end if;
    if new.category_id is not null and not exists(select 1 from public.category_listing_type_mappings m where m.category_id = new.category_id and m.listing_type_id = new.listing_type_id and m.listing_schema_id = new.listing_schema_id) then raise exception 'listing category schema mapping mismatch'; end if;
  end if;
  if tg_table_name in ('requests','demand_signals','unmet_demand') and new.category_id is not null and not exists(select 1 from public.categories c where c.id = new.category_id and (c.market_id is null or c.market_id = new.market_id)) then raise exception 'category market mismatch'; end if;
  if tg_table_name = 'search_intents' and new.category_id is not null and not exists(select 1 from public.categories c join public.searches s on s.id = new.search_id where c.id = new.category_id and (c.market_id is null or c.market_id = s.market_id)) then raise exception 'search intent category market mismatch'; end if;
  if tg_table_name = 'orders' and not exists(select 1 from public.businesses b where b.id = new.business_id and b.market_id = new.market_id) then raise exception 'order business market mismatch'; end if;
  if tg_table_name = 'order_items' and not exists(select 1 from public.listings l join public.orders o on o.id = new.order_id where l.id = new.listing_id and l.business_id = o.business_id and l.market_id = o.market_id) then raise exception 'order item listing mismatch'; end if;
  if tg_table_name = 'order_items' and new.variant_id is not null and not exists(select 1 from public.listing_variants v where v.id = new.variant_id and v.listing_id = new.listing_id) then raise exception 'order item variant mismatch'; end if;
  return new;
end; $$;
create trigger market_locations_validate_market before insert or update on public.market_locations for each row execute function public.validate_market_integrity();
create trigger categories_validate_market before insert or update on public.categories for each row execute function public.validate_market_integrity();
create trigger businesses_validate_market before insert or update on public.businesses for each row execute function public.validate_market_integrity();
create trigger listings_validate_market before insert or update on public.listings for each row execute function public.validate_market_integrity();
create trigger search_intents_validate_market before insert or update on public.search_intents for each row execute function public.validate_market_integrity();
create trigger requests_validate_market before insert or update on public.requests for each row execute function public.validate_market_integrity();
create trigger demand_signals_validate_market before insert or update on public.demand_signals for each row execute function public.validate_market_integrity();
create trigger unmet_demand_validate_market before insert or update on public.unmet_demand for each row execute function public.validate_market_integrity();
create trigger orders_validate_market before insert or update on public.orders for each row execute function public.validate_market_integrity();
create trigger order_items_validate_market before insert or update on public.order_items for each row execute function public.validate_market_integrity();
create trigger category_aliases_validate_market before insert or update on public.category_aliases for each row execute function public.validate_market_integrity();
create trigger category_listing_type_mappings_validate_market before insert or update on public.category_listing_type_mappings for each row execute function public.validate_market_integrity();

-- Final explicit grants/policies replace the permissive bootstrap statements above.
revoke all privileges on all tables in schema public from public, anon, authenticated;
revoke all privileges on all sequences in schema public from public, anon, authenticated;
revoke all privileges on all functions in schema public from public, anon, authenticated;
grant usage on schema public to anon, authenticated;
grant select on public.markets, public.market_locations, public.categories, public.category_aliases, public.category_listing_type_mappings, public.businesses, public.listing_types, public.listing_schemas, public.schema_fields, public.listings, public.listing_media, public.listing_variants, public.listing_availability to anon, authenticated;
grant select on public.profiles to authenticated;
grant update(display_name, avatar_path, default_market_id, phone_e164) on public.profiles to authenticated;
grant select on public.profile_capabilities, public.business_memberships to authenticated;
grant select on public.business_onboarding_drafts to authenticated;
grant select, insert on public.searches, public.search_intents, public.requests to authenticated;
grant select, insert, update, delete on public.listings, public.listing_variants, public.inventory_levels, public.listing_availability to authenticated;
grant select, insert on public.listing_media to authenticated;
grant select on public.orders, public.order_items, public.order_status_events, public.fulfilment_events, public.notifications to authenticated;
grant update(status, read_at) on public.notifications to authenticated;
grant execute on function public.is_current_profile_active(), public.has_capability(public.profile_capability), public.is_business_member(uuid), public.is_business_manager(uuid), public.start_business_onboarding(uuid,text,text), public.save_business_onboarding_draft(uuid,text,jsonb), public.claim_guest_intent(uuid,text) to authenticated;
revoke execute on function public.create_guest_intent(text,text,jsonb,text) from public, anon, authenticated;
revoke execute on function public.consume_auth_rate_limit(text,text) from public, anon, authenticated;
grant execute on function public.consume_auth_rate_limit(text,text) to service_role;
grant execute on function public.create_guest_intent(text,text,jsonb,text) to service_role;
grant execute on function public.post_journal(text,text,uuid,text,jsonb) to service_role;
grant execute on function public.reverse_posted_journal(uuid,text,text) to service_role;
alter table public.media_upload_rate_limits enable row level security;
alter table public.listing_media_upload_reservations enable row level security;
revoke execute on function public.consume_media_upload_rate_limit() from public, anon, authenticated;
grant execute on function public.reserve_listing_media_upload(uuid,text) to authenticated;
grant execute on function public.confirm_listing_media_upload(uuid,text) to authenticated;
grant execute on function public.cancel_listing_media_upload(uuid,text) to authenticated;
grant execute on function public.mark_listing_media_upload_removed(uuid,text) to authenticated;
grant execute on function public.expire_listing_media_upload_reservations() to service_role;
grant execute on function public.claim_orphan_listing_media_cleanup(integer) to service_role;
grant execute on function public.complete_orphan_listing_media_cleanup(text,uuid) to service_role;
grant execute on function public.fail_orphan_listing_media_cleanup(text,uuid,text) to service_role;
grant execute on function public.has_reserved_listing_media_upload(text), public.has_confirmed_listing_media_upload(uuid,text) to authenticated;

drop policy profiles_self on public.profiles;
drop policy drafts_owner on public.business_onboarding_drafts;
drop policy guest_intents_claim on public.guest_intents;
drop policy searches_owner on public.searches;
drop policy requests_owner_write on public.requests;
drop policy orders_buyer_create on public.orders;
drop policy listings_manager_write on public.listings;
drop policy listing_media_manager_write on public.listing_media;
drop policy variants_manager_write on public.listing_variants;
drop policy availability_manager_write on public.listing_availability;

create policy profiles_self_select on public.profiles for select to authenticated using (id = (select auth.uid()));
create policy profiles_self_update on public.profiles for update to authenticated using (id = (select auth.uid()) and (select public.is_current_profile_active())) with check (id = (select auth.uid()));
create policy drafts_owner_select on public.business_onboarding_drafts for select to authenticated using (owner_id = (select auth.uid()) and (select public.is_business_manager(business_id)));
create policy drafts_owner_update on public.business_onboarding_drafts for update to authenticated using (owner_id = (select auth.uid()) and (select public.is_business_manager(business_id))) with check (owner_id = (select auth.uid()) and (select public.is_business_manager(business_id)));
create policy guest_intents_claimed_owner_select on public.guest_intents for select to authenticated using (claimed_by = (select auth.uid()) and (select public.is_current_profile_active()));
create policy searches_owner_select on public.searches for select to authenticated using (actor_id = (select auth.uid()));
create policy searches_owner_insert on public.searches for insert to authenticated with check (actor_id = (select auth.uid()) and (select public.is_current_profile_active()));
create policy search_intents_owner_insert on public.search_intents for insert to authenticated with check (exists(select 1 from public.searches s where s.id = search_id and s.actor_id = (select auth.uid())));
create policy requests_owner_insert on public.requests for insert to authenticated with check (requester_id = (select auth.uid()) and (select public.is_current_profile_active()));
create policy notifications_self_update on public.notifications for update to authenticated using (profile_id = (select auth.uid())) with check (profile_id = (select auth.uid()) and status = 'read' and read_at is not null);
create policy listings_manager_select on public.listings for select to authenticated using ((select public.is_business_member(business_id)));
create policy listings_manager_insert on public.listings for insert to authenticated with check ((select public.is_business_manager(business_id)) and status = 'draft' and created_by = (select auth.uid()));
create policy listings_manager_update on public.listings for update to authenticated using ((select public.is_business_manager(business_id))) with check ((select public.is_business_manager(business_id)) and status <> 'active');
create policy listings_manager_delete on public.listings for delete to authenticated using ((select public.is_business_manager(business_id)) and status = 'draft');
create policy listing_media_manager_insert on public.listing_media for insert to authenticated with check ((select public.has_confirmed_listing_media_upload(listing_id,storage_path)));
create policy variants_manager_insert on public.listing_variants for insert to authenticated with check (exists(select 1 from public.listings l where l.id = listing_id and (select public.is_business_manager(l.business_id))));
create policy variants_manager_update on public.listing_variants for update to authenticated using (exists(select 1 from public.listings l where l.id = listing_id and (select public.is_business_manager(l.business_id)))) with check (exists(select 1 from public.listings l where l.id = listing_id and (select public.is_business_manager(l.business_id))));
create policy variants_manager_delete on public.listing_variants for delete to authenticated using (exists(select 1 from public.listings l where l.id = listing_id and (select public.is_business_manager(l.business_id))));
create policy inventory_manager_select on public.inventory_levels for select to authenticated using (exists(select 1 from public.listing_variants v join public.listings l on l.id = v.listing_id where v.id = variant_id and (select public.is_business_member(l.business_id))));
create policy inventory_manager_insert on public.inventory_levels for insert to authenticated with check (exists(select 1 from public.listing_variants v join public.listings l on l.id = v.listing_id where v.id = variant_id and (select public.is_business_manager(l.business_id))));
create policy inventory_manager_update on public.inventory_levels for update to authenticated using (exists(select 1 from public.listing_variants v join public.listings l on l.id = v.listing_id where v.id = variant_id and (select public.is_business_manager(l.business_id)))) with check (exists(select 1 from public.listing_variants v join public.listings l on l.id = v.listing_id where v.id = variant_id and (select public.is_business_manager(l.business_id))));
create policy availability_manager_insert on public.listing_availability for insert to authenticated with check (exists(select 1 from public.listings l where l.id = listing_id and (select public.is_business_manager(l.business_id))));
create policy availability_manager_update on public.listing_availability for update to authenticated using (exists(select 1 from public.listings l where l.id = listing_id and (select public.is_business_manager(l.business_id)))) with check (exists(select 1 from public.listings l where l.id = listing_id and (select public.is_business_manager(l.business_id))));
create policy availability_manager_delete on public.listing_availability for delete to authenticated using (exists(select 1 from public.listings l where l.id = listing_id and (select public.is_business_manager(l.business_id))));

drop policy businesses_public_read on public.businesses;
drop policy public_active_listings on public.listings;
drop policy public_listing_media on public.listing_media;
drop policy public_variants on public.listing_variants;
drop policy public_availability on public.listing_availability;
create policy public_active_markets on public.markets for select to anon, authenticated using (is_active);
create policy public_active_businesses on public.businesses for select to anon, authenticated using (status = 'active' and exists(select 1 from public.markets m where m.id = market_id and m.is_active));
create policy businesses_members_select on public.businesses for select to authenticated using ((select public.is_business_member(id)));
create policy public_active_locations on public.market_locations for select to anon, authenticated using (is_active and exists(select 1 from public.markets m where m.id = market_id and m.is_active));
create policy public_active_categories on public.categories for select to anon, authenticated using (is_active and (market_id is null or exists(select 1 from public.markets m where m.id = market_id and m.is_active)));
create policy public_category_aliases on public.category_aliases for select to anon, authenticated using (exists(select 1 from public.categories c left join public.markets cm on cm.id = c.market_id left join public.markets am on am.id = category_aliases.market_id where c.id = category_id and c.is_active and c.market_id is not distinct from category_aliases.market_id and (cm.id is null or cm.is_active) and (am.id is null or am.is_active)));
create policy public_category_listing_type_mappings on public.category_listing_type_mappings for select to anon, authenticated using (exists(select 1 from public.categories c left join public.markets m on m.id = c.market_id join public.listing_types lt on lt.id = listing_type_id join public.listing_schemas s on s.id = listing_schema_id where c.id = category_id and c.is_active and (m.id is null or m.is_active) and lt.is_active and s.status = 'published' and s.listing_type_id = listing_type_id));
create policy public_listing_types on public.listing_types for select to anon, authenticated using (is_active);
create policy public_published_schemas on public.listing_schemas for select to anon, authenticated using (status = 'published');
create policy public_published_schema_fields on public.schema_fields for select to anon, authenticated using (exists(select 1 from public.listing_schemas s where s.id = listing_schema_id and s.status = 'published'));
create policy public_active_listings on public.listings for select to anon, authenticated using (status = 'active' and exists(select 1 from public.businesses b join public.markets m on m.id = b.market_id where b.id = business_id and b.status = 'active' and m.is_active));
create policy public_listing_media on public.listing_media for select to anon, authenticated using (exists(select 1 from public.listings l join public.businesses b on b.id = l.business_id join public.markets m on m.id = l.market_id where l.id = listing_id and l.status = 'active' and b.status = 'active' and m.is_active));
create policy public_variants on public.listing_variants for select to anon, authenticated using (is_active and exists(select 1 from public.listings l join public.businesses b on b.id = l.business_id join public.markets m on m.id = l.market_id where l.id = listing_id and l.status = 'active' and b.status = 'active' and m.is_active));
create policy public_availability on public.listing_availability for select to anon, authenticated using (exists(select 1 from public.listings l join public.businesses b on b.id = l.business_id join public.markets m on m.id = l.market_id where l.id = listing_id and l.status = 'active' and b.status = 'active' and m.is_active));

create or replace function public.transition_business_status(target_business uuid, next_status text, reason text) returns void language plpgsql security definer set search_path = '' as $$
declare
  trim_chars constant text := E' \t\n\r\f' || pg_catalog.chr(11) || U&'\00A0\1680\180E\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\200B\200C\200D\200E\200F\2028\2029\202A\202B\202C\202D\202E\202F\205F\2060\2061\2062\2063\2064\2066\2067\2068\2069\3000\FEFF';
  default_ignorable_pattern constant text := U&'[\00AD\034F\061C\115F-\1160\17B4-\17B5\180B-\180F\200B-\200F\202A-\202E\2060-\206F\3164\FE00-\FE0F\FEFF\FFA0\FFF0-\FFF8\+01BCA0-\+01BCA3\+01D173-\+01D17A\+0E0000-\+0E0FFF]';
  normalized_reason text := pg_catalog.btrim(reason, trim_chars);
  visible_reason text := pg_catalog.regexp_replace(normalized_reason, default_ignorable_pattern, '', 'g');
  meaningful_reason text := pg_catalog.regexp_replace(visible_reason, '[^[:alnum:]]', '', 'g');
begin
  if not (public.has_capability('admin') or public.has_capability('super_admin')) then raise exception 'administrator access is required'; end if;
  if next_status not in ('pending_review','active','suspended') or reason is null or char_length(normalized_reason) not between 3 and 500 or char_length(meaningful_reason) < 3 or exists(select 1 from public.business_memberships bm where bm.business_id = target_business and bm.profile_id = (select auth.uid()) and bm.accepted_at is not null) then raise exception 'invalid transition'; end if;
  update public.businesses set status = next_status where id = target_business;
  if not found then raise exception 'business not found'; end if;
  insert into public.admin_events(admin_id,action,subject_type,subject_id,reason) values((select auth.uid()),'business_status_transition','business',target_business,normalized_reason);
end; $$;
revoke execute on function public.transition_business_status(uuid,text,text) from public, anon, authenticated;
grant execute on function public.transition_business_status(uuid,text,text) to authenticated;
create or replace function public.set_profile_suspension(target_profile uuid, should_suspend boolean, reason text) returns void language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := (select auth.uid());
  trim_chars constant text := E' \t\n\r\f' || pg_catalog.chr(11) || U&'\00A0\1680\180E\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\200B\200C\200D\200E\200F\2028\2029\202A\202B\202C\202D\202E\202F\205F\2060\2061\2062\2063\2064\2066\2067\2068\2069\3000\FEFF';
  default_ignorable_pattern constant text := U&'[\00AD\034F\061C\115F-\1160\17B4-\17B5\180B-\180F\200B-\200F\202A-\202E\2060-\206F\3164\FE00-\FE0F\FEFF\FFA0\FFF0-\FFF8\+01BCA0-\+01BCA3\+01D173-\+01D17A\+0E0000-\+0E0FFF]';
  normalized_reason text := pg_catalog.btrim(reason, trim_chars);
  visible_reason text := pg_catalog.regexp_replace(normalized_reason, default_ignorable_pattern, '', 'g');
  meaningful_reason text := pg_catalog.regexp_replace(visible_reason, '[^[:alnum:]]', '', 'g');
begin
  if actor is null or not public.has_capability('super_admin') or actor = target_profile or reason is null or char_length(normalized_reason) not between 3 and 500 or char_length(meaningful_reason) < 3 then raise exception 'invalid profile suspension request'; end if;
  update public.profiles set is_suspended = should_suspend where id = target_profile;
  if not found then raise exception 'profile not found'; end if;
  insert into public.admin_events(admin_id,action,subject_type,subject_id,reason) values(actor,case when should_suspend then 'profile_suspended' else 'profile_unsuspended' end,'profile',target_profile,normalized_reason);
end; $$;
revoke execute on function public.set_profile_suspension(uuid,boolean,text) from public, anon, authenticated;
grant execute on function public.set_profile_suspension(uuid,boolean,text) to authenticated;

drop policy listing_media_object_read on storage.objects;
drop policy listing_media_object_insert on storage.objects;
drop policy listing_media_object_update on storage.objects;
drop policy listing_media_object_delete on storage.objects;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('listing-media','listing-media',false,20971520,array['image/jpeg','image/png','image/webp','video/mp4','application/pdf']) on conflict(id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
create policy listing_media_object_public_read on storage.objects for select to anon, authenticated using (bucket_id = 'listing-media' and exists(select 1 from public.listing_media lm join public.listings l on l.id = lm.listing_id join public.businesses b on b.id = l.business_id join public.markets m on m.id = l.market_id where lm.storage_path = storage.objects.name and l.status = 'active' and b.status = 'active' and m.is_active));
create policy listing_media_object_manager_read on storage.objects for select to authenticated using (bucket_id = 'listing-media' and storage.objects.name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{32}\.(jpg|jpeg|png|webp|mp4|pdf)$' and exists(select 1 from public.listings l where l.id::text = (storage.foldername(storage.objects.name))[1] and (select public.is_business_manager(l.business_id))));
create policy listing_media_object_insert on storage.objects for insert to authenticated with check (bucket_id = 'listing-media' and (select public.has_reserved_listing_media_upload(storage.objects.name)));

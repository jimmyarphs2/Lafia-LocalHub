-- Forward-compatible regression probe for the active-table branches installed
-- by 202608300018_localhub_market_integrity_trigger_dispatch.sql. Step 26
-- migration 033 makes the legacy search/demand relations owner-dormant; their
-- mutation boundary is exercised by demand_mission_quarantine_probe.sql.
-- Everything in this probe, including the auth fixture, is rolled back.
begin;

do $$
declare
  market_one uuid := '10000000-0000-4000-8000-000000000001';
  market_two uuid := '10000000-0000-4000-8000-000000000002';
  location_one uuid := '20000000-0000-4000-8000-000000000001';
  location_two uuid := '20000000-0000-4000-8000-000000000002';
  category_one uuid := '30000000-0000-4000-8000-000000000001';
  category_two uuid := '30000000-0000-4000-8000-000000000002';
  type_one uuid := '40000000-0000-4000-8000-000000000001';
  type_two uuid := '40000000-0000-4000-8000-000000000002';
  schema_one uuid := '50000000-0000-4000-8000-000000000001';
  schema_two uuid := '50000000-0000-4000-8000-000000000002';
  business_one uuid := '60000000-0000-4000-8000-000000000001';
  business_two uuid := '60000000-0000-4000-8000-000000000002';
  listing_one uuid := '70000000-0000-4000-8000-000000000001';
  listing_two uuid := '70000000-0000-4000-8000-000000000002';
  variant_one uuid := '80000000-0000-4000-8000-000000000001';
  variant_two uuid := '80000000-0000-4000-8000-000000000002';
  guest_one uuid := 'a0000000-0000-4000-8000-000000000001';
  guest_bad uuid := 'a0000000-0000-4000-8000-000000000002';
  buyer_one uuid := 'b0000000-0000-4000-8000-000000000001';
  order_one uuid := 'c0000000-0000-4000-8000-000000000001';
begin
  if (
    select count(*)
    from pg_trigger t
    join pg_class relation on relation.oid = t.tgrelid
    join pg_namespace relation_schema on relation_schema.oid = relation.relnamespace
    join pg_proc function on function.oid = t.tgfoid
    join pg_namespace function_schema on function_schema.oid = function.pronamespace
    where not t.tgisinternal
      and relation_schema.nspname = 'public'
      and function_schema.nspname = 'public'
      and function.proname = 'validate_market_integrity'
  ) <> 12 then
    raise exception 'expected exactly 12 production validate_market_integrity triggers';
  end if;

  if (
    select array_agg(relation.relname::text order by relation.relname)
    from pg_trigger t
    join pg_class relation on relation.oid = t.tgrelid
    join pg_namespace relation_schema on relation_schema.oid = relation.relnamespace
    join pg_proc function on function.oid = t.tgfoid
    join pg_namespace function_schema on function_schema.oid = function.pronamespace
    where not t.tgisinternal
      and relation_schema.nspname = 'public'
      and function_schema.nspname = 'public'
      and function.proname = 'validate_market_integrity'
  ) is distinct from array[
    'businesses', 'categories', 'category_aliases',
    'category_listing_type_mappings', 'demand_signals', 'listings',
    'market_locations', 'order_items', 'orders', 'requests',
    'search_intents', 'unmet_demand'
  ]::text[] then
    raise exception 'validate_market_integrity trigger table set is incorrect';
  end if;

  insert into public.markets(id, slug, name) values
    (market_one, 'dispatch-probe-one', 'Dispatch Probe One'),
    (market_two, 'dispatch-probe-two', 'Dispatch Probe Two');
  insert into public.market_locations(id, market_id, kind, name, slug)
    values (location_one, market_one, 'state', 'Probe One', 'probe-one');
  update public.market_locations set is_active = is_active where id = location_one;
  insert into public.market_locations(id, market_id, kind, name, slug)
    values (location_two, market_two, 'state', 'Probe Two', 'probe-two');

  insert into public.categories(id, market_id, slug, name)
    values (category_one, market_one, 'probe-one', 'Probe One');
  update public.categories set is_active = is_active where id = category_one;
  insert into public.categories(id, market_id, slug, name)
    values (category_two, market_two, 'probe-two', 'Probe Two');
  insert into public.category_aliases(category_id, market_id, alias, normalized_alias)
    values (category_one, market_one, 'probe one', 'probe one');
  update public.category_aliases set alias = alias where category_id = category_one;

  insert into public.listing_types(id, code, name) values
    (type_one, 'probe_type_one', 'Probe Type One'),
    (type_two, 'probe_type_two', 'Probe Type Two');
  insert into public.listing_schemas(id, listing_type_id, version, schema) values
    (schema_one, type_one, 1, '{}'::jsonb),
    (schema_two, type_two, 1, '{}'::jsonb);
  insert into public.category_listing_type_mappings(category_id, listing_type_id, listing_schema_id)
    values (category_one, type_one, schema_one), (category_two, type_two, schema_two);
  update public.category_listing_type_mappings
    set is_default = is_default
    where category_id = category_one and listing_type_id = type_one and listing_schema_id = schema_one;

  insert into public.businesses(id, market_id, location_id, name, slug)
    values (business_one, market_one, location_one, 'Probe Business One', 'dispatch-probe-business-one');
  update public.businesses set name = name where id = business_one;
  insert into public.businesses(id, market_id, location_id, name, slug)
    values (business_two, market_two, location_two, 'Probe Business Two', 'dispatch-probe-business-two');
  insert into public.listings(
    id, business_id, market_id, category_id, listing_type_id, listing_schema_id,
    location_id, slug, title
  ) values (
    listing_one, business_one, market_one, category_one, type_one, schema_one,
    location_one, 'dispatch-probe-listing-one', 'Probe Listing One'
  ), (
    listing_two, business_two, market_two, category_two, type_two, schema_two,
    location_two, 'dispatch-probe-listing-two', 'Probe Listing Two'
  );
  update public.listings set title = title where id = listing_one;
  insert into public.listing_variants(id, listing_id, name)
    values (variant_one, listing_one, 'Probe Variant One'), (variant_two, listing_two, 'Probe Variant Two');

  insert into public.guest_intents(id, market_id, kind, return_to, expires_at)
    values (guest_one, market_one, 'probe', '/probe', now() + interval '1 hour');
  insert into public.requests(guest_intent_id, market_id, category_id, title)
    values (guest_one, market_one, category_one, 'Probe request');
  update public.requests set title = title where guest_intent_id = guest_one;
  insert into auth.users(
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values (
    buyer_one, '00000000-0000-0000-0000-000000000000', 'authenticated',
    'authenticated', 'dispatch-probe@example.test', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
  );
  insert into public.profiles(id, display_name) values (buyer_one, 'Dispatch Probe Buyer')
    on conflict (id) do nothing;
  insert into public.orders(id, order_number, buyer_id, business_id, market_id)
    values (order_one, 'DISPATCH-PROBE-ORDER', buyer_one, business_one, market_one);
  update public.orders set total_minor = total_minor where id = order_one;
  insert into public.order_items(order_id, listing_id, variant_id, title_snapshot, quantity, unit_price_minor, total_minor)
    values (order_one, listing_one, variant_one, 'Probe Listing One', 1, 0, 0);
  update public.order_items set quantity = quantity where order_id = order_one;

  -- Each block must receive the trigger's exact public error, not a later FK/check error.
  begin
    insert into public.market_locations(market_id, parent_id, kind, name, slug)
      values (market_one, location_two, 'lga', 'Bad location', 'bad-location');
    raise exception 'expected location parent failure';
  exception when others then if sqlerrm <> 'location parent is invalid' then raise; end if; end;
  begin
    insert into public.categories(market_id, parent_id, slug, name)
      values (market_one, category_two, 'bad-category', 'Bad category');
    raise exception 'expected category parent failure';
  exception when others then if sqlerrm <> 'category parent is invalid' then raise; end if; end;
  begin
    insert into public.category_aliases(category_id, market_id, alias, normalized_alias)
      values (category_one, market_two, 'bad alias', 'bad alias');
    raise exception 'expected category alias failure';
  exception when others then if sqlerrm <> 'category alias market mismatch' then raise; end if; end;
  begin
    insert into public.category_listing_type_mappings(category_id, listing_type_id, listing_schema_id)
      values (category_one, type_two, schema_one);
    raise exception 'expected category mapping failure';
  exception when others then if sqlerrm <> 'category mapping schema mismatch' then raise; end if; end;
  begin
    insert into public.businesses(market_id, location_id, name, slug)
      values (market_one, location_two, 'Bad business', 'dispatch-probe-bad-business');
    raise exception 'expected business location failure';
  exception when others then if sqlerrm <> 'business location market mismatch' then raise; end if; end;
  begin
    insert into public.listings(business_id, market_id, listing_type_id, listing_schema_id, slug, title)
      values (business_two, market_one, type_one, schema_one, 'bad-business-listing', 'Bad business listing');
    raise exception 'expected listing business failure';
  exception when others then if sqlerrm <> 'listing business market mismatch' then raise; end if; end;
  begin
    insert into public.listings(business_id, market_id, location_id, listing_type_id, listing_schema_id, slug, title)
      values (business_one, market_one, location_two, type_one, schema_one, 'bad-location-listing', 'Bad location listing');
    raise exception 'expected listing location failure';
  exception when others then if sqlerrm <> 'listing location market mismatch' then raise; end if; end;
  begin
    insert into public.listings(business_id, market_id, category_id, listing_type_id, listing_schema_id, slug, title)
      values (business_one, market_one, category_two, type_one, schema_one, 'bad-category-listing', 'Bad category listing');
    raise exception 'expected listing category failure';
  exception when others then if sqlerrm <> 'listing category market mismatch' then raise; end if; end;
  begin
    insert into public.listings(business_id, market_id, category_id, listing_type_id, listing_schema_id, slug, title)
      values (business_one, market_one, category_one, type_two, schema_one, 'bad-schema-listing', 'Bad schema listing');
    raise exception 'expected listing schema type failure';
  exception when others then if sqlerrm <> 'listing schema type mismatch' then raise; end if; end;
  begin
    insert into public.listings(business_id, market_id, category_id, listing_type_id, listing_schema_id, slug, title)
      values (business_one, market_one, category_one, type_two, schema_two, 'bad-mapping-listing', 'Bad mapping listing');
    raise exception 'expected listing category mapping failure';
  exception when others then if sqlerrm <> 'listing category schema mapping mismatch' then raise; end if; end;
  begin
    insert into public.requests(guest_intent_id, market_id, category_id, title)
      values (guest_bad, market_one, category_two, 'Bad request');
    raise exception 'expected request category failure';
  exception when others then if sqlerrm <> 'category market mismatch' then raise; end if; end;
  begin
    insert into public.orders(order_number, buyer_id, business_id, market_id)
      values ('DISPATCH-PROBE-BAD-ORDER', buyer_one, business_two, market_one);
    raise exception 'expected order business failure';
  exception when others then if sqlerrm <> 'order business market mismatch' then raise; end if; end;
  begin
    insert into public.order_items(order_id, listing_id, title_snapshot, quantity, unit_price_minor, total_minor)
      values (order_one, listing_two, 'Wrong listing', 1, 0, 0);
    raise exception 'expected order item listing failure';
  exception when others then if sqlerrm <> 'order item listing mismatch' then raise; end if; end;
  begin
    insert into public.order_items(order_id, listing_id, variant_id, title_snapshot, quantity, unit_price_minor, total_minor)
      values (order_one, listing_one, variant_two, 'Wrong variant', 1, 0, 0);
    raise exception 'expected order item variant failure';
  exception when others then if sqlerrm <> 'order item variant mismatch' then raise; end if; end;
end;
$$;

create table public.market_integrity_dispatch_probe (
  id uuid primary key default extensions.gen_random_uuid()
);
create trigger market_integrity_dispatch_probe_validate_market
  before insert or update on public.market_integrity_dispatch_probe
  for each row execute function public.validate_market_integrity();

do $$
begin
  begin
    insert into public.market_integrity_dispatch_probe default values;
    raise exception 'expected unknown-table failure';
  exception when others then
    if sqlerrm <> 'validate_market_integrity cannot validate table market_integrity_dispatch_probe' then
      raise;
    end if;
  end;
end;
$$;

rollback;

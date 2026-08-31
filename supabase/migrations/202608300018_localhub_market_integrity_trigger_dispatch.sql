-- The foundation market-integrity trigger was shared by tables with different
-- row shapes. Compound predicates such as `tg_table_name = 'x' and new.x ...`
-- still bind every referenced NEW field when PostgreSQL prepares the expression,
-- so a valid category insert could fail on a field owned by a later table branch.
-- Dispatch first, then prepare only the expressions valid for that table shape.

create or replace function public.validate_market_integrity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_schema <> 'public' then
    raise exception 'validate_market_integrity cannot validate schema %', tg_table_schema;
  end if;

  case tg_table_name
    when 'market_locations' then
      if new.parent_id is not null and (
        new.parent_id = new.id
        or not exists (
          select 1
          from public.market_locations p
          where p.id = new.parent_id
            and p.market_id = new.market_id
        )
        or exists (
          with recursive ancestors as (
            select p.id, p.parent_id
            from public.market_locations p
            where p.id = new.parent_id
            union
            select p.id, p.parent_id
            from public.market_locations p
            join ancestors a on p.id = a.parent_id
          )
          select 1 from ancestors where id = new.id
        )
      ) then
        raise exception 'location parent is invalid';
      end if;

    when 'categories' then
      if new.parent_id is not null and (
        new.parent_id = new.id
        or not exists (
          select 1
          from public.categories p
          where p.id = new.parent_id
            and p.market_id is not distinct from new.market_id
        )
        or exists (
          with recursive ancestors as (
            select p.id, p.parent_id
            from public.categories p
            where p.id = new.parent_id
            union
            select p.id, p.parent_id
            from public.categories p
            join ancestors a on p.id = a.parent_id
          )
          select 1 from ancestors where id = new.id
        )
      ) then
        raise exception 'category parent is invalid';
      end if;

    when 'category_aliases' then
      if not exists (
        select 1
        from public.categories c
        where c.id = new.category_id
          and c.market_id is not distinct from new.market_id
      ) then
        raise exception 'category alias market mismatch';
      end if;

    when 'category_listing_type_mappings' then
      if not exists (
        select 1
        from public.listing_schemas s
        where s.id = new.listing_schema_id
          and s.listing_type_id = new.listing_type_id
      ) then
        raise exception 'category mapping schema mismatch';
      end if;

    when 'businesses' then
      if new.location_id is not null and not exists (
        select 1
        from public.market_locations l
        where l.id = new.location_id
          and l.market_id = new.market_id
      ) then
        raise exception 'business location market mismatch';
      end if;

    when 'listings' then
      if not exists (
        select 1
        from public.businesses b
        where b.id = new.business_id
          and b.market_id = new.market_id
      ) then
        raise exception 'listing business market mismatch';
      end if;
      if new.location_id is not null and not exists (
        select 1
        from public.market_locations l
        where l.id = new.location_id
          and l.market_id = new.market_id
      ) then
        raise exception 'listing location market mismatch';
      end if;
      if new.category_id is not null and not exists (
        select 1
        from public.categories c
        where c.id = new.category_id
          and (c.market_id is null or c.market_id = new.market_id)
      ) then
        raise exception 'listing category market mismatch';
      end if;
      if not exists (
        select 1
        from public.listing_schemas s
        where s.id = new.listing_schema_id
          and s.listing_type_id = new.listing_type_id
      ) then
        raise exception 'listing schema type mismatch';
      end if;
      if new.category_id is not null and not exists (
        select 1
        from public.category_listing_type_mappings m
        where m.category_id = new.category_id
          and m.listing_type_id = new.listing_type_id
          and m.listing_schema_id = new.listing_schema_id
      ) then
        raise exception 'listing category schema mapping mismatch';
      end if;

    when 'requests' then
      if new.category_id is not null and not exists (
        select 1
        from public.categories c
        where c.id = new.category_id
          and (c.market_id is null or c.market_id = new.market_id)
      ) then
        raise exception 'category market mismatch';
      end if;

    when 'demand_signals' then
      if new.category_id is not null and not exists (
        select 1
        from public.categories c
        where c.id = new.category_id
          and (c.market_id is null or c.market_id = new.market_id)
      ) then
        raise exception 'category market mismatch';
      end if;

    when 'unmet_demand' then
      if new.category_id is not null and not exists (
        select 1
        from public.categories c
        where c.id = new.category_id
          and (c.market_id is null or c.market_id = new.market_id)
      ) then
        raise exception 'category market mismatch';
      end if;

    when 'search_intents' then
      if new.category_id is not null and not exists (
        select 1
        from public.categories c
        join public.searches s on s.id = new.search_id
        where c.id = new.category_id
          and (c.market_id is null or c.market_id = s.market_id)
      ) then
        raise exception 'search intent category market mismatch';
      end if;

    when 'orders' then
      if not exists (
        select 1
        from public.businesses b
        where b.id = new.business_id
          and b.market_id = new.market_id
      ) then
        raise exception 'order business market mismatch';
      end if;

    when 'order_items' then
      if not exists (
        select 1
        from public.listings l
        join public.orders o on o.id = new.order_id
        where l.id = new.listing_id
          and l.business_id = o.business_id
          and l.market_id = o.market_id
      ) then
        raise exception 'order item listing mismatch';
      end if;
      if new.variant_id is not null and not exists (
        select 1
        from public.listing_variants v
        where v.id = new.variant_id
          and v.listing_id = new.listing_id
      ) then
        raise exception 'order item variant mismatch';
      end if;

    else
      raise exception 'validate_market_integrity cannot validate table %', tg_table_name;
  end case;

  return new;
end;
$$;

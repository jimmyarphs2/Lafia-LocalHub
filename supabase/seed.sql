-- DEMO ONLY: fictional Lafia fixtures. Never deploy as production data.
insert into public.markets (id, slug, name, country_code, currency_code, timezone) values ('00000000-0000-4000-8000-000000000001','lafia','Lafia (local fictional fixture)','NG','NGN','Africa/Lagos') on conflict (slug) do update set name = excluded.name;
insert into public.market_locations (id, market_id, kind, name, slug) values ('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000001','district','Central Lafia (fictional demo)','central-lafia-demo') on conflict do nothing;
insert into public.categories (id, market_id, slug, name, kind) values ('00000000-0000-4000-8000-000000000020','00000000-0000-4000-8000-000000000001','fresh-produce-demo','Fresh Produce (fictional demo)','standard'),('00000000-0000-4000-8000-000000000021','00000000-0000-4000-8000-000000000001','home-services-demo','Home Services (fictional demo)','emerging') on conflict do nothing;
insert into public.category_aliases (category_id, market_id, alias, normalized_alias) values ('00000000-0000-4000-8000-000000000020','00000000-0000-4000-8000-000000000001','demo vegetables','demo vegetables') on conflict do nothing;
insert into public.listing_types (id, code, name, description) values ('00000000-0000-4000-8000-000000000030','product','Product (fictional demo)','Explicit demo Adaptive Listing Engine type') on conflict (code) do nothing;
insert into public.listing_schemas (id, listing_type_id, version, status, schema, published_at) values (
  '00000000-0000-4000-8000-000000000031',
  '00000000-0000-4000-8000-000000000030',
  1,
  'published',
  '{
    "contractVersion":"1.1",
    "schemaVersion":1,
    "schemaKey":"demo_product_v1",
    "listingKind":"product",
    "terminology":{
      "singular":"fictional demo product",
      "plural":"fictional demo products",
      "createAction":"Add a fictional demo product"
    },
    "bindings":{"title":"title","description":"description"},
    "fields":[
      {"key":"title","type":"short_text","label":"Demo product title","required":true,"minLength":2,"maxLength":120},
      {"key":"description","type":"long_text","label":"Demo description","required":true,"minLength":20,"maxLength":1500},
      {"key":"unit","type":"select","label":"Unit (fictional demo)","required":true,"options":[{"label":"Bundle","value":"bundle"},{"label":"Kilogram","value":"kg"}]},
      {"key":"origin_note","type":"short_text","label":"Origin note (fictional demo)","required":false,"maxLength":160}
    ]
  }'::jsonb,
  now()
) on conflict (listing_type_id, version) do nothing;
insert into public.schema_fields (listing_schema_id, key, label, data_type, is_required, is_filterable, validation, display_order) values ('00000000-0000-4000-8000-000000000031','unit','Unit (fictional demo)','select',true,true,'{"provenance":"fictional-demo","options":["bundle","kg"]}'::jsonb,10),('00000000-0000-4000-8000-000000000031','origin_note','Origin note (fictional demo)','text',false,false,'{"provenance":"fictional-demo"}'::jsonb,20) on conflict do nothing;
insert into public.category_listing_type_mappings(category_id, listing_type_id, listing_schema_id, is_default) values ('00000000-0000-4000-8000-000000000020','00000000-0000-4000-8000-000000000030','00000000-0000-4000-8000-000000000031',true) on conflict do nothing;

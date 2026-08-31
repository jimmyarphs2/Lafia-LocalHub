-- Cover the business foreign key used by referential checks without mutating
-- the already-applied listing draft workspace migration.

create index listing_draft_create_requests_business_idx
  on private.listing_draft_create_requests(business_id);

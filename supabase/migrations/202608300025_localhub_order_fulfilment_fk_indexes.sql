-- Cover the two composite fulfilment foreign keys for parent-side integrity
-- checks without changing authorization, state, or application behavior.

create index if not exists
  listing_order_fulfilment_processing_fulfilment_order_idx
  on private.listing_order_fulfilment_processing(fulfilment_id, order_id);

create index if not exists fulfilment_events_fulfilment_order_idx
  on public.fulfilment_events(fulfilment_id, order_id);

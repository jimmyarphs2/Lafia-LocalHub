# LocalHub order fulfilment processing contract

**Status:** frozen implementation contract for the first protected fulfilment boundary
**Scope:** one governed production slice after vendor confirmation
**Order state:** remains `confirmed`
**Fulfilment state:** `not started -> processing`

## Product truth

This operation records only that the vendor business has begun handling a confirmed order. It does not assert that an item or service is ready, dispatched, delivered, collected, handed over, accepted, completed, paid for, refunded, or settled.

LocalHub has no immutable fulfilment method, address, tracking, carrier, contact, handoff evidence, customer acknowledgement, payment state, or dispute policy in the current order snapshot. The first boundary must therefore not set `orders.status = 'fulfilled'` or use delivery/pickup language.

## Authoritative state model

Create one canonical `public.order_fulfilments` row per protected listing order. In this slice its only legal state is `processing`.

- The row has a UUID primary key and a unique, non-null `order_id` referencing `public.orders(id)` with `ON DELETE RESTRICT`.
- `status` is constrained to `processing`.
- `started_at`, `created_at`, and `updated_at` use one canonical timestamp and must be equal.
- The row contains no method, address, contact, carrier, tracking, proof, note, arbitrary payload, payment, or inventory field.
- The existing `public.fulfilment_events` history is normalized to reference the fulfilment aggregate, record status `processing`, event type `processing_started`, the responsible actor while that profile exists, an empty payload, and the same canonical timestamp.

Legal pre-state:

- `orders.snapshot_source = 'listing_order'`.
- `orders.status = 'confirmed'` and `vendor_decided_at` is non-null.
- The immutable order history is the exact durable `placed -> confirmed` chain.
- No fulfilment aggregate or fulfilment event exists for the order.

Legal post-state:

- The order row, `orders.updated_at`, item snapshot, and two order-status events are unchanged.
- Exactly one `processing` aggregate exists.
- Exactly one `processing_started` fulfilment event exists.
- Exactly one minimized `order.fulfilment_processing_started` audit event exists.
- No transition out of `processing` exists in this slice.

## Command boundary

The only mutation entry point is `public.start_listing_order_fulfilment(p_order_id uuid, p_idempotency_key uuid)`.

Untrusted input is limited to one order UUID and one lowercase UUIDv4 idempotency key. The public function is executable only by `authenticated`. It must reject anonymous, `service_role`, malformed, missing, and ambiguous input without exposing order existence.

The actor must be an authenticated, unsuspended profile with an accepted `owner`, `manager`, or `staff` membership for the order's exact currently active business. Authorization is rechecked on replay.

### Outcomes

- `started`: the first atomic state creation.
- `replayed`: the same currently authorized actor, key, and order reproduce the exact durable result.
- `already_started`: the exact durable processing state already exists under another key or actor.
- `idempotency_key_reused`: the actor/key is bound to another order.
- `not_found`: absent, unauthorized, inactive, or wrong pre-state, without existence leakage.
- `invalid`: malformed command.
- `rate_limited`: retryable.

Only `started`, `replayed`, and `already_started` return a complete bounded projection: order ID, order status `confirmed`, fulfilment ID, fulfilment status `processing`, and equal started/updated timestamps. All other outcomes return null projection fields. Any internal inconsistency raises and becomes a generic retryable application failure.

## Concurrency and idempotency

Use a distinct private UUIDv4 ledger and distinct actor limiter; do not reuse the vendor-decision key space.

Lock order:

1. Validate command syntax without order lookup.
2. Authenticate and lock the active profile `FOR SHARE`.
3. Consume the separate actor-owned fixed window before order lookup: at most 120 attempts per actor/hour.
4. Acquire the actor-plus-key transaction advisory lock.
5. Read the private idempotency row under lock.
6. Lock the requested order `FOR NO KEY UPDATE`.
7. Lock the active business `FOR SHARE`.
8. Lock the exact accepted membership `FOR SHARE`.
9. Read and lock the fulfilment aggregate.
10. Generate one `clock_timestamp()` and atomically write the aggregate, event, ledger, and audit.

The ledger primary key is `(actor_id, idempotency_key)`, binds the one `start_processing` command to one order, and stores the fulfilment ID plus canonical result. A unique order constraint is the final duplicate-start backstop. Same-key contention produces one start and one replay; different-key or different-employee contention produces one start and one `already_started`.

## Durable evidence

The successful operation writes exactly:

- one `order_fulfilments` row;
- one `fulfilment_events` row with matching order/fulfilment IDs, `processing_started`, `processing`, current actor, `{}` payload, and canonical timestamp;
- one `audit_events` row with subject `order`, the order ID, action `order.fulfilment_processing_started`, the same actor/timestamp, and exact metadata `{business_id, fulfilment_id, to_status: 'processing'}`.

A private fixed-search-path consistency helper proves the confirmed order history plus exact aggregate/event/audit cardinality, actor, timestamp, and metadata concordance. If the responsible profile is later deleted, the existing `ON DELETE SET NULL` foreign keys may erase both actor references together; the immutable action, business, fulfilment, order, and timestamp evidence remains durable and consistent. This is intentional data-minimization behavior, not an application mutation. Aggregate and event rows are append-only for protected listing orders. Direct application and service-role mutation is revoked.

## Reads, RLS, and client contract

- Enable RLS on the aggregate and authorize customer/vendor reads through `private.can_current_actor_view_order(order_id)`.
- Replace the stale foundation `fulfilment_visible` policy with the same active-profile-aware helper.
- Authenticated grants expose only bounded aggregate/event columns. Event actor and payload are omitted.
- Do not add the aggregate to Realtime in this slice. No subscription UI is introduced.
- Extend the four customer/vendor order projections and retained placement replay with an all-null or all-complete fulfilment quartet: ID, status, started timestamp, updated timestamp.
- `placed` and `cancelled` require all fulfilment fields null. `confirmed` permits either all null or the exact complete `processing` aggregate. Partial, contradictory, plural, wrong-order, unknown-status, or timestamp-drift responses fail parsing.

Customer and vendor views read the same canonical fulfilment row. Vendor projections continue to omit buyer identity.

## Interface truth and accessibility

Only a confirmed vendor order detail may offer `Start processing`. It requires an explicit, focused confirmation:

> This records that your business has begun handling the order. It does not collect payment, reserve stock, arrange pickup or delivery, or mark the order fulfilled.

The confirmation action is `Yes, start processing`; the escape action is `Not yet`. Pending disables both controls. Focus moves to the confirmation heading, returns to the trigger when dismissed, and moves to persistent status/alert feedback after a definitive result or refreshed canonical state. A retryable failure reuses the same idempotency key.

Customer copy is limited to:

> Vendor is processing your order. The vendor has recorded that they have begun handling it. LocalHub has not collected payment. Pickup, delivery, handoff, and completion are not yet recorded.

This slice must not use `shipped`, `out for delivery`, `ready`, `delivered`, `completed`, or `fulfilled` as a fulfilment claim.

## Retention and cleanup

- Idempotency rows retain 30 days.
- Actor limiter rows retain 48 hours.
- Cleanup is service-role-only, bounded to 1-2000 rows, and uses ordered `FOR UPDATE SKIP LOCKED` batches.
- Aggregate, event, and audit evidence is durable and is never pruned by this operation.
- After ledger pruning, a repeat returns `already_started` and cannot create duplicate evidence.

## Required verification

Application tests must execute strict parser, singleton RPC, duplicate-form-field, authentication, same-key retry, wrong-order response, revalidation, confirmation, pending, focus, and truthful-copy behavior. Migration contract tests must cover authorization, actor-first limiting, deterministic locks, unique/idempotent state, immutable evidence, RLS/grants, cleanup bounds, exact projections, and excluded writes.

A live rollback probe must prove owner/manager/staff success; customer/foreign/pending/revoked/suspended/inactive denial; same-key replay; key reuse; different-key `already_started`; the 120th/121st limiter boundary; direct-DML rejection; exact aggregate/event/audit concordance; unchanged order/item/two-event history; retained placement replay with processing projection; customer/vendor synchronization without buyer leakage; post-prune durability; and zero payment, payment-event, inventory, notification, ledger, address, carrier, tracking, or extra order-event effects. All fixtures must roll back with zero residue.

A genuine two-connection contention test remains desirable when a disposable environment is available. Structural lock proof and live rollback behavior are acceptable for this slice if that environment remains unavailable, with the residual documented.

## Explicit exclusions and next approval boundary

Excluded: order-level `fulfilled`; ready-for-handoff; pickup; dispatch; delivery; customer receipt; service completion; proof; failure/reversal; method/address/contact/tracking/carrier/rider data; inventory/reservation; payment/Paystack/refund/earnings/fees/referral/ledger/settlement/payout; notifications; new Realtime behavior; customer cancellation; vendor reversal; admin override; dispute/return; AI; listing publication; analytics; and external providers.

The next fulfilment boundary must separately define method and address policy, handoff/completion evidence, responsible actors, reversals/disputes, and any payment/settlement interaction before implementation.

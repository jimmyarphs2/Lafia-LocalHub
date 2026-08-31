# LocalHub protected order snapshot slice

**Frozen:** 2026-08-30
**Authority:** Historical contract for the completed order snapshot slice; current status and next action are in `LOCALHUB_BUILD_STATUS.md`.

## Objective

Let a guest commit to one explicitly orderable live listing, authenticate only at commitment, resume the exact purchase, and explicitly place one server-authoritative order. The database must atomically create one `placed` order, one immutable item/amount snapshot, and one initial `placed` event. Customer and accepted members of the exact vendor business then read bounded projections of that same order.

## Included behavior

- Add a deny-by-default normalized `listings.is_orderable` flag. Price presence alone never makes a listing orderable, and this migration activates no existing listing.
- Support one base listing and a bounded quantity of 1–100. The server derives listing, business, market, title, price, currency, and totals; browser-supplied commerce truth is ignored.
- Use a separate 15-minute `listing_order` guest capability. Its secret remains in an HttpOnly, SameSite cookie; only the opaque intent UUID may enter a URL.
- Re-read and lock the active profile, claimed intent, live listing, active business/market/category, and the server-created quote at placement. A changed or unavailable quote creates nothing.
- Serialize retries on the intent row. A same-owner replay returns the existing order independently of the new-placement budget while a separate high-capacity replay budget bounds direct RPC lock abuse; a foreign, malformed, expired, or conflicting capability fails closed.
- Create `status = 'placed'`, set `placed_at`, snapshot the vendor name and canonical listing route, compute `subtotal_minor = total_minor = unit_price_minor × quantity`, and append one `placed` event in one transaction.
- Expose strict customer market list/detail and vendor exact-membership list/detail projections. Vendor projections contain no customer identity or contact data.
- Preserve Realtime-compatible authenticated `SELECT` with active-profile-aware RLS while revoking direct order/item/event mutation from application and service roles.
- Bound intent, placement, and replay attempts through isolated fixed-window limiter scopes, and expose bounded service-only cleanup for stale order intents and limiter rows.
- Provide mobile-first confirmation, receipt/tracking, customer history, and read-only vendor inbox/detail surfaces with truthful `Placed — awaiting vendor confirmation` and `No payment has been collected` language.

## Data and security boundary

- Source of truth: authoritative PostgreSQL listing/order rows and RPC authorization.
- Client input: canonical route context and quantity only before intent creation; final placement submits only the intent UUID.
- Persistence: one order, one item, one status event, one minimized audit event, the capability row, and bounded rate-limit state.
- Anonymous users may create only the opaque server-derived intent. Only an authenticated active claimant may place or read the order.
- Accepted vendor membership is checked against the order's exact business on every vendor read. Revocation or profile suspension removes access immediately.
- Order identity, buyer/business/market, quote, totals, placed time, item snapshot, and initial event are immutable in this slice.

## Explicit exclusions

- Fulfilment boundaries after vendor confirmation, or any other order-state mutation beyond the protected vendor transition.
- Payment initialization, Paystack, payment rows/events, fees, ledger entries, earnings, refunds, settlements, or payouts.
- Fulfilment choice or transitions, delivery execution, addresses, inventory reservation, variants, carts, discounts, tax, or notification delivery.
- Listing submission/moderation/publication controls or activation of production data.
- AI/OpenAI calls, admin command-center work, deployment, provider activation, or production claims.

## Synthetic verification fixtures

Rollback-only fixtures will create one active market/category/business/member/customer and one active published orderable listing, plus inactive, unpublished, unpriced, non-orderable, foreign-business, and suspended-actor variants. All identifiers are synthetic and all fixture rows roll back.

## Required success evidence

- Adversarial application tests execute intent/auth/action/parser/component behavior, including cookie attributes, exact resume, GET no-mutation, demo and non-orderable rejection, strict cardinality, error states, pending accessibility, and no secret/PII disclosure.
- Migration contract tests cover locks, grants, constraints, rate bounds, cleanup, RLS, immutable snapshots, and excluded writes.
- A live rollback probe proves atomic creation, exact totals, one event/audit, replay idempotency, quote-change rejection, cross-user/business isolation, revoked direct DML, and zero payment/fulfilment/notification/ledger residue.
- Generated Supabase types, schema/grants/RLS inventory, advisors, full quality checks, demo build, and explicit live-mode build all pass after reviewed application.

## Rollback

Before live application, exercise the migration inside a rollback-only transaction where supported. The permanent migration is forward-only; emergency rollback requires disabling the new application routes/RPC grants first, then a reviewed compensating migration. No existing listing becomes orderable automatically, so the feature remains dormant without deliberate catalog configuration.

## Completion and next governed slice

The protected vendor order-state transition contract (`placed -> confirmed|cancelled`) is now implemented and live as migration `20260830171813 localhub_order_vendor_transitions`, with exact active-business authorization, actor-first limiting, UUIDv4 idempotency, deterministic locks, immutable snapshots, exact terminal event/audit evidence, synchronized customer/vendor reads, and zero-residue post-apply rollback evidence. A low, nonblocking genuine two-session contention operational-test residual remains; structural concurrency review passed. The next governed slice is the first protected fulfilment boundary after `confirmed`. Payment remains a separate later architecture boundary.

# LocalHub protected vendor order transition slice

**Frozen:** 2026-08-30
**Authority:** `LOCALHUB_BUILD_STATUS.md`, the protected order snapshot contract, and the consolidated Master Autonomous Production Build Directive

## Objective

Let an authenticated active member of the exact vendor business make one authoritative availability decision on a protected listing order: `placed -> confirmed` or `placed -> cancelled`. The decision must be concurrency-safe, idempotent, audited, visible from both customer and vendor read projections, and incapable of starting payment, fulfilment, inventory, notification, or ledger work.

## Included behavior

- Add one vendor detail-page decision control for a `placed` listing order. The available commands are `confirm` and `cancel`; list pages remain navigation and status surfaces rather than mutation surfaces.
- Treat the Server Action and RPC as untrusted POST entry points. Validate exact singleton form values, a UUID order identifier, a UUIDv4 idempotency key, authentication, active profile, active business, and accepted exact-business membership on every attempt and replay.
- Permit the existing vendor roles `owner`, `manager`, and `staff` to decide availability. Pending, rejected, revoked, foreign-business, suspended-profile, and inactive-business actors fail without disclosing order state.
- Rate-limit the authenticated actor before looking up an attacker-selected order. Serialize same-actor/key attempts, lock the order in a fixed order, and permit exactly one terminal decision from `placed`.
- Bind an idempotency key to one actor, one order, and one decision. The exact same authorized request may replay its authoritative result; key reuse for another order or decision fails. A new key for the same terminal decision reports an already-transitioned result, while the opposite decision reports a conflict.
- Set one canonical vendor-decision timestamp, update only `orders.status`, `orders.vendor_decided_at`, and the normal `updated_at`, then append exactly one matching terminal status event and one minimized audit event in the same transaction.
- Preserve the immutable order identity, claimant, business, market, order number, placed time, listing route/vendor snapshots, amount fields, item snapshot, and original `placed` event. Preserve the guest-intent binding while its capability is retained; the existing scheduled retention cleanup is the sole permitted maintenance path that may clear that foreign key without changing the order timestamp.
- Update the protected order shape and mutation guard narrowly enough to allow only the gated `placed -> confirmed|cancelled` change and its matching second event. Direct table mutation remains revoked and rejected.
- Keep placement replay valid after a legitimate terminal decision while the consumed capability remains inside the existing 30-day retention window. A consumed listing-order intent may replay only when its order has either one exact `placed` event or an exact two-event `placed -> confirmed|cancelled` chain matching the current row and decision timestamp; all other histories fail closed. Scheduled capability cleanup intentionally retires later replay without changing the order's authoritative update timestamp.
- Return a bounded transition projection containing only the order ID, terminal status, vendor-decision timestamp, update timestamp, outcome, and retryability. No buyer identity, contact data, capability secret, membership data, or internal rate/audit state may leave the RPC.
- Revalidate the vendor list/detail and customer market list/detail route families only after a fully parsed authoritative success or replay. Both sides continue reading the same canonical order row; no separate synchronized state is introduced.
- Show accurate copy: confirmation records vendor availability but does not collect money or start fulfilment; cancellation occurs before payment and therefore creates no refund.

## State and outcome contract

- Allowed input decision/status pairs are `confirm -> confirmed` and `cancel -> cancelled`.
- Allowed pre-state is exactly `placed` with no vendor-decision timestamp and exactly one matching `placed` event.
- Allowed post-state is exactly `confirmed` or `cancelled` with one vendor-decision timestamp and exactly two ordered events: the original `placed` event followed by the matching terminal event.
- Successful outcomes are `transitioned` and exact authorized `replayed`.
- Safe terminal outcomes are `already_transitioned`, `conflict`, `not_found`, `invalid`, and `idempotency_key_reused`; rate limiting is retryable. Unexpected database/network/parser failures are retryable application errors and never fabricated as success.
- A malformed, partial, plural, status/decision-mismatched, timestamp-mismatched, or unknown RPC row is rejected by the application contract.

## Data and security boundary

- Source of truth: the locked PostgreSQL order row, exact event history, current profile/business/membership authority, private idempotency ledger, and minimized audit trail.
- Client input: order UUID, `confirm|cancel`, and UUIDv4 idempotency key only. Route, business, customer, prices, timestamps, current status, and audit identity are never trusted from the browser.
- Persistence: one nullable `vendor_decided_at` column on the existing order, at most one private transition-ledger row per order, bounded private actor rate state, one terminal event, and one minimized transition audit record.
- Customer reads remain owner-only. Vendor reads and mutations remain active-profile and accepted exact-business-member only. Transition authorization additionally requires the business itself to be active.
- Application roles receive no direct mutation grant on orders, items, events, transition ledgers, rate rows, or audits. Private tables retain RLS with no application-table grants. Privileged operations stay inside fixed-search-path security-definer functions.
- Lock order and advisory keys are deterministic. Competing confirm/cancel attempts cannot both commit, and replay verification happens under current authorization.

## Explicit exclusions

- `confirmed -> fulfilled`, any delivery/pickup workflow, fulfilment records/events, addresses, tracking, proof of delivery, inventory reservation, or stock mutation.
- Payment initialization, Paystack, payment rows/events, fees, ledgers, earnings, refunds, settlements, payouts, or any assertion that money moved.
- Customer cancellation, vendor reversal, reopening a cancelled/confirmed order, admin overrides, disputes, returns, or refund transitions.
- Email/SMS/push/in-app notification delivery, Realtime subscriptions, analytics events, or external provider calls.
- Listing moderation/activation, cart/variant/discount/tax work, AI/OpenAI implementation, deployment, or production-readiness claims beyond this slice.

## Synthetic verification fixtures

Rollback-only fixtures will create synthetic active customer/vendor profiles, one active business with owner/manager/staff and non-member variants, one protected `placed` order with its immutable item and event, and inactive/suspended/revoked/foreign-business variants. Separate fixtures exercise confirmation and cancellation. All rows, including private ledger, rate, audit, event, and order mutations, roll back.

## Required success evidence

- Adversarial application tests execute strict parser/RPC/action/control behavior: malformed and plural rows, UUIDv4 enforcement, duplicate form fields, unauthenticated and RPC failures, same-key retry, safe terminal outcomes, canonical path revalidation, pending accessibility, and no PII/secret disclosure.
- Migration contract tests cover allowed state pairs, exact event cardinality/order, immutable columns, current authorization on replay, actor-first rate limiting, deterministic locks, private grants/RLS, cleanup bounds, audit minimization, and absence of excluded writes.
- A live rollback probe proves owner/manager/staff success, same-key replay, key reuse rejection, same/opposite-decision terminal behavior, revoked/suspended/foreign/inactive denial, direct-DML rejection, exact row/event/audit timestamps, placement replay after each terminal outcome within retained capabilities, cleanup without order-timestamp drift, and zero payment/fulfilment/notification/ledger residue. Deterministic lock-order and cardinality proofs cover competing decisions; a genuine two-connection execution remains separately identified wherever the available environment cannot provide safe disposable concurrent fixtures.
- Generated Supabase types, table/function/grant/RLS inventories, advisors, focused tests, full tests, typecheck, lint, format check, demo build, and explicit live-mode build pass after reviewed application.
- Independent application, database, and security reviews report no unresolved critical finding before the migration is applied permanently.

## Rollback

Exercise the migration and behavioral probe in rollback-only transactions before permanent application. The live migration is forward-only; emergency recovery requires disabling the new control/RPC grant first, then a reviewed compensating migration that preserves any committed terminal decisions and audit evidence. Never delete or rewrite committed order history to simulate rollback.

## Next unapproved slice

Define the first protected fulfilment boundary after vendor confirmation, including its authoritative state model, authorization, idempotency, audit, and customer/vendor synchronization. Payment remains a later, separately governed architecture boundary and requires the prescribed escalated review.

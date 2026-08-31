# LocalHub notification producer contract

**Status:** Hosted-verified for Master Step 26, Slice 26B; migration 036 live
**Project:** LocalHub (`exftgbfhmneweilsebjw`)
**Scope:** Transactional in-app producers only

## Purpose

Slice 26B may populate the migration-035 in-app inbox from already approved request, order, and fulfilment state changes. Every notification is derived inside PostgreSQL in the same transaction as its source change. The client cannot choose a recipient, source identity, template, title, body, market, or action path.

This slice does not activate `private.notification_deliveries`, create a provider writer or worker, store a destination, send email/SMS/push/voice/WhatsApp, introduce preferences or consent, or change payment, referral, ledger, demand, publication, inventory, or AI behavior.

## Event matrix

| Source change                             | Eligible recipient                                                                   | Source identity                             | Template                    | Action path                       |
| ----------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------- | --------------------------- | --------------------------------- |
| Linked listing request inserted as `open` | Each non-suspended, accepted owner/manager/staff member of the exact active business | `listing_request`, request ID               | `vendor_request_created`    | `/vendor/requests`                |
| Listing request `open -> accepted`        | Non-suspended requester                                                              | `listing_request`, request ID               | `customer_request_accepted` | `/{market}/requests/{request_id}` |
| Listing request `open -> declined`        | Non-suspended requester                                                              | `listing_request`, request ID               | `customer_request_declined` | `/{market}/requests/{request_id}` |
| Listing order inserted as `placed`        | Each non-suspended, accepted owner/manager/staff member of the exact active business | `listing_order`, order UUID                 | `vendor_order_placed`       | `/vendor/orders/{order_number}`   |
| Listing order `placed -> confirmed`       | Non-suspended buyer                                                                  | `listing_order`, order UUID                 | `customer_order_confirmed`  | `/{market}/orders/{order_number}` |
| Listing order `placed -> cancelled`       | Non-suspended buyer                                                                  | `listing_order`, order UUID                 | `customer_order_cancelled`  | `/{market}/orders/{order_number}` |
| Processing fulfilment aggregate inserted  | Non-suspended buyer of the exact confirmed order                                     | `listing_order_fulfilment`, fulfilment UUID | `customer_order_processing` | `/{market}/orders/{order_number}` |

Every event additionally requires the source market and business, where applicable, to remain active and exactly linked. Vendor fan-out is ordered by `profile_id` and includes only accepted owner/manager/staff memberships whose profiles are not suspended. Customer delivery requires the exact requester/buyer profile to remain non-suspended. Recipient selection never depends on `profiles.default_market_id`. No legacy/unlinked request, draft/non-listing order, unrelated update, replay without a source write, or malformed state change emits a notification.

## Fixed copy

Copy is version-1 server-owned text and contains no customer text, contact data, address, amount, business name, listing title, or provider content.

| Template                    | Title                      | Body                                                                             |
| --------------------------- | -------------------------- | -------------------------------------------------------------------------------- |
| `vendor_request_created`    | `New customer request`     | `A customer sent a request for one of your listings.`                            |
| `customer_request_accepted` | `Request accepted`         | `The vendor accepted your request. Open it to review the latest status.`         |
| `customer_request_declined` | `Request declined`         | `The vendor declined your request. Open it to review the latest status.`         |
| `vendor_order_placed`       | `New order`                | `A customer placed a new order. Open it to review the details.`                  |
| `customer_order_confirmed`  | `Order confirmed`          | `The vendor confirmed your order. Open it to review the latest status.`          |
| `customer_order_cancelled`  | `Order cancelled`          | `The vendor cancelled your order. Open it to review the latest status.`          |
| `customer_order_processing` | `Order processing started` | `The vendor started processing your order. Open it to review the latest status.` |

Changing copy, routes, source kinds, or template version requires a later migration and contract update; it is not runtime configuration in this slice.

## Transaction and idempotency rules

1. Producers do **not** attach to source tables. Migration 036 moves the five already-approved public write boundaries behind uniquely named private source-boundary functions and recreates the same public names, arguments, return columns, authentication behavior, and authenticated-only grants as thin notification wrappers.
2. A public wrapper calls its private source boundary first and invokes the fixed enqueue helper only for the first-success outcome: request/order `created`, request/order `transitioned`, or fulfilment `started`. `replayed`, `already_transitioned`, `already_started`, invalid, unauthorized, rate-limited, conflicting, and unavailable outcomes never invoke the helper.
3. Enqueue runs after the protected source boundary has written and verified every source aggregate, event, audit, and idempotency record. It remains inside the same transaction. A producer error therefore rolls back the source change and all of its evidence.
4. The private helper re-reads the authoritative source and verifies its complete admissible state before deriving recipients, market, fixed copy, and canonical action path. The wrappers pass only a private fixed event key and the durable source UUID; clients cannot call either layer directly.
5. `notifications(profile_id, source_kind, source_id, template_key, template_version)` remains the database idempotency boundary. Producers use `ON CONFLICT (profile_id, source_kind, source_id, template_key, template_version) DO NOTHING` only against that exact key.
6. A legitimate event creates at most one notification per eligible recipient/template. Multiple accepted business members deliberately receive separate rows.
7. A source transition with no eligible active recipient succeeds with zero notifications. Notification absence must not reactivate or broaden a suspended profile or stale membership.
8. Replays create no notification. No source-table trigger exists, so owner/service-role maintenance writes cannot accidentally become producer events.
9. Migration 036 performs no historical backfill. It takes explicit source and notification locks before checking emptiness and refuses to apply if requests, orders, fulfilments, notifications, or deliveries contain any row.

## Security boundary

- One private fixed-template enqueue helper owns the copy and constructs every market route from the authoritative market slug.
- Five private source-boundary functions retain the already-approved source implementations. They are PostgreSQL-owned, `SECURITY DEFINER`, use an empty `search_path`, and expose no EXECUTE grant to `PUBLIC`, `anon`, `authenticated`, or `service_role`.
- The private enqueue helper has the same owner/search-path/ACL posture. The five public thin wrappers are PostgreSQL-owned, `SECURITY DEFINER`, use an empty `search_path`, and grant EXECUTE only to `authenticated`.
- Existing application roles retain no direct notification INSERT/UPDATE/DELETE/TRUNCATE grant. The migration adds no source-table DML grant.
- Migration 036 removes the dormant foundation-era direct request INSERT/DELETE/TRUNCATE privileges from `service_role`; protected request creation and cleanup remain RPC-only.
- The public inbox still exposes only the sanitized projection from migration 035. `source_kind` and `source_id` remain hidden from application SELECT privileges.
- `private.notification_deliveries` remains zero-row, policy-free, ACL-free, outside Realtime, and protected by its always-enabled row/truncate blockers.

## Retention, revocation, and Realtime

- Membership removal or business suspension stops future vendor fan-out. It does not rewrite an already-issued, generic, PII-free inbox row for that profile; every action route reauthorizes the destination independently.
- Profile suspension immediately hides existing rows through the active-self RLS predicate and prevents future delivery.
- Market and business activity are checked from the source relationship, never from a recipient preference. Notification `source_kind`/`source_id` are correlation metadata, not foreign-key authorization and never grant source access.
- Request and order action destinations use their canonical public identifiers: request UUID for the existing request route and `LO-*` `order_number` for every customer/vendor order route. The hidden notification source identity remains the source UUID.
- `notifications.profile_id` becomes nullable with `ON DELETE SET NULL`, while every producer insert still requires a non-null recipient. The always-enabled immutability trigger permits only the foreign-key maintenance transition from a non-null recipient to `NULL` with every other column, including `read_at`, unchanged. It rejects null inserts, reattachment, and every mutation of an orphan.
- Profile deletion therefore retains an inaccessible, recipient-free orphan instead of producing an unfilterable Realtime DELETE. The active-self RLS policy, direct ACLs, and both inbox RPCs exclude orphan rows. Future retention or external-delivery activation must handle orphans explicitly; Slice 26B does not delete them or populate the delivery ledger.

## Required verification

- Exact event matrix, fixed copy, action paths, source IDs, and one-row cardinality.
- Two eligible vendor members receive two rows; invited, suspended, foreign-business, and stale-market profiles receive none.
- Customer and vendor recipients cannot see each other's rows under RLS.
- Same-event replay does not duplicate; different terminal templates cannot coexist for the one-way source state machine.
- Legacy requests, draft/non-listing orders, unrelated updates, invalid transitions, and direct application notification DML emit nothing or fail closed as appropriate.
- Direct owner/service-role source writes do not emit because no notification producer trigger exists.
- Forced producer failure rolls back the source transaction with zero partial notification/source residue.
- Private delivery row count remains zero and all external-delivery mutation attempts still fail.
- Realtime INSERT/UPDATE owner/foreign/suspended isolation and profile-deletion `SET NULL` behavior are tested with separate authenticated sessions when legitimate hosted test identities are available. Neither the former owner nor a foreign subscriber may receive the orphaning update.
- Full TypeScript, lint, formatting, unit/contract tests, demo build, and explicit live-mode build pass after hosted application.

# LocalHub architecture

**Last updated:** 2026-08-31

## System shape

```text
Guest/customer/vendor/admin routes
        -> Next.js application boundaries
        -> Supabase Auth + PostgreSQL/RLS + Storage/Realtime
        -> domain workflows (search, intent, onboarding, ALE, media, orders)
        -> controlled, scoped operations and audit
```

LocalHub is the permanent platform identity. Lafia is the first configured market, not a renamed product. Market, area, coordinates, radius, availability, content, and operating rules are modeled for future markets.

## Verified backend

The authoritative Supabase project is `exftgbfhmneweilsebjw` in `eu-west-1`. Thirty-seven migrations are live, newest `20260831133056 localhub_unmet_demand_capture`. There are 51 public plus 25 private tables; all 76 have RLS enabled. Migration 033 quarantines six empty legacy search/demand/mission tables. Migration 034 adds only two empty private demand-gap/referral-mission definition tables with forced RLS, zero policies/effective application privileges, and no public writer. Migration 035 adds the sanitized public inbox/read boundary and a mutation-blocked private zero-row delivery ledger. Migration 036 moves the five approved commerce write functions behind private source boundaries and recreates identical public signatures as fixed-template, first-success notification wrappers. Migration 037 adds one private zero-row market/category/day evidence relation and one authenticated-only, fixed-input, non-oracular zero-supply writer. Public types contain 51 tables/78 functions and exclude all 25 private tables; private function inventory is 44.

Production markets, categories, businesses, listings, explicitly orderable listings, requests, guest intents, orders, order children, fulfilments, payments, inventory, notifications, and ledger rows remain zero by design. Root location uniqueness is null-safe, and database constraints enforce the same safe single-segment slug grammar used by public routes. Security and correctness controls include strict terminal payloads, idempotent retry order, a shared market lock plus business write-stability lock, canonical category/contact/whitespace validation, bounded multilingual admin reasons with default-ignorable Unicode rejection, and separate three-hour database and two-hour signed-token reservation deadlines. The authenticated draft-only vendor listing workspace verifies exact ALE 1.1 schema rendering/validation, RPC-only idempotent create/edit, optimistic revision/conflict handling, safe autosave/navigation with a reused history sentinel, persisted draft-only media selection, actor/key advisory serialization, bounded abuse limits, and taxonomy locks. Draft, listing-request, vendor-response, listing-order, and fulfilment-processing cleanup use bounded `SKIP LOCKED` retention through service-role-only public cleanup RPCs scheduled daily. The 12-table market-integrity trigger now dispatches before table-specific row-field binding and passed a complete live rollback invariant matrix.

## Product flows

Guests browse, search, inspect details, use Ask LocalHub, and authenticate only when identity is required. Guest intent and interrupted work resume after authentication. Vendors use profile capabilities, guided resumable onboarding, category intelligence, and ALE-driven schemas. Email, Google, Facebook, profile/capability, onboarding, deterministic category/ALE, and media source workflows exist; hosted provider journeys are not yet verified.

Production market/category/search/vendor/listing pages and the sitemap use a server-only anonymous Supabase adapter, explicit publication filters, defensive mapping, and collision-safe route identities. An empty or unavailable live catalog never falls back to demo data. Deterministic guest/demo browse/search/detail data remains source-only and is not legitimate production marketplace data.

Operational demand capture is category-level and privacy-minimized. Only a complete live catalog with one deterministically recognized category and zero public supply offers an explicit query-free/no-referrer review route. Authentication continuation is isolated from unrelated guest intents, GET never mutates, the confirmation Server Action repeats canonical/session/catalog checks, and the database revalidates current zero supply before inserting at most one market/category/local-day marker. It stores no query, actor, session, contact, provider, referral, mission, finance, or AI data and exposes no existence/count oracle.

For a live listing, a server-only service boundary creates an opaque guest intent from authoritative identifiers. Authentication claims the capability and resumes the exact canonical confirmation route without putting the secret in a URL. An explicit authenticated POST materializes one request per intent under a row lock; customer history/detail and the vendor member inbox expose only bounded projections under RLS-backed authorization. Active accepted vendor members can move an open request once to accepted or declined through an RPC-only, locked, idempotent, audited transition. A private fixed-window limiter bounds the public transition boundary to 120 calls per active actor/hour before attacker-selected request lookup, and a service-only bounded pruner removes limiter state after 48 hours; both sides still read the same canonical request row. Request processing never implicitly creates an order.

The dormant finance foundation is complete through B3. B3 adds only typed commerce-ledger accounts, journals, and inherent equal posting pairs with fixed purposes, exact provider/application source bindings, unique posting keys, positive JS-safe money, kind-bound debit/credit purposes, and exact one-time reversals. It adds no balance cache, JSON, seed, writer, command, route, provider, transaction, refund, payout, or reconciliation. Step 24 activation remains externally gated. Step 25's non-financial referral identity/link/disclosure boundary is live and deliberately records no attribution, credit, reward, commission, journal, payout, or payment. Step 27’s definition foundation remains dormant except for the separate minimal category/day evidence boundary; assignment, progress, attribution, reward, finance, provider, and AI state remain absent.

Master Step 26 notifications is complete through Slice 26B. Read state is separated from provider delivery state; active-profile RLS and server-owned mark-read are enforced; copy/template/action paths are bounded; source/template identity is unique per recipient; fixed-template producers are atomic with approved request/order/fulfilment transitions; and the private delivery ledger remains mutation-blocked and unsendable. Master Step 27’s minimal operational demand recorder is complete and hosted-verified. The current autonomous boundary is Master Step 28: a provider-neutral controlled Tool Gateway with typed schemas, authorization scopes, approval classes, redaction, auditability, and fail-closed errors, but no AI invocation or external side effect.

## AI and security boundaries

AI is **NOT STARTED**; the application makes no OpenAI request. `OPENAI_MODEL` remains environment-configurable and the explicit report-before-AI gate is active. Secrets stay server-side. No service-role runtime secret is configured. RLS, internal RPC authorization, storage policies, trusted ingress/HMAC, and controlled tool operations must remain least-privilege and auditable.

## Related documents

- [Build status](LOCALHUB_BUILD_STATUS.md)
- [Operations](LOCALHUB_OPERATIONS.md)
- [External setup](LOCALHUB_EXTERNAL_SETUP.md)
- [Launch checklist](LOCALHUB_LAUNCH_CHECKLIST.md)

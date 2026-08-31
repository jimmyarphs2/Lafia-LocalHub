# LocalHub launch checklist

**Last updated:** 2026-08-31
Unchecked items are not verified.

## Customer

- [ ] Guest browse/search/detail uses legitimate live vendor/listing data. The authoritative RLS-backed source path is verified, but the live project is intentionally empty and demo data is not production data.
- [ ] Auth occurs at the commitment point and exact intent/order/request state resumes.
- [ ] Hosted email, Google, and Facebook journeys pass end to end.
- [ ] Customer request/order creation, confirmation, tracking, and vendor fulfilment pass.
- [x] The protected listing-request source/live-database boundary passes: exact guest-intent resumption, explicit confirmation, idempotent persistence, customer history/detail, cross-actor RLS, and synchronized vendor accept/decline processing. Hosted E2E remains unchecked.
- [x] The protected order source/live-database boundary passes: deny-by-default orderability, exact guest-intent resumption, server-authoritative quote revalidation, atomic idempotent `placed` order/item/event/audit creation, customer/vendor read-only tracking, cross-actor RLS, exact cardinality, limiter/cleanup controls, zero excluded-workflow residue, and protected vendor `placed -> confirmed | cancelled` transition with exact active-business authorization, UUIDv4 idempotency, deterministic locks, immutable snapshots, exact terminal event/audit, synchronized reads, and no buyer leakage. No live listing is orderable; hosted E2E remains unchecked.

## Vendor and marketplace

- [x] Guided resumable onboarding, canonical validation, category intelligence, and media reservation source/live controls are verified.
- [x] Deterministic ALE schemas and category-specific workflows are verified; ALE test passes.
- [x] Authenticated draft-only vendor listing workspace is verified: ALE 1.1 rendering/validation, RPC-only idempotent create/edit, optimistic conflicts, safe autosave/navigation, and persisted draft-only media selection.
- [ ] Live merchant/category/market data, publishing, requests, and fulfilment are verified.
- [x] Accepted active vendor members have a bounded request inbox and can securely accept/decline for follow-up; replay, revocation, audit, and synchronized customer status are verified.
- [ ] Search operates against legitimate live data and the bounded unmet-demand confirmation passes hosted user/catalog E2E.
- [x] The privacy-bounded zero-supply recorder is hosted-verified: complete-catalog suppression, query-free/no-referrer continuation, explicit authenticated confirmation, current database zero-supply revalidation, one market/category/day marker, no actor/query/provider/finance/AI data, non-oracular replay, and forced-RLS/ACL isolation.

## Backend and security

- [x] Thirty-seven live migrations, 51 public plus 25 private tables, all 76 RLS-enabled. Step 23 A/B1/B2/B3, Step 25 referral identity/link, legacy search/demand/mission quarantine, Master Step 27 definitions/minimal recorder, and Step 26A/26B in-app notification foundations/producers are hosted-verified; private domains remain forced-RLS, application-inaccessible, and excluded from public types.
- [x] Anonymous/authenticated ACL matrix and internal RPC authorization are verified.
- [x] Security/performance advisor findings are reviewed: expected service-only INFOs, authenticated internally authorized `SECURITY DEFINER` WARNs, and empty-database unused-index INFOs only.
- [ ] Service-role runtime secret, trusted ingress/HMAC, cleanup scheduler/secret, and hosted runtime are configured and verified.

## Finance, operations, and deployment

- [ ] Payments, typed ledger operations, refunds, payouts, reconciliation, referrals, and policy are Founder-approved and verified. Slice A finance quarantine is live, but it activates none of these capabilities.
- [ ] Admin operations, monitoring, rollback, domain/deployment, and hosted E2E smoke are verified.
- [x] Fresh post-migration-037 quality passes: TypeScript, lint, formatting, 106 files/628 tests, demo/live builds 68/23 generated static pages, 43 app route patterns, audit zero, and diff check PASS. Migration 037 independent Sol security/React/TypeScript follow-ups have no P0/P1 implementation finding.

## AI gate

- [ ] Explicit pre-AI Founder checkpoint released.
- [ ] Only after release: implement the AI abstraction with deterministic fallback. AI is currently **NOT STARTED** and the application makes no OpenAI request.

## Next action

Step 23 is hosted-verified through dormant B3. Step 24 Paystack activation remains externally blocked and must not be bypassed. Step 25's non-financial referral identity/link/disclosure is hosted-verified and records no attribution or economics. Master Step 26 in-app notifications is hosted-verified through fixed, atomically idempotent Slice 26B producers while every external channel remains disabled. Master Step 27’s minimal operational demand recorder is hosted-verified without missions, referral attribution/economics, provider actions, or AI. Next implement only Step 28’s controlled, provider-neutral Tool Gateway boundary. External launch dependencies and the pre-AI checkpoint remain required.

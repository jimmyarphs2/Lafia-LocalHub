# LocalHub operations

**Last updated:** 2026-08-31

## Verified operating baseline

The live Supabase project is LocalHub (`exftgbfhmneweilsebjw`, `eu-west-1`). Thirty-seven migrations are live, newest `20260831133056 localhub_unmet_demand_capture`. It has 51 public plus 25 private tables; all 76 are RLS-enabled. The six legacy search/demand/mission tables and two private definition tables remain isolated. Public notifications force active-self RLS and remain empty because production sources are empty; five approved commerce boundaries now enqueue fixed in-app rows transactionally. The private empty delivery ledger has no policies/application privileges, is absent from Realtime, and has always-enabled mutation blockers. The private zero-row unmet-demand marker is also policy-free/application-inaccessible; only the authenticated fixed writer can create one category/day marker after revalidating current zero supply.

The current advisor snapshot shows 49 expected INFO [RLS-no-policy notices](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy), one reviewed anonymous-definer WARN, 38 reviewed authenticated [`SECURITY DEFINER` RPC WARNs](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable), 59 unused-index INFOs, four unindexed-foreign-key watches, and one expected multiple-permissive-policy WARN. No errors.

## Local development and quality

Keep `.env.local` ignored and never log or commit secrets. `OPENAI_MODEL` is environment-configurable; AI is not started and the application makes no OpenAI request.

```bash
npm.cmd run typecheck
npm.cmd run lint
npm.cmd test
npm.cmd run build
```

The fresh post-migration-037 checkpoint passes: TypeScript, lint, formatting, 106 files/628 tests, demo/live builds 68/23 generated static pages, 43 app route patterns, fresh audit zero, and diff check PASS. Migration 037 rehearsal, permanent apply, complete post-apply probe, exact zero-residue/RLS/ACL checks, and independent Sol security/React/TypeScript follow-ups pass with no P0/P1 implementation finding.

## Data and incident rules

Source guest/demo browse, search, and detail data is fictional and must never be called legitimate production marketplace data. Do not imply real ratings, stock, demand, popularity, or sales. Redact secrets and sensitive data from logs; preserve audit records for privileged actions. Escalate legal, financial, privacy, security, deployment, and provider decisions.

An approved daily service-role cleanup job must invoke `prune_listing_draft_internal_state`, `prune_listing_request_intents`, `prune_listing_request_vendor_responses`, `prune_listing_request_vendor_response_rate_limits`, `prune_listing_order_intents`, `prune_listing_order_vendor_transitions`, and `prune_listing_order_fulfilment_processing` in bounded batches until each returns no more work. Unconsumed listing-order intents retain 24 hours after expiry; consumed order intents, vendor-transition replay rows, and fulfilment-processing replay rows retain 30 days. Order intent/place/replay, vendor-transition, and fulfilment-processing limiter rows retain 48 hours. Vendor-response replay rows retain 30 days; response rate-limit rows retain 48 hours. Keep the scheduler secret server-side, use trusted ingress/HMAC where applicable, record only minimized operational metadata, and alert on repeated cleanup failure.

## Readiness and continuity

Hosted Auth/runtime E2E remains unchecked. Step 23 is complete/live and dormant through B3. Step 24 Paystack activation remains externally blocked by decisions, credentials, verifier/privacy/retention, typed atomic commands/ACL, concurrency, provider E2E, monitoring, and kill switch. Step 25 referral identity/link/disclosure is complete/live. Master Step 26 in-app notifications is complete/live through Slice 26B; every external channel remains disabled. Master Step 27’s minimal category/day demand recorder is complete/live; genuine two-session replay, ingress rate control, and legitimate hosted E2E remain activation checks. Continue with Step 28’s controlled, provider-neutral, non-AI Tool Gateway only. Do not send externally, capture referral attribution, activate missions, credit, rewards, commissions, money posting, expose provider/service-role credentials, or invoke AI.

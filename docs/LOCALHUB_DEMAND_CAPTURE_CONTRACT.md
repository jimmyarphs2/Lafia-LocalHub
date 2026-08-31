# LocalHub operational unmet-demand capture contract

**Status:** Step 27 boundary hosted-verified as migration 037; rollback rehearsal, post-apply probe, generated types, full quality/build gates, and independent Sol security/React/TypeScript follow-ups pass. Legitimate hosted user/catalog E2E, ingress rate control, and genuine two-session replay remain production-activation checks.
**Authority:** The Master Autonomous Production Build Directive requires legitimate live search and recorded unmet demand. This document chooses the smallest implementation that satisfies that approved requirement without activating missions, referral attribution, rewards, finance, external delivery, or AI.
**Authoritative backend:** Supabase project `exftgbfhmneweilsebjw` only

## 1. Fixed product meaning

An operational demand record means only:

> An authenticated LocalHub credential invoked the fixed writer, and the database observed no legitimate, publicly discoverable supply for one active category in one active market on one market-local calendar day.

That is the complete durable claim. The first-party UI additionally requires a deterministic search miss, an explicit review page, and an explicit POST, but the public RPC cannot prove personhood, prior page viewing, or use of that UI. The evidence must never be presented as proving those facts.

It is a **private, low-trust binary daily marker**. It is not a person count, search count, conversion metric, market-size estimate, mission trigger, merchant recruitment instruction, endorsement, promise of fulfilment, or financial signal.

The v1 boundary deliberately undercounts. Replays and confirmations from different people on the same market/category/day all produce the same generic success result and at most one row.

## 2. Eligibility boundary

The application may offer confirmation only when all conditions are true:

1. The selected catalog is the live Supabase source and its state is `ready`.
2. The bounded public catalog snapshot did not reach any catalog cap used to derive the result. A cap hit is treated as incomplete, never as proof of no supply.
3. The normalized query is non-empty.
4. Deterministic search returned zero matches.
5. Exactly one active category UUID was recognized from the live catalog.
6. The loaded catalog contains no publicly discoverable listing in that category.
7. The person explicitly chooses the record action, authenticates if required, reviews the category-level explanation, and submits a POST confirmation.

Demo data, unavailable/unpublished markets, unknown free text, no recognized category, multiple recognized categories, incomplete catalog snapshots, and filter-only misses are ineligible. They remain normal search misses and create no demand state.

The database independently revalidates the actor, market, category, and absence of publicly discoverable category supply. Client eligibility is user guidance, not authorization.

## 3. Data minimization and prohibited data

The only durable evidence relation is:

`private.unmet_demand_zero_result_days`

| Column                   | Contract                                                                        |
| ------------------------ | ------------------------------------------------------------------------------- |
| `market_id uuid`         | Active authoritative market; FK `public.markets(id) ON DELETE RESTRICT`         |
| `category_id uuid`       | Active global-or-market category; FK `public.categories(id) ON DELETE RESTRICT` |
| `observed_on date`       | Derived by PostgreSQL from the market timezone; never client supplied           |
| `created_at timestamptz` | First accepted database time for the daily marker; never client supplied        |

Primary key: `(market_id, category_id, observed_on)`.

The evidence row, RPC arguments/body, continuation URL, and demand-specific application log fields **must not contain or derive**:

- raw or normalized query text;
- arbitrary JSON or an open-ended payload;
- capability tags, budget, area, relative time, contact details, or free text;
- profile/user ID, email, phone, IP/device fingerprint, session identifier, guest-intent ID, or referral identity;
- provider data, AI input/output, attribution, mission, reward, commission, payment, ledger, payout, or KYC state;
- a client-selected timestamp, count, score, threshold, signal type, or demand key.

The authenticated session and `auth.uid()` may be used transiently only to authorize an active profile; neither may be persisted, returned, or copied into demand-specific logs. Existing browser search URLs may contain `q`; first-party demand navigation must use a full, non-prefetched `no-referrer` navigation so the confirmation/auth request receives neither that URL nor its query through `Referer`. The application cannot prevent a hostile client from forging an HTTP header, so the enforceable promise is that demand code does not persist, return, or log such a header.

## 4. Database and RPC contract

The only v1 writer is:

```text
public.record_my_unmet_demand_zero_result(
  p_market_slug text,
  p_category_id uuid
) returns boolean
```

Required behavior:

- `SECURITY DEFINER`, owner `postgres`, exact `search_path = ''`;
- executable only by `authenticated`; revoke `PUBLIC`, `anon`, and `service_role`;
- reject a missing profile or suspended actor before accepting evidence;
- resolve one active market by the validated canonical slug;
- resolve one active category whose `market_id` is null or equals that market;
- confirm there is no active, published listing for that category belonging to an active business in that market;
- validate the market timezone against PostgreSQL-recognized timezone names;
- derive `observed_on` from `statement_timestamp()` in that market timezone;
- materialize actor, market, category, timezone, and zero-supply eligibility and feed `INSERT ... ON CONFLICT DO NOTHING` from one SQL statement snapshot;
- return only `true` for a first write or replay while every current eligibility and zero-supply check still passes;
- expose no count, row, timestamp, prior-existence oracle, actor identity, or private identifier.

Malformed, unavailable, suspended, foreign-market, inactive, or supplied-category requests fail closed with the same application-level unavailable outcome. If supply appears after an earlier marker, a replay also fails with that generic outcome; it must not reveal whether the earlier marker exists.

No application role receives table or column DML. The private table is owned by `postgres`, forced-RLS, policy-free, excluded from generated public types, absent from Realtime, and has always-enabled guards against update, delete, or truncate. No public view or reader is created in this slice.

## 5. User and authentication flow

```text
live complete zero-supply search
  -> explicit full-navigation “Record this category gap” link
     (prefetch disabled by construction; referrerPolicy/rel = no-referrer)
  -> /[market]/demand/confirm?category=<uuid>
  -> unauthenticated users: /auth?next=<encoded confirmation path>
  -> authenticated confirmation page (GET never mutates)
  -> same-origin Server Action POST
  -> session-scoped Supabase client
  -> authenticated RPC with only market slug + category UUID
  -> generic recorded/unavailable redirect
```

The flow must not use `/auth/intent`, a guest-intent capability, or a `return_to` containing `q`. When `next` is the exact canonical demand-confirmation path, auth page/callback/resume code must not claim, consume, clear, or redirect from a pre-existing `GUEST_INTENT_COOKIE`; the unrelated cookie is preserved. Next.js Server Action CSRF enforcement is retained, and the action repeats schema, session, catalog, and canonical-context checks because it remains a direct POST entry point.

The confirmation copy must disclose that:

- only the market/category daily marker is retained;
- the query and account identity are not placed in the demand record;
- the marker does not guarantee a vendor response;
- submitting is explicit and optional.

## 6. Idempotency, abuse, concurrency, and truthfulness

- The primary key and `ON CONFLICT DO NOTHING` are the database mechanism that makes eligible retries, duplicate tabs, different users, and concurrent submissions atomically idempotent.
- The maximum durable write rate is one row per market/category/day, independent of request volume.
- One materialized eligibility CTE and its insert share a PostgreSQL statement snapshot. “At write time” means that exact insert-statement snapshot; a later catalog change does not rewrite history. A filter-only search miss cannot become a category supply-gap marker.
- The application suppresses the action whenever a catalog cap is reached; the database remains authoritative if a client bypasses that suppression.
- No record is automatically consumed by a mission, recommendation, notification, referral, or financial workflow.
- Because v1 stores no actor key, it intentionally has no per-person count or rate table. The global daily ceiling limits durable storage and downstream poisoning, **not RPC request volume**. Authenticated request flooding remains possible; ingress/database rate control and monitoring are a production-activation gate. Any future quantified demand, attribution, per-actor limiter, or automated action requires a new reviewed contract and Founder approval.

## 7. Retention and access

V1 creates no reader. Any future reader must expose aggregates only, apply a rolling 90-day logical window, document minimum cohort thresholds, and remain non-automating until separately approved.

Physical deletion is currently impossible through normal DML for application, service, and privileged cleanup callers because the always-enabled immutability guard rejects delete and truncate. A future reviewed migration must replace or narrowly condition that guard and install an exact cleanup routine before the already-known scheduler/secret can be activated. Until then, the table contains only non-attributed market/category/day markers and remains inaccessible to all application roles. No claim may be made that physical 90-day deletion is active.

## 8. Compatibility and quarantine invariants

Migration 037 must preserve migrations 033 and 034 exactly:

- `public.searches`, `public.search_intents`, `public.demand_signals`, `public.unmet_demand`, `public.missions`, and `public.mission_progress` stay empty, forced-RLS, policy-free, ACL-closed, and mutation-blocked;
- `private.demand_gap_definitions` and `private.referral_mission_definitions` stay empty, dormant, policy-free, ACL-closed, and mutation-blocked;
- no writer, reader, dependency, or FK is added to those eight relations;
- no mission, referral, reward, finance, provider, external delivery, or AI object is activated;
- only the new public RPC appears in generated TypeScript database types; the private table remains absent.

## 9. Verification gates

Code/tests must prove:

- eligibility accepts only live, ready, complete, one-category, zero-match, zero-category-supply input;
- candidate data contains only canonical market slug and category UUID;
- demo, unavailable, bounded, unknown, multi-category, filter-only miss, and positive-result cases do not offer capture;
- continuation/auth URLs contain no `q`, raw query, arbitrary payload, or guest-intent capability;
- confirmation GET never mutates; unauthenticated continuation is internal and sanitized;
- POST validates route/input/session/context and calls the RPC with exactly two fields;
- RPC output parsing accepts only literal `true` with no error;
- generic success/failure UI does not reveal row existence or private state.

Migration tests and the rollback-only hosted probe must prove:

- exact owner, forced RLS, zero policies, zero table/column privileges, and no Realtime publication;
- exact RPC owner/security/search-path/grants and only two fixed inputs;
- active profile/market/category checks and public-supply revalidation;
- the hosted rollback-only probe proves first write, same-user replay, and sequential cross-user replay leave one row and return the same result;
- genuine two-session concurrent eligible replay remains a separate production-activation verification gate for a disposable/local database; neither the single-session hosted probe nor source inspection may be described as concurrency runtime proof;
- activating publicly discoverable supply makes a later replay fail with the same generic outcome as any supplied-category request;
- an adversarial catalog-activation check and function-source inspection prove eligibility and insert share one materialized statement snapshot;
- anon and `service_role` cannot execute the RPC or directly access the table;
- update/delete/truncate guards remain effective;
- legacy quarantine and dormant definition blockers/ACLs are unchanged;
- rollback leaves zero fixture residue and never rewinds a shared sequence.

## 10. Deferred Founder decisions

The approved autonomous boundary ends at private low-trust recording. Founder approval is required before any of the following:

- quantified demand/person/search counts or raw-query retention;
- a public, vendor, admin, or ATLAS reader;
- low-supply thresholds, aggregation/cohort policy, or merchant recruitment;
- mission assignment/progress, referral attribution, incentives, rewards, or economics;
- automatic operational decisions, notifications, external delivery, or AI consumption;
- a new persistent actor/rate-limit identifier;
- a migration that enables physical cleanup, activation of its scheduler, or a change to the proposed 90-day logical window.

These deferrals do not block the narrow recording slice. Hosted Auth/runtime setup still blocks real guest-to-auth production E2E, but existing authenticated sessions can use the new session-scoped RPC without adding a service-role dependency to this writer.

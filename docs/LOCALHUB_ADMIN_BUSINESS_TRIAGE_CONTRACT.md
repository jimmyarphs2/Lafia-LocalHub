# LocalHub admin business triage contract

**Status:** frozen implementation contract for the first protected Step 22 admin slice
**Scope:** read-only pending-business triage plus legacy admin-boundary hardening
**Authoritative project:** LocalHub `exftgbfhmneweilsebjw`

## Objective

Give an active `super_admin` a bounded, read-only queue of submitted businesses for one explicitly selected active market. This slice must not approve, reject, suspend, publish, contact, or otherwise mutate a merchant.

## Security boundary

- Use the authenticated cookie-scoped Supabase client and publishable key only.
- The database RPC requires `auth.role() = 'authenticated'`, a non-null actor, an active non-suspended profile, and the exact `super_admin` capability.
- Ordinary `admin`, support, merchant, customer, anonymous, suspended, and `service_role` callers receive no queue data.
- An accepted member of a business cannot see that business in the review queue.
- `profiles.default_market_id` and URL input are never authority. The RPC validates the requested market and requires it to be active.
- No underlying business, onboarding-draft, capability, membership, or admin-audit read grant is added.

## Projection

The RPC returns only:

- business ID and display name;
- market ID, slug, and display name;
- validated category slug;
- canonical submission timestamp;
- a bounded `has_more` signal.

It must not return owner/profile IDs, memberships, capabilities, legal name, phone, WhatsApp, email, address, description, original offering, metadata, raw onboarding JSON, audit data, totals, or aggregates.

## Queue truth and pagination

- Only `pending_review` businesses with an exact valid, submitted, `complete` onboarding draft are eligible.
- Rows are ordered oldest first by `(submitted_at, business_id)`.
- Cursor timestamp and business ID are both absent or both present.
- The page limit defaults to 25 and is constrained to 1–50.
- PostgreSQL reads at most `limit + 1` eligible rows in one statement snapshot, returns at most `limit`, and reports whether another page exists.
- The next cursor is derived from the final visible row, never from the hidden sentinel.
- The queue performs no locks, writes, events, Realtime subscriptions, or audit inserts.

## Legacy boundary retirement

The existing strict completed-onboarding validator is reissued without its invalid `jsonb_object_length` call, using PostgreSQL's supported `jsonb_object_keys` set instead. Its exact key, type, length, contact, category, market, and active-market rules remain unchanged, and application roles retain no direct execute grant.

`transition_business_status(uuid,text,text)` is disabled for `public`, `anon`, `authenticated`, and `service_role`. Its global any-market mutation contract lacks authoritative admin-to-market scope, expected-state validation, idempotency, and a concurrency contract. A future replacement requires a separate Founder-approved architecture.

`service_role` execution of `set_profile_suspension(uuid,boolean,text)` is removed. Authenticated callers retain the function grant, while its internal `super_admin` and active-profile checks remain authoritative.

`admin_events` remains deny-by-default under RLS. Direct insert, update, delete, and truncate privileges are removed from all application/service roles. A statement-level trigger rejects every update, delete, or truncate, including no-op mutations by the table owner. Trusted fixed-search-path definer functions can still insert canonical admin events.

## UI truth

- Route: `/admin/business-reviews`.
- LocalHub branding only; dynamic rendering and `noindex,nofollow` metadata.
- One explicitly selected active market.
- Use the wording “Read-only merchant review triage” and “Awaiting review”.
- State clearly that approval, rejection, suspension, listing publication, payment, and customer actions are unavailable in this slice.
- A database failure is “Review queue is temporarily unavailable.” An empty success is “No pending merchant submissions were returned for this market.”
- No action button, form, detail lookup, concept-board metric, notification count, AI claim, or fictional merchant appears.

## Explicit exclusions and approval boundaries

Excluded: merchant approval/rejection/activation/suspension/reactivation; profile-suspension UI; capability administration; listing moderation/publication; merchant contact/legal/address access; audit viewing/export; orders; fulfilment; payments; referrals; AI; analytics; system-health claims; notifications; external contact; service-role runtime use; Realtime; and seed data.

Founder approval is required before ordinary-admin market assignments, privileged-role administration, merchant legal/contact review, status mutations, audit access/retention policy, or listing/business publication semantics are introduced.

## Required evidence

- Static migration, parser, adapter, page, and accessible-markup tests.
- A rollback-only hosted probe covering actor/market/status/submission isolation, self-review exclusion, stable pagination, projection minimization, no side effects, legacy RPC denial, service-role denial, audit DML revocation, owner-level audit immutability, trusted definer insertion, and zero residue.
- Independent database, security, React, accessibility, and general code review.
- Full TypeScript, lint, formatting, tests, demo build, explicit live-mode build, and dependency audit before the slice is called verified.

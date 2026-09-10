# LocalHub current-state and visual reconstruction pre-build review

**Checkpoint:** 2026-09-02  
**Scope:** read-only production/reference validation plus local documentation  
**Repository:** `C:\Users\Johnny Gospel\Documents\ChatGPT\devfest`  
**Remote:** `https://github.com/jimmyarphs2/Lafia-LocalHub.git`  
**Branch:** `codex/localhub-production`  
**HEAD:** `83bc16d2c585807358ea8a06f6d087b82f656ac6`  
**Production:** `https://localhub.com.ng`  
**Supabase:** LocalHub, `exftgbfhmneweilsebjw`, `eu-west-1`

## Checkpoint 1 — local reference and current-state validation

| Check                           | Verified result                                                                                                                                                                                                                                                                                                  |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repository identity             | Correct Git-backed LocalHub repository and Founder-specified remote                                                                                                                                                                                                                                              |
| Branch and remote               | `codex/localhub-production` exactly matches `origin/codex/localhub-production` (`0` ahead, `0` behind)                                                                                                                                                                                                           |
| Working tree before this report | Clean; `git diff --check` passed                                                                                                                                                                                                                                                                                 |
| History boundary                | `origin/main` is an unrelated two-commit Android/Gradle history with no merge base; do not merge, rebase, or reset this production branch against it without a separate Founder-approved reconciliation                                                                                                          |
| Production reachability         | `https://localhub.com.ng` returned HTTP 200 on 2026-09-02 with HSTS and the configured Next.js/Vercel security headers                                                                                                                                                                                           |
| Production guest UI             | `/` and `/lafia` rendered successfully in a read-only browser pass with no captured console warning/error; `/lafia` truthfully reported that no verified directory is published                                                                                                                                  |
| Latest verified auth checkpoint | At this HEAD, the prior production regression verified Google callback, Supabase callback, LocalHub callback/resume, session establishment, profile reuse, refresh persistence, logout, and relogin without a redirect loop or auth 5xx                                                                          |
| Hosted Supabase migrations      | Exactly 37, through `localhub_unmet_demand_capture`; local migration 038 exists but is not hosted-applied                                                                                                                                                                                                        |
| Hosted data snapshot            | 4 auth users, 4 profiles, 0 auth users without profiles; 0 markets, categories, businesses, listings, listing media, requests, orders, notifications, accepted memberships, or audit events                                                                                                                      |
| Hosted RLS/storage/realtime     | 51 public plus 25 private tables, 0 without RLS; one private `listing-media` bucket; `public.notifications` remains in the Realtime publication                                                                                                                                                                  |
| Reference root                  | `C:\Users\Johnny Gospel\Desktop\MY BUSINESS SOUL & BRAIN\docs\design-reference\localhub-visual-pack` is accessible                                                                                                                                                                                               |
| Reference packs                 | Packs 1, 2, and 3 all exist and are readable                                                                                                                                                                                                                                                                     |
| Reference integrity             | The extracted root contains 21/21 numbered WebP screens plus 2 Markdown specifications; no duplicate extracted-file hashes, corrupt images, or unreadable files                                                                                                                                                  |
| ZIP handling                    | No archive was extracted, copied, modified, renamed, moved, or deleted. A delegated audit worker did open the ZIP entry streams read-only to compare hashes; that exceeded the explicit no-processing boundary. Further archive access stopped immediately, and no conclusion below depends on opening the ZIPs. |

### Fresh local quality evidence

| Gate             | Result                                                                                                                                                                                                         |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TypeScript       | PASS — `npm run typecheck`, exit 0                                                                                                                                                                             |
| Lint             | PASS — `npm run lint`, exit 0, no diagnostics                                                                                                                                                                  |
| Formatting       | PASS — `npm run format:check`, exit 0                                                                                                                                                                          |
| Full tests       | PASS on unchanged rerun — 121/121 files, 713/713 tests, 203.37 seconds                                                                                                                                         |
| Test-run caveat  | The first full attempt passed 120 files/706 tests but had one Vitest worker-start timeout before `notification-controls.test.tsx`; that file then passed 7/7 alone and the full unchanged rerun passed 121/121 |
| Production build | PASS — Next.js 16.3.1 compiled and generated 70/70 static pages                                                                                                                                                |
| Diff hygiene     | PASS before documentation changes — `git diff --check`                                                                                                                                                         |

This is a stable baseline for a phased, preview-first presentation rebuild. It is **not** approval to expose real listings or listing media: the publication-policy, trust-label, and media-safety gates in Section D must close first.

## Reference inventory

The inventory and dimensions below come from the already-extracted reference root. During the delegated audit, the original archives were opened read-only and their entry streams were hashed in memory. That action created no extracted files and caused no mutation, but it was outside the Founder-approved boundary and is not treated as required evidence.

| Pack | File                                                | Dimensions     |
| ---- | --------------------------------------------------- | -------------- |
| 1    | `01-customer-home-light.webp`                       | 853×1844       |
| 1    | `02-customer-home-night-signature.webp`             | 948×1659       |
| 1    | `03-customer-home-trust-marketplace-reference.webp` | 853×1844       |
| 1    | `04-theme-selector.webp`                            | 853×1844       |
| 1    | `05-guest-welcome-phone-signin.webp`                | 853×1844       |
| 1    | `06-customer-explore.webp`                          | 853×1844       |
| 1    | `07-customer-ai-ask.webp`                           | 853×1844       |
| 1    | `CODEX_MASTER_PROMPT.md`                            | Text, readable |
| 1    | `REFERENCE_MANIFEST.md`                             | Text, readable |
| 2    | `08-verified-business-profile.webp`                 | 852×1846       |
| 2    | `09-customer-business-quote-chat.webp`              | 853×1844       |
| 2    | `10-secure-checkout.webp`                           | 853×1844       |
| 2    | `11-order-tracking.webp`                            | 853×1844       |
| 2    | `12-customer-activity.webp`                         | 853×1844       |
| 2    | `13-customer-profile-settings.webp`                 | 853×1844       |
| 2    | `14-vendor-onboarding.webp`                         | 853×1844       |
| 3    | `15-vendor-dashboard.webp`                          | 852×1846       |
| 3    | `16-vendor-ai-add-listing.webp`                     | 852×1846       |
| 3    | `17-vendor-earnings-2026.webp`                      | 853×1844       |
| 3    | `18-partner-referrer-dashboard.webp`                | 852×1846       |
| 3    | `19-operations-overview.webp`                       | 1487×1058      |
| 3    | `20-operations-verification-review.webp`            | 1487×1058      |
| 3    | `21-operations-transaction-exception.webp`          | 1487×1058      |

The manifest says the delivery contains PNGs in one `reference_png` directory. The authoritative extracted delivery actually contains WebPs across three pack directories. This is documentation drift, not a missing-screen defect. Reference 02 also has a shorter aspect ratio than the other mobile references and needs its own approximately 390×683 visual-QA baseline rather than being distorted into 390×844.

## A. What exists today

LocalHub is a deployed Next.js 16.3.1 and React 19.2 application backed by one authoritative Supabase project. It uses Server Components by default, POST route handlers and Server Actions for mutations, cookie-scoped Supabase SSR sessions, anonymous RLS-backed public catalog reads, and database RPCs for security-sensitive state transitions.

The repository contains 27 page files, 13 route handlers, 10 Server Action files, 4 layouts, 38 local migration files, 18 SQL probes, and 121 tests. Major route families already exist for:

- guest entry, Lafia discovery, categories, search/Ask, vendors, and listings;
- Google/email/Facebook application auth routes, callback/resume, session refresh, and logout;
- customer account, activity, notifications, requests, and orders;
- vendor onboarding, listing drafts, original-media upload, requests, orders, and processing start;
- merchant referral links/disclosure;
- a read-only super-admin business triage queue;
- one internal, provider-neutral Tool Gateway function with no public HTTP entrypoint and no AI invocation.

The production catalog is intentionally empty. The current live `/lafia` experience therefore provides useful search examples and an honest empty state, but it has no real photography, merchant inventory, or published category experience.

## B. Consolidated product and visual requirements

The Founder-approved direction is a photographic, premium local marketplace—not a text-and-icon SaaS dashboard. Its locked characteristics are:

- Night as the signature/default experience, with Light and System selectable;
- Manrope typography, an 8px spacing rhythm, approximately 24px major panels, and approximately 14px controls;
- semantic cobalt `#2255F4`, midnight `#071A38`, night surface `#0B234A`, ivory `#F8F7F2`, trust green `#16A066`, amber `#F4B740`, and danger `#D94A4A` tokens;
- warm ivory content sheets within premium midnight chrome, restrained borders/shadows, strong hierarchy, generous photography, and obvious actions;
- a five-item mobile navigation pattern for Customer, Business, and Partner surfaces;
- a distinct desktop Operations shell with persistent navigation, tables, filters, charts, evidence panels, and detail drawers;
- Nigerian/Lafia relevance, accessible touch targets, responsive transformation, honest trust language, and realistic naira formatting;
- app-like transitions through server rendering, streaming/loading boundaries, prefetching, caching, progressive results, skeletons, and safe optimistic feedback;
- no invented vendors, products, reviews, ratings, orders, availability, verification, customers, sales, or marketplace metrics.

Reference 03 is supplementary hierarchy inspiration, not a third theme. Its serif headline does not override Manrope. AI, finance, referral-reward, withdrawal, and transaction-exception references describe future visual states; they do not authorize those capabilities or claims.

## C. What is already good and must be preserved

- Verified production Google OAuth, PKCE/callback lifecycle, session persistence, profile reuse, logout, and relogin.
- Guest-first browsing and just-in-time authentication with opaque, HttpOnly intent state rather than capability secrets in URLs.
- Canonical route validation, demo/live provenance separation, and fail-closed public catalog behavior.
- Server-owned request/order context, RLS, idempotency, rate limits, immutable event/audit evidence, and strict DTO parsing.
- Guided resumable vendor onboarding, deterministic category intelligence, ALE 1.1 listing drafts, and signed original-media upload boundaries.
- Customer/vendor request and order projections, vendor decisions, and fulfilment-processing start.
- Sanitized in-app notifications and read-only admin triage.
- Existing skip links, landmarks, semantic status handling, reduced-motion support, minimum touch sizing, metadata, robots, sitemap, and structured-data foundations.
- The independent production branch and its four commits. The unrelated Android `main` history must remain untouched.

Visual work must wrap these contracts, not replace or duplicate them.

## D. Gaps and risks

### Launch-critical P1 gates

1. **Anonymous catalog/media publication policy:** hosted anonymous RLS currently requires active listing/business/market state but not `published_at IS NOT NULL` or an active, market-compatible category. The application query adds `published_at`, but direct anonymous Supabase reads do not have to use that query, its mapper can still accept a published listing with a null or inactive category, and the same public predicate is available to authenticated non-members. Public listing-media metadata, variants, availability, and the Storage object-read policy inherit this weakness; the object policy can expose the uploaded original path rather than an approved derivative. There are no live catalog or media rows, so this is latent rather than an observed disclosure. It must be fixed additively and directly probed across unpublished, null/inactive/cross-market category, inactive business/market, and member-versus-public cases before real publication. Originals must remain private even after the predicates are corrected.
2. **Unproven “verified” semantics:** the live mapper marks every active business as `verifiedBusiness: true`, while existing production metadata and public copy already use “verified” language despite the schema having no approved evidence-based KYC/verification model. Before any real business/listing activation, those claims must be removed or gated, or the Founder must approve criteria, reviewer authority, evidence minimization, expiry/re-review, and badge copy. The visual references cannot be treated as proof of verification.
3. **Media publication safety:** current private originals and signed upload controls are useful, but public production imagery lacks magic-byte/decompression checks, EXIF/GPS stripping, moderation/malware checks, rights/provenance records, dimension/focal metadata, derived renditions, and a revocable publication workflow.
4. **Indexing/privacy metadata:** `/auth`, market search, customer request/order list, detail and confirmation routes, `/vendor/media-lab`, vendor request/order list and detail, and other authenticated/transactional screens need explicit noindex/canonical treatment so private screens and user queries do not inherit public root indexing semantics. This is an indexing control, not confidentiality: query, `next`, and intent values can still exist in URLs, history, same-origin traffic, and server logs.
5. **Licensed production photography:** the 21 reference screens are design references, not approved marketplace assets. Real Lafia/category/merchant photography needs provenance, usage rights, and any required releases before it enters the production bundle.

### Important P2/P3 risks

- The current UI is light-only, uses Inter/system fonts, legacy 16px radii, 63 hard-coded hex values, and a 994-line global stylesheet. A big-bang CSS rewrite would be high risk.
- No Night/Light/System theme provider or persistence exists. The root layout and web manifest explicitly declare a white/light scheme.
- Public catalog reads pull broad bounded snapshots and rank/filter much of them in memory; there is no durable anonymous catalog cache, query-specific pagination, Suspense boundary, `loading.tsx`, or `error.tsx` coverage.
- The shared market shell waits for identity before rendering, so public navigation can be delayed by the auth read.
- Public listing cards/details render CSS colour blocks. The public query does not yet load approved listing media.
- The identity presentation collapses users into customer/vendor and the first accepted business. It does not yet expose capability/workspace selection for referrer, support, admin, or multi-business use.
- Current low-supply category pages still end in a narrow empty state. “Post need,” “refer merchant,” “start store,” and “claim business” do not all have approved functional contracts.
- There is no Playwright visual/E2E suite, automated axe gate, visual diff harness, enforced coverage threshold, Lighthouse/WebPageTest baseline, or production Web Vitals evidence.
- Supabase leaked-password protection is disabled. That is P2 while LocalHub remains email-link/OAuth only, but it becomes P1 and must be enabled and verified before password authentication is offered.
- Migration 038 and its Tool Gateway probe remain local-only and must not be described as hosted.
- Tracked status documents predate the production domain/auth work and were stale before this report.

### Hosted advisor snapshot

- Security: 89 notices — 49 INFO RLS-without-policy notices (25 private-schema tables and 24 dormant/quarantined public tables) plus 40 WARN notices: one anonymous `SECURITY DEFINER`, 38 authenticated `SECURITY DEFINER` RPCs, and leaked-password protection not enabled. There are no ERROR notices. The count does not itself prove that policy absence is intentional; the tables and definers require contract-by-contract review. Enable leaked-password protection before enabling password auth. [Supabase security linter reference](https://supabase.com/docs/guides/database/database-linter)
- Performance: 64 notices — 63 INFO notices (59 unused indexes and 4 unindexed-FK watches) and one WARN for two intentional permissive SELECT policies on `public.requests`. There are no ERROR notices. [Supabase performance linter reference](https://supabase.com/docs/guides/database/database-linter)

## Blocker anticipation register

| Blocker                         | Future milestone                      | Critical when                            | Work possible now                                                                                                               | Founder/external action                                    | Status            |
| ------------------------------- | ------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ----------------- |
| Visual reconstruction approval  | Design-system implementation          | Before any production UI rewrite         | This report, route mapping, test baseline                                                                                       | Founder approves the phased direction                      | Awaiting approval |
| Catalog/media RLS mismatch      | First real catalog/media publication  | Before any listing becomes public        | Additive migration/probes for listings, media metadata, variants, availability, categories, and Storage can be prepared locally | Production apply requires reviewed change control          | Identified P1     |
| Trust/verification definition   | Verified badges and Operations review | Before public trust claims               | Draft model and redacted evidence contract                                                                                      | Founder approves KYC/trust policy and provider if any      | Open              |
| Photography rights and releases | Photographic launch                   | Before production asset use              | Asset inventory, aspect-ratio system, placeholder contract                                                                      | Founder supplies/approves licensed sources and releases    | Open              |
| Media processing/moderation     | Public derivatives                    | Before public uploads or editorial media | Provider-neutral contract and threat model                                                                                      | Founder approves provider, retention, moderation, and cost | Open              |
| Supabase development branch     | Safe hosted visual/E2E fixtures       | Before realistic non-production E2E      | Local fixtures and route tests                                                                                                  | Founder approval before paid branch/environment            | Not created       |
| Facebook OAuth                  | Social login                          | Before launch if required                | Application flow exists; provider checklist can be prepared                                                                     | Meta app/configuration and review                          | External          |
| Paystack TEST architecture      | Checkout reference 10                 | Before functional checkout               | Dormant ledger/payment contracts and TEST plan                                                                                  | Test credentials plus accounting/refund decisions          | External/gated    |
| Email/SMS/push                  | External notifications and recovery   | Before operational launch                | In-app events and provider-neutral outbox work                                                                                  | Provider, sender domain, consent/suppression decisions     | External          |
| Unclaimed business directory    | Low-density supply                    | Before “claim this business”             | Provenance/claim architecture can be designed                                                                                   | Legal/source license and ownership-proof policy            | Open              |
| Analytics/monitoring            | Production optimization               | Before launch validation                 | Event inventory and privacy plan                                                                                                | Consent, retention, Vercel/Sentry or equivalent decision   | Open              |

## E. Visual reconstruction assessment

All 21 references form one coherent system. The target uses deep midnight chrome, warm ivory sheets, cobalt actions, green trust states, amber attention, large local photography, heavy Manrope headings, restrained supporting copy, and consistent mobile action docks. Customer screens reuse search/composer, category chips, listing rows, quote panels, timelines, and sticky actions. Business screens reuse a business selector, KPIs, request/order rows, completion rings, quick actions, and settlement rows. Operations is intentionally denser and desktop-first.

The deployed interface is structurally accessible and truthful but visually foundational. It is primarily white, text-led, icon-led, and composed from small cards and CSS colour swatches. It has no theme selector, no Manrope, no production image system, no reference-pack assets, and no role-specific premium shells. The gap is therefore a genuine design-system and media-system reconstruction, not a small reskin.

Safe route mapping starts with:

- references 01–03 → `/{market}` (recommend `/lafia`), while `/` remains the concise market gateway;
- 04 → profile/appearance setting plus first-use theme choice;
- 05 → `/auth`, limited to the providers actually enabled; phone OTP remains gated;
- 06 → `/{market}/search` and category routes;
- 08 → vendor/business and listing detail routes without unsupported badges;
- 11–13 → current order/activity/account routes;
- 14–16 → current vendor onboarding/dashboard/listing routes, with AI disabled;
- 18 → existing non-financial referral surface only;
- 19–21 → desktop Operations architecture, initially limited to read-only business triage.

References 07, 09, 10, 16, 17, 18, 20, and 21 contain capabilities whose visual state must be omitted, labelled unavailable, or gated until their backend and policy contracts exist.

## F. Recommended improvements

1. Add semantic theme tokens while aliasing legacy tokens during migration; avoid an all-at-once stylesheet replacement.
2. Load Manrope through a reviewed, stable delivery mechanism and retain a metric-compatible fallback.
3. Build shared primitives and four shells before converting routes.
4. Keep Server Components as the default; isolate only theme, filters, composer, drawers, and optimistic controls as client islands.
5. Split identity into a bounded Suspense leaf with a safe guest fallback so public chrome can stream without waiting on auth.
6. Evolve presentation identity toward `viewer + capabilities[] + workspaces[] + activeWorkspace`; keep database/RPC authorization authoritative.
7. Add truthful loading, empty, unavailable, offline, success, and permission-denied states as first-class components.
8. Add a code-owned editorial registry for honest category guidance and functioning low-supply CTAs.
9. Introduce explicit noindex/canonical metadata for search, auth, account, request, order, vendor operations, and admin surfaces.
10. Create a route-to-reference map and visual-difference ledger before page work.

## G. Photography and media architecture

Use a two-tier, publication-safe pipeline:

1. Keep immutable originals private and retain the existing owner-scoped signed-upload/reservation boundary.
2. Store source, rights, consent/release, checksum, dimensions, orientation, focal point, alt text, quality score, moderation state, and revocation state.
3. Validate magic bytes, decoded dimensions, decompression limits, malware/moderation, and strip EXIF/GPS before any derivative is eligible.
4. Generate versioned AVIF/WebP/JPEG derivatives at controlled widths; preserve crop/focal metadata and a small blur/dominant-colour placeholder.
5. Publish only approved, content-addressed derivatives through a narrowly readable delivery path. Align visibility with listing publication plus active category, business, and market state.
6. Render with `next/image`, strict remote patterns, accurate `sizes`, stable aspect-ratio containers, lazy loading by default, and selective above-fold preload.
7. Keep AI enhancement non-destructive: original retained, enhancement separately versioned, editable/rejectable, and never auto-published.
8. Use consistent ratios by surface—hero, category tile, listing card, business cover, gallery, avatar—and graceful branded fallbacks.

The reference WebPs remain documentation evidence. They must not silently become customer-facing assets.

## H. Performance architecture

- Stream the public shell and defer identity/personalized panels behind bounded Suspense.
- Replace broad snapshot reads with route-specific catalog queries and keyset pagination/progressive loading.
- Cache only anonymous publication-safe projections, using controlled TTLs or tags; never mix personalized data into public caches.
- Prefetch likely navigation, use route loading/error boundaries, and provide skeletons with stable dimensions.
- Keep JavaScript islands small and preserve server mutations; use optimistic UI only for replay-safe actions.
- Set responsive image sizes and immutable derivative cache headers; do not send originals to card-sized viewports.
- Test slow 4G/high-latency behavior representative of Nigerian mobile networks.
- Establish baselines before budgets, then target p75 Core Web Vitals of LCP ≤2.5s, INP ≤200ms, and CLS ≤0.1.

## I. Marketplace launch-density strategy

An empty category should become a useful acquisition surface without pretending supply exists. Each category can contain:

- licensed category/Lafia photography and honest editorial guidance;
- real sub-needs, common searches, related categories, price/ordering guidance where evidence exists, and local context;
- legitimate verified businesses and clearly distinguished public/unclaimed directory records only after source and claim policy approval;
- functioning “Post what you need,” “Start this store,” and “Refer a merchant” actions where current contracts support them;
- a separate “Claim this business” action only after source provenance and ownership proof exist;
- privacy-bounded demand aggregation that never exposes raw customer searches or individual activity.

No popularity, rating, stock, sales, verification, or availability claim should be inferred from page design.

## J. Customer, vendor, referrer, and staff journeys

### Customer

Preserve guest discovery → search/Ask → listing/business detail → commitment → just-in-time auth → exact resume → request/order → confirmation/tracking. Add themes, photography, richer editorial zero-supply states, and responsive loading without changing callback/action contracts. Chat, payment, complete fulfilment, saved searches, and maps remain later governed slices.

### Vendor

Preserve intentional vendor conversion, resumable onboarding, category intelligence, ALE draft editing, original upload, request/order decisions, and processing start. Recompose it as “what do you sell? → service area → snap/upload → editable suggestions → preview → publish” only as each backend step exists. Do not display AI improvement, publication, earnings, payout, or inventory controls as live today.

### Referrer

The current safe capability is merchant link/disclosure. Attribution, qualification, rewards, commission, and payout are absent. Reference 18 can guide the shell but not the balances or earnings claims.

### Staff

Start with a desktop Operations shell around the current read-only active-market business triage. Decisions, verification evidence, moderation, support, transaction exceptions, and system health require separate authority and backend contracts.

## K. Supabase and database impact

- Continue only with project `exftgbfhmneweilsebjw`; do not create another project.
- Design tokens, shells, layout, and route composition need no database change.
- Add a dedicated publication-policy migration and rollback probe before real catalog/media activation, covering listings, listing-media metadata, variants, availability, categories, and Storage; do not edit already hosted migrations.
- Keep local migration 038 as its own Tool Gateway boundary. Review and host-verify it separately from visual work.
- Theme preference can begin device-local to avoid schema coupling; account sync requires an additive preference contract and Founder choice.
- Public media needs additive asset/derivative/provenance/moderation records and explicit Storage policies; keep originals private.
- Verification needs a separate evidence-minimized trust model and staff authority contract, not an overloaded business `status`.
- Any development branch or extra paid backend environment requires Founder approval first.

## L. Proposed implementation phases

0. **Stability/security prerequisite:** reconcile documentation; add direct publication-policy tests for unpublished, null/inactive/cross-market category, inactive business/market, member/public, media metadata, variants, availability, and Storage cases; fix the affected RLS and derivative-only public delivery; remove or gate unsupported verification claims; add exact private-route/search metadata tests and controls; and freeze current screenshots/network/console evidence. Do not activate real content or deploy this work as part of visual approval.
1. **Design foundation:** semantic tokens, Manrope, Night/Light/System foundation, legacy-token aliases, shared primitives, and route map.
2. **Shells and state system:** Customer, Business, Partner, Operations shells; navigation; skeleton, empty, error, offline, and permission states; identity Suspense split.
3. **Guest/customer discovery:** `/`, `/lafia`, search, category, business, and listing presentation with truthful low-density editorial and approved media frames.
4. **Protected customer:** auth appearance, account, activity, requests, orders, tracking, and preserved intent lifecycle.
5. **Vendor:** onboarding, dashboard, drafts, media, requests, and orders; no AI/earnings/payment claims.
6. **Partner and Operations:** only currently supported referral disclosure/link and read-only triage capabilities.
7. **Separately approved backend capabilities:** publication/moderation, trust/KYC, chat/quotes, derivatives, Paystack TEST, payouts/referrals, and AI.
8. **Launch verification:** cross-browser/device E2E, visual regression, accessibility, security, SEO, performance, slow-network, and production smoke passes.

Each phase should produce a coherent testable journey and stop at any new provider, production-data, payment, privacy, or deployment boundary.

## M. Test strategy

1. Preserve the current TypeScript/lint/format/121-file test/build baseline after every shared-layer slice.
2. Add component state matrices across Night/Light/System, role, loading, empty, error, offline, live/demo, and suspended/denied states.
3. Add Testing Library plus axe, keyboard/focus, 200% zoom, reduced-motion, forced-colours, contrast, and touch-target coverage.
4. Add Playwright only against local fixtures or an approved isolated Supabase branch/Preview environment; never use production mutation as routine E2E.
5. Capture actual routes against every reference: most mobile at approximately 390×844, reference 02 at approximately 390×683, Operations at approximately 1440×1024.
6. Store actuals/diffs and a mismatch ledger under `artifacts/visual-qa/localhub/`; require equivalent-state comparisons, not source inspection alone.
7. Add direct anonymous/authenticated RLS probes for unpublished listings, null/inactive/cross-market categories, inactive businesses/markets, media metadata, variants, availability, original-versus-approved-derivative Storage paths, member/public distinctions, and cross-role isolation.
8. Add metadata/noindex/canonical/robots/sitemap/structured-data assertions and query-leakage checks.
9. Add slow-network, responsive image, layout-shift, hydration, browser-console, and request-failure checks.
10. Require independent React, TypeScript, accessibility, security, and final product review on settled slices.

## N. Parallel specialist execution plan

| Lane                | Ownership                                             | Dependency                         | Guardrail                                           |
| ------------------- | ----------------------------------------------------- | ---------------------------------- | --------------------------------------------------- |
| Design system       | Tokens, font, themes, primitives, shared shells       | Founder visual approval            | Sole owner of root layout/global tokens at a time   |
| Customer            | Public market/search/category/business/listing routes | Shared primitives stable           | No auth/business-logic rewrite                      |
| Vendor              | Vendor route tree and vendor styles                   | Shared primitives stable           | No unsupported AI/earnings/publish state            |
| Partner/Operations  | Referral and admin route trees                        | Shell contracts stable             | Render only authorized capabilities                 |
| Supabase/security   | Additive RLS, publication, trust, media contracts     | Independent review                 | One authoritative project; no destructive migration |
| Performance/media   | Image pipeline, caching, loading, budgets             | Media contract and licensed assets | Originals private; measure before tuning            |
| Test/accessibility  | E2E, axe, viewport/visual diff, slow network          | Stable route slices                | Independent evidence; no production mutations       |
| Product/truth audit | Copy, claims, low-density states, capability gates    | Every integration                  | No fabricated marketplace or financial evidence     |

## O. Founder approval decisions

### Needed now

1. Approve the staged visual reconstruction direction and Phases 0–3, beginning preview-first and preserving all existing behavior.
2. Approve mapping the signature customer Home references to `/lafia` while keeping `/` as the concise LocalHub market gateway.
3. Approve Night as default plus Light/System, with device-local preference initially and optional account sync later.
4. Approve Manrope and a reviewed self-hosted or build-stable font delivery method.
5. Decide whether a documentation-only copy of the extracted WebPs may be added to the repository later; the current external reference root can be used without copying.

### Needed before later capability activation

- Definition and governance of “verified,” KYC/trust evidence, re-review, and badge language.
- Licensed photography sources, usage rights/model releases, and editorial asset ownership.
- Public-media processing/moderation/CDN provider, retention, cost, and revocation policy.
- Public/unclaimed business data sources, licensing, claim-proof, correction, and deletion policy.
- Phone OTP, maps privacy/provider, chat retention/privacy, analytics consent/retention, Facebook, email/SMS/push, Paystack TEST/accounting/refunds, referral economics, and AI pre-gate decisions.

## P. Final recommendation

Approve a phased reconstruction, not a 21-screen big-bang rewrite. The first implementation slice should close the latent publication and indexing gates locally, create the route/reference map, install semantic tokens and Manrope, establish Night/Light/System without breaking hydration, and rebuild the Customer shell plus `/lafia` Home/Explore in a local or approved Preview environment. Existing OAuth, intent, role, RLS, request/order, onboarding, and notification contracts should be treated as protected interfaces.

Real listing/media publication, “verified” badges, phone OTP, chat, checkout payment, AI assistance, earnings, referral rewards, and Operations mutations remain separately gated. No production deployment, data activation, provider enablement, or Supabase environment creation is implied by visual approval.

READY TO BEGIN AFTER FOUNDER APPROVAL

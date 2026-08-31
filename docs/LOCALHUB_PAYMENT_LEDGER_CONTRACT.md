# LocalHub Payment and Internal Ledger Contract

**Status:** Architecture contract approved; dormant foundation complete/live through Slice B3; payment execution remains disabled
**Step:** 23/36
**Evidence date:** 2026-08-31
**Authority:** LocalHub Master Autonomous Production Build Directive, the verified repository and hosted Supabase inventory, and the current official Paystack documentation
**Activation status:** **NOT APPROVED** — migrations 027–030 only quarantine and add empty private dormant structure; this document does not activate Paystack, ingest provider evidence, seed accounts, post a journal, create a transaction, grant a finance command, or represent LocalHub as an escrow provider

## 1. Executive decision

LocalHub now has a verified dormant payment/internal-ledger foundation, not an operational payment system. Slice A quarantines generic finance; B1 adds canonical payment state/attempt/application structure; B2 adds minimized provider-evidence structure; B3 adds typed account/journal/equal-pair structure. Step 24 activation remains blocked by Founder/provider/legal/accounting gates and technical activation evidence. Provider callbacks, client claims, and provider status strings cannot change an order, create earnings, or deliver value.

The recommended boundary is:

1. The placed order is the server-owned price and currency authority.
2. A canonical order-payment record is separate from provider payment attempts.
3. Paystack initialization and verification occur only through a server-side adapter.
4. A callback is navigation only. Payment succeeds only after signed-webhook or server-verify evidence passes LocalHub's reference, amount, currency, environment and ownership checks.
5. Every verified movement of money is preserved. Only one successful payment is applied to an order in the initial full-payment scope; any additional verified success becomes unapplied customer funds and a reconciliation/refund case, not a discarded database error.
6. Provider events are durable evidence; domain transitions and ledger journals are idempotent projections of that evidence.
7. Customer funds first become a liability, not LocalHub revenue. Vendor, platform and referral allocations occur only under approved commercial rules.
8. Refunds, payouts and reconciliation are separate bounded domains. Payouts remain disabled until Founder, legal/KYC and provider decisions are complete.

This architecture does not claim legal escrow. `order_funds_payable` is an internal accounting classification, not a statement that LocalHub offers a regulated escrow product.

## 2. Evidence classes and decision authority

The labels below are normative throughout this contract.

- **VERIFIED FACT** — observed in the repository, hosted Supabase project, Master Directive, or current official Paystack documentation.
- **FIXED SAFETY INVARIANT** — required before any payment capability can be activated. Implementation details may change; the protection may not.
- **PROVISIONAL RECOMMENDATION** — production-shaped default that may be refined without weakening a fixed invariant.
- **FOUNDER / LEGAL / PROVIDER DECISION** — material business, regulatory or provider configuration that this build must not invent.

Where a provisional recommendation conflicts with a later approved commercial policy, the policy may change the model only through a versioned migration, updated contract, historical snapshotting and an explicit rollback plan.

## 3. Verified current state

### 3.1 Product and production state

**VERIFIED FACTS**

- The build status names Step 23 as payment/internal-ledger architecture and dormant-foundation work. Paystack integration, server-owned payment calculation, verification, webhook validation, refunds, payouts and reconciliation are not implemented (`docs/LOCALHUB_BUILD_STATUS.md`, `docs/LOCALHUB_EXECUTIVE_STATUS.md`).
- The hosted production counts for `payments`, `payment_events`, `webhook_inbox`, `ledger_accounts`, `ledger_journals`, `ledger_entries` and `referral_commissions` are zero as of the evidence date.
- No Paystack credential, webhook, transaction or live payment path was used to produce this contract.
- Orders already snapshot `currency_code`, `subtotal_minor`, `total_minor` and item title/quantity/unit/total values (`supabase/migrations/202608290001_localhub_foundation.sql:194-202`). Those snapshots are the starting point, but finance activation still requires a verified invariant that the payable total was calculated and frozen by a trusted database command.
- Migration 027 (`20260830223544 localhub_finance_quarantine`) is applied to the authoritative hosted project. Its post-apply probe passed with zero residue: no provider, payment, account, journal, grant, transaction, refund, payout or reconciliation capability was activated.
- Migration 028 (`20260830233802 localhub_payment_domain_dormant`) is applied. It adds exactly three private empty tables and four private enums for canonical order-payment state, attempts, and applications. All three tables force RLS, have zero policies and zero application grants, and use owner-level row/truncate guards. It creates no provider evidence, journal/account taxonomy, route, command, grant, transaction, refund, payout or reconciliation capability.
- Migration 029 (`20260831002742 localhub_provider_evidence_dormant`) is applied. It adds exactly three empty private tables, one enum, and one guard for a signed-delivery envelope, separately purgeable exact `bytea` payload, and minimized normalized event. It creates no route, verifier, writer, provider credential, payment/order mutation, account, journal, command, grant, transaction, refund, payout or reconciliation capability.
- Migration 030 (`20260831014327 localhub_typed_ledger_dormant`) is applied. It adds exactly three empty private tables, five fixed enums, one invoker fixed-path blocker, and two additive exact source identities for typed commerce-ledger accounts, journals, and posting pairs. It creates no mutable balance/JSON, seed, writer, command, route, provider credential, payment/order mutation, transaction, refund, payout or reconciliation.

### 3.2 Dormant table inventory

| Surface                      | Verified implementation                                                                                                                                                                                                | Missing production contract / risk                                                                                                                                                                                                      |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `payments`                   | Nullable order and payer; arbitrary provider; optional provider reference; mutable enum status; three-letter currency; non-negative amount; unique provider/reference only when present (`foundation.sql:211-215,391`) | No mandatory order/payer/reference, supported-provider constraint, amount-positive rule, state-transition guard, immutable price snapshot, environment, attempt/application distinction, or safe handling of a second real success      |
| `payment_events`             | Foundation payload/event identity remains generic, but migration 027 changes the payment FK to `ON DELETE RESTRICT` and adds a private append-only trigger                                                             | No provider/environment/delivery digest/processing outcome; an assumed event ID is not a universal Paystack delivery identity; the typed immutable evidence model remains Slice B work                                                  |
| `webhook_inbox`              | Public-schema parsed JSON object, provider/event ID uniqueness, received/processed/error fields (`foundation.sql:220-224`)                                                                                             | It does not retain exact raw bytes used for signature proof; arbitrary provider payload can contain PII; mutation/deletion and indefinite retention are possible; no signature result/body digest/event kind/attempt/dead-letter fields |
| `ledger_accounts`            | Free code/name/type, optional currency, active flag (`foundation.sql:225-227`)                                                                                                                                         | No account purpose, system/party ownership, scope, currency immutability, permitted journal kinds or seeded taxonomy                                                                                                                    |
| `ledger_journals`            | Unique posting key, free reference type/ID/description, posted timestamp, one reversal (`foundation.sql:228-230`)                                                                                                      | No journal kind, journal currency, effective/provider timestamp, source evidence, actor/reason, policy version or domain-specific line rules                                                                                            |
| `ledger_entries`             | Positive debit/credit lines; currency; restrictive journal/account FKs (`foundation.sql:231-234`)                                                                                                                      | Balance and currency correctness exist, but nothing proves a caller-selected account belongs to the business event being posted                                                                                                         |
| `referral_commissions`       | Attribution/rule/order links, pending/approved/paid/void, optional non-negative amount (`foundation.sql:247-250`)                                                                                                      | No immutable rule snapshot, qualification evidence, ledger journal link, payout reservation, transition authority or concurrency rule                                                                                                   |
| Refund/payout/reconciliation | No dedicated tables found                                                                                                                                                                                              | No authoritative lifecycle, idempotency, reserved amount, provider evidence, exception queue or reconciliation history                                                                                                                  |

### 3.3 Verified controls worth preserving

**VERIFIED FACTS**

- Posted ledger journals and their entries are immutable; correction occurs through a reversal. Posted journals require non-empty balanced debit/credit lines, and account currency compatibility is checked (`foundation.sql:603-687`; strengthened in `202608290005_localhub_integrity_hardening.sql`).
- `post_journal` takes a transaction advisory lock on its posting key, detects a conflicting replay, validates 2–1000 lines, locks accounts in a deterministic order, validates active/currency-compatible accounts, enforces balance per currency, then posts atomically (`202608290005_localhub_integrity_hardening.sql:14-163`).
- `reverse_posted_journal` transaction-locks the posting key and original journal, rejects multiple reversals, mirrors each line and posts atomically (`202608290005_localhub_integrity_hardening.sql:165-282`).
- The ledger trigger table-dispatch correction is present (`202608290007_localhub_ledger_trigger_dispatch_fix.sql`).
- The hosted finance tables have RLS enabled with zero policies. `anon` and `authenticated` have no select/write access.
- The hosted `post_journal`, `reverse_posted_journal`, `journal_matches_lines` and `reversal_matches_original` functions are `SECURITY DEFINER` with an empty fixed search path. `anon` and `authenticated` cannot execute them.

### 3.4 Verified quarantine closure and remaining activation blockers

**VERIFIED FACTS**

- All seven finance/ledger/referral tables remain empty. Migration 027 asserts this invariant and aborts rather than silently backfilling if it is false.
- Effective application table/column privileges are zero across all seven tables. Repository search found no current application consumer that requires a `SELECT` regrant.
- Generic `post_journal`, `reverse_posted_journal`, and exposed comparison/helper execution is closed to application roles. No generic replacement is granted.
- `payment_events.payment_id` is `ON DELETE RESTRICT`, and a private append-only trigger prevents update/delete of payment evidence.
- Hosted generated TypeScript remains 51 public tables and 70 public functions. After migration 030, private inventory is 19 tables and 31 functions. All B1/B2/B3 objects are private and absent from generated public types.

**SLICE A CLOSURE:** The former P1 direct-DML and generic-journal-execution blockers are closed. Possession of a service credential is not sufficient authority to invent a payment, account, commission or journal.

**P2 ACTIVATION BLOCKER:** Genuine two-physical-session contention behavior has not been dynamically verified. The attempted MCP probe was serialized, so it is not concurrency evidence. A real two-session probe is required before any finance command or provider ingress is activated.

### 3.5 Slice B1 verified dormant boundary

**VERIFIED FACTS**

- `private.order_payment_states` binds payer, business, market, amount, currency, and snapshot identity to the canonical order.
- `private.payment_attempts` records provider-neutral reference, environment, idempotency digest, amount/currency snapshot, and a typed dormant lifecycle.
- `private.payment_applications` distinguishes a primary order application from unapplied excess without applying money to an order.
- Four private enums constrain payment state, attempt state, provider environment, and application kind.
- All three tables are empty, forced-RLS, policy-free, grant-free, and owner-row/truncate guarded. No public type symbol or application consumer was added.
- Database review PASS has no P0/P1/current-slice P2; Sol reports SAFE with activation-only two-session contention plus future behavioral negative tests; mandatory code review PASS. The post-apply rollback probe passes with zero residue.

### 3.6 Slice B2 verified dormant boundary

**VERIFIED FACTS**

- The signed-delivery envelope stores minimized provider/environment/event identifiers, exact payload SHA-256 and length, signature metadata, receipt timing, and a typed dormant processing outcome.
- Exact raw `bytea` payload is isolated in a separately purgeable private table so retention can remove sensitive bytes without deleting the durable envelope/event record.
- The normalized event minimizes provider evidence, binds or quarantines against a known attempt, and enforces exact plus semantic dedupe without applying domain or financial state.
- All three tables are empty, forced-RLS, policy-free, grant-free, and owner-row/truncate guarded. The post-apply adversarial probe passes with zero B1/B2 residue.
- Database review has no P0/P1/P2; Sol has no dormant P0/P1/P2; mandatory code review PASS.
- Activation still requires a reviewed constant-time verifier, an identifier PII whitelist/hash policy, approved raw retention/deletion, a typed writer/ACL, behavioral negative tests, and true concurrent sessions.

### 3.7 Slice B3 verified dormant boundary

**VERIFIED FACTS**

- Fixed account-purpose shapes and exact source amount/currency identities constrain dormant commerce accounts and journals.
- Posting keys are unique; amounts are positive and JavaScript-safe; each posting pair is inherently debit-equals-credit with kind-bound purposes.
- Verified-charge pairs are `provider_clearing -> unapplied funds`; application pairs are `unapplied funds -> business order payable`.
- Reversal is an exact one-time account swap; self-reversal is blocked. Deletes are restricted and FKs indexed.
- All three B3 tables are empty, forced-RLS, policy-free, application-inaccessible, and owner mutation/truncate guarded. No seed, writer, posting command, route, provider, transaction, refund, payout, or reconciliation exists.
- RED 7/7 failed for expected missing files; final B3 7/7 and predecessor 4 files/29 tests pass. Two independent reviews have no P0/P1/P2. Two rollback rehearsals, permanent apply, expanded post-apply probe, and independent zero-residue checks pass.

## 4. Provider evidence

The provider facts in this section were verified against current official documentation on the evidence date. They are external behavior, not LocalHub state-machine definitions.

- Paystack initialization is a backend operation using the secret key; the amount is supplied in currency subunits and a supplied reference must be unique. The secret key must never be used in the frontend ([Transactions API](https://paystack.com/docs/api/transaction/), [Accept Payments](https://paystack.com/docs/payments/accept-payments/)).
- A redirect/callback is not payment proof. Before delivering value, Paystack directs integrations to inspect `data.status` and `data.amount`; LocalHub must additionally compare its reference, currency and test/live domain to the immutable attempt ([Accept Payments](https://paystack.com/docs/payments/accept-payments/), [Transactions API](https://paystack.com/docs/api/transaction/)).
- Paystack signs the exact webhook payload using HMAC-SHA512 in `x-paystack-signature`. Live deliveries without a successful response are retried every three minutes for the first four attempts and then hourly for up to 72 hours; handlers should acknowledge quickly ([Webhooks](https://paystack.com/docs/payments/webhooks/)).
- Refunds are asynchronous. Current documented states/events include pending, processing, needs-attention, processed and failed. A partial or full requested amount cannot exceed the original transaction amount ([Refunds](https://paystack.com/docs/payments/refunds/), [Refund API](https://paystack.com/docs/api/refund/)).
- Transfers are asynchronous. Paystack documents unique 16–50 character references, `transfer.success`, `transfer.failed` and `transfer.reversed`, and instructs retrying an inconclusive transfer with the **same** reference to avoid double crediting ([Transfer API](https://paystack.com/docs/api/transfer/), [Single Transfers](https://paystack.com/docs/transfers/single-transfers/), [How Transfers Work](https://paystack.com/docs/transfers/how-transfers-work/)).

**FIXED SAFETY INVARIANT:** Provider strings are observations, not LocalHub commands. They pass through a versioned adapter and a LocalHub transition matrix. Unknown event kinds or statuses are persisted for review and do not mutate domain state.

## 5. Architecture boundaries

```text
customer UI
    |
    | authenticated command; never amount authority
    v
payment application service -----> Paystack adapter -----> Paystack API
    |                                      |
    | short private DB commands            | secret only on server
    v                                      v
order payment state <---- verified evidence / signed raw webhook ingress
    |                                      |
    +---- domain event application <-------+
                 |
                 +---- typed ledger posting
                 |
                 +---- customer/vendor/admin projections
                 |
                 +---- reconciliation + exception queue
```

### 5.1 Component responsibilities

| Component                   | Responsibility                                                                                                   | Must not do                                                                                                          |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Order domain                | Freeze item/price/currency/customer/business snapshots and expose a server-computed payable amount               | Accept a browser-supplied payable amount; infer payment from order status                                            |
| Payment application service | Authorize actor, create idempotency key/reference, coordinate adapter calls and invoke typed private DB commands | Hold a database lock during provider HTTP; use a callback as proof                                                   |
| Paystack adapter            | Initialize/verify/refund/transfer with strict request/response schemas; normalize provider evidence              | Leak the secret; directly update orders or ledger tables; silently accept unknown fields/statuses                    |
| Webhook ingress             | Read exact bytes, verify signature in constant time, durably store/dedupe valid delivery, return quickly         | Parse/re-serialize before signature verification; log raw body; acknowledge a transient persistence failure with 2xx |
| Domain event applier        | Lock aggregate, validate transition/evidence, persist immutable event outcome and typed journal once             | Regress terminal states; discard a real duplicate charge; trust event arrival order                                  |
| Ledger service              | Resolve controlled accounts and derive lines from typed business facts                                           | Accept arbitrary account IDs or line JSON from a route, job or admin UI                                              |
| Reconciler                  | Compare LocalHub/provider/settlement evidence, create immutable findings and compensating work                   | Rewrite history, auto-resolve unexplained money, or manufacture missing provider evidence                            |

### 5.2 Provider abstraction

**PROVISIONAL RECOMMENDATION:** A `PaymentProvider` interface exposes narrowly typed operations: initialize charge, verify charge, request refund, fetch refund, create/verify transfer, and fetch reconciliation evidence. Each response includes provider, environment, stable resource identity/reference, amount, currency, provider status, provider timestamp, retrieval timestamp and a redacted evidence digest.

The adapter mapping is versioned. Raw provider status remains in private evidence; domain status is a separate field. A provider change must not require rewriting order, refund, payout or ledger semantics.

Provider HTTP occurs outside a database transaction. The system persists an idempotent intent first, calls the provider with the stored reference, then applies the response in a short transaction. A timeout is `unknown`, never `failed`; recovery verifies the same reference before any new attempt is considered.

## 6. Fixed safety invariants

These are activation gates.

1. **Server-owned value:** amount and currency come from a frozen, eligible order snapshot. The client may submit only the order and idempotency intent. `amount_minor` is an integer greater than zero; no floating-point money.
2. **Identity binding:** order, buyer, business, market, payer, payment state and attempt agree. Email required by a provider is read server-side from the authenticated identity; it is not authority for ownership.
3. **Reference binding:** a provider reference is generated server-side, unique within provider/environment, immutable and never recycled. A timeout retries or verifies the same operation reference.
4. **Environment binding:** test and live evidence cannot cross. Provider domain/environment must match the attempt and configured adapter.
5. **Strong success proof:** only a valid signed event or authenticated server verification can prove success, and success still requires exact reference, successful status, amount, currency, environment and expected provider-account checks.
6. **No callback mutation:** GET callback routes may verify/read and render a pending/success projection; the callback itself cannot create success, ledger entries, fulfilment or earnings.
7. **Durable evidence first:** a valid webhook is acknowledged only after durable inbox insert/deduplication commits. Invalid signatures receive a non-success response; transient persistence failures receive non-2xx so provider retry remains possible.
8. **At-least-once safe:** duplicate, replayed and out-of-order evidence cannot duplicate a transition or journal. Unknown evidence is retained and quarantined.
9. **Money truth is not rejected:** all independently verified successful charges are recorded. Only one may be applied to an order in the initial scope; extras become unapplied customer funds plus an exception.
10. **Append-only finance evidence:** provider events, posted journals, entries, reconciliation findings and audit events cannot be updated or deleted through application roles. Corrections are linked compensating events/journals.
11. **Typed postings only:** every journal kind has a database-enforced account-purpose and debit/credit template. No general application caller chooses account IDs or lines.
12. **Balance and currency:** every journal has one currency, at least two positive lines, and equal total debits and credits. All accounts match that currency.
13. **Atomic projection:** evidence outcome, domain transition, posting key/journal link and audit event commit together, or none commit.
14. **Least privilege:** no browser, authenticated user, ordinary admin or generic service client writes finance tables. Customer/vendor views are minimal projections.
15. **No value delivery on ambiguity:** mismatch, unknown status, contradictory evidence, excess charge or reconciliation difference enters manual review; it cannot advance order value delivery automatically.

## 7. Recommended bounded data model

Names are provisional; boundaries and invariants are fixed.

### 7.1 `order_payment_states`

One row per payable order, containing order, payer, business, market, immutable expected amount/currency and price-snapshot/version digest. It is provider-neutral.

State:

```text
unpaid -> payment_pending -> paid -> partially_refunded -> refunded
   ^            |
   +------------+  only when every attempt is conclusively closed and no money succeeded
```

- `paid` requires exactly one active primary payment application whose amount/currency equal the order snapshot.
- `partially_refunded` and `refunded` reflect **processed** refunds, not a request or provider queue response.
- Pending refund/payout information is exposed through its own projection, not by falsifying payment finality.
- A chargeback/dispute state is intentionally not invented. It is a Founder/provider/legal decision and an activation blocker if those events can affect launch payments.

### 7.2 Payment attempts and applications

The existing `payments` table should be treated as an unsafe precursor, not activated in place. A forward migration should either remodel it while empty or replace it with typed `payment_attempts`.

Attempt state:

```text
created -> initialization_pending -> awaiting_customer -> verification_pending -> succeeded
                         |                    |                 |
                         +-> init_failed      +-> failed        +-> refund domains only
                         +-> init_unknown     +-> cancelled
                                              +-> expired

any contradictory or late strong evidence -> manual_review
```

Rules:

- `created` stores the immutable order snapshot, provider/environment and generated reference before HTTP.
- `init_unknown` means the provider call outcome is uncertain; verify the same reference. Do not generate a replacement reference automatically.
- Only strong proof can enter `succeeded`. Browser success, initialization response and redirect arrival cannot.
- `failed`, `cancelled` and `expired` are conclusive only for the known evidence. A later signed success cannot be ignored; it records the attempt's money truth and enters manual review if automatic order application is no longer safe.
- Provider access codes and authorization URLs are secret-adjacent, short-lived server data. Do not place them in logs or durable public projections.

`payment_applications` binds a verified success to an order-purpose. The initial supported kinds are `primary_order_payment` and `unapplied_excess`.

- A partial unique invariant permits one active `primary_order_payment` per order.
- Multiple attempts may be genuinely successful. A second success is posted to unapplied customer funds, linked to an exception and offered for an approved refund workflow.
- A partial unique index directly on `payment_attempts(status = 'succeeded')` is **not** acceptable because a database conflict must not erase an actual second provider charge.

### 7.3 Provider deliveries and normalized events

**PROVISIONAL RECOMMENDATION:** Store exact valid webhook bytes in a restricted private-schema inbox as `bytea`, together with provider/environment, body SHA-256, signature verification result/version, minimal whitelisted headers, received timestamp, processing state, retry count and processing outcome. Parsed JSON is produced only after signature verification.

Two dedupe layers are required:

1. **Delivery dedupe:** unique provider/environment/body digest catches byte-identical retries.
2. **Semantic event dedupe:** a versioned server-derived key from provider event kind plus stable provider resource/reference/status/version timestamp where the event supplies sufficient identity.

The adapter must not assume every webhook has a universal provider delivery ID. If stable semantic identity is unavailable, resource locks, monotonic transition rules and unique domain posting/application keys still make processing idempotent. Every inbox row records one of: `applied`, `duplicate`, `ignored_stale`, `quarantined_unknown`, `mismatch`, `retryable_error` or `terminal_error`.

Raw bodies are never stored in a public table or application logs. Invalid-signature payloads are not retained as financial evidence; a minimized request fingerprint/count may be retained for abuse monitoring.

### 7.4 Refunds

Local refund state is deliberately distinct from provider state:

```text
requested -> approved -> submission_pending -> provider_pending -> processing -> processed
    |          |               |                    |
    +-> denied +-> cancelled   +-> submission_unknown
                                                   +-> needs_attention
                                                   +-> failed
```

- Only a verified successful payment can be refunded.
- Under locks, the sum of refund amounts in capacity-consuming states (`approved`, submission pending/unknown, provider pending, processing, needs attention, processed) cannot exceed the successful payment amount. Failed/denied/cancelled rows release capacity only after conclusive evidence.
- A partial refund has an explicit positive amount; never omit the provider amount and rely on a full-refund default.
- `processed` requires provider evidence and creates the cash-clearing journal exactly once. A provider `needs-attention` event creates a restricted operations task; customer bank details require a separately approved PII collection and retention design.
- A retry acts on the same internal refund and provider refund identity when supported. It does not create a second refundable amount reservation.
- Platform/vendor/referral reversals follow an approved refund-allocation policy. No proportional formula is assumed here.

### 7.5 Payouts

Payouts remain disabled. The provisional lifecycle is:

```text
draft -> approved -> submission_pending -> submitted/pending -> succeeded
  |         |               |                  |            |
  +->void   +->rejected     +->unknown         +->failed    +->reversed
```

- Approval requires eligible verified recipient/KYC data, payable balance, approved schedule/limits and an operator-control policy.
- A payout reserves a specific vendor/referral payable amount under lock before provider submission. Available balance equals posted payable less existing active reservations and processed payouts.
- The server creates one immutable 16–50 character provider reference. An inconclusive call is verified or retried with that same reference; a new reference would be a new payout and is prohibited without resolving/voiding the original.
- `succeeded`, `failed` and `reversed` are normalized through the adapter. Reversal after success is a valid later transition and posts compensating entries; it must not rewrite the original payout/journal.
- Whether the provider balance is reduced at submission or final success must be established from actual provider evidence and reconciliation. Ledger recognition follows the economic event, not an assumed status name.

### 7.6 Reconciliation

`reconciliation_runs` are immutable runs for a provider, environment, currency, time window and source artifact/API query.

```text
created -> running -> completed_clean
                   -> completed_with_differences
                   -> failed
```

Each run owns immutable `reconciliation_items`: `matched`, `missing_local`, `missing_provider`, `amount_mismatch`, `currency_mismatch`, `status_mismatch`, `duplicate_money`, `settlement_mismatch` or `manual_review`. Resolution adds actor, reason, evidence and compensating command/journal links; it never edits the original finding.

Reconciliation compares at least:

- successful provider charges vs attempts, applications and charge journals;
- refund amounts/statuses vs refund reservations and journals;
- transfers vs payout reservations/journals;
- provider settlement/balance movement vs clearing and bank accounts;
- order paid/refunded projections vs payment applications;
- ledger control totals vs domain source totals.

## 8. State-transition authority and out-of-order rules

| Domain transition         | Permitted initiator                                     | Required evidence                                                                         |
| ------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Create payment intent     | Active order buyer through server command               | Eligible frozen order; actor owns order; idempotency key; no active paid application      |
| Initialize/verify attempt | Trusted server worker/route                             | Stored attempt/reference; adapter schema validation; no client amount                     |
| Attempt to succeeded      | Signed webhook processor or server verifier             | Exact reference/amount/currency/environment/status plus provider-account binding          |
| Apply primary payment     | Private evidence-applier transaction                    | Verified success; order lock; expected total; no active primary application               |
| Record excess payment     | Private evidence-applier transaction                    | Verified success that cannot safely be primary                                            |
| Request refund            | Authorized customer-support/admin policy command        | Approved eligibility/reason/amount; payment/refund locks; idempotency key                 |
| Refund processed          | Signed webhook processor or server verifier             | Matching provider refund/payment/amount/currency/environment                              |
| Approve payout            | Restricted finance capability; dual control if approved | KYC/recipient/payable/limits/policy snapshot                                              |
| Submit/complete payout    | Trusted worker and signed/verified provider evidence    | Same reference; recipient/amount/currency/environment match                               |
| Post/reverse journal      | Private typed domain function only                      | Source evidence, journal kind, policy version, derived accounts/lines, unique posting key |
| Resolve reconciliation    | Restricted finance operations capability                | Finding, evidence, reason, actor and compensating action; never historical mutation       |

Out-of-order processing is monotonic:

- Replays return the already recorded result when the semantic input matches; a key collision with different input is an alert and rejection.
- A stale failure cannot regress a verified success or processed refund.
- A valid transfer reversal may follow success and creates a new transition plus compensating journal.
- An event for an unknown reference is retained and quarantined. It must not auto-create a payment/order association from provider metadata.
- Contradictory strong evidence enters reconciliation/manual review. The system preserves both observations and does not guess.

## 9. Concurrency and lock proof

### 9.1 Global rules

1. Never call Paystack or any external service while holding a database lock.
2. Acquire transaction advisory locks for idempotency/posting keys before row locks where needed.
3. For multiple rows of the same type, lock ascending UUID/reference order.
4. Use one consistent aggregate order:

```text
idempotency/reference key
-> order
-> order_payment_state
-> payment attempt/application
-> refund or payout rows
-> ledger accounts in ascending UUID
-> journal/posting key
```

5. The valid webhook inbox insert/dedupe commits before asynchronous processing. Event application later follows the aggregate order above.
6. Keep transactions short; expensive JSON parsing, signature verification and provider HTTP occur before the atomic database apply command, while the command revalidates all immutable evidence fields.

### 9.2 Race proofs

**Two payment initializations:** the same client idempotency key returns the same attempt. Different keys may create multiple awaiting attempts, but the order lock and primary-application uniqueness permit only one verified success to satisfy the order. Any other verified success is preserved as excess/unapplied.

**Webhook and server verify arrive together:** both derive the same semantic evidence/application/posting keys. One transaction applies; the other observes an exact replay. A mismatched replay quarantines and alerts.

**Two partial refunds:** both lock payment then existing active refunds in deterministic order. The second recomputes reserved plus processed amount after the first commit and cannot exceed the verified charge.

**Two payouts:** both lock payee/currency payable state and active reservations. Only available unreserved posted balance can be reserved. Same idempotency key replays; different keys cannot over-reserve.

**Journal replay:** one typed domain command derives a stable posting key such as `paystack:{environment}:{event-kind}:{resource}:{purpose}`. Exact replay returns the journal; different facts under the same key are rejected and alerted.

## 10. Ledger contract

### 10.1 Account taxonomy

Every account has immutable `purpose`, `owner_type`, optional `owner_id`, currency and scope. Codes are display/lookup identifiers, not authorization. Account purposes allowed for the first payment scope are:

| Class     | Purpose                    | Owner                                                       |
| --------- | -------------------------- | ----------------------------------------------------------- |
| Asset     | `provider_clearing`        | LocalHub + provider/environment/currency                    |
| Asset     | `operating_bank`           | LocalHub + verified bank account/currency                   |
| Liability | `unapplied_customer_funds` | LocalHub control account, with source application subledger |
| Liability | `order_funds_payable`      | Order/business subledger; not named or marketed as escrow   |
| Liability | `vendor_payable`           | Business/currency                                           |
| Liability | `referral_payable`         | Qualified beneficiary/currency                              |
| Liability | `customer_refund_payable`  | Refund/customer subledger                                   |
| Liability | `payout_in_transit`        | Payee/provider/currency                                     |
| Revenue   | `platform_fee_revenue`     | LocalHub/currency                                           |
| Expense   | `processor_fee_expense`    | LocalHub/provider/currency                                  |

**FIXED SAFETY INVARIANTS**

- System account creation is migration- or tightly governed setup-RPC-only. Service role cannot create arbitrary accounts.
- Purpose, owner, type and currency become immutable once referenced.
- A typed journal kind has an allow-list of account purposes and directions.
- Account balances are always derived from immutable entries. No mutable balance column is authoritative.

### 10.2 Journal envelope

The journal model must add or guarantee: one `journal_kind`, one currency, source evidence type/ID, effective/provider timestamp, recorded timestamp, policy version, immutable posting key, optional actor/reason for human decisions, and reversal linkage.

Descriptions are presentation only. They are not evidence or authorization and must not contain sensitive customer/provider payloads.

### 10.3 Posting templates

Let:

- `A` = independently verified gross customer payment;
- `V` = approved vendor earning;
- `F` = approved LocalHub platform fee;
- `R` = approved referral earning;
- `P` = verified processor fee;
- `N` = verified net settlement;

No rule may invent `V`, `F`, `R`, `P` or their recognition time. When allocation is approved, `A = V + F + R` for the allocated amount, with zero-value components omitted rather than posted as zero lines.

| Economic event                                                 | Debit                                           | Credit                                                             | Gate                                                           |
| -------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------- |
| Verified charge                                                | Provider clearing `A`                           | Unapplied customer funds `A`                                       | Strong success proof; exactly once per provider charge         |
| Apply charge to order                                          | Unapplied customer funds `A`                    | Order funds payable `A`                                            | One primary application; exact order amount/currency           |
| Recognize approved allocation                                  | Order funds payable `A`                         | Vendor payable `V`; platform fee revenue `F`; referral payable `R` | Approved recognition point and snapshotted fee/referral policy |
| Verified processor fee                                         | Processor fee expense `P`                       | Provider clearing `P`                                              | Provider statement/transaction evidence; no estimate           |
| Verified settlement                                            | Operating bank `N`                              | Provider clearing `N`                                              | Bank/provider settlement reconciliation                        |
| Establish approved refund payable from unallocated/order funds | Unapplied customer funds or order funds payable | Customer refund payable                                            | Approved refund; source still available                        |
| Process provider refund                                        | Customer refund payable                         | Provider clearing                                                  | Matching processed refund evidence                             |

If funds were already allocated, the approved refund policy derives a compensating allocation journal that debits the proper vendor payable, revenue/contra-revenue and/or referral payable sources and credits customer refund payable. This contract deliberately does not choose who absorbs processor fees or a refund.

Payout reservation is a subledger hold, not an accounting entry by itself. When provider evidence proves the relevant economic movement, the typed payout template moves vendor/referral payable through payout-in-transit and then reduces provider clearing. Failure or reversal uses linked compensating journals according to what actually moved; provider submission status alone is not assumed to be cash movement.

### 10.4 Posting API boundary

The reusable balance/reversal engine may remain an internal database implementation detail, but service-facing commands are domain-specific, for example `apply_verified_charge`, `apply_processed_refund`, `apply_provider_settlement`, `apply_completed_payout` and `reverse_finance_event`.

Each command receives source IDs and expected version—not line JSON or account IDs—and performs all of the following in one transaction:

- re-authorizes trusted execution context;
- locks and re-reads the domain aggregate;
- validates transition and source evidence;
- resolves accounts by controlled purpose/owner/currency;
- derives and validates lines;
- posts or exactly replays one journal;
- links journal to the domain event;
- records a redacted audit event.

## 11. Authentication, RLS, grants and projections

### 11.1 Write boundary

- Keep RLS enabled with no direct app-role policies on all raw finance tables.
- Revoke direct DML from `anon`, `authenticated` and `service_role`. A service credential may execute only narrow private/server commands required for its job.
- Revoke service execution of the generic caller-composed `post_journal`/`reverse_posted_journal` surface. Restrict balance helpers and ledger engine functions to an internal owner role/private schema.
- Every `SECURITY DEFINER` command has a fixed empty search path, fully qualified objects, explicit execute revokes, strict argument validation, bounded inputs and a role/context check.
- Webhook authorization is the valid Paystack signature plus configured environment/account binding. It is not a user session.
- Scheduled reconciliation/payout workers use dedicated command capabilities and separate secrets where the platform permits; they do not receive a generic finance mutation API.
- Ordinary `super_admin` status is insufficient for raw finance mutation. Any manual refund/payout/reconciliation capability must be separately approved, audited, reason-bound and preferably dual-controlled above approved thresholds.

### 11.2 Read boundary

No client reads raw provider payloads, webhook inbox, ledger accounts/entries, bank/recipient data or internal reconciliation notes.

Future read-only security-definer projections may expose:

- **Customer:** own order number, expected/paid/refunded amount and currency, payment/refund display status, timestamps and safe next action. Never full provider payload, other payer data, secret/access code or internal fraud/reconciliation detail.
- **Vendor member:** only orders belonging to an active membership business, payment availability state and recognized/paid/pending earning totals supported by posted ledger/application facts. Never customer bank/card/provider payload or another business's accounts.
- **Finance operator:** capability-scoped queues and evidence digests; raw sensitive evidence only through a separately audited break-glass path.

Every projection rechecks active profile, ownership/membership/capability and returns normalized display states—not raw provider statuses.

## 12. Audit, privacy, retention and observability

### 12.1 Audit and evidence

Audit every finance command with request/idempotency key digest, actor or trusted system principal, aggregate IDs, old/new normalized state, source evidence digest, journal ID, outcome and redacted reason. Do not put secrets, signatures, authorization URLs, access codes, full email/phone, card/bank data or raw webhook bodies in audit/log text.

Provider raw evidence belongs in a restricted private store. Application errors use stable internal correlation IDs. UI errors are generic and never reveal whether a provider reference, customer or account exists.

### 12.2 Retention

**FOUNDER / LEGAL DECISION:** financial record, webhook raw-body, provider evidence, refund bank-detail, audit and reconciliation retention periods must be approved for LocalHub's operating jurisdictions and provider contract.

**PROVISIONAL RECOMMENDATION:** retain exact webhook bytes only for the minimum approved operational evidence window (candidate 30–90 days), then cryptographically erase/delete them while retaining the body digest, normalized event, processing outcome and immutable financial history. Ledger journals/entries and legally required financial/audit records use the approved statutory period; this contract does not invent a duration. Deletion jobs must be dry-run capable, bounded, audited and must never delete posted journal/event referential evidence.

### 12.3 Metrics and alerts

Track without PII:

- invalid-signature rate and provider/environment;
- valid inbox insert failures, oldest unprocessed age, retry/dead-letter counts;
- verification latency/error/mismatch rate;
- duplicate delivery and semantic replay rate;
- excess/unknown-reference charges;
- stuck payment/refund/payout states;
- journal collision/rejection and any balance invariant failure;
- provider clearing vs settlement difference;
- reconciliation difference count/value/age;
- manual finance action and break-glass use.

Page immediately on valid webhook persistence failure, verified amount/currency/environment mismatch, unexplained duplicate money, journal invariant violation or payout/refund amount breach. Provider outage and delayed event delivery should degrade to `pending`/reconciliation, not false failure or false success.

## 13. Failure recovery

| Failure                                                  | Required behavior                                                                                                               |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Initialization timeout                                   | Keep same reference in unknown/verification-pending state; verify/requery before retry or replacement                           |
| Callback arrives before webhook                          | Show pending; server may verify; never succeed from URL alone                                                                   |
| Valid webhook DB insert fails                            | Return non-2xx; alert; rely on provider retry                                                                                   |
| Inbox persisted, worker crashes                          | Retry from durable inbox; exact semantic/domain keys make apply idempotent                                                      |
| Event parser sees unknown type/status                    | Quarantine raw/normalized evidence; no transition; alert and reconcile                                                          |
| Provider says success but amount/currency/domain differs | Record mismatch/manual review; do not apply to order or deliver value                                                           |
| Two real successes for one order                         | Record/post both; apply one primary; classify other as unapplied customer funds; alert/refund under policy                      |
| Journal apply fails                                      | Roll back domain transition/event outcome together; retry from inbox; never mark evidence applied without journal               |
| Refund/transfer request times out                        | Keep reservation and same operation reference; verify before retry; never release capacity on ambiguity                         |
| Transfer later reverses                                  | Append reversal transition and compensating journal; restore payable only when matching economic evidence supports it           |
| Reconciliation finds difference                          | Freeze affected automation where appropriate; create finding; investigate; correct with linked compensating action, never edits |

## 14. Adversarial verification matrix

Before activation, automated migration/contract/integration tests must prove:

1. Browser-supplied amount, currency, payer, provider reference, callback target, order/business/market mismatch and unsupported provider are rejected.
2. Anonymous/authenticated/vendor/ordinary admin cannot read or write raw finance tables or execute finance mutation functions.
3. Service role cannot direct-insert/update/delete payments, events, inbox, accounts, commissions, journals or entries and cannot call generic line-composed posting.
4. Security-definer commands have empty search paths, explicit grants and resist object shadowing/search-path injection.
5. Signature verification uses the exact body bytes and constant-time comparison; wrong/missing/malformed/replayed signatures and parse-before-verify attempts fail.
6. Valid webhook dedupe is durable before 2xx; simulated DB failure returns non-2xx; a worker crash after insert replays safely.
7. Callback GET does not mutate; fake success query parameters do not deliver value; secrets never appear in URL, `Location`, logs or client payload.
8. Reference, amount, currency, environment/domain and provider-account mismatches cannot enter success.
9. Same delivery, semantically duplicate delivery, webhook/verify race, stale failure after success and unknown event/status are safe and auditable.
10. Two concurrent initializations cannot duplicate one idempotency intent; two genuine successes are both recorded while only one is applied to the order.
11. Concurrent partial refunds cannot reserve/process more than the verified charge; failed/unknown refund behavior preserves capacity correctly.
12. Concurrent payouts cannot exceed unreserved posted payable; inconclusive retries reuse the same reference; success then reversed posts compensation once.
13. Each journal template accepts only its permitted purposes/directions, one currency, positive lines and balance; cross-owner/cross-business/cross-currency accounts fail.
14. Posted evidence/journals/entries and account identity fields are immutable; corrections require linked reversals.
15. Customer/vendor projections enforce ownership, active membership/profile and minimum disclosure; cross-user/business access fails.
16. Raw webhook/body/PII/signature/access code cannot appear in logs, audit, public tables, generated types or client bundles.
17. Reconciliation detects missing local/provider records, duplicates, amount/currency/status and settlement differences and cannot silently auto-resolve them.
18. Migration rollback probe proves no finance path becomes partially writable if a migration fails.

Representative concurrency tests must run two independent database sessions; SQL substring tests are insufficient. A hosted test-mode Paystack E2E remains an external activation gate and must use test credentials only.

## 15. Dormant migration slices

The first Step 23 migration **quarantines**, rather than activates, the existing finance foundation.

### Slice A — complete and verified live

1. Asserted all seven finance/ledger/referral tables were empty, with a clear reconciliation-required abort otherwise.
2. Revoked every effective application table/column privilege across the seven tables. No read access was regranted because app/lib search found no current consumer.
3. Revoked `service_role` execution of generic `post_journal`, `reverse_posted_journal`, and exposed ledger comparison helpers. No generic replacement was granted.
4. Changed the payment-event/payment deletion relationship from cascade to restrict and added the private append-only evidence guard.
5. Added explicit dormant-execution comments/contract assertions and hosted ACL/function-metadata probe coverage.
6. Regenerated hosted database types. The public symbol set remained 51 tables/70 functions; the new private trigger function is intentionally absent. No account, provider route, or finance row was created.

**Verified result:** Migration 027 is applied on `exftgbfhmneweilsebjw`. Rollback rehearsal and the complete post-apply probe pass with all seven table counts at zero, generic execution closed, effective application privileges at zero, payment-event FK `RESTRICT`, the private append-only trigger active, and no provider/account/journal/transaction side effect. Sol finance/security verdict: P0/P1/P3 PASS. The P2 two-physical-session activation test remains outstanding because the available MCP path serialized the attempted contention probe.

This slice is forward-only because verified production counts are zero. Its rollback is the migration rollback in an isolated branch/local database; production rollback must not re-grant unsafe mutation authority. If the zero-row assertion fails in a future environment, stop and perform a separately approved data audit/backfill plan.

### Slice B1 — complete and verified live, still dormant

Migration 028 introduces only provider-neutral canonical order-payment state, typed attempts/applications, and four private enums. It adds no provider evidence, account taxonomy, journal envelope, route, command, application grant, or transaction. Its three tables remain empty and deny-by-default.

### Slice B2 — complete and verified live, still dormant

Migration 029 introduces only private signed-delivery envelope, separately purgeable exact-byte payload, and minimized normalized-event structure with exact digest/length, exact and semantic dedupe, attempt binding/quarantine, forced RLS, zero policies/grants, owner mutation/truncate guards, and no callable ingestion command or route. All tables remain empty.

### Slice B3 — complete and verified live, still dormant

Migration 030 introduces controlled account purposes, journal envelopes, and inherent equal posting pairs only. It introduces no callable posting command or seed. Refund, payout, reconciliation, and referral posting remain excluded.

### Slice C — activation, separately authorized

Configure test-only Paystack credentials and webhook, run provider E2E/replay/reconciliation tests, approve commercial/legal policies, then use an explicit launch change with monitoring and kill switch. Live credentials and production transactions require Founder authorization.

## 16. Rollback and kill switch

- **Pre-activation:** migrations run on an isolated branch/local reset first; schema verification and ACL tests must pass before hosted apply. No unsafe privileges are restored to “fix” a failing test.
- **Provider kill switch:** initialization, refund and payout submission have separate server-side feature flags. Disabling submissions must leave signed webhook receipt, verification, reconciliation and customer-safe status reads operational.
- **Finance kill switch:** if typed ledger posting is unhealthy, persist valid provider inbox evidence and return pending/manual review; do not deliver value without the atomic domain+ledger apply.
- **Migration failure:** transactional DDL rolls back. A post-apply verification failure blocks activation and triggers an additive repair migration, not destructive history editing.
- **Bad rule/policy:** retire the version for new events; preserve snapshots; post linked corrections/reversals under approved authority.

## 17. Explicit exclusions

This contract does not implement or approve:

- Paystack credentials, dashboard/webhook changes, live or test transactions;
- escrow, wallet, stored-value, trust-account or regulated custody claims;
- cards, bank details, addresses, inventory reservation, delivery/carrier proof or notifications;
- split payments, subaccounts, dedicated accounts, direct charge, subscriptions, instalments, deposits, multi-currency or multiple primary payments per order;
- fee percentages, tax/VAT treatment, referral percentages/windows, vendor recognition timing, refund absorption or payout schedules;
- chargeback/dispute handling, KYC vendor, sanctions/fraud engine, recipient management or manual bank transfer;
- automated payout/refund approval, provider fund movements or settlement assumptions;
- retroactive paid/earning state for existing orders;
- frontend claims that payment, refund, earning or payout works before the corresponding hosted/provider E2E is verified.

These exclusions preserve value: the model deliberately leaves safe extension points without pretending unapproved financial operations exist.

## 18. Founder, legal and provider decisions

The following decisions are required before their dependent capability is activated. They do not block Slice A.

1. Approve Paystack as provider, business account ownership, test/live progression, supported channels and webhook/operator ownership.
2. Confirm launch currency/market (recommended first scope: one configured currency per order; NGN only if approved) and whether initial orders require one full payment only.
3. Approve when payment becomes required relative to order confirmation/processing and what customer value may advance after payment.
4. Approve platform-fee formula, fee bearer, recognition timing, tax/VAT treatment and immutable policy-version behavior.
5. Approve vendor earning recognition, holds/reserves, payout eligibility, schedule, min/max, KYC/recipient source and dual-control thresholds.
6. Approve referral qualification, percentage/formula, duration, reversal rules, fraud controls and earning/payout timing.
7. Approve refund eligibility/authority, partial/full behavior, customer timeline wording, and who absorbs provider/platform/vendor/referral amounts and fees.
8. Decide chargeback/dispute/late-success policy and whether those Paystack events are in launch scope.
9. Obtain legal/accounting review of the liability/revenue recognition model, customer/vendor terms, custody characterization and explicit no-escrow language.
10. Approve raw webhook, financial, audit, reconciliation and refund bank-detail retention/access/deletion periods.
11. Approve reconciliation sources, cadence, responsible operator, difference thresholds, incident path and settlement bank evidence.
12. Approve finance capabilities, dual control, break-glass access, reason requirements and incident owners.
13. Confirm the authoritative server-side customer email source required for provider initialization and its privacy treatment.

## 19. Architecture trade-offs

### Separate canonical payment state from provider attempts

- **Pros:** provider-neutral order truth; safe retries/multiple attempts; honest handling of duplicate charges; clearer refunds/reconciliation.
- **Cons:** more tables and projections than mutating one `payments` row.
- **Alternative rejected:** one mutable payment row per order. It cannot safely represent initialization uncertainty, multiple attempts or an excess real success.
- **Decision:** adopt the separation.

### Durable raw-byte inbox plus normalized events

- **Pros:** signature/audit fidelity, quick acknowledgement, crash recovery and adapter-version reprocessing.
- **Cons:** sensitive payload storage and retention burden.
- **Alternative rejected:** parsed JSON only. Re-serialization cannot prove the exact signed bytes and encourages public-schema PII retention.
- **Decision:** private, access-controlled, time-bounded raw evidence plus durable minimized normalized history.

### Typed domain posting over generic journal RPC

- **Pros:** balance plus business authorization, ownership, taxonomy and idempotency; smaller blast radius.
- **Cons:** a command/template per economic event.
- **Alternative rejected:** expose balanced arbitrary lines to service role. Balanced fraud/error remains balanced.
- **Decision:** keep the generic engine internal and expose only typed commands.

### Preserve every real success, apply one to the order

- **Pros:** accounts for actual money and avoids losing a duplicate charge due to a uniqueness error.
- **Cons:** requires unapplied-funds liability and exception operations.
- **Alternative rejected:** one-succeeded-attempt constraint. A constraint cannot make a second provider charge cease to exist.
- **Decision:** record all verified successes; one primary order application in initial scope.

## 20. Risk register

- **P0 — PASS in the dormant production state.** There is no implemented provider ingress, transaction path or finance data to corrupt.
- **P1/P2 — PASS for dormant Slice B3.** Two independent final reviews found no P0/P1/P2. The optional P3 exact legacy payment-event FK column binding was closed before apply.
- **Activation gates:** Founder/provider/legal/accounting approval and credentials; constant-time verification; identifier PII/retention controls; typed atomic command/ACL; true two-session concurrency; provider E2E; monitoring; and kill switch.
- **Performance watch:** three existing B1 composite-FK INFOs remain reviewed; B3 adds only an intentional unused index on empty posting pairs.

Slice A/B1/B2/B3 and their independent reviews close the dormant-foundation work. Step 24 activation remains blocked until every activation gate closes; no provider route or mutation command is granted.

## 21. Activation definition of done

Payment remains **not ready** until all of the following are true:

- Slice A/B1/B2/B3 schema, ACL, transition, concurrency, migration and projection tests pass locally and on the authoritative hosted project with no production finance rows created by testing.
- All P1 blockers are closed and independently security-reviewed.
- Required Founder/legal/accounting/provider decisions are recorded and versioned.
- Test-mode Paystack initialization, signed webhook replay, verify fallback, duplicate/out-of-order, amount/currency/domain mismatch, refund and reconciliation journeys pass.
- Customer/vendor UI uses truthful pending/paid/refunded/earning language and does not imply escrow or payout completion.
- Monitoring, incident ownership, reconciliation cadence, kill switches, backup/restore and rollback probes are verified.
- Live activation is a separate Founder-authorized change.

Until then, LocalHub may accurately say it has a **dormant internal ledger foundation and a documented architecture contract**. It may not say that Paystack, payments, refunds, vendor earnings, referral earnings, payouts, settlement or escrow are operational.

Step 25's separately bounded non-financial referral identity/link/disclosure foundation is live without commission posting, earning recognition, payout, or payment activation. Step 24 remains externally blocked. Master Step 26 in-app notifications is live through fixed transactional producers, with external delivery disabled. The current autonomous boundary is the Master Step 27 privacy-bounded operational demand-evidence contract; it must not add referral attribution, missions, credit, rewards, commissions, money movement, or AI.

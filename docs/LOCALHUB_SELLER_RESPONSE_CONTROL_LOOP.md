# LocalHub Seller Response Control Loop v1

## Scope

This slice proves a deterministic seller-response workflow on top of the
LocalHub–ORBIT bridge without activating a production provider or database
migration.

Agent authority is fixed in code:

- **ATLAS** is the sole orchestrator.
- **ORDERGUARD** owns the order-related case.
- **SHOPKEEPER** owns seller communication and fallback handling.

Callers cannot replace these roles.

## State and event contract

Every case has a caller-supplied `lh-case-<lowercase-id>` identifier (one to 128
lowercase letters, digits, or internal hyphens after the prefix) and is bound to
one order, seller, approved request template, request time, and timeout. The v1
state flow is:

```text
awaiting_seller -> seller_responded
awaiting_seller -> fallback_queued
```

The loop emits immutable `1.0.0` envelopes for:

- `seller.request_sent`
- `seller.responded`
- `seller.request_missed`

Every event includes the case ID, authoritative order aggregate ID, fixed agent
routing, source-event identity, command idempotency key, and bounded evidence.

## Retry and concurrency rules

- Commands are serialized first by global idempotency key and then by case, so
  cross-case collisions cannot pass the ledger through an asynchronous sink.
- One idempotency key is bound to one normalized command fingerprint.
- An exact retry returns the recorded result with `replayed: true`.
- Reusing a key for different work fails closed.
- The simulator has its own idempotency ledger as a second duplicate-work guard.
- The v1 factory constructs the concrete simulator internally and rejects any
  injected provider, including one that merely claims simulation mode.
- Event admission is idempotent in the simulator sink.
- The seller-loop sink contract requires idempotent admission. If a sink commits
  and then reports an uncertain failure, an exact retry may re-attempt ingestion
  with the same event key but must not admit a second event.
- A timeout check before the deadline records only its idempotent `not_due`
  command result and writes no case event, audit row, or fallback. An exact retry
  replays that result; a later observation uses a fresh idempotency key.
- Once a response or missed timeout resolves the case, the competing path cannot
  produce an event or fallback.
- A seller response is accepted only from the request time up to, but not
  including, the timeout. Backdated, at-deadline, and late responses fail closed.

## Fallback and audit evidence

A missed request queues one simulator-only `manual_review` fallback. Audit
evidence records the case, event, time, idempotency key, fixed agent routing,
simulator reference, and explicit proof that no outbound message, ranking
penalty, or payment mutation occurred. Audit and event snapshots are immutable.

No raw message body, recipient address, credential, payment detail, or provider
secret is accepted or stored by this slice.

## Deliberate exclusions

- No email, SMS, WhatsApp, push, voice, or other outbound request
- No seller ranking or reputation mutation
- No payment, refund, payout, ledger, or order-state mutation
- No Supabase or production migration
- No scheduler, webhook, HTTP route, deployment, or provider credential
- No automatic retry policy outside explicit idempotent command replay

## Verification

```bash
npm test -- tests/seller-response-control-loop.test.ts tests/orbit-localhub-bridge.test.ts
npm run typecheck
```

The behavioural tests prove role routing, immutable evidence, exact response and
timeout event sequences, fail-closed provider mode, idempotency-key binding, and
sequential/concurrent retry deduplication across provider work, event admission,
case state, fallback work, and audit rows.

## Remaining next action

The independent code and TypeScript reviews are complete. The remaining next
action is Founder approval to push this branch for remote review. Any durable
store, real provider adapter, scheduler, production migration, external message,
ranking consequence, or payment connection requires a separate Founder-approved
slice.

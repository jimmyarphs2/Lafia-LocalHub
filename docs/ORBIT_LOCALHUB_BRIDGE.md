# LocalHub–ORBIT bridge

This branch adds the first narrow connection between the LocalHub company module and the independent ORBIT OS core.

## What it does

- Maps an authoritative LocalHub merchant-onboarding observation to the versioned ORBIT event envelope.
- Uses `sourceEventId` as the idempotency key.
- Freezes the admitted envelope and its nested payload/source/subject objects.
- Exposes a transport-neutral `OrbitEventSink` composition boundary.
- Performs no message send, database migration, provider call, or other external mutation.

The first event is:

`localhub.merchant.onboarding_stalled`

The ORBIT policy may later recommend `localhub.notify_merchant` after the approved 24-hour threshold. This adapter only records the observation; approval and the final mutation guard remain ORBIT responsibilities.

## Why there is no direct package import yet

The ORBIT core repository is intentionally independent and currently private/unpublished. A direct dependency from LocalHub would make CI and deployment depend on an unavailable package artifact. This branch therefore establishes the stable adapter contract first. Once the core package has a versioned distribution channel, the composition root can pass its `EventEngine` as the sink without changing LocalHub domain code or event semantics.

## Preserved boundaries

- LocalHub remains the source of merchant, listing, onboarding, and authorization truth.
- ORBIT remains the owner of generic event admission, memory, decisions, approvals, mutation guards, audit, and execution modes.
- No production migrations or external messaging are enabled by this branch.

## Seller Response Control Loop v1 extension

The seller response slice composes with the same transport-neutral sink through
`lib/orbit/seller-response-control-loop.ts`. It does not change the onboarding
event or bridge method. The sink interface is generic only so each versioned
LocalHub event family can retain its exact payload contract.

The extension fixes ATLAS as the sole orchestrator, assigns ORDERGUARD to the
case, and assigns SHOPKEEPER to seller communication. Its provider is required
at runtime to declare simulation mode. The simulator records no real recipient
and cannot send an external message.

The admitted event sequence is:

- `seller.request_sent`
- `seller.responded`, when the simulated seller response is recorded
- `seller.request_missed`, when the deadline passes first

The missed path queues an in-memory `manual_review` fallback only. It does not
apply a seller ranking penalty, collect or mutate payment, run a migration, or
contact anyone.

## Verification

Run the focused test and typecheck commands in the LocalHub repository:

```bash
npm test -- tests/orbit-localhub-bridge.test.ts
npm run typecheck
```

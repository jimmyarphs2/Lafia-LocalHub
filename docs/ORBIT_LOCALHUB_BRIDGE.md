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

## Verification

Run the focused test and typecheck commands in the LocalHub repository:

```bash
npm test -- tests/orbit-localhub-bridge.test.ts
npm run typecheck
```

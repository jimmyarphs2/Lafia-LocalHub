# LocalHub controlled tool gateway contract

## Status and boundary

Step 28 establishes an internal, server-only gateway boundary for future ATLAS
and specialist-agent integrations. The first slice implements exactly one GREEN
tool: `get_platform_summary`.

This slice does **not** expose an HTTP endpoint, invoke an AI provider, contact a
customer or vendor, publish content, mutate commerce/catalog/admin domain state,
or receive a Supabase service-role, payment, messaging, infrastructure, or model
credential.

`get_platform_summary` is domain-read-only. Its only permitted database writes
are control-plane writes:

1. one bounded fixed-window limiter row per authenticated actor; and
2. canonical immutable audit evidence for quota-admitted outcomes, plus at most
   one `rate_limited` transition event per actor/window.

## Invocation contract

The provider-neutral request is:

```text
{
  contractVersion: 1,
  tool: "get_platform_summary",
  input: { marketSlug: canonical-lowercase-market-slug }
}
```

The gateway generates a UUIDv4 invocation identifier internally. Callers cannot
choose it. The server boundary authenticates the cookie-scoped user with
`auth.getUser()`, and the database independently requires:

- the Postgres JWT role to be exactly `authenticated`;
- a non-null `auth.uid()`;
- an existing, non-suspended profile; and
- the exact `super_admin` capability.

Authorization happens before rate limiting. Rate limiting happens before market
input validation or lookup so a caller cannot use rejected requests as an
unmetered market-existence oracle. The TypeScript boundary rejects malformed
input before RPC execution; direct authenticated RPC calls are still metered and
record a bounded `invalid_input` event without persisting the raw input.

The database result has one of four bounded outcomes:

- `succeeded`: exact active-market aggregate and a non-null audit-event ID;
- `market_not_found`: no market fields/counts and a non-null audit-event ID;
- `invalid_input`: no raw input, market fields, or counts and a non-null audit ID;
- `rate_limited`: no market fields/counts; only the first transition in a window
  creates an audit row, preventing write amplification after quota exhaustion.

Unexpected database, transport, or response-contract failures abort/discard the
result. The dispatcher emits only a stable event code, generated invocation ID,
and canonical tool name to its control-plane observer. It never logs the actor,
market slug, request body, cookies, credentials, SQL/provider errors, or response.

## Returned data

On success the tool returns only these non-PII, market-scoped facts:

- active market ID, canonical slug, and public name;
- public country code, currency code, and timezone;
- active public category count (global or belonging to the market);
- active approved vendor count;
- active, published listing count for active vendors and categories; and
- the subset currently eligible for the existing direct-order contract.

It does not return users, profile/contact details, addresses, memberships,
orders, revenue, payments, ledger data, demand records, pending-review totals,
incidents, credentials, or a claim of platform/system health.

## Rate and audit rules

The fixed window admits at most 60 invocations per actor per UTC hour. The single
limiter row is capped at the first denied transition; subsequent denied calls in
that window perform no database write. The window resets in place and does not
create an unbounded history table.

Audit evidence uses `public.audit_events` with:

- `subject_type = 'tool_gateway_invocation'`;
- `subject_id =` the internally generated invocation UUID;
- `action = 'tool.get_platform_summary'`;
- `actor_id = auth.uid()`; and
- exact metadata containing only contract version, canonical tool name, outcome,
  and `market_id` on success.

An `ENABLE ALWAYS` trigger admits those rows only from the exact owner-executed
RPC invocation context and makes them immutable. A successful database result is
not returned unless its audit insert succeeded in the same transaction.

## Action classes

- **GREEN:** bounded read/research/summarize/draft/recommend operations. They may
  execute only after their own authorization, scoping, rate, output, and audit
  contracts are implemented and verified.
- **YELLOW:** spending, pricing, referral/promotion activation, external contact,
  or publishing. They require an explicit Founder/admin approval artifact and a
  separately verified execution contract.
- **RED:** deletion, money transfer, credential access, irreversible
  infrastructure/destructive operations, or security-control changes. They are
  not exposed by this gateway and always require explicit authorization.

The registry may describe future tools, but only entries marked `implemented`
are executable. The executable `ReadonlyMap` contains exactly
`get_platform_summary`; deferred/prohibited names are catalogue metadata, never
disabled handlers. Documentation is never treated as proof of live capability.

The dispatcher executes once with a fixed five-second deadline. It passes the
same cooperative `AbortSignal` to the Supabase RPC and performs no hidden retry.
Timeouts and late responses are discarded with a stable, redacted error.

## Activation gates beyond this slice

Before any external agent/provider is connected, LocalHub still requires an
approved provider data policy, prompt/tool-injection review, cost and concurrency
budgets, retention policy, end-to-end authorization tests, operational alerting,
and a final independent security review. YELLOW/RED tool execution remains
disabled until its specific approval architecture is Founder-approved.

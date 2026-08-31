# LocalHub external setup

**Last updated:** 2026-08-31

External production setup is incomplete. Never commit credentials or expose server secrets through `NEXT_PUBLIC_` variables.

## Supabase

The authoritative project is LocalHub, ref `exftgbfhmneweilsebjw`, region `eu-west-1`. The ignored `.env.local` contains the project URL and modern publishable-key binding. No service-role key is configured. A service-role runtime secret remains an external blocker for cleanup and any future explicitly approved privileged server route and must be supplied through an approved secret store. The current admin triage queue uses the authenticated user session and does not require that secret.

Thirty-seven migrations are live, newest `20260831133056 localhub_unmet_demand_capture`, with 51 public plus 25 private tables; all 76 have RLS enabled. The six legacy search/demand/mission tables and two private definition tables remain isolated. The zero-row public notification inbox has active-self forced RLS and fixed in-app producers on five approved commerce boundaries; the zero-row private delivery ledger is policy-free, application-inaccessible, excluded from Realtime/public types, and mutation-blocked. The zero-row private unmet-demand marker is also policy-free/application-inaccessible and has one authenticated-only fixed writer. No external send exists.

## Authentication

Hosted Auth site URL/redirect allowlist and Google/Facebook credentials are not configured. Configure them in the authorized provider and Supabase Auth consoles, then verify email, Google, Facebook, callback failure, duplicate identity, logout, recovery, and exact post-auth intent resumption. This remains `BLOCKED_EXTERNAL`.

## OpenAI

AI is **NOT STARTED**. The application makes no OpenAI request. The configured local OpenAI credential remains ignored and server-only; `OPENAI_MODEL` remains environment-configurable. Preserve the explicit report-before-AI gate and do not begin the AI abstraction until the Founder releases that checkpoint.

## Other providers and hosting

Payment, messaging/OTP, maps, cleanup scheduler/secret, trusted ingress/HMAC, domain/deployment, monitoring, and hosted E2E are not verified. Live market/category/business data is also absent by design. Paystack/payment, legal, referral, payout, dispute, refund, and provider-spend decisions require Founder approval before activation.

## Founder checkpoint

The pre-AI Founder checkpoint remains closed. The OpenAI key is present only in ignored local environment configuration; `OPENAI_MODEL` remains environment-configurable and no OpenAI call exists. Step 23 is complete/live through B3. Step 24 Paystack activation remains blocked by Founder/provider/legal/accounting approvals and credentials plus verifier/privacy/retention, typed atomic command/ACL, concurrency, provider E2E, monitoring, and kill-switch evidence. Step 25 referral identity/link/disclosure is complete/live without attribution or economics. Master Step 26 in-app notifications is complete/live through Slice 26B. Master Step 27’s minimal category/day demand writer is complete/live without raw queries, identity, missions, attribution, provider activity, finance, or AI. Codex may continue with Step 28’s provider-neutral Tool Gateway contract/implementation only. No external send, referral attribution capture, mission activation, credit, reward, commission, earning, journal, payout, payment activation, unrestricted credential exposure, or AI invocation is authorized.

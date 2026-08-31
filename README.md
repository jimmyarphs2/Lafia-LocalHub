# LocalHub

LocalHub is a demand-first local commerce platform. Its first configured launch market is Lafia, Nasarawa State, Nigeria; Lafia is market data, not the platform brand.

## Repository status

This repository contains the audited LocalHub foundation and is being continued toward **LocalHub — Ready to Ship**. The current work is not a completed marketplace: the live Supabase foundation is verified, while hosted authentication, legitimate marketplace data, production UI completion, and public deployment remain incomplete.

Verified checkpoint (2026-08-31): the authoritative Supabase project is LocalHub, ref `exftgbfhmneweilsebjw`, region `eu-west-1`; 30 migrations are live, with 51 public and 19 private tables. All 70 tables are RLS-enabled; all nine B1/B2/B3 private tables force RLS. Step 23's dormant foundation is complete through B3: quarantined finance surfaces, canonical payment/attempt/application structure, minimized provider evidence, and typed commerce-ledger account/journal/posting-pair structure. B3 guarantees fixed account purposes, source-bound amount/currency, unique posting keys, positive JS-safe equal pairs, kind-bound debit/credit purposes, and exact one-time reversals. All B1/B2/B3 tables remain empty with zero application access. Paystack, credentials, writers, commands, seeded accounts, postings, transactions, refunds, payouts, and reconciliation remain disabled. Fresh quality passes at 85 files/474 tests, demo/live builds 65/20, and audit zero. AI remains **NOT STARTED**.

## Run locally

```bash
npm.cmd ci
npm.cmd run dev
```

Open <http://localhost:3000>. Useful checks:

```bash
npm.cmd run typecheck
npm.cmd run lint
npm.cmd test
npm.cmd run build
npm.cmd run quality
```

Use `npm` instead of `npm.cmd` on macOS/Linux. Calling `npm.cmd` on Windows avoids PowerShell execution-policy conflicts with `npm.ps1`.

## Environment and secrets

Copy `.env.example` to `.env.local` for local configuration. The local Supabase binding uses the modern publishable key only and remains ignored; no service-role key is present. AI is not started, no OpenAI request is made, and `OPENAI_MODEL` remains configurable per environment. Hosted Auth, live marketplace data, payment, maps, cleanup, trusted ingress, deployment, and monitoring remain external blockers.

## Continuation documents

- [Build status](docs/LOCALHUB_BUILD_STATUS.md) — verified state, blockers, and next action.
- [Architecture](docs/LOCALHUB_ARCHITECTURE.md) — master-brand and multi-market direction.
- [Operations](docs/LOCALHUB_OPERATIONS.md) — local quality loop and operating rules.
- [Agent tools](docs/LOCALHUB_AGENT_TOOLS.md) — controlled ATLAS/tool-gateway contract.
- [Launch checklist](docs/LOCALHUB_LAUNCH_CHECKLIST.md) — acceptance checklist.
- [External setup](docs/LOCALHUB_EXTERNAL_SETUP.md) — Founder-facing provider setup.
- [Design foundation](docs/design/README.md) — code-native visual guidance.

Concept images are reference-only. They may contain legacy “Lafia Hub” wording and are not implemented UI or approved factual data.

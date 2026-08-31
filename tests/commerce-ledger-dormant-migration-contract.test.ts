import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

function migration030() {
  const directory = resolve(process.cwd(), "supabase", "migrations");
  const name = readdirSync(directory).find((entry) =>
    /^202608310030_.*\.sql$/.test(entry),
  );
  if (!name) throw new Error("Missing Step 23 migration 202608310030_*.sql");
  return readFileSync(resolve(directory, name), "utf8");
}

function probeSql() {
  return readFileSync(
    resolve(
      process.cwd(),
      "supabase",
      "tests",
      "typed_ledger_dormant_probe.sql",
    ),
    "utf8",
  );
}

function compact(sql: string) {
  return sql
    .replace(/\s+/g, " ")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .trim()
    .toLowerCase();
}

const ledgerTables = [
  "commerce_ledger_accounts",
  "commerce_ledger_journals",
  "commerce_ledger_posting_pairs",
] as const;

describe("dormant typed commerce-ledger migration contract", () => {
  it("locks all predecessor tables before failing closed on stale finance state", () => {
    const migration = compact(migration030());
    const lock = migration.indexOf("lock table");
    const precondition = migration.indexOf("do $$");

    expect(lock).toBeGreaterThanOrEqual(0);
    expect(lock).toBeLessThan(precondition);
    expect(migration.slice(lock, precondition)).toContain(
      "in share row exclusive mode",
    );
    for (const table of [
      "payments",
      "payment_events",
      "webhook_inbox",
      "ledger_accounts",
      "ledger_journals",
      "ledger_entries",
      "referral_commissions",
      "order_payment_states",
      "payment_attempts",
      "payment_applications",
      "provider_evidence_deliveries",
      "provider_evidence_raw_payloads",
      "provider_normalized_events",
    ]) {
      expect(migration.slice(lock, precondition)).toContain(table);
    }
    for (const table of [
      "payments",
      "payment_events",
      "webhook_inbox",
      "ledger_accounts",
      "ledger_journals",
      "ledger_entries",
      "referral_commissions",
    ]) {
      expect(migration).toContain(`exists (select 1 from public.${table})`);
    }
    for (const table of [
      "order_payment_states",
      "payment_attempts",
      "payment_applications",
      "provider_evidence_deliveries",
      "provider_evidence_raw_payloads",
      "provider_normalized_events",
    ]) {
      expect(migration).toContain(`exists (select 1 from private.${table})`);
    }
    expect(migration).toContain(
      "commerce ledger migration requires quarantine",
    );
    expect(migration).toContain("has_table_privilege");
    expect(migration).toContain("has_any_column_privilege");
    expect(migration).toContain("has_function_privilege");
    expect(migration).toContain("expected.constraint_name");
    expect(migration).toContain("pg_catalog.unnest(c.conkey) with ordinality");
    expect(migration).toContain("pg_catalog.unnest(c.confkey) with ordinality");
    expect(migration).toContain("finance rls changed");
  });

  it("defines exactly the typed ledger enums and closes type usage", () => {
    const migration = compact(migration030());
    const enums = [
      ["commerce_account_class_code", "'asset', 'liability'"],
      ["commerce_account_owner_code", "'localhub', 'business'"],
      [
        "commerce_account_scope_code",
        "'platform', 'provider_environment', 'business'",
      ],
      [
        "commerce_account_purpose_code",
        "'provider_clearing', 'unapplied_customer_funds', 'order_funds_payable'",
      ],
      [
        "commerce_journal_kind_code",
        "'verified_charge', 'order_payment_application', 'reversal'",
      ],
    ];

    expect(
      migration.match(/create type private\.commerce_[a-z_]+ as enum/g) ?? [],
    ).toHaveLength(5);
    for (const [name, labels] of enums) {
      expect(migration).toContain(
        `create type private.${name} as enum (${labels});`,
      );
      expect(migration).toContain(
        `revoke all on type private.${name} from public, anon, authenticated, service_role`,
      );
    }
  });

  it("models account identities and journal evidence without generic postings", () => {
    const migration = compact(migration030());

    expect(migration).toContain(
      "create table private.commerce_ledger_accounts",
    );
    expect(migration).toContain(
      "unique nulls not distinct (purpose, owner_type, owner_id, scope, provider_code, payment_environment, currency_code, identity_version)",
    );
    expect(migration).toContain(
      "unique (id, currency_code, purpose, owner_type, owner_id)",
    );
    expect(migration).toContain(
      "references public.businesses(id) on delete restrict",
    );
    expect(migration).toContain("provider_code ~ '^[a-z][a-z0-9_-]{1,31}$'");
    expect(migration).toContain("provider_clearing");
    expect(migration).toContain("unapplied_customer_funds");
    expect(migration).toContain("order_funds_payable");
    expect(migration).not.toMatch(/\b(balance|is_active)\b/);

    expect(migration).toContain(
      "create table private.commerce_ledger_journals",
    );
    expect(migration).toContain("posting_key_sha256 text not null");
    expect(migration).toContain("source_evidence_sha256 text not null");
    expect(migration).toContain("amount_minor > 0");
    expect(migration).toContain("amount_minor <= 9007199254740991");
    expect(migration).toContain(
      "unique (posting_key_version, posting_key_sha256)",
    );
    expect(migration).toContain("normalization_outcome = 'matched_attempt'");
    expect(migration).toContain("normalization_outcome is not null");
    expect(migration).toContain(
      "references private.provider_normalized_events",
    );
    expect(migration).toContain("references private.payment_applications");
    expect(migration).not.toContain("jsonb");
    expect(migration).not.toMatch(
      /create (table|function) private\.(ledger|posting|balance)/,
    );
  });

  it("uses intrinsically balanced pair rows and exact reversible identities", () => {
    const migration = compact(migration030());

    expect(migration).toContain(
      "create table private.commerce_ledger_posting_pairs",
    );
    expect(migration).toContain("debit_account_id uuid not null");
    expect(migration).toContain("credit_account_id uuid not null");
    expect(migration).toContain(
      "journal_kind private.commerce_journal_kind_code not null",
    );
    expect(migration).toContain(
      "debit_account_purpose private.commerce_account_purpose_code not null",
    );
    expect(migration).toContain(
      "credit_account_purpose private.commerce_account_purpose_code not null",
    );
    expect(migration).toContain("debit_account_id <> credit_account_id");
    expect(migration).toContain("unique (journal_id, pair_index)");
    expect(migration).toContain("unique (reverses_pair_id)");
    expect(migration).toContain("journal_reversal_of_id");
    expect(migration).toContain("reverses_pair_id is null");
    expect(migration).toContain("reverses_pair_id is not null");
    expect(migration).toContain(
      "credit_account_id, debit_account_id, amount_minor, currency_code",
    );
    expect(migration).toContain(
      "journal_kind = 'verified_charge' and debit_account_purpose = 'provider_clearing' and credit_account_purpose = 'unapplied_customer_funds'",
    );
    expect(migration).toContain(
      "journal_kind = 'order_payment_application' and debit_account_purpose = 'unapplied_customer_funds' and credit_account_purpose = 'order_funds_payable'",
    );
    expect(migration).toContain(
      "reversal_of_journal_id is null or reversal_of_journal_id <> id",
    );
    expect(migration).toContain("on delete restrict");
    expect(migration).toMatch(
      /create index [a-z0-9_]+ on private\.commerce_ledger_posting_pairs\(journal_id/,
    );
  });

  it("keeps every new relation forced-RLS, privilege-closed, and owner-dormant", () => {
    const migration = compact(migration030());

    for (const table of ledgerTables) {
      expect(migration).toContain(
        `alter table private.${table} enable row level security`,
      );
      expect(migration).toContain(
        `alter table private.${table} force row level security`,
      );
      expect(migration).toContain(
        `revoke all on table private.${table} from public, anon, authenticated, service_role`,
      );
      expect(migration).toMatch(
        new RegExp(`before insert or update or delete on private\\.${table}`),
      );
      expect(migration).toMatch(
        new RegExp(`before truncate on private\\.${table}`),
      );
    }
    expect(migration).toContain(
      "create or replace function private.prevent_dormant_commerce_ledger_mutation()",
    );
    expect(migration).toContain("security invoker");
    expect(migration).toContain("set search_path = ''");
    expect(migration).toContain("using errcode = '55000'");
    expect(migration.match(/create or replace function/g) ?? []).toHaveLength(
      1,
    );
  });

  it("contains no activation path, seed data, public surface, or generic money command", () => {
    const migration = compact(migration030());

    expect(migration).not.toMatch(/\bgrant\b/);
    expect(migration).not.toMatch(/insert\s+into\s+(public|private)\./);
    expect(migration).not.toMatch(/on delete (cascade|set null)/);
    expect(migration).not.toMatch(/\b(paystack|stripe|flutterwave|monnify)\b/);
    expect(migration).not.toContain("jsonb");
    expect(migration).not.toMatch(/create table public\.commerce_ledger/);
    expect(migration).not.toMatch(
      /create table private\.(refund|payout|settlement|bank|wallet|escrow|reconciliation)/,
    );
    expect(migration).not.toMatch(
      /(create|replace) function [^(]+\((?:[^)]*,)?\s*(?:json|line|posting)/,
    );
  });

  it("ships a rollback-only structural and adversarial hosted probe", () => {
    const probe = compact(probeSql());

    expect(probe).toMatch(/^-- rollback-only live regression probe/);
    expect(probe).toContain("begin;");
    expect(probe).toMatch(/rollback;$/);
    expect(probe).toContain("relrowsecurity");
    expect(probe).toContain("relforcerowsecurity");
    expect(probe).toContain("pg_policies");
    expect(probe).toContain("has_table_privilege");
    expect(probe).toContain("has_any_column_privilege");
    expect(probe).toContain("has_type_privilege");
    expect(probe).toContain("has_function_privilege");
    expect(probe).toContain("confdeltype");
    expect(probe).toContain("commerce ledger is dormant");
    for (const phrase of [
      "invalid provider clearing account",
      "invalid unapplied account",
      "invalid payable account",
      "cross-currency pair",
      "same debit and credit account",
      "nonpositive pair amount",
      "wrong posting template",
      "missing normalization outcome",
      "quarantined evidence",
      "missing evidence money",
      "evidence amount mismatch",
      "evidence currency mismatch",
      "application amount mismatch",
      "application currency mismatch",
      "zero journal amount",
      "negative journal amount",
      "normal journal reversal linkage",
      "reversal journal without linkage",
      "self-reversing journal",
      "unmapped reversal pair",
      "exact reversal account swap",
      "second reversal unexpectedly worked",
      "second reversal pair unexpectedly worked",
      "duplicate posting key",
      "dormant journal insert",
      "dormant posting pair insert",
      "truncate private.commerce_ledger_posting_pairs",
      "typed ledger probe left application fixture residue",
    ]) {
      expect(probe).toContain(phrase);
    }
  });
});

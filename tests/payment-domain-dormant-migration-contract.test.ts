import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

function migration028() {
  const directory = resolve(process.cwd(), "supabase", "migrations");
  const name = readdirSync(directory).find((entry) =>
    /^202608310028_.*\.sql$/.test(entry),
  );
  if (!name) throw new Error("Missing Step 23 migration 202608310028_*.sql");
  return readFileSync(resolve(directory, name), "utf8");
}

function probeSql() {
  return readFileSync(
    resolve(
      process.cwd(),
      "supabase",
      "tests",
      "payment_domain_dormant_probe.sql",
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

const domainTables = [
  "order_payment_states",
  "payment_attempts",
  "payment_applications",
] as const;

describe("typed dormant payment-domain migration contract", () => {
  it("locks and validates the existing quarantine before adding anything", () => {
    const migration = compact(migration028());
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
    ]) {
      expect(migration).toContain(`from public.${table}`);
    }
    expect(migration).toContain("payment_events_append_only");
    expect(migration).toContain("confdeltype = 'r'");
    expect(migration).toContain("has_table_privilege");
    expect(migration).toContain("has_any_column_privilege");
    expect(migration).toContain("has_function_privilege");
    expect(migration).toContain("payment domain migration requires quarantine");
  });

  it("defines only the four fixed private domain enums and revokes their use", () => {
    const migration = migration028();
    const normalized = compact(migration);

    for (const [name, values] of [
      [
        "order_payment_state_code",
        ["unpaid", "payment_pending", "paid", "partially_refunded", "refunded"],
      ],
      [
        "payment_attempt_state_code",
        [
          "created",
          "initialization_pending",
          "awaiting_customer",
          "verification_pending",
          "succeeded",
          "init_failed",
          "init_unknown",
          "failed",
          "cancelled",
          "expired",
          "manual_review",
        ],
      ],
      ["payment_environment_code", ["test", "live"]],
      [
        "payment_application_kind",
        ["primary_order_payment", "unapplied_excess"],
      ],
    ] as const) {
      expect(normalized).toContain(`create type private.${name} as enum`);
      expect(normalized).toContain(
        `revoke all on type private.${name} from public, anon, authenticated, service_role`,
      );
      for (const value of values) expect(migration).toContain(`'${value}'`);
    }
  });

  it("binds one canonical payment state to the exact immutable order snapshot", () => {
    const migration = compact(migration028());

    expect(migration).toContain(
      "unique (id, buyer_id, business_id, market_id, total_minor, currency_code)",
    );
    expect(migration).toContain("create table private.order_payment_states");
    expect(migration).toContain("unique (order_id)");
    expect(migration).toContain("expected_amount_minor > 0");
    expect(migration).toContain("expected_amount_minor <= 9007199254740991");
    expect(migration).toContain("order_snapshot_version > 0");
    expect(migration).toContain("order_snapshot_sha256 ~ '^[0-9a-f]{64}$'");
    expect(migration).toContain(
      "foreign key (order_id, payer_id, business_id, market_id, expected_amount_minor, currency_code)",
    );
    expect(migration).toContain(
      "references public.orders(id, buyer_id, business_id, market_id, total_minor, currency_code) on delete restrict",
    );
  });

  it("allows multiple real successful attempts while binding every snapshot", () => {
    const migration = compact(migration028());

    expect(migration).toContain("create table private.payment_attempts");
    expect(migration).toContain(
      "unique (provider_code, provider_environment, provider_reference)",
    );
    expect(migration).toContain(
      "unique (order_payment_state_id, idempotency_key_sha256)",
    );
    expect(migration).toContain(
      "foreign key (order_payment_state_id, expected_amount_minor, currency_code, order_snapshot_version, order_snapshot_sha256)",
    );
    expect(migration).toContain(
      "references private.order_payment_states(id, expected_amount_minor, currency_code, order_snapshot_version, order_snapshot_sha256) on delete restrict",
    );
    expect(migration).not.toMatch(
      /unique[^;]+payment_attempts[^;]+where\s+status\s*=\s*'succeeded'/,
    );
  });

  it("applies only succeeded attempts and permits one primary plus excess money", () => {
    const migration = compact(migration028());

    expect(migration).toContain("create table private.payment_applications");
    expect(migration).toContain("attempt_status = 'succeeded'");
    expect(migration).toContain("unique (payment_attempt_id)");
    expect(migration).toContain(
      "foreign key (payment_attempt_id, order_payment_state_id, attempt_status, expected_amount_minor, currency_code, order_snapshot_version, order_snapshot_sha256)",
    );
    expect(migration).toContain(
      "references private.payment_attempts(id, order_payment_state_id, status, expected_amount_minor, currency_code, order_snapshot_version, order_snapshot_sha256) on delete restrict",
    );
    expect(migration).toMatch(
      /create unique index payment_applications_one_primary_idx on private\.payment_applications\s*\(order_payment_state_id\)\s*where kind = 'primary_order_payment'/,
    );
  });

  it("forces deny-by-default RLS and owner-level dormancy on every new table", () => {
    const migration = compact(migration028());

    for (const table of domainTables) {
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
      "create or replace function private.prevent_dormant_payment_domain_mutation()",
    );
    expect(migration).toContain("security invoker");
    expect(migration).toContain("set search_path = ''");
    expect(migration).toContain("using errcode = '55000'");
  });

  it("contains no provider activation, seed, public table or callable command", () => {
    const migration = compact(migration028());

    expect(migration).not.toMatch(/\bgrant\b/);
    expect(migration).not.toContain("paystack");
    expect(migration).not.toMatch(/insert into (public|private)\./);
    expect(migration).not.toMatch(/on delete (cascade|set null)/);
    expect(migration).not.toMatch(
      /create table public\.(order_payment_states|payment_attempts|payment_applications)/,
    );
    expect(migration.match(/create or replace function/g) ?? []).toHaveLength(
      1,
    );
    for (const forbidden of [
      "raw_provider_body",
      "provider_signature",
      "secret_key",
      "ledger_account_purpose",
      "refunds",
      "payouts",
      "reconciliation_runs",
    ]) {
      expect(migration).not.toContain(forbidden);
    }
  });

  it("ships a rollback-only structural and behavioral hosted probe", () => {
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
    expect(probe).toContain("payment domain is dormant");
    expect(probe).toContain("insert into private.order_payment_states");
    expect(probe).toContain("truncate private.payment_applications");
  });
});

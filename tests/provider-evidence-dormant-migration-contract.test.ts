import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

function migration029() {
  const directory = resolve(process.cwd(), "supabase", "migrations");
  const name = readdirSync(directory).find((entry) =>
    /^202608310029_.*\.sql$/.test(entry),
  );
  if (!name) throw new Error("Missing Step 23 migration 202608310029_*.sql");
  return readFileSync(resolve(directory, name), "utf8");
}

function probeSql() {
  return readFileSync(
    resolve(
      process.cwd(),
      "supabase",
      "tests",
      "provider_evidence_dormant_probe.sql",
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

const evidenceTables = [
  "provider_evidence_deliveries",
  "provider_evidence_raw_payloads",
  "provider_normalized_events",
] as const;

describe("dormant provider-evidence migration contract", () => {
  it("fails closed unless the finance quarantine and B1 dormancy remain exact", () => {
    const migration = compact(migration029());
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
    ]) {
      expect(migration).toContain(table);
    }
    expect(migration).toContain("payment_events_append_only");
    expect(migration).toContain("prevent_dormant_payment_domain_mutation");
    expect(migration).toContain("has_table_privilege");
    expect(migration).toContain("has_any_column_privilege");
    expect(migration).toContain("has_function_privilege");
    expect(migration).toContain(
      "provider evidence migration requires quarantine",
    );
  });

  it("defines only the fixed normalization outcomes and revokes type use", () => {
    const migration = migration029();
    const normalized = compact(migration);

    expect(normalized).toContain(
      "create type private.provider_normalization_outcome_code as enum",
    );
    expect(normalized).toContain(
      "revoke all on type private.provider_normalization_outcome_code from public, anon, authenticated, service_role",
    );
    for (const outcome of [
      "matched_attempt",
      "quarantined_unknown_reference",
      "quarantined_missing_reference",
      "quarantined_malformed_reference",
      "quarantined_unsupported_event",
    ]) {
      expect(migration).toContain(`'${outcome}'`);
    }
  });

  it("keeps immutable signed-delivery metadata separate from exact raw bytes", () => {
    const migration = compact(migration029());

    expect(migration).toContain(
      "create table private.provider_evidence_deliveries",
    );
    expect(migration).toContain(
      "unique (provider_code, provider_environment, digest_version, raw_body_sha256)",
    );
    expect(migration).toContain(
      "unique (id, provider_code, provider_environment)",
    );
    expect(migration).toContain(
      "unique (id, digest_version, raw_body_sha256, raw_body_bytes)",
    );
    expect(migration).toContain("raw_body_bytes between 1 and 1048576");
    expect(migration).toContain("signature_method text not null");
    expect(migration).toContain("signature_sha256 text not null");
    expect(migration).toContain("signature_key_version text not null");
    expect(migration).toContain("verifier_version smallint not null");
    expect(migration).toContain("provider_delivery_id text");
    expect(migration).toContain(
      "create index provider_evidence_deliveries_provider_id_observation_idx",
    );
    expect(migration).not.toMatch(
      /create unique index[^;]+provider_delivery_id/,
    );
    expect(migration).toContain("content_type text not null");
    expect(migration).toContain("signature_verified_at >= received_at");
    expect(migration).toContain("created_at >= signature_verified_at");
    expect(migration).toContain(
      "on private.provider_evidence_deliveries(provider_code, provider_environment, received_at desc)",
    );

    expect(migration).toContain(
      "create table private.provider_evidence_raw_payloads",
    );
    expect(migration).toContain("raw_body bytea not null");
    expect(migration).toContain("purge_after timestamptz not null");
    expect(migration).toContain("purge_after > stored_at");
    expect(migration).toContain("octet_length(raw_body) = raw_body_bytes");
    expect(migration).toContain(
      "encode(extensions.digest(raw_body, 'sha256'), 'hex') = raw_body_sha256",
    );
    expect(migration).toContain(
      "references private.provider_evidence_deliveries(id, digest_version, raw_body_sha256, raw_body_bytes) on delete restrict",
    );
  });

  it("normalizes only minimized typed observations and binds exact attempts", () => {
    const migration = compact(migration029());

    expect(migration).toContain(
      "create table private.provider_normalized_events",
    );
    expect(migration).toContain(
      "add constraint payment_attempts_provider_evidence_identity_unique unique (id, provider_code, provider_environment, provider_reference)",
    );
    expect(migration).toContain("provider_event_kind text not null");
    expect(migration).toContain("provider_resource_kind text not null");
    expect(migration).toContain("provider_resource_id text");
    expect(migration).toContain("provider_status text");
    expect(migration).toContain(
      "normalization_outcome private.provider_normalization_outcome_code not null",
    );
    expect(migration).toContain("normalized_at timestamptz not null");
    expect(migration).toContain(
      "foreign key (delivery_id, provider_code, provider_environment)",
    );
    expect(migration).toContain(
      "references private.provider_evidence_deliveries(id, provider_code, provider_environment) on delete restrict",
    );
    expect(migration).toContain(
      "foreign key (payment_attempt_id, provider_code, provider_environment, provider_reference)",
    );
    expect(migration).toContain(
      "references private.payment_attempts(id, provider_code, provider_environment, provider_reference) on delete restrict",
    );
    expect(migration).toContain(
      "unique (delivery_id, event_index, normalizer_version)",
    );
    expect(migration).toContain("where semantic_key_sha256 is not null");
    expect(migration).toContain("observed_amount_minor is null");
    expect(migration).toContain("observed_currency_code is null");
    expect(migration).toContain("semantic_key_version is null");
    expect(migration).toContain("payment_attempt_id is null");
    expect(migration).toMatch(
      /normalization_outcome = 'matched_attempt'[^;]+semantic_key_sha256 is not null/,
    );
  });

  it("forces deny-by-default RLS and owner-level dormancy", () => {
    const migration = compact(migration029());

    for (const table of evidenceTables) {
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
      "create or replace function private.prevent_dormant_provider_evidence_mutation()",
    );
    expect(migration).toContain("security invoker");
    expect(migration).toContain("set search_path = ''");
    expect(migration).toContain("using errcode = '55000'");
  });

  it("contains no provider activation, secret, public surface, or finance command", () => {
    const migration = compact(migration029());

    expect(migration).not.toMatch(/\bgrant\b/);
    expect(migration).not.toMatch(/insert\s+into\s+(public|private)\./);
    expect(migration).not.toMatch(/on delete (cascade|set null)/);
    expect(migration).not.toMatch(/\b(paystack|stripe|flutterwave|monnify)\b/);
    expect(migration).not.toMatch(/\braw_signature\b/);
    expect(migration).not.toContain("secret_key");
    expect(migration).not.toContain("authorization_url");
    expect(migration).not.toContain("access_code");
    expect(migration).not.toContain("callback_url");
    expect(migration).not.toContain("jsonb");
    for (const forbiddenColumn of [
      "customer_email",
      "customer_phone",
      "card_number",
      "bank_account",
      "billing_address",
      "request_headers",
    ]) {
      expect(migration).not.toContain(forbiddenColumn);
    }
    expect(migration).not.toMatch(/create table public\.provider_/);
    expect(migration).not.toMatch(
      /create table private\.(ledger|refund|payout|reconciliation)/,
    );
    expect(migration).not.toMatch(/update\s+public\.orders/);
    expect(migration).not.toMatch(/update\s+private\.payment_/);
    expect(migration.match(/create or replace function/g) ?? []).toHaveLength(
      1,
    );
  });

  it("ships a rollback-only hosted structural and adversarial probe", () => {
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
    expect(probe).toContain("extensions.digest");
    expect(probe).toContain("wrong digest");
    expect(probe).toContain("duplicate exact delivery");
    expect(probe).toContain("semantic duplicate");
    expect(probe).toContain("quarantined_unknown_reference");
    expect(probe).toContain("second primary application");
    expect(probe).toContain("unapplied_excess");
    expect(probe).toContain("non-matched outcome with attempt id");
    expect(probe).toContain("currency without amount");
    expect(probe).toContain("provider evidence is dormant");
    expect(probe).toContain("truncate private.provider_normalized_events");
    expect(probe).toContain("truncate private.provider_evidence_deliveries");
  });
});

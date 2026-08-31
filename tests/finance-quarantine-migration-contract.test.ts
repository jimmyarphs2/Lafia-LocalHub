import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

function migration027() {
  const directory = resolve(process.cwd(), "supabase", "migrations");
  const name = readdirSync(directory).find((entry) =>
    /^202608300027_.*\.sql$/.test(entry),
  );
  if (!name) throw new Error("Missing Step 23 migration 202608300027_*.sql");
  return readFileSync(resolve(directory, name), "utf8");
}

function probeSql() {
  return readFileSync(
    resolve(process.cwd(), "supabase", "tests", "finance_quarantine_probe.sql"),
    "utf8",
  );
}

const financeTables = [
  "payments",
  "payment_events",
  "webhook_inbox",
  "ledger_accounts",
  "ledger_journals",
  "ledger_entries",
  "referral_commissions",
] as const;

describe("dormant finance quarantine migration contract", () => {
  it("locks every affected table in a fixed order before asserting zero rows", () => {
    const migration = migration027().toLowerCase();
    const lockStart = migration.indexOf("lock table");
    const zeroCheckStart = migration.indexOf("do $$");

    expect(lockStart).toBeGreaterThanOrEqual(0);
    expect(lockStart).toBeLessThan(zeroCheckStart);
    const lockSection = migration.slice(lockStart, zeroCheckStart);
    expect(lockSection).toContain("in share row exclusive mode");

    let previousPosition = -1;
    for (const table of financeTables) {
      const position = lockSection.indexOf(`public.${table}`);
      expect(
        position,
        `${table} is missing from the quarantine lock`,
      ).toBeGreaterThan(previousPosition);
      previousPosition = position;
    }
  });

  it("fails closed unless every affected hosted table is empty", () => {
    const migration = migration027().toLowerCase();

    for (const table of financeTables) {
      expect(migration).toContain(`from public.${table}`);
    }
    expect(migration).toMatch(/raise exception\s+['"]finance quarantine/i);
    expect(migration).toContain("reconciliation is required");
  });

  it("removes every direct finance-table privilege from application roles", () => {
    const compact = migration027().replace(/\s+/g, "").toLowerCase();

    expect(compact).toContain(
      "revokeallprivilegesontablepublic.payments,public.payment_events,public.webhook_inbox,public.ledger_accounts,public.ledger_journals,public.ledger_entries,public.referral_commissionsfrompublic,anon,authenticated,service_role;",
    );
    expect(compact).not.toMatch(
      /grant(select|insert|update|delete|truncate|references|trigger)/,
    );
  });

  it("closes the generic ledger execution surface without replacing it", () => {
    const compact = migration027().replace(/\s+/g, "").toLowerCase();

    expect(compact).toContain(
      "revokeexecuteonfunctionpublic.post_journal(text,text,uuid,text,jsonb)frompublic,anon,authenticated,service_role;",
    );
    expect(compact).toContain(
      "revokeexecuteonfunctionpublic.reverse_posted_journal(uuid,text,text)frompublic,anon,authenticated,service_role;",
    );
    expect(compact).toContain(
      "revokeexecuteonfunctionpublic.journal_matches_lines(uuid,jsonb)frompublic,anon,authenticated,service_role;",
    );
    expect(compact).toContain(
      "revokeexecuteonfunctionpublic.reversal_matches_original(uuid,uuid)frompublic,anon,authenticated,service_role;",
    );
    expect(compact).not.toContain("grantexecuteonfunctionpublic.post_journal");
    expect(compact).not.toContain(
      "grantexecuteonfunctionpublic.reverse_posted_journal",
    );
  });

  it("retains payment evidence and makes it append-only", () => {
    const migration = migration027();

    expect(migration).toMatch(
      /foreign key\s*\(payment_id\)\s*references public\.payments\s*\(id\)\s*on delete restrict/i,
    );
    expect(migration).toMatch(
      /create or replace function private\.[a-z_]+\(\)[\s\S]*returns trigger[\s\S]*security definer[\s\S]*set search_path = ''/i,
    );
    expect(migration).toMatch(
      /create trigger [a-z_]+[\s\S]*before update or delete on public\.payment_events[\s\S]*for each row[\s\S]*execute function private\./i,
    );
    expect(migration).toMatch(/raise exception ['"].*append-only/i);
  });

  it("keeps the slice explicitly dormant and contains no activation path", () => {
    const migration = migration027();
    const compact = migration.replace(/\s+/g, " ").toLowerCase();

    expect(compact).toContain("payment execution remains dormant");
    expect(compact).toContain("provider ingress remains dormant");
    expect(compact).not.toContain("paystack");
    expect(compact).not.toMatch(
      /insert\s+into\s+public\.(payments|payment_events|webhook_inbox|ledger_accounts|ledger_journals|ledger_entries|referral_commissions)/,
    );
    expect(compact).not.toMatch(/\bgrant\b/);
  });

  it("ships a rollback-only hosted probe for ACL, RLS, metadata and evidence behavior", () => {
    const probe = probeSql();
    const compact = probe.replace(/\s+/g, " ").toLowerCase();

    expect(compact).toMatch(/^-- rollback-only live regression probe/);
    expect(compact).toContain("begin;");
    expect(compact).toMatch(/rollback;\s*$/);
    expect(compact).toContain("has_table_privilege");
    expect(compact).toContain("has_any_column_privilege");
    expect(compact).toContain("has_function_privilege");
    expect(compact).toContain("'references'");
    expect(compact).toContain("'trigger'");
    expect(compact).toContain("relrowsecurity");
    expect(compact).toContain("pg_policies");
    expect(compact).toContain("confdeltype = 'r'");
    expect(compact).toContain("payment events are append-only");
  });
});

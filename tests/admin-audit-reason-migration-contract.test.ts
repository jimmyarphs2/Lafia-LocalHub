import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const readMigration = (name: string) =>
  readFileSync(resolve(process.cwd(), "supabase", "migrations", name), "utf8");

const migrations = [
  {
    name: "foundation",
    sql: readMigration("202608290001_localhub_foundation.sql"),
  },
  {
    name: "validation",
    sql: readMigration(
      "202608290009_localhub_admin_audit_reason_validation.sql",
    ),
  },
  {
    name: "forward hardening",
    sql: readMigration(
      "202608290011_localhub_admin_reason_whitespace_hardening.sql",
    ),
  },
];

type FunctionName = "transition_business_status" | "set_profile_suspension";

function functionSection(sql: string, name: FunctionName) {
  const start = sql.indexOf(`create or replace function public.${name}`);
  if (start < 0) throw new Error(`Missing ${name}`);
  const next = sql.indexOf("\ncreate or replace function public.", start + 1);
  return sql.slice(start, next < 0 ? undefined : next);
}

function expectNormalization(block: string): void {
  // Space + tab + LF + CR + FF are in the escape string; chr(11) is VT.
  expect(block).toContain("E' \\t\\n\\r\\f'");
  expect(block).toContain("pg_catalog.chr(11)");
  expect(block).toContain("U&'\\00A0");
  expect(block).toContain("\\200B");
  expect(block).toContain("\\FEFF'");
  expect(block).toContain("pg_catalog.btrim(reason, trim_chars)");
  expect(block).toContain(
    "pg_catalog.regexp_replace(normalized_reason, default_ignorable_pattern, '', 'g')",
  );
  expect(block).toContain(
    "pg_catalog.regexp_replace(visible_reason, '[^[:alnum:]]', '', 'g')",
  );
  expect(block).toContain(
    "char_length(normalized_reason) not between 3 and 500",
  );
  expect(block).toContain("char_length(meaningful_reason) < 3");
  expect(block).not.toContain("char_length(trim(reason))");

  const auditInsert = block.slice(
    block.indexOf("insert into public.admin_events"),
  );
  expect(auditInsert).toContain("normalized_reason");
  expect(auditInsert).not.toContain("trim(reason)");
}

function expectExecutionBoundary(block: string, signature: string): void {
  expect(block).toContain("language plpgsql");
  expect(block).toContain("security definer");
  expect(block).toContain("set search_path = ''");
  const compactBlock = block.replace(/\s+/g, "");
  const compactSignature = signature.replace(/\s+/g, "");
  expect(compactBlock).toContain(
    `revokeexecuteonfunction${compactSignature}frompublic,anon,authenticated;`,
  );
  expect(compactBlock).toContain(
    `grantexecuteonfunction${compactSignature}toauthenticated;`,
  );
}

describe("administrative audit-reason migrations", () => {
  it("asserts the live database behavior for omitted invisible classes", () => {
    const hardening = migrations.at(-1)!.sql;

    for (const codePoint of [
      "0085",
      "00AD",
      "034F",
      "115F",
      "1160",
      "3164",
      "FFA0",
      "+01BCA0",
      "+01D173",
      "+0E0001",
      "+0E0100",
    ]) {
      expect(hardening).toContain(`\\${codePoint}`);
    }
    expect(hardening).toContain("$localhub_admin_reason_contract$");
    expect(hardening).toContain(
      "database Unicode classification is unsafe for audit reasons",
    );
  });

  for (const migration of migrations) {
    describe(migration.name, () => {
      it("hardens the business-status transition independently", () => {
        const block = functionSection(
          migration.sql,
          "transition_business_status",
        );

        expectNormalization(block);
        expectExecutionBoundary(
          block,
          "public.transition_business_status(uuid, text, text)",
        );
        expect(block).toContain("public.has_capability('admin')");
        expect(block).toContain("public.has_capability('super_admin')");
        expect(block).toContain("bm.profile_id = (select auth.uid())");
        expect(block).toContain("bm.accepted_at is not null");
      });

      it("hardens profile suspension independently", () => {
        const block = functionSection(migration.sql, "set_profile_suspension");

        expectNormalization(block);
        expectExecutionBoundary(
          block,
          "public.set_profile_suspension(uuid, boolean, text)",
        );
        expect(block).toContain("public.has_capability('super_admin')");
        expect(block).toContain("actor = target_profile");
        expect(block).toContain("actor uuid := (select auth.uid())");
      });
    });
  }
});

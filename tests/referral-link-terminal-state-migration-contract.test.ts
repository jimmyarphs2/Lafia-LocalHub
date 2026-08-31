import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/202608310032_localhub_referral_link_terminal_state.sql",
);
const probePath = resolve(
  process.cwd(),
  "supabase/tests/referral_acquisition_links_probe.sql",
);

function normalized(path: string) {
  return readFileSync(path, "utf8").replace(/\s+/g, " ").toLowerCase();
}

describe("referral link terminal-state hotfix contract", () => {
  it("replaces only the authenticated owner toggle boundary", () => {
    const sql = normalized(migrationPath);
    expect(sql).toMatch(
      /create or replace function public\.set_my_referral_link_enabled\(\s*p_link_id uuid, p_enabled boolean\s*\)/,
    );
    expect(sql).not.toMatch(
      /create table|alter table|insert into public\.referral_|insert into private\.referral_|payment|ledger|commission|attribution/,
    );
  });

  it("locks the owner row and treats stored or elapsed expiry as terminal", () => {
    const sql = normalized(migrationPath);
    expect(sql).toContain("for update");
    expect(sql).toContain("stored_status = 'expired'");
    expect(sql).toContain(
      "stored_expires_at is not null and stored_expires_at <= now()",
    );
    expect(sql).toContain(
      "raise exception 'referral link cannot be changed' using errcode='55000'",
    );
  });

  it("preserves fixed-path ownership and the exact authenticated grant", () => {
    const sql = normalized(migrationPath);
    expect(sql).toContain(
      "language plpgsql security definer set search_path = ''",
    );
    expect(sql).toContain(
      "alter function public.set_my_referral_link_enabled(uuid, boolean) owner to postgres",
    );
    expect(sql).toContain(
      "revoke all on function public.set_my_referral_link_enabled(uuid, boolean) from public, anon, authenticated, service_role",
    );
    expect(sql).toContain(
      "grant execute on function public.set_my_referral_link_enabled(uuid, boolean) to authenticated",
    );
  });

  it("probes direct-RPC stored and elapsed expiry mutation attempts", () => {
    const probe = normalized(probePath);
    expect(probe).toContain(
      "stored expired referral link unexpectedly re-enabled",
    );
    expect(probe).toContain(
      "stored expired referral link unexpectedly disabled",
    );
    expect(probe).toContain("elapsed referral link unexpectedly re-enabled");
    expect(probe).toContain("elapsed referral link unexpectedly disabled");
  });
});

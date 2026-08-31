import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

function read(relativePath: string) {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

function compact(sql: string) {
  return sql
    .replace(/--.*$/gm, "")
    .replace(/\s+/g, " ")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .trim()
    .toLowerCase();
}

const migrationPath =
  "supabase/migrations/202608310038_localhub_tool_gateway_platform_summary.sql";
const probePath = "supabase/tests/tool_gateway_platform_summary_probe.sql";

describe("controlled tool-gateway migration", () => {
  it("installs one forced-RLS, ACL-closed, fixed-window actor limiter", () => {
    const sql = compact(read(migrationPath));
    const table = sql.match(
      /create table private\.tool_gateway_actor_rate_limits \(([\s\S]*?)\);/,
    )?.[1];

    expect(table).toBeTruthy();
    expect(table).toContain("actor_id uuid primary key");
    expect(table).toContain("window_started_at timestamptz not null");
    expect(table).toContain("request_count smallint not null");
    expect(table).not.toMatch(
      /market|query|input|payload|email|phone|ip_address|cookie|credential|provider|model/,
    );
    expect(sql).toContain(
      "alter table private.tool_gateway_actor_rate_limits force row level security",
    );
    expect(sql).toContain(
      "revoke all on table private.tool_gateway_actor_rate_limits from public, anon, authenticated, service_role",
    );
    expect(sql).toContain("request_count <= 61");
  });

  it("authorizes and consumes the actor quota before market validation or lookup", () => {
    const sql = compact(read(migrationPath));
    const rpc = sql.match(
      /create function public\.get_tool_gateway_platform_summary[\s\S]*?\$\$;/,
    )?.[0];
    expect(rpc).toBeTruthy();
    const authorizeAt = rpc!.indexOf("auth.role()");
    const activeAt = rpc!.indexOf("from public.profiles profile_record");
    const capabilityAt = rpc!.indexOf(
      "from public.profile_capabilities capability_record",
    );
    const consumeAt = rpc!.indexOf(
      "private.consume_tool_gateway_read_rate_limit(actor, observed_time)",
    );
    const validateAt = rpc!.indexOf("p_market_slug !~");
    const marketAt = rpc!.indexOf("from public.markets market_record");

    expect(authorizeAt).toBeGreaterThan(-1);
    expect(activeAt).toBeGreaterThan(authorizeAt);
    expect(capabilityAt).toBeGreaterThan(activeAt);
    expect(rpc!.slice(activeAt, consumeAt)).toContain("for share");
    expect(consumeAt).toBeGreaterThan(capabilityAt);
    expect(validateAt).toBeGreaterThan(consumeAt);
    expect(marketAt).toBeGreaterThan(validateAt);
  });

  it("returns only bounded non-PII public-catalog aggregates", () => {
    const sql = compact(read(migrationPath));
    const signature = sql.match(
      /create function public\.get_tool_gateway_platform_summary[\s\S]*?language plpgsql/,
    )?.[0];

    expect(signature).toBeTruthy();
    for (const field of [
      "invocation_id",
      "audit_event_id",
      "outcome",
      "observed_at",
      "market_id",
      "market_slug",
      "market_name",
      "country_code",
      "currency_code",
      "timezone",
      "active_category_count",
      "active_vendor_count",
      "published_listing_count",
      "orderable_listing_count",
    ]) {
      expect(signature).toContain(field);
    }
    expect(signature).not.toMatch(
      /email|phone|address|\bprofile\b|membership|\borders?\b|revenue|payment|ledger|demand|incident|credential/,
    );
    expect(sql).toContain("listing_record.is_orderable");
    expect(sql).toContain("listing_record.published_at is not null");
    expect(sql).toContain("business_record.status = 'active'");
    expect(sql).toContain("category_record.is_active");
  });

  it("permits only bounded control-plane writes and immutable exact audit evidence", () => {
    const sql = compact(read(migrationPath));
    const inserts = sql.match(/insert into [a-z0-9_.]+/g) ?? [];

    expect(new Set(inserts)).toEqual(
      new Set([
        "insert into private.tool_gateway_actor_rate_limits",
        "insert into public.audit_events",
      ]),
    );
    expect(sql).toContain("tool_gateway_invocation");
    expect(sql).toContain("tool_gateway.get_platform_summary");
    expect(sql).toContain("contract_version");
    expect(sql).toContain("enable always trigger");
    expect(sql).toContain("tool-gateway audit evidence is immutable");
    expect(sql).toContain("first_limited");
    expect(sql).toContain("rate_limited");
    expect(sql).toContain("limited");
  });

  it("grants only the exact authenticated RPC and keeps it out of Realtime", () => {
    const sql = compact(read(migrationPath));

    expect(sql).toContain("security definer");
    expect(sql).toContain("set search_path = ''");
    expect(sql).toContain(
      "revoke all on function public.get_tool_gateway_platform_summary(uuid, text) from public, anon, authenticated, service_role",
    );
    expect(sql).toContain(
      "grant execute on function public.get_tool_gateway_platform_summary(uuid, text) to authenticated",
    );
    expect(sql).not.toContain(
      "grant execute on function public.get_tool_gateway_platform_summary(uuid, text) to service_role",
    );
    expect(sql).toContain("pg_catalog.pg_publication_tables");
  });

  it("ships a rollback-only behavioral probe for auth, scoping, rate, audit, and non-mutation", () => {
    const sql = compact(read(probePath));

    expect(sql).toMatch(/^begin;/);
    expect(sql).toMatch(/rollback;$/);
    expect(sql).not.toContain("pg_catalog.setval");
    for (const evidence of [
      "anonymous tool execution unexpectedly succeeded",
      "service-role tool execution unexpectedly succeeded",
      "ordinary profile tool execution unexpectedly succeeded",
      "suspended administrator tool execution unexpectedly succeeded",
      "platform summary did not match the market-scoped public catalog",
      "platform summary exposed an unexpected output column",
      "market-not-found response became an oracle",
      "rate limiter admitted more than sixty calls",
      "rate limiting amplified audit writes",
      "tool audit metadata was not exact",
      "tool audit evidence was mutable",
      "tool gateway mutated domain relations",
      "left tool-gateway probe fixture residue",
    ]) {
      expect(sql).toContain(evidence);
    }
  });
});

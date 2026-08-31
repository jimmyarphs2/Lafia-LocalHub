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
  "supabase/migrations/202608310035_localhub_notification_inbox_foundation.sql";
const probePath = "supabase/tests/notification_inbox_foundation_probe.sql";

describe("notification inbox foundation migration contract", () => {
  it("fails closed unless the exact empty legacy notification surface is present", () => {
    const rawSql = read(migrationPath);
    const sql = compact(rawSql);

    expect(sql).toContain("set local lock_timeout = '10s'");
    expect(sql).toContain("set local statement_timeout = '120s'");
    expect(sql.indexOf("lock table public.profiles")).toBeLessThan(
      sql.indexOf("lock table public.notifications in access exclusive mode"),
    );
    expect(sql.indexOf("lock table public.notifications")).toBeLessThan(
      sql.indexOf("do $$"),
    );
    expect(sql).toContain("exists (select 1 from public.notifications)");
    expect(sql).toContain("legacy notification surface precondition failed");
    expect(sql).toContain("using errcode = '55000'");
    for (const legacyColumn of [
      "id",
      "profile_id",
      "channel",
      "template_key",
      "payload",
      "status",
      "sent_at",
      "read_at",
      "created_at",
    ]) {
      expect(sql).toContain(`'${legacyColumn}'`);
    }
    expect(sql).toContain("notifications_pkey");
    expect(sql).toContain("notifications_profile_id_fkey");
    expect(sql).toContain("notifications_channel_check");
    expect(sql).toContain("notifications_status_check");
    expect(sql).toContain("constraint_record.conkey = array[");
    expect(sql).toContain("constraint_record.confkey = array[");
    expect(sql).toContain("constraint_record.confupdtype = 'a'");
    expect(sql).toContain("constraint_record.confmatchtype = 's'");
    expect(sql).toContain("constraint_record.convalidated");
    expect(sql).toContain("notifications_profile_status_idx");
    expect(sql).toContain("index set drifted");
    expect(sql).toContain("notifications_self");
    expect(sql).toContain("notifications_self_update");
    expect(sql).toContain("pg_catalog.pg_depend");
    expect(sql).toContain("pg_catalog.pg_rewrite");
    expect(sql).toContain("pg_catalog.pg_trigger");
    expect(sql).toContain("pg_catalog.pg_publication_tables");
    expect(sql).toContain("relreplident <> 'f'");
    expect(sql).toContain("no partial replacement objects");
    expect(sql).toContain(
      "function_record.prosrc ~* '[[:<:]]notifications[[:>:]]'",
    );
    for (const overEscaped of ["\\\\(", "\\\\)", "\\\\.", "\\\\[", "\\\\]"]) {
      expect(rawSql).not.toContain(overEscaped);
    }
  });

  it("replaces delivery-shaped legacy columns with a bounded inbox contract", () => {
    const sql = compact(read(migrationPath));

    for (const column of ["channel", "status", "sent_at", "payload"]) {
      expect(sql).toContain(`drop column ${column}`);
    }
    for (const definition of [
      "market_id uuid references public.markets(id) on delete restrict",
      "source_kind text not null",
      "source_id uuid not null",
      "template_version smallint not null default 1",
      "title text not null",
      "body text not null",
      "action_path text",
    ]) {
      expect(sql).toContain(definition);
    }
    expect(sql).toContain("octet_length(title) <= 480");
    expect(sql).toContain("char_length(title) between 1 and 120");
    expect(sql).toContain("octet_length(body) <= 2400");
    expect(sql).toContain("char_length(body) between 1 and 600");
    expect(sql).toContain("title !~ '[[:cntrl:]]'");
    expect(sql).toContain("body !~ '[[:cntrl:]]'");
    expect(sql).toContain(
      "action_path ~ '^/[a-z][a-z0-9_-]*(/[a-za-z0-9][a-za-z0-9_~-]*)*$'",
    );
    expect(sql).toContain(
      "unique (profile_id, source_kind, source_id, template_key, template_version)",
    );
    expect(sql).toContain(
      "create index notifications_profile_created_id_idx on public.notifications (profile_id, created_at desc, id desc)",
    );
    expect(sql).toContain(
      "create index notifications_profile_unread_created_id_idx on public.notifications (profile_id, created_at desc, id desc) where read_at is null",
    );
    expect(sql).toContain(
      "create index notifications_market_id_fkey_idx on public.notifications (market_id) where market_id is not null",
    );
  });

  it("allows only active owners to read and routes read state through one RPC", () => {
    const sql = compact(read(migrationPath));

    expect(sql).toContain(
      "alter table public.notifications force row level security",
    );
    expect(sql.match(/create policy /g) ?? []).toHaveLength(1);
    expect(sql).toContain(
      "create policy notifications_active_self_select on public.notifications for select to authenticated",
    );
    expect(sql).toContain("profile_id = (select auth.uid())");
    expect(sql).toContain("(select public.is_current_profile_active())");
    expect(sql).not.toMatch(/create policy .* for (?:insert|update|delete)/);
    expect(sql).toContain(
      "grant select (id, profile_id, market_id, template_key, template_version, title, body, action_path, read_at, created_at) on public.notifications to authenticated",
    );
    expect(sql).not.toMatch(/grant select \([^)]*source_(?:kind|id)/);
    expect(sql).not.toMatch(/grant[^;]*service_role/);

    expect(sql).toContain(
      "create function public.list_my_notifications (p_limit integer default 20, p_before_created_at timestamptz default null, p_before_id uuid default null, p_unread_only boolean default false)",
    );
    expect(sql).toContain("language plpgsql stable security invoker");
    expect(sql).toContain("p_limit not between 1 and 50");
    expect(sql).toContain(
      "(p_before_created_at is null) <> (p_before_id is null)",
    );
    expect(sql).toContain(
      "(notification_record.created_at, notification_record.id) < (p_before_created_at, p_before_id)",
    );
    expect(sql).toContain(
      "order by notification_record.created_at desc, notification_record.id desc",
    );

    expect(sql).toContain(
      "create function public.mark_my_notification_read(p_notification_id uuid)",
    );
    expect(sql).toContain("language plpgsql volatile security definer");
    expect(sql).toContain("for no key update");
    expect(sql).toContain("statement_timestamp()");
    for (const outcome of ["marked_read", "already_read", "not_found"]) {
      expect(sql).toContain(`'${outcome}'`);
    }
    expect(sql).toContain(
      "grant execute on function public.list_my_notifications(integer, timestamptz, uuid, boolean) to authenticated",
    );
    expect(sql).toContain(
      "grant execute on function public.mark_my_notification_read(uuid) to authenticated",
    );
  });

  it("enforces immutable inbox content even for privileged insertion paths", () => {
    const sql = compact(read(migrationPath));

    expect(sql).toContain(
      "create function private.enforce_notification_read_state() returns trigger language plpgsql security invoker",
    );
    expect(sql).toContain("if tg_op = 'insert' and new.read_at is not null");
    expect(sql).toContain("new is distinct from old");
    expect(sql).toContain("new.read_at := old.read_at");
    expect(sql).toContain("new.read_at := pg_catalog.statement_timestamp()");
    expect(sql).toContain(
      "before insert or update on public.notifications for each row",
    );
    expect(sql).toContain(
      "alter table public.notifications enable always trigger notifications_enforce_read_state",
    );
  });

  it("creates a provider-neutral delivery ledger that is structurally dormant", () => {
    const sql = compact(read(migrationPath));

    expect(sql).toContain("create table private.notification_deliveries");
    expect(sql).toContain(
      "notification_id uuid not null references public.notifications(id) on delete cascade",
    );
    expect(sql).toContain("channel in ('email', 'sms', 'push', 'voice')");
    expect(sql).toContain(
      "status in ('pending', 'leased', 'provider_accepted', 'retryable_failed', 'terminal_failed', 'suppressed')",
    );
    expect(sql).toContain("idempotency_key_sha256 ~ '^[0-9a-f]{64}$'");
    expect(sql).toContain("attempt_count between 0 and 20");
    expect(sql).toContain(
      "status not in ('provider_accepted', 'terminal_failed')",
    );
    expect(sql).toContain("completed_at >= last_attempt_at");
    expect(sql).toContain(
      "lease_expires_at <= leased_at + interval '15 minutes'",
    );
    expect(sql).toContain("unique (notification_id, channel)");
    expect(sql).toContain(
      "create unique index notification_deliveries_provider_message_unique_idx",
    );
    expect(sql).toContain(
      "create index notification_deliveries_ready_idx on private.notification_deliveries (channel, available_at, created_at, id) where status in ('pending', 'retryable_failed')",
    );
    expect(sql).toContain(
      "create index notification_deliveries_expired_lease_idx on private.notification_deliveries (lease_expires_at) where status = 'leased'",
    );
    expect(sql).not.toMatch(
      /\b(destination|recipient|email_address|phone|message_body|headers|credentials|secret)\b/,
    );
    expect(sql).toContain(
      "alter table private.notification_deliveries force row level security",
    );
    expect(sql).toContain(
      "create function private.prevent_dormant_notification_delivery_mutation()",
    );
    expect(sql).toContain(
      "before insert or update or delete on private.notification_deliveries for each row",
    );
    expect(sql).toContain(
      "before truncate on private.notification_deliveries for each statement",
    );
    expect(
      sql.match(/enable always trigger notification_deliveries_dormant_/g) ??
        [],
    ).toHaveLength(2);
    expect(sql).not.toMatch(
      /create function (?:public|private)\.(?:enqueue|claim|complete|fail|send|deliver)/,
    );
  });

  it("ships a rollback-only probe for metadata, authorization, behavior, and dormancy", () => {
    const sql = compact(read(probePath));

    expect(sql).toMatch(/^begin;/);
    expect(sql).toMatch(/rollback;$/);
    expect(sql).toContain("set local transaction_timeout");
    expect(sql).toContain("in access exclusive mode");
    for (const catalog of [
      "pg_catalog.pg_attribute",
      "pg_catalog.pg_constraint",
      "pg_catalog.pg_index",
      "pg_catalog.pg_policies",
      "pg_catalog.pg_trigger",
      "pg_catalog.pg_proc",
      "pg_catalog.pg_publication_tables",
      "pg_catalog.has_table_privilege",
      "pg_catalog.has_any_column_privilege",
      "pg_catalog.has_function_privilege",
    ]) {
      expect(sql).toContain(catalog);
    }
    for (const role of ["anon", "authenticated", "service_role", "postgres"]) {
      expect(sql).toContain(`set local role ${role}`);
    }
    expect(sql).toContain("request.jwt.claim.sub");
    expect(sql).toContain("request.jwt.claims");
    expect(sql).toContain("marked_read");
    expect(sql).toContain("already_read");
    expect(sql).toContain("not_found");
    expect(sql).toContain("invalid notification action path");
    expect(sql).toContain("duplicate notification identity");
    expect(sql).toContain("notification deliveries are dormant");
    expect(sql).toContain("session_replication_role = replica");
    expect(sql).toContain(
      "zero-attempt provider acceptance unexpectedly worked",
    );
    expect(sql).toContain("completion before last attempt unexpectedly worked");
    expect(sql).toContain("'maintain'");
    expect(sql).toContain("left notification fixture residue");
  });
});

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/202608290001_localhub_foundation.sql",
  ),
  "utf8",
);
const runtimeHardeningMigration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/202608290002_localhub_runtime_hardening.sql",
  ),
  "utf8",
);
const securityAndIndexMigration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/202608290003_localhub_security_and_index_hardening.sql",
  ),
  "utf8",
);
const authenticatedPolicyRepairMigration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/202608290004_localhub_authenticated_policy_repair.sql",
  ),
  "utf8",
);
const integrityHardeningMigration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/202608290005_localhub_integrity_hardening.sql",
  ),
  "utf8",
);
const onboardingAbuseControlsMigration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/202608290006_localhub_onboarding_abuse_controls.sql",
  ),
  "utf8",
);
const ledgerTriggerDispatchFixMigration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/202608290007_localhub_ledger_trigger_dispatch_fix.sql",
  ),
  "utf8",
);
const onboardingCompletionValidationMigration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/202608290008_localhub_onboarding_completion_validation.sql",
  ),
  "utf8",
);
const adminAuditReasonMigration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/202608290009_localhub_admin_audit_reason_validation.sql",
  ),
  "utf8",
);
const mediaReservationSafetyMigration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/202608290010_localhub_media_reservation_safety.sql",
  ),
  "utf8",
);
const adminReasonWhitespaceHardeningMigration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/202608290011_localhub_admin_reason_whitespace_hardening.sql",
  ),
  "utf8",
);
const publicRouteSlugConstraintsMigration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/202608290012_localhub_public_route_slug_constraints.sql",
  ),
  "utf8",
);
const notificationInboxFoundationMigration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/202608310035_localhub_notification_inbox_foundation.sql",
  ),
  "utf8",
);
const finalStoragePolicies = migration.slice(
  migration.lastIndexOf("drop policy listing_media_object_read"),
);

describe("Supabase security contract", () => {
  it("enforces one safe path-segment format for public catalog slugs", () => {
    for (const table of [
      "markets",
      "market_locations",
      "businesses",
      "categories",
      "listings",
    ]) {
      expect(publicRouteSlugConstraintsMigration).toContain(
        `alter table public.${table}`,
      );
      expect(publicRouteSlugConstraintsMigration).toContain(
        `validate constraint ${table}_public_route_slug_format;`,
      );
    }
    expect(
      publicRouteSlugConstraintsMigration.match(
        /check \(slug ~ '\^\[a-z0-9\]\+\(-\[a-z0-9\]\+\)\*\$'\) not valid;/g,
      ),
    ).toHaveLength(5);
    expect(publicRouteSlugConstraintsMigration).not.toMatch(
      /\b(insert into|update public|delete from|grant|revoke)\b/i,
    );
  });

  it("denies direct access to rate-limit state and scopes Realtime tables", () => {
    expect(runtimeHardeningMigration).toContain(
      "alter table public.auth_rate_limits enable row level security;",
    );
    expect(runtimeHardeningMigration).toContain("'orders'");
    expect(runtimeHardeningMigration).toContain("'order_status_events'");
    expect(runtimeHardeningMigration).toContain("'fulfilment_events'");
    expect(runtimeHardeningMigration).toContain("'notifications'");
    expect(runtimeHardeningMigration).toContain(
      "alter publication supabase_realtime add table public.%I",
    );
    expect(runtimeHardeningMigration).toContain("pg_publication_tables");
  });

  it("removes implicit administrative RPC access and covers foreign keys", () => {
    expect(migration).toContain(
      "alter default privileges revoke execute on functions from public, anon, authenticated;",
    );
    expect(securityAndIndexMigration).toContain(
      "revoke execute on function public.transition_business_status(uuid, text, text)",
    );
    expect(securityAndIndexMigration).toContain(
      "revoke execute on function public.set_profile_suspension(uuid, boolean, text)",
    );
    expect(securityAndIndexMigration).toContain(
      "create index if not exists admin_events_admin_idx",
    );
    expect(securityAndIndexMigration).toContain(
      "create index if not exists unmet_demand_category_idx",
    );
  });

  it("keeps active-profile checks non-probeable and enables scoped live reads", () => {
    expect(migration).not.toContain(
      "grant execute on function public.is_active_profile(uuid)",
    );
    expect(authenticatedPolicyRepairMigration).toContain(
      "grant execute on function public.is_current_profile_active()",
    );
    expect(authenticatedPolicyRepairMigration).toContain(
      "grant select on public.orders",
    );
    expect(authenticatedPolicyRepairMigration).toContain(
      "public.order_status_events",
    );
    expect(authenticatedPolicyRepairMigration).toContain(
      "public.fulfilment_events",
    );
    expect(notificationInboxFoundationMigration).toContain(
      "drop policy notifications_self_update on public.notifications",
    );
    expect(notificationInboxFoundationMigration).toContain(
      "grant execute on function public.mark_my_notification_read(uuid)",
    );
    expect(notificationInboxFoundationMigration).not.toContain(
      "grant update(status, read_at) on public.notifications",
    );
  });

  it("serializes ledger mutations and forces service writes through RPCs", () => {
    expect(integrityHardeningMigration).toContain("for no key update;");
    expect(integrityHardeningMigration).toContain(
      "order by a.id\n  for no key update;",
    );
    expect(integrityHardeningMigration).toContain(
      "and j.posted_at is not null",
    );
    expect(integrityHardeningMigration).toContain(
      "revoke all privileges on public.ledger_journals, public.ledger_entries",
    );
    expect(integrityHardeningMigration).toContain(
      "grant select on public.ledger_journals, public.ledger_entries",
    );
    expect(ledgerTriggerDispatchFixMigration).toContain(
      "if tg_table_name = 'ledger_journals' then",
    );
    expect(ledgerTriggerDispatchFixMigration).toContain(
      "elsif tg_table_name = 'ledger_entries' then",
    );
  });

  it("limits self-service profile edits and root-location duplicates", () => {
    expect(migration).not.toContain(
      "grant select, update on public.profiles to authenticated;",
    );
    expect(integrityHardeningMigration).toContain(
      "grant update(display_name, avatar_path, default_market_id, phone_e164)",
    );
    expect(migration).toContain(
      "unique nulls not distinct (market_id, parent_id, slug)",
    );
  });

  it("bounds authenticated tenant creation and onboarding write load", () => {
    expect(onboardingAbuseControlsMigration).toContain(
      "business_onboarding_drafts_owner_open_idx",
    );
    expect(onboardingAbuseControlsMigration).toContain(
      "when 'business_onboarding' then max_requests := 3",
    );
    expect(onboardingAbuseControlsMigration).toContain(
      "when 'business_onboarding_save' then max_requests := 120",
    );
    expect(onboardingAbuseControlsMigration).toContain(
      "complete the existing onboarding first",
    );
    expect(onboardingAbuseControlsMigration).toContain(
      "and d.submitted_at is null",
    );
    expect(onboardingAbuseControlsMigration).toContain(
      "when next_step = 'complete' then coalesce(d.submitted_at, now())",
    );
    expect(onboardingAbuseControlsMigration).toContain(
      "status = 'pending_review'",
    );
    expect(onboardingAbuseControlsMigration).toContain(
      "and d.data = draft_data",
    );
    expect(onboardingAbuseControlsMigration).toContain(
      "b.status in ('pending_review', 'active', 'suspended')",
    );
    expect(onboardingCompletionValidationMigration).toContain(
      "create or replace function public.is_valid_completed_onboarding_draft",
    );
    const finalOnboardingDefinitions = onboardingCompletionValidationMigration;
    expect(finalOnboardingDefinitions).toContain(
      "if not public.is_valid_completed_onboarding_draft",
    );
    expect(finalOnboardingDefinitions).toContain(
      "pg_catalog.jsonb_object_length(payload) <> 11",
    );
    expect(finalOnboardingDefinitions).toContain("'other-local-trade'");
    expect(finalOnboardingDefinitions).toContain(
      "!~ '^[+]?[0-9][0-9 ()-]{6,28}$'",
    );
    expect(finalOnboardingDefinitions).toContain("pg_catalog.btrim");
    expect(finalOnboardingDefinitions).toContain("for no key update of b");
    expect(finalOnboardingDefinitions).toContain("for share of m");
    expect(
      finalOnboardingDefinitions.indexOf("d.submitted_at is not null"),
    ).toBeLessThan(
      finalOnboardingDefinitions.indexOf(
        "if not public.is_valid_completed_onboarding_draft",
      ),
    );
    expect(finalOnboardingDefinitions).toContain(
      "and m.slug = payload->>'marketSlug'",
    );
    expect(onboardingCompletionValidationMigration).toContain(
      "public.is_valid_completed_onboarding_draft(uuid, jsonb)",
    );
  });

  it("uses a deterministic deny-by-default grant baseline", () => {
    expect(migration).toContain(
      "revoke all privileges on all tables in schema public from public, anon, authenticated;",
    );
    expect(migration).toContain(
      "alter default privileges in schema public revoke all on tables from public, anon, authenticated;",
    );
    expect(migration).toContain("grant select on public.markets");
  });

  it("keeps ledger writes behind an idempotent, balanced posting RPC", () => {
    expect(migration).toContain("posting_key text not null unique");
    expect(migration).toContain(
      "create or replace function public.post_journal",
    );
    expect(migration).toContain("jsonb_array_length(p_lines) < 2");
    expect(migration).toContain("ledger_journals_posted_immutable");
    expect(migration).toContain("before insert or update of posted_at");
    expect(migration).toContain("posted journals require balanced entries");
    expect(migration).toContain("ledger_entries_validate_currency");
    expect(migration).toContain("ledger_accounts_validate_currency");
    expect(migration).toContain("j.id = old.journal_id");
    expect(migration).toContain("j.id = new.journal_id");
  });

  it("uses secret-hashed, atomic guest intent RPCs and owner-only reads", () => {
    expect(migration).toContain("secret_hash text");
    expect(migration).toContain(
      "create or replace function public.create_guest_intent",
    );
    expect(migration).toContain(
      "create or replace function public.claim_guest_intent",
    );
    expect(migration).toContain("guest_intents_claimed_owner_select");
  });

  it("uses an immutable, canonical object path contract", () => {
    expect(finalStoragePolicies).toContain(
      "drop policy listing_media_object_update on storage.objects;",
    );
    expect(finalStoragePolicies).toContain(
      "drop policy listing_media_object_delete on storage.objects;",
    );
    expect(finalStoragePolicies).not.toContain(
      "create policy listing_media_object_update",
    );
    expect(finalStoragePolicies).not.toContain(
      "create policy listing_media_object_delete",
    );
    expect(migration).not.toContain(
      "create policy listing_media_manager_update",
    );
    expect(migration).not.toContain(
      "create policy listing_media_manager_delete",
    );
    expect(migration).toContain(
      "grant select, insert on public.listing_media to authenticated;",
    );
    expect(migration).toContain(
      "on conflict(id) do update set public = excluded.public",
    );
  });

  it("keeps manager object reads canonical and public reads market-active", () => {
    expect(migration).toContain("listing_media_object_manager_read");
    expect(migration).toContain(
      "/[0-9a-f]{32}\\.(jpg|jpeg|png|webp|mp4|pdf)$'",
    );
    expect(migration).toMatch(
      /listing_media_object_public_read[\s\S]*m\.is_active/,
    );
  });

  it("makes anonymous intent creation server-only and rate-limited", () => {
    expect(migration).toContain("create table public.auth_rate_limits");
    expect(migration).toContain(
      "create or replace function public.consume_auth_rate_limit",
    );
    expect(migration).toContain("p_rate_limit_key text");
    expect(migration).toContain(
      "revoke execute on function public.create_guest_intent(text,text,jsonb,text) from public, anon, authenticated;",
    );
    expect(migration).toContain(
      "grant execute on function public.create_guest_intent(text,text,jsonb,text) to service_role;",
    );
  });

  it("uses authenticated identity, rather than caller data, for media abuse controls", () => {
    expect(migration).toContain(
      "create or replace function public.consume_media_upload_rate_limit() returns boolean",
    );
    expect(migration).toContain("declare actor uuid := (select auth.uid())");
    expect(migration).toContain(
      "if not public.consume_media_upload_rate_limit() then raise exception 'media upload rate limit exceeded'; end if;",
    );
    expect(migration).toContain("on conflict(storage_path) do nothing");
    expect(migration).toContain("select r.expires_at into result_expiry");
    expect(migration).toContain("r.cleanup_state = 'none'");
    expect(migration).not.toContain(
      "on conflict(storage_path) do update set expires_at",
    );
    expect(migration).toContain(
      "revoke execute on function public.consume_media_upload_rate_limit() from public, anon, authenticated;",
    );
    expect(migration).toContain("listing_media_object_insert");
    expect(migration).toContain("has_reserved_listing_media_upload");
    expect(migration).toContain("has_confirmed_listing_media_upload");
    expect(migration).toContain("for key share of r");
    expect(migration).toContain("listing_media_record_registration");
    expect(migration).toContain(
      "grant execute on function public.has_reserved_listing_media_upload(text), public.has_confirmed_listing_media_upload(uuid,text) to authenticated;",
    );
    expect(finalStoragePolicies).not.toContain(
      "create policy listing_media_object_update",
    );
    expect(finalStoragePolicies).not.toContain(
      "create policy listing_media_object_delete",
    );
    expect(migration).toContain("r.status = 'confirmed'");
    expect(migration).toContain("mark_listing_media_upload_removed");
    expect(migration).toContain("interval '3 hours'");
    expect(mediaReservationSafetyMigration).toContain("interval '3 hours'");
    expect(mediaReservationSafetyMigration).toContain(
      "revoke execute on function public.reserve_listing_media_upload(uuid, text)",
    );
    expect(migration).toContain(
      "check ((status in ('confirmed','removed')) = (confirmed_at is not null))",
    );
    expect(migration).toContain(
      "grant execute on function public.expire_listing_media_upload_reservations() to service_role;",
    );
  });

  it("claims orphan-media cleanup work atomically for service workers only", () => {
    expect(migration).toContain(
      "listing_id uuid references public.listings(id) on delete set null",
    );
    expect(migration).toContain(
      "profile_id uuid references public.profiles(id) on delete set null",
    );
    expect(migration).toContain("r.listing_id is null or r.profile_id is null");
    expect(migration).toContain(
      "create or replace function public.claim_orphan_listing_media_cleanup(p_batch_size integer default 25)",
    );
    expect(migration).toContain("for update skip locked");
    expect(migration).toContain(
      "status = case when r.status = 'reserved' then 'expired' else r.status end",
    );
    expect(migration).toContain(
      "status = case when status = 'confirmed' then 'removed' else status end",
    );
    expect(migration).toContain("p_batch_size not between 1 and 100");
    expect(migration).toContain(
      "cleanup_claimed_at <= now() - interval '15 minutes'",
    );
    expect(migration).toContain(
      "cleanup_failed_at <= now() - interval '5 minutes'",
    );
    expect(migration).toContain(
      "grant execute on function public.claim_orphan_listing_media_cleanup(integer) to service_role;",
    );
    expect(migration).toContain(
      "grant execute on function public.complete_orphan_listing_media_cleanup(text,uuid) to service_role;",
    );
    expect(migration).toContain(
      "grant execute on function public.fail_orphan_listing_media_cleanup(text,uuid,text) to service_role;",
    );
    expect(migration).not.toContain(
      "grant execute on function public.claim_orphan_listing_media_cleanup(integer) to authenticated;",
    );
  });

  it("keeps security-critical administrative and catalog operations auditable", () => {
    expect(migration).toContain(
      "create or replace function public.set_profile_suspension",
    );
    expect(migration).toContain("profile_suspended");
    expect(migration).toContain("category_aliases_validate_market");
    expect(migration).toContain(
      "category_listing_type_mappings_validate_market",
    );
    expect(migration).toContain("search_intents_validate_market");
    expect(migration).toContain("requests_validate_market");
    expect(migration).toContain("demand_signals_validate_market");
    expect(migration).toContain("unmet_demand_validate_market");
    expect(migration).toContain("listing category schema mapping mismatch");
    expect(migration).not.toContain(
      "grant execute on function public.is_active_profile(uuid)",
    );
    expect(migration).toContain("not public.has_capability('super_admin')");
    expect(migration).toContain(
      "only super administrators can change suspension status",
    );
    for (const auditReasonMigration of [
      adminAuditReasonMigration,
      adminReasonWhitespaceHardeningMigration,
    ]) {
      expect(auditReasonMigration).toContain(
        "char_length(normalized_reason) not between 3 and 500",
      );
      expect(auditReasonMigration).toContain(
        "char_length(meaningful_reason) < 3",
      );
      expect(auditReasonMigration).toContain(
        "pg_catalog.btrim(reason, trim_chars)",
      );
      expect(auditReasonMigration).toContain("default_ignorable_pattern");
      expect(auditReasonMigration).not.toContain("trim(reason)");
    }
  });
});

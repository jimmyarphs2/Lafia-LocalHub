import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const foundation = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/202608290001_localhub_foundation.sql",
  ),
  "utf8",
);

describe("first Google identity bootstrap contract", () => {
  it("atomically creates one profile from trustworthy auth metadata", () => {
    expect(foundation).toContain("function public.handle_new_auth_user()");
    expect(foundation).toContain(
      "insert into public.profiles(id, display_name)",
    );
    expect(foundation).toContain("new.raw_user_meta_data ->> 'full_name'");
    expect(foundation).toContain("new.raw_user_meta_data ->> 'name'");
    expect(foundation).toContain(
      "create trigger on_auth_user_created after insert on auth.users",
    );
  });

  it("grants customer capability idempotently without auto-vendor access", () => {
    const bootstrap = foundation.slice(
      foundation.indexOf("function public.handle_new_auth_user()"),
      foundation.indexOf("function public.has_capability"),
    );

    expect(bootstrap).toContain(
      "values (new.id, 'customer') on conflict do nothing",
    );
    expect(bootstrap).not.toMatch(/merchant|business_memberships|vendor/);
  });

  it("prevents duplicate returning-user profiles and capabilities by key", () => {
    expect(foundation).toContain(
      "id uuid primary key references auth.users(id) on delete cascade",
    );
    expect(foundation).toContain("primary key (profile_id, capability)");
    expect(foundation).toContain("after insert on auth.users");
  });
});

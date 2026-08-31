import { afterEach, describe, expect, it } from "vitest";

import { getPublicSupabaseConfig } from "./env";

const priorUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const priorKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const priorPublishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

afterEach(() => {
  if (priorUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  else process.env.NEXT_PUBLIC_SUPABASE_URL = priorUrl;
  if (priorKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = priorKey;
  if (priorPublishableKey === undefined) {
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  } else {
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = priorPublishableKey;
  }
});

describe("Supabase environment", () => {
  it("keeps hosted Supabase optional during static or demo builds", () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    expect(getPublicSupabaseConfig()).toBeNull();
  });

  it("rejects malformed public Supabase URLs", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "not a URL";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "public-anon-key";
    expect(getPublicSupabaseConfig()).toBeNull();
  });

  it("allows HTTPS and local HTTP only", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://example.com";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "public-anon-key";
    expect(getPublicSupabaseConfig()).toBeNull();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
    expect(getPublicSupabaseConfig()).toEqual({
      url: "https://project.supabase.co",
      anonKey: "public-anon-key",
    });
  });

  it("prefers the modern publishable key over the legacy anon variable", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "public-publishable-key";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "legacy-anon-key";
    expect(getPublicSupabaseConfig()).toEqual({
      url: "https://project.supabase.co",
      anonKey: "public-publishable-key",
    });
  });
});

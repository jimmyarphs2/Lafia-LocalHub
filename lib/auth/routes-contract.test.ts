import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const read = (path: string) =>
  readFileSync(resolve(process.cwd(), path), "utf8");

describe("auth route boundaries", () => {
  it("uses 303 after POST and binds intent return targets server-side", () => {
    expect(read("app/auth/intent/route.ts")).toContain("p_return_to: next");
    expect(read("app/auth/intent/route.ts")).toContain("303,");
    expect(read("app/auth/provider/route.ts")).toContain("303);");
  });

  it("does not place the guest capability in callback URLs and supports a safe retry", () => {
    const callback = read("app/auth/callback/route.ts");
    expect(callback).toContain(
      "`/auth?resume=1&intent=${encodeURIComponent(intent.id)}",
    );
    expect(callback).not.toContain('searchParams.set("guest_intent"');
    expect(callback).not.toContain("&next=${encodeURIComponent(next)}");
    expect(callback).toContain("serializeAuthReturnCookie(next)");
    expect(callback).toMatch(/response\.headers\.set\(\s*"Location"/);
    const resume = read("app/auth/resume/route.ts");
    expect(resume).toContain("export async function POST");
    expect(resume).not.toContain("export async function GET");
    expect(resume).toContain('"claim_guest_intent"');
  });

  it("fails closed around every auth-provider network boundary", () => {
    expect(read("app/auth/intent/route.ts")).toContain(
      "p_rate_limit_key: rateLimitIdentifier",
    );
    for (const route of [
      "app/auth/provider/route.ts",
      "app/auth/email/route.ts",
      "app/auth/callback/route.ts",
      "app/auth/resume/route.ts",
    ]) {
      expect(read(route)).toContain("consumeAuthRateLimit");
      expect(read(route)).toContain("catch");
    }
  });
});

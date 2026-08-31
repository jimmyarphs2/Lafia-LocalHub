import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

function read(relativePath: string) {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

describe("tool-gateway server boundary", () => {
  it("uses the cookie-scoped user client and independently authenticates the user", () => {
    const source = read("lib/tools/gateway.ts");

    expect(source).toContain('import "server-only"');
    expect(source).toContain("getServerSupabaseClient");
    expect(source).toContain("client.auth.getUser");
    expect(source).toContain("createSupabaseToolGatewayAdapter");
    expect(source).toContain("dispatchToolGatewayRequest");
    expect(source).not.toMatch(/service[_-]?role|admin supabase|openai|grok/i);
  });

  it("emits only stable minimized control-plane observations", () => {
    const source = read("lib/tools/observer.ts");

    expect(source).toContain("[localhub-tool-gateway]");
    expect(source).not.toMatch(
      /actor|user|marketSlug|request|response|cookie|credential|providerError|errorMessage/,
    );
  });

  it("adds no public route, AI invocation, or external side effect", () => {
    const files = [
      "lib/tools/gateway.ts",
      "lib/tools/dispatcher.ts",
      "lib/tools/supabase-adapter.ts",
    ].map(read);
    const source = files.join("\n");

    expect(source).not.toMatch(
      /NextRequest|NextResponse|fetch\(|chat\.completions|responses\.create/,
    );
    expect(source).not.toMatch(
      /paystack|twilio|metricool|elevenlabs|seedance/i,
    );
  });
});

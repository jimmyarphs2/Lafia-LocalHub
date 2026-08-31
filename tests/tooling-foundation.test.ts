import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import nextConfig from "@/next.config";

const projectRoot = process.cwd();

function readProjectFile(path: string) {
  return readFileSync(resolve(projectRoot, path), "utf8");
}

describe("LocalHub development foundation", () => {
  it("uses the LocalHub package identity and shell-independent quality commands", () => {
    const packageJson = JSON.parse(readProjectFile("package.json")) as {
      name: string;
      scripts: Record<string, string>;
    };

    expect(packageJson.name).toBe("localhub");
    expect(packageJson.scripts.quality).toBe("node scripts/run-quality.mjs");

    for (const scriptName of [
      "dev",
      "build",
      "start",
      "lint",
      "typecheck",
      "test",
    ]) {
      expect(packageJson.scripts[scriptName]).toMatch(/^node /);
    }
  });

  it("keeps documented server credentials empty in the committed environment template", () => {
    const environmentTemplate = readProjectFile(".env.example");

    for (const key of [
      "SUPABASE_SERVICE_ROLE_KEY",
      "OPENAI_API_KEY",
      "OPENAI_MODEL",
    ]) {
      expect(environmentTemplate).toMatch(new RegExp(`^${key}=$`, "m"));
    }
  });

  it("applies baseline browser security headers to every application route", async () => {
    expect(nextConfig.headers).toBeTypeOf("function");

    const rules = await nextConfig.headers?.();
    const headers = rules?.find((rule) => rule.source === "/:path*")?.headers;

    expect(headers).toEqual(
      expect.arrayContaining([
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
      ]),
    );
  });
});

import { describe, expect, it } from "vitest";
import { serializeJsonLd } from "@/lib/catalog/structured-data";

describe("JSON-LD serialization", () => {
  it("escapes script-breaking less-than characters", () => {
    expect(serializeJsonLd({ name: "<script>" })).toContain("\\u003cscript>");
  });
});

import { describe, expect, it } from "vitest";

import {
  parseGuestIntentCookie,
  safeReturnPath,
  serializeGuestIntentCookie,
} from "./redirects";

describe("auth redirect boundaries", () => {
  it("accepts only same-site path returns", () => {
    expect(safeReturnPath("/lafia-demo/search?q=rice")).toBe(
      "/lafia-demo/search?q=rice",
    );
    expect(safeReturnPath("https://attacker.example/redirect")).toBe("/");
    expect(safeReturnPath("//attacker.example/redirect")).toBe("/");
    expect(safeReturnPath("/\n/attacker.example")).toBe("/");
    expect(safeReturnPath("/\t/attacker.example")).toBe("/");
    expect(safeReturnPath("/ path")).toBe("/");
  });

  it("keeps opaque guest intent capabilities in the cookie only", () => {
    const guestIntentId = "5aa8ff50-051b-4ff4-8c49-675b83a5f978";
    const secret = "a".repeat(64);
    expect(
      parseGuestIntentCookie(serializeGuestIntentCookie(guestIntentId, secret)),
    ).toEqual({ id: guestIntentId, secret });
    expect(parseGuestIntentCookie("not-a-cookie")).toBeNull();
  });
});

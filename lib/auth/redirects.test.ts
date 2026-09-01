import { describe, expect, it } from "vitest";

import {
  authReturnCookieName,
  authReturnStateCookieName,
  parseAuthReturnState,
  parseAuthReturnCookie,
  parsePkceFlowId,
  safeAuthReturnPath,
  parseGuestIntentCookie,
  safeReturnPath,
  serializeAuthReturnCookie,
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

  it("round-trips only bounded internal authentication returns", () => {
    const returnTo = "/lafia/search?q=fresh%20rice&category=groceries";

    expect(parseAuthReturnCookie(serializeAuthReturnCookie(returnTo))).toBe(
      returnTo,
    );
    expect(
      parseAuthReturnCookie(
        serializeAuthReturnCookie("https://attacker.example/collect"),
      ),
    ).toBe("/");
    expect(parseAuthReturnCookie("not-a-cookie")).toBeNull();
    expect(parseAuthReturnCookie("x".repeat(4097))).toBeNull();
  });

  it("accepts only Supabase's bounded flow-id alphabet for cookie correlation", () => {
    expect(parsePkceFlowId("flow_google_123")).toBe("flow_google_123");
    expect(parsePkceFlowId("bad flow")).toBeNull();
    expect(parsePkceFlowId("short")).toBeNull();
    expect(authReturnCookieName("flow_google_123")).toBe(
      `${authReturnCookieName()}-flow_google_123`,
    );
  });

  it("uses only UUID return states for email continuation cookie correlation", () => {
    const state = "11111111-1111-4111-8111-111111111111";
    expect(parseAuthReturnState(state)).toBe(state);
    expect(parseAuthReturnState("bad-state")).toBeNull();
    expect(authReturnStateCookieName(state)).toBe(
      `${authReturnCookieName()}-state-${state}`,
    );
    expect(authReturnStateCookieName("bad-state")).toBeNull();
  });

  it("prevents a completed login from returning into auth controllers", () => {
    expect(safeAuthReturnPath("/auth")).toBe("/");
    expect(safeAuthReturnPath("/auth/callback?code=replay")).toBe("/");
    expect(safeAuthReturnPath("/auth/logout")).toBe("/");
    expect(safeAuthReturnPath("/authentic-vendors")).toBe("/authentic-vendors");
  });
});

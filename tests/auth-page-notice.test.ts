import { describe, expect, it } from "vitest";

import { safeAuthNotice } from "@/lib/auth/notices";

describe("auth page notice boundary", () => {
  it("allows only the generic check-email notice", () => {
    expect(safeAuthNotice("check_email")).toBe("check_email");
    expect(safeAuthNotice("email_sent_to_someone@example.com")).toBeNull();
    expect(safeAuthNotice("configuration")).toBeNull();
    expect(safeAuthNotice(undefined)).toBeNull();
  });
});

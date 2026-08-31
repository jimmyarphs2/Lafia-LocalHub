import { describe, expect, it } from "vitest";

import {
  MEDIA_MUTATION_HEADER,
  MEDIA_MUTATION_HEADER_VALUE,
} from "@/lib/media/contracts";
import {
  isTrustedMediaMutation,
  readBoundedJsonBody,
} from "@/lib/media/request-security";

function mutationRequest(
  origin = "https://localhub.example",
  extraHeaders: Record<string, string> = {},
) {
  return new Request("https://localhub.example/api/vendor/media/negotiate", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin,
      "sec-fetch-site": "same-origin",
      [MEDIA_MUTATION_HEADER]: MEDIA_MUTATION_HEADER_VALUE,
      ...extraHeaders,
    },
    body: JSON.stringify({ ok: true }),
  });
}

describe("media mutation request boundary", () => {
  it("accepts a marked same-origin JSON mutation", () => {
    expect(isTrustedMediaMutation(mutationRequest())).toBe(true);
  });

  it("rejects a cross-origin request", () => {
    expect(
      isTrustedMediaMutation(mutationRequest("https://attacker.example")),
    ).toBe(false);
  });

  it("rejects a request without the media mutation marker", () => {
    expect(
      isTrustedMediaMutation(
        mutationRequest("https://localhub.example", {
          [MEDIA_MUTATION_HEADER]: "wrong-contract",
        }),
      ),
    ).toBe(false);
  });

  it("returns null for an oversized JSON metadata body", async () => {
    const body = JSON.stringify({ value: "x".repeat(9_000) });
    const request = new Request(
      "https://localhub.example/api/vendor/media/negotiate",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": String(body.length),
        },
        body,
      },
    );

    await expect(readBoundedJsonBody(request)).resolves.toBeNull();
  });

  it("cancels an oversized chunked JSON body without Content-Length", async () => {
    const encoder = new TextEncoder();
    let pulls = 0;
    let cancelled = false;
    const request = new Request(
      "https://localhub.example/api/vendor/media/negotiate",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: new ReadableStream<Uint8Array>({
          pull(controller) {
            pulls += 1;
            controller.enqueue(encoder.encode("x".repeat(1024)));
          },
          cancel() {
            cancelled = true;
          },
        }),
        duplex: "half",
      } as RequestInit,
    );

    await expect(readBoundedJsonBody(request)).resolves.toBeNull();

    expect(cancelled).toBe(true);
    expect(pulls).toBeLessThan(16);
  });
});

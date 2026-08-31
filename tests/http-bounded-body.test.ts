import { describe, expect, it } from "vitest";

import {
  readBoundedBody,
  readBoundedUrlEncodedForm,
} from "@/lib/http/bounded-body";

function unboundedChunkedRequest(chunkBytes: number) {
  const encoder = new TextEncoder();
  let pulls = 0;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulls += 1;
      controller.enqueue(encoder.encode("x".repeat(chunkBytes)));
    },
    cancel() {
      cancelled = true;
    },
  });

  return {
    request: new Request("https://localhub.example/stream", {
      body,
      headers: { "content-type": "application/x-www-form-urlencoded" },
      method: "POST",
      // Node's Fetch implementation requires this for a stream request body.
      duplex: "half",
    } as RequestInit),
    wasCancelled: () => cancelled,
    pulls: () => pulls,
  };
}

describe("bounded request body reader", () => {
  it("cancels a chunked body with no Content-Length before all chunks are read", async () => {
    const stream = unboundedChunkedRequest(512);

    await expect(readBoundedBody(stream.request, 1024)).resolves.toBeNull();

    expect(stream.wasCancelled()).toBe(true);
    expect(stream.pulls()).toBeLessThan(10);
  });

  it("rejects non-url-encoded form media types", async () => {
    const stream = unboundedChunkedRequest(512);
    stream.request.headers.set(
      "content-type",
      "multipart/form-data; boundary=x",
    );

    await expect(
      readBoundedUrlEncodedForm(stream.request, 1024),
    ).resolves.toBeNull();
  });
});

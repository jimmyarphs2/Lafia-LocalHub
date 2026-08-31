/**
 * Reads a request body incrementally and never concatenates it until the
 * configured byte limit has been validated. `Content-Length` is only an early
 * rejection optimization: the stream remains the enforcement boundary.
 */
export async function readBoundedBody(
  request: Request,
  maximumBytes: number,
): Promise<Uint8Array | null> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0) {
    throw new RangeError("maximumBytes must be a non-negative safe integer.");
  }

  const declaredLength = request.headers.get("content-length");
  if (
    declaredLength !== null &&
    /^\d+$/.test(declaredLength) &&
    Number(declaredLength) > maximumBytes
  ) {
    return null;
  }

  if (!request.body) return new Uint8Array();

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytesRead = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      bytesRead += value.byteLength;
      if (bytesRead > maximumBytes) {
        await reader.cancel("Request body exceeds the permitted size.");
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(bytesRead);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export function hasUrlEncodedFormContentType(request: Request): boolean {
  const contentType = request.headers.get("content-type");
  return (
    contentType?.split(";", 1)[0]?.trim().toLowerCase() ===
    "application/x-www-form-urlencoded"
  );
}

/**
 * Auth forms deliberately accept only URL-encoded scalar fields; multipart
 * parsing would permit file uploads and its own unbounded parser buffering.
 */
export async function readBoundedUrlEncodedForm(
  request: Request,
  maximumBytes: number,
): Promise<URLSearchParams | null> {
  if (!hasUrlEncodedFormContentType(request)) return null;

  const body = await readBoundedBody(request, maximumBytes);
  if (!body) return null;

  try {
    return new URLSearchParams(
      new TextDecoder("utf-8", { fatal: true }).decode(body),
    );
  } catch {
    return null;
  }
}

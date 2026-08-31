import {
  MEDIA_MUTATION_HEADER,
  MEDIA_MUTATION_HEADER_VALUE,
} from "@/lib/media/contracts";
import { readBoundedBody } from "@/lib/http/bounded-body";

const MAX_JSON_BODY_BYTES = 8 * 1024;
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{8,64}$/;

export function isTrustedMediaMutation(request: Request): boolean {
  const originHeader = request.headers.get("origin");
  const contentType = request.headers.get("content-type") ?? "";
  const fetchSite = request.headers.get("sec-fetch-site");

  if (!originHeader || !contentType.startsWith("application/json")) {
    return false;
  }

  if (
    request.headers.get(MEDIA_MUTATION_HEADER) !== MEDIA_MUTATION_HEADER_VALUE
  ) {
    return false;
  }

  if (fetchSite && fetchSite !== "same-origin") return false;

  try {
    return new URL(originHeader).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

export async function readBoundedJsonBody(
  request: Request,
): Promise<unknown | null> {
  try {
    const body = await readBoundedBody(request, MAX_JSON_BODY_BYTES);
    if (!body) return null;
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(body),
    ) as unknown;
  } catch {
    return null;
  }
}

export function getSafeRequestId(request: Request): string {
  const supplied = request.headers.get("x-request-id");
  return supplied && SAFE_REQUEST_ID.test(supplied)
    ? supplied
    : crypto.randomUUID();
}

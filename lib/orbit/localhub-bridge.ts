export const LOCALHUB_ORBIT_COMPANY_ID = "localhub" as const;
export const MERCHANT_ONBOARDING_STALLED_EVENT =
  "localhub.merchant.onboarding_stalled" as const;

const MAX_MERCHANT_ID_LENGTH = 128;
const MAX_SOURCE_EVENT_ID_LENGTH = 160;
const MAX_RECIPIENT_LENGTH = 320;
const MAX_NEXT_STEP_LENGTH = 240;
const MAX_STALLED_HOURS = 8760;
const ISO_TIMESTAMP_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-](?:0\d|1\d|2[0-3]):[0-5]\d)$/u;

export type LocalHubOrbitEvent = Readonly<{
  companyId: typeof LOCALHUB_ORBIT_COMPANY_ID;
  type: typeof MERCHANT_ONBOARDING_STALLED_EVENT;
  occurredAt: string;
  source: Readonly<{ system: "localhub"; eventId: string }>;
  subject: Readonly<{ aggregateId: string }>;
  payload: Readonly<{
    hoursStalled: number;
    recipient: string | null;
    nextStep: string;
  }>;
  idempotencyKey: string;
  schemaVersion: "1.0.0";
}>;

export interface OrbitEventSink {
  ingest(event: LocalHubOrbitEvent): unknown | Promise<unknown>;
}

export type MerchantOnboardingStalledInput = {
  merchantId: string;
  hoursStalled: number;
  recipient?: string | null;
  nextStep: string;
  sourceEventId: string;
  occurredAt?: string;
};

function requiredText(
  value: unknown,
  field: string,
  maxLength: number,
): string {
  if (typeof value !== "string") {
    throw new TypeError(`${field} must be a string`);
  }

  const normalized = value.trim();
  if (!normalized) {
    throw new TypeError(`${field} must not be empty`);
  }
  if (normalized.length > maxLength) {
    throw new RangeError(`${field} is too long`);
  }
  if (/[\r\n]/u.test(normalized)) {
    throw new TypeError(`${field} must not contain line breaks`);
  }

  return normalized;
}

function optionalRecipient(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  return requiredText(value, "recipient", MAX_RECIPIENT_LENGTH);
}

function eventTime(value: unknown): string {
  if (value === undefined) return new Date().toISOString();
  const text = requiredText(value, "occurredAt", 64);
  const match = ISO_TIMESTAMP_PATTERN.exec(text);
  if (!match) {
    throw new TypeError("occurredAt must be a valid ISO timestamp");
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const daysInMonth = [
    31,
    year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];

  const maxDay = daysInMonth[month - 1] ?? 0;
  if (month < 1 || month > 12 || day < 1 || day > maxDay) {
    throw new TypeError("occurredAt must be a valid ISO timestamp");
  }

  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) {
    throw new TypeError("occurredAt must be a valid ISO timestamp");
  }
  return parsed.toISOString();
}

function stalledHours(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > MAX_STALLED_HOURS
  ) {
    throw new RangeError(
      `hoursStalled must be an integer between 0 and ${MAX_STALLED_HOURS}`,
    );
  }
  return value;
}

/**
 * Maps an authoritative LocalHub onboarding observation to the ORBIT event
 * envelope. It does not send messages or perform any other external mutation.
 */
export function toMerchantOnboardingStalledEvent(
  input: MerchantOnboardingStalledInput,
): LocalHubOrbitEvent {
  const merchantId = requiredText(
    input?.merchantId,
    "merchantId",
    MAX_MERCHANT_ID_LENGTH,
  );
  const sourceEventId = requiredText(
    input?.sourceEventId,
    "sourceEventId",
    MAX_SOURCE_EVENT_ID_LENGTH,
  );
  const nextStep = requiredText(
    input?.nextStep,
    "nextStep",
    MAX_NEXT_STEP_LENGTH,
  );
  const recipient = optionalRecipient(input?.recipient);
  const hoursStalled = stalledHours(input?.hoursStalled);

  const payload = Object.freeze({ hoursStalled, recipient, nextStep });
  const source = Object.freeze({
    system: "localhub" as const,
    eventId: sourceEventId,
  });
  const subject = Object.freeze({ aggregateId: merchantId });

  return Object.freeze({
    companyId: LOCALHUB_ORBIT_COMPANY_ID,
    type: MERCHANT_ONBOARDING_STALLED_EVENT,
    occurredAt: eventTime(input?.occurredAt),
    source,
    subject,
    payload,
    idempotencyKey: sourceEventId,
    schemaVersion: "1.0.0" as const,
  });
}

/**
 * Composition boundary for the private @enterorbit/os-core package.
 * LocalHub supplies the event; ORBIT supplies the governed sink.
 */
export function createLocalHubOrbitBridge(sink: OrbitEventSink) {
  if (!sink || typeof sink.ingest !== "function") {
    throw new TypeError("An ORBIT event sink is required");
  }

  return Object.freeze({
    async emitMerchantOnboardingStalled(
      input: MerchantOnboardingStalledInput,
    ): Promise<unknown> {
      return sink.ingest(toMerchantOnboardingStalledEvent(input));
    },
  });
}

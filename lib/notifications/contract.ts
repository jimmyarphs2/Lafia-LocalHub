import { z } from "zod";

export const NOTIFICATION_LIST_DEFAULT = 20;
export const NOTIFICATION_LIST_MAXIMUM = 50;

const controlCharacterPattern = /[\u0000-\u001f\u007f-\u009f]/u;
const internalActionPathPattern =
  /^\/[a-z][a-z0-9_-]*(?:\/[A-Za-z0-9][A-Za-z0-9_~-]*)*$/;

function utf8Length(value: string): number {
  return new TextEncoder().encode(value).length;
}

function boundedPlainText(maximumCharacters: number, maximumBytes: number) {
  return z
    .string()
    .min(1)
    .max(maximumCharacters)
    .refine((value) => value === value.trim(), "Text must be trimmed.")
    .refine(
      (value) => !controlCharacterPattern.test(value),
      "Control characters are not allowed.",
    )
    .refine(
      (value) => utf8Length(value) <= maximumBytes,
      "Text exceeds its UTF-8 byte limit.",
    );
}

export const notificationIdSchema = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );

export const notificationTemplateKeySchema = z
  .string()
  .regex(/^[a-z][a-z0-9_.-]{2,95}$/);

export const notificationActionPathSchema = z
  .string()
  .min(2)
  .max(300)
  .regex(internalActionPathPattern);

export const notificationTimestampSchema = z
  .string()
  .datetime({ offset: true })
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/,
  );

function timestampMicroseconds(value: string): bigint | null {
  const match =
    /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/.exec(
      value,
    );
  if (!match) return null;
  const wholeSecondMilliseconds = Date.parse(`${match[1]}${match[3]}`);
  if (!Number.isFinite(wholeSecondMilliseconds)) return null;
  const fractionalMicroseconds = BigInt((match[2] ?? "").padEnd(6, "0"));
  return BigInt(wholeSecondMilliseconds) * 1_000n + fractionalMicroseconds;
}

const inAppNotificationWireSchema = z
  .object({
    notification_id: notificationIdSchema,
    market_id: notificationIdSchema.nullable(),
    template_key: notificationTemplateKeySchema,
    template_version: z.literal(1),
    title: boundedPlainText(120, 480),
    body: boundedPlainText(600, 2_400),
    action_path: notificationActionPathSchema.nullable(),
    read_at: notificationTimestampSchema.nullable(),
    created_at: notificationTimestampSchema,
  })
  .strict()
  .superRefine((row, context) => {
    const readAt = row.read_at ? timestampMicroseconds(row.read_at) : null;
    const createdAt = timestampMicroseconds(row.created_at);
    if (
      row.read_at !== null &&
      readAt !== null &&
      createdAt !== null &&
      readAt < createdAt
    ) {
      context.addIssue({
        code: "custom",
        path: ["read_at"],
        message: "Read time cannot precede notification creation.",
      });
    }
  });

const markedNotificationWireSchema = z.discriminatedUnion("outcome", [
  z
    .object({
      outcome: z.literal("marked_read"),
      notification_id: notificationIdSchema,
      read_at: notificationTimestampSchema,
    })
    .strict(),
  z
    .object({
      outcome: z.literal("already_read"),
      notification_id: notificationIdSchema,
      read_at: notificationTimestampSchema,
    })
    .strict(),
  z
    .object({
      outcome: z.literal("not_found"),
      notification_id: z.null(),
      read_at: z.null(),
    })
    .strict(),
]);

const notificationCursorSchema = z
  .object({
    createdAt: notificationTimestampSchema,
    notificationId: notificationIdSchema,
  })
  .strict();

export const notificationListInputSchema = z
  .object({
    marketId: notificationIdSchema,
    limit: z
      .number()
      .int()
      .min(1)
      .max(NOTIFICATION_LIST_MAXIMUM)
      .default(NOTIFICATION_LIST_DEFAULT),
    cursor: notificationCursorSchema.nullable().default(null),
    unreadOnly: z.boolean().default(false),
  })
  .strict();

const notificationParseOptionsSchema = notificationListInputSchema.pick({
  marketId: true,
  limit: true,
  cursor: true,
  unreadOnly: true,
});

export type InAppNotification = {
  notificationId: string;
  marketId: string | null;
  templateKey: string;
  templateVersion: 1;
  title: string;
  body: string;
  actionPath: string | null;
  readAt: string | null;
  createdAt: string;
};

export type NotificationListInput = z.input<typeof notificationListInputSchema>;

export type NotificationMarkReadResult =
  | {
      outcome: "marked_read" | "already_read";
      notificationId: string;
      readAt: string;
    }
  | {
      outcome: "not_found";
      notificationId: null;
      readAt: null;
    };

function mapNotificationWireRow(
  row: z.infer<typeof inAppNotificationWireSchema>,
): InAppNotification {
  return {
    notificationId: row.notification_id,
    marketId: row.market_id,
    templateKey: row.template_key,
    templateVersion: row.template_version,
    title: row.title,
    body: row.body,
    actionPath: row.action_path,
    readAt: row.read_at,
    createdAt: row.created_at,
  };
}

export function parseInAppNotification(
  value: unknown,
): InAppNotification | null {
  const parsed = inAppNotificationWireSchema.safeParse(value);
  return parsed.success ? mapNotificationWireRow(parsed.data) : null;
}

export function parseInAppNotificationList(
  value: unknown,
  options: unknown,
): InAppNotification[] | null {
  const parsedOptions = notificationParseOptionsSchema.safeParse(options);
  if (!parsedOptions.success) return null;
  const parsed = z
    .array(inAppNotificationWireSchema)
    .max(parsedOptions.data.limit)
    .safeParse(value);
  if (!parsed.success) return null;

  const ids = new Set<string>();
  const notifications: InAppNotification[] = [];
  let previous: z.infer<typeof inAppNotificationWireSchema> | null = null;
  for (const row of parsed.data) {
    if (ids.has(row.notification_id)) return null;
    if (parsedOptions.data.unreadOnly && row.read_at !== null) return null;
    const rowCreatedAt = timestampMicroseconds(row.created_at)!;
    const previousCreatedAt = previous
      ? timestampMicroseconds(previous.created_at)
      : null;
    if (
      previous &&
      (rowCreatedAt > previousCreatedAt! ||
        (rowCreatedAt === previousCreatedAt &&
          row.notification_id >= previous.notification_id))
    ) {
      return null;
    }
    const cursor = parsedOptions.data.cursor;
    if (cursor) {
      const cursorCreatedAt = timestampMicroseconds(cursor.createdAt)!;
      if (
        rowCreatedAt > cursorCreatedAt ||
        (rowCreatedAt === cursorCreatedAt &&
          row.notification_id >= cursor.notificationId)
      ) {
        return null;
      }
    }
    ids.add(row.notification_id);
    if (
      row.market_id === null ||
      row.market_id === parsedOptions.data.marketId
    ) {
      notifications.push(mapNotificationWireRow(row));
    }
    previous = row;
  }
  return notifications;
}

export function parseNotificationMarkReadResult(
  value: unknown,
  expectedNotificationId: string,
): NotificationMarkReadResult | null {
  if (!notificationIdSchema.safeParse(expectedNotificationId).success) {
    return null;
  }
  const row = Array.isArray(value) && value.length === 1 ? value[0] : null;
  const parsed = markedNotificationWireSchema.safeParse(row);
  if (!parsed.success) return null;
  if (parsed.data.outcome === "not_found") {
    return {
      outcome: "not_found",
      notificationId: null,
      readAt: null,
    };
  }
  if (parsed.data.notification_id !== expectedNotificationId) return null;
  return {
    outcome: parsed.data.outcome,
    notificationId: parsed.data.notification_id,
    readAt: parsed.data.read_at,
  };
}

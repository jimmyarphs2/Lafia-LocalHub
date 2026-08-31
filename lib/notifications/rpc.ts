import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  notificationIdSchema,
  notificationListInputSchema,
  parseInAppNotificationList,
  parseNotificationMarkReadResult,
  type InAppNotification,
  type NotificationListInput,
  type NotificationMarkReadResult,
} from "@/lib/notifications/contract";
import type { Database } from "@/lib/supabase/database.types";

type NotificationClient = SupabaseClient<Database>;
type RpcResponse = { data: unknown; error: unknown };

export type NotificationRpcFailure =
  { kind: "provider"; cause: unknown } | { kind: "contract"; cause: Error };

function contractFailure(operation: string): NotificationRpcFailure {
  return {
    kind: "contract",
    cause: new Error(
      `${operation} response did not match its bounded notification contract.`,
    ),
  };
}

async function requestRpc(
  operation: string,
  request: () => PromiseLike<RpcResponse>,
): Promise<
  | { response: RpcResponse; error: null }
  | { response: null; error: NotificationRpcFailure }
> {
  let response: RpcResponse;
  try {
    response = await request();
  } catch (cause) {
    return { response: null, error: { kind: "provider", cause } };
  }
  if (response.error !== null && response.error !== undefined) {
    return {
      response: null,
      error: { kind: "provider", cause: response.error },
    };
  }
  return { response, error: null };
}

export async function listMyInAppNotifications(
  client: NotificationClient,
  input: NotificationListInput,
): Promise<{
  notifications: InAppNotification[] | null;
  error: NotificationRpcFailure | null;
}> {
  const parsedInput = notificationListInputSchema.safeParse(input);
  if (!parsedInput.success) {
    return {
      notifications: null,
      error: contractFailure("list_my_notifications input"),
    };
  }

  const cursorArguments = parsedInput.data.cursor
    ? {
        p_before_created_at: parsedInput.data.cursor.createdAt,
        p_before_id: parsedInput.data.cursor.notificationId,
      }
    : {};
  const result = await requestRpc("list_my_notifications", () =>
    client.rpc("list_my_notifications", {
      p_limit: parsedInput.data.limit,
      p_unread_only: parsedInput.data.unreadOnly,
      ...cursorArguments,
    }),
  );
  if (result.error) return { notifications: null, error: result.error };

  const notifications = parseInAppNotificationList(result.response.data, {
    marketId: parsedInput.data.marketId,
    limit: parsedInput.data.limit,
    cursor: parsedInput.data.cursor,
    unreadOnly: parsedInput.data.unreadOnly,
  });
  return notifications === null
    ? {
        notifications: null,
        error: contractFailure("list_my_notifications"),
      }
    : { notifications, error: null };
}

export async function markMyInAppNotificationRead(
  client: NotificationClient,
  notificationId: string,
): Promise<{
  result: NotificationMarkReadResult | null;
  error: NotificationRpcFailure | null;
}> {
  if (!notificationIdSchema.safeParse(notificationId).success) {
    return {
      result: null,
      error: contractFailure("mark_my_notification_read input"),
    };
  }

  const response = await requestRpc("mark_my_notification_read", () =>
    client.rpc("mark_my_notification_read", {
      p_notification_id: notificationId,
    }),
  );
  if (response.error) return { result: null, error: response.error };

  const result = parseNotificationMarkReadResult(
    response.response.data,
    notificationId,
  );
  return result === null
    ? { result: null, error: contractFailure("mark_my_notification_read") }
    : { result, error: null };
}

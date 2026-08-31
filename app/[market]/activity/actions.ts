"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  notificationIdSchema,
  notificationTimestampSchema,
} from "@/lib/notifications/contract";
import {
  listMyInAppNotifications,
  markMyInAppNotificationRead,
} from "@/lib/notifications/rpc";
import { marketSlugSchema } from "@/lib/requests/contract";
import { getServerSupabaseClient } from "@/lib/supabase/server";

const actionInputSchema = z
  .object({
    market: marketSlugSchema,
    notificationId: notificationIdSchema,
  })
  .strict();

type FailureCode = "not_found" | "unauthorized" | "unavailable" | "validation";

export type NotificationActionResult =
  | {
      ok: true;
      retryable: false;
      code: "marked_read" | "already_read";
      message: string;
    }
  | {
      ok: false;
      retryable: boolean;
      code: FailureCode;
      message: string;
    };

type UserClient = NonNullable<
  Awaited<ReturnType<typeof getServerSupabaseClient>>
>;

type NotificationContext =
  | { ok: true; client: UserClient; marketId: string }
  | { ok: false; result: NotificationActionResult };

function failure(
  code: FailureCode,
  message: string,
  retryable = false,
): NotificationActionResult {
  return { ok: false, retryable, code, message };
}

function exactActionInput(formData: FormData): unknown {
  const allowedKeys = new Set(["market", "notification_id"]);
  const receivedKeys = new Set(formData.keys());
  if (
    receivedKeys.size !== allowedKeys.size ||
    [...receivedKeys].some((key) => !allowedKeys.has(key))
  ) {
    return null;
  }

  const marketValues = formData.getAll("market");
  const notificationValues = formData.getAll("notification_id");
  if (
    marketValues.length !== 1 ||
    notificationValues.length !== 1 ||
    typeof marketValues[0] !== "string" ||
    typeof notificationValues[0] !== "string"
  ) {
    return null;
  }
  return {
    market: marketValues[0],
    notificationId: notificationValues[0],
  };
}

async function getNotificationContext(
  market: string,
): Promise<NotificationContext> {
  const client = await getServerSupabaseClient().catch(() => null);
  if (!client) {
    return {
      ok: false,
      result: failure(
        "unauthorized",
        "Your session has expired. Sign in again to manage notifications.",
      ),
    };
  }

  const user = await client.auth.getUser().catch(() => null);
  if (!user?.data.user) {
    return {
      ok: false,
      result: failure(
        "unauthorized",
        "Your session has expired. Sign in again to manage notifications.",
      ),
    };
  }

  const access = await Promise.all([
    client.rpc("is_current_profile_active"),
    client
      .from("markets")
      .select("id,slug")
      .eq("slug", market)
      .eq("is_active", true)
      .maybeSingle(),
  ]).catch(() => null);
  if (!access) {
    return {
      ok: false,
      result: failure(
        "unavailable",
        "Notifications are temporarily unavailable. Try again later.",
        true,
      ),
    };
  }

  const [profileResult, marketResult] = access;
  if (profileResult.error || marketResult.error) {
    return {
      ok: false,
      result: failure(
        "unavailable",
        "Notifications are temporarily unavailable. Try again later.",
        true,
      ),
    };
  }
  if (profileResult.data !== true) {
    return {
      ok: false,
      result: failure(
        "unauthorized",
        "This account cannot manage notifications.",
      ),
    };
  }

  const marketId = notificationIdSchema.safeParse(marketResult.data?.id);
  if (!marketId.success || marketResult.data?.slug !== market) {
    return {
      ok: false,
      result: failure(
        "validation",
        "This market is not available for notifications.",
      ),
    };
  }
  return { ok: true, client, marketId: marketId.data };
}

export async function markNotificationRead(
  _previousState: NotificationActionResult | null,
  formData: FormData,
): Promise<NotificationActionResult> {
  const input = actionInputSchema.safeParse(exactActionInput(formData));
  if (!input.success) {
    return failure(
      "validation",
      "We could not verify this notification request.",
    );
  }

  const context = await getNotificationContext(input.data.market);
  if (!context.ok) return context.result;

  const visible = await listMyInAppNotifications(context.client, {
    marketId: context.marketId,
    limit: 50,
    cursor: null,
    unreadOnly: false,
  }).catch(() => ({ notifications: null, error: true }));
  if (visible.error || !visible.notifications) {
    return failure(
      "unavailable",
      "Notifications are temporarily unavailable. Try again later.",
      true,
    );
  }

  const matches = visible.notifications.filter(
    (notification) =>
      notification.notificationId === input.data.notificationId &&
      (notification.marketId === null ||
        notification.marketId === context.marketId),
  );
  if (matches.length !== 1) {
    return failure("not_found", "This notification is no longer available.");
  }

  const marked = await markMyInAppNotificationRead(
    context.client,
    input.data.notificationId,
  ).catch(() => ({ result: null, error: true }));
  if (marked.error || !marked.result) {
    return failure(
      "unavailable",
      "Notifications are temporarily unavailable. Try again later.",
      true,
    );
  }
  if (marked.result.outcome === "not_found") {
    return failure("not_found", "This notification is no longer available.");
  }
  if (
    marked.result.notificationId !== input.data.notificationId ||
    !notificationTimestampSchema.safeParse(marked.result.readAt).success ||
    (marked.result.outcome !== "marked_read" &&
      marked.result.outcome !== "already_read")
  ) {
    return failure(
      "unavailable",
      "We could not confirm this notification change. Try again later.",
      true,
    );
  }

  revalidatePath(`/${input.data.market}/activity`);
  return {
    ok: true,
    retryable: false,
    code: marked.result.outcome,
    message:
      marked.result.outcome === "marked_read"
        ? "Marked as read."
        : "This notification was already marked as read.",
  };
}

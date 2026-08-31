"use server";

import { validateAdaptiveListingValues } from "@/lib/ale/validation";
import {
  saveVendorListingDraftInputSchema,
  type SaveVendorListingDraftInput,
} from "@/lib/listings/contract";
import { saveListingDraft } from "@/lib/listings/persistence";
import { loadVendorListingDraftWorkspace } from "@/lib/listings/workspace";
import { getServerSupabaseClient } from "@/lib/supabase/server";

export type SaveVendorListingDraftActionResult =
  | {
      ok: true;
      outcome: "created" | "updated";
      listingId: string;
      revision: number;
      savedAt: string;
    }
  | {
      ok: false;
      code:
        | "configuration"
        | "unauthorized"
        | "validation"
        | "conflict"
        | "draft_limit"
        | "rate_limited"
        | "taxonomy_unavailable"
        | "persistence";
      message: string;
      fieldErrors?: Record<string, string>;
    };

function fieldErrorsFromIssues(
  issues: readonly { path: PropertyKey[]; message: string }[],
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of issues) {
    const field = issue.path.at(-1);
    if (typeof field === "string" && !errors[field]) {
      errors[field] = issue.message;
    }
  }
  return errors;
}

function slugBaseFromAuthoritativeTitle(title: unknown): string {
  if (typeof title !== "string") return "listing";
  const slug = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
  return slug || "listing";
}

/**
 * Save only an authenticated vendor's unpublished listing draft. This action
 * intentionally does not revalidate during autosave; the caller already owns
 * the editor's local state and receives a small revision acknowledgement.
 */
export async function saveVendorListingDraft(
  untrustedInput: SaveVendorListingDraftInput,
): Promise<SaveVendorListingDraftActionResult> {
  const input = saveVendorListingDraftInputSchema.safeParse(untrustedInput);
  if (!input.success) {
    return {
      ok: false,
      code: "validation",
      message: "Check the highlighted listing details and try again.",
      fieldErrors: fieldErrorsFromIssues(input.error.issues),
    };
  }

  const client = await getServerSupabaseClient();
  if (!client) {
    return {
      ok: false,
      code: "configuration",
      message: "Secure listing drafts are not configured in this environment.",
    };
  }

  try {
    const {
      data: { user },
    } = await client.auth.getUser();
    if (!user) {
      return {
        ok: false,
        code: "unauthorized",
        message: "Your session has expired. Sign in again to continue.",
      };
    }
  } catch {
    return {
      ok: false,
      code: "unauthorized",
      message: "Your session could not be verified. Sign in again to continue.",
    };
  }

  // This manager-authorized RPC is both the authorization check and the source of
  // truth for the currently published schema. Do not trust client schema data.
  const workspace = await loadVendorListingDraftWorkspace(client, {
    targetBusinessId: input.data.targetBusinessId,
    ...(input.data.listingId ? { listingId: input.data.listingId } : {}),
  });
  if (!workspace.ok) {
    return {
      ok: false,
      code:
        workspace.reason === "taxonomy_unavailable"
          ? "taxonomy_unavailable"
          : "persistence",
      message:
        workspace.reason === "taxonomy_unavailable"
          ? "This listing category is not ready for drafts yet."
          : "This listing draft is unavailable. Check your access and try again.",
    };
  }

  if (
    workspace.workspace.mapping.schemaId !== input.data.expectedSchemaId ||
    workspace.workspace.mapping.schemaVersion !==
      input.data.expectedSchemaVersion
  ) {
    return {
      ok: false,
      code: "conflict",
      message: "The listing form changed. Refresh it before saving your draft.",
    };
  }

  const values = validateAdaptiveListingValues(
    workspace.workspace.schema,
    input.data.values,
  );
  if (!values.success) {
    return {
      ok: false,
      code: "validation",
      message: "Check the highlighted listing details and try again.",
      fieldErrors: fieldErrorsFromIssues(values.error.issues),
    };
  }

  const saved = await saveListingDraft(
    client,
    {
      ...input.data,
      values: values.data,
    },
    slugBaseFromAuthoritativeTitle(
      values.data[workspace.workspace.schema.bindings.title],
    ),
  );
  if (!saved.ok) {
    if (saved.reason === "conflict") {
      return {
        ok: false,
        code: "conflict",
        message:
          "This draft changed elsewhere. Refresh it before saving again.",
      };
    }
    if (saved.reason === "taxonomy_unavailable") {
      return {
        ok: false,
        code: "taxonomy_unavailable",
        message: "This listing category is not ready for drafts yet.",
      };
    }
    if (saved.reason === "rate_limited") {
      return {
        ok: false,
        code: "rate_limited",
        message:
          "Draft saving is temporarily limited. Wait a few minutes, then try again.",
      };
    }
    if (saved.reason === "draft_limit") {
      return {
        ok: false,
        code: "draft_limit",
        message:
          "This business has reached its unpublished draft limit. Review existing drafts before creating another.",
      };
    }
    return {
      ok: false,
      code: "persistence",
      message: "Your listing draft could not be saved. Try again in a moment.",
    };
  }

  return saved;
}

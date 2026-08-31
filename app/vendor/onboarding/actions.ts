"use server";

import { getOnboardingCategory } from "@/lib/onboarding/categories";
import { suggestOnboardingCategories } from "@/lib/onboarding/category-intelligence";
import { saveOnboardingDraft } from "@/lib/onboarding/persistence";
import {
  onboardingCompletionSchema,
  saveOnboardingDraftInputSchema,
  type OnboardingDraftValues,
  type SaveOnboardingDraftInput,
} from "@/lib/onboarding/schema";
import { getServerSupabaseClient } from "@/lib/supabase/server";

type DraftField = keyof OnboardingDraftValues;

export type SaveDraftActionResult =
  | { ok: true; savedAt: string }
  | {
      ok: false;
      code: "configuration" | "unauthorized" | "validation" | "persistence";
      message: string;
      fieldErrors?: Partial<Record<DraftField, string>>;
    };

function fieldErrorsFromIssues(
  issues: readonly { path: PropertyKey[]; message: string }[],
): Partial<Record<DraftField, string>> {
  const errors: Partial<Record<DraftField, string>> = {};
  for (const issue of issues) {
    const candidate = issue.path.at(-1);
    if (typeof candidate === "string" && !(candidate in errors)) {
      errors[candidate as DraftField] = issue.message;
    }
  }
  return errors;
}

function canonicalizeCategory(
  values: OnboardingDraftValues,
): OnboardingDraftValues {
  const selectedCategory = getOnboardingCategory(values.categorySlug);
  if (!selectedCategory) {
    return { ...values, categoryConfidence: "unknown" };
  }

  const suggestions = suggestOnboardingCategories(values.originalOffering);
  const selectedSuggestion = suggestions.find(
    (suggestion) => suggestion.category.slug === selectedCategory.slug,
  );

  return {
    ...values,
    categoryConfidence:
      selectedCategory.slug === "other-local-trade"
        ? "unknown"
        : (selectedSuggestion?.confidence ?? "low"),
  };
}

export async function saveVendorOnboardingDraft(
  untrustedInput: SaveOnboardingDraftInput,
): Promise<SaveDraftActionResult> {
  const parsed = saveOnboardingDraftInputSchema.safeParse(untrustedInput);
  if (!parsed.success) {
    return {
      ok: false,
      code: "validation",
      message: "Check the highlighted details and try saving again.",
      fieldErrors: fieldErrorsFromIssues(parsed.error.issues),
    };
  }

  const values = canonicalizeCategory(parsed.data.values);
  if (values.businessName.length < 2) {
    return {
      ok: false,
      code: "validation",
      message: "Add your business name before saving this draft.",
      fieldErrors: { businessName: "Enter your business name." },
    };
  }

  if (parsed.data.step === "complete") {
    const complete = onboardingCompletionSchema.safeParse(values);
    if (!complete.success) {
      return {
        ok: false,
        code: "validation",
        message: "Complete the required details before finishing onboarding.",
        fieldErrors: fieldErrorsFromIssues(complete.error.issues),
      };
    }
  }

  const client = await getServerSupabaseClient();
  if (!client) {
    return {
      ok: false,
      code: "configuration",
      message: "Secure draft saving is not configured in this environment.",
    };
  }

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

  const saved = await saveOnboardingDraft(
    client,
    user.id,
    parsed.data.step,
    values,
  );

  if (!saved.ok) {
    return {
      ok: false,
      code: "persistence",
      message:
        saved.reason === "launch_market_unavailable"
          ? "The launch market is not ready for onboarding yet."
          : "Your draft could not be saved securely. Try again in a moment.",
    };
  }

  return { ok: true, savedAt: new Date().toISOString() };
}

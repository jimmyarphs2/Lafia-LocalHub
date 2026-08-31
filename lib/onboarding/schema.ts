import { z } from "zod";

import {
  getOnboardingCategory,
  isOnboardingCategorySlug,
} from "@/lib/onboarding/categories";
import type { CategoryConfidence } from "@/lib/onboarding/category-intelligence";
import { markets } from "@/lib/market/config";

export const onboardingSteps = [
  "business",
  "category",
  "profile",
  "location",
  "review",
] as const;

export const persistedOnboardingSteps = [
  ...onboardingSteps,
  "complete",
] as const;

export type OnboardingStep = (typeof onboardingSteps)[number];
export type PersistedOnboardingStep = (typeof persistedOnboardingSteps)[number];

const emptyOrEmail = z.union([
  z.literal(""),
  z.string().trim().email("Enter a valid email address.").max(254),
]);

const emptyOrPhone = z
  .string()
  .trim()
  .max(30, "Phone numbers must be 30 characters or fewer.")
  .refine(
    (value) => value === "" || /^\+?[0-9][0-9 ()-]{6,28}$/.test(value),
    "Enter a valid phone number, including the area or country code.",
  );

const marketSlugSchema = z
  .string()
  .trim()
  .refine(
    (value) => markets.some((market) => market.slug === value),
    "Choose an available launch market.",
  );

const categorySlugSchema = z
  .string()
  .trim()
  .refine(
    (value) => value === "" || isOnboardingCategorySlug(value),
    "Choose one of the available business categories.",
  );

export const onboardingDraftValuesSchema = z
  .object({
    businessName: z.string().trim().max(120, "Use 120 characters or fewer."),
    originalOffering: z
      .string()
      .trim()
      .max(240, "Use 240 characters or fewer."),
    categorySlug: categorySlugSchema,
    categoryConfidence: z.enum(["high", "medium", "low", "unknown"]),
    description: z.string().trim().max(1_500, "Use 1,500 characters or fewer."),
    phone: emptyOrPhone,
    whatsapp: emptyOrPhone,
    email: emptyOrEmail,
    marketSlug: marketSlugSchema,
    area: z.string().trim().max(120, "Use 120 characters or fewer."),
    address: z.string().trim().max(240, "Use 240 characters or fewer."),
  })
  .strict();

export const onboardingCompletionSchema =
  onboardingDraftValuesSchema.superRefine((values, context) => {
    if (values.businessName.length < 2) {
      context.addIssue({
        code: "custom",
        message: "Enter your business name.",
        path: ["businessName"],
      });
    }

    if (values.originalOffering.length < 3) {
      context.addIssue({
        code: "custom",
        message: "Describe what you sell or do in your own words.",
        path: ["originalOffering"],
      });
    }

    if (!getOnboardingCategory(values.categorySlug)) {
      context.addIssue({
        code: "custom",
        message:
          "Choose the closest category. You can always choose Other local trade.",
        path: ["categorySlug"],
      });
    }

    if (values.description.length < 20) {
      context.addIssue({
        code: "custom",
        message: "Add at least 20 characters so customers know what to expect.",
        path: ["description"],
      });
    }

    if (!values.phone && !values.whatsapp && !values.email) {
      context.addIssue({
        code: "custom",
        message: "Add at least one way for customers to contact you.",
        path: ["phone"],
      });
    }

    if (values.area.length < 2) {
      context.addIssue({
        code: "custom",
        message: "Enter the area where your business operates.",
        path: ["area"],
      });
    }
  });

export const saveOnboardingDraftInputSchema = z
  .object({
    step: z.enum(persistedOnboardingSteps),
    values: onboardingDraftValuesSchema,
  })
  .strict();

export const persistedOnboardingEnvelopeSchema = z
  .object({
    onboardingVersion: z.literal(1),
    values: onboardingDraftValuesSchema,
  })
  .strict();

export type OnboardingDraftValues = z.infer<typeof onboardingDraftValuesSchema>;
export type SaveOnboardingDraftInput = z.infer<
  typeof saveOnboardingDraftInputSchema
>;
export type PersistedOnboardingEnvelope = z.infer<
  typeof persistedOnboardingEnvelopeSchema
>;

export const emptyOnboardingDraft: OnboardingDraftValues = {
  businessName: "",
  originalOffering: "",
  categorySlug: "",
  categoryConfidence: "unknown" satisfies CategoryConfidence,
  description: "",
  phone: "",
  whatsapp: "",
  email: "",
  marketSlug: markets[0].slug,
  area: "",
  address: "",
};

export function parsePersistedDraftValues(
  value: unknown,
): OnboardingDraftValues {
  const envelope = persistedOnboardingEnvelopeSchema.safeParse(value);
  if (envelope.success) return envelope.data.values;

  const parsed = onboardingDraftValuesSchema.safeParse(value);
  return parsed.success ? parsed.data : emptyOnboardingDraft;
}

export function parsePersistedStep(value: unknown): PersistedOnboardingStep {
  const parsed = z.enum(persistedOnboardingSteps).safeParse(value);
  return parsed.success ? parsed.data : "business";
}

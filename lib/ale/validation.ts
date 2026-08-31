import { z } from "zod";

import type {
  AdaptiveListingSchema,
  AleField,
  AleFormValues,
} from "@/lib/ale/contract";

function optionalize(schema: z.ZodType, required: boolean): z.ZodType {
  return required ? schema : schema.optional();
}

function emptyToUndefined(value: unknown): unknown {
  return (typeof value === "string" && value.trim() === "") || value === null
    ? undefined
    : value;
}

function isCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function fieldValueSchema(field: AleField): z.ZodType {
  switch (field.type) {
    case "short_text":
    case "long_text":
    case "location": {
      let value = z.string().trim();
      if (field.minLength !== undefined) value = value.min(field.minLength);
      if (field.maxLength !== undefined) value = value.max(field.maxLength);
      if (field.required) return value.min(1, `${field.label} is required.`);
      return z.preprocess(emptyToUndefined, value.optional());
    }
    case "number":
    case "money":
    case "duration": {
      let value = z.coerce.number().finite(`${field.label} must be a number.`);
      if (field.min !== undefined) value = value.min(field.min);
      if (field.max !== undefined) value = value.max(field.max);
      if (field.step !== undefined) value = value.multipleOf(field.step);
      if (field.type === "money") {
        value = value
          .multipleOf(0.01)
          .nonnegative()
          .max(90_000_000_000_000_000);
      }
      return z.preprocess(emptyToUndefined, optionalize(value, field.required));
    }
    case "boolean":
      return optionalize(z.boolean(), field.required);
    case "date":
      return z.preprocess(
        emptyToUndefined,
        optionalize(
          z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a valid date.")
            .refine(isCalendarDate, "Choose a valid date."),
          field.required,
        ),
      );
    case "time":
      return z.preprocess(
        emptyToUndefined,
        optionalize(
          z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Choose a valid time."),
          field.required,
        ),
      );
    case "select": {
      const allowedValues = new Set(
        field.options.map((option) => option.value),
      );
      const value = z
        .string()
        .refine(
          (candidate) => allowedValues.has(candidate),
          "Choose an available option.",
        );
      return z.preprocess(emptyToUndefined, optionalize(value, field.required));
    }
    case "multi_select": {
      const allowedValues = new Set(
        field.options.map((option) => option.value),
      );
      let value = z
        .array(z.string())
        .max(field.options.length)
        .refine(
          (candidates) =>
            candidates.every((candidate) => allowedValues.has(candidate)),
          "Choose only available options.",
        )
        .refine(
          (candidates) => new Set(candidates).size === candidates.length,
          "Choose each option only once.",
        );
      if (field.required)
        value = value.min(
          1,
          `Choose at least one ${field.label.toLowerCase()} option.`,
        );
      return field.required ? value : value.optional().default([]);
    }
  }
}

export function buildAdaptiveListingValueSchema(
  schema: AdaptiveListingSchema,
): z.ZodObject<Record<string, z.ZodType>> {
  const shape: Record<string, z.ZodType> = {};
  for (const field of schema.fields) {
    shape[field.key] = fieldValueSchema(field);
  }
  return z.object(shape).strict();
}

export function validateAdaptiveListingValues(
  schema: AdaptiveListingSchema,
  values: AleFormValues,
) {
  return buildAdaptiveListingValueSchema(schema).safeParse(values);
}

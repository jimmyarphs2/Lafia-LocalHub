import { z } from "zod";

import type { ListingKind } from "@/lib/onboarding/categories";

export const ALE_CONTRACT_VERSION = "1.1" as const;

/**
 * The database stores dynamic listing values, while `listings` has a small
 * normalized projection used by the catalogue. These bindings make that
 * projection explicit in every published ALE schema.
 */
const normalizedBindingsSchema = z
  .object({
    title: z.string().regex(/^[a-z][a-zA-Z0-9]{0,62}$/),
    description: z
      .string()
      .regex(/^[a-z][a-zA-Z0-9]{0,62}$/)
      .optional(),
    price: z
      .string()
      .regex(/^[a-z][a-zA-Z0-9]{0,62}$/)
      .optional(),
    fulfilmentMethods: z
      .string()
      .regex(/^[a-z][a-zA-Z0-9]{0,62}$/)
      .optional(),
  })
  .strict();

const optionSchema = z
  .object({
    label: z.string().min(1).max(80),
    value: z.string().min(1).max(80),
  })
  .strict();

const baseFieldSchema = z.object({
  key: z.string().regex(/^[a-z][a-zA-Z0-9]{0,62}$/),
  label: z.string().min(1).max(100),
  helpText: z.string().max(240).optional(),
  required: z.boolean(),
});

const textFieldSchema = baseFieldSchema
  .extend({
    type: z.enum(["short_text", "long_text", "location"]),
    minLength: z.number().int().min(0).optional(),
    maxLength: z.number().int().positive().max(5_000).optional(),
    placeholder: z.string().max(160).optional(),
  })
  .strict();

const numericFieldSchema = baseFieldSchema
  .extend({
    type: z.enum(["number", "money", "duration"]),
    min: z.number().optional(),
    max: z.number().optional(),
    step: z.number().positive().optional(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .optional(),
  })
  .strict();

const choiceFieldSchema = baseFieldSchema
  .extend({
    type: z.enum(["select", "multi_select"]),
    options: z.array(optionSchema).min(1).max(30),
  })
  .strict();

const simpleFieldSchema = baseFieldSchema
  .extend({
    type: z.enum(["boolean", "date", "time"]),
  })
  .strict();

export const aleFieldSchema = z.discriminatedUnion("type", [
  textFieldSchema,
  numericFieldSchema,
  choiceFieldSchema,
  simpleFieldSchema,
]);

export const adaptiveListingSchemaContract = z
  .object({
    contractVersion: z.literal(ALE_CONTRACT_VERSION),
    schemaVersion: z.number().int().positive(),
    schemaKey: z.string().regex(/^[a-z][a-z0-9_]{1,62}$/),
    listingKind: z.enum(["product", "service", "place"]),
    terminology: z
      .object({
        singular: z.string().min(1).max(60),
        plural: z.string().min(1).max(60),
        createAction: z.string().min(1).max(80),
      })
      .strict(),
    fields: z.array(aleFieldSchema).min(1).max(40),
    bindings: normalizedBindingsSchema,
  })
  .strict()
  .superRefine((schema, context) => {
    const keys = new Set<string>();
    for (const [index, field] of schema.fields.entries()) {
      if (keys.has(field.key)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate field key: ${field.key}`,
          path: ["fields", index, "key"],
        });
      }
      keys.add(field.key);
      if (
        (field.type === "short_text" ||
          field.type === "long_text" ||
          field.type === "location") &&
        field.minLength !== undefined &&
        field.maxLength !== undefined &&
        field.minLength > field.maxLength
      ) {
        context.addIssue({
          code: "custom",
          message: `Field ${field.key} has an invalid length range.`,
          path: ["fields", index],
        });
      }
      if (
        (field.type === "number" ||
          field.type === "money" ||
          field.type === "duration") &&
        field.min !== undefined &&
        field.max !== undefined &&
        field.min > field.max
      ) {
        context.addIssue({
          code: "custom",
          message: `Field ${field.key} has an invalid numeric range.`,
          path: ["fields", index],
        });
      }
      if (
        (field.type === "number" || field.type === "duration") &&
        field.currency !== undefined
      ) {
        context.addIssue({
          code: "custom",
          message: `Field ${field.key} may declare currency only when it is money.`,
          path: ["fields", index, "currency"],
        });
      }
      if (
        (field.type === "select" || field.type === "multi_select") &&
        new Set(field.options.map((option) => option.value)).size !==
          field.options.length
      ) {
        context.addIssue({
          code: "custom",
          message: `Field ${field.key} has duplicate option values.`,
          path: ["fields", index, "options"],
        });
      }
    }

    const boundFieldKeys = Object.values(schema.bindings).filter(
      (value): value is string => typeof value === "string",
    );
    if (new Set(boundFieldKeys).size !== boundFieldKeys.length) {
      context.addIssue({
        code: "custom",
        message: "Normalized bindings must reference distinct fields.",
        path: ["bindings"],
      });
    }

    const bindings: Array<
      readonly [keyof typeof schema.bindings, readonly AleField["type"][]]
    > = [
      ["title", ["short_text"]],
      ["description", ["short_text", "long_text"]],
      ["price", ["money"]],
      ["fulfilmentMethods", ["multi_select"]],
    ];

    for (const [bindingName, expectedTypes] of bindings) {
      const fieldKey = schema.bindings[bindingName];
      if (!fieldKey) continue;

      const field = schema.fields.find(
        (candidate) => candidate.key === fieldKey,
      );
      if (!field) {
        context.addIssue({
          code: "custom",
          message: `Binding ${bindingName} references an unknown field: ${fieldKey}`,
          path: ["bindings", bindingName],
        });
        continue;
      }
      if (!expectedTypes.includes(field.type)) {
        context.addIssue({
          code: "custom",
          message: `Binding ${bindingName} references an incompatible field type.`,
          path: ["bindings", bindingName],
        });
      }
    }

    const title = schema.fields.find(
      (field) => field.key === schema.bindings.title,
    );
    if (title && !title.required) {
      context.addIssue({
        code: "custom",
        message: "Binding title must reference a required field.",
        path: ["bindings", "title"],
      });
    }
  });

export type AleField = z.infer<typeof aleFieldSchema>;
export type AdaptiveListingSchema = z.infer<
  typeof adaptiveListingSchemaContract
>;
export type AleFormValues = Record<string, unknown>;

export type AleRegistry = Record<ListingKind, AdaptiveListingSchema>;

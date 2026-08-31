import { describe, expect, it } from "vitest";

import {
  adaptiveListingSchemaContract,
  ALE_CONTRACT_VERSION,
} from "@/lib/ale/contract";
import {
  aleSchemaRegistry,
  getAdaptiveListingSchema,
} from "@/lib/ale/registry";
import { validateAdaptiveListingValues } from "@/lib/ale/validation";
import { matchOnboardingCategory } from "@/lib/onboarding/category-intelligence";

describe("Adaptive Listing Engine foundation", () => {
  it("ships a validated, versioned schema for every listing kind", () => {
    for (const schema of Object.values(aleSchemaRegistry)) {
      expect(adaptiveListingSchemaContract.parse(schema)).toEqual(schema);
      expect(schema.contractVersion).toBe(ALE_CONTRACT_VERSION);
      expect(schema.schemaVersion).toBeGreaterThan(0);
      expect(new Set(schema.fields.map((field) => field.key)).size).toBe(
        schema.fields.length,
      );
    }
  });

  it("selects schemas through listing kind rather than category UI branches", () => {
    const cake = matchOnboardingCategory("I bake cakes");
    const photographer = matchOnboardingCategory("event photographer");

    expect(getAdaptiveListingSchema(cake.category.listingKind).schemaKey).toBe(
      "local_product_v1",
    );
    expect(
      getAdaptiveListingSchema(photographer.category.listingKind).schemaKey,
    ).toBe("local_service_v1");
  });

  it("coerces valid product numbers while enforcing configured choices", () => {
    const schema = getAdaptiveListingSchema("product");
    const result = validateAdaptiveListingValues(schema, {
      title: "Celebration cake",
      description: "A made-to-order cake for birthdays and celebrations.",
      price: "15000",
      availableQuantity: "2",
      fulfilment: ["pickup", "made_to_order"],
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.price).toBe(15000);
      expect(result.data.availableQuantity).toBe(2);
    }
  });

  it("does not coerce whitespace-only numeric input to zero", () => {
    const schema = getAdaptiveListingSchema("product");
    const result = validateAdaptiveListingValues(schema, {
      title: "Celebration cake",
      description: "A made-to-order cake for birthdays and celebrations.",
      price: "   ",
      fulfilment: ["pickup"],
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.price).toBeUndefined();
  });

  it("rejects missing required fields and values outside the schema", () => {
    const schema = getAdaptiveListingSchema("service");
    const invalid = validateAdaptiveListingValues(schema, {
      title: "Phone repair",
      description: "Too short",
      pricingModel: "secret-price-mode",
      serviceArea: "",
      injectedSystemField: "not allowed",
    });

    expect(invalid.success).toBe(false);
  });

  it("requires each normalized binding to reference the matching ALE field", () => {
    const product = getAdaptiveListingSchema("product");

    expect(
      adaptiveListingSchemaContract.safeParse({
        ...product,
        bindings: { ...product.bindings, title: "description" },
      }).success,
    ).toBe(false);
    expect(
      adaptiveListingSchemaContract.safeParse({
        ...product,
        bindings: { ...product.bindings, price: "unknownPrice" },
      }).success,
    ).toBe(false);
  });

  it("keeps the application contract aligned with exact database validation", () => {
    const product = getAdaptiveListingSchema("product");

    expect(
      adaptiveListingSchemaContract.safeParse({
        ...product,
        fields: product.fields.map((field, index) =>
          index === 0 ? { ...field, unknownRule: true } : field,
        ),
      }).success,
    ).toBe(false);
    expect(
      adaptiveListingSchemaContract.safeParse({
        ...product,
        fields: product.fields.map((field) =>
          field.type === "number" ? { ...field, currency: "NGN" } : field,
        ),
      }).success,
    ).toBe(false);
  });

  it("rejects impossible calendar dates and duplicate multi-select values", () => {
    const schema = adaptiveListingSchemaContract.parse({
      contractVersion: ALE_CONTRACT_VERSION,
      schemaVersion: 1,
      schemaKey: "event_product_v1",
      listingKind: "product",
      terminology: {
        singular: "event",
        plural: "events",
        createAction: "Add event",
      },
      bindings: { title: "title" },
      fields: [
        {
          key: "title",
          type: "short_text",
          label: "Title",
          required: true,
        },
        {
          key: "eventDate",
          type: "date",
          label: "Event date",
          required: true,
        },
        {
          key: "formats",
          type: "multi_select",
          label: "Formats",
          required: true,
          options: [{ label: "Pickup", value: "pickup" }],
        },
      ],
    });

    expect(
      validateAdaptiveListingValues(schema, {
        title: "Community event",
        eventDate: "2026-99-99",
        formats: ["pickup"],
      }).success,
    ).toBe(false);
    expect(
      validateAdaptiveListingValues(schema, {
        title: "Community event",
        eventDate: "2026-08-29",
        formats: ["pickup", "pickup"],
      }).success,
    ).toBe(false);
  });
});

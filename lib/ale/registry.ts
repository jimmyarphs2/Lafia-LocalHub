import {
  adaptiveListingSchemaContract,
  ALE_CONTRACT_VERSION,
  type AdaptiveListingSchema,
  type AleRegistry,
} from "@/lib/ale/contract";
import type { ListingKind } from "@/lib/onboarding/categories";

const schemas = {
  product: {
    contractVersion: ALE_CONTRACT_VERSION,
    schemaVersion: 1,
    schemaKey: "local_product_v1",
    listingKind: "product",
    terminology: {
      singular: "product",
      plural: "products",
      createAction: "Add your first product",
    },
    bindings: {
      title: "title",
      description: "description",
      price: "price",
      fulfilmentMethods: "fulfilment",
    },
    fields: [
      {
        key: "title",
        type: "short_text",
        label: "Product name",
        placeholder: "e.g. Celebration cake",
        required: true,
        minLength: 2,
        maxLength: 120,
      },
      {
        key: "description",
        type: "long_text",
        label: "What should customers know?",
        required: true,
        minLength: 20,
        maxLength: 1_500,
      },
      {
        key: "price",
        type: "money",
        label: "Starting price",
        helpText:
          "Use the lowest normal price. You can explain variations in the description.",
        required: false,
        min: 0,
        step: 100,
        currency: "NGN",
      },
      {
        key: "availableQuantity",
        type: "number",
        label: "Quantity currently available",
        required: false,
        min: 0,
        step: 1,
      },
      {
        key: "fulfilment",
        type: "multi_select",
        label: "How can customers receive it?",
        required: true,
        options: [
          { value: "pickup", label: "Pickup" },
          { value: "delivery", label: "Local delivery" },
          { value: "made_to_order", label: "Made to order" },
        ],
      },
    ],
  },
  service: {
    contractVersion: ALE_CONTRACT_VERSION,
    schemaVersion: 1,
    schemaKey: "local_service_v1",
    listingKind: "service",
    terminology: {
      singular: "service",
      plural: "services",
      createAction: "Describe your first service",
    },
    bindings: {
      title: "title",
      description: "description",
      price: "startingPrice",
    },
    fields: [
      {
        key: "title",
        type: "short_text",
        label: "Service name",
        placeholder: "e.g. Phone screen repair",
        required: true,
        minLength: 2,
        maxLength: 120,
      },
      {
        key: "description",
        type: "long_text",
        label: "What is included?",
        required: true,
        minLength: 20,
        maxLength: 1_500,
      },
      {
        key: "pricingModel",
        type: "select",
        label: "How do you price this service?",
        required: true,
        options: [
          { value: "fixed", label: "Fixed price" },
          { value: "from", label: "Starting from" },
          { value: "quote", label: "Quote after assessment" },
          { value: "hourly", label: "Per hour" },
        ],
      },
      {
        key: "startingPrice",
        type: "money",
        label: "Starting price",
        required: false,
        min: 0,
        step: 100,
        currency: "NGN",
      },
      {
        key: "durationMinutes",
        type: "duration",
        label: "Typical duration in minutes",
        required: false,
        min: 5,
        max: 10_080,
        step: 5,
      },
      {
        key: "serviceArea",
        type: "location",
        label: "Where do you provide this service?",
        placeholder: "e.g. Lafia and nearby areas",
        required: true,
        minLength: 2,
        maxLength: 160,
      },
    ],
  },
  place: {
    contractVersion: ALE_CONTRACT_VERSION,
    schemaVersion: 1,
    schemaKey: "local_place_v1",
    listingKind: "place",
    terminology: {
      singular: "place",
      plural: "places",
      createAction: "Add your place",
    },
    bindings: {
      title: "title",
      description: "description",
    },
    fields: [
      {
        key: "title",
        type: "short_text",
        label: "Place name",
        required: true,
        minLength: 2,
        maxLength: 120,
      },
      {
        key: "description",
        type: "long_text",
        label: "Describe the place",
        required: true,
        minLength: 20,
        maxLength: 1_500,
      },
      {
        key: "address",
        type: "location",
        label: "Address",
        required: true,
        minLength: 5,
        maxLength: 240,
      },
      {
        key: "capacity",
        type: "number",
        label: "Maximum guest capacity",
        required: false,
        min: 1,
        step: 1,
      },
      {
        key: "amenities",
        type: "multi_select",
        label: "Available amenities",
        required: false,
        options: [
          { value: "parking", label: "Parking" },
          { value: "power", label: "Backup power" },
          { value: "accessible", label: "Step-free access" },
          { value: "restrooms", label: "Restrooms" },
        ],
      },
    ],
  },
} satisfies AleRegistry;

export const aleSchemaRegistry: AleRegistry = {
  product: adaptiveListingSchemaContract.parse(schemas.product),
  service: adaptiveListingSchemaContract.parse(schemas.service),
  place: adaptiveListingSchemaContract.parse(schemas.place),
};

export function getAdaptiveListingSchema(
  listingKind: ListingKind,
): AdaptiveListingSchema {
  return aleSchemaRegistry[listingKind];
}

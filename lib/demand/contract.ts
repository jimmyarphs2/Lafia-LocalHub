import { z } from "zod";

import type { CatalogState, Category, Listing } from "@/lib/catalog/data";
import type { SearchIntent } from "@/lib/catalog/search";
import { marketSlugSchema } from "@/lib/requests/contract";

export const demandCategoryIdSchema = z.string().uuid();

export type UnmetDemandCaptureCandidate = {
  marketSlug: string;
  categoryId: string;
};

type DemandCaptureInput = {
  source: "fictional-demo" | "supabase";
  state: CatalogState;
  complete: boolean;
  market?: { id: string; slug: string };
  categories: readonly Pick<Category, "id" | "marketId" | "slug">[];
  listings: readonly Pick<Listing, "categoryId">[];
  intent: Pick<SearchIntent, "normalized" | "categoryIds" | "categorySlugs">;
  resultCount: number;
};

/**
 * Derives the only data allowed to cross the operational-demand boundary.
 * Search text and secondary intent facts are intentionally absent.
 */
export function deriveUnmetDemandCaptureCandidate(
  input: DemandCaptureInput,
): UnmetDemandCaptureCandidate | null {
  const marketSlug = marketSlugSchema.safeParse(input.market?.slug);
  const marketId = demandCategoryIdSchema.safeParse(input.market?.id);
  if (
    input.source !== "supabase" ||
    input.state !== "ready" ||
    !input.complete ||
    !input.market ||
    !marketSlug.success ||
    !marketId.success ||
    !input.intent.normalized ||
    input.resultCount !== 0 ||
    input.intent.categoryIds.length !== 1 ||
    input.intent.categorySlugs.length !== 1
  ) {
    return null;
  }

  const categoryId = input.intent.categoryIds[0];
  const category = input.categories.find(
    (candidate) =>
      candidate.id === categoryId &&
      candidate.slug === input.intent.categorySlugs[0] &&
      (candidate.marketId === null || candidate.marketId === marketId.data),
  );
  const parsedCategoryId = demandCategoryIdSchema.safeParse(category?.id);
  if (
    !category ||
    !parsedCategoryId.success ||
    input.listings.some((listing) => listing.categoryId === category.id)
  ) {
    return null;
  }

  return { marketSlug: marketSlug.data, categoryId: parsedCategoryId.data };
}

export function demandConfirmationPath(
  marketSlug: string,
  categoryId: string,
): string {
  const market = marketSlugSchema.parse(marketSlug);
  const category = demandCategoryIdSchema.parse(categoryId);
  return `/${market}/demand/confirm?category=${category}`;
}

export function parseDemandConfirmationPath(
  value: string | null | undefined,
): UnmetDemandCaptureCandidate | null {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return null;
  try {
    const destination = new URL(value, "https://localhub.invalid");
    if (
      destination.origin !== "https://localhub.invalid" ||
      destination.hash ||
      destination.searchParams.size !== 1
    ) {
      return null;
    }
    const segments = destination.pathname.split("/").filter(Boolean);
    const market = marketSlugSchema.safeParse(segments[0]);
    const categories = destination.searchParams.getAll("category");
    const category = demandCategoryIdSchema.safeParse(categories[0]);
    if (
      segments.length !== 3 ||
      segments[1] !== "demand" ||
      segments[2] !== "confirm" ||
      !market.success ||
      categories.length !== 1 ||
      !category.success
    ) {
      return null;
    }
    const parsed = { marketSlug: market.data, categoryId: category.data };
    return demandConfirmationPath(parsed.marketSlug, parsed.categoryId) ===
      value
      ? parsed
      : null;
  } catch {
    return null;
  }
}

export function parseUnmetDemandRecordResult(
  value: unknown,
  error: unknown,
): { accepted: true } | null {
  return !error && value === true ? { accepted: true } : null;
}

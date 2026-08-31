import {
  fallbackOnboardingCategory,
  onboardingCategories,
  type OnboardingCategory,
} from "@/lib/onboarding/categories";

export type CategoryConfidence = "high" | "medium" | "low" | "unknown";

export type CategorySuggestion = {
  category: OnboardingCategory;
  confidence: CategoryConfidence;
  matchedTerms: readonly string[];
  normalizedWording: string;
  originalWording: string;
  score: number;
};

const COMBINING_MARKS = /[\u0300-\u036f]/g;
const NON_WORD_CHARACTERS = /[^a-z0-9]+/g;

export function normalizeOfferingWording(value: string): string {
  return value
    .normalize("NFKD")
    .replace(COMBINING_MARKS, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(NON_WORD_CHARACTERS, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function confidenceForScore(score: number): CategoryConfidence {
  if (score >= 0.78) return "high";
  if (score >= 0.55) return "medium";
  if (score >= 0.34) return "low";
  return "unknown";
}

function scoreCategory(
  normalizedWording: string,
  category: OnboardingCategory,
): { matchedTerms: string[]; score: number } {
  if (!normalizedWording || category.aliases.length === 0) {
    return { matchedTerms: [], score: 0 };
  }

  const inputTokens = new Set(normalizedWording.split(" "));
  const matchedTerms: string[] = [];
  let bestScore = 0;

  for (const alias of category.aliases) {
    const normalizedAlias = normalizeOfferingWording(alias);
    const aliasTokens = normalizedAlias.split(" ");
    const exact = normalizedWording === normalizedAlias;
    const phraseMatch =
      normalizedWording === normalizedAlias ||
      normalizedWording.startsWith(`${normalizedAlias} `) ||
      normalizedWording.endsWith(` ${normalizedAlias}`) ||
      normalizedWording.includes(` ${normalizedAlias} `);
    const tokenMatches = aliasTokens.filter((token) => inputTokens.has(token));

    if (phraseMatch || tokenMatches.length === aliasTokens.length) {
      matchedTerms.push(alias);
    }

    if (exact) {
      bestScore = 1;
      continue;
    }

    if (phraseMatch) {
      bestScore = Math.max(
        bestScore,
        0.6 + Math.min(aliasTokens.length * 0.08, 0.2),
      );
      continue;
    }

    if (tokenMatches.length > 0) {
      const aliasCoverage = tokenMatches.length / aliasTokens.length;
      const inputCoverage = tokenMatches.length / Math.max(inputTokens.size, 1);
      bestScore = Math.max(
        bestScore,
        aliasCoverage * 0.38 + inputCoverage * 0.18,
      );
    }
  }

  const distinctMatches = [...new Set(matchedTerms)];
  const corroborationBonus = Math.min(
    Math.max(distinctMatches.length - 1, 0) * 0.1,
    0.2,
  );

  return {
    matchedTerms: distinctMatches,
    score: Math.min(bestScore + corroborationBonus, 1),
  };
}

export function suggestOnboardingCategories(
  originalWording: string,
  limit = 3,
): readonly CategorySuggestion[] {
  const preservedWording = originalWording.trim();
  const normalizedWording = normalizeOfferingWording(preservedWording);

  const ranked = onboardingCategories
    .filter((category) => category.slug !== fallbackOnboardingCategory.slug)
    .map((category) => {
      const result = scoreCategory(normalizedWording, category);
      return {
        category,
        confidence: confidenceForScore(result.score),
        matchedTerms: result.matchedTerms,
        normalizedWording,
        originalWording: preservedWording,
        score: Number(result.score.toFixed(3)),
      } satisfies CategorySuggestion;
    })
    .filter((suggestion) => suggestion.score >= 0.24)
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.category.name.localeCompare(right.category.name),
    )
    .slice(0, Math.max(1, limit));

  if (ranked.length > 0 && ranked[0].confidence !== "unknown") {
    return ranked;
  }

  return [
    {
      category: fallbackOnboardingCategory,
      confidence: "unknown",
      matchedTerms: [],
      normalizedWording,
      originalWording: preservedWording,
      score: 0,
    },
  ];
}

export function matchOnboardingCategory(
  originalWording: string,
): CategorySuggestion {
  return suggestOnboardingCategories(originalWording, 1)[0];
}

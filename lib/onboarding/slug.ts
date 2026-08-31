const NON_SLUG_CHARACTERS = /[^a-z0-9]+/g;

export function createOnboardingBusinessSlug(
  businessName: string,
  ownerId: string,
): string {
  const namePart = businessName
    .normalize("NFKD")
    .toLowerCase()
    .replace(NON_SLUG_CHARACTERS, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
  const ownerPart = ownerId
    .toLowerCase()
    .replace(/[^a-f0-9]/g, "")
    .slice(0, 10);
  return `${namePart || "local-business"}-${ownerPart || "owner"}`;
}

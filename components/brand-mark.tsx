import { Network } from "lucide-react";
import Link from "next/link";

import { DraftNavigationLink } from "@/components/vendor/draft-navigation-link";

export function BrandMark({
  guardDraftNavigation = false,
}: {
  guardDraftNavigation?: boolean;
}) {
  const BrandLink = guardDraftNavigation ? DraftNavigationLink : Link;

  return (
    <BrandLink className="brand" href="/">
      <Network
        className="brand-icon"
        aria-hidden="true"
        size={36}
        strokeWidth={1.8}
      />
      <span>
        LocalHub<small>Making local life searchable.</small>
      </span>
    </BrandLink>
  );
}

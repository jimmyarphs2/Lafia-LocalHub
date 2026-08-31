"use client";

import Link from "next/link";
import type { ComponentProps, MouseEvent } from "react";

export const DRAFT_NAVIGATION_REQUEST = "localhub:draft-navigation-request";

/**
 * Lets the active draft workspace veto client-side navigation while a save is
 * pending or the form still contains unsaved changes.
 */
export function DraftNavigationLink({
  onClick,
  ...props
}: ComponentProps<typeof Link>) {
  function requestNavigation(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event);
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }

    const request = new Event(DRAFT_NAVIGATION_REQUEST, {
      cancelable: true,
    });
    if (!window.dispatchEvent(request)) event.preventDefault();
  }

  return <Link {...props} onClick={requestNavigation} />;
}

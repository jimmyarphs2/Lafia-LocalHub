"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useSyncExternalStore, useTransition } from "react";
import {
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  LocateFixed,
  MapPin,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import { AccountMenu } from "@/components/account-menu";
import type { AuthIdentity } from "@/lib/auth/identity";
import { haversineDistanceKm } from "@/lib/location/haversine";
import type { EntryMarket } from "@/lib/market/entry-markets";
import {
  cleanEntryText,
  parseEntryPreferences,
  readEntryPreferences,
  saveEntryPreferences,
  subscribeEntryPreferences,
} from "@/lib/market/entry-preferences";
import styles from "./localhub-entry.module.css";

const examples = [
  "Birthday cake under ₦20,000 near me",
  "Who can fix my phone today?",
  "Office chair within ₦45,000, delivered this week",
];
const emptySnapshot = () => "";
type Sheet = "area" | "request" | "help" | "terms" | "privacy";

export function LocalHubEntry({
  identity,
  markets,
  directoryState,
  demoMode,
}: {
  identity: AuthIdentity | null;
  markets: EntryMarket[];
  directoryState: "ready" | "unavailable" | "not-configured";
  demoMode: boolean;
}) {
  const router = useRouter();
  const stored = useSyncExternalStore(
    subscribeEntryPreferences,
    readEntryPreferences,
    emptySnapshot,
  );
  const preferences = parseEntryPreferences(stored);
  const [chosenArea, setChosenArea] = useState<{
    slug: string;
    name: string;
  } | null>(null);
  const area = chosenArea ??
    preferences.area ??
    markets.find((market) => market.slug === "lafia") ??
    markets[0] ?? { slug: "", name: "Choose area" };
  const activeMarket = markets.find(
    (market) => market.slug === area.slug && market.slug,
  );
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [sheet, setSheet] = useState<Sheet>("area");
  const [areaFilter, setAreaFilter] = useState("");
  const [locationMessage, setLocationMessage] = useState("");
  const [locating, setLocating] = useState(false);
  const [pending, startTransition] = useTransition();
  const input = useRef<HTMLTextAreaElement>(null);
  const composer = useRef<HTMLFormElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const recent = preferences.recent
    .filter((item) => item.market === area.slug && area.slug)
    .map((item) => item.query);
  const suggestions = [...new Set([...recent, ...examples])].slice(0, 3);
  const visibleMarkets = markets.filter((market) =>
    `${market.name} ${market.region}`
      .toLowerCase()
      .includes(areaFilter.trim().toLowerCase()),
  );

  function openSheet(next: Sheet) {
    opener.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setSheet(next);
    setFocused(false);
    dialog.current?.showModal();
  }
  function closeSheet() {
    dialog.current?.close();
    opener.current?.focus();
  }
  function chooseArea(next: { slug: string; name: string }) {
    setChosenArea(next);
    saveEntryPreferences({
      ...preferences,
      area: { slug: next.slug, name: next.name },
    });
    setFeedback("");
    setLocationMessage("");
    closeSheet();
  }
  function useLocation() {
    if (!navigator.geolocation) {
      setLocationMessage(
        "This browser cannot share location. Please choose your area below.",
      );
      return;
    }
    setLocating(true);
    setLocationMessage("Checking nearby published areas…");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false);
        const point = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        };
        const nearest = markets
          .filter((market) => market.coordinates)
          .map((market) => ({
            market,
            distance: haversineDistanceKm(point, market.coordinates!),
          }))
          .sort((left, right) => left.distance - right.distance)[0];
        if (
          !nearest ||
          nearest.distance > 25 ||
          position.coords.accuracy > 10_000
        ) {
          setLocationMessage(
            "We couldn’t confidently match your location to a published area. Please choose or enter your city below.",
          );
          return;
        }
        setAreaFilter(nearest.market.name);
        setLocationMessage(
          `You appear to be near ${nearest.market.name}. Select it below to confirm. Location is approximate.`,
        );
      },
      () => {
        setLocating(false);
        setLocationMessage(
          "Location wasn’t available. You can still choose your area manually.",
        );
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 },
    );
  }
  function search() {
    const text = cleanEntryText(query);
    if (!text) {
      input.current?.focus();
      return;
    }
    if (!activeMarket) {
      setFeedback(
        directoryState === "ready"
          ? `We can’t offer a published directory for ${area.name === "Choose area" ? "this area" : area.name} yet. Choose another area or help a business start selling below.`
          : "We can’t confirm area availability right now. Please try again later. Your search has not been posted or sent to a business.",
      );
      setFocused(false);
      return;
    }
    saveEntryPreferences({
      area: { slug: activeMarket.slug, name: activeMarket.name },
      recent: [
        { market: activeMarket.slug, query: text },
        ...preferences.recent.filter(
          (item) => item.market !== activeMarket.slug || item.query !== text,
        ),
      ].slice(0, 6),
    });
    startTransition(() =>
      router.push(`/${activeMarket.slug}/search?q=${encodeURIComponent(text)}`),
    );
  }
  return (
    <div
      className={styles.entry}
      onPointerDownCapture={(event) => {
        if (!composer.current?.contains(event.target as Node))
          setFocused(false);
      }}
    >
      <a className="skip-link" href="#entry-search">
        Skip to search
      </a>
      <header className={styles.header}>
        <Link className={styles.wordmark} href="/" aria-label="LocalHub home">
          Local<span>Hub</span>
        </Link>
        <div className={styles.headerActions}>
          <div className={styles.location}>
            <button
              className={styles.areaButton}
              type="button"
              onClick={() => openSheet("area")}
              aria-label={`Change area, ${area.name}`}
            >
              <MapPin size={20} aria-hidden="true" />
              <span>{area.name}</span>
              <ChevronDown size={16} aria-hidden="true" />
            </button>
            <small>
              {area.slug
                ? "Using your selected area"
                : "Choose where to discover"}
            </small>
          </div>
          <div className={styles.account}>
            <AccountMenu
              identity={identity}
              marketSlug={activeMarket?.slug ?? "lafia"}
            />
          </div>
        </div>
      </header>
      <main className={styles.main}>
        <section className={styles.hero} aria-labelledby="entry-title">
          <p className={styles.badge}>
            Your local marketplace <span aria-hidden="true">•</span>{" "}
            {demoMode ? "Fictional demo" : "Early access"}
          </p>
          <h1 id="entry-title">
            Find what you need
            <br />
            <span>near you.</span>
          </h1>
          <p className={styles.description}>
            Ask naturally. Compare nearby options.
            <br />
            Search within your budget.
          </p>
        </section>
        <form
          ref={composer}
          className={styles.composer}
          data-focused={focused}
          action={`/${activeMarket?.slug ?? "lafia"}/search`}
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            search();
          }}
          onFocus={() => setFocused(true)}
          onBlur={(event) => {
            if (
              !event.currentTarget.contains(event.relatedTarget as Node | null)
            )
              setFocused(false);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setFocused(false);
              input.current?.blur();
            }
          }}
        >
          <div className={styles.inputBox}>
            <Sparkles className={styles.sparkle} size={28} aria-hidden="true" />
            <label className="sr-only" htmlFor="entry-search">
              What do you want to find nearby?
            </label>
            <textarea
              id="entry-search"
              ref={input}
              name="q"
              rows={1}
              maxLength={160}
              required
              autoComplete="off"
              enterKeyHint="search"
              placeholder="What do you want to find nearby?"
              value={query}
              aria-describedby="entry-search-help"
              onChange={(event) => {
                setQuery(event.target.value);
                setFeedback("");
              }}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing
                ) {
                  event.preventDefault();
                  search();
                }
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  composer.current
                    ?.querySelector<HTMLButtonElement>("[data-suggestion]")
                    ?.focus();
                }
              }}
            />
            {focused || query ? (
              <button
                className={styles.clear}
                type="button"
                aria-label={query ? "Clear search" : "Close suggestions"}
                onClick={() => {
                  if (query) {
                    setQuery("");
                    input.current?.focus();
                  } else {
                    setFocused(false);
                    input.current?.blur();
                  }
                }}
              >
                <X size={21} aria-hidden="true" />
              </button>
            ) : null}
          </div>
          {focused ? (
            <div className={styles.suggestions}>
              <div className={styles.suggestionHeading}>
                <p>
                  {recent.length ? "Suggested for you" : "Try asking LocalHub"}
                </p>
                {recent.length ? (
                  <button
                    type="button"
                    onClick={() =>
                      saveEntryPreferences({ ...preferences, recent: [] })
                    }
                  >
                    Clear history
                  </button>
                ) : null}
              </div>
              <ul aria-label="Search suggestions">
                {suggestions.map((suggestion) => (
                  <li key={suggestion}>
                    <button
                      type="button"
                      data-suggestion
                      onClick={() => {
                        setQuery(suggestion);
                        input.current?.focus();
                      }}
                    >
                      <Search size={22} aria-hidden="true" />
                      <span>{suggestion}</span>
                      <ChevronRight size={20} aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
              <p className={styles.suggestionNote}>
                {recent.length
                  ? "Based on searches in this tab and selected area."
                  : "A few ideas to get you started. Make them yours."}
              </p>
            </div>
          ) : (
            <p className={styles.idleHint}>
              Tell us what you need, your budget, and where.
            </p>
          )}
          <div className={styles.submitRow}>
            <button type="submit" className={styles.primary} disabled={pending}>
              {pending ? "Finding options…" : "Ask LocalHub"}
              <ArrowUp size={22} aria-hidden="true" />
            </button>
          </div>
          <p className="sr-only" id="entry-search-help">
            Include a budget in naira. Suggestions appear when you focus this
            search. Budget, location and timing help rank published listings;
            confirm price and availability with the business.
          </p>
        </form>
        {feedback ? (
          <div className={styles.feedback} role="status">
            <p>{feedback}</p>
            <button type="button" onClick={() => openSheet("area")}>
              Change area <ChevronRight size={17} aria-hidden="true" />
            </button>
          </div>
        ) : null}
        <p className={styles.trust}>
          <span>Browse without login</span>
          <i aria-hidden="true">•</i>
          <span>Local results</span>
          <i aria-hidden="true">•</i>
          <span>Budget-aware</span>
        </p>
        <section className={styles.fallback} aria-labelledby="entry-fallback">
          <h2 id="entry-fallback">Not seeing it?</h2>
          <p>Post a request or help a local business start selling.</p>
          <div className={styles.fallbackActions}>
            <button
              type="button"
              className={styles.primary}
              onClick={() => openSheet("request")}
            >
              Post a request
            </button>
            <Link className={styles.secondary} href="/vendor/onboarding">
              Start selling
            </Link>
          </div>
        </section>
      </main>
      <footer className={styles.footer}>
        <nav aria-label="Footer navigation">
          <Link href="/vendor/onboarding">Sell on LocalHub</Link>
          <button type="button" onClick={() => openSheet("help")}>
            Help
          </button>
          <button type="button" onClick={() => openSheet("terms")}>
            Terms
          </button>
          <button type="button" onClick={() => openSheet("privacy")}>
            Privacy
          </button>
        </nav>
        <p>
          Building a stronger{" "}
          {area.name === "Choose area" ? "community" : area.name}, together.
        </p>
      </footer>
      <dialog
        className={styles.dialog}
        ref={dialog}
        aria-labelledby="entry-sheet-title"
        onClick={(event) => {
          if (event.target === event.currentTarget) closeSheet();
        }}
      >
        <div className={styles.sheet}>
          <button
            className={styles.dismiss}
            type="button"
            onClick={closeSheet}
            aria-label="Close dialog"
          >
            <X size={22} />
          </button>
          <h2 id="entry-sheet-title">
            {
              {
                area: "Where are you discovering?",
                request: "Let’s find the right business",
                help: "A little help, a lot nearby",
                terms: "Early-access terms",
                privacy: "Your search, your control",
              }[sheet]
            }
          </h2>
          {sheet === "area" ? (
            <>
              <p>
                Discover in your city or explore somewhere else. Available
                directories grow as local businesses join.
              </p>
              <button
                type="button"
                className={styles.locationAction}
                disabled={locating || demoMode}
                onClick={useLocation}
              >
                <LocateFixed size={20} />
                {locating ? "Checking your location…" : "Use my location"}
              </button>
              <small>
                {demoMode
                  ? "Device location is off in this fictional Lafia demo."
                  : "With your permission. Coordinates stay in this tab and are not saved. You can always choose manually."}
              </small>
              {locationMessage ? (
                <p className={styles.sheetNotice} role="status">
                  {locationMessage}
                </p>
              ) : null}
              <label htmlFor="entry-city">City or area</label>
              <input
                id="entry-city"
                placeholder="Search or enter your city"
                value={areaFilter}
                maxLength={60}
                onChange={(event) => setAreaFilter(event.target.value)}
              />
              <ul className={styles.marketList}>
                {visibleMarkets.map((market) => (
                  <li key={market.slug}>
                    <button type="button" onClick={() => chooseArea(market)}>
                      <MapPin size={19} />
                      <span>
                        {market.name}
                        <small>{market.region || market.country}</small>
                      </span>
                      {area.slug === market.slug ? (
                        <Check size={18} />
                      ) : (
                        <ChevronRight size={18} />
                      )}
                    </button>
                  </li>
                ))}
              </ul>
              {directoryState !== "ready" ? (
                <p role="status">
                  Published areas are temporarily unavailable. You can still
                  enter your city; search coverage is not confirmed.
                </p>
              ) : null}
              {cleanEntryText(areaFilter, 60) &&
              !visibleMarkets.some(
                (market) =>
                  market.name.toLowerCase() === areaFilter.trim().toLowerCase(),
              ) ? (
                <button
                  type="button"
                  className={styles.secondary}
                  onClick={() =>
                    chooseArea({
                      slug: "",
                      name: cleanEntryText(areaFilter, 60),
                    })
                  }
                >
                  Use “{cleanEntryText(areaFilter, 60)}”
                </button>
              ) : null}
            </>
          ) : sheet === "request" ? (
            <>
              <p>
                Requests currently go to a business you choose. Search for what
                you need, open a listing, then send your request.
              </p>
              <p className={styles.sheetNotice}>
                Public request posting isn’t available yet. Nothing is posted or
                sent by opening this screen.
              </p>
              <button
                type="button"
                className={styles.primary}
                onClick={() => {
                  closeSheet();
                  input.current?.focus();
                }}
              >
                Find a business <Search size={18} />
              </button>
              {activeMarket ? (
                <Link
                  className={styles.sheetLink}
                  href={`/${activeMarket.slug}/refer/merchant`}
                >
                  Invite a business to LocalHub <ChevronRight size={16} />
                </Link>
              ) : null}
            </>
          ) : sheet === "help" ? (
            <>
              <p>
                Ask for a product or service, add your budget in naira, and
                choose your area. You can browse without an account.
              </p>
              <p>
                Matching uses published listing details and search rules—not a
                live AI conversation. Budget and timing help rank options, but
                aren’t guarantees. Confirm details with the business.
              </p>
              <p>
                No match? Try different wording, change your area, or help a
                business start selling.
              </p>
            </>
          ) : sheet === "terms" ? (
            <p>
              Full marketplace terms have not been published yet. LocalHub is in
              early access; browsing does not confirm an order, payment, price
              or availability. This notice is not a replacement for the
              forthcoming marketplace terms.
            </p>
          ) : (
            <>
              <p>
                This entry keeps your chosen area and up to six recent searches
                in this browser tab only. Clear your search history below or
                close the tab to remove it.
              </p>
              <p>
                Device location is optional. Coordinates are used only to
                suggest a nearby published area; they aren’t saved or sent to a
                geocoding service. Submitted searches go to LocalHub to retrieve
                results, not to businesses.
              </p>
              <p>
                This describes the entry screen only; a full platform privacy
                policy still needs to be published.
              </p>
              <button
                type="button"
                className={styles.secondary}
                onClick={() => {
                  saveEntryPreferences({ ...preferences, recent: [] });
                  setFeedback("Search history cleared for this tab.");
                  closeSheet();
                }}
              >
                Clear search history
              </button>
            </>
          )}
        </div>
      </dialog>
    </div>
  );
}

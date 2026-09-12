import {
  ArrowLeft,
  ArrowRight,
  Building2,
  MapPin,
  Search,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { BrandMark } from "@/components/brand-mark";
import { getCurrentIdentity } from "@/lib/auth/identity";
import {
  AUTH_RETURN_COOKIE,
  parseAuthReturnCookie,
  safeAuthError,
  safeAuthReturnPath,
} from "@/lib/auth/redirects";
import { isAuthRuntimeReady } from "@/lib/auth/runtime";
import { getPublicSupabaseConfig } from "@/lib/config/env";
import { requestIntentIdSchema } from "@/lib/requests/contract";
import { isListingOrderConfirmationPath } from "@/lib/orders/navigation";
import { parseDemandConfirmationPath } from "@/lib/demand/contract";

import styles from "./auth.module.css";

export default async function AuthPage({
  searchParams,
}: {
  searchParams: Promise<{
    next?: string;
    error?: string;
    resume?: string;
    intent?: string;
  }>;
}) {
  const params = await searchParams;
  const cookieStore = await cookies();
  const explicitNext = safeAuthReturnPath(params.next, "");
  const cookieNext = parseAuthReturnCookie(
    cookieStore.get(AUTH_RETURN_COOKIE)?.value,
  );
  const next = explicitNext || cookieNext || "/";
  const error = safeAuthError(params.error ?? null);
  const configured = Boolean(getPublicSupabaseConfig());
  const serverConfigured = isAuthRuntimeReady();
  const authAvailable =
    configured && serverConfigured && error !== "configuration";
  const continuesDemand = Boolean(parseDemandConfirmationPath(next));
  const resumeIntent =
    params.resume === "1" && !continuesDemand
      ? (requestIntentIdSchema.safeParse(params.intent).data ?? null)
      : null;
  const identity = await getCurrentIdentity();
  if (identity && !resumeIntent) redirect(next);
  const continuesOrder = isListingOrderConfirmationPath(next);
  const browsePath = "/lafia";

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <BrandMark />
        <Link className={styles.backLink} href={browsePath}>
          <ArrowLeft aria-hidden="true" size={17} /> Back to browse
        </Link>
      </header>
      <div className={styles.shell}>
        <section className={styles.story} aria-label="Discover LocalHub">
          <div className={styles.storyShade} />
          <div className={styles.storyContent}>
            <span className={styles.location}>
              <MapPin aria-hidden="true" size={16} /> Lafia, Nasarawa State
            </span>
            <h2>Everything local, one request away.</h2>
            <p>
              Find businesses, products, and services across Lafia—then save,
              request, or claim what belongs to you.
            </p>
          </div>
        </section>
        <section aria-labelledby="auth-title" className={styles.card}>
          <div className={styles.icon} aria-hidden="true">
            <ShieldCheck size={28} />
          </div>
          <p className={styles.eyebrow}>Secure LocalHub account</p>
          <h1 id="auth-title">
            {identity && resumeIntent
              ? "Resume your saved work"
              : "Sign in to continue"}
          </h1>
          <p className={styles.intro}>
            {continuesDemand
              ? "Sign in and return to review this category gap. Nothing has been recorded yet."
              : continuesOrder
                ? "Sign in with Google and your saved order will be waiting."
                : resumeIntent
                  ? "Sign in with Google and your saved request will be waiting."
                  : "Use Google to keep your saved places, activity, requests, and business tools connected."}
          </p>
          {resumeIntent ? (
            <div className={styles.notice} role="status">
              <strong>
                Resume your saved {continuesOrder ? "order" : "request"}.
              </strong>
              <span>One secure confirmation is needed before continuing.</span>
              <form action="/auth/resume" method="post">
                <input name="intent" type="hidden" value={resumeIntent} />
                <input name="next" type="hidden" value={next} />
                <button disabled={!authAvailable} type="submit">
                  Resume {continuesOrder ? "order" : "request"}
                </button>
              </form>
            </div>
          ) : null}
          {!identity || !resumeIntent ? (
            <>
              {!authAvailable ? (
                <div className={styles.notice} role="status">
                  <strong>Google sign-in setup is being completed.</strong>
                  <span>
                    You can explore every public listing while sign-in is
                    unavailable in this preview.
                  </span>
                </div>
              ) : null}
              {authAvailable && error ? (
                <div className={styles.error} role="alert">
                  <strong>Google sign-in did not finish.</strong>
                  <span>Please try again or continue browsing as a guest.</span>
                </div>
              ) : null}
              <form
                action="/auth/provider"
                className={styles.providers}
                method="post"
              >
                <input name="next" type="hidden" value={next} />
                <button
                  disabled={!authAvailable}
                  name="provider"
                  type="submit"
                  value="google"
                >
                  Continue with Google
                  <ArrowRight aria-hidden="true" size={18} />
                </button>
              </form>
              <div className={styles.divider} aria-hidden="true">
                <span /> <p>or</p> <span />
              </div>
              <Link className={styles.guestButton} href={browsePath}>
                <Search aria-hidden="true" size={19} /> Explore Lafia as guest
              </Link>
              <Link className={styles.businessLink} href="/vendor/onboarding">
                <span className={styles.businessIcon} aria-hidden="true">
                  <Building2 size={20} />
                </span>
                <span>
                  <strong>Run a local business?</strong>
                  <small>List or claim your business</small>
                </span>
                <ArrowRight aria-hidden="true" size={18} />
              </Link>
              <p className={styles.trustNote}>
                <ShieldCheck aria-hidden="true" size={16} /> Your public profile
                is created only after you sign in.
              </p>
            </>
          ) : (
            <div className={styles.notice} role="status">
              <strong>
                You are already signed in as {identity.displayName}.
              </strong>
              <span>Resume the saved action above or return to browsing.</span>
              <form action="/auth/logout" method="post">
                <input name="next" type="hidden" value="/" />
                <button type="submit">Sign out instead</button>
              </form>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

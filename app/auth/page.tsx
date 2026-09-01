import {
  ArrowLeft,
  ArrowRight,
  CircleUserRound,
  Mail,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { BrandMark } from "@/components/brand-mark";
import { getCurrentIdentity } from "@/lib/auth/identity";
import { safeAuthNotice } from "@/lib/auth/notices";
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
    notice?: string;
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
  const notice = safeAuthNotice(params.notice);
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
  const formDescription = authAvailable
    ? "We will send a sign-in link to this email address."
    : "Sign-in is not configured in this environment. You can still continue browsing LocalHub.";

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <BrandMark />
        <Link className={styles.backLink} href={next}>
          <ArrowLeft aria-hidden="true" size={17} /> Back to browse
        </Link>
      </header>
      <section aria-labelledby="auth-title" className={styles.card}>
        <div className={styles.icon} aria-hidden="true">
          <ShieldCheck size={28} />
        </div>
        <h1 id="auth-title">
          {identity && resumeIntent
            ? "Resume your saved work"
            : "Sign in to continue"}
        </h1>
        <p className={styles.intro}>
          {continuesDemand
            ? "You will return to review a category gap. Nothing has been recorded yet."
            : continuesOrder
              ? "Your saved LocalHub order will be waiting after you sign in."
              : resumeIntent
                ? "Your saved LocalHub request will be waiting after you sign in."
                : "Sign in once to keep your LocalHub account, activity, orders, and requests connected."}
        </p>
        {resumeIntent ? (
          <div className={styles.notice} role="status">
            <strong>
              Resume your saved {continuesOrder ? "order" : "request"}.
            </strong>
            <span>We need one more secure confirmation before continuing.</span>
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
                <strong>Sign-in is unavailable in this environment.</strong>
                <span>
                  Provider setup is still pending. Browsing remains available
                  without an account.
                </span>
              </div>
            ) : null}
            {authAvailable && error ? (
              <div className={styles.error} role="alert">
                <strong>We could not complete sign-in.</strong>
                <span>
                  Please check the details and choose a sign-in method again.
                </span>
              </div>
            ) : null}
            {authAvailable && notice === "check_email" ? (
              <div className={styles.success} role="status">
                <strong>Check your email for a sign-in link.</strong>
                <span>
                  If email sign-in is available for that address, a secure link
                  will arrive shortly. You can safely close this page.
                </span>
              </div>
            ) : null}
            <form action="/auth/email" className={styles.form} method="post">
              <input name="next" type="hidden" value={next} />
              <label htmlFor="email">Email address</label>
              <input
                aria-describedby="email-help"
                autoComplete="email"
                disabled={!authAvailable}
                id="email"
                name="email"
                placeholder="you@example.com"
                required
                type="email"
              />
              <p className={styles.help} id="email-help">
                {formDescription}
              </p>
              <button disabled={!authAvailable} type="submit">
                <Mail aria-hidden="true" size={18} /> Email me a sign-in link
                <ArrowRight aria-hidden="true" size={17} />
              </button>
            </form>
            <div className={styles.divider} aria-hidden="true">
              <span /> <p>or continue with</p> <span />
            </div>
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
                <CircleUserRound aria-hidden="true" size={20} /> Continue with
                Google
              </button>
              <button
                disabled={!authAvailable}
                name="provider"
                type="submit"
                value="facebook"
              >
                <CircleUserRound aria-hidden="true" size={20} /> Continue with
                Facebook
              </button>
            </form>
            <p className={styles.continueNote}>
              <Link href={next}>Continue browsing without an account</Link>
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
    </main>
  );
}

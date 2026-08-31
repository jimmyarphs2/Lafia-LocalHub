import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { VendorOnboardingWizard } from "@/components/vendor/onboarding-wizard";
import { VendorProviderBlocker } from "@/components/vendor/provider-blocker";
import styles from "@/components/vendor/vendor-onboarding.module.css";
import { getPublicSupabaseConfig } from "@/lib/config/env";
import { loadOnboardingDraft } from "@/lib/onboarding/persistence";
import {
  emptyOnboardingDraft,
  onboardingSteps,
  type OnboardingStep,
} from "@/lib/onboarding/schema";
import { getServerSupabaseClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Vendor onboarding",
  description: "Create and securely save a LocalHub vendor profile.",
  robots: { index: false, follow: false },
};

const ONBOARDING_PATH = "/vendor/onboarding";

function asVisibleStep(step: string): OnboardingStep {
  return onboardingSteps.includes(step as OnboardingStep)
    ? (step as OnboardingStep)
    : "review";
}

export default async function VendorOnboardingPage() {
  if (!getPublicSupabaseConfig()) {
    return <VendorProviderBlocker kind="provider_not_configured" />;
  }

  const client = await getServerSupabaseClient();
  if (!client) {
    return <VendorProviderBlocker kind="provider_not_configured" />;
  }

  let authResult: Awaited<ReturnType<typeof client.auth.getUser>>;
  try {
    authResult = await client.auth.getUser();
  } catch {
    return <VendorProviderBlocker kind="authentication_unavailable" />;
  }

  if (!authResult.data.user) {
    redirect(`/auth?next=${encodeURIComponent(ONBOARDING_PATH)}`);
  }

  const loaded = await loadOnboardingDraft(client, authResult.data.user.id);
  if (!loaded.ok) {
    return <VendorProviderBlocker kind="database_unavailable" />;
  }

  const draft = loaded.draft;
  const completed = draft?.step === "complete";

  return (
    <>
      <header className={styles.intro}>
        <p className={styles.eyebrow}>Vendor setup</p>
        <h1>Bring your local business online, one clear step at a time.</h1>
        <p>
          Your authenticated draft resumes automatically. Category matching is
          deterministic and your original business wording is always preserved.
        </p>
      </header>
      <VendorOnboardingWizard
        initialCompleted={completed}
        initialStep={draft ? asVisibleStep(draft.step) : "business"}
        initialUpdatedAt={draft?.updatedAt}
        initialValues={draft?.values ?? emptyOnboardingDraft}
      />
    </>
  );
}

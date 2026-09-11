import { detectStalledOnboardingDrafts } from "@/lib/onboarding/stalled-detector";
import type { OnboardingDraftRecord } from "@/lib/onboarding/persistence";
import {
  createLocalHubGovernedRuntime,
  type GovernedWorkflowResult,
} from "@/lib/orbit/localhub-governed-runtime";

export type StalledOnboardingWorkflowOptions = {
  now?: Date;
  thresholdHours?: number;
  governed?: ReturnType<typeof createLocalHubGovernedRuntime>;
};

export type StalledOnboardingWorkflowResult = {
  candidates: ReturnType<typeof detectStalledOnboardingDrafts>;
  results: GovernedWorkflowResult[];
  governed: ReturnType<typeof createLocalHubGovernedRuntime>;
};

/**
 * Runs the existing LocalHub onboarding draft records through the ORBIT
 * governed entry point. The default runtime is staging-safe and in-memory.
 */
export async function processStalledOnboardingDrafts(
  drafts: readonly OnboardingDraftRecord[],
  options: StalledOnboardingWorkflowOptions = {},
): Promise<StalledOnboardingWorkflowResult> {
  const candidates = detectStalledOnboardingDrafts(drafts, options);
  const governed = options.governed ?? createLocalHubGovernedRuntime();
  const results = await Promise.all(
    candidates.map((candidate) =>
      governed.processMerchantOnboardingStalled(candidate),
    ),
  );

  return { candidates, results, governed };
}

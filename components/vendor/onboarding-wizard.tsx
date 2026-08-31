"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Check, ChevronLeft, ChevronRight, Save } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { useForm, useWatch, type FieldPath } from "react-hook-form";

import {
  saveVendorOnboardingDraft,
  type SaveDraftActionResult,
} from "@/app/vendor/onboarding/actions";
import { AleListingStarter } from "@/components/vendor/ale-listing-starter";
import { getAdaptiveListingSchema } from "@/lib/ale/registry";
import {
  fallbackOnboardingCategory,
  getOnboardingCategory,
} from "@/lib/onboarding/categories";
import { suggestOnboardingCategories } from "@/lib/onboarding/category-intelligence";
import {
  onboardingCompletionSchema,
  onboardingSteps,
  type OnboardingDraftValues,
  type OnboardingStep,
  type PersistedOnboardingStep,
} from "@/lib/onboarding/schema";

import styles from "@/components/vendor/vendor-onboarding.module.css";

type SaveState =
  | { status: "idle" }
  | { status: "saving" }
  | { status: "saved"; savedAt: string }
  | { status: "error"; message: string };

type OnboardingWizardProps = {
  initialCompleted: boolean;
  initialStep: OnboardingStep;
  initialUpdatedAt?: string;
  initialValues: OnboardingDraftValues;
};

const stepLabels: Record<OnboardingStep, string> = {
  business: "Business",
  category: "Category",
  profile: "Profile",
  location: "Location",
  review: "Review",
};

const stepFields: Record<
  OnboardingStep,
  readonly FieldPath<OnboardingDraftValues>[]
> = {
  business: ["businessName", "originalOffering"],
  category: ["categorySlug"],
  profile: ["description", "phone", "whatsapp", "email"],
  location: ["marketSlug", "area", "address"],
  review: [],
};

const fieldSteps: Record<FieldPath<OnboardingDraftValues>, OnboardingStep> = {
  businessName: "business",
  originalOffering: "business",
  categorySlug: "category",
  categoryConfidence: "category",
  description: "profile",
  phone: "profile",
  whatsapp: "profile",
  email: "profile",
  marketSlug: "location",
  area: "location",
  address: "location",
};

function nextStep(current: OnboardingStep): OnboardingStep {
  const index = onboardingSteps.indexOf(current);
  return onboardingSteps[Math.min(index + 1, onboardingSteps.length - 1)];
}

function previousStep(current: OnboardingStep): OnboardingStep {
  const index = onboardingSteps.indexOf(current);
  return onboardingSteps[Math.max(index - 1, 0)];
}

function formattedSaveTime(isoDate: string): string {
  return new Intl.DateTimeFormat("en-NG", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(isoDate));
}

function StepHeading({
  children,
  description,
  headingRef,
}: {
  children: React.ReactNode;
  description: string;
  headingRef: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <div className={styles.stepHeading} ref={headingRef} tabIndex={-1}>
      <h2>{children}</h2>
      <p>{description}</p>
    </div>
  );
}

export function VendorOnboardingWizard({
  initialCompleted,
  initialStep,
  initialUpdatedAt,
  initialValues,
}: OnboardingWizardProps) {
  const [currentStep, setCurrentStep] = useState(initialStep);
  const [completed, setCompleted] = useState(initialCompleted);
  const [saveState, setSaveState] = useState<SaveState>(
    initialUpdatedAt
      ? { status: "saved", savedAt: initialUpdatedAt }
      : { status: "idle" },
  );
  const [isSaving, startSavingTransition] = useTransition();
  const headingRef = useRef<HTMLDivElement>(null);
  const saveSequence = useRef(0);
  const hasMounted = useRef(false);

  const {
    control,
    formState: { errors, isDirty },
    getValues,
    register,
    setError,
    setValue,
    trigger,
  } = useForm<OnboardingDraftValues>({
    defaultValues: initialValues,
    mode: "onTouched",
    resolver: zodResolver(onboardingCompletionSchema),
  });

  const watchedValues = useWatch({ control });
  const watchedFingerprint = JSON.stringify(watchedValues);
  const originalOffering = watchedValues.originalOffering ?? "";
  const selectedCategorySlug = watchedValues.categorySlug ?? "";
  const suggestions = useMemo(
    () => suggestOnboardingCategories(originalOffering, 3),
    [originalOffering],
  );
  const selectedCategory =
    getOnboardingCategory(selectedCategorySlug) ?? fallbackOnboardingCategory;
  const displayedSuggestions = useMemo(() => {
    const displayed = [...suggestions];
    if (
      selectedCategorySlug &&
      !displayed.some(
        (suggestion) => suggestion.category.slug === selectedCategorySlug,
      )
    ) {
      displayed.push({
        category: selectedCategory,
        confidence:
          selectedCategory.slug === fallbackOnboardingCategory.slug
            ? "unknown"
            : "low",
        matchedTerms: [],
        normalizedWording: "",
        originalWording: originalOffering,
        score: 0,
      });
    }
    if (
      !displayed.some(
        (suggestion) =>
          suggestion.category.slug === fallbackOnboardingCategory.slug,
      )
    ) {
      displayed.push({
        category: fallbackOnboardingCategory,
        confidence: "unknown",
        matchedTerms: [],
        normalizedWording: "",
        originalWording: originalOffering,
        score: 0,
      });
    }
    return displayed;
  }, [originalOffering, selectedCategory, selectedCategorySlug, suggestions]);
  const listingSchema = getAdaptiveListingSchema(selectedCategory.listingKind);

  const runSaveAction = useCallback(
    (step: PersistedOnboardingStep, values: OnboardingDraftValues) =>
      new Promise<SaveDraftActionResult>((resolve) => {
        startSavingTransition(async () => {
          try {
            resolve(await saveVendorOnboardingDraft({ step, values }));
          } catch {
            resolve({
              ok: false,
              code: "persistence",
              message:
                "Your draft could not be saved securely. Check your connection and try again.",
            });
          }
        });
      }),
    [],
  );

  const persistDraft = useCallback(
    async (
      step: PersistedOnboardingStep,
      values: OnboardingDraftValues,
      announceError = true,
    ): Promise<boolean> => {
      const sequence = ++saveSequence.current;
      setSaveState({ status: "saving" });
      const result = await runSaveAction(step, values);
      if (sequence !== saveSequence.current) return result.ok;

      if (result.ok) {
        setSaveState({ status: "saved", savedAt: result.savedAt });
        return true;
      }

      if (result.fieldErrors) {
        for (const [field, message] of Object.entries(result.fieldErrors)) {
          if (message) {
            setError(field as FieldPath<OnboardingDraftValues>, {
              message,
              type: "server",
            });
          }
        }
      }
      setSaveState({ status: "error", message: result.message });
      if (announceError) headingRef.current?.focus();
      return false;
    },
    [runSaveAction, setError],
  );

  useEffect(() => {
    if (!hasMounted.current) {
      hasMounted.current = true;
      return;
    }
    if (!isDirty || completed) return;

    const snapshot = getValues();
    if (snapshot.businessName.trim().length < 2) {
      return;
    }

    const timer = window.setTimeout(() => {
      void persistDraft(currentStep, getValues(), false);
    }, 1_400);

    return () => window.clearTimeout(timer);
  }, [
    completed,
    currentStep,
    getValues,
    isDirty,
    persistDraft,
    watchedFingerprint,
  ]);

  useEffect(() => {
    headingRef.current?.focus();
  }, [currentStep]);

  const goForward = async () => {
    const valid = await trigger(stepFields[currentStep], { shouldFocus: true });
    if (!valid) return;

    if (currentStep === "review") {
      const complete = onboardingCompletionSchema.safeParse(getValues());
      if (!complete.success) {
        await trigger(undefined, { shouldFocus: true });
        const firstField = complete.error.issues[0]?.path[0];
        if (typeof firstField === "string" && firstField in fieldSteps) {
          setCurrentStep(
            fieldSteps[firstField as FieldPath<OnboardingDraftValues>],
          );
        }
        return;
      }
      const saved = await persistDraft("complete", getValues());
      if (saved) setCompleted(true);
      return;
    }

    const destination = nextStep(currentStep);
    const saved = await persistDraft(destination, getValues());
    if (saved) setCurrentStep(destination);
  };

  const goBack = () => {
    setCurrentStep(previousStep(currentStep));
  };

  const submitOnboarding = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isSaving && !completed) void goForward();
  };

  const chooseCategory = (
    slug: string,
    confidence: OnboardingDraftValues["categoryConfidence"],
  ) => {
    setValue("categorySlug", slug, {
      shouldDirty: true,
      shouldTouch: true,
      shouldValidate: true,
    });
    setValue("categoryConfidence", confidence, { shouldDirty: true });
  };

  const errorFor = (field: FieldPath<OnboardingDraftValues>) => {
    const message = errors[field]?.message;
    return typeof message === "string" ? message : undefined;
  };

  return (
    <div className={styles.workspace}>
      <ol className={styles.progress} aria-label="Onboarding progress">
        {onboardingSteps.map((step, index) => {
          const currentIndex = onboardingSteps.indexOf(currentStep);
          const stateClass =
            index < currentIndex
              ? styles.progressComplete
              : index === currentIndex
                ? styles.progressCurrent
                : "";
          return (
            <li
              aria-current={step === currentStep ? "step" : undefined}
              className={`${styles.progressItem} ${stateClass}`}
              key={step}
            >
              <span>{stepLabels[step]}</span>
            </li>
          );
        })}
      </ol>

      <section className={styles.card} aria-label="Vendor onboarding form">
        {completed ? (
          <div className={styles.completionBanner} role="status">
            <strong>
              <Check aria-hidden="true" size={18} /> Your onboarding draft is
              complete.
            </strong>
            Your answers are saved securely. Publishing remains disabled until
            listing persistence and media moderation are verified.
          </div>
        ) : null}

        <form onSubmit={submitOnboarding}>
          {currentStep === "business" ? (
            <>
              <StepHeading
                description="Start with the words you already use. LocalHub will adapt around your business."
                headingRef={headingRef}
              >
                Tell us about your business
              </StepHeading>
              <div className={styles.fields}>
                <div className={styles.field}>
                  <label htmlFor="businessName">Business name</label>
                  <input
                    aria-describedby={
                      errorFor("businessName")
                        ? "businessName-error"
                        : undefined
                    }
                    aria-invalid={Boolean(errorFor("businessName"))}
                    autoComplete="organization"
                    id="businessName"
                    maxLength={120}
                    placeholder="e.g. Amina's Cakes"
                    {...register("businessName")}
                  />
                  {errorFor("businessName") ? (
                    <p
                      className={styles.fieldError}
                      id="businessName-error"
                      role="alert"
                    >
                      {errorFor("businessName")}
                    </p>
                  ) : null}
                </div>
                <div className={styles.field}>
                  <label htmlFor="originalOffering">
                    What do you sell or do?
                  </label>
                  <small id="originalOffering-help">
                    Use your own words. We keep this wording even when we
                    suggest a category.
                  </small>
                  <textarea
                    aria-describedby={`originalOffering-help${errorFor("originalOffering") ? " originalOffering-error" : ""}`}
                    aria-invalid={Boolean(errorFor("originalOffering"))}
                    id="originalOffering"
                    maxLength={240}
                    placeholder="e.g. I bake celebration cakes and small chops for events"
                    rows={4}
                    {...register("originalOffering")}
                  />
                  {errorFor("originalOffering") ? (
                    <p
                      className={styles.fieldError}
                      id="originalOffering-error"
                      role="alert"
                    >
                      {errorFor("originalOffering")}
                    </p>
                  ) : null}
                </div>
              </div>
            </>
          ) : null}

          {currentStep === "category" ? (
            <>
              <StepHeading
                description="Choose the closest match. An unfamiliar trade can always continue as Other local trade."
                headingRef={headingRef}
              >
                Help customers find you
              </StepHeading>
              <p className={styles.preservedWording}>
                <strong>Your wording is preserved:</strong> “{originalOffering}”
              </p>
              <fieldset className={styles.fieldGroup}>
                <legend>Suggested categories</legend>
                <input type="hidden" {...register("categorySlug")} />
                <input type="hidden" {...register("categoryConfidence")} />
                <div className={styles.suggestionList}>
                  {displayedSuggestions.map((suggestion) => (
                    <label
                      className={styles.suggestion}
                      key={suggestion.category.slug}
                    >
                      <input
                        checked={
                          selectedCategorySlug === suggestion.category.slug
                        }
                        name="categorySlug"
                        onChange={() =>
                          chooseCategory(
                            suggestion.category.slug,
                            suggestion.confidence,
                          )
                        }
                        type="radio"
                        value={suggestion.category.slug}
                      />
                      <span>
                        <strong>{suggestion.category.name}</strong>
                        <span>{suggestion.category.description}</span>
                        <span className={styles.confidence}>
                          {suggestion.confidence === "unknown"
                            ? "New category fallback"
                            : `${suggestion.confidence} match`}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
                {errorFor("categorySlug") ? (
                  <p className={styles.fieldError} role="alert">
                    {errorFor("categorySlug")}
                  </p>
                ) : null}
              </fieldset>
            </>
          ) : null}

          {currentStep === "profile" ? (
            <>
              <StepHeading
                description="Give customers enough context to decide whether to contact you. One contact method is required."
                headingRef={headingRef}
              >
                Build your public profile
              </StepHeading>
              <div className={styles.fields}>
                <div className={styles.field}>
                  <label htmlFor="description">Business description</label>
                  <textarea
                    aria-describedby={
                      errorFor("description") ? "description-error" : undefined
                    }
                    aria-invalid={Boolean(errorFor("description"))}
                    id="description"
                    maxLength={1500}
                    placeholder="What do you offer, who is it for, and what makes your service useful?"
                    rows={6}
                    {...register("description")}
                  />
                  {errorFor("description") ? (
                    <p
                      className={styles.fieldError}
                      id="description-error"
                      role="alert"
                    >
                      {errorFor("description")}
                    </p>
                  ) : null}
                </div>
                <p className={styles.contactNote}>
                  Add only business contact details you are comfortable showing
                  to customers after your profile is approved.
                </p>
                <div className={styles.fieldGrid}>
                  <div className={styles.field}>
                    <label htmlFor="phone">Phone</label>
                    <input
                      aria-describedby={
                        errorFor("phone") ? "phone-error" : undefined
                      }
                      aria-invalid={Boolean(errorFor("phone"))}
                      autoComplete="tel"
                      id="phone"
                      inputMode="tel"
                      placeholder="e.g. +234 800 000 0000"
                      {...register("phone")}
                    />
                    {errorFor("phone") ? (
                      <p
                        className={styles.fieldError}
                        id="phone-error"
                        role="alert"
                      >
                        {errorFor("phone")}
                      </p>
                    ) : null}
                  </div>
                  <div className={styles.field}>
                    <label htmlFor="whatsapp">WhatsApp</label>
                    <input
                      aria-describedby={
                        errorFor("whatsapp") ? "whatsapp-error" : undefined
                      }
                      aria-invalid={Boolean(errorFor("whatsapp"))}
                      autoComplete="tel"
                      id="whatsapp"
                      inputMode="tel"
                      placeholder="e.g. +234 800 000 0000"
                      {...register("whatsapp")}
                    />
                    {errorFor("whatsapp") ? (
                      <p
                        className={styles.fieldError}
                        id="whatsapp-error"
                        role="alert"
                      >
                        {errorFor("whatsapp")}
                      </p>
                    ) : null}
                  </div>
                </div>
                <div className={styles.field}>
                  <label htmlFor="email">Business email</label>
                  <input
                    aria-describedby={
                      errorFor("email") ? "email-error" : undefined
                    }
                    aria-invalid={Boolean(errorFor("email"))}
                    autoComplete="email"
                    id="email"
                    inputMode="email"
                    placeholder="business@example.com"
                    type="email"
                    {...register("email")}
                  />
                  {errorFor("email") ? (
                    <p
                      className={styles.fieldError}
                      id="email-error"
                      role="alert"
                    >
                      {errorFor("email")}
                    </p>
                  ) : null}
                </div>
              </div>
            </>
          ) : null}

          {currentStep === "location" ? (
            <>
              <StepHeading
                description="Tell customers where you operate. A full street address is optional during onboarding."
                headingRef={headingRef}
              >
                Set your launch location
              </StepHeading>
              <div className={styles.fields}>
                <div className={styles.field}>
                  <label>Launch market</label>
                  <div className={styles.readonlyValue}>
                    Lafia, Nasarawa State
                  </div>
                  <input type="hidden" {...register("marketSlug")} />
                </div>
                <div className={styles.field}>
                  <label htmlFor="area">Area or neighbourhood</label>
                  <input
                    aria-describedby={
                      errorFor("area") ? "area-error" : undefined
                    }
                    aria-invalid={Boolean(errorFor("area"))}
                    autoComplete="address-level3"
                    id="area"
                    maxLength={120}
                    placeholder="e.g. Shendam Road"
                    {...register("area")}
                  />
                  {errorFor("area") ? (
                    <p
                      className={styles.fieldError}
                      id="area-error"
                      role="alert"
                    >
                      {errorFor("area")}
                    </p>
                  ) : null}
                </div>
                <div className={styles.field}>
                  <label htmlFor="address">Street address (optional)</label>
                  <textarea
                    aria-describedby={
                      errorFor("address") ? "address-error" : undefined
                    }
                    aria-invalid={Boolean(errorFor("address"))}
                    autoComplete="street-address"
                    id="address"
                    maxLength={240}
                    placeholder="Add landmarks or directions that help customers find you"
                    rows={3}
                    {...register("address")}
                  />
                  {errorFor("address") ? (
                    <p
                      className={styles.fieldError}
                      id="address-error"
                      role="alert"
                    >
                      {errorFor("address")}
                    </p>
                  ) : null}
                </div>
              </div>
            </>
          ) : null}

          {currentStep === "review" ? (
            <>
              <StepHeading
                description="Check the saved foundation for your vendor profile. You can go back to change anything."
                headingRef={headingRef}
              >
                Review your LocalHub setup
              </StepHeading>
              <div className={styles.reviewGrid}>
                <section className={styles.reviewSection}>
                  <h3>Business</h3>
                  <p>
                    <strong>{watchedValues.businessName}</strong>
                  </p>
                  <p>“{watchedValues.originalOffering}”</p>
                </section>
                <section className={styles.reviewSection}>
                  <h3>Customer category</h3>
                  <p>
                    <strong>{selectedCategory.name}</strong>
                  </p>
                  <p>{selectedCategory.description}</p>
                </section>
                <section className={styles.reviewSection}>
                  <h3>Contact</h3>
                  <p>
                    {watchedValues.phone ||
                      watchedValues.whatsapp ||
                      watchedValues.email}
                  </p>
                  <p>{watchedValues.description}</p>
                </section>
                <section className={styles.reviewSection}>
                  <h3>Launch location</h3>
                  <p>
                    <strong>{watchedValues.area}, Lafia</strong>
                  </p>
                  {watchedValues.address ? (
                    <p>{watchedValues.address}</p>
                  ) : null}
                </section>
              </div>
              <section className={styles.nextAction}>
                <strong>
                  Next Best Action: {listingSchema.terminology.createAction}
                </strong>
                <p>
                  LocalHub selected the {listingSchema.terminology.singular}{" "}
                  workflow from the category mapping—not a category-specific
                  page.
                </p>
              </section>
            </>
          ) : null}

          {saveState.status === "error" ? (
            <p className={styles.saveError} role="alert">
              {saveState.message}
            </p>
          ) : null}

          <div className={styles.actions}>
            <div aria-live="polite" className={styles.saveStatus} role="status">
              {isSaving || saveState.status === "saving" ? (
                <>
                  <span aria-hidden="true" className={styles.spinner} /> Saving
                  securely…
                </>
              ) : saveState.status === "saved" ? (
                <>
                  <Save aria-hidden="true" size={15} /> Saved at{" "}
                  {formattedSaveTime(saveState.savedAt)}
                </>
              ) : (
                "Your progress saves after you begin."
              )}
            </div>
            <div className={styles.actionGroup}>
              {currentStep !== "business" ? (
                <button
                  className={styles.secondaryButton}
                  disabled={isSaving}
                  onClick={goBack}
                  type="button"
                >
                  <ChevronLeft aria-hidden="true" size={18} /> Back
                </button>
              ) : null}
              {completed ? (
                <span className={styles.saveStatus}>
                  Submitted details are locked after completion.
                </span>
              ) : (
                <button
                  className={styles.primaryButton}
                  disabled={isSaving}
                  type="submit"
                >
                  {currentStep === "review"
                    ? "Finish onboarding"
                    : "Save and continue"}
                  {currentStep === "review" ? (
                    <Check aria-hidden="true" size={18} />
                  ) : (
                    <ChevronRight aria-hidden="true" size={18} />
                  )}
                </button>
              )}
            </div>
          </div>
        </form>
        {currentStep === "review" ? (
          <details className={styles.alePreview}>
            <summary>Preview your adaptive listing form</summary>
            <div className={styles.alePreviewBody}>
              <AleListingStarter
                key={listingSchema.schemaKey}
                schema={listingSchema}
              />
            </div>
          </details>
        ) : null}
      </section>
    </div>
  );
}

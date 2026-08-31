"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle2, Save } from "lucide-react";
import type { FormEvent } from "react";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useForm, useWatch } from "react-hook-form";

import {
  saveVendorListingDraft,
  type SaveVendorListingDraftActionResult,
} from "@/app/vendor/listings/actions";
import { DynamicFieldRenderer } from "@/components/vendor/dynamic-field-renderer";
import {
  DRAFT_NAVIGATION_REQUEST,
  DraftNavigationLink,
} from "@/components/vendor/draft-navigation-link";
import type { AleFormValues } from "@/lib/ale/contract";
import { buildAdaptiveListingValueSchema } from "@/lib/ale/validation";
import type {
  ListingDraftNormalizedRow,
  VendorListingDraftWorkspace,
} from "@/lib/listings/workspace";

import styles from "./listing-draft-workspace.module.css";

const DRAFT_HISTORY_GUARD_KEY = "__localhubListingDraftGuard";

type SaveErrorCode = Extract<
  SaveVendorListingDraftActionResult,
  { ok: false }
>["code"];

type SaveState =
  | { status: "idle" }
  | { status: "saving"; announce: boolean }
  | { status: "saved"; savedAt: string; announce: boolean }
  | {
      status: "error";
      code: SaveErrorCode;
      message: string;
    };

type ListingDraftWorkspaceProps = {
  createIdempotencyKey: string;
  workspace: VendorListingDraftWorkspace;
};

function formatSavedAt(isoDate: string): string {
  return new Intl.DateTimeFormat("en-NG", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(isoDate));
}

function valuesFor(draft: ListingDraftNormalizedRow | null): AleFormValues {
  return draft?.values ?? {};
}

export function ListingDraftWorkspace({
  createIdempotencyKey,
  workspace,
}: ListingDraftWorkspaceProps) {
  const [draft, setDraft] = useState(workspace.selectedDraft);
  const [saveState, setSaveState] = useState<SaveState>({ status: "idle" });
  const [isSaving, startSavingTransition] = useTransition();
  const hasMounted = useRef(false);
  const saveSequence = useRef(0);
  const failedSaveFingerprint = useRef<string | null>(null);
  const navigationRiskRef = useRef({ isDirty: false, isSaving: false });
  const errorRef = useRef<HTMLDivElement>(null);
  const valueSchema = buildAdaptiveListingValueSchema(workspace.schema);
  const {
    control,
    formState: { errors, isDirty },
    getValues,
    handleSubmit,
    register,
    reset,
    setError,
  } = useForm<AleFormValues>({
    defaultValues: valuesFor(workspace.selectedDraft),
    mode: "onTouched",
    resolver: zodResolver(valueSchema),
    shouldUnregister: true,
  });
  const watchedValues = useWatch({ control });
  const watchedFingerprint = JSON.stringify(watchedValues);
  const saveErrorCode =
    saveState.status === "error" ? saveState.code : undefined;

  const runSaveAction = useCallback(
    (values: AleFormValues) =>
      new Promise<SaveVendorListingDraftActionResult>((resolve) => {
        startSavingTransition(async () => {
          try {
            resolve(
              await saveVendorListingDraft({
                targetBusinessId: workspace.businessId,
                listingId: draft?.listingId,
                expectedRevision: draft?.revision,
                expectedSchemaId: workspace.mapping.schemaId,
                expectedSchemaVersion: workspace.mapping.schemaVersion,
                createIdempotencyKey: draft ? undefined : createIdempotencyKey,
                values,
              }),
            );
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
    [createIdempotencyKey, draft, workspace],
  );

  const persistDraft = useCallback(
    async (
      values: AleFormValues,
      shouldFocusOnFailure: boolean,
      announceSuccess: boolean,
    ) => {
      const sequence = ++saveSequence.current;
      const formFingerprintAtStart = JSON.stringify(values);
      setSaveState({ status: "saving", announce: announceSuccess });
      const result = await runSaveAction(values);
      if (sequence !== saveSequence.current) return result.ok;

      if (!result.ok) {
        failedSaveFingerprint.current = formFingerprintAtStart;
        for (const [field, message] of Object.entries(
          result.fieldErrors ?? {},
        )) {
          if (message) setError(field, { message, type: "server" });
        }
        setSaveState({
          status: "error",
          code: result.code,
          message: result.message,
        });
        if (shouldFocusOnFailure)
          requestAnimationFrame(() => errorRef.current?.focus());
        return false;
      }

      const nextDraft: ListingDraftNormalizedRow = {
        listingId: result.listingId,
        revision: result.revision,
        slug: draft?.slug ?? result.listingId,
        updatedAt: result.savedAt,
        values,
      };
      const wasCreated = !draft;
      const changedDuringSave =
        JSON.stringify(getValues()) !== formFingerprintAtStart;
      failedSaveFingerprint.current = null;
      setDraft(nextDraft);
      if (!changedDuringSave) reset(values);
      setSaveState({
        status: "saved",
        savedAt: result.savedAt,
        announce: announceSuccess,
      });

      if (wasCreated) {
        const params = new URLSearchParams({
          business: workspace.businessId,
          draft: result.listingId,
        });
        window.history.replaceState(
          window.history.state,
          "",
          `/vendor/listings?${params.toString()}`,
        );
      }
      return true;
    },
    [draft, getValues, reset, runSaveAction, setError, workspace],
  );

  useEffect(() => {
    if (!hasMounted.current) {
      hasMounted.current = true;
      return;
    }
    if (!draft || !isDirty || isSaving) return;
    if (saveErrorCode) {
      if (saveErrorCode === "conflict") return;
      if (failedSaveFingerprint.current === watchedFingerprint) return;
    }

    const timer = window.setTimeout(() => {
      void persistDraft(getValues(), false, false);
    }, 1_200);
    return () => window.clearTimeout(timer);
  }, [
    draft,
    getValues,
    isDirty,
    isSaving,
    persistDraft,
    saveErrorCode,
    watchedFingerprint,
  ]);

  useEffect(() => {
    navigationRiskRef.current = { isDirty, isSaving };
  }, [isDirty, isSaving]);

  const navigationAtRisk = isDirty || isSaving;

  useEffect(() => {
    if (!navigationAtRisk) return;

    const guardId = `${workspace.businessId}:${createIdempotencyKey}`;
    const currentState =
      window.history.state && typeof window.history.state === "object"
        ? window.history.state
        : {};
    if (currentState[DRAFT_HISTORY_GUARD_KEY] !== guardId) {
      window.history.pushState(
        { ...currentState, [DRAFT_HISTORY_GUARD_KEY]: guardId },
        "",
        window.location.href,
      );
    }

    let restoringGuardEntry = false;
    let approvedHistoryExit = false;

    function confirmUnsavedExit(): boolean {
      const risk = navigationRiskRef.current;
      if (risk.isSaving) return false;
      return (
        !risk.isDirty ||
        window.confirm(
          "This draft has unsaved changes. Leave without saving them?",
        )
      );
    }

    function protectDraftNavigation(event: Event) {
      if (!confirmUnsavedExit()) event.preventDefault();
    }

    function protectBrowserNavigation(event: BeforeUnloadEvent) {
      const risk = navigationRiskRef.current;
      if (!risk.isDirty && !risk.isSaving) return;
      event.preventDefault();
      event.returnValue = "";
    }

    function protectHistoryNavigation() {
      if (restoringGuardEntry) {
        restoringGuardEntry = false;
        return;
      }
      if (approvedHistoryExit) return;

      if (confirmUnsavedExit()) {
        approvedHistoryExit = true;
        window.history.back();
        return;
      }

      restoringGuardEntry = true;
      window.history.forward();
    }

    window.addEventListener(DRAFT_NAVIGATION_REQUEST, protectDraftNavigation);
    window.addEventListener("beforeunload", protectBrowserNavigation);
    window.addEventListener("popstate", protectHistoryNavigation);
    return () => {
      window.removeEventListener(
        DRAFT_NAVIGATION_REQUEST,
        protectDraftNavigation,
      );
      window.removeEventListener("beforeunload", protectBrowserNavigation);
      window.removeEventListener("popstate", protectHistoryNavigation);
    };
  }, [createIdempotencyKey, navigationAtRisk, workspace.businessId]);

  const submit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      void handleSubmit((values) => persistDraft(values, true, true))(event);
    },
    [handleSubmit, persistDraft],
  );

  return (
    <div className={styles.workspace}>
      <section className={styles.card} aria-labelledby="listing-draft-title">
        <div className={styles.heading}>
          <p className={styles.eyebrow}>Unpublished listing draft</p>
          <h2 id="listing-draft-title">
            {draft
              ? "Edit listing draft"
              : workspace.schema.terminology.createAction}
          </h2>
          <p>
            These fields come from the approved category schema for this
            business. Saving keeps this listing as a draft; it does not submit
            or publish it.
          </p>
        </div>

        <form onSubmit={submit}>
          <div className={styles.fields}>
            {workspace.schema.fields.map((field) => {
              const message = errors[field.key]?.message;
              return (
                <DynamicFieldRenderer
                  error={typeof message === "string" ? message : undefined}
                  field={field}
                  key={field.key}
                  register={register}
                />
              );
            })}
          </div>

          {saveState.status === "error" ? (
            <div
              className={styles.error}
              ref={errorRef}
              role="alert"
              tabIndex={-1}
            >
              <strong>
                {saveState.code === "conflict"
                  ? "This draft changed elsewhere"
                  : "Draft not saved"}
              </strong>
              <p>{saveState.message}</p>
              {saveState.code === "conflict" ? (
                <button
                  className={styles.retryButton}
                  onClick={() => window.location.reload()}
                  type="button"
                >
                  Reload current draft
                </button>
              ) : null}
            </div>
          ) : null}

          <div className={styles.actions}>
            <button
              className={styles.saveButton}
              disabled={isSaving}
              type="submit"
            >
              <Save aria-hidden="true" size={18} />
              {isSaving ? "Saving draft…" : "Save draft"}
            </button>
            {draft ? (
              <DraftNavigationLink
                className={styles.mediaLink}
                href={`/vendor/media-lab?listing=${encodeURIComponent(draft.listingId)}`}
              >
                Add original media
              </DraftNavigationLink>
            ) : null}
            <div
              aria-atomic="true"
              aria-live={
                (saveState.status === "saving" ||
                  saveState.status === "saved") &&
                saveState.announce
                  ? "polite"
                  : "off"
              }
              className={styles.status}
            >
              {saveState.status === "saving" ? "Saving your draft…" : null}
              {saveState.status !== "saving" && isDirty
                ? "Unsaved changes · save before leaving"
                : null}
              {saveState.status === "saved" && !isDirty ? (
                <>
                  <CheckCircle2 aria-hidden="true" size={17} /> Saved at{" "}
                  {formatSavedAt(saveState.savedAt)} · Revision{" "}
                  {draft?.revision}
                </>
              ) : null}
              {saveState.status === "idle" && draft && !isDirty
                ? `Revision ${draft.revision}`
                : null}
            </div>
          </div>
        </form>
      </section>
    </div>
  );
}

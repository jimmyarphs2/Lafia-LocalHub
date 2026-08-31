"use client";

import Link from "next/link";
import {
  Camera,
  CheckCircle2,
  FileText,
  ImagePlus,
  LockKeyhole,
  RefreshCw,
  Trash2,
  UploadCloud,
} from "lucide-react";
import { useEffect, useState, type ChangeEvent } from "react";

import styles from "@/components/vendor/media/vendor-media.module.css";
import {
  LISTING_MEDIA_ACCEPT,
  LISTING_MEDIA_BUCKET,
  LISTING_MEDIA_CAMERA_ACCEPT,
  MEDIA_MUTATION_HEADER,
  MEDIA_MUTATION_HEADER_VALUE,
  mediaConfirmationSuccessSchema,
  mediaMutationErrorSchema,
  mediaNegotiationSchema,
  mediaNegotiationSuccessSchema,
  mediaRemovalSuccessSchema,
  sanitizeOriginalFileName,
  type MediaMutationError,
  type MediaNegotiationInput,
} from "@/lib/media/contracts";
import { getBrowserSupabaseClient } from "@/lib/supabase/browser";

export type VendorMediaListing = {
  id: string;
  status: string;
  title: string;
};

export type VendorMediaProviderState =
  | "authentication_required"
  | "provider_not_configured"
  | "ready"
  | "unavailable";

type UploadStage =
  | "confirming"
  | "confirmed"
  | "error"
  | "idle"
  | "negotiating"
  | "removing"
  | "selected"
  | "uploading";

type UploadSelection = {
  file: File;
  idempotencyKey: string;
  storagePath?: string;
  uploadAttempted: boolean;
  uploadExpiresAt?: string;
  uploadToken?: string;
};

type ClientResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: MediaMutationError; status: number };

const mutationHeaders = {
  "content-type": "application/json",
  [MEDIA_MUTATION_HEADER]: MEDIA_MUTATION_HEADER_VALUE,
};

const fallbackError: MediaMutationError = {
  ok: false,
  code: "MEDIA_REQUEST_FAILED",
  message: "The secure media request could not be completed.",
  retryable: true,
};

const UPLOAD_TOKEN_EXPIRY_SAFETY_MS = 30_000;

function hasUsableUploadToken(selection: UploadSelection): boolean {
  if (!selection.uploadToken || !selection.uploadExpiresAt) return false;

  const expiresAt = Date.parse(selection.uploadExpiresAt);
  return (
    Number.isFinite(expiresAt) &&
    expiresAt > Date.now() + UPLOAD_TOKEN_EXPIRY_SAFETY_MS
  );
}

async function parseMutationResult<T>(
  response: Response,
  parseSuccess: (
    value: unknown,
  ) => { success: true; data: T } | { success: false },
): Promise<ClientResult<T>> {
  const body: unknown = await response.json().catch(() => null);
  if (response.ok) {
    const parsed = parseSuccess(body);
    if (parsed.success) return { ok: true, data: parsed.data };
  }

  const parsedError = mediaMutationErrorSchema.safeParse(body);
  return {
    ok: false,
    error: parsedError.success ? parsedError.data : fallbackError,
    status: response.status,
  };
}

function ProviderGate({ state }: { state: VendorMediaProviderState }) {
  if (state === "ready") return null;

  const content = {
    authentication_required: {
      heading: "Sign in to manage listing originals.",
      body: "LocalHub has not opened an upload session because your vendor identity has not been verified.",
      action: (
        <Link
          className={styles.primaryLink}
          href="/auth?next=/vendor/media-lab"
        >
          Sign in securely
        </Link>
      ),
    },
    provider_not_configured: {
      heading: "Secure media storage is not configured.",
      body: "This environment does not have the public Supabase connection required for authenticated, RLS-protected uploads. No file has been accepted.",
      action: null,
    },
    unavailable: {
      heading: "Secure media storage is not ready yet.",
      body: "LocalHub could not verify the protected listing and storage policies. Apply the reviewed migration and retry; no browser-only fallback is used.",
      action: null,
    },
  }[state];

  return (
    <section className={styles.providerGate} aria-labelledby="media-gate-title">
      <LockKeyhole aria-hidden="true" size={30} />
      <p className={styles.eyebrow}>Protected workflow</p>
      <h2 id="media-gate-title">{content.heading}</h2>
      <p>{content.body}</p>
      {content.action}
    </section>
  );
}

export function VendorMediaUploader({
  initialListingId,
  listings,
  providerState,
}: {
  initialListingId?: string;
  listings: readonly VendorMediaListing[];
  providerState: VendorMediaProviderState;
}) {
  const firstListingId = listings.at(0)?.id ?? "";
  const selectedInitialListingId =
    initialListingId &&
    listings.some((listing) => listing.id === initialListingId)
      ? initialListingId
      : firstListingId;
  const [listingId, setListingId] = useState(selectedInitialListingId);
  const [selection, setSelection] = useState<UploadSelection | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [altText, setAltText] = useState("");
  const [stage, setStage] = useState<UploadStage>("idle");
  const [error, setError] = useState<MediaMutationError | null>(null);

  useEffect(
    () => () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    },
    [previewUrl],
  );

  if (providerState !== "ready") {
    return <ProviderGate state={providerState} />;
  }

  if (listings.length === 0) {
    return (
      <section
        className={styles.providerGate}
        aria-labelledby="no-listing-title"
      >
        <ImagePlus aria-hidden="true" size={30} />
        <p className={styles.eyebrow}>Listing required</p>
        <h2 id="no-listing-title">Create a draft listing first.</h2>
        <p>
          Media is always scoped to a listing. This lab will not create an
          unattached object or accept a business identifier from the browser.
        </p>
        <Link className={styles.primaryLink} href="/vendor/onboarding">
          Continue vendor onboarding
        </Link>
      </section>
    );
  }

  const busy = ["confirming", "negotiating", "removing", "uploading"].includes(
    stage,
  );
  const confirmed = stage === "confirmed";

  function clearSelection(): void {
    setSelection(null);
    setAltText("");
    setPreviewUrl(null);
    setError(null);
    setStage("idle");
  }

  function handleListingChange(event: ChangeEvent<HTMLSelectElement>): void {
    clearSelection();
    setListingId(event.currentTarget.value);
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>): void {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;

    const idempotencyKey = crypto.randomUUID();
    const parsed = mediaNegotiationSchema.safeParse({
      listingId,
      fileName: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
      idempotencyKey,
    });

    if (!parsed.success) {
      setSelection(null);
      setPreviewUrl(null);
      setStage("error");
      setError({
        ok: false,
        code: "MEDIA_INVALID_FILE",
        message:
          parsed.error.issues.at(0)?.message ??
          "Choose a supported file of 20 MB or less.",
        retryable: false,
      });
      return;
    }

    setPreviewUrl(
      file.type.startsWith("image/") || file.type.startsWith("video/")
        ? URL.createObjectURL(file)
        : null,
    );
    setSelection({ file, idempotencyKey, uploadAttempted: false });
    setAltText("");
    setError(null);
    setStage("selected");
  }

  function payloadFor(current: UploadSelection): MediaNegotiationInput {
    return {
      listingId,
      fileName: current.file.name,
      mimeType: current.file.type as MediaNegotiationInput["mimeType"],
      sizeBytes: current.file.size,
      idempotencyKey: current.idempotencyKey,
    };
  }

  async function confirmOriginal(
    current: UploadSelection & { storagePath: string },
  ): Promise<"confirmed" | "failed" | "missing"> {
    setStage("confirming");
    const response = await fetch("/api/vendor/media/confirm", {
      method: "POST",
      credentials: "same-origin",
      headers: mutationHeaders,
      body: JSON.stringify({
        ...payloadFor(current),
        storagePath: current.storagePath,
        altText,
      }),
    });
    const result = await parseMutationResult(response, (value) =>
      mediaConfirmationSuccessSchema.safeParse(value),
    );

    if (result.ok) {
      setSelection(current);
      setError(null);
      setStage("confirmed");
      return "confirmed";
    }

    if (result.error.code === "MEDIA_OBJECT_NOT_FOUND") return "missing";
    setError(result.error);
    setStage("error");
    return "failed";
  }

  async function uploadOriginal(): Promise<void> {
    if (!selection || !listingId || busy) return;

    try {
      await performUploadOriginal(selection);
    } catch {
      setError(fallbackError);
      setStage("error");
    }
  }

  async function performUploadOriginal(
    selected: UploadSelection,
  ): Promise<void> {
    const browserClient = getBrowserSupabaseClient();
    if (!browserClient) {
      setError({
        ok: false,
        code: "MEDIA_PROVIDER_NOT_CONFIGURED",
        message: "Secure media storage is not configured in this environment.",
        retryable: true,
      });
      setStage("error");
      return;
    }

    setError(null);
    let current = selected;

    if (current.storagePath && current.uploadAttempted) {
      const confirmation = await confirmOriginal({
        ...current,
        storagePath: current.storagePath,
      });
      if (confirmation !== "missing") return;
    }

    if (!hasUsableUploadToken(current)) {
      current = {
        ...current,
        uploadAttempted: false,
        uploadExpiresAt: undefined,
        uploadToken: undefined,
      };
      setSelection(current);
    }

    if (!current.storagePath || !hasUsableUploadToken(current)) {
      setStage("negotiating");
      const response = await fetch("/api/vendor/media/negotiate", {
        method: "POST",
        credentials: "same-origin",
        headers: mutationHeaders,
        body: JSON.stringify(payloadFor(current)),
      });
      const negotiation = await parseMutationResult(response, (value) =>
        mediaNegotiationSuccessSchema.safeParse(value),
      );

      if (!negotiation.ok) {
        setError(negotiation.error);
        setStage("error");
        return;
      }

      current = {
        ...current,
        storagePath: negotiation.data.storagePath,
        uploadExpiresAt: negotiation.data.expiresAt,
        uploadToken: negotiation.data.uploadToken,
      };
      setSelection(current);
    }

    if (
      !current.storagePath ||
      !current.uploadToken ||
      !hasUsableUploadToken(current)
    ) {
      setError(fallbackError);
      setStage("error");
      return;
    }

    const storagePath = current.storagePath;
    const uploadToken = current.uploadToken;

    setStage("uploading");
    current = { ...current, uploadAttempted: true };
    setSelection(current);

    const upload = await browserClient.storage
      .from(LISTING_MEDIA_BUCKET)
      .uploadToSignedUrl(storagePath, uploadToken, current.file, {
        cacheControl: "3600",
        contentType: current.file.type,
        upsert: false,
        metadata: {
          declaredSize: current.file.size,
          listingId,
          mimeType: current.file.type,
          originalName: sanitizeOriginalFileName(current.file.name),
          uploadId: current.idempotencyKey,
        },
      });

    if (upload.error) {
      const confirmation = await confirmOriginal({
        ...current,
        storagePath,
      });
      if (confirmation !== "missing") return;
      setError({
        ok: false,
        code: "MEDIA_DIRECT_UPLOAD_FAILED",
        message: "The original did not finish uploading. Retry this same file.",
        retryable: true,
      });
      setStage("error");
      return;
    }

    await confirmOriginal({ ...current, storagePath });
  }

  async function removeOriginal(): Promise<void> {
    if (!selection?.storagePath) {
      clearSelection();
      return;
    }

    try {
      setError(null);
      setStage("removing");
      const response = await fetch("/api/vendor/media/remove", {
        method: "DELETE",
        credentials: "same-origin",
        headers: mutationHeaders,
        body: JSON.stringify({
          ...payloadFor(selection),
          storagePath: selection.storagePath,
        }),
      });
      const result = await parseMutationResult(response, (value) =>
        mediaRemovalSuccessSchema.safeParse(value),
      );

      if (!result.ok) {
        setError(result.error);
        setStage("error");
        return;
      }

      clearSelection();
    } catch {
      setError(fallbackError);
      setStage("error");
    }
  }

  return (
    <section
      className={styles.workspace}
      aria-labelledby="media-workspace-title"
    >
      <div className={styles.sectionHeading}>
        <p className={styles.eyebrow}>Original media</p>
        <h2 id="media-workspace-title">
          Attach one original to a draft listing
        </h2>
        <p>
          The browser sends the original directly to a short-lived Supabase
          target. LocalHub confirms the stored size and type before attaching
          metadata. This does not enhance or publish the listing.
        </p>
      </div>

      <div className={styles.field}>
        <label htmlFor="media-listing">Listing</label>
        <select
          disabled={busy}
          id="media-listing"
          onChange={handleListingChange}
          value={listingId}
        >
          {listings.map((listing) => (
            <option key={listing.id} value={listing.id}>
              {listing.title} ({listing.status})
            </option>
          ))}
        </select>
        <small>
          The server derives the business from this listing and re-checks your
          owner or manager access.
        </small>
      </div>

      <div className={styles.picker}>
        <ImagePlus aria-hidden="true" size={34} />
        <div>
          <strong>Choose the original file</strong>
          <p>JPEG, PNG, WebP, MP4, or PDF · maximum 20 MB</p>
        </div>
        <div className={styles.pickerActions}>
          <label className={styles.pickerButton}>
            <UploadCloud aria-hidden="true" size={18} /> Choose file
            <input
              accept={LISTING_MEDIA_ACCEPT}
              className={styles.visuallyHidden}
              disabled={busy}
              id="listing-media-file"
              onChange={handleFileChange}
              type="file"
            />
          </label>
          <label className={styles.cameraButton}>
            <Camera aria-hidden="true" size={18} /> Take photo
            <input
              accept={LISTING_MEDIA_CAMERA_ACCEPT}
              capture="environment"
              className={styles.visuallyHidden}
              disabled={busy}
              id="listing-media-camera"
              onChange={handleFileChange}
              type="file"
            />
          </label>
        </div>
      </div>

      {selection ? (
        <article className={styles.selectionCard}>
          <div className={styles.preview}>
            {previewUrl && selection.file.type.startsWith("image/") ? (
              // The preview is a local object URL and never leaves the browser.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                alt={`Preview of ${sanitizeOriginalFileName(selection.file.name)}`}
                src={previewUrl}
              />
            ) : null}
            {previewUrl && selection.file.type.startsWith("video/") ? (
              <video controls preload="metadata" src={previewUrl}>
                Your browser does not support this video preview.
              </video>
            ) : null}
            {!previewUrl ? <FileText aria-hidden="true" size={48} /> : null}
          </div>
          <div className={styles.selectionDetails}>
            <p className={styles.fileName}>
              {sanitizeOriginalFileName(selection.file.name)}
            </p>
            <p className={styles.fileMeta}>
              {selection.file.type} ·{" "}
              {(selection.file.size / 1_048_576).toFixed(2)} MB
            </p>
            {selection.file.type.startsWith("image/") ? (
              <div className={styles.field}>
                <label htmlFor="media-alt-text">Image description</label>
                <textarea
                  disabled={busy || confirmed}
                  id="media-alt-text"
                  maxLength={500}
                  onChange={(event) => setAltText(event.currentTarget.value)}
                  placeholder="Describe what customers need to understand from the image."
                  rows={3}
                  value={altText}
                />
              </div>
            ) : null}
          </div>
        </article>
      ) : null}

      <div aria-atomic="true" aria-live="polite" className={styles.status}>
        {stage === "negotiating"
          ? "Preparing a protected upload target…"
          : null}
        {stage === "uploading"
          ? "Uploading the original directly to secure storage…"
          : null}
        {stage === "confirming"
          ? "Verifying stored size, type, and listing access…"
          : null}
        {stage === "removing" ? "Removing the exact attached original…" : null}
        {confirmed ? (
          <span className={styles.success}>
            <CheckCircle2 aria-hidden="true" size={18} /> Original confirmed. It
            is attached as draft media, not enhanced or published.
          </span>
        ) : null}
      </div>

      {error ? (
        <div className={styles.error} role="alert">
          <strong>Upload not completed</strong>
          <p>{error.message}</p>
        </div>
      ) : null}

      <div className={styles.actions}>
        <button
          className={styles.primaryButton}
          disabled={!selection || busy || confirmed}
          onClick={() => void uploadOriginal()}
          type="button"
        >
          {stage === "error" ? (
            <RefreshCw aria-hidden="true" size={18} />
          ) : (
            <UploadCloud aria-hidden="true" size={18} />
          )}
          {stage === "error" ? "Retry safely" : "Upload original"}
        </button>
        <button
          className={styles.removeButton}
          disabled={!selection || busy}
          onClick={() => void removeOriginal()}
          type="button"
        >
          <Trash2 aria-hidden="true" size={18} />
          {selection?.storagePath ? "Remove upload" : "Clear selection"}
        </button>
      </div>
    </section>
  );
}

"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";

import type { AdaptiveListingSchema, AleFormValues } from "@/lib/ale/contract";
import { buildAdaptiveListingValueSchema } from "@/lib/ale/validation";
import { DynamicFieldRenderer } from "@/components/vendor/dynamic-field-renderer";

import styles from "@/components/vendor/vendor-onboarding.module.css";

export function AleListingStarter({
  schema,
}: {
  schema: AdaptiveListingSchema;
}) {
  const [checked, setChecked] = useState(false);
  const valueSchema = buildAdaptiveListingValueSchema(schema);
  const {
    formState: { errors, isSubmitting },
    handleSubmit,
    register,
  } = useForm<AleFormValues>({
    resolver: zodResolver(valueSchema),
    shouldUnregister: true,
  });

  return (
    <div id="listing-starter">
      <p>
        This {schema.terminology.singular} form is generated from ALE contract{" "}
        {schema.contractVersion}, schema version {schema.schemaVersion}. It
        validates locally for now and does not publish or upload media.
      </p>
      <form
        className={styles.fields}
        onChange={() => setChecked(false)}
        onSubmit={handleSubmit(
          () => setChecked(true),
          () => setChecked(false),
        )}
      >
        {schema.fields.map((field) => {
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
        <button
          className={styles.secondaryButton}
          disabled={isSubmitting}
          type="submit"
        >
          Check listing details
        </button>
      </form>
      {checked ? (
        <p className={styles.localValidationSuccess} role="status">
          These details match the current {schema.terminology.singular} schema.
          Secure listing persistence is the next integration.
        </p>
      ) : null}
    </div>
  );
}

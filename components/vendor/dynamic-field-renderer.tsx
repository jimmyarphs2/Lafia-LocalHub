"use client";

import type { UseFormRegister } from "react-hook-form";

import type { AleField, AleFormValues } from "@/lib/ale/contract";

import styles from "@/components/vendor/vendor-onboarding.module.css";

type DynamicFieldRendererProps = {
  error?: string;
  field: AleField;
  register: UseFormRegister<AleFormValues>;
};

export function DynamicFieldRenderer({
  error,
  field,
  register,
}: DynamicFieldRendererProps) {
  const errorId = `${field.key}-error`;
  const helpId = `${field.key}-help`;
  const describedBy =
    [field.helpText ? helpId : null, error ? errorId : null]
      .filter(Boolean)
      .join(" ") || undefined;

  if (field.type === "multi_select") {
    return (
      <fieldset
        aria-describedby={describedBy}
        aria-invalid={error ? true : undefined}
        className={styles.fieldGroup}
      >
        <legend>
          {field.label}{" "}
          {field.required ? <span aria-hidden="true">*</span> : null}
        </legend>
        {field.helpText ? (
          <span className={styles.helpText} id={helpId}>
            {field.helpText}
          </span>
        ) : null}
        <div className={styles.choiceGrid}>
          {field.options.map((option) => (
            <label className={styles.choiceOption} key={option.value}>
              <input
                aria-describedby={describedBy}
                aria-invalid={error ? true : undefined}
                type="checkbox"
                value={option.value}
                {...register(field.key)}
              />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
        {error ? (
          <p className={styles.fieldError} id={errorId} role="alert">
            {error}
          </p>
        ) : null}
      </fieldset>
    );
  }

  if (field.type === "boolean") {
    return (
      <div className={styles.field}>
        <label className={styles.checkboxField}>
          <input
            aria-describedby={describedBy}
            aria-invalid={error ? true : undefined}
            type="checkbox"
            {...register(field.key)}
          />
          <span>{field.label}</span>
        </label>
        {field.helpText ? (
          <span className={styles.helpText} id={helpId}>
            {field.helpText}
          </span>
        ) : null}
        {error ? (
          <p className={styles.fieldError} id={errorId} role="alert">
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  const common = {
    "aria-describedby": describedBy,
    "aria-invalid": error ? (true as const) : undefined,
    id: field.key,
    ...register(field.key),
  };

  return (
    <div className={styles.field}>
      <label htmlFor={field.key}>
        {field.label}{" "}
        {field.required ? <span aria-hidden="true">*</span> : null}
      </label>
      {field.helpText ? (
        <span className={styles.helpText} id={helpId}>
          {field.helpText}
        </span>
      ) : null}

      {field.type === "long_text" ? (
        <textarea
          {...common}
          maxLength={field.maxLength}
          minLength={field.minLength}
          required={field.required}
          rows={5}
        />
      ) : field.type === "select" ? (
        <select {...common} required={field.required} defaultValue="">
          <option value="">Choose one</option>
          {field.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ) : field.type === "short_text" || field.type === "location" ? (
        <input
          {...common}
          maxLength={field.maxLength}
          minLength={field.minLength}
          placeholder={field.placeholder}
          required={field.required}
          type="text"
        />
      ) : (
        <input
          {...common}
          inputMode={
            field.type === "number" || field.type === "duration"
              ? "numeric"
              : "decimal"
          }
          max={"max" in field ? field.max : undefined}
          min={"min" in field ? field.min : undefined}
          required={field.required}
          step={"step" in field ? field.step : undefined}
          type={
            field.type === "date"
              ? "date"
              : field.type === "time"
                ? "time"
                : "number"
          }
        />
      )}

      {error ? (
        <p className={styles.fieldError} id={errorId} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

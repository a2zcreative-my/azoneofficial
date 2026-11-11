"use client";

/* v1.276.0 - A2Z OS 3.0: ONE FORM FIELD (approved 1 Nov in the 4.0 plan,
   built now). The label, the required mark, the hint and the error, each
   tied to the control by id - a screen reader hears the hint and the error
   with the field, and the error is words under the field, never a colour
   alone. The control is the caller's (an erp-input, a select, a date): the
   field hands it the ids to spread. */

import { useId, type ReactNode } from "react";
import css from "./ui3.module.css";

export interface FieldControlProps {
  id: string;
  "aria-describedby"?: string;
  "aria-invalid"?: true;
  "aria-required"?: true;
}

export function FormField({ label, hint, error, required = false, children }: {
  label: ReactNode;
  hint?: ReactNode;
  /** the server's or the form's message - shown under the field */
  error?: ReactNode;
  required?: boolean;
  children: (control: FieldControlProps) => ReactNode;
}) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errId = error ? `${id}-err` : undefined;
  const described = [hintId, errId].filter(Boolean).join(" ") || undefined;
  return (
    <div className={css.field}>
      <label htmlFor={id} className={css.label}>
        {label}{required ? <span className={css.required} aria-hidden>*</span> : null}
      </label>
      {children({ id, "aria-describedby": described, ...(error ? { "aria-invalid": true as const } : {}), ...(required ? { "aria-required": true as const } : {}) })}
      {hint ? <span id={hintId} className={css.hint}>{hint}</span> : null}
      {error ? <span id={errId} className={css.error} role="alert">{error}</span> : null}
    </div>
  );
}

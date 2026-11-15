"use client";

/* v1.318.0 - THE COMPANY'S OWN LOGO, ONE WAY (the CEO, 15-11-2026: "A2Z OS
   change to my own logo. make it standardize").

   The reference picture for the clock-in confirmation carried a drawn gold
   "A" beside the words "A2Z OS". The company has a logo of its own
   (public/logo.png, the mark the side rail and the public site already
   show), so that is what is drawn - on a white tile, the way the rail draws
   it, so it reads the same in the light and the dark theme. One component,
   so every dialog that names the company shows the same mark at the same
   size. */

import css from "./brand-logo.module.css";

export function BrandLogo({ label }: {
  /** the module the dialog belongs to, beside the mark (e.g. "Attendance") */
  label?: string;
}) {
  return (
    <span className={css.brand} data-testid="brand-logo">
      {/* eslint-disable-next-line @next/next/no-img-element -- a static export: next/image has no optimiser to call */}
      <img src="/logo.png" alt="A2Z Creative Marketing" className="erp-brand-logo" width={991} height={547} />
      {label && <span className={css.label}>{label}</span>}
    </span>
  );
}

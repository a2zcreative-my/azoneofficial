"use client";

/* v1.276.0 - A2Z OS 3.0: ONE SWITCH (approved 1 Nov in the 4.0 plan, built
   now). A real switch (role=switch, aria-checked), its words beside it, a
   44px target on a phone, the colour change backed by the On / Off word for
   anyone who cannot see it. It only reports the press - the caller saves. */

import type { ReactNode } from "react";
import { getLang } from "@/lib/i18n";
import css from "./ui3.module.css";

const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);

export function Switch({ checked, onChange, label, disabled = false, showState = true }: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: ReactNode;
  disabled?: boolean;
  /** say On / Off beside the label (default) */
  showState?: boolean;
}) {
  return (
    <button type="button" role="switch" aria-checked={checked} disabled={disabled}
      className={css.switch} onClick={() => onChange(!checked)}>
      <span className={css.track} aria-hidden><span className={css.thumb} /></span>
      <span>{label}{showState ? <> · {checked ? L("On", "Hidup") : L("Off", "Mati")}</> : null}</span>
    </button>
  );
}

"use client";

/**
 * v1.181.16 - ACCEPT ON THE SHARED LINK (ERP roadmap, phase 4).
 *
 * Under a shared quotation, the customer can accept it with their name and
 * position. The server records who accepted which revision, when and from
 * where - nothing else. No status moves, nothing is sent, nothing is paid:
 * the team sees the acceptance on the quotation and takes it from there.
 * A revised quotation needs accepting again, because it is a different
 * offer. Paper colours only (--doc-*), like the page around it.
 */

import { useState } from "react";

import { csrfFetch } from "@/lib/api";

import css from "./doc-accept.module.css";

export interface Acceptance { accepted_name: string; accepted_position: string | null; accepted_at: string }

const when = (s: string) => {
  const t = new Date(s.replace(" ", "T") + (s.endsWith("Z") ? "" : "Z"));
  return Number.isNaN(t.getTime()) ? s : t.toLocaleString("en-MY", { timeZone: "Asia/Kuala_Lumpur", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
};

export function DocAccept({ token, label, initial }: { token: string; label: string; initial: Acceptance | null }) {
  const [done, setDone] = useState<Acceptance | null>(initial);
  const [name, setName] = useState("");
  const [position, setPosition] = useState("");
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (done) {
    return (
      <section className={css.card} aria-live="polite">
        <p className={css.title}>Accepted</p>
        <p className={css.text}>
          {label} was accepted by <strong>{done.accepted_name}</strong>{done.accepted_position ? `, ${done.accepted_position}` : ""} on {when(done.accepted_at)}.
          Thank you - we will be in touch about the next step.
        </p>
      </section>
    );
  }

  const submit = async () => {
    setError("");
    if (name.trim().length < 2) { setError("Please type your name."); return; }
    if (!agree) { setError("Please tick the box to accept."); return; }
    setBusy(true);
    try {
      const res = await csrfFetch(`/api/v1/public/doc/${token}/accept`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), position: position.trim() || undefined, agree: true }),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; accepted_name?: string; accepted_at?: string; error?: { message?: string } } | null;
      if (!res.ok || !data?.ok) { setError(data?.error?.message ?? "Not sent - please try again."); return; }
      setDone({ accepted_name: data.accepted_name ?? name.trim(), accepted_position: data.accepted_name ? null : position.trim() || null, accepted_at: data.accepted_at ?? new Date().toISOString() });
    } catch {
      setError("Not sent - check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={css.card} aria-labelledby="accept-title">
      <p id="accept-title" className={css.title}>Accept this quotation</p>
      <p className={css.text}>If you are happy with {label} as shown above, accept it here. This records your acceptance only - it is not a payment.</p>
      <div className={css.fields}>
        <label className={css.field}>Your name
          <input className={css.input} value={name} maxLength={120} autoComplete="name" onChange={(e) => setName(e.target.value)} />
        </label>
        <label className={css.field}>Position (optional)
          <input className={css.input} value={position} maxLength={120} autoComplete="organization-title" onChange={(e) => setPosition(e.target.value)} />
        </label>
      </div>
      <label className={css.check}>
        <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
        I accept {label} on behalf of my company.
      </label>
      {error && <p className={css.error} role="alert">{error}</p>}
      <button type="button" className={css.button} disabled={busy} onClick={() => void submit()}>{busy ? "Sending..." : "Accept quotation"}</button>
    </section>
  );
}

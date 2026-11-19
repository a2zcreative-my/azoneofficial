"use client";

/* Website restructure (18-11-2026, unreleased) - THE MINIMAL ENQUIRY FORM (homepage section E and every service
   page). It posts to the EXISTING public intake, POST /api/v1/enquiries -
   the same row the Contact page writes, which A2Z OS already shows the
   business team under Sales -> Customers & Follow-ups and announces the
   moment it lands. No second CRM, no new route, nothing of A2Z OS exposed.

   Four fields: name, phone, service, message. The service and the page it
   was sent from travel at the top of the message ("[Service: ...] [Page:
   ...]") so the team sees the source without a schema change; the email
   field stays empty (the intake's column is optional).

   Duplicates: the same enquiry from this browser within 24 hours is not
   sent twice (a fingerprint in localStorage), the button locks while
   sending, and the server's own per-address rate limit still applies. A
   hidden field catches simple bots. Privacy: the line under the form says
   what the details are for and links the Privacy Policy. */

import { useState } from "react";
import Link from "next/link";

import { HOME_COPY } from "@/constants/home-copy";
import { SERVICE_PAGES, serviceWhatsApp, type Lang, type ServiceKey } from "@/constants/services";
import { csrfFetch } from "@/lib/api";

import css from "./landing.module.css";

type Status = "idle" | "sending" | "sent" | "already" | "error";

const KEY = "a2z-enquiry-sent";
const DAY = 24 * 60 * 60 * 1000;

function fingerprint(parts: string[]): string {
  /* a short, stable hash - this is a duplicate check, not security */
  let h = 5381;
  for (const ch of parts.join("|").toLowerCase().replace(/\s+/g, " ")) h = ((h << 5) + h + ch.charCodeAt(0)) | 0;
  return String(h >>> 0);
}

function seen(fp: string): boolean {
  try {
    const all = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, number>;
    return typeof all[fp] === "number" && Date.now() - all[fp] < DAY;
  } catch {
    return false;
  }
}

function remember(fp: string) {
  try {
    const all = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, number>;
    for (const [k, at] of Object.entries(all)) if (Date.now() - at > DAY) delete all[k];
    all[fp] = Date.now();
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* private mode - the server's rate limit still applies */
  }
}

export function EnquiryForm({ lang, service }: { lang: Lang; service?: ServiceKey }) {
  const t = HOME_COPY[lang].form;
  const [status, setStatus] = useState<Status>("idle");
  const [form, setForm] = useState({ name: "", phone: "", service: service ?? "", message: "", website: "" });

  const picked = SERVICE_PAGES.find((s) => s.key === form.service) ?? null;
  const ready = form.name.trim().length > 1 && form.phone.replace(/\D/g, "").length >= 7 && form.message.trim().length > 2;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready || status === "sending") return;
    if (form.website) { setStatus("sent"); return; } // the bot field: say thanks, send nothing
    const serviceName = picked ? picked.en.name : "Not sure yet";
    const fp = fingerprint([form.name, form.phone.replace(/\D/g, ""), serviceName, form.message]);
    if (seen(fp)) { setStatus("already"); return; }
    setStatus("sending");
    const path = window.location.pathname;
    try {
      const res = await csrfFetch("/api/v1/enquiries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim().slice(0, 120),
          phone: form.phone.trim().slice(0, 40),
          message: `[Service: ${serviceName}] [Page: ${path}] [Lang: ${lang.toUpperCase()}]\n\n${form.message.trim()}`.slice(0, 4000),
        }),
      });
      if (res.ok) { remember(fp); setStatus("sent"); }
      else setStatus("error");
    } catch {
      setStatus("error");
    }
  };

  if (status === "sent" || status === "already") {
    return (
      <div className={css.form} role="status">
        <h3 className={css.formTitle}>{t.title}</h3>
        <p className={css.notice}>{status === "sent" ? t.sent : t.already}</p>
      </div>
    );
  }

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <form className={css.form} onSubmit={submit} noValidate aria-labelledby="enquiry-title">
      <h3 id="enquiry-title" className={css.formTitle}>{t.title}</h3>
      <p className={css.formLede}>{t.messageHint}</p>
      <div className={css.fields}>
        <label className={css.field}>
          <span className={css.label}>{t.name} <span className={css.req}>({t.required})</span></span>
          <input className={css.input} value={form.name} onChange={set("name")} autoComplete="name" maxLength={120} required />
        </label>
        <label className={css.field}>
          <span className={css.label}>{t.phone} <span className={css.req}>({t.required})</span></span>
          <input className={css.input} value={form.phone} onChange={set("phone")} autoComplete="tel" inputMode="tel" maxLength={40} required />
        </label>
        <label className={`${css.field} ${css.full}`}>
          <span className={css.label}>{t.service}</span>
          <select className={css.input} value={form.service} onChange={set("service")}>
            <option value="">{t.serviceAny}</option>
            {SERVICE_PAGES.map((s) => <option key={s.key} value={s.key}>{s[lang].name}</option>)}
          </select>
        </label>
        <label className={`${css.field} ${css.full}`}>
          <span className={css.label}>{t.message} <span className={css.req}>({t.required})</span></span>
          <textarea className={css.input} value={form.message} onChange={set("message")} maxLength={3800} required aria-describedby="enquiry-hint" />
          <span id="enquiry-hint" className={css.hint}>{t.messageHint}</span>
        </label>
        <label className={css.trap} aria-hidden="true">
          Website
          <input tabIndex={-1} autoComplete="off" value={form.website} onChange={set("website")} />
        </label>
      </div>
      <div className={css.formFoot}>
        <p className={css.privacy}>
          {t.privacy} <Link href="/privacy">{t.privacyLink}</Link>
        </p>
        <button type="submit" className={css.btnNavy} disabled={!ready || status === "sending"}>
          {status === "sending" ? t.sending : t.send}
        </button>
        {status === "error" && (
          <p className={css.error} role="alert">
            {t.error}{" "}
            <a href={serviceWhatsApp(picked, lang)} target="_blank" rel="noopener noreferrer">{t.errorWa}</a>.
          </p>
        )}
      </div>
    </form>
  );
}

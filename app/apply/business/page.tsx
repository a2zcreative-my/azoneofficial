"use client";

/* v1.369.0 - THE A2Z BUSINESS GROWTH CHECK (the CEO, 18-11-2026; his three
   step pictures are the layout, the Partner Interest Application at
   /apply/partner is the style - this page wears the same stylesheet).

     1 Business & Contact     who they are, the business, where they found us
     2 Challenges & Goals     up to three challenges, the most urgent problem,
                              the 90-day goal, the platforms in use, optional interests
     3 Contact & Consent      how and when to reach them, two separate required
                              consents and one optional marketing consent (unticked)

   One step at a time; Back and Continue keep every answer (and a reload keeps
   them for this browser tab). The server checks every answer again
   (worker/src/growth.ts), asks Cloudflare's bot check, saves ONE enquiry with a
   reference (or adds the answers to the person's open enquiry), tells the Sales
   team - and creates NO account and no sale. There is no budget question and
   nothing to buy: the first review is free, and a paid service, if the
   entrepreneur wants one, needs its own quotation and acceptance. The campaign's
   utm_* parameters are kept separately from the source the person chooses. */

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { AtSign, CalendarDays, Ellipsis, Facebook, House, Instagram, Linkedin, MessageCircle, Music2, UserRound, Mail, ArrowRight, ArrowLeft, Check, ChevronDown, User, Store, MapPin, Globe } from "lucide-react";
import { api } from "@/lib/api";
import { getLang, setLang, type Lang } from "@/lib/i18n";
import { useBotCheck } from "@/components/security/bot-check";
import { CompanyFooter } from "@/components/public/company-footer"; // v1.381.0 - who is behind this form
import { GROWTH_CHALLENGES, GROWTH_INDUSTRIES, GROWTH_INTERESTS, GROWTH_METHODS, GROWTH_PLATFORMS, GROWTH_STATES, GROWTH_TIMES, type Bi } from "@/lib/growth-words";
import css from "../partner/partner.module.css";
import bx from "./business.module.css";

type Step = 1 | 2 | 3;
interface Form {
  full_name: string; dial: string; phone: string; email: string; business_name: string; industry: string; industry_other: string; city: string; state: string; social_url: string;
  source: string; source_detail: string;
  challenges: string[]; challenge_other: string; urgent_problem: string; goal_90d: string; platforms: string[]; interests: string[];
  contact_method: string; contact_time: string; consent_contact: boolean; consent_privacy: boolean; consent_marketing: boolean;
}
const EMPTY: Form = {
  full_name: "", dial: "+60", phone: "", email: "", business_name: "", industry: "", industry_other: "", city: "", state: "", social_url: "", source: "", source_detail: "",
  challenges: [], challenge_other: "", urgent_problem: "", goal_90d: "", platforms: [], interests: [],
  contact_method: "whatsapp", contact_time: "", consent_contact: false, consent_privacy: false, consent_marketing: false,
};
const MAX_CHALLENGES = 3;
const DIALS = ["+60", "+65", "+62", "+66", "+673"];
const SOURCES: { k: string; label: Bi; icon: ReactNode }[] = [
  { k: "facebook", label: ["Facebook", "Facebook"], icon: <Facebook aria-hidden /> },
  { k: "instagram", label: ["Instagram", "Instagram"], icon: <Instagram aria-hidden /> },
  { k: "tiktok", label: ["TikTok", "TikTok"], icon: <Music2 aria-hidden /> },
  { k: "threads", label: ["Threads", "Threads"], icon: <AtSign aria-hidden /> },
  { k: "x", label: ["X", "X"], icon: <span className={css.glyph} aria-hidden>X</span> },
  { k: "linkedin", label: ["LinkedIn", "LinkedIn"], icon: <Linkedin aria-hidden /> },
  { k: "whatsapp", label: ["WhatsApp", "WhatsApp"], icon: <MessageCircle aria-hidden /> },
  { k: "google", label: ["Google", "Google"], icon: <span className={css.glyph} aria-hidden>G</span> },
  { k: "website", label: ["Website", "Laman web"], icon: <House aria-hidden /> },
  { k: "referral", label: ["Referral", "Rujukan"], icon: <UserRound aria-hidden /> },
  { k: "event", label: ["Event", "Acara"], icon: <CalendarDays aria-hidden /> },
  { k: "other", label: ["Other", "Lain-lain"], icon: <Ellipsis aria-hidden /> },
];
const STEPS: Bi[] = [["Business & Contact", "Bisnes & Hubungan"], ["Challenges & Goals", "Cabaran & Matlamat"], ["Contact & Consent", "Hubungan & Persetujuan"]];
const UTM_KEYS = ["source", "medium", "campaign", "term", "content"] as const;
const STORE = "a2z-business-growth-check";
const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`);

type Errors = Partial<Record<keyof Form | "form", string>>;
function check(step: Step, f: Form, L: (en: string, ms: string) => string): Errors {
  const e: Errors = {};
  const need = L("Required", "Diperlukan");
  if (step === 1) {
    if (f.full_name.trim().length < 2) e.full_name = L("Enter your name", "Masukkan nama anda");
    if (!/^\d{7,12}$/.test(f.phone.replace(/\D/g, "").replace(/^0+/, ""))) e.phone = L("Enter a valid WhatsApp number", "Masukkan nombor WhatsApp yang sah");
    if (f.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(f.email.trim())) e.email = L("Enter a valid email address, or leave it empty", "Masukkan alamat e-mel yang sah, atau biarkan kosong");
    if (f.business_name.trim().length < 2) e.business_name = L("Enter your business or brand name", "Masukkan nama bisnes atau jenama anda");
    if (!f.industry) e.industry = need;
    if (f.city.trim().length < 2) e.city = L("Enter your city", "Masukkan bandar anda");
    if (!f.state) e.state = need;
    if (!f.source) e.source = L("Choose where you heard about us", "Pilih di mana anda mengetahui tentang kami");
  }
  if (step === 2) {
    if (!f.challenges.length) e.challenges = L("Choose at least one challenge", "Pilih sekurang-kurangnya satu cabaran");
    if (f.urgent_problem.trim().replace(/\s+/g, " ").length < 10) e.urgent_problem = L("Tell us a little more (at least 10 characters)", "Terangkan sedikit lagi (sekurang-kurangnya 10 aksara)");
    if (f.goal_90d.trim().replace(/\s+/g, " ").length < 10) e.goal_90d = L("Tell us a little more (at least 10 characters)", "Terangkan sedikit lagi (sekurang-kurangnya 10 aksara)");
    if (!f.platforms.length) e.platforms = L("Choose at least one, or None yet", "Pilih sekurang-kurangnya satu, atau Belum ada");
  }
  if (step === 3) {
    if (!f.contact_method) e.contact_method = need;
    if (f.contact_method === "email" && !f.email.trim()) e.contact_method = L("Add your email in step 1 to be contacted by email", "Tambah e-mel anda dalam langkah 1 untuk dihubungi melalui e-mel");
    if (!f.contact_time) e.contact_time = need;
    if (!f.consent_contact) e.consent_contact = L("Please confirm to continue", "Sila sahkan untuk meneruskan");
    if (!f.consent_privacy) e.consent_privacy = L("Please confirm to continue", "Sila sahkan untuk meneruskan");
  }
  return e;
}
/* the server's field names -> the step that asks them */
const STEP_OF: Record<string, Step> = {
  full_name: 1, phone: 1, email: 1, business_name: 1, industry: 1, city: 1, state: 1, source: 1,
  challenges: 2, urgent_problem: 2, goal_90d: 2, platforms: 2,
  contact_method: 3, contact_time: 3, consent_contact: 3, consent_privacy: 3,
};

/* One press, one POST: the server keeps one record per client_key. Sent without the sign-in cookie. */
function sendCheck(body: Record<string, unknown>) {
  return api<{ ok?: boolean; ref?: string; existing?: boolean; error?: { code?: string; message?: string; fields?: Record<string, string> } }>("/public/business-growth", {
    method: "POST", body: JSON.stringify(body), credentials: "omit",
  });
}

/* The Cloudflare site key, when the check is on; the form never waits for it */
function useBotSiteKey(): string | null {
  const [key, setKey] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void api<{ bot_check?: { site_key: string } | null }>("/auth/methods").then((r) => { if (live && r.ok && r.data?.bot_check?.site_key) setKey(r.data.bot_check.site_key); });
    return () => { live = false; };
  }, []);
  return key;
}

export default function BusinessGrowthCheckPage() {
  const [lang, setLangState] = useState<Lang>("ms");
  const [step, setStep] = useState<Step>(1);
  const [f, setF] = useState<Form>(EMPTY);
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ ref: string; existing: boolean } | null>(null);
  const siteKey = useBotSiteKey();
  const keyRef = useRef("");
  const utmRef = useRef<Record<string, string>>({});
  const refRef = useRef<{ referrer: string; landing_path: string }>({ referrer: "", landing_path: "" });
  const cardRef = useRef<HTMLElement | null>(null);
  const loaded = useRef(false);
  const L = (en: string, ms: string) => (lang === "ms" ? ms : en);
  const bot = useBotCheck(siteKey, "growth_check");

  /* the reader's language (Bahasa Malaysia first unless they chose English), the campaign, this tab's answers */
  useEffect(() => {
    const saved = (() => { try { return window.localStorage.getItem("azone-lang"); } catch { return null; } })();
    setLangState(saved ? getLang() : "ms");
    const q = new URLSearchParams(window.location.search);
    const utm: Record<string, string> = {};
    for (const k of UTM_KEYS) { const v = q.get(`utm_${k}`); if (v) utm[k] = v.slice(0, 120); }
    refRef.current = { referrer: (document.referrer || "").slice(0, 300), landing_path: `${window.location.pathname}${window.location.search}`.slice(0, 300) };
    try {
      const s = JSON.parse(window.sessionStorage.getItem(STORE) ?? "null") as { f?: Form; step?: Step; key?: string; utm?: Record<string, string>; ref?: { referrer: string; landing_path: string } } | null;
      if (s?.f) setF({ ...EMPTY, ...s.f });
      if (s?.step) setStep(s.step);
      keyRef.current = s?.key ?? newKey();
      utmRef.current = Object.keys(utm).length ? utm : s?.utm ?? {};
      if (s?.ref && !Object.keys(utm).length) refRef.current = s.ref;
    } catch { keyRef.current = newKey(); utmRef.current = utm; }
    loaded.current = true;
  }, []);
  useEffect(() => {
    if (!loaded.current || done) return;
    try { window.sessionStorage.setItem(STORE, JSON.stringify({ f, step, key: keyRef.current, utm: utmRef.current, ref: refRef.current })); } catch { /* private mode: the answers live in this page */ }
  }, [f, step, done]);

  const pickLang = (l: Lang) => { setLang(l); setLangState(l); if (Object.keys(errors).length) setErrors(check(step, f, l === "ms" ? (_e, m) => m : (e) => e)); };
  const set = <K extends keyof Form>(k: K, v: Form[K]) => { setF((x) => ({ ...x, [k]: v })); if (errors[k]) setErrors((e) => { const n = { ...e }; delete n[k]; return n; }); };
  const toggle = (k: "challenges" | "platforms" | "interests", v: string) => {
    const cur = f[k];
    if (cur.includes(v)) { set(k, cur.filter((x) => x !== v)); return; }
    if (k === "challenges" && cur.length >= MAX_CHALLENGES) return; // three at most - the chips say so
    if (k === "platforms") { set(k, v === "none" ? ["none"] : [...cur.filter((x) => x !== "none"), v]); return; }
    set(k, [...cur, v]);
  };
  const top = () => cardRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  const focusFirst = (e: Errors) => window.setTimeout(() => {
    const first = Object.keys(e)[0];
    const el = first ? document.querySelector<HTMLElement>(`[data-field="${first}"] input, [data-field="${first}"] select, [data-field="${first}"] textarea, [data-field="${first}"] button`) : null;
    el?.focus({ preventScroll: false });
  }, 30);

  const next = () => {
    const e = check(step, f, L);
    setErrors(e);
    if (Object.keys(e).length) { focusFirst(e); return; }
    setStep((s) => (s < 3 ? (s + 1) as Step : s)); top();
  };
  const back = () => { setErrors({}); setStep((s) => (s > 1 ? (s - 1) as Step : s)); top(); };
  const submit = async () => {
    const e = check(3, f, L);
    setErrors(e);
    if (Object.keys(e).length) { focusFirst(e); return; }
    setBusy(true);
    const r = await sendCheck({
      ...f, client_key: keyRef.current, utm: utmRef.current, ...refRef.current, lang, bot_token: bot.token ?? undefined,
      source_detail: ["referral", "other"].includes(f.source) ? f.source_detail : "",
      industry_other: f.industry === "other" ? f.industry_other : "", challenge_other: f.challenges.includes("other") ? f.challenge_other : "",
    });
    setBusy(false);
    bot.spend();
    if (r.ok && r.data?.ref) {
      setDone({ ref: r.data.ref, existing: !!r.data.existing });
      try { window.sessionStorage.removeItem(STORE); } catch { /* nothing kept */ }
      top();
      return;
    }
    const fields = r.data?.error?.fields;
    if (fields && Object.keys(fields).length) {
      const first = Object.keys(fields).map((k) => STEP_OF[k] ?? 3).sort()[0] ?? 3;
      const all = check(first, f, L);
      setStep(first);
      setErrors(Object.keys(all).length ? all : { form: L("Some answers need checking.", "Sesetengah jawapan perlu disemak.") });
      top();
      return;
    }
    setErrors({ form: r.status === 429 ? L("Too many submissions from this connection - please try again later.", "Terlalu banyak penghantaran dari sambungan ini - sila cuba lagi kemudian.")
      : r.data?.error?.code?.startsWith("bot_check") ? L("Please complete the security check and press Submit again.", "Sila lengkapkan semakan keselamatan dan tekan Hantar semula.")
        : r.data?.error?.message ?? L("Your form could not be sent - please check your connection and try again.", "Borang anda tidak dapat dihantar - sila semak sambungan anda dan cuba lagi.") });
  };

  const req = <span className={css.req} aria-hidden>*</span>;
  const opt = <span className={bx.opt}>{L("(optional)", "(pilihan)")}</span>;
  const err = (k: keyof Form) => errors[k] ? <p className={css.err} role="alert" id={`err-${k}`}>{errors[k]}</p> : null;
  const label = (en: string, ms: string, required: boolean | "opt" = false, htmlFor?: string) => <label className={css.label} htmlFor={htmlFor}>{L(en, ms)}{required === true && <> {req}</>}{required === "opt" && <> {opt}</>}</label>;
  const select = (k: keyof Form, opts: [string, Bi][], placeholder: Bi | null, id: string) => (
    <span className={css.selectWrap}>
      <select id={id} className={css.select} value={String(f[k])} onChange={(e) => set(k, e.target.value as never)} aria-invalid={!!errors[k]} aria-describedby={errors[k] ? `err-${k}` : undefined} data-testid={`bg-${k}`}>
        {placeholder && <option value="">{L(placeholder[0], placeholder[1])}</option>}
        {opts.map(([v, w]) => <option key={v} value={v}>{L(w[0], w[1])}</option>)}
      </select>
      <ChevronDown className={css.chev} aria-hidden />
    </span>
  );
  const chips = (k: "challenges" | "platforms" | "interests" | "contact_method" | "contact_time", opts: [string, Bi][], multi: boolean) => (
    <div className={css.chips} role="group" data-invalid={errors[k] ? "" : undefined}>
      {opts.map(([v, w]) => {
        const on = multi ? (f[k] as string[]).includes(v) : f[k] === v;
        const full = k === "challenges" && !on && f.challenges.length >= MAX_CHALLENGES;
        return (
          <button key={v} type="button" className={`${css.chip} ${full ? bx.full : ""}`} aria-pressed={on} disabled={full} data-testid={`bg-${k}-${v}`}
            onClick={() => (multi ? toggle(k as "challenges" | "platforms" | "interests", v) : set(k, v as never))}>{L(w[0], w[1])}</button>
        );
      })}
    </div>
  );
  const tick = (k: "consent_contact" | "consent_privacy" | "consent_marketing", content: ReactNode) => (
    <div data-field={k}>
      <label className={css.tick}>
        <input type="checkbox" checked={f[k]} onChange={(e) => set(k, e.target.checked)} aria-invalid={!!errors[k]} data-testid={`bg-${k}`} />
        <span className={css.box} aria-hidden><Check /></span>
        <span>{content}</span>
      </label>
      {err(k)}
    </div>
  );

  const stepper = (
    <ol className={css.stepper} aria-label={L("Form steps", "Langkah borang")} data-testid="bg-stepper">
      {STEPS.map((w, i) => {
        const n = (i + 1) as Step;
        const state = done || n < step ? "done" : n === step ? "on" : "todo";
        return (
          <li key={n} className={css.stepItem} data-state={state} aria-current={state === "on" ? "step" : undefined}>
            <span className={css.stepNo} aria-hidden>{state === "done" ? <Check /> : n}</span>
            <span className={css.stepWord}>{L(w[0], w[1])}</span>
          </li>
        );
      })}
    </ol>
  );
  const freeNote = <p className={css.screening}>{L("Free first review · No budget question · No obligation to buy", "Semakan awal percuma · Tiada soalan bajet · Tiada kewajipan membeli")}</p>;
  const cardHead = (t: Bi, sub: Bi) => (
    <div className={css.cardHead}>
      <div><h2 className={css.cardTitle}>{L(t[0], t[1])}</h2><p className={css.cardSub}>{L(sub[0], sub[1])}</p></div>
      {freeNote}
    </div>
  );
  const foot = (
    <div className={css.foot}>
      <p className={css.footNote}>{L(`Step ${step} of 3 · Your answers are read by authorised A2Z staff only.`, `Langkah ${step} daripada 3 · Jawapan anda dibaca oleh kakitangan A2Z yang diberi kuasa sahaja.`)}</p>
      <div className={css.footBtns}>
        {step > 1 && <button type="button" className={css.backBtn} onClick={back} data-testid="bg-back"><ArrowLeft aria-hidden />{L("Back", "Kembali")}</button>}
        {step < 3
          ? <button type="button" className={css.goBtn} onClick={next} data-testid="bg-continue">{L("Continue", "Teruskan")}<ArrowRight aria-hidden /></button>
          : <button type="button" className={css.goBtn} onClick={() => void submit()} disabled={busy || !bot.canSend} data-testid="bg-submit">{busy ? L("Sending…", "Menghantar…") : L("Submit for a Free Review", "Hantar untuk Semakan Percuma")}<ArrowRight aria-hidden /></button>}
      </div>
    </div>
  );

  return (
    <div className={css.page} data-testid="business-growth-check">
      <header className={css.top}>
        <div className={css.topIn}>
          <Link href="/" className={css.wordmark} aria-label="A2Z OS - A2Z Creative Marketing">
            <span className={css.wordName}>A2Z<span className={css.wordOs}>OS</span></span>
            <span className={css.wordSub}>A2Z CREATIVE MARKETING</span>
          </Link>
          <div className={css.lang} role="group" aria-label="Language / Bahasa">
            <button type="button" aria-pressed={lang === "en"} onClick={() => pickLang("en")} data-testid="bg-lang-en">EN</button>
            <button type="button" aria-pressed={lang === "ms"} onClick={() => pickLang("ms")} data-testid="bg-lang-ms">BM</button>
          </div>
        </div>
      </header>

      <main className={css.main}>
        <section className={css.hero} aria-labelledby="bg-title">
          <svg className={css.arc} viewBox="0 0 400 200" preserveAspectRatio="none" aria-hidden><path d="M120 -10 C 150 80, 230 150, 330 210" /></svg>
          <div className={css.heroText}>
            <p className={css.eyebrow}>A2Z Business Growth Check</p>
            <h1 id="bg-title" className={css.title}>{L("Identify Your Business Challenges — A FREE First Review", "Kenal Pasti Cabaran Bisnes Anda — Semakan Awal PERCUMA")}</h1>
            <p className={css.lead}>{L("Tell us about your business, the challenges you face and your goal for the next 90 days. Our team will review it and contact you with free first suggestions.", "Beritahu kami tentang bisnes anda, cabaran yang dihadapi dan matlamat 90 hari akan datang. Pasukan kami akan menyemaknya dan menghubungi anda dengan cadangan awal secara percuma.")}</p>
          </div>
          <div className={css.badge}>
            <strong>{L("Free first review", "Semakan awal percuma")}</strong>
            <span>{L("No obligation to buy", "Tiada kewajipan membeli")}</span>
          </div>
        </section>

        {stepper}

        <section className={css.card} ref={cardRef} aria-live="polite">
          {done ? (
            <div className={css.done} data-testid="bg-done">
              <span className={css.doneIcon} aria-hidden><Check /></span>
              <h2 className={css.cardTitle}>{done.existing ? L("We already have your Business Growth Check", "Kami sudah menerima Semakan Pertumbuhan Bisnes anda") : L("Thank you - your Business Growth Check is received", "Terima kasih - Semakan Pertumbuhan Bisnes anda diterima")}</h2>
              <p className={css.cardSub}>{L("Your reference", "Rujukan anda")}</p>
              <p className={css.ref} data-testid="bg-ref">{done.ref}</p>
              <p className={css.doneText}>{done.existing
                ? L("Your new answers were added to the review we already have, so the same person continues with you.", "Jawapan baharu anda ditambah kepada semakan yang sedia ada, supaya orang yang sama meneruskan bersama anda.")
                : L("An A2Z team member will review your answers and contact you at the time you chose. Keep this reference for any follow-up.", "Ahli pasukan A2Z akan menyemak jawapan anda dan menghubungi anda pada masa yang anda pilih. Simpan rujukan ini untuk sebarang susulan.")}</p>
              <p className={css.info}>{L("The first review is free. Any paid service is optional and needs a separate quotation that you accept. Submitting this form does not create an account.", "Semakan awal adalah percuma. Sebarang perkhidmatan berbayar adalah pilihan dan memerlukan sebut harga berasingan yang anda terima. Menghantar borang ini tidak membuat akaun.")}</p>
            </div>
          ) : step === 1 ? (
            <div data-testid="bg-step-1">
              {cardHead(["Business & Contact", "Bisnes & Hubungan"], ["Tell us who you are, about your business and where you found us.", "Beritahu kami siapa anda, tentang bisnes anda dan di mana anda menemui kami."])}
              <div className={css.two}>
                <div className={css.field} data-field="full_name">
                  {label("Your name", "Nama anda", true, "bg-name")}
                  <span className={css.inputIcon}><User aria-hidden /><input id="bg-name" className={css.input} value={f.full_name} onChange={(e) => set("full_name", e.target.value)} placeholder={L("Your full name", "Nama penuh anda")} autoComplete="name" maxLength={120} aria-invalid={!!errors.full_name} data-testid="bg-full_name" /></span>
                  {err("full_name")}
                </div>
                <div className={css.field} data-field="phone">
                  {label("WhatsApp number", "Nombor WhatsApp", true, "bg-phone")}
                  <span className={css.phone}>
                    <span className={css.phoneIcon} aria-hidden><MessageCircle /></span>
                    <span className={css.dialWrap}>
                      <select className={css.dial} value={f.dial} onChange={(e) => set("dial", e.target.value)} aria-label={L("Country code", "Kod negara")} data-testid="bg-dial">{DIALS.map((d) => <option key={d} value={d}>{d}</option>)}</select>
                      <ChevronDown className={css.chevSm} aria-hidden />
                    </span>
                    <input id="bg-phone" className={css.phoneInput} inputMode="tel" autoComplete="tel-national" value={f.phone} onChange={(e) => set("phone", e.target.value.replace(/[^\d\s-]/g, "").slice(0, 16))} placeholder={L("e.g. 12-345 6789", "cth. 12-345 6789")} aria-invalid={!!errors.phone} data-testid="bg-phone" />
                  </span>
                  {err("phone")}
                </div>
              </div>
              <div className={css.two}>
                <div className={css.field} data-field="business_name">
                  {label("Business / brand name", "Nama bisnes / jenama", true, "bg-biz")}
                  <span className={css.inputIcon}><Store aria-hidden /><input id="bg-biz" className={css.input} value={f.business_name} onChange={(e) => set("business_name", e.target.value)} placeholder={L("Your business or brand", "Bisnes atau jenama anda")} maxLength={160} aria-invalid={!!errors.business_name} data-testid="bg-business_name" /></span>
                  {err("business_name")}
                </div>
                <div className={css.field} data-field="industry">
                  {label("Industry", "Industri", true, "bg-industry")}
                  {select("industry", GROWTH_INDUSTRIES, ["Select your industry", "Pilih industri anda"], "bg-industry")}
                  {f.industry === "other" && <input className={`${css.inputPlain} ${css.otherIn}`} value={f.industry_other} onChange={(e) => set("industry_other", e.target.value)} maxLength={120} placeholder={L("Your industry (optional)", "Industri anda (pilihan)")} aria-label={L("Other industry", "Industri lain")} data-testid="bg-industry_other" />}
                  {err("industry")}
                </div>
              </div>
              <div className={css.two}>
                <div className={css.field} data-field="city">
                  {label("City", "Bandar", true, "bg-city")}
                  <span className={css.inputIcon}><MapPin aria-hidden /><input id="bg-city" className={css.input} value={f.city} onChange={(e) => set("city", e.target.value)} placeholder={L("e.g. Johor Bahru", "cth. Johor Bahru")} autoComplete="address-level2" maxLength={80} aria-invalid={!!errors.city} data-testid="bg-city" /></span>
                  {err("city")}
                </div>
                <div className={css.field} data-field="state">
                  {label("State", "Negeri", true, "bg-state")}
                  {select("state", GROWTH_STATES, ["Select your state", "Pilih negeri anda"], "bg-state")}
                  {err("state")}
                </div>
              </div>
              <div className={css.two}>
                <div className={css.field} data-field="email">
                  {label("Email address", "Alamat e-mel", "opt", "bg-email")}
                  <span className={css.inputIcon}><Mail aria-hidden /><input id="bg-email" type="email" className={css.input} value={f.email} onChange={(e) => set("email", e.target.value)} placeholder="name@example.com" autoComplete="email" maxLength={200} aria-invalid={!!errors.email} data-testid="bg-email" /></span>
                  {err("email")}
                </div>
                <div className={css.field} data-field="social_url">
                  {label("Social media or website", "Media sosial atau laman web", "opt", "bg-social")}
                  <span className={css.inputIcon}><Globe aria-hidden /><input id="bg-social" className={css.input} value={f.social_url} onChange={(e) => set("social_url", e.target.value)} placeholder={L("e.g. instagram.com/yourbrand", "cth. instagram.com/jenamaanda")} maxLength={300} data-testid="bg-social_url" /></span>
                </div>
              </div>
              <div className={css.section} data-field="source">
                <p className={css.sectionTitle} id="bg-source">{L("Where did you hear about the A2Z Business Growth Check?", "Di manakah anda mengetahui tentang A2Z Business Growth Check?")} {req}</p>
                <div className={css.sources} role="radiogroup" aria-labelledby="bg-source" aria-invalid={!!errors.source}>
                  {SOURCES.map((s) => (
                    <button key={s.k} type="button" role="radio" aria-checked={f.source === s.k} className={css.source} onClick={() => set("source", s.k)} data-testid={`bg-source-${s.k}`}>
                      <span className={css.sourceIcon}>{s.icon}</span>{L(s.label[0], s.label[1])}
                    </button>
                  ))}
                </div>
                {err("source")}
                {(f.source === "referral" || f.source === "other") && (
                  <div className={css.detail}>
                    <label className={css.label} htmlFor="bg-src-detail">{f.source === "referral" ? L("Who referred you? (optional)", "Siapa yang merujuk anda? (pilihan)") : L("Where did you hear about it? (optional)", "Di mana anda mengetahuinya? (pilihan)")}</label>
                    <input id="bg-src-detail" className={css.inputPlain} value={f.source_detail} onChange={(e) => set("source_detail", e.target.value)} maxLength={200} placeholder={L("A brief description", "Penerangan ringkas")} data-testid="bg-source_detail" />
                  </div>
                )}
                <p className={css.small}>{L("Campaign links (utm) are recorded separately from your answer.", "Pautan kempen (utm) direkod berasingan daripada jawapan anda.")}</p>
              </div>
              {errors.form && <p className={css.formErr} role="alert">{errors.form}</p>}
              {foot}
            </div>
          ) : step === 2 ? (
            <div data-testid="bg-step-2">
              {cardHead(["Challenges & Goals", "Cabaran & Matlamat"], ["What is holding the business back, and where do you want it to be in 90 days?", "Apa yang menghalang bisnes anda, dan di mana anda mahu ia berada dalam 90 hari?"])}
              <div className={css.section} data-field="challenges">
                <p className={css.sectionTitle}>{L("Your main challenges", "Cabaran utama anda")} {req} <span className={bx.count} data-testid="bg-challenge-count">{L(`${f.challenges.length} of ${MAX_CHALLENGES} chosen`, `${f.challenges.length} daripada ${MAX_CHALLENGES} dipilih`)}</span></p>
                <p className={css.small}>{L("Choose up to three.", "Pilih sehingga tiga.")}</p>
                {chips("challenges", GROWTH_CHALLENGES, true)}
                {f.challenges.includes("other") && <input className={`${css.inputPlain} ${css.otherIn}`} value={f.challenge_other} onChange={(e) => set("challenge_other", e.target.value)} maxLength={200} placeholder={L("Your challenge (optional)", "Cabaran anda (pilihan)")} aria-label={L("Other challenge", "Cabaran lain")} data-testid="bg-challenge_other" />}
                {err("challenges")}
              </div>
              <div className={css.two}>
                <div className={css.field} data-field="urgent_problem">
                  {label("Your most urgent problem right now", "Masalah paling mendesak sekarang", true, "bg-urgent")}
                  <textarea id="bg-urgent" className={css.textarea} rows={4} maxLength={1500} value={f.urgent_problem} onChange={(e) => set("urgent_problem", e.target.value)} aria-invalid={!!errors.urgent_problem} data-testid="bg-urgent_problem"
                    placeholder={L("Example: sales dropped since last month and we do not know why…", "Contoh: jualan menurun sejak bulan lepas dan kami tidak pasti puncanya…")} />
                  {err("urgent_problem")}
                </div>
                <div className={css.field} data-field="goal_90d">
                  {label("Your goal for the next 90 days", "Matlamat anda untuk 90 hari akan datang", true, "bg-goal")}
                  <textarea id="bg-goal" className={css.textarea} rows={4} maxLength={1500} value={f.goal_90d} onChange={(e) => set("goal_90d", e.target.value)} aria-invalid={!!errors.goal_90d} data-testid="bg-goal_90d"
                    placeholder={L("Example: 30 new customers a month from Instagram and TikTok…", "Contoh: 30 pelanggan baharu sebulan daripada Instagram dan TikTok…")} />
                  {err("goal_90d")}
                </div>
              </div>
              <div className={css.section} data-field="platforms">
                <p className={css.sectionTitle}>{L("Platforms you use now", "Platform yang anda gunakan sekarang")} {req}</p>
                {chips("platforms", GROWTH_PLATFORMS, true)}
                {err("platforms")}
              </div>
              <div className={css.section} data-field="interests">
                <p className={css.sectionTitle}>{L("Areas you would like to improve", "Bidang yang ingin anda tingkatkan")} {opt}</p>
                {chips("interests", GROWTH_INTERESTS, true)}
                <p className={css.small}>{L("This only helps us prepare. It is not an order.", "Ini hanya membantu kami bersedia. Ia bukan pesanan.")}</p>
              </div>
              {errors.form && <p className={css.formErr} role="alert">{errors.form}</p>}
              {foot}
            </div>
          ) : (
            <div data-testid="bg-step-3">
              {cardHead(["Contact & Consent", "Hubungan & Persetujuan"], ["How and when should we reach you? Please read and confirm below.", "Bagaimana dan bila kami patut menghubungi anda? Sila baca dan sahkan di bawah."])}
              <div className={css.two}>
                <div className={css.field} data-field="contact_method">
                  <span className={css.label}>{L("Preferred contact method", "Kaedah hubungan pilihan")} {req}</span>
                  {chips("contact_method", GROWTH_METHODS, false)}
                  {err("contact_method")}
                </div>
                <div className={css.field} data-field="contact_time">
                  {label("Preferred time", "Masa pilihan", true, "bg-time")}
                  {select("contact_time", GROWTH_TIMES, ["Select a time", "Pilih masa"], "bg-time")}
                  {err("contact_time")}
                </div>
              </div>
              <div className={css.section}>
                <p className={css.sectionTitle}>{L("What to expect", "Apa yang dijangka")}</p>
                <ul className={bx.expect} data-testid="bg-expect">
                  <li><Check aria-hidden />{L("The first review is free.", "Semakan awal adalah percuma.")}</li>
                  <li><Check aria-hidden />{L("A2Z may suggest solutions that fit your business.", "A2Z mungkin mencadangkan penyelesaian yang sesuai dengan bisnes anda.")}</li>
                  <li><Check aria-hidden />{L("A paid service is never required.", "Perkhidmatan berbayar tidak sekali-kali diwajibkan.")}</li>
                  <li><Check aria-hidden />{L("Any paid service needs a separate quotation that you accept first.", "Sebarang perkhidmatan berbayar memerlukan sebut harga berasingan yang anda terima terlebih dahulu.")}</li>
                  <li><Check aria-hidden />{L("No result is guaranteed.", "Tiada hasil yang dijamin.")}</li>
                </ul>
              </div>
              <div className={css.section}>
                <p className={css.sectionTitle}>{L("Consent", "Persetujuan")}</p>
                {tick("consent_contact", L("I agree that A2Z Creative Marketing may contact me by my chosen method about this Business Growth Check.", "Saya bersetuju A2Z Creative Marketing boleh menghubungi saya melalui kaedah pilihan saya berkenaan Semakan Pertumbuhan Bisnes ini."))}
                {tick("consent_privacy", lang === "ms"
                  ? <>Saya telah membaca dan memahami <Link href="/privacy" className={css.link} target="_blank" rel="noopener">Notis Privasi A2Z</Link>.</>
                  : <>I have read and understood the <Link href="/privacy" className={css.link} target="_blank" rel="noopener">A2Z Privacy Notice</Link>.</>)}
                {tick("consent_marketing", <>{L("Optional: I would like to receive tips, offers and updates from A2Z.", "Pilihan: Saya ingin menerima tip, tawaran dan berita terkini daripada A2Z.")} <em>{L("(Not required)", "(Tidak diwajibkan)")}</em></>)}
              </div>
              {bot.widgetNode}
              {siteKey && bot.state === "checking" && <p className={css.small} role="status">{L("Cloudflare is checking this browser…", "Cloudflare sedang menyemak pelayar ini…")}</p>}
              {errors.form && <p className={css.formErr} role="alert" data-testid="bg-form-error">{errors.form}</p>}
              {foot}
            </div>
          )}
        </section>
      </main>
      <CompanyFooter lang={lang} />
    </div>
  );
}

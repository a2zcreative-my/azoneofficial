"use client";

/* v1.351.0 - THE PARTNER INTEREST APPLICATION (the CEO, 17-11-2026, "A2Z OS -
   CREATE PARTNER INTEREST APPLICATION"; his three pictures are the layout).

   A public, three-step screening form for independent referral agents:
     1 Contact & Source        who they are, how to reach them, where they found us
     2 Referral Capability     their referral potential - never a CV or a client list
     3 Availability & Consent  time, the screening call, the acknowledgments, privacy
   One step at a time; Back and Continue keep every answer (and a reload keeps
   them for this browser tab). The server checks every answer again
   (worker/src/partners.ts), asks Cloudflare's bot check, saves ONE record with
   a reference, tells the Sales / agent team - and creates NO account. Access
   to the Agent Portal is given later, after a recorded approval, through
   Users & Security. The campaign's utm_* parameters are kept separately from
   the source the applicant chooses. */

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { AtSign, CalendarDays, Ellipsis, Facebook, House, Instagram, Linkedin, MessageCircle, Music2, UserRound, Mail, ArrowRight, ArrowLeft, Check, ChevronDown, User } from "lucide-react";
import { api } from "@/lib/api";
import { getLang, setLang, type Lang } from "@/lib/i18n";
import { useBotCheck } from "@/components/security/bot-check";
import { CompanyFooter } from "@/components/public/company-footer"; // v1.381.0 - who is behind this form
import css from "./partner.module.css";

type Step = 1 | 2 | 3;
interface Form {
  full_name: string; gender: "" | "male" | "female"; age_range: string; dial: string; phone: string; email: string; location: string;
  contact_method: "whatsapp" | "email" | "call"; best_time: string; source: string; source_detail: string;
  referred_before: "" | "yes" | "no"; intro_per_week: string; customer_groups: string[]; groups_other: string; lead_channels: string[]; channels_other: string; approach: string;
  time_available: string; screening_window: string; ack_independent: boolean; ack_terms: boolean; privacy_ack: boolean; marketing_opt_in: boolean;
}
const EMPTY: Form = {
  full_name: "", gender: "", age_range: "", dial: "+60", phone: "", email: "", location: "", contact_method: "whatsapp", best_time: "", source: "", source_detail: "",
  referred_before: "", intro_per_week: "", customer_groups: [], groups_other: "", lead_channels: [], channels_other: "", approach: "",
  time_available: "", screening_window: "", ack_independent: false, ack_terms: false, privacy_ack: false, marketing_opt_in: false,
};
type Bi = [string, string];
const AGES: [string, Bi][] = [["18-24", ["18 - 24", "18 - 24"]], ["25-34", ["25 - 34", "25 - 34"]], ["35-44", ["35 - 44", "35 - 44"]], ["45-54", ["45 - 54", "45 - 54"]], ["55+", ["55 and above", "55 ke atas"]]];
const LOCATIONS: [string, Bi][] = [
  ["johor", ["Johor", "Johor"]], ["kedah", ["Kedah", "Kedah"]], ["kelantan", ["Kelantan", "Kelantan"]], ["melaka", ["Melaka", "Melaka"]], ["negeri_sembilan", ["Negeri Sembilan", "Negeri Sembilan"]],
  ["pahang", ["Pahang", "Pahang"]], ["perak", ["Perak", "Perak"]], ["perlis", ["Perlis", "Perlis"]], ["pulau_pinang", ["Pulau Pinang", "Pulau Pinang"]], ["sabah", ["Sabah", "Sabah"]],
  ["sarawak", ["Sarawak", "Sarawak"]], ["selangor", ["Selangor", "Selangor"]], ["terengganu", ["Terengganu", "Terengganu"]], ["kuala_lumpur", ["W.P. Kuala Lumpur", "W.P. Kuala Lumpur"]],
  ["labuan", ["W.P. Labuan", "W.P. Labuan"]], ["putrajaya", ["W.P. Putrajaya", "W.P. Putrajaya"]], ["outside_malaysia", ["Outside Malaysia", "Luar Malaysia"]],
];
const METHODS: [Form["contact_method"], Bi][] = [["whatsapp", ["WhatsApp", "WhatsApp"]], ["email", ["Email", "E-mel"]], ["call", ["Call", "Panggilan"]]];
const TIMES: [string, Bi][] = [["morning", ["Morning (9am - 12pm)", "Pagi (9 pg - 12 tgh)"]], ["afternoon", ["Afternoon (12pm - 5pm)", "Petang (12 tgh - 5 ptg)"]], ["evening", ["Evening (5pm - 9pm)", "Malam (5 ptg - 9 mlm)"]], ["any", ["Any time", "Bila-bila masa"]]];
const DIALS = ["+60", "+65", "+62", "+66", "+673"];
const SOURCES: { k: string; label: Bi; icon: ReactNode }[] = [
  { k: "facebook", label: ["Facebook", "Facebook"], icon: <Facebook aria-hidden /> },
  { k: "instagram", label: ["Instagram", "Instagram"], icon: <Instagram aria-hidden /> },
  { k: "x", label: ["X", "X"], icon: <span className={css.glyph} aria-hidden>X</span> },
  { k: "threads", label: ["Threads", "Threads"], icon: <AtSign aria-hidden /> },
  { k: "tiktok", label: ["TikTok", "TikTok"], icon: <Music2 aria-hidden /> },
  { k: "linkedin", label: ["LinkedIn", "LinkedIn"], icon: <Linkedin aria-hidden /> },
  { k: "whatsapp", label: ["WhatsApp", "WhatsApp"], icon: <MessageCircle aria-hidden /> },
  { k: "google", label: ["Google", "Google"], icon: <span className={css.glyph} aria-hidden>G</span> },
  { k: "website", label: ["Website", "Laman web"], icon: <House aria-hidden /> },
  { k: "referral", label: ["Referral", "Rujukan"], icon: <UserRound aria-hidden /> },
  { k: "event", label: ["Event", "Acara"], icon: <CalendarDays aria-hidden /> },
  { k: "other", label: ["Other", "Lain-lain"], icon: <Ellipsis aria-hidden /> },
];
const INTROS: [string, Bi][] = [["0", ["0 - not yet", "0 - belum lagi"]], ["1-2", ["1 - 2 a week", "1 - 2 seminggu"]], ["3-5", ["3 - 5 a week", "3 - 5 seminggu"]], ["6+", ["6 or more a week", "6 atau lebih seminggu"]]];
const GROUPS: [string, Bi][] = [["sme", ["SME / Business owners", "PKS / Pemilik perniagaan"]], ["individuals", ["Individuals / Consumers", "Individu / Pengguna"]], ["corporate", ["Corporate clients", "Pelanggan korporat"]], ["community", ["Local community", "Komuniti setempat"]], ["other", ["Other", "Lain-lain"]]];
const CHANNELS: [string, Bi][] = [["personal", ["Personal network", "Rangkaian peribadi"]], ["business", ["Business network", "Rangkaian perniagaan"]], ["social", ["Social media", "Media sosial"]], ["events", ["Events / Community", "Acara / Komuniti"]], ["other", ["Other", "Lain-lain"]]];
const AVAIL: [string, Bi][] = [["occasional", ["Occasional", "Sekali-sekala"]], ["2-5", ["2–5 hours / week", "2–5 jam / minggu"]], ["5+", ["5+ hours / week", "5+ jam / minggu"]]];
const WINDOWS: [string, Bi][] = [["48h", ["Within the next 48 hours", "Dalam 48 jam akan datang"]], ["7d", ["Within the next 7 days", "Dalam 7 hari akan datang"]], ["14d", ["Within the next 14 days", "Dalam 14 hari akan datang"]], ["flexible", ["I'm flexible", "Saya fleksibel"]]];
const STEPS: Bi[] = [["Contact & Source", "Hubungan & Sumber"], ["Referral Capability", "Keupayaan Rujukan"], ["Availability & Consent", "Ketersediaan & Persetujuan"]];
const UTM_KEYS = ["source", "medium", "campaign", "term", "content"] as const;
const STORE = "a2z-partner-application";
const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`);

type Errors = Partial<Record<keyof Form | "form", string>>;
function check(step: Step, f: Form, L: (en: string, ms: string) => string): Errors {
  const e: Errors = {};
  const need = L("Required", "Diperlukan");
  if (step === 1) {
    if (f.full_name.trim().length < 2) e.full_name = L("Enter your full name", "Masukkan nama penuh anda");
    if (!f.gender) e.gender = need;
    if (!f.age_range) e.age_range = need;
    if (!/^\d{7,12}$/.test(f.phone.replace(/\D/g, "").replace(/^0+/, ""))) e.phone = L("Enter a valid mobile number", "Masukkan nombor telefon bimbit yang sah");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(f.email.trim())) e.email = L("Enter a valid email address", "Masukkan alamat e-mel yang sah");
    if (!f.location) e.location = need;
    if (!f.source) e.source = L("Choose where you heard about us", "Pilih di mana anda mengetahui tentang kami");
  }
  if (step === 2) {
    if (!f.referred_before) e.referred_before = need;
    if (!f.intro_per_week) e.intro_per_week = need;
    if (!f.customer_groups.length) e.customer_groups = L("Choose at least one", "Pilih sekurang-kurangnya satu");
    if (!f.lead_channels.length) e.lead_channels = L("Choose at least one", "Pilih sekurang-kurangnya satu");
    if (f.approach.trim().replace(/\s+/g, " ").length < 20) e.approach = L("Tell us a little more (at least 20 characters)", "Terangkan sedikit lagi (sekurang-kurangnya 20 aksara)");
  }
  if (step === 3) {
    if (!f.time_available) e.time_available = need;
    if (!f.screening_window) e.screening_window = need;
    if (!f.ack_independent) e.ack_independent = L("Please confirm to continue", "Sila sahkan untuk meneruskan");
    if (!f.ack_terms) e.ack_terms = L("Please confirm to continue", "Sila sahkan untuk meneruskan");
    if (!f.privacy_ack) e.privacy_ack = L("Please confirm to continue", "Sila sahkan untuk meneruskan");
  }
  return e;
}
/* the server's field names -> the step that asks them */
const STEP_OF: Record<string, Step> = {
  full_name: 1, gender: 1, age_range: 1, phone: 1, email: 1, location: 1, source: 1,
  referred_before: 2, intro_per_week: 2, customer_groups: 2, lead_channels: 2, approach: 2,
  time_available: 3, screening_window: 3, ack_independent: 3, ack_terms: 3, privacy_ack: 3,
};

/* One press, one POST: the server keeps one record per client_key. Sent without the sign-in cookie. */
function sendApplication(body: Record<string, unknown>) {
  return api<{ ok?: boolean; ref?: string; existing?: boolean; error?: { code?: string; message?: string; fields?: Record<string, string> } }>("/public/partner-applications", {
    method: "POST",
    body: JSON.stringify(body),
    /* v1.354.0 - the form needs no session, so it never sends one: a person who is also signed in
       (an agent, or staff still setting up 2FA) applies like anyone else, and the 2FA gate - which
       judges only a request that carries a session - stays exactly as the security audit set it */
    credentials: "omit",
  });
}

/* The Cloudflare site key, when the check is on. The form never waits for it:
   it is drawn in full from the first frame, and the answer only switches on
   the check before Submit (the same as the set-password page). */
function useBotSiteKey(): string | null {
  const [key, setKey] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void api<{ bot_check?: { site_key: string } | null }>("/auth/methods").then((r) => { if (live && r.ok && r.data?.bot_check?.site_key) setKey(r.data.bot_check.site_key); });
    return () => { live = false; };
  }, []);
  return key;
}

export default function PartnerApplicationPage() {
  const [lang, setLangState] = useState<Lang>("en");
  const [step, setStep] = useState<Step>(1);
  const [f, setF] = useState<Form>(EMPTY);
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ ref: string; existing: boolean } | null>(null);
  const siteKey = useBotSiteKey();
  const keyRef = useRef("");
  const utmRef = useRef<Record<string, string>>({});
  const cardRef = useRef<HTMLElement | null>(null);
  const loaded = useRef(false);
  const L = (en: string, ms: string) => (lang === "ms" ? ms : en);
  const bot = useBotCheck(siteKey, "partner_apply");

  /* the reader's language, the campaign that brought them, and this tab's unfinished answers */
  useEffect(() => {
    setLangState(getLang());
    const q = new URLSearchParams(window.location.search);
    const utm: Record<string, string> = {};
    for (const k of UTM_KEYS) { const v = q.get(`utm_${k}`); if (v) utm[k] = v.slice(0, 120); }
    try {
      const saved = JSON.parse(window.sessionStorage.getItem(STORE) ?? "null") as { f?: Form; step?: Step; key?: string; utm?: Record<string, string> } | null;
      if (saved?.f) setF({ ...EMPTY, ...saved.f });
      if (saved?.step) setStep(saved.step);
      keyRef.current = saved?.key ?? newKey();
      utmRef.current = Object.keys(utm).length ? utm : saved?.utm ?? {};
    } catch { keyRef.current = newKey(); utmRef.current = utm; }
    loaded.current = true;
  }, []);
  useEffect(() => {
    if (!loaded.current || done) return;
    try { window.sessionStorage.setItem(STORE, JSON.stringify({ f, step, key: keyRef.current, utm: utmRef.current })); } catch { /* private mode: the answers live in this page */ }
  }, [f, step, done]);

  const pickLang = (l: Lang) => { setLang(l); setLangState(l); if (Object.keys(errors).length) setErrors(check(step, f, l === "ms" ? (_e, m) => m : (e) => e)); };
  const set = <K extends keyof Form>(k: K, v: Form[K]) => { setF((x) => ({ ...x, [k]: v })); if (errors[k]) setErrors((e) => { const n = { ...e }; delete n[k]; return n; }); };
  const toggle = (k: "customer_groups" | "lead_channels", v: string) => set(k, f[k].includes(v) ? f[k].filter((x) => x !== v) : [...f[k], v]);
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
    const r = await sendApplication({
      ...f, referred_before: f.referred_before === "yes", client_key: keyRef.current, utm: utmRef.current, lang, bot_token: bot.token ?? undefined,
      source_detail: ["referral", "other"].includes(f.source) ? f.source_detail : "",
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
      /* the server found what the browser did not: go to the first step it names */
      const first = Object.keys(fields).map((k) => STEP_OF[k] ?? 3).sort()[0] ?? 3;
      const all = check(first, f, L);
      setStep(first);
      setErrors(Object.keys(all).length ? all : { form: L("Some answers need checking.", "Sesetengah jawapan perlu disemak.") });
      top();
      return;
    }
    setErrors({ form: r.status === 429 ? L("Too many applications from this connection - please try again later.", "Terlalu banyak permohonan dari sambungan ini - sila cuba lagi kemudian.")
      : r.data?.error?.code?.startsWith("bot_check") ? L("Please complete the security check and press Submit again.", "Sila lengkapkan semakan keselamatan dan tekan Hantar semula.")
        : r.data?.error?.message ?? L("Your application could not be sent - please check your connection and try again.", "Permohonan anda tidak dapat dihantar - sila semak sambungan anda dan cuba lagi.") });
  };

  const req = <span className={css.req} aria-hidden>*</span>;
  const err = (k: keyof Form) => errors[k] ? <p className={css.err} role="alert" id={`err-${k}`}>{errors[k]}</p> : null;
  const label = (en: string, ms: string, required = false, htmlFor?: string) => <label className={css.label} htmlFor={htmlFor}>{L(en, ms)}{required && <> {req}</>}</label>;
  const select = (k: keyof Form, opts: [string, Bi][], placeholder: Bi | null, id: string) => (
    <span className={css.selectWrap}>
      <select id={id} className={css.select} value={String(f[k])} onChange={(e) => set(k, e.target.value as never)} aria-invalid={!!errors[k]} aria-describedby={errors[k] ? `err-${k}` : undefined} data-testid={`pa-${k}`}>
        {placeholder && <option value="">{L(placeholder[0], placeholder[1])}</option>}
        {opts.map(([v, w]) => <option key={v} value={v}>{L(w[0], w[1])}</option>)}
      </select>
      <ChevronDown className={css.chev} aria-hidden />
    </span>
  );
  const chips = (k: "customer_groups" | "lead_channels" | "time_available" | "referred_before", opts: [string, Bi][], multi: boolean) => (
    <div className={css.chips} role="group" data-invalid={errors[k] ? "" : undefined}>
      {opts.map(([v, w]) => {
        const on = multi ? (f[k] as string[]).includes(v) : f[k] === v;
        return (
          <button key={v} type="button" className={css.chip} aria-pressed={on} data-testid={`pa-${k}-${v}`}
            onClick={() => (multi ? toggle(k as "customer_groups" | "lead_channels", v) : set(k, v as never))}>{L(w[0], w[1])}</button>
        );
      })}
    </div>
  );
  const tick = (k: "ack_independent" | "ack_terms" | "privacy_ack" | "marketing_opt_in", content: ReactNode) => (
    <div data-field={k}>
      <label className={css.tick}>
        <input type="checkbox" checked={f[k]} onChange={(e) => set(k, e.target.checked)} aria-invalid={!!errors[k]} data-testid={`pa-${k}`} />
        <span className={css.box} aria-hidden><Check /></span>
        <span>{content}</span>
      </label>
      {err(k)}
    </div>
  );

  const stepper = (
    <ol className={css.stepper} aria-label={L("Application steps", "Langkah permohonan")} data-testid="pa-stepper">
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
  const screeningNote = <p className={css.screening}>{L("Screening only · No résumé, identity document or bank details required at this stage", "Saringan sahaja · Tiada resume, dokumen pengenalan atau butiran bank diperlukan pada peringkat ini")}</p>;
  const cardHead = (en: Bi, sub: Bi) => (
    <div className={css.cardHead}>
      <div><h2 className={css.cardTitle}>{L(en[0], en[1])}</h2><p className={css.cardSub}>{L(sub[0], sub[1])}</p></div>
      {screeningNote}
    </div>
  );
  const foot = (
    <div className={css.foot}>
      <p className={css.footNote}>{L(`Step ${step} of 3 · Your information is reviewed by authorized A2Z staff only.`, `Langkah ${step} daripada 3 · Maklumat anda disemak oleh kakitangan A2Z yang diberi kuasa sahaja.`)}</p>
      <div className={css.footBtns}>
        {step > 1 && <button type="button" className={css.backBtn} onClick={back} data-testid="pa-back"><ArrowLeft aria-hidden />{L("Back", "Kembali")}</button>}
        {step < 3
          ? <button type="button" className={css.goBtn} onClick={next} data-testid="pa-continue">{L("Continue", "Teruskan")}<ArrowRight aria-hidden /></button>
          : <button type="button" className={css.goBtn} onClick={() => void submit()} disabled={busy || !bot.canSend} data-testid="pa-submit">{busy ? L("Sending…", "Menghantar…") : L("Submit for Screening", "Hantar untuk Saringan")}<ArrowRight aria-hidden /></button>}
      </div>
    </div>
  );

  return (
    <div className={css.page} data-testid="partner-application">
      <header className={css.top}>
        <div className={css.topIn}>
          {/* v1.385.0 - the CEO: the official company logo, not the portal name */}
          <Link href="/" className={css.logoLink} aria-label="A2Z Creative Marketing - home">
            <img src="/logo.png" alt="A2Z Creative Marketing" className={css.logo} width={991} height={547} />
          </Link>
          <div className={css.lang} role="group" aria-label="Language / Bahasa">
            <button type="button" aria-pressed={lang === "en"} onClick={() => pickLang("en")} data-testid="pa-lang-en">EN</button>
            <button type="button" aria-pressed={lang === "ms"} onClick={() => pickLang("ms")} data-testid="pa-lang-ms">BM</button>
          </div>
        </div>
      </header>

      <main className={css.main}>
        <section className={css.hero} aria-labelledby="pa-title">
          <svg className={css.arc} viewBox="0 0 400 200" preserveAspectRatio="none" aria-hidden><path d="M120 -10 C 150 80, 230 150, 330 210" /></svg>
          <div className={css.heroText}>
            <p className={css.eyebrow}>{L("A2Z Business Referral Network", "Rangkaian Rujukan Perniagaan A2Z")}</p>
            <h1 id="pa-title" className={css.title}>{L("Partner Interest Application", "Permohonan Minat Rakan Kongsi")}</h1>
            <p className={css.lead}>{L("Interested in referring potential customers? Tell us about your network and referral approach.", "Berminat merujuk bakal pelanggan? Beritahu kami tentang rangkaian dan pendekatan rujukan anda.")}</p>
          </div>
          {/* v1.385.0 - the CEO: "replace this to QR instead much professional looks" - the form's own address as a QR */}
          <figure className={css.qr} data-testid="pa-qr">
            <img src="/qr/partner-qr.svg" alt={L("QR code for a2zcreative.my/apply/partner", "Kod QR untuk a2zcreative.my/apply/partner")} width={132} height={132} />
            <figcaption>{L("Scan to open on your phone", "Imbas untuk buka di telefon")}<span>a2zcreative.my/<wbr />apply/<wbr />partner</span></figcaption>
          </figure>
        </section>

        {stepper}

        <section className={css.card} ref={cardRef} aria-live="polite">
          {done ? (
            <div className={css.done} data-testid="pa-done">
              <span className={css.doneIcon} aria-hidden><Check /></span>
              <h2 className={css.cardTitle}>{done.existing ? L("We already have your application", "Kami sudah menerima permohonan anda") : L("Application received", "Permohonan diterima")}</h2>
              <p className={css.cardSub}>{L("Your application reference", "Rujukan permohonan anda")}</p>
              <p className={css.ref} data-testid="pa-ref">{done.ref}</p>
              <p className={css.doneText}>{L("Thank you. Authorized A2Z staff will review your application and contact you for a short screening discussion. Keep this reference for any follow-up.", "Terima kasih. Kakitangan A2Z yang diberi kuasa akan menyemak permohonan anda dan menghubungi anda untuk perbincangan saringan ringkas. Simpan rujukan ini untuk sebarang susulan.")}</p>
              <p className={css.info}>{L("Submitting this form does not create a portal account or guarantee an appointment. Only approved partners may later receive access through the existing Agent Portal.", "Menghantar borang ini tidak membuat akaun portal atau menjamin pelantikan. Hanya rakan kongsi yang diluluskan boleh kemudian menerima akses melalui Portal Ejen yang sedia ada.")}</p>
            </div>
          ) : step === 1 ? (
            <div data-testid="pa-step-1">
              {cardHead(["Contact & Source", "Hubungan & Sumber"], ["Tell us how to contact you and where you found this opportunity.", "Beritahu kami cara menghubungi anda dan di mana anda menemui peluang ini."])}
              <div className={css.gridA}>
                <div className={css.field} data-field="full_name">
                  {label("Full name", "Nama penuh", true, "pa-name")}
                  <span className={css.inputIcon}><User aria-hidden /><input id="pa-name" className={css.input} value={f.full_name} onChange={(e) => set("full_name", e.target.value)} placeholder={L("Your full name", "Nama penuh anda")} autoComplete="name" maxLength={120} aria-invalid={!!errors.full_name} data-testid="pa-full_name" /></span>
                  {err("full_name")}
                </div>
                <div className={css.field} data-field="gender">
                  <span className={css.label} id="pa-gender">{L("Gender", "Jantina")} {req}</span>
                  <div className={css.radios} role="radiogroup" aria-labelledby="pa-gender" aria-invalid={!!errors.gender}>
                    {([["male", ["Male", "Lelaki"]], ["female", ["Female", "Perempuan"]]] as [Form["gender"], Bi][]).map(([v, w]) => (
                      <label key={v} className={css.radio}><input type="radio" name="gender" value={v} checked={f.gender === v} onChange={() => set("gender", v)} data-testid={`pa-gender-${v}`} /><span className={css.dot} aria-hidden />{L(w[0], w[1])}</label>
                    ))}
                  </div>
                  {err("gender")}
                </div>
                <div className={css.field} data-field="age_range">
                  {label("Age", "Umur", true, "pa-age")}
                  {select("age_range", AGES, ["Select age", "Pilih umur"], "pa-age")}
                  {err("age_range")}
                </div>
              </div>
              <div className={css.gridB}>
                <div className={css.field} data-field="phone">
                  {label("WhatsApp number", "Nombor WhatsApp", true, "pa-phone")}
                  <span className={css.phone}>
                    <span className={css.phoneIcon} aria-hidden><MessageCircle /></span>
                    <span className={css.dialWrap}>
                      <select className={css.dial} value={f.dial} onChange={(e) => set("dial", e.target.value)} aria-label={L("Country code", "Kod negara")} data-testid="pa-dial">{DIALS.map((d) => <option key={d} value={d}>{d}</option>)}</select>
                      <ChevronDown className={css.chevSm} aria-hidden />
                    </span>
                    <input id="pa-phone" className={css.phoneInput} inputMode="tel" autoComplete="tel-national" value={f.phone} onChange={(e) => set("phone", e.target.value.replace(/[^\d\s-]/g, "").slice(0, 16))} placeholder={L("Enter mobile number", "Masukkan nombor telefon bimbit")} aria-invalid={!!errors.phone} data-testid="pa-phone" />
                  </span>
                  {err("phone")}
                </div>
                <div className={css.field} data-field="email">
                  {label("Email address", "Alamat e-mel", true, "pa-email")}
                  <span className={css.inputIcon}><Mail aria-hidden /><input id="pa-email" type="email" className={css.input} value={f.email} onChange={(e) => set("email", e.target.value)} placeholder="name@example.com" autoComplete="email" maxLength={200} aria-invalid={!!errors.email} data-testid="pa-email" /></span>
                  {err("email")}
                </div>
              </div>
              <div className={css.gridC}>
                <div className={css.field} data-field="location">
                  {label("City / State", "Bandar / Negeri", true, "pa-loc")}
                  {select("location", LOCATIONS, ["Select your location", "Pilih lokasi anda"], "pa-loc")}
                  {err("location")}
                </div>
                <div className={css.field} data-field="contact_method">
                  {label("Preferred contact method", "Kaedah hubungan pilihan", false, "pa-method")}
                  {select("contact_method", METHODS, null, "pa-method")}
                </div>
                <div className={css.field} data-field="best_time">
                  {label("Best time to contact", "Masa terbaik untuk dihubungi", false, "pa-time")}
                  {select("best_time", TIMES, ["Select a time", "Pilih masa"], "pa-time")}
                </div>
              </div>
              <div className={css.section} data-field="source">
                <p className={css.sectionTitle} id="pa-source">{L("Where did you hear about this partnership opportunity?", "Di manakah anda mengetahui tentang peluang perkongsian ini?")} {req}</p>
                <div className={css.sources} role="radiogroup" aria-labelledby="pa-source" aria-invalid={!!errors.source}>
                  {SOURCES.map((s) => (
                    <button key={s.k} type="button" role="radio" aria-checked={f.source === s.k} className={css.source} onClick={() => set("source", s.k)} data-testid={`pa-source-${s.k}`}>
                      <span className={css.sourceIcon}>{s.icon}</span>{L(s.label[0], s.label[1])}
                    </button>
                  ))}
                </div>
                {err("source")}
                {(f.source === "referral" || f.source === "other") && (
                  <div className={css.detail}>
                    <label className={css.label} htmlFor="pa-src-detail">{f.source === "referral" ? L("Who referred you? (optional)", "Siapa yang merujuk anda? (pilihan)") : L("Where did you hear about it? (optional)", "Di mana anda mengetahuinya? (pilihan)")}</label>
                    <input id="pa-src-detail" className={css.inputPlain} value={f.source_detail} onChange={(e) => set("source_detail", e.target.value)} maxLength={200} placeholder={L("A brief description", "Penerangan ringkas")} data-testid="pa-source_detail" />
                  </div>
                )}
                <p className={css.small}>{L("We also record available campaign / referral parameters separately for recruitment analysis.", "Kami juga merekod parameter kempen / rujukan yang tersedia secara berasingan untuk analisis pengambilan.")}</p>
              </div>
              {errors.form && <p className={css.formErr} role="alert">{errors.form}</p>}
              {foot}
            </div>
          ) : step === 2 ? (
            <div data-testid="pa-step-2">
              {cardHead(["Referral Capability", "Keupayaan Rujukan"], ["Show us how you can introduce genuine potential customers — no CV required.", "Tunjukkan bagaimana anda boleh memperkenalkan bakal pelanggan yang tulen — tiada CV diperlukan."])}
              <div className={css.two}>
                <div className={css.field} data-field="referred_before">
                  <span className={css.label}>{L("Have you referred customers before?", "Pernahkah anda merujuk pelanggan sebelum ini?")} {req}</span>
                  {chips("referred_before", [["yes", ["Yes", "Ya"]], ["no", ["No — interested to start", "Tidak — berminat untuk bermula"]]], false)}
                  {err("referred_before")}
                </div>
                <div className={css.field} data-field="intro_per_week">
                  {label("How many qualified introductions could you realistically make per week?", "Berapa banyak perkenalan berkelayakan yang realistik boleh anda buat seminggu?", true, "pa-intro")}
                  {select("intro_per_week", INTROS, ["Select: 0 / 1–2 / 3–5 / 6+", "Pilih: 0 / 1–2 / 3–5 / 6+"], "pa-intro")}
                  {err("intro_per_week")}
                </div>
              </div>
              <div className={css.section} data-field="customer_groups">
                <p className={css.sectionTitle}>{L("Which customer groups can you reach?", "Kumpulan pelanggan manakah yang boleh anda capai?")} {req}</p>
                {chips("customer_groups", GROUPS, true)}
                {f.customer_groups.includes("other") && <input className={`${css.inputPlain} ${css.otherIn}`} value={f.groups_other} onChange={(e) => set("groups_other", e.target.value)} maxLength={200} placeholder={L("Other group (optional)", "Kumpulan lain (pilihan)")} aria-label={L("Other customer group", "Kumpulan pelanggan lain")} />}
                {err("customer_groups")}
              </div>
              <div className={css.section}>
                <p className={css.sectionTitle}>{L("How would you introduce potential customers?", "Bagaimanakah anda akan memperkenalkan bakal pelanggan?")}</p>
                <div className={css.two}>
                  <div className={css.field} data-field="lead_channels">
                    <span className={css.label}>{L("Your existing lead channels", "Saluran petunjuk sedia ada anda")} {req}</span>
                    {chips("lead_channels", CHANNELS, true)}
                    {f.lead_channels.includes("other") && <input className={`${css.inputPlain} ${css.otherIn}`} value={f.channels_other} onChange={(e) => set("channels_other", e.target.value)} maxLength={200} placeholder={L("Other channel (optional)", "Saluran lain (pilihan)")} aria-label={L("Other lead channel", "Saluran petunjuk lain")} />}
                    {err("lead_channels")}
                  </div>
                  <div className={css.field} data-field="approach">
                    {label("Briefly describe your referral approach", "Terangkan secara ringkas pendekatan rujukan anda", true, "pa-approach")}
                    <textarea id="pa-approach" className={css.textarea} rows={4} maxLength={2000} value={f.approach} onChange={(e) => set("approach", e.target.value)} aria-invalid={!!errors.approach} data-testid="pa-approach"
                      placeholder={L("Example: how you identify suitable customers, introduce them and follow up…", "Contoh: cara anda mengenal pasti pelanggan yang sesuai, memperkenalkan mereka dan membuat susulan…")} />
                    {err("approach")}
                  </div>
                </div>
              </div>
              <p className={css.small}>{L("Introduce prospects only with their knowledge and permission. You are not required to upload a client list.", "Perkenalkan prospek hanya dengan pengetahuan dan kebenaran mereka. Anda tidak perlu memuat naik senarai pelanggan.")}</p>
              {errors.form && <p className={css.formErr} role="alert">{errors.form}</p>}
              {foot}
            </div>
          ) : (
            <div data-testid="pa-step-3">
              {cardHead(["Availability & Consent", "Ketersediaan & Persetujuan"], ["Confirm your availability and agreement to be contacted for screening.", "Sahkan ketersediaan dan persetujuan anda untuk dihubungi bagi saringan."])}
              <div className={css.two}>
                <div className={css.field} data-field="time_available">
                  <span className={css.label}>{L("Time available for referral activities", "Masa yang ada untuk aktiviti rujukan")} {req}</span>
                  {chips("time_available", AVAIL, false)}
                  {err("time_available")}
                </div>
                <div className={css.field} data-field="screening_window">
                  {label("When could we contact you for a screening discussion?", "Bilakah kami boleh menghubungi anda untuk perbincangan saringan?", true, "pa-window")}
                  {select("screening_window", WINDOWS, ["Select a time frame", "Pilih tempoh masa"], "pa-window")}
                  {err("screening_window")}
                </div>
              </div>
              <div className={css.section}>
                <p className={css.sectionTitle}>{L("Partnership understanding", "Pemahaman perkongsian")}</p>
                {tick("ack_independent", lang === "ms"
                  ? <>Saya faham ini ialah <strong>peluang rujukan bebas, bukan tawaran pekerjaan</strong>. Penghantaran tidak menjamin pelantikan atau akses portal.</>
                  : <>I understand this is an <strong>independent referral opportunity, not an employment offer</strong>. Submission does not guarantee appointment or portal access.</>)}
                {tick("ack_terms", L("I understand that any commission eligibility and commercial terms will be disclosed and agreed before a partnership is activated.", "Saya faham bahawa sebarang kelayakan komisen dan terma komersial akan didedahkan dan dipersetujui sebelum perkongsian diaktifkan."))}
              </div>
              <div className={css.section}>
                <p className={css.sectionTitle}>{L("Privacy & consent", "Privasi & persetujuan")}</p>
                {tick("privacy_ack", lang === "ms"
                  ? <>Saya telah membaca <Link href="/privacy" className={css.link} target="_blank" rel="noopener">Notis Privasi</Link> dan bersetuju butiran permohonan saya boleh digunakan untuk saringan dan susulan yang berkaitan.</>
                  : <>I have read the <Link href="/privacy" className={css.link} target="_blank" rel="noopener">Privacy Notice</Link> and agree that my application details may be used for screening and relevant follow-up.</>)}
                {tick("marketing_opt_in", <>{L("Optional: I would like to receive future partnership updates and promotional messages.", "Pilihan: Saya ingin menerima kemas kini perkongsian dan mesej promosi pada masa hadapan.")} <em>{L("(Not required to apply)", "(Tidak diperlukan untuk memohon)")}</em></>)}
                <p className={css.info}>{L("Your application will be reviewed by A2Z staff. Only approved partners may later receive access through the existing Agent Portal.", "Permohonan anda akan disemak oleh kakitangan A2Z. Hanya rakan kongsi yang diluluskan boleh kemudian menerima akses melalui Portal Ejen yang sedia ada.")}</p>
              </div>
              {bot.widgetNode}
              {siteKey && bot.state === "checking" && <p className={css.small} role="status">{L("Cloudflare is checking this browser…", "Cloudflare sedang menyemak pelayar ini…")}</p>}
              {errors.form && <p className={css.formErr} role="alert" data-testid="pa-form-error">{errors.form}</p>}
              {foot}
            </div>
          )}
        </section>
      </main>
      <CompanyFooter lang={lang} />
    </div>
  );
}

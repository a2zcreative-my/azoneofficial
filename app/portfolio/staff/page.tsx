"use client";
/* eslint-disable @next/next/no-img-element -- the photo and the work come from the API, not from next/image */

/* v1.389.0 - THE PUBLIC STAFF PORTFOLIO (/portfolio/<name>; the CEO, 19-11-2026).
   No sign-in. Shows only what was approved when the portfolio was published: the portrait,
   name, position, department, introduction, key responsibilities, expertise and specialties,
   the work, and the contact the CEO approved (otherwise the company's). Never a staff id, IC,
   salary, address, attendance or any HR record - the API (worker/src/index.ts,
   /api/v1/public/portfolio/<name>) does not send them.
   v1.391.0 (the CEO, 19-11-2026: "A2Z Creative - Premium Web & PWA Portfolio UI Upgrade") - the
   page redrawn on his reference: a cinematic navy hero, the expertise as icon chips, then two
   columns from 1024px (left: about, responsibilities, project showcase - right: a compact enquiry
   card with the approved contact). Under 768px it is its own phone layout: a compact hero, a
   chip grid, responsibilities that open, a gallery that scrolls sideways, and a sticky bar
   (Enquire now + WhatsApp) that opens the SAME enquiry form in a native bottom sheet. Same API,
   same enquiry route, same address and QR; the card PNG / PDF is drawn elsewhere and untouched.
   Every section hides when it has nothing to show - no placeholder is ever drawn.
   0220 (the CEO 19-11-2026: "text doesn't change to BM") - with BM chosen, the person's own words
   are the approved BM ones (`ms`, frozen at publish; Translate to BM in the editor, checked by
   staff). A word with no BM shows in English. */

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, Building2, Check, ChevronDown, Globe, Layers, Mail, MapPin, Menu, MessageCircle, Phone, Play, Send, Star, X } from "lucide-react";
import { api } from "@/lib/api";
import { SkelRows } from "@/components/ui/skeleton";
import { getLang, setLang, type Lang } from "@/lib/i18n";
import { CompanyFooter } from "@/components/public/company-footer";
import { CONTACT } from "@/constants/content";
import { A2Z_CREATIVE } from "@/lib/issuers";
import { CARD_ICONS, iconsFor, type CardIcon } from "@/lib/card-icons";
import css from "./staff.module.css";

interface PublicPortfolio {
  slug: string; url: string; name: string; name_case?: "upper" | "normal"; position: string | null; department: string | null;
  tagline: string | null; intro: string | null; specialties: string[]; expertise: string[]; experience: string | null;
  responsibilities: string[]; email: string | null; phone: string | null; socials: Record<string, string>; template: string;
  has_photo: boolean; published_at: string | null;
  /** 0220 - the approved BM words; lists are a phrase map (English -> BM) */
  ms?: { tagline?: string; intro?: string; experience?: string; phrases?: Record<string, string>; items?: Record<string, { title?: string; description?: string }> } | null;
  items: { id: number; kind: "image" | "video"; title: string; description: string | null; video_url: string | null; has_media: boolean; media_type: string | null; featured: boolean }[];
}
type Item = PublicPortfolio["items"][number];
type Form = { name: string; phone: string; email: string; company: string; message: string };
const EMPTY: Form = { name: "", phone: "", email: "", company: "", message: "" };

const titleCase = (s: string) => (s === s.toUpperCase() ? s.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (_m, a: string, b: string) => a + b.toUpperCase()) : s);
const slugFromPath = () => {
  if (typeof window === "undefined") return null;
  const m = /^\/portfolio\/([a-z0-9-]{3,40})\/?$/i.exec(window.location.pathname);
  return m && m[1]!.toLowerCase() !== "staff" ? m[1]!.toLowerCase() : null;
};
const SOCIAL_LABEL: Record<string, string> = { instagram: "Instagram", tiktok: "TikTok", facebook: "Facebook", linkedin: "LinkedIn", youtube: "YouTube" };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?[0-9 ()-]{7,20}$/;
/* the phone layout is a different page, not a squeezed desktop: it follows the CSS breakpoint */
const PHONE_MQ = "(max-width: 767px)";

/** a specialty's line icon: the same path data the card draws (lib/card-icons.ts) */
function ChipIcon({ icon }: { icon: CardIcon }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true" className={css.chipIcon}><path d={CARD_ICONS[icon]} /></svg>;
}

/* one piece of work - at module scope so React keeps it between renders */
function Work({ i, media, L }: { i: Item; media: (id: number) => string; L: (en: string, ms: string) => string }) {
  /* i arrives already in the visitor's language (the page maps title / description) */
  const isVideo = i.has_media && i.media_type?.startsWith("video/");
  return (
    <article className={css.work} data-testid={`portfolio-item-${i.id}`}>
      <div className={css.workFrame}>
        {isVideo
          ? <video className={css.workMedia} src={media(i.id)} controls preload="metadata" playsInline aria-label={i.title} />
          : i.has_media
            ? <a href={media(i.id)} target="_blank" rel="noopener" className={css.workLink} aria-label={L(`Open ${i.title}`, `Buka ${i.title}`)}><img className={css.workMedia} src={media(i.id)} alt={i.title} loading="lazy" decoding="async" /></a>
            : i.video_url
              ? <a href={i.video_url} target="_blank" rel="noopener nofollow" className={css.workVideoLink} aria-label={L(`Watch ${i.title}`, `Tonton ${i.title}`)}><Play aria-hidden /></a>
              : <div className={css.workVideoLink} aria-hidden><Layers /></div>}
        {i.featured && <span className={css.featured}><Star aria-hidden />{L("Featured", "Pilihan")}</span>}
      </div>
      <div className={css.workText}>
        <h3>{i.title}</h3>
        {i.description && <p>{i.description}</p>}
        {i.video_url && i.has_media && <a href={i.video_url} target="_blank" rel="noopener nofollow" className={css.watch}><Play aria-hidden />{L("Watch the video", "Tonton video")}</a>}
      </div>
    </article>
  );
}

/** the enquiry form - one copy of the state, drawn inline on a wide screen and in the sheet on a phone */
function EnquiryForm({ f, setF, sent, msg, onSend, L, idp }: {
  f: Form; setF: (f: Form) => void; sent: "idle" | "sending" | "sent" | "error"; msg: string;
  onSend: (e: React.FormEvent) => void; L: (en: string, ms: string) => string; idp: string;
}) {
  if (sent === "sent") return <p className={css.sent} role="status" data-testid="portfolio-sent"><Check aria-hidden />{L("Thank you - your message is with the A2Z team. We reply within one working day.", "Terima kasih - mesej anda telah diterima pasukan A2Z. Kami membalas dalam satu hari bekerja.")}</p>;
  const field = (k: keyof Form, label: string, el: React.ReactNode) => (
    <label className={k === "message" ? `${css.field} ${css.wide}` : css.field} htmlFor={`${idp}-${k}`}><span className={css.srLabel}>{label}</span>{el}</label>
  );
  return (
    <form className={css.form} onSubmit={onSend} noValidate data-testid="portfolio-form-fields">
      {field("name", L("Your name", "Nama anda"), <input id={`${idp}-name`} placeholder={L("Your name", "Nama anda")} value={f.name} maxLength={120} onChange={(e) => setF({ ...f, name: e.target.value })} required autoComplete="name" />)}
      {field("email", L("Your email", "Emel anda"), <input id={`${idp}-email`} type="email" inputMode="email" placeholder={L("Your email", "Emel anda")} value={f.email} maxLength={200} onChange={(e) => setF({ ...f, email: e.target.value })} autoComplete="email" />)}
      {field("phone", L("Phone", "Telefon"), <input id={`${idp}-phone`} type="tel" inputMode="tel" placeholder={L("Phone", "Telefon")} value={f.phone} maxLength={40} onChange={(e) => setF({ ...f, phone: e.target.value })} autoComplete="tel" />)}
      {field("company", L("Company (optional)", "Syarikat (pilihan)"), <input id={`${idp}-company`} placeholder={L("Company (optional)", "Syarikat (pilihan)")} value={f.company} maxLength={200} onChange={(e) => setF({ ...f, company: e.target.value })} autoComplete="organization" />)}
      {field("message", L("Tell us about your project or enquiry", "Ceritakan projek atau pertanyaan anda"), <textarea id={`${idp}-message`} rows={3} placeholder={L("Tell us about your project or enquiry...", "Ceritakan projek atau pertanyaan anda...")} value={f.message} maxLength={2000} onChange={(e) => setF({ ...f, message: e.target.value })} required />)}
      {msg && <p className={css.err} role="alert" data-testid="portfolio-error">{msg}</p>}
      <button type="submit" className={`${css.ctaGold} ${css.wide}`} disabled={sent === "sending"} data-testid="portfolio-send"><Send aria-hidden />{sent === "sending" ? L("Sending...", "Menghantar...") : L("Send enquiry", "Hantar pertanyaan")}</button>
    </form>
  );
}

export default function StaffPortfolioPage() {
  const [lang, setL] = useState<Lang>("en");
  const [p, setP] = useState<PublicPortfolio | null | undefined>(undefined);
  const [slug, setSlug] = useState<string | null>(null);
  const [sent, setSent] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [msg, setMsg] = useState<string>("");
  const [f, setF] = useState<Form>(EMPTY);
  const [phone, setPhone] = useState(false);
  const [menu, setMenu] = useState(false);
  const [allDuties, setAllDuties] = useState(false);
  const [allWork, setAllWork] = useState(false);
  const sheet = useRef<HTMLDialogElement | null>(null);
  const L = useCallback((en: string, ms: string) => (lang === "ms" ? ms : en), [lang]);

  useEffect(() => {
    setL(getLang());
    const s = slugFromPath();
    setSlug(s);
    if (!s) { setP(null); return; }
    void api<{ portfolio: PublicPortfolio }>(`/public/portfolio/${s}`, { credentials: "omit" }).then((r) => {
      if (r.ok && r.data?.portfolio) { setP(r.data.portfolio); document.title = `${titleCase(r.data.portfolio.name)} - ${r.data.portfolio.position ?? "A2Z Creative Marketing"}`; }
      else setP(null);
    });
  }, []);
  useEffect(() => {
    const mq = window.matchMedia(PHONE_MQ);
    const on = () => { setPhone(mq.matches); if (!mq.matches && sheet.current?.open) sheet.current.close(); };
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!slug) return;
    const t = { name: f.name.trim(), phone: f.phone.trim(), email: f.email.trim(), company: f.company.trim(), message: f.message.trim() };
    if (!t.name) { setMsg(L("Please give your name.", "Sila berikan nama anda.")); return; }
    if (!t.phone && !t.email) { setMsg(L("Leave a phone number or an email so we can reply.", "Tinggalkan nombor telefon atau emel supaya kami boleh membalas.")); return; }
    if (t.email && !EMAIL_RE.test(t.email)) { setMsg(L("That email does not look right.", "Emel itu tidak kelihatan betul.")); return; }
    if (t.phone && !PHONE_RE.test(t.phone)) { setMsg(L("That phone number does not look right.", "Nombor telefon itu tidak kelihatan betul.")); return; }
    if (t.message.length < 5) { setMsg(L("Tell us a little about what you need.", "Ceritakan sedikit apa yang anda perlukan.")); return; }
    setSent("sending"); setMsg("");
    const r = await api(`/public/portfolio/${slug}/enquiry`, { method: "POST", body: JSON.stringify(t), credentials: "omit" });
    if (r.ok) { setSent("sent"); setF(EMPTY); }
    else { setSent("error"); setMsg((r.data as { error?: { message?: string } } | null)?.error?.message ?? L("Not sent - please WhatsApp us instead.", "Tidak dihantar - sila WhatsApp kami.")); }
  };
  const switchLang = (l: Lang) => { setLang(l); setL(l); };
  const enquire = (e?: React.MouseEvent) => {
    setMenu(false);
    if (phone && sheet.current) { e?.preventDefault(); sheet.current.showModal(); }
  };

  if (p === undefined) return <main className={css.page}><div className={css.loading} aria-busy="true"><SkelRows rows={6} /></div></main>;
  if (p === null) {
    return (
      <main className={css.page}>
        <header className={css.bar}><div className={css.barInner}><Link href="/" aria-label="A2Z Creative Marketing"><img src="/logo.png" alt="A2Z Creative Marketing" className={css.logo} width={120} height={40} /></Link></div></header>
        <section className={css.missing} data-testid="portfolio-missing">
          <h1>{L("This portfolio is not available", "Portfolio ini tidak tersedia")}</h1>
          <p>{L("It may have been taken down or the link may be mistyped. You can still reach A2Z Creative Marketing directly.", "Ia mungkin telah dikeluarkan atau pautan tersilap. Anda masih boleh menghubungi A2Z Creative Marketing.")}</p>
          <p className={css.ctaRow}><a className={css.ctaGold} href={`https://wa.me/${CONTACT.whatsapp}`} target="_blank" rel="noopener"><MessageCircle aria-hidden /> WhatsApp A2Z</a><Link className={css.ctaGhostDark} href="/">a2zcreative.my</Link></p>
        </section>
        <CompanyFooter lang={lang} />
      </main>
    );
  }

  const name = p.name_case === "upper" ? p.name.toLocaleUpperCase("ms-MY") : titleCase(p.name);
  /* the contact the approver ticked, otherwise A2Z Creative Marketing's own (this is A2Z's page) */
  const email = p.email ?? A2Z_CREATIVE.email;
  const waNumber = p.phone ? p.phone.replace(/\D/g, "").replace(/^0/, "60") : CONTACT.whatsapp;
  const waText = encodeURIComponent(L(`Hi, I saw ${name}'s portfolio on a2zcreative.my`, `Hai, saya lihat portfolio ${name} di a2zcreative.my`));
  const waHref = `https://wa.me/${waNumber}?text=${waText}`;
  /* 0220 - the visitor's language: the approved BM word, else the English */
  const bm = lang === "ms" ? (p.ms ?? null) : null;
  const T = (en: string) => bm?.phrases?.[en] ?? en;
  const tagline = bm?.tagline ?? p.tagline;
  const intro = bm?.intro ?? p.intro;
  const experience = bm?.experience ?? p.experience;
  const duties = p.responsibilities.map(T);
  const chipsEn = [...p.specialties, ...p.expertise.filter((x) => !p.specialties.includes(x))];
  const chips = chipsEn.map(T);
  const chipIcons = iconsFor(chipsEn); // the icon is chosen from the English words, so both languages match
  /* the work: featured first, then the rest in the order the studio keeps */
  const inLang = (i: Item): Item => (bm?.items?.[String(i.id)] ? { ...i, title: bm.items[String(i.id)]!.title ?? i.title, description: bm.items[String(i.id)]!.description ?? i.description } : i);
  const work = [...p.items.filter((i) => i.featured), ...p.items.filter((i) => !i.featured)].map(inLang);
  const WORK_FIRST = 6;
  const shownWork = phone || allWork ? work : work.slice(0, WORK_FIRST);
  const DUTIES_FIRST = 2;
  const media = (id: number) => `/api/v1/public/portfolio/${p.slug}/media/${id}`;
  const socials = Object.entries(p.socials ?? {}).filter(([, v]) => v);
  const nav = [["/", L("Home", "Utama")], ["/#services", L("Services", "Perkhidmatan")], ["/#work", L("Work", "Kerja")], ["#enquire", L("Contact", "Hubungi")]] as const;

  const contactList = (
    <ul className={css.contact} data-testid="portfolio-contact">
      <li><Mail aria-hidden /><a href={`mailto:${email}`}>{email}</a></li>
      <li><Phone aria-hidden /><a href={waHref} target="_blank" rel="noopener">{p.phone ?? A2Z_CREATIVE.whatsapp}</a></li>
      <li><MapPin aria-hidden /><span>Johor Bahru, Malaysia</span></li>
      <li><Globe aria-hidden /><Link href="/">a2zcreative.my</Link></li>
      {socials.length > 0 && <li className={css.socials}>{socials.map(([k, v]) => <a key={k} href={v} target="_blank" rel="noopener nofollow">{SOCIAL_LABEL[k] ?? k}</a>)}</li>}
    </ul>
  );
  const enquiryHead = (
    <div className={css.enqHead}>
      <span className={css.enqIcon} aria-hidden><Send /></span>
      <div>
        <h2 id="enquire-title">{L("Let's work together", "Mari bekerjasama")}</h2>
        <p>{L(`Have a project or campaign in mind? Tell ${name} and the A2Z team what you need.`, `Ada projek atau kempen? Beritahu ${name} dan pasukan A2Z apa yang anda perlukan.`)}</p>
      </div>
    </div>
  );
  const formEl = <EnquiryForm f={f} setF={(x) => { setF(x); if (msg) setMsg(""); }} sent={sent} msg={msg} onSend={(e) => void send(e)} L={L} idp={phone ? "sheet" : "page"} />;

  return (
    <main className={css.page} data-testid="portfolio-page">
      <header className={css.bar}>
        <div className={css.barInner}>
          <Link href="/" aria-label="A2Z Creative Marketing"><img src="/logo.png" alt="A2Z Creative Marketing" className={css.logo} width={120} height={40} /></Link>
          <nav className={css.nav} aria-label={L("Site", "Laman")}>
            {nav.map(([href, label]) => <a key={href} href={href} onClick={href === "#enquire" ? enquire : undefined}>{label}</a>)}
          </nav>
          <span className={css.barEnd}>
            <span className={css.langs} role="group" aria-label="Language">
              <button type="button" aria-pressed={lang === "en"} onClick={() => switchLang("en")}>EN</button>
              <button type="button" aria-pressed={lang === "ms"} onClick={() => switchLang("ms")}>BM</button>
            </span>
            <a className={`${css.ctaGold} ${css.barCta}`} href="#enquire" onClick={enquire} data-testid="portfolio-enquire-top"><Send aria-hidden />{L("Enquire now", "Hubungi kami")}</a>
            <button type="button" className={css.menuBtn} aria-expanded={menu} aria-controls="portfolio-menu" aria-label={menu ? L("Close menu", "Tutup menu") : L("Open menu", "Buka menu")} onClick={() => setMenu((m) => !m)}>{menu ? <X aria-hidden /> : <Menu aria-hidden />}</button>
          </span>
        </div>
        {menu && (
          <nav id="portfolio-menu" className={css.menu} aria-label={L("Site", "Laman")}>
            {nav.map(([href, label]) => <a key={href} href={href} onClick={href === "#enquire" ? enquire : () => setMenu(false)}>{label}</a>)}
          </nav>
        )}
      </header>

      <section className={css.hero} aria-labelledby="portfolio-name">
        <div className={css.heroInner}>
          <div className={css.heroText}>
            <p className={css.kicker}><Link href="/">A2Z Creative Marketing</Link><span aria-hidden> / </span>{L("Team portfolio", "Portfolio pasukan")}</p>
            <h1 id="portfolio-name" data-testid="portfolio-name">{name}</h1>
            {p.position && <p className={css.pill} data-testid="portfolio-position">{T(p.position)}</p>}
            {(p.department || experience) && (
              <p className={css.dept}>
                {p.department && <span><Building2 aria-hidden />{L("Department", "Jabatan")}: {T(p.department)}</span>}
                {experience && <span><Star aria-hidden />{experience}</span>}
              </p>
            )}
            {tagline && <p className={css.tagline}>{tagline}</p>}
            <p className={`${css.ctaRow} ${css.heroCtas}`}>
              <a className={css.ctaGold} href="#enquire" onClick={enquire} data-testid="portfolio-enquire">{L("Work with me", "Bekerja dengan saya")}<ArrowRight aria-hidden /></a>
              {work.length > 0 && <a className={css.ctaGhost} href="#projects"><Play aria-hidden />{L("View portfolio", "Lihat portfolio")}</a>}
            </p>
          </div>
          <div className={css.heroPhoto}>
            <span className={css.ring} aria-hidden />
            {p.has_photo
              ? <img src={`/api/v1/public/portfolio/${p.slug}/portrait`} alt={name} data-testid="portfolio-photo" fetchPriority="high" decoding="async" />
              : <span className={css.initials} aria-hidden>{name.split(/\s+/).slice(0, 2).map((w) => w[0]).join("")}</span>}
          </div>
        </div>
      </section>

      {chips.length > 0 && (
        <section className={css.expertise} aria-labelledby="expertise-title" data-testid="portfolio-expertise">
          <h2 id="expertise-title"><Layers aria-hidden />{L("Expertise & specialties", "Kepakaran & keistimewaan")}</h2>
          <ul className={css.chips}>{chips.map((t, i) => <li key={`${i}-${t}`}><ChipIcon icon={chipIcons[i] ?? "star"} />{t}</li>)}</ul>
        </section>
      )}

      <div className={css.body}>
        <div className={css.main}>
          {intro && (
            <section className={css.section} aria-labelledby="about-title">
              <h2 id="about-title">{L("About me", "Tentang saya")}</h2>
              <p className={css.intro}>{intro}</p>
            </section>
          )}
          {duties.length > 0 && (
            <section className={css.section} aria-labelledby="duties-title" data-testid="portfolio-duties">
              <h2 id="duties-title">{L("Key responsibilities", "Tanggungjawab utama")}</h2>
              <ul className={`${css.ticks} ${allDuties ? css.ticksAll : ""}`} id="portfolio-duty-list">
                {duties.map((t, n) => <li key={`${n}-${t}`}><Check aria-hidden /><span>{t}</span></li>)}
              </ul>
              {duties.length > DUTIES_FIRST && (
                <button type="button" className={css.more} aria-expanded={allDuties} aria-controls="portfolio-duty-list" onClick={() => setAllDuties((x) => !x)} data-testid="portfolio-duties-more">
                  {allDuties ? L("Show less", "Tunjuk kurang") : L(`Show all ${duties.length}`, `Tunjuk semua ${duties.length}`)}<ChevronDown aria-hidden className={allDuties ? css.flip : undefined} />
                </button>
              )}
            </section>
          )}
          {work.length > 0 && (
            <section className={css.section} id="projects" aria-labelledby="projects-title" data-testid="portfolio-projects">
              <div className={css.sectionHead}>
                <h2 id="projects-title">{L("Project showcase", "Pameran projek")}</h2>
                {!phone && work.length > WORK_FIRST && <button type="button" className={css.link} aria-expanded={allWork} onClick={() => setAllWork((x) => !x)}>{allWork ? L("Show fewer", "Tunjuk kurang") : L(`View all ${work.length}`, `Lihat semua ${work.length}`)}<ArrowRight aria-hidden /></button>}
              </div>
              <div className={css.gallery} tabIndex={phone ? 0 : undefined} aria-label={phone ? L("Projects - swipe to see more", "Projek - leret untuk lihat lagi") : undefined} role={phone ? "region" : undefined}>
                {shownWork.map((i) => <Work key={i.id} i={i} media={media} L={L} />)}
              </div>
            </section>
          )}
        </div>

        {!phone && (
          <aside className={css.enquire} id="enquire" aria-labelledby="enquire-title" data-testid="portfolio-form">
            {enquiryHead}
            {formEl}
            {contactList}
          </aside>
        )}
        {phone && (
          <section className={css.section} id="enquire" aria-labelledby="contact-title" data-testid="portfolio-contact-card">
            <h2 id="contact-title">{L("Contact", "Hubungi")}</h2>
            {contactList}
          </section>
        )}
      </div>

      <CompanyFooter lang={lang} />

      {/* the phone's own actions: always one tap away, inside the safe area */}
      <div className={css.dock} data-testid="portfolio-dock">
        <button type="button" className={css.ctaGold} onClick={() => sheet.current?.showModal()} data-testid="portfolio-dock-enquire"><Send aria-hidden />{L("Enquire now", "Hubungi kami")}</button>
        <a className={css.dockWa} href={waHref} target="_blank" rel="noopener" aria-label="WhatsApp"><MessageCircle aria-hidden /></a>
      </div>
      <dialog ref={sheet} className={css.sheet} aria-labelledby="enquire-title" data-testid="portfolio-sheet" onClick={(e) => { if (e.target === e.currentTarget) sheet.current?.close(); }}>
        {phone && (
          <div className={css.sheetBody}>
            <span className={css.grab} aria-hidden />
            <button type="button" className={css.sheetClose} onClick={() => sheet.current?.close()} aria-label={L("Close", "Tutup")}><X aria-hidden /></button>
            {enquiryHead}
            {formEl}
          </div>
        )}
      </dialog>
    </main>
  );
}

"use client";
/* eslint-disable @next/next/no-img-element -- the photo and the work come from the API, not from next/image */

/* v1.389.0 - THE PUBLIC STAFF PORTFOLIO (/portfolio/<name>; the CEO, 19-11-2026).
   No sign-in. Shows only what was approved when the portfolio was published: the portrait,
   name, position, department, introduction, key responsibilities, expertise and specialties,
   featured projects, the work gallery and videos, and the contact the CEO approved (otherwise
   the company's). Never a staff id, IC, salary, address, attendance or any HR record - the API
   (worker/src/index.ts, /api/v1/public/portfolio/<name>) does not send them. */

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, Briefcase, Building2, Check, Mail, MapPin, MessageCircle, Phone, Play, Star } from "lucide-react";
import { api } from "@/lib/api";
import { SkelRows } from "@/components/ui/skeleton";
import { getLang, setLang, type Lang } from "@/lib/i18n";
import { CompanyFooter } from "@/components/public/company-footer";
import { CONTACT } from "@/constants/content";
import { A2Z_CREATIVE } from "@/lib/issuers";
import css from "./staff.module.css";

interface PublicPortfolio {
  slug: string; url: string; name: string; position: string | null; department: string | null;
  tagline: string | null; intro: string | null; specialties: string[]; expertise: string[]; experience: string | null;
  responsibilities: string[]; email: string | null; phone: string | null; socials: Record<string, string>; template: string;
  has_photo: boolean; published_at: string | null;
  items: { id: number; kind: "image" | "video"; title: string; description: string | null; video_url: string | null; has_media: boolean; media_type: string | null; featured: boolean }[];
}

const titleCase = (s: string) => (s === s.toUpperCase() ? s.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (_m, a: string, b: string) => a + b.toUpperCase()) : s);
const slugFromPath = () => {
  if (typeof window === "undefined") return null;
  const m = /^\/portfolio\/([a-z0-9-]{3,40})\/?$/i.exec(window.location.pathname);
  return m && m[1]!.toLowerCase() !== "staff" ? m[1]!.toLowerCase() : null;
};
const SOCIAL_LABEL: Record<string, string> = { instagram: "Instagram", tiktok: "TikTok", facebook: "Facebook", linkedin: "LinkedIn", youtube: "YouTube" };

/* one piece of work - at module scope so React keeps it between renders */
function Work({ i, media, L }: { i: PublicPortfolio["items"][number]; media: (id: number) => string; L: (en: string, ms: string) => string }) {
  return (
    <article className={css.work} data-testid={`portfolio-item-${i.id}`}>
      {i.has_media && i.media_type?.startsWith("video/")
        ? <video className={css.workMedia} src={media(i.id)} controls preload="metadata" playsInline />
        : i.has_media
          ? <img className={css.workMedia} src={media(i.id)} alt={i.title} loading="lazy" />
          : <div className={css.workPlaceholder}><Play aria-hidden /></div>}
      <div className={css.workText}>
        <h3>{i.title}</h3>
        {i.description && <p>{i.description}</p>}
        {i.video_url && <a href={i.video_url} target="_blank" rel="noopener nofollow" className={css.watch}><Play aria-hidden />{L("Watch the video", "Tonton video")}</a>}
      </div>
    </article>
  );
}

export default function StaffPortfolioPage() {
  const [lang, setL] = useState<Lang>("en");
  const [p, setP] = useState<PublicPortfolio | null | undefined>(undefined);
  const [slug, setSlug] = useState<string | null>(null);
  const [sent, setSent] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [msg, setMsg] = useState<string>("");
  const [f, setF] = useState({ name: "", phone: "", email: "", company: "", message: "" });
  const L = (en: string, ms: string) => (lang === "ms" ? ms : en);

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

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!slug) return;
    if (!f.name.trim() || !f.message.trim() || (!f.phone.trim() && !f.email.trim())) { setMsg(L("Please give your name, a message and a phone number or an email.", "Sila berikan nama, mesej dan nombor telefon atau emel.")); return; }
    setSent("sending"); setMsg("");
    const r = await api(`/public/portfolio/${slug}/enquiry`, { method: "POST", body: JSON.stringify(f), credentials: "omit" });
    if (r.ok) { setSent("sent"); setF({ name: "", phone: "", email: "", company: "", message: "" }); }
    else { setSent("error"); setMsg((r.data as { error?: { message?: string } } | null)?.error?.message ?? L("Not sent - please WhatsApp us instead.", "Tidak dihantar - sila WhatsApp kami.")); }
  };

  const switchLang = (l: Lang) => { setLang(l); setL(l); };

  if (p === undefined) return <main className={css.page}><div className={css.loading} aria-busy="true"><SkelRows rows={6} /></div></main>;
  if (p === null) {
    return (
      <main className={css.page}>
        <header className={css.bar}><Link href="/" aria-label="A2Z Creative Marketing"><img src="/logo.png" alt="A2Z Creative Marketing" className={css.logo} /></Link></header>
        <section className={css.missing} data-testid="portfolio-missing">
          <h1>{L("This portfolio is not available", "Portfolio ini tidak tersedia")}</h1>
          <p>{L("It may have been taken down or the link may be mistyped. You can still reach A2Z Creative Marketing directly.", "Ia mungkin telah dikeluarkan atau pautan tersilap. Anda masih boleh menghubungi A2Z Creative Marketing.")}</p>
          <p className={css.ctaRow}><a className={css.ctaGold} href={`https://wa.me/${CONTACT.whatsapp}`} target="_blank" rel="noopener"><MessageCircle aria-hidden /> WhatsApp A2Z</a><Link className={css.ctaGhost} href="/">a2zcreative.my</Link></p>
        </section>
        <CompanyFooter lang={lang} />
      </main>
    );
  }

  const name = titleCase(p.name);
  const email = p.email ?? CONTACT.email;
  const waNumber = p.phone ? p.phone.replace(/\D/g, "").replace(/^0/, "60") : CONTACT.whatsapp;
  const featured = p.items.filter((i) => i.featured);
  const gallery = p.items.filter((i) => i.kind === "image" && !i.featured);
  const videos = p.items.filter((i) => i.kind === "video" && !i.featured);
  const media = (id: number) => `/api/v1/public/portfolio/${p.slug}/media/${id}`;
  const socials = Object.entries(p.socials ?? {}).filter(([, v]) => v);


  return (
    <main className={css.page} data-testid="portfolio-page">
      <header className={css.bar}>
        <Link href="/" aria-label="A2Z Creative Marketing"><img src="/logo.png" alt="A2Z Creative Marketing" className={css.logo} /></Link>
        <span className={css.langs} role="group" aria-label="Language">
          <button type="button" aria-pressed={lang === "en"} onClick={() => switchLang("en")}>EN</button>
          <button type="button" aria-pressed={lang === "ms"} onClick={() => switchLang("ms")}>BM</button>
        </span>
      </header>

      <section className={css.hero}>
        <div className={css.heroText}>
          <p className={css.kicker}>{L("A2Z Creative Marketing · Team portfolio", "A2Z Creative Marketing · Portfolio pasukan")}</p>
          <h1 data-testid="portfolio-name">{name}</h1>
          {p.position && <p className={css.pill} data-testid="portfolio-position">{p.position}</p>}
          {p.department && <p className={css.dept}>{p.department}</p>}
          {p.tagline && <p className={css.tagline}>{p.tagline}</p>}
          <p className={css.ctaRow}>
            <a className={css.ctaGold} href="#enquire" data-testid="portfolio-enquire">{L("Work with me", "Bekerja dengan saya")}<ArrowRight aria-hidden /></a>
            <a className={css.ctaGhost} href={`https://wa.me/${waNumber}?text=${encodeURIComponent(L(`Hi, I saw ${name}'s portfolio on a2zcreative.my`, `Hai, saya lihat portfolio ${name} di a2zcreative.my`))}`} target="_blank" rel="noopener"><MessageCircle aria-hidden />WhatsApp</a>
          </p>
        </div>
        <div className={css.heroPhoto}>
          {p.has_photo
            ? <img src={`/api/v1/public/portfolio/${p.slug}/portrait`} alt={name} data-testid="portfolio-photo" />
            : <span className={css.initials} aria-hidden>{name.split(/\s+/).slice(0, 2).map((w) => w[0]).join("")}</span>}
        </div>
      </section>

      <div className={css.body}>
        <section className={css.facts} aria-label={L("At a glance", "Sepintas lalu")}>
          {p.position && <div><Briefcase aria-hidden /><span>{L("Position", "Jawatan")}</span><strong>{p.position}</strong></div>}
          {p.department && <div><Building2 aria-hidden /><span>{L("Department", "Jabatan")}</span><strong>{p.department}</strong></div>}
          {p.experience && <div><Star aria-hidden /><span>{L("Experience", "Pengalaman")}</span><strong>{p.experience}</strong></div>}
        </section>

        {p.intro && (
          <section className={css.section}>
            <h2>{L("About me", "Tentang saya")}</h2>
            <p className={css.intro}>{p.intro}</p>
          </section>
        )}

        {p.responsibilities.length > 0 && (
          <section className={css.section} data-testid="portfolio-duties">
            <h2>{L("Key responsibilities", "Tanggungjawab utama")}</h2>
            <ul className={css.ticks}>{p.responsibilities.map((t) => <li key={t}><Check aria-hidden />{t}</li>)}</ul>
          </section>
        )}

        {(p.specialties.length > 0 || p.expertise.length > 0) && (
          <section className={css.section}>
            <h2>{L("Expertise & specialties", "Kepakaran & keistimewaan")}</h2>
            <ul className={css.chips}>{[...p.specialties, ...p.expertise.filter((x) => !p.specialties.includes(x))].map((t) => <li key={t}>{t}</li>)}</ul>
          </section>
        )}

        {featured.length > 0 && (
          <section className={css.section}>
            <h2>{L("Featured projects", "Projek pilihan")}</h2>
            <div className={css.grid}>{featured.map((i) => <Work key={i.id} i={i} media={media} L={L} />)}</div>
          </section>
        )}
        {gallery.length > 0 && (
          <section className={css.section}>
            <h2>{L("Work gallery", "Galeri kerja")}</h2>
            <div className={css.grid}>{gallery.map((i) => <Work key={i.id} i={i} media={media} L={L} />)}</div>
          </section>
        )}
        {videos.length > 0 && (
          <section className={css.section}>
            <h2>{L("Video portfolio", "Portfolio video")}</h2>
            <div className={css.grid}>{videos.map((i) => <Work key={i.id} i={i} media={media} L={L} />)}</div>
          </section>
        )}

        <section className={css.enquire} id="enquire" data-testid="portfolio-form">
          <div>
            <h2>{L("Let's work together", "Mari bekerjasama")}</h2>
            <p>{L(`Tell ${name} and the A2Z team what you need. We reply within one working day.`, `Beritahu ${name} dan pasukan A2Z apa yang anda perlukan. Kami membalas dalam satu hari bekerja.`)}</p>
            <ul className={css.contact}>
              <li><Mail aria-hidden /><a href={`mailto:${email}`}>{email}</a></li>
              <li><Phone aria-hidden /><a href={`https://wa.me/${waNumber}`} target="_blank" rel="noopener">{p.phone ?? A2Z_CREATIVE.whatsapp}</a></li>
              <li><MapPin aria-hidden />Johor Bahru, Malaysia</li>
            </ul>
            {socials.length > 0 && <p className={css.socials}>{socials.map(([k, v]) => <a key={k} href={v} target="_blank" rel="noopener nofollow">{SOCIAL_LABEL[k] ?? k}</a>)}</p>}
          </div>
          {sent === "sent" ? (
            <p className={css.sent} role="status" data-testid="portfolio-sent">{L("Thank you - your message is with the A2Z team.", "Terima kasih - mesej anda telah diterima pasukan A2Z.")}</p>
          ) : (
            <form className={css.form} onSubmit={(e) => void send(e)} noValidate>
              <label>{L("Your name", "Nama anda")}<input value={f.name} maxLength={120} onChange={(e) => setF({ ...f, name: e.target.value })} required autoComplete="name" /></label>
              <label>{L("Company (optional)", "Syarikat (pilihan)")}<input value={f.company} maxLength={200} onChange={(e) => setF({ ...f, company: e.target.value })} autoComplete="organization" /></label>
              <label>{L("Phone", "Telefon")}<input type="tel" value={f.phone} maxLength={40} onChange={(e) => setF({ ...f, phone: e.target.value })} autoComplete="tel" /></label>
              <label>{L("Email", "Emel")}<input type="email" value={f.email} maxLength={200} onChange={(e) => setF({ ...f, email: e.target.value })} autoComplete="email" /></label>
              <label className={css.wide}>{L("How can we help?", "Bagaimana kami boleh membantu?")}<textarea rows={4} value={f.message} maxLength={2000} onChange={(e) => setF({ ...f, message: e.target.value })} required /></label>
              {msg && <p className={css.err} role="alert">{msg}</p>}
              <button type="submit" className={css.ctaGold} disabled={sent === "sending"} data-testid="portfolio-send">{sent === "sending" ? L("Sending...", "Menghantar...") : L("Send enquiry", "Hantar pertanyaan")}</button>
            </form>
          )}
        </section>
      </div>
      <CompanyFooter lang={lang} />
    </main>
  );
}

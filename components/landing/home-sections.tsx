/* Website restructure (18-11-2026, unreleased), second pass - the homepage.

   A Hero         the original navy hero lit like a studio, the brand
                  statement, the A-to-Z route (four stages, eight services),
                  Get a Free Consultation + View Our Work, WhatsApp
      Proof       the registered company, our companies, our client, the
                  channels we sell on - facts that can be checked
   B Services     the eight services on the route: four stages x two (4 x 2)
   C Work         real work as editorial rows (ELFIA, our own live channels,
                  AZ ONE OFFICIAL's website)
      Team        the three directors, real portraits, their own words
   D Why A2Z      four checkable reasons
   E Consult      WhatsApp, phone, email, address and a four-field form
   (F, the footer, is components/layout/footer.tsx.)

   Server components; only the enquiry form runs in the browser. Words come
   from constants/home-copy.ts, constants/services.ts and constants/team.ts. */

import {
  ArrowRight,
  ArrowUpRight,
  Building2,
  Check,
  Languages,
  Layers,
  Mail,
  MapPin,
  MessageCircle,
  Phone,
  ShieldCheck,
  Users,
} from "lucide-react";
import Link from "next/link";

import { EnquiryForm } from "@/components/landing/enquiry-form";
import { OUR_COMPANIES, PUBLISHABLE_CLIENTS, brandByCode } from "@/constants/brands";
import { CONTACT, HOME_MEDIA, LIVE_SHOWCASE } from "@/constants/content";
import { HOME_COPY } from "@/constants/home-copy";
import {
  SERVICE_PAGES,
  STAGES,
  displayPhone,
  serviceByKey,
  servicePath,
  serviceWhatsApp,
  type Lang,
  type ServiceKey,
} from "@/constants/services";
import { SITE_CONFIG } from "@/constants/site";
import { TEAM } from "@/constants/team";

import css from "./landing.module.css";

/* ---------------------------------------------------------------- A */
export function Hero({ lang }: { lang: Lang }) {
  const t = HOME_COPY[lang].hero;
  const r = HOME_COPY[lang].route;
  const wa = serviceWhatsApp(null, lang);
  return (
    <section id="top" className={css.hero} aria-labelledby="hero-title">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className={css.ghost} src="/logo-white.png" alt="" width={991} height={547} aria-hidden="true" />
      <div className={css.wrap}>
        <div className={css.heroInner}>
          <div>
            <p className={css.brandLine} data-no-translate>{t.eyebrow}</p>
            <h1 id="hero-title" className={css.heroTitle} data-no-translate>
              <span>{t.line1}</span>
              <span className={css.heroGold}>{t.line2}</span>
            </h1>
            <p className={css.heroLede}>{t.lede}</p>
            <div className={`${css.btnRow} ${css.heroCtas}`}>
              <a className={css.btnGold} href="#consultation">
                <span>{t.primary}</span>
                <ArrowRight aria-hidden="true" />
              </a>
              <a className={css.btnGhost} href="#work">
                <span>{t.secondary}</span>
              </a>
            </div>
          </div>
          <ul className={css.credits}>
            <li>
              <MapPin aria-hidden="true" />
              <div><strong>{t.facts[0]?.title}</strong><span>{t.facts[0]?.text}</span></div>
            </li>
            <li>
              <Languages aria-hidden="true" />
              <div><strong>{t.facts[2]?.title}</strong><span>{t.facts[2]?.text}</span></div>
            </li>
            <li>
              <MessageCircle aria-hidden="true" />
              <div>
                <strong>{t.whatsapp}</strong>
                <span><a href={wa} target="_blank" rel="noopener noreferrer" data-no-translate>{displayPhone()}</a></span>
              </div>
            </li>
          </ul>
        </div>

        <nav className={css.route} aria-label={r.label}>
          <div className={css.routeEnds} aria-hidden="true">
            <span><b>A</b>{r.a}</span>
            <span>{r.z}<b>Z</b></span>
          </div>
          <div className={css.track} aria-hidden="true" />
          <ol className={css.stops}>
            {STAGES.map((st, i) => (
              <li key={st.key} className={css.stop}>
                <span className={css.stopNum}>0{i + 1}</span>
                <span className={css.stopName}>{st[lang].name}</span>
                <ul>
                  {SERVICE_PAGES.filter((s) => s.stage === st.key).map((s) => (
                    <li key={s.key}><Link href={servicePath(s, lang)}>{s[lang].name}</Link></li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        </nav>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- proof */
export function ProofBar({ lang }: { lang: Lang }) {
  const t = HOME_COPY[lang].proof;
  return (
    <section className={css.proof} aria-label={t.registered}>
      <div className={css.wrap}>
        <div className={css.proofInner}>
          <div className={css.proofReg}>
            <strong>{t.registered}</strong>
            <span data-no-translate>{SITE_CONFIG.legalName}</span>
          </div>
          <div className={css.proofMarks}>
            <div className={css.proofGroup}>
              <span>{t.companies}</span>
              {OUR_COMPANIES.map((b) => (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img key={b.code} src={b.logo} alt={b.name} title={b.descriptor} />
              ))}
            </div>
            {PUBLISHABLE_CLIENTS.length > 0 && (
              <div className={css.proofGroup}>
                <span>{t.client}</span>
                {PUBLISHABLE_CLIENTS.map((b) => (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img key={b.code} src={b.logo} alt={b.name} />
                ))}
              </div>
            )}
          </div>
          <p className={css.proofChannels}>{t.channels}</p>
        </div>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- B */
export function ServicesGrid({ lang }: { lang: Lang }) {
  const t = HOME_COPY[lang].services;
  return (
    <section id="services" className={css.section} aria-labelledby="services-title">
      <div className={css.wrap}>
        <div className={`${css.head} ${css.headRow}`}>
          <h2 id="services-title" className={css.h2}>{t.title}</h2>
          <div>
            <p className={css.lede}>{t.lede}</p>
          </div>
        </div>
        <ol className={css.stages}>
          {STAGES.map((st, i) => (
            <li key={st.key} className={css.stage}>
              <div className={css.stageHead}>
                <span className={css.stageNum}>{t.stage} 0{i + 1}</span>
                <span className={css.stageName}>{st[lang].name}</span>
                <span className={css.stageLine}>{st[lang].line}</span>
              </div>
              <ul className={css.svcList}>
                {SERVICE_PAGES.filter((s) => s.stage === st.key).map((s) => {
                  const Icon = s.icon;
                  return (
                    <li key={s.key}>
                      <Link className={css.svc} href={servicePath(s, lang)}>
                        <span className={css.svcIcon} aria-hidden="true"><Icon /></span>
                        <h3 className={css.svcName}>{s[lang].name}</h3>
                        <ArrowRight className={css.svcArrow} aria-hidden="true" />
                        <p className={css.svcText}>{s[lang].card}</p>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- C */
interface Work {
  key: string;
  kind: string;
  title: string;
  text: string;
  did: ServiceKey[];
  href: string;
  linkText: string;
  logo?: string;
  handle?: string;
  handleSub?: string;
}

function works(lang: Lang): Work[] {
  const en = lang === "en";
  const elfia = brandByCode("elfia");
  const azone = brandByCode("azone");
  const handle = `@${LIVE_SHOWCASE.tiktokProfileUrl.split("@")[1] ?? ""}`;
  const host = (u: string) => u.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const out: Work[] = [];
  if (elfia?.permissionOnFile) {
    out.push({
      key: "elfia",
      kind: en ? "Client · Premium modestwear" : "Klien · Modestwear premium",
      title: elfia.name,
      text: en
        ? "ELFIA came to us with a premium product and no live presence. We built its live selling channel from zero - the session format, trained hosts, rundowns and the creative around every drop - and we run it end to end, together with the brand's own online store."
        : "ELFIA datang kepada kami dengan produk premium tetapi tiada kehadiran live. Kami membina saluran jualan livenya dari kosong - format sesi, host terlatih, rundown dan kreatif untuk setiap drop - dan menguruskannya sepenuhnya, bersama kedai dalam talian jenama itu sendiri.",
      did: ["live-commerce", "live-host", "design", "website"],
      href: elfia.url,
      linkText: host(elfia.url),
      logo: elfia.logoOnDark,
    });
  }
  out.push({
    key: "live",
    kind: en ? "Our own channels" : "Saluran kami sendiri",
    title: en ? "Live on TikTok and Shopee, every week" : "Live di TikTok dan Shopee, setiap minggu",
    text: en
      ? "We run our own live channels with the same hosts, studio and moderation we bring to clients. It is where we test formats before we recommend them - so our advice comes from the seller's chair."
      : "Kami menguruskan saluran live kami sendiri dengan host, studio dan moderasi yang sama untuk klien. Di sinilah kami menguji format sebelum mencadangkannya - jadi nasihat kami datang daripada pengalaman menjual sendiri.",
    did: ["live-host", "live-commerce", "mobilegraphy", "studio"],
    href: LIVE_SHOWCASE.tiktokProfileUrl,
    linkText: en ? `${handle} on TikTok` : `${handle} di TikTok`,
    handle,
    handleSub: "TikTok Live · Shopee Live",
  });
  if (azone) {
    out.push({
      key: "azone",
      kind: en ? "Our consultancy company" : "Syarikat perundingan kami",
      title: azone.name,
      text: en
        ? "The consultancy company of our group needed to present as seriously as it works. We built its positioning, its website and an enquiry desk that takes a lead from first message to proposal."
        : "Syarikat perundingan dalam kumpulan kami perlu tampil seyakin cara ia bekerja. Kami membina penjenamaannya, laman webnya dan meja pertanyaan yang membawa setiap pertanyaan hingga ke cadangan.",
      did: ["website", "design"],
      href: azone.url,
      linkText: host(azone.url),
      logo: azone.logoOnDark,
    });
  }
  return out;
}

export function SelectedWork({ lang }: { lang: Lang }) {
  const t = HOME_COPY[lang].work;
  return (
    <section id="work" className={`${css.section} ${css.grey}`} aria-labelledby="work-title">
      <div className={css.wrap}>
        <div className={`${css.head} ${css.headRow}`}>
          <h2 id="work-title" className={css.h2}>{t.title}</h2>
          <div>
            <p className={css.lede}>{t.lede}</p>
          </div>
        </div>
        <ul className={css.works}>
          {works(lang).map((w) => {
            const photo = HOME_MEDIA.work[w.key];
            return (
              <li key={w.key} className={css.workRow}>
                <div className={css.workMedia}>
                  {photo?.src ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img className={css.workPhoto} src={photo.src} alt={photo.alt} loading="lazy" />
                  ) : w.logo ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img className={css.workLogo} src={w.logo} alt="" loading="lazy" />
                  ) : (
                    <div>
                      <span className={css.workHandle} data-no-translate>{w.handle}</span>
                      <span className={css.workHandleSub} data-no-translate>{w.handleSub}</span>
                    </div>
                  )}
                  <span className={css.workKind}>{w.kind}</span>
                </div>
                <div>
                  <h3 className={css.workTitle} data-no-translate={w.key !== "live" || undefined}>{w.title}</h3>
                  <p className={css.workText}>{w.text}</p>
                  <ul className={css.did}>
                    {w.did.map((k) => {
                      const s = serviceByKey(k);
                      return <li key={k}><Link href={servicePath(s, lang)}>{s[lang].name}</Link></li>;
                    })}
                  </ul>
                  <a className={css.workLink} href={w.href} target="_blank" rel="noopener noreferrer">
                    <span data-no-translate>{w.linkText}</span>
                    <ArrowUpRight aria-hidden="true" />
                  </a>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- team */
export function Team({ lang }: { lang: Lang }) {
  const t = HOME_COPY[lang].team;
  /* the order the company presents its directors: CEO, COO, CCO */
  const order = ["farhan", "zoll", "izz"];
  const people = [...TEAM].sort((a, b) => order.indexOf(a.slug) - order.indexOf(b.slug)).filter((m) => m.photo);
  if (!people.length) return null;
  return (
    <section id="team" className={css.section} aria-labelledby="team-title">
      <div className={css.wrap}>
        <div className={`${css.head} ${css.headRow}`}>
          <h2 id="team-title" className={css.h2}>{t.title}</h2>
          <div>
            <p className={css.lede}>{t.lede}</p>
          </div>
        </div>
        <ul className={css.people}>
          {people.map((m) => (
            <li key={m.slug} className={css.person}>
              <div className={css.portrait}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={m.photo} alt={`${m.known[lang]}, ${m.role[lang]}`} loading="lazy" width={640} height={640} />
              </div>
              <h3 className={css.personName} data-no-translate>{m.known[lang]}</h3>
              <p className={css.personRole}>{m.role[lang]}</p>
              <p className={css.personLead}>{m.lead[lang]}</p>
              <Link href={`/${m.slug}`}>{t.card}</Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- D */
const WHY_ICONS = [ShieldCheck, Building2, Layers, Users] as const;

export function WhyA2z({ lang }: { lang: Lang }) {
  const t = HOME_COPY[lang].why;
  return (
    <section id="why" className={`${css.section} ${css.dark}`} aria-labelledby="why-title">
      <div className={css.wrap}>
        <div className={css.head}>
          <h2 id="why-title" className={css.h2}>{t.title}</h2>
        </div>
        <ul className={css.whyGrid}>
          {t.points.map((p, i) => {
            const Icon = WHY_ICONS[i] ?? Check;
            return (
              <li key={p.title} className={css.whyItem}>
                <Icon aria-hidden="true" />
                <div>
                  <h3>{p.title}</h3>
                  <p>{p.text}</p>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- E */
export function Consultation({ lang }: { lang: Lang }) {
  const t = HOME_COPY[lang].consult;
  const wa = serviceWhatsApp(null, lang);
  return (
    <section id="consultation" className={`${css.section} ${css.grey}`} aria-labelledby="consult-title">
      <div className={css.wrap}>
        <div className={css.consult}>
          <div className={css.consultSide}>
            <h2 id="consult-title" className={css.h2}>{t.title}</h2>
            <p className={css.lede}>{t.lede}</p>
            <div className={`${css.btnRow} ${css.heroCtas}`}>
              <a className={css.btnGold} href={wa} target="_blank" rel="noopener noreferrer">
                <MessageCircle aria-hidden="true" />
                <span>{HOME_COPY[lang].hero.whatsapp}</span>
              </a>
            </div>
            <ContactList lang={lang} />
            <p className={css.hours}>{t.hours}</p>
          </div>
          <EnquiryForm lang={lang} />
        </div>
      </div>
    </section>
  );
}

export function ContactList({ lang }: { lang: Lang }) {
  const t = HOME_COPY[lang].consult;
  const wa = serviceWhatsApp(null, lang);
  return (
    <ul className={css.contactList}>
      <li className={css.contactItem}>
        <MessageCircle aria-hidden="true" />
        <div><strong>{t.whatsapp}</strong><a href={wa} target="_blank" rel="noopener noreferrer" data-no-translate>{displayPhone()}</a></div>
      </li>
      <li className={css.contactItem}>
        <Phone aria-hidden="true" />
        <div><strong>{t.call}</strong><a href={`tel:+${CONTACT.whatsapp}`} data-no-translate>{displayPhone()}</a></div>
      </li>
      <li className={css.contactItem}>
        <Mail aria-hidden="true" />
        <div><strong>{t.email}</strong><a href={`mailto:${CONTACT.email}`} data-no-translate>{CONTACT.email}</a></div>
      </li>
      <li className={css.contactItem}>
        <MapPin aria-hidden="true" />
        <div><strong>{t.visit}</strong><span data-no-translate>{SITE_CONFIG.address}</span></div>
      </li>
    </ul>
  );
}

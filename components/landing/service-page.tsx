/* Website restructure (18-11-2026, unreleased) - ONE SERVICE PAGE, English or Bahasa Melayu (the owner's brief,
   18-11-2026, section 4). /services/<slug> and /ms/services/<slug> both
   render this from constants/services.ts.

   Order: breadcrumbs + H1 + intro on the navy band, then What's included,
   Who it's for, How it works, Our work (real work only - left out when there
   is none), Where we work, FAQs; beside it the quotation box (WhatsApp with
   this service's message, the number, the enquiry form); then related
   services and the other services, and a closing call to action.

   Structured data: Service, FAQPage and BreadcrumbList, all from the same
   words the visitor reads. */
import { ArrowRight, ArrowUpRight, Check, MessageCircle } from "lucide-react";
import Link from "next/link";

import { EnquiryForm } from "@/components/landing/enquiry-form";
import { Footer } from "@/components/layout/footer";
import { Navbar } from "@/components/layout/navbar";
import { PAGE_WORDS } from "@/constants/home-copy";
import {
  SERVICE_PAGES,
  STAGES,
  displayPhone,
  serviceByKey,
  servicePath,
  serviceWhatsApp,
  type Lang,
  type ServiceDef,
} from "@/constants/services";
import { SITE_CONFIG } from "@/constants/site";

import css from "./landing.module.css";

function jsonLd(s: ServiceDef, lang: Lang) {
  const c = s[lang];
  const w = PAGE_WORDS[lang];
  const url = `${SITE_CONFIG.url}${servicePath(s, lang)}`;
  const home = `${SITE_CONFIG.url}${lang === "ms" ? "/ms" : "/"}`;
  return [
    {
      "@context": "https://schema.org",
      "@type": "Service",
      "@id": `${url}#service`,
      name: c.name,
      serviceType: s.serviceType,
      description: c.seoDescription,
      url,
      inLanguage: lang === "ms" ? "ms-MY" : "en-MY",
      provider: { "@id": `${SITE_CONFIG.url}/#organization` },
      areaServed:
        s.area === "johor"
          ? [{ "@type": "City", name: "Johor Bahru" }, { "@type": "State", name: "Johor" }]
          : [{ "@type": "Country", name: "Malaysia" }],
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: c.faqs.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: w.home, item: home },
        { "@type": "ListItem", position: 2, name: w.services, item: `${SITE_CONFIG.url}/services` },
        { "@type": "ListItem", position: 3, name: c.name, item: url },
      ],
    },
  ];
}

export function ServicePage({ s, lang }: { s: ServiceDef; lang: Lang }) {
  const c = s[lang];
  const w = PAGE_WORDS[lang];
  const wa = serviceWhatsApp(s, lang);
  const Icon = s.icon;
  const work = s.work(lang);
  const related = s.related.map(serviceByKey);
  const others = SERVICE_PAGES.filter((x) => x.key !== s.key && !s.related.includes(x.key));
  return (
    <>
      <Navbar />
      <main lang={lang === "ms" ? "ms" : undefined}>
        <section className={css.svcHero} aria-labelledby="svc-title">
          <div className={css.wrap}>
            <nav aria-label={lang === "ms" ? "Laluan" : "Breadcrumb"}>
              <ol className={css.crumbs}>
                <li><Link href={lang === "ms" ? "/ms" : "/"}>{w.home}</Link></li>
                <li><Link href="/services">{w.services}</Link></li>
                <li aria-current="page">{c.name}</li>
              </ol>
            </nav>
            <div className={css.svcTitleRow}>
              <span className={css.svcBadge} aria-hidden="true"><Icon /></span>
              <p className={css.svcLabel}>
                {c.name}
                <small>{lang === "ms" ? "Peringkat" : "Stage"} {STAGES.findIndex((x) => x.key === s.stage) + 1} · {STAGES.find((x) => x.key === s.stage)?.[lang].name}</small>
              </p>
            </div>
            <h1 id="svc-title" className={css.svcH1}>{c.h1}</h1>
            <p className={css.svcIntro}>{c.intro}</p>
            <div className={`${css.btnRow} ${css.heroCtas}`}>
              <a className={css.btnGold} href={wa} target="_blank" rel="noopener noreferrer">
                <MessageCircle aria-hidden="true" />
                <span>{w.quote}</span>
              </a>
              <a className={css.btnGhost} href="#enquiry">{w.enquire}</a>
            </div>
            <ol className={css.mini} aria-label={lang === "ms" ? "Laluan A2Z" : "The A2Z route"}>
              {STAGES.map((st, i) => (
                <li key={st.key} className={st.key === s.stage ? css.on : undefined} aria-current={st.key === s.stage ? "step" : undefined}>
                  0{i + 1}<b>{st[lang].name}</b>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className={css.section}>
          <div className={css.wrap}>
            <div className={css.svcGrid}>
              <div>
                <div className={css.svcBlock}>
                  <h2 className={css.h3}>{w.included}</h2>
                  <ul className={`${css.ticks} ${css.ticks2}`}>{c.scope.map((x) => <li key={x}><Check aria-hidden="true" /><span>{x}</span></li>)}</ul>
                </div>
                <div className={css.svcBlock}>
                  <h2 className={css.h3}>{w.forWho}</h2>
                  <ul className={css.ticks}>{c.forWho.map((x) => <li key={x}><Check aria-hidden="true" /><span>{x}</span></li>)}</ul>
                </div>
                <div className={css.svcBlock}>
                  <h2 className={css.h3}>{w.how}</h2>
                  <ol className={css.steps}>
                    {c.steps.map((x) => <li key={x.title}><strong>{x.title}</strong><span>{x.text}</span></li>)}
                  </ol>
                </div>
                {work.length > 0 && (
                  <div className={css.svcBlock}>
                    <h2 className={css.h3}>{w.work}</h2>
                    <ul className={css.workList}>
                      {work.map((x) => (
                        <li key={x.name + x.href} className={css.workItem}>
                          <div>
                            <strong data-no-translate>{x.name}</strong>
                            <span>{x.what}</span>
                          </div>
                          {x.external ? (
                            <a className={css.textLink} href={x.href} target="_blank" rel="noopener noreferrer">
                              {w.visit}<ArrowUpRight aria-hidden="true" />
                            </a>
                          ) : (
                            <Link className={css.textLink} href={x.href}>{w.visit}<ArrowRight aria-hidden="true" /></Link>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <div className={css.svcBlock}>
                  <h2 className={css.h3}>{w.coverage}</h2>
                  <p className={css.body}>{c.coverage}</p>
                </div>
                <div className={css.svcBlock}>
                  <h2 className={css.h3}>{w.faq}</h2>
                  <div className={css.faq}>
                    {c.faqs.map((f) => (
                      <details key={f.q}>
                        <summary>{f.q}</summary>
                        <p>{f.a}</p>
                      </details>
                    ))}
                  </div>
                </div>
              </div>

              <aside className={css.aside} id="enquiry" aria-label={w.quote}>
                <div className={css.quote}>
                  <h2>{c.name}</h2>
                  <p>{w.ctaText}</p>
                  <a className={css.btnGold} href={wa} target="_blank" rel="noopener noreferrer">
                    <MessageCircle aria-hidden="true" />
                    <span>{w.quote}</span>
                  </a>
                  <span className={css.quoteFoot}>
                    WhatsApp <a href={wa} target="_blank" rel="noopener noreferrer" data-no-translate>{displayPhone()}</a>
                  </span>
                </div>
                <EnquiryForm lang={lang} service={s.key} />
              </aside>
            </div>
          </div>
        </section>

        <section className={`${css.section} ${css.grey}`} aria-labelledby="related-title">
          <div className={css.wrap}>
            <h2 id="related-title" className={css.h3}>{w.related}</h2>
            <ul className={css.related}>
              {related.map((r) => {
                const RIcon = r.icon;
                return (
                  <li key={r.key}>
                    <Link className={css.svc} href={servicePath(r, lang)}>
                      <span className={css.svcIcon} aria-hidden="true"><RIcon /></span>
                      <h3 className={css.svcName}>{r[lang].name}</h3>
                      <ArrowRight className={css.svcArrow} aria-hidden="true" />
                      <p className={css.svcText}>{r[lang].card}</p>
                    </Link>
                  </li>
                );
              })}
            </ul>
            <ul className={css.otherList} aria-label={w.other}>
              {others.map((o) => <li key={o.key}><Link href={servicePath(o, lang)}>{o[lang].name}</Link></li>)}
            </ul>
          </div>
        </section>

        <section className={css.band}>
          <div className={css.wrap}>
            <div className={css.bandInner}>
              <div>
                <h2>{w.ctaTitle} {c.name}?</h2>
                <p>{w.ctaText}</p>
              </div>
              <a className={css.btnGold} href={wa} target="_blank" rel="noopener noreferrer">
                <MessageCircle aria-hidden="true" />
                <span>{w.consult}</span>
              </a>
            </div>
          </div>
        </section>
      </main>
      <Footer />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd(s, lang)) }} />
    </>
  );
}

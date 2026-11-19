import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import css from "@/components/landing/landing.module.css";
import { Footer } from "@/components/layout/footer";
import { Navbar } from "@/components/layout/navbar";
import { PAGE_WORDS } from "@/constants/home-copy";
import { SERVICE_PAGES, STAGES, servicePath } from "@/constants/services";

/* Website restructure (18-11-2026, unreleased) - the services hub: the eight official services, each linking to
   its own page. The old /services anchors are kept on the nearest card (or
   on the consultancy note), so a bookmarked /services#live-host-service
   still lands on the right thing. */
export const metadata: Metadata = {
  title: { absolute: "Services — Live Commerce, Studio, Video & Websites | A2Z" },
  description:
    "A2Z Creative Marketing's eight services in Johor Bahru: live host, live commerce management, studio rental, product video, creative design, mobilegraphy, websites and affiliate marketing.",
  alternates: { canonical: "/services" },
};

/* the anchors the old /services page had, by service */
const OLD_ANCHORS: Partial<Record<string, string>> = {
  "live-host": "live-host-service",
  "live-commerce": "live-commerce-management",
  video: "content-creation-and-video",
  design: "creative-marketing",
};

export default function ServicesPage() {
  const w = PAGE_WORDS.en;
  return (
    <>
      <Navbar />
      <main>
        <section className={css.svcHero} aria-labelledby="hub-title">
          <div className={css.wrap}>
            <nav aria-label="Breadcrumb">
              <ol className={css.crumbs}>
                <li><Link href="/">{w.home}</Link></li>
                <li aria-current="page">{w.services}</li>
              </ol>
            </nav>
            <p className={css.svcName}>{w.services}</p>
            <h1 id="hub-title" className={css.svcH1}>Everything your brand needs to be seen and to sell</h1>
            <p className={css.svcIntro}>{w.hubIntro}</p>
          </div>
        </section>
        <section className={css.section}>
          <div className={css.wrap}>
            <ol className={css.stages}>
              {STAGES.map((st, i) => (
                <li key={st.key} className={css.stage}>
                  <div className={css.stageHead}>
                    <span className={css.stageNum}>Stage 0{i + 1}</span>
                    <span className={css.stageName}>{st.en.name}</span>
                    <span className={css.stageLine}>{st.en.line}</span>
                  </div>
                  <ul className={css.svcList}>
                    {SERVICE_PAGES.filter((s) => s.stage === st.key).map((s) => {
                      const Icon = s.icon;
                      return (
                        <li key={s.key} id={OLD_ANCHORS[s.key]}>
                          <Link className={css.svc} href={servicePath(s, "en")}>
                            <span className={css.svcIcon} aria-hidden="true"><Icon /></span>
                            <h2 className={css.svcName}>{s.en.name}</h2>
                            <ArrowRight className={css.svcArrow} aria-hidden="true" />
                            <p className={css.svcText}>{s.en.card}</p>
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
        <section className={`${css.section} ${css.grey}`} id="digital-marketing">
          <div className={css.wrap} id="consultancy-and-business-development">
            <h2 className={css.h3}>{w.consultancyTitle}</h2>
            <p className={css.body}>{w.consultancyText}</p>
            <div className={`${css.btnRow} ${css.heroCtas}`}>
              <Link className={css.btnNavy} href="/consultancy">{w.seeConsultancy}</Link>
              <Link className={css.btnLine} href="/packages">{w.seePackages}</Link>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}

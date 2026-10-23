/* v1.195.0 - SELECTED WORK, on the owner's mockup: image cards with a label,
   a title, a line and an arrow. Only real work: the two named entries in
   PORTFOLIO_ITEMS (ELFIA, a client named on the CEO's recorded permission,
   and AZ ONE OFFICIAL, our sister company) and the published case study.
   No invented clients or projects. A card shows a real photograph when one
   is set in HOME_MEDIA.work; until then it is the brand's own mark on its
   colour - never a stock image pretending to be ours. */

import { ArrowRight, BookOpenText } from "lucide-react";
import Link from "next/link";

import { Reveal } from "@/components/ui/reveal";
import { BRANDS } from "@/constants/brands";
import { HOME_MEDIA } from "@/constants/content";
import { CASE_STUDIES, PORTFOLIO_ITEMS } from "@/constants/pages";

import css from "./home.module.css";

const BG: Record<string, string | undefined> = { elfia: css.bgElfia, azone: css.bgAzone };

export function Work() {
  const study = CASE_STUDIES[0];
  return (
    <section id="work" className={css.section}>
      <div className={css.wrap}>
        <div className={css.head}>
          <div>
            <p className={css.eyebrow}>Our work</p>
            <h2 className={css.h2}>Selected work</h2>
          </div>
          <div className={css.headAside}>
            <p className={css.lede}>Real channels we built and run. Clients are shown anonymised unless they have given us permission to name them.</p>
            <Link className={css.btnLine} href="/portfolio">
              <span>View all work</span>
              <ArrowRight aria-hidden="true" />
            </Link>
          </div>
        </div>
        <ul className={css.work} role="list">
          {PORTFOLIO_ITEMS.map((item, i) => {
            const brand = BRANDS.find((b) => b.name === item.client);
            const code = brand?.code ?? "";
            const photo = HOME_MEDIA.work[code];
            const body = (
              <>
                {photo?.src ? (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img className={css.workPhoto} src={photo.src} alt={photo.alt} loading="lazy" />
                  </>
                ) : (
                  <>
                    <span className={`${css.workBg} ${BG[code] ?? css.bgAzone}`} aria-hidden="true" />
                    {brand?.logoOnDark && (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img className={css.workLogo} src={brand.logoOnDark} alt="" loading="lazy" />
                    )}
                  </>
                )}
                <span className={css.workShade} aria-hidden="true" />
                {item.role && <span className={css.workChip}>{item.role}</span>}
                <div className={css.workFoot}>
                  <div>
                    <h3 className={css.workTitle} data-no-translate>{item.client}</h3>
                    <p className={`${css.workSub} ${css.clamp2}`}>{item.summary}</p>
                  </div>
                  <span className={css.arrow} aria-hidden="true"><ArrowRight /></span>
                </div>
              </>
            );
            return (
              <li key={item.client}>
                <Reveal delay={i * 0.08} className={css.fill100}>
                  {item.href
                    ? <a className={css.workCard} href={item.href} target="_blank" rel="noopener noreferrer" aria-label={`${item.client} — ${item.role ?? ""}`}>{body}</a>
                    : <Link className={css.workCard} href="/portfolio">{body}</Link>}
                </Reveal>
              </li>
            );
          })}
          {study && (
            <li>
              <Reveal delay={PORTFOLIO_ITEMS.length * 0.08} className={css.fill100}>
                <Link className={css.workCard} href="/case-studies">
                  <span className={`${css.workBg} ${css.bgCase}`} aria-hidden="true" />
                  <span className={css.workMark} aria-hidden="true"><BookOpenText /></span>
                  <span className={css.workShade} aria-hidden="true" />
                  <span className={css.workChip}>Case study</span>
                  <div className={css.workFoot}>
                    <div>
                      <h3 className={css.workTitle}>{study.title}</h3>
                      <p className={css.workSub}>{study.client}</p>
                    </div>
                    <span className={css.arrow} aria-hidden="true"><ArrowRight /></span>
                  </div>
                </Link>
              </Reveal>
            </li>
          )}
        </ul>
      </div>
    </section>
  );
}

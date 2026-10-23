/* v1.197.0 - SELECTED WORK, as on the owner's mockup: four wide picture
   cards across the page - a category chip, a title, the services as a line,
   a round arrow - and "View all work". A swipe row on a phone.
   Only real work: ELFIA (named on the CEO's recorded permission), our own
   TikTok live channel, the published case study and AZ ONE OFFICIAL, our
   sister company. No invented clients or projects. A card shows a real
   photograph when one is set in HOME_MEDIA.work; until then it is the
   brand's own mark on its colour - never a stock image pretending to be ours. */

import { ArrowRight, BookOpenText } from "lucide-react";
import Link from "next/link";

import { Reveal } from "@/components/ui/reveal";
import { BRANDS } from "@/constants/brands";
import { HOME_MEDIA, LIVE_SHOWCASE } from "@/constants/content";
import { CASE_STUDIES, PORTFOLIO_ITEMS } from "@/constants/pages";

import css from "./home.module.css";

interface Card {
  key: string;
  chip: string;
  title: string;
  /** a brand or handle - never translated */
  titleIsName: boolean;
  line: string;
  href: string;
  external: boolean;
  bg: string | undefined;
  logo?: string;
  mark?: "case" | "live";
}

/* the chip and the services line for each real portfolio entry */
const TAGS: Record<string, { chip: string; line: string }> = {
  elfia: { chip: "Fashion Live", line: "Live Commerce • Online Store • Content" },
  azone: { chip: "Brand & Website", line: "Positioning • Website • Lead Desk" },
};

function cards(): Card[] {
  const out: Card[] = [];
  const items = PORTFOLIO_ITEMS.map((item) => {
    const brand = BRANDS.find((b) => b.name === item.client);
    const code = brand?.code ?? item.client;
    const tag = TAGS[code];
    return {
      key: code,
      chip: tag?.chip ?? item.role ?? "",
      title: item.client,
      titleIsName: true,
      line: tag?.line ?? item.summary,
      href: item.href ?? "/portfolio",
      external: Boolean(item.href),
      bg: code === "elfia" ? css.bgElfia : css.bgAzone,
      logo: brand?.logoOnDark,
    } satisfies Card;
  });
  const [first, ...rest] = items;
  if (first) out.push(first);
  out.push({
    key: "live",
    chip: "TikTok Live Commerce",
    title: "Our live channel",
    titleIsName: false,
    line: "Live Sessions • Hosting • Short-form Cuts",
    href: LIVE_SHOWCASE.tiktokProfileUrl,
    external: true,
    bg: css.bgLive,
    mark: "live",
  });
  const study = CASE_STUDIES[0];
  if (study) {
    out.push({
      key: "case",
      chip: "Case Study",
      title: "Premium Modestwear Label",
      titleIsName: false,
      line: "Strategy • Live Management • Hosts",
      href: "/case-studies",
      external: false,
      bg: css.bgCase,
      mark: "case",
    });
  }
  out.push(...rest);
  return out;
}

function CardBody({ c }: { c: Card }) {
  const photo = HOME_MEDIA.work[c.key];
  return (
    <>
      {photo?.src ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img className={css.workPhoto} src={photo.src} alt={photo.alt} loading="lazy" />
      ) : (
        <>
          <span className={`${css.workBg} ${c.bg ?? css.bgAzone}`} aria-hidden="true" />
          {c.logo && (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img className={css.workLogo} src={c.logo} alt="" loading="lazy" />
          )}
          {c.mark === "case" && <span className={css.workMark} aria-hidden="true"><BookOpenText /></span>}
          {c.mark === "live" && (
            <span className={css.workLive} aria-hidden="true">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo-white.png" alt="" width={991} height={547} loading="lazy" />
              <span className={css.liveChip}><span className={css.liveDot} />LIVE</span>
            </span>
          )}
        </>
      )}
      <span className={css.workShade} aria-hidden="true" />
      <span className={css.workChip}>{c.chip}</span>
      <div className={css.workFoot}>
        <div>
          <h3 className={css.workTitle} data-no-translate={c.titleIsName || undefined}>{c.title}</h3>
          <p className={css.workSub}>{c.line}</p>
        </div>
        <span className={css.arrow} aria-hidden="true"><ArrowRight /></span>
      </div>
    </>
  );
}

export function Work() {
  return (
    <section id="work" className={`${css.section} ${css.sectionTight} ${css.tint}`}>
      <div className={css.wrap}>
        <div className={css.head}>
          <div>
            <p className={css.eyebrow}>Our work</p>
            <h2 className={css.h2}>Selected Work</h2>
          </div>
          <div className={`${css.headAside} ${css.headRow}`}>
            <p className={`${css.lede} ${css.ledeSm}`}>Real projects and the channels we built and still run. Clients are named only with their permission.</p>
            <Link className={css.btnLine} href="/portfolio">
              <span>View all work</span>
              <ArrowRight aria-hidden="true" />
            </Link>
          </div>
        </div>
      </div>
      <Reveal>
      <ul className={css.work} role="list">
        {cards().map((c) => (
          <li key={c.key}>
            <div className={css.fill100}>
              {c.external
                ? <a className={css.workCard} href={c.href} target="_blank" rel="noopener noreferrer"><CardBody c={c} /></a>
                : <Link className={css.workCard} href={c.href}><CardBody c={c} /></Link>}
            </div>
          </li>
        ))}
      </ul>
      </Reveal>
    </section>
  );
}

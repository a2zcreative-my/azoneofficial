/* v1.197.0 - SERVICES, as on the owner's mockup: right after the hero, six
   compact cards in one row on a wide screen (two by two by two on a phone),
   each a tinted icon, a short name, one line and a round arrow. The one
   line is the short form of the service's description in SERVICES; the
   full text stays on /services, where each card's arrow lands on its own
   service. The title and intro keep their Admin -> Content keys. */

import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { Editable } from "@/components/live/editable";
import { Reveal } from "@/components/ui/reveal";
import { SERVICES, serviceSlug } from "@/constants/content";

import css from "./home.module.css";

const TINT = [css.tGold, css.tBlue, css.tRed, css.tGreen, css.tPurple, css.tGold];
/* the short name and one line per service, in SERVICES order */
const SHORT: readonly { name: string; line: string }[] = [
  { name: "Creative Marketing", line: "Turn ideas into campaigns that get attention and drive sales." },
  { name: "Digital Marketing", line: "Grow your brand with strategic digital campaigns." },
  { name: "Live Commerce Management", line: "End-to-end TikTok Live management to boost sales." },
  { name: "Live Host Service", line: "Professional BM & English live hosts for your brand." },
  { name: "Content Creation", line: "Content production for social media and live commerce." },
  { name: "Consultancy", line: "Practical guidance to scale your brand and grow revenue." },
];

export function Services() {
  return (
    <section id="services" className={`${css.section} ${css.sectionTight}`}>
      <div className={css.wrap}>
        <div className={css.head}>
          <div>
            <p className={css.eyebrow}>Our services</p>
            <h2 className={css.h2}><Editable k="home.services.title" fallback="Everything a brand needs to grow" /></h2>
          </div>
          <p className={`${css.lede} ${css.ledeSm}`}>
            <Editable
              k="home.services.intro"
              fallback={
                <>
                  From strategy and creative production to live commerce management, we provide end-to-end solutions to help your business{" "}
                  <strong className={css.ledeStrong}>Stand Out, Get Seen and Sell More.</strong>
                </>
              }
            />
          </p>
        </div>
        <ul className={css.services} role="list">
          {SERVICES.map((service, i) => {
            const Icon = service.icon;
            const short = SHORT[i];
            const href = i === 5 ? "/consultancy" : `/services#${serviceSlug(service.title)}`;
            return (
              <li key={service.title}>
                <Reveal delay={(i % 6) * 0.05} className={css.fill100}>
                  <Link href={href} className={css.serviceCard}>
                    <span className={`${css.serviceIcon} ${TINT[i] ?? css.tGold}`}><Icon aria-hidden="true" /></span>
                    <h3 className={css.serviceTitle}>{short?.name ?? service.title}</h3>
                    <p className={css.serviceText}>{short?.line ?? service.description}</p>
                    <span className={`${css.arrow} ${css.serviceArrow}`} aria-hidden="true"><ArrowRight /></span>
                  </Link>
                </Reveal>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

"use client";

/* v1.195.0 - TRUST & CREDIBILITY, then who we are. The four credentials are
   TRUST_SIGNALS - facts true today (the SSM registration, the channel we run,
   the team in Johor Bahru, BM and English hosts). No invented clients,
   counts or awards: STATISTICS stays the only place a number can come from,
   and it renders only when it holds real figures. The three paragraphs keep
   their Admin -> Content keys (about.body1..3); the companies row is
   OUR_COMPANIES from constants/brands.ts, the businesses the group owns. */

import { BadgeCheck, Languages, MapPin, Store } from "lucide-react";
import Link from "next/link";
import type { ComponentType, SVGProps } from "react";

import { Editable } from "@/components/live/editable";
import { Reveal } from "@/components/ui/reveal";
import { OUR_COMPANIES } from "@/constants/brands";
import { ABOUT, STATISTICS, TRUST_SIGNALS } from "@/constants/content";

import css from "./home.module.css";

const ICONS: ComponentType<SVGProps<SVGSVGElement>>[] = [BadgeCheck, Store, MapPin, Languages];

export function About() {
  return (
    <section id="about" className={css.section}>
      <div className={css.wrap}>
        <div className={css.head}>
          <div>
            <p className={css.eyebrow}>{ABOUT.eyebrow}</p>
            <h2 className={css.h2}>{ABOUT.title}</h2>
          </div>
          <p className={css.lede}>A registered Malaysian company with its own team, studio and live channel — here is what you can check before you call us.</p>
        </div>

        <ul className={css.creds}>
          {TRUST_SIGNALS.map((signal, i) => {
            const Icon = ICONS[i % ICONS.length] ?? BadgeCheck;
            return (
              <li key={signal.label}>
                <Reveal delay={i * 0.06} className={css.cred}>
                  <span className={css.credIcon}><Icon aria-hidden="true" /></span>
                  <p className={css.credTitle}>{signal.label}</p>
                  <p className={css.credText}>{signal.description}</p>
                </Reveal>
              </li>
            );
          })}
        </ul>

        <div className={css.aboutGrid}>
          <Reveal className={css.aboutBody}>
            {ABOUT.body.map((paragraph, i) => (
              <p key={paragraph}>
                <Editable k={`about.body${i + 1}`} fallback={paragraph} />
              </p>
            ))}
          </Reveal>
          <Reveal delay={0.08} className={css.companies}>
            <p className={css.companiesLabel}>Our companies</p>
            {OUR_COMPANIES.map((b) => {
              const inner = (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img className={css.companyLogo} src={b.logo} alt="" loading="lazy" />
                  <span>
                    <span className={css.companyName}>{b.name}</span>
                    <span className={css.companyMeta}>{b.descriptor}</span>
                    {b.registration && <span className={css.companyMeta} data-no-translate>{b.registration}</span>}
                  </span>
                </>
              );
              /* our own company opens About; a sister company its own site */
              return b.code === "a2z"
                ? <Link key={b.code} className={css.company} href="/about">{inner}</Link>
                : <a key={b.code} className={css.company} href={b.url} target="_blank" rel="noopener noreferrer">{inner}</a>;
            })}
            {STATISTICS.length > 0 && (
              <div className={css.stats}>
                {STATISTICS.map((s) => (
                  <p key={s.label} className={css.stat}>
                    <strong>{s.value}{s.suffix}</strong>
                    <span>{s.label}</span>
                  </p>
                ))}
              </div>
            )}
          </Reveal>
        </div>
      </div>
    </section>
  );
}

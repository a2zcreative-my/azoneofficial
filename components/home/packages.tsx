/* v1.195.0 - PACKAGES, made comparable at a glance: the four tiers side by
   side on a wide screen (two by two on a tablet, stacked on a phone), each
   with its cadence, its line and every feature from PACKAGES - unchanged -
   and its own call to action, a WhatsApp message that names the tier. The
   full matrix stays on /packages. Prices are still quoted per brand. */

import { ArrowRight, Check } from "lucide-react";
import Link from "next/link";

import { Reveal } from "@/components/ui/reveal";
import { PACKAGES, whatsappUrl } from "@/constants/content";
import { CTA_LABEL } from "@/constants/site";

import css from "./home.module.css";

export function Packages() {
  return (
    <section id="packages" className={css.section}>
      <div className={css.wrap}>
        <div className={css.head}>
          <div>
            <p className={css.eyebrow}>Packages</p>
            <h2 className={css.h2}>Pick the level of support you need</h2>
          </div>
          <div className={css.headAside}>
            <p className={css.lede}>Our live commerce service is sold in four tiers; creative, digital marketing, and consultancy are scoped per brief. Every engagement starts with a free live audit — we look at your products and current channels, then recommend a tier. Pricing is quoted per brand, so you only pay for the cadence and creative you actually use.</p>
          </div>
        </div>
        <ul className={css.packages} role="list">
          {PACKAGES.map((tier, i) => (
            <li key={tier.name}>
              <Reveal delay={i * 0.06} className={css.fill100}>
                <article className={`${css.pkg} ${tier.featured ? css.pkgFeatured : ""}`}>
                  {tier.featured && <span className={css.pkgBadge}>Most chosen</span>}
                  <h3 className={css.pkgName}>{tier.name}</h3>
                  <span className={css.pkgCadence}>{tier.cadence}</span>
                  <p className={css.pkgTag}>{tier.tagline}</p>
                  <ul className={css.pkgList}>
                    {tier.features.map((f) => (
                      <li key={f}><Check aria-hidden="true" /><span>{f}</span></li>
                    ))}
                  </ul>
                  <a className={`${tier.featured ? css.btnGold : css.btnLine} ${css.pkgCta}`}
                    href={whatsappUrl(`Hi A2Z Creative Marketing, I'm interested in the ${tier.name} package. I would like to know more.`)}
                    target="_blank" rel="noopener noreferrer" aria-label={`Get a quote for ${tier.name} on WhatsApp`}>
                    <span>Get a quote</span>
                    <ArrowRight aria-hidden="true" />
                  </a>
                </article>
              </Reveal>
            </li>
          ))}
        </ul>
        <div className={`${css.btnRow} ${css.heroCtas}`}>
          <Link className={css.btnNavy} href="/packages"><span>Compare packages</span><ArrowRight aria-hidden="true" /></Link>
          <a className={css.btnLine} href={whatsappUrl()} target="_blank" rel="noopener noreferrer"><span>{CTA_LABEL}</span></a>
        </div>
      </div>
    </section>
  );
}

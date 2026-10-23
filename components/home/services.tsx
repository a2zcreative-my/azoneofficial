/* v1.195.0 - SERVICES, on the owner's mockup: six cards in a row on a wide
   screen, each with its own tinted icon, the existing title and description
   from SERVICES, and a way to the page that sells it - live commerce and
   hosting to Packages, consultancy to its own page, the rest to Services.
   The title and intro keep their Admin -> Content keys. */

import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { Editable } from "@/components/live/editable";
import { Reveal } from "@/components/ui/reveal";
import { SERVICES } from "@/constants/content";

import css from "./home.module.css";

const TINT = [css.tGold, css.tBlue, css.tRed, css.tGreen, css.tPurple, css.tGold];
const HREF = ["/services", "/services", "/packages", "/packages", "/services", "/consultancy"];

export function Services() {
  return (
    <section id="services" className={`${css.section} ${css.tint}`}>
      <div className={css.wrap}>
        <div className={css.head}>
          <div>
            <p className={css.eyebrow}>Our services</p>
            <h2 className={css.h2}><Editable k="home.services.title" fallback="Everything a brand needs to grow" /></h2>
          </div>
          <p className={css.lede}>
            <Editable k="home.services.intro" fallback="Creative, digital, content, live commerce, and consultancy — pick a single lane or hand us the whole thing." />
          </p>
        </div>
        <ul className={css.services} role="list">
          {SERVICES.map((service, i) => {
            const Icon = service.icon;
            return (
              <li key={service.title}>
                <Reveal delay={(i % 6) * 0.05} className={css.fill100}>
                  <Link href={HREF[i] ?? "/services"} className={css.serviceCard}>
                    <span className={`${css.serviceIcon} ${TINT[i] ?? css.tGold}`}><Icon aria-hidden="true" /></span>
                    <h3 className={css.serviceTitle}>{service.title}</h3>
                    <p className={css.serviceText}>{service.description}</p>
                    <span className={css.serviceFoot}>
                      <span>Learn more</span>
                      <span className={css.arrow} aria-hidden="true"><ArrowRight /></span>
                    </span>
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

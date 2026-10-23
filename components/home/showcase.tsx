/* v1.195.0 - LIVE COMMERCE: what a managed session delivers, and the rhythm
   of one - the same copy and the same "simulated view" label the page has
   always carried, so nothing here reads as a real order or a real figure.
   The TikTok and Shopee channels follow in LiveShowcase. Testimonials come
   only from the database (LiveTestimonials) and TESTIMONIALS, both empty
   until real words exist. The title and intro keep their Admin -> Content
   keys. */

import { CheckCircle2, MessageCircle, Package, ShoppingCart } from "lucide-react";
import Link from "next/link";

import { Editable } from "@/components/live/editable";
import { LiveTestimonials } from "@/components/live/live-content";
import { Reveal } from "@/components/ui/reveal";
import { TESTIMONIALS } from "@/constants/content";

import css from "./home.module.css";

const DELIVERABLES = [
  "Session rundown built around your best offers",
  "Trained host + producer on every live",
  "Real-time moderation and order push",
  "Post-live report: GMV, viewers, conversion, next actions",
] as const;

export function Showcase() {
  return (
    <section id="showcase" className={`${css.section} ${css.tint}`}>
      <div className={`${css.wrap} ${css.liveSplit}`}>
        <Reveal>
          <p className={css.eyebrow}>Live commerce</p>
          <h2 className={css.h2}><Editable k="home.showcase.title" fallback="What a session with us looks like" /></h2>
          <p className={css.lede}><Editable k="home.showcase.intro" fallback="No mystery, no vanity metrics. Every live session is planned, produced, and reported like a campaign." /></p>
          <ul className={css.checks}>
            {DELIVERABLES.map((item) => (
              <li key={item}><CheckCircle2 aria-hidden="true" /><span>{item}</span></li>
            ))}
          </ul>
          <div className={`${css.btnRow} ${css.heroCtas}`}>
            <Link className={css.btnNavy} href="/packages"><span>See packages</span></Link>
            <a className={css.btnLine} href="#live"><span>Watch us work</span></a>
          </div>
        </Reveal>
        <Reveal delay={0.1}>
          <div className={css.session}>
            <p className={css.sessionHead}><span className={css.liveChip}><span className={css.liveDot} aria-hidden="true" />LIVE</span>Live session, simulated view</p>
            <ul className={css.sessionList}>
              <li className={css.sessionItem}><ShoppingCart aria-hidden="true" /><span>Pinned: Today-only bundle — checkout in cart</span></li>
              <li className={css.sessionItem}><MessageCircle aria-hidden="true" /><span>&quot;sis, ada size M tak?&quot; — answered live, on camera</span></li>
              <li className={css.sessionItem}><Package aria-hidden="true" /><span>Order #214 confirmed while the host styles the next look</span></li>
            </ul>
            <p className={css.sessionNote}>This is the rhythm of a managed live: pitch, answer, close — repeated for two hours.</p>
          </div>
        </Reveal>
      </div>
      <div className={css.wrap}>
        <LiveTestimonials />
        {TESTIMONIALS.length > 0 && (
          <ul className={css.problems} role="list">
            {TESTIMONIALS.slice(0, 3).map((t) => (
              <li key={t.author} className={css.problem}>
                <p className={css.problemA}>&quot;{t.quote}&quot;</p>
                <p className={css.problemLabel}>{t.author} — {t.role}, {t.company}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

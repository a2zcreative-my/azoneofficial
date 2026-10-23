/* v1.195.0 - the first five questions (FaqList, unchanged), beside the
   section's heading on a wide screen. */

import Link from "next/link";

import { FaqList } from "@/components/ui/faq-list";

import css from "./home.module.css";

export function Faq() {
  return (
    <section id="faq" className={css.section}>
      <div className={`${css.wrap} ${css.faqGrid}`}>
        <div>
          <p className={css.eyebrow}>FAQ</p>
          <h2 className={css.h2}>Before you ask</h2>
          <p className={css.lede}>The questions brands ask us most, answered straight.</p>
          <p className={css.faqMore}>
            <Link href="/faq">See all questions</Link>{" "}
            — including pricing, session length, studio, and on-site sessions.
          </p>
        </div>
        <FaqList limit={5} />
      </div>
    </section>
  );
}

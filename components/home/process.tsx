/* v1.195.0 - the four steps (PROCESS, unchanged copy), numbered because
   the order is the point. */

import { Reveal } from "@/components/ui/reveal";
import { PROCESS } from "@/constants/content";

import css from "./home.module.css";

export function Process() {
  return (
    <section id="process" className={`${css.section} ${css.tint}`}>
      <div className={css.wrap}>
        <div className={css.head}>
          <div>
            <p className={css.eyebrow}>Process</p>
            <h2 className={css.h2}>From first call to first sale</h2>
          </div>
          <p className={css.lede}>Four steps. The order matters — each one feeds the next.</p>
        </div>
        <ol className={css.steps}>
          {PROCESS.map((step, i) => (
            <li key={step.step}>
              <Reveal delay={i * 0.08} className={`${css.step} ${css.fill100}`}>
                <span className={css.stepNo} aria-hidden="true">{String(step.step).padStart(2, "0")}</span>
                <h3 className={css.stepTitle}>{step.title}</h3>
                <p className={css.stepText}>{step.description}</p>
              </Reveal>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

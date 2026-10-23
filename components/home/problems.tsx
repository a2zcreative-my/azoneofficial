/* v1.195.0 - the problems brands hire us for (PROBLEMS, unchanged copy),
   in the homepage's new card style. */

import { Reveal } from "@/components/ui/reveal";
import { PROBLEMS } from "@/constants/content";

import css from "./home.module.css";

export function Problems() {
  return (
    <section id="problems" className={css.section}>
      <div className={css.wrap}>
        <div className={css.head}>
          <div>
            <p className={css.eyebrow}>Sound familiar?</p>
            <h2 className={css.h2}>The problems we get hired to solve</h2>
          </div>
          <p className={css.lede}>Most brands don&apos;t stall because the product is wrong — they stall on the parts nobody warned them about, from an identity that never settles to a live room that draws a crowd and sells nothing. These are the ones we get hired for.</p>
        </div>
        <ul className={css.problems} role="list">
          {PROBLEMS.map((item, i) => (
            <li key={item.problem}>
              <Reveal delay={(i % 3) * 0.06} className={`${css.problem} ${css.fill100}`}>
                <p className={css.problemQ}>&ldquo;{item.problem}&rdquo;</p>
                <p className={css.problemLabel}>How we solve it</p>
                <p className={css.problemA}>{item.solution}</p>
              </Reveal>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

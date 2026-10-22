"use client";

/* v1.184.0 - THE CLOCK FACE on the Dashboard's attendance card (the owner's
   reference, 22-10-2026: a round analog clock above Check In / Check Out).
   Decorative and honest: it shows Malaysian time (UTC+8, the time every
   punch is recorded in), ticks once a second on its own, and re-renders
   only itself - the card around it keeps its minute tick. The seconds hand
   is the brand gold; the rest is the brand navy on the card's own surface,
   so it reads the same in both themes. Reduced motion: the hand still moves
   (a clock that stops is wrong), but with no transition. */

import { useEffect, useState } from "react";
import css from "./analog-clock.module.css";

const MYT_MS = 8 * 3600 * 1000;

export function AnalogClock({ size = 176, label }: { size?: number; label?: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const d = new Date(now + MYT_MS);
  const h = d.getUTCHours() % 12, m = d.getUTCMinutes(), s = d.getUTCSeconds();
  const hourDeg = (h + m / 60) * 30;
  const minDeg = (m + s / 60) * 6;
  const secDeg = s * 6;
  const ticks = Array.from({ length: 60 }, (_, i) => i);
  return (
    <svg
      className={css.clock}
      width={size}
      height={size}
      viewBox="0 0 200 200"
      role="img"
      aria-label={label ?? `${String(d.getUTCHours()).padStart(2, "0")}:${String(m).padStart(2, "0")}`}
    >
      <circle cx="100" cy="100" r="96" className={css.ring} />
      <circle cx="100" cy="100" r="88" className={css.face} />
      {ticks.map((i) => (
        <line
          key={i}
          x1="100" y1="18" x2="100" y2={i % 5 === 0 ? "28" : "23"}
          className={i % 5 === 0 ? css.tickMajor : css.tick}
          transform={`rotate(${i * 6} 100 100)`}
        />
      ))}
      {[12, 3, 6, 9].map((n, i) => (
        <text
          key={n}
          x={[100, 158, 100, 42][i]}
          y={[48, 106, 164, 106][i]}
          className={css.numeral}
          textAnchor="middle"
        >
          {n}
        </text>
      ))}
      <line x1="100" y1="106" x2="100" y2="56" className={css.hour} transform={`rotate(${hourDeg} 100 100)`} />
      <line x1="100" y1="108" x2="100" y2="40" className={css.minute} transform={`rotate(${minDeg} 100 100)`} />
      <line x1="100" y1="114" x2="100" y2="34" className={css.second} transform={`rotate(${secDeg} 100 100)`} />
      <circle cx="100" cy="100" r="4.5" className={css.pin} />
    </svg>
  );
}

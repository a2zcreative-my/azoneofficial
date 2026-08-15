"use client";

/* v1.14.0 — photo avatar with an initials fallback.
 *
 * The portal already renders this pattern by hand in five places with three
 * different ring treatments. One component, one look: navy fill, gold text,
 * gold ring — the same identity cue the rail's active state uses.
 *
 * The fallback is not "no photo" — it is also "photo failed to load", which
 * happens whenever a media key is stale. Hiding a broken <img> leaves a hole;
 * swapping to initials keeps the row's geometry intact.
 */

import { useState } from "react";

const SIZE = {
  sm: "h-7 w-7 text-[10px] ring-1",
  md: "h-9 w-9 text-xs ring-2",
  lg: "h-11 w-11 text-sm ring-2",
} as const;

export function Avatar({
  name, photoKey, size = "md", online,
}: {
  name: string;
  /** Media key; resolved through the existing /api/v1/media/file route. */
  photoKey?: string | null;
  size?: keyof typeof SIZE;
  /** Green presence dot, bottom-right. */
  online?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const initials = name.trim().split(/\s+/).slice(0, 2).map((w) => w.charAt(0).toUpperCase()).join("") || "?";
  const show = photoKey && !failed;

  return (
    <span className="relative inline-flex shrink-0">
      {show ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/api/v1/media/file/${encodeURIComponent(photoKey)}`}
          alt=""
          onError={() => setFailed(true)}
          className={`ring-gold rounded-full object-cover ${SIZE[size]}`}
        />
      ) : (
        <span
          aria-hidden
          className={`bg-brand text-gold ring-gold inline-flex items-center justify-center rounded-full font-semibold ${SIZE[size]}`}
        >
          {initials}
        </span>
      )}
      {online ? (
        <span className="bg-success ring-card absolute right-0 bottom-0 h-2.5 w-2.5 rounded-full ring-2" aria-label="Available" />
      ) : null}
    </span>
  );
}

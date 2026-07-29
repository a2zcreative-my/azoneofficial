import type { ReactNode } from "react";

/**
 * ButtonGroup (v1.2.19) — pairs of CTAs rendered at identical width.
 *
 * `min-w-[180px]` on Button only sets a floor, so two buttons with different
 * label lengths still came out different sizes ("Get a free live audit" vs
 * "See packages"). This lays them out in equal-fraction columns instead, so
 * every button in the group matches the widest one.
 *
 * Mobile: full-width stacked. Desktop: equal columns, shrink-to-fit as a group.
 */
export function ButtonGroup({
  children,
  align = "start",
  className = "",
}: {
  children: ReactNode;
  align?: "start" | "center";
  className?: string;
}) {
  return (
    <div
      className={`grid grid-cols-1 gap-3 sm:inline-grid sm:auto-cols-fr sm:grid-flow-col [&>*]:sm:w-full ${
        align === "center" ? "sm:justify-center" : ""
      } ${className}`}
    >
      {children}
    </div>
  );
}

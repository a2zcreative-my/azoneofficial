/**
 * SubR — the portal's field label, v1.79.0.
 *
 * The pattern is v1.4.139 and the whole portal already uses it: a small
 * subhead above a field, because a placeholder is not a label. A placeholder
 * vanishes the moment somebody types, and two adjacent boxes both reading
 * "0.00" are indistinguishable to anyone who has not memorised the column
 * order.
 *
 * It lived as a private function inside role-panels.tsx, so every OTHER file
 * that wanted a labelled field either wrote its own or shipped bare
 * placeholders — which is how the document form ended up with an unlabelled
 * unit-price box next to an unlabelled line-discount box on a phone, and the
 * CEO's RM 12 went into the wrong one.
 *
 * CEO, 31-08-2026, about the last card that had this problem: *"use globally
 * format coding!"* A shared component is what that means.
 *
 * Two of them, because a labelled field has two shapes:
 *   SubR    — a standalone field. The label is always there.
 *   RowCell — one cell of a repeating grid row that HAS a column header on
 *             wide screens. Repeating the label down five invoice lines
 *             would be noise, so it shows only below `sm`, where the header
 *             row is not rendered at all.
 */
import type { ReactNode } from "react";

export function SubR({
  t,
  children,
  className = "",
}: {
  t: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="text-muted-foreground mb-0.5 block text-[11px] font-medium">
        {t}
      </span>
      {children}
    </label>
  );
}

/**
 * One cell of a repeating grid row. Below `sm` it labels its field; at `sm`
 * and above it becomes `display: contents`, so it leaves no box of its own
 * and the input sits directly in its grid column exactly as if the wrapper
 * were not there — which is what lets the row keep sharing a column template
 * with its header.
 */
export function RowCell({ t, children }: { t: string; children: ReactNode }) {
  return (
    <label className="block sm:contents">
      <span className="text-muted-foreground mb-0.5 block text-[11px] font-medium sm:hidden">
        {t}
      </span>
      {children}
    </label>
  );
}

/* v1.205.0 - OPEN THE RECORD, NOT JUST THE TAB (the owner's Global Search
   brief, 25-10-2026: "Ensure clicking a notification opens the
   corresponding original record").

   A search hit, a notification and a Desk item each name a record: a hit by
   its kind and id, a notification and a Desk item by their `ref` ("leave:12",
   "claim:7", "task:5:od:2026-09-18", "quote:9:2"). The portal turns that into
   a FOCUS - the tab, the kind, the id - and the module that owns the record
   opens it in its own drawer or row, the way pressing it there would. No
   module keeps a copy: the focus is a pointer, the record stays where it is.

   The focus lasts while its tab is open and is dropped the moment another
   tab is chosen (the provider, the same rule as tabStart). `seq` makes the
   same record opened twice a second request, not a no-op. */

import { useEffect, useState } from "react";
import type { TabName } from "@/lib/portal-tabs";

export interface RecordFocus {
  tab: TabName;
  /** the module's own word for the record: staff, hotel, task, leave, claim, asset, stock, document, client */
  kind: string;
  id: number;
  seq: number;
}

/** Where a kind of record lives - the registry tab its own module draws. */
export const TAB_OF_KIND: Record<string, TabName> = {
  staff: "Staff Details",
  hotel: "Hotels",
  task: "Tasks",
  leave: "Leave",
  claim: "Claims",
  asset: "Assets",
  stock: "Inventory",
  document: "Sales",
  client: "Sales",
  announcement: "Announcements", // v1.217.0 - the bell opens the post itself
};

/** The record a notification or Desk `ref` names, or null when it names a
    day, a person's week or nothing a module can open on its own ("ot:9002:
    2026-09-21", "announcement:3", "watch:stock:17"). Only the prefixes the
    worker writes are read; anything else is left to the tab. */
export function recordOfRef(ref: string | null | undefined): { kind: string; id: number } | null {
  if (!ref) return null;
  const m = /^(leave|claim|task|task-close|stock|quote|announcement):(\d+)(?::|$)/.exec(ref);
  if (!m) return null;
  const id = Number(m[2]);
  if (!Number.isFinite(id) || id <= 0) return null;
  const word = m[1]!;
  const kind = word === "task-close" ? "task" : word === "quote" ? "document" : word;
  return { kind, id };
}

/**
 * Apply a focus once, while rendering (React's pattern for state that follows
 * a changing value - no effect, no second render with the old view). `ready`
 * holds it until the module's own list has loaded, so the record can be
 * found; `apply` is the module's own "open this one" - the same setters its
 * row buttons call. Returns the focus last applied (for a scroll-into-view).
 */
export function useRecordFocus(
  focus: RecordFocus | null | undefined,
  ready: boolean,
  apply: (f: RecordFocus) => void,
): RecordFocus | null {
  const [seen, setSeen] = useState<RecordFocus | null>(null);
  if (focus && ready && focus.seq !== seen?.seq) {
    setSeen(focus);
    apply(focus);
  }
  return seen;
}

/** After a focus is applied, bring its row into view: the element marked
    data-record="kind:id" by the module. A scroll, not state - an effect. */
export function useScrollToRecord(seen: RecordFocus | null): void {
  useEffect(() => {
    if (!seen) return;
    const t = window.setTimeout(() => {
      document.querySelector(`[data-record="${seen.kind}:${seen.id}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 120);
    return () => window.clearTimeout(t);
  }, [seen]);
}

"use client";

/* v1.293.0 - A TAB'S VIEW IN THE ADDRESS, for any tab (the Desk first; the
   Sales Workspace 4.0 hook in sales-shell.tsx is the same rule, written for
   Sales before this existed).

   /portal?tab=Desk&view=inbox - only the tab and the view's short name are
   written: never a record, a person or a figure. Arriving puts the view on
   the history entry already there; a change of view adds one entry, so Back
   and Forward move between views; leaving the tab takes both words off the
   address again. portal-provider.tsx reads `view` from a link once per page
   load and hands it to the tab as its start view. */

import { useEffect } from "react";

export function tabViewUrl(tab: string, view: string): string {
  const u = new URL(window.location.href);
  u.searchParams.set("tab", tab);
  u.searchParams.set("view", view);
  return u.pathname + u.search + u.hash;
}
export function withoutTabView(): string {
  const u = new URL(window.location.href);
  u.searchParams.delete("tab");
  u.searchParams.delete("view");
  return u.pathname + u.search + u.hash;
}

export function useTabViewAddress<V extends string>(tab: string, view: V, setView: (v: V) => void, isView: (v: string | null) => v is V) {
  useEffect(() => {
    const cur = new URL(window.location.href).searchParams.get("view");
    if (cur === null) window.history.replaceState({ tabView: view }, "", tabViewUrl(tab, view));
    else if (cur !== view) window.history.pushState({ tabView: view }, "", tabViewUrl(tab, view));
  }, [tab, view]);
  useEffect(() => {
    const onPop = () => { const v = new URL(window.location.href).searchParams.get("view"); if (isView(v)) setView(v); };
    window.addEventListener("popstate", onPop);
    return () => { window.removeEventListener("popstate", onPop); window.history.replaceState(null, "", withoutTabView()); };
  }, [setView, isView]);
}

"use client";

/**
 * EN / BM for the public site — v1.32.0.
 *
 * CEO, 20-08-2026: "put a toggle for EN BM so that client can choose their
 * preferences", scope confirmed as every public page.
 *
 * HOW IT WORKS, and why this way
 * ------------------------------
 * The public pages are Server Components — they export `metadata`, so they
 * cannot call a React hook. Translating them the usual way (a `t()` call at
 * every string) would mean splitting all twelve pages into server+client
 * halves and editing some thirty files of a live marketing site at once.
 * Instead the BM layer is applied to the rendered DOM: one walk over the text
 * nodes, swapping any node whose exact text has an entry in MS_DICT.
 *
 * That buys a whole-site translation with two new files and no edits to the
 * pages themselves — and it degrades honestly: a string with no entry, or one
 * whose English has since been reworded, simply stays English.
 *
 * NO FLASH, AND NO HYDRATION MISMATCH
 * -----------------------------------
 * The obvious trick — swap the text in an inline script before React boots —
 * was tried and rejected: React then hydrates against text that no longer
 * matches the server HTML, repairs the DOM back to English and logs error
 * #418. So the inline script touches no text at all. It only marks the
 * document `ms-pending`, which CSS uses to hold the body invisible for the
 * few frames until React mounts and the swap lands. A BM visitor therefore
 * never sees English blink past, and React never sees a DOM it did not write.
 *
 * The veil is failsafed twice over: the inline script lifts it after 1.2s no
 * matter what, and the runtime lifts it on mount even if the swap throws. A
 * translation must never be able to leave the site blank.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO
 * ----------------------------------
 * The HTML served to crawlers stays English, so English remains the indexed
 * language. BM is a reader convenience, chosen per device. If BM SEO is ever
 * wanted, that is a different job: real /ms routes rendered at build time.
 *
 * The choice is stored under the SAME key the staff portal uses
 * ("azone-lang"), so someone who works in BM inside the portal gets BM on the
 * public site too.
 */
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { MS_DICT } from "@/constants/ms";

export type PublicLang = "en" | "ms";

const KEY = "azone-lang";
const EVENT = "azone-lang-change";
const VEIL = "ms-pending";

/** Surfaces that own their own language handling — never touch these. */
const APP_PREFIXES = ["portal", "admin", "account", "login", "doc", "report"] as const;
const APP_SURFACES = new RegExp(`^/(${APP_PREFIXES.join("|")})`);

function readLang(): PublicLang {
  if (typeof window === "undefined") return "en";
  try {
    return window.localStorage.getItem(KEY) === "ms" ? "ms" : "en";
  } catch {
    return "en";
  }
}

/** Every text node we have swapped, with the English we replaced. */
const originals = new WeakMap<Text, string>();

/** Collapse the whitespace JSX leaves in a text node: source written over
    three indented lines arrives as one node full of newlines, which would
    never match a dictionary key written on one line. */
const norm = (s: string): string => s.trim().replace(/\s+/g, " ");

/** MS_DICT, re-keyed the same way, built once. */
const NORM_DICT: Record<string, string> = (() => {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(MS_DICT)) out[norm(k)] = v;
  return out;
})();

/**
 * Whole-node matches only: a partial replace inside a sentence assembled from
 * several nodes would produce mangled half-BM text. Originals are remembered
 * so switching back to EN is exact — a reverse lookup would be ambiguous,
 * since two English strings can share one BM translation.
 */
function applyLang(on: boolean): void {
  if (typeof document === "undefined") return;
  try {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        const p = (n as Text).parentElement;
        if (!p) return NodeFilter.FILTER_REJECT;
        const tag = p.tagName;
        if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT") return NodeFilter.FILTER_REJECT;
        if (p.closest("[data-no-translate]")) return NodeFilter.FILTER_REJECT;
        const v = n.nodeValue ?? "";
        return v.trim().length > 1 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      },
    });
    const nodes: Text[] = [];
    let cur: Node | null;
    while ((cur = walker.nextNode())) nodes.push(cur as Text);

    for (const node of nodes) {
      const raw = node.nodeValue ?? "";
      const trimmed = raw.trim();
      if (on) {
        const hit = NORM_DICT[norm(raw)];
        if (hit) {
          if (!originals.has(node)) originals.set(node, raw);
          node.nodeValue = raw.replace(trimmed, hit);
        }
      } else if (originals.has(node)) {
        node.nodeValue = originals.get(node) ?? raw;
        originals.delete(node);
      }
    }
    document.documentElement.lang = on ? "ms" : "en";
  } catch {
    /* a translation must never break the page */
  }
}

/**
 * Inline boot script for the root layout's <head>. Text is NOT touched here
 * (see the header comment) — it only raises the veil for a BM visitor, with
 * a hard 1.2s failsafe so a JS failure can never leave a blank page.
 */
export function MsBoot() {
  return (
    <script
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{
        /* Plain prefix checks, not a regex literal: building one by escaping
           APP_SURFACES.source into a template produced `/^\\/(portal…/`,
           whose second slash closed the literal early and threw "Unexpected
           token '.'" on every page load. Caught by the e2e's zero-page-errors
           rule; kept simple so it cannot come back. */
        __html: `(function(){try{
  if(localStorage.getItem(${JSON.stringify(KEY)})!=='ms')return;
  var p=location.pathname,a=${JSON.stringify(APP_PREFIXES)};
  for(var i=0;i<a.length;i++){if(p.indexOf('/'+a[i])===0)return;}
  var d=document.documentElement;d.classList.add(${JSON.stringify(VEIL)});
  setTimeout(function(){d.classList.remove(${JSON.stringify(VEIL)})},1200);
}catch(e){}})();`,
      }}
    />
  );
}

/**
 * Mounted once in the root layout. Owns the actual swap and keeps it applied
 * across client-side navigation and late-arriving content (the live-content
 * panels replace text after they fetch).
 */
export function LangRuntime() {
  const pathname = usePathname() ?? "/";

  useEffect(() => {
    const lift = () => document.documentElement.classList.remove(VEIL);
    if (APP_SURFACES.test(window.location.pathname)) {
      lift();
      return;
    }

    const sync = () => {
      applyLang(readLang() === "ms");
      lift();
    };
    sync();

    const observer = new MutationObserver(() => {
      if (readLang() === "ms") applyLang(true);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener(EVENT, sync);
    return () => {
      observer.disconnect();
      window.removeEventListener(EVENT, sync);
    };
  }, [pathname]);

  return null;
}

/** The EN | BM control itself. Lives in the navbar, desktop and mobile. */
export function LangToggle({ className = "" }: { className?: string }) {
  const pathname = usePathname() ?? "/";
  const [lang, setLang] = useState<PublicLang>("en");

  useEffect(() => {
    setLang(readLang());
    const onChange = () => setLang(readLang());
    window.addEventListener(EVENT, onChange);
    return () => window.removeEventListener(EVENT, onChange);
  }, []);

  const choose = useCallback((next: PublicLang) => {
    try {
      window.localStorage.setItem(KEY, next);
    } catch {
      /* private mode — the choice just does not persist */
    }
    setLang(next);
    window.dispatchEvent(new Event(EVENT));
  }, []);

  if (APP_SURFACES.test(pathname)) return null;

  return (
    <div
      data-no-translate
      className={`border-border inline-flex items-center rounded-full border p-0.5 ${className}`}
      role="group"
      aria-label="Language / Bahasa"
    >
      {(["en", "ms"] as const).map((code) => (
        <button
          key={code}
          type="button"
          onClick={() => choose(code)}
          aria-pressed={lang === code}
          className={`rounded-full px-2.5 py-1 text-xs font-semibold transition-colors ${
            lang === code
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {code === "en" ? "EN" : "BM"}
        </button>
      ))}
    </div>
  );
}

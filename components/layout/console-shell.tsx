"use client";

/* v1.228.0 - THE CONSOLE SHELL: /admin and /account in the /portal interface.
 *
 * The owner, 30-10-2026: "/admin and /account should follow the interface of
 * /portal. do sync it now". Both still drew the v1.23.0 navy icon rail inside
 * a framed canvas, their own header and a navy-square bottom bar, while the
 * portal had moved on to the light grouped rail, the .erp-topbar header, the
 * tinted bottom bar and the More sheet (v1.172.x, Interface System V3).
 *
 * This is that same chrome, built from the SAME pieces, for a page that has
 * no PortalProvider behind it:
 *   - the rail is components/layout/side-nav.tsx (SideNav) with the page's
 *     own sections, on AppShell's `navigation` workspace;
 *   - the header is .erp-topbar: avatar initial, eyebrow, the section's name,
 *     then the theme preset, EN/BM, dark mode and sign out (desktop);
 *   - phones get the .erp-bottom-nav with .erp-bottom-nav-item stops and a
 *     More sheet holding the other sections, the preferences and sign out -
 *     the portal's layout, tile for tile;
 *   - the page is .erp-page with the bottom-bar clearance.
 * The preferences are the portal's own keys (azone-theme, azone-theme-preset,
 * azone-lang, azone-nav-collapsed), so a person who switches between the
 * consoles keeps one setting. Nothing here decides who sees what: `items`
 * arrives already filtered by the page, as the portal's do.
 */

import { useEffect, useState, type ReactNode } from "react";
import { Moon, Palette, Sun } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { NAV_COLLAPSED_KEY, SideNav, sectionTitle } from "@/components/layout/side-nav";
import { CloseX, Ellipsis, LogOut, TabIcon } from "@/components/layout/nav-icons";
import { setLang as persistLang, type Lang } from "@/lib/i18n";
import { syncThemeColor } from "@/lib/theme-color";
import { PORTAL_WIDTH, btnGhost, btnHdr, btnHdrDesktop, mobileAppBottomClearance, mobileBottomNav, sheetCard } from "@/lib/ui-styles";
import css from "./console-shell.module.css";

export interface ConsoleItem { name: string; label: string }
export interface ConsoleSection { title: string; tabs: string[] }

export function ConsoleShell({
  eyebrow, items, sections, active, onSelect, title, phoneTitle, user, lang, onLang, onSignOut, primaryCount = 4, children,
}: {
  /** the small gold line above the title - which console this is */
  eyebrow: string;
  /** the destinations this person may open, in order (already permission-filtered) */
  items: ConsoleItem[];
  /** how the rail and the More sheet group them; a tab listed nowhere goes under "Other" */
  sections: ConsoleSection[];
  active: string;
  onSelect: (name: string) => void;
  /** the header title on desktop (defaults to the active label) */
  title?: string;
  /** the header title on phones (defaults to the active label) */
  phoneTitle?: string;
  user: { name: string; role: string };
  lang: Lang;
  onLang: (l: Lang) => void;
  onSignOut: () => void;
  /** how many destinations sit on the phone bar before More */
  primaryCount?: number;
  children: ReactNode;
}) {
  const L = (en: string, ms: string) => (lang === "ms" ? ms : en);
  const [collapsed, setCollapsed] = useState(true);
  const [dark, setDark] = useState(false);
  const [preset, setPreset] = useState<"navy" | "plum">("navy");
  const [moreOpen, setMoreOpen] = useState(false);

  /* the rail remembers, exactly as the portal's does (portal-provider.tsx) */
  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 1280px)");
    const fit = () => {
      let saved: string | null = null;
      try { saved = localStorage.getItem(NAV_COLLAPSED_KEY); } catch { /* storage denied */ }
      setCollapsed(saved === null ? !desktop.matches : saved === "1");
    };
    fit();
    desktop.addEventListener("change", fit);
    return () => desktop.removeEventListener("change", fit);
  }, []);
  const toggleCollapsed = () => setCollapsed((v) => {
    try { localStorage.setItem(NAV_COLLAPSED_KEY, v ? "0" : "1"); } catch { /* a convenience */ }
    return !v;
  });

  /* dark mode and the colour preset: the portal's keys and the same test the
     pre-paint script in app/layout.tsx makes (only a saved "dark" is dark) */
  useEffect(() => {
    const load = () => {
      try {
        setDark(localStorage.getItem("azone-theme") === "dark");
        setPreset(localStorage.getItem("azone-theme-preset") === "plum" ? "plum" : "navy");
      } catch { /* light, navy */ }
    };
    load();
  }, []);
  const flipDark = () => setDark((v) => {
    try { localStorage.setItem("azone-theme", v ? "light" : "dark"); } catch { /* this visit only */ }
    return !v;
  });
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    syncThemeColor();
  }, [dark]);
  const flipPreset = () => setPreset((v) => {
    const next = v === "plum" ? "navy" : "plum";
    try { localStorage.setItem("azone-theme-preset", next); } catch { /* this visit only */ }
    return next;
  });
  useEffect(() => {
    if (preset === "plum") document.documentElement.setAttribute("data-theme", "plum");
    else document.documentElement.removeAttribute("data-theme");
  }, [preset]);
  const flipLang = () => { const next: Lang = lang === "ms" ? "en" : "ms"; persistLang(next); onLang(next); };

  /* the More sheet locks the page behind it, as the portal's does */
  useEffect(() => {
    document.body.style.overflow = moreOpen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [moreOpen]);

  const labelOf = (name: string) => items.find((i) => i.name === name)?.label ?? name;
  const go = (name: string) => { onSelect(name); setMoreOpen(false); window.scrollTo({ top: 0 }); };
  const primary = items.slice(0, primaryCount);
  const rest = items.slice(primaryCount);
  const placed = new Set(sections.flatMap((s) => s.tabs));
  const moreGroups = [
    ...sections.map((s) => ({ title: s.title, tabs: s.tabs.filter((t) => rest.some((r) => r.name === t)) })),
    { title: "Other", tabs: rest.filter((r) => !placed.has(r.name)).map((r) => r.name) },
  ].filter((g) => g.tabs.length > 0);
  const activeLabel = labelOf(active);

  return (
    <AppShell
      navigation={
        <SideNav
          items={items}
          sections={sections}
          active={active}
          collapsed={collapsed}
          onToggleCollapsed={toggleCollapsed}
          userName={user.name}
          userRole={user.role}
          onSelect={go}
          onSignOut={onSignOut}
        />
      }
    >
      <div className={`${css.page} ${mobileAppBottomClearance} ${PORTAL_WIDTH}`}>
        <header className="erp-topbar" style={{ paddingTop: "calc(var(--hdr-pt) + env(safe-area-inset-top, 0px))" }}>
          <div className={css.identity}>
            <span className={`${css.avatar} ${css.avatarInitial}`} aria-hidden>{user.name.trim().charAt(0).toUpperCase() || "?"}</span>
            <div className="erp-min0">
              <p className="erp-topbar-eyebrow erp-desktop-only">{eyebrow}</p>
              <h1 className="erp-topbar-title erp-desktop-only">{title ?? activeLabel}</h1>
              <h1 className="erp-topbar-title erp-phone-only">{phoneTitle ?? activeLabel}</h1>
            </div>
          </div>
          <div className={css.tools}>
            <button type="button" className={btnHdrDesktop} aria-label={L("Switch colour theme", "Tukar tema warna")}
              title={preset === "plum" ? L("Theme: Plum & Rose — switch to Navy & Gold", "Tema: Plum & Rose — tukar ke Navy & Gold") : L("Theme: Navy & Gold — switch to Plum & Rose", "Tema: Navy & Gold — tukar ke Plum & Rose")}
              onClick={flipPreset}>
              <Palette aria-hidden className="erp-icon" strokeWidth={1.75} />
            </button>
            <button type="button" className={`${btnHdrDesktop} ${css.langButton}`} aria-label={L("Toggle language", "Togol bahasa")}
              title={lang === "ms" ? "Bahasa: BM — tukar ke English" : "Language: EN — switch to Bahasa Melayu"} onClick={flipLang}>
              {lang === "ms" ? "BM" : "EN"}
            </button>
            <button type="button" className={btnHdrDesktop} aria-label={L("Toggle dark mode", "Togol mod gelap")} onClick={flipDark}>
              {dark ? <Sun aria-hidden className="erp-icon" strokeWidth={1.75} /> : <Moon aria-hidden className="erp-icon" strokeWidth={1.75} />}
            </button>
            <button type="button" className={btnHdrDesktop} title={L("Sign out", "Log keluar")} aria-label={L("Sign out", "Log keluar")} onClick={onSignOut}>
              <LogOut aria-hidden className="erp-icon" strokeWidth={1.75} />
            </button>
            {/* phones: the preferences live in More, as on the portal; the
                language stays one tap away in the header */}
            <button type="button" className={`${btnHdr} erp-phone-only ${css.langButton}`} aria-label={L("Toggle language", "Togol bahasa")} onClick={flipLang}>
              {lang === "ms" ? "BM" : "EN"}
            </button>
          </div>
        </header>

        <nav className={mobileBottomNav} aria-label={L("Sections (mobile)", "Bahagian (mudah alih)")}>
          {primary.map((it) => (
            <button key={it.name} type="button" onClick={() => go(it.name)} aria-current={active === it.name && !moreOpen ? "page" : undefined} className="erp-bottom-nav-item">
              <span aria-hidden className="erp-bottom-nav-icon"><TabIcon name={it.name} /></span>
              <span className="erp-bottom-nav-label">{it.label}</span>
            </button>
          ))}
          <button type="button" onClick={() => setMoreOpen((v) => !v)} aria-expanded={moreOpen} aria-controls="console-more-menu"
            data-active={moreOpen || rest.some((r) => r.name === active) || undefined} className="erp-bottom-nav-item">
            <span aria-hidden className="erp-bottom-nav-icon"><Ellipsis aria-hidden className="erp-icon-md" strokeWidth={1.75} /></span>
            <span className="erp-bottom-nav-label">{L("More", "Lagi")}</span>
          </button>
        </nav>

        {moreOpen && (
          <div className={css.moreBackdrop}>
            <button type="button" aria-label={L("Close menu", "Tutup menu")} className={css.moreScrim} onClick={() => setMoreOpen(false)} />
            <div id="console-more-menu" role="dialog" aria-modal="true" aria-label={L("More", "Lagi")} className={sheetCard}>
              <div className={css.moreHead}>
                <span className={css.moreSpacer} />
                <span aria-hidden className={css.moreGrip} />
                <button type="button" aria-label={L("Close", "Tutup")} className={`erp-icon-button ${css.moreClose}`} onClick={() => setMoreOpen(false)}>
                  <CloseX aria-hidden className="erp-icon" strokeWidth={1.75} />
                </button>
              </div>
              {moreGroups.map((g) => (
                <section key={g.title} className={css.moreSection}>
                  <p className={css.moreLabel}>{sectionTitle(g.title, lang)}</p>
                  <div className={css.moreGrid}>
                    {g.tabs.map((t) => (
                      <button key={t} type="button" onClick={() => go(t)} aria-current={active === t ? "page" : undefined} className={`${css.moreTab} ${active === t ? css.moreTabOn : ""}`}>
                        <span aria-hidden className="erp-center"><TabIcon name={t} /></span>
                        {labelOf(t)}
                      </button>
                    ))}
                  </div>
                </section>
              ))}
              <p className={`${css.moreLabel} ${css.moreLabelPrefs}`}>{L("Preferences", "Pilihan")}</p>
              <div className={css.moreGrid}>
                <button type="button" className={css.morePref} onClick={flipLang}>
                  <span aria-hidden className={css.moreLang}>{lang === "ms" ? "BM" : "EN"}</span>
                  {lang === "ms" ? "Bahasa" : "English"}
                </button>
                <button type="button" className={css.morePref} onClick={flipPreset}>
                  <span aria-hidden className="erp-center"><Palette className="erp-icon-md" strokeWidth={1.75} /></span>
                  {preset === "plum" ? L("Plum", "Ungu") : L("Navy", "Biru")}
                </button>
              </div>
              <div className={css.moreFoot}>
                <button type="button" className={btnGhost} aria-pressed={dark} onClick={flipDark}>
                  {dark ? <Sun aria-hidden className="erp-icon" /> : <Moon aria-hidden className="erp-icon" />}
                  {dark ? L("Light mode", "Mod cerah") : L("Dark mode", "Mod gelap")}
                </button>
                <button type="button" className="erp-button erp-button-danger" onClick={() => { setMoreOpen(false); onSignOut(); }}>
                  <LogOut aria-hidden className="erp-icon" />{L("Sign out", "Log keluar")}
                </button>
              </div>
            </div>
          </div>
        )}

        {children}
      </div>
    </AppShell>
  );
}

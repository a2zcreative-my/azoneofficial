"use client";

/* v1.13.0 — the grouped ERP sidebar (CEO's DZI reference).
 *
 * Replaces the v1.8.0/v1.12.0 icon-only rail on desktop. An icon rail works
 * for six destinations; this system has more than twenty. Unlabelled icons
 * at that count stop being navigation and become a memory test — hence
 * sections with headers.
 *
 * CRITICAL — this component does NOT decide what you can see.
 * It renders the SAME `items` array the portal already computes from role
 * gating and the CEO's per-user tab-access overrides. Grouping is presentation
 * only: a section renders if and only if at least one of its tabs survived
 * that filter, and any tab missing from SECTIONS still appears (under "Other")
 * rather than silently vanishing. Adding a tab to the system can never make it
 * unreachable by forgetting to list it here.
 *
 * Phones never render this — they keep the v1.11.1 bottom nav.
 */

import { useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from "react";
import { ChevronDown, ChevronsUpDown, FolderKanban } from "lucide-react";
import css from "./side-nav.module.css";
import { TabIcon, GroupIcon, LogOut } from "@/components/layout/nav-icons";
import { NAV_GROUPS } from "@/lib/portal-tabs";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { getLang } from "@/lib/i18n";

interface NavItem { name: string; label: string }
/** v1.279.0 - one row of the name card's menu (side-nav draws it; the
    portal hands in what it does - the same handlers as the phone's More
    sheet). A setting stays open after a press so its new state shows. */
export interface AccountAction {
  key: string;
  icon: ReactNode;
  label: string;
  onSelect: () => void;
  /** a setting: aria-pressed, and the menu stays open */
  pressed?: boolean;
  /** the one consequential row (Sign out) - drawn in the danger ink, set apart */
  danger?: boolean;
}

/**
 * Presentation grouping only — see the note above. Order defines display order.
 *
 * v1.102.0 — CEO, 05-09-2026, writing the whole tab list out in the order he
 * wants it. These sections are CUTS of that one sequence, not a second
 * ordering laid over it: read the tabs down this list and you get exactly
 * ALL_TABS in lib/portal-tabs.ts, which is also the order of the phone bottom
 * bar. tests/registry-parity.mjs holds the two together, because a sidebar
 * that resequences the registry is a second answer to "what order are the
 * tabs in", and the whole point of v1.79.0 was that there is one.
 *
 * v1.172.0 — Portal UI V2. The CEO's target information architecture is
 * OVERVIEW / SALES / OPERATIONS / PEOPLE / AUTOMATION / INTELLIGENCE / SYSTEM,
 * exposing only modules that exist. Mapped onto this portal:
 *   Overview    Dashboard
 *   Sales       Ecommerce, Sales (what is sold and to whom; v1.183.0 -
 *               Enquiries, Sales Performance and Hankei's retired)
 *   Operations  Inventory, Assets, Hotels (what the company holds and works)
 *   ELFIA       ELFIA Store, ELFIA Traffic - the client store is a workspace
 *               of its own and keeps the heading the CEO gave it (v1.183.0 -
 *               Web Orders retired)
 *   People      HR through Payroll
 *   Finance     Finance, Accounting, Companies - no target group names them
 *               and they exist, so they keep their own heading (v1.183.0 -
 *               Commission retired)
 *   Account     Cards, Profile (who you are)
 *   System      Users (accounts, permissions, locations - the settings)
 * AUTOMATION and INTELLIGENCE have no portal modules yet (Telegram is an API
 * contract and a simulator, not a tab) and are therefore not drawn: a heading
 * with nothing under it is a promise the product does not keep.
 *
 * Stokis, Content and Threads are absent because they are PARKED, and a parked
 * tab never reaches this component: it is filtered out of `items` upstream.
 */
/* v1.277.0 - A2Z OS 3.0 NAVIGATION (the CEO approved it 10-11-2026,
   claude/UIUX-3.0-BLUEPRINT.md section 5): HOME, REVENUE, OPERATIONS, ELFIA,
   PEOPLE, FINANCE, SYSTEM. Overview is "Home", Sales is "Revenue" (so the
   group is never mistaken for the Sales tab), Tasks joins Operations, and
   the Account pair (Cards, Profile) is drawn at the rail's foot beside the
   person's name instead of as a group (FOOT_SECTION) - still a section, so
   the More sheet and the access review keep listing it. Same tabs, same
   access, same URLs. */
/* v1.287.0 - GLOBAL NAVIGATION (the CEO approved the blueprint, 12-11-2026,
   claude/NAVIGATION-BLUEPRINT.md): WORKSPACE, REVENUE, OPERATIONS, PEOPLE,
   FINANCE, ELFIA, SYSTEM, and the Account pair at the foot. The groups now
   live beside the registry (NAV_GROUPS in lib/portal-tabs.ts) so the rail,
   the phone's More sheet and the access card read ONE list; SECTIONS stays
   the name those readers import. Same tabs, same access, same URLs. */
export const SECTIONS: { title: string; tabs: string[] }[] = NAV_GROUPS;
/** v1.277.0 - the section the portal rail draws at its foot, with the name */
export const FOOT_SECTION = "Account";
/* v1.287.0 - the desktop "More" of v1.279.0 (RAIL_PRIMARY: fifteen modules
   on the rail, every other one under More) is gone, by the CEO's directive
   of 12-11-2026 ("NO UNSTRUCTURED MORE CATEGORY ON DESKTOP"): every module
   the person may open is drawn in its own group. */
/** the group id of a section title (GROUP_ICON is keyed by id) */
const groupId = (title: string) => NAV_GROUPS.find((g) => g.title === title)?.id ?? title.toLowerCase();
/** v1.277.0 - which groups this device folded (titles); the group holding
    the open tab is always unfolded */
export const NAV_GROUPS_KEY = "azone-nav-folded";
/* read as an external store: the server and the first client paint agree
   (nothing folded), then the device's choice applies; a blocked storage
   means every group stays open, never an error */
let foldedMemory = "[]";
const foldedListeners = new Set<() => void>();
const subscribeFolded = (cb: () => void) => {
  foldedListeners.add(cb);
  const onStorage = (e: StorageEvent) => { if (e.key === NAV_GROUPS_KEY) cb(); };
  window.addEventListener("storage", onStorage);
  return () => { foldedListeners.delete(cb); window.removeEventListener("storage", onStorage); };
};
const readFolded = () => { try { return window.localStorage.getItem(NAV_GROUPS_KEY) ?? foldedMemory; } catch { return foldedMemory; } };
const writeFolded = (v: string) => {
  foldedMemory = v;
  try { window.localStorage.setItem(NAV_GROUPS_KEY, v); } catch { /* the fold lasts this visit */ }
  foldedListeners.forEach((cb) => cb());
};

/** BM display names for the section headings - ONE map, read by this rail
    and by the phone's More sheet (app/portal/page.tsx), so the two surfaces
    cannot name a group differently. */
export const SECTION_LABEL_MS: Record<string, string> = {
  Overview: "Ringkasan", Workspace: "Ruang Kerja", Sales: "Jualan", Home: "Utama", Revenue: "Hasil", Operations: "Operasi", ELFIA: "ELFIA", People: "Kakitangan",
  Finance: "Kewangan", Account: "Akaun", System: "Sistem", Other: "Lain-lain",
  /* v1.228.0 - the /admin and /account rails (console-shell.tsx) */
  Content: "Kandungan", Leads: "Prospek", Client: "Klien",
};
export const sectionTitle = (title: string, lang: string): string =>
  lang === "ms" ? SECTION_LABEL_MS[title] ?? title : title;

/** v1.172.0 - the rail remembers whether it was collapsed. One key, read
    before the first paint of the shell by app/portal/page.tsx. */
export const NAV_COLLAPSED_KEY = "azone-nav-collapsed";

export function SideNav({
  items, active, onSelect, onSignOut, collapsed, onToggleCollapsed, userName, userRole, sections = SECTIONS,
  accountMenu, userPhoto, onProjects,
}: {
  items: NavItem[];
  active: string;
  onSelect: (name: string) => void;
  onSignOut: () => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  userName: string;
  userRole: string;
  /** v1.228.0 - the grouping for a console that is not the portal (/admin,
      /account: components/layout/console-shell.tsx). The portal passes
      nothing and keeps SECTIONS. */
  sections?: { title: string; tabs: string[] }[];
  /** v1.279.0 - the portal's name card opens this menu (profile, cards,
      sound, push, language, colour theme, sign out - the settings that left
      the header). Without it the foot keeps its plain Sign out row. */
  accountMenu?: AccountAction[];
  /** v1.279.0 - the photo on the person's badge card, if any */
  userPhoto?: string | null;
  /** v1.279.0 - the Projects shortcut (Tasks > Projects); drawn only when
      the portal passes it, i.e. the person may open Tasks and its projects */
  onProjects?: () => void;
}) {
  const lang = getLang();
  const ms = lang === "ms";
  const byName = new Map(items.map((i) => [i.name, i]));
  const navRef = useRef<HTMLElement | null>(null);
  /* v1.172.0 - the icon-only rail names its destinations on hover and on
     keyboard focus, so a collapsed rail is never a memory test. ONE floating
     label, fixed to the viewport beside the hovered button: a label inside
     the scrolling <nav> would be clipped by its overflow. Decorative - each
     button's aria-label already carries the name. */
  const [tip, setTip] = useState<{ label: string; top: number; left: number } | null>(null);
  /* v1.287.0 - the collapsed portal rail draws one icon per group; the icon
     opens a labelled flyout of that group's modules (the CEO's choice D2).
     Arrow keys move inside it, Escape closes it and returns to the icon, a
     click outside or a choice closes it. Fixed to the viewport beside the
     icon, like the tooltip, so the scrolling <nav> cannot clip it. */
  const [fly, setFly] = useState<{ title: string; top: number; left: number } | null>(null);
  const flyRef = useRef<HTMLDivElement | null>(null);
  const flyOpener = useRef<HTMLButtonElement | null>(null);
  const closeFly = (refocus: boolean) => { setFly(null); if (refocus) flyOpener.current?.focus(); };
  useEffect(() => {
    if (!fly) return;
    flyRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (flyRef.current?.contains(t) || flyOpener.current?.contains(t)) return;
      setFly(null);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [fly]);
  const onFlyKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") { e.preventDefault(); closeFly(true); return; }
    if (e.key === "Tab") { setFly(null); return; }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
    const nodes = Array.from(flyRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? []);
    const at = nodes.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === "Home" ? 0 : e.key === "End" ? nodes.length - 1 : e.key === "ArrowDown" ? Math.min(at + 1, nodes.length - 1) : Math.max(at - 1, 0);
    e.preventDefault();
    nodes[next]?.focus();
  };
  const showTip = (el: HTMLElement, label: string) => {
    if (!collapsed) return;
    const r = el.getBoundingClientRect();
    setTip({ label, top: r.top + r.height / 2, left: r.right + 8 });
  };
  /* v1.172.0 - roving keyboard focus along the rail: Up/Down move between
     destinations across section boundaries, Home/End jump to the ends. Tab
     still leaves the rail after one stop, as a toolbar should. */
  const onNavKey = (e: KeyboardEvent<HTMLElement>) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
    const nodes = Array.from(navRef.current?.querySelectorAll<HTMLButtonElement>("button[data-nav-item]") ?? []);
    if (nodes.length === 0) return;
    const at = nodes.indexOf(document.activeElement as HTMLButtonElement);
    let next = at;
    if (e.key === "ArrowDown") next = at < 0 ? 0 : Math.min(at + 1, nodes.length - 1);
    if (e.key === "ArrowUp") next = at < 0 ? nodes.length - 1 : Math.max(at - 1, 0);
    if (e.key === "Home") next = 0;
    if (e.key === "End") next = nodes.length - 1;
    e.preventDefault();
    nodes[next]?.focus();
  };
  /* v1.277.0 - folded groups, remembered on this device (never required:
     a private window simply starts with every group open) */
  const portalRail = sections === SECTIONS;
  const foldedRaw = useSyncExternalStore(subscribeFolded, readFolded, () => "[]");
  let folded: string[] = [];
  if (portalRail) { try { const v = JSON.parse(foldedRaw); if (Array.isArray(v)) folded = v.filter((x): x is string => typeof x === "string"); } catch { folded = []; } }
  const toggleGroup = (title: string) => {
    const next = folded.includes(title) ? folded.filter((t) => t !== title) : [...folded, title];
    writeFolded(JSON.stringify(next));
  };
  const grouped = sections
    .map((s) => ({ title: s.title, items: s.tabs.map((t) => byName.get(t)).filter((x): x is NavItem => !!x) }))
    .filter((s) => s.items.length > 0);

  // Anything the SECTIONS map doesn't know about still gets a home.
  const placed = new Set(sections.flatMap((s) => s.tabs));
  const orphans = items.filter((i) => !placed.has(i.name));
  if (orphans.length) grouped.push({ title: "Other", items: orphans });
  /* the portal's Account pair goes to the foot, beside the name */
  const foot = portalRail ? grouped.find((g) => g.title === FOOT_SECTION) : undefined;
  const railGroups = foot ? grouped.filter((g) => g !== foot) : grouped;
  /* the expanded portal rail; the collapsed one draws group icons instead */
  const fullRail = portalRail && !collapsed;
  const groupRail = portalRail && collapsed;
  /* the name card's menu: closes on Escape, on a click outside, on a choice */
  const [menuOpen, setMenuOpen] = useState(false);
  const footRef = useRef<HTMLDivElement | null>(null);
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => { if (footRef.current && !footRef.current.contains(e.target as Node)) setMenuOpen(false); };
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === "Escape") { setMenuOpen(false); menuButtonRef.current?.focus(); } };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [menuOpen]);
  const closeMenu = () => setMenuOpen(false);
  const initials = userName.trim().split(/\s+/).slice(0, 2).map((w) => w.charAt(0).toUpperCase()).join("") || "?";

  const itemButton = (it: NavItem) => {
    const on = it.name === active;
    return (
      <li key={it.name}>
        <button
          type="button"
          data-nav-item
          onClick={() => { onSelect(it.name); setMenuOpen(false); }}
          onMouseEnter={(e) => showTip(e.currentTarget, it.label)}
          onFocus={(e) => showTip(e.currentTarget, it.label)}
          onMouseLeave={() => setTip(null)}
          onBlur={() => setTip(null)}
          aria-current={on ? "page" : undefined}
          title={collapsed ? it.label : undefined}
          aria-label={it.label}
          className="erp-rail-item"
        >
          {/* the gold active marker is drawn by .erp-rail-item[aria-current] */}
          <span className="erp-rail-icon"><TabIcon name={it.name} className="erp-icon" /></span>
          {!collapsed && <span className="erp-rail-item-label">{it.label}</span>}
        </button>
      </li>
    );
  };
  /* v1.279.0 - Projects is a way into Tasks > Projects, not a tab of its
     own: it never carries aria-current (Tasks does, whichever Tasks view is
     open), and it is not a registry entry, so access stays the Tasks tab's */
  const projectsButton = onProjects ? (
    <li key="__projects">
      <button type="button" data-nav-item className="erp-rail-item" onClick={onProjects}>
        <span className="erp-rail-icon"><FolderKanban aria-hidden className="erp-icon" strokeWidth={1.75} /></span>
        <span className="erp-rail-item-label">{ms ? "Projek" : "Projects"}</span>
      </button>
    </li>
  ) : null;

  return (
    <aside
      className="erp-rail"
      data-collapsed={collapsed || undefined}
      aria-label={ms ? "Navigasi utama" : "Main navigation"}
    >
      {/* v1.172.1 (Interface System V3): the rail, its brand row, groups,
          items, tooltip and footer are named classes in styles/erp-v3.css;
          nothing here spells a look out by hand any more. */}
      {/* Brand + collapse toggle */}
      <div className="erp-rail-brand">
        {portalRail ? (
          /* v1.279.0 - the photo's wordmark; the image logo stays on the
             /admin and /account rails */
          !collapsed && (
            <span className={css.wordmark}>
              <span className={css.wordmarkName}>A2Z <span className={css.wordmarkOs}>OS</span></span>
              <span className={css.wordmarkSub}>A2Z CREATIVE MARKETING</span>
            </span>
          )
        ) : (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {!collapsed && <img src="/logo.png" alt="" className="erp-rail-logo" />}
            {!collapsed && (
              <span className="erp-rail-brand-name">
                A2Z CREATIVE MARKETING
              </span>
            )}
          </>
        )}
        <button
          type="button"
          onClick={() => { setFly(null); onToggleCollapsed(); }}
          aria-label={collapsed ? (ms ? "Buka navigasi" : "Expand navigation") : (ms ? "Kecilkan navigasi" : "Collapse navigation")}
          title={collapsed ? (ms ? "Buka navigasi" : "Expand navigation") : (ms ? "Kecilkan navigasi" : "Collapse navigation")}
          aria-expanded={!collapsed}
          className="erp-icon-button erp-icon-button-ghost"
        >
          {collapsed ? <PanelLeftOpen aria-hidden className="erp-icon" /> : <PanelLeftClose aria-hidden className="erp-icon" />}
        </button>
      </div>

      <nav ref={navRef} onKeyDown={onNavKey} className="erp-rail-nav" data-style={fullRail ? "photo" : undefined}>
        {groupRail && railGroups.map((section) => {
          const id = groupId(section.title);
          const holds = section.items.some((i) => i.name === active);
          const open = fly?.title === section.title;
          const name = sectionTitle(section.title, lang);
          return (
            <div key={section.title} className="erp-rail-group" data-group={section.title}>
              <ul>
                <li>
                  <button type="button" data-nav-item data-group-icon={id} className={`erp-rail-item ${holds ? css.groupOn : ""}`}
                    /* the group holding the open page wears the gold, so the place is never lost */
                    data-holds-active={holds || undefined}
                    aria-haspopup="true" aria-expanded={open} aria-controls={open ? "rail-flyout" : undefined}
                    aria-label={ms ? `Kumpulan ${name}` : `${name} group`}
                    onMouseEnter={(e) => showTip(e.currentTarget, name)} onMouseLeave={() => setTip(null)}
                    onFocus={(e) => { if (!fly) showTip(e.currentTarget, name); }} onBlur={() => setTip(null)}
                    onClick={(e) => {
                      setTip(null);
                      if (open) { setFly(null); return; }
                      flyOpener.current = e.currentTarget;
                      const r = e.currentTarget.getBoundingClientRect();
                      setFly({ title: section.title, top: Math.min(r.top, window.innerHeight - 24 - (section.items.length + 2) * 44), left: r.right + 8 });
                    }}>
                    <span className="erp-rail-icon"><GroupIcon id={id} className="erp-icon" /></span>
                  </button>
                </li>
              </ul>
            </div>
          );
        })}
        {!groupRail && railGroups.map((section) => {
          const shown = section.items;
          const withProjects = fullRail && section.title === "Operations" && projectsButton;
          if (shown.length === 0 && !withProjects) return null;
          /* v1.277.0 - a group folds (the chevron), except the one holding the
             open tab, which always shows its items */
          const holdsActive = shown.some((i) => i.name === active);
          const open = collapsed || !portalRail || holdsActive || !folded.includes(section.title);
          const listId = `rail-${section.title.replace(/\W+/g, "-").toLowerCase()}`;
          return (
          <div key={section.title} className="erp-rail-group" data-group={section.title}>
            {/* The section header names the group; on the portal rail it is
                the fold button. Collapsed mode replaces it with a hairline so
                the grouping is still legible without text. */}
            {collapsed ? (
              <div className="erp-rail-group-rule" aria-hidden />
            ) : portalRail ? (
              <button type="button" className={`erp-rail-group-label ${css.groupToggle}`}
                aria-expanded={open} aria-controls={listId} disabled={holdsActive}
                /* named "Finance group", never just "Finance": the Finance TAB keeps its name to itself */
                aria-label={ms ? `Kumpulan ${sectionTitle(section.title, lang)}` : `${sectionTitle(section.title, lang)} group`}
                title={holdsActive ? undefined : open ? (ms ? "Lipat kumpulan" : "Fold the group") : (ms ? "Buka kumpulan" : "Open the group")}
                onClick={() => toggleGroup(section.title)}>
                <span>{sectionTitle(section.title, lang)}</span>
                {!holdsActive && <ChevronDown aria-hidden className={`${css.chevron} ${open ? "" : css.chevronShut}`} />}
              </button>
            ) : (
              <p className="erp-rail-group-label">
                {sectionTitle(section.title, lang)}
              </p>
            )}
            {open && <ul id={listId}>{withProjects}{shown.map(itemButton)}</ul>}
          </div>
          );
        })}
      </nav>

      {fly && groupRail && (() => {
        const g = railGroups.find((x) => x.title === fly.title);
        if (!g) return null;
        const name = sectionTitle(g.title, lang);
        return (
          <div id="rail-flyout" ref={flyRef} className={css.flyout} style={{ top: fly.top, left: fly.left }}
            role="group" aria-label={name} onKeyDown={onFlyKey} data-testid="rail-flyout">
            <p className={css.flyTitle} aria-hidden>{name}</p>
            <ul className={css.flyList}>
              {g.title === "Operations" && onProjects && (
                <li><button type="button" className={css.flyItem} onClick={() => { closeFly(false); onProjects(); }}>
                  <FolderKanban aria-hidden className="erp-icon" strokeWidth={1.75} /><span>{ms ? "Projek" : "Projects"}</span>
                </button></li>
              )}
              {g.items.map((it) => (
                <li key={it.name}><button type="button" className={css.flyItem} aria-current={it.name === active ? "page" : undefined}
                  onClick={() => { closeFly(false); onSelect(it.name); }}>
                  <TabIcon name={it.name} className="erp-icon" /><span>{it.label}</span>
                </button></li>
              ))}
            </ul>
          </div>
        );
      })()}
      {tip && collapsed && (
        <span aria-hidden style={{ top: tip.top, left: tip.left }} className="erp-rail-tip">
          {tip.label}
        </span>
      )}

      {/* Signed-in identity + sign out */}
      {accountMenu ? (
        /* v1.279.0 - the photo's name card: avatar, name, role. It opens the
           account menu - profile, cards and the set-once settings that left
           the header, and Sign out */
        <div className={`erp-rail-foot ${css.foot}`} ref={footRef}>
          {menuOpen && (
            <div id="rail-account-menu" className={css.menu} role="group" aria-label={ms ? "Akaun anda" : "Your account"}>
              {foot && <ul className={css.menuItems}>{foot.items.map((it) => (
                <li key={it.name}>
                  <button type="button" className={css.menuItem} aria-current={it.name === active ? "page" : undefined}
                    onClick={() => { onSelect(it.name); closeMenu(); }}>
                    <TabIcon name={it.name} className="erp-icon" />{it.label}
                  </button>
                </li>
              ))}</ul>}
              <ul className={css.menuItems}>{accountMenu.filter((a) => !a.danger).map((a) => (
                <li key={a.key}>
                  <button type="button" className={css.menuItem} aria-pressed={a.pressed}
                    onClick={() => { a.onSelect(); if (a.pressed === undefined) closeMenu(); }}>
                    {a.icon}<span className={css.menuLabel}>{a.label}</span>
                    {a.pressed !== undefined && <span aria-hidden className={a.pressed ? css.menuOn : css.menuOff}>{a.pressed ? (ms ? "Hidup" : "On") : (ms ? "Mati" : "Off")}</span>}
                  </button>
                </li>
              ))}</ul>
              {accountMenu.filter((a) => a.danger).map((a) => (
                <button key={a.key} type="button" className={`${css.menuItem} ${css.menuDanger}`} onClick={() => { closeMenu(); a.onSelect(); }}>
                  {a.icon}{a.label}
                </button>
              ))}
            </div>
          )}
          <button type="button" ref={menuButtonRef} className={css.me} aria-expanded={menuOpen} aria-controls="rail-account-menu"
            aria-label={ms ? `Akaun anda: ${userName}` : `Your account: ${userName}`} title={collapsed ? userName : undefined}
            onClick={() => setMenuOpen((v) => !v)}>
            {userPhoto
              /* eslint-disable-next-line @next/next/no-img-element */
              ? <img src={userPhoto} alt="" className={css.avatar} />
              : <span aria-hidden className={css.avatar}>{initials}</span>}
            {!collapsed && (
              <span className={css.meText}>
                <span className={css.meName}>{userName}</span>
                <span className={css.meRole}>{userRole.replace(/_/g, " ")}</span>
              </span>
            )}
            {!collapsed && <ChevronsUpDown aria-hidden className={css.meChevron} />}
          </button>
        </div>
      ) : (
      <div className="erp-rail-foot">
        {foot && <ul className={css.footItems} aria-label={sectionTitle(FOOT_SECTION, lang)}>{foot.items.map(itemButton)}</ul>}
        {!collapsed && (
          <div className="erp-rail-user">
            <p className="erp-rail-user-name">{userName}</p>
            <p className="erp-rail-user-role">{userRole.replace(/_/g, " ")}</p>
          </div>
        )}
        <button
          type="button"
          onClick={onSignOut}
          title={ms ? "Log keluar" : "Sign out"}
          aria-label={ms ? "Log keluar" : "Sign out"}
          className="erp-rail-item erp-rail-item-signout"
        >
          <span className="erp-rail-icon"><LogOut aria-hidden className="erp-icon" strokeWidth={1.75} /></span>
          {!collapsed && <span className="erp-rail-item-label">{ms ? "Log keluar" : "Sign out"}</span>}
        </button>
      </div>
      )}
    </aside>
  );
}

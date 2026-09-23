"use client";

/**
 * THE PERSISTENT SHELL — P1.1, v1.181.0.
 *
 * Everything that is on screen whichever module you are looking at: the
 * desktop rail, the topbar, the notification panel, the phone's bottom bar,
 * the More sheet and the command palette. It moved out of
 * `app/portal/page.tsx` VERBATIM — not one class name, handler or comment
 * was changed on the way — so that P1.2 can swap the module underneath it
 * without the shell remounting.
 *
 * It reads everything from `usePortal()`. It owns no state of its own, which
 * is deliberate: a shell with private state is a shell that loses it the
 * first time the tree above it re-renders.
 *
 * `{children}` is the module. Today that is `app/portal/page.tsx`'s
 * thirty-three-branch switch, handed down by the layout; from P1.2 it will
 * be one route's page. `<main key={tab}>` is unchanged, so the
 * `screen-enter` animation and the per-tab remount behave exactly as they
 * did.
 */

import type { ReactNode } from "react";

import { api } from "@/lib/api";
import { enablePush, disablePush } from "@/lib/push-client";
import { AppIcon } from "@/components/ui/app-icon";
import { AppShell } from "@/components/layout/app-shell";
import { SideNav, sectionTitle } from "@/components/layout/side-nav";
import { TabIcon, LogOut, Search, Bell, BellRing, BellOff, Moon, Sun, Volume2, VolumeX, Palette, CloseX, Ellipsis } from "@/components/layout/nav-icons";
import { setLang as persistLang, t as tr } from "@/lib/i18n";
import { APP_VERSION } from "@/lib/version";
import { CommandPalette } from "@/components/layout/command-palette";
import { FAVOURITES_MAX, favouritesFull, toggleFavourite } from "@/lib/favourites";
import { clearApiCache } from "@/lib/cached-api";
import { revealAnchor } from "@/components/portal/page-shared";
import { REVENUE_ROLES } from "@/components/portal/dashboard";
import { PORTAL_WIDTH, btnGhost, btnHdr, btnHdrDesktop, card, mobileAppBottomClearance, mobileBottomNav, sheetCard } from "@/lib/ui-styles";
import { L } from "@/components/portal/page-shared";
import { dmy } from "@/lib/format";
import type { TabName } from "@/lib/portal-tabs";
import { usePortal } from "@/components/portal/portal-provider";
import css from "@/app/portal/portal.module.css";

/* v1.176.0 — WHERE AN UPDATE IS READ. The bell is for updates with links, not
   a second approval queue: it says a thing happened and takes you to the
   record. The DESK is where what is waiting on you to DECIDE lives, and the
   two counts answer different questions — unread messages here, pending
   decisions there. Kinds come from worker/src/staff.ts `notify(...)`. */
const NOTIF_WHERE: Record<string, { tab: string; anchor?: string }> = {
  announcement: { tab: "Announcements" },
  enquiry: { tab: "Enquiries" },
  ot: { tab: "Attendance", anchor: "ot-approvals" },
  attendance: { tab: "Attendance", anchor: "pending-punches" },
  claim: { tab: "Claims", anchor: "claims-pending" },
  leave: { tab: "Leave" },
  task: { tab: "Tasks" },
  watch: { tab: "Desk" },
  commission: { tab: "Commission" },
};

export function PortalShell({ children }: { children: ReactNode }) {
  const {
    user, setUser, navCollapsed, toggleNavCollapsed,
    tab, setTab, activeTab, canOpen, deskStop, setDeskStop,
    setSalesStart, setSalesCreateRequest,
    dark, setDark, theme, setTheme, lang, setLangState,
    notifs, unread, showNotifs, setShowNotifs,
    moreOpen, setMoreOpen, paletteOpen, setPaletteOpen,
    sound, setSound, pushState, setPushState, chime,
    favourites, navItems, mobileStops, mobileMore, mobileGroups,
  } = usePortal();

  /* v1.175.0 — one module tile for the More sheet: the button that opens it,
     plus a pin toggle in its corner. Two sibling buttons, never nested, so
     both are reachable by keyboard and the pin never swallows the open. */
  const moreTile = (t: TabName) => {
    const pinned = favourites.includes(t);
    const full = favouritesFull(user?.id, t);
    return (
      <span key={t} className={css.moreCell}>
        <button
          type="button"
          onClick={() => { setTab(t); setMoreOpen(false); window.scrollTo({ top: 0 }); }}
          className={`${css.moreTab} ${tab === t ? css.moreTabOn : ""}`}
        >
          <span aria-hidden className="erp-center">
            <TabIcon name={t} />
          </span>
          {tr(t, lang)}
        </button>
        <button
          type="button"
          aria-pressed={pinned}
          disabled={!pinned && full}
          className={`${css.morePin} ${pinned ? css.morePinOn : ""}`}
          title={pinned
            ? L(`Unpin ${tr(t, lang)}`, `Nyahsemat ${tr(t, lang)}`)
            : full
              ? L(`Six pinned already — unpin one first`, `Enam sudah disemat — nyahsemat satu dahulu`)
              : L(`Pin ${tr(t, lang)} to the bottom bar`, `Semat ${tr(t, lang)} ke bar bawah`)}
          aria-label={pinned
            ? L(`Unpin ${tr(t, lang)}`, `Nyahsemat ${tr(t, lang)}`)
            : L(`Pin ${tr(t, lang)}`, `Semat ${tr(t, lang)}`)}
          onClick={() => toggleFavourite(user?.id, t)}
        >
          <AppIcon name="star" />
        </button>
      </span>
    );
  };

  return (
    /* Navigation receives the already permission-filtered registry. */
    <AppShell
      navigation={
        <SideNav
          items={navItems}
          active={activeTab}
          collapsed={navCollapsed}
          onToggleCollapsed={toggleNavCollapsed}
          userName={user.name}
          userRole={user.role}
          onSelect={(t) => setTab(t as TabName)}
          onSignOut={() =>
            void api("/auth/logout", {
              method: "POST",
              body: JSON.stringify({}),
            }).then(() => {
              clearApiCache();
              setUser(null);
            })
          }
        />
      }
    >
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        tabs={navItems}
        canSeeClients={REVENUE_ROLES.includes(user.role)}
        onTab={(t) => setTab(t as TabName)}
        pinned={favourites}
        extraActions={[
          {
            label: tr("Apply leave", lang),
            hint: L("action", "tindakan"),
            run: () => {
              setTab("Leave");
              setPaletteOpen(false);
            },
          },
          ...(canOpen("Sales")
            ? [
                {
                  label: tr("Create quotation", lang),
                  hint: L("action", "tindakan"),
                  run: () => {
                    setSalesStart("create");
                    setSalesCreateRequest((n) => n + 1);
                    setTab("Sales");
                    setPaletteOpen(false);
                  },
                },
              ]
            : []),
          {
            label: L("Toggle dark mode", "Tukar mod gelap"),
            hint: L("action", "tindakan"),
            run: () => {
              setDark((v) => !v);
              setPaletteOpen(false);
            },
          },
        ]}
      />
      {/* v1.164.1: the bottom clearance now follows the fixed nav's real PWA
        safe-area formula instead of a detached pb-28 guess. */}
      {/* v1.70.0 (CEO: "make the width globally standardize instead of
          inconsistent") — the portal had NO maximum width on desktop
          (`md:max-w-none`), so every card stretched to whatever the window
          happened to be. On a wide monitor that gives a paragraph a
          200-character line while the card beside it holds a table pinned to
          760px, and nothing on the page shares a measure.
          One standard width, centred, defined once in ui-styles and used by
          every screen. 1600px is wide enough for the seven-column roster and
          the payroll tables, narrow enough that prose stays readable. */}
      <div className={`${css.page} ${mobileAppBottomClearance} ${PORTAL_WIDTH}`}>
        {/* v1.13.0: on desktop this row IS the shell's topbar. `md:-mx-5 md:-mt-4`
          breaks it out of <main>'s padding so it spans the full working area,
          and it stays sticky/bordered instead of dissolving into the page as
          it did before. Every mobile class is unchanged. */}
        {/* v1.109.1 — CEO, 05-09-2026, the portal installed on his Android
            Home Screen: the clock, signal and battery drawn straight over the
            avatar and "Today". The manifest asks for viewport-fit=cover, so
            an installed app runs edge to edge and the status bar is OURS to
            clear. The header pads its top by the safe-area inset - zero in a
            browser tab, the status bar's height when installed - and, being
            sticky, keeps clearing it as the page scrolls. The bottom bar has
            done the same for its inset since v1.10.0; the top simply never
            had to until phones started drawing under it. */}
        {/* v1.172.1 (Interface System V3): the header is the named
            .erp-topbar (styles/erp-v3.css) - one blur on phones, a plain bar
            on desktop, sticky at the top, and (v1.172.2) the owner of its
            own --hdr-pt. The status-bar inset stays written here, where
            tests/shell-scroll.mjs reads it: the inset is ADDED to the bar's
            own top padding, never swapped for it. */}
        <header className="erp-topbar"
          style={{ paddingTop: "calc(var(--hdr-pt) + env(safe-area-inset-top, 0px))" }}>
          <div className={css.identity}>
            {/* v1.4.141: the badge-card photo as an app-style avatar — circular,
              gold-ringed, next to the welcome on desktop and the screen title
              on mobile. Falls back to the initial when no photo is set. */}
            {user.photo_key ? (
              <img
                src={`/api/v1/media/file/${encodeURIComponent(user.photo_key)}`}
                alt=""
                className={css.avatar}
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                }}
              />
            ) : (
              <span className={`${css.avatar} ${css.avatarInitial}`}>
                {user.name.trim().charAt(0).toUpperCase()}
              </span>
            )}
            <div className="erp-min0">
              <p className="erp-topbar-eyebrow erp-desktop-only">
                {tr("Staff Portal short", lang)}
              </p>
              {/* Tablet tools use a second row so translated titles remain readable. */}
              <h1 className="erp-topbar-title erp-desktop-only">
                {tr(activeTab, lang)}
              </h1>
              {/* On phones the header reads like an app screen title.
                v1.10.0: the Dashboard says "Today" (the reference design's
                home title); every other tab keeps its own name. */}
              <h1 className="erp-topbar-title erp-phone-only">
                {activeTab === "Dashboard"
                  ? tr("Today", lang)
                  : tr(activeTab, lang)}
              </h1>
            </div>
          </div>
          <div className={css.tools}>
            {/* v1.8.0: global search — opens the palette (Ctrl/Cmd+K works anywhere) */}
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              className={`erp-button erp-button-secondary ${css.searchPill}`}
              aria-label={L("Search the portal", "Cari dalam portal")}
            >
              <span className={css.searchPillInner}>
                <Search aria-hidden className="erp-icon" strokeWidth={1.75} />{" "}
                {tr("Search…", lang)}
              </span>
              <kbd className={css.kbd}>
                Ctrl K
              </kbd>
            </button>
            <button
              type="button"
              className={`${btnHdr} erp-phone-only`}
              onClick={() => setPaletteOpen(true)}
              aria-label={L("Search the portal", "Cari dalam portal")}
            >
              <Search aria-hidden className="erp-icon" strokeWidth={1.75} />
            </button>
            {/* v1.10.0: sound, push and EN/BM are set-once switches, not daily
              taps — on phones they live in the More sheet's Preferences row
              so the phone app bar keeps just search and notifications. */}
            <button
              type="button"
              className={btnHdrDesktop}
              title={
                sound
                  ? L(
                      "Notification sound ON — tap to mute",
                      "Bunyi pemberitahuan HIDUP — tekan untuk senyapkan"
                    )
                  : L(
                      "Notification sound OFF — tap to unmute",
                      "Bunyi pemberitahuan MATI — tekan untuk hidupkan"
                    )
              }
              aria-label={
                sound
                  ? L(
                      "Mute notification sound",
                      "Senyapkan bunyi pemberitahuan"
                    )
                  : L(
                      "Unmute notification sound",
                      "Hidupkan bunyi pemberitahuan"
                    )
              }
              onClick={() => {
                const next = !sound;
                setSound(next);
                localStorage.setItem("azone-notif-sound", next ? "on" : "off");
                if (next) void chime(); // audible confirmation (gesture context — always plays now)
              }}
            >
              {sound ? (
                <Volume2 aria-hidden className="erp-icon" strokeWidth={1.75} />
              ) : (
                <VolumeX aria-hidden className="erp-icon" strokeWidth={1.75} />
              )}
            </button>
            {/* v1.6.0: push alerts to this device (works even with the tab
              closed). Hidden where the browser can't do web push. */}
            {pushState !== "unsupported" && (
              <button
                type="button"
                className={btnHdrDesktop}
                title={
                  pushState === "granted"
                    ? L(
                        "Push alerts ON for this device — tap to turn off",
                        "Makluman push HIDUP untuk peranti ini — tekan untuk matikan"
                      )
                    : L(
                        "Get push alerts on this device",
                        "Dapatkan makluman push pada peranti ini"
                      )
                }
                aria-label={L("Toggle push alerts", "Togol makluman push")}
                onClick={async () => {
                  if (pushState === "granted") {
                    await disablePush();
                    setPushState("default");
                  } else {
                    const r = await enablePush();
                    if (r === "ok") {
                      setPushState("granted");
                    } else if (r === "unconfigured")
                      window.alert(
                        L(
                          "Push isn't set up on the server yet — run PUSH.bat on the office PC once; it asks for the push keys and sets them.",
                          "Push belum disediakan di pelayan — jalankan PUSH.bat di PC pejabat sekali; ia meminta kunci push dan menetapkannya."
                        )
                      );
                    else if (r === "denied")
                      window.alert(
                        L(
                          "Notifications are blocked for this site in your browser settings.",
                          "Pemberitahuan disekat untuk laman ini dalam tetapan pelayar anda."
                        )
                      );
                  }
                }}
              >
                {pushState === "granted" ? (
                  <BellRing
                    aria-hidden
                    className="erp-icon"
                    strokeWidth={1.75}
                  />
                ) : (
                  <BellOff aria-hidden className="erp-icon" strokeWidth={1.75} />
                )}
              </button>
            )}
            <button
              type="button"
              className={`${btnHdr} ${css.bellAnchor}`}
              aria-label={
                unread > 0
                  ? L(
                      `Notifications — ${unread} unread`,
                      `Pemberitahuan — ${unread} belum dibaca`
                    )
                  : tr("Notifications", lang)
              }
              onClick={() => {
                /* v1.176.0 — mark read when the panel CLOSES. Marking on open
                   cleared the badge before the person had read a word, which
                   made the unread state meaningless. */
                setShowNotifs((v) => {
                  if (v && unread)
                    void api("/staff/notifications/read", {
                      method: "POST",
                      body: JSON.stringify({}),
                    });
                  return !v;
                });
              }}
            >
              <Bell aria-hidden className="erp-icon" strokeWidth={1.75} />
              {unread > 0 && (
                <span className="erp-badge erp-pulse">
                  {unread > 9 ? "9+" : unread}
                </span>
              )}
            </button>
            {/* v1.9.0: theme preset + chrome language */}
            <button
              type="button"
              className={btnHdrDesktop}
              title={
                theme === "plum"
                  ? L(
                      "Theme: Plum & Rose — switch to Navy & Gold",
                      "Tema: Plum & Rose — tukar ke Navy & Gold"
                    )
                  : L(
                      "Theme: Navy & Gold — switch to Plum & Rose",
                      "Tema: Navy & Gold — tukar ke Plum & Rose"
                    )
              }
              aria-label={L("Switch colour theme", "Tukar tema warna")}
              onClick={() => setTheme(theme === "plum" ? "navy" : "plum")}
            >
              <Palette aria-hidden className="erp-icon" strokeWidth={1.75} />
            </button>
            <button
              type="button"
              className={`${btnHdrDesktop} ${css.langButton}`}
              title={
                lang === "ms"
                  ? "Bahasa: BM — tukar ke English"
                  : "Language: EN — switch to Bahasa Melayu"
              }
              aria-label={L("Toggle language", "Togol bahasa")}
              onClick={() => {
                const next = lang === "ms" ? "en" : "ms";
                setLangState(next);
                persistLang(next);
              }}
            >
              {lang === "ms" ? "BM" : "EN"}
            </button>
            <button
              type="button"
              className={btnHdrDesktop}
              onClick={() => setDark((v) => !v)}
              aria-label={L("Toggle dark mode", "Togol mod gelap")}
            >
              {dark ? (
                <Sun aria-hidden className="erp-icon" strokeWidth={1.75} />
              ) : (
                <Moon aria-hidden className="erp-icon" strokeWidth={1.75} />
              )}
            </button>
            {/* v1.16.0 (CEO): icon-only — the text label cost ~70px in a row
              that was already squeezing the greeting. title + aria-label keep
              it discoverable and announced. */}
            <button
              type="button"
              className={btnHdrDesktop}
              title={tr("Sign out", lang)}
              aria-label={tr("Sign out", lang)}
              onClick={() =>
                void api("/auth/logout", {
                  method: "POST",
                  body: JSON.stringify({}),
                }).then(() => {
                  clearApiCache();
                  setUser(null);
                })
              }
            >
              <LogOut aria-hidden className="erp-icon" strokeWidth={1.75} />
            </button>
          </div>
        </header>

        {showNotifs && (
          <div className={`${card} erp-mt-4`}>
            <p className="erp-heading">{tr("Notifications", lang)}</p>
            <p className="erp-meta erp-mt-half">
              {L(
                "Last 7 days. Older notifications clear automatically.",
                "7 hari terakhir. Pemberitahuan lama dipadam secara automatik."
              )}
            </p>
            {notifs.length === 0 && (
              <p className="erp-text-sm erp-muted erp-mt-2">
                {L("Nothing yet.", "Tiada apa-apa lagi.")}
              </p>
            )}
            <div className={css.notifList}>
              {notifs.map((n) => (
                /* v1.176.0 — AN UPDATE, WITH SOMEWHERE TO GO. Every row is a
                   link now: NOTIF_WHERE maps the kind to the tab (and the
                   section inside it) holding the record, so an overtime or
                   claim update is no longer dead text. Unread rows are marked,
                   and the panel marks read on CLOSE, not on open, so the state
                   still means something while you read.
                   THIS IS NOT AN APPROVAL QUEUE: nothing is actioned here, the
                   badge counts unread MESSAGES, and what is waiting on you to
                   DECIDE is the Desk's own count. Two different questions. */
                <p key={n.id} className={`${css.notifItem} ${n.is_read ? "" : css.notifUnread}`}>
                  {!n.is_read && <span aria-hidden className="erp-dot erp-dot-brand" />}
                  {NOTIF_WHERE[n.kind] ? (
                    <button
                      type="button"
                      className={css.notifLink}
                      onClick={() => {
                        const where = NOTIF_WHERE[n.kind]!;
                        setTab(where.tab as TabName);
                        setShowNotifs(false);
                        if (unread)
                          void api("/staff/notifications/read", { method: "POST", body: JSON.stringify({}) });
                        if (where.anchor) revealAnchor(where.anchor);
                      }}
                    >
                      {n.message}
                    </button>
                  ) : (
                    n.message
                  )}{" "}
                  <span className="erp-meta">
                    · {dmy(n.created_at)}
                    {!n.is_read && <> · {L("new", "baharu")}</>}
                  </span>
                </p>
              ))}
            </div>
          </div>
        )}

        {/* v1.8.0: the desktop tab-pill grid is replaced by the icon sidebar
          (SidebarNav). Phones keep the bottom navigation below. */}

        {/* App-style bottom navigation (v1.168.0) — phones only. The fixed
          primary tabs stay predictable; the remaining permitted tabs use More. */}
        <nav
          className={mobileBottomNav}
          aria-label={L(
            "Portal sections (mobile)",
            "Bahagian portal (mudah alih)"
          )}
        >
          {/* v1.10.0 (reference design): each tab shows its sidebar icon; the
            active one sits in a filled navy rounded square — same visual
            language as the desktop sidebar's gold square. */}
          {mobileStops.map((stop) => {
            const t = stop.tab;
            /* v1.175.0 — two stops may share a tab (Home and Desk are both the
               Dashboard), so the active stop is keyed on the stop, not the
               tab. Nothing here reads a count: the bar never reorders. */
            const onTab = tab === t && !moreOpen;
            const active = onTab && (stop.anchor ? deskStop : !(deskStop && stop.key === "Dashboard"));
            return (
              <button
                key={stop.key}
                type="button"
                onClick={() => {
                  setTab(t);
                  setMoreOpen(false);
                  setDeskStop(Boolean(stop.anchor));
                  if (stop.anchor) revealAnchor(stop.anchor);
                  else window.scrollTo({ top: 0 });
                }}
                aria-current={active ? "page" : undefined}
                className="erp-bottom-nav-item"
              >
                {/* v1.172.1 (Interface System V3): the item, its icon well
                    and its label are named classes in styles/erp-v3.css;
                    the active stop is marked twice - a tinted well and a
                    gold hairline - so it reads without colour. */}
                <span aria-hidden className="erp-bottom-nav-icon">
                  <TabIcon name={stop.label ?? t} />
                </span>
                {/* the label ellipsises: BM labels ("Papan Pemuka") must not
                  wrap and unbalance the row on narrow phones */}
                <span className="erp-bottom-nav-label">
                  {stop.label ? tr(stop.label, lang) : tr(t, lang)}
                </span>
              </button>
            );
          })}
          {/* v1.10.0 review fix: More renders UNCONDITIONALLY — the mobile
            Preferences (sound/push/language/theme) live in its sheet, and a
            role trimmed to ≤4 tabs would otherwise lose them entirely. */}
          {(() => {
            const active = moreOpen || mobileMore.includes(activeTab);
            return (
              <button
                type="button"
                onClick={() => setMoreOpen((v) => !v)}
                aria-expanded={moreOpen}
                aria-controls="portal-more-menu"
                data-active={active || undefined}
                className="erp-bottom-nav-item"
              >
                <span aria-hidden className="erp-bottom-nav-icon">
                  <Ellipsis
                    aria-hidden
                    className="erp-icon-md"
                    strokeWidth={1.75}
                  />
                </span>
                <span className="erp-bottom-nav-label">
                  {tr("More", lang)}
                </span>
              </button>
            );
          })()}
        </nav>

        {moreOpen && (
          <div className={css.moreBackdrop}>
            <button
              type="button"
              aria-label={L("Close menu", "Tutup menu")}
              className={css.moreScrim}
              onClick={() => setMoreOpen(false)}
            />
            {/* v1.10.0 review fix: bottom padding clears the taller nav PLUS the
              phone's home-indicator inset — the old pb-16 left the Preferences
              row half-covered and untappable on notched iPhones. */}
            <div id="portal-more-menu" role="dialog" aria-modal="true" aria-label={tr("More", lang)} className={sheetCard}>
              <div className={css.moreHead}>
                <span className={css.moreSpacer} />
                <span aria-hidden className={css.moreGrip} />
                <button
                  type="button"
                  aria-label={L("Close", "Tutup")}
                  className={`erp-icon-button ${css.moreClose}`}
                  onClick={() => setMoreOpen(false)}
                >
                  <CloseX aria-hidden className="erp-icon" strokeWidth={1.75} />
                </button>
              </div>
              {/* v1.175.0 — PINNED. Up to six modules the person keeps on the
                  phone bar, in the order they pinned them. It is the same
                  sheet and the same tile as every other module here: pinning
                  is a preference, not a second menu. A pinned module leaves
                  the grouped lists below (it is already on the bar), so this
                  section is also where it is unpinned. */}
              {favourites.length > 0 && (
                <section className={css.moreSection}>
                  <p className={css.moreLabel}>
                    {L("Pinned", "Disematkan")} — {favourites.length}/{FAVOURITES_MAX}
                  </p>
                  <div className={css.moreGrid}>
                    {favourites.map((t) => moreTile(t as TabName))}
                  </div>
                </section>
              )}
              {mobileGroups.map((section) => (
                <section key={section.title} className={css.moreSection}>
                  <p className={css.moreLabel}>
                    {sectionTitle(section.title, lang)}
                  </p>
                  <div className={css.moreGrid}>
                  {section.tabs.map((t) => moreTile(t))}
                  </div>
                </section>
              ))}
              {/* v1.10.0: the set-once switches displaced from the app bar —
                sound, push alerts, language, colour theme. Same handlers as
                the desktop header buttons. */}
              <p className={`${css.moreLabel} ${css.moreLabelPrefs}`}>
                {tr("Preferences", lang)}
              </p>
              <div
                className={`${css.moreGrid} ${pushState !== "unsupported" ? css.moreGrid4 : ""}`}
              >
                <button
                  type="button"
                  className={css.morePref}
                  onClick={() => {
                    const next = !sound;
                    setSound(next);
                    localStorage.setItem(
                      "azone-notif-sound",
                      next ? "on" : "off"
                    );
                    if (next) void chime();
                  }}
                >
                  <span aria-hidden className="erp-center">
                    {sound ? (
                      <Volume2
                        className="erp-icon-md"
                        strokeWidth={1.75}
                      />
                    ) : (
                      <VolumeX
                        className="erp-icon-md"
                        strokeWidth={1.75}
                      />
                    )}
                  </span>
                  {sound
                    ? lang === "ms"
                      ? "Bunyi"
                      : "Sound on"
                    : lang === "ms"
                      ? "Senyap"
                      : "Muted"}
                </button>
                {pushState !== "unsupported" && (
                  <button
                    type="button"
                    className={css.morePref}
                    onClick={async () => {
                      if (pushState === "granted") {
                        await disablePush();
                        setPushState("default");
                      } else {
                        const r = await enablePush();
                        if (r === "ok") {
                          setPushState("granted");
                        } else if (r === "unconfigured")
                          window.alert(
                            L(
                              "Push isn't set up on the server yet — run PUSH.bat on the office PC once; it asks for the push keys and sets them.",
                              "Push belum disediakan di pelayan — jalankan PUSH.bat di PC pejabat sekali; ia meminta kunci push dan menetapkannya."
                            )
                          );
                        else if (r === "denied")
                          window.alert(
                            L(
                              "Notifications are blocked for this site in your browser settings.",
                              "Pemberitahuan disekat untuk laman ini dalam tetapan pelayar anda."
                            )
                          );
                      }
                    }}
                  >
                    <span aria-hidden className="erp-center">
                      {pushState === "granted" ? (
                        <BellRing
                          className="erp-icon-md"
                          strokeWidth={1.75}
                        />
                      ) : (
                        <BellOff
                          className="erp-icon-md"
                          strokeWidth={1.75}
                        />
                      )}
                    </span>
                    {pushState === "granted"
                      ? lang === "ms"
                        ? "Push aktif"
                        : "Push on"
                      : lang === "ms"
                        ? "Push tutup"
                        : "Push off"}
                  </button>
                )}
                <button
                  type="button"
                  className={css.morePref}
                  onClick={() => {
                    const next = lang === "ms" ? "en" : "ms";
                    setLangState(next);
                    persistLang(next);
                  }}
                >
                  <span aria-hidden className={css.moreLang}>
                    {lang === "ms" ? "BM" : "EN"}
                  </span>
                  {lang === "ms" ? "Bahasa" : "English"}
                </button>
                <button
                  type="button"
                  className={css.morePref}
                  onClick={() => setTheme(theme === "plum" ? "navy" : "plum")}
                >
                  <span aria-hidden className="erp-center">
                    <Palette className="erp-icon-md" strokeWidth={1.75} />
                  </span>
                  {theme === "plum"
                    ? lang === "ms"
                      ? "Ungu"
                      : "Plum"
                    : lang === "ms"
                      ? "Biru"
                      : "Navy"}
                </button>
              </div>
              {/* v1.170.0 - these two carry LABELS, so they are pills, not
                  the 44px icon circles btnHdr became in v1.169.0: on the
                  CEO's phone the words "Toggle dark mode" and "Sign out"
                  spilled out of two little rings. Dark mode is a setting
                  and sits with the other settings' geometry; signing out is
                  the one consequential action on this sheet and wears the
                  contract's destructive outline so it is never pressed by
                  reflex. */}
              <div className={css.moreFoot}>
                <button type="button" className={btnGhost} aria-pressed={dark} onClick={() => setDark((v) => !v)}>
                  {dark ? <Sun aria-hidden className="erp-icon" /> : <Moon aria-hidden className="erp-icon" />}
                  {dark ? L("Light mode", "Mod cerah") : L("Dark mode", "Mod gelap")}
                </button>
                <button type="button" className="erp-button erp-button-danger" onClick={() =>
                  void api("/auth/logout", { method: "POST", body: JSON.stringify({}) }).then(() => {
                    clearApiCache(); setUser(null); setMoreOpen(false);
                  })}>
                  <LogOut aria-hidden className="erp-icon" />{tr("Sign out", lang)}
                </button>
              </div>
              {/* v1.23.4: the visible build stamp — "is the live site on the
                new version?" is now answerable from any phone. */}
              <p className={css.buildStamp}>
                {L(
                  `A2Z CREATIVE MARKETING staff portal · v${APP_VERSION}`,
                  `Portal kakitangan A2Z CREATIVE MARKETING · v${APP_VERSION}`
                )}
              </p>
            </div>
          </div>
        )}


        <main key={tab} className={`screen-enter ${css.main}`}>
          {children}
        </main>
      </div>
    </AppShell>
  );
}

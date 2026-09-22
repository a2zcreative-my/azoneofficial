"use client";

/**
 * A2Z CREATIVE MARKETING — Staff Portal v1 (/portal)
 * Internal only. Shares auth with /admin (session cookie -> API Worker).
 * Modules: Dashboard, Attendance, Leave, Tasks, Announcements, Sales, Profile,
 * plus role modules (v1.4.4): HR, Inventory, Commercial, Operations, Overview.
 * Desktop-first, responsive; light/dark mode.
 *
 * v1.114.0 (housekeeping) — THIS FILE IS THE SHELL. It was 605 KB / 14,117
 * lines with every module inside it; the modules now live in
 * components/portal/ (dashboard, trading-desk, events, attendance, leave,
 * tiktok-cards, tasks, announcements, sales, live-cards, profile,
 * users-panel, commission; shared types and helpers in page-shared), moved
 * verbatim — nothing was rewritten. What stays here is PortalPage: auth,
 * tabs, header, bell, bottom bar, and the switch that draws each tab.
 * tests/portal-split.mjs keeps it this way; tests/lib/portal-source.mjs
 * lets the other guards read the page as the one text it used to be.
 */

import Link from "next/link";

import { api, sendOutboxEntry } from "@/lib/api"; // v1.5.0: one shared helper (was a per-file copy)
import { setOutboxScope, startOutbox } from "@/lib/outbox"; // v1.105.0 - kept-on-the-phone writes
import { InstallCoach } from "@/components/ui/install-coach"; // v1.105.0 - iOS Home Screen coaching
import { enablePush, disablePush, pushPermission } from "@/lib/push-client";
// v1.65.0 — live cards: the version store, and the hook that watches it.
import { applyVersions, pokeVersions, resetVersions } from "@/lib/live";
import { Fragment, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  ALL_TABS,
  canSeeTab,
  mobileNavStops,
  mobilePrimaryTabs,
  type PersonAccess,
  type TabName,
} from "@/lib/portal-tabs"; // v1.79.0 — ONE tab registry (page + 🔐 card)
import { FAVOURITES_MAX, favouritesFull, favouritesServerSnapshot, favouritesSnapshot, readFavourites, subscribeFavourites, toggleFavourite } from "@/lib/favourites";
import { revealAnchor } from "@/components/portal/page-shared";
import { AppIcon } from "@/components/ui/app-icon";
/* v1.28.0 — legal document identity: a STAMPED document (leave form, invoice
   chase) renders the issuer stored on its row via resolveIssuer(issuer_code);
   a document issued fresh TODAY (the SOA) carries DOCUMENT_ISSUER. */
/* v1.4.212 (approved architecture review): three NEW isolated cards. */
import { ConnectionStatusCard } from "@/components/portal/connection-status-card";
import { FulfilmentCard } from "@/components/portal/fulfilment-card";
import { AppShell } from "@/components/layout/app-shell";
import { PortalSkeleton } from "@/components/portal/portal-skeleton";
import { setCacheScope, clearApiCache } from "@/lib/cached-api";

import { NAV_COLLAPSED_KEY, SECTIONS, SideNav, sectionTitle } from "@/components/layout/side-nav";
import { TabIcon, LogOut, Search, Bell, BellRing, BellOff, Moon, Sun, Volume2, VolumeX, Palette, CloseX, Ellipsis } from "@/components/layout/nav-icons";
import { ContextPanel, RightRail } from "@/components/portal/side-columns";
import {
  TaskProgressCard,
  InventoryStatusCard,
} from "@/components/portal/company-monitor";
import { OpsMapCard } from "@/components/portal/ops-map";
import {
  getLang,
  setLang as persistLang,
  t as tr,
  type Lang,
} from "@/lib/i18n";
import { APP_VERSION } from "@/lib/version";
import { CommandPalette } from "@/components/layout/command-palette";
import { TwoFactorPanel } from "@/components/security/two-factor-panel";
import { PermissionPlaceholder } from "@/components/ui/permission-placeholder";
/* v1.103.0 (roadmap phase 01) - every tab panel that is NOT on the first
   screen now arrives through next/dynamic, one chunk per module, fetched the
   first time its tab is opened. Same components, same names, same props; only
   these import lines moved. components/portal/lazy-panels.tsx explains why,
   and tests/lazy-panels.mjs fails the build if one of them is ever imported
   statically here again. What stays static above is what the Dashboard paints
   on first load. */
import {
  AccessReviewCard, CompaniesPanel, HrAdminPanel, AssetsPanel, CardsPanel, CommissionPanel, ContentPanel,
  DocumentsPanel, ElfiaStorePanel, ElfiaTrafficPanel, CashFlowPanel,
  GeofenceCard, HotelsPanel, EnquiriesPanel, SalesPerformancePanel, HankeisPanel, SalesMap, PayrollPanel, MyPayslip, AccountingPanel,
  AttendanceAdminPanel, HrPanel, InventoryPanel, ClaimsPanel, ExpensesPanel, TikTokOrdersCard,
  RosterBoard, StokisPanel, TabAccessCard, ThreadsPanel, VerificationCard, WebOrdersPanel,
  StaffDirectory,
} from "@/components/portal/lazy-panels";
import { PORTAL_WIDTH, btnClass, btnGhost, btnHdr, btnHdrDesktop, card, mobileAppBottomClearance, mobileBottomNav, sheetCard } from "@/lib/ui-styles";
import css from "./portal.module.css";
import { TabPage, TabZone } from "@/components/portal/tab-concept";
import { dmy } from "@/lib/format";
import { Announcements } from "@/components/portal/announcements";
import { Attendance } from "@/components/portal/attendance";
import { LeaderboardCard, MoneyCard } from "@/components/portal/commission";
import { Dashboard, REVENUE_ROLES } from "@/components/portal/dashboard";
import { Leave } from "@/components/portal/leave";
import { OtApprovalsCard } from "@/components/portal/live-cards";
import { L, MANAGE_ROLES, Notification, User, ZoneLabel } from "@/components/portal/page-shared";
import { Profile } from "@/components/portal/profile";
import { ClientsCard, LiveEconomicsCard, PackagesEditorCard, PnlCard, Sales } from "@/components/portal/sales";
import { Tasks } from "@/components/portal/tasks";
import { TikTokAnalyticsCard } from "@/components/portal/tiktok-cards";
import { RevenueAndHoursCard } from "@/components/portal/trading-desk";
import { CompanyAttendanceToday } from "@/components/portal/dashboard-cards";
import { UsersPanel } from "@/components/portal/users-panel";
import { syncThemeColor } from "@/lib/theme-color";

/* v1.79.0 — ALL_TABS, TAB_ROLES and SALES_ROLES moved to lib/portal-tabs.ts.
   They were duplicated in components/portal/tab-access-card.tsx, and the copy
   had drifted: the 🔐 card listed the tabs in a different order and had the
   Users default down as CEO + COO when this file has allowed `admin` since
   v1.40.0. Both now read the one module. Tab ORDER is still the CEO's own
   v1.22.0 sequence. The phone bottom bar uses MOBILE_PRIMARY_TABS and the
   remaining permitted tabs are grouped in More. */

// No staff role's home is /admin any more (only super_admin/admin live there,
// and they deep-link into portal modules via the admin Staff bridge). Kept as
// an empty guard so the redirect logic below stays explicit.
const CONTENT_ONLY_ROLES: string[] = [];


export default function PortalPage() {
  const [user, setUser] = useState<User | null>(null);
  const [checked, setChecked] = useState(false);
  const [navCollapsed, setNavCollapsed] = useState(true);
  useEffect(() => {
    /* v1.172.0 - the rail remembers. A saved choice wins on any width that
       draws the rail; with nothing saved, the rail opens on wide desktops
       and folds to icons below 1280px, as before. */
    const desktop = window.matchMedia("(min-width: 1280px)");
    const fit = () => {
      let saved: string | null = null;
      try { saved = localStorage.getItem(NAV_COLLAPSED_KEY); } catch { /* storage denied: fall back to width */ }
      setNavCollapsed(saved === null ? !desktop.matches : saved === "1");
    };
    fit();
    desktop.addEventListener("change", fit);
    return () => desktop.removeEventListener("change", fit);
  }, []);
  const toggleNavCollapsed = () => setNavCollapsed((v) => {
    try { localStorage.setItem(NAV_COLLAPSED_KEY, v ? "0" : "1"); } catch { /* preference is a convenience, not state */ }
    return !v;
  });
  /* v1.4.231 (CEO: "when I refresh the tabs back to Dashboard instead of
     last tab that I open"): the active tab was plain useState — a refresh
     rebuilds the page and lands on the default. Now the last tab persists
     per device (localStorage azone-tab), restored on load and validated:
     if the saved tab isn't visible to this account (role change, 🔐 tab
     access change), the guard effect below falls back to Dashboard. */
  const [tab, setTab] = useState<TabName>("Dashboard");
  /* v1.175.0 — which Dashboard stop the phone bar last used, so Home and Desk
     (both the Dashboard) can each show as current when they are. */
  const [deskStop, setDeskStop] = useState(false);
  /* v1.175.0 — the pinned modules, read through the store so pinning one in
     the More sheet re-renders the bar and the palette at once (and a second
     open tab of the portal agrees, via the `storage` event). */
  const pinnedRaw = useSyncExternalStore(
    subscribeFavourites,
    () => favouritesSnapshot(user?.id),
    favouritesServerSnapshot,
  );
  const [entryReady, setEntryReady] = useState(false);
  const [salesStart, setSalesStart] = useState<"documents" | "create">("documents");
  const [salesCreateRequest, setSalesCreateRequest] = useState(0);
  useEffect(() => { if (tab !== "Sales") setSalesStart("documents"); }, [tab]);
  /* v1.4.232 (CEO: "does it will accidentally appear the full tabs roles by
     accidents?"): his question exposed a shared-device edge in v1.4.231 —
     the remembered tab was stored per DEVICE, so a lower-role account
     signing in after the CEO could restore a restricted tab for one render
     frame (the server 403s all data, but even a panel skeleton must not
     flash). Two fixes: the key is per USER (azone-tab:{id} — accounts never
     inherit each other's tab), and the render below clamps through
     activeTab so an out-of-scope tab can never mount, not even one frame. */
  /* v1.24.0 (CEO refined v1.23.6: "if they refresh it will remain to the
     last page that they visit… go back to dashboard if the staff close
     their web/mobile browser"): tab memory lives in SESSION STORAGE now —
     the browser feature with exactly those semantics. A refresh keeps the
     tab; closing the tab/browser clears it, so the next open starts at the
     Dashboard. Per-user key + the activeTab clamp keep the v1.4.232
     shared-device guarantee (no restricted tab can mount for a lower role),
     and a crashed tab can only haunt one browser session, never every
     visit (v1.22.7). Old localStorage keys from the retired scheme are
     cleaned up. */
  useEffect(() => {
    let live = true;
    const settle = () => { if (live) setEntryReady(true); };
    try {
      if (!user) return;
      window.localStorage.removeItem(`azone-tab:${user.id}`); // retired v1.4.231 scheme
      /* v1.105.0 - a push notification now deep-links to its tab
         (/portal?tab=Leave). The link wins over the remembered tab, once,
         and is then removed from the address so a reload does not keep
         dragging the person back to it. The visibility clamp below still
         applies: a tab this account cannot see snaps to the Dashboard. */
      const wanted = new URL(window.location.href).searchParams.get("tab");
      if (wanted && (ALL_TABS as readonly string[]).includes(wanted)) {
        setTab(wanted as TabName);
        const clean = new URL(window.location.href);
        clean.searchParams.delete("tab");
        window.history.replaceState(null, "", clean.pathname + clean.search + clean.hash);
        settle();
        return;
      }
      const saved = window.sessionStorage.getItem(`azone-tab:${user.id}`);
      if (saved && (ALL_TABS as readonly string[]).includes(saved)) {
        setTab(saved as TabName);
        settle();
        return;
      }
    } catch {
      /* private mode */
    }
    if (!user) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 8000);
    void api<{ today_shift?: { entry?: { launch_shift: boolean } } }>("/staff/attendance", { signal: controller.signal })
      .then(r => {
        if (live && r.ok && r.data?.today_shift?.entry?.launch_shift) setTab(current => current === "Dashboard" ? "On Shift" : current);
      }).catch(() => {}).finally(() => { window.clearTimeout(timeout); settle(); });
    return () => { live = false; controller.abort(); window.clearTimeout(timeout); };
  }, [user]);
  useEffect(() => {
    try {
      if (user && entryReady) window.sessionStorage.setItem(`azone-tab:${user.id}`, tab);
    } catch {
      /* private mode */
    }
  }, [tab, user?.id, entryReady]);
  const [dark, setDark] = useState(false);
  // v1.9.0: Plum & Rose theme preset + EN/BM chrome language (per device)
  const [theme, setTheme] = useState<"navy" | "plum">("navy");
  const [lang, setLangState] = useState<Lang>("en");
  useEffect(() => {
    setTheme(
      localStorage.getItem("azone-theme-preset") === "plum" ? "plum" : "navy"
    );
    setLangState(getLang());
  }, []);
  useEffect(() => {
    if (theme === "plum")
      document.documentElement.setAttribute("data-theme", "plum");
    else document.documentElement.removeAttribute("data-theme");
    localStorage.setItem("azone-theme-preset", theme);
  }, [theme]);
  const [notifs, setNotifs] = useState<Notification[]>([]);
  /* v1.4.219: CEO-managed tab access overrides (system_meta). */
  const [tabOverrides, setTabOverrides] = useState<Record<string, string[]>>(
    {}
  );
  /* v1.90.0 — this person's own grants and refusals, above the role. */
  const [myTabAccess, setMyTabAccess] = useState<PersonAccess | null>(null);
  useEffect(() => {
    void fetch("/api/v1/staff/tabs/access", { credentials: "include" })
      .then(async (r) => (r.ok ? await r.json() : null))
      .then((d) => {
        if (d && typeof d === "object" && "overrides" in d) {
          setTabOverrides(
            (d as { overrides: Record<string, string[]> }).overrides ?? {}
          );
          const mine = (d as { mine?: PersonAccess | null }).mine;
          setMyTabAccess(mine && typeof mine === "object" ? mine : null);
        }
      })
      .catch(() => {
        /* old worker: defaults apply */
      });
  }, []);
  const [showNotifs, setShowNotifs] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  useEffect(() => {
    if (!moreOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setMoreOpen(false); };
    window.addEventListener("keydown", close);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", close);
    };
  }, [moreOpen]);
  // v1.8.0: global search (Ctrl/Cmd+K)
  const [paletteOpen, setPaletteOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        (e.ctrlKey || (e as unknown as { metaKey?: boolean }).metaKey) &&
        e.key.toLowerCase() === "k"
      ) {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey as unknown as EventListener);
    return () =>
      window.removeEventListener("keydown", onKey as unknown as EventListener);
  }, []);

  // While the More sheet is open, the page behind must not scroll — the
  // sheet then behaves like a native menu instead of a floating layer.
  useEffect(() => {
    document.body.style.overflow = moreOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [moreOpen]);

  useEffect(() => {
    if (!moreOpen) return;
    const menu = document.getElementById("portal-more-menu");
    const trigger = document.querySelector<HTMLButtonElement>('button[aria-controls="portal-more-menu"]');
    const buttons = () => Array.from(menu?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
    buttons()[0]?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); setMoreOpen(false); }
      if (event.key !== "Tab") return;
      const controls = buttons();
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    const desktop = window.matchMedia("(min-width: 768px)");
    const resize = () => { if (desktop.matches) setMoreOpen(false); };
    document.addEventListener("keydown", onKey);
    desktop.addEventListener("change", resize);
    return () => {
      document.removeEventListener("keydown", onKey);
      desktop.removeEventListener("change", resize);
      trigger?.focus({ preventScroll: true });
    };
  }, [moreOpen]);

  useEffect(() => {
    setDark(localStorage.getItem("azone-theme") === "dark");
    void api<{ user: User }>("/auth/me").then((r) => {
      if (r.ok && r.data) {
        setUser(r.data.user);
        // v1.25.0: remembered data is per-account — switching users wipes it.
        setCacheScope(r.data.user.id);
        /* v1.105.0 - the outbox is per-account too, and it drains only once
           we know who is signed in: a queued clock-in sent under the wrong
           session would be refused, and rightly. */
        setOutboxScope(r.data.user.id);
      } else { setCacheScope(null); setOutboxScope(null); }
      setChecked(true);
    });
  }, []);
  /* v1.105.0 (roadmap phase 03) - start draining whatever waited on this
     phone: on `online`, when the app comes to the front, every 45 s while
     something is queued, and once now. Stopped when the page unmounts. */
  useEffect(() => {
    if (!user) return;
    return startOutbox(sendOutboxEntry);
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("azone-theme", dark ? "dark" : "light");
    /* v1.124.0 — repaint the browser's own chrome too. The class toggle above
       is synchronous, so the computed --browser-theme-color read inside is
       already the new theme's. */
    syncThemeColor();
  }, [dark]);

  // v1.4.144: notification chime — a soft two-tone ding synthesized with the
  // Web Audio API (no file to download), played when NEW unread notifications
  // arrive. Browsers only allow audio after a user gesture, so the first
  // click/tap anywhere unlocks the audio context; polls before that stay
  // silent (the badge still updates). Toggleable via the 🔔/🔕 button.
  const [sound, setSound] = useState(true);
  // v1.6.0: web-push permission state for this device.
  const [pushState, setPushState] = useState<
    "default" | "granted" | "denied" | "unsupported"
  >("default");
  useEffect(() => {
    setSound(localStorage.getItem("azone-notif-sound") !== "off");
    setPushState(pushPermission());
  }, []);
  const audioRef = useRef<AudioContext | null>(null);
  const unreadRef = useRef<number | null>(null); // null = first load (no chime)
  // v1.6.0: the SSE stream reads the latest list without re-subscribing.
  const notifsRef = useRef<Notification[]>([]);
  useEffect(() => {
    notifsRef.current = notifs;
  }, [notifs]);
  useEffect(() => {
    // Unlock on the first gesture so POLL-triggered chimes are allowed later.
    const unlock = () => {
      if (!audioRef.current) {
        try {
          const AC =
            window.AudioContext ??
            (window as unknown as { webkitAudioContext?: typeof AudioContext })
              .webkitAudioContext;
          if (AC) audioRef.current = new AC();
        } catch {
          /* very old browser — chime simply stays off */
        }
      }
      void audioRef.current?.resume();
    };
    window.addEventListener("pointerdown", unlock, { once: true });
    return () => window.removeEventListener("pointerdown", unlock);
  }, []);
  const chime = useCallback(async () => {
    // v1.4.151 FIX: the first 🔊 press raced the unlock — resume() is async,
    // so ctx.state was still "suspended" when the click handler chimed, and
    // the guard swallowed the sound. Now the chime itself creates the context
    // if needed and AWAITS resume before checking. Called from a gesture
    // (the toggle) this always resumes; called from a background poll it
    // resumes only if a gesture already unlocked audio — same policy, no race.
    let ctx = audioRef.current;
    if (!ctx) {
      try {
        const AC =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext;
        if (AC) {
          ctx = new AC();
          audioRef.current = ctx;
        }
      } catch {
        return;
      }
    }
    if (!ctx) return;
    if (ctx.state !== "running") {
      try {
        await ctx.resume();
      } catch {
        return;
      }
    }
    if (ctx.state !== "running") return;
    const note = (freq: number, at: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, ctx.currentTime + at);
      gain.gain.linearRampToValueAtTime(0.18, ctx.currentTime + at + 0.015);
      gain.gain.exponentialRampToValueAtTime(
        0.0001,
        ctx.currentTime + at + 0.45
      );
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + at);
      osc.stop(ctx.currentTime + at + 0.5);
    };
    note(880, 0); // A5
    note(1174.66, 0.12); // D6 — rising two-tone, short and unobtrusive
  }, []);

  useEffect(() => {
    if (!user) return;
    // v1.6.0: chime + badge logic factored out so both the initial fetch, the
    // safety-net poll, and the live SSE stream feed it.
    const applyList = (list: Notification[]) => {
      const nowUnread = list.filter((n) => !n.is_read).length;
      if (
        unreadRef.current !== null &&
        nowUnread > unreadRef.current &&
        localStorage.getItem("azone-notif-sound") !== "off"
      ) {
        void chime();
      }
      unreadRef.current = nowUnread;
      setNotifs(list);
    };
    const fetchNotifs = () =>
      void api<{ notifications: Notification[] }>("/staff/notifications").then(
        (r) => {
          if (r.data?.notifications) applyList(r.data.notifications);
        }
      );
    fetchNotifs();

    /* v1.6.0 REAL-TIME: an SSE stream delivers new notifications within
       ~5 seconds instead of up to 60. The Worker stream self-closes after
       ~20s and EventSource reconnects automatically. A slow 120s poll stays
       as a safety net (and covers browsers where SSE is blocked). The chime
       still fires on the same increase rule; server-side web-push covers the
       tab-closed case. */
    let es: EventSource | null = null;
    let sinceId = 0;
    const openStream = () => {
      try {
        sinceId = Math.max(sinceId, ...notifsRef.current.map((n) => n.id), 0);
        es = new EventSource(
          `/api/v1/staff/notifications/stream?since=${sinceId}`,
          { withCredentials: true }
        );
        es.addEventListener("notifications", (ev) => {
          try {
            const incoming = JSON.parse(
              (ev as MessageEvent).data
            ) as Notification[];
            if (!incoming.length) return;
            const merged = [...incoming.reverse(), ...notifsRef.current]
              .filter((n, i, a) => a.findIndex((x) => x.id === n.id) === i)
              .sort((a, b) => b.id - a.id)
              .slice(0, 50);
            sinceId = Math.max(sinceId, ...incoming.map((n) => n.id));
            applyList(merged);
          } catch {
            /* ignore malformed frame */
          }
        });
        /* v1.65.0 — the same stream now carries data-version frames. The
           store decides what changed; the cards decide what to do about it.
           This listener knows about neither. */
        es.addEventListener("versions", (ev) => {
          try {
            applyVersions(
              JSON.parse((ev as MessageEvent).data) as Record<string, number>
            );
          } catch {
            /* ignore malformed frame */
          }
        });
        es.onerror = () => {
          es?.close();
          es = null;
        };
      } catch {
        /* EventSource unsupported — the poll below carries it */
      }
    };
    openStream();
    const reconnect = window.setInterval(() => {
      if (!es) openStream();
    }, 8000);
    const timer = window.setInterval(fetchNotifs, 120_000);

    /* v1.65.0 — coming back to the foreground. The stream dies when a phone
       sleeps, and frames that arrived while the tab was hidden were
       deliberately not acted on, so returning does two things: ask for the
       version map once over plain HTTP (cheap, and works even if SSE is
       blocked by a proxy), then poke the store so every card that was owed a
       reload takes it. This is also the safety net for the whole design — if
       every stream in the building failed, the portal would still be correct
       the moment somebody looked at it. */
    const catchUp = () => {
      if (document.visibilityState === "hidden") return;
      fetchNotifs();
      void api<{ versions: Record<string, number> }>("/staff/versions").then((r) => {
        if (r.data?.versions) applyVersions(r.data.versions);
        pokeVersions();
      });
    };
    window.addEventListener("focus", catchUp);
    document.addEventListener("visibilitychange", catchUp);
    return () => {
      es?.close();
      window.clearInterval(reconnect);
      window.clearInterval(timer);
      window.removeEventListener("focus", catchUp);
      document.removeEventListener("visibilitychange", catchUp);
      /* A different person may sign in next. Their first frame must be a
         baseline, not a reason for every card to reload. */
      resetVersions();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, chime]);

  const unread = notifs.filter((n) => !n.is_read).length;
  /* v1.4.219 (CEO tab access control): server-side overrides from the 🔐
     card on the Users tab. Absent tab = the built-in default below.
     Rails: Dashboard + On Shift + Profile always visible; super_admin ignores
     overrides entirely (the escape hatch); fetch failure (old worker) =
     defaults, so a split deploy can never blank the tab strip. */
  const tabs = ALL_TABS.filter((t) => canSeeTab(user?.role, t, tabOverrides, myTabAccess));
  // v1.4.231 guard: a remembered tab this account can't see → Dashboard.
  useEffect(() => {
    if (!tabs.includes(tab)) setTab("Dashboard");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabs.join("|"), tab]);
  /* v1.159.9 (CEO, 14-09-2026: "check the sales all link to all the tabs").
     A panel that offers a button INTO another tab must know whether this
     account can see that tab - otherwise the press lands on the clamp above
     and the person is bounced to the Dashboard with no word why. This is the
     one question, answered from the same filter the strip is drawn from, so
     a link can never be offered to a tab the strip does not show (a live
     host has Sales Performance but not Sales; the CEO may also untick any
     tab for any role in the access card). */
  const canOpen = (t: string) => (tabs as readonly string[]).includes(t);
  /* v1.159.9 - the roster's Sales-duty note opens the register on THAT
     person and THAT day. Held here, not in the address, so nothing is left
     for a reload to replay; cleared the moment the tab is left. */
  const [spPreset, setSpPreset] = useState<{ staff: number; day: string } | null>(null);
  useEffect(() => {
    if (tab !== "Sales Performance") setSpPreset(null);
  }, [tab]);

  /* v1.21.1: the shell scrolls INTERNALLY now (#shell-scroll in AppShell),
     so a tab switch must rewind that container — without this, opening a
     tab landed wherever the previous tab was scrolled to. (Lives BEFORE the
     early returns below — hooks must run on every render.) */
  useEffect(() => {
    document.getElementById("shell-scroll")?.scrollTo({ top: 0 });
  }, [tab]);

  /* v1.23.8 — overflow self-report (CEO's phone shows a clipped roster no
     sandbox engine reproduces): 2s after each tab renders on a PHONE, the
     page measures itself; anything poking past the screen edge is reported
     to the error_log (source: ui_overflow) with the exact element — once
     per tab per session per build. The shell's own clip guard is skipped
     when checking containment, so it can't hide the culprit. Diagnostics
     must never break the page: everything is try-wrapped. */
  useEffect(() => {
    if (typeof window === "undefined" || window.innerWidth >= 768) return;
    const t = window.setTimeout(() => {
      try {
        const vw = document.documentElement.clientWidth;
        const dw = Math.max(
          document.documentElement.scrollWidth,
          document.body.scrollWidth
        );
        const bad: string[] = [];
        document.querySelectorAll("body *").forEach((el) => {
          if (bad.length >= 5) return;
          const h = el as HTMLElement;
          const r = h.getBoundingClientRect();
          if (r.width <= 0 || r.right <= vw + 1) return;
          const cs = getComputedStyle(h);
          if (cs.display === "none" || cs.position === "fixed") return;
          let a = h.parentElement;
          let contained = false;
          /* body/html/#shell-scroll do NOT count as containers: body's own
             overflow-x rule is exactly what iOS Safari ignores (the reason
             phones pan while every desktop engine looks clean), and the
             shell clip is our guard, not the culprit's alibi. */
          while (a && a !== document.body && a !== document.documentElement) {
            if (
              a.id !== "shell-scroll" &&
              /(auto|scroll|hidden|clip)/.test(getComputedStyle(a).overflowX)
            ) {
              contained = true;
              break;
            }
            a = a.parentElement;
          }
          if (!contained)
            bad.push(
              `${h.tagName}.${String(h.className).slice(0, 90)}|R${Math.round(r.right)}`
            );
        });
        if (bad.length > 0 || dw > vw + 1) {
          const key = `azone-ovf:${APP_VERSION}:${tab}`;
          if (!window.sessionStorage.getItem(key)) {
            window.sessionStorage.setItem(key, "1");
            void api(`/staff/debug/overflow`, {
              method: "POST",
              body: JSON.stringify({ tab, v: APP_VERSION, vw, dw, els: bad }),
            });
          }
        }
      } catch {
        /* never break the page for a diagnostic */
      }
    }, 2000);
    return () => window.clearTimeout(t);
  }, [tab]);

  /* v1.88.1 — THE SAME SELF-REPORT, FOR HEIGHT, ON DESKTOP. The CEO sent a
     screenshot of the canvas ending two-thirds down the window with a white
     void beneath it and a second scrollbar on the page: something had grown
     the document past the viewport, straight through the shell's clip. The
     shell now forbids that (app-shell.tsx, v1.88.1) — but "forbids" is a
     claim, and this is how the claim is checked on every real screen rather
     than on mine. If the document is still taller than the viewport, the
     elements whose bottom edge pokes past it are named and written to the
     error_log, once per tab per session per build, so the next occurrence
     arrives with its own cause attached. Same rails as the phone version:
     try-wrapped, and never allowed to break the page. */
  useEffect(() => {
    if (typeof window === "undefined" || window.innerWidth < 768) return;
    const t = window.setTimeout(() => {
      try {
        const vh = window.innerHeight;
        const dh = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
        if (dh <= vh + 2) return;
        const bad: string[] = [];
        document.querySelectorAll("body *").forEach((el) => {
          if (bad.length >= 5) return;
          const h = el as HTMLElement;
          const cs = getComputedStyle(h);
          if (cs.display === "none" || cs.position === "fixed") return;
          const r = h.getBoundingClientRect();
          /* Past the viewport bottom AND not inside the shell's own scroller —
             content scrolled below the fold inside #shell-scroll is normal;
             content below the CANVAS is the bug. */
          if (r.height <= 0 || r.bottom <= vh + 1) return;
          if (h.closest("#shell-scroll")) return;
          bad.push(`${h.tagName}.${String(h.className).slice(0, 90)}|B${Math.round(r.bottom)}|${cs.position}`);
        });
        const key = `azone-ovfy:${APP_VERSION}:${tab}`;
        if (!window.sessionStorage.getItem(key)) {
          window.sessionStorage.setItem(key, "1");
          void api(`/staff/debug/overflow`, {
            method: "POST",
            body: JSON.stringify({ tab, v: APP_VERSION, axis: "y", vw: vh, dw: dh, els: bad }),
          });
        }
      } catch {
        /* never break the page for a diagnostic */
      }
    }, 2500);
    return () => window.clearTimeout(t);
  }, [tab]);

  /* v1.25.0 (CEO: "a dead skeleton waiting for my website like a Threads
     so that my staff wont see any loading"): this used to be `return null`
     — and because the site is a static export, THAT NULL WAS THE HTML FILE.
     Staff saw a white screen through the whole JS download and the auth
     round-trip. The skeleton below ships inside portal.html and paints
     immediately, with zero JavaScript. */
  if (!checked || (user && !entryReady && !user.requires_2fa)) return <PortalSkeleton />;
  if (user?.role === "customer") {
    if (typeof window !== "undefined") window.location.replace("/account");
    return null;
  }
  // Content-team roles work in /admin; if one lands here, send them home.
  // (Admins are allowed to use portal modules via the admin Staff bridge, but
  // their front door is /admin — this keeps each role's default flow clean.)
  if (user && CONTENT_ONLY_ROLES.includes(user.role)) {
    if (typeof window !== "undefined") window.location.replace("/admin");
    return null;
  }
  if (!user) {
    return (
      <div className={css.gate}>
        <p className={css.gateEyebrow}>
          {L(
            "A2Z CREATIVE MARKETING / Staff Portal",
            "A2Z CREATIVE MARKETING / Portal Kakitangan"
          )}
        </p>
        <h1 className={css.gateTitle}>
          {L("Sign in required", "Log masuk diperlukan")}
        </h1>
        <p className={css.gateText}>
          {L(
            "The Staff Portal is for A2Z CREATIVE MARKETING employees only.",
            "Portal Kakitangan hanya untuk pekerja A2Z CREATIVE MARKETING."
          )}
        </p>
        {/* v1.72.1: a raw <a> to an in-app route. next lint refuses it
            (@next/next/no-html-link-for-pages) because it throws away the
            router and reloads the whole bundle to reach a page the client
            already has. It only surfaced now because this is the first
            deploy where the WEBSITE half of the pipeline actually ran. */}
        <Link href="/login" className={`${btnClass} ${css.gateAction}`}>
          {L("Go to login", "Pergi ke log masuk")}
        </Link>
      </div>
    );
  }

  if (user.requires_2fa) {
    return (
      <div className={css.stepUp}>
        <div className={card}>
          <h1 className={css.stepUpTitle}>
            {L(
              "Two-Factor Authentication Required",
              "Pengesahan Dua Faktor Diperlukan"
            )}
          </h1>
          <p className={css.stepUpText}>
            {L(
              "Your role requires two-factor authentication to be enabled before you can access the A2Z CREATIVE MARKETING Staff Portal. Please set it up now.",
              "Peranan anda memerlukan pengesahan dua faktor diaktifkan sebelum anda boleh mengakses Portal Kakitangan A2Z CREATIVE MARKETING. Sila sediakannya sekarang."
            )}
          </p>
          <TwoFactorPanel />
          <div className={css.stepUpFoot}>
            <button
              onClick={() => {
                /* v1.5.0 fix: azone_session is HttpOnly — document.cookie
                   could never clear it, so this button looped users back to
                   the same screen forever. A real server-side logout now. */
                void api("/auth/logout", {
                  method: "POST",
                  body: JSON.stringify({}),
                }).then(() => {
                  window.location.href = "/login";
                });
              }}
              className={css.quietLink}
            >
              {L("Sign out", "Log keluar")}
            </button>
          </div>
        </div>
      </div>
    );
  }
  /* v1.4.232: render-time clamp — effects run AFTER a render, so the guard
     alone still allowed one frame; every panel below renders off activeTab,
     which can never name a tab outside this account's visible list. */
  const activeTab: TabName = tabs.includes(tab) ? tab : "Dashboard";

  const navItems = tabs.map((tb) => ({ name: tb, label: tr(tb, lang) }));
  /* v1.175.0 — the person's own pinned modules. Read per account and clamped
     to `tabs`, the same permission-filtered list everything else here uses,
     so a pin can never open a module the access review has since closed. */
  /* pinnedRaw is the store's snapshot — reading it here is what makes the bar
     and the palette re-render the moment a pin moves. */
  const favourites = pinnedRaw ? readFavourites(user?.id, tabs) : [];
  const mobileStops = mobileNavStops(tabs, { role: user?.role, favourites });
  const mobilePrimary = mobilePrimaryTabs(tabs, { role: user?.role, favourites });
  const mobileMore = tabs.filter((t) => !mobilePrimary.includes(t));
  const mobileGroups = SECTIONS.map((section) => ({
    ...section,
    tabs: section.tabs.filter((name): name is TabName => mobileMore.includes(name as TabName)),
  })).filter((section) => section.tabs.length > 0);
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
                setShowNotifs((v) => !v);
                if (unread)
                  void api("/staff/notifications/read", {
                    method: "POST",
                    body: JSON.stringify({}),
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
                <p key={n.id} className={css.notifItem}>
                  {n.kind === "announcement" || n.kind === "enquiry" ? (
                    <button
                      type="button"
                      className={css.notifLink}
                      onClick={() => setTab(n.kind === "enquiry" ? "Enquiries" : "Announcements")}
                    >
                      {n.message}
                    </button>
                  ) : (
                    n.message
                  )}{" "}
                  <span className="erp-meta">
                    · {dmy(n.created_at)}
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
          {activeTab === "Companies" && <CompaniesPanel />}
          {activeTab === "On Shift" && (
            <Dashboard user={user} go={setTab} canOpen={canOpen} lang={lang} shiftOnly />
          )}
          {activeTab === "Dashboard" && (
            <>
              {/* v1.105.0 - iPhone + Safari + not installed, once: how to put
                  the portal on the Home Screen. Phones only (md:hidden). */}
              <div className={`${css.coach} erp-phone-only`}><InstallCoach /></div>
              <Dashboard user={user} go={setTab} canOpen={canOpen} lang={lang}
                onCreateQuotation={() => { setSalesStart("create"); setSalesCreateRequest((n) => n + 1); setTab("Sales"); }} />
              <details className={css.overview}>
                <summary className={css.overviewSummary}>
                  {L("Calendar and team overview", "Kalendar dan ringkasan pasukan")}
                </summary>
                <div className={css.overviewGrid}>
                  <div className={css.overviewCol}><ContextPanel lang={lang} /></div>
                  <div className={css.overviewCol}><RightRail lang={lang} go={(t) => setTab(t as TabName)} /></div>
                </div>
              </details>
            </>
          )}
          {activeTab === "Claims" && (
            <ClaimsPanel userId={user.id} role={user.role} />
          )}
          {activeTab === "Finance" && (
            /* v1.173.0 (tab concept): two zones. The cash position and the
               month's figures first, the payments due and the expense
               records under them; the P&L rides inside Expenses as before. */
            <TabPage>
              <TabZone label={L("This month", "Bulan ini")}>
                {/* Current cash and payments due precede reporting. */}
                <CashFlowPanel />
              </TabZone>
              {/* the expense zones are the panel's own (role-panels.tsx) */}
              <ExpensesPanel reporting={<PnlCard />} />
            </TabPage>
          )}
          {activeTab === "Attendance" && (
            /* v1.173.0 (tab concept): four zones in the v1.171.0 order -
               today's records, the decisions waiting, the roster, setup. */
            <TabPage>
              <TabZone label={L("Today", "Hari ini")}>
              <Attendance user={user} />
              {/* v1.171.0 (CEO, 20-09-2026: "resort it based on it own
                  function and properly put in on their own tabs") — the
                  attendance donut and today's assignments, from the Dashboard.
                  Same tier as the monitor above; status chips act for the
                  roles that may edit the roster. */}
              {MANAGE_ROLES.includes(user.role) && (
                <CompanyAttendanceToday canManage={["ceo", "coo", "cco", "super_admin", "admin"].includes(user.role)} />
              )}
              </TabZone>
              <TabZone label={L("Waiting on me", "Menunggu saya")}>
              {/* v1.84.0 (CEO: "attendance verification should move to
                  Attendance ... full report is require and a must!") — it was
                  on the HR tab, printing every punch in the month with no
                  total. Same tier that could see it there. */}
              {["ceo", "coo", "cco", "hr_admin", "super_admin", "admin"].includes(user.role) && (
                <VerificationCard />
              )}
              {["ceo", "coo", "super_admin", "admin"].includes(user.role) ? (
                <OtApprovalsCard />
              ) : (
                <PermissionPlaceholder
                  title={L("OT Approvals", "Kelulusan OT")}
                />
              )}
              </TabZone>
              <TabZone label={L("The roster", "Jadual")}>
              {/* Scheduling follows attendance review and OT decisions.
                  v1.171.0: the anchor "Open roster" (assignments card) scrolls to. */}
              <div id="roster-board" className={css.rosterAnchor}>
              <RosterBoard
                canManage={[
                  "ceo",
                  "coo",
                  "cco",
                  "hr_admin",
                  "super_admin",
                  "admin",
                ].includes(user.role)}
                canEdit={["ceo", "coo", "cco", "super_admin", "admin"].includes(
                  user.role
                )}
                /* v1.171.0 (CEO, 20-09-2026: "on the attendance, the Task
                   should be able to delete!") - mirrors task_delete in
                   worker/src/permissions.ts, which is the CEO alone. */
                canDeleteTask={["ceo", "super_admin"].includes(user.role)}
                /* v1.159.9 - a Sales-duty note opens the register on that
                   person and day; offered only when this account has the tab. */
                onOpenRegister={canOpen("Sales Performance") ? (staff, day) => { setSpPreset({ staff, day }); setTab("Sales Performance"); } : undefined}
              />
              </div>
              </TabZone>
              <TabZone label={L("Setup", "Tetapan")}>
              {/* v1.91.0 — mirrors attendance_correct in the worker. */}
              {["ceo", "coo", "cco", "hr_admin", "super_admin", "admin"].includes(user.role) ? (
                <AttendanceAdminPanel role={user.role} />
              ) : (
                <PermissionPlaceholder
                  title={L("Attendance Admin", "Admin Kehadiran")}
                />
              )}
              </TabZone>
            </TabPage>
          )}
          {/* v1.172.0 - Reconciliation, Ads Fund and Purchasing retired: no
             block here, no tab in the registry, no panel in the bundle. */}
          {activeTab === "Commission" && (
            <CommissionPanel
              canDecide={["super_admin", "ceo"].includes(user.role)}
            />
          )}
          {activeTab === "Accounting" && <AccountingPanel />}
          {activeTab === "Leave" && <Leave user={user} />}
          {activeTab === "Tasks" && (
            /* v1.173.0: the zones are the panel's own (tasks.tsx). */
            <Tasks user={user} progress={MANAGE_ROLES.includes(user.role) ? <TaskProgressCard /> : undefined} />
          )}
          {activeTab === "Announcements" && <Announcements user={user} />}
          {/* v1.40.0 (AUDIT M12): visibility is decided ONCE, in the tabs filter
              (role default + tab-access override). The extra role re-check here
              made Sales the only tab where an override granted by the CEO
              rendered a completely blank page. */}
          {/* v1.112.0: enquiries are their own tab (CEO: staff work that must
              be answered), one place after Sales. */}
          {activeTab === "Enquiries" && <EnquiriesPanel userId={user.id} />}
          {activeTab === "Sales" && (
            /* v1.173.0 (tab concept): the Sales panel draws its own zones
               (the month's figures, the work, the customers); the map and
               the long view follow as two more. */
            <TabPage>
              <Sales user={user} initialView={salesStart} createRequest={salesCreateRequest} workExtra={<DocumentsPanel bare />} customersExtra={<ClientsCard bare />} />
              <TabZone label={L("This month", "Bulan ini")}>
                <SalesMap />
              </TabZone>
              <TabZone label={L("The longer view", "Pandangan lebih jauh")} cols={2}>
                <LiveEconomicsCard />
                <PackagesEditorCard role={user.role} />
              </TabZone>
            </TabPage>
          )}
          {/* v1.21.0: the Pipeline tab is retired (CEO: "Sales pipeline is
            really needed?? I dont think so"). Customer enquiries — the real
            inbound funnel — moved onto the Sales tab above. */}
          {activeTab === "Content" && (
            <ContentPanel
              canManage={[
                "super_admin",
                "admin",
                "ceo",
                "coo",
                "cco",
                "hr_admin",
                "sales_marketing",
                "marketing",
                "editor",
                "live_host",
              ].includes(user.role)}
            />
          )}
          {activeTab === "Stokis" && (
            <StokisPanel
              canManage={[
                "super_admin",
                "admin",
                "ceo",
                "coo",
                "cco",
                "hr_admin",
                "sales_marketing",
                "marketing",
              ].includes(user.role)}
            />
          )}
          {activeTab === "HR" && (
            /* v1.173.0: the zones are the panel's own (role-panels.tsx HrPanel). */
            <TabPage>
              <HrPanel administration={["hr_admin", "ceo", "super_admin", "admin"].includes(
                user.role
              ) ? (
                <HrAdminPanel />
              ) : (
                <PermissionPlaceholder
                  title={L("HR Administration", "Pentadbiran HR")}
                />
              )} />
            </TabPage>
          )}
          {activeTab === "Payroll" && <PayrollPanel role={user.role} />}
          {activeTab === "Staff Details" && (
            /* v1.173.0: the zones are the panel's own (staff-directory.tsx). */
            <TabPage>
              <StaffDirectory
                canAmend={["super_admin", "admin", "ceo"].includes(user.role)}
                readOnly={["coo", "cco"].includes(user.role)}
                /* v1.101.0 - the organisation view needs to know who is
                   looking: only the CEO, COO and CCO may set a reporting
                   line. readOnly above is about staff RECORDS - the COO and
                   CCO may not amend those, and may set reporting lines - so
                   the two cannot be folded into one flag. */
                role={user.role}
                /* v1.174.0 - who writes roles and responsibilities: the CEO
                   and the HR tier, mirroring PERMS.responsibilities_edit in
                   worker/src/permissions.ts (tests/staff-responsibilities.mjs
                   holds the two lists equal). */
                canEditResponsibilities={["super_admin", "admin", "hr_admin", "ceo"].includes(user.role)}
              />
              {/* v1.19.0 C1: the Birthdays tab folded in here; v1.93.0 (CEO:
                  "the birthday should be embedded into the staff card!") — and
                  then into the record itself: a cake on the face within a
                  fortnight, the age they turn on the open card, and the next
                  three under the circle. The date is set on the record form. */}
            </TabPage>
          )}
          {activeTab === "Inventory" && (
            /* v1.21.1 (CEO): status strip FIRST, minimal - the health read
               before the table. v1.119.0: the panel draws it, beside the
               ELFIA bridge pulse, as the first row of its STOCK NOW zone. */
            <InventoryPanel role={user.role} statusCard={MANAGE_ROLES.includes(user.role) ? <InventoryStatusCard /> : undefined} />
          )}
          {activeTab === "ELFIA Store" && (
            <ElfiaStorePanel />
          )}
          {activeTab === "Web Orders" && (
            <WebOrdersPanel />
          )}
          {activeTab === "ELFIA Traffic" && (
            <ElfiaTrafficPanel />
          )}
          {activeTab === "Ecommerce" && (
            /* v1.174.1 - TabPage (block flow), not the .ecomStack grid: a grid
               with an implicit auto track is sized by its widest card, so ONE
               card with an unbreakable line widened every zone past the phone
               (the CEO's screenshot, 21-09-2026). In block flow a wide line
               spills out of its own card only. */
            <TabPage>
              {REVENUE_ROLES.includes(user.role) && (
                <section className="erp-stack-tight">
                  <ZoneLabel>{L("This month", "Bulan ini")}</ZoneLabel>
                  {/* v1.171.0: the Sales floor (KPI target, pace, markets,
                      month bars) is the card's third pill - moved here from
                      the Dashboard, beside the revenue it measures. */}
                  <RevenueAndHoursCard user={user} go={setTab} lang={lang} />
                </section>
              )}
              <section className="erp-stack-tight">
                <ZoneLabel>{L("The work", "Kerja")}</ZoneLabel>
                <div className={`${css.ecomWork} ${REVENUE_ROLES.includes(user.role) ? css.ecomWorkSplit : ""}`}>
                  <TikTokOrdersCard
                    role={user.role}
                    onChanged={() => {
                      /* stock views live on Inventory */
                    }}
                  />
                  {REVENUE_ROLES.includes(user.role) && <FulfilmentCard />}
                </div>
              </section>
              {REVENUE_ROLES.includes(user.role) && (
                <section className="erp-stack-tight">
                  <ZoneLabel>{L("The longer view", "Pandangan lebih jauh")}</ZoneLabel>
                  <OpsMapCard aside={<LeaderboardCard user={user} compact />} />
                  <MoneyCard user={user} />
                  {["ceo", "super_admin"].includes(user.role) && <TikTokAnalyticsCard />}
                </section>
              )}
              <section className="erp-stack-tight">
                <ZoneLabel>{L("Setup", "Tetapan")}</ZoneLabel>
                <ConnectionStatusCard />
              </section>
            </TabPage>
          )}
          {/* v1.5.0: Social tab removed on the CEO's direction. */}
          {activeTab === "Assets" && <AssetsPanel />}
          {activeTab === "Threads" && <ThreadsPanel />}
          {activeTab === "Hotels" && <HotelsPanel />}
          {/* v1.155.0 - the Sales Performance command centre: one page, evidence in, verified figures out. */}
          {activeTab === "Sales Performance" && <SalesPerformancePanel go={(t) => setTab(t as TabName)} canOpen={canOpen} preset={spPreset} />}
          {/* Hankei's Commerce: orders, receipts and manual bank verification. */}
          {activeTab === "Hankeis" && <HankeisPanel />}
          {/* v1.129.0 - the three officers' cards. TAB_ROLES draws this tab
              for ceo/coo/cco only; the panel takes the role so it can put the
              signed-in officer's own card first. */}
          {activeTab === "Cards" && <CardsPanel role={user.role} />}
          {activeTab === "Users" && (
            /* v1.173.0 (tab concept): accounts and their review in one card
               under ACCOUNTS; who sees which tab and where a punch counts
               side by side under ACCESS AND LOCATIONS. Same order as before. */
            <TabPage>
              <TabZone label={L("Accounts", "Akaun")}>
                <div className={card}>
                  <UsersPanel role={user.role} embedded />
                  {["ceo", "super_admin"].includes(user.role) && <AccessReviewCard embedded />}
                </div>
              </TabZone>
              {["ceo", "super_admin", "coo"].includes(user.role) && (
                <TabZone label={L("Access and locations", "Akses dan lokasi")} cols={2}>
                  {["ceo", "super_admin"].includes(user.role) && <TabAccessCard />}
                  {["super_admin", "ceo", "coo"].includes(user.role) && (
                    <GeofenceCard />
                  )}
                </TabZone>
              )}
            </TabPage>
          )}
          {activeTab === "Profile" && (
            /* v1.173.0 (tab concept): three zones - who I am, my pay, my
               security - in the order the tab has always read. */
            <TabPage>
              <TabZone label={L("My details", "Butiran saya")}>
                <Profile />
              </TabZone>
              <TabZone label={L("My pay", "Gaji saya")}>
                <MyPayslip />
              </TabZone>
              <TabZone label={L("Security and privacy", "Keselamatan dan privasi")}>
              <TwoFactorPanel />
              {/* v1.4.191: staff read how their personal data (NRIC, bank,
                photos, payroll) is handled — PDPA notice */}
              <p className={css.privacyNote}>
                <a
                  href="/privacy"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {L(
                    "How your personal data is handled — Privacy Notice (PDPA)",
                    "Bagaimana data peribadi anda diurus — Notis Privasi (PDPA)"
                  )}
                </a>
              </p>
              </TabZone>
            </TabPage>
          )}
        </main>
      </div>
    </AppShell>
  );
}

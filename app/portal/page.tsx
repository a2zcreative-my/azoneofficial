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
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import {
  ALL_TABS,
  SALES_ROLES,
  canSeeTab,
  type PersonAccess,
  type TabName,
} from "@/lib/portal-tabs"; // v1.79.0 — ONE tab registry (page + 🔐 card)
/* v1.28.0 — legal document identity: a STAMPED document (leave form, invoice
   chase) renders the issuer stored on its row via resolveIssuer(issuer_code);
   a document issued fresh TODAY (the SOA) carries DOCUMENT_ISSUER. */
/* v1.4.212 (approved architecture review): three NEW isolated cards. */
import { ConnectionStatusCard } from "@/components/portal/connection-status-card";
import { SalesByHourCard } from "@/components/portal/sales-by-hour-card";
import { FulfilmentCard } from "@/components/portal/fulfilment-card";
import { AppShell } from "@/components/layout/app-shell";
import { PortalSkeleton } from "@/components/portal/portal-skeleton";
import { setCacheScope, clearApiCache } from "@/lib/cached-api";

import { SidebarNav } from "@/components/layout/sidebar-nav";
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
  AccessReviewCard, HrAdminPanel, AssetsPanel, CommissionPanel, AdsFundPanel, ContentPanel,
  DocumentsPanel, ElfiaStorePanel, ElfiaTrafficPanel, CashFlowPanel, ReconciliationPanel,
  GeofenceCard, HotelsPanel, EnquiriesPanel, SalesMap, PayrollPanel, MyPayslip, PurchasingPanel, AccountingPanel,
  AttendanceAdminPanel, HrPanel, InventoryPanel, ClaimsPanel, ExpensesPanel, TikTokOrdersCard,
  RosterBoard, StokisPanel, TabAccessCard, ThreadsPanel, VerificationCard, WebOrdersPanel,
  StaffDirectory,
} from "@/components/portal/lazy-panels";
import { card, btnClass, btnHdr, btnHdrDesktop, PORTAL_WIDTH } from "@/lib/ui-styles";
import { dmy } from "@/lib/format";
import { Announcements } from "@/components/portal/announcements";
import { Attendance } from "@/components/portal/attendance";
import { LeaderboardCard, MoneyCard } from "@/components/portal/commission";
import { Dashboard, REVENUE_ROLES } from "@/components/portal/dashboard";
import { Leave } from "@/components/portal/leave";
import { OtApprovalsCard } from "@/components/portal/live-cards";
import { L, MANAGE_ROLES, Notification, User, ZoneLabel, mytGreeting } from "@/components/portal/page-shared";
import { Profile } from "@/components/portal/profile";
import { ClientsCard, LiveEconomicsCard, PackagesEditorCard, PnlCard, Sales } from "@/components/portal/sales";
import { Tasks } from "@/components/portal/tasks";
import { TikTokAnalyticsCard } from "@/components/portal/tiktok-cards";
import { SalesRevenueCard } from "@/components/portal/trading-desk";
import { UsersPanel } from "@/components/portal/users-panel";

/* v1.79.0 — ALL_TABS, TAB_ROLES and SALES_ROLES moved to lib/portal-tabs.ts.
   They were duplicated in components/portal/tab-access-card.tsx, and the copy
   had drifted: the 🔐 card listed the tabs in a different order and had the
   Users default down as CEO + COO when this file has allowed `admin` since
   v1.40.0. Both now read the one module. Tab ORDER is still the CEO's own
   v1.22.0 sequence — the phone bottom bar is the first four tabs a role can
   see, so the list decides every role's thumb row. */

// No staff role's home is /admin any more (only super_admin/admin live there,
// and they deep-link into portal modules via the admin Staff bridge). Kept as
// an empty guard so the redirect logic below stays explicit.
const CONTENT_ONLY_ROLES: string[] = [];


export default function PortalPage() {
  const [user, setUser] = useState<User | null>(null);
  const [checked, setChecked] = useState(false);
  /* v1.4.231 (CEO: "when I refresh the tabs back to Dashboard instead of
     last tab that I open"): the active tab was plain useState — a refresh
     rebuilds the page and lands on the default. Now the last tab persists
     per device (localStorage azone-tab), restored on load and validated:
     if the saved tab isn't visible to this account (role change, 🔐 tab
     access change), the guard effect below falls back to Dashboard. */
  const [tab, setTab] = useState<TabName>("Dashboard");
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
        return;
      }
      const saved = window.sessionStorage.getItem(`azone-tab:${user.id}`);
      if (saved && (ALL_TABS as readonly string[]).includes(saved))
        setTab(saved as TabName);
    } catch {
      /* private mode */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);
  useEffect(() => {
    try {
      if (user) window.sessionStorage.setItem(`azone-tab:${user.id}`, tab);
    } catch {
      /* private mode */
    }
  }, [tab, user?.id]);
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
     Rails: Dashboard + Profile always visible; super_admin ignores
     overrides entirely (the escape hatch); fetch failure (old worker) =
     defaults, so a split deploy can never blank the tab strip. */
  const tabs = ALL_TABS.filter((t) => canSeeTab(user?.role, t, tabOverrides, myTabAccess));
  // v1.4.231 guard: a remembered tab this account can't see → Dashboard.
  useEffect(() => {
    if (!tabs.includes(tab)) setTab("Dashboard");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabs.join("|"), tab]);

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
  if (!checked) return <PortalSkeleton />;
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
      <div className="mx-auto mt-24 max-w-sm px-6 text-center">
        <p className="text-gold-deep mb-3 text-xs font-medium tracking-[0.3em] uppercase">
          {L(
            "A2Z CREATIVE MARKETING / Staff Portal",
            "A2Z CREATIVE MARKETING / Portal Kakitangan"
          )}
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">
          {L("Sign in required", "Log masuk diperlukan")}
        </h1>
        <p className="text-muted-foreground mt-3 text-sm">
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
        <Link href="/login" className={`${btnClass} mt-6`}>
          {L("Go to login", "Pergi ke log masuk")}
        </Link>
      </div>
    );
  }

  if (user.requires_2fa) {
    return (
      <div className="mx-auto w-full max-w-lg px-4 py-12 md:py-24">
        <div className="border-border bg-card rounded-xl border p-6 shadow-sm">
          <h1 className="text-foreground mb-2 text-2xl font-semibold tracking-tight">
            {L(
              "Two-Factor Authentication Required",
              "Pengesahan Dua Faktor Diperlukan"
            )}
          </h1>
          <p className="text-muted-foreground mb-8 text-sm">
            {L(
              "Your role requires two-factor authentication to be enabled before you can access the A2Z CREATIVE MARKETING Staff Portal. Please set it up now.",
              "Peranan anda memerlukan pengesahan dua faktor diaktifkan sebelum anda boleh mengakses Portal Kakitangan A2Z CREATIVE MARKETING. Sila sediakannya sekarang."
            )}
          </p>
          <TwoFactorPanel />
          <div className="border-border mt-8 flex justify-end border-t pt-6">
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
              className="text-muted-foreground hover:text-foreground text-sm font-medium transition-colors"
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
  return (
    /* v1.13.0: AppShell now renders the grouped ERP sidebar (CEO's DZI
       reference). It receives the SAME `navItems` the role gating and
       tab-access overrides already produced — the shell groups them for
       display and decides nothing about visibility. Below `md` it renders
       `children` unstyled, so the v1.11.1 phone is untouched. */
    <AppShell
      rail={
        <SidebarNav
          items={navItems}
          active={activeTab}
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
      /* v1.14.0: the side columns carry a date context.
         v1.17.0 (CEO: "Schedule & Roster seem take so much unrelated things
         there"): DASHBOARD ONLY. On Attendance the rails repeated pending
         leave / open tasks / announcements beside a tab that is already five
         cards deep — duplication read as clutter, and the roster lost width
         to it. Work tabs get the full working area. */
      contextPanel={
        activeTab === "Dashboard" ? <ContextPanel lang={lang} /> : undefined
      }
      rightRail={
        activeTab === "Dashboard" ? <RightRail lang={lang} go={(t) => setTab(t as TabName)} /> : undefined
      }
    >
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        tabs={navItems}
        canSeeClients={REVENUE_ROLES.includes(user.role)}
        onTab={(t) => setTab(t as TabName)}
        extraActions={[
          {
            label: tr("Apply leave", lang),
            hint: L("action", "tindakan"),
            run: () => {
              setTab("Leave");
              setPaletteOpen(false);
            },
          },
          ...(SALES_ROLES.includes(user.role)
            ? [
                {
                  label: tr("Create quotation", lang),
                  hint: L("action", "tindakan"),
                  run: () => {
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
      {/* v1.10.0: pb-28 — the bottom nav grew to min-h-16 + safe-area inset,
        pb-24 left the last card's edge underneath it on notched phones. */}
      {/* v1.70.0 (CEO: "make the width globally standardize instead of
          inconsistent") — the portal had NO maximum width on desktop
          (`md:max-w-none`), so every card stretched to whatever the window
          happened to be. On a wide monitor that gives a paragraph a
          200-character line while the card beside it holds a table pinned to
          760px, and nothing on the page shares a measure.
          One standard width, centred, defined once in ui-styles and used by
          every screen. 1600px is wide enough for the seven-column roster and
          the payroll tables, narrow enough that prose stays readable. */}
      <div className={`w-full px-4 py-3 pb-28 md:px-5 md:py-4 md:pb-6 ${PORTAL_WIDTH}`}>
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
        <header className="border-border bg-background/95 sticky top-0 z-30 -mx-4 flex items-center justify-between gap-2 border-b px-4 pb-2 backdrop-blur [--hdr-pt:0.5rem] md:-mx-5 md:mb-4 md:gap-3 md:px-5 md:pb-3 md:backdrop-blur-none md:[--hdr-pt:0.75rem]"
          style={{ paddingTop: "calc(var(--hdr-pt) + env(safe-area-inset-top, 0px))" }}>
          <div className="flex min-w-0 flex-1 items-center gap-2 md:gap-3">
            {/* v1.4.141: the badge-card photo as an app-style avatar — circular,
              gold-ringed, next to the welcome on desktop and the screen title
              on mobile. Falls back to the initial when no photo is set. */}
            {user.photo_key ? (
              <img
                src={`/api/v1/media/file/${encodeURIComponent(user.photo_key)}`}
                alt=""
                className="ring-gold h-9 w-9 shrink-0 rounded-full object-cover ring-2 md:h-11 md:w-11"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                }}
              />
            ) : (
              <span className="bg-primary text-primary-foreground ring-gold flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold ring-2 md:h-11 md:w-11">
                {user.name.trim().charAt(0).toUpperCase()}
              </span>
            )}
            <div className="min-w-0">
              <p className="text-gold-deep hidden text-xs font-medium tracking-[0.3em] uppercase md:block">
                {tr("Staff Portal short", lang)}
              </p>
              {/* v1.15.0: time-of-day greeting, as the reference.
                v1.16.0: text-lg until 2xl — xl is 1280px, so at a 1440px
                viewport (both side columns open, 773px header) xl:text-xl
                re-applied the 20px size and the name clipped by 12px. 2xl
                (1536px) is the first width with room for it. Measured, not
                guessed: h1 183px available vs 195px scrollWidth at text-xl. */}
              <h1 className="hidden truncate text-lg font-semibold tracking-tight md:block 2xl:text-xl">
                {mytGreeting(lang)}, {user.name.split(" ")[0]}
              </h1>
              {/* On phones the header reads like an app screen title.
                v1.10.0: the Dashboard says "Today" (the reference design's
                home title); every other tab keeps its own name. */}
              <h1 className="truncate text-xl font-bold tracking-tight md:hidden">
                {activeTab === "Dashboard"
                  ? tr("Today", lang)
                  : tr(activeTab, lang)}
              </h1>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5 md:min-w-0 md:shrink">
            {/* v1.8.0: global search — opens the palette (Ctrl/Cmd+K works anywhere) */}
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              className="border-border text-muted-foreground hover:bg-secondary hidden h-9 w-40 min-w-24 shrink items-center justify-between rounded-lg border px-3 text-sm transition-colors md:flex"
              aria-label={L("Search the portal", "Cari dalam portal")}
            >
              <span className="flex items-center gap-2">
                <Search aria-hidden className="h-4 w-4" strokeWidth={1.75} />{" "}
                {tr("Search…", lang)}
              </span>
              <kbd className="bg-secondary rounded px-1.5 py-0.5 text-[10px] font-medium">
                Ctrl K
              </kbd>
            </button>
            <button
              type="button"
              className={`${btnHdr} md:hidden`}
              onClick={() => setPaletteOpen(true)}
              aria-label={L("Search the portal", "Cari dalam portal")}
            >
              <Search aria-hidden className="h-4 w-4" strokeWidth={1.75} />
            </button>
            {/* v1.10.0: sound, push and EN/BM are set-once switches, not daily
              taps — on phones they live in the More sheet's Preferences row
              so the app bar keeps just search · bell · dark · sign out. */}
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
                <Volume2 aria-hidden className="h-4 w-4" strokeWidth={1.75} />
              ) : (
                <VolumeX aria-hidden className="h-4 w-4" strokeWidth={1.75} />
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
                    className="h-4 w-4"
                    strokeWidth={1.75}
                  />
                ) : (
                  <BellOff aria-hidden className="h-4 w-4" strokeWidth={1.75} />
                )}
              </button>
            )}
            <button
              type="button"
              className={`${btnHdr} relative`}
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
              <Bell aria-hidden className="h-4 w-4" strokeWidth={1.75} />
              {unread > 0 && (
                <span className="absolute -top-1.5 -right-1.5 inline-flex h-5 min-w-5 animate-pulse items-center justify-center rounded-full bg-amber-500 px-1 text-[11px] font-bold text-white shadow">
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
              <Palette aria-hidden className="h-4 w-4" strokeWidth={1.75} />
            </button>
            <button
              type="button"
              className={`${btnHdrDesktop} text-xs font-semibold`}
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
              className={btnHdr}
              onClick={() => setDark((v) => !v)}
              aria-label={L("Toggle dark mode", "Togol mod gelap")}
            >
              {dark ? (
                <Sun aria-hidden className="h-4 w-4" strokeWidth={1.75} />
              ) : (
                <Moon aria-hidden className="h-4 w-4" strokeWidth={1.75} />
              )}
            </button>
            {/* v1.16.0 (CEO): icon-only — the text label cost ~70px in a row
              that was already squeezing the greeting. title + aria-label keep
              it discoverable and announced. */}
            <button
              type="button"
              className={btnHdr}
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
              <LogOut aria-hidden className="h-4 w-4" strokeWidth={1.75} />
            </button>
          </div>
        </header>

        {/* v1.13.0: the reference's page header — title left, breadcrumb right. */}
        <div className="mb-3 hidden items-baseline justify-between gap-4 md:flex">
          <h2 className="text-[22px] font-semibold tracking-tight">
            {tr(activeTab, lang)}
          </h2>
          <p className="text-muted-foreground text-xs">
            {tr("Staff Portal", lang)} / {tr(activeTab, lang)}
          </p>
        </div>

        {showNotifs && (
          <div className={`${card} mt-4`}>
            <p className="text-sm font-semibold">{tr("Notifications", lang)}</p>
            <p className="text-muted-foreground mt-0.5 text-xs">
              {L(
                "Last 7 days. Older notifications clear automatically.",
                "7 hari terakhir. Pemberitahuan lama dipadam secara automatik."
              )}
            </p>
            {notifs.length === 0 && (
              <p className="text-muted-foreground mt-2 text-sm">
                {L("Nothing yet.", "Tiada apa-apa lagi.")}
              </p>
            )}
            <div className="mt-1 max-h-44 overflow-y-auto pr-1">
              {notifs.map((n) => (
                <p key={n.id} className="mt-2 text-sm">
                  {n.kind === "announcement" || n.kind === "enquiry" ? (
                    <button
                      type="button"
                      className="text-left underline-offset-2 hover:underline"
                      onClick={() => setTab(n.kind === "enquiry" ? "Enquiries" : "Announcements")}
                    >
                      {n.message}
                    </button>
                  ) : (
                    n.message
                  )}{" "}
                  <span className="text-muted-foreground text-xs">
                    · {dmy(n.created_at)}
                  </span>
                </p>
              ))}
            </div>
          </div>
        )}

        {/* v1.8.0: the desktop tab-pill grid is replaced by the icon sidebar
          (SidebarNav). Phones keep the bottom navigation below. */}

        {/* App-style bottom navigation (v1.4.49) — phones only. The first four
          of this person's tabs are one thumb-tap away; the rest are in More. */}
        <nav
          className="border-border bg-card fixed inset-x-0 bottom-0 z-40 flex border-t md:hidden"
          /* v1.25.4 (CEO: "Why bottom nav like this?!!!" — labels sliced along
           their bottom edge on iPhone): iOS Safari reports this inset as 0 while
           its floating toolbar is shown, which removed ALL breathing room under
           the labels. max() guarantees a floor either way. */
          style={{
            paddingBottom: "max(env(safe-area-inset-bottom, 0px), 6px)",
          }}
          aria-label={L(
            "Portal sections (mobile)",
            "Bahagian portal (mudah alih)"
          )}
        >
          {/* v1.10.0 (reference design): each tab shows its sidebar icon; the
            active one sits in a filled navy rounded square — same visual
            language as the desktop sidebar's gold square. */}
          {tabs.slice(0, 4).map((t) => {
            const active = tab === t && !moreOpen;
            return (
              <button
                key={t}
                type="button"
                onClick={() => {
                  setTab(t);
                  setMoreOpen(false);
                  window.scrollTo({ top: 0 });
                }}
                aria-current={active ? "page" : undefined}
                className="flex min-h-16 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-medium"
              >
                <span
                  aria-hidden
                  className={`grid h-9 w-9 place-items-center rounded-xl text-base transition-colors ${
                    active
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground"
                  }`}
                >
                  <TabIcon name={t} />
                </span>
                {/* truncate: BM labels ("Papan Pemuka") must not wrap and
                  unbalance the row on narrow phones */}
                <span
                  className={`w-full truncate px-0.5 text-center leading-[1.6] ${active ? "text-primary font-semibold" : "text-muted-foreground"}`}
                >
                  {tr(t, lang)}
                </span>
              </button>
            );
          })}
          {/* v1.10.0 review fix: More renders UNCONDITIONALLY — the mobile
            Preferences (sound/push/language/theme) live in its sheet, and a
            role trimmed to ≤4 tabs would otherwise lose them entirely. */}
          {(() => {
            const active = moreOpen || tabs.indexOf(tab) >= 4;
            return (
              <button
                type="button"
                onClick={() => setMoreOpen((v) => !v)}
                className="flex min-h-16 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-medium"
              >
                <span
                  aria-hidden
                  className={`grid h-9 w-9 place-items-center rounded-xl text-base transition-colors ${
                    active
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground"
                  }`}
                >
                  <Ellipsis
                    aria-hidden
                    className="h-[18px] w-[18px]"
                    strokeWidth={1.75}
                  />
                </span>
                <span
                  className={`w-full truncate text-center leading-[1.6] ${active ? "text-primary font-semibold" : "text-muted-foreground"}`}
                >
                  {tr("More", lang)}
                </span>
              </button>
            );
          })()}
        </nav>

        {moreOpen && (
          <div className="fixed inset-0 z-30 md:hidden">
            <button
              type="button"
              aria-label={L("Close menu", "Tutup menu")}
              className="absolute inset-0 cursor-pointer bg-black/40"
              onClick={() => setMoreOpen(false)}
            />
            {/* v1.10.0 review fix: bottom padding clears the taller nav PLUS the
              phone's home-indicator inset — the old pb-16 left the Preferences
              row half-covered and untappable on notched iPhones. */}
            <div className="border-border bg-card absolute inset-x-0 bottom-0 max-h-[80vh] overflow-y-auto overscroll-contain rounded-t-2xl border-t p-4 pb-[calc(4.5rem+env(safe-area-inset-bottom))]">
              <div className="mb-3 flex items-center justify-between">
                <span className="w-9" />
                <button
                  type="button"
                  aria-label={L("Close menu", "Tutup menu")}
                  className="bg-border mx-auto h-1.5 w-12 rounded-full"
                  onClick={() => setMoreOpen(false)}
                />
                <button
                  type="button"
                  aria-label={L("Close", "Tutup")}
                  className="border-border text-muted-foreground flex h-9 w-9 items-center justify-center rounded-full border text-base"
                  onClick={() => setMoreOpen(false)}
                >
                  <CloseX aria-hidden className="h-4 w-4" strokeWidth={1.75} />
                </button>
              </div>
              {tabs.length > 4 && (
                <div className="grid grid-cols-3 gap-2.5">
                  {tabs.slice(4).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => {
                        setTab(t);
                        setMoreOpen(false);
                        window.scrollTo({ top: 0 });
                      }}
                      className={`flex min-h-16 flex-col items-center justify-center gap-1 rounded-xl border px-2 py-2.5 text-xs font-medium ${
                        tab === t
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border hover:bg-secondary"
                      }`}
                    >
                      <span aria-hidden className="grid place-items-center">
                        <TabIcon name={t} />
                      </span>
                      {tr(t, lang)}
                    </button>
                  ))}
                </div>
              )}
              {/* v1.10.0: the set-once switches displaced from the app bar —
                sound, push alerts, language, colour theme. Same handlers as
                the desktop header buttons. */}
              <p className="text-muted-foreground mt-4 mb-1.5 text-[10px] font-semibold tracking-wider uppercase">
                {tr("Preferences", lang)}
              </p>
              <div
                className={`grid gap-2.5 ${pushState !== "unsupported" ? "grid-cols-4" : "grid-cols-3"}`}
              >
                <button
                  type="button"
                  className="border-border hover:bg-secondary flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl border px-1 py-2 text-[11px] font-medium"
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
                  <span aria-hidden className="grid place-items-center">
                    {sound ? (
                      <Volume2
                        className="h-[18px] w-[18px]"
                        strokeWidth={1.75}
                      />
                    ) : (
                      <VolumeX
                        className="h-[18px] w-[18px]"
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
                    className="border-border hover:bg-secondary flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl border px-1 py-2 text-[11px] font-medium"
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
                    <span aria-hidden className="grid place-items-center">
                      {pushState === "granted" ? (
                        <BellRing
                          className="h-[18px] w-[18px]"
                          strokeWidth={1.75}
                        />
                      ) : (
                        <BellOff
                          className="h-[18px] w-[18px]"
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
                  className="border-border hover:bg-secondary flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl border px-1 py-2 text-[11px] font-medium"
                  onClick={() => {
                    const next = lang === "ms" ? "en" : "ms";
                    setLangState(next);
                    persistLang(next);
                  }}
                >
                  <span aria-hidden className="text-base font-bold">
                    {lang === "ms" ? "BM" : "EN"}
                  </span>
                  {lang === "ms" ? "Bahasa" : "English"}
                </button>
                <button
                  type="button"
                  className="border-border hover:bg-secondary flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl border px-1 py-2 text-[11px] font-medium"
                  onClick={() => setTheme(theme === "plum" ? "navy" : "plum")}
                >
                  <span aria-hidden className="grid place-items-center">
                    <Palette className="h-[18px] w-[18px]" strokeWidth={1.75} />
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
              {/* v1.23.4: the visible build stamp — "is the live site on the
                new version?" is now answerable from any phone. */}
              <p className="text-muted-foreground/70 mt-3 text-center text-[10px] tabular-nums">
                {L(
                  `A2Z CREATIVE MARKETING staff portal · v${APP_VERSION}`,
                  `Portal kakitangan A2Z CREATIVE MARKETING · v${APP_VERSION}`
                )}
              </p>
            </div>
          </div>
        )}

        <main key={tab} className="screen-enter mt-4 md:mt-6">
          {activeTab === "Dashboard" && (
            <>
              {/* v1.105.0 - iPhone + Safari + not installed, once: how to put
                  the portal on the Home Screen. Phones only (md:hidden). */}
              <div className="mb-4 md:hidden"><InstallCoach /></div>
              <Dashboard user={user} go={setTab} lang={lang} />
            </>
          )}
          {activeTab === "Claims" && (
            <ClaimsPanel userId={user.id} role={user.role} />
          )}
          {activeTab === "Finance" && (
            <div className="space-y-4 md:space-y-6">
              {/* v1.21.1 (CEO): Cash Flow LEADS the tab — the live bank picture
                first, the P&L and expense detail below it. */}
              <CashFlowPanel />
              <PnlCard />
              <ExpensesPanel />
            </div>
          )}
          {activeTab === "Attendance" && (
            <div className="space-y-4 md:space-y-6">
              {/* v1.8.0: the Schedule & Roster board (reference design) leads. */}
              {/* v1.22.6: canEdit — amend/typo-fix on sessions is CEO/COO/CCO
                (+ admin tier) only; hr_admin keeps scheduling powers. */}
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
              />
              <Attendance user={user} />
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
              {/* v1.91.0 — mirrors attendance_correct in the worker. */}
              {["ceo", "coo", "cco", "hr_admin", "super_admin", "admin"].includes(user.role) ? (
                <AttendanceAdminPanel role={user.role} />
              ) : (
                <PermissionPlaceholder
                  title={L("Attendance Admin", "Admin Kehadiran")}
                />
              )}
            </div>
          )}
          {activeTab === "Reconciliation" && <ReconciliationPanel />}
          {activeTab === "Commission" && (
            <CommissionPanel
              canDecide={["super_admin", "ceo"].includes(user.role)}
            />
          )}
          {activeTab === "Ads Fund" && (
            <AdsFundPanel
              canManage={["super_admin", "admin", "ceo", "coo"].includes(
                user.role
              )}
            />
          )}
          {activeTab === "Purchasing" && <PurchasingPanel />}
          {activeTab === "Accounting" && <AccountingPanel />}
          {activeTab === "Leave" && <Leave user={user} />}
          {activeTab === "Tasks" && (
            <div className="space-y-4 md:space-y-6">
              <Tasks user={user} />
              {MANAGE_ROLES.includes(user.role) && <TaskProgressCard />}
            </div>
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
            <div className="space-y-4 md:space-y-6">
              {/* v1.21.0 put the enquiries card here; v1.112.0 moved it to its
                own tab, one place to the right. v1.113.0: the CEO's sales map
                leads the tab - where the money is, by state. */}
              <SalesMap />
              <Sales user={user} />
              {/* v1.7.0: receipts, credit notes & outstanding report */}
              <DocumentsPanel />
              <ClientsCard />
              <LiveEconomicsCard />
              <PackagesEditorCard role={user.role} />
            </div>
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
            <div className="space-y-4 md:space-y-6">
              <HrPanel />
              {["hr_admin", "ceo", "super_admin", "admin"].includes(
                user.role
              ) ? (
                <HrAdminPanel />
              ) : (
                <PermissionPlaceholder
                  title={L("HR Administration", "Pentadbiran HR")}
                />
              )}
            </div>
          )}
          {activeTab === "Payroll" && <PayrollPanel role={user.role} />}
          {activeTab === "Staff Details" && (
            <div className="space-y-4 md:space-y-6">
              <StaffDirectory
                canAmend={["super_admin", "admin", "ceo"].includes(user.role)}
                readOnly={["coo", "cco"].includes(user.role)}
                /* v1.101.0 - the organisation view needs to know who is
                   looking: only the CEO, COO and CCO may set a reporting
                   line. readOnly above is about staff RECORDS - the COO and
                   CCO may not amend those, and may set reporting lines - so
                   the two cannot be folded into one flag. */
                role={user.role}
              />
              {/* v1.19.0 C1: the Birthdays tab folded in here; v1.93.0 (CEO:
                  "the birthday should be embedded into the staff card!") — and
                  then into the record itself: a cake on the face within a
                  fortnight, the age they turn on the open card, and the next
                  three under the circle. The date is set on the record form. */}
            </div>
          )}
          {activeTab === "Inventory" && (
            <div className="flex flex-col gap-4 md:gap-6">
              {/* v1.21.1 (CEO): status strip FIRST, minimal — the health
                read before the table. flex-col so the strip self-starts
                instead of stretching full width. */}
              {MANAGE_ROLES.includes(user.role) && <InventoryStatusCard />}
              <InventoryPanel role={user.role} />
            </div>
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
            <div className="space-y-3 md:space-y-6">
              {/* v1.4.214 (CEO): every TikTok / e-commerce card in one place.
                v1.4.217: connection status last (plumbing below the business).
                v1.21.1: the map leads. v1.64.3: leaderboard rides in the map's
                side column; targets + history + lines are one three-tab card.

                v1.117.0 — FOUR ZONES, like the Dashboard (CEO, 06-09-2026:
                "Now review on Ecommerce"). THIS MONTH: the map (leaderboard
                beside it), then Sales revenue and Sales by hour side by side -
                how much, and when in the day. THE WORK: the order tracker with
                Fulfilment beside it - the four counts are a summary of the same
                orders. THE LONGER VIEW: targets / history / lines, and the
                platform's own analytics. SETUP: the connection, last. The one
                place the phone differs from the desk is by one card: the
                month's total comes before the map on a small screen (a number
                reads in a glance; a map needs a scroll and a tap) - done with
                CSS order on the same three cards, so it is one tree. Every
                card is unchanged inside; only the order and the grouping. */}
              {REVENUE_ROLES.includes(user.role) && (
                <section className="space-y-3 md:space-y-4">
                  <ZoneLabel>{L("This month", "Bulan ini")}</ZoneLabel>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2 md:gap-4">
                    <div className="order-2 md:order-1 md:col-span-2">
                      <OpsMapCard aside={<LeaderboardCard user={user} compact />} />
                    </div>
                    <div className="order-1 md:order-2"><SalesRevenueCard /></div>
                    <div className="order-3"><SalesByHourCard /></div>
                  </div>
                </section>
              )}
              <section className="space-y-3 md:space-y-4">
                <ZoneLabel>{L("The work", "Kerja")}</ZoneLabel>
                <div className={`grid grid-cols-1 gap-3 md:gap-4 ${REVENUE_ROLES.includes(user.role) ? "md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]" : ""}`}>
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
                <section className="space-y-3 md:space-y-4">
                  <ZoneLabel>{L("The longer view", "Pandangan lebih jauh")}</ZoneLabel>
                  <MoneyCard user={user} />
                  {["ceo", "super_admin"].includes(user.role) && <TikTokAnalyticsCard />}
                </section>
              )}
              <section className="space-y-3 md:space-y-4">
                <ZoneLabel>{L("Setup", "Tetapan")}</ZoneLabel>
                <ConnectionStatusCard />
              </section>
            </div>
          )}
          {/* v1.5.0: Social tab removed on the CEO's direction. */}
          {activeTab === "Assets" && <AssetsPanel />}
          {activeTab === "Threads" && <ThreadsPanel />}
          {activeTab === "Hotels" && <HotelsPanel />}
          {activeTab === "Users" && (
            <div className="space-y-4 md:space-y-6">
              {["ceo", "super_admin"].includes(user.role) && <TabAccessCard />}
              {["ceo", "super_admin"].includes(user.role) && <AccessReviewCard />}
              {["super_admin", "ceo", "coo"].includes(user.role) && (
                <GeofenceCard />
              )}
              <UsersPanel role={user.role} />
            </div>
          )}
          {activeTab === "Profile" && (
            <div className="space-y-4 md:space-y-6">
              <Profile />
              <MyPayslip />
              <TwoFactorPanel />
              {/* v1.4.191: staff read how their personal data (NRIC, bank,
                photos, payroll) is handled — PDPA notice */}
              <p className="text-muted-foreground text-center text-xs">
                <a
                  className="underline"
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
            </div>
          )}
        </main>
      </div>
    </AppShell>
  );
}

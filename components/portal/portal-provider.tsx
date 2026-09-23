"use client";

/**
 * THE PORTAL'S STATE, IN ONE PLACE — P1.1, v1.181.0.
 *
 * `app/portal/page.tsx` was 1,917 lines: one component holding the auth
 * round-trip, the permission filter, the tab state, the theme, the language,
 * the notification stream, the outbox scope, the sound and push preferences,
 * the topbar, the bottom bar, the More sheet, the command palette AND a
 * thirty-three-branch switch drawing every module. P1 needs the shell to
 * survive a route change while the module underneath it is replaced, and a
 * route's page cannot receive props from a layout — so the state moves HERE,
 * behind one context, and the shell and the module page both read it.
 *
 * WHAT THIS RELEASE DOES NOT DO, ON PURPOSE:
 *
 *   The navigation is STILL `useState`. `tab` and `setTab` below are the
 *   same two lines they have been since v1.4.231, with the same
 *   sessionStorage memory, the same `?tab=` deep link and the same
 *   render-time clamp. No URL changes meaning in this release.
 *
 *   That is the whole point of shipping the extraction alone: it is the
 *   change most likely to break something subtle — a hook order, an effect
 *   that assumed it ran once, the SSE stream, the outbox scope — and doing
 *   it while the old navigation still drives the product means a regression
 *   here is provably not a routing bug. `lib/portal-routes.ts` (P1.0) is
 *   already in the repository, tested and unused; P1.2 is what connects it.
 *
 * EVERY LINE BELOW MOVED VERBATIM from page.tsx. Nothing was rewritten,
 * reordered or "tidied" on the way across: the diff a reviewer needs to read
 * is a MOVE, and a move that also edits is two changes wearing one commit.
 *
 * The gates live here rather than in the shell so that `usePortal().user` is
 * a `User` and never `User | null` — while the auth check is in flight this
 * component returns the skeleton and its children, the shell and the module
 * page, are never rendered at all.
 */

import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore, type Dispatch, type ReactNode, type SetStateAction } from "react";
import Link from "next/link";

import { api, sendOutboxEntry } from "@/lib/api";
import { setOutboxScope, startOutbox } from "@/lib/outbox";
import { pushPermission } from "@/lib/push-client";
import { applyVersions, pokeVersions, resetVersions } from "@/lib/live";
import {
  ALL_TABS,
  canSeeTab,
  mobileNavStops,
  mobilePrimaryTabs,
  type PersonAccess,
  type TabName,
} from "@/lib/portal-tabs";
import { favouritesServerSnapshot, favouritesSnapshot, readFavourites, subscribeFavourites } from "@/lib/favourites";
import { PortalSkeleton } from "@/components/portal/portal-skeleton";
import { setCacheScope } from "@/lib/cached-api";
import { NAV_COLLAPSED_KEY, SECTIONS } from "@/components/layout/side-nav";
import { getLang, t as tr, type Lang } from "@/lib/i18n";
import { APP_VERSION } from "@/lib/version";
import { TwoFactorPanel } from "@/components/security/two-factor-panel";
import { btnClass, card } from "@/lib/ui-styles";
import { L, type Notification, type User } from "@/components/portal/page-shared";
import { syncThemeColor } from "@/lib/theme-color";
import css from "@/app/portal/portal.module.css";

// No staff role's home is /admin any more (only super_admin/admin live there,
// and they deep-link into portal modules via the admin Staff bridge). Kept as
// an empty guard so the redirect logic below stays explicit.
const CONTENT_ONLY_ROLES: string[] = [];

/** Exactly the closure page.tsx used to be, named. */
export interface PortalContextValue {
  user: User;
  setUser: Dispatch<SetStateAction<User | null>>;
  checked: boolean;
  entryReady: boolean;
  navCollapsed: boolean;
  toggleNavCollapsed: () => void;
  tab: TabName;
  setTab: Dispatch<SetStateAction<TabName>>;
  /** the render-time clamp: never a tab outside this account's list */
  activeTab: TabName;
  tabs: TabName[];
  canOpen: (t: string) => boolean;
  deskStop: boolean;
  setDeskStop: Dispatch<SetStateAction<boolean>>;
  salesStart: "documents" | "create";
  setSalesStart: Dispatch<SetStateAction<"documents" | "create">>;
  salesCreateRequest: number;
  setSalesCreateRequest: Dispatch<SetStateAction<number>>;
  dark: boolean;
  setDark: Dispatch<SetStateAction<boolean>>;
  theme: "navy" | "plum";
  setTheme: Dispatch<SetStateAction<"navy" | "plum">>;
  lang: Lang;
  setLangState: Dispatch<SetStateAction<Lang>>;
  notifs: Notification[];
  setNotifs: Dispatch<SetStateAction<Notification[]>>;
  unread: number;
  showNotifs: boolean;
  setShowNotifs: Dispatch<SetStateAction<boolean>>;
  moreOpen: boolean;
  setMoreOpen: Dispatch<SetStateAction<boolean>>;
  paletteOpen: boolean;
  setPaletteOpen: Dispatch<SetStateAction<boolean>>;
  sound: boolean;
  setSound: Dispatch<SetStateAction<boolean>>;
  pushState: "default" | "granted" | "denied" | "unsupported";
  setPushState: Dispatch<SetStateAction<"default" | "granted" | "denied" | "unsupported">>;
  chime: () => Promise<void>;
  spPreset: { staff: number; day: string } | null;
  setSpPreset: Dispatch<SetStateAction<{ staff: number; day: string } | null>>;
  favourites: string[];
  navItems: { name: string; label: string }[];
  mobileStops: ReturnType<typeof mobileNavStops>;
  mobileMore: TabName[];
  mobileGroups: { title: string; tabs: TabName[] }[];
}

const PortalCtx = createContext<PortalContextValue | null>(null);

/** The shell and every routed module read the portal through this. */
export function usePortal(): PortalContextValue {
  const ctx = useContext(PortalCtx);
  if (!ctx) throw new Error("usePortal() outside <PortalProvider>");
  return ctx;
}

export function PortalProvider({ children }: { children: ReactNode }) {
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
    /* v1.177.0 - dark is the portal's ground now, so an account that has
       never touched the toggle gets the deck. Only an explicit "light" opts
       out, which is the same test the pre-paint script in app/layout.tsx
       makes - the two must agree or the theme flips after hydration. */
    setDark(localStorage.getItem("azone-theme") !== "light");
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

  return (
    <PortalCtx.Provider
      value={{
        user, setUser, checked, entryReady, navCollapsed, toggleNavCollapsed,
  tab, setTab, activeTab, tabs, canOpen, deskStop, setDeskStop,
  salesStart, setSalesStart, salesCreateRequest, setSalesCreateRequest,
  dark, setDark, theme, setTheme, lang, setLangState,
  notifs, setNotifs, unread, showNotifs, setShowNotifs,
  moreOpen, setMoreOpen, paletteOpen, setPaletteOpen,
  sound, setSound, pushState, setPushState, chime,
  spPreset, setSpPreset, favourites, navItems, mobileStops, mobileMore, mobileGroups,
      }}
    >
      {children}
    </PortalCtx.Provider>
  );
}

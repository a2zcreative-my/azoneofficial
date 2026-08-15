"use client";

/* v1.16.0 — one SVG icon per module, system-wide (CEO: "I want svg which is
 * looks professional").
 *
 * Replaces the emoji glyph maps that lived in three places — the sidebar's
 * ICONS, admin's TAB_ICONS and account's nav tuples. Emoji rendered
 * differently on every platform (monochrome on some Androids, tofu on old
 * WebViews) and could never be tinted, so the active state relied on the
 * square behind the glyph. Lucide strokes inherit `currentColor`: the same
 * icon is white/70 idle, navy-on-gold active, without two assets.
 *
 * lucide-react is ALREADY a dependency (the public site's navbar/footer use
 * it) — this adds no package. Icons tree-shake; only the ~30 named here are
 * bundled.
 *
 * ONE MAP for portal + admin + account. Names that exist in more than one
 * surface (Dashboard, Users, Enquiries, Account) deliberately share the icon,
 * so the surfaces speak one language. A name missing from the map falls back
 * to a neutral square — same rule as the old `?? "▪"`, a new tab can never
 * crash the nav.
 */

import {
  Banknote, Cake, CalendarClock, Clapperboard, ClipboardList, FileText,
  Globe, IdCard, Image, Inbox, LayoutDashboard, LayoutPanelTop, ListChecks,
  LogOut, Magnet, Megaphone, MessageSquareQuote, Package, Palmtree, Percent,
  Receipt, Rocket, Scale, ScrollText, Settings2, ShieldCheck, ShoppingBag,
  ShoppingCart, SquarePen, Square, Store, Timer, TrendingDown, UserRound,
  UsersRound, Video, Wallet,
  type LucideIcon,
} from "lucide-react";

export const TAB_ICON: Record<string, LucideIcon> = {
  // ---- portal ----
  Dashboard: LayoutDashboard,
  Overview: LayoutPanelTop,
  Announcements: Megaphone,
  HR: UsersRound,
  "Staff Details": IdCard,
  Attendance: Timer,
  Leave: Palmtree,
  Tasks: ListChecks,
  Pipeline: Magnet,
  Content: Clapperboard,
  Claims: Receipt,
  Payroll: Wallet,
  Expenses: TrendingDown,
  Sales: FileText,
  Inventory: Package,
  Stokis: Store,
  Ecommerce: ShoppingCart,
  Assets: Video,
  Birthdays: Cake,
  Profile: UserRound,
  Users: ShieldCheck,
  // ---- admin (names not shared with the portal) ----
  Website: Globe,
  Enquiries: Inbox,
  Portfolio: Image,
  Testimonials: MessageSquareQuote,
  Posts: SquarePen,
  Media: Clapperboard,
  Staff: UsersRound,
  Audit: ScrollText,
  Account: UserRound,
  Advanced: Settings2,
  // ---- account + portal Orders (the unified recorder) ----
  Orders: ClipboardList,
  // ---- ERP modules (v1.18.0, programme phases 4–7) ----
  "Cash Flow": Banknote,
  Reconciliation: Scale,
  Commission: Percent,
  "Ads Fund": Rocket,
  Purchasing: ShoppingBag,
  Accounting: ScrollText,
  // ---- misc surfaces ----
  Events: CalendarClock,
  Banking: Banknote,
};

/** The one nav glyph. Sized for the h-9/w-9 icon squares (18px) by default;
 *  pass a className to resize. Decorative — the label or aria-label on the
 *  surrounding control carries the name. */
export function TabIcon({ name, className }: { name: string; className?: string }) {
  const I = TAB_ICON[name] ?? Square;
  return <I aria-hidden className={className ?? "h-[18px] w-[18px]"} strokeWidth={1.75} />;
}

/* Re-exported so consumers import every chrome icon from ONE place — keeps
   the icon language consistent and makes the next sweep greppable. */
export { LogOut };
export {
  Bell, BellOff, BellRing, Check, Clock3, Languages, MapPin, Moon, Palette,
  Search, ShieldCheck as ShieldOk, Sun, Volume2, VolumeX, X as CloseX,
  Ellipsis,
} from "lucide-react";

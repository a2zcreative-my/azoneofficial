"use client";

/**
 * v1.126.0 — ONE icon for everything that is not the nav.
 *
 * The CEO, 06-09-2026, on the portal's emoji. He is right, and the fix for the
 * navigation already exists: v1.16.0 replaced the sidebar, admin and account
 * glyph maps with lucide SVGs in components/layout/nav-icons.tsx, and every
 * rail has rendered `<TabIcon>` since. What he found in sidebar-nav.tsx was the
 * dead `ICONS` map that v1.16.0 left behind with a DEPRECATED note on it — no
 * file imported it, so it rendered nowhere. It is deleted now, because a
 * deprecated map that nobody deletes is a map somebody eventually reads as
 * current, which is exactly what happened.
 *
 * What was still emoji is everything BELOW the nav: card headings, action
 * buttons, status callouts, and the little marks beside a city or a date. This
 * is their map. Same argument as nav-icons.tsx: emoji render differently on
 * every platform (monochrome on some Androids, tofu on old WebViews) and can
 * never be tinted, so a warning triangle could not be the warning colour.
 * Lucide strokes inherit `currentColor`, so an icon in a danger callout is
 * danger-coloured for free.
 *
 * THE RULE, and it is the interesting part:
 *
 *   An emoji that DECORATES rendered UI becomes an icon.
 *   An emoji that IS CONTENT stays an emoji.
 *
 * Content means text that leaves the app and lands somewhere React cannot
 * follow: a CSV cell, a printed claim form, a toast or push body, a WhatsApp
 * message, the public marketing pages. An <svg> in a CSV is a broken cell. So
 * `"⏳ no clock-out"` in the attendance export stays exactly as it is, and
 * tests/app-icons.mjs allowlists it by that reason rather than by line number.
 *
 * Names here say what the icon MEANS, not which lucide glyph it is, so a
 * caller reads `<AppIcon name="warning" />` and the choice of triangle-vs-
 * circle stays one edit in one file.
 */

import {
  BadgeCheck, Ban, Banknote, Cake, CalendarDays, ChartColumn, ClipboardList,
  Clapperboard, CreditCard, Database, DoorOpen, Download, Eye, FileText, Flame,
  Folder, Footprints, Gem, Hourglass, Lightbulb, Link2, Lock, MapPin, Paperclip,
  MessageCircle, Package, Palmtree, PartyPopper, Plug, Printer, Puzzle, Receipt,
  ReceiptText, Rocket, Scale, Send, ShieldCheck, ShoppingCart, Store, Tag,
  Plane, QrCode, Target, Timer, TrendingDown, TrendingUp, TriangleAlert, Trophy, Truck, Tv, Undo2,
  Upload, UserRound, Video, Wrench, Zap, CircleCheck, CircleX, Pencil, Search,
  type LucideIcon,
} from "lucide-react";
import type React from "react";

export const APP_ICON = {
  /* status */
  warning: TriangleAlert,
  success: CircleCheck,
  error: CircleX,
  pending: Hourglass,
  blocked: Ban,
  celebrate: PartyPopper,
  /* actions */
  edit: Pencil,
  search: Search,
  download: Download,
  upload: Upload,
  attach: Paperclip,
  print: Printer,
  verify: ShieldCheck,
  fix: Wrench,
  pay: CreditCard,
  paid: BadgeCheck,
  link: Link2,
  qr: QrCode,
  calendarAdd: CalendarDays,
  offboard: DoorOpen,
  preview: Eye,
  /* things */
  money: Banknote,
  receipt: ReceiptText,
  document: FileText,
  documents: Receipt,
  package: Package,
  service: Wrench,
  cart: ShoppingCart,
  shipped: Truck,
  transit: Plane,
  returned: Undo2,
  fulfilment: Send,
  inventory: Package,
  store: Store,
  clients: Gem,
  content: Clapperboard,
  video: Video,
  live: Tv,
  chat: MessageCircle,
  person: UserRound,
  place: MapPin,
  date: CalendarDays,
  time: Timer,
  cake: Cake,
  holiday: Palmtree,
  lock: Lock,
  access: ShieldCheck,
  connection: Plug,
  database: Database,
  folder: Folder,
  identification: Tag,
  purchase: ReceiptText,
  assignment: MapPin,
  walkIn: Footprints,
  orders: ClipboardList,
  /* figures */
  chart: ChartColumn,
  up: TrendingUp,
  down: TrendingDown,
  trophy: Trophy,
  hot: Flame,
  target: Target,
  idea: Lightbulb,
  boost: Rocket,
  fast: Zap,
  balance: Scale,
  puzzle: Puzzle,
} satisfies Record<string, LucideIcon>;

export type AppIconName = keyof typeof APP_ICON;

/**
 * One size, one weight, everywhere. `h-4 w-4` matches the 14px body text these
 * sit beside; `strokeWidth 1.75` matches nav-icons so the two never look like
 * two icon sets. Always `aria-hidden` — every one of these sits next to the
 * word it illustrates, so a screen reader announcing it would read the label
 * twice. Colour is inherited: put the icon inside the callout and it takes the
 * callout's colour.
 */
export function AppIcon({ name, className = "" }: { name: AppIconName; className?: string }) {
  const Glyph = APP_ICON[name];
  return <Glyph aria-hidden className={`inline-block h-4 w-4 shrink-0 ${className}`} strokeWidth={1.75} />;
}

/**
 * The card heading, with its icon. Renders exactly what a bare
 * `<p className="text-sm font-semibold">` renders when given no icon, so a
 * card can be converted to it without moving a pixel, and the 138 headings
 * that have no icon yet are not a different component.
 *
 * The icon is muted by default: a heading's job is the word. An icon at the
 * same weight as the text competes with it, which is how a page ends up
 * looking like a toolbar.
 */
export function PanelTitle({ icon, children, className = "", tone = "muted" }: {
  icon?: AppIconName;
  children: React.ReactNode;
  className?: string;
  /** "muted" (default) or "inherit" — inherit when the heading is already coloured. */
  tone?: "muted" | "inherit";
}) {
  return (
    <p className={`flex items-center gap-2 text-sm font-semibold ${className}`}>
      {icon ? <AppIcon name={icon} className={tone === "muted" ? "text-muted-foreground" : ""} /> : null}
      {children}
    </p>
  );
}

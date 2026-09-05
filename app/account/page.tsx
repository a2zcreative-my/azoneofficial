"use client";

/** Customer area (/account) — a customer's own details and enquiry history. */

import { TabIcon, LogOut } from "@/components/layout/nav-icons";
import Link from "next/link"; // v1.77.0 — an in-app route is a <Link>, not an <a> (build rule no-html-link-for-pages)
import { Skel, SkelText, SkelCard } from "@/components/ui/skeleton"; // v1.77.0: + Skel, SkelCard for the auth-check shell
import { api, csrfFetch } from "@/lib/api"; // v1.5.0: one shared helper (was a per-file copy)
import { useEffect, useState } from "react";
import { ChangePasswordForm } from "@/components/account/change-password-form";
import { useSaveToast } from "@/components/ui/save-toast";
import { card, inputClass, btnClass, btnGhost, btnHdr, chipSuccess, chipWarn, chipNeutral } from "@/lib/ui-styles";
import { AppShell } from "@/components/layout/app-shell";
import { SidebarNav } from "@/components/layout/sidebar-nav";
import { dmy, fmtRM } from "@/lib/format";
import { getLang, setLang as persistLang, type Lang } from "@/lib/i18n";


interface User { id: number; email: string; name: string; role: string; oauth?: boolean }
interface Enquiry { id: number; message: string; category?: string | null; status: string; reply?: string | null; replied_at?: string | null; created_at: string }
// v1.6.0: customer order tracking
interface OrderDoc { doc_number: string; doc_type: string; total_cents: number; payment_status?: string | null; delivery_status?: string | null; due_date?: string | null; paid_at?: string | null; share_token?: string | null; created_at: string }
interface LiveSession { session_date: string; start_time: string; end_time?: string | null; platform: string; status: string }
const DOC_LABEL: Record<string, string> = { QT: "Quotation", DO: "Delivery order", INV: "Invoice" };
/* v1.4.181: enquiry categories — mirror the server whitelist. */
const ENQUIRY_CATS = [
  ["general", "General question"],
  ["package_pricing", "Package & pricing"],
  ["live_commerce", "Live commerce services"],
  ["order_delivery", "Order & delivery"],
  ["collaboration", "Collaboration / work with us"],
] as const;
const CAT_LABEL = Object.fromEntries(ENQUIRY_CATS) as Record<string, string>;

/* BM labels for display only — the values sent to / received from the API
   ("QT", "paid", "new", "general"…) never change. */
const DOC_LABEL_MS: Record<string, string> = { QT: "Sebut harga", DO: "Pesanan penghantaran", INV: "Invois" };
const CAT_LABEL_MS: Record<string, string> = {
  general: "Soalan umum",
  package_pricing: "Pakej & harga",
  live_commerce: "Perkhidmatan live commerce",
  order_delivery: "Pesanan & penghantaran",
  collaboration: "Kerjasama / bekerja dengan kami",
};
/* Same BM status words the admin's enquiry board uses. */
const ENQ_STATUS_MS: Record<string, string> = { new: "baharu", contacted: "dihubungi", qualified: "layak", closed: "ditutup" };
const LIVE_STATUS_MS: Record<string, string> = { scheduled: "dijadualkan", completed: "selesai", cancelled: "dibatalkan" };





/** ISO "YYYY-MM-DD…" → "DD-MM-YYYY" (+ " HH:MM" when time is present). */

/* v1.77.0 — the client area's first paint while /auth/me answers (and while
   a redirect to /login, /admin or /portal is on its way). Pure presentational:
   the SAME shell (full-width canvas since v1.88.2, navy rail, header row, the Account
   tab's two-column card grid, bottom nav on phones), so nothing jumps when
   the real page takes over. No hooks, no fetch. */
function AccountPageSkeleton() {
  return (
    <AppShell
      rail={
        <div className="flex h-full flex-col items-center gap-1 py-3" aria-hidden>
          <div className="mb-2 h-8 w-8 shrink-0 rounded-lg bg-white/90" />
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="h-10 w-10 shrink-0 rounded-xl bg-white/10" />
          ))}
        </div>
      }
    >
    <div className="w-full px-4 py-4 pb-28 md:px-6 md:py-6 md:pb-8" aria-busy="true">
      <header className="border-border bg-background/95 sticky top-0 z-30 -mx-4 flex flex-wrap items-center justify-between gap-3 border-b px-4 pb-3 backdrop-blur md:static md:mx-0 md:border-0 md:bg-transparent md:px-0 md:pb-0 md:backdrop-blur-none [--hdr-pt:0.75rem] md:[--hdr-pt:0px]"
        style={{ paddingTop: "calc(var(--hdr-pt) + env(safe-area-inset-top, 0px))" }}>
        <div className="space-y-1.5">
          <Skel className="hidden h-3 w-64 md:block" />
          <Skel className="h-6 w-40" />
        </div>
        <div className="flex items-center gap-2">
          <Skel className="h-9 w-10 rounded-lg" />
          <Skel className="h-9 w-9 rounded-lg" />
        </div>
      </header>

      {/* bottom navigation (phones) — three real-sized slots */}
      <nav className="border-border bg-card fixed inset-x-0 bottom-0 z-40 flex border-t md:hidden" style={{ paddingBottom: "max(env(safe-area-inset-bottom, 0px), 6px)" }} aria-hidden>
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="flex min-h-16 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 py-2">
            <Skel className="h-9 w-9 rounded-xl" />
            <Skel className="h-2 w-12" />
          </div>
        ))}
      </nav>

      {/* the Account tab (the one everyone lands on): details card, then the
          full-width password card */}
      <div className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-2">
        <SkelCard lines={2} sub={false} />
        <div className={`${card} sm:col-span-2`}>
          <Skel className="h-4 w-36" />
          <Skel className="mt-2 h-3 w-72 max-w-full" />
          <div className="mt-3 space-y-2">
            <Skel className="h-9 w-full sm:max-w-72" />
            <Skel className="h-9 w-full sm:max-w-72" />
            <Skel className="h-9 w-32" />
          </div>
        </div>
      </div>
      <Skel className="mx-auto mt-6 mb-2 h-3 w-40" />
    </div>
    </AppShell>
  );
}

export default function AccountPage() {
  const [user, setUser] = useState<User | null>(null);
  const [checked, setChecked] = useState(false);
  /* v1.77.0: null = the thread has not arrived yet (skeleton), [] = arrived
     and empty (the "No enquiries yet" line). */
  const [enquiries, setEnquiries] = useState<Enquiry[] | null>(null);
  const [ask, setAsk] = useState("");
  const [askCat, setAskCat] = useState("general"); // v1.4.181
  const [tab, setTab] = useState<"Account" | "Orders" | "Enquiries">("Account");
  // v1.6.0: order tracking
  const [orders, setOrders] = useState<{ docs: OrderDoc[]; lives: LiveSession[] } | null>(null);
  const [ordersLocked, setOrdersLocked] = useState(false);
  /* v1.30.0 (CEO: "customer or client can have a option to click on their
     logo then will redirecting to their own domain"): the client's OWN mark
     and address, read from their customer record — not from any list in our
     code. Null for a client with neither on file, and the area then looks
     exactly as it did before. */
  const [brand, setBrand] = useState<{ company: string; website: string | null; logo_key: string | null } | null>(null);
  const [sending, setSending] = useState(false);
  const { show: showToast, node: toastNode } = useSaveToast();
  // EN/BM chrome language — same per-device store as the staff portal.
  const [lang, setLangState] = useState<Lang>("en");
  useEffect(() => { setLangState(getLang()); }, []);
  const L = (en: string, ms: string) => (lang === "ms" ? ms : en);

  useEffect(() => {
    void api<{ user: User }>("/auth/me").then((r) => {
      if (r.ok && r.data?.user) {
        // /account is the customer area only. A staff or admin account that
        // lands here is sent to its own interface — no role sees another
        // role's surface.
        if (r.data.user.role !== "customer") {
          const dest = ["editor", "marketing", "admin", "super_admin"].includes(r.data.user.role)
            ? "/admin"
            : "/portal";
          window.location.replace(dest);
          return;
        }
        setUser(r.data.user);
        void api<{ enquiries: Enquiry[] }>("/account/enquiries").then((e) =>
          setEnquiries(e.data?.enquiries ?? []),
        );
        void api<{ locked: boolean; docs: OrderDoc[]; lives: LiveSession[]; brand?: { company: string; website: string | null; logo_key: string | null } | null }>("/account/orders").then((o) => {
          if (o.data?.locked) setOrdersLocked(true);
          setOrders({ docs: o.data?.docs ?? [], lives: o.data?.lives ?? [] });
          setBrand(o.data?.brand ?? null);
        });
      } else {
        window.location.replace("/login");
        return;
      }
      setChecked(true);
    });
  }, []);

  /* v1.77.0 — skeleton until the first fetch lands. This used to return null
     (a blank screen with a name); the page-shaped shell paints instead, and
     stays up while any redirect in the effect above is on its way. */
  if (!checked || !user) return <AccountPageSkeleton />;

  /* v1.22.8 (CEO: "/admin and /account also I found doesnt follow UI/UX as
     /portal"): the customer area now sits on the SAME shell as the portal —
     navy backdrop, rounded canvas, internal scroll on desktop. Phones are
     untouched (all shell rules are md:-prefixed).
     v1.23.0 (CEO: "Where is the sidebar?"): the navy icon rail too — the
     same SidebarNav, fed the three customer sections. The desktop pill row
     is retired; phones keep the bottom navigation. */
  return (
    <AppShell
      rail={
        <SidebarNav
          items={(["Account", "Orders", "Enquiries"] as const).map((t) => ({ name: t, label: t === "Enquiries" ? L("My Enquiries", "Pertanyaan Saya") : t === "Orders" ? L("Orders", "Pesanan") : L("Account", "Akaun") }))}
          active={tab}
          onSelect={(t) => setTab(t as "Account" | "Orders" | "Enquiries")}
          onSignOut={() =>
            void api("/auth/logout", { method: "POST", body: JSON.stringify({}) }).then(
              () => window.location.replace("/"),
            )
          }
        />
      }
    >
    <div className="w-full px-4 py-4 pb-28 md:px-6 md:py-6 md:pb-8">
      {toastNode}
      {/* v1.11.0: -mx-4/px-4 matches the wrapper's mobile padding — with -mx-5
          the sticky header overhung the viewport by 4px each side. */}
      <header className="border-border bg-background/95 sticky top-0 z-30 -mx-4 flex flex-wrap items-center justify-between gap-3 border-b px-4 pb-3 backdrop-blur md:static md:mx-0 md:border-0 md:bg-transparent md:px-0 md:pb-0 md:backdrop-blur-none [--hdr-pt:0.75rem] md:[--hdr-pt:0px]"
        style={{ paddingTop: "calc(var(--hdr-pt) + env(safe-area-inset-top, 0px))" }}>
        <div>
          {/* v1.27.0: the customer area never named the company anywhere.
              It is A2Z CREATIVE MARKETING's client portal — say so. */}
          <p className="text-gold-deep hidden text-xs font-medium tracking-[0.3em] uppercase md:block">
            {L("A2Z CREATIVE MARKETING / Client Portal", "A2Z CREATIVE MARKETING / Portal Klien")}
          </p>
          <h1 className="hidden text-xl font-semibold tracking-tight md:block">
            {L("Welcome", "Selamat datang")}, {user.name.split(" ")[0]}
          </h1>
          {/* v1.11.0: app screen title weight/size, matching /portal. */}
          <h1 className="text-xl font-bold tracking-tight md:hidden">
            {tab === "Enquiries" ? L("My Enquiries", "Pertanyaan Saya") : tab === "Orders" ? L("My Orders", "Pesanan Saya") : L("My Account", "Akaun Saya")}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          {/* EN/BM toggle — same control as the portal header (btnHdr, not
              btnHdrDesktop: customers have no mobile Preferences sheet, so
              the switch must stay visible on phones). */}
          <button type="button" className={`${btnHdr} text-xs font-semibold`} title={lang === "ms" ? "Bahasa: BM — tukar ke English" : "Language: EN — switch to Bahasa Melayu"}
            aria-label="Toggle language" onClick={() => { const next = lang === "ms" ? "en" : "ms"; setLangState(next); persistLang(next); }}>
            {lang === "ms" ? "BM" : "EN"}
          </button>
          {/* v1.16.0 (CEO): icon-only sign out — minimal width. */}
          <button
            type="button"
            className={`${btnGhost} px-2.5`}
            title={L("Sign out", "Log keluar")}
            aria-label={L("Sign out", "Log keluar")}
            onClick={() =>
              void api("/auth/logout", { method: "POST", body: JSON.stringify({}) }).then(
                () => window.location.replace("/"),
              )
            }
          >
            <LogOut aria-hidden className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </div>
      </header>

      {/* v1.23.0: the desktop pill row is retired — the icon rail (left,
          same as /portal) is the desktop navigation now. */}

      {/* App-style bottom navigation (v1.4.55) — phones only.
          v1.11.0: same shell as /portal and /admin — icon per tab, the active
          one in a filled navy rounded square with the label beneath. */}
      <nav
        className="border-border bg-card fixed inset-x-0 bottom-0 z-40 flex border-t md:hidden"
        /* v1.25.4 (CEO: "Why bottom nav like this?!!!" — labels sliced along
           their bottom edge on iPhone): iOS Safari reports this inset as 0 while
           its floating toolbar is shown, which removed ALL breathing room under
           the labels. max() guarantees a floor either way. */
        style={{ paddingBottom: "max(env(safe-area-inset-bottom, 0px), 6px)" }}
        aria-label={L("Account sections (mobile)", "Bahagian akaun (mudah alih)")}
      >
        {/* v1.16.0: emoji tuples -> the shared SVG icon map. */}
        {(["Account", "Orders", "Enquiries"] as const).map((t) => {
          const active = tab === t;
          return (
            <button
              key={t}
              type="button"
              onClick={() => { setTab(t); window.scrollTo({ top: 0 }); }}
              aria-current={active ? "page" : undefined}
              className="flex min-h-16 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-medium"
            >
              <span
                aria-hidden
                className={`grid h-9 w-9 place-items-center rounded-xl text-base transition-colors ${
                  active ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground"
                }`}
              >
                <TabIcon name={t} />
              </span>
              <span className={`w-full truncate px-0.5 text-center leading-[1.6] ${active ? "text-primary font-semibold" : "text-muted-foreground"}`}>{t === "Enquiries" ? L("Enquiries", "Pertanyaan") : t === "Orders" ? L("Orders", "Pesanan") : L("Account", "Akaun")}</span>
            </button>
          );
        })}
      </nav>

      {tab === "Account" && (
      <div key="acct" className="screen-enter mt-6 grid grid-cols-1 gap-6 sm:grid-cols-2">
        <div className={card}>
          <p className="text-sm font-semibold">{L("My details", "Maklumat saya")}</p>
          <p className="text-muted-foreground mt-2 text-sm">{user.name}</p>
          <p className="text-muted-foreground text-sm">{user.email}</p>
        </div>
        <div className={`${card} sm:col-span-2`}>
          {/* v1.4.181 (CEO: "they can change their password? … does it
              require to change the password?"): Google sign-ins have NO
              password on this account — nothing to change, so no form.
              Their sign-in security lives in their Google Account. */}
          {user.oauth ? (
            <>
              <p className="text-sm font-semibold">{L("Password", "Kata laluan")}</p>
              <p className="text-muted-foreground mt-1 text-sm">
                {L(
                  "You sign in with Google, so this account has no password — there is nothing to change here. Your sign-in security (password, 2-step verification) is managed in your Google Account.",
                  "Anda log masuk dengan Google, jadi akaun ini tiada kata laluan — tiada apa yang perlu ditukar di sini. Keselamatan log masuk anda (kata laluan, pengesahan 2 langkah) diuruskan dalam Akaun Google anda.",
                )}
              </p>
            </>
          ) : (
            <>
              <p className="text-sm font-semibold">{L("Change password", "Tukar kata laluan")}</p>
              <p className="text-muted-foreground mt-1 mb-3 text-xs">
                {L(
                  "Changing your password signs you out on every other device.",
                  "Menukar kata laluan anda akan melog keluar anda di semua peranti lain.",
                )}
              </p>
              <ChangePasswordForm />
            </>
          )}
        </div>
        {/* v1.27.0: the "ELFIA drops" card was removed. ELFIA is an
            independent client brand, not an A2Z product, and this card
            advertised one client's storefront to every signed-in customer —
            including that client's competitors.
            v1.30.0 brings a brand card back, but inverted and safe: it shows
            THIS client their OWN mark, read from their own customer record,
            and links to THEIR domain. Nobody ever sees another client's
            brand, which is exactly what went wrong the first time. */}
        {brand && (
          <div className={card}>
            <p className="text-muted-foreground text-[11px] font-semibold tracking-wider uppercase">
              {L("Your brand", "Jenama anda")}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              {brand.logo_key && (
                brand.website ? (
                  <a href={brand.website} target="_blank" rel="noopener noreferrer"
                    className="border-border rounded-lg border bg-white p-1.5 transition-colors hover:border-gold">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/v1/media/file/${encodeURIComponent(brand.logo_key)}`} alt={brand.company} className="h-10 w-auto" />
                  </a>
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`/api/v1/media/file/${encodeURIComponent(brand.logo_key)}`} alt={brand.company}
                    className="border-border h-10 w-auto rounded-lg border bg-white p-1.5" />
                )
              )}
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{brand.company}</p>
                {brand.website && (
                  <a href={brand.website} target="_blank" rel="noopener noreferrer"
                    className="text-gold-deep truncate text-xs underline underline-offset-2">
                    {brand.website.replace(/^https?:\/\//, "")}
                  </a>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      )}

      {tab === "Orders" && (
      <div key="orders" className="screen-enter mt-4 space-y-4 md:mt-6">
        {ordersLocked ? (
          <div className={card}>
            <p className="text-sm font-semibold">{L("🔒 Verify your email to see your orders", "🔒 Sahkan e-mel anda untuk melihat pesanan anda")}</p>
            <p className="text-muted-foreground mt-1 text-sm">
              {L(
                "To protect your order and invoice details, order history is shown only to accounts with a verified email. Sign in with Google using the email we have on file, or message us on WhatsApp and we'll share your latest documents.",
                "Untuk melindungi butiran pesanan dan invois anda, sejarah pesanan hanya dipaparkan kepada akaun dengan e-mel yang disahkan. Log masuk dengan Google menggunakan e-mel dalam rekod kami, atau hubungi kami di WhatsApp dan kami akan kongsikan dokumen terkini anda.",
              )}
            </p>
            <a
              href="https://wa.me/60123834821?text=Hi%20AZ%20ONE%20OFFICIAL%2C%20I%20would%20like%20to%20check%20my%20orders."
              target="_blank" rel="noopener noreferrer" className={`${btnClass} mt-3`}
            >
              {L("Ask on WhatsApp", "Tanya di WhatsApp")}
            </a>
          </div>
        ) : (
          <>
            <div className={card}>
              <p className="text-sm font-semibold">{L("🧾 My orders & invoices", "🧾 Pesanan & invois saya")}</p>
              <p className="text-muted-foreground mt-0.5 text-xs">
                {L(
                  "Your quotations, invoices and delivery orders. Tap an invoice to open its PDF.",
                  "Sebut harga, invois dan pesanan penghantaran anda. Ketik invois untuk membuka PDF-nya.",
                )}
              </p>
              {!orders ? (
                <SkelText lines={3} className="mt-3" />
              ) : orders.docs.length === 0 ? (
                <p className="text-muted-foreground mt-3 text-sm">{L("No documents yet. When we prepare a quotation or invoice for you, it appears here.", "Belum ada dokumen. Apabila kami menyediakan sebut harga atau invois untuk anda, ia akan terpapar di sini.")}</p>
              ) : (
                <div className="mt-3 space-y-2">
                  {orders.docs.map((d) => {
                    const paid = (d.payment_status ?? "").toLowerCase() === "paid";
                    const chip = d.doc_type === "INV"
                      ? (paid ? chipSuccess : chipWarn)
                      : chipNeutral;
                    const status = d.doc_type === "INV"
                      ? (paid ? L("Paid", "Dibayar") : L("Unpaid", "Belum dibayar"))
                      : d.doc_type === "DO"
                        ? (d.delivery_status ? d.delivery_status : L("Pending", "Menunggu"))
                        : L("Quotation", "Sebut harga");
                    const inner = (
                      <div className="flex items-center justify-between gap-2">
                        <span className="min-w-0">
                          <span className="font-medium">{(lang === "ms" ? DOC_LABEL_MS : DOC_LABEL)[d.doc_type] ?? d.doc_type}</span>
                          <span className="text-muted-foreground ml-1.5 text-xs">{d.doc_number}</span>
                        </span>
                        <span className="flex shrink-0 items-center gap-2">
                          <span className="tabular-nums font-semibold">{fmtRM(d.total_cents)}</span>
                          <span className={chip}>{status}</span>
                        </span>
                      </div>
                    );
                    return (
                      <div key={d.doc_number} className="border-border rounded-lg border p-3">
                        {d.share_token ? (
                          <a href={`/doc?t=${d.share_token}`} target="_blank" rel="noopener noreferrer" className="block hover:opacity-80">
                            {inner}
                          </a>
                        ) : inner}
                        <p className="text-muted-foreground mt-1 text-[11px]">
                          {dmy(d.created_at)}
                          {d.doc_type === "INV" && !paid && d.due_date ? L(` · due ${dmy(d.due_date)}`, ` · perlu dibayar ${dmy(d.due_date)}`) : ""}
                          {d.doc_type === "INV" && paid && d.paid_at ? L(` · paid ${dmy(d.paid_at)}`, ` · dibayar ${dmy(d.paid_at)}`) : ""}
                          {d.share_token ? L(" · tap to open PDF", " · ketik untuk buka PDF") : ""}
                        </p>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {orders && orders.lives.length > 0 && (
              <div className={card}>
                <p className="text-sm font-semibold">{L("📺 My live sessions", "📺 Sesi langsung saya")}</p>
                <div className="mt-2 space-y-1.5">
                  {orders.lives.map((l, i) => (
                    <div key={i} className="border-border flex items-center justify-between gap-2 border-b py-2 text-sm last:border-0">
                      <span>
                        {dmy(l.session_date)} · {l.start_time}{l.end_time ? `–${l.end_time}` : ""}
                        <span className="text-muted-foreground ml-1.5 text-xs capitalize">{l.platform}</span>
                      </span>
                      <span className={l.status === "completed" ? chipSuccess : l.status === "cancelled" ? chipNeutral : chipWarn}>{lang === "ms" ? LIVE_STATUS_MS[l.status] ?? l.status : l.status}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
      )}

      {tab === "Enquiries" && (
      <>
      {/* v1.4.181 (CEO): a DIRECT line to staff — WhatsApp for instant
          contact, categorized enquiries that bell-notify the team the
          moment they land. */}
      <div className={`${card} mt-4 md:mt-6`}>
        <p className="text-sm font-semibold">{L("💬 WhatsApp us — fastest reply", "💬 WhatsApp kami — balasan terpantas")}</p>
        <p className="text-muted-foreground mt-0.5 text-xs">
          {L(
            "Package questions, live commerce services, orders — talk to the A2Z CREATIVE MARKETING team directly on WhatsApp.",
            "Soalan pakej, perkhidmatan live commerce, pesanan — hubungi pasukan A2Z CREATIVE MARKETING terus di WhatsApp.",
          )}
        </p>
        <a
          href="https://wa.me/60123834821?text=Hi%20A2Z%20CREATIVE%20MARKETING%2C%20I%20would%20like%20to%20ask%20about%20your%20services."
          target="_blank" rel="noopener noreferrer"
          className={`${btnClass} mt-3`}
        >
          {L("Chat on WhatsApp (+60 12-383 4821)", "Sembang di WhatsApp (+60 12-383 4821)")}
        </a>
      </div>

      <div className={`${card} mt-4 md:mt-6`}>
        <p className="text-sm font-semibold">{L("Ask A2Z CREATIVE MARKETING", "Tanya A2Z CREATIVE MARKETING")}</p>
        <p className="text-muted-foreground mt-0.5 text-xs">
          {L(
            "Send a question to our team — it reaches staff with your name and email attached, notifies them instantly, and your thread shows below.",
            "Hantar soalan kepada pasukan kami — ia sampai kepada kakitangan bersama nama dan e-mel anda, memberitahu mereka serta-merta, dan perbualan anda dipaparkan di bawah.",
          )}
        </p>
        <label className="mt-3 block sm:max-w-72">
          <span className="text-muted-foreground mb-0.5 block text-[11px]">{L("What is this about?", "Tentang apakah pertanyaan ini?")}</span>
          <select className={inputClass} value={askCat} onChange={(e) => setAskCat(e.target.value)}>
            {ENQUIRY_CATS.map(([v, l]) => <option key={v} value={v}>{lang === "ms" ? CAT_LABEL_MS[v] ?? l : l}</option>)}
          </select>
        </label>
        <textarea
          className={`${inputClass} mt-2`}
          rows={3}
          placeholder={L("What would you like to ask?", "Apakah yang ingin anda tanyakan?")}
          value={ask}
          onChange={(e) => setAsk(e.target.value)}
        />
        <button
          type="button"
          className={`${btnClass} mt-2`}
          disabled={!ask.trim() || sending}
          onClick={async () => {
            setSending(true);
            const r = await csrfFetch("/api/v1/account/enquiries", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ message: ask, category: askCat }),
            });
            setSending(false);
            if (r.ok) {
              setAsk("");
              showToast(L("Sent", "Dihantar"), L("Enquiry received — we will get back to you", "Pertanyaan diterima — kami akan menghubungi anda semula")); // v1.4.101: same save popup family as the portal
              void api<{ enquiries: Enquiry[] }>("/account/enquiries").then((e) =>
                setEnquiries(e.data?.enquiries ?? []),
              );
            }
          }}
        >
          {sending ? L("Sending…", "Menghantar…") : L("Send enquiry", "Hantar pertanyaan")}
        </button>
      </div>

      <div className={`${card} mt-4 md:mt-6`}>
        <p className="text-sm font-semibold">{L("My enquiries", "Pertanyaan saya")}</p>
        {/* v1.77.0 — skeleton until the first fetch lands: message line,
            then the status line, bordered like the real thread rows. */}
        {enquiries === null ? (
          <div aria-busy="true">
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} className="border-border border-b py-2 last:border-0">
                <Skel className="h-4 w-3/4" />
                <Skel className="mt-1.5 h-3 w-1/3" />
              </div>
            ))}
          </div>
        ) : enquiries.length === 0 ? (
          <p className="text-muted-foreground mt-2 text-sm">
            {L("No enquiries yet — send your first question above.", "Belum ada pertanyaan — hantar soalan pertama anda di atas.")}
          </p>
        ) : (
          enquiries.map((e) => (
            <div key={e.id} className="border-border border-b py-2 text-sm last:border-0">
              <p>{e.message}</p>
              {/* v1.4.191: the team's reply, right here in the thread */}
              {e.reply && (
                <p className="mt-1.5 rounded border border-green-300 bg-green-100 px-2.5 py-1.5 text-sm text-green-900">
                  <span className="font-semibold">{L("A2Z CREATIVE MARKETING replied", "A2Z CREATIVE MARKETING membalas")}{e.replied_at ? ` (${dmy(e.replied_at)})` : ""}:</span> {e.reply}
                </p>
              )}
              <p className="text-muted-foreground mt-1 text-xs">
                {e.category ? <span className="bg-secondary mr-1.5 rounded-full px-2 py-0.5 text-[10px]">{(lang === "ms" ? CAT_LABEL_MS : CAT_LABEL)[e.category] ?? e.category}</span> : null}
                Status: {lang === "ms" ? ENQ_STATUS_MS[e.status] ?? e.status : e.status} · {dmy(e.created_at)}
              </p>
            </div>
          ))
        )}
      </div>
      </>
      )}
      {/* v1.4.191: PDPA notice one tap away for customers */}
      <p className="text-muted-foreground mt-6 pb-2 text-center text-xs">
        <Link className="underline" href="/privacy">{L("Privacy Notice (PDPA)", "Notis Privasi (PDPA)")}</Link>
      </p>
    </div>
    </AppShell>
  );
}

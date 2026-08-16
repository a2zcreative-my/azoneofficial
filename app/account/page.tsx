"use client";

/** Customer area (/account) — a customer's own details and enquiry history. */

import { TabIcon, LogOut } from "@/components/layout/nav-icons";
import { api } from "@/lib/api"; // v1.5.0: one shared helper (was a per-file copy)
import { useEffect, useState } from "react";
import { ChangePasswordForm } from "@/components/account/change-password-form";
import { useSaveToast } from "@/components/ui/save-toast";
import { card, inputClass, btnClass, btnGhost, chipSuccess, chipWarn, chipNeutral } from "@/lib/ui-styles";
import { AppShell } from "@/components/layout/app-shell";
import { SidebarNav } from "@/components/layout/sidebar-nav";
import { dmy, fmtRM } from "@/lib/format";


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





/** ISO "YYYY-MM-DD…" → "DD-MM-YYYY" (+ " HH:MM" when time is present). */

export default function AccountPage() {
  const [user, setUser] = useState<User | null>(null);
  const [checked, setChecked] = useState(false);
  const [enquiries, setEnquiries] = useState<Enquiry[]>([]);
  const [ask, setAsk] = useState("");
  const [askCat, setAskCat] = useState("general"); // v1.4.181
  const [tab, setTab] = useState<"Account" | "Orders" | "Enquiries">("Account");
  // v1.6.0: order tracking
  const [orders, setOrders] = useState<{ docs: OrderDoc[]; lives: LiveSession[] } | null>(null);
  const [ordersLocked, setOrdersLocked] = useState(false);
  const [sending, setSending] = useState(false);
  const { show: showToast, node: toastNode } = useSaveToast();

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
        void api<{ locked: boolean; docs: OrderDoc[]; lives: LiveSession[] }>("/account/orders").then((o) => {
          if (o.data?.locked) setOrdersLocked(true);
          setOrders({ docs: o.data?.docs ?? [], lives: o.data?.lives ?? [] });
        });
      } else {
        window.location.replace("/login");
        return;
      }
      setChecked(true);
    });
  }, []);

  if (!checked || !user) return null;

  /* v1.22.8 (CEO: "/admin and /account also I found doesnt follow UI/UX as
     /portal"): the customer area now sits on the SAME shell as the portal —
     navy backdrop, rounded canvas, internal scroll on desktop. Phones are
     untouched (all shell rules are md:-prefixed).
     v1.23.0 (CEO: "Where is the sidebar?"): the navy icon rail too — the
     same SidebarNav, fed the three customer sections. The desktop pill row
     is retired; phones keep the bottom navigation. */
  return (
    <AppShell
      maxWidth="md:max-w-4xl"
      rail={
        <SidebarNav
          items={(["Account", "Orders", "Enquiries"] as const).map((t) => ({ name: t, label: t === "Enquiries" ? "My Enquiries" : t }))}
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
    <div className="mx-auto w-full max-w-4xl px-4 py-4 pb-28 md:px-6 md:py-6 md:pb-8">
      {toastNode}
      {/* v1.11.0: -mx-4/px-4 matches the wrapper's mobile padding — with -mx-5
          the sticky header overhung the viewport by 4px each side. */}
      <header className="border-border bg-background/95 sticky top-0 z-30 -mx-4 flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3 backdrop-blur md:static md:mx-0 md:border-0 md:bg-transparent md:px-0 md:py-0 md:backdrop-blur-none">
        <div>
          <p className="text-gold-deep hidden text-xs font-medium tracking-[0.3em] uppercase md:block">
            My account
          </p>
          <h1 className="hidden text-xl font-semibold tracking-tight md:block">
            Welcome, {user.name.split(" ")[0]}
          </h1>
          {/* v1.11.0: app screen title weight/size, matching /portal. */}
          <h1 className="text-xl font-bold tracking-tight md:hidden">
            {tab === "Enquiries" ? "My Enquiries" : tab === "Orders" ? "My Orders" : "My Account"}
          </h1>
        </div>
        {/* v1.16.0 (CEO): icon-only sign out — minimal width. */}
        <button
          type="button"
          className={`${btnGhost} px-2.5`}
          title="Sign out"
          aria-label="Sign out"
          onClick={() =>
            void api("/auth/logout", { method: "POST", body: JSON.stringify({}) }).then(
              () => window.location.replace("/"),
            )
          }
        >
          <LogOut aria-hidden className="h-4 w-4" strokeWidth={1.75} />
        </button>
      </header>

      {/* v1.23.0: the desktop pill row is retired — the icon rail (left,
          same as /portal) is the desktop navigation now. */}

      {/* App-style bottom navigation (v1.4.55) — phones only.
          v1.11.0: same shell as /portal and /admin — icon per tab, the active
          one in a filled navy rounded square with the label beneath. */}
      <nav
        className="border-border bg-card fixed inset-x-0 bottom-0 z-40 flex border-t md:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        aria-label="Account sections (mobile)"
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
              <span className={`w-full truncate px-0.5 text-center ${active ? "text-primary font-semibold" : "text-muted-foreground"}`}>{t}</span>
            </button>
          );
        })}
      </nav>

      {tab === "Account" && (
      <div key="acct" className="screen-enter mt-6 grid gap-6 sm:grid-cols-2">
        <div className={card}>
          <p className="text-sm font-semibold">My details</p>
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
              <p className="text-sm font-semibold">Password</p>
              <p className="text-muted-foreground mt-1 text-sm">
                You sign in with Google, so this account has no password —
                there is nothing to change here. Your sign-in security
                (password, 2-step verification) is managed in your Google
                Account.
              </p>
            </>
          ) : (
            <>
              <p className="text-sm font-semibold">Change password</p>
              <p className="text-muted-foreground mt-1 mb-3 text-xs">
                Changing your password signs you out on every other device.
              </p>
              <ChangePasswordForm />
            </>
          )}
        </div>
        <div className={card}>
          <p className="text-sm font-semibold">ELFIA drops</p>
          <p className="text-muted-foreground mt-2 text-sm">
            Our featured client launches new pieces on TikTok Live — shop
            through ELFIA&apos;s own store.
          </p>
          <a
            href="https://elfiaofficialstore.com"
            target="_blank"
            rel="noopener noreferrer"
            className={`${btnGhost} mt-3`}
          >
            Visit elfiaofficialstore.com
          </a>
        </div>
      </div>

      )}

      {tab === "Orders" && (
      <div key="orders" className="screen-enter mt-4 space-y-4 md:mt-6">
        {ordersLocked ? (
          <div className={card}>
            <p className="text-sm font-semibold">🔒 Verify your email to see your orders</p>
            <p className="text-muted-foreground mt-1 text-sm">
              To protect your order and invoice details, order history is shown
              only to accounts with a verified email. Sign in with Google using
              the email we have on file, or message us on WhatsApp and we&apos;ll
              share your latest documents.
            </p>
            <a
              href="https://wa.me/60123834821?text=Hi%20AZ%20ONE%20OFFICIAL%2C%20I%20would%20like%20to%20check%20my%20orders."
              target="_blank" rel="noopener noreferrer" className={`${btnClass} mt-3`}
            >
              Ask on WhatsApp
            </a>
          </div>
        ) : (
          <>
            <div className={card}>
              <p className="text-sm font-semibold">🧾 My orders &amp; invoices</p>
              <p className="text-muted-foreground mt-0.5 text-xs">
                Your quotations, invoices and delivery orders. Tap an invoice to open its PDF.
              </p>
              {!orders ? (
                <p className="text-muted-foreground mt-3 text-sm">Loading…</p>
              ) : orders.docs.length === 0 ? (
                <p className="text-muted-foreground mt-3 text-sm">No documents yet. When we prepare a quotation or invoice for you, it appears here.</p>
              ) : (
                <div className="mt-3 space-y-2">
                  {orders.docs.map((d) => {
                    const paid = (d.payment_status ?? "").toLowerCase() === "paid";
                    const chip = d.doc_type === "INV"
                      ? (paid ? chipSuccess : chipWarn)
                      : chipNeutral;
                    const status = d.doc_type === "INV"
                      ? (paid ? "Paid" : "Unpaid")
                      : d.doc_type === "DO"
                        ? (d.delivery_status ? d.delivery_status : "Pending")
                        : "Quotation";
                    const inner = (
                      <div className="flex items-center justify-between gap-2">
                        <span className="min-w-0">
                          <span className="font-medium">{DOC_LABEL[d.doc_type] ?? d.doc_type}</span>
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
                          {d.doc_type === "INV" && !paid && d.due_date ? ` · due ${dmy(d.due_date)}` : ""}
                          {d.doc_type === "INV" && paid && d.paid_at ? ` · paid ${dmy(d.paid_at)}` : ""}
                          {d.share_token ? " · tap to open PDF" : ""}
                        </p>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {orders && orders.lives.length > 0 && (
              <div className={card}>
                <p className="text-sm font-semibold">📺 My live sessions</p>
                <div className="mt-2 space-y-1.5">
                  {orders.lives.map((l, i) => (
                    <div key={i} className="border-border flex items-center justify-between gap-2 border-b py-2 text-sm last:border-0">
                      <span>
                        {dmy(l.session_date)} · {l.start_time}{l.end_time ? `–${l.end_time}` : ""}
                        <span className="text-muted-foreground ml-1.5 text-xs capitalize">{l.platform}</span>
                      </span>
                      <span className={l.status === "completed" ? chipSuccess : l.status === "cancelled" ? chipNeutral : chipWarn}>{l.status}</span>
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
        <p className="text-sm font-semibold">💬 WhatsApp us — fastest reply</p>
        <p className="text-muted-foreground mt-0.5 text-xs">
          Package questions, live commerce services, orders — talk to the AZ
          ONE OFFICIAL team directly on WhatsApp.
        </p>
        <a
          href="https://wa.me/60123834821?text=Hi%20AZ%20ONE%20OFFICIAL%2C%20I%20would%20like%20to%20ask%20about%20your%20services."
          target="_blank" rel="noopener noreferrer"
          className={`${btnClass} mt-3`}
        >
          Chat on WhatsApp (+60 12-383 4821)
        </a>
      </div>

      <div className={`${card} mt-4 md:mt-6`}>
        <p className="text-sm font-semibold">Ask AZ ONE OFFICIAL</p>
        <p className="text-muted-foreground mt-0.5 text-xs">
          Send a question to our team — it reaches staff with your name and
          email attached, notifies them instantly, and your thread shows below.
        </p>
        <label className="mt-3 block sm:max-w-72">
          <span className="text-muted-foreground mb-0.5 block text-[11px]">What is this about?</span>
          <select className={inputClass} value={askCat} onChange={(e) => setAskCat(e.target.value)}>
            {ENQUIRY_CATS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <textarea
          className={`${inputClass} mt-2`}
          rows={3}
          placeholder="What would you like to ask?"
          value={ask}
          onChange={(e) => setAsk(e.target.value)}
        />
        <button
          type="button"
          className={`${btnClass} mt-2`}
          disabled={!ask.trim() || sending}
          onClick={async () => {
            setSending(true);
            const r = await fetch("/api/v1/account/enquiries", {
              method: "POST",
              credentials: "include",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ message: ask, category: askCat }),
            });
            setSending(false);
            if (r.ok) {
              setAsk("");
              showToast("Sent", "Enquiry received — we will get back to you"); // v1.4.101: same save popup family as the portal
              void api<{ enquiries: Enquiry[] }>("/account/enquiries").then((e) =>
                setEnquiries(e.data?.enquiries ?? []),
              );
            }
          }}
        >
          {sending ? "Sending…" : "Send enquiry"}
        </button>
      </div>

      <div className={`${card} mt-4 md:mt-6`}>
        <p className="text-sm font-semibold">My enquiries</p>
        {enquiries.length === 0 ? (
          <p className="text-muted-foreground mt-2 text-sm">
            No enquiries yet — send your first question above.
          </p>
        ) : (
          enquiries.map((e) => (
            <div key={e.id} className="border-border border-b py-2 text-sm last:border-0">
              <p>{e.message}</p>
              {/* v1.4.191: the team's reply, right here in the thread */}
              {e.reply && (
                <p className="mt-1.5 rounded border border-green-300 bg-green-100 px-2.5 py-1.5 text-sm text-green-900">
                  <span className="font-semibold">AZ ONE OFFICIAL replied{e.replied_at ? ` (${dmy(e.replied_at)})` : ""}:</span> {e.reply}
                </p>
              )}
              <p className="text-muted-foreground mt-1 text-xs">
                {e.category ? <span className="bg-secondary mr-1.5 rounded-full px-2 py-0.5 text-[10px]">{CAT_LABEL[e.category] ?? e.category}</span> : null}
                Status: {e.status} · {dmy(e.created_at)}
              </p>
            </div>
          ))
        )}
      </div>
      </>
      )}
      {/* v1.4.191: PDPA notice one tap away for customers */}
      <p className="text-muted-foreground mt-6 pb-2 text-center text-xs">
        <a className="underline" href="/privacy">Privacy Notice (PDPA)</a>
      </p>
    </div>
    </AppShell>
  );
}

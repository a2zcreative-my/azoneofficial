"use client";

/** Customer area (/account) — a customer's own details and enquiry history. */

import Link from "next/link"; // v1.77.0 — an in-app route is a <Link>, not an <a> (build rule no-html-link-for-pages)
import { SkelRows } from "@/components/ui/skeleton"; // v1.77.0
import { api, csrfFetch } from "@/lib/api"; // v1.5.0: one shared helper (was a per-file copy)
import { useEffect, useState } from "react";
import { ChangePasswordForm } from "@/components/account/change-password-form";
import { GoogleConnectPanel } from "@/components/security/google-connect-panel"; // v1.266.0 - Connect / disconnect Google
import { useSaveToast } from "@/components/ui/save-toast";
import { btnClass, btnSm, chipSmInfo, chipSmNeutral, chipSmSuccess, chipSmWarn, fieldLabel, selectClass, textareaClass } from "@/lib/ui-styles";
import { TabPage, TabZone } from "@/components/portal/tab-concept"; // v1.343.0 - the portal's page concept
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile"; // v1.343.0 - the one KPI strip
import { SplitColumn, SplitPane, WorkspaceSplit } from "@/components/ui/workspace-split"; // v1.343.0
import { CompactTaskTable, type TableCol } from "@/components/portal/task-table"; // v1.343.0 - the portal's register
import css from "./account.module.css";
import { PortalSkeleton } from "@/components/portal/portal-skeleton"; // v1.228.0
import { ConsoleShell } from "@/components/layout/console-shell"; // v1.228.0 - the portal chrome
import { dmy, fmtRM } from "@/lib/format";
import { getLang, type Lang } from "@/lib/i18n";
import { AppIcon } from "@/components/ui/app-icon";


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
  /* v1.228.0 - the portal's own first paint: the same rail, header and bar
     the console shell draws, so nothing jumps when the page takes over */
  return <PortalSkeleton />;
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
  const [todayIso] = useState(() => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10)); // v1.343.0 - today in MYT, for "next live session"
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

  /* v1.22.8 / v1.23.0 / v1.228.0 - the client area sits on the portal's own
     chrome (ConsoleShell: the grouped rail, the .erp-topbar header, the phone
     bar and the More sheet).
     v1.343.0 (the CEO, 17-11-2026: "for customer account, make it
     standardize as my /portal interface UI/UX!") - and now its PAGES are the
     portal's too: each section is a TabPage of captioned zones, opened by ONE
     connected KPI strip (KpiRow) whose figures come only from the two reads
     this page already makes (/account/orders, /account/enquiries); the work
     sits in titled panes (WorkspaceSplit / SplitPane); the records are the
     portal's register (CompactTaskTable). Nothing new is fetched or sent, no
     rule changed, and the hand-written utility classes are gone (a CSS Module
     beside the page instead). */
  const ACCOUNT_TABS = ["Account", "Orders", "Enquiries"] as const;
  type AccountTab = (typeof ACCOUNT_TABS)[number];
  const tabName = (t: AccountTab) => t === "Enquiries" ? L("My Enquiries", "Pertanyaan Saya") : t === "Orders" ? L("My Orders", "Pesanan Saya") : L("My Account", "Akaun Saya");

  /* ---- figures, from what is already on the page ---- */
  const docs = orders?.docs ?? [];
  const invoices = docs.filter((d) => d.doc_type === "INV");
  const isPaid = (d: OrderDoc) => (d.payment_status ?? "").toLowerCase() === "paid";
  const unpaid = invoices.filter((d) => !isPaid(d));
  const unpaidCents = unpaid.reduce((a, d) => a + (d.total_cents || 0), 0);
  const nextLive = (orders?.lives ?? []).filter((l) => l.status === "scheduled" && l.session_date >= todayIso).sort((a, b) => (a.session_date + a.start_time).localeCompare(b.session_date + b.start_time))[0] ?? null;
  const enq = enquiries ?? [];
  const awaiting = enq.filter((e) => !e.reply && e.status !== "closed").length;
  const replied = enq.filter((e) => !!e.reply).length;
  const ordersBusy = orders === null;
  const enqBusy = enquiries === null;

  const docLabel = (t: string) => (lang === "ms" ? DOC_LABEL_MS : DOC_LABEL)[t] ?? t;
  const docStatus = (d: OrderDoc): [string, string] => d.doc_type === "INV"
    ? (isPaid(d) ? [chipSmSuccess, L("Paid", "Dibayar")] : [chipSmWarn, L("Unpaid", "Belum dibayar")])
    : d.doc_type === "DO" ? [chipSmInfo, d.delivery_status ? d.delivery_status : L("Pending", "Menunggu")]
    : [chipSmNeutral, L("Quotation", "Sebut harga")];
  type DocRow = OrderDoc & { id: number };
  const docRows: DocRow[] = docs.map((d, i) => ({ ...d, id: i + 1 }));
  const docCols: TableCol<DocRow>[] = [
    { key: "doc", label: L("Document", "Dokumen"), main: true, cell: (d) => <span className={css.docName}><strong>{docLabel(d.doc_type)}</strong><small>{d.doc_number}</small></span> },
    { key: "date", label: L("Date", "Tarikh"), cell: (d) => <span className="erp-nowrap">{dmy(d.created_at)}</span> },
    { key: "due", label: L("Due / paid", "Tamat / dibayar"), cell: (d) => <span className="erp-nowrap">{d.doc_type === "INV" ? (isPaid(d) ? (d.paid_at ? L(`Paid ${dmy(d.paid_at)}`, `Dibayar ${dmy(d.paid_at)}`) : "—") : (d.due_date ? L(`Due ${dmy(d.due_date)}`, `Tamat ${dmy(d.due_date)}`) : "—")) : "—"}</span> },
    { key: "amount", label: L("Amount", "Jumlah"), cell: (d) => <span className={css.money}>{fmtRM(d.total_cents)}</span> },
    { key: "status", label: L("Status", "Status"), cell: (d) => { const [c, w] = docStatus(d); return <span className={c}>{w}</span>; } },
    { key: "pdf", label: L("PDF", "PDF"), cell: (d) => d.share_token ? <span className={css.open}><AppIcon name="external" />{L("Open", "Buka")}</span> : <span className={css.muted}>—</span> },
  ];
  type LiveRow = LiveSession & { id: number };
  const liveRows: LiveRow[] = (orders?.lives ?? []).map((l, i) => ({ ...l, id: i + 1 }));
  const liveCols: TableCol<LiveRow>[] = [
    { key: "when", label: L("Date & time", "Tarikh & masa"), main: true, cell: (l) => <span className="erp-nowrap">{dmy(l.session_date)} · {l.start_time}{l.end_time ? `–${l.end_time}` : ""}</span> },
    { key: "platform", label: L("Platform", "Platform"), cell: (l) => <span className={css.cap}>{l.platform}</span> },
    { key: "status", label: L("Status", "Status"), cell: (l) => <span className={l.status === "completed" ? chipSmSuccess : l.status === "cancelled" ? chipSmNeutral : chipSmWarn}>{lang === "ms" ? LIVE_STATUS_MS[l.status] ?? l.status : l.status}</span> },
  ];
  const openDoc = (id: number) => {
    const d = docRows.find((x) => x.id === id);
    if (d?.share_token) window.open(`/doc?t=${d.share_token}`, "_blank", "noopener,noreferrer");
  };
  const sendEnquiry = async () => {
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
      void api<{ enquiries: Enquiry[] }>("/account/enquiries").then((e) => setEnquiries(e.data?.enquiries ?? []));
    }
  };
  const WHATSAPP = "https://wa.me/60123834821?text=Hi%20A2Z%20CREATIVE%20MARKETING%2C%20I%20would%20like%20to%20ask%20about%20your%20services.";

  return (
    <ConsoleShell
      eyebrow={L("A2Z Client Portal", "Portal Klien A2Z")}
      items={ACCOUNT_TABS.map((t) => ({ name: t, label: tabName(t) }))}
      sections={[{ title: "Client", tabs: [...ACCOUNT_TABS] }]}
      active={tab}
      onSelect={(t) => setTab(t as AccountTab)}
      title={tab === "Account" ? `${L("Welcome", "Selamat datang")}, ${user.name.split(" ")[0]}` : tabName(tab)}
      user={user}
      lang={lang}
      onLang={setLangState}
      primaryCount={3}
      onSignOut={() =>
        void api("/auth/logout", { method: "POST", body: JSON.stringify({}) }).then(
          () => window.location.replace("/"),
        )
      }
    >
      {toastNode}
      {tab === "Account" && (
        <TabPage key="acct" className="screen-enter" id="account-home">
          <TabZone label={L("At a glance", "Sekilas pandang")}>
            <KpiRow label={L("My account at a glance", "Akaun saya sekilas pandang")} testid="account-strip">
              <KpiTile icon="documents" tone="navy" label={L("Documents", "Dokumen")} busy={ordersBusy} value={ordersLocked ? "—" : docs.length}
                sub={ordersLocked ? L("Verify your email to see them", "Sahkan e-mel untuk melihatnya") : L("Quotations, invoices, delivery orders", "Sebut harga, invois, pesanan penghantaran")} onClick={() => setTab("Orders")} />
              <KpiTile icon="pay" tone={unpaid.length ? "gold" : "green"} label={L("Unpaid Invoices", "Invois Belum Dibayar")} busy={ordersBusy} value={ordersLocked ? "—" : unpaid.length ? fmtRM(unpaidCents) : L("None", "Tiada")}
                sub={ordersLocked ? "—" : unpaid.length ? L(`${unpaid.length} invoice(s)`, `${unpaid.length} invois`) : L("Everything is paid", "Semua telah dibayar")} onClick={() => setTab("Orders")} />
              <KpiTile icon="chat" tone={awaiting ? "blue" : "green"} label={L("Open Enquiries", "Pertanyaan Terbuka")} busy={enqBusy} value={awaiting}
                sub={awaiting ? L("Waiting for our reply", "Menunggu balasan kami") : L("Nothing waiting", "Tiada yang menunggu")} onClick={() => setTab("Enquiries")} />
              <KpiTile icon="live" tone="purple" label={L("Next Live Session", "Sesi Langsung Seterusnya")} busy={ordersBusy} value={nextLive ? dmy(nextLive.session_date) : "—"}
                sub={nextLive ? `${nextLive.start_time} · ${nextLive.platform}` : L("None scheduled", "Tiada dijadualkan")} onClick={() => setTab("Orders")} />
            </KpiRow>
          </TabZone>
          <TabZone label={L("My account", "Akaun saya")}>
            <WorkspaceSplit testid="account-split" ratio="55-45">
              <SplitPane testid="account-security" title={L("Sign-in & password", "Log masuk & kata laluan")} label={L("Sign-in and password", "Log masuk dan kata laluan")}
                sub={user.oauth ? L("You sign in with Google.", "Anda log masuk dengan Google.") : L("Changing your password signs you out on every other device.", "Menukar kata laluan anda akan melog keluar anda di semua peranti lain.")}>
                {/* v1.4.181: Google sign-ins have NO password on this account - nothing to change, so no form */}
                {user.oauth ? (
                  <p className={css.text}>{L(
                    "You sign in with Google, so this account has no password — there is nothing to change here. Your sign-in security (password, 2-step verification) is managed in your Google Account.",
                    "Anda log masuk dengan Google, jadi akaun ini tiada kata laluan — tiada apa yang perlu ditukar di sini. Keselamatan log masuk anda (kata laluan, pengesahan 2 langkah) diuruskan dalam Akaun Google anda.",
                  )}</p>
                ) : <ChangePasswordForm />}
              </SplitPane>
              <SplitColumn>
                <SplitPane fit testid="account-details" title={L("My details", "Maklumat saya")} label={L("My details", "Maklumat saya")}>
                  <dl className={css.facts}>
                    <div><dt>{L("Name", "Nama")}</dt><dd>{user.name}</dd></div>
                    <div><dt>{L("Email", "E-mel")}</dt><dd>{user.email}</dd></div>
                    <div><dt>{L("Signs in with", "Log masuk dengan")}</dt><dd>{user.oauth ? "Google" : L("Email and password", "E-mel dan kata laluan")}</dd></div>
                  </dl>
                </SplitPane>
                {/* v1.30.0 - THIS client's own mark and domain, from their own customer record; nobody sees another client's brand */}
                <SplitPane testid="account-brand" title={L("Your brand", "Jenama anda")} label={L("Your brand", "Jenama anda")}
                  actions={<a href={WHATSAPP} target="_blank" rel="noopener noreferrer" className={btnSm}><AppIcon name="chat" />{L("WhatsApp us", "WhatsApp kami")}</a>}>
                  {brand ? (
                    <div className={css.brand}>
                      {brand.logo_key && (
                        brand.website ? (
                          <a href={brand.website} target="_blank" rel="noopener noreferrer" className={css.logoLink}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={`/api/v1/media/file/${encodeURIComponent(brand.logo_key)}`} alt={brand.company} className={css.logo} />
                          </a>
                        ) : (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={`/api/v1/media/file/${encodeURIComponent(brand.logo_key)}`} alt={brand.company} className={`${css.logo} ${css.logoFrame}`} />
                        )
                      )}
                      <span className={css.brandText}>
                        <strong>{brand.company}</strong>
                        {brand.website && <a href={brand.website} target="_blank" rel="noopener noreferrer" className={css.link}>{brand.website.replace(/^https?:\/\//, "")}</a>}
                      </span>
                    </div>
                  ) : <p className={css.muted}>{L("When we set up your brand with us, its logo and website show here.", "Apabila jenama anda didaftarkan dengan kami, logo dan laman webnya dipaparkan di sini.")}</p>}
                </SplitPane>
              </SplitColumn>
            </WorkspaceSplit>
          </TabZone>
          {/* v1.266.0 (Secure Authentication 2.0, Phase 1c) - Connected Google account: connect with the password + an emailed code, or disconnect while the password remains */}
          <TabZone label={L("Connected account", "Akaun disambungkan")}>
            <GoogleConnectPanel />
          </TabZone>
        </TabPage>
      )}

      {tab === "Orders" && (
        <TabPage key="orders" className="screen-enter" id="account-orders">
          {ordersLocked ? (
            <TabZone label={L("My orders", "Pesanan saya")}>
              <section className={`erp-card ${css.locked}`} aria-label={L("Orders locked", "Pesanan dikunci")} data-testid="orders-locked">
                <span className={css.lockIcon} aria-hidden><AppIcon name="lock" /></span>
                <div className={css.lockText}>
                  <h3>{L("Verify your email to see your orders", "Sahkan e-mel anda untuk melihat pesanan anda")}</h3>
                  <p>{L(
                    "To protect your order and invoice details, order history is shown only to accounts with a verified email. Sign in with Google using the email we have on file, or message us on WhatsApp and we'll share your latest documents.",
                    "Untuk melindungi butiran pesanan dan invois anda, sejarah pesanan hanya dipaparkan kepada akaun dengan e-mel yang disahkan. Log masuk dengan Google menggunakan e-mel dalam rekod kami, atau hubungi kami di WhatsApp dan kami akan kongsikan dokumen terkini anda.",
                  )}</p>
                  <a href="https://wa.me/60123834821?text=Hi%20AZ%20ONE%20OFFICIAL%2C%20I%20would%20like%20to%20check%20my%20orders." target="_blank" rel="noopener noreferrer" className={btnClass}>
                    {L("Ask on WhatsApp", "Tanya di WhatsApp")}
                  </a>
                </div>
              </section>
            </TabZone>
          ) : (
            <>
              <TabZone label={L("Figures", "Angka")}>
                <KpiRow label={L("My orders at a glance", "Pesanan saya sekilas pandang")} testid="orders-strip">
                  <KpiTile icon="documents" tone="navy" label={L("Documents", "Dokumen")} busy={ordersBusy} value={docs.length} sub={L("All your documents", "Semua dokumen anda")} />
                  <KpiTile icon="pay" tone={unpaid.length ? "gold" : "green"} label={L("Unpaid", "Belum Dibayar")} busy={ordersBusy} value={unpaid.length ? fmtRM(unpaidCents) : L("None", "Tiada")} sub={L(`${unpaid.length} invoice(s)`, `${unpaid.length} invois`)} />
                  <KpiTile icon="paid" tone="green" label={L("Paid Invoices", "Invois Dibayar")} busy={ordersBusy} value={invoices.length - unpaid.length} sub={L(`of ${invoices.length} invoice(s)`, `daripada ${invoices.length} invois`)} />
                  <KpiTile icon="live" tone="purple" label={L("Live Sessions", "Sesi Langsung")} busy={ordersBusy} value={orders?.lives.length ?? 0} sub={nextLive ? L(`Next ${dmy(nextLive.session_date)}`, `Seterusnya ${dmy(nextLive.session_date)}`) : L("None scheduled", "Tiada dijadualkan")} />
                </KpiRow>
              </TabZone>
              <TabZone label={L("Records", "Rekod")}>
                <section className="erp-card" aria-label={L("My orders and invoices", "Pesanan dan invois saya")} data-testid="orders-register">
                  <header className={css.head}>
                    <h3>{L("Orders & invoices", "Pesanan & invois")}</h3>
                    <p>{L("Your quotations, invoices and delivery orders. Open a row to see its PDF.", "Sebut harga, invois dan pesanan penghantaran anda. Buka satu baris untuk melihat PDF-nya.")}</p>
                  </header>
                  {ordersBusy ? <SkelRows rows={4} /> : (
                    <CompactTaskTable rows={docRows} cols={docCols} label={L("Orders and invoices", "Pesanan dan invois")} record="document" testid="orders-table" onOpen={openDoc}
                      empty={<p className={css.muted}>{L("No documents yet. When we prepare a quotation or invoice for you, it appears here.", "Belum ada dokumen. Apabila kami menyediakan sebut harga atau invois untuk anda, ia akan terpapar di sini.")}</p>} />
                  )}
                </section>
                {liveRows.length > 0 && (
                  <section className="erp-card" aria-label={L("My live sessions", "Sesi langsung saya")} data-testid="lives-register">
                    <header className={css.head}><h3>{L("Live sessions", "Sesi langsung")}</h3></header>
                    <CompactTaskTable rows={liveRows} cols={liveCols} label={L("Live sessions", "Sesi langsung")} record="live" testid="lives-table" onOpen={() => {}} />
                  </section>
                )}
              </TabZone>
            </>
          )}
        </TabPage>
      )}

      {tab === "Enquiries" && (
        <TabPage key="enq" className="screen-enter" id="account-enquiries">
          <TabZone label={L("Figures", "Angka")}>
            <KpiRow label={L("My enquiries at a glance", "Pertanyaan saya sekilas pandang")} testid="enquiries-strip">
              <KpiTile icon="chat" tone="navy" label={L("Enquiries", "Pertanyaan")} busy={enqBusy} value={enq.length} sub={L("Everything you have asked", "Semua yang anda tanya")} />
              <KpiTile icon="pending" tone={awaiting ? "gold" : "green"} label={L("Awaiting Reply", "Menunggu Balasan")} busy={enqBusy} value={awaiting} sub={awaiting ? L("We will get back to you", "Kami akan menghubungi anda") : L("Nothing waiting", "Tiada yang menunggu")} />
              <KpiTile icon="success" tone="green" label={L("Replied", "Dibalas")} busy={enqBusy} value={replied} sub={L("Answers from our team", "Jawapan daripada pasukan kami")} />
            </KpiRow>
          </TabZone>
          <TabZone label={L("Ask and follow up", "Tanya dan susuli")}>
            <WorkspaceSplit testid="enquiries-split" ratio="50-50">
              {/* v1.4.181 (CEO): a DIRECT line to staff - categorized enquiries that bell-notify the team, and WhatsApp for instant contact */}
              <SplitPane testid="ask" title={L("Ask A2Z CREATIVE MARKETING", "Tanya A2Z CREATIVE MARKETING")} label={L("Ask a question", "Tanya soalan")}
                sub={L("It reaches our team with your name and email, notifies them at once, and your thread shows beside it.", "Ia sampai kepada pasukan kami bersama nama dan e-mel anda, memberitahu mereka serta-merta, dan perbualan anda dipaparkan di sebelah.")}
                foot={<span className={css.footRow}><span className={css.muted}>{L("Fastest reply:", "Balasan terpantas:")}</span><a href={WHATSAPP} target="_blank" rel="noopener noreferrer" className={btnSm}><AppIcon name="chat" />{L("WhatsApp +60 12-383 4821", "WhatsApp +60 12-383 4821")}</a></span>}>
                <div className={css.form}>
                  <label className={css.field}>
                    <span className={fieldLabel}>{L("What is this about?", "Tentang apakah pertanyaan ini?")}</span>
                    <select className={selectClass} value={askCat} onChange={(e) => setAskCat(e.target.value)}>
                      {ENQUIRY_CATS.map(([v, l]) => <option key={v} value={v}>{lang === "ms" ? CAT_LABEL_MS[v] ?? l : l}</option>)}
                    </select>
                  </label>
                  <label className={css.field}>
                    <span className={fieldLabel}>{L("Your question", "Soalan anda")}</span>
                    <textarea className={textareaClass} rows={4} placeholder={L("What would you like to ask?", "Apakah yang ingin anda tanyakan?")} value={ask} onChange={(e) => setAsk(e.target.value)} />
                  </label>
                  <div><button type="button" className={btnClass} disabled={!ask.trim() || sending} onClick={() => void sendEnquiry()} data-testid="send-enquiry">
                    {sending ? L("Sending…", "Menghantar…") : L("Send enquiry", "Hantar pertanyaan")}
                  </button></div>
                </div>
              </SplitPane>
              <SplitPane testid="thread" title={L("My enquiries", "Pertanyaan saya")} label={L("My enquiries", "Pertanyaan saya")}>
                {/* v1.77.0 - skeleton until the first fetch lands */}
                {enquiries === null ? <SkelRows rows={3} /> : enquiries.length === 0 ? (
                  <p className={css.muted}>{L("No enquiries yet — send your first question.", "Belum ada pertanyaan — hantar soalan pertama anda.")}</p>
                ) : (
                  <ul className={`erp-listbox ${css.thread}`}>
                    {enquiries.map((e) => (
                      <li key={e.id}>
                        <p className={css.msg}>{e.message}</p>
                        {/* v1.4.191: the team's reply, right here in the thread */}
                        {e.reply && (
                          <p className={css.reply}><strong>{L("A2Z CREATIVE MARKETING replied", "A2Z CREATIVE MARKETING membalas")}{e.replied_at ? ` (${dmy(e.replied_at)})` : ""}:</strong> {e.reply}</p>
                        )}
                        <p className={css.meta}>
                          {e.category && <span className={chipSmNeutral}>{(lang === "ms" ? CAT_LABEL_MS : CAT_LABEL)[e.category] ?? e.category}</span>}
                          <span className={e.status === "closed" ? chipSmNeutral : e.reply ? chipSmSuccess : chipSmWarn}>{lang === "ms" ? ENQ_STATUS_MS[e.status] ?? e.status : e.status}</span>
                          <span>{dmy(e.created_at)}</span>
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </SplitPane>
            </WorkspaceSplit>
          </TabZone>
        </TabPage>
      )}
      {/* v1.4.191: PDPA notice one tap away for customers */}
      <p className={css.privacy}>
        <Link className={css.link} href="/privacy">{L("Privacy Notice (PDPA)", "Notis Privasi (PDPA)")}</Link>
      </p>
    </ConsoleShell>
  );
}

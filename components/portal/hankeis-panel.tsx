"use client";

/**
 * HANKEI'S COMMERCE - the portal section. v1.163.0.
 *
 * Six screens behind one pill row: Dashboard, Payment review, Orders,
 * Customers, Catalogue, Fulfilment and Settings. The screen that matters is
 * PAYMENT REVIEW, and it is built to make the honest action easy and the
 * dishonest one hard: the order and the receipt side by side, and an
 * approval form that will not submit until the reviewer has entered what
 * they found in MAYBANK - the reference, the amount, the time, the account -
 * and ticked that they read the bank record rather than the receipt.
 *
 * Nothing here computes money. Every figure is what the worker sent, and
 * the approve button is a POST the worker can and does refuse.
 */

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { makeApi } from "@/lib/api";
import { useCachedApi } from "@/lib/cached-api";
import { useSaveToast } from "@/components/ui/save-toast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { usePrompt } from "@/components/ui/prompt-dialog";
import { Skel, SkelRows, StaleHint } from "@/components/ui/skeleton";
import { StatTile } from "@/components/ui/stat-tile";
import { AppIcon, PanelTitle } from "@/components/ui/app-icon";
import { mytDateTime } from "@/components/portal/page-shared";
import { getLang } from "@/lib/i18n";
import { fmtRM } from "@/lib/format";
import {
  card, insetCard, modalCard, inputClass, inputClassSm, selectClass, fieldLabel,
  btnSm, btnSmPrimary, chipSmNeutral, chipSmSuccess, chipSmWarn, chipSmDanger, chipSmInfo,
  tabPill, tabPillOn, listRow,
} from "@/lib/ui-styles";

const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);
const api = makeApi("/staff/hankeis");
const API_ROOT = "/api/v1/staff/hankeis";

/* ---- what the worker sends ---- */
interface Can { order: boolean; verify: boolean; pack: boolean; admin: boolean }
interface Dash {
  can: Can;
  counts: Record<string, number>;
  money: Record<string, number>;
  open_exceptions: number; outbox_pending: number;
  recent: OrderRow[];
  setup: { qr_configured: boolean; recipient_configured: boolean; account_configured: boolean; ocr_available: boolean };
}
interface OrderRow {
  id: number; order_no: string; total_cents: number; order_state: string; payment_state: string; fulfilment_state: string;
  channel?: string; created_at: string; customer_name: string; customer_category?: string; receipts?: number; exceptions?: number; expires_at?: string | null;
}
interface QueueRow extends OrderRow { customer_phone: string | null; latest_receipt_id: number | null }
/* GET /customers returns hk_customers rows, so the person's name is `name` -
   NOT `customer_name`, which is what the order queries alias it to. */
interface CustomerRow {
  id: number; name: string; phone: string | null; category: string;
  telegram_user_id: number | null; orders: number; spent_cents: number;
}
/* GET /packing selects the delivery address, not the payment columns - an
   order only reaches this query when payment_state is already 'verified'. */
interface PackRow {
  id: number; order_no: string; total_cents: number; fulfilment_state: string; created_at: string;
  customer_name: string; customer_phone: string | null;
  recipient: string | null; line1: string | null; line2: string | null; postcode: string | null; city: string | null; state: string | null;
  open_exceptions: number;
}
interface Receipt {
  id: number; order_id: number; r2_key: string; content_type: string; bytes: number; sha256: string;
  uploaded_via: string; state: string; reject_reason: string | null; created_at: string;
  declared_amount_cents: number | null; declared_reference: string | null; same_file_count: number;
  ocr_state: string; ocr_amount_cents: number | null; ocr_reference: string | null; ocr_recipient: string | null; ocr_confidence: number | null;
  corrected_amount_cents: number | null; corrected_reference: string | null;
}
interface OrderDetail {
  order: OrderRow & { subtotal_cents: number; shipping_cents: number; pay_snapshot: string | null; customer_phone: string | null; customer_id: number; note: string | null; cancel_reason: string | null };
  lines: { id: number; name_snapshot: string; sku_snapshot: string | null; qty: number; unit_price_cents: number; line_total_cents: number }[];
  receipts: Receipt[];
  events: { id: number; action: string; from_state: string | null; to_state: string | null; reason: string | null; meta: string | null; actor_name: string | null; actor_kind: string; created_at: string }[];
  allocations: { id: number; receiving_account: string; bank_reference: string; amount_cents: number; bank_time: string; verified_by_name: string | null; verified_at: string; note: string | null }[];
  exceptions: { id: number; kind: string; detail: string; amount_cents: number | null; state: string; resolution: string | null }[];
  shipments: { id: number; courier: string; tracking_no: string; shipped_at: string }[];
  addresses: { id: number; line1: string; line2: string | null; postcode: string | null; city: string | null; state: string | null; recipient: string | null }[];
  ocr_available: boolean;
  /* the configured receiving account, sent only to a staff member who may
     verify - never the customer's pay_snapshot, which says only "configured" */
  receiving_account: string | null;
}
interface Err { ok?: boolean; error?: { code?: string; message?: string } }
const say = (r: { data: Err | null }, fallback: string) => r.data?.error?.message ?? fallback;

const PAY_CHIP: Record<string, [string, string, string]> = {
  awaiting_payment: ["Awaiting payment", "Menunggu bayaran", chipSmNeutral],
  awaiting_review: ["Receipt to review", "Resit untuk disemak", chipSmWarn],
  clarification_required: ["Clarification asked", "Penjelasan diminta", chipSmInfo],
  verified: ["Payment verified", "Bayaran disahkan", chipSmSuccess],
  refunded: ["Refunded", "Dikembalikan", chipSmDanger],
};
const FUL_CHIP: Record<string, [string, string, string]> = {
  not_ready: ["Not ready", "Belum sedia", chipSmNeutral],
  ready_to_pack: ["Ready to pack", "Sedia dibungkus", chipSmSuccess],
  packing: ["Packing", "Sedang dibungkus", chipSmInfo],
  shipped: ["Shipped", "Dihantar", chipSmSuccess],
  delivered: ["Delivered", "Sampai", chipSmSuccess],
  on_hold: ["On hold", "Ditahan", chipSmDanger],
};
/* One shape for every order row in this panel. An order number is 14
   characters and a customer name can be longer: side by side inside a
   flex-1 button they shred into one word per line on a phone, which is
   what the first phone render showed. So: stacked below 640px, side by
   side above it, and the order number always on a line of its own. */
const hkRow = "flex flex-col gap-1.5 py-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-2";
const chipFor = (m: Record<string, [string, string, string]>, k: string) => {
  const t = m[k];
  return t ? <span className={t[2]}>{L(t[0], t[1])}</span> : <span className={chipSmNeutral}>{k}</span>;
};
const EX_LABEL: Record<string, [string, string]> = {
  underpaid: ["Underpaid", "Kurang bayar"], overpaid: ["Overpaid", "Lebih bayar"],
  late_payment: ["Late payment", "Bayaran lewat"], duplicate_payment: ["Duplicate payment", "Bayaran berulang"],
  mismatch: ["Mismatch", "Tidak sepadan"], refund_request: ["Refund", "Bayaran balik"],
};

/* ════════════════════════════════════════════════════════════════════════
   the approval form - module scope (rule #30: it holds inputs)
   ════════════════════════════════════════════════════════════════════════ */
/**
 * THE form. It asks for what is in MAYBANK, not what is on the receipt, and
 * it will not enable its button until all of it is there and the reviewer
 * has ticked the attestation. The server refuses the same request again -
 * this is only the part that makes the honest path the easy one.
 */
function ApproveForm({ detail, defaultAccount, busy, onSubmit }: {
  detail: OrderDetail; defaultAccount: string; busy: boolean;
  onSubmit: (v: { receiving_account: string; bank_reference: string; amount_cents: number; bank_time: string; attested_bank_checked: boolean; note: string; receipt_id: number | null }) => void;
}) {
  const [account, setAccount] = useState(defaultAccount);
  const [ref, setRef] = useState("");
  const [amount, setAmount] = useState("");
  const [time, setTime] = useState("");
  const [attested, setAttested] = useState(false);
  const [note, setNote] = useState("");
  const latest = detail.receipts.find((r) => r.state === "submitted") ?? detail.receipts[0] ?? null;
  const cents = Math.round((Number.parseFloat(amount.replace(/[^\d.]/g, "")) || 0) * 100);
  const total = detail.order.total_cents;
  const diff = cents - total;
  const ready = account.trim().length > 0 && ref.trim().length >= 4 && cents > 0 && time.trim().length > 0 && attested;
  return (
    <div className="space-y-3">
      <div className="bg-warning-soft text-warning rounded-lg px-3 py-2 text-xs">
        {L("Open Maybank and find this transaction in the receiving account before you fill this in. The receipt on the left is the customer's claim; the bank record is the evidence.",
           "Buka Maybank dan cari transaksi ini dalam akaun penerima sebelum mengisi borang ini. Resit di sebelah kiri ialah dakwaan pelanggan; rekod bank ialah buktinya.")}
      </div>
      <label className="block"><span className={fieldLabel}>{L("Receiving account (as it appears in Maybank)", "Akaun penerima (seperti dalam Maybank)")}</span>
        <input className={`${inputClassSm} w-full`} value={account} onChange={(e) => setAccount(e.target.value)} placeholder="Maybank 5123xxxx1234" />
      </label>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label className="block"><span className={fieldLabel}>{L("Bank transaction reference", "Rujukan transaksi bank")}</span>
          <input className={`${inputClassSm} w-full font-mono`} value={ref} onChange={(e) => setRef(e.target.value)} placeholder="e.g. MB240920ABC123" />
          <span className="text-muted-foreground mt-0.5 block text-[11px]">{L("Exactly as Maybank shows it. If the record cannot identify this transfer, use Request clarification instead.", "Tepat seperti Maybank paparkan. Jika rekod tidak dapat mengenal pasti pemindahan ini, guna Minta penjelasan.")}</span>
        </label>
        <label className="block"><span className={fieldLabel}>{L("Amount received (RM)", "Jumlah diterima (RM)")}</span>
          <input className={`${inputClassSm} w-full tabular-nums`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={(total / 100).toFixed(2)} />
          {cents > 0 && diff !== 0 && (
            <span className={`mt-0.5 block text-[11px] font-medium ${diff < 0 ? "text-danger" : "text-warning"}`}>
              {diff < 0 ? L(`Underpaid by ${fmtRM(-diff)}`, `Kurang ${fmtRM(-diff)}`) : L(`Overpaid by ${fmtRM(diff)}`, `Lebih ${fmtRM(diff)}`)}
              {" · "}{L("this will open an exception, not block the record", "ini akan buka pengecualian, bukan menghalang rekod")}
            </span>
          )}
          {cents > 0 && diff === 0 && <span className="text-muted-foreground mt-0.5 block text-[11px]">{L("Matches the total. A match is not proof - the bank record is.", "Sepadan dengan jumlah. Sepadan bukan bukti - rekod bank yang menjadi bukti.")}</span>}
        </label>
      </div>
      <label className="block"><span className={fieldLabel}>{L("Transaction time (from the bank record)", "Masa transaksi (dari rekod bank)")}</span>
        <input className={`${inputClassSm} w-full`} value={time} onChange={(e) => setTime(e.target.value)} placeholder="2026-09-20 11:02" />
      </label>
      <label className="block"><span className={fieldLabel}>{L("Note (optional)", "Nota (pilihan)")}</span>
        <textarea className={`${inputClassSm} w-full`} rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <label className="bg-secondary/50 flex items-start gap-2 rounded-lg p-2.5 text-sm">
        <input type="checkbox" className="mt-0.5" checked={attested} onChange={(e) => setAttested(e.target.checked)} />
        <span>{L("I opened the receiving account's own Maybank record and found this transaction there. I am not relying on the customer's receipt.",
                 "Saya telah membuka rekod Maybank akaun penerima dan menemui transaksi ini di sana. Saya tidak bergantung pada resit pelanggan.")}</span>
      </label>
      <button type="button" className={btnSmPrimary} disabled={busy || !ready}
        onClick={() => onSubmit({ receiving_account: account.trim(), bank_reference: ref.trim(), amount_cents: cents, bank_time: time.trim(), attested_bank_checked: attested, note, receipt_id: latest?.id ?? null })}>
        {busy ? <Skel className="inline-block h-3 w-20" /> : L("Allocate this bank transaction and verify", "Peruntukkan transaksi bank ini dan sahkan")}
      </button>
      {!ready && <p className="text-muted-foreground text-[11px]">{L("All four bank fields and the attestation are required.", "Kesemua empat medan bank dan pengesahan diperlukan.")}</p>}
    </div>
  );
}

/** A receipt, shown as the untrusted file it is. */
function ReceiptView({ r, ocrAvailable }: { r: Receipt | null; ocrAvailable: boolean }) {
  if (!r) return <p className="text-muted-foreground text-sm">{L("No receipt uploaded yet.", "Tiada resit dimuat naik lagi.")}</p>;
  const src = `${API_ROOT}/receipt-file?key=${encodeURIComponent(r.r2_key)}`;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className={chipSmNeutral}>{r.uploaded_via}</span>
        <span className={r.state === "rejected" ? chipSmDanger : r.state === "accepted" ? chipSmSuccess : chipSmWarn}>{r.state}</span>
        {r.same_file_count > 0 && <span className={chipSmWarn}>{L(`Same file as ${r.same_file_count} other upload(s)`, `Fail sama dengan ${r.same_file_count} muat naik lain`)}</span>}
        <span className="text-muted-foreground tabular-nums">{mytDateTime(r.created_at)} · {(r.bytes / 1024).toFixed(0)} KB</span>
      </div>
      <div className="border-border overflow-hidden rounded-lg border bg-secondary/30">
        {r.content_type === "application/pdf"
          ? <div className="p-4 text-center text-sm"><a className="underline" href={src} target="_blank" rel="noopener noreferrer">{L("Open the PDF receipt", "Buka resit PDF")}</a></div>
          /* eslint-disable-next-line @next/next/no-img-element */
          : <img src={src} alt={L("Customer receipt", "Resit pelanggan")} className="max-h-[420px] w-full object-contain" />}
      </div>
      {(r.declared_amount_cents != null || r.declared_reference) && (
        <p className="text-muted-foreground text-xs">
          {L("Customer declared", "Pelanggan menyatakan")}: {r.declared_amount_cents != null ? fmtRM(r.declared_amount_cents) : "-"}
          {r.declared_reference ? ` · ${r.declared_reference}` : ""}
          {" · "}<span className="text-warning">{L("a declaration is not evidence", "penyataan bukan bukti")}</span>
        </p>
      )}
      <div className={insetCard}>
        <p className={fieldLabel}>{L("Extraction", "Pengekstrakan")}</p>
        {r.ocr_state === "unavailable" || !ocrAvailable ? (
          <p className="text-muted-foreground mt-1 text-xs">
            {L("No OCR engine is configured, so no extraction was attempted. Read the receipt yourself - and then check the bank.",
               "Tiada enjin OCR dikonfigurasi, jadi tiada pengekstrakan dibuat. Baca resit sendiri - kemudian semak bank.")}
          </p>
        ) : r.ocr_state === "failed" ? (
          <p className="text-warning mt-1 text-xs">{L("The extraction failed. Read the receipt yourself.", "Pengekstrakan gagal. Baca resit sendiri.")}</p>
        ) : (
          <div className="mt-1 space-y-0.5 text-xs">
            <p>{L("Amount", "Jumlah")}: {r.ocr_amount_cents != null ? fmtRM(r.ocr_amount_cents) : "-"} · {L("Reference", "Rujukan")}: <span className="font-mono">{r.ocr_reference ?? "-"}</span></p>
            <p>{L("Recipient", "Penerima")}: {r.ocr_recipient ?? "-"} · {L("Confidence", "Keyakinan")}: {r.ocr_confidence != null ? `${Math.round(r.ocr_confidence * 100)}%` : "-"}</p>
            <p className="text-warning">{L("An extraction is a reading aid. It is never evidence that money arrived.", "Pengekstrakan ialah bantuan membaca. Ia bukan bukti wang telah masuk.")}</p>
          </div>
        )}
      </div>
    </div>
  );
}

/** A simple modal, the house shape. */
function Sheet({ title, sub, wide = false, onClose, children }: { title: string; sub?: string; wide?: boolean; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 backdrop-blur-[2px] sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
      <div className={`${modalCard} max-h-[92vh] overflow-y-auto overscroll-contain rounded-b-none pb-[calc(1.25rem+env(safe-area-inset-bottom))] sm:rounded-b-2xl sm:pb-6 ${wide ? "sm:max-w-4xl" : ""}`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0"><p className="text-base font-semibold">{title}</p>{sub && <p className="text-muted-foreground mt-0.5 text-xs">{sub}</p>}</div>
          <button type="button" className={`${btnSm} h-8 w-8 shrink-0 justify-center px-0`} aria-label={L("Close", "Tutup")} onClick={onClose}><AppIcon name="blocked" className="h-4 w-4" /></button>
        </div>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}

/** New-order form (module scope: it holds inputs). */
function OrderForm({ busy, onSubmit }: { busy: boolean; onSubmit: (v: { customer_id: number; address_id: number | null; lines: { product_id?: number; package_id?: number; qty: number }[]; note: string }) => void }) {
  const cat = useCachedApi<{ products: { id: number; name: string; sku: string; unit_price_cents: number; is_active: number }[]; packages: { id: number; code: string; name: string; eligibility: string; price_cents: number; is_active: number }[] }>("/staff/hankeis/catalogue", true, ["hankeis"]);
  const cust = useCachedApi<{ customers: { id: number; name: string; phone: string | null; category: string }[] }>("/staff/hankeis/customers", true, ["hankeis"]);
  const [customer, setCustomer] = useState("");
  const [note, setNote] = useState("");
  const [picked, setPicked] = useState<Record<string, number>>({});
  const set = (k: string, n: number) => setPicked((p) => ({ ...p, [k]: Math.max(0, n) }));
  const lines = Object.entries(picked).filter(([, q]) => q > 0).map(([k, qty]) => k.startsWith("p") ? { product_id: Number(k.slice(1)), qty } : { package_id: Number(k.slice(1)), qty });
  return (
    <div className="space-y-3">
      <label className="block"><span className={fieldLabel}>{L("Customer", "Pelanggan")}</span>
        <select className={`${selectClass} w-full`} value={customer} onChange={(e) => setCustomer(e.target.value)}>
          <option value="">{L("Pick a customer", "Pilih pelanggan")}</option>
          {(cust.data?.customers ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}{c.phone ? ` · ${c.phone}` : ""} · {c.category}</option>)}
        </select>
      </label>
      <div>
        <p className={fieldLabel}>{L("Items", "Barang")}</p>
        <div className="mt-1 space-y-1">
          {(cat.data?.products ?? []).filter((p) => p.is_active).map((p) => (
            <div key={`p${p.id}`} className={listRow}>
              <span className="text-sm">{p.name} <span className="text-muted-foreground text-xs">· {fmtRM(p.unit_price_cents)}</span></span>
              <input type="number" min={0} max={999} className={`${inputClassSm} w-20 tabular-nums`} value={picked[`p${p.id}`] ?? 0} onChange={(e) => set(`p${p.id}`, Number(e.target.value))} />
            </div>
          ))}
          {(cat.data?.packages ?? []).filter((p) => p.is_active).map((p) => (
            <div key={`k${p.id}`} className={listRow}>
              <span className="text-sm">{p.name} <span className={chipSmInfo}>{p.eligibility}</span> <span className="text-muted-foreground text-xs">· {fmtRM(p.price_cents)}</span></span>
              <input type="number" min={0} max={999} className={`${inputClassSm} w-20 tabular-nums`} value={picked[`k${p.id}`] ?? 0} onChange={(e) => set(`k${p.id}`, Number(e.target.value))} />
            </div>
          ))}
        </div>
      </div>
      <label className="block"><span className={fieldLabel}>{L("Note (optional)", "Nota (pilihan)")}</span>
        <input className={`${inputClassSm} w-full`} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <p className="text-muted-foreground text-xs">{L("The total is calculated on the server from the catalogue and the customer's category - eligibility and stock are checked there too.", "Jumlah dikira di pelayan daripada katalog dan kategori pelanggan - kelayakan dan stok turut disemak di sana.")}</p>
      <button type="button" className={btnSmPrimary} disabled={busy || !customer || lines.length === 0}
        onClick={() => onSubmit({ customer_id: Number(customer), address_id: null, lines, note })}>
        {busy ? <Skel className="inline-block h-3 w-16" /> : L("Create the order", "Cipta pesanan")}
      </button>
    </div>
  );
}

/** Settings editor (module scope: it holds inputs). */
function SettingsForm({ initial, busy, onSave }: { initial: Record<string, string>; busy: boolean; onSave: (patch: Record<string, string>) => void }) {
  const [v, setV] = useState(initial);
  useEffect(() => { setV(initial); }, [initial]);
  const field = (k: string, label: [string, string], hint?: [string, string], type: "text" | "area" = "text") => (
    <label className="block">
      <span className={fieldLabel}>{L(label[0], label[1])}</span>
      {type === "area"
        ? <textarea className={`${inputClassSm} w-full`} rows={3} maxLength={2000} value={v[k] ?? ""} onChange={(e) => setV({ ...v, [k]: e.target.value })} />
        : <input className={`${inputClassSm} w-full`} value={v[k] ?? ""} onChange={(e) => setV({ ...v, [k]: e.target.value })} />}
      {hint && <span className="text-muted-foreground mt-0.5 block text-[11px]">{L(hint[0], hint[1])}</span>}
    </label>
  );
  const dirty = Object.keys(v).filter((k) => v[k] !== initial[k]);
  return (
    <div className="space-y-4">
      <div className={insetCard}>
        <p className="text-danger text-[11px] font-semibold tracking-wider uppercase">{L("Payment destination", "Destinasi bayaran")}</p>
        <p className="text-muted-foreground mt-1 mb-2 text-xs">{L("Where customers send money. Owner only, and every change is written to the audit log and pushed to the other officers.", "Ke mana pelanggan menghantar wang. Pemilik sahaja, dan setiap perubahan dicatat dalam log audit dan dimaklumkan kepada pegawai lain.")}</p>
        <div className="space-y-2">
          {field("recipient_name", ["Expected recipient name", "Nama penerima dijangka"], ["Shown to the customer so they can check the QR before paying.", "Dipaparkan kepada pelanggan supaya mereka boleh menyemak QR sebelum membayar."])}
          {field("receiving_account", ["Receiving account label", "Label akaun penerima"], ["Used to scope the bank-transaction uniqueness check.", "Digunakan untuk skop semakan keunikan transaksi bank."])}
          {field("qr_image_key", ["Static QR image key", "Kunci imej QR statik"], ["The stored key of the Maybank QR image. The QR itself never expires.", "Kunci tersimpan bagi imej QR Maybank. QR itu sendiri tidak tamat tempoh."])}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {/* shipping_mode is read by quote() - "quote" is what puts an order in
            quote_required, the state the dashboard already counts, so it has
            to be settable here or that queue can never fill. */}
        <label className="block">
          <span className={fieldLabel}>{L("Shipping", "Penghantaran")}</span>
          <select className={`${selectClass} w-full`} value={v.shipping_mode ?? "flat"} onChange={(e) => setV({ ...v, shipping_mode: e.target.value })}>
            <option value="flat">{L("Flat rate", "Kadar rata")}</option>
            <option value="quote">{L("Quoted per order", "Sebut harga setiap pesanan")}</option>
            <option value="pickup">{L("Self pickup", "Ambil sendiri")}</option>
          </select>
          <span className="text-muted-foreground mt-0.5 block text-[11px]">
            {L("Quoted holds every new order at \"needs a shipping quote\" until someone prices it.", "Sebut harga menahan setiap pesanan baharu pada \"perlu sebut harga\" sehingga seseorang menetapkan harganya.")}
          </span>
        </label>
        {field("shipping_flat_cents", ["Flat shipping (sen)", "Penghantaran rata (sen)"])}
        {field("shipping_free_over_cents", ["Free shipping over (sen, blank = never)", "Percuma melebihi (sen, kosong = tiada)"])}
        {field("reservation_minutes", ["Stock reservation (minutes)", "Tempahan stok (minit)"], ["0 turns reservations off.", "0 mematikan tempahan."])}
        {field("max_receipts_per_order", ["Receipts allowed per order", "Resit dibenarkan setiap pesanan"])}
        {field("uploads_per_hour", ["Uploads per customer per hour", "Muat naik setiap pelanggan sejam"])}
        {field("catalogue_key", ["Catalogue file key", "Kunci fail katalog"])}
      </div>
      {field("pay_instructions_bm", ["Customer payment instructions (BM)", "Arahan bayaran pelanggan (BM)"], undefined, "area")}
      <button type="button" className={btnSmPrimary} disabled={busy || dirty.length === 0} onClick={() => onSave(Object.fromEntries(dirty.map((k) => [k, v[k] ?? ""])))}>
        {busy ? <Skel className="inline-block h-3 w-16" /> : L(`Save ${dirty.length} change(s)`, `Simpan ${dirty.length} perubahan`)}
      </button>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   the panel
   ════════════════════════════════════════════════════════════════════════ */
type Screen = "dashboard" | "review" | "orders" | "customers" | "catalogue" | "packing" | "settings";

/* No `role` prop, deliberately. Every other panel takes one and decides what
   to draw from it; this one does not, because what a person may do here is a
   money decision. The worker answers GET /staff/hankeis with `can` - order,
   verify, pack, admin - computed from the SAME permission matrix that the
   POST handlers enforce, so the button and the refusal can never disagree.
   A tampered client role would draw a button the worker still refuses. */
export function HankeisPanel() {
  const [screen, setScreen] = useState<Screen>("dashboard");
  const [openOrder, setOpenOrder] = useState<number | null>(null);
  const [sheet, setSheet] = useState<"new_order" | "new_customer" | null>(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState("");
  const { show: toast, node: toastNode } = useSaveToast();
  const { confirm, node: confirmNode } = useConfirm();
  const { prompt, node: promptNode } = usePrompt();

  const dash = useCachedApi<Dash>("/staff/hankeis", true, ["hankeis"]);
  const review = useCachedApi<{ queue: QueueRow[]; can_verify: boolean; ocr_available: boolean }>(screen === "review" ? "/staff/hankeis/review" : null, screen === "review", ["hankeis"]);
  const orders = useCachedApi<{ orders: OrderRow[] }>(screen === "orders" ? `/staff/hankeis/orders${filter ? `?payment_state=${filter}` : ""}` : null, screen === "orders", ["hankeis"]);
  const customers = useCachedApi<{ customers: CustomerRow[] }>(screen === "customers" ? "/staff/hankeis/customers" : null, screen === "customers", ["hankeis"]);
  const packing = useCachedApi<{ queue: PackRow[]; can_pack: boolean }>(screen === "packing" ? "/staff/hankeis/packing" : null, screen === "packing", ["hankeis"]);
  const setup = useCachedApi<{ settings: Record<string, string>; ocr_available: boolean; clients: { id: number; name: string; scopes: string; is_active: number; last_seen_at: string | null }[] }>(screen === "settings" ? "/staff/hankeis/settings" : null, screen === "settings", ["hankeis"]);
  const detail = useCachedApi<OrderDetail>(openOrder ? `/staff/hankeis/orders/${openOrder}` : null, Boolean(openOrder), ["hankeis"]);

  const can: Can = dash.data?.can ?? { order: false, verify: false, pack: false, admin: false };
  const refreshAll = useCallback(() => { dash.refresh(); review.refresh(); orders.refresh(); packing.refresh(); detail.refresh(); customers.refresh(); }, [dash, review, orders, packing, detail, customers]);

  const post = async (path: string, body: unknown, done: [string, string]): Promise<boolean> => {
    setBusy(true);
    const r = await api<Err & Record<string, unknown>>(path, { method: "POST", body: JSON.stringify(body) });
    setBusy(false);
    if (!r.ok) { toast(L("Refused", "Ditolak"), say(r, L("The server refused that", "Pelayan menolaknya")), "notice"); return false; }
    toast(L(done[0], done[1]), typeof r.data?.note === "string" ? r.data.note : "");
    refreshAll();
    return true;
  };

  const verify = async (v: Parameters<Parameters<typeof ApproveForm>[0]["onSubmit"]>[0]) => {
    if (!openOrder) return;
    const okGo = await confirm({
      title: L("Verify this payment?", "Sahkan bayaran ini?"),
      message: L("You are stating that you found this transaction in the receiving account's own Maybank record. The transaction will be allocated to this order and cannot pay for another.",
                 "Anda menyatakan bahawa anda menemui transaksi ini dalam rekod Maybank akaun penerima. Transaksi ini akan diperuntukkan kepada pesanan ini dan tidak boleh membayar pesanan lain."),
      confirmLabel: L("Verify", "Sahkan"),
    });
    if (!okGo) return;
    setBusy(true);
    const r = await api<Err & { exceptions?: { kind: string; detail: string }[] }>(`/orders/${openOrder}/verify`, { method: "POST", body: JSON.stringify(v) });
    setBusy(false);
    if (!r.ok) { toast(L("Not verified", "Tidak disahkan"), say(r, ""), "notice"); return; }
    const ex = r.data?.exceptions ?? [];
    toast(L("Payment verified", "Bayaran disahkan"),
      ex.length === 0 ? L("Moved to the packing queue", "Dipindahkan ke barisan pembungkusan")
        : L(`On hold: ${ex.map((e) => e.kind).join(", ")}`, `Ditahan: ${ex.map((e) => e.kind).join(", ")}`),
      ex.length === 0 ? "success" : "notice");
    refreshAll();
  };

  const clarify = async (id: number) => {
    const r = await prompt({ title: L("What is unclear?", "Apa yang tidak jelas?"), message: L("The customer reads this, in Bahasa Melayu.", "Pelanggan membaca ini, dalam Bahasa Melayu."), label: L("Message", "Mesej"), required: true });
    if (!r?.value.trim()) return;
    await post(`/orders/${id}/clarify`, { reason: r.value.trim() }, ["Clarification asked", "Penjelasan diminta"]);
  };
  const rejectReceipt = async (receiptId: number) => {
    const r = await prompt({
      title: L("Why can this receipt not be used?", "Kenapa resit ini tidak boleh digunakan?"),
      message: L("This says the EVIDENCE is unusable. It makes no claim about whether the bank transfer happened, and the customer is told so.", "Ini bermakna BUKTI tidak boleh digunakan. Ia tidak mendakwa sama ada pemindahan bank berlaku, dan pelanggan diberitahu demikian."),
      label: L("Reason", "Sebab"), required: true, variant: "danger", confirmLabel: L("Reject the receipt", "Tolak resit"),
    });
    if (!r?.value.trim()) return;
    await post(`/receipts/${receiptId}/reject`, { reason: r.value.trim() }, ["Receipt rejected", "Resit ditolak"]);
  };
  const ship = async (id: number) => {
    const courier = await prompt({ title: L("Courier", "Kurier"), label: L("Courier", "Kurier"), required: true, initial: "J&T" });
    if (!courier?.value.trim()) return;
    const tracking = await prompt({ title: L("Tracking number", "Nombor penjejakan"), label: L("Tracking number", "Nombor penjejakan"), required: true });
    if (!tracking?.value.trim()) return;
    await post(`/orders/${id}/ship`, { courier: courier.value.trim(), tracking_no: tracking.value.trim() }, ["Shipped", "Dihantar"]);
  };

  const SCREENS: [Screen, string, string][] = [
    ["dashboard", "Dashboard", "Papan pemuka"], ["review", "Payment review", "Semakan bayaran"],
    ["orders", "Orders", "Pesanan"], ["packing", "Fulfilment", "Pemenuhan"],
    ["customers", "Customers", "Pelanggan"], ["catalogue", "Catalogue", "Katalog"], ["settings", "Settings", "Tetapan"],
  ];
  const d = dash.data;
  const money = d?.money ?? {};
  const counts = d?.counts ?? {};
  const setupGap = d && (!d.setup.qr_configured || !d.setup.recipient_configured || !d.setup.account_configured);

  return (
    <div className="space-y-4 md:space-y-6">
      {toastNode}{confirmNode}{promptNode}

      <section className={card}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <PanelTitle icon="store">Hankei&apos;s <span className="text-muted-foreground font-normal">· {L("orders and manual payment checks", "pesanan dan semakan bayaran manual")}</span></PanelTitle>
            <p className="text-muted-foreground mt-1 text-xs">
              {L("Customers pay a static Maybank QR and upload a receipt. A receipt is evidence, never proof: an authorised reviewer finds the transaction in the bank and allocates it here.",
                 "Pelanggan membayar melalui QR Maybank statik dan memuat naik resit. Resit ialah bukti sokongan, bukan pengesahan: penyemak yang diberi kuasa mencari transaksi dalam bank dan memperuntukkannya di sini.")}
            </p>
            <StaleHint show={Boolean(dash.stale)} className="mt-1" />
          </div>
          {can.order && <button type="button" className={btnSmPrimary} onClick={() => setSheet("new_order")}>{L("New order", "Pesanan baharu")}</button>}
        </div>
        <div role="tablist" className="mt-3 flex flex-wrap gap-1.5">
          {SCREENS.map(([k, en, ms]) => (
            <button key={k} type="button" role="tab" aria-selected={screen === k} className={screen === k ? tabPillOn : tabPill} onClick={() => setScreen(k)}>
              {L(en, ms)}
              {k === "review" && (counts.awaiting_review ?? 0) > 0 && <span className="ml-1 tabular-nums">{counts.awaiting_review}</span>}
              {k === "packing" && (counts.to_pack ?? 0) > 0 && <span className="ml-1 tabular-nums">{counts.to_pack}</span>}
            </button>
          ))}
        </div>
        {setupGap && (
          <p className="text-warning mt-2 text-xs">
            {L("Set the QR image, the recipient name and the receiving account in Settings before taking an order - a customer must be able to check the recipient before paying.",
               "Tetapkan imej QR, nama penerima dan akaun penerima dalam Tetapan sebelum menerima pesanan - pelanggan mesti boleh menyemak penerima sebelum membayar.")}
          </p>
        )}
      </section>

      {/* ---- dashboard ---- */}
      {screen === "dashboard" && (
        !d ? <SkelRows rows={4} /> : (
          <>
            <section className={card}>
              <PanelTitle icon="chart">{L("Today", "Hari ini")}</PanelTitle>
              <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4 md:gap-3">
                <StatTile label={L("New orders today", "Pesanan baharu hari ini")} value={counts.new_today ?? 0} tone="brand" />
                <StatTile label={L("Awaiting payment", "Menunggu bayaran")} value={counts.awaiting_payment ?? 0} tone="muted" />
                <StatTile label={L("Receipts to review", "Resit untuk disemak")} value={counts.awaiting_review ?? 0} tone={(counts.awaiting_review ?? 0) > 0 ? "gold" : "muted"} onClick={() => setScreen("review")} />
                <StatTile label={L("Clarification asked", "Penjelasan diminta")} value={counts.clarification ?? 0} tone="info" />
                <StatTile label={L("Verified, to pack", "Disahkan, untuk dibungkus")} value={counts.to_pack ?? 0} tone="success" onClick={() => setScreen("packing")} />
                <StatTile label={L("Shipped", "Dihantar")} value={counts.shipped ?? 0} tone="muted" />
                <StatTile label={L("On hold / exceptions", "Ditahan / pengecualian")} value={d.open_exceptions} tone={d.open_exceptions > 0 ? "danger" : "muted"} />
                <StatTile label={L("Needs a shipping quote", "Perlu sebut harga penghantaran")} value={counts.quote_required ?? 0} tone="muted" />
              </div>
            </section>
            <section className={card}>
              <PanelTitle icon="money">{L("Sales, from VERIFIED payments only", "Jualan, daripada bayaran DISAHKAN sahaja")}</PanelTitle>
              <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4 md:gap-3">
                <StatTile label={L("Verified, this month", "Disahkan, bulan ini")} value={fmtRM(money.verified_month_cents ?? 0)} tone="success" />
                <StatTile label={L("Verified, all time", "Disahkan, sepanjang masa")} value={fmtRM(money.verified_cents ?? 0)} tone="brand" />
                <StatTile label={L("Cancelled (not counted)", "Dibatalkan (tidak dikira)")} value={fmtRM(money.cancelled_cents ?? 0)} tone="muted" />
                <StatTile label={L("Refunded (not counted)", "Dikembalikan (tidak dikira)")} value={fmtRM(money.refunded_cents ?? 0)} tone="danger" />
              </div>
              <p className="text-muted-foreground mt-2 text-xs">
                {L("An order with a receipt on it counts for nothing here until a person has matched the bank transaction.", "Pesanan yang ada resit tidak dikira di sini sehingga seseorang memadankan transaksi bank.")}
              </p>
            </section>
            <section className={card}>
              <PanelTitle icon="orders">{L("Latest orders", "Pesanan terkini")}</PanelTitle>
              <ul className="divide-border mt-2 divide-y">
                {d.recent.map((o) => (
                  <li key={o.id} className={hkRow}>
                    <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setOpenOrder(o.id)}>
                      <span className="block text-sm font-medium">{o.order_no}</span>
                      <span className="text-muted-foreground block text-xs">{o.customer_name} · {mytDateTime(o.created_at)}</span>
                    </button>
                    <span className="flex shrink-0 flex-wrap items-center gap-1.5">
                      <span className="text-sm font-semibold tabular-nums">{fmtRM(o.total_cents)}</span>
                      {chipFor(PAY_CHIP, o.payment_state)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          </>
        )
      )}

      {/* ---- payment review ---- */}
      {screen === "review" && (
        <section className={card}>
          <PanelTitle icon="verify">{L("Payment review queue", "Barisan semakan bayaran")} <span className="text-muted-foreground font-normal tabular-nums">· {review.data?.queue.length ?? 0}</span></PanelTitle>
          <p className="text-muted-foreground mt-1 text-xs">
            {can.verify
              ? L("Open an order, read the receipt, then check the receiving account in Maybank and allocate the transaction.", "Buka pesanan, baca resit, kemudian semak akaun penerima dalam Maybank dan peruntukkan transaksi.")
              : L("You can read this queue and ask for clarification. Verifying a payment is a finance permission.", "Anda boleh membaca barisan ini dan meminta penjelasan. Mengesahkan bayaran ialah kebenaran kewangan.")}
          </p>
          {!review.data ? <SkelRows rows={3} className="mt-3" /> : review.data.queue.length === 0 ? (
            <p className="text-muted-foreground mt-3 text-sm">{L("Nothing waiting. Receipts land here the moment a customer uploads one.", "Tiada yang menunggu. Resit sampai di sini sebaik pelanggan memuat naiknya.")}</p>
          ) : (
            <ul className="divide-border mt-3 divide-y">
              {review.data.queue.map((o) => (
                <li key={o.id} className={hkRow}>
                  <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setOpenOrder(o.id)}>
                    <span className="block text-sm font-medium">{o.order_no}</span>
                    <span className="text-muted-foreground block text-xs">{o.customer_name}{o.customer_phone ? ` · ${o.customer_phone}` : ""}</span>
                    <span className="text-muted-foreground mt-0.5 block text-[11px] tabular-nums">{mytDateTime(o.created_at)} · {o.receipts} {L("receipt(s)", "resit")}</span>
                  </button>
                  <span className="flex shrink-0 flex-wrap items-center gap-1.5">
                    <span className="text-sm font-semibold tabular-nums">{fmtRM(o.total_cents)}</span>
                    {chipFor(PAY_CHIP, o.payment_state)}
                    <button type="button" className={btnSm} onClick={() => setOpenOrder(o.id)}>{L("Open", "Buka")}</button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* ---- orders ---- */}
      {screen === "orders" && (
        <section className={card}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <PanelTitle icon="orders">{L("Orders", "Pesanan")}</PanelTitle>
            <select className={selectClass} value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="">{L("All payment states", "Semua status bayaran")}</option>
              {Object.keys(PAY_CHIP).map((k) => <option key={k} value={k}>{L(PAY_CHIP[k]![0], PAY_CHIP[k]![1])}</option>)}
            </select>
          </div>
          {!orders.data ? <SkelRows rows={4} className="mt-3" /> : (
            <ul className="divide-border mt-3 divide-y">
              {orders.data.orders.map((o) => (
                <li key={o.id} className={hkRow}>
                  <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setOpenOrder(o.id)}>
                    <span className="block text-sm font-medium">{o.order_no}</span>
                    <span className="text-muted-foreground block text-xs">{o.customer_name} · {o.channel} · {mytDateTime(o.created_at)}</span>
                  </button>
                  <span className="flex shrink-0 flex-wrap items-center gap-1.5">
                    {(o.exceptions ?? 0) > 0 && <span className={chipSmDanger}>{L("exception", "pengecualian")}</span>}
                    <span className="text-sm font-semibold tabular-nums">{fmtRM(o.total_cents)}</span>
                    {chipFor(PAY_CHIP, o.payment_state)}
                    {chipFor(FUL_CHIP, o.fulfilment_state)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* ---- fulfilment ---- */}
      {screen === "packing" && (
        <section className={card}>
          <PanelTitle icon="package">{L("Packing queue", "Barisan pembungkusan")}</PanelTitle>
          <p className="text-muted-foreground mt-1 text-xs">{L("Only orders whose payment a person has verified in the bank appear here. An order with an open exception is held.", "Hanya pesanan yang bayarannya telah disahkan oleh seseorang dalam bank muncul di sini. Pesanan dengan pengecualian terbuka ditahan.")}</p>
          {!packing.data ? <SkelRows rows={3} className="mt-3" /> : packing.data.queue.length === 0 ? (
            <p className="text-muted-foreground mt-3 text-sm">{L("Nothing to pack.", "Tiada untuk dibungkus.")}</p>
          ) : (
            <ul className="divide-border mt-3 divide-y">
              {packing.data.queue.map((o) => (
                <li key={o.id} className={hkRow}>
                  <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setOpenOrder(o.id)}>
                    <span className="block text-sm font-medium">{o.order_no}</span>
                    <span className="text-muted-foreground block text-xs">{o.customer_name}</span>
                    <span className="text-muted-foreground mt-0.5 block text-[11px]">{[o.line1, o.city].filter(Boolean).join(", ") || L("no address on file", "tiada alamat")}</span>
                  </button>
                  <span className="flex shrink-0 flex-wrap items-center gap-1.5">
                    {o.open_exceptions > 0 && <span className={chipSmDanger}>{L("on hold", "ditahan")}</span>}
                    {chipFor(FUL_CHIP, o.fulfilment_state)}
                    {can.pack && o.open_exceptions === 0 && o.fulfilment_state !== "shipped" && (
                      <button type="button" className={btnSmPrimary} disabled={busy} onClick={() => void ship(o.id)}>{L("Record shipment", "Rekod penghantaran")}</button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* ---- customers ---- */}
      {screen === "customers" && (
        <section className={card}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <PanelTitle icon="clients">{L("Customers", "Pelanggan")}</PanelTitle>
            {can.order && <button type="button" className={btnSm} onClick={() => setSheet("new_customer")}>{L("Add a customer", "Tambah pelanggan")}</button>}
          </div>
          {!customers.data ? <SkelRows rows={4} className="mt-3" /> : (
            <ul className="divide-border mt-3 divide-y">
              {customers.data.customers.map((c) => (
                <li key={c.id} className={listRow}>
                  <span className="min-w-0 text-sm">
                    {c.name}
                    <span className="text-muted-foreground ml-2 text-xs">{c.phone ?? ""}</span>
                    <span className="text-muted-foreground mt-0.5 block text-[11px]">{c.orders} {L("orders", "pesanan")} · {fmtRM(c.spent_cents)} {L("verified", "disahkan")}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    <span className={c.category === "retail" ? chipSmNeutral : chipSmInfo}>{c.category}</span>
                    {can.admin && (
                      <button type="button" className={btnSm} disabled={busy} onClick={async () => {
                        const r = await prompt({ title: L("Change category", "Tukar kategori"), message: L("retail, agent or stockist. This decides which packages the customer may buy - a customer can never set it themselves.", "retail, agent atau stockist. Ini menentukan pakej yang boleh dibeli - pelanggan tidak boleh menetapkannya sendiri."), label: L("Category", "Kategori"), initial: c.category, required: true });
                        if (r?.value.trim()) await post(`/customers/${c.id}/category`, { category: r.value.trim(), reason: "portal" }, ["Category changed", "Kategori ditukar"]);
                      }}>{L("Category", "Kategori")}</button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* ---- catalogue ---- */}
      {screen === "catalogue" && <CatalogueScreen canAdmin={can.admin} busy={busy} post={post} />}

      {/* ---- settings ---- */}
      {screen === "settings" && (
        <>
          <section className={card}>
            <PanelTitle icon="fix">{L("Settings", "Tetapan")}</PanelTitle>
            {!setup.data ? <SkelRows rows={4} className="mt-3" /> : !can.admin ? (
              <p className="text-muted-foreground mt-3 text-sm">{L("Only the owner may change these. You can see the current values on an order's payment snapshot.", "Hanya pemilik boleh mengubah ini.")}</p>
            ) : (
              <div className="mt-3">
                <SettingsForm initial={setup.data.settings} busy={busy} onSave={async (patch) => {
                  setBusy(true);
                  const r = await api<Err>("/settings", { method: "PUT", body: JSON.stringify(patch) });
                  setBusy(false);
                  if (!r.ok) { toast(L("Not saved", "Tidak disimpan"), say(r, ""), "notice"); return; }
                  toast(L("Saved", "Disimpan"), L("Changes to the payment destination are audited", "Perubahan destinasi bayaran diaudit"));
                  setup.refresh(); dash.refresh();
                }} />
              </div>
            )}
          </section>
          {can.admin && setup.data && (
            <section className={card}>
              <PanelTitle icon="link">{L("Integration credentials", "Kelayakan integrasi")}</PanelTitle>
              <p className="text-muted-foreground mt-1 text-xs">
                {L("Tokens for Astra GPT's Telegram adapter. They can read the catalogue, create orders and upload receipts. They can never verify a payment or change a setting - there is no route for it on that surface.",
                   "Token untuk penyesuai Telegram Astra GPT. Ia boleh membaca katalog, mencipta pesanan dan memuat naik resit. Ia tidak boleh mengesahkan bayaran atau mengubah tetapan.")}
              </p>
              <ul className="divide-border mt-2 divide-y text-sm">
                {setup.data.clients.map((c) => (
                  <li key={c.id} className={listRow}>
                    <span className="min-w-0">{c.name}<span className="text-muted-foreground ml-2 font-mono text-[11px]">{c.scopes}</span></span>
                    <span className="flex items-center gap-1.5">
                      <span className={c.is_active ? chipSmSuccess : chipSmDanger}>{c.is_active ? L("active", "aktif") : L("revoked", "dibatalkan")}</span>
                      {c.is_active === 1 && <button type="button" className={btnSm} disabled={busy} onClick={async () => {
                        const go = await confirm({ title: L("Revoke this token?", "Batalkan token ini?"), message: L("The adapter stops working immediately.", "Penyesuai berhenti berfungsi serta-merta."), confirmLabel: L("Revoke", "Batalkan"), variant: "danger" });
                        if (go) await post(`/clients/${c.id}/revoke`, {}, ["Revoked", "Dibatalkan"]);
                      }}>{L("Revoke", "Batalkan")}</button>}
                    </span>
                  </li>
                ))}
              </ul>
              <button type="button" className={`${btnSm} mt-2`} disabled={busy} onClick={async () => {
                const r = await prompt({ title: L("Name the integration", "Namakan integrasi"), label: L("Name", "Nama"), required: true, initial: "Astra Telegram adapter" });
                if (!r?.value.trim()) return;
                setBusy(true);
                const res = await api<Err & { token?: string }>("/clients", { method: "POST", body: JSON.stringify({ name: r.value.trim() }) });
                setBusy(false);
                if (!res.ok || !res.data?.token) { toast(L("Not created", "Tidak dicipta"), say(res, ""), "notice"); return; }
                await confirm({ title: L("Copy this token now", "Salin token ini sekarang"), message: res.data.token, confirmLabel: L("I have copied it", "Saya telah menyalinnya") });
                setup.refresh();
              }}>{L("Create a token", "Cipta token")}</button>
            </section>
          )}
        </>
      )}

      {/* ---- order detail: the side-by-side review ---- */}
      {openOrder && (
        <Sheet wide title={detail.data?.order.order_no ?? L("Order", "Pesanan")}
          sub={detail.data ? `${detail.data.order.customer_name} · ${fmtRM(detail.data.order.total_cents)}` : undefined}
          onClose={() => setOpenOrder(null)}>
          {!detail.data ? <SkelRows rows={5} /> : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-1.5">
                {chipFor(PAY_CHIP, detail.data.order.payment_state)}
                {chipFor(FUL_CHIP, detail.data.order.fulfilment_state)}
                <span className={chipSmNeutral}>{detail.data.order.order_state}</span>
                {detail.data.exceptions.filter((e) => e.state === "open").map((e) => (
                  <span key={e.id} className={chipSmDanger}>{L(...(EX_LABEL[e.kind] ?? [e.kind, e.kind]))}</span>
                ))}
              </div>
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {/* left: the order */}
                <div className="space-y-3">
                  <div className={insetCard}>
                    <p className={fieldLabel}>{L("Order", "Pesanan")}</p>
                    <ul className="mt-1 space-y-0.5 text-sm">
                      {detail.data.lines.map((l) => (
                        <li key={l.id} className="flex justify-between gap-2">
                          <span className="min-w-0">{l.qty} × {l.name_snapshot}</span>
                          <span className="shrink-0 tabular-nums">{fmtRM(l.line_total_cents)}</span>
                        </li>
                      ))}
                    </ul>
                    <div className="border-border mt-2 space-y-0.5 border-t pt-2 text-sm">
                      <p className="flex justify-between"><span>{L("Subtotal", "Subjumlah")}</span><span className="tabular-nums">{fmtRM(detail.data.order.subtotal_cents)}</span></p>
                      <p className="flex justify-between"><span>{L("Shipping", "Penghantaran")}</span><span className="tabular-nums">{fmtRM(detail.data.order.shipping_cents)}</span></p>
                      <p className="flex justify-between font-semibold"><span>{L("Total payable", "Jumlah perlu dibayar")}</span><span className="tabular-nums">{fmtRM(detail.data.order.total_cents)}</span></p>
                    </div>
                  </div>
                  {detail.data.allocations.length > 0 && (
                    <div className={insetCard}>
                      <p className={fieldLabel}>{L("Bank transaction allocated", "Transaksi bank diperuntukkan")}</p>
                      {detail.data.allocations.map((a) => (
                        <div key={a.id} className="mt-1 text-xs">
                          <p className="font-mono">{a.bank_reference} · {fmtRM(a.amount_cents)}</p>
                          <p className="text-muted-foreground">{a.receiving_account} · {a.bank_time}</p>
                          <p className="text-muted-foreground">{L("Verified by", "Disahkan oleh")} {a.verified_by_name ?? "-"} · {mytDateTime(a.verified_at)}</p>
                          {/* the allocation note is typed into a textarea, so what was typed on several lines is shown on several lines */}
                          {a.note && <p className="mt-0.5 whitespace-pre-line">{a.note}</p>}
                        </div>
                      ))}
                    </div>
                  )}
                  <div className={insetCard}>
                    <p className={fieldLabel}>{L("History", "Sejarah")}</p>
                    <ul className="mt-1 space-y-1 text-xs">
                      {detail.data.events.map((e) => (
                        <li key={e.id}>
                          <span className="text-muted-foreground tabular-nums">{mytDateTime(e.created_at)}</span>{" "}
                          <span className="font-medium">{e.action.replace(/_/g, " ")}</span>
                          {e.from_state && e.to_state && e.from_state !== e.to_state && <span className="text-muted-foreground"> · {e.from_state} → {e.to_state}</span>}
                          {e.actor_name && <span className="text-muted-foreground"> · {e.actor_name}</span>}
                          {e.actor_kind === "integration" && <span className="text-muted-foreground"> · {L("via Telegram", "melalui Telegram")}</span>}
                          {e.reason && <span className="block">{e.reason}</span>}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
                {/* right: the evidence and the decision */}
                <div className="space-y-3">
                  <div className={insetCard}>
                    <div className="flex items-center justify-between gap-2">
                      <p className={fieldLabel}>{L("Receipt (customer evidence)", "Resit (bukti pelanggan)")}</p>
                      <span className="text-muted-foreground text-[11px]">{detail.data.receipts.length} {L("uploaded", "dimuat naik")}</span>
                    </div>
                    <div className="mt-2"><ReceiptView r={detail.data.receipts[0] ?? null} ocrAvailable={detail.data.ocr_available} /></div>
                    {detail.data.receipts.length > 1 && (
                      <details className="mt-2">
                        <summary className="cursor-pointer text-xs">{L(`${detail.data.receipts.length - 1} earlier upload(s)`, `${detail.data.receipts.length - 1} muat naik terdahulu`)}</summary>
                        <div className="mt-2 space-y-3">
                          {detail.data.receipts.slice(1).map((r) => (
                            <div key={r.id}>
                              {r.reject_reason && <p className="text-danger text-xs">{L("Rejected", "Ditolak")}: {r.reject_reason}</p>}
                              <ReceiptView r={r} ocrAvailable={detail.data!.ocr_available} />
                            </div>
                          ))}
                        </div>
                      </details>
                    )}
                  </div>
                  {can.verify && ["awaiting_payment", "awaiting_review", "clarification_required"].includes(detail.data.order.payment_state) && (
                    <div className={insetCard}>
                      <p className={fieldLabel}>{L("Verify against the bank", "Sahkan dengan bank")}</p>
                      <div className="mt-2">
                        {/* key: a new order id must reset the form, or the
                            reference typed for the previous order would sit
                            in the field for this one. */}
                        <ApproveForm key={detail.data.order.id} detail={detail.data} defaultAccount={detail.data.receiving_account ?? ""} busy={busy} onSubmit={(v) => void verify(v)} />
                      </div>
                    </div>
                  )}
                  <div className="flex flex-wrap gap-1.5">
                    {can.order && ["awaiting_payment", "awaiting_review"].includes(detail.data.order.payment_state) && (
                      <button type="button" className={btnSm} disabled={busy} onClick={() => void clarify(detail.data!.order.id)}>{L("Request clarification", "Minta penjelasan")}</button>
                    )}
                    {can.order && detail.data.receipts[0] && detail.data.receipts[0].state === "submitted" && (
                      <button type="button" className={btnSm} disabled={busy} onClick={() => void rejectReceipt(detail.data!.receipts[0]!.id)}>{L("Reject this receipt", "Tolak resit ini")}</button>
                    )}
                    {can.order && detail.data.order.order_state !== "cancelled" && (
                      <button type="button" className={btnSm} disabled={busy} onClick={async () => {
                        const r = await prompt({ title: L("Cancel the order?", "Batalkan pesanan?"), label: L("Reason", "Sebab"), required: true, variant: "danger" });
                        if (r?.value.trim()) await post(`/orders/${detail.data!.order.id}/cancel`, { reason: r.value.trim() }, ["Cancelled", "Dibatalkan"]);
                      }}>{L("Cancel the order", "Batalkan pesanan")}</button>
                    )}
                    {can.pack && detail.data.order.payment_state === "verified" && detail.data.order.fulfilment_state !== "shipped" && detail.data.exceptions.filter((e) => e.state === "open").length === 0 && (
                      <button type="button" className={btnSmPrimary} disabled={busy} onClick={() => void ship(detail.data!.order.id)}>{L("Record shipment", "Rekod penghantaran")}</button>
                    )}
                  </div>
                  {detail.data.order.payment_state !== "verified" && (
                    <p className="text-muted-foreground text-xs">
                      {L("This order cannot be packed until a reviewer has found the transaction in the bank. A receipt on file changes nothing by itself.",
                         "Pesanan ini tidak boleh dibungkus sehingga penyemak menemui transaksi dalam bank. Resit yang ada tidak mengubah apa-apa dengan sendirinya.")}
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}
        </Sheet>
      )}

      {sheet === "new_order" && (
        <Sheet title={L("New order", "Pesanan baharu")} sub={L("Priced on the server", "Dinilai di pelayan")} onClose={() => setSheet(null)}>
          <OrderForm busy={busy} onSubmit={async (v) => { if (await post("/orders", v, ["Order created", "Pesanan dicipta"])) setSheet(null); }} />
        </Sheet>
      )}
      {sheet === "new_customer" && (
        <Sheet title={L("Add a customer", "Tambah pelanggan")} onClose={() => setSheet(null)}>
          <NewCustomerForm busy={busy} onSubmit={async (v) => { if (await post("/customers", v, ["Customer added", "Pelanggan ditambah"])) setSheet(null); }} />
        </Sheet>
      )}
    </div>
  );
}

/** Module scope: holds inputs. */
function NewCustomerForm({ busy, onSubmit }: { busy: boolean; onSubmit: (v: { name: string; phone: string; email: string }) => void }) {
  const [name, setName] = useState(""); const [phone, setPhone] = useState(""); const [email, setEmail] = useState("");
  return (
    <div className="space-y-3">
      <label className="block"><span className={fieldLabel}>{L("Name", "Nama")}</span><input className={`${inputClass} w-full`} value={name} onChange={(e) => setName(e.target.value)} /></label>
      <label className="block"><span className={fieldLabel}>{L("Phone", "Telefon")}</span><input className={`${inputClass} w-full`} value={phone} onChange={(e) => setPhone(e.target.value)} /></label>
      <label className="block"><span className={fieldLabel}>{L("Email (optional)", "E-mel (pilihan)")}</span><input className={`${inputClass} w-full`} value={email} onChange={(e) => setEmail(e.target.value)} /></label>
      <p className="text-muted-foreground text-xs">{L("New customers start on retail pricing. Agent and stockist categories are assigned by the owner.", "Pelanggan baharu bermula dengan harga runcit. Kategori ejen dan stokis ditetapkan oleh pemilik.")}</p>
      <button type="button" className={btnSmPrimary} disabled={busy || !name.trim()} onClick={() => onSubmit({ name: name.trim(), phone: phone.trim(), email: email.trim() })}>
        {busy ? <Skel className="inline-block h-3 w-16" /> : L("Add", "Tambah")}
      </button>
    </div>
  );
}

/** Module scope: its own read and its own inputs. */
function CatalogueScreen({ canAdmin, busy, post }: { canAdmin: boolean; busy: boolean; post: (p: string, b: unknown, d: [string, string]) => Promise<boolean> }) {
  const cat = useCachedApi<{
    products: { id: number; sku: string; name: string; flavour: string | null; unit_price_cents: number; is_active: number; stock: number | null; reserved: number; inventory_item_id: number | null }[];
    packages: { id: number; code: string; name: string; eligibility: string; min_qty: number; price_cents: number; is_active: number }[];
    inventory_items: { id: number; sku: string; name: string; stock: number }[];
  }>("/staff/hankeis/catalogue", true, ["hankeis"]);
  return (
    <>
      <section className={card}>
        <PanelTitle icon="inventory">{L("Products", "Produk")}</PanelTitle>
        <p className="text-muted-foreground mt-1 text-xs">{L("Stock is the portal's own inventory item - one number, one place. Available is stock minus live reservations.", "Stok ialah item inventori portal - satu nombor, satu tempat. Tersedia ialah stok tolak tempahan aktif.")}</p>
        {!cat.data ? <SkelRows rows={3} className="mt-3" /> : (
          <ul className="divide-border mt-3 divide-y">
            {cat.data.products.map((p) => (
              <li key={p.id} className={listRow}>
                <span className="min-w-0 text-sm">
                  {p.name}{p.flavour ? ` · ${p.flavour}` : ""}
                  <span className="text-muted-foreground ml-2 font-mono text-[11px]">{p.sku}</span>
                  <span className="text-muted-foreground mt-0.5 block text-[11px]">
                    {p.inventory_item_id == null ? L("not stock-tracked", "tidak dijejak stok")
                      : L(`${(p.stock ?? 0) - p.reserved} available · ${p.stock ?? 0} in stock, ${p.reserved} reserved`, `${(p.stock ?? 0) - p.reserved} tersedia · ${p.stock ?? 0} dalam stok, ${p.reserved} ditempah`)}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-1.5">
                  <span className="text-sm font-semibold tabular-nums">{fmtRM(p.unit_price_cents)}</span>
                  <span className={p.is_active ? chipSmSuccess : chipSmNeutral}>{p.is_active ? L("active", "aktif") : L("off", "mati")}</span>
                  {canAdmin && <button type="button" className={btnSm} disabled={busy} onClick={() => void post(`/products/${p.id}`, { is_active: !p.is_active }, ["Updated", "Dikemas kini"])}>{p.is_active ? L("Hide", "Sembunyi") : L("Show", "Papar")}</button>}
                </span>
              </li>
            ))}
            {cat.data.products.length === 0 && <li className="text-muted-foreground py-3 text-sm">{L("No products yet. The owner adds them in Settings.", "Tiada produk lagi.")}</li>}
          </ul>
        )}
      </section>
      <section className={card}>
        <PanelTitle icon="package">{L("Agent and stockist packages", "Pakej ejen dan stokis")}</PanelTitle>
        <p className="text-muted-foreground mt-1 text-xs">{L("Eligibility is enforced on the server for every quote and every order. A customer cannot put themselves on a privileged price.", "Kelayakan dikuatkuasakan di pelayan untuk setiap sebut harga dan pesanan. Pelanggan tidak boleh meletakkan diri pada harga istimewa.")}</p>
        {!cat.data ? <SkelRows rows={2} className="mt-3" /> : (
          <ul className="divide-border mt-3 divide-y">
            {cat.data.packages.map((p) => (
              <li key={p.id} className={listRow}>
                <span className="min-w-0 text-sm">{p.name}<span className="text-muted-foreground ml-2 font-mono text-[11px]">{p.code}</span>
                  <span className="text-muted-foreground mt-0.5 block text-[11px]">{L(`minimum ${p.min_qty}`, `minimum ${p.min_qty}`)}</span></span>
                <span className="flex shrink-0 items-center gap-1.5">
                  <span className={chipSmInfo}>{p.eligibility}</span>
                  <span className="text-sm font-semibold tabular-nums">{fmtRM(p.price_cents)}</span>
                </span>
              </li>
            ))}
            {cat.data.packages.length === 0 && <li className="text-muted-foreground py-3 text-sm">{L("No packages yet.", "Tiada pakej lagi.")}</li>}
          </ul>
        )}
      </section>
    </>
  );
}

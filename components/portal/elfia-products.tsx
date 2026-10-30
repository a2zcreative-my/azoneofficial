"use client";

/* v1.235.0 - ELFIA STORE 2.0: the product table and the product drawer
   (the owner's brief, 30-10-2026; claude/ELFIA-STORE-AUDIT.md). Answers:
   three tabs; one explicit Save in the drawer; price, discount and publish
   for the CEO, COO and super admin (descriptions, collections and photos
   stay with everyone who has Inventory); the Inventory tab keeps its own
   editor.

   ONE PRODUCT RECORD: every row here IS an Inventory item; nothing is
   copied, and stock is read-only (Inventory owns it). The drawer saves
   through the SAME two routes as before - PATCH /inventory/:id/bridge
   (publish, web price) and PATCH /inventory/:id/elfia (collection,
   description, discount) - only for the fields that changed; the server
   re-checks every one.

   "Customer pays" is the FEED's rule (worker/src/bridge-feed.ts): web price
   (or list price) minus a discount that is below it and not on an ended
   flash sale. The panel cannot import worker code, so this is a second
   spelling, held to the first by tests/input-truth.mjs. */

import { useEffect, useState } from "react";
import { AppIcon } from "@/components/ui/app-icon";
import { SideDrawer } from "@/components/ui/side-drawer";
import { Skel } from "@/components/ui/skeleton";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useSaveToast } from "@/components/ui/save-toast";
import { makeApi } from "@/lib/api";
import { rm as rmBare } from "@/lib/format";
import { getLang } from "@/lib/i18n";
import { btnClass, btnSm, chipNeutral, chipSuccess, chipWarn, chipInfo, inputClass } from "@/lib/ui-styles";
import css from "./elfia-store.module.css";

const api = makeApi("/staff");
const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);
export const photoUrl = (key: string) => `/api/v1/media/file/${key}`;
/** Who changes what the live shop charges or shows - must stay equal to
    PERMS.elfia_publish in worker/src/permissions.ts (tests/elfia-store.mjs). */
export const ELFIA_PUBLISH_ROLES: readonly string[] = ["super_admin", "ceo", "coo"];

export interface ElfiaItem {
  id: number;
  sku: string;
  name: string;
  stock: number;
  status: string;
  unit_price_cents?: number | null;
  bridge_enabled?: number | null;
  elfia_price_cents?: number | null;
  elfia_category?: string | null;
  elfia_description?: string | null;
  elfia_image_key?: string | null;
  elfia_image_updated_at?: string | null;
  elfia_discount_cents?: number | null;
  elfia_flash_until?: string | null;
}

/** A flash deadline in Malaysia time, said so (v1.139.0). */
export const flashWhen = (ms: number): string => {
  const d = new Date(ms + 8 * 3600 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getUTCDate())}-${p(d.getUTCMonth() + 1)}-${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} MYT`;
};

/** What the shop charges for one item, by the feed's own rule. */
export function priceState(it: ElfiaItem) {
  const base = it.elfia_price_cents ?? it.unit_price_cents ?? 0;
  const disc = it.elfia_discount_cents ?? 0;
  const raw = it.elfia_flash_until;
  /* SQLite writes "2026-09-09 18:00:00" - no T, no zone. Read as UTC,
     exactly as the feed reads it. */
  const at = typeof raw === "string" && raw.trim() !== ""
    ? Date.parse(raw.includes("T") ? raw : `${raw.replace(" ", "T")}Z`)
    : NaN;
  const ended = Number.isFinite(at) && at <= Date.now();
  const running = Number.isFinite(at) && at > Date.now();
  const tooBig = disc > 0 && base > 0 && disc >= base;
  const live = disc > 0 && disc < base && !ended;
  return { base, disc, at, ended, running, tooBig, live, pays: live ? base - disc : base };
}

/** The one line that says what the customer is charged - and why, when the
    stored discount does not apply. */
export function PaysLine({ it }: { it: ElfiaItem }) {
  const { base, disc, at, ended, running, tooBig, live } = priceState(it);
  if (base <= 0) return <span className={css.warn}>{L("No price - not sold online", "Tiada harga - tidak dijual dalam talian")}</span>;
  if (disc > 0 && disc < base) {
    if (ended) {
      return (
        <span className={css.warn} title={L("The feed stops applying a discount once its flash deadline has passed - the shop charges the full price.", "Suapan berhenti mengenakan diskaun apabila tarikh tamat jualan kilat berlalu - kedai mengenakan harga penuh.")}>
          {L(`Flash sale ended ${flashWhen(at)} - the shop charges RM ${rmBare(base)}, not RM ${rmBare(base - disc)}.`,
             `Jualan kilat tamat ${flashWhen(at)} - kedai mengenakan RM ${rmBare(base)}, bukan RM ${rmBare(base - disc)}.`)}
        </span>
      );
    }
  }
  if (tooBig) return <span className={css.warn}>{L(`Discount not below the price - the shop charges RM ${rmBare(base)}`, `Diskaun tidak di bawah harga - kedai mengenakan RM ${rmBare(base)}`)}</span>;
  if (!live) return <span className={css.payPlain}>RM {rmBare(base)}</span>;
  return (
    <span className={css.payOk}>
      RM {rmBare(base - disc)} <s className={css.was}>RM {rmBare(base)}</s>
      {running && <span className={css.flash}>{L(`· flash until ${flashWhen(at)}`, `· kilat hingga ${flashWhen(at)}`)}</span>}
    </span>
  );
}

/** Where a product's last change stands with the store. */
export type SyncState = "none" | "waiting" | "read";
export const syncOf = (sku: string, changed: Record<string, string> | null, lastRead: string | null): SyncState => {
  const at = changed?.[sku];
  if (!at) return "none";
  return lastRead && lastRead.slice(0, 19) > at ? "read" : "waiting"; // = /elfia/activity's rule
};
export function SyncChip({ state }: { state: SyncState }) {
  if (state === "none") return null;
  return state === "read"
    ? <span className={chipSuccess} title={L("The store has read the feed since this product last changed", "Kedai telah membaca suapan sejak produk ini berubah")}>{L("Read by the store", "Dibaca kedai")}</span>
    : <span className={chipInfo} title={L("Saved here; the store has not read the feed since", "Disimpan di sini; kedai belum membaca suapan sejak itu")}>{L("Waiting for the store", "Menunggu kedai")}</span>;
}

export function StatusChip({ it }: { it: ElfiaItem }) {
  const on = (it.bridge_enabled ?? 0) === 1;
  if (on && it.status === "discontinued") return <span className={chipWarn} title={L("Ticked, but discontinued items are left out of the shop", "Ditanda, tetapi barang dihentikan tidak dihantar ke kedai")}>{L("Published · left out", "Diterbitkan · dikecualikan")}</span>;
  return on ? <span className={chipSuccess}>{L("Published", "Diterbitkan")}</span> : <span className={chipNeutral}>{L("Not on the store", "Tiada di kedai")}</span>;
}

/* ------------------------------------------------------------------ */
/** The searchable product table (desktop) and cards (phone). */
export function ProductTable({ rows, picked, setPicked, onEdit, changed, lastRead, selectable }: {
  rows: ElfiaItem[]; picked: Set<number>; setPicked: (f: (p: Set<number>) => Set<number>) => void;
  onEdit: (id: number) => void; changed: Record<string, string> | null; lastRead: string | null; selectable: boolean;
}) {
  const tick = (id: number, on: boolean) => setPicked((prev) => { const n = new Set(prev); if (on) n.add(id); else n.delete(id); return n; });
  return (
    <>
      <div className={`${css.tableWrap} ${css.desk}`}>
        <table className={css.table} aria-label={L("ELFIA products", "Produk ELFIA")}>
          <thead><tr>
            {selectable && <th className={css.tick}><span className={css.srOnly}>{L("Select", "Pilih")}</span></th>}
            <th>{L("Product", "Produk")}</th><th>{L("Collection", "Koleksi")}</th>
            <th className={css.num}>{L("Web price", "Harga web")}</th><th className={css.num}>{L("Discount", "Diskaun")}</th>
            <th>{L("Customer pays", "Pelanggan bayar")}</th><th className={css.num}>{L("Stock", "Stok")}</th>
            <th>{L("Status", "Status")}</th><th><span className={css.srOnly}>{L("Edit", "Sunting")}</span></th>
          </tr></thead>
          <tbody>
            {rows.map((it) => {
              const p = priceState(it);
              return (
                <tr key={it.id} className={(it.bridge_enabled ?? 0) === 1 ? "" : css.off}>
                  {selectable && <td className={css.tick}><input type="checkbox" checked={picked.has(it.id)} aria-label={`${L("Select", "Pilih")} ${it.sku}`} onChange={(e) => tick(it.id, e.target.checked)} /></td>}
                  <td>
                    <button type="button" className={css.prod} onClick={() => onEdit(it.id)}>
                      <span className={css.thumb}>{it.elfia_image_key
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <img src={photoUrl(it.elfia_image_key)} alt="" loading="lazy" />
                        : <AppIcon name="package" />}</span>
                      <span className={css.prodText}><strong>{it.name}</strong><span>{L("SKU", "SKU")}: {it.sku}</span></span>
                    </button>
                  </td>
                  <td>{(it.elfia_category ?? "").trim() || <span className={css.muted}>—</span>}</td>
                  <td className={css.num}>{p.base > 0 ? rmBare(p.base) : "—"}{it.elfia_price_cents ? "" : p.base > 0 ? <small className={css.hint}>{L(" list", " senarai")}</small> : null}</td>
                  <td className={css.num}>{p.disc > 0 ? rmBare(p.disc) : "—"}</td>
                  <td className={css.pays}><PaysLine it={it} /></td>
                  <td className={css.num}>{it.stock}</td>
                  <td><span className={css.chips}><StatusChip it={it} /><SyncChip state={syncOf(it.sku, changed, lastRead)} /></span></td>
                  <td><button type="button" className={btnSm} onClick={() => onEdit(it.id)}><AppIcon name="edit" />{L("Edit", "Sunting")}</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <ul className={`${css.cards} ${css.phone}`} aria-label={L("ELFIA products", "Produk ELFIA")}>
        {rows.map((it) => (
          <li key={it.id} className={(it.bridge_enabled ?? 0) === 1 ? "" : css.off}>
            {selectable && <input type="checkbox" className={css.cardTick} checked={picked.has(it.id)} aria-label={`${L("Select", "Pilih")} ${it.sku}`} onChange={(e) => tick(it.id, e.target.checked)} />}
            <button type="button" className={css.card} onClick={() => onEdit(it.id)}>
              <span className={css.thumbLg}>{it.elfia_image_key
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={photoUrl(it.elfia_image_key)} alt="" loading="lazy" />
                : <AppIcon name="package" />}</span>
              <span className={css.prodText}>
                <strong>{it.name}</strong>
                <span>{it.sku}{(it.elfia_category ?? "").trim() ? ` · ${(it.elfia_category ?? "").trim()}` : ""} · {L("stock", "stok")} {it.stock}</span>
                <PaysLine it={it} />
                <span className={css.chips}><StatusChip it={it} /><SyncChip state={syncOf(it.sku, changed, lastRead)} /></span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

/* ------------------------------------------------------------------ */
interface PhotoRow { key: string; at: string; who: string | null; current: boolean }

/** The product drawer: one record, one Save. */
export function ProductDrawer({ item, onClose, canPrice, onSaved, onUpload, onCut, busyPhoto, busyCut }: {
  item: ElfiaItem | null; onClose: () => void; canPrice: boolean; onSaved: () => void;
  onUpload: (it: ElfiaItem, f: File) => Promise<void>; onCut: (it: ElfiaItem) => Promise<void>;
  busyPhoto: number | null; busyCut: number | null;
}) {
  return (
    <SideDrawer open={item !== null} onClose={onClose} wide title={item ? item.name : ""} subtitle={item ? `${L("SKU", "SKU")} ${item.sku} · ${L("Inventory item", "Barang inventori")} #${item.id}` : undefined}>
      {item && (
        <DrawerForm
          /* remounted exactly when a STORED value changes (v1.134.0's lesson:
             a form that keeps a figure the database never heard of lies) */
          key={`${item.id}:${item.bridge_enabled ?? 0}:${item.elfia_price_cents ?? ""}:${item.elfia_discount_cents ?? ""}:${item.elfia_category ?? ""}:${(item.elfia_description ?? "").length}:${item.elfia_image_key ?? ""}`}
          it={item} canPrice={canPrice} onSaved={onSaved} onUpload={onUpload} onCut={onCut} busyPhoto={busyPhoto} busyCut={busyCut} />
      )}
    </SideDrawer>
  );
}

function DrawerForm({ it, canPrice, onSaved, onUpload, onCut, busyPhoto, busyCut }: {
  it: ElfiaItem; canPrice: boolean; onSaved: () => void;
  onUpload: (it: ElfiaItem, f: File) => Promise<void>; onCut: (it: ElfiaItem) => Promise<void>;
  busyPhoto: number | null; busyCut: number | null;
}) {
  const { show: toast, node: toastNode } = useSaveToast();
  const { confirm, node: confirmNode } = useConfirm();
  const [publish, setPublish] = useState((it.bridge_enabled ?? 0) === 1);
  const [price, setPrice] = useState(it.elfia_price_cents ? rmBare(it.elfia_price_cents) : "");
  const [disc, setDisc] = useState(it.elfia_discount_cents ? rmBare(it.elfia_discount_cents) : "");
  const [cat, setCat] = useState((it.elfia_category ?? "").trim());
  const [desc, setDesc] = useState(it.elfia_description ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [photos, setPhotos] = useState<PhotoRow[] | null>(null);
  const [fileEl, setFileEl] = useState<HTMLInputElement | null>(null);

  useEffect(() => {
    const c = new AbortController();
    void api<{ photos: PhotoRow[] }>(`/inventory/${it.id}/elfia/photos`, { signal: c.signal }).then((r) => { if (!c.signal.aborted) setPhotos(r.ok && r.data ? r.data.photos : []); });
    return () => c.abort();
  }, [it.id, it.elfia_image_key]);

  const cents = (s: string) => (s.trim() === "" ? null : Math.round(Number(s) * 100));
  const priceC = cents(price), discC = cents(disc);
  const badNum = (s: string) => s.trim() !== "" && !(Number.isFinite(Number(s)) && Number(s) > 0);
  const nextBase = priceC ?? it.unit_price_cents ?? 0;
  const preview = priceState({ ...it, elfia_price_cents: priceC, elfia_discount_cents: discC });
  const changes = {
    publish: publish !== ((it.bridge_enabled ?? 0) === 1),
    price: priceC !== (it.elfia_price_cents ?? null),
    disc: discC !== (it.elfia_discount_cents ?? null),
    cat: cat.trim() !== (it.elfia_category ?? "").trim(),
    desc: desc.trim() !== (it.elfia_description ?? "").trim(),
  };
  const dirty = Object.values(changes).some(Boolean);
  const invalid = badNum(price) || badNum(disc) || (discC !== null && nextBase > 0 && discC >= nextBase) || cat.trim().length > 40 || desc.trim().length > 2000;

  const save = async () => {
    setBusy(true); setError("");
    const send = async (route: "bridge" | "elfia", body: Record<string, unknown>) => {
      const r = route === "bridge"
        ? await api<{ error?: { message?: string } }>(`/inventory/${it.id}/bridge`, { method: "PATCH", body: JSON.stringify(body) })
        : await api<{ error?: { message?: string } }>(`/inventory/${it.id}/elfia`, { method: "PATCH", body: JSON.stringify(body) });
      if (!r.ok) throw new Error(r.data?.error?.message ?? L("The server refused the change.", "Pelayan menolak perubahan."));
    };
    try {
      const content: Record<string, unknown> = {};
      if (changes.cat) content.category = cat.trim();
      if (changes.desc) content.description = desc.trim();
      const bridge: Record<string, unknown> = {};
      if (changes.publish) bridge.bridge_enabled = publish;
      if (changes.price) bridge.elfia_price = priceC === null ? "" : priceC / 100;
      /* order matters: the server checks a discount against the CURRENT
         price, and a price against the CURRENT discount - so a smaller
         discount goes first, a larger one after the price */
      const discFirst = changes.disc && (discC ?? 0) < (it.elfia_discount_cents ?? 0);
      if (discFirst) await send("elfia", { discount: discC === null ? "" : discC / 100 });
      if (Object.keys(bridge).length) await send("bridge", bridge);
      if (changes.disc && !discFirst) await send("elfia", { discount: discC === null ? "" : discC / 100 });
      if (Object.keys(content).length) await send("elfia", content);
      toast(L("Saved", "Disimpan"), L(`${it.sku} - waiting for the store to read it`, `${it.sku} - menunggu kedai membacanya`));
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      onSaved(); // whatever did save is shown as saved
    } finally { setBusy(false); }
  };
  const restore = async (key: string) => {
    if (!(await confirm({ title: L("Put this photo back?", "Kembalikan foto ini?"), message: L("The current photo is kept and can be put back too. The store downloads this one on its next read.", "Foto semasa disimpan dan boleh dikembalikan juga. Kedai memuat turun foto ini pada bacaan seterusnya."), confirmLabel: L("Restore photo", "Pulihkan foto") }))) return;
    const r = await api<{ error?: { message?: string } }>(`/inventory/${it.id}/elfia/photo/restore`, { method: "POST", body: JSON.stringify({ key }) });
    if (r.ok) { toast(L("Photo restored", "Foto dipulihkan"), it.sku); onSaved(); } else toast(L("Not restored", "Tidak dipulihkan"), r.data?.error?.message ?? "", "notice");
  };
  const removePhoto = async () => {
    if (!(await confirm({ title: L("Take the photo off the shop?", "Buang foto dari kedai?"), message: L("The file is not deleted - it stays in this product's photo history and can be restored.", "Fail tidak dipadam - ia kekal dalam sejarah foto produk ini dan boleh dipulihkan."), confirmLabel: L("Remove from shop", "Buang dari kedai"), variant: "danger" }))) return;
    const r = await api<{ error?: { message?: string } }>(`/inventory/${it.id}/elfia`, { method: "PATCH", body: JSON.stringify({ remove_photo: true }) });
    if (r.ok) { toast(L("Photo removed from the shop", "Foto dibuang dari kedai"), L("kept in the history", "disimpan dalam sejarah")); onSaved(); } else toast(L("Not removed", "Tidak dibuang"), r.data?.error?.message ?? "", "notice");
  };

  return (
    <div className={css.drawer}>
      {toastNode}{confirmNode}
      <section className={css.block} aria-label={L("Product reference", "Rujukan produk")}>
        <dl className={css.dl}>
          <dt>{L("Inventory item", "Barang inventori")}</dt><dd>#{it.id} · {it.sku}</dd>
          <dt>{L("Stock (Inventory)", "Stok (Inventori)")}</dt><dd>{it.stock}{it.status === "discontinued" ? ` · ${L("discontinued - left out of the shop", "dihentikan - tidak dihantar ke kedai")}` : ""}</dd>
          <dt>{L("List price", "Harga senarai")}</dt><dd>{it.unit_price_cents ? `RM ${rmBare(it.unit_price_cents)}` : "—"}</dd>
          <dt>{L("The shop charges now", "Kedai mengenakan sekarang")}</dt><dd><PaysLine it={it} /></dd>
        </dl>
      </section>

      <section className={css.block} aria-label={L("Photo", "Foto")}>
        <p className={css.label}>{L("Photo", "Foto")}</p>
        <div className={css.photoRow}>
          <span className={css.photo}>{it.elfia_image_key
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={photoUrl(it.elfia_image_key)} alt={it.name} />
            : <span>{L("No photo", "Tiada foto")}</span>}</span>
          <span className={css.actions}>
            <input type="file" accept="image/jpeg,image/png,image/webp" hidden ref={setFileEl} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void onUpload(it, f); }} />
            <button type="button" className={btnSm} disabled={busyPhoto === it.id} onClick={() => fileEl?.click()}><AppIcon name="upload" />{busyPhoto === it.id ? L("Uploading…", "Memuat naik…") : it.elfia_image_key ? L("Replace photo", "Ganti foto") : L("Add photo", "Tambah foto")}</button>
            {it.elfia_image_key && <button type="button" className={btnSm} disabled={busyCut !== null} onClick={() => void onCut(it)}><AppIcon name="fix" />{busyCut === it.id ? L("Cutting out…", "Memotong…") : L("Cut out background", "Buang latar")}</button>}
            {it.elfia_image_key && <button type="button" className={btnSm} onClick={() => void removePhoto()}>{L("Remove from shop", "Buang dari kedai")}</button>}
          </span>
        </div>
        <p className={css.hint}>{L("A new photo or a cut-out never deletes the one before - every version stays below and can be put back.", "Foto baharu atau potongan tidak memadam yang sebelumnya - setiap versi kekal di bawah dan boleh dikembalikan.")}</p>
        {photos === null ? <Skel className={css.skel} /> : photos.length > 1 && (
          <ul className={css.history} aria-label={L("Photo history", "Sejarah foto")}>
            {photos.map((p) => (
              <li key={p.key}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photoUrl(p.key)} alt="" loading="lazy" />
                <span>{p.at.slice(0, 16)} UTC{p.who ? ` · ${p.who}` : ""}</span>
                {p.current ? <span className={chipSuccess}>{L("Current", "Semasa")}</span> : <button type="button" className={btnSm} onClick={() => void restore(p.key)}>{L("Restore", "Pulihkan")}</button>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <fieldset className={css.block} disabled={busy}>
        <p className={css.label}>{L("Price on the ELFIA shop", "Harga di kedai ELFIA")}</p>
        {!canPrice && <p className={css.hint}>{L("Price, discount and publishing are changed by the CEO, COO or super admin.", "Harga, diskaun dan penerbitan ditukar oleh CEO, COO atau super admin.")}</p>}
        <div className={css.formRow}>
          <label>{L("Web price (RM)", "Harga web (RM)")}<input type="number" min={0} step="0.01" inputMode="decimal" className={inputClass} disabled={!canPrice} value={price} placeholder={it.unit_price_cents ? rmBare(it.unit_price_cents) : "0.00"} onChange={(e) => setPrice(e.target.value)} aria-label={L("Web price", "Harga web")} /></label>
          <label>{L("Discount (RM off)", "Diskaun (RM potongan)")}<input type="number" min={0} step="0.01" inputMode="decimal" className={inputClass} disabled={!canPrice} value={disc} placeholder="0.00" onChange={(e) => setDisc(e.target.value)} aria-label={L("Discount", "Diskaun")} /></label>
          <label>{L("Customer pays", "Pelanggan bayar")}<output className={css.pays} aria-live="polite">{preview.base > 0 ? `RM ${rmBare(preview.pays)}` : "—"}</output></label>
        </div>
        <p className={css.hint}>{L("Empty web price = the list price. The TikTok live rebate never applies online.", "Harga web kosong = harga senarai. Rebat live TikTok tidak terpakai dalam talian.")}</p>
        {discC !== null && nextBase > 0 && discC >= nextBase && <p role="alert" className={css.error}>{L(`The discount must be below the price (RM ${rmBare(nextBase)}) - otherwise the shop ignores it.`, `Diskaun mesti di bawah harga (RM ${rmBare(nextBase)}) - jika tidak kedai mengabaikannya.`)}</p>}
        {(badNum(price) || badNum(disc)) && <p role="alert" className={css.error}>{L("Prices are positive RM amounts - or empty.", "Harga ialah amaun RM positif - atau kosong.")}</p>}
        {preview.ended && discC !== null && <p className={css.hint}>{L("This product's flash sale has ended, so the shop charges the full price.", "Jualan kilat produk ini telah tamat, jadi kedai mengenakan harga penuh.")}</p>}
        <label className={css.check}><input type="checkbox" checked={publish} disabled={!canPrice} onChange={(e) => setPublish(e.target.checked)} />{L("Published on the ELFIA shop", "Diterbitkan di kedai ELFIA")}</label>
      </fieldset>

      <fieldset className={css.block} disabled={busy}>
        <p className={css.label}>{L("What the customer reads", "Apa yang pelanggan baca")}</p>
        <label>{L("Collection", "Koleksi")}<input className={inputClass} list="elfia-collections" maxLength={40} value={cat} onChange={(e) => setCat(e.target.value)} placeholder={L("e.g. Bawal or Shawl", "cth. Bawal atau Shawl")} aria-label={L("Collection", "Koleksi")} /></label>
        <label>{L("Description", "Penerangan")}<textarea className={inputClass} rows={5} maxLength={2000} value={desc} onChange={(e) => setDesc(e.target.value)} aria-label={L("Description", "Penerangan")} /></label>
      </fieldset>

      {error && <p role="alert" className={css.error}>{error}</p>}
      <div className={css.saveRow}>
        <button type="button" className={btnClass} disabled={!dirty || invalid || busy} onClick={() => void save()}><AppIcon name="save" />{busy ? L("Saving…", "Menyimpan…") : L("Save", "Simpan")}</button>
        <span className={css.hint}>{dirty ? L("Saved here first; the shop shows it once the store reads the feed.", "Disimpan di sini dahulu; kedai memaparkannya apabila kedai membaca suapan.") : L("No changes yet.", "Belum ada perubahan.")}</span>
      </div>
    </div>
  );
}

"use client";

/* v1.45.0 — 🛍 the ELFIA tab (CEO, 25-08-2026: "on portal I want an option
   for me to upload the photo and also to bridge directly to ELFIA … should
   create a new tab for ELFIA on the inventory which is sync inventory, photo
   upload, description and product").

   One place to run the ELFIA web store's catalogue from the portal:

   - the bridge's pulse (same /inventory/bridge-health the Inventory tab
     reads — is the store connected, when did it last report a sale);
   - every inventory item with its FULL ELFIA dressing: published or not,
     web price, collection (bawal/shawl), description, and the product
     photo — uploaded HERE once, not a second time in ELFIA's /admin.

   Where each fact lands, so this panel never lies about what a save means:
   - publish + web price → PATCH /inventory/:id/bridge   (v1.35.0, unchanged)
   - collection + description → PATCH /inventory/:id/elfia        (v1.45.0)
   - photo → POST /inventory/:id/elfia/photo (binary)             (v1.45.0)
   All of it travels on feed A within 5 minutes. A SKU ELFIA has never seen
   is CREATED there from this data and, as of store v1.8.0, goes LIVE on that
   sync: the feed only carries rows with Publish ticked here, so this tick IS
   the decision and the store no longer parks it for a second approval in an
   /admin the CEO cannot open. Un-ticking Publish drops it from the feed and
   out of the shop. The blurb below says exactly that — five minutes, not
   instant, and no second screen to visit.

   House rules kept: checkbox saves at once, text saves on blur, every
   mutation through api()/csrfFetch (CSRF), every string L()-bilingual,
   photos compressed client-side before upload (free-tier R2). */

import { useCallback, useEffect, useRef, useState } from "react";
import { makeApi, csrfFetch } from "@/lib/api";
import { useSaveToast } from "@/components/ui/save-toast";
import { compressImage } from "@/lib/compress-image";
import { card, inputClass, btnSm, chipSuccess, chipNeutral, chipWarn } from "@/lib/ui-styles";
import { rm as rmBare } from "@/lib/format";
import { getLang } from "@/lib/i18n";

const api = makeApi("/staff");
const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);

interface ElfiaItem {
  id: number;
  sku: string;
  name: string;
  stock: number;
  status: string;
  unit_price_cents?: number | null;
  bridge_enabled?: number | null;
  elfia_price_cents?: number | null;
  /* v1.45.0 (0086) */
  elfia_category?: string | null;
  elfia_description?: string | null;
  elfia_image_key?: string | null;
  elfia_image_updated_at?: string | null;
  elfia_discount_cents?: number | null; // v1.46.0
}

interface Slide { // v1.46.0 — one hero-carousel slide
  id: number;
  image_key: string;
  image_updated_at: string;
  title?: string | null;
  subtitle?: string | null;
  sort: number;
  active: number;
  /* v1.47.0 — framing. Per cent of the photo that must stay visible when
     the shop crops it, and whether it crops at all. Optional because a
     worker published before 0088 does not send them. */
  focus_x?: number | null;
  focus_y?: number | null;
  fit?: string | null;
}

interface BridgeHealth {
  key_configured: boolean;
  last_event_at?: string | null;
  last_poll_at?: string | null;
  applied_24h: number;
  unknown_24h: number;
  unknown: { sku: string; n: number; last_at: string }[];
  pending_migration?: boolean;
  unavailable?: boolean;
}

/** The photo as the media route serves it. Key lives under uploads/elfia/ —
    the public prefix — so this same URL is what the feed hands the store. */
const photoUrl = (key: string) => `/api/v1/media/file/${key}`;

/* v1.47.0 — framing, read defensively: an api worker published before 0088
   sends neither field, and the honest answer then is the middle of the
   photo filling the banner, which is exactly what the shop already does. */
const focusOf = (sl: Slide): { x: number; y: number } => ({
  x: typeof sl.focus_x === "number" && Number.isFinite(sl.focus_x) ? Math.min(100, Math.max(0, sl.focus_x)) : 50,
  y: typeof sl.focus_y === "number" && Number.isFinite(sl.focus_y) ? Math.min(100, Math.max(0, sl.focus_y)) : 50,
});
const fitOf = (sl: Slide): "cover" | "contain" => (sl.fit === "contain" ? "contain" : "cover");

export function ElfiaStorePanel() {
  const [items, setItems] = useState<ElfiaItem[]>([]);
  const [slides, setSlides] = useState<Slide[] | null>(null); // null = 0087 pending or loading
  const [busySlide, setBusySlide] = useState(false);
  const [health, setHealth] = useState<BridgeHealth | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busyPhoto, setBusyPhoto] = useState<number | null>(null);
  const [openDesc, setOpenDesc] = useState<Record<number, boolean>>({});
  const { show: toast, node: toastNode } = useSaveToast();
  const fileRefs = useRef<Record<number, HTMLInputElement | null>>({});

  const load = useCallback(async () => {
    const [i, bh, sl] = await Promise.all([
      api<{ items: ElfiaItem[] }>(`/inventory`),
      api<BridgeHealth>(`/inventory/bridge-health`),
      api<{ slides: Slide[] }>(`/elfia/slides`),
    ]);
    if (i.data?.items) {
      setItems(i.data.items.map((x) => ({
        ...x, sku: x.sku ?? "", name: x.name ?? "", stock: Number(x.stock) || 0, status: x.status ?? "",
      })));
    }
    /* Same rule as the Inventory tab (v1.38.1): only a real payload counts
       as health — an error body must not read as "key not set". */
    setHealth(
      bh.ok && bh.data && typeof (bh.data as BridgeHealth).key_configured === "boolean"
        ? (bh.data as BridgeHealth)
        : { unavailable: true, key_configured: false, applied_24h: 0, unknown_24h: 0, unknown: [] },
    );
    setSlides(sl.ok && sl.data?.slides ? sl.data.slides : null);
    setLoaded(true);
  }, []);
  useEffect(() => { void load(); }, [load]);

  /* Published rows first — they are the shop — then A→Z by SKU. */
  const sorted = [...items].sort((a, b) =>
    ((b.bridge_enabled ?? 0) - (a.bridge_enabled ?? 0)) ||
    a.sku.localeCompare(b.sku, undefined, { numeric: true }));
  const published = items.filter((x) => (x.bridge_enabled ?? 0) === 1);
  const missingPhoto = published.filter((x) => !x.elfia_image_key);
  const migrationPending = loaded && items.length > 0 && items.every((x) => x.elfia_image_key === undefined);

  const setBridge = async (it: ElfiaItem, patch: Record<string, unknown>, saved: string) => {
    const res = await api<{ error?: { message?: string } }>(`/inventory/${it.id}/bridge`, {
      method: "PATCH", body: JSON.stringify(patch),
    });
    if (!res.ok) { toast(L("Not saved", "Tidak disimpan"), res.data?.error?.message ?? L("Update failed", "Kemas kini gagal"), "notice"); return; }
    toast(L("Saved", "Disimpan"), saved);
    void load();
  };

  const setElfia = async (it: ElfiaItem, patch: Record<string, unknown>, saved: string) => {
    const res = await api<{ error?: { message?: string } }>(`/inventory/${it.id}/elfia`, {
      method: "PATCH", body: JSON.stringify(patch),
    });
    if (!res.ok) { toast(L("Not saved", "Tidak disimpan"), res.data?.error?.message ?? L("Update failed", "Kemas kini gagal"), "notice"); return; }
    toast(L("Saved", "Disimpan"), saved);
    void load();
  };

  const uploadPhoto = async (it: ElfiaItem, file: File) => {
    setBusyPhoto(it.id);
    try {
      /* Compressed like every other upload (free-tier R2) — and the result
         is JPEG, which the ELFIA store accepts. The 5 MB check the worker
         runs is the store's own limit, mirrored so a photo that "saved"
         here can never be refused over there. */
      const blob = await compressImage(file);
      const res = await csrfFetch(`/api/v1/staff/inventory/${it.id}/elfia/photo`, {
        method: "POST",
        headers: { "Content-Type": blob.type || file.type || "image/jpeg" },
        body: blob,
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        toast(L("Not saved", "Tidak disimpan"), j?.error?.message ?? L("Upload failed", "Muat naik gagal"), "notice");
        return;
      }
      toast(L("Photo saved", "Foto disimpan"),
        `${it.sku} — ${L("the store picks it up within 5 minutes", "kedai akan mengambilnya dalam masa 5 minit")}`);
      void load();
    } finally {
      setBusyPhoto(null);
    }
  };

  const uploadSlide = async (file: File, id?: number) => {
    setBusySlide(true);
    try {
      const blob = await compressImage(file);
      const res = await csrfFetch(`/api/v1/staff/elfia/slides${id ? `/${id}` : ""}/photo`, {
        method: "POST",
        headers: { "Content-Type": blob.type || file.type || "image/jpeg" },
        body: blob,
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        toast(L("Not saved", "Tidak disimpan"), j?.error?.message ?? L("Upload failed", "Muat naik gagal"), "notice");
        return;
      }
      toast(L("Slide saved", "Slaid disimpan"), L("the shop's carousel updates within 5 minutes", "karusel kedai dikemas kini dalam 5 minit"));
      void load();
    } finally { setBusySlide(false); }
  };

  const patchSlide = async (id: number, patch: Record<string, unknown>, saved: string) => {
    const res = await api<{ error?: { message?: string } }>(`/elfia/slides/${id}`, {
      method: "PATCH", body: JSON.stringify(patch),
    });
    if (!res.ok) { toast(L("Not saved", "Tidak disimpan"), res.data?.error?.message ?? L("Update failed", "Kemas kini gagal"), "notice"); return; }
    toast(L("Saved", "Disimpan"), saved);
    void load();
  };

  return (
    <div className="space-y-4 md:space-y-6">
      {toastNode}

      {/* ---- the bridge's pulse + what this tab is ---- */}
      <div className={card}>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <span className="font-semibold">{L("ELFIA web store", "Kedai web ELFIA")}</span>
          {health?.unavailable && (
            <span className="text-muted-foreground">
              {L("Bridge status unavailable — deploy azoneofficial-api, then reload.",
                 "Status jambatan tidak tersedia — deploy azoneofficial-api, kemudian muat semula.")}
            </span>
          )}
          {health && !health.unavailable && !health.key_configured && (
            <span className="font-medium text-amber-700 dark:text-amber-400">
              {L("Key not set — the store cannot connect (ELFIA_BRIDGE_KEY)",
                 "Kunci belum ditetapkan — kedai tidak boleh sambung (ELFIA_BRIDGE_KEY)")}
            </span>
          )}
          {health && !health.unavailable && health.key_configured && (
            <>
              <span className={chipSuccess}>{L("Connected", "Bersambung")}</span>
              <span className="text-muted-foreground">
                {L("Published:", "Diterbitkan:")} {published.length}/{items.length}
              </span>
              <span className="text-muted-foreground">
                {L("Last sale reported:", "Jualan terakhir dilaporkan:")}{" "}
                {health.last_event_at ? health.last_event_at.slice(0, 16) : L("never", "belum ada")}
              </span>
            </>
          )}
        </div>
        <p className="text-muted-foreground mt-2 text-xs">
          {/* v1.47.0 — this used to promise a second approval step in the
              store's own admin. That step is gone (store v1.8.0): ticking
              Publish HERE is the decision, and the old wording had people
              waiting for a screen that never needed visiting. */}
          {L("Everything on this tab reaches the store on its 5-minute sync: counts, prices, collection, description and photo. Ticking Publish is what puts a product in the shop — a SKU the store has never had is created there and goes live on the next sync. Un-tick it and it leaves the shop.",
             "Semua pada tab ini sampai ke kedai pada penyegerakan 5 minit: kiraan, harga, koleksi, penerangan dan foto. Menanda Publish di sinilah yang meletakkan produk dalam kedai — SKU yang belum ada di kedai akan dicipta dan terus dipaparkan pada penyegerakan berikutnya. Buang tanda itu dan ia hilang dari kedai.")}
        </p>
        {migrationPending && (
          <p className="mt-2 rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs font-medium text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
            {L("Migration 0086 has not reached the database yet — photo, collection and description cannot save. Run: npx wrangler d1 migrations apply azoneofficial --remote",
               "Migrasi 0086 belum sampai ke pangkalan data — foto, koleksi dan penerangan tidak boleh disimpan. Jalankan: npx wrangler d1 migrations apply azoneofficial --remote")}
          </p>
        )}
        {missingPhoto.length > 0 && !migrationPending && (
          <p className="mt-2 text-xs font-medium text-amber-700 dark:text-amber-400">
            {L("No photo yet:", "Belum ada foto:")}{" "}
            {missingPhoto.slice(0, 6).map((x) => x.sku).join(", ")}
            {missingPhoto.length > 6 ? ` +${missingPhoto.length - 6}` : ""} —{" "}
            {L("published items without a photo show a plain placeholder in the shop.",
               "barang diterbitkan tanpa foto memaparkan pemegang tempat kosong di kedai.")}
          </p>
        )}
      </div>

      {/* ---- the hero carousel (v1.46.0) ---- */}
      <div className={card}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-semibold">{L("Homepage carousel", "Karusel halaman utama")}</p>
            <p className="text-muted-foreground mt-0.5 text-xs">
              {L("The big pictures at the top of the shop. The store mirrors this list exactly — remove a slide here and it leaves the shop; no slides at all and the shop shows its built-in campaign photos.",
                 "Gambar besar di bahagian atas kedai. Kedai mencerminkan senarai ini — buang slaid di sini dan ia hilang dari kedai; tiada slaid langsung dan kedai memaparkan foto kempen terbina dalam.")}
            </p>
          </div>
          <label className={`${btnSm} cursor-pointer`}>
            {busySlide ? L("Uploading…", "Memuat naik…") : L("+ Add slide", "+ Tambah slaid")}
            <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void uploadSlide(f); }} />
          </label>
        </div>

        {slides === null && loaded && (
          <p className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs font-medium text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
            {L("Migration 0087 has not reached the database yet — the carousel cannot save. Run: npx wrangler d1 migrations apply azoneofficial --remote",
               "Migrasi 0087 belum sampai ke pangkalan data — karusel tidak boleh disimpan. Jalankan: npx wrangler d1 migrations apply azoneofficial --remote")}
          </p>
        )}
        {slides !== null && slides.length === 0 && (
          <p className="text-muted-foreground mt-3 text-xs">
            {L("No slides yet — the shop is showing its built-in campaign photos. Add one to take over.",
               "Belum ada slaid — kedai memaparkan foto kempen terbina dalam. Tambah satu untuk mengambil alih.")}
          </p>
        )}
        {slides !== null && slides.length > 0 && (
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {slides.map((sl, idx) => (
              <div key={sl.id} className={`rounded-xl border p-2 ${sl.active === 1 ? "border-border" : "border-border/60 opacity-70"}`}>
                {/* v1.47.0 — this box is a TRUE PREVIEW: same 21:9 shape and
                    same framing rules the shop uses, so what is seen here is
                    what a customer sees. Clicking it sets the focus point
                    (the CEO: "I want to adjustable the photo so that I can
                    focus on what I want"); replacing the photo moved to its
                    own button below, because a click now means "focus here". */}
                <div className="bg-secondary relative cursor-crosshair overflow-hidden rounded-lg"
                  title={L("Click the part of the photo that must always be visible",
                           "Klik bahagian foto yang mesti sentiasa kelihatan")}
                  onClick={(e) => {
                    if (fitOf(sl) === "contain") return; // nothing is cropped, so nothing to aim
                    const r = e.currentTarget.getBoundingClientRect();
                    if (r.width === 0 || r.height === 0) return;
                    const x = Math.round(((e.clientX - r.left) / r.width) * 100);
                    const y = Math.round(((e.clientY - r.top) / r.height) * 100);
                    void patchSlide(sl.id, { focus_x: x, focus_y: y }, L("framing saved", "bingkai disimpan"));
                  }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={photoUrl(sl.image_key)} alt=""
                    className={`aspect-[21/9] w-full ${fitOf(sl) === "contain" ? "object-contain" : "object-cover"}`}
                    style={{ objectPosition: `${focusOf(sl).x}% ${focusOf(sl).y}%` }} />
                  {fitOf(sl) !== "contain" && (
                    <span aria-hidden
                      className="pointer-events-none absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-black/30 shadow"
                      style={{ left: `${focusOf(sl).x}%`, top: `${focusOf(sl).y}%` }} />
                  )}
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
                  <label className={`${btnSm} cursor-pointer`}>
                    {L("Change photo", "Tukar foto")}
                    <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
                      onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void uploadSlide(f, sl.id); }} />
                  </label>
                  <label className="flex items-center gap-1"
                    title={L("Show the whole photo instead of filling the banner", "Papar keseluruhan foto dan bukan memenuhi sepanduk")}>
                    <input type="checkbox" checked={fitOf(sl) === "contain"}
                      onChange={(e) => void patchSlide(sl.id, { fit: e.target.checked ? "contain" : "cover" },
                        e.target.checked ? L("showing the whole photo", "memaparkan keseluruhan foto")
                                         : L("filling the banner", "memenuhi sepanduk"))} />
                    {L("Whole photo", "Foto penuh")}
                  </label>
                  {fitOf(sl) !== "contain" && (
                    <span className="text-muted-foreground">
                      {L("click the photo to aim", "klik foto untuk halakan")}
                    </span>
                  )}
                </div>
                <input className="border-input bg-background mt-2 w-full rounded border px-2 py-1 text-xs font-medium"
                  placeholder={L("Big line (optional)", "Baris besar (pilihan)")} defaultValue={sl.title ?? ""} maxLength={120}
                  onBlur={(e) => { const v = e.target.value.trim(); if (v !== (sl.title ?? "")) void patchSlide(sl.id, { title: v }, L("caption saved", "kapsyen disimpan")); }} />
                <input className="border-input bg-background mt-1 w-full rounded border px-2 py-1 text-xs"
                  placeholder={L("Small line (optional)", "Baris kecil (pilihan)")} defaultValue={sl.subtitle ?? ""} maxLength={200}
                  onBlur={(e) => { const v = e.target.value.trim(); if (v !== (sl.subtitle ?? "")) void patchSlide(sl.id, { subtitle: v }, L("caption saved", "kapsyen disimpan")); }} />
                <div className="mt-1.5 flex items-center gap-2 text-xs">
                  <button type="button" className={btnSm} disabled={idx === 0}
                    title={L("Show earlier", "Papar lebih awal")}
                    onClick={() => { const prev = slides[idx - 1]; if (prev) { void patchSlide(sl.id, { sort: prev.sort - 1 }, L("moved up", "dinaikkan")); } }}>
                    ↑
                  </button>
                  <button type="button" className={btnSm} disabled={idx === slides.length - 1}
                    title={L("Show later", "Papar kemudian")}
                    onClick={() => { const nxt = slides[idx + 1]; if (nxt) { void patchSlide(sl.id, { sort: nxt.sort + 1 }, L("moved down", "diturunkan")); } }}>
                    ↓
                  </button>
                  <label className="ml-1 flex items-center gap-1">
                    <input type="checkbox" checked={sl.active === 1}
                      onChange={(e) => void patchSlide(sl.id, { active: e.target.checked },
                        e.target.checked ? L("slide shown", "slaid dipaparkan") : L("slide hidden (kept here)", "slaid disembunyikan (kekal di sini)"))} />
                    {L("Show", "Papar")}
                  </label>
                  <button type="button" className="text-muted-foreground ml-auto underline"
                    onClick={() => void patchSlide(sl.id, { remove: true }, L("slide removed — leaves the shop on the next sync", "slaid dibuang — hilang dari kedai pada penyegerakan seterusnya"))}>
                    {L("remove", "buang")}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ---- the catalogue ---- */}
      <div className={card}>
        <p className="text-sm font-semibold">{L("Products on the ELFIA store", "Produk di kedai ELFIA")}</p>
        <p className="text-muted-foreground mt-0.5 text-xs">
          {L("Tick to publish. Photo, collection and description are what the customer sees on the product page. Prices save on blur; the TikTok live rebate never applies online.",
             "Tanda untuk terbitkan. Foto, koleksi dan penerangan ialah apa yang pelanggan lihat di halaman produk. Harga disimpan selepas blur; rebat live TikTok tidak sekali-kali terpakai dalam talian.")}
        </p>

        {loaded && items.length === 0 && (
          <p className="text-muted-foreground mt-4 text-sm">
            {L("No inventory items yet — add them on the Inventory tab first.",
               "Belum ada barang inventori — tambah di tab Inventori dahulu.")}
          </p>
        )}

        <div className="mt-3 space-y-2">
          {sorted.map((it) => {
            const on = (it.bridge_enabled ?? 0) === 1;
            const cat = it.elfia_category === "shawl" ? "shawl" : it.elfia_category === "bawal" ? "bawal" : "";
            return (
              <div key={it.id}
                className={`rounded-xl border p-3 transition-colors ${on ? "border-border bg-card" : "border-border/60 bg-secondary/30 opacity-80"}`}>
                <div className="flex flex-wrap items-start gap-3">
                  {/* photo — the tap target IS the upload */}
                  <button type="button"
                    className="border-border bg-secondary relative h-20 w-16 shrink-0 overflow-hidden rounded-lg border"
                    title={L("Upload / replace the product photo (JPEG, PNG or WEBP, max 5 MB)",
                             "Muat naik / ganti foto produk (JPEG, PNG atau WEBP, maks 5 MB)")}
                    onClick={() => fileRefs.current[it.id]?.click()}>
                    {it.elfia_image_key ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={photoUrl(it.elfia_image_key)} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <span className="text-muted-foreground flex h-full items-center justify-center px-1 text-center text-[10px] leading-tight">
                        {L("+ photo", "+ foto")}
                      </span>
                    )}
                    {busyPhoto === it.id && (
                      <span className="absolute inset-0 flex items-center justify-center bg-black/40 text-[10px] font-medium text-white">
                        {L("Uploading…", "Memuat naik…")}
                      </span>
                    )}
                  </button>
                  <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
                    ref={(el) => { fileRefs.current[it.id] = el; }}
                    onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void uploadPhoto(it, f); }} />

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs">{it.sku}</span>
                      <span className="text-sm font-medium">{it.name}</span>
                      {on
                        ? <span className={chipSuccess}>{L("Published", "Diterbitkan")}</span>
                        : <span className={chipNeutral}>{L("Not on the store", "Tiada di kedai")}</span>}
                      {on && !it.elfia_image_key && <span className={chipWarn}>{L("no photo", "tiada foto")}</span>}
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
                      <label className="flex items-center gap-1.5">
                        <input type="checkbox" checked={on}
                          onChange={(e) => void setBridge(it, { bridge_enabled: e.target.checked },
                            e.target.checked
                              ? `${it.sku} ${L("now published to the ELFIA store", "kini diterbitkan ke kedai ELFIA")}`
                              : `${it.sku} ${L("withdrawn from the ELFIA store", "ditarik daripada kedai ELFIA")}`)} />
                        {L("Publish", "Terbitkan")}
                      </label>

                      <label className="flex items-center gap-1.5">
                        {L("Web price RM", "Harga web RM")}
                        <input type="number" min={0} step="0.01"
                          className="border-input bg-background w-20 rounded border px-1.5 py-0.5 text-right"
                          placeholder={it.unit_price_cents ? rmBare(it.unit_price_cents) : "0.00"}
                          defaultValue={it.elfia_price_cents ? rmBare(it.elfia_price_cents) : ""}
                          title={L("Empty = the list price. What the ELFIA customer pays.", "Kosong = harga senarai. Yang dibayar pelanggan ELFIA.")}
                          onBlur={(e) => {
                            const raw = e.target.value.trim();
                            const next = raw === "" ? null : Math.round(Number(raw) * 100);
                            if (raw !== "" && (!Number.isFinite(Number(raw)) || Number(raw) <= 0)) {
                              toast(L("Not saved", "Tidak disimpan"), L("Web price must be a positive RM amount — or empty to use the list price", "Harga web mesti amaun RM positif — atau kosong untuk guna harga senarai"), "notice");
                              return;
                            }
                            if (next === (it.elfia_price_cents ?? null)) return;
                            void setBridge(it, { elfia_price: raw === "" ? "" : Number(raw) },
                              next === null
                                ? `${it.sku} — ${L("web price cleared", "harga web dikosongkan")}`
                                : `${it.sku} — ${L("web price", "harga web")} RM ${rmBare(next)}`);
                          }} />
                      </label>

                      <label className="flex items-center gap-1.5">
                        {L("Discount RM", "Diskaun RM")}
                        <input type="number" min={0} step="0.01"
                          className="border-input bg-background w-16 rounded border px-1.5 py-0.5 text-right"
                          placeholder="0"
                          defaultValue={it.elfia_discount_cents ? rmBare(it.elfia_discount_cents) : ""}
                          title={L("Web discount — the shop shows the old price struck through and charges price minus this. Empty = no discount.",
                                    "Diskaun web — kedai memaparkan harga lama dipotong dan mencaj harga tolak jumlah ini. Kosong = tiada diskaun.")}
                          onBlur={(e) => {
                            const raw = e.target.value.trim();
                            const next = raw === "" ? null : Math.round(Number(raw) * 100);
                            if (raw !== "" && (!Number.isFinite(Number(raw)) || Number(raw) <= 0)) {
                              toast(L("Not saved", "Tidak disimpan"), L("Discount must be a positive RM amount — or empty to clear it", "Diskaun mesti amaun RM positif — atau kosong untuk membuangnya"), "notice");
                              return;
                            }
                            if (next === (it.elfia_discount_cents ?? null)) return;
                            void setElfia(it, { discount: raw === "" ? "" : Number(raw) },
                              next === null
                                ? `${it.sku} — ${L("discount cleared", "diskaun dibuang")}`
                                : `${it.sku} — ${L("discount", "diskaun")} RM ${rmBare(next)}`);
                          }} />
                      </label>

                      {(() => {
                        const base = it.elfia_price_cents ?? it.unit_price_cents ?? 0;
                        const disc = it.elfia_discount_cents ?? 0;
                        if (!(disc > 0 && disc < base)) return null;
                        return (
                          <span className="font-medium text-emerald-700 dark:text-emerald-400"
                            title={L("What the shop shows: old price struck through, this charged", "Apa yang kedai papar: harga lama dipotong, ini dicaj")}>
                            {L("Customer pays", "Pelanggan bayar")} RM {rmBare(base - disc)}
                            <s className="text-muted-foreground ml-1 font-normal">RM {rmBare(base)}</s>
                          </span>
                        );
                      })()}

                      <label className="flex items-center gap-1.5">
                        {L("Collection", "Koleksi")}
                        <select className="border-input bg-background rounded border px-1.5 py-0.5"
                          value={cat}
                          title={L("Which ELFIA collection this item belongs to", "Koleksi ELFIA untuk barang ini")}
                          onChange={(e) => void setElfia(it, { category: e.target.value },
                            `${it.sku} — ${e.target.value === "shawl" ? L("Shawl collection", "koleksi Shawl") : e.target.value === "bawal" ? L("Bawal collection", "koleksi Bawal") : L("collection cleared (store defaults to Bawal)", "koleksi dikosongkan (kedai guna Bawal)")}`)}>
                          <option value="">{L("— default (Bawal)", "— lalai (Bawal)")}</option>
                          <option value="bawal">Bawal</option>
                          <option value="shawl">Shawl</option>
                        </select>
                      </label>

                      <span className="text-muted-foreground">
                        {L("Stock", "Stok")} {it.stock}
                      </span>

                      <button type="button" className={btnSm}
                        onClick={() => setOpenDesc((d) => ({ ...d, [it.id]: !d[it.id] }))}>
                        {openDesc[it.id]
                          ? L("Hide description", "Sembunyi penerangan")
                          : it.elfia_description
                            ? L("Edit description", "Sunting penerangan")
                            : L("Add description", "Tambah penerangan")}
                      </button>
                      {it.elfia_image_key && (
                        <button type="button" className="text-muted-foreground underline"
                          onClick={() => void setElfia(it, { remove_photo: true },
                            `${it.sku} — ${L("photo removed (the store keeps showing its current one until you upload a new photo)", "foto dibuang (kedai terus memaparkan yang sedia ada sehingga foto baharu dimuat naik)")}`)}>
                          {L("remove photo", "buang foto")}
                        </button>
                      )}
                    </div>

                    {openDesc[it.id] && (
                      <div className="mt-2">
                        <textarea className={`${inputClass} h-20 text-xs`} maxLength={2000}
                          defaultValue={it.elfia_description ?? ""}
                          placeholder={L("What the ELFIA product page says about this item — material, feel, sizing. Saves when you click away; empty keeps the store's own text.",
                                          "Apa yang halaman produk ELFIA katakan tentang barang ini — bahan, rasa, saiz. Disimpan apabila klik di luar; kosong mengekalkan teks kedai sendiri.")}
                          onBlur={(e) => {
                            const next = e.target.value.trim();
                            if (next === (it.elfia_description ?? "").trim()) return;
                            void setElfia(it, { description: next },
                              `${it.sku} — ${next ? L("description saved", "penerangan disimpan") : L("description cleared", "penerangan dikosongkan")}`);
                          }} />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

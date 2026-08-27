"use client";

/* v1.45.0 — 🛍 the ELFIA tab (CEO, 25-08-2026: "on portal I want an option
   for me to upload the photo and also to bridge directly to ELFIA … should
   create a new tab for ELFIA on the inventory which is sync inventory, photo
   upload, description and product").

   One place to run the ELFIA web store's catalogue from the portal:

   - the bridge's pulse (same /inventory/bridge-health the Inventory tab
     reads — is the store connected, when did it last report a sale);
   - every inventory item with its FULL ELFIA dressing: published or not,
     web price, collection (any name she types), description, and the
     product photo — uploaded HERE once, not a second time in ELFIA's
     /admin.

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
import { extractCatalogMap, type ExtractedMap, type PageRuns } from "@/lib/catalog-extract";

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
  zoom?: number | null;   // v1.48.0 — 100 = whole photo visible
  /* v1.50.0 — the cut-out model who steps out of the banner. */
  cutout_key?: string | null;
  cutout_updated_at?: string | null;
  cutout_side?: string | null;
  cutout_scale?: number | null;
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

/* v1.53.0 — the store's answer to "can a customer pay online right now?".
   `ok` is the credential check (the API key reads its collection). It is a
   WEAKER claim than "the last customer could pay", which is why
   last_gateway_error is carried separately: a bill can be refused for
   reasons a collection read never sees. */
interface PayStatus {
  ok?: boolean;
  sandbox?: boolean;
  message?: string;
  warning?: string | null;
  signature_key_set?: boolean;
  last_gateway_error?: string | null;
  last_gateway_hint?: string | null;
  unavailable?: boolean;
}

/** The photo as the media route serves it. Key lives under uploads/elfia/ —
    the public prefix — so this same URL is what the feed hands the store. */
const photoUrl = (key: string) => `/api/v1/media/file/${key}`;

/* ==== v1.55.0 — the shop catalog, uploaded here, priced by the shop ==== */

interface CatStatus {
  live: boolean;
  pending: boolean;
  updated_at: string | null;
  cover_key: string | null;
  unavailable?: boolean;
}

/** What was read out of the chosen PDF, waiting for Upload. */
interface CatDraft {
  file: File;
  map: ExtractedMap;
  cover: Blob | null;
  coverUrl: string | null;
  pages: number;
  matched: number;
  /* v1.56.0 — the labels that matched NO published product, BY NAME. A
     count alone let a typo ("Champange") ship silently priceless; the
     names make the fix obvious — correct the PDF, or rename/publish the
     product — before anything uploads. */
  unmatched_labels: string[];
  prices_detected: number;
  truncated: boolean;
}

/* A browser-side preview of the store's label→product matcher, for the
   "will this work?" moment BEFORE upload. Same rules, same generic-word
   list: a product matches a label when every distinctive word of its name
   appears in the label; the store's verdict is the real one. */
const CAT_GENERIC = new Set(["bawal", "shawl", "chiffon", "lumi", "premium", "by", "elfia"]);
const catTokens = (s: string): string[] =>
  s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
const catLabelMatches = (label: string, names: string[]): boolean => {
  const lt = new Set(catTokens(label));
  /* v1.57.0 — mirror the store's kerning tolerance: display faces can fuse
     words ("lumiMahogany"), so a 3+ character token may also match inside
     the label with its spaces removed. */
  const squashed = label.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, "");
  const has = (t: string) => lt.has(t) || (t.length >= 3 && squashed.includes(t));
  return names.some((n) => {
    const distinct = catTokens(n).filter((t) => !CAT_GENERIC.has(t));
    return distinct.length > 0 && distinct.every(has);
  });
};

/* v1.47.0 — framing, read defensively: an api worker published before 0088
   sends neither field, and the honest answer then is the middle of the
   photo filling the banner, which is exactly what the shop already does. */
const focusOf = (sl: Slide): { x: number; y: number } => ({
  x: typeof sl.focus_x === "number" && Number.isFinite(sl.focus_x) ? Math.min(100, Math.max(0, sl.focus_x)) : 50,
  y: typeof sl.focus_y === "number" && Number.isFinite(sl.focus_y) ? Math.min(100, Math.max(0, sl.focus_y)) : 50,
});
const fitOf = (sl: Slide): "cover" | "contain" => (sl.fit === "contain" ? "contain" : "cover");

/* v1.48.0 — zoom per cent. A slide saved before 0089 has no zoom; the honest
   reading of the old switch is "contain meant pulled all the way back, cover
   meant filled", and 160 is about what fills a 21:9 banner with the portrait
   shots this shop uses. */
const zoomOf = (sl: Slide): number => {
  const z = Math.round(Number(sl.zoom));
  if (Number.isFinite(z) && z >= 100) return Math.min(300, z);
  return fitOf(sl) === "contain" ? 100 : 160;
};

export function ElfiaStorePanel() {
  const [items, setItems] = useState<ElfiaItem[]>([]);
  const [slides, setSlides] = useState<Slide[] | null>(null); // null = 0087 pending or loading
  const [busySlide, setBusySlide] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [health, setHealth] = useState<BridgeHealth | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busyPhoto, setBusyPhoto] = useState<number | null>(null);
  const [openDesc, setOpenDesc] = useState<Record<number, boolean>>({});
  /* v1.52.0 — what delivery costs. Held as the RINGGIT TEXT being typed, not
     as a number: an input that reformats on every keystroke fights whoever
     is using it. It converts to sen on save, and sen is the only unit the
     database and the feed ever see. "" = an empty box, which Save refuses. */
  const [ship, setShip] = useState("");
  const [freeAbove, setFreeAbove] = useState("");
  const [deliverySaved, setDeliverySaved] = useState<{ ship: string; free: string } | null>(null);
  const [busyDelivery, setBusyDelivery] = useState(false);
  /* v1.53.0 — whether customers can actually pay online, and why not. */
  const [pay, setPay] = useState<PayStatus | null>(null);
  const [busyPay, setBusyPay] = useState(false);
  /* v1.54.0 — bulk discount. The CEO: "I want to perform bulk discount
     instead of one by one. but I need to have 1 by 1 update also." So this
     is a SELECTION laid over the list that already exists; every per-item
     box below is untouched. */
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [bulkMode, setBulkMode] = useState<"amount" | "percent">("percent");
  const [bulkValue, setBulkValue] = useState("");
  const [busyBulk, setBusyBulk] = useState(false);
  /* v1.55.0 — the uploadable catalog. `cat` is what the server holds;
     `catDraft` is a chosen file read in this browser, waiting for Upload. */
  const [cat, setCat] = useState<CatStatus | null>(null);
  const [catReading, setCatReading] = useState(false);
  const [catBusy, setCatBusy] = useState(false);
  const [catDraft, setCatDraft] = useState<CatDraft | null>(null);
  const catFileRef = useRef<HTMLInputElement | null>(null);
  /* v1.61.0 — the /catalog hover backdrop (CEO: "this I can upload by
     myself in portal!"). What the server holds; null until loaded. */
  const [backdrop, setBackdrop] = useState<{ key: string | null; url: string | null; unavailable?: boolean } | null>(null);
  const [busyBackdrop, setBusyBackdrop] = useState(false);
  /* v1.58.0 — background cut-out. busyCut: the product being matted, or -1
     while the run-them-all pass works; cutNote narrates the batch. */
  const [busyCut, setBusyCut] = useState<number | null>(null);
  const [cutNote, setCutNote] = useState("");
  const { show: toast, node: toastNode } = useSaveToast();
  const fileRefs = useRef<Record<number, HTMLInputElement | null>>({});

  const load = useCallback(async () => {
    const [i, bh, sl, dv, ct, bd] = await Promise.all([
      api<{ items: ElfiaItem[] }>(`/inventory`),
      api<BridgeHealth>(`/inventory/bridge-health`),
      api<{ slides: Slide[] }>(`/elfia/slides`),
      api<{ shipping_cents: number | null; free_above_cents: number | null }>(`/elfia/delivery`),
      api<CatStatus>(`/elfia/catalog`),
      api<{ key: string | null; url: string | null }>(`/elfia/backdrop`),
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
    /* Blank, not "0.00", when the portal has never set them: the shop is
       then still using its own built-in numbers, and showing 0.00 here would
       claim delivery is free when it is not. */
    if (dv.ok && dv.data) {
      const asRM = (c: number | null) => (typeof c === "number" ? (c / 100).toFixed(2) : "");
      const s = asRM(dv.data.shipping_cents), f = asRM(dv.data.free_above_cents);
      setShip(s); setFreeAbove(f);
      setDeliverySaved({ ship: s, free: f });
    }
    /* An api worker published before v1.55.0 has no /elfia/catalog; the card
       then says to deploy rather than pretending nothing is uploaded. */
    setCat(ct.ok && ct.data && typeof ct.data.live === "boolean" ? ct.data : { live: false, pending: false, updated_at: null, cover_key: null, unavailable: true });
    /* An api worker published before v1.61.0 has no /elfia/backdrop; the
       card then says to deploy rather than pretending nothing is set. */
    setBackdrop(bd.ok && bd.data && "key" in bd.data
      ? { key: bd.data.key, url: bd.data.url }
      : { key: null, url: null, unavailable: true });
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

  /* ==== v1.58.0 — "I just want the model only there" ====
     One click mattes the model out of a product photo (lib/cutout.ts —
     vendored on-device model, no third-party service) and saves it through
     the SAME photo route as any upload, so it reaches the shop like any
     photo change. Nothing anywhere changes until this button is pressed,
     and an already-cut photo is left alone. */
  const cutOne = async (it: ElfiaItem): Promise<"done" | "skipped" | "failed"> => {
    if (!it.elfia_image_key) return "skipped";
    try {
      const blob = await (await fetch(photoUrl(it.elfia_image_key))).blob();
      const bmp = await createImageBitmap(blob);
      const probe = document.createElement("canvas");
      probe.width = bmp.width; probe.height = bmp.height;
      const pctx = probe.getContext("2d", { willReadFrequently: true });
      if (!pctx) return "failed";
      pctx.drawImage(bmp, 0, 0);
      const { hasTransparency, cutoutPhoto } = await import("@/lib/cutout");
      if (hasTransparency(pctx, bmp.width, bmp.height)) return "skipped"; // already a cut-out
      let png = await cutoutPhoto(blob);
      if (png.size > 4_800_000) {
        /* Stay under the 5 MB photo cap: shrink to 1100px wide, plenty for
           the shop's circles. */
        const scale = 1100 / bmp.width;
        const c2 = document.createElement("canvas");
        c2.width = 1100; c2.height = Math.round(bmp.height * scale);
        const ctx2 = c2.getContext("2d");
        if (!ctx2) return "failed";
        ctx2.drawImage(await createImageBitmap(png), 0, 0, c2.width, c2.height);
        const smaller = await new Promise<Blob | null>((res) => c2.toBlob(res, "image/png"));
        if (!smaller) return "failed";
        png = smaller;
      }
      const res = await csrfFetch(`/api/v1/staff/inventory/${it.id}/elfia/photo`, {
        method: "POST", headers: { "Content-Type": "image/png" }, body: png,
      });
      return res.ok ? "done" : "failed";
    } catch {
      return "failed";
    }
  };

  const cutBackground = async (it: ElfiaItem) => {
    setBusyCut(it.id);
    try {
      const r = await cutOne(it);
      if (r === "done") {
        toast(L("Background removed", "Latar dibuang"),
          `${it.sku} — ${L("the model only; the shop picks it up within a minute", "model sahaja; kedai mengambilnya dalam seminit")}`);
        void load();
      } else if (r === "skipped") {
        toast(L("Already cut out", "Sudah dipotong"), it.sku);
      } else {
        toast(L("Could not cut this one", "Tidak dapat dipotong"),
          L("The photo stays as it was — nothing changed.", "Foto kekal seperti sedia ada — tiada perubahan."), "notice");
      }
    } finally { setBusyCut(null); }
  };

  const cutAll = async () => {
    const targets = items.filter((x) => x.elfia_image_key);
    setBusyCut(-1);
    let done = 0, skipped = 0, failed = 0;
    try {
      for (const [i, it] of targets.entries()) {
        setCutNote(`${i + 1}/${targets.length} — ${it.sku}`);
        const r = await cutOne(it);
        if (r === "done") done++; else if (r === "skipped") skipped++; else failed++;
      }
      toast(L("Backgrounds removed", "Latar dibuang"),
        L(`${done} cut out${skipped ? `, ${skipped} already done` : ""}${failed ? `, ${failed} failed (left as they were)` : ""} — the shop picks them up within a minute`,
          `${done} dipotong${skipped ? `, ${skipped} sudah siap` : ""}${failed ? `, ${failed} gagal (kekal sedia ada)` : ""} — kedai mengambilnya dalam seminit`),
        failed ? "notice" : undefined);
      void load();
    } finally { setBusyCut(null); setCutNote(""); }
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

  /* v1.54.0 — apply one discount to everything ticked.
     `clear` is a separate button rather than "enter 0", because 0 and "no
     discount" are different things and a box that means both is a box that
     gets misread. */
  const applyBulk = async (mode: "amount" | "percent" | "clear") => {
    const ids = [...picked];
    if (ids.length === 0) return;
    const value = mode === "clear" ? 0 : Number(bulkValue.trim());
    if (mode !== "clear" && (!Number.isFinite(value) || value <= 0 || (mode === "percent" && value >= 100))) {
      toast(L("Not applied", "Tidak digunakan"),
        mode === "percent"
          ? L("Enter a percentage above 0 and below 100", "Masukkan peratusan melebihi 0 dan kurang daripada 100")
          : L("Enter a positive RM amount", "Masukkan amaun RM positif"), "notice");
      return;
    }
    setBusyBulk(true);
    try {
      const res = await api<{ applied?: string[]; skipped?: { sku: string; why: string }[]; error?: { message?: string } }>(
        `/elfia/bulk-discount`, { method: "POST", body: JSON.stringify({ ids, mode, value }) });
      if (!res.ok) {
        toast(L("Not applied", "Tidak digunakan"), res.data?.error?.message ?? L("Update failed", "Kemas kini gagal"), "notice");
        return;
      }
      const n = res.data?.applied?.length ?? 0;
      const skip = res.data?.skipped ?? [];
      /* Skipped rows are NAMED. A bulk action that quietly leaves some
         products alone is worse than one that refuses — nobody re-checks
         thirty rows afterwards. */
      toast(
        skip.length ? L("Applied, with exceptions", "Digunakan, dengan pengecualian") : L("Applied", "Digunakan"),
        `${n} ${L("product", "produk")}${n === 1 ? "" : "s"}` +
        (skip.length
          ? ` · ${L("skipped", "dilangkau")}: ${skip.slice(0, 4).map((s) => `${s.sku} (${s.why})`).join(", ")}${skip.length > 4 ? ` +${skip.length - 4}` : ""}`
          : ""),
        skip.length ? "notice" : undefined);
      setPicked(new Set());
      void load();
    } finally { setBusyBulk(false); }
  };

  /* v1.53.0 — ask the shop whether online payment is working. Deliberately
     NOT part of the tab's first load: it makes the shop call Billplz, and
     that is a request to somebody else's service on every page view. It runs
     when someone asks. */
  const checkPayment = async () => {
    setBusyPay(true);
    try {
      const res = await api<PayStatus>(`/elfia/payment-status`);
      setPay(res.ok && res.data ? res.data : { unavailable: true, message: L("Could not reach the shop.", "Tidak dapat menghubungi kedai.") });
    } finally { setBusyPay(false); }
  };

  /* v1.52.0 — save what delivery costs.
     Ringgit in the box, SEN on the wire: RM 4.50 -> 450. Rounding happens
     here, once, so a "4.005" typed by accident cannot become a fraction of a
     sen in the database. Both boxes save together because the two numbers
     only mean anything side by side — a delivery charge with no free-delivery
     threshold, or the reverse, is a half-set rule. */
  const rmToSen = (v: string): number | null => {
    const t = v.trim().replace(/^RM\s*/i, "").replace(/,/g, "");
    if (t === "") return null;
    const n = Number(t);
    if (!Number.isFinite(n) || n < 0 || n > 1000) return null;
    return Math.round(n * 100);
  };
  const deliveryDirty = deliverySaved !== null
    && (ship.trim() !== deliverySaved.ship || freeAbove.trim() !== deliverySaved.free);

  const saveDelivery = async () => {
    const s = rmToSen(ship), f = rmToSen(freeAbove);
    if (s === null || f === null) {
      toast(L("Not saved", "Tidak disimpan"),
        L("Enter both amounts in ringgit, between 0 and 1000 — for example 4.50 and 45.00",
          "Masukkan kedua-dua jumlah dalam ringgit, antara 0 dan 1000 — contohnya 4.50 dan 45.00"), "notice");
      return;
    }
    setBusyDelivery(true);
    try {
      const res = await api<{ ok: boolean; error?: { message?: string } }>(`/elfia/delivery`, {
        method: "POST", body: JSON.stringify({ shipping_cents: s, free_above_cents: f }),
      });
      if (!res.ok) {
        toast(L("Not saved", "Tidak disimpan"), res.data?.error?.message ?? L("Update failed", "Kemas kini gagal"), "notice");
        return;
      }
      toast(L("Delivery saved", "Penghantaran disimpan"),
        L("the shop charges this within a minute — press “Update the shop now” to apply it immediately",
          "kedai mengenakan kadar ini dalam seminit — tekan “Kemas kini kedai sekarang” untuk terus digunakan"));
      void load();
    } finally { setBusyDelivery(false); }
  };

  /* v1.48.0 — ask the shop to pull everything on this tab right now instead
     of waiting for its own schedule. Failure is never dramatic: the shop
     updates by itself anyway, and the message says so. */
  const syncShopNow = async () => {
    setSyncing(true);
    const res = await api<{ updated?: number; prices?: number; created?: number; error?: { message?: string } }>(
      `/elfia/sync-now`, { method: "POST", body: "{}" });
    setSyncing(false);
    if (!res.ok) {
      toast(L("Not updated", "Tidak dikemas kini"),
        res.data?.error?.message ?? L("The shop could not be reached. It updates by itself every minute.",
                                      "Kedai tidak dapat dihubungi. Ia mengemas kini sendiri setiap minit."), "notice");
      return;
    }
    const n = (res.data?.prices ?? 0) + (res.data?.updated ?? 0) + (res.data?.created ?? 0);
    toast(L("Shop updated", "Kedai dikemas kini"),
      n > 0 ? L(`${n} change${n === 1 ? "" : "s"} are live now`, `${n} perubahan kini disiarkan`)
            : L("The shop was already up to date", "Kedai memang sudah terkini"));
  };

  /* v1.50.0 — the cut-out PNG. Deliberately NOT run through compressImage:
     that helper draws onto a canvas and exports JPEG, which would flatten
     the transparency this whole feature depends on and paint a white box
     over the banner. It goes up exactly as she made it. */
  const uploadCutout = async (file: File, slideId: number) => {
    if (!/^image\/(png|webp)$/.test(file.type)) {
      toast(L("Wrong kind of file", "Jenis fail salah"),
        L("A cut-out must be a PNG (or WEBP) with a see-through background. A JPEG cannot be see-through and would show as a white box.",
          "Potongan mesti PNG (atau WEBP) dengan latar lutsinar. JPEG tidak boleh lutsinar dan akan jadi kotak putih."), "notice");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast(L("Too big", "Terlalu besar"),
        L("The cut-out is over 5 MB — please export it smaller.", "Potongan melebihi 5 MB — sila eksport lebih kecil."), "notice");
      return;
    }
    setBusySlide(true);
    const res = await csrfFetch(`/api/v1/staff/elfia/slides/${slideId}/cutout`, {
      method: "POST", headers: { "Content-Type": file.type }, body: file,
    });
    setBusySlide(false);
    if (!res.ok) {
      const j = await res.json().catch(() => null) as { error?: { message?: string } } | null;
      toast(L("Not uploaded", "Tidak dimuat naik"), j?.error?.message ?? L("Upload failed", "Muat naik gagal"), "notice");
      return;
    }
    toast(L("Saved", "Disimpan"), L("the model now steps out of the banner", "model kini keluar dari sepanduk"));
    void load();
  };

  const patchSlide = async (id: number, patch: Record<string, unknown>, saved: string) => {
    const res = await api<{ error?: { message?: string } }>(`/elfia/slides/${id}`, {
      method: "PATCH", body: JSON.stringify(patch),
    });
    if (!res.ok) { toast(L("Not saved", "Tidak disimpan"), res.data?.error?.message ?? L("Update failed", "Kemas kini gagal"), "notice"); return; }
    toast(L("Saved", "Disimpan"), saved);
    void load();
  };

  /* ==== v1.55.0 — the catalog ====
     The CEO: "the portal can upload the PDF for this catalog without the
     prices tag and it will automatically live price embedded to the PDF
     uploaded."

     Reading happens HERE, when she picks the file: pdf.js (loaded only at
     that moment — it is a meaningful download) lists every text label with
     its position, and page 1 becomes the cover photo the shop's share
     preview uses. What was read is shown BEFORE anything uploads — how many
     labels matched her products, which didn't, whether printed price tags
     were found in a file that is supposed to have none. The store's Worker
     then prices those spots live on every download, exactly like the
     built-in catalog. */
  const readCatalogFile = async (file: File) => {
    if (file.type !== "application/pdf" && !/\.pdf$/i.test(file.name)) {
      toast(L("Wrong kind of file", "Jenis fail salah"), L("The catalog must be a PDF.", "Katalog mesti PDF."), "notice");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast(L("Too big", "Terlalu besar"),
        L("The PDF is over 10 MB — export it smaller (photos at screen quality are plenty).",
          "PDF melebihi 10 MB — eksport lebih kecil (foto kualiti skrin sudah memadai)."), "notice");
      return;
    }
    setCatReading(true);
    if (catDraft?.coverUrl) URL.revokeObjectURL(catDraft.coverUrl);
    setCatDraft(null);
    try {
      const pdfjs = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = "/vendor/pdf.worker.min.mjs";
      const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
      const pages: PageRuns[] = [];
      const canvases: (HTMLCanvasElement | null)[] = [];
      let cover: Blob | null = null;
      for (let n = 1; n <= doc.numPages; n++) {
        const page = await doc.getPage(n);
        const vp = page.getViewport({ scale: 1 });
        const tc = await page.getTextContent();
        pages.push({
          w: vp.width, h: vp.height,
          runs: tc.items.flatMap((it) => ("str" in it && Array.isArray(it.transform))
            ? [{ str: it.str, x: Number(it.transform[4]), baseline: Number(it.transform[5]), width: it.width, height: it.height }]
            : []),
        });
        /* Every page is rendered once: page 1 becomes the cover, and every
           page's pixels are kept so the background behind each PRINTED
           price can be sampled (v1.57.0) — the shop covers a printed price
           in its own page colour, and only this browser can see colours. */
        const scale = (n === 1 ? 1100 : 700) / vp.width;
        const v2 = page.getViewport({ scale });
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(v2.width); canvas.height = Math.round(v2.height);
        const cctx = canvas.getContext("2d", { willReadFrequently: true });
        if (cctx) {
          await page.render({ canvasContext: cctx, viewport: v2 }).promise;
          canvases.push(canvas);
          if (n === 1) {
            cover = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", 0.85));
          }
        } else {
          canvases.push(null);
        }
      }
      const r = extractCatalogMap(pages);
      /* v1.57.0 — sample the colour AROUND each printed price (4 points
         just outside its box, median per channel) so the shop's cover
         patch disappears into the page: cream stays cream, a rose pill
         stays a rose pill. */
      for (const ps of r.map.price_sites ?? []) {
        const cv = canvases[ps.page];
        const pageDim = pages[ps.page];
        if (!cv || !pageDim) continue;
        const cctx = cv.getContext("2d", { willReadFrequently: true });
        if (!cctx) continue;
        const sc = cv.width / pageDim.w;
        const cy = (ps.y0 + ps.y1) / 2, cx2 = (ps.x0 + ps.x1) / 2;
        const pts: [number, number][] = [
          [ps.x0 - 5, cy], [ps.x1 + 5, cy], [cx2, ps.y0 - 5], [cx2, ps.y1 + 5],
        ];
        const samples: number[][] = [];
        for (const [px, py] of pts) {
          const x = Math.min(cv.width - 1, Math.max(0, Math.round(px * sc)));
          const y = Math.min(cv.height - 1, Math.max(0, Math.round(py * sc)));
          const d = cctx.getImageData(x, y, 1, 1).data;
          samples.push([d[0]!, d[1]!, d[2]!]);
        }
        const med = (i: number) => {
          const v = samples.map((s) => s[i]!).sort((a, b) => a - b);
          return Math.round((v[1]! + v[2]!) / 2);
        };
        ps.bg = [med(0), med(1), med(2)];
        /* The number's own INK: scan inside the box for the pixel farthest
           from the background — the glyph colour. The CEO: "Price should
           the font like Saiz" — same face, same colour as the designer's,
           so the replacement is indistinguishable from the original. */
        /* Glyph pixels are the MANY far-from-background pixels; a stray
           sliver of photograph at the box's edge is only a few. The median
           of all far pixels lands on the glyph colour, not the sliver. */
        const farPix: [number, number, number][] = [];
        for (let gy = 0; gy < 5; gy++) {
          for (let gx = 0; gx < 12; gx++) {
            const x = Math.min(cv.width - 1, Math.max(0, Math.round((ps.x0 + ((gx + 0.5) / 12) * (ps.x1 - ps.x0)) * sc)));
            const y = Math.min(cv.height - 1, Math.max(0, Math.round((ps.y0 + ((gy + 0.5) / 5) * (ps.y1 - ps.y0)) * sc)));
            const d = cctx.getImageData(x, y, 1, 1).data;
            const dist = (d[0]! - ps.bg[0]) ** 2 + (d[1]! - ps.bg[1]) ** 2 + (d[2]! - ps.bg[2]) ** 2;
            if (dist > 55 * 55) farPix.push([d[0]!, d[1]!, d[2]!]);
          }
        }
        /* Only a clearly different colour counts as ink — a near-empty box
           keeps the store's own contrast rule. */
        if (farPix.length >= 3) {
          const chMed = (i: number) => farPix.map((v) => v[i]!).sort((a, b) => a - b)[Math.floor(farPix.length / 2)]!;
          ps.ink = [chMed(0), chMed(1), chMed(2)];
        }
      }

      /* v1.58.0 — THE EMPTY PILL. On a price-less catalog the designer
         leaves a coloured pill under the "Price" heading with nothing in
         it; the price used to be dropped under the heading in the page
         margin instead of INSIDE the pill ("it is not properly price
         tagging inside the Pills" — the CEO). The pill is found by its
         pixels: scan below the heading for the wide run of non-background
         colour, and hand its inner area to the store as a price site — the
         same machinery that fills printed pills then writes the live price
         inside it, in the pill's own colours. */
      for (const site of r.map.sites) {
        const isPriceHead = ["price", "harga"].includes(site.label.toLowerCase().normalize("NFKD").replace(/[^a-z]/g, ""));
        if (!isPriceHead) continue;
        const hcx = (site.x0 + site.x1) / 2;
        const already = (r.map.price_sites ?? []).some((q) =>
          q.page === site.page && Math.abs((q.x0 + q.x1) / 2 - hcx) < 110
          && q.y0 > site.y1 - 6 && q.y0 < site.y1 + 70);
        if (already) continue; // a printed price already lives in that pill
        const cv = canvases[site.page];
        const pageDim = pages[site.page];
        if (!cv || !pageDim) continue;
        const cctx = cv.getContext("2d", { willReadFrequently: true });
        if (!cctx) continue;
        const sc = cv.width / pageDim.w;
        const pxAt = (x: number, y: number) => {
          const d = cctx.getImageData(
            Math.min(cv.width - 1, Math.max(0, Math.round(x * sc))),
            Math.min(cv.height - 1, Math.max(0, Math.round(y * sc))), 1, 1).data;
          return [d[0]!, d[1]!, d[2]!] as [number, number, number];
        };
        /* A pill is a BOUNDED blob of UNIFORM colour that begins where the
           page stops — three properties no photograph or fabric texture
           shares. Walk straight down from the heading: the longest uniform
           colour segment that differs from what sits above it, whose width
           has two real edges, is the pill. (The first version compared to a
           single "page background" sample — one probe landing on a photo
           made the whole page read as pill.) */
        const diff = (a: [number, number, number], b: [number, number, number]) =>
          Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
        const ys: number[] = [];
        const cols: [number, number, number][] = [];
        for (let i = 0; i < 46; i++) { const y = site.y1 + 2 + i * 1.5; ys.push(y); cols.push(pxAt(hcx, y)); }
        type Seg = { x0: number; y0: number; x1: number; y1: number; h: number; c: [number, number, number] };
        let bestSeg: Seg | null = null;
        let a = 0;
        for (let i = 1; i <= cols.length; i++) {
          if (i === cols.length || diff(cols[i]!, cols[i - 1]!) > 36) {
            if (ys[i - 1]! - ys[a]! >= 9) {
              const mid = Math.floor((a + i - 1) / 2);
              const c = cols[mid]!;
              const above = pxAt(hcx, ys[a]! - 4);
              if (diff(c, above) > 60) {
                const y = ys[mid]!;
                let x0 = hcx, x1 = hcx;
                /* His pills can stretch far past their heading — search
                   wide, still demanding two real edges. */
                while (x0 > hcx - 260 && diff(pxAt(x0 - 3, y), c) < 45) x0 -= 3;
                while (x1 < hcx + 260 && diff(pxAt(x1 + 3, y), c) < 45) x1 += 3;
                const bounded = x0 > hcx - 260 && x1 < hcx + 260; // both edges truly found
                const w = x1 - x0;
                const h = ys[i - 1]! - ys[a]!;
                if (bounded && w >= 50 && (!bestSeg || h > bestSeg.h)) {
                  bestSeg = { x0, y0: ys[a]!, x1, y1: ys[i - 1]!, h, c };
                }
              }
            }
            a = i;
          }
        }
        if (!bestSeg) {
          /* No pill blob found — the heading STILL gets a guaranteed spot
             (the CEO's pill missed detection once; an empty Price section
             must never happen again). A modest area directly under the
             heading, its colour sampled from those very pixels: if it lands
             on a pill it covers in pill colour, on fabric in fabric colour
             — either way the price appears, legibly. */
          const fy0 = site.y1 + 12, fy1 = site.y1 + 30;
          const mid = pxAt(hcx, (fy0 + fy1) / 2);
          const neighbours = [pxAt(hcx - 20, (fy0 + fy1) / 2), mid, pxAt(hcx + 20, (fy0 + fy1) / 2)];
          const med = (i: number) => neighbours.map((v) => v[i]!).sort((x, y) => x - y)[1]!;
          const fbg: [number, number, number] = [med(0), med(1), med(2)];
          const flum = (0.2126 * fbg[0] + 0.7152 * fbg[1] + 0.0722 * fbg[2]) / 255;
          (r.map.price_sites ??= []).push({
            page: site.page, x0: hcx - 70, y0: fy0, x1: hcx + 70, y1: fy1, bg: fbg,
            ...(flum < 0.82 ? { ink: [255, 255, 255] as [number, number, number] } : {}),
          });
          continue;
        }
        const bg = bestSeg.c;
        const lum = (0.2126 * bg[0] + 0.7152 * bg[1] + 0.0722 * bg[2]) / 255;
        const insetY = bestSeg.h * 0.18;
        /* The site is CLIPPED around the heading's centre: the store pairs
           a price site with the label above it by centre distance, and a
           pill stretching far to one side would otherwise centre itself
           out of reach — the exact way his empty bawal pill stayed empty. */
        (r.map.price_sites ??= []).push({
          page: site.page,
          x0: Math.max(bestSeg.x0 + 10, hcx - 110), y0: bestSeg.y0 + insetY,
          x1: Math.min(bestSeg.x1 - 10, hcx + 110), y1: bestSeg.y1 - insetY,
          bg,
          /* His pills carry white text; only a near-paper pill keeps the
             store's dark-ink rule. */
          ...(lum < 0.82 ? { ink: [255, 255, 255] as [number, number, number] } : {}),
        });
      }
      if (r.map.sites.length === 0) {
        toast(L("No labels found", "Tiada label dijumpai"),
          L("No product names could be read from this PDF — if the text is drawn as pictures (outlined), the shop cannot place prices on it.",
            "Tiada nama produk dapat dibaca daripada PDF ini — jika teksnya berupa gambar (outline), kedai tidak dapat meletakkan harga."), "notice");
        return;
      }
      const names = published.map((x) => x.name).filter(Boolean);
      const matched = r.map.sites.filter((s) => catLabelMatches(s.label, names)).length;
      /* The labels left without a product, named — deduplicated, page
         furniture ("Price", "Saiz", "Details", …) left out since the shop
         does not treat those as products either. Only label-looking text
         (two words or more) is worth the CEO's attention here. */
      const FURN = new Set(["price", "harga", "saiz", "size", "sizes", "details", "detail", "material", "materials", "product detail", "by elfia", "elfia"]);
      const unmatched_labels = [...new Set(
        r.map.sites
          .filter((s) => !catLabelMatches(s.label, names))
          .map((s) => s.label.trim())
          .filter((l) => !FURN.has(l.toLowerCase()) && l.split(/\s+/).length >= 2),
      )];
      setCatDraft({
        file, map: r.map, cover,
        coverUrl: cover ? URL.createObjectURL(cover) : null,
        pages: pages.length, matched, unmatched_labels,
        prices_detected: r.prices_detected, truncated: r.truncated,
      });
    } catch {
      toast(L("Could not read the file", "Fail tidak dapat dibaca"),
        L("That PDF could not be opened. Re-export it and try again.", "PDF itu tidak dapat dibuka. Eksport semula dan cuba lagi."), "notice");
    } finally {
      setCatReading(false);
      if (catFileRef.current) catFileRef.current.value = "";
    }
  };

  const uploadCatalog = async () => {
    if (!catDraft) return;
    setCatBusy(true);
    try {
      /* PDF first, cover second, MAP LAST — the map is the switch that puts
         the upload on the feed, so everything else must already be there. */
      const up = await csrfFetch(`/api/v1/staff/elfia/catalog`, {
        method: "POST", headers: { "Content-Type": "application/pdf" }, body: catDraft.file,
      });
      if (!up.ok) {
        const j = (await up.json().catch(() => null)) as { error?: { message?: string } } | null;
        toast(L("Not uploaded", "Tidak dimuat naik"), j?.error?.message ?? L("Upload failed", "Muat naik gagal"), "notice");
        return;
      }
      if (catDraft.cover) {
        await csrfFetch(`/api/v1/staff/elfia/catalog/cover`, {
          method: "POST", headers: { "Content-Type": "image/jpeg" }, body: catDraft.cover,
        }).catch(() => null); // a missing cover never blocks the catalog itself
      }
      const mp = await api<{ live?: boolean; error?: { message?: string } }>(`/elfia/catalog/map`, {
        method: "POST", body: JSON.stringify({ map: catDraft.map }),
      });
      if (!mp.ok) {
        toast(L("Not finished", "Tidak selesai"),
          mp.data?.error?.message ?? L("The label map could not be saved — the shop was NOT changed. Try again.",
                                       "Peta label tidak dapat disimpan — kedai TIDAK diubah. Cuba lagi."), "notice");
        return;
      }
      toast(L("Catalog uploaded", "Katalog dimuat naik"),
        L("the shop starts serving it, live-priced, within a minute — press “Update the shop now” to hurry it",
          "kedai mula memaparkannya, berharga langsung, dalam seminit — tekan “Kemas kini kedai sekarang” untuk segerakan"));
      if (catDraft.coverUrl) URL.revokeObjectURL(catDraft.coverUrl);
      setCatDraft(null);
      void load();
    } finally { setCatBusy(false); }
  };

  const removeCatalog = async () => {
    setCatBusy(true);
    try {
      const res = await api<{ store_reset?: boolean; error?: { message?: string } }>(`/elfia/catalog`, { method: "DELETE" });
      if (!res.ok) {
        toast(L("Not removed", "Tidak dibuang"), res.data?.error?.message ?? L("Remove failed", "Buang gagal"), "notice");
        return;
      }
      toast(L("Catalog removed", "Katalog dibuang"),
        res.data?.store_reset
          ? L("the shop is back on its built-in catalog", "kedai kembali kepada katalog terbina dalamnya")
          : L("removed here — the shop returns to its built-in catalog on its next sync", "dibuang di sini — kedai kembali kepada katalog terbina dalam pada penyegerakan seterusnya"));
      void load();
    } finally { setCatBusy(false); }
  };

  /* v1.61.0 — the /catalog hover backdrop. A raw binary POST like the
     catalog cover; the server stamps the marker and the shop re-downloads
     within a minute. */
  const uploadBackdrop = async (f: File) => {
    const ct = f.type === "image/png" ? "image/png" : f.type === "image/webp" ? "image/webp" : "image/jpeg";
    setBusyBackdrop(true);
    try {
      const up = await csrfFetch(`/api/v1/staff/elfia/backdrop`, {
        method: "POST", headers: { "Content-Type": ct }, body: f,
      });
      if (!up.ok) {
        const j = (await up.json().catch(() => null)) as { error?: { message?: string } } | null;
        toast(L("Not uploaded", "Tidak dimuat naik"), j?.error?.message ?? L("Upload failed", "Muat naik gagal"), "notice");
        return;
      }
      toast(L("Background uploaded", "Latar belakang dimuat naik"),
        L("the shop's /catalog hover uses it within a minute — press “Update the shop now” to hurry it",
          "hover /catalog kedai menggunakannya dalam seminit — tekan “Kemas kini kedai sekarang” untuk segerakan"));
      void load();
    } finally { setBusyBackdrop(false); }
  };

  const removeBackdrop = async () => {
    setBusyBackdrop(true);
    try {
      const res = await api<{ store_reset?: boolean; error?: { message?: string } }>(`/elfia/backdrop`, { method: "DELETE" });
      if (!res.ok) {
        toast(L("Not removed", "Tidak dibuang"), res.data?.error?.message ?? L("Remove failed", "Buang gagal"), "notice");
        return;
      }
      toast(L("Background removed", "Latar belakang dibuang"),
        res.data?.store_reset
          ? L("the shop is back on its shipped ELFIA backdrop", "kedai kembali kepada latar ELFIA terbina dalamnya")
          : L("removed here — the shop returns to its shipped backdrop on its next sync", "dibuang di sini — kedai kembali kepada latar terbina dalam pada penyegerakan seterusnya"));
      void load();
    } finally { setBusyBackdrop(false); }
  };

  return (
    <div className="space-y-4 md:space-y-6">
      {toastNode}

      {/* v1.49.0 — every collection name already in use, offered to every
          Collection box below. Built from the items themselves, so it needs
          no list to maintain and cannot go stale. */}
      <datalist id="elfia-collections">
        {[...new Set(items.map((x) => (x.elfia_category ?? "").trim()).filter(Boolean))]
          .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
          .map((c) => <option key={c} value={c} />)}
      </datalist>

      {/* ---- the bridge's pulse + what this tab is ---- */}
      <div className={card}>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <span className="font-semibold">{L("ELFIA web store", "Kedai web ELFIA")}</span>
          {/* v1.48.0 — "still the discount is not live update!!!!". The shop
              refreshes itself every minute; this is for the moment you have
              just typed a price and want to look at the shop NOW. */}
          <button type="button" className={btnSm} disabled={syncing}
            onClick={() => void syncShopNow()}>
            {syncing ? L("Updating the shop…", "Mengemas kini kedai…") : L("Update the shop now", "Kemas kini kedai sekarang")}
          </button>
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
          {L("Everything on this tab reaches the store within about a minute: counts, prices, discounts, collection, description and photo. Ticking Publish is what puts a product in the shop — a SKU the store has never had is created there and goes live. Un-tick it and it leaves the shop. In a hurry? Press \u201cUpdate the shop now\u201d.",
             "Semua pada tab ini sampai ke kedai dalam kira-kira seminit: kiraan, harga, diskaun, koleksi, penerangan dan foto. Menanda Publish di sinilah yang meletakkan produk dalam kedai — SKU yang belum ada di kedai akan dicipta dan terus dipaparkan. Buang tanda itu dan ia hilang dari kedai. Tergesa-gesa? Tekan \u201cKemas kini kedai sekarang\u201d.")}
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

      {/* ---- can customers pay online? (v1.53.0) ----
          The CEO, 26-08, on the live shop: "This appear on the gateway
          payment!" — the customer-facing "Payment gateway unavailable", with
          nowhere to find out why. The store writes Billplz's own reply down
          now; this is the window onto it. */}
      <div className={card}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-semibold">{L("Online payment (Billplz FPX)", "Pembayaran dalam talian (Billplz FPX)")}</p>
            <p className="text-muted-foreground mt-0.5 text-xs">
              {L("Checks the shop's payment keys against Billplz. Read-only — it creates no bill and moves no money.",
                 "Menyemak kunci pembayaran kedai dengan Billplz. Baca sahaja — tiada bil dicipta dan tiada wang berpindah.")}
            </p>
          </div>
          <button type="button" className={btnSm} disabled={busyPay} onClick={() => void checkPayment()}>
            {busyPay ? L("Checking…", "Menyemak…") : L("Check now", "Semak sekarang")}
          </button>
        </div>

        {pay && (
          <div className="mt-3 space-y-2 text-xs">
            {pay.unavailable ? (
              <p className="text-muted-foreground">{pay.message}</p>
            ) : (
              <>
                <p className="flex flex-wrap items-center gap-2">
                  <span className={pay.ok ? chipSuccess : chipWarn}>
                    {pay.ok ? L("Keys working", "Kunci berfungsi") : L("Not working", "Tidak berfungsi")}
                  </span>
                  {pay.sandbox && <span className={chipWarn}>{L("SANDBOX", "SANDBOX")}</span>}
                  {pay.signature_key_set === false && <span className={chipNeutral}>{L("No X-Signature key", "Tiada kunci X-Signature")}</span>}
                </p>
                <p className="text-muted-foreground">{pay.message}</p>
                {pay.warning && <p className="font-medium text-amber-700 dark:text-amber-400">{pay.warning}</p>}

                {/* The credential check passing is a weaker claim than "the
                    last customer could pay". This is the stronger one. */}
                {pay.last_gateway_error && (
                  <div className="rounded-lg border border-amber-300 bg-amber-50 p-2.5 dark:border-amber-700 dark:bg-amber-950/40">
                    <p className="font-semibold text-amber-900 dark:text-amber-300">
                      {L("Last time a customer could not pay", "Kali terakhir pelanggan tidak dapat membayar")}
                    </p>
                    <p className="mt-1 font-mono text-[11px] break-words text-amber-900/90 dark:text-amber-200/90">
                      {pay.last_gateway_error}
                    </p>
                    {pay.last_gateway_hint && (
                      <p className="mt-1.5 text-amber-900 dark:text-amber-200">{pay.last_gateway_hint}</p>
                    )}
                  </div>
                )}
                {pay.ok && !pay.last_gateway_error && (
                  <p className="text-muted-foreground">
                    {L("No failed payment has been recorded on the shop.", "Tiada pembayaran gagal direkodkan di kedai.")}
                  </p>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* ---- what delivery costs (v1.52.0) ----
          The CEO, 26-08-2026: "I want to have the authority to update the
          shipping fees which is above RM45.00, I will provide a free
          delivery fees." Both numbers used to be in the store's config file,
          so changing them meant a code edit and a deploy. They are hers now.
          The sentence below the boxes is the exact sentence the shop shows a
          customer, built from what is currently typed — the point being that
          nobody should have to imagine what these two numbers add up to. */}
      <div className={card}>
        <p className="text-sm font-semibold">{L("Delivery charges", "Caj penghantaran")}</p>
        <p className="text-muted-foreground mt-0.5 text-xs">
          {L("What the shop charges for delivery, and the basket size that makes it free. Yours to change — the shop picks it up within a minute.",
             "Kadar penghantaran yang dikenakan kedai, dan jumlah belian yang menjadikannya percuma. Anda boleh ubah — kedai mengambilnya dalam seminit.")}
        </p>

        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="text-muted-foreground block text-xs">{L("Delivery charge", "Caj penghantaran")}</span>
            <span className="mt-1 flex items-center gap-1.5">
              <span className="text-muted-foreground text-sm">RM</span>
              <input value={ship} onChange={(e) => setShip(e.target.value)}
                inputMode="decimal" placeholder="4.50" aria-label={L("Delivery charge in ringgit", "Caj penghantaran dalam ringgit")}
                className={`${inputClass} w-24`} />
            </span>
          </label>
          <label className="block">
            <span className="text-muted-foreground block text-xs">{L("Free delivery from", "Penghantaran percuma dari")}</span>
            <span className="mt-1 flex items-center gap-1.5">
              <span className="text-muted-foreground text-sm">RM</span>
              <input value={freeAbove} onChange={(e) => setFreeAbove(e.target.value)}
                inputMode="decimal" placeholder="45.00" aria-label={L("Free delivery threshold in ringgit", "Ambang penghantaran percuma dalam ringgit")}
                className={`${inputClass} w-24`} />
            </span>
          </label>
          <button type="button" className={btnSm} disabled={busyDelivery || !deliveryDirty}
            onClick={() => void saveDelivery()}>
            {busyDelivery ? L("Saving…", "Menyimpan…") : L("Save", "Simpan")}
          </button>
        </div>

        {/* The customer's sentence, live. */}
        {rmToSen(ship) !== null && rmToSen(freeAbove) !== null && (
          <p className="mt-3 text-xs">
            {L("The shop will say:", "Kedai akan memaparkan:")}{" "}
            <span className="font-medium">
              {L(`Free delivery above RM ${(rmToSen(freeAbove)! / 100).toFixed(2)} · RM ${(rmToSen(ship)! / 100).toFixed(2)} otherwise`,
                 `Penghantaran percuma melebihi RM ${(rmToSen(freeAbove)! / 100).toFixed(2)} · RM ${(rmToSen(ship)! / 100).toFixed(2)} jika tidak`)}
            </span>
          </p>
        )}

        {deliverySaved !== null && deliverySaved.ship === "" && (
          <p className="mt-2 text-xs font-medium text-amber-700 dark:text-amber-400">
            {L("Not set here yet — the shop is using its own built-in amounts. Save once and this tab takes over.",
               "Belum ditetapkan di sini — kedai menggunakan jumlah terbina dalamnya sendiri. Simpan sekali dan tab ini akan mengambil alih.")}
          </p>
        )}
      </div>

      {/* ---- the catalog PDF (v1.55.0) ----
          The CEO: "the portal can upload the PDF for this catalog without
          the prices tag and it will automatically live price embedded to
          the PDF uploaded." Choosing a file reads it HERE in the browser —
          labels, positions, page-1 cover — and shows what was found before
          anything uploads. The shop prices those spots live on every
          download, so the PDF never goes stale. */}
      <div className={card}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-semibold">{L("Catalog PDF", "PDF Katalog")}</p>
            <p className="text-muted-foreground mt-0.5 text-xs">
              {L("Upload the catalog WITHOUT price tags — the shop writes today's prices under each product name itself, on every download, and makes every product tappable.",
                 "Muat naik katalog TANPA tanda harga — kedai sendiri menulis harga hari ini di bawah setiap nama produk, pada setiap muat turun, dan menjadikan setiap produk boleh ditekan.")}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {cat?.live && <span className={chipSuccess}>{L("Live on the shop", "Disiarkan di kedai")}</span>}
            {cat && !cat.live && !cat.unavailable && <span className={chipNeutral}>{L("Built-in catalog", "Katalog terbina dalam")}</span>}
          </div>
        </div>

        {cat?.unavailable && (
          <p className="mt-2 rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs font-medium text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
            {L("This api worker does not have the catalog routes yet — deploy azoneofficial-api, then reload.",
               "Worker api ini belum ada laluan katalog — deploy azoneofficial-api, kemudian muat semula.")}
          </p>
        )}

        {cat && !cat.unavailable && (
          <div className="mt-3 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <input ref={catFileRef} type="file" accept="application/pdf" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void readCatalogFile(f); }} />
              <button type="button" className={btnSm} disabled={catReading || catBusy}
                onClick={() => catFileRef.current?.click()}>
                {catReading
                  ? L("Reading the PDF…", "Membaca PDF…")
                  : cat.live ? L("Replace the catalog", "Ganti katalog") : L("Choose a PDF", "Pilih PDF")}
              </button>
              {cat.live && (
                <>
                  <span className="text-muted-foreground text-xs">
                    {L("Uploaded", "Dimuat naik")} {cat.updated_at ? cat.updated_at.slice(0, 16).replace("T", " ") : ""}
                  </span>
                  <button type="button" className="text-muted-foreground ml-auto text-xs underline" disabled={catBusy}
                    onClick={() => void removeCatalog()}>
                    {L("remove — the shop returns to its built-in catalog", "buang — kedai kembali kepada katalog terbina dalam")}
                  </button>
                </>
              )}
            </div>

            {cat.pending && !catDraft && (
              <p className="text-xs font-medium text-amber-700 dark:text-amber-400">
                {L("A previous upload did not finish — the shop was not changed. Choose the PDF again.",
                   "Muat naik sebelum ini tidak selesai — kedai tidak diubah. Pilih PDF itu semula.")}
              </p>
            )}

            {/* what was read, before anything uploads */}
            {catDraft && (
              <div className="rounded-lg border p-3">
                <div className="flex flex-wrap items-start gap-3">
                  {catDraft.coverUrl && (
                    /* eslint-disable-next-line @next/next/no-img-element -- object URL preview */
                    <img src={catDraft.coverUrl} alt={L("Catalog cover", "Kulit katalog")}
                      className="w-20 rounded-md border object-cover" />
                  )}
                  <div className="min-w-0 flex-1 text-xs">
                    <p className="font-medium">{catDraft.file.name}</p>
                    <p className="text-muted-foreground mt-1">
                      {L(`${catDraft.pages} pages · ${catDraft.map.sites.length} labels found · ${catDraft.matched} match a published product`,
                         `${catDraft.pages} halaman · ${catDraft.map.sites.length} label dijumpai · ${catDraft.matched} sepadan dengan produk diterbitkan`)}
                    </p>
                    {catDraft.matched === 0 && (
                      <p className="mt-1 font-medium text-amber-700 dark:text-amber-400">
                        {L("None of the labels match a published product — the shop would add no prices. Check the names, or publish the products first.",
                           "Tiada label sepadan dengan produk diterbitkan — kedai tidak akan menambah harga. Semak nama, atau terbitkan produk dahulu.")}
                      </p>
                    )}
                    {/* v1.56.0 — the CEO's "missing prices tag": these are
                        the exact labels that will print WITHOUT a price.
                        Named, so a typo in the PDF or an unpublished
                        product is caught here, not in the printed file. */}
                    {catDraft.matched > 0 && catDraft.unmatched_labels.length > 0 && (
                      <p className="mt-1 font-medium text-amber-700 dark:text-amber-400">
                        {L("These get NO price (no published product matches): ",
                           "Ini TIDAK mendapat harga (tiada produk diterbitkan sepadan): ")}
                        {catDraft.unmatched_labels.slice(0, 12).join(" · ")}
                        {catDraft.unmatched_labels.length > 12 ? ` +${catDraft.unmatched_labels.length - 12}` : ""}
                        {" — "}
                        {L("fix the name in the PDF, or publish/rename the product, then choose the file again.",
                           "betulkan nama dalam PDF, atau terbitkan/namakan semula produk, kemudian pilih fail semula.")}
                      </p>
                    )}
                    {/* v1.57.0 — printed prices are HANDLED now: each one is
                        covered in its own page colour and the live price is
                        written in the same spot. Good news, not a warning. */}
                    {catDraft.prices_detected > 0 && (
                      <p className="text-muted-foreground mt-1">
                        {L(`${catDraft.prices_detected} printed price tag${catDraft.prices_detected === 1 ? "" : "s"} found — the shop covers each one and writes today's price in its place.`,
                           `${catDraft.prices_detected} tanda harga bercetak dijumpai — kedai menutup setiap satu dan menulis harga hari ini di tempatnya.`)}
                      </p>
                    )}
                    {catDraft.truncated && (
                      <p className="mt-1 font-medium text-amber-700 dark:text-amber-400">
                        {L("Over 300 labels — only the first 300 get prices.", "Melebihi 300 label — hanya 300 pertama mendapat harga.")}
                      </p>
                    )}
                    <div className="mt-2 flex gap-2">
                      <button type="button" className={btnSm} disabled={catBusy} onClick={() => void uploadCatalog()}>
                        {catBusy ? L("Uploading…", "Memuat naik…") : L("Upload to the shop", "Muat naik ke kedai")}
                      </button>
                      <button type="button" className="text-muted-foreground text-xs underline" disabled={catBusy}
                        onClick={() => { if (catDraft.coverUrl) URL.revokeObjectURL(catDraft.coverUrl); setCatDraft(null); }}>
                        {L("cancel", "batal")}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ---- the /catalog hover backdrop (v1.61.0) ---- */}
      <div className={card}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-semibold">{L("Catalog hover background", "Latar belakang hover katalog")}</p>
            <p className="text-muted-foreground mt-0.5 text-xs">
              {L("Optional. On the shop's /catalog page this picture appears behind each cut-out photo when a customer hovers over it. Nothing uploaded = the shop uses its shipped ELFIA backdrop. A square picture fits the circular tiles best.",
                 "Pilihan. Di halaman /catalog kedai, gambar ini muncul di belakang setiap foto potongan apabila pelanggan menghalakan kursor. Tiada muat naik = kedai menggunakan latar ELFIA terbina dalamnya. Gambar segi empat sama paling sesuai dengan jubin bulat.")}
            </p>
          </div>
          <label className={`${btnSm} cursor-pointer`}>
            {busyBackdrop
              ? L("Uploading…", "Memuat naik…")
              : backdrop?.key ? L("Replace", "Ganti") : L("+ Add background", "+ Tambah latar")}
            <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void uploadBackdrop(f); }} />
          </label>
        </div>

        {backdrop?.unavailable && loaded && (
          <p className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs font-medium text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
            {L("The api worker is older than v1.61.0 — deploy it (PUSH.bat) before this card can save.",
               "Worker api lebih lama daripada v1.61.0 — deploy dahulu (PUSH.bat) sebelum kad ini boleh menyimpan.")}
          </p>
        )}
        {backdrop !== null && !backdrop.unavailable && backdrop.key && backdrop.url && (
          <div className="mt-3 flex items-center gap-3">
            {/* The circle preview, because that is exactly how the shop's
                tiles will crop it. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={backdrop.url} alt={L("Current hover background", "Latar hover semasa")}
              className="h-20 w-20 rounded-full border object-cover object-top" />
            <button type="button" className="text-muted-foreground text-xs underline" disabled={busyBackdrop}
              onClick={() => void removeBackdrop()}>
              {L("remove — the shop returns to its shipped ELFIA backdrop", "buang — kedai kembali kepada latar ELFIA terbina dalam")}
            </button>
          </div>
        )}
        {backdrop !== null && !backdrop.unavailable && !backdrop.key && (
          <p className="text-muted-foreground mt-3 text-xs">
            {L("No background uploaded — the shop is using its shipped ELFIA backdrop.",
               "Tiada latar dimuat naik — kedai menggunakan latar ELFIA terbina dalamnya.")}
          </p>
        )}
      </div>

      {/* ---- the hero carousel (v1.46.0) ---- */}
      <div className={card}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-semibold">{L("Homepage carousel", "Karusel halaman utama")}</p>
            <p className="text-muted-foreground mt-0.5 text-xs">
              {L("The big pictures at the top of the shop. The store mirrors this list exactly — remove a slide here and it leaves the shop; no slides at all and the shop shows no carousel.",
                 "Gambar besar di bahagian atas kedai. Kedai mencerminkan senarai ini — buang slaid di sini dan ia hilang dari kedai; tiada slaid langsung dan kedai tidak memaparkan karusel.")}
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
            {L("No slides yet — the shop's homepage has no carousel until you add one.",
               "Belum ada slaid — halaman utama kedai tiada karusel sehingga anda tambah satu.")}
          </p>
        )}
        {slides !== null && slides.length > 0 && (
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {slides.map((sl, idx) => (
              <div key={sl.id} className={`rounded-xl border p-2 ${sl.active === 1 ? "border-border" : "border-border/60 opacity-70"}`}>
                {/* v1.48.0 — the CEO: "Instead of clickable, I want to zoom
                    out at least I can see the full instead of like this!!!"
                    So the control is a ZOOM SLIDER, not a click target: at
                    100 the whole photo sits inside the shop's banner with
                    nothing cut off, and sliding right grows it until it
                    fills. The box is the shop's exact 21:9 shape and uses
                    the shop's exact rule, so this IS the preview. Dragging
                    inside it moves the photo when it is zoomed in far enough
                    to be cropped. */}
                <div className={`bg-secondary relative overflow-hidden rounded-lg ${zoomOf(sl) > 100 ? "cursor-move" : ""}`}
                  title={zoomOf(sl) > 100
                    ? L("Drag to move the photo", "Seret untuk gerakkan foto")
                    : L("The whole photo is showing", "Keseluruhan foto dipaparkan")}
                  onPointerDown={(e) => {
                    if (zoomOf(sl) <= 100) return;   // nothing is cropped, nothing to move
                    const box = e.currentTarget;
                    const r = box.getBoundingClientRect();
                    if (r.width === 0 || r.height === 0) return;
                    const start = { x: e.clientX, y: e.clientY, fx: focusOf(sl).x, fy: focusOf(sl).y };
                    let last = { x: start.fx, y: start.fy };
                    box.setPointerCapture(e.pointerId);
                    const move = (ev: PointerEvent) => {
                      /* Dragging right should move the PHOTO right, which
                         means looking further left — hence the minus. */
                      const nx = Math.min(100, Math.max(0, Math.round(start.fx - ((ev.clientX - start.x) / r.width) * 100)));
                      const ny = Math.min(100, Math.max(0, Math.round(start.fy - ((ev.clientY - start.y) / r.height) * 100)));
                      last = { x: nx, y: ny };
                      const img = box.querySelector("img");
                      if (img) img.style.objectPosition = `${nx}% ${ny}%`;
                    };
                    const up = () => {
                      box.removeEventListener("pointermove", move);
                      box.removeEventListener("pointerup", up);
                      if (last.x !== start.fx || last.y !== start.fy) {
                        void patchSlide(sl.id, { focus_x: last.x, focus_y: last.y }, L("photo moved", "foto digerakkan"));
                      }
                    };
                    box.addEventListener("pointermove", move);
                    box.addEventListener("pointerup", up);
                  }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={photoUrl(sl.image_key)} alt="" draggable={false}
                    className="aspect-[21/9] w-full object-contain select-none"
                    style={{
                      objectPosition: `${focusOf(sl).x}% ${focusOf(sl).y}%`,
                      transform: `scale(${zoomOf(sl) / 100})`,
                      transformOrigin: `${focusOf(sl).x}% ${focusOf(sl).y}%`,
                    }} />
                  {/* v1.50.0 — she is previewed INSIDE the box here, where
                      the shop lets her rise above it. The box is a preview
                      of the framing, not of the step-out; showing her
                      overflowing a card in a list of cards would just look
                      like a layout bug. */}
                  {sl.cutout_key && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={photoUrl(sl.cutout_key)} alt="" draggable={false}
                      className={`pointer-events-none absolute bottom-0 h-full w-auto max-w-[55%] object-contain object-bottom select-none ${
                        sl.cutout_side === "left" ? "left-1" : "right-1"}`} />
                  )}
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                  <label className="flex flex-1 items-center gap-2" style={{ minWidth: "12rem" }}>
                    <span className="text-muted-foreground shrink-0">{L("Zoom", "Zum")}</span>
                    <input type="range" min={100} max={300} step={5} defaultValue={zoomOf(sl)}
                      className="flex-1 accent-current"
                      onInput={(e) => {
                        /* Live preview while dragging; only the release is saved. */
                        const z = Number((e.target as HTMLInputElement).value);
                        const img = (e.currentTarget.closest("div")?.parentElement?.querySelector("img")) as HTMLImageElement | null;
                        if (img) img.style.transform = `scale(${z / 100})`;
                      }}
                      onChange={(e) => void patchSlide(sl.id, { zoom: Number(e.target.value) },
                        Number(e.target.value) <= 100
                          ? L("showing the whole photo", "memaparkan keseluruhan foto")
                          : L("zoom saved", "zum disimpan"))} />
                  </label>
                  <span className="text-muted-foreground shrink-0">
                    {zoomOf(sl) <= 100
                      ? L("whole photo", "foto penuh")
                      : L("drag the photo to move it", "seret foto untuk gerakkannya")}
                  </span>
                  <label className={`${btnSm} cursor-pointer shrink-0`}>
                    {L("Change photo", "Tukar foto")}
                    <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
                      onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void uploadSlide(f, sl.id); }} />
                  </label>
                </div>

                {/* v1.50.0 — the model who steps OUT of the banner (CEO's
                    reference: "the ladies 3D outside the carousel"). It is a
                    second picture, so it gets its own row: upload, which end
                    she stands at, and how far she rises above the card. */}
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                  <label className={`${btnSm} cursor-pointer shrink-0`}>
                    {sl.cutout_key ? L("Change model", "Tukar model") : L("+ Model cut-out", "+ Potongan model")}
                    <input type="file" accept="image/png,image/webp" className="hidden"
                      onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void uploadCutout(f, sl.id); }} />
                  </label>
                  {!sl.cutout_key && (
                    <span className="text-muted-foreground">
                      {L("a PNG with no background", "PNG tanpa latar belakang")}
                    </span>
                  )}
                  {sl.cutout_key && (
                    <>
                      <button type="button" className={btnSm}
                        title={L("Which end she stands at — the words take the other end",
                                 "Di hujung mana dia berdiri — teks mengambil hujung satu lagi")}
                        onClick={() => void patchSlide(sl.id,
                          { cutout_side: sl.cutout_side === "left" ? "right" : "left" },
                          L("moved to the other side", "dipindah ke sebelah lain"))}>
                        {sl.cutout_side === "left" ? L("◀ Left", "◀ Kiri") : L("Right ▶", "Kanan ▶")}
                      </button>
                      <label className="flex flex-1 items-center gap-2" style={{ minWidth: "10rem" }}>
                        <span className="text-muted-foreground shrink-0">{L("Height", "Tinggi")}</span>
                        <input type="range" min={100} max={160} step={2}
                          defaultValue={Number(sl.cutout_scale) || 118}
                          className="flex-1 accent-current"
                          onChange={(e) => void patchSlide(sl.id, { cutout_scale: Number(e.target.value) },
                            L("height saved", "tinggi disimpan"))} />
                      </label>
                      <button type="button" className="text-muted-foreground shrink-0 underline"
                        onClick={() => void patchSlide(sl.id, { remove_cutout: true },
                          L("model removed", "model dibuang"))}>
                        {L("remove model", "buang model")}
                      </button>
                    </>
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

        {/* ---- bulk discount (v1.54.0) ----
            The CEO: "I want to perform bulk discount instead of one by one.
            but I need to have 1 by 1 update also." Nothing below changes —
            this is a selection laid over the same list. The bar only appears
            once something is ticked, so the everyday view stays as it was. */}
        {/* v1.58.0 — the CEO: "I just want the model only there for
            /catalog!" One pass over every product photo; already-cut ones
            are skipped, failures leave the photo untouched. */}
        {items.some((x) => x.elfia_image_key) && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            <button type="button" className={btnSm} disabled={busyCut !== null}
              onClick={() => void cutAll()}>
              {busyCut === -1
                ? `${L("Cutting out backgrounds…", "Memotong latar…")} ${cutNote}`
                : L("Cut out ALL photo backgrounds", "Buang SEMUA latar foto")}
            </button>
            <span className="text-muted-foreground">
              {L("model only, like the catalog — photos already cut are skipped", "model sahaja, seperti katalog — foto yang sudah dipotong dilangkau")}
            </span>
          </div>
        )}

        {items.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
            <span className="text-muted-foreground">{L("Select:", "Pilih:")}</span>
            <button type="button" className="underline underline-offset-2"
              onClick={() => setPicked(new Set(published.map((x) => x.id)))}>
              {L("all published", "semua diterbitkan")} ({published.length})
            </button>
            {/* By collection, because a sale is usually "all the shawls". */}
            {[...new Set(items.map((x) => (x.elfia_category ?? "").trim()).filter(Boolean))]
              .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
              .map((c) => (
                <button key={c} type="button" className="underline underline-offset-2"
                  onClick={() => setPicked(new Set(items.filter((x) => (x.elfia_category ?? "").trim() === c).map((x) => x.id)))}>
                  {c} ({items.filter((x) => (x.elfia_category ?? "").trim() === c).length})
                </button>
              ))}
            {picked.size > 0 && (
              <button type="button" className="text-muted-foreground underline underline-offset-2"
                onClick={() => setPicked(new Set())}>
                {L("clear selection", "kosongkan pilihan")}
              </button>
            )}
          </div>
        )}

        {picked.size > 0 && (
          <div className="mt-2 flex flex-wrap items-end gap-2 rounded-lg border border-amber-300 bg-amber-50 p-2.5 dark:border-amber-700 dark:bg-amber-950/40">
            <span className="text-xs font-semibold text-amber-900 dark:text-amber-300">
              {picked.size} {L("selected", "dipilih")}
            </span>
            <label className="flex items-center gap-1.5 text-xs">
              <select value={bulkMode} onChange={(e) => setBulkMode(e.target.value as "amount" | "percent")}
                className="border-input bg-background rounded border px-1.5 py-1"
                aria-label={L("Discount type", "Jenis diskaun")}>
                <option value="percent">{L("% off", "% diskaun")}</option>
                <option value="amount">{L("RM off", "RM diskaun")}</option>
              </select>
              <input value={bulkValue} onChange={(e) => setBulkValue(e.target.value)}
                inputMode="decimal" placeholder={bulkMode === "percent" ? "20" : "3.00"}
                aria-label={L("Discount value", "Nilai diskaun")}
                className={`${inputClass} w-20`} />
            </label>
            <button type="button" className={btnSm} disabled={busyBulk}
              onClick={() => void applyBulk(bulkMode)}>
              {busyBulk ? L("Applying…", "Menggunakan…") : L("Apply to selected", "Guna pada yang dipilih")}
            </button>
            {/* Its own button: 0 and "no discount" are different things, and
                a box that means both is a box that gets misread. */}
            <button type="button" className={btnSm} disabled={busyBulk}
              onClick={() => void applyBulk("clear")}>
              {L("Remove discount", "Buang diskaun")}
            </button>
            <span className="text-muted-foreground w-full text-[11px]">
              {bulkMode === "percent"
                ? L("Worked out from each product's own web price. Anything it cannot apply to is named, not skipped quietly.",
                    "Dikira daripada harga web setiap produk sendiri. Apa-apa yang tidak boleh digunakan akan dinamakan, bukan dilangkau diam-diam.")
                : L("The same RM off every selected product. Anything cheaper than that is named, not skipped quietly.",
                    "Potongan RM yang sama bagi setiap produk dipilih. Apa-apa yang lebih murah akan dinamakan, bukan dilangkau diam-diam.")}
            </span>
          </div>
        )}

        <div className="mt-3 space-y-2">
          {sorted.map((it) => {
            const on = (it.bridge_enabled ?? 0) === 1;
            return (
              <div key={it.id}
                className={`rounded-xl border p-3 transition-colors ${on ? "border-border bg-card" : "border-border/60 bg-secondary/30 opacity-80"}`}>
                <div className="flex flex-wrap items-start gap-3">
                  {/* v1.54.0 — the bulk-discount tick. Its own control,
                      nowhere near the Publish tick below: those two mean very
                      different things and confusing them takes a product off
                      the shop. */}
                  <label className="flex shrink-0 items-center pt-7"
                    title={L("Select for a bulk discount", "Pilih untuk diskaun pukal")}>
                    <input type="checkbox" checked={picked.has(it.id)}
                      aria-label={`${L("Select", "Pilih")} ${it.sku}`}
                      onChange={(e) => setPicked((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) next.add(it.id); else next.delete(it.id);
                        return next;
                      })} />
                  </label>
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

                      {/* v1.49.0 — the CEO: "how I want to add the Collection
                          category!". It was a dropdown of two words, so there
                          was no way to add one. It is a free text box now,
                          with every collection already in use offered as a
                          suggestion so staff reuse a name instead of coining
                          "Shawl", "shawls" and "Shawl " as three shelves.
                          Type a new one and the shop grows a shelf; clear it
                          and the item falls back to Bawal. Saves on blur,
                          same as the description. */}
                      <label className="flex items-center gap-1.5">
                        {L("Collection", "Koleksi")}
                        <input className="border-input bg-background w-36 rounded border px-1.5 py-0.5"
                          list="elfia-collections"
                          defaultValue={it.elfia_category ?? ""}
                          maxLength={40}
                          placeholder={L("Bawal", "Bawal")}
                          title={L("Type any collection name — the shop makes a shelf for it. Empty = Bawal.",
                                   "Taip apa-apa nama koleksi — kedai akan buat rak untuknya. Kosong = Bawal.")}
                          onBlur={(e) => {
                            const v = e.target.value.trim().replace(/\s+/g, " ");
                            if (v === (it.elfia_category ?? "")) return;
                            void setElfia(it, { category: v },
                              v === "" ? `${it.sku} — ${L("collection cleared (store defaults to Bawal)", "koleksi dikosongkan (kedai guna Bawal)")}`
                                       : `${it.sku} — ${v}`);
                          }} />
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
                        <button type="button" className={btnSm} disabled={busyCut !== null}
                          title={L("Remove the studio background — model only, like the catalog", "Buang latar studio — model sahaja, seperti katalog")}
                          onClick={() => void cutBackground(it)}>
                          {busyCut === it.id ? L("Cutting…", "Memotong…") : L("Cut out background", "Buang latar")}
                        </button>
                      )}
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

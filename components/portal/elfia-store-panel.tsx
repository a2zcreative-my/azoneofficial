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

import { holds } from "@/lib/caps"; // v1.237.0 - the server's answer, matrix edits included
import { useCallback, useEffect, useRef, useState } from "react";
import { makeApi, csrfFetch } from "@/lib/api";
import { useSaveToast } from "@/components/ui/save-toast";
import { Skel } from "@/components/ui/skeleton";
import { compressImage } from "@/lib/compress-image";
import { btnSm, card, chipNeutral, chipSuccess, chipWarn, inputClass, insetCard, selectClassSm } from "@/lib/ui-styles";
import { rm as rmBare } from "@/lib/format";
import { getLang } from "@/lib/i18n";
import { QuietCard, ZoneLabel } from "@/components/portal/page-shared"; // v1.122.0
import { extractCatalogMap, type ExtractedMap, type PageRuns } from "@/lib/catalog-extract";
import { AppIcon } from "@/components/ui/app-icon";
import { LineTabs } from "@/components/ui/line-tabs";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { ELFIA_PUBLISH_ROLES, ProductDrawer, ProductTable, SyncChip, photoUrl, priceState, syncOf, type ElfiaItem } from "@/components/portal/elfia-products";
import es from "./elfia-store.module.css";

const api = makeApi("/staff");
const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);

/** A flash deadline, in the form the CEO reads dates in. Local time on
    purpose: the deadline is a moment in his shop's day, not a UTC stamp. */
/* v1.139.0 - MALAYSIA TIME, and it says so. This formatted in whatever zone
   the browser was set to and printed no label, so a laptop on another clock
   showed a different "flash sale ended" time from the office - about a
   deadline that decides what the shop charges. */
/* v1.235.0 - flashWhen, ElfiaItem and photoUrl live in elfia-products.tsx (one copy) */
/** A bulk preview as the confirmation's message: every line up to 14, then a count. */
const previewText = (lines: string[]): string =>
  `${lines.slice(0, 14).join("\n")}${lines.length > 14 ? `\n+${lines.length - 14} ${L("more", "lagi")}` : ""}\n\n${L("Each product is checked again on the server; anything it cannot apply is named afterwards.", "Setiap produk disemak semula di pelayan; apa-apa yang tidak boleh digunakan akan dinamakan selepas itu.")}`;
const ago = (t: string | null | undefined): string => {
  if (!t) return "";
  const ms = Date.now() - Date.parse(t.includes("T") ? t : `${t.replace(" ", "T")}Z`);
  if (!Number.isFinite(ms)) return "";
  const m = Math.round(ms / 60000);
  return m < 1 ? L("just now", "baru sahaja") : m < 60 ? L(`${m} min ago`, `${m} min lalu`) : m < 1440 ? L(`${Math.round(m / 60)} h ago`, `${Math.round(m / 60)} j lalu`) : L(`${Math.round(m / 1440)} d ago`, `${Math.round(m / 1440)} h lalu`);
};
/** Minutes since a SQLite UTC stamp, or null. */
const minutesSince = (t: string | null): number | null => (t ? (Date.now() - Date.parse(`${t.replace(" ", "T")}Z`)) / 60000 : null);
/* the store is "reading" when it read the feed within this long */
const READ_FRESH_MIN = 15;
const ACT_WORD: Record<string, [string, string]> = {
  "inventory.bridge": ["Publish / web price", "Terbit / harga web"], "inventory.elfia": ["Collection, description or discount", "Koleksi, penerangan atau diskaun"],
  "inventory.elfia_photo": ["Photo uploaded", "Foto dimuat naik"], "inventory.elfia_photo_restore": ["Photo restored", "Foto dipulihkan"],
  "elfia.bulk_discount": ["Bulk discount", "Diskaun pukal"], "elfia.bulk_price": ["Bulk web price", "Harga web pukal"], "elfia.flash_sale": ["Flash sale", "Jualan kilat"],
  "elfia.sync_now": ["Update the shop now", "Kemas kini kedai"], "elfia.delivery": ["Delivery charges", "Caj penghantaran"],
  "elfia.slide_create": ["Carousel slide added", "Slaid ditambah"], "elfia.slide_photo": ["Carousel photo", "Foto karusel"], "elfia.slide_update": ["Carousel slide edited", "Slaid disunting"],
  "elfia.slide_remove": ["Carousel slide removed", "Slaid dibuang"], "elfia.slide_cutout": ["Carousel cut-out", "Potongan karusel"], "elfia.catalog_pdf": ["Catalog PDF", "PDF katalog"],
  "elfia.catalog_map": ["Catalog labels", "Label katalog"], "elfia.catalog_cover": ["Catalog cover", "Kulit katalog"], "elfia.catalog_remove": ["Catalog removed", "Katalog dibuang"],
  "elfia.backdrop": ["Hover backdrop", "Latar hover"], "elfia.backdrop_remove": ["Hover backdrop removed", "Latar hover dibuang"],
};


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
  /* v1.235.0 - what the store actually did */
  feed_last_read_at?: string | null;
  feed_last_count?: number | null;
  last_sync_now?: { at: string; who: string | null; result: { created?: number; updated?: number; prices?: number } } | null;
  store_url?: string | null;
  rejected_orders?: number;
  refunds_pending?: number;
  sku_key_collisions?: { sku_key: string; n: number }[];
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

export function ElfiaStorePanel({ role = "" }: { role?: string }) {
  /* v1.235.0 - the owner: price, discount, publish, bulk and Update now are
     the CEO, COO and super admin's (= PERMS.elfia_publish, enforced there) */
  const canPrice = holds("elfia_publish", ELFIA_PUBLISH_ROLES.includes(role));
  const [tab, setTab] = useState<"overview" | "products" | "publishing">("products");
  const [editId, setEditId] = useState<number | null>(null);
  const [statusF, setStatusF] = useState<"" | "published" | "hidden">("");
  const [stockF, setStockF] = useState<"" | "in" | "out">("");
  const [activity, setActivity] = useState<{ feed_last_read_at: string | null; waiting: { sku: string; changed_at: string }[]; changed: Record<string, string>; events: { id: number; action: string; at: string; who: string | null; sku: string | null; item: string | null; detail: string | null }[] } | null>(null);
  const { confirm, node: confirmNode } = useConfirm();
  const [items, setItems] = useState<ElfiaItem[]>([]);
  const [slides, setSlides] = useState<Slide[] | null>(null); // null = 0087 pending or loading
  const [busySlide, setBusySlide] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [health, setHealth] = useState<BridgeHealth | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busyPhoto, setBusyPhoto] = useState<number | null>(null);
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
  /* v1.63.0 — bulk PRICE (the sibling of bulk discount: one changes what
     comes OFF a price, this changes the price itself) and the FLASH SALE
     window. `priceDir` carries the sign for the ± modes so the input box
     never has to accept a minus — a stray "-" turning a price rise into a
     cut is not a mistake worth leaving available. */
  const [priceMode, setPriceMode] = useState<"set" | "percent" | "amount">("set");
  const [priceDir, setPriceDir] = useState<1 | -1>(-1);
  const [priceValue, setPriceValue] = useState("");
  const [busyPrice, setBusyPrice] = useState(false);
  const [flashUntil, setFlashUntil] = useState("");
  /* Which collection the list is showing. Selection is scoped to it. */
  const [view, setView] = useState("all");
  const [q, setQ] = useState(""); // v1.122.0 - find by SKU, name or collection
  /* v1.68.0: the flash sale sets its own price. "% off" by default, because
     a flash sale is nearly always announced as a percentage. */
  const [flashMode, setFlashMode] = useState<"percent" | "amount">("percent");
  const [flashValue, setFlashValue] = useState("");
  const [busyFlash, setBusyFlash] = useState(false);
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

  const load = useCallback(async () => {
    void api<NonNullable<typeof activity>>(`/elfia/activity`).then((r) => setActivity(r.ok && r.data ? r.data : null)); // v1.235.0
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
  /* v1.68.0 (CEO: "when I choose Bawal, it doesnt only show Bawal").
     He was right, and the fault was ours: those links SELECTED a collection
     and left all 22 products on screen. Selecting ten things you cannot see
     is not a workflow — you tick a collection precisely so you can check
     what you are about to reprice.
     So collection is now a FILTER, and selecting is a separate act on what
     the filter is showing. Two words, "Show" and "Select", doing one job
     each. */
  const collections = [...new Set(items.map((x) => (x.elfia_category ?? "").trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  const needle = q.trim().toLowerCase();
  const inView = (view === "all" ? items
    : items.filter((x) => (x.elfia_category ?? "").trim() === view))
    .filter((x) => !needle || x.sku.toLowerCase().includes(needle) || x.name.toLowerCase().includes(needle) || (x.elfia_category ?? "").toLowerCase().includes(needle))
    /* v1.235.0 - status and stock, beside the collection chips */
    .filter((x) => !statusF || (statusF === "published") === ((x.bridge_enabled ?? 0) === 1))
    .filter((x) => !stockF || (stockF === "in") === (x.stock > 0));
  const sorted = [...inView].sort((a, b) =>
    ((b.bridge_enabled ?? 0) - (a.bridge_enabled ?? 0)) ||
    a.sku.localeCompare(b.sku, undefined, { numeric: true }));
  const published = items.filter((x) => (x.bridge_enabled ?? 0) === 1);
  const publishedInView = inView.filter((x) => (x.bridge_enabled ?? 0) === 1);
  const missingPhoto = published.filter((x) => !x.elfia_image_key);
  const migrationPending = loaded && items.length > 0 && items.every((x) => x.elfia_image_key === undefined);



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
    /* v1.235.0 - never reprocess every live photo on one press without saying so */
    if (!(await confirm({ title: L(`Cut out the background on up to ${targets.length} photo(s)?`, `Buang latar sehingga ${targets.length} foto?`),
      message: L(`Every product with a photo is processed in this browser; photos already cut out are skipped. Each new photo is a NEW file - the old ones stay in each product's photo history and can be restored. The shop shows the new photos once the store reads the feed.\n\n${targets.slice(0, 12).map((x) => x.sku).join(", ")}${targets.length > 12 ? ` +${targets.length - 12}` : ""}`,
        `Setiap produk berfoto diproses dalam pelayar ini; foto yang sudah dipotong dilangkau. Setiap foto baharu ialah fail BAHARU - yang lama kekal dalam sejarah foto setiap produk dan boleh dipulihkan.\n\n${targets.slice(0, 12).map((x) => x.sku).join(", ")}${targets.length > 12 ? ` +${targets.length - 12}` : ""}`),
      confirmLabel: L("Cut out backgrounds", "Buang latar") }))) return;
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
    /* v1.235.0 - a preview and a confirmation before any live price moves */
    const pv = items.filter((x) => picked.has(x.id)).map((x) => {
      const base = priceState(x).base;
      const c = mode === "clear" ? 0 : mode === "percent" ? Math.round(base * value / 100) : Math.round(value * 100);
      return mode === "clear" ? `${x.sku}: ${L("discount removed", "diskaun dibuang")}`
        : base <= 0 || c <= 0 || c >= base ? `${x.sku}: ${L("skipped", "dilangkau")}`
        : `${x.sku}: RM ${rmBare(base)} → RM ${rmBare(base - c)}`;
    });
    if (!(await confirm({ title: L(`Change the discount on ${ids.length} live product(s)?`, `Tukar diskaun ${ids.length} produk?`), message: previewText(pv), confirmLabel: L("Apply discount", "Guna diskaun") }))) return;
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

  /* v1.63.0 — bulk WEB PRICE. The CEO: "I want to add price update in a
     bulk." Same reporting discipline as the discount above: skipped rows are
     NAMED, and so is any discount the new price stranded (RM 5 off a product
     just repriced to RM 4 cannot stand) — the server clears those and says
     which, rather than shipping a price no customer could be charged. */
  const applyPrice = async () => {
    const ids = [...picked];
    if (ids.length === 0) return;
    const value = Number(priceValue.trim());
    const bad = !Number.isFinite(value) || value <= 0 || (priceMode === "percent" && value >= 100);
    if (bad) {
      toast(L("Not applied", "Tidak digunakan"),
        priceMode === "percent"
          ? L("Enter a percentage above 0 and below 100", "Masukkan peratusan melebihi 0 dan kurang daripada 100")
          : L("Enter a positive RM amount", "Masukkan amaun RM positif"), "notice");
      return;
    }
    const pv = items.filter((x) => picked.has(x.id)).map((x) => {
      const base = priceState(x).base;
      const next = priceMode === "set" ? Math.round(value * 100) : priceMode === "percent" ? Math.round(base * (1 + priceDir * value / 100)) : base + priceDir * Math.round(value * 100);
      const d = x.elfia_discount_cents ?? 0;
      return next <= 0 || base <= 0 && priceMode !== "set" ? `${x.sku}: ${L("skipped", "dilangkau")}` : `${x.sku}: RM ${base > 0 ? rmBare(base) : "—"} → RM ${rmBare(next)}${d > 0 && d >= next ? ` · ${L("discount cleared", "diskaun dibuang")}` : ""}`;
    });
    if (!(await confirm({ title: L(`Change the web price of ${ids.length} live product(s)?`, `Tukar harga web ${ids.length} produk?`), message: previewText(pv), confirmLabel: L("Apply price", "Guna harga") }))) return;
    setBusyPrice(true);
    try {
      const res = await api<{ applied?: { sku: string }[]; skipped?: { sku: string; why: string }[];
        discount_cleared?: string[]; error?: { message?: string } }>(
        `/elfia/bulk-price`,
        { method: "POST", body: JSON.stringify({ ids, mode: priceMode, value, direction: priceMode === "set" ? 1 : priceDir }) });
      if (!res.ok) {
        toast(L("Not applied", "Tidak digunakan"), res.data?.error?.message ?? L("Update failed", "Kemas kini gagal"), "notice");
        return;
      }
      const n = res.data?.applied?.length ?? 0;
      const skip = res.data?.skipped ?? [];
      const cleared = res.data?.discount_cleared ?? [];
      toast(
        skip.length || cleared.length ? L("Priced, with exceptions", "Diharga, dengan pengecualian") : L("Priced", "Diharga"),
        `${n} ${L("product", "produk")}${n === 1 ? "" : "s"}` +
        (cleared.length ? ` · ${L("discount cleared on", "diskaun dibuang pada")}: ${cleared.slice(0, 4).join(", ")}${cleared.length > 4 ? ` +${cleared.length - 4}` : ""}` : "") +
        (skip.length ? ` · ${L("skipped", "dilangkau")}: ${skip.slice(0, 4).map((s) => `${s.sku} (${s.why})`).join(", ")}${skip.length > 4 ? ` +${skip.length - 4}` : ""}` : ""),
        skip.length || cleared.length ? "notice" : undefined);
      setPicked(new Set());
      void load();
    } finally { setBusyPrice(false); }
  };

  /* v1.63.0 — the FLASH SALE window. `until` null ENDS it: the discount
     stays, it simply stops being a flash sale. Ending is a separate button
     from setting, for the same reason "Remove discount" is: a box that means
     both "this time" and "no time" is a box that gets misread.

     The deadline is typed in the browser's own local time and sent as an
     absolute instant, so the shop's countdown and the office's clock cannot
     disagree about when the sale ends. */
  const applyFlash = async (end: boolean) => {
    const ids = [...picked];
    if (ids.length === 0) return;
    if (!end && flashUntil.trim() === "") {
      toast(L("Not applied", "Tidak digunakan"),
            L("Pick the date and time the sale ends", "Pilih tarikh dan masa jualan tamat"), "notice");
      return;
    }
    /* datetime-local has no timezone; the Date constructor reads it as local
       time, and toISOString turns it into the absolute instant the server
       stores. */
    const untilIso = end ? null : new Date(flashUntil).toISOString();
    if (!end && !Number.isFinite(Date.parse(untilIso ?? ""))) {
      toast(L("Not applied", "Tidak digunakan"), L("That date and time is not valid", "Tarikh dan masa itu tidak sah"), "notice");
      return;
    }
    if (!(await confirm({ title: end ? L(`End the flash sale on ${ids.length} product(s)?`, `Tamatkan jualan kilat ${ids.length} produk?`) : L(`Start a flash sale on ${ids.length} product(s)?`, `Mula jualan kilat ${ids.length} produk?`),
      message: previewText(items.filter((x) => picked.has(x.id)).map((x) => `${x.sku}${end ? "" : ` · ${L("until", "hingga")} ${new Date(flashUntil).toLocaleString()}`}${!end && flashValue.trim() ? ` · ${flashValue}${flashMode === "percent" ? "%" : " RM"} ${L("off", "potongan")}` : ""}`)),
      confirmLabel: end ? L("End flash sale", "Tamatkan jualan kilat") : L("Start flash sale", "Mula jualan kilat") }))) return;
    setBusyFlash(true);
    try {
      /* The price rides with the deadline. Blank means "keep whatever
         discount these already have", which is the old behaviour and still
         the right answer for items already marked down. */
      const fv = Number(flashValue);
      const withPrice = !end && flashValue.trim() !== "" && Number.isFinite(fv) && fv > 0;
      const res = await api<{ applied?: string[]; skipped?: { sku: string; why: string }[]; error?: { message?: string } }>(
        `/elfia/flash-sale`, {
          method: "POST",
          body: JSON.stringify({ ids, until: untilIso,
                                 ...(withPrice ? { discount: { mode: flashMode, value: fv } } : {}) }),
        });
      if (!res.ok) {
        toast(L("Not applied", "Tidak digunakan"), res.data?.error?.message ?? L("Update failed", "Kemas kini gagal"), "notice");
        return;
      }
      const n = res.data?.applied?.length ?? 0;
      const skip = res.data?.skipped ?? [];
      toast(
        end ? L("Flash sale ended", "Jualan kilat ditamatkan") : L("Flash sale set", "Jualan kilat ditetapkan"),
        `${n} ${L("product", "produk")}${n === 1 ? "" : "s"}` +
        (skip.length ? ` · ${L("skipped", "dilangkau")}: ${skip.slice(0, 3).map((s) => `${s.sku} (${s.why})`).join(", ")}${skip.length > 3 ? ` +${skip.length - 3}` : ""}` : ""),
        skip.length ? "notice" : undefined);
      setPicked(new Set());
      setFlashValue("");
      void load();
    } finally { setBusyFlash(false); }
  };

  /* v1.53.0 — ask the shop whether online payment is working. Deliberately
     NOT part of the tab's first load: it makes the shop call the gateway, and
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
    void load(); // v1.235.0 - the health card shows the store's own answer
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

  /* ---- v1.235.0 - THREE TABS (the owner's ELFIA Store 2.0 brief and answers,
     30-10-2026; claude/ELFIA-STORE-AUDIT.md). Overview: what the store
     actually did, the figures the database proves, the warnings, and the
     shop settings. Products & Pricing: the table and the drawer. Publishing
     & Sync: the store's reads, Update now, what is waiting, the activity -
     and the shopfront content the store reads from the same feed. Every
     card that existed is kept; nothing here is a second catalogue. ---- */
  const editing = editId !== null ? items.find((x) => x.id === editId) ?? null : null;
  const lastRead = health?.feed_last_read_at ?? activity?.feed_last_read_at ?? null;
  const readAgeMin = minutesSince(lastRead);
  const conn: "loading" | "unavailable" | "nokey" | "never" | "reading" | "stale" = !health ? "loading" : health.unavailable ? "unavailable"
    : !health.key_configured ? "nokey" : !lastRead ? "never" : (readAgeMin ?? 1e9) <= READ_FRESH_MIN ? "reading" : "stale";
  const syncAt = health?.last_sync_now?.at ?? null;
  const lastVerified = [lastRead, syncAt].filter(Boolean).sort().pop() ?? null;
  const changed = activity?.changed ?? null;
  const publishedSkus = new Set(published.map((x) => x.sku));
  const waiting = (activity?.waiting ?? []).filter((w) => items.some((i) => i.sku === w.sku));
  const leftOut = published.filter((x) => x.status === "discontinued");
  const noPrice = published.filter((x) => priceState(x).base <= 0);
  const ignored = published.filter((x) => { const p = priceState(x); return p.disc > 0 && (p.tooBig || p.ended); });
  const warnings: { key: string; title: string; detail: string; skus: ElfiaItem[] }[] = [
    ...(migrationPending ? [{ key: "mig", title: L("Migration 0086 not applied", "Migrasi 0086 belum digunakan"), detail: L("Photo, collection and description cannot save until it runs.", "Foto, koleksi dan penerangan tidak boleh disimpan sehingga ia dijalankan."), skus: [] }] : []),
    ...(conn === "stale" || conn === "never" ? [{ key: "read", title: conn === "never" ? L("The store has not read the feed since this check was added", "Kedai belum membaca suapan sejak semakan ini ditambah") : L(`The store has not read the feed for ${Math.round(readAgeMin ?? 0)} min`, `Kedai tidak membaca suapan selama ${Math.round(readAgeMin ?? 0)} min`), detail: L("Changes saved here are not reaching the shop. Try Update the shop now, or check the store.", "Perubahan yang disimpan tidak sampai ke kedai. Cuba Kemas kini kedai, atau semak kedai."), skus: [] }] : []),
    ...(leftOut.length ? [{ key: "out", title: L("Published but left out of the shop", "Diterbitkan tetapi dikecualikan dari kedai"), detail: L("Discontinued in Inventory - the feed leaves them out.", "Dihentikan dalam Inventori - suapan tidak menghantarnya."), skus: leftOut }] : []),
    ...(noPrice.length ? [{ key: "price", title: L("Published without a price", "Diterbitkan tanpa harga"), detail: L("No web price and no list price.", "Tiada harga web dan tiada harga senarai."), skus: noPrice }] : []),
    ...(ignored.length ? [{ key: "disc", title: L("A discount the shop ignores", "Diskaun yang diabaikan kedai"), detail: L("Not below the price, or its flash sale has ended - the shop charges the full price.", "Tidak di bawah harga, atau jualan kilatnya tamat - kedai mengenakan harga penuh."), skus: ignored }] : []),
    ...(missingPhoto.length && !migrationPending ? [{ key: "photo", title: L("Published without a photo", "Diterbitkan tanpa foto"), detail: L("The shop shows a plain placeholder.", "Kedai memaparkan pemegang tempat kosong."), skus: missingPhoto }] : []),
    ...(health && health.unknown_24h > 0 ? [{ key: "unk", title: L(`${health.unknown_24h} web sale(s) for SKUs the portal does not know (24 h)`, `${health.unknown_24h} jualan web untuk SKU yang tidak dikenali (24 j)`), detail: health.unknown.slice(0, 6).map((u) => u.sku).join(", "), skus: [] }] : []),
    ...(health?.sku_key_collisions?.length ? [{ key: "coll", title: L("SKUs that answer to the same store code", "SKU yang menjawab kod kedai yang sama"), detail: health.sku_key_collisions.map((c) => c.sku_key).join(", "), skus: [] }] : []),
  ];
  const connChip = conn === "reading" ? <span className={chipSuccess}>{L("Connected", "Bersambung")}</span>
    : conn === "loading" ? <Skel className="h-5 w-24 rounded-full" />
    : conn === "nokey" ? <span className={chipWarn}>{L("Key not set", "Kunci belum ditetapkan")}</span>
    : conn === "unavailable" ? <span className={chipNeutral}>{L("Status unavailable", "Status tidak tersedia")}</span>
    : <span className={chipWarn}>{conn === "never" ? L("Not read yet", "Belum dibaca") : L("Not reading", "Tidak membaca")}</span>;
  const connText = conn === "reading" ? L(`The store read the feed ${ago(lastRead)}${health?.feed_last_count != null ? ` · ${health.feed_last_count} products` : ""}`, `Kedai membaca suapan ${ago(lastRead)}${health?.feed_last_count != null ? ` · ${health.feed_last_count} produk` : ""}`)
    : conn === "nokey" ? L("The store cannot connect (ELFIA_BRIDGE_KEY)", "Kedai tidak boleh sambung (ELFIA_BRIDGE_KEY)")
    : conn === "unavailable" ? L("Deploy azoneofficial-api, then reload.", "Deploy azoneofficial-api, kemudian muat semula.")
    : conn === "never" ? L("No read recorded yet - it appears after the next read.", "Belum ada bacaan direkod - ia muncul selepas bacaan seterusnya.")
    : conn === "stale" ? L(`Last read ${ago(lastRead)}`, `Bacaan terakhir ${ago(lastRead)}`) : "";
  const updateBtn = canPrice ? (
    <button type="button" className={btnSm} disabled={syncing} onClick={() => void syncShopNow()}>
      <AppIcon name="refresh" />{syncing ? L("Updating the shop…", "Mengemas kini kedai…") : L("Update the shop now", "Kemas kini kedai sekarang")}
    </button>
  ) : null;

  return (
    <div className="erp-stack erp-tab-page">
      {toastNode}{confirmNode}
      {/* v1.49.0 — every collection name already in use, offered to every
          Collection box. Built from the items themselves. */}
      <datalist id="elfia-collections">
        {[...new Set(items.map((x) => (x.elfia_category ?? "").trim()).filter(Boolean))]
          .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
          .map((c) => <option key={c} value={c} />)}
      </datalist>

      <div className={es.pageHead}>
        <p className={es.sub}>{L("Your products, prices, photos and the ELFIA web store's publishing - one product record, stock from Inventory.", "Produk, harga, foto dan penerbitan kedai web ELFIA - satu rekod produk, stok dari Inventori.")}</p>
        <div className={es.headActions}>
          {health?.store_url && <a className={btnSm} href={health.store_url} target="_blank" rel="noopener noreferrer"><AppIcon name="external" />{L("View shop", "Lihat kedai")}</a>}
          {updateBtn}
        </div>
      </div>
      <LineTabs value={tab} onChange={(k) => setTab(k)} label={L("ELFIA Store", "Kedai ELFIA")} tabs={[
        ["overview", L("Overview", "Gambaran")],
        ["products", L("Products & Pricing", "Produk & Harga")],
        ["publishing", L("Publishing & Sync", "Penerbitan & Segerak")],
      ] as const} />

      {/* ================= OVERVIEW ================= */}
      <div hidden={tab !== "overview"} className="erp-stack">
      <section className="erp-stack-tight erp-tab-zone">
        <ZoneLabel>{L("The shop", "Kedai")}</ZoneLabel>
        <div className={card} aria-label={L("ELFIA web store", "Kedai web ELFIA")}>
          <div className={es.strip}>
            <div className={es.stripCell}>
              <span className={es.well}><AppIcon name="store" /></span>
              <span className={es.cellText}><strong>{L("ELFIA web store", "Kedai web ELFIA")} {connChip}</strong><span>{connText}</span></span>
            </div>
            <div className={es.stripCell}>
              <span className={es.well}><AppIcon name="refresh" /></span>
              <span className={es.cellText}><strong>{L("Last verified sync", "Segerak terakhir disahkan")}</strong>
                <span>{lastVerified ? `${lastVerified.slice(0, 16)} UTC · ${ago(lastVerified)}` : L("None recorded yet", "Belum direkod")}</span></span>
            </div>
            <div className={es.stripCell}>
              <span className={es.well}><AppIcon name="receipt" /></span>
              <span className={es.cellText}><strong>{L("Last sale reported", "Jualan terakhir dilaporkan")}</strong>
                <span>{health?.last_event_at ? `${health.last_event_at.slice(0, 16)} UTC · ${ago(health.last_event_at)}` : L("never", "belum ada")}</span>
                <span>{L("Sales and orders are in Ecommerce", "Jualan dan pesanan di Ecommerce")}</span></span>
            </div>
          </div>
        </div>
        <KpiRow label={L("ELFIA at a glance", "ELFIA sepintas lalu")}>
          <KpiTile icon="package" tone="navy" busy={!loaded} label={L("Catalogue items", "Barang katalog")} value={String(items.length)} sub={L("Inventory items", "Barang inventori")} />
          <KpiTile icon="store" tone="green" busy={!loaded} label={L("Published", "Diterbitkan")} value={`${published.length}/${items.length}`} sub={leftOut.length ? L(`${leftOut.length} left out (discontinued)`, `${leftOut.length} dikecualikan`) : L("in the shop's feed", "dalam suapan kedai")} />
          <KpiTile icon="pending" tone="blue" busy={!activity && loaded} label={L("Waiting for the store", "Menunggu kedai")} value={String(waiting.length)} sub={L("changed since its last read", "berubah sejak bacaan terakhir")} />
          <KpiTile icon="warning" tone="gold" busy={!loaded} label={L("Warnings", "Amaran")} value={String(warnings.length)} sub={warnings.length ? L("see below", "lihat di bawah") : L("nothing to fix", "tiada untuk dibaiki")} />
        </KpiRow>
        <div className={card} aria-label={L("Warnings", "Amaran")}>
          <p className="text-sm font-semibold">{L("Needs attention", "Perlu perhatian")}</p>
          {!loaded ? <Skel className="mt-2 h-16 w-full" /> : warnings.length === 0 ? (
            <p className={es.sub}>{L("Nothing to fix - every published product has a price, a photo and a discount the shop applies.", "Tiada untuk dibaiki - setiap produk diterbitkan ada harga, foto dan diskaun yang digunakan kedai.")}</p>
          ) : (
            <ul className={es.list}>{warnings.map((w) => (
              <li key={w.key}>
                <span className={es.main}><strong>{w.title}{w.skus.length ? ` (${w.skus.length})` : ""}</strong><span>{w.detail}</span></span>
                {w.skus.length > 0 && <span className={es.chipsRow}>{w.skus.slice(0, 6).map((x) => (
                  <button key={x.id} type="button" className={es.linkBtn} onClick={() => { setTab("products"); setEditId(x.id); }}>{x.sku}</button>
                ))}{w.skus.length > 6 ? <span className={es.sub}>+{w.skus.length - 6}</span> : null}</span>}
              </li>
            ))}</ul>
          )}
        </div>
      </section>
      <section className="erp-stack-tight erp-tab-zone">
        <ZoneLabel>{L("Settings", "Tetapan")}</ZoneLabel>
      <div className="grid grid-cols-1 items-start gap-3 md:gap-4 lg:grid-cols-2">
      {/* ---- what delivery costs (v1.52.0) ----
          The CEO, 26-08-2026: "I want to have the authority to update the
          shipping fees which is above RM45.00, I will provide a free
          delivery fees." Both numbers used to be in the store's config file,
          so changing them meant a code edit and a deploy. They are hers now.
          The sentence below the boxes is the exact sentence the shop shows a
          customer, built from what is currently typed — the point being that
          nobody should have to imagine what these two numbers add up to. */}
      <QuietCard title={L("Delivery charges", "Caj penghantaran")} summary={deliverySaved ? `RM ${deliverySaved.ship || "0"} · ${L("free over RM", "percuma melebihi RM")} ${deliverySaved.free || "—"}` : undefined}>
        
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
          <p className="mt-2 text-xs font-medium text-warning">
            {L("Not set here yet — the shop is using its own built-in amounts. Save once and this tab takes over.",
               "Belum ditetapkan di sini — kedai menggunakan jumlah terbina dalamnya sendiri. Simpan sekali dan tab ini akan mengambil alih.")}
          </p>
        )}
      </QuietCard>

      {/* ---- can customers pay online? (v1.53.0) ----
          The CEO, 26-08, on the live shop: "This appear on the gateway
          payment!" — the customer-facing "Payment gateway unavailable", with
          nowhere to find out why. The store writes the gateway's own reply down
          now; this is the window onto it. */}
      <QuietCard title={L("Online payment (Bayarcash FPX)", "Pembayaran dalam talian (Bayarcash FPX)")} summary={pay ? (pay.ok ? `${L("keys working", "kunci berfungsi")}${pay.sandbox ? " · sandbox" : ""}` : L("not working", "tidak berfungsi")) : L("not checked yet", "belum disemak")}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            
            <p className="text-muted-foreground mt-0.5 text-xs">
              {L("Checks the shop's payment token against Bayarcash. Read-only — it creates no payment and moves no money.",
                 "Menyemak token pembayaran kedai dengan Bayarcash. Baca sahaja — tiada pembayaran dicipta dan tiada wang berpindah.")}
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
                  {pay.signature_key_set === false && <span className={chipNeutral}>{L("No API Secret Key", "Tiada API Secret Key")}</span>}
                </p>
                <p className="text-muted-foreground">{pay.message}</p>
                {pay.warning && <p className="font-medium text-warning">{pay.warning}</p>}

                {/* The credential check passing is a weaker claim than "the
                    last customer could pay". This is the stronger one. */}
                {pay.last_gateway_error && (
                  <div className="rounded-lg border border-warning/30 bg-warning-soft p-2.5">
                    <p className="font-semibold text-warning">
                      {L("Last time a customer could not pay", "Kali terakhir pelanggan tidak dapat membayar")}
                    </p>
                    <p className="mt-1 font-mono text-[11px] break-words text-warning">
                      {pay.last_gateway_error}
                    </p>
                    {pay.last_gateway_hint && (
                      <p className="mt-1.5 text-warning">{pay.last_gateway_hint}</p>
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
      </QuietCard>

      </div>
      </section>
      </div>

      {/* ================= PRODUCTS & PRICING ================= */}
      <div hidden={tab !== "products"} className="erp-stack">
      <section className="erp-stack-tight erp-tab-zone">
        <ZoneLabel>{L("Products", "Produk")}</ZoneLabel>
      {/* ---- the catalogue ---- */}
      <div className={card}>
        <p className="text-sm font-semibold">{L("Products on the ELFIA store", "Produk di kedai ELFIA")}</p>
        <p className="text-muted-foreground mt-0.5 text-xs">
          {L("Every product is an Inventory item - stock comes from Inventory. Press a product (or Edit) to change its photo, price, collection, description or publishing, then Save. The TikTok live rebate never applies online.",
             "Setiap produk ialah barang Inventori - stok datang dari Inventori. Tekan produk (atau Sunting) untuk menukar foto, harga, koleksi, penerangan atau penerbitan, kemudian Simpan. Rebat live TikTok tidak sekali-kali terpakai dalam talian.")}
        </p>

        {/* v1.77.0 — skeleton until the first fetch lands: the Show/Select
            rows, then product cards in the list's own shape — tick, 16×20
            photo, SKU + name, the price boxes — so nothing jumps. */}
        {!loaded && (
          <div aria-hidden>
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <Skel className="h-3 w-10" />
              <Skel className="h-5 w-16 rounded-full" />
              <Skel className="h-5 w-20 rounded-full" />
              <Skel className="h-5 w-24 rounded-full" />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-3">
              <Skel className="h-3 w-12" />
              <Skel className="h-3 w-32" />
              <Skel className="h-3 w-28" />
            </div>
            <div className="mt-3 space-y-2">
              {Array.from({ length: 4 }, (_, i) => (
                <div key={i} className={insetCard}>
                  <div className="flex flex-wrap items-start gap-3">
                    <Skel className="mt-7 h-4 w-4 shrink-0" />
                    <Skel className="h-20 w-16 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Skel className="h-3 w-16" />
                        <Skel className="h-4 w-40" />
                        <Skel className="h-5 w-20 rounded-full" />
                      </div>
                      <div className="mt-3 flex flex-wrap items-end gap-3">
                        <Skel className="h-9 w-28" />
                        <Skel className="h-9 w-28" />
                        <Skel className="h-9 w-36" />
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
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
          <>
            {/* SHOW — a filter. Changing it clears the selection, because a
                tick you can no longer see is a tick you will forget you
                made, and the next Apply would reprice it. */}
            <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs">
              <input className={`${inputClass} h-8 min-w-0 flex-1 text-xs sm:max-w-60`} value={q} placeholder={L("Find by SKU, name or collection", "Cari ikut SKU, nama atau koleksi")}
                aria-label={L("Find a product", "Cari produk")} onChange={(e) => { setQ(e.target.value); setPicked(new Set()); }} />
              <select className={selectClassSm} value={statusF} onChange={(e) => { setStatusF(e.target.value as typeof statusF); setPicked(new Set()); }} aria-label={L("Status", "Status")}>
                <option value="">{L("All status", "Semua status")}</option><option value="published">{L("Published", "Diterbitkan")}</option><option value="hidden">{L("Not on the store", "Tiada di kedai")}</option>
              </select>
              <select className={selectClassSm} value={stockF} onChange={(e) => { setStockF(e.target.value as typeof stockF); setPicked(new Set()); }} aria-label={L("Stock", "Stok")}>
                <option value="">{L("All stock", "Semua stok")}</option><option value="in">{L("In stock", "Ada stok")}</option><option value="out">{L("Out of stock", "Habis stok")}</option>
              </select>
              <span className="text-muted-foreground mr-1">{L("Show:", "Papar:")}</span>
              {([["all", L("All", "Semua"), items.length] as const,
                 ...collections.map((c) => [c, c, items.filter((x) => (x.elfia_category ?? "").trim() === c).length] as const)])
                .map(([key, label, n]) => (
                  <button key={key} type="button"
                    className={view === key
                      ? "bg-primary text-primary-foreground rounded-full px-2.5 py-0.5 font-medium"
                      : "border-border text-muted-foreground hover:bg-secondary rounded-full border px-2.5 py-0.5"}
                    onClick={() => { setView(key); setPicked(new Set()); }}>
                    {label} ({n})
                  </button>
                ))}
            </div>

            {/* SELECT — an action, on what is showing. v1.235.0: only for those
                who may change prices (the bulk bar below is theirs) */}
            {canPrice && <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
              <span className="text-muted-foreground">{L("Select:", "Pilih:")}</span>
              <button type="button" className="underline underline-offset-2"
                onClick={() => setPicked(new Set(sorted.map((x) => x.id)))}>
                {view === "all"
                  ? L(`everything shown (${sorted.length})`, `semua yang dipapar (${sorted.length})`)
                  : L(`all ${view} (${sorted.length})`, `semua ${view} (${sorted.length})`)}
              </button>
              <button type="button" className="underline underline-offset-2"
                onClick={() => setPicked(new Set(publishedInView.map((x) => x.id)))}>
                {L(`published only (${publishedInView.length})`, `yang diterbitkan sahaja (${publishedInView.length})`)}
              </button>
              {picked.size > 0 && (
                <button type="button" className="text-muted-foreground underline underline-offset-2"
                  onClick={() => setPicked(new Set())}>
                  {L("clear selection", "kosongkan pilihan")}
                </button>
              )}
            </div>}
          </>
        )}

        {canPrice && picked.size > 0 && (
          <div className="mt-2 flex flex-wrap items-end gap-2 rounded-lg border border-warning/30 bg-warning-soft p-2.5">
            <span className="text-xs font-semibold text-warning">
              {picked.size} {L("selected", "dipilih")}
            </span>
            <label className="flex items-center gap-1.5 text-xs">
              <select value={bulkMode} onChange={(e) => setBulkMode(e.target.value as "amount" | "percent")}
                className={selectClassSm}
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

            {/* ---- v1.63.0: bulk WEB PRICE ----
                Its own row, and deliberately below the discount: the two are
                easy to confuse, and the price is the number the discount
                comes off. */}
            <div className="border-warning/30 mt-1 w-full border-t pt-2">
              <div className="flex flex-wrap items-end gap-2">
                <span className="text-xs font-semibold text-warning">
                  {L("Web price", "Harga web")}
                </span>
                <label className="flex items-center gap-1.5 text-xs">
                  <select value={priceMode} onChange={(e) => setPriceMode(e.target.value as "set" | "percent" | "amount")}
                    className={selectClassSm}
                    aria-label={L("Price change type", "Jenis perubahan harga")}>
                    <option value="set">{L("set to RM", "tetapkan RM")}</option>
                    <option value="percent">{L("by %", "mengikut %")}</option>
                    <option value="amount">{L("by RM", "mengikut RM")}</option>
                  </select>
                  {priceMode !== "set" && (
                    <select value={priceDir} onChange={(e) => setPriceDir(Number(e.target.value) === 1 ? 1 : -1)}
                      className={selectClassSm}
                      aria-label={L("Up or down", "Naik atau turun")}>
                      <option value={-1}>{L("down", "turun")}</option>
                      <option value={1}>{L("up", "naik")}</option>
                    </select>
                  )}
                  <input value={priceValue} onChange={(e) => setPriceValue(e.target.value)}
                    inputMode="decimal" placeholder={priceMode === "percent" ? "10" : "14.00"}
                    aria-label={L("Price value", "Nilai harga")}
                    className={`${inputClass} w-20`} />
                </label>
                <button type="button" className={btnSm} disabled={busyPrice}
                  onClick={() => void applyPrice()}>
                  {busyPrice ? L("Pricing…", "Menetapkan…") : L("Apply price", "Guna harga")}
                </button>
                <span className="text-muted-foreground w-full text-[11px]">
                  {priceMode === "set"
                    ? L("Every selected product becomes this price. A discount that no longer fits under it is cleared and named.",
                        "Setiap produk dipilih menjadi harga ini. Diskaun yang tidak lagi muat akan dibuang dan dinamakan.")
                    : L("Worked out from each product's own current web price, so a range keeps its ladder. Anything it cannot apply to is named.",
                        "Dikira daripada harga web semasa setiap produk, jadi julat mengekalkan tangganya. Apa-apa yang tidak boleh digunakan akan dinamakan.")}
                </span>
              </div>
            </div>

            {/* ---- v1.63.0: FLASH SALE ----
                Not a category: a deadline on the discount the item already
                has. When it passes the price reverts by itself on the next
                sync — nobody has to remember to end it. */}
            <div className="border-warning/30 mt-1 w-full border-t pt-2">
              <div className="flex flex-wrap items-end gap-2">
                <span className="text-xs font-semibold text-warning">
                  <AppIcon name="fast" className="mr-1 h-3.5 w-3.5" />{L("Flash sale", "Jualan kilat")}
                </span>
                {/* v1.68.0 — the price lives HERE now.
                    A flash sale is a price and a deadline. Asking for them in
                    two different rows, and refusing anything not already
                    discounted somewhere else, was a form explaining itself
                    instead of doing the job. */}
                <label className="flex items-center gap-1.5 text-xs">
                  <select value={flashMode} onChange={(e) => setFlashMode(e.target.value as "percent" | "amount")}
                    aria-label={L("Flash price type", "Jenis harga kilat")}
                    className={`${inputClass} w-28`}>
                    <option value="percent">{L("% off", "% turun")}</option>
                    <option value="amount">{L("RM off", "RM turun")}</option>
                  </select>
                  <input value={flashValue} onChange={(e) => setFlashValue(e.target.value)}
                    inputMode="decimal" placeholder={flashMode === "percent" ? "20" : "3.00"}
                    aria-label={L("Flash sale price", "Harga jualan kilat")}
                    className={`${inputClass} w-24`} />
                </label>
                <label className="flex items-center gap-1.5 text-xs">
                  <span className="text-muted-foreground">{L("ends", "tamat")}</span>
                  <input type="datetime-local" value={flashUntil}
                    onChange={(e) => setFlashUntil(e.target.value)}
                    aria-label={L("Flash sale end time", "Masa tamat jualan kilat")}
                    className={`${inputClass} w-52`} />
                </label>
                <button type="button" className={btnSm} disabled={busyFlash}
                  onClick={() => void applyFlash(false)}>
                  {busyFlash ? L("Setting…", "Menetapkan…") : L("Start flash sale", "Mula jualan kilat")}
                </button>
                <button type="button" className={btnSm} disabled={busyFlash}
                  onClick={() => void applyFlash(true)}>
                  {L("End flash sale", "Tamatkan jualan kilat")}
                </button>
                <span className="text-muted-foreground w-full text-[11px]">
                  {L("Set the price and the end time together. Leave the price blank to put a deadline on the discount these products already have. The shop shows a red Flash Sale pill counting down, then puts the price back by itself — ending it early keeps the discount, it just stops being a flash sale.",
                     "Tetapkan harga dan masa tamat bersama. Biarkan harga kosong untuk meletakkan tarikh akhir pada diskaun sedia ada produk ini. Kedai menunjukkan pil merah Jualan Kilat mengira detik, kemudian mengembalikan harga dengan sendirinya — menamatkannya awal mengekalkan diskaun, cuma ia berhenti menjadi jualan kilat.")}
                </span>
              </div>
            </div>
          </div>
        )}

        {items.length > 0 && sorted.length === 0 && (
          <p className="text-muted-foreground mt-3 text-sm">
            {L("Nothing matches these filters.", "Tiada yang sepadan dengan penapis ini.")}{" "}
            <button type="button" className="underline underline-offset-2"
              onClick={() => { setView("all"); setQ(""); setStatusF(""); setStockF(""); setPicked(new Set()); }}>
              {L("Show all products", "Papar semua produk")}
            </button>
          </p>
        )}
        {loaded && sorted.length > 0 && (
          <ProductTable rows={sorted} picked={picked} setPicked={setPicked} onEdit={setEditId} changed={changed} lastRead={lastRead} selectable={canPrice} />
        )}
        {loaded && <p className={`${es.sub} mt-2`}>{L(`Showing ${sorted.length} of ${items.length} products`, `Memaparkan ${sorted.length} daripada ${items.length} produk`)}</p>}
      </div>
      </section>
      </div>

      {/* ================= PUBLISHING & SYNC ================= */}
      <div hidden={tab !== "publishing"} className="erp-stack">
      <section className="erp-stack-tight erp-tab-zone">
        <ZoneLabel>{L("Publishing", "Penerbitan")}</ZoneLabel>
        <div className={card} aria-label={L("Publishing health", "Kesihatan penerbitan")}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="text-sm font-semibold">{L("How a change reaches the shop", "Bagaimana perubahan sampai ke kedai")}</p>
              <p className={es.sub}>{L("Saved here → the store reads the feed (Read by the store) → the shop shows it. Only the store's own answer to Update now is shown as applied.", "Disimpan di sini → kedai membaca suapan (Dibaca kedai) → kedai memaparkannya. Hanya jawapan kedai kepada Kemas kini ditunjukkan sebagai digunakan.")}</p>
            </div>
            {updateBtn}
          </div>
          <ul className={`${es.list} mt-2`}>
            <li><span className={es.main}><strong>{L("Store connection", "Sambungan kedai")}</strong><span>{connText}</span></span>{connChip}</li>
            <li><span className={es.main}><strong>{L("Last Update the shop now", "Kemas kini kedai terakhir")}</strong><span>{health?.last_sync_now ? `${health.last_sync_now.at.slice(0, 16)} UTC · ${health.last_sync_now.who ?? "—"} · ${L("applied", "digunakan")}: ${(health.last_sync_now.result.created ?? 0)} ${L("new", "baharu")}, ${(health.last_sync_now.result.updated ?? 0)} ${L("updated", "dikemas kini")}, ${(health.last_sync_now.result.prices ?? 0)} ${L("prices", "harga")}` : L("Not pressed yet", "Belum ditekan")}</span></span>{health?.last_sync_now ? <span className={chipSuccess}>{L("Applied", "Digunakan")}</span> : null}</li>
            <li><span className={es.main}><strong>{L("Web sales reported (24 h)", "Jualan web dilaporkan (24 j)")}</strong><span>{health ? L(`${health.applied_24h} applied to stock · ${health.unknown_24h} unknown SKU`, `${health.applied_24h} dikenakan pada stok · ${health.unknown_24h} SKU tidak dikenali`) : "…"}</span></span></li>
            <li><span className={es.main}><strong>{L("Orders last pulled", "Pesanan terakhir ditarik")}</strong><span>{health?.last_poll_at ? `${health.last_poll_at.slice(0, 16)} UTC · ${ago(health.last_poll_at)}` : L("never", "belum ada")}{health?.rejected_orders ? ` · ${health.rejected_orders} ${L("rejected", "ditolak")}` : ""}{health?.refunds_pending ? ` · ${health.refunds_pending} ${L("refunds to decide (Ecommerce)", "bayaran balik (Ecommerce)")}` : ""}</span></span></li>
          </ul>
        </div>
        <div className={card} aria-label={L("Waiting for the store", "Menunggu kedai")}>
          <p className="text-sm font-semibold">{L("Waiting for the store", "Menunggu kedai")} <span className={es.sub}>({waiting.length})</span></p>
          {!activity ? <Skel className="mt-2 h-10 w-full" /> : waiting.length === 0 ? (
            <p className={es.sub}>{L("Nothing waiting - the store has read every saved change.", "Tiada yang menunggu - kedai telah membaca setiap perubahan.")}</p>
          ) : (
            <ul className={es.list}>{waiting.map((w) => {
              const it = items.find((i) => i.sku === w.sku);
              return (
                <li key={w.sku}><span className={es.main}><strong>{w.sku}{it ? ` · ${it.name}` : ""}</strong><span>{L("changed", "berubah")} {w.changed_at.slice(0, 16)} UTC · {publishedSkus.has(w.sku) ? L("published", "diterbitkan") : L("not published", "tidak diterbitkan")}</span></span>
                  <SyncChip state="waiting" /></li>
              );
            })}</ul>
          )}
        </div>
        <div className={card} aria-label={L("Activity", "Aktiviti")}>
          <p className="text-sm font-semibold">{L("Activity", "Aktiviti")}</p>
          <p className={es.sub}>{L("Every change to what the shop shows or charges, newest first - who, what and when.", "Setiap perubahan pada apa yang kedai papar atau caj, terbaru dahulu - siapa, apa dan bila.")}</p>
          {!activity ? <Skel className="mt-2 h-16 w-full" /> : activity.events.length === 0 ? <p className={es.sub}>{L("Nothing recorded yet.", "Belum ada rekod.")}</p> : (
            <ul className={es.list}>{activity.events.slice(0, 40).map((e) => (
              <li key={e.id}><span className={es.main}><strong>{ACT_WORD[e.action] ? L(ACT_WORD[e.action]![0], ACT_WORD[e.action]![1]) : e.action}{e.sku ? ` · ${e.sku}` : ""}</strong><span>{e.at.slice(0, 16)} UTC · {e.who ?? "—"}{e.sku && changed?.[e.sku] ? ` · ${syncOf(e.sku, changed, lastRead) === "read" ? L("read by the store", "dibaca kedai") : L("waiting for the store", "menunggu kedai")}` : ""}</span></span></li>
            ))}</ul>
          )}
        </div>
      </section>
      <section className="erp-stack-tight erp-tab-zone">
        <ZoneLabel>{L("The shopfront", "Muka kedai")}</ZoneLabel>
      {/* ---- the hero carousel (v1.46.0) ---- */}
      <QuietCard title={L("Homepage carousel", "Karusel halaman utama")} summary={slides ? `${slides.length} ${L("slides", "slaid")} · ${slides.filter((s) => s.active).length} ${L("active", "aktif")}` : undefined}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            
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

        {/* v1.77.0 — skeleton until the first fetch lands: three slide
            cards in the carousel's own grid, each the shop's 21:9 banner. */}
        {slides === null && !loaded && (
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-hidden>
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} className="border-border rounded-xl border p-2">
                <Skel className="aspect-[21/9] w-full" />
                <div className="mt-2 flex items-center justify-between gap-2">
                  <Skel className="h-3 w-24" />
                  <Skel className="h-5 w-16 rounded-full" />
                </div>
              </div>
            ))}
          </div>
        )}
        {slides === null && loaded && (
          <p className="mt-3 rounded-lg border border-warning/30 bg-warning-soft p-2 text-xs font-medium text-warning">
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
                    <input type="range" min={100} max={300} step={5}
                      key={`zoom:${zoomOf(sl)}`} defaultValue={zoomOf(sl)}
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
                          key={`cutscale:${Number(sl.cutout_scale) || 118}`}
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
                <input className={`${inputClass} mt-2 font-medium`}
                  placeholder={L("Big line (optional)", "Baris besar (pilihan)")} key={`title:${sl.title ?? ""}`} defaultValue={sl.title ?? ""} maxLength={120}
                  onBlur={(e) => { const v = e.target.value.trim(); if (v !== (sl.title ?? "")) void patchSlide(sl.id, { title: v }, L("caption saved", "kapsyen disimpan")); }} />
                <input className={`${inputClass} mt-1`}
                  placeholder={L("Small line (optional)", "Baris kecil (pilihan)")} key={`subtitle:${sl.subtitle ?? ""}`} defaultValue={sl.subtitle ?? ""} maxLength={200}
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
      </QuietCard>

      {/* ---- the catalog PDF (v1.55.0) ----
          The CEO: "the portal can upload the PDF for this catalog without
          the prices tag and it will automatically live price embedded to
          the PDF uploaded." Choosing a file reads it HERE in the browser —
          labels, positions, page-1 cover — and shows what was found before
          anything uploads. The shop prices those spots live on every
          download, so the PDF never goes stale. */}
      <QuietCard title={L("Catalog PDF", "PDF Katalog")} summary={cat?.live ? `${L("live on the shop", "disiarkan di kedai")}${cat.updated_at ? ` · ${cat.updated_at.slice(0, 10)}` : ""}` : L("built-in catalog", "katalog terbina dalam")}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            
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

        {/* v1.77.0 — skeleton until the first fetch lands: the Choose-a-PDF
            button row, where the real controls will sit. */}
        {cat === null && (
          <div className="mt-3 flex flex-wrap items-center gap-2" aria-hidden>
            <Skel className="h-7 w-28" />
            <Skel className="h-3 w-40" />
          </div>
        )}
        {cat?.unavailable && (
          <p className="mt-2 rounded-lg border border-warning/30 bg-warning-soft p-2 text-xs font-medium text-warning">
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
              <p className="text-xs font-medium text-warning">
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
                      <p className="mt-1 font-medium text-warning">
                        {L("None of the labels match a published product — the shop would add no prices. Check the names, or publish the products first.",
                           "Tiada label sepadan dengan produk diterbitkan — kedai tidak akan menambah harga. Semak nama, atau terbitkan produk dahulu.")}
                      </p>
                    )}
                    {/* v1.56.0 — the CEO's "missing prices tag": these are
                        the exact labels that will print WITHOUT a price.
                        Named, so a typo in the PDF or an unpublished
                        product is caught here, not in the printed file. */}
                    {catDraft.matched > 0 && catDraft.unmatched_labels.length > 0 && (
                      <p className="mt-1 font-medium text-warning">
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
                      <p className="mt-1 font-medium text-warning">
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
      </QuietCard>

      {/* ---- the /catalog hover backdrop (v1.61.0) ---- */}
      <QuietCard title={L("Catalog hover background", "Latar belakang hover katalog")} summary={backdrop?.key ? L("set", "ditetapkan") : L("none", "tiada")}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            
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

        {/* v1.77.0 — skeleton until the first fetch lands: the circular
            preview the shop's tiles crop to, beside its remove link. */}
        {backdrop === null && (
          <div className="mt-3 flex items-center gap-3" aria-hidden>
            <Skel className="h-20 w-20 shrink-0 rounded-full" />
            <Skel className="h-3 w-56 max-w-full" />
          </div>
        )}
        {backdrop?.unavailable && loaded && (
          <p className="mt-3 rounded-lg border border-warning/30 bg-warning-soft p-2 text-xs font-medium text-warning">
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
      </QuietCard>

      </section>
      </div>

      <ProductDrawer item={editing} onClose={() => setEditId(null)} canPrice={canPrice} onSaved={() => void load()}
        onUpload={uploadPhoto} onCut={cutBackground} busyPhoto={busyPhoto} busyCut={busyCut} />
    </div>
  );
}

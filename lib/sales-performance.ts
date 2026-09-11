/**
 * SALES PERFORMANCE - the rules the browser shares with the worker. v1.155.0.
 *
 * The CEO, 11-09-2026: one page that answers "did this staff member actually
 * work on sales today?" without relying on what they claim.
 *
 * This is the browser's copy of worker/src/sp-rules.ts, line for line: the
 * closed vocabularies with both languages, the social URL rules (platform,
 * post identity, account handle), the seven score weights and the bands.
 * tests/sales-performance.mjs bundles BOTH files and runs them over the same
 * URLs and the same figures - a single disagreement fails the build.
 *
 * The browser uses these as a courtesy: a typist hears "Platform mismatch"
 * or "that TikTok link is not a post" before pressing Save, and the score
 * bands colour the same way everywhere. THE WORKER'S ANSWER IS THE ONE THAT
 * COUNTS. Nothing here writes a figure; nothing in the portal computes a
 * score the worker did not send.
 *
 * This file imports nothing, on purpose.
 */

export const SP_PLATFORMS = [
  ["tiktok", "TikTok", "TikTok"],
  ["instagram", "Instagram", "Instagram"],
  ["facebook", "Facebook", "Facebook"],
  ["whatsapp", "WhatsApp", "WhatsApp"],
  ["other", "Other", "Lain-lain"],
] as const;
export type SpPlatform = (typeof SP_PLATFORMS)[number][0];

export const SP_CHANNELS = [
  ["tiktok", "TikTok", "TikTok"],
  ["instagram", "Instagram", "Instagram"],
  ["facebook", "Facebook", "Facebook"],
  ["whatsapp", "WhatsApp", "WhatsApp"],
  ["call", "Phone call", "Panggilan"],
  ["walk_in", "Walk-in", "Datang sendiri"],
  ["other", "Other", "Lain-lain"],
] as const;

export const SP_INTERACTIONS = [
  ["new_inquiry", "New inquiry", "Pertanyaan baharu"],
  ["product_question", "Product question", "Soalan produk"],
  ["price_inquiry", "Price inquiry", "Pertanyaan harga"],
  ["follow_up", "Follow-up", "Susulan"],
  ["existing_customer", "Existing customer", "Pelanggan sedia ada"],
  ["repeat_customer", "Repeat customer", "Pelanggan berulang"],
  ["complaint", "Complaint", "Aduan"],
  ["other", "Other", "Lain-lain"],
] as const;
/** the interaction types that count as a LEAD / inquiry */
export const SP_INQUIRY_TYPES: readonly string[] = ["new_inquiry", "product_question", "price_inquiry"];

export const SP_POST_STATUSES = [
  ["pending", "Pending verification", "Menunggu pengesahan"],
  ["verified", "Verified", "Disahkan"],
  ["rejected", "Rejected", "Ditolak"],
  ["evidence_invalid", "Evidence invalid", "Bukti tidak sah"],
  ["manual_review", "Manual verification required", "Pengesahan manual diperlukan"],
  ["duplicate", "Duplicate", "Pendua"],
  ["old_post", "Old post - management review", "Pos lama - semakan pengurusan"],
  ["unavailable", "Post unavailable", "Pos tidak tersedia"],
] as const;
export type SpPostStatus = (typeof SP_POST_STATUSES)[number][0];

export const SP_PROMO_TYPES = [
  ["discount", "Discount", "Diskaun"],
  ["bundle", "Bundle", "Pakej"],
  ["giveaway", "Giveaway", "Hadiah percuma"],
  ["live", "Live session", "Sesi live"],
  ["launch", "Launch", "Pelancaran"],
  ["other", "Other", "Lain-lain"],
] as const;

/** the activity feed's vocabulary - the CEO's list, one code each */
export const SP_ACTIVITY_TYPES = [
  ["customer_inquiry", "Customer inquiry", "Pertanyaan pelanggan"],
  ["customer_follow_up", "Customer follow-up", "Susulan pelanggan"],
  ["new_order", "New order", "Pesanan baharu"],
  ["repeat_order", "Repeat order", "Pesanan berulang"],
  ["social_post", "Social media post", "Pos media sosial"],
  ["promotion", "Promotion", "Promosi"],
  ["whatsapp_follow_up", "WhatsApp follow-up", "Susulan WhatsApp"],
  ["tiktok_activity", "TikTok activity", "Aktiviti TikTok"],
  ["facebook_activity", "Facebook activity", "Aktiviti Facebook"],
  ["instagram_activity", "Instagram activity", "Aktiviti Instagram"],
  ["shipment", "Shipment", "Penghantaran"],
  ["tracking_update", "Tracking update", "Kemas kini penjejakan"],
  ["other", "Other sales activity", "Aktiviti jualan lain"],
] as const;

export const SP_TRACKING = [
  ["preparing", "Pending / packed", "Menunggu / dibungkus"],
  ["shipped", "Shipped", "Dihantar"],
  ["in_transit", "In transit", "Dalam perjalanan"],
  ["delivered", "Delivered", "Diterima"],
  ["returned", "Exception / returned", "Pengecualian / dipulangkan"],
] as const;
/** a shipment in one of these states MUST carry a tracking number */
export const SP_TRACKING_REQUIRED: readonly string[] = ["shipped", "in_transit", "delivered"];

export function spLabel(list: readonly (readonly [string, string, string])[], code: string, lang: "en" | "ms" = "en"): string {
  const row = list.find((r) => r[0] === code);
  return row ? (lang === "ms" ? row[2] : row[1]) : code;
}

/* ────────────────────────────────────────────────────────────────────────
   SOCIAL URLS
   ──────────────────────────────────────────────────────────────────────── */

export interface SocialUrlInfo {
  ok: boolean;
  /** why not, when !ok - a sentence for the form */
  reason?: string;
  platform: SpPlatform | null;
  /** the post's identity - two spellings of one post give one key */
  key: string;
  /** the account the URL names, lowercase, no @ - null when the platform does not put it in the URL */
  handle: string | null;
  /** the URL as it will be stored - https, no tracking parameters, no fragment */
  clean: string;
}

const TRACKING_PARAMS = /^(utm_|fbclid$|igsh$|igshid$|si$|share_id$|_t$|_r$|is_from_webapp$|sender_device$|web_id$|ref$|refsrc$|mibextid$|rdid$|share_url$|s$|sfnsn$|checkpoint_src$|lang$|source$|__tn__$|__cft__)/i;

function hostPlatform(host: string): SpPlatform | null {
  const h = host.toLowerCase().replace(/^www\./, "").replace(/^m\./, "");
  if (h === "tiktok.com" || h.endsWith(".tiktok.com")) return "tiktok";
  if (h === "instagram.com" || h.endsWith(".instagram.com") || h === "instagr.am") return "instagram";
  if (h === "facebook.com" || h.endsWith(".facebook.com") || h === "fb.com" || h === "fb.watch") return "facebook";
  if (h === "whatsapp.com" || h.endsWith(".whatsapp.com") || h === "wa.me") return "whatsapp";
  return null;
}

/** Read a social post URL. Pure; the same answer on the worker and in the browser. */
export function readSocialUrl(raw: string): SocialUrlInfo {
  const none: SocialUrlInfo = { ok: false, platform: null, key: "", handle: null, clean: "" };
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return { ...none, reason: "A post URL is required." };
  let u: URL;
  try { u = new URL(trimmed); } catch { return { ...none, reason: "That is not a valid URL - paste the full link, starting with https://" }; }
  if (u.protocol !== "https:") return { ...none, reason: "The post URL must start with https://" };
  if (u.username || u.password) return { ...none, reason: "That URL carries credentials - paste the plain post link." };
  const platform = hostPlatform(u.hostname);
  /* strip tracking parameters, keep the ones that identify the post */
  const keep = new URLSearchParams();
  for (const [k, v] of u.searchParams) if (!TRACKING_PARAMS.test(k)) keep.append(k, v);
  const host = u.hostname.toLowerCase().replace(/^www\./, "").replace(/^m\./, "");
  let path = decodeURIComponent(u.pathname).replace(/\/+$/, "").replace(/\/{2,}/g, "/");
  let key = "";
  let handle: string | null = null;
  if (platform === "tiktok") {
    const video = path.match(/^\/@([^/]+)\/(?:video|photo)\/(\d+)/i);
    const short = host !== "tiktok.com" ? path.match(/^\/([A-Za-z0-9]+)/) : null; // vm./vt. short links
    const t = path.match(/^\/t\/([A-Za-z0-9]+)/);
    if (video) { handle = video[1]!.toLowerCase(); key = `tiktok:${video[2]}`; }
    else if (t) key = `tiktok:short:${t[1]!.toLowerCase()}`;
    else if (short) key = `tiktok:short:${short[1]!.toLowerCase()}`;
    else return { ...none, platform, reason: "That TikTok link is not a post - use the link under Share > Copy link on the video." };
  } else if (platform === "instagram") {
    const m = path.match(/^\/(?:([^/]+)\/)?(p|reel|reels|tv)\/([A-Za-z0-9_-]+)/i);
    if (m) { key = `instagram:${m[3]}`; handle = m[1] && !/^(p|reel|reels|tv|stories)$/i.test(m[1]) ? m[1].toLowerCase() : null; }
    else {
      const story = path.match(/^\/stories\/([^/]+)\/(\d+)/i);
      if (story) { handle = story[1]!.toLowerCase(); key = `instagram:story:${story[2]}`; }
      else return { ...none, platform, reason: "That Instagram link is not a post - use the link under the three dots > Copy link." };
    }
  } else if (platform === "facebook") {
    if (host === "fb.watch") { const m = path.match(/^\/([A-Za-z0-9_-]+)/); if (!m) return { ...none, platform, reason: "That Facebook link is not a post." }; key = `facebook:watch:${m[1]!.toLowerCase()}`; }
    else {
      const id = keep.get("story_fbid") || keep.get("fbid") || keep.get("v");
      const perm = path.match(/^\/([^/]+)\/(?:posts|videos|reels|photos)\/(?:[^/]+\/)?([A-Za-z0-9_.-]+)/i);
      const reel = path.match(/^\/(?:reel|watch|share)\/(?:[a-z]\/)?([A-Za-z0-9_-]+)/i);
      const photo = path.match(/^\/photo(?:\.php)?/i) ? keep.get("fbid") : null;
      if (perm) { handle = perm[1]!.toLowerCase(); key = `facebook:${perm[2]!.toLowerCase()}`; }
      else if (reel) key = `facebook:${reel[1]!.toLowerCase()}`;
      else if (photo) key = `facebook:${photo}`;
      else if (id) key = `facebook:${id}`;
      else return { ...none, platform, reason: "That Facebook link is not a post - open the post and copy its own link." };
      if (handle && /^(share|reel|watch|photo|photo\.php|story\.php|permalink\.php|groups|profile\.php)$/i.test(handle)) handle = null;
    }
  } else if (platform === "whatsapp") {
    key = `whatsapp:${host}${path.toLowerCase()}`;
  } else {
    /* an unrecognised host: kept, but it can never be auto-matched to a
       company account - the worker marks it manual_review */
    path = path.toLowerCase();
    const q = [...keep.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join("&");
    key = `other:${host}${path}${q ? `?${q}` : ""}`;
  }
  const clean = `https://${u.hostname.toLowerCase()}${u.pathname.replace(/\/+$/, "") || "/"}${platform === "facebook" && keep.toString() ? `?${keep.toString()}` : ""}`;
  return { ok: true, platform: platform ?? "other", key, handle, clean };
}

/** @handle or a profile URL -> the bare lowercase handle the register stores */
export function normalizeHandle(raw: string): string {
  let h = String(raw ?? "").trim();
  try {
    if (/^https?:\/\//i.test(h)) {
      const u = new URL(h);
      const seg = u.pathname.split("/").filter(Boolean)[0] ?? "";
      h = seg;
    }
  } catch { /* not a URL */ }
  return h.replace(/^@+/, "").toLowerCase().replace(/\/+$/, "");
}

/* ────────────────────────────────────────────────────────────────────────
   THE SCORE
   ──────────────────────────────────────────────────────────────────────── */

/** The CEO's weights, in percent. They sum to 100. */
export const SP_WEIGHTS = {
  sales: 40,
  engagement: 15,
  social: 15,
  follow_up: 10,
  orders: 10,
  shipment: 5,
  promotion: 5,
} as const;
export type SpComponent = keyof typeof SP_WEIGHTS;

/** each component is a ratio 0..1 already; the score is the weighted sum */
export function spScore(components: Record<SpComponent, number>): number {
  let total = 0;
  for (const k of Object.keys(SP_WEIGHTS) as SpComponent[]) {
    const v = Number(components[k]);
    const clamped = Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
    total += clamped * SP_WEIGHTS[k];
  }
  return Math.round(total);
}

export function spBand(score: number): { code: "excellent" | "good" | "needs_improvement" | "poor"; en: string; ms: string } {
  if (score >= 90) return { code: "excellent", en: "Excellent", ms: "Cemerlang" };
  if (score >= 75) return { code: "good", en: "Good", ms: "Baik" };
  if (score >= 50) return { code: "needs_improvement", en: "Needs improvement", ms: "Perlu diperbaiki" };
  return { code: "poor", en: "Poor", ms: "Lemah" };
}

/** a ratio, safe: 0 when the denominator is 0 */
export function ratio(n: number, d: number): number {
  return d > 0 ? Math.min(1, Math.max(0, n / d)) : 0;
}

/**
 * BUSY IS NOT PRODUCTIVE. Four separate readings, each 0..100, and the
 * verdict: lots of activity with next to no revenue is LOW SALES PERFORMANCE
 * however many posts went up.
 */
export function spBusyVsProductive(x: { activity: number; engagement: number; conversion: number; revenue: number }): {
  activity: number; engagement: number; conversion: number; revenue: number; verdict: "low_sales" | "balanced" | "strong";
} {
  const pct = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 100);
  const a = pct(x.activity), e = pct(x.engagement), c = pct(x.conversion), r = pct(x.revenue);
  const verdict = r >= 75 && c >= 25 ? "strong" : a >= 50 && r < 25 ? "low_sales" : "balanced";
  return { activity: a, engagement: e, conversion: c, revenue: r, verdict };
}

/** the same customer, whichever way the name was typed */
export function customerKey(customerId: number | null | undefined, name: string, phone: string | null | undefined): string {
  if (customerId) return `c:${customerId}`;
  const digits = String(phone ?? "").replace(/\D/g, "");
  if (digits.length >= 8) return `p:${digits.replace(/^60/, "0")}`;
  return `n:${String(name ?? "").trim().toLowerCase().replace(/\s+/g, " ")}`;
}

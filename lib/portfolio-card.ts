/* v1.389.0 - THE STAFF PORTFOLIO CARD, drawn on a canvas (the CEO, 19-11-2026: "use this photo to
   match the Portfolio card designed given strictly").

   ONE drawing for the preview and the export: the portal shows this very canvas scaled down, and
   Download PNG / PDF save the same pixels, so the file always matches what was previewed.
   Front: the A2Z logo, the portrait (about half the card), the name, the position on a gold pill
   right under it, the department, a short tagline and three to five specialties in the navy band.
   Back: "Explore My Portfolio", the QR (ONLY when there is a published page behind it), position
   and department, the key responsibilities, the expertise, the approved contact and the socials.

   Sizes: 1080 x 1920 (the digital card, WhatsApp / stories) and 1080 x 1720 (the 54 x 86 mm
   printed card's proportion). Everything vertical is laid out against the card's height.
   The canvas never fetches anything: the caller hands in decoded images. */

import { CARD_ICONS, iconFor, iconsFor, type CardIcon } from "@/lib/card-icons";
import { qrMatrix } from "@/lib/qr";

export type CardTemplate = "navy" | "gold" | "light";
export type CardSize = "story" | "compact";
export const CARD_SIZES: Record<CardSize, { w: number; h: number; mm?: [number, number] }> = {
  story: { w: 1080, h: 1920 },
  compact: { w: 1080, h: 1720, mm: [54, 86] },
};

export interface CardData {
  name: string;
  /** 0218 - 'upper' draws the name in CAPITAL LETTERS; otherwise normal letters (an all-caps record name is title-cased) */
  nameCase?: "upper" | "normal";
  position: string;
  department: string | null;
  tagline: string | null;
  specialties: string[];
  responsibilities: string[];
  expertise: string[];
  experience: string | null;
  email: string;
  phone: string;
  location: string;
  website: string;
  socials: { kind: CardIcon; label: string }[];
  socialHandle: string | null;
  /** the published page; null means no QR is drawn (there is no page yet) */
  qrUrl: string | null;
  template: CardTemplate;
}
export interface CardCrop { zoom: number; x: number; y: number }
export interface CardAssets {
  logo: CanvasImageSource | null;
  portrait: { img: CanvasImageSource; w: number; h: number; cutout: boolean; box?: { x: number; y: number; w: number; h: number } } | null;
  crop: CardCrop;
}

type Palette = { navy: string; navy2: string; blue: string; gold: string; gold2: string; ink: string; muted: string; bg: string; bg2: string; chip: string; line: string };
const PALETTES: Record<CardTemplate, Palette> = {
  navy: { navy: "#0b1f4b", navy2: "#16337a", blue: "#2a5bd7", gold: "#f6b800", gold2: "#ffd23f", ink: "#0b1f4b", muted: "#55617d", bg: "#ffffff", bg2: "#eef3fb", chip: "#eef3fb", line: "#dde4f0" },
  gold: { navy: "#10224f", navy2: "#1b3a80", blue: "#d99a00", gold: "#f6b800", gold2: "#ffd23f", ink: "#10224f", muted: "#5a6176", bg: "#fffdf7", bg2: "#fff4d6", chip: "#fff4d6", line: "#efe3c2" },
  light: { navy: "#1d3f8f", navy2: "#2f63c7", blue: "#5b8def", gold: "#f6b800", gold2: "#ffd23f", ink: "#13295e", muted: "#56637f", bg: "#ffffff", bg2: "#f1f6ff", chip: "#eaf1ff", line: "#dbe5f6" },
};

/** the portal's own Poppins (next/font gives it a generated family name) */
export function cardFont(): string {
  if (typeof document === "undefined") return "Poppins, Arial, sans-serif";
  const v = getComputedStyle(document.body).getPropertyValue("--font-poppins").trim();
  return `${v ? `${v}, ` : ""}Poppins, Arial, sans-serif`;
}

const titleCase = (s: string) => (s === s.toUpperCase() ? s.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (_m, a: string, b: string) => a + b.toUpperCase()) : s);

/** the specialty icon rules live in lib/card-icons.ts (iconFor / iconsFor) - one place, tested */
export { iconFor };

function icon(ctx: CanvasRenderingContext2D, name: CardIcon, x: number, y: number, size: number, color: string, width = 2) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 24, size / 24);
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = "round"; ctx.lineJoin = "round";
  ctx.stroke(new Path2D(CARD_ICONS[name]));
  ctx.restore();
}

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number | [number, number, number, number]) {
  const [a, b, c, d] = typeof r === "number" ? [r, r, r, r] : r;
  ctx.beginPath();
  ctx.moveTo(x + a, y); ctx.lineTo(x + w - b, y); ctx.quadraticCurveTo(x + w, y, x + w, y + b);
  ctx.lineTo(x + w, y + h - c); ctx.quadraticCurveTo(x + w, y + h, x + w - c, y + h);
  ctx.lineTo(x + d, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - d);
  ctx.lineTo(x, y + a); ctx.quadraticCurveTo(x, y, x + a, y); ctx.closePath();
}

/** wrap words into lines no wider than max; a word longer than the line is kept whole */
function wrap(ctx: CanvasRenderingContext2D, text: string, max: number): string[] {
  const out: string[] = [];
  for (const para of text.split(/\n/)) {
    let line = "";
    for (const w of para.split(/\s+/).filter(Boolean)) {
      const t = line ? `${line} ${w}` : w;
      if (ctx.measureText(t).width <= max || !line) line = t; else { out.push(line); line = w; }
    }
    if (line) out.push(line);
  }
  return out;
}
/** at most n lines; the last one ends in an ellipsis when text was cut */
function clampLines(ctx: CanvasRenderingContext2D, lines: string[], n: number, max: number): string[] {
  if (lines.length <= n) return lines;
  const keep = lines.slice(0, n);
  let last = keep[n - 1]!;
  while (last && ctx.measureText(`${last}...`).width > max) last = last.replace(/\s*\S+$/, "");
  keep[n - 1] = `${last}...`;
  return keep;
}
/** the largest size (from start, down to min) at which every line fits */
function fitFont(ctx: CanvasRenderingContext2D, font: (s: number) => string, text: string, max: number, start: number, min: number, lines = 1): number {
  for (let s = start; s >= min; s -= 2) {
    ctx.font = font(s);
    const l = wrap(ctx, text, max);
    if (l.length <= lines && l.every((x) => ctx.measureText(x).width <= max)) return s;
  }
  return min;
}

function initials(name: string) {
  return name.split(/\s+/).filter((w) => !/^(bin|binti|bt|bte)$/i.test(w)).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("");
}

/* ======================================================================= FRONT */
export function drawFront(ctx: CanvasRenderingContext2D, d: CardData, a: CardAssets, size: CardSize, family = cardFont()) {
  const { w: W, h: H } = CARD_SIZES[size];
  const k = H / 1920;
  const P = PALETTES[d.template];
  const F = (wt: number, s: number, it = false) => `${it ? "italic " : ""}${wt} ${Math.round(s)}px ${family}`;
  ctx.save();
  ctx.clearRect(0, 0, W, H);

  /* ground: white with a soft light wash */
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, P.bg); g.addColorStop(1, P.bg2);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

  const bandTop = H - 430 * k;

  /* the navy sweep behind the portrait, the lighter blue echo and the gold corner */
  ctx.beginPath();
  ctx.moveTo(W, 150 * k);
  ctx.bezierCurveTo(W * 0.6, 260 * k, W * 0.44, 760 * k, W * 0.6, bandTop + 60 * k);
  ctx.lineTo(W, bandTop + 60 * k); ctx.closePath();
  const ng = ctx.createLinearGradient(W * 0.5, 0, W, H);
  ng.addColorStop(0, P.navy2); ng.addColorStop(1, P.navy);
  ctx.fillStyle = ng; ctx.fill();
  ctx.beginPath();
  ctx.moveTo(W, 360 * k);
  ctx.bezierCurveTo(W * 0.74, 470 * k, W * 0.66, 900 * k, W * 0.8, bandTop);
  ctx.lineTo(W, bandTop); ctx.closePath();
  ctx.globalAlpha = 0.55; ctx.fillStyle = P.blue; ctx.fill(); ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.moveTo(W * 0.56, 0);
  ctx.bezierCurveTo(W * 0.74, 40 * k, W * 0.9, 90 * k, W, 230 * k);
  ctx.lineTo(W, 0); ctx.closePath();
  const gg = ctx.createLinearGradient(W * 0.56, 0, W, 230 * k);
  gg.addColorStop(0, P.gold2); gg.addColorStop(1, P.gold);
  ctx.fillStyle = gg; ctx.fill();
  ctx.beginPath();
  ctx.moveTo(W * 0.66, 0);
  ctx.bezierCurveTo(W * 0.8, 50 * k, W * 0.93, 120 * k, W, 290 * k);
  ctx.lineTo(W, 250 * k);
  ctx.bezierCurveTo(W * 0.93, 100 * k, W * 0.82, 34 * k, W * 0.7, 0);
  ctx.closePath(); ctx.fillStyle = "rgba(255,255,255,0.85)"; ctx.fill();

  /* the portrait: about half the card, on the right */
  const area = { x: W * 0.34, y: 230 * k, w: W * 0.66, h: bandTop + 70 * k - 230 * k };
  const crop = a.crop;
  if (a.portrait && a.portrait.cutout) {
    const box = a.portrait.box ?? { x: 0, y: 0, w: a.portrait.w, h: a.portrait.h };
    /* a wide pose (arms out, holding a product) is made smaller rather than covering the words */
    let fh = area.h * 1.02 * crop.zoom;
    let fw = fh * (box.w / box.h);
    const maxW = W * 0.7 * crop.zoom;
    if (fw > maxW) { fh *= maxW / fw; fw = maxW; }
    /* keep the left edge clear of the name column; the right edge may run off the card */
    /* the starting spot keeps clear of the name column; the Left / right slider then moves the person
       BOTH ways from it (it used to pull every left move back to the start - the CEO, 19-11-2026) */
    let cx = area.x + area.w * 0.56;
    const leftLimit = W * 0.43;
    if (cx - fw / 2 < leftLimit) cx = Math.min(leftLimit + fw / 2, W - fw * 0.38);
    cx += crop.x * area.w * 0.5;
    const by = area.y + area.h + crop.y * area.h * 0.4 + 10 * k;
    ctx.save();
    ctx.beginPath(); ctx.rect(area.x - W * 0.08, 0, W, bandTop + 90 * k); ctx.clip();
    ctx.shadowColor = "rgba(8,20,50,0.28)"; ctx.shadowBlur = 40; ctx.shadowOffsetY = 18;
    ctx.drawImage(a.portrait.img, box.x, box.y, box.w, box.h, cx - fw / 2, by - fh, fw, fh);
    ctx.restore();
  } else {
    /* an arch frame: the photo's own wall stays inside a shape, never a hard box */
    const ax = W * 0.4, ay = 250 * k, aw = W * 0.6 - 56, ah = bandTop + 40 * k - ay;
    ctx.save();
    rr(ctx, ax, ay, aw, ah, [aw / 2, aw / 2, 36, 36]);
    ctx.shadowColor = "rgba(8,20,50,0.25)"; ctx.shadowBlur = 36; ctx.shadowOffsetY = 16;
    ctx.fillStyle = P.bg2; ctx.fill();
    ctx.restore();
    ctx.save();
    rr(ctx, ax, ay, aw, ah, [aw / 2, aw / 2, 36, 36]); ctx.clip();
    if (a.portrait) {
      const s = Math.max(aw / a.portrait.w, ah / a.portrait.h) * crop.zoom;
      const dw = a.portrait.w * s, dh = a.portrait.h * s;
      const dx = ax + (aw - dw) / 2 + crop.x * (dw - aw) / 2 * -1;
      const dy = ay + (ah - dh) / 2 + crop.y * (dh - ah) / 2 * -1;
      ctx.drawImage(a.portrait.img, dx, dy, dw, dh);
    } else {
      /* the professional placeholder: the initials on navy, never an invented face */
      const pg = ctx.createLinearGradient(ax, ay, ax + aw, ay + ah);
      pg.addColorStop(0, P.navy2); pg.addColorStop(1, P.navy);
      ctx.fillStyle = pg; ctx.fillRect(ax, ay, aw, ah);
      ctx.fillStyle = "rgba(255,255,255,0.12)";
      ctx.beginPath(); ctx.arc(ax + aw / 2, ay + ah * 0.4, aw * 0.26, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(ax + aw / 2, ay + ah * 0.92, aw * 0.46, ah * 0.3, 0, Math.PI, 0); ctx.fill();
      ctx.fillStyle = "#ffffff"; ctx.font = F(600, 120 * k); ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(initials(d.name), ax + aw / 2, ay + ah * 0.4);
      ctx.font = F(400, 28 * k); ctx.fillStyle = "rgba(255,255,255,0.75)";
      ctx.fillText("Photo coming soon", ax + aw / 2, ay + ah * 0.62);
      ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    }
    ctx.restore();
    ctx.save();
    rr(ctx, ax, ay, aw, ah, [aw / 2, aw / 2, 36, 36]);
    ctx.lineWidth = 8; ctx.strokeStyle = P.gold; ctx.stroke();
    ctx.restore();
  }

  /* the logo */
  const lx = 80, ly = 92 * k;
  if (a.logo) {
    const lh = 118 * k;
    const lw = lh * (991 / 547);
    ctx.drawImage(a.logo, lx, ly, lw, lh);
  } else {
    ctx.fillStyle = P.navy; ctx.font = F(700, 76 * k); ctx.fillText("A2Z", lx, ly + 80 * k);
  }

  /* name, position, department, tagline: the left column, centred in the space it has */
  const colW = W * 0.47;
  const name = d.nameCase === "upper" ? d.name.trim().toLocaleUpperCase("ms-MY") : titleCase(d.name.trim());
  const nameMax = W * 0.52;
  const ns = fitFont(ctx, (s) => F(700, s), name, nameMax, Math.round(124 * k), Math.round(64 * k), 3);
  ctx.font = F(700, ns);
  const nameLines = clampLines(ctx, wrap(ctx, name, nameMax), 3, nameMax);
  const tw0 = W * 0.4;
  ctx.font = F(400, 36 * k);
  const deptLines = d.department ? clampLines(ctx, wrap(ctx, d.department, colW), 2, colW) : [];
  ctx.font = F(400, 40 * k, true);
  const tagLines = d.tagline ? clampLines(ctx, wrap(ctx, d.tagline, tw0), 5, tw0) : [];
  ctx.font = F(700, ns);
  const blockH = nameLines.length * ns * 1.02 + 18 * k + 48 * k * 1.62 + 56 * k + deptLines.length * 46 * k + 40 * k + 92 * k + tagLines.length * 56 * k;
  const topY = 270 * k, availH = bandTop - 60 * k - topY;
  let y = topY + Math.max(0, (availH - blockH) * 0.42) + ns;
  ctx.fillStyle = P.ink;
  for (const l of nameLines) { ctx.fillText(l, lx, y); y += ns * 1.02; }
  y += 18 * k;

  const pos = d.position || "A2Z Team";
  const ps = fitFont(ctx, (s) => F(600, s), pos, W * 0.5, Math.round(48 * k), Math.round(30 * k), 1);
  ctx.font = F(600, ps);
  const pw = Math.min(ctx.measureText(pos).width, W * 0.5) + 64;
  const ph = ps * 1.62;
  ctx.save();
  ctx.shadowColor = "rgba(160,110,0,0.28)"; ctx.shadowBlur = 18; ctx.shadowOffsetY = 6;
  rr(ctx, lx - 8, y, pw, ph, ph / 2);
  const pgold = ctx.createLinearGradient(lx, y, lx + pw, y + ph);
  pgold.addColorStop(0, P.gold2); pgold.addColorStop(1, P.gold);
  ctx.fillStyle = pgold; ctx.fill();
  ctx.restore();
  ctx.fillStyle = P.navy; ctx.textBaseline = "middle";
  ctx.fillText(pos, lx - 8 + 32, y + ph / 2 + 2);
  ctx.textBaseline = "alphabetic";
  y += ph + 56 * k;

  if (deptLines.length) {
    ctx.font = F(400, 36 * k); ctx.fillStyle = P.ink;
    for (const l of deptLines) { ctx.fillText(l, lx, y); y += 46 * k; }
  }
  y += 40 * k;
  ctx.fillStyle = P.gold; rr(ctx, lx, y, 76, 10 * k, 5 * k); ctx.fill();
  y += 92 * k;
  if (tagLines.length) {
    ctx.font = F(400, 40 * k, true); ctx.fillStyle = P.ink;
    for (const l of tagLines) { ctx.fillText(l, lx, y); y += 56 * k; }
  }

  /* the navy band with the specialties */
  ctx.beginPath();
  ctx.moveTo(0, bandTop + 120 * k);
  ctx.bezierCurveTo(W * 0.3, bandTop + 10 * k, W * 0.7, bandTop + 90 * k, W, bandTop - 30 * k);
  ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath();
  const bg = ctx.createLinearGradient(0, bandTop, 0, H);
  bg.addColorStop(0, P.navy2); bg.addColorStop(1, P.navy);
  ctx.fillStyle = bg; ctx.fill();
  ctx.beginPath();
  ctx.moveTo(0, bandTop + 96 * k);
  ctx.bezierCurveTo(W * 0.3, bandTop - 14 * k, W * 0.7, bandTop + 66 * k, W, bandTop - 54 * k);
  ctx.lineTo(W, bandTop - 30 * k);
  ctx.bezierCurveTo(W * 0.7, bandTop + 90 * k, W * 0.3, bandTop + 10 * k, 0, bandTop + 120 * k);
  ctx.closePath(); ctx.fillStyle = P.blue; ctx.globalAlpha = 0.7; ctx.fill(); ctx.globalAlpha = 1;
  /* gold at the foot, left and right */
  ctx.beginPath(); ctx.moveTo(0, H - 96 * k); ctx.bezierCurveTo(W * 0.18, H - 40 * k, W * 0.34, H - 14 * k, W * 0.5, H); ctx.lineTo(0, H); ctx.closePath();
  ctx.fillStyle = P.gold; ctx.fill();
  ctx.beginPath(); ctx.moveTo(W * 0.62, H); ctx.bezierCurveTo(W * 0.78, H - 22 * k, W * 0.9, H - 40 * k, W, H - 74 * k); ctx.lineTo(W, H); ctx.closePath();
  ctx.fillStyle = P.gold2; ctx.globalAlpha = 0.85; ctx.fill(); ctx.globalAlpha = 1;

  const sp = d.specialties.slice(0, 5);
  if (sp.length) {
    const n = sp.length;
    const slot = (W - 100) / n;
    const cy = bandTop + 200 * k;
    const r = Math.min(66 * k, slot * 0.34);
    const spIcons = iconsFor(sp.slice(0, n)); // each specialty its best-fitting icon, none repeated when another fits
    for (let i = 0; i < n; i++) {
      const cx = 50 + slot * i + slot / 2;
      ctx.fillStyle = "rgba(255,255,255,0.1)";
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.18)"; ctx.lineWidth = 2; ctx.stroke();
      const is = r * 0.95;
      icon(ctx, spIcons[i] ?? "star", cx - is / 2, cy - is / 2, is, "#ffffff", 1.8);
      ctx.font = F(500, 29 * k); ctx.fillStyle = "#ffffff"; ctx.textAlign = "center";
      const lines = clampLines(ctx, wrap(ctx, sp[i]!, slot - 24), 2, slot - 24);
      let ty = cy + r + 50 * k;
      for (const l of lines) { ctx.fillText(l, cx, ty); ty += 36 * k; }
      ctx.textAlign = "left";
      if (i > 0) { ctx.strokeStyle = "rgba(255,255,255,0.16)"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(50 + slot * i, cy - r); ctx.lineTo(50 + slot * i, cy + r + 70 * k); ctx.stroke(); }
    }
  }
  ctx.restore();
}

/* ======================================================================== BACK */
export function drawBack(ctx: CanvasRenderingContext2D, d: CardData, size: CardSize, family = cardFont()) {
  const { w: W, h: H } = CARD_SIZES[size];
  const k = H / 1920;
  const P = PALETTES[d.template];
  const F = (wt: number, s: number) => `${wt} ${Math.round(s)}px ${family}`;
  ctx.save();
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = P.bg; ctx.fillRect(0, 0, W, H);

  /* the navy head with its quiet geometry */
  const topH = 640 * k;
  const hg = ctx.createLinearGradient(0, 0, W, topH);
  hg.addColorStop(0, P.navy); hg.addColorStop(1, P.navy2);
  ctx.fillStyle = hg; ctx.fillRect(0, 0, W, topH + 80 * k);
  ctx.fillStyle = "rgba(255,255,255,0.05)";
  ctx.beginPath(); ctx.arc(W * 0.12, topH * 0.98, 260 * k, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(W * 0.92, 40 * k, 200 * k, 0, Math.PI * 2); ctx.fill();

  /* heading */
  const lx = 80;
  ctx.fillStyle = P.gold; rr(ctx, lx, 120 * k, 120, 12 * k, 6 * k); ctx.fill();
  const headW = W * 0.45;
  ctx.font = F(700, 80 * k); ctx.fillStyle = "#ffffff";
  let y = 250 * k;
  for (const l of wrap(ctx, "Explore My Portfolio", headW)) { ctx.fillText(l, lx, y); y += 92 * k; }
  y += 6 * k;
  ctx.font = F(400, 36 * k); ctx.fillStyle = "rgba(255,255,255,0.88)";
  for (const l of wrap(ctx, "Explore my work, projects and creative portfolio.", headW)) { ctx.fillText(l, lx, y); y += 50 * k; }

  /* the QR: only a real, published address; otherwise an honest empty frame */
  const qs = 372 * k;
  const qx = W - 80 - qs, qy = 104 * k;
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.25)"; ctx.shadowBlur = 24; ctx.shadowOffsetY = 8;
  rr(ctx, qx, qy, qs, qs, 30 * k); ctx.fillStyle = "#ffffff"; ctx.fill();
  ctx.restore();
  if (d.qrUrl) {
    const m = qrMatrix(d.qrUrl);
    const n = m.length + 8; // four modules of quiet zone each side
    const pad = 22 * k;
    const cell = (qs - pad * 2) / n;
    ctx.fillStyle = "#000000";
    for (let r = 0; r < m.length; r++) for (let c = 0; c < m.length; c++) {
      if (m[r]![c]) ctx.fillRect(Math.floor(qx + pad + (c + 4) * cell), Math.floor(qy + pad + (r + 4) * cell), Math.ceil(cell), Math.ceil(cell));
    }
  } else {
    ctx.save();
    ctx.setLineDash([14, 10]); ctx.strokeStyle = "#9aa6c0"; ctx.lineWidth = 3;
    rr(ctx, qx + 28 * k, qy + 28 * k, qs - 56 * k, qs - 56 * k, 18 * k); ctx.stroke();
    ctx.restore();
    ctx.fillStyle = P.muted; ctx.font = F(500, 28 * k); ctx.textAlign = "center";
    ctx.fillText("QR appears", qx + qs / 2, qy + qs / 2 - 6 * k);
    ctx.fillText("when published", qx + qs / 2, qy + qs / 2 + 34 * k);
    ctx.textAlign = "left";
  }
  /* gold corner brackets, outside the QR's quiet zone */
  ctx.strokeStyle = P.gold; ctx.lineWidth = 7 * k; ctx.lineCap = "round";
  const o = 18 * k, L = 54 * k;
  for (const [cx, cy, sx, sy] of [[qx - o, qy - o, 1, 1], [qx + qs + o, qy - o, -1, 1], [qx - o, qy + qs + o, 1, -1], [qx + qs + o, qy + qs + o, -1, -1]] as const) {
    ctx.beginPath(); ctx.moveTo(cx, cy + sy * L); ctx.lineTo(cx, cy); ctx.lineTo(cx + sx * L, cy); ctx.stroke();
  }
  ctx.lineCap = "butt";
  /* the call to action */
  const cta = "Scan to View My Portfolio";
  ctx.font = F(600, 29 * k);
  const cw = ctx.measureText(cta).width + 110 * k, ch = 64 * k;
  const ccx = qx + qs / 2 - cw / 2, ccy = qy + qs + 46 * k;
  rr(ctx, ccx, ccy, cw, ch, ch / 2); ctx.fillStyle = P.gold; ctx.fill();
  icon(ctx, "scan", ccx + 26 * k, ccy + ch / 2 - 16 * k, 32 * k, P.navy, 2.2);
  ctx.fillStyle = P.navy; ctx.textBaseline = "middle"; ctx.fillText(cta, ccx + 70 * k, ccy + ch / 2 + 1);
  ctx.textBaseline = "alphabetic";

  /* the white sheet */
  const sy = topH - 30 * k;
  ctx.save();
  ctx.shadowColor = "rgba(8,20,50,0.18)"; ctx.shadowBlur = 30; ctx.shadowOffsetY = -6;
  rr(ctx, 0, sy, W, H - sy, [70 * k, 70 * k, 0, 0]); ctx.fillStyle = P.bg; ctx.fill();
  ctx.restore();

  /* position | department | experience */
  y = sy + 60 * k;
  const cols: [CardIcon, string, string][] = [["briefcase", "Position", d.position || "-"], ["building", "Department", d.department || "-"]];
  if (d.experience) cols.push(["calendar", "Experience", d.experience]);
  const cw2 = (W - 160) / cols.length;
  let colBottom = y;
  cols.forEach(([ic, label, value], i) => {
    const cx = 80 + cw2 * i + cw2 / 2;
    icon(ctx, ic, cx - 26 * k, y, 52 * k, P.navy, 1.8);
    ctx.textAlign = "center";
    ctx.font = F(400, 29 * k); ctx.fillStyle = P.muted; ctx.fillText(label, cx, y + 92 * k);
    ctx.font = F(600, 33 * k); ctx.fillStyle = P.ink;
    let vy = y + 134 * k;
    for (const l of clampLines(ctx, wrap(ctx, value, cw2 - 30), 2, cw2 - 30)) { ctx.fillText(l, cx, vy); vy += 42 * k; }
    colBottom = Math.max(colBottom, vy);
    ctx.textAlign = "left";
    if (i > 0) { ctx.strokeStyle = P.line; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(80 + cw2 * i, y + 10 * k); ctx.lineTo(80 + cw2 * i, y + 170 * k); ctx.stroke(); }
  });
  y = colBottom + 14 * k;
  ctx.strokeStyle = P.line; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(80, y); ctx.lineTo(W - 80, y); ctx.stroke();

  const heading = (t: string) => {
    y += 72 * k;
    ctx.fillStyle = P.gold; rr(ctx, 80, y - 20 * k, 40, 9 * k, 4 * k); ctx.fill();
    ctx.font = F(700, 46 * k); ctx.fillStyle = P.ink; ctx.fillText(t, 140, y);
    y += 30 * k;
  };

  /* key responsibilities */
  const duties = d.responsibilities.slice(0, 5);
  if (duties.length) {
    heading("Key Responsibilities");
    ctx.font = F(400, 32 * k);
    const tw = W - 80 - 160;
    for (const t of duties) {
      const lines = clampLines(ctx, wrap(ctx, t, tw), 2, tw);
      y += 24 * k;
      ctx.fillStyle = P.gold; ctx.beginPath(); ctx.arc(102, y + 4 * k, 20 * k, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 4 * k; ctx.lineCap = "round"; ctx.lineJoin = "round";
      ctx.beginPath(); ctx.moveTo(92, y + 4 * k); ctx.lineTo(99, y + 11 * k); ctx.lineTo(113, y - 4 * k); ctx.stroke(); ctx.lineCap = "butt";
      ctx.fillStyle = P.ink; ctx.font = F(400, 32 * k);
      let ly = y + 15 * k;
      for (const l of lines) { ctx.fillText(l, 140, ly); ly += 42 * k; }
      y = ly - 24 * k;
    }
    y += 8 * k;
  }

  /* expertise and services */
  const ex = d.expertise.slice(0, 6);
  if (ex.length) {
    heading("Expertise & Services");
    y += 16 * k;
    ctx.font = F(500, 29 * k);
    let x = 80; const chH = 58 * k;
    let rows = 1;
    for (const t of ex) {
      const tw = Math.min(ctx.measureText(t).width + 48, W - 160);
      if (x + tw > W - 80) { if (rows >= 2) break; x = 80; y += chH + 16 * k; rows++; }
      rr(ctx, x, y, tw, chH, chH / 2); ctx.fillStyle = P.chip; ctx.fill();
      ctx.fillStyle = P.ink; ctx.textBaseline = "middle"; ctx.fillText(t, x + 24, y + chH / 2 + 1); ctx.textBaseline = "alphabetic";
      x += tw + 14;
    }
    y += chH + 10 * k;
  }

  /* let's work together: the contact the CEO approved, else the company's */
  y = Math.max(y + 6 * k, H - 470 * k);
  ctx.strokeStyle = P.line; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(80, y); ctx.lineTo(W * 0.72, y); ctx.stroke();
  y += 70 * k;
  ctx.font = F(700, 46 * k); ctx.fillStyle = P.ink; ctx.fillText("Let's Work Together", 80, y);
  y += 16 * k;
  const contact: [CardIcon, string][] = [["mail", d.email], ["phone", d.phone], ["pin", d.location], ["globe", d.website]];
  for (const [ic, t] of contact) {
    y += 60 * k;
    icon(ctx, ic, 80, y - 34 * k, 40 * k, P.gold, 2.2);
    ctx.font = F(400, 32 * k); ctx.fillStyle = P.ink; ctx.fillText(t, 146, y);
  }

  /* the navy foot with the socials */
  const fy = H - 250 * k;
  ctx.beginPath();
  ctx.moveTo(W * 0.56, H);
  ctx.bezierCurveTo(W * 0.72, H - 40 * k, W * 0.84, fy + 60 * k, W, fy - 10 * k);
  ctx.lineTo(W, H); ctx.closePath();
  ctx.fillStyle = P.navy; ctx.fill();
  ctx.beginPath();
  ctx.moveTo(W * 0.5, H);
  ctx.bezierCurveTo(W * 0.68, H - 50 * k, W * 0.82, fy + 30 * k, W, fy - 50 * k);
  ctx.lineTo(W, fy - 10 * k);
  ctx.bezierCurveTo(W * 0.84, fy + 60 * k, W * 0.72, H - 40 * k, W * 0.56, H);
  ctx.closePath(); ctx.fillStyle = P.gold; ctx.fill();
  const soc = d.socials.slice(0, 4);
  const iz = 44 * k, gap = 26 * k;
  let sx = W - 80 - soc.length * iz - (soc.length - 1) * gap;
  for (const s of soc) { icon(ctx, s.kind, sx, H - 136 * k, iz, "#ffffff", 2); sx += iz + gap; }
  if (d.socialHandle) {
    ctx.font = F(500, 30 * k); ctx.fillStyle = "#ffffff"; ctx.textAlign = "right";
    ctx.fillText(d.socialHandle, W - 80, H - 46 * k);
    ctx.textAlign = "left";
  }
  ctx.restore();
}

/** the bounding box of a cut-out's visible pixels, so the person sits on the band, not the empty canvas */
export function alphaBox(img: CanvasImageSource, w: number, h: number): { x: number; y: number; w: number; h: number } {
  const s = Math.min(1, 400 / Math.max(w, h));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w * s)); c.height = Math.max(1, Math.round(h * s));
  const x = c.getContext("2d")!;
  x.drawImage(img, 0, 0, c.width, c.height);
  const { data } = x.getImageData(0, 0, c.width, c.height);
  let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
  for (let yy = 0; yy < c.height; yy++) for (let xx = 0; xx < c.width; xx++) {
    if (data[(yy * c.width + xx) * 4 + 3]! > 40) { if (xx < x0) x0 = xx; if (yy < y0) y0 = yy; if (xx > x1) x1 = xx; if (yy > y1) y1 = yy; }
  }
  if (x1 < 0) return { x: 0, y: 0, w, h };
  return { x: x0 / s, y: y0 / s, w: (x1 - x0 + 1) / s, h: (y1 - y0 + 1) / s };
}

/** does the image carry real transparency (a cut-out)? */
export function isCutout(img: CanvasImageSource, w: number, h: number): boolean {
  const c = document.createElement("canvas");
  c.width = 64; c.height = Math.max(1, Math.round(64 * h / w));
  const x = c.getContext("2d")!;
  x.drawImage(img, 0, 0, c.width, c.height);
  const { data } = x.getImageData(0, 0, c.width, c.height);
  let clear = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i]! < 20) clear++;
  return clear > (data.length / 4) * 0.08;
}

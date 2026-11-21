/* v1.404.0 - THE SALES PLAYBOOK, the one copy of its rules (Sales Command Center Phase 7; the CEO, 21-11-2026,
   "As recommended" on the nine Phase 7 decisions). worker/src/playbook.ts validates every save with it and
   components/portal/sales-playbook.tsx draws from it. Imports nothing, so the worker and the screen share it.

   - ten sections, in the order of the CEO's reference picture
   - five kinds of entry: a guide, a script, an objection (what the customer says, a suggested answer and
     focus points), a question list and a checklist
   - an entry is written in ONE language, chosen by its author; the screen's labels follow EN / BM
   - decision 3: NO PRICE IS EVER TYPED INTO THE PLAYBOOK. A ringgit amount is refused (priceProblem); an
     entry links packages instead and the screen shows their live price from the Packages library
   - decision 5: an entry may name ONE pipeline stage, so a deal opens "the Playbook for this stage" */

export const PB_SECTIONS = ["quick", "product", "scripts", "objections", "training", "discovery", "proposal", "closing", "practices", "sop"] as const;
export type PbSection = (typeof PB_SECTIONS)[number];
export const PB_SECTION_WORD: Record<PbSection, [string, string]> = {
  quick: ["Quick Guide", "Panduan Ringkas"],
  product: ["Product Knowledge", "Pengetahuan Produk"],
  scripts: ["Sales Scripts", "Skrip Jualan"],
  objections: ["Objection Handling", "Menangani Bantahan"],
  training: ["Training & Role-play", "Latihan & Main Peranan"],
  discovery: ["Discovery Questions", "Soalan Penerokaan"],
  proposal: ["Proposal & Follow-up", "Cadangan & Susulan"],
  closing: ["Closing Techniques", "Teknik Menutup Jualan"],
  practices: ["Best Practices", "Amalan Terbaik"],
  sop: ["SOP & Templates", "SOP & Templat"],
};
/** what each section is for - one line under its heading */
export const PB_SECTION_HINT: Record<PbSection, [string, string]> = {
  quick: ["The short version: how A2Z sells.", "Versi ringkas: cara A2Z menjual."],
  product: ["Our packages, live from the Packages library, and what to say about them.", "Pakej kami, terus dari pustaka Pakej, dan apa yang perlu dikatakan."],
  scripts: ["From the first contact to the close.", "Dari hubungan pertama hingga penutupan."],
  objections: ["What customers say, and how to answer with confidence.", "Apa kata pelanggan, dan cara menjawab dengan yakin."],
  training: ["Role-play scenarios and practice material.", "Senario main peranan dan bahan latihan."],
  discovery: ["Questions that find out what the customer needs.", "Soalan untuk mengetahui keperluan pelanggan."],
  proposal: ["Sending a proposal and following it up.", "Menghantar cadangan dan membuat susulan."],
  closing: ["Asking for the decision and agreeing the next step.", "Meminta keputusan dan menetapkan langkah seterusnya."],
  practices: ["What works, written down.", "Apa yang berkesan, ditulis."],
  sop: ["Procedures and the files that go with them.", "Prosedur dan fail yang berkaitan."],
};
/** the kind a new entry starts as in each section (the author may pick another) */
export const PB_DEFAULT_KIND: Record<PbSection, PbKind> = {
  quick: "checklist", product: "guide", scripts: "script", objections: "objection", training: "script",
  discovery: "questions", proposal: "checklist", closing: "guide", practices: "guide", sop: "guide",
};

export const PB_KINDS = ["guide", "script", "objection", "questions", "checklist"] as const;
export type PbKind = (typeof PB_KINDS)[number];
export const PB_KIND_WORD: Record<PbKind, [string, string]> = {
  guide: ["Guide", "Panduan"],
  script: ["Script", "Skrip"],
  objection: ["Objection", "Bantahan"],
  questions: ["Question list", "Senarai soalan"],
  checklist: ["Checklist", "Senarai semak"],
};

export const PB_STAGES = ["new", "qualified", "proposal", "negotiation"] as const; // the open pipeline stages (lib/pipeline-words OPEN_STAGES)
export type PbStage = (typeof PB_STAGES)[number];

export const PB_LIMITS = { title: 120, body: 4000, answer: 2000, item: 240, items: 15, focus: 5, focusLen: 140, packages: 5, note: 300, reason: 300 } as const;
export const PB_FILE_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"] as const;
export const PB_MAX_FILES = 5;
export const PB_MAX_FILE_BYTES = 10 * 1024 * 1024;

export interface PbPayload {
  title: string;
  lang: "ms" | "en";
  /** guide and script: the text; objection: unused */
  body: string;
  /** objection: the suggested answer */
  answer: string;
  /** questions, checklist: the lines; objection: the focus points */
  items: string[];
  stage: PbStage | null;
  package_ids: number[];
}

/** Decision 3 - a ringgit amount in Playbook text. Prices live in the Packages library only. Catches
    "RM 1,500", "RM1500", "rm 99.90", "MYR 200", "1,500 ringgit", "500 ringgit" and "RM 1.5k"; leaves words
    such as "RM" on its own or "ROI" alone. Returns the offending piece, or "" when the text is clean. */
export function priceProblem(text: string): string {
  const t = String(text ?? "");
  const m = /\b(?:RM|MYR)\s?\d[\d,.]*\s?[kK]?\b|\b\d[\d,.]*\s?(?:ringgit|sen)\b/i.exec(t);
  return m ? m[0].trim() : "";
}

const clean = (v: unknown, max: number): string => String(v ?? "").replace(/\r\n/g, "\n").trim().slice(0, max + 1);

/** The one check of an entry's content. Returns the cleaned payload or the problems found (English and Malay). */
export function checkPayload(kind: string, raw: unknown): { ok: true; payload: PbPayload } | { ok: false; problems: [string, string][] } {
  const p = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const problems: [string, string][] = [];
  if (!(PB_KINDS as readonly string[]).includes(kind)) problems.push(["Choose a kind of entry.", "Pilih jenis catatan."]);
  const title = clean(p.title, PB_LIMITS.title);
  const body = clean(p.body, PB_LIMITS.body);
  const answer = clean(p.answer, PB_LIMITS.answer);
  const lang = p.lang === "en" ? "en" : p.lang === "ms" ? "ms" : null;
  const items = (Array.isArray(p.items) ? p.items : []).map((x) => clean(x, PB_LIMITS.item)).filter(Boolean);
  const stage = p.stage === null || p.stage === undefined || p.stage === "" ? null : String(p.stage);
  const pk = (Array.isArray(p.package_ids) ? p.package_ids : []).map((x) => Number(x));

  if (title.length < 2) problems.push(["Give the entry a title.", "Beri tajuk kepada catatan."]);
  if (title.length > PB_LIMITS.title) problems.push([`The title is longer than ${PB_LIMITS.title} characters.`, `Tajuk melebihi ${PB_LIMITS.title} aksara.`]);
  if (!lang) problems.push(["Choose the language the entry is written in.", "Pilih bahasa catatan ini."]);
  if (body.length > PB_LIMITS.body) problems.push([`The text is longer than ${PB_LIMITS.body} characters.`, `Teks melebihi ${PB_LIMITS.body} aksara.`]);
  if (answer.length > PB_LIMITS.answer) problems.push([`The answer is longer than ${PB_LIMITS.answer} characters.`, `Jawapan melebihi ${PB_LIMITS.answer} aksara.`]);
  if (items.some((x) => x.length > PB_LIMITS.item)) problems.push([`A line is longer than ${PB_LIMITS.item} characters.`, `Satu baris melebihi ${PB_LIMITS.item} aksara.`]);
  if (stage !== null && !(PB_STAGES as readonly string[]).includes(stage)) problems.push(["That pipeline stage does not exist.", "Peringkat saluran itu tidak wujud."]);
  if (pk.length > PB_LIMITS.packages || pk.some((x) => !Number.isInteger(x) || x <= 0)) problems.push([`Link up to ${PB_LIMITS.packages} packages.`, `Paut sehingga ${PB_LIMITS.packages} pakej.`]);

  if (kind === "guide" || kind === "script") {
    if (body.length < 10) problems.push(["Write the text (10 characters at least).", "Tulis teksnya (sekurang-kurangnya 10 aksara)."]);
  } else if (kind === "objection") {
    if (answer.length < 10) problems.push(["Write the suggested answer (10 characters at least).", "Tulis cadangan jawapan (sekurang-kurangnya 10 aksara)."]);
    if (items.length > PB_LIMITS.focus) problems.push([`Up to ${PB_LIMITS.focus} focus points.`, `Sehingga ${PB_LIMITS.focus} titik fokus.`]);
    if (items.some((x) => x.length > PB_LIMITS.focusLen)) problems.push([`A focus point is longer than ${PB_LIMITS.focusLen} characters.`, `Satu titik fokus melebihi ${PB_LIMITS.focusLen} aksara.`]);
  } else if (kind === "questions" || kind === "checklist") {
    if (!items.length) problems.push(["Write at least one line.", "Tulis sekurang-kurangnya satu baris."]);
    if (items.length > PB_LIMITS.items) problems.push([`Up to ${PB_LIMITS.items} lines.`, `Sehingga ${PB_LIMITS.items} baris.`]);
  }
  for (const piece of [title, body, answer, ...items]) {
    const hit = priceProblem(piece);
    if (hit) { problems.push([`"${hit}" is a price. Prices come only from the Packages library: link the package instead.`, `"${hit}" ialah harga. Harga hanya dari pustaka Pakej: paut pakej itu.`]); break; }
  }
  if (problems.length) return { ok: false, problems };
  const keep = kind === "objection" || kind === "questions" || kind === "checklist";
  return { ok: true, payload: {
    title, lang: lang!, body: kind === "guide" || kind === "script" ? body : "", answer: kind === "objection" ? answer : "",
    items: keep ? items : [], stage: stage as PbStage | null, package_ids: [...new Set(pk)],
  } };
}

/** every word of an entry, for the Playbook's own search */
export function searchText(p: Pick<PbPayload, "title" | "body" | "answer" | "items">): string {
  return [p.title, p.body, p.answer, ...p.items].join(" ").toLowerCase();
}

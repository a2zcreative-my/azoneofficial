/* v1.404.0 - the Sales Playbook in the browser fixture (serve.mjs). Invented words only - never the sample text of
   the CEO's reference picture. The worker's own rules (readers get the published version only, playbook_manage
   writes, publish needs a note, versions kept, no ringgit amounts, packages active to publish, version locks) are
   proven by tests/playbook.mjs; this mirrors them so the screens can be driven end to end, per ROLE. */
const ROLE = process.env.ROLE ?? "ceo";
const NEVER = ["agent", "customer"].includes(ROLE);
const MANAGE = ["ceo", "coo", "cco"].includes(ROLE);
const ago = (d) => new Date(Date.now() - d * 86400_000).toISOString().slice(0, 19).replace("T", " ");
const P = (title, over = {}) => ({ title, lang: "ms", body: "", answer: "", items: [], stage: null, package_ids: [], ...over });
const price = (s) => /\b(?:RM|MYR)\s?\d[\d,.]*\s?[kK]?\b|\b\d[\d,.]*\s?(?:ringgit|sen)\b/i.exec(String(s ?? ""));

const init = () => {
  const E = (id, section, kind, payload, { versions = 1, status = "published", draft = null, files = [], archive = null } = {}) => ({
    id, section, kind, sort: id * 10, status, lock: id * 3, draft: draft ?? payload, draft_files: files, has_draft: !!draft || status === "draft",
    archived_at: archive ? ago(2) : null, archive_reason: archive, updated_at: ago(1), updated_by_name: "Fixture Person",
    versions: status === "draft" ? [] : Array.from({ length: versions }, (_, i) => ({
      version: i + 1, payload: i + 1 === versions ? payload : { ...payload, title: `${payload.title} (earlier)` }, files, note: i === 0 ? "First version" : "Tightened the wording",
      restored_from: null, published_at: ago(10 - i), published_by_name: i ? "Ops Lead" : "Fixture Person",
    })),
  });
  return {
    next: 20, nextFile: 5,
    rows: [
      E(1, "quick", "checklist", P("Lima langkah jualan A2Z", { items: ["Kenal pasti matlamat pelanggan dahulu", "Tunjukkan hasil kerja yang serupa", "Pilih pakej dari pustaka, bukan harga sendiri", "Tetapkan tarikh susulan sebelum tamat panggilan", "Rekod setiap hubungan dalam CRM"] }), { versions: 2 }),
      E(2, "discovery", "questions", P("Soalan pertama untuk pelanggan baharu", { items: ["Apakah sasaran jualan bulan depan?", "Siapa pelanggan utama anda?", "Saluran mana yang paling berkesan sekarang?", "Bila anda mahu mula?"], stage: "qualified" })),
      E(3, "proposal", "checklist", P("Sebelum dan selepas hantar cadangan", { items: ["Semak skop dengan pelanggan", "Hantar dalam masa 24 jam", "Susulan dalam 2 hari bekerja", "Tetapkan langkah seterusnya"], stage: "proposal" })),
      E(4, "objections", "objection", P("Saya perlu bincang dengan rakan kongsi dulu.", { answer: "Baik, itu keputusan penting. Boleh saya sediakan ringkasan satu muka untuk rakan kongsi tuan/puan, dan kita tetapkan masa untuk menjawab soalan mereka bersama?", items: ["Hormati proses keputusan", "Beri bahan ringkas", "Tetapkan tarikh susulan"], stage: "negotiation", package_ids: [71] })),
      E(5, "objections", "objection", P("Kami pernah cuba live, tak menjadi.", { answer: "Terima kasih kerana berkongsi. Boleh ceritakan apa yang dicuba? Kami mula dengan sesi percubaan yang kecil dan ukur hasilnya bersama.", items: ["Dengar pengalaman lepas", "Cadangkan percubaan kecil"] }),
        { draft: P("Kami pernah cuba live, tak menjadi.", { answer: "Draf baharu: tanya apa yang tidak berjaya, kemudian tunjuk kajian kes yang serupa.", items: ["Dengar dahulu"] }) }),
      E(6, "scripts", "script", P("Panggilan pertama selepas pertanyaan", { body: "Assalamualaikum, saya [nama] dari A2Z Creative. Terima kasih kerana menghubungi kami tentang [perkhidmatan].\nBoleh saya tanya sedikit tentang perniagaan tuan/puan sebelum saya cadangkan apa-apa?", stage: "new" })),
      E(7, "sop", "guide", P("SOP sebut harga", { body: "Semua sebut harga dibuat di Sales > Quotations & Invoices dari pustaka Pakej. Lampiran di bawah ialah senarai semak dalaman." }), { files: [{ id: 1, filename: "senarai-semak-sebut-harga.pdf", content_type: "application/pdf", size: 18200 }] }),
      E(8, "training", "script", P("Main peranan: pelanggan yang sibuk", { body: "Pasangan A menjadi pemilik kedai yang hanya ada dua minit. Pasangan B mesti dapatkan satu masa temu janji." }), { status: "draft" }),
      E(9, "practices", "guide", P("Amalan lama", { body: "Catatan lama yang tidak digunakan lagi oleh pasukan." }), { status: "archived", archive: "Replaced by the Quick Guide" }),
    ],
  };
};
let st = init();
export const resetPlaybook = () => { st = init(); };

const cur = (e) => e.versions[e.versions.length - 1] ?? null;
const shape = (e) => {
  const v = cur(e);
  const published = v ? { version: v.version, payload: v.payload, note: v.note, published_at: v.published_at, published_by_name: v.published_by_name, files: v.files } : null;
  if (!MANAGE) return { id: e.id, section: e.section, kind: e.kind, sort: e.sort, published };
  return { id: e.id, section: e.section, kind: e.kind, sort: e.sort, status: e.status, has_draft: e.has_draft, lock: e.lock, draft: e.draft, draft_files: e.draft_files,
    updated_at: e.updated_at, updated_by_name: e.updated_by_name, archived_at: e.archived_at, archive_reason: e.archive_reason, published };
};
const bad = (status, message, code = "invalid_input") => ({ status, data: { error: { code, message } } });
const check = (kind, p) => {
  if (!p || String(p.title ?? "").trim().length < 2) return "Give the entry a title.";
  for (const piece of [p.title, p.body, p.answer, ...(p.items ?? [])]) { const m = price(piece); if (m) return `"${m[0]}" is a price. Prices come only from the Packages library: link the package instead.`; }
  if ((kind === "guide" || kind === "script") && String(p.body ?? "").trim().length < 10) return "Write the text (10 characters at least).";
  if (kind === "objection" && String(p.answer ?? "").trim().length < 10) return "Write the suggested answer (10 characters at least).";
  if ((kind === "questions" || kind === "checklist") && !(p.items ?? []).length) return "Write at least one line.";
  return "";
};

export function playbookRoute(method, p, body) {
  if (p !== "/staff/playbook" && !p.startsWith("/staff/playbook/")) return null;
  if (NEVER) return bad(403, "Sales access required", "forbidden");
  if (p === "/staff/playbook" && method === "GET") {
    const rows = MANAGE ? st.rows : st.rows.filter((e) => e.status === "published" && cur(e));
    return { status: 200, data: { entries: rows.map(shape), can_manage: MANAGE } };
  }
  if (!MANAGE) return bad(403, "Only the CEO, COO and CCO write the Sales Playbook", "forbidden");
  if (p === "/staff/playbook" && method === "POST") {
    const why = check(body?.kind, body?.payload);
    if (why) return bad(400, why);
    const e = { id: st.next++, section: body.section, kind: body.kind, sort: 999, status: "draft", lock: 1, draft: body.payload, draft_files: [], has_draft: true,
      archived_at: null, archive_reason: null, updated_at: ago(0), updated_by_name: "Fixture Person", versions: [] };
    st.rows.push(e);
    return { status: 201, data: { ok: true, entry: shape(e) } };
  }
  const m = /^\/staff\/playbook\/(\d+)(?:\/(versions|publish|discard|restore|archive|unarchive))?$/.exec(p);
  if (!m) return null;
  const e = st.rows.find((x) => x.id === Number(m[1]));
  if (!e) return bad(404, "That Playbook entry does not exist", "not_found");
  const act = m[2] ?? "";
  if (act === "versions" && method === "GET") return { status: 200, data: { versions: [...e.versions].reverse() } };
  if (Number(body?.version) !== e.lock) return bad(409, "Someone saved this entry while you were working on it. Reload it and try again.", "changed");
  const done = () => { e.lock += 1; e.updated_at = ago(0); return { status: 200, data: { ok: true, entry: shape(e), version: cur(e)?.version } }; };
  if (act === "" && method === "PUT") {
    if (e.status === "archived") return bad(409, "Bring the entry back before editing it.", "archived");
    const why = check(e.kind, body.payload);
    if (why) return bad(400, why);
    e.draft = body.payload; e.has_draft = true;
    if (Array.isArray(body.files)) e.draft_files = e.draft_files.filter((f) => body.files.includes(f.id));
    return done();
  }
  if (act === "publish") {
    if (String(body?.note ?? "").trim().length < 5) return bad(400, "Say in a few words what changed (5 characters at least).");
    if (e.status === "published" && !e.has_draft) return bad(409, "There are no changes to publish.", "nothing_to_publish");
    e.versions.push({ version: e.versions.length + 1, payload: e.draft, files: e.draft_files, note: body.note.trim(), restored_from: body.restored_from ?? null, published_at: ago(0), published_by_name: "Fixture Person" });
    e.status = "published"; e.has_draft = false;
    return done();
  }
  if (act === "discard") { e.draft = cur(e).payload; e.draft_files = cur(e).files; e.has_draft = false; return done(); }
  if (act === "restore") { const v = e.versions.find((x) => x.version === Number(body.from)); if (!v) return bad(404, "That version does not exist", "not_found"); e.draft = v.payload; e.draft_files = v.files; e.has_draft = true; return done(); }
  if (act === "archive") { if (String(body?.reason ?? "").trim().length < 5) return bad(400, "Say why it is archived (5 characters at least)."); e.status = "archived"; e.archive_reason = body.reason; e.archived_at = ago(0); return done(); }
  if (act === "unarchive") { e.status = cur(e) ? "published" : "draft"; e.archive_reason = null; e.archived_at = null; return done(); }
  return null;
}

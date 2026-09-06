"use client";

/* v1.38.0 (IMPLEMENTATION-PLAN.md S-1) — the signature vault's upload card.

   The five officer signatures used to be plain files under /signatures/ —
   downloadable by ANYONE, no login, and referenced from approved leave and
   claim forms. They now live in private R2 and are served only through
   authenticated routes; this card is where an admin puts them there.

   Because the old files were public for an unknown period, the honest move
   is to re-scan FRESH signatures rather than re-upload the leaked images —
   then a leaked copy no longer matches what appears on new documents.

   v1.127.0 (CEO, 06-09-2026: *"2 Entity of company ... both need separated
   e-signature due to the company stamp on it"*) — the card is a GRID now,
   five roles by two entities, because a chop carries a company stamp and the
   two companies are separate legal entities:

     A2Z CREATIVE MARKETING  the operating issuer. Signs everything raised
                             since the 19-08-2026 switch.
     AZ ONE OFFICIAL         the consultancy. Signs every document issued
                             before it, forever — re-printing a 2026-07
                             invoice must still produce AZ ONE's letterhead,
                             AZ ONE's bank account AND AZ ONE's chop.

   Every document has carried issuer_code since migration 0073 and every
   renderer resolved the letterhead from it; only the signature was blind to
   it, so an AZ ONE invoice printed under the A2Z stamp.

   Uploads APPEND a version, they do not replace. v2 signs documents from the
   day it lands; everything already approved keeps v1, because the vault
   resolves a document's chop by the version that was current when it was
   signed (migration 0118). That is also why nothing here deletes. */

import { useCallback, useEffect, useState } from "react";
import { makeApi, csrfFetch } from "@/lib/api";
import { useSaveToast } from "@/components/ui/save-toast";
import { card, insetCard } from "@/lib/ui-styles";
import { getLang } from "@/lib/i18n";
import { Skel } from "@/components/ui/skeleton"; // v1.77.0
import { AppIcon } from "@/components/ui/app-icon"; // v1.126.0

const api = makeApi("/staff"); // the vault index lives under the staff handler
const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);

/* The file name is the ROLE's, unchanged since v1.38.0; the entity is a path
   segment in front of it. `role` is the underscored app role the vault keys
   on, so the two spellings never have to be guessed at a call site. */
const ROLES: { file: string; role: string; label: string }[] = [
  { file: "ceo-sign.png", role: "ceo", label: "CEO" },
  { file: "coo-sign.png", role: "coo", label: "COO" },
  { file: "cco-sign.png", role: "cco", label: "CCO" },
  { file: "hr-admin-sign.png", role: "hr_admin", label: "HR Admin" },
  { file: "sales-marketing-sign.png", role: "sales_marketing", label: "Sales & Marketing" },
];

const ENTITIES: { code: "a2z" | "azoo"; name: string; note: string; noteMs: string }[] = [
  { code: "a2z", name: "A2Z CREATIVE MARKETING", note: "Signs everything raised today", noteMs: "Menandatangani semua yang dibuat hari ini" },
  { code: "azoo", name: "AZ ONE OFFICIAL", note: "Signs documents issued before 19-08-2026", noteMs: "Menandatangani dokumen sebelum 19-08-2026" },
];

interface VaultRow {
  issuer_code: string; role: string; version: number;
  uploaded_at: string; uploaded_by_name: string | null;
  sha256: string | null; retired_at: string | null;
}

const dmy = (iso: string) => (iso ?? "").slice(0, 10).split("-").reverse().join("-");

export function SignaturesPanel() {
  const { show: showToast, node: toastNode } = useSaveToast();
  /* null = the vault has not answered yet (skeleton), so a cell is never
     shown "Missing" merely because the request is in flight. */
  const [rows, setRows] = useState<VaultRow[] | null>(null);
  /* Roles whose PRE-v1.127.0 flat file is still in R2. Those files were
     uploaded while A2Z was the operating issuer, so that is what they are;
     the worker serves them for A2Z only. Saying so here is the difference
     between "AZ ONE has nothing on file" and a blank zone that looks broken. */
  const [legacy, setLegacy] = useState<string[]>([]);
  const [ready, setReady] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [openHistory, setOpenHistory] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await api<{ ready: boolean; rows: VaultRow[]; legacy: string[] }>("/signatures");
    if (r.ok && r.data) { setRows(r.data.rows ?? []); setLegacy(r.data.legacy ?? []); setReady(r.data.ready); }
    else { setRows([]); setReady(true); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const upload = async (entity: string, r: { file: string; role: string; label: string }, blob: File) => {
    if (blob.type !== "image/png") {
      showToast(L("Not uploaded", "Tidak dimuat naik"), L("Signatures must be PNG (transparent background)", "Tandatangan mesti PNG (latar telus)"), "notice");
      return;
    }
    const cell = `${entity}:${r.role}`;
    setBusy(cell);
    const res = await csrfFetch(`/api/v1/staff/signatures/${entity}/${r.file}`, {
      method: "POST",
      headers: { "Content-Type": "image/png" },
      body: blob,
    });
    setBusy(null);
    if (!res.ok) {
      const why = res.status === 503
        ? L("The vault table is missing — run the database migrations, then upload again", "Jadual bilik kebal tiada — jalankan migrasi pangkalan data, kemudian muat naik semula")
        : L("Upload failed — admin or CEO only", "Muat naik gagal — admin atau CEO sahaja");
      showToast(L("Not uploaded", "Tidak dimuat naik"), why, "notice");
      return;
    }
    const j = (await res.json().catch(() => null)) as { version?: number } | null;
    const ent = ENTITIES.find((e) => e.code === entity)?.name ?? entity;
    showToast(
      L("Uploaded", "Dimuat naik"),
      L(`${r.label} v${j?.version ?? "?"} for ${ent} — documents signed from now on carry it; everything already approved keeps the version it was signed with`,
        `${r.label} v${j?.version ?? "?"} untuk ${ent} — dokumen yang ditandatangani mulai sekarang menggunakannya; yang telah diluluskan kekal dengan versi asalnya`),
    );
    void load();
  };

  const history = (entity: string, role: string): VaultRow[] =>
    (rows ?? []).filter((v) => v.issuer_code === entity && v.role === role)
      .sort((a, b) => b.version - a.version);

  return (
    <div className={card}>
      {toastNode}
      <h2 className="text-base font-semibold">{L("Signatures", "Tandatangan")}</h2>
      <p className="text-muted-foreground mt-1 text-sm">
        {L("Served only to signed-in staff and token-holding customers — never public. Upload a FRESH scan: the old public files must be treated as compromised.",
           "Hanya diberikan kepada kakitangan yang log masuk dan pelanggan pemegang token — tidak sekali-kali umum. Muat naik imbasan BARU: fail lama yang pernah umum perlu dianggap terjejas.")}
      </p>
      <p className="text-muted-foreground mt-1.5 text-sm">
        {L("Each company signs with its own chop, because the chop carries the company stamp. A document is signed by the entity that ISSUED it — so AZ ONE documents keep AZ ONE signatures forever, even when re-printed today.",
           "Setiap syarikat menandatangani dengan cop sendiri, kerana cop itu membawa cap syarikat. Dokumen ditandatangani oleh entiti yang MENGELUARKANNYA — jadi dokumen AZ ONE kekal dengan tandatangan AZ ONE selama-lamanya, walaupun dicetak semula hari ini.")}
      </p>

      {!ready && (
        <p className="border-warning/30 bg-warning-soft text-warning mt-3 flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium">
          <AppIcon name="warning" className="h-3.5 w-3.5" />
          {L("The vault table is not there yet — run the database migrations (0118). Until then documents fall back to the pre-v1.127.0 files, which sign for A2Z only.",
             "Jadual bilik kebal belum wujud — jalankan migrasi pangkalan data (0118). Sehingga itu dokumen menggunakan fail sebelum v1.127.0, yang menandatangani untuk A2Z sahaja.")}
        </p>
      )}

      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 md:gap-4">
        {ENTITIES.map((ent) => (
          <section key={ent.code}>
            <p className="text-[11px] font-semibold tracking-wider uppercase">{ent.name}</p>
            <p className="text-muted-foreground mb-2 text-[11px]">{L(ent.note, ent.noteMs)}</p>
            <ul className="space-y-1.5">
              {ROLES.map((r) => {
                const hist = history(ent.code, r.role);
                const cur = hist[0] ?? null;
                const cell = `${ent.code}:${r.role}`;
                const hasLegacy = ent.code === "a2z" && legacy.includes(r.role);
                return (
                  <li key={cell} className={insetCard}>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                      <span className="min-w-[7rem] font-medium">{r.label}</span>
                      {rows === null ? (
                        <><Skel className="h-4 w-24" /><Skel className="h-5 w-20" /></>
                      ) : (
                        <>
                          {cur ? (
                            <span className="text-success text-xs">v{cur.version} · {dmy(cur.uploaded_at)}</span>
                          ) : hasLegacy ? (
                            <span className="text-muted-foreground text-xs">
                              {L("pre-v1.127.0 file — re-upload to version it", "fail sebelum v1.127.0 — muat naik semula untuk versinya")}
                            </span>
                          ) : (
                            <span className="text-warning text-xs font-medium">
                              {L("Missing — documents print a blank zone", "Tiada — dokumen mencetak ruang kosong")}
                            </span>
                          )}
                          <label className="border-border hover:bg-secondary ml-auto cursor-pointer rounded border px-2 py-0.5 text-xs">
                            {busy === cell
                              ? L("Uploading…", "Memuat naik…")
                              : cur
                                ? L(`Upload v${cur.version + 1}`, `Muat naik v${cur.version + 1}`)
                                : L("Upload PNG", "Muat naik PNG")}
                            <input type="file" accept="image/png" className="hidden" disabled={busy !== null}
                              onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(ent.code, r, f); e.target.value = ""; }} />
                          </label>
                          {hist.length > 1 && (
                            <button type="button" className="text-muted-foreground text-xs underline"
                              onClick={() => setOpenHistory(openHistory === cell ? null : cell)}>
                              {openHistory === cell
                                ? L("Hide history", "Sembunyi sejarah")
                                : L(`${hist.length} versions`, `${hist.length} versi`)}
                            </button>
                          )}
                        </>
                      )}
                    </div>
                    {openHistory === cell && (
                      <div className="border-border mt-2 border-t pt-2">
                        {/* Every version stays — a document signed under v1
                            has to be able to resolve v1 for as long as it
                            exists. Nothing here deletes. */}
                        {hist.map((v) => (
                          <p key={v.version} className="text-muted-foreground flex flex-wrap justify-between gap-2 text-[11px]">
                            <span>v{v.version} · {dmy(v.uploaded_at)}{v.uploaded_by_name ? ` · ${v.uploaded_by_name}` : ""}</span>
                            {v.sha256 ? <span className="font-mono tabular-nums">{v.sha256.slice(0, 12)}</span> : null}
                          </p>
                        ))}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

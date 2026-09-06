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
   signed (migration 0118). That is also why nothing here deletes.

   v1.130.0 (CEO, 06-09-2026, handing over the six scans: *"ensure that the
   signature is embedded correctly to the person which is no leaked out of
   false in use!"*) — EACH CELL SHOWS THE CHOP THAT IS ACTUALLY IN IT.

   This is the only check that catches the failure that matters. A cell that
   says "v1 - 06-09-2026" is telling you an upload happened; it cannot tell
   you WHOSE signature happened. Put the COO's scan in the CEO row and every
   invoice, leave form and claim form afterwards carries the COO's hand under
   the CEO's name — and nothing anywhere would have said so. The stamps are no
   help either: all three officers of one entity share one company stamp, so
   the only thing that distinguishes them is the handwriting beside it.

   So the panel draws it, at a size where the hand is legible, and clicking
   opens it full size to compare against the paper. The image comes from the
   vault's own authenticated route — the same one documents use — so what you
   are looking at is exactly what a document would print, not a copy of the
   file you uploaded. */

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

/* The image the vault would actually serve for this cell, from the vault's own
   authenticated route. `v` is a cache-buster keyed to the version, because the
   route answers "the current chop for this entity and role" — without it, a
   freshly uploaded v2 would keep showing v1 out of the browser cache, which is
   the one moment a stale picture would be actively misleading. */
const chopSrc = (entity: string, role: string, version: number | "legacy") =>
  `/api/v1/staff/signature/${entity}/${role.replace(/_/g, "-")}-sign.png?v=${version}`;

/** The chop in a cell, small but legible. Clicking opens it full size. */
function Chop({ entity, role, version, label, onZoom }: {
  entity: string; role: string; version: number | "legacy"; label: string; onZoom: () => void;
}) {
  const [broken, setBroken] = useState(false);
  if (broken) return null;
  return (
    <button
      type="button"
      onClick={onZoom}
      title={L("Open full size to check whose signature this is", "Buka saiz penuh untuk semak tandatangan siapa ini")}
      /* A white plate, always: the scans are navy ink on transparency, and on
         a dark card an unplated signature is a dark smudge on a dark square. */
      className="border-border hover:border-primary block shrink-0 rounded border bg-white p-1 transition-colors"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {/* h-14, not h-9. Measured against the real scans: at 36px the company
          stamp fills the frame and all three officers look identical, which
          makes the thumbnail decorative — the exact opposite of its job. At
          56px the handwriting beside the stamp is distinguishable at a
          glance, and the row is still a row. */}
      <img
        src={chopSrc(entity, role, version)}
        alt={L(`Signature on file for ${label}`, `Tandatangan dalam fail untuk ${label}`)}
        className="h-14 w-auto max-w-[10rem] object-contain"
        onError={() => setBroken(true)}
      />
    </button>
  );
}

/** Full size, to hold against the paper. */
function ChopZoom({ entity, role, label, entName, onClose }: {
  entity: string; role: string; label: string; entName: string; onClose: () => void;
}) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", esc);
    /* BODY, never <html> — styles/globals.css names the two owners of the
       document scroll and a third is a bug. */
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", esc);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={L(`Signature on file for ${label}, ${entName}`, `Tandatangan dalam fail untuk ${label}, ${entName}`)}
      onClick={onClose}
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-black/70 p-6"
    >
      <div className="max-h-[70vh] max-w-full overflow-auto rounded-xl bg-white p-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={chopSrc(entity, role, Date.now())} alt="" className="max-h-[60vh] w-auto object-contain" />
      </div>
      <div className="text-center text-white">
        <p className="text-sm font-semibold">{label}</p>
        <p className="mt-0.5 text-xs text-white/70">{entName}</p>
        <p className="mt-2 text-xs text-white/60">
          {L("Is this the right person? If not, upload the correct scan — the wrong one here signs every document for this role.",
             "Adakah ini orang yang betul? Jika tidak, muat naik imbasan yang betul — yang salah di sini menandatangani setiap dokumen bagi peranan ini.")}
        </p>
      </div>
    </div>
  );
}

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
  /* The cell whose chop is open full size, as "<entity>:<role>". */
  const [zoom, setZoom] = useState<{ entity: string; role: string; label: string; entName: string } | null>(null);

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
      {zoom && (
        <ChopZoom
          entity={zoom.entity}
          role={zoom.role}
          label={zoom.label}
          entName={zoom.entName}
          onClose={() => setZoom(null)}
        />
      )}
      <h2 className="text-base font-semibold">{L("Signatures", "Tandatangan")}</h2>
      <p className="text-muted-foreground mt-1 text-sm">
        {L("Served only to signed-in staff and token-holding customers — never public. Upload a FRESH scan: the old public files must be treated as compromised.",
           "Hanya diberikan kepada kakitangan yang log masuk dan pelanggan pemegang token — tidak sekali-kali umum. Muat naik imbasan BARU: fail lama yang pernah umum perlu dianggap terjejas.")}
      </p>
      <p className="text-muted-foreground mt-1.5 text-sm">
        {L("Check the picture in each row, not just the date: all three officers of one company share the same stamp, so the handwriting beside it is the only thing that says who signed. A scan in the wrong row signs every document for that role.",
           "Semak gambar pada setiap baris, bukan tarikh sahaja: ketiga-tiga pegawai bagi satu syarikat berkongsi cop yang sama, jadi tulisan tangan di sebelahnya sahaja yang menentukan siapa menandatangani. Imbasan pada baris yang salah akan menandatangani setiap dokumen bagi peranan itu.")}
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
                          {/* v1.130.0 - WHOSE signature is in this cell. The
                              version and the date say an upload happened; only
                              the picture says who. */}
                          {(cur || hasLegacy) && (
                            <Chop
                              entity={ent.code}
                              role={r.role}
                              version={cur ? cur.version : "legacy"}
                              label={`${r.label} - ${ent.name}`}
                              onZoom={() => setZoom({ entity: ent.code, role: r.role, label: r.label, entName: ent.name })}
                            />
                          )}
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

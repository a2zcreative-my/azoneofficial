"use client";

/* v1.248.0 - SIGNATURES & STAMPS (the owner's brief of 01-11-2026,
   claude/SIGNATURES-AUDIT.md and his answers). Three screens over one set of
   routes (worker/src/signing.ts):

   - SigningPanel: Users > Signatures & Stamps. The CEO (and the super admin,
     for recovery) registers signatures, uploads each company's stamp, grants
     signing authority per company and document type, approves, retires, and
     sets each company's policy. COO and CCO see it, read only.
   - MySignature: Profile. A person uploads their own signature and confirms
     one the CEO registered for them - the signature is used only after BOTH.
   - DocSigningCard: the quotation page. Who prepared it and with what, whether
     it needs an approval, and the Approve and sign button for a signatory.

   Every change asks for a live authenticator code (withStepUp). The server
   decides everything; these screens only say what it decided. A scanned
   signature is a visual mark, not a cryptographic signature - said on screen. */

import { useCallback, useEffect, useState } from "react";
import { api, csrfFetch } from "@/lib/api";
import { L, withStepUp } from "@/components/portal/page-shared";
import { usePrompt } from "@/components/ui/prompt-dialog";
import { useSaveToast } from "@/components/ui/save-toast";
import { Avatar } from "@/components/ui/avatar";
import { SkelCard } from "@/components/ui/skeleton";
import { fmtRM } from "@/lib/format";
import { btnSm, btnSmPrimary, btnSmQuiet, selectClassSm } from "@/lib/ui-styles";
import css from "./signing-panel.module.css";

type Issuer = "a2z" | "azoo";
const ISSUER_NAME: Record<Issuer, string> = { a2z: "A2Z CREATIVE MARKETING", azoo: "AZ ONE OFFICIAL" };
const TYPE_NAME: Record<string, string> = { QT: "Quotations", INV: "Invoices", DO: "Delivery orders" };
interface Policy { issuer_code: Issuer; personal: boolean; stamp_on: string[]; updated_at: string | null; updated_by_name?: string | null }
interface Stamp { id: number; issuer_code: Issuer; version: number; status: string; uploaded_at: string; uploaded_by_name: string | null; retired_at: string | null }
interface Sig { id: number; user_id: number; version: number; status: string; uploaded_at: string; consented_at: string | null; approved_at: string | null; retired_at: string | null; note: string | null; uploaded_by_name: string | null; approved_by_name: string | null }
interface Auth { id: number; user_id: number; issuer_code: Issuer; capacity: "prepare" | "approve"; doc_types: string; granted_at: string; reason: string | null; granted_by_name: string | null }
interface Person { id: number; name: string; role: string; position: string | null; photo_key?: string | null; is_active?: number }
interface Overview { can_manage: boolean; approval_limit: { limit_cents: number; since: string } | null; policies: Policy[]; stamps: Stamp[]; signatures: Sig[]; authorities: Auth[]; people: Person[] }

const day = (s: string | null | undefined) => (s ? s.slice(0, 10).split("-").reverse().join("-") : "");
const statusWord = (s: Sig) => s.status === "active" ? L("Active", "Aktif")
  : s.status === "retired" ? L("Retired", "Dihentikan")
  : !s.consented_at ? L("Waiting for the person", "Menunggu pemiliknya")
  : L("Waiting for the CEO", "Menunggu CEO");
const chip = (s: string) => s === "active" ? css.ok : s === "retired" ? css.off : css.wait;

type Ask = ReturnType<typeof usePrompt>["prompt"];
/** POST with the authenticator retry; returns the server's message on refusal. */
async function signed(ask: Ask, path: string, body: Record<string, unknown>, title: string): Promise<{ ok: boolean; msg: string }> {
  const r = await withStepUp<{ error?: { message?: string } }>(
    (totp) => api(path, { method: path.includes("/policy/") ? "PUT" : "POST", body: JSON.stringify({ ...body, ...(totp ? { totp } : {}) }) }),
    ask, { title, label: L("Your 6-digit authenticator code", "Kod pengesah 6 digit anda") });
  return { ok: r.ok, msg: r.data?.error?.message ?? "" };
}
/** A raw PNG upload, the code in the X-Totp header. */
async function uploadPng(ask: Ask, query: string, file: File, title: string): Promise<{ ok: boolean; msg: string; status?: string }> {
  const send = async (totp?: string) => {
    const res = await csrfFetch(`/api/v1/staff/signing/assets?${query}`, { method: "POST", body: file, headers: { "Content-Type": "image/png", ...(totp ? { "X-Totp": totp } : {}) } });
    const data = (await res.json().catch(() => null)) as { status?: string; error?: { message?: string } } | null;
    return { ok: res.ok, status: res.status, data };
  };
  const r = await withStepUp(send, ask, { title, label: L("Your 6-digit authenticator code", "Kod pengesah 6 digit anda") });
  return { ok: r.ok, msg: r.data?.error?.message ?? "", status: r.data?.status };
}

function Mark({ id, alt }: { id: number; alt: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img className={css.mark} src={`/api/v1/staff/signing/assets/${id}/image`} alt={alt} loading="lazy" />;
}

function pickPng(onFile: (f: File) => void) {
  const inp = document.createElement("input");
  inp.type = "file"; inp.accept = "image/png";
  inp.onchange = () => { const f = inp.files?.[0]; if (f) onFile(f); };
  inp.click();
}

/* v1.249.2 (the owner, 01-11-2026: "Signatures & Stamps collect the data from
   /admin and the picture I will replace it with the current flow") - the
   officer chops already in the /admin vault (signature + company stamp in one
   scan, per company and officer role) are shown here, read from the SAME
   vault index and image routes /admin uses (CEO, super admin, admin only -
   for anyone else this block stays away). Nothing is copied or changed: the
   chops keep printing while personal signing is Off and stay on documents
   already issued; each row offers the new flow for the person who holds that
   role today. */
const OFFICERS: { role: string; file: string; label: string }[] = [
  { role: "ceo", file: "ceo-sign.png", label: "CEO" },
  { role: "coo", file: "coo-sign.png", label: "COO" },
  { role: "cco", file: "cco-sign.png", label: "CCO" },
  { role: "hr_admin", file: "hr-admin-sign.png", label: "HR Admin" },
  { role: "sales_marketing", file: "sales-marketing-sign.png", label: "Sales & Marketing" },
];
interface VaultRow { issuer_code: string; role: string; version: number; uploaded_at: string; uploaded_by_name: string | null; retired_at: string | null }

function OfficerChops({ co, staff, sigOf, manage, onRegister }: {
  co: Issuer; staff: Person[]; sigOf: (uid: number) => Sig | null; manage: boolean; onRegister: (uid: number) => void;
}) {
  const [vault, setVault] = useState<{ rows: VaultRow[]; legacy: string[] } | null | "none">(null);
  useEffect(() => {
    const c = new AbortController();
    void api<{ rows?: VaultRow[]; legacy?: string[] }>("/staff/signatures", { signal: c.signal }).then((r) => {
      if (c.signal.aborted) return;
      setVault(r.ok && r.data ? { rows: r.data.rows ?? [], legacy: r.data.legacy ?? [] } : "none");
    });
    return () => c.abort();
  }, []);
  if (vault === "none") return null; // not a vault reader - nothing to show
  return (
    <section className={css.card} aria-label={L("Officer chops from /admin", "Cop pegawai dari /admin")} data-testid="officer-chops">
      <h3 className={css.cardTitle}>{L(`Officer chops on file for ${ISSUER_NAME[co]} (from /admin)`, `Cop pegawai dalam fail untuk ${ISSUER_NAME[co]} (dari /admin)`)}</h3>
      <p className={css.muted}>{L("These are the scans documents print today while personal signing is Off (signature and company stamp in one picture). To replace one, use the new flow on its row: register the person's own signature, they confirm it in Profile, you approve it - then upload the company stamp above and turn personal signing on. The old chops are kept for documents already issued; nothing is deleted.",
        "Ini imbasan yang dicetak pada dokumen hari ini semasa tandatangan peribadi Mati (tandatangan dan cop syarikat dalam satu gambar). Untuk menggantinya, guna aliran baharu pada barisnya: daftar tandatangan orang itu, mereka sahkan di Profil, anda luluskan - kemudian muat naik cop syarikat di atas dan hidupkan tandatangan peribadi. Cop lama disimpan untuk dokumen yang telah dikeluarkan; tiada yang dipadam.")}</p>
      {vault === null ? <SkelCard lines={3} /> : (
        <ul className={css.people}>
          {OFFICERS.map((o) => {
            const cur = vault.rows.filter((v) => v.issuer_code === co && v.role === o.role && !v.retired_at).sort((a, b) => b.version - a.version)[0] ?? null;
            const legacy = co === "a2z" && vault.legacy.includes(o.role);
            const holders = staff.filter((p) => p.role === o.role && p.is_active !== 0);
            return (
              <li key={o.role} className={css.person} data-testid={`chop-${o.role}`}>
                <div className={css.whoText}>
                  <span className={css.name}>{o.label}</span>
                  <span className={css.muted}>{holders.length ? holders.map((h) => h.name).join(", ") : L("Nobody holds this role now", "Tiada sesiapa memegang peranan ini sekarang")}</span>
                </div>
                <div className={css.sigCell}>
                  {cur || legacy ? (<>
                    <div className={css.plateSm}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img className={css.mark} src={`/api/v1/staff/signature/${co}/${o.file}?v=${cur ? cur.version : "legacy"}`} alt={L(`Chop on file for ${o.label}`, `Cop dalam fail untuk ${o.label}`)} loading="lazy" />
                    </div>
                    <span className={css.muted}>{cur ? L(`Version ${cur.version} · ${day(cur.uploaded_at)}`, `Versi ${cur.version} · ${day(cur.uploaded_at)}`) + (cur.uploaded_by_name ? ` · ${cur.uploaded_by_name}` : "") : L("Early file (before versions)", "Fail awal (sebelum versi)")}</span>
                  </>) : <span className={`${css.chip} ${css.wait}`}>{L("Missing - prints a blank space", "Tiada - mencetak ruang kosong")}</span>}
                </div>
                <div className={css.auths}>
                  {holders.map((h) => { const sg = sigOf(h.id); return (
                    <span key={h.id}>{L("New signature", "Tandatangan baharu")} ({h.name}): {sg ? <span className={`${css.chip} ${chip(sg.status)}`}>{statusWord(sg)}</span> : L("not registered", "belum didaftar")}</span>
                  ); })}
                </div>
                {manage && holders.length > 0 && (
                  <div className={css.row}>
                    {holders.map((h) => (
                      <button key={h.id} type="button" className={btnSm} onClick={() => onRegister(h.id)}>
                        {sigOf(h.id) ? L(`Replace ${h.name}'s signature`, `Ganti tandatangan ${h.name}`) : L(`Register ${h.name}'s signature`, `Daftar tandatangan ${h.name}`)}
                      </button>
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/* ======================================================= Users > Signatures & Stamps */
export function SigningPanel() {
  const [data, setData] = useState<Overview | null>(null);
  const [failed, setFailed] = useState("");
  const [staff, setStaff] = useState<Person[]>([]);
  const [co, setCo] = useState<Issuer>("a2z");
  const [tick, setTick] = useState(0);
  const [addId, setAddId] = useState("");
  const { prompt, node: promptNode } = usePrompt();
  const { show, node: toastNode } = useSaveToast();
  useEffect(() => {
    const c = new AbortController();
    void api<Overview & { error?: { message?: string } }>("/staff/signing/overview", { signal: c.signal }).then((r) => {
      if (c.signal.aborted) return;
      if (r.ok && r.data) { setData(r.data); setFailed(""); } else setFailed(r.data?.error?.message ?? L("Signatures could not be loaded.", "Tandatangan tidak dapat dimuatkan."));
    });
    void api<{ staff?: Person[] }>("/staff/staff-list", { signal: c.signal }).then((r) => { if (!c.signal.aborted && r.ok) setStaff(r.data?.staff ?? []); });
    return () => c.abort();
  }, [tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  const done = (r: { ok: boolean; msg: string }, okText: string) => { if (r.ok) { show(okText); reload(); } else if (r.msg) show(L("Not saved", "Tidak disimpan"), r.msg, "notice"); };

  if (failed) return <p className={css.warn} role="alert">{failed}</p>;
  if (!data) return <SkelCard lines={4} />;
  const manage = data.can_manage;
  const pol = data.policies.find((p) => p.issuer_code === co)!;
  const stamp = data.stamps.find((s) => s.issuer_code === co && s.status === "active") ?? null;
  const people = new Map<number, Person>([...staff, ...data.people].map((p) => [p.id, p]));
  const ids = [...new Set([...data.authorities.filter((a) => a.issuer_code === co).map((a) => a.user_id), ...data.signatures.filter((s) => s.status !== "retired").map((s) => s.user_id)])];
  const sigOf = (uid: number) => data.signatures.filter((s) => s.user_id === uid && s.status !== "retired")[0] ?? null;
  const authOf = (uid: number, cap: "prepare" | "approve") => data.authorities.find((a) => a.user_id === uid && a.issuer_code === co && a.capacity === cap) ?? null;

  const setPolicy = async (patch: Partial<Policy>) => {
    const next = { ...pol, ...patch };
    done(await signed(prompt, `/staff/signing/policy/${co}`, { personal: next.personal, stamp_on: next.stamp_on }, L("Change the signing policy", "Tukar polisi tandatangan")), L("Policy saved", "Polisi disimpan"));
  };
  const grant = async (uid: number, cap: "prepare" | "approve", types: string[]) => {
    const why = await prompt({ title: cap === "prepare" ? L("Allow to sign as preparer", "Benarkan menandatangan sebagai penyedia") : L("Allow to approve", "Benarkan meluluskan"), label: L("Why (kept in the history)", "Sebab (disimpan dalam sejarah)"), required: true });
    if (!why) return;
    done(await signed(prompt, "/staff/signing/authorities", { user_id: uid, issuer_code: co, capacity: cap, doc_types: types, reason: why.value }, L("Grant signing authority", "Beri kuasa tandatangan")), L("Authority granted", "Kuasa diberi"));
  };
  const revoke = async (a: Auth) => {
    const why = await prompt({ title: L("Remove signing authority", "Tarik balik kuasa tandatangan"), label: L("Why (kept in the history)", "Sebab (disimpan dalam sejarah)"), required: true, variant: "danger" });
    if (!why) return;
    done(await signed(prompt, `/staff/signing/authorities/${a.id}/revoke`, { reason: why.value }, L("Remove signing authority", "Tarik balik kuasa tandatangan")), L("Authority removed", "Kuasa ditarik balik"));
  };
  const retire = async (id: number, what: string) => {
    const why = await prompt({ title: L(`Retire this ${what}`, `Hentikan ${what} ini`), label: L("Why (kept in the history). Documents already issued keep it.", "Sebab (disimpan dalam sejarah). Dokumen yang telah dikeluarkan mengekalkannya."), required: true, variant: "danger" });
    if (!why) return;
    done(await signed(prompt, `/staff/signing/assets/${id}/retire`, { reason: why.value }, L("Retire", "Hentikan")), L("Retired", "Dihentikan"));
  };
  const approveSig = async (s: Sig) => done(await signed(prompt, `/staff/signing/assets/${s.id}/approve`, {}, L("Approve this signature", "Luluskan tandatangan ini")), L("Signature approved", "Tandatangan diluluskan"));
  const register = (uid: number) => pickPng(async (f) => {
    const r = await uploadPng(prompt, `kind=signature&user=${uid}`, f, L("Register a signature", "Daftar tandatangan"));
    if (r.ok) { show(r.status === "active" ? L("Signature active", "Tandatangan aktif") : L("Registered - waiting for the person to confirm it", "Didaftar - menunggu pemiliknya mengesahkan")); reload(); }
    else if (r.msg) show(L("Not uploaded", "Tidak dimuat naik"), r.msg, "notice");
  });
  const uploadStamp = () => pickPng(async (f) => {
    const r = await uploadPng(prompt, `kind=stamp&issuer=${co}`, f, L("Upload the company stamp", "Muat naik cop syarikat"));
    if (r.ok) { show(L("Stamp active", "Cop aktif")); reload(); } else if (r.msg) show(L("Not uploaded", "Tidak dimuat naik"), r.msg, "notice");
  });
  return (
    <div className={css.wrap} data-testid="signing-panel">
      {promptNode}{toastNode}
      <header className={css.head}>
        <div>
          <h2 className={css.title}>{L("Signatures & Stamps", "Tandatangan & Cop")}</h2>
          <p className={css.sub}>{L("A signature belongs to a person and is used only after that person confirms it and the CEO approves it. A stamp belongs to one company. A scanned signature is a visual mark, not a digital certificate.", "Tandatangan milik seseorang dan hanya digunakan selepas orang itu mengesahkannya dan CEO meluluskannya. Cop milik satu syarikat. Tandatangan imbasan ialah tanda visual, bukan sijil digital.")}</p>
        </div>
        <div className={css.switch} role="tablist" aria-label={L("Company", "Syarikat")}>
          {(["a2z", "azoo"] as Issuer[]).map((c) => (
            <button key={c} type="button" role="tab" aria-selected={co === c} className={co === c ? css.on : undefined} onClick={() => setCo(c)}>{ISSUER_NAME[c]}</button>
          ))}
        </div>
      </header>
      {!manage && <p className={css.note}>{L("Read only - the CEO manages signatures and stamps.", "Baca sahaja - CEO mengurus tandatangan dan cop.")}</p>}

      <section className={css.grid}>
        <div className={css.card} aria-label={L("Policy", "Polisi")}>
          <h3 className={css.cardTitle}>{L("Signing policy", "Polisi tandatangan")}</h3>
          <dl className={css.facts}>
            <div><dt>{L("Personal signing", "Tandatangan peribadi")}</dt><dd>{pol.personal ? L("On - documents carry the preparer's own signature", "Hidup - dokumen membawa tandatangan penyedia sendiri") : L("Off - documents print as today (officer chops)", "Mati - dokumen dicetak seperti hari ini (cop pegawai)")}</dd></div>
            <div><dt>{L("Stamp on", "Cop pada")}</dt><dd>{pol.stamp_on.length ? pol.stamp_on.map((t) => TYPE_NAME[t] ?? t).join(", ") : L("No documents", "Tiada dokumen")}</dd></div>
            {/* the ONE approval rule: the CEO's quotation approval limit (Sales), for both companies */}
            <div><dt>{L("Quotation approval", "Kelulusan sebut harga")}</dt><dd>{data.approval_limit ? L(`Above ${fmtRM(data.approval_limit.limit_cents)} (your approval limit in Sales - both companies)`, `Melebihi ${fmtRM(data.approval_limit.limit_cents)} (had kelulusan anda dalam Jualan - kedua-dua syarikat)`) : L("Not required - no approval limit is set in Sales", "Tidak diperlukan - tiada had kelulusan ditetapkan dalam Jualan")}</dd></div>
            {pol.updated_at && <div><dt>{L("Last changed", "Terakhir ditukar")}</dt><dd>{day(pol.updated_at)}{pol.updated_by_name ? ` · ${pol.updated_by_name}` : ""}</dd></div>}
          </dl>
          {manage && (
            <div className={css.row}>
              <button type="button" className={pol.personal ? btnSm : btnSmPrimary} onClick={() => void setPolicy({ personal: !pol.personal })}>{pol.personal ? L("Turn personal signing off", "Matikan tandatangan peribadi") : L("Turn personal signing on", "Hidupkan tandatangan peribadi")}</button>
              {(["QT", "INV", "DO"] as const).map((t) => (
                <label key={t} className={css.check}><input type="checkbox" checked={pol.stamp_on.includes(t)} onChange={(e) => void setPolicy({ stamp_on: e.target.checked ? [...pol.stamp_on, t] : pol.stamp_on.filter((x) => x !== t) })} />{L(`Stamp on ${TYPE_NAME[t]}`, `Cop pada ${TYPE_NAME[t]}`)}</label>
              ))}
            </div>
          )}
        </div>

        <div className={css.card} aria-label={L("Company stamp", "Cop syarikat")}>
          <h3 className={css.cardTitle}>{L(`${ISSUER_NAME[co]} stamp`, `Cop ${ISSUER_NAME[co]}`)}</h3>
          {stamp ? (<>
            <div className={css.plate}><Mark id={stamp.id} alt={L("Company stamp", "Cop syarikat")} /></div>
            <p className={css.muted}>{L(`Version ${stamp.version} · uploaded ${day(stamp.uploaded_at)}`, `Versi ${stamp.version} · dimuat naik ${day(stamp.uploaded_at)}`)}{stamp.uploaded_by_name ? ` · ${stamp.uploaded_by_name}` : ""}</p>
          </>) : <p className={css.muted}>{L("No stamp uploaded for this company yet - today its stamp prints inside the officer chops below. It never borrows the other company's.", "Belum ada cop dimuat naik untuk syarikat ini - hari ini copnya dicetak dalam cop pegawai di bawah. Ia tidak meminjam cop syarikat lain.")}</p>}
          {manage && <div className={css.row}>
            <button type="button" className={btnSm} onClick={uploadStamp}>{stamp ? L("Replace stamp", "Ganti cop") : L("Upload stamp (PNG)", "Muat naik cop (PNG)")}</button>
            {stamp && <button type="button" className={btnSmQuiet} onClick={() => void retire(stamp.id, L("stamp", "cop"))}>{L("Retire", "Hentikan")}</button>}
          </div>}
        </div>
      </section>

      <section className={css.card} aria-label={L("Signatories", "Penandatangan")}>
        <h3 className={css.cardTitle}>{L(`Who signs for ${ISSUER_NAME[co]}`, `Siapa menandatangan untuk ${ISSUER_NAME[co]}`)}</h3>
        {ids.length === 0 && <p className={css.muted}>{L("Nobody yet. Add a person below.", "Belum ada. Tambah seseorang di bawah.")}</p>}
        <ul className={css.people}>
          {ids.map((uid) => {
            const p = people.get(uid); const s = sigOf(uid); const pa = authOf(uid, "prepare"); const aa = authOf(uid, "approve");
            return (
              <li key={uid} className={css.person} data-testid={`signer-${uid}`}>
                <div className={css.who}>
                  <Avatar name={p?.name ?? `#${uid}`} userId={uid} size="sm" />
                  <div className={css.whoText}><span className={css.name}>{p?.name ?? `#${uid}`}</span><span className={css.muted}>{p?.position ?? p?.role ?? ""}</span></div>
                </div>
                <div className={css.sigCell}>
                  {s ? (<>
                    {(manage || s.status === "active") && <div className={css.plateSm}><Mark id={s.id} alt={L(`Signature of ${p?.name ?? ""}`, `Tandatangan ${p?.name ?? ""}`)} /></div>}
                    <span className={`${css.chip} ${chip(s.status)}`}>{statusWord(s)}</span>
                  </>) : <span className={css.muted}>{L("No signature", "Tiada tandatangan")}</span>}
                </div>
                <div className={css.auths}>
                  <span>{L("Prepares", "Menyedia")}: {pa ? pa.doc_types.split(",").map((t) => TYPE_NAME[t] ?? t).join(", ") : "—"}</span>
                  <span>{L("Approves", "Melulus")}: {aa ? aa.doc_types.split(",").map((t) => TYPE_NAME[t] ?? t).join(", ") : "—"}</span>
                </div>
                {manage && (
                  <div className={css.row}>
                    {s && s.status === "pending" && s.consented_at && <button type="button" className={btnSmPrimary} onClick={() => void approveSig(s)}>{L("Approve signature", "Luluskan tandatangan")}</button>}
                    <button type="button" className={btnSm} onClick={() => register(uid)}>{s ? L("Replace signature", "Ganti tandatangan") : L("Register signature", "Daftar tandatangan")}</button>
                    {s && <button type="button" className={btnSmQuiet} onClick={() => void retire(s.id, L("signature", "tandatangan"))}>{L("Retire", "Hentikan")}</button>}
                    {pa ? <button type="button" className={btnSmQuiet} onClick={() => void revoke(pa)}>{L("Stop preparing", "Henti menyedia")}</button>
                      : <button type="button" className={btnSm} onClick={() => void grant(uid, "prepare", ["QT", "INV", "DO"])}>{L("Allow to prepare", "Benarkan menyedia")}</button>}
                    {aa ? <button type="button" className={btnSmQuiet} onClick={() => void revoke(aa)}>{L("Stop approving", "Henti melulus")}</button>
                      : <button type="button" className={btnSm} onClick={() => void grant(uid, "approve", ["QT"])}>{L("Allow to approve quotations", "Benarkan melulus sebut harga")}</button>}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        {manage && (
          <div className={css.row}>
            <select className={selectClassSm} value={addId} aria-label={L("Add a person", "Tambah seseorang")} onChange={(e) => setAddId(e.target.value)}>
              <option value="">{L("Add a person…", "Tambah seseorang…")}</option>
              {staff.filter((p) => !ids.includes(p.id)).map((p) => <option key={p.id} value={p.id}>{p.name}{p.position ? ` · ${p.position}` : ""}</option>)}
            </select>
            <button type="button" className={btnSm} disabled={!addId} onClick={() => { const id = Number(addId); setAddId(""); void grant(id, "prepare", ["QT", "INV", "DO"]); }}>{L("Allow to prepare", "Benarkan menyedia")}</button>
            <button type="button" className={btnSm} disabled={!addId} onClick={() => { const id = Number(addId); setAddId(""); register(id); }}>{L("Register signature", "Daftar tandatangan")}</button>
          </div>
        )}
      </section>

      <OfficerChops co={co} staff={staff} sigOf={sigOf} manage={manage} onRegister={register} />
    </div>
  );
}

/* ======================================================= Profile > My signature */
export function MySignature() {
  const [d, setD] = useState<{ signatures: Sig[]; authorities: { issuer_code: Issuer; capacity: string; doc_types: string }[] } | null>(null);
  const [tick, setTick] = useState(0);
  const { prompt, node: promptNode } = usePrompt();
  const { show, node: toastNode } = useSaveToast();
  useEffect(() => {
    const c = new AbortController();
    void api<{ signatures: Sig[]; authorities: { issuer_code: Issuer; capacity: string; doc_types: string }[] }>("/staff/signing/me", { signal: c.signal }).then((r) => { if (!c.signal.aborted && r.ok && r.data) setD(r.data); });
    return () => c.abort();
  }, [tick]);
  if (!d) return <SkelCard lines={2} />;
  const cur = d.signatures.find((s) => s.status !== "retired") ?? null;
  const upload = () => pickPng(async (f) => {
    const r = await uploadPng(prompt, "kind=signature", f, L("Upload your signature", "Muat naik tandatangan anda"));
    if (r.ok) { show(r.status === "active" ? L("Signature active", "Tandatangan aktif") : L("Sent - the CEO approves it next", "Dihantar - CEO akan meluluskannya")); setTick((t) => t + 1); }
    else if (r.msg) show(L("Not uploaded", "Tidak dimuat naik"), r.msg, "notice");
  });
  const consent = async (s: Sig) => {
    const r = await signed(prompt, `/staff/signing/assets/${s.id}/consent`, {}, L("Confirm this is your signature", "Sahkan ini tandatangan anda"));
    if (r.ok) { show(L("Confirmed", "Disahkan")); setTick((t) => t + 1); } else if (r.msg) show(L("Not confirmed", "Tidak disahkan"), r.msg, "notice");
  };
  return (
    <section className={css.card} aria-label={L("My signature", "Tandatangan saya")} data-testid="my-signature">
      {promptNode}{toastNode}
      <h3 className={css.cardTitle}>{L("My signature", "Tandatangan saya")}</h3>
      <p className={css.muted}>{L("Your signature prints on documents you prepare only after you confirm it and the CEO approves it. It is a visual mark, not a digital certificate.", "Tandatangan anda dicetak pada dokumen yang anda sediakan hanya selepas anda mengesahkannya dan CEO meluluskannya. Ia tanda visual, bukan sijil digital.")}</p>
      {cur ? (
        <div className={css.row}>
          <div className={css.plateSm}><Mark id={cur.id} alt={L("My signature", "Tandatangan saya")} /></div>
          <span className={`${css.chip} ${chip(cur.status)}`}>{statusWord(cur)}</span>
          {cur.status === "pending" && !cur.consented_at && <button type="button" className={btnSmPrimary} onClick={() => void consent(cur)}>{L("This is my signature - confirm", "Ini tandatangan saya - sahkan")}</button>}
        </div>
      ) : <p className={css.muted}>{L("No signature on file.", "Tiada tandatangan dalam fail.")}</p>}
      <div className={css.row}>
        <button type="button" className={btnSm} onClick={upload}>{cur ? L("Upload a new one", "Muat naik yang baharu") : L("Upload my signature (PNG)", "Muat naik tandatangan saya (PNG)")}</button>
      </div>
      {d.authorities.length > 0 && (
        <ul className={css.list}>
          {d.authorities.map((a, i) => <li key={i}>{a.capacity === "prepare" ? L("Prepares", "Menyedia") : L("Approves", "Melulus")} · {ISSUER_NAME[a.issuer_code]} · {a.doc_types.split(",").map((t) => TYPE_NAME[t] ?? t).join(", ")}</li>)}
        </ul>
      )}
    </section>
  );
}

/* ======================================================= the quotation page */
interface PlanPerson { user_id: number | null; name: string | null; position: string | null; asset_id: number | null; at?: string }
interface Plan { mode: "legacy" | "personal"; issuer: Issuer; prepared: PlanPerson | null; approved: PlanPerson | null; stamp_asset_id: number | null; needs_approval: boolean; blocked: string | null; notice: string | null; issued: { at: string } | null }
export function DocSigningCard({ docId, onChange }: { docId: number; onChange?: () => void }) {
  const [p, setP] = useState<{ sign: Plan; can_approve: boolean } | null>(null);
  const [tick, setTick] = useState(0);
  const { prompt, node: promptNode } = usePrompt();
  const { show, node: toastNode } = useSaveToast();
  useEffect(() => {
    const c = new AbortController();
    void api<{ sign: Plan; can_approve: boolean }>(`/staff/docs/${docId}/sign-plan`, { signal: c.signal }).then((r) => { if (!c.signal.aborted) setP(r.ok && r.data ? r.data : null); });
    return () => c.abort();
  }, [docId, tick]);
  if (!p) return <SkelCard lines={2} />;
  if (p.sign.mode !== "personal") return null; // the company still signs with the role chops: nothing to say
  const s = p.sign;
  const approve = async () => {
    const r = await signed(prompt, `/staff/docs/${docId}/approve`, {}, L("Approve and sign this quotation", "Luluskan dan tandatangani sebut harga ini"));
    if (r.ok) { show(L("Approved - your signature is on it", "Diluluskan - tandatangan anda padanya")); setTick((t) => t + 1); onChange?.(); }
    else if (r.msg) show(L("Not approved", "Tidak diluluskan"), r.msg, "notice");
  };
  return (
    <section className={css.card} aria-label={L("Signatures", "Tandatangan")} data-testid="doc-signing">
      {promptNode}{toastNode}
      <h3 className={css.cardTitle}>{L("Signatures", "Tandatangan")}</h3>
      <dl className={css.facts}>
        <div><dt>{L("Prepared by", "Disediakan oleh")}</dt><dd>{s.prepared?.name ?? "—"} · {s.prepared?.asset_id ? L("own signature", "tandatangan sendiri") : L("ink line (no active signature or authority)", "garisan dakwat (tiada tandatangan aktif atau kuasa)")}</dd></div>
        <div><dt>{L("Approved by", "Diluluskan oleh")}</dt><dd>{s.approved ? `${s.approved.name ?? ""} · ${day(s.approved.at)}` : s.needs_approval ? L("Required - not yet approved", "Diperlukan - belum diluluskan") : L("Not required", "Tidak diperlukan")}</dd></div>
        <div><dt>{L("Company stamp", "Cop syarikat")}</dt><dd>{s.stamp_asset_id ? L("On this document", "Pada dokumen ini") : L("Not on this document", "Tiada pada dokumen ini")}</dd></div>
        <div><dt>{L("Issued", "Dikeluarkan")}</dt><dd>{s.issued ? L(`${day(s.issued.at)} - its signatures are fixed`, `${day(s.issued.at)} - tandatangannya tetap`) : L("Not yet - fixed at the first share", "Belum - ditetapkan semasa kongsi pertama")}</dd></div>
      </dl>
      {s.blocked && <p className={css.warn} role="status">{s.blocked}</p>}
      {!s.blocked && s.notice && <p className={css.note}>{s.notice}</p>}
      {p.can_approve && <div className={css.row}><button type="button" className={btnSmPrimary} onClick={() => void approve()}>{L("Approve and sign", "Luluskan dan tandatangan")}</button></div>}
    </section>
  );
}

/** Before a document leaves (shared or sent): fix its signatures. Null = go ahead; else the reason it may not. */
export async function issueBeforeSend(docId: number): Promise<string | null> {
  const r = await api<{ error?: { code?: string; message?: string } }>(`/staff/docs/${docId}/issue`, { method: "POST", body: JSON.stringify({}) });
  if (r.ok) return null;
  if (r.status === 409 && r.data?.error?.code === "approval_required") return r.data.error.message ?? L("This quotation needs a management approval first.", "Sebut harga ini perlu kelulusan pengurusan dahulu.");
  return null; // an older worker (no route) or a passing failure never blocks a send the server still allows
}

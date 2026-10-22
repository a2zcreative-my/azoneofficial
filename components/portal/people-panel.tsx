"use client";

/**
 * v1.181.17 - PEOPLE (ERP roadmap, phase 5), on the HR tab.
 *
 * The lifecycle around the records HR already keeps, in one card:
 *
 *   Joining & leaving  who joined in the last 90 days with joining steps
 *                      still open (the checklist in Staff Details, read
 *                      here), and who is leaving or left in the last 60 days,
 *                      with a leaving checklist of its own.
 *   Probation          when each probation ends, and the decision -
 *                      confirmed, extended or ended. A decision is recorded;
 *                      the employment status is still changed in Staff
 *                      Details, as before. The Desk reminds 14 days ahead.
 *   Letters            offer, confirmation, extension, warning, resignation
 *                      acceptance, employment verification - drafted from the
 *                      record, edited, numbered, printed and signed by hand.
 *   Training           courses attended, cost and who paid.
 *
 * hr_manage only. For anyone else the zone does not render at all.
 */

import { useEffect, useState } from "react";

import { SectionTabs } from "@/components/portal/page-shared";
import { TabZone } from "@/components/portal/tab-concept";
import { openPrintPreview } from "@/components/ui/document-preview";
import { usePrompt } from "@/components/ui/prompt-dialog";
import { rowBtn } from "@/components/ui/row-button";
import { useSaveToast } from "@/components/ui/save-toast";
import { SkelRows } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { dmy, dmyMYT, fmtRM, mytToday } from "@/lib/format";
import { LETTER_LABEL, letterDraft, letterHtml, type LetterKind, type LetterPerson } from "@/lib/hr-letters";
import { getLang } from "@/lib/i18n";
import { btnSm, btnSmPrimary, card, chipSmNeutral, chipSmSuccess, chipSmWarn, inputClassSm, selectClassSm } from "@/lib/ui-styles";

import css from "./business.module.css";

const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);

const JOINING_LABEL: Record<string, [string, string]> = {
  offer_letter: ["Offer letter signed", "Surat tawaran ditandatangani"],
  contract: ["Employment contract signed", "Kontrak pekerjaan ditandatangani"],
  bank: ["Bank details collected", "Butiran bank dikumpul"],
  twofa: ["2FA enabled", "2FA diaktifkan"],
  badge: ["ID badge printed", "Lencana ID dicetak"],
  groups: ["Added to team WhatsApp group", "Ditambah ke kumpulan WhatsApp pasukan"],
};
const LEAVING_LABEL: Record<string, [string, string]> = {
  assets_returned: ["Company assets returned", "Aset syarikat dipulangkan"],
  access_removed: ["Portal access and accounts removed", "Akses portal dan akaun dibuang"],
  claims_settled: ["Claims and advances settled", "Tuntutan dan pendahuluan diselesaikan"],
  final_pay: ["Final pay settled", "Gaji akhir diselesaikan"],
  exit_letter: ["Resignation acceptance letter issued", "Surat penerimaan peletakan jawatan dikeluarkan"],
  groups_removed: ["Removed from team WhatsApp groups", "Dibuang daripada kumpulan WhatsApp pasukan"],
};
const OUTCOME: Record<string, [string, string]> = { confirmed: ["confirmed", "disahkan"], extended: ["extended", "dilanjutkan"], ended: ["ended", "ditamatkan"] };

interface Overview {
  today: string;
  joining: { id: number; name: string; position: string | null; joined_on: string; open: string[] }[];
  leaving: { id: number; name: string; position: string | null; left_on: string; items: Record<string, boolean>; open: string[]; assets_held: number }[];
  probation: { id: number; name: string; position: string | null; joined_on: string | null; suggested_ends_on: string | null; review: { id: number; ends_on: string; outcome: string | null } | null }[];
  decided: { id: number; user_id: number; name: string | null; ends_on: string; outcome: string; note: string | null; decided_at: string; decided_by_name: string | null }[];
  letters: { id: number; user_id: number; kind: LetterKind; ref_no: string; issued_on: string; subject: string; voided_at: string | null; void_reason: string | null; name: string; issued_by_name: string | null }[];
  training: { id: number; user_id: number; name: string; title: string; provider: string | null; on_date: string; hours: number | null; cost_cents: number | null; paid_by: string | null }[];
  staff: { id: number; name: string; position: string | null }[];
  joining_keys: string[]; leaving_keys: string[];
  pending_migration?: boolean;
}

const errOf = (r: { data?: unknown }) => (r.data as { error?: { message?: string } } | null)?.error?.message;

export type PeopleTab = "lifecycle" | "probation" | "letters" | "training";

/* v1.192.0 - the HR page's Employee Lifecycle tab may hold the pill (its
   Overview opens Training or Probation directly); alone it holds its own. */
export function PeoplePanel({ tab: tabProp, onTab }: { tab?: PeopleTab; onTab?: (t: PeopleTab) => void } = {}) {
  const [tabOwn, setTabOwn] = useState<PeopleTab>("lifecycle");
  const tab = tabProp ?? tabOwn;
  const setTab = (t: PeopleTab) => { setTabOwn(t); onTab?.(t); };
  const [data, setData] = useState<Overview | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [tick, setTick] = useState(0);
  const reload = () => setTick((t) => t + 1);
  const { prompt, node: promptNode } = usePrompt();
  const { show: toast, node: toastNode } = useSaveToast();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void api<Overview>(`/staff/people/overview`).then((r) => {
      if (!live) return;
      if (r.status === 403) { setForbidden(true); return; }
      if (r.ok && r.data) setData(r.data);
    });
    return () => { live = false; };
  }, [tick]);

  /* ---- probation ---- */
  const [ends, setEnds] = useState<Record<number, string>>({});
  /* ---- letters ---- */
  const [lt, setLt] = useState({ user: "", kind: "offer" as LetterKind, on: mytToday(), signer: "", signerPos: "", subject: "", body: "" });
  const [person, setPerson] = useState<LetterPerson | null>(null);
  /* ---- training ---- */
  const [tr, setTr] = useState({ user: "", title: "", provider: "", on: "", hours: "", cost: "", paid: "company" });

  const send = async (path: string, method: string, payload: unknown, done: string) => {
    setBusy(true);
    const r = await api(path, { method, body: JSON.stringify(payload ?? {}) });
    setBusy(false);
    if (!r.ok) { toast(L("No changes", "Tiada perubahan"), errOf(r) ?? L("Not saved", "Tidak disimpan"), "notice"); return false; }
    toast(L("Saved", "Disimpan"), done);
    reload();
    return true;
  };

  if (forbidden) return null;
  const body = !data ? <div className={card}><SkelRows rows={5} /></div>
    : data.pending_migration ? <div className={card}><p className="erp-note erp-note-warning">{L("People needs the 0144 database update. It is applied by the next PUSH.bat.", "Orang memerlukan kemas kini pangkalan data 0144. Ia dipasang oleh PUSH.bat seterusnya.")}</p></div>
      : null;
  if (body) return <TabZone label={L("Joining, leaving and letters", "Masuk, keluar dan surat")}>{body}</TabZone>;
  const d = data!;

  const toggleLeaving = (u: Overview["leaving"][number], key: string, on: boolean) =>
    void send(`/staff/people/${u.id}/leaving`, "PUT", { items: { ...u.items, [key]: on } }, on ? L("Step ticked", "Langkah ditanda") : L("Step reopened", "Langkah dibuka semula"));

  const decide = async (p: Overview["probation"][number], outcome: "confirmed" | "extended" | "ended") => {
    const got = await prompt({
      title: L(`${p.name}: probation ${OUTCOME[outcome]![0]}`, `${p.name}: percubaan ${OUTCOME[outcome]![1]}`),
      message: L("This records the decision. Change the employment status in Staff Details, and issue the letter from Letters.", "Ini merekod keputusan. Tukar status pekerjaan di Butiran Kakitangan, dan keluarkan surat dari Surat."),
      label: L("Note (optional)", "Catatan (pilihan)"),
      ...(outcome === "extended" ? { date: { label: L("New end date", "Tarikh tamat baharu"), initial: "", required: true } } : {}),
      confirmLabel: L("Record decision", "Rekod keputusan"), variant: outcome === "ended" ? "danger" : "default",
    });
    if (!got) return;
    const ok = await send(`/staff/people/${p.id}/probation/decide`, "POST", { outcome, note: got.value || undefined, next_ends_on: outcome === "extended" ? got.date : undefined },
      L(`Decision recorded for ${p.name}`, `Keputusan direkod untuk ${p.name}`));
    if (ok && outcome !== "ended") {
      setLt((x) => ({ ...x, user: String(p.id), kind: outcome === "confirmed" ? "confirmation" : "extension", subject: "", body: "" }));
      setPerson(null);
    }
  };

  const fill = async () => {
    if (!lt.user) return;
    const r = await api<{ person: LetterPerson }>(`/staff/people/${lt.user}/letter-fields`);
    if (!r.ok || !r.data) { toast(L("No changes", "Tiada perubahan"), errOf(r) ?? L("Could not read the record", "Tidak dapat membaca rekod"), "notice"); return; }
    const pr = d.probation.find((x) => String(x.id) === lt.user)?.review;
    const draft = letterDraft(lt.kind, r.data.person, { ends_on: pr?.ends_on ?? null, next_ends_on: pr?.ends_on ?? null });
    setPerson(r.data.person);
    setLt((x) => ({ ...x, subject: draft.subject, body: draft.body }));
  };
  const preview = (ref: string, l: { subject: string; body: string; issued_on: string; name: string; position?: string | null; ic_number?: string | null; voided?: boolean }, signer: { name: string; position: string }) =>
    openPrintPreview(letterHtml({ ref_no: ref, ...l }, signer));
  const issue = async () => {
    setBusy(true);
    const r = await api<{ id?: number; ref_no?: string; error?: { message?: string } }>(`/staff/people/${lt.user}/letters`, {
      method: "POST", body: JSON.stringify({ kind: lt.kind, issued_on: lt.on, subject: lt.subject, body: lt.body, signer_name: lt.signer, signer_position: lt.signerPos }),
    });
    setBusy(false);
    if (!r.ok || !r.data?.ref_no) { toast(L("No changes", "Tiada perubahan"), r.data?.error?.message ?? L("Not issued", "Tidak dikeluarkan"), "notice"); return; }
    toast(L("Saved", "Disimpan"), L(`${r.data.ref_no} issued`, `${r.data.ref_no} dikeluarkan`));
    preview(r.data.ref_no, { subject: lt.subject, body: lt.body, issued_on: lt.on, name: person?.name ?? "", position: person?.position, ic_number: person?.ic_number }, { name: lt.signer, position: lt.signerPos });
    setLt((x) => ({ ...x, subject: "", body: "" }));
    reload();
  };
  const reprint = async (id: number) => {
    const r = await api<{ letter: { ref_no: string; subject: string; body: string; issued_on: string; name: string; position: string | null; ic_number: string | null; signer_name: string | null; signer_position: string | null; voided_at: string | null } }>(`/staff/people/letters/${id}`);
    if (!r.ok || !r.data) { toast(L("No changes", "Tiada perubahan"), errOf(r) ?? L("Letter not found", "Surat tidak dijumpai"), "notice"); return; }
    const l = r.data.letter;
    preview(l.ref_no, { subject: l.subject, body: l.body, issued_on: l.issued_on, name: l.name, position: l.position, ic_number: l.ic_number, voided: !!l.voided_at }, { name: l.signer_name ?? "", position: l.signer_position ?? "" });
  };
  const voidLetter = async (l: Overview["letters"][number]) => {
    const got = await prompt({ title: L(`Void ${l.ref_no}?`, `Batalkan ${l.ref_no}?`), message: L("The letter stays on record, marked voided.", "Surat kekal direkod, ditanda dibatalkan."),
      label: L("Reason", "Sebab"), required: true, confirmLabel: L("Void letter", "Batalkan surat"), variant: "danger" });
    if (!got) return;
    void send(`/staff/people/letters/${l.id}/void`, "POST", { reason: got.value }, L(`${l.ref_no} voided`, `${l.ref_no} dibatalkan`));
  };

  const openJoin = d.joining.filter((j) => j.open.length > 0);
  return (
    <TabZone label={L("Joining, leaving and letters", "Masuk, keluar dan surat")}>
      <div className={card}>
        {promptNode}{toastNode}
        <SectionTabs value={tab} onChange={setTab} tabs={[
          ["lifecycle", `${L("Joining & leaving", "Masuk & keluar")}${openJoin.length + d.leaving.filter((x) => x.open.length).length ? ` · ${openJoin.length + d.leaving.filter((x) => x.open.length).length}` : ""}`],
          ["probation", `${L("Probation", "Percubaan")}${d.probation.length ? ` · ${d.probation.length}` : ""}`],
          ["letters", L("Letters", "Surat")],
          ["training", L("Training", "Latihan")],
        ] as const} />

        {/* ---- joining & leaving ---- */}
        <div className={`${css.stack} erp-mt-3`} hidden={tab !== "lifecycle"}>
          <p className={css.sub}>{L("Joining - the last 90 days", "Masuk - 90 hari lepas")}</p>
          {openJoin.length === 0 ? <p className={css.empty}>{L("Every joining checklist is complete.", "Setiap senarai semak kemasukan lengkap.")}</p> : (
            <ul className={css.list} aria-label={L("Joining steps open", "Langkah kemasukan terbuka")}>
              {openJoin.map((j) => (
                <li key={j.id} className={css.tlItem}>
                  <span className={css.when}>{dmy(j.joined_on)}</span>
                  <span className={css.what}><span className={css.whatTitle}>{j.name}{j.position ? ` · ${j.position}` : ""}</span>
                    <span className={css.whatDetail}>{L("Open: ", "Terbuka: ")}{j.open.map((k) => L(JOINING_LABEL[k]?.[0] ?? k, JOINING_LABEL[k]?.[1] ?? k)).join(" · ")}</span></span>
                  <span className={chipSmWarn}>{j.open.length}/{d.joining_keys.length}</span>
                </li>
              ))}
            </ul>
          )}
          <p className={css.hiddenNote}>{L("Joining steps are ticked in Staff Details → the person → Documents & onboarding.", "Langkah kemasukan ditanda di Butiran Kakitangan → orang itu → Dokumen & onboarding.")}</p>

          <p className={css.sub}>{L("Leaving", "Keluar")}</p>
          {d.leaving.length === 0 ? <p className={css.empty}>{L("Nobody is leaving. A last day set in Staff Details brings the person here.", "Tiada sesiapa keluar. Hari terakhir yang ditetapkan di Butiran Kakitangan membawa orang itu ke sini.")}</p> : (
            <ul className={css.list} aria-label={L("Leaving checklists", "Senarai semak keluar")}>
              {d.leaving.map((u) => (
                <li key={u.id} className={css.monthRow}>
                  <div className={css.monthHead}>
                    <span className={css.whatTitle}>{u.name}{u.position ? ` · ${u.position}` : ""}</span>
                    <span className={u.open.length ? chipSmWarn : chipSmSuccess}>{u.open.length ? L(`${u.open.length} open`, `${u.open.length} terbuka`) : L("done", "selesai")}</span>
                    <span className={css.whatDetail}>{L(`last day ${dmy(u.left_on)}`, `hari terakhir ${dmy(u.left_on)}`)}{u.assets_held ? L(` · holds ${u.assets_held} company asset(s)`, ` · memegang ${u.assets_held} aset syarikat`) : ""}</span>
                  </div>
                  <div className={css.form}>
                    {d.leaving_keys.map((k) => (
                      <label key={k} className={css.check}>
                        <input type="checkbox" checked={!!u.items[k]} disabled={busy} onChange={(e) => toggleLeaving(u, k, e.target.checked)} />
                        {L(LEAVING_LABEL[k]?.[0] ?? k, LEAVING_LABEL[k]?.[1] ?? k)}
                      </label>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* ---- probation ---- */}
        <div className={`${css.stack} erp-mt-3`} hidden={tab !== "probation"}>
          <p className={css.hiddenNote}>{L("Everyone whose status is Probation. The Desk reminds you 14 days before the end. A decision is recorded here; change the status in Staff Details.",
            "Setiap orang yang berstatus Percubaan. Meja mengingatkan anda 14 hari sebelum tamat. Keputusan direkod di sini; tukar status di Butiran Kakitangan.")}</p>
          {d.probation.length === 0 ? <p className={css.empty}>{L("Nobody is on probation.", "Tiada sesiapa dalam percubaan.")}</p> : (
            <ul className={css.list} aria-label={L("On probation", "Dalam percubaan")}>
              {d.probation.map((p) => {
                const end = p.review?.ends_on ?? null;
                const due = end && end <= d.today;
                const value = ends[p.id] ?? end ?? p.suggested_ends_on ?? "";
                return (
                  <li key={p.id} className={css.monthRow}>
                    <div className={css.monthHead}>
                      <span className={css.whatTitle}>{p.name}{p.position ? ` · ${p.position}` : ""}</span>
                      {end ? <span className={due ? chipSmWarn : chipSmNeutral}>{L(`ends ${dmy(end)}`, `tamat ${dmy(end)}`)}</span> : <span className={chipSmNeutral}>{L("no end date", "tiada tarikh tamat")}</span>}
                      <span className={css.whatDetail}>{p.joined_on ? L(`joined ${dmy(p.joined_on)}`, `masuk ${dmy(p.joined_on)}`) : ""}</span>
                    </div>
                    <div className={css.form}>
                      <label className={css.field}>{L("Probation ends on", "Percubaan tamat pada")}
                        <input className={inputClassSm} type="date" value={value} onChange={(e) => setEnds((m) => ({ ...m, [p.id]: e.target.value }))} />
                      </label>
                      <button type="button" className={btnSm} disabled={busy || !value || value === end}
                        onClick={() => void send(`/staff/people/${p.id}/probation`, "POST", { ends_on: value }, L("End date saved", "Tarikh tamat disimpan"))}>
                        {L("Save end date", "Simpan tarikh tamat")}
                      </button>
                    </div>
                    {end && (
                      <div className={css.figures}>
                        <button type="button" className={btnSmPrimary} disabled={busy} onClick={() => void decide(p, "confirmed")}>{L("Confirm", "Sahkan")}</button>
                        <button type="button" className={btnSm} disabled={busy} onClick={() => void decide(p, "extended")}>{L("Extend", "Lanjutkan")}</button>
                        <button type="button" className={rowBtn} disabled={busy} onClick={() => void decide(p, "ended")}>{L("End employment", "Tamatkan")}</button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {d.decided.length > 0 && (
            <>
              <p className={css.sub}>{L("Recent decisions", "Keputusan terkini")}</p>
              <ul className={css.list} aria-label={L("Recent probation decisions", "Keputusan percubaan terkini")}>
                {d.decided.map((r) => (
                  <li key={r.id} className={css.item}>
                    <span className={css.when}>{dmyMYT(r.decided_at).slice(0, 10)}</span>
                    <span className={css.what}><span className={css.whatTitle}>{r.name ?? "-"} · {L(OUTCOME[r.outcome]?.[0] ?? r.outcome, OUTCOME[r.outcome]?.[1] ?? r.outcome)}</span>
                      <span className={css.whatDetail}>{[r.decided_by_name, r.note].filter(Boolean).join(" · ")}</span></span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        {/* ---- letters ---- */}
        <div className={`${css.stack} erp-mt-3`} hidden={tab !== "letters"}>
          <div className={css.form}>
            <label className={css.field}>{L("For", "Untuk")}
              <select className={selectClassSm} value={lt.user} onChange={(e) => { setLt({ ...lt, user: e.target.value, subject: "", body: "" }); setPerson(null); }}>
                <option value="">{L("- pick a person -", "- pilih orang -")}</option>
                {d.staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            <label className={css.field}>{L("Letter", "Surat")}
              <select className={selectClassSm} value={lt.kind} onChange={(e) => setLt({ ...lt, kind: e.target.value as LetterKind, subject: "", body: "" })}>
                {(Object.keys(LETTER_LABEL) as LetterKind[]).map((k) => <option key={k} value={k}>{L(LETTER_LABEL[k][0], LETTER_LABEL[k][1])}</option>)}
              </select>
            </label>
            <label className={css.field}>{L("Date", "Tarikh")}<input className={inputClassSm} type="date" value={lt.on} onChange={(e) => setLt({ ...lt, on: e.target.value })} /></label>
            <button type="button" className={btnSm} disabled={!lt.user} onClick={() => void fill()}>{L("Draft from the record", "Draf daripada rekod")}</button>
          </div>
          {lt.body && (
            <>
              <label className={css.field}>{L("Subject", "Perkara")}<input className={inputClassSm} value={lt.subject} maxLength={200} onChange={(e) => setLt({ ...lt, subject: e.target.value })} /></label>
              <label className={css.field}>{L("Text - edit before issuing; anything in [brackets] needs filling", "Teks - sunting sebelum dikeluarkan; apa-apa dalam [kurungan] perlu diisi")}
                <textarea className={inputClassSm} rows={10} value={lt.body} maxLength={8000} onChange={(e) => setLt({ ...lt, body: e.target.value })} />
              </label>
              <div className={css.form}>
                <label className={css.field}>{L("Signed by", "Ditandatangani oleh")}<input className={inputClassSm} value={lt.signer} maxLength={120} onChange={(e) => setLt({ ...lt, signer: e.target.value })} /></label>
                <label className={css.field}>{L("Their position", "Jawatan mereka")}<input className={inputClassSm} value={lt.signerPos} maxLength={120} placeholder={L("e.g. Chief Executive Officer", "cth. Ketua Pegawai Eksekutif")} onChange={(e) => setLt({ ...lt, signerPos: e.target.value })} /></label>
                <button type="button" className={btnSm} onClick={() => preview(L("DRAFT", "DRAF"), { subject: lt.subject, body: lt.body, issued_on: lt.on, name: person?.name ?? "", position: person?.position, ic_number: person?.ic_number }, { name: lt.signer, position: lt.signerPos })}>{L("Preview", "Pratonton")}</button>
                <button type="button" className={btnSmPrimary} disabled={busy || /\[[^\]]+\]/.test(lt.body) || lt.signer.trim().length < 2} onClick={() => void issue()}>{L("Issue and print", "Keluarkan dan cetak")}</button>
              </div>
              {/\[[^\]]+\]/.test(lt.body) && <p className="erp-note erp-note-warning">{L("Fill or remove everything in [brackets] before issuing.", "Isi atau buang semua dalam [kurungan] sebelum dikeluarkan.")}</p>}
            </>
          )}
          <p className={css.sub}>{L("Issued", "Dikeluarkan")} · {d.letters.length}</p>
          {d.letters.length === 0 ? <p className={css.empty}>{L("No letters issued here yet.", "Belum ada surat dikeluarkan di sini.")}</p> : (
            <ul className={css.list} aria-label={L("Letters issued", "Surat dikeluarkan")}>
              {d.letters.map((l) => (
                <li key={l.id} className={`${css.item} ${l.voided_at ? css.voided : ""}`}>
                  <span className={css.when}>{dmy(l.issued_on)}</span>
                  <span className={css.what}><span className={css.whatTitle}>{l.ref_no} · {l.name}</span>
                    <span className={css.whatDetail}>{L(LETTER_LABEL[l.kind]?.[0] ?? l.kind, LETTER_LABEL[l.kind]?.[1] ?? l.kind)}{l.voided_at ? L(` · voided - ${l.void_reason ?? ""}`, ` · dibatalkan - ${l.void_reason ?? ""}`) : l.issued_by_name ? ` · ${l.issued_by_name}` : ""}</span></span>
                  <button type="button" className={rowBtn} onClick={() => void reprint(l.id)}>{L("Print", "Cetak")}</button>
                  {!l.voided_at && <button type="button" className={rowBtn} disabled={busy} onClick={() => void voidLetter(l)}>{L("Void", "Batal")}</button>}
                </li>
              ))}
            </ul>
          )}
          <p className={css.hiddenNote}>{L("Keep the signed copy in the person's documents in Staff Details.", "Simpan salinan yang ditandatangani dalam dokumen orang itu di Butiran Kakitangan.")}</p>
        </div>

        {/* ---- training ---- */}
        <div className={`${css.stack} erp-mt-3`} hidden={tab !== "training"}>
          <div className={css.form}>
            <label className={css.field}>{L("Who", "Siapa")}
              <select className={selectClassSm} value={tr.user} onChange={(e) => setTr({ ...tr, user: e.target.value })}>
                <option value="">{L("- pick a person -", "- pilih orang -")}</option>
                {d.staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            <label className={css.field}>{L("Course", "Kursus")}<input className={inputClassSm} value={tr.title} maxLength={200} onChange={(e) => setTr({ ...tr, title: e.target.value })} /></label>
            <label className={css.field}>{L("Provider", "Penyedia")}<input className={inputClassSm} value={tr.provider} maxLength={200} onChange={(e) => setTr({ ...tr, provider: e.target.value })} /></label>
            <label className={css.field}>{L("Date", "Tarikh")}<input className={inputClassSm} type="date" value={tr.on} onChange={(e) => setTr({ ...tr, on: e.target.value })} /></label>
            <label className={css.field}>{L("Hours", "Jam")}<input className={inputClassSm} inputMode="decimal" value={tr.hours} onChange={(e) => setTr({ ...tr, hours: e.target.value.replace(/[^\d.]/g, "") })} /></label>
            <label className={css.field}>{L("Cost (RM)", "Kos (RM)")}<input className={inputClassSm} inputMode="decimal" value={tr.cost} onChange={(e) => setTr({ ...tr, cost: e.target.value.replace(/[^\d.]/g, "") })} /></label>
            <label className={css.field}>{L("Paid by", "Dibayar oleh")}
              <select className={selectClassSm} value={tr.paid} onChange={(e) => setTr({ ...tr, paid: e.target.value })}>
                <option value="company">{L("Company", "Syarikat")}</option>
                <option value="self">{L("The staff member", "Kakitangan sendiri")}</option>
                <option value="sponsor">{L("A sponsor (e.g. HRD Corp)", "Penaja (cth. HRD Corp)")}</option>
              </select>
            </label>
            <button type="button" className={btnSmPrimary} disabled={busy || !tr.user || tr.title.trim().length < 3 || !tr.on}
              onClick={() => { void send(`/staff/people/${tr.user}/training`, "POST", { title: tr.title, provider: tr.provider || undefined, on_date: tr.on, hours: tr.hours ? Number(tr.hours) : null, cost_cents: tr.cost ? Math.round(Number(tr.cost) * 100) : null, paid_by: tr.paid }, L("Training recorded", "Latihan direkod")).then((ok) => { if (ok) setTr({ user: "", title: "", provider: "", on: "", hours: "", cost: "", paid: "company" }); }); }}>
              {L("Record training", "Rekod latihan")}
            </button>
          </div>
          <p className={css.hiddenNote}>{L("A course the company paid for is still claimed or paid through Claims or Finance, as today. This is the record of who learned what.",
            "Kursus yang dibayar syarikat masih dituntut atau dibayar melalui Tuntutan atau Kewangan, seperti biasa. Ini rekod siapa belajar apa.")}</p>
          {d.training.length === 0 ? <p className={css.empty}>{L("No training recorded yet.", "Belum ada latihan direkod.")}</p> : (
            <ul className={css.list} aria-label={L("Training", "Latihan")}>
              {d.training.map((t) => (
                <li key={t.id} className={css.item}>
                  <span className={css.when}>{dmy(t.on_date)}</span>
                  <span className={css.what}><span className={css.whatTitle}>{t.name} · {t.title}</span>
                    <span className={css.whatDetail}>{[t.provider, t.hours ? L(`${t.hours} h`, `${t.hours} j`) : null, t.paid_by ? L(`paid by ${t.paid_by}`, `dibayar oleh ${t.paid_by}`) : null].filter(Boolean).join(" · ")}</span></span>
                  {t.cost_cents != null && <span className={css.amount}>{fmtRM(t.cost_cents)}</span>}
                  <button type="button" className={rowBtn} disabled={busy} onClick={() => void send(`/staff/people/training/${t.id}/remove`, "POST", {}, L("Training removed", "Latihan dibuang"))}>{L("Remove", "Buang")}</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </TabZone>
  );
}

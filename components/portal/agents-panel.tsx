"use client";

/* v1.249.0 - THE AGENT DESK (claude/TASK-UPDATES-AGENT-AUDIT.md, the owner's
   answers and "approved", 01-11-2026). One tab, two views decided by the
   server's answer, never by the menu:

   - An AGENT: the active packages to promote (name, what is in it, the price,
     the issuing company), "Submit a client" with the package the client
     wants, and their own requests with what happened to each.
   - SALES & MARKETING: every agent's requests, read only.
   - MANAGEMENT (CEO, COO, CCO): the same list, and edits it - status, who
     follows it up, the quotation it became, a private note.

   Nothing here makes a quotation, a customer, a commission or a payroll row:
   a request is a lead, and the quotation is made in Sales. */

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { L } from "@/components/portal/page-shared";
import { fmtRM } from "@/lib/format";
import { useSaveToast } from "@/components/ui/save-toast";
import { SideDrawer } from "@/components/ui/side-drawer";
import { SkelCard, SkelRows } from "@/components/ui/skeleton";
import { LineTabs } from "@/components/ui/line-tabs";
import { btnClass, btnSm, btnSmPrimary, inputClass, inputClassSm, selectClassSm } from "@/lib/ui-styles";
import css from "./agents-panel.module.css";

interface Pkg { id: number; name: string; category: string | null; description: string | null; issuers: string[]; total_cents: number; lines: { name: string; qty: number }[] }
interface Req {
  id: number; agent_id: number; agent_name: string | null; client_name: string; client_phone: string | null; client_email: string | null; company: string | null;
  package_id: number | null; package_name: string | null; note: string | null; status: Status; assigned_to: number | null; assigned_name: string | null;
  quotation_id: number | null; quotation_number: string | null; manager_note: string | null; created_at: string; updated_at: string | null;
}
type Status = "new" | "contacted" | "quoted" | "won" | "lost";
const ISSUER: Record<string, string> = { a2z: "A2Z CREATIVE MARKETING", azoo: "AZ ONE OFFICIAL" };
const statusWord = (s: Status) => ({ new: L("New", "Baharu"), contacted: L("Contacted", "Dihubungi"), quoted: L("Quoted", "Sebut harga"), won: L("Won", "Berjaya"), lost: L("Lost", "Tidak berjaya") }[s]);
const tone = (s: Status) => (s === "won" ? css.ok : s === "lost" ? css.off : s === "new" ? css.info : css.wait);
const day = (v: string | null) => (v ? v.slice(0, 10).split("-").reverse().join("-") : "");

export function AgentsPanel({ role }: { role: string }) {
  const isAgent = role === "agent";
  const [view, setView] = useState<"packages" | "requests">(isAgent ? "packages" : "requests");
  const [pkgs, setPkgs] = useState<Pkg[] | null>(null);
  const [reqs, setReqs] = useState<{ requests: Req[]; can_manage: boolean; can_submit: boolean } | null>(null);
  const [failed, setFailed] = useState("");
  const [tick, setTick] = useState(0);
  const [submitFor, setSubmitFor] = useState<Pkg | null>(null);
  const [editing, setEditing] = useState<Req | null>(null);
  const [statusF, setStatusF] = useState<"" | Status>("");
  const [q, setQ] = useState("");
  const { show, node: toastNode } = useSaveToast();
  useEffect(() => {
    const c = new AbortController();
    void api<{ packages?: Pkg[]; error?: { message?: string } }>("/staff/agent/packages", { signal: c.signal }).then((r) => {
      if (c.signal.aborted) return;
      if (r.ok) setPkgs(r.data?.packages ?? []); else setFailed(r.data?.error?.message ?? L("The agent desk could not be loaded.", "Meja ejen tidak dapat dimuatkan."));
    });
    void api<{ requests: Req[]; can_manage: boolean; can_submit: boolean }>("/staff/agent/requests", { signal: c.signal }).then((r) => { if (!c.signal.aborted && r.ok && r.data) setReqs(r.data); });
    return () => c.abort();
  }, [tick]);

  const shown = useMemo(() => (reqs?.requests ?? []).filter((r) => (!statusF || r.status === statusF)
    && (!q || `${r.client_name} ${r.company ?? ""} ${r.agent_name ?? ""} ${r.package_name ?? ""}`.toLowerCase().includes(q.toLowerCase()))), [reqs, statusF, q]);

  if (failed) return <p className={css.warn} role="alert">{failed}</p>;
  const tabs: readonly (readonly ["packages" | "requests", string])[] = [
    ["packages", L("Packages to promote", "Pakej untuk dipromosi")],
    ["requests", isAgent ? L("My requests", "Permintaan saya") : L("Agents' requests", "Permintaan ejen")],
  ];
  return (
    <div className={css.wrap} data-testid="agents-panel">
      {toastNode}
      <header className={css.head}>
        <div>
          <h2 className={css.title}>{isAgent ? L("Agent desk", "Meja ejen") : L("Agents", "Ejen")}</h2>
          <p className={css.sub}>{isAgent
            ? L("Promote the active packages and send us the clients who want one. Our sales team follows up and you see what happens here.", "Promosikan pakej aktif dan hantar pelanggan yang berminat. Pasukan jualan kami akan menyusul dan anda boleh lihat perkembangannya di sini.")
            : L("Clients the agents bring in, with the package each wants. Sales follows them up; management edits them.", "Pelanggan yang dibawa ejen, dengan pakej yang diingini. Jualan menyusul; pengurusan menyunting.")}</p>
        </div>
      </header>
      <LineTabs value={view} onChange={setView} tabs={tabs} label={L("Agent desk", "Meja ejen")} />

      {view === "packages" && (
        !pkgs ? <SkelCard lines={4} /> : pkgs.length === 0 ? <p className={css.muted}>{L("No active packages yet.", "Belum ada pakej aktif.")}</p> : (
          <ul className={css.grid}>
            {pkgs.map((p) => (
              <li key={p.id} className={css.card} data-testid={`agent-pkg-${p.id}`}>
                <div className={css.cardHead}>
                  <span className={css.cat}>{p.category ?? L("Package", "Pakej")}</span>
                  <span className={css.price}>{fmtRM(p.total_cents)}</span>
                </div>
                <h3 className={css.pkgName}>{p.name}</h3>
                {p.description && <p className={css.desc}>{p.description}</p>}
                {p.lines.length > 0 && <ul className={css.lines}>{p.lines.slice(0, 6).map((l, i) => <li key={i}>{l.qty > 1 ? `${l.qty} × ` : ""}{l.name}</li>)}</ul>}
                <p className={css.muted}>{p.issuers.map((i) => ISSUER[i] ?? i).join(" · ")}</p>
                {isAgent && <button type="button" className={btnSmPrimary} onClick={() => setSubmitFor(p)}>{L("Submit a client", "Hantar pelanggan")}</button>}
              </li>
            ))}
          </ul>
        )
      )}

      {view === "requests" && (
        !reqs ? <SkelRows rows={5} /> : (
          <section className={css.panel} aria-label={L("Requests", "Permintaan")}>
            <div className={css.toolbar}>
              <input className={inputClassSm} value={q} onChange={(e) => setQ(e.target.value)} placeholder={L("Find a client, company or agent", "Cari pelanggan, syarikat atau ejen")} aria-label={L("Find", "Cari")} />
              <select className={selectClassSm} value={statusF} onChange={(e) => setStatusF(e.target.value as "" | Status)} aria-label={L("Status", "Status")}>
                <option value="">{L("All statuses", "Semua status")}</option>
                {(["new", "contacted", "quoted", "won", "lost"] as Status[]).map((s) => <option key={s} value={s}>{statusWord(s)}</option>)}
              </select>
              <span className={css.muted}>{L(`${shown.length} shown`, `${shown.length} dipaparkan`)}</span>
            </div>
            {shown.length === 0 ? <p className={css.muted}>{isAgent ? L("No requests yet - open Packages to promote and submit a client.", "Belum ada permintaan - buka Pakej dan hantar pelanggan.") : L("No requests match.", "Tiada permintaan sepadan.")}</p> : (
              <div className={css.tableWrap}>
                <table className={css.table}>
                  <thead><tr>
                    <th>{L("Client", "Pelanggan")}</th>
                    {!isAgent && <th>{L("Agent", "Ejen")}</th>}
                    <th>{L("Package", "Pakej")}</th>
                    <th>{L("Status", "Status")}</th>
                    <th>{L("Follow-up", "Susulan")}</th>
                    <th>{L("Submitted", "Dihantar")}</th>
                    {reqs.can_manage && <th aria-label={L("Actions", "Tindakan")} />}
                  </tr></thead>
                  <tbody>
                    {shown.map((r) => (
                      <tr key={r.id} data-testid={`agent-req-${r.id}`}>
                        <td data-label={L("Client", "Pelanggan")}><span className={css.strong}>{r.client_name}</span>{r.company && <span className={css.muted}>{r.company}</span>}<span className={css.muted}>{[r.client_phone, r.client_email].filter(Boolean).join(" · ")}</span></td>
                        {!isAgent && <td data-label={L("Agent", "Ejen")}>{r.agent_name ?? "—"}</td>}
                        <td data-label={L("Package", "Pakej")}>{r.package_name ?? "—"}</td>
                        <td data-label={L("Status", "Status")}><span className={`${css.chip} ${tone(r.status)}`}>{statusWord(r.status)}</span>{r.quotation_number && <span className={css.muted}>{r.quotation_number}</span>}</td>
                        <td data-label={L("Follow-up", "Susulan")}>{r.assigned_name ?? <span className={css.muted}>{L("Not yet", "Belum")}</span>}</td>
                        <td data-label={L("Submitted", "Dihantar")}>{day(r.created_at)}</td>
                        {reqs.can_manage && <td><button type="button" className={btnSm} onClick={() => setEditing(r)}>{L("Edit", "Sunting")}</button></td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )
      )}

      {submitFor && <SubmitSheet pkg={submitFor} onClose={() => setSubmitFor(null)} onDone={() => { setSubmitFor(null); setView("requests"); setTick((t) => t + 1); show(L("Sent to the sales team", "Dihantar kepada pasukan jualan")); }} />}
      {editing && <EditSheet req={editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); setTick((t) => t + 1); show(L("Saved", "Disimpan")); }} />}
    </div>
  );
}

function SubmitSheet({ pkg, onClose, onDone }: { pkg: Pkg; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ client_name: "", client_phone: "", client_email: "", company: "", note: "" });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const submit = async () => {
    setBusy(true); setProblem("");
    const r = await api<{ error?: { message?: string } }>("/staff/agent/requests", { method: "POST", body: JSON.stringify({ ...f, package_id: pkg.id }) });
    setBusy(false);
    if (!r.ok) { setProblem(r.data?.error?.message ?? L("Not sent - try again", "Tidak dihantar - cuba lagi")); return; }
    onDone();
  };
  return (
    <SideDrawer open onClose={onClose} title={L(`Submit a client: ${pkg.name}`, `Hantar pelanggan: ${pkg.name}`)}
      footer={<button type="button" className={btnClass} disabled={busy || f.client_name.trim().length < 2 || (!f.client_phone.trim() && !f.client_email.trim())} aria-busy={busy || undefined} onClick={() => void submit()}>{busy ? L("Sending…", "Menghantar…") : L("Send to Sales", "Hantar kepada Jualan")}</button>}>
      <div className={css.form}>
        <label className={css.field}><span>{L("Client name *", "Nama pelanggan *")}</span><input className={inputClass} value={f.client_name} onChange={(e) => setF({ ...f, client_name: e.target.value })} /></label>
        <label className={css.field}><span>{L("Phone", "Telefon")}</span><input className={inputClass} type="tel" value={f.client_phone} onChange={(e) => setF({ ...f, client_phone: e.target.value })} /></label>
        <label className={css.field}><span>{L("Email", "E-mel")}</span><input className={inputClass} type="email" value={f.client_email} onChange={(e) => setF({ ...f, client_email: e.target.value })} /></label>
        <label className={css.field}><span>{L("Company (optional)", "Syarikat (pilihan)")}</span><input className={inputClass} value={f.company} onChange={(e) => setF({ ...f, company: e.target.value })} /></label>
        <label className={css.field}><span>{L("Note for Sales (optional)", "Nota untuk Jualan (pilihan)")}</span><textarea className={inputClass} rows={3} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></label>
        <p className={css.muted}>{L("A phone or an email is needed so Sales can reach the client.", "Telefon atau e-mel diperlukan supaya Jualan boleh menghubungi pelanggan.")}</p>
        {problem && <p className={css.warn} role="alert">{problem}</p>}
      </div>
    </SideDrawer>
  );
}

function EditSheet({ req, onClose, onDone }: { req: Req; onClose: () => void; onDone: () => void }) {
  /* skeleton: none — the form is drawn in full from the request it was opened with; the staff list only fills the follow-up picker's options */
  const [f, setF] = useState({ status: req.status, assigned_to: req.assigned_to ?? 0, manager_note: req.manager_note ?? "" });
  const [team, setTeam] = useState<{ id: number; name: string; role?: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  useEffect(() => { void api<{ staff?: { id: number; name: string; role?: string }[] }>("/staff/staff-list").then((r) => setTeam((r.data?.staff ?? []).filter((u) => ["sales_marketing", "ceo", "coo", "cco"].includes(u.role ?? "")))); }, []);
  const save = async () => {
    setBusy(true); setProblem("");
    const r = await api<{ error?: { message?: string } }>(`/staff/agent/requests/${req.id}`, { method: "PATCH", body: JSON.stringify({ status: f.status, assigned_to: f.assigned_to || null, manager_note: f.manager_note }) });
    setBusy(false);
    if (!r.ok) { setProblem(r.data?.error?.message ?? L("Not saved", "Tidak disimpan")); return; }
    onDone();
  };
  return (
    <SideDrawer open onClose={onClose} title={L(`Request: ${req.client_name}`, `Permintaan: ${req.client_name}`)}
      footer={<button type="button" className={btnClass} disabled={busy} aria-busy={busy || undefined} onClick={() => void save()}>{busy ? L("Saving…", "Menyimpan…") : L("Save", "Simpan")}</button>}>
      <div className={css.form}>
        <p className={css.muted}>{L(`From ${req.agent_name ?? "an agent"} · ${req.package_name ?? ""} · ${day(req.created_at)}`, `Daripada ${req.agent_name ?? "ejen"} · ${req.package_name ?? ""} · ${day(req.created_at)}`)}</p>
        {req.note && <p className={css.note}>{req.note}</p>}
        <label className={css.field}><span>{L("Status", "Status")}</span>
          <select className={inputClass} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as Status })}>
            {(["new", "contacted", "quoted", "won", "lost"] as Status[]).map((s) => <option key={s} value={s}>{statusWord(s)}</option>)}
          </select>
        </label>
        <label className={css.field}><span>{L("Follow-up by", "Susulan oleh")}</span>
          <select className={inputClass} value={f.assigned_to} onChange={(e) => setF({ ...f, assigned_to: Number(e.target.value) })}>
            <option value={0}>{L("Nobody yet", "Belum ada")}</option>
            {team.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </label>
        <label className={css.field}><span>{L("Private note (Sales and management only)", "Nota peribadi (Jualan dan pengurusan sahaja)")}</span><textarea className={inputClass} rows={3} value={f.manager_note} onChange={(e) => setF({ ...f, manager_note: e.target.value })} /></label>
        {problem && <p className={css.warn} role="alert">{problem}</p>}
      </div>
    </SideDrawer>
  );
}

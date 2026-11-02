"use client";

/* v1.254.0 - ONE COMMENT THREAD AND ONE ACTIVITY LIST for a record's
   drawer. Lifted unchanged from the Leave drawer (v1.252.0, leave.tsx) so
   the Claim drawer reads the same component instead of a copy: the same
   markup, the same look (the Leave page's thread styles), the same
   employee / internal choice. Only the endpoint differs - the server of
   each module decides who reads and writes what. */

import { useEffect, useState } from "react";
import { L } from "@/components/portal/page-shared";
import { SkelRows } from "@/components/ui/skeleton";
import { AppIcon } from "@/components/ui/app-icon";
import { api } from "@/lib/api";
import { dmyMYT } from "@/lib/format";
import { properName } from "@/lib/names";
import { btnSm, chipSmNeutral, inputClass } from "@/lib/ui-styles";
import lv from "./leave-page.module.css";

type Comment = { id: number; visibility: string; body: string; created_at: string; author: string | null };

/** `base` is the record's API path under /staff, e.g. `/staff/leave/12`. */
export function RecordComments({ base, own, testId, ownPrompt, radioName }: {
  base: string; own: boolean; testId: string; ownPrompt: string; radioName: string;
}) {
  const [d, setD] = useState<{ comments: Comment[]; can_internal: boolean } | null>(null);
  const [tick, setTick] = useState(0);
  const [msg, setMsg] = useState("");
  const [vis, setVis] = useState<"employee" | "internal">("employee");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  useEffect(() => {
    let live = true;
    void api<{ comments: Comment[]; can_internal: boolean }>(`${base}/comments`).then((r) => { if (live) setD(r.ok && r.data ? r.data : { comments: [], can_internal: false }); });
    return () => { live = false; };
  }, [base, tick]);
  const send = async () => {
    setBusy(true); setProblem("");
    const r = await api<{ error?: { message?: string } }>(`${base}/comments`, { method: "POST", body: JSON.stringify({ body: msg.trim(), visibility: vis, client_key: `${radioName}-${Date.now()}` }) });
    setBusy(false);
    if (!r.ok) { setProblem(r.data?.error?.message ?? L("Not sent - try again", "Tidak dihantar - cuba lagi")); return; }
    setMsg(""); setTick((n) => n + 1);
  };
  return (
    <section className={lv.dSection} aria-label={L("Comments", "Komen")} data-testid={testId}>
      {!d ? <SkelRows rows={2} /> : d.comments.length === 0 ? <p className={lv.sub}>{L("No comments yet.", "Tiada komen lagi.")}</p> : (
        <ul className={lv.thread}>
          {d.comments.map((c) => (
            <li key={c.id} className={c.visibility === "internal" ? lv.threadInternal : ""}>
              <span className={lv.threadHead}><strong>{properName(c.author ?? "")}</strong><span>{dmyMYT(c.created_at)}</span>{c.visibility === "internal" && <span className={chipSmNeutral}>{L("Internal", "Dalaman")}</span>}</span>
              <span className={lv.threadBody}>{c.body}</span>
            </li>
          ))}
        </ul>
      )}
      <label className={lv.threadForm}>
        <span className={lv.sub}>{own ? ownPrompt : L("Add a comment", "Tambah komen")}</span>
        <textarea className={inputClass} rows={2} maxLength={1000} value={msg} onChange={(e) => setMsg(e.target.value)} aria-label={L("Comment", "Komen")} />
      </label>
      {d?.can_internal && (
        <div className={lv.visRow} role="radiogroup" aria-label={L("Who sees it", "Siapa melihatnya")}>
          <label><input type="radio" name={`vis-${radioName}`} checked={vis === "employee"} onChange={() => setVis("employee")} /> {L("Visible to the employee", "Dilihat oleh pekerja")}</label>
          <label><input type="radio" name={`vis-${radioName}`} checked={vis === "internal"} onChange={() => setVis("internal")} /> {L("Internal - management only", "Dalaman - pengurusan sahaja")}</label>
        </div>
      )}
      {problem && <p role="alert" className={lv.sub}>{problem}</p>}
      <div><button type="button" className={btnSm} disabled={busy || msg.trim().length < 2} onClick={() => void send()}><AppIcon name="chat" />{L("Post comment", "Hantar komen")}</button></div>
    </section>
  );
}

type Act = { id: number; action: string; created_at: string; who: string | null };
/** The audit trail of one record, as it happened - kept apart from comments. */
export function RecordActivity({ base, labels, testId, empty }: {
  base: string; labels: Record<string, [string, string]>; testId: string; empty: string;
}) {
  const [rows, setRows] = useState<Act[] | null>(null);
  useEffect(() => {
    let live = true;
    void api<{ activity: Act[] }>(`${base}/activity`).then((r) => { if (live) setRows(r.ok ? r.data?.activity ?? [] : []); });
    return () => { live = false; };
  }, [base]);
  return (
    <section className={lv.dSection} aria-label={L("Activity", "Aktiviti")} data-testid={testId}>
      {!rows ? <SkelRows rows={2} /> : rows.length === 0 ? <p className={lv.sub}>{empty}</p> : (
        <ul className={lv.thread}>
          {rows.map((a) => (
            <li key={a.id}><span className={lv.threadHead}><strong>{labels[a.action] ? L(labels[a.action]![0], labels[a.action]![1]) : a.action}</strong><span>{dmyMYT(a.created_at)}</span></span>
              {a.who && <span className={lv.threadBody}>{properName(a.who)}</span>}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

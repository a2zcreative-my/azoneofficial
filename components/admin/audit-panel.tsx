"use client";

/**
 * Audit-log viewer (v1.4.16). Reads the trail every consequential action
 * already writes — logins, leave approvals, role changes, password resets,
 * suspensions. After the backdoor incident, being able to SEE this history in
 * /admin is the point: nothing new is logged here, it's a window onto what was
 * always recorded.
 *
 * v1.327.0 (the CEO's Users & Security brief, 16-11-2026, the Audit History
 * picture): the connected figure strip, the Audit Event Register (search,
 * event type, actor, date range, pages) and, beside it, the chosen event in
 * full - read-only. Still the ONE route (GET /api/v1/audit, audit_read on the
 * server): the newest 300 events, or 300 of one event type, or one person's
 * trail. The level (Info / Success / Warning) is read from the action's own
 * words; nothing here writes, edits or deletes an entry.
 */

import { api } from "@/lib/api"; // v1.5.0: one shared helper (was a per-file copy)
import { downloadCsv } from "@/lib/csv";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getLang } from "@/lib/i18n";
import { AppIcon } from "@/components/ui/app-icon";
import { SkelRows } from "@/components/ui/skeleton";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { PillSwitch } from "@/components/ui/panel";
import { FilterField, FilterPopover } from "@/components/ui/filter-popover";
import { SplitPane, WorkspaceSplit } from "@/components/ui/workspace-split";
import { CompactTaskTable, type TableCol } from "@/components/portal/task-table";
import { type PageSize } from "@/components/ui/pagination-controls";
import { btnSm, chipSmInfo, chipSmSuccess, chipSmWarn, inputClassSm, selectClassSm } from "@/lib/ui-styles";
import css from "./audit-panel.module.css";
const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);

interface Entry {
  id: number;
  action: string;
  entity?: string;
  entity_id?: string;
  detail?: string | null;
  created_at: string;
  user_name?: string | null;
}

/* the event types: a prefix the server filters by (300 of that type) - the chips the viewer always had, and the picture's */
const KINDS = [
  ["", "All", "Semua"], ["auth.login", "Sign-ins", "Log masuk"], ["user", "User changes", "Perubahan pengguna"],
  ["permissions", "Role changes", "Perubahan peranan"], ["security", "Security", "Keselamatan"],
  ["leave", "Leave", "Cuti"], ["holiday", "Holidays", "Cuti umum"], ["task", "Tasks", "Tugasan"],
] as const;
type Kind = (typeof KINDS)[number][0];
type Level = "warn" | "success" | "info";
/** read from the action's own words - a refusal or a failure is a warning, a sign-in or a completed safeguard a success */
export const levelOf = (action: string): Level =>
  /(refus|reject|denied|fail|unavailable|abort|2fa_disabled|backup_used|force_logout|reset_all|unlink|suspend)/.test(action) ? "warn"
    : /(^auth\.login|_added$|_linked$|_accepted$|_executed$|2fa_enabled|_approved$)/.test(action) ? "success" : "info";
const LEVEL: Record<Level, [string, string, string]> = { warn: ["Warning", "Amaran", chipSmWarn], success: ["Success", "Berjaya", chipSmSuccess], info: ["Info", "Info", chipSmInfo] };

/** 16 Nov 11:57, Malaysia time */
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const myt = (iso: string) => {
  const d = new Date(new Date(iso.replace(" ", "T").replace(/Z?$/, "Z")).getTime() + 8 * 3600 * 1000);
  const i = d.toISOString();
  return { day: i.slice(0, 10), text: `${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${i.slice(11, 16)}`, full: `${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()} · ${i.slice(11, 16)} MYT` };
};
const SYSTEM = () => L("System", "Sistem");
const targetOf = (e: Entry) => !e.entity ? "—" : e.entity === "users" ? L(`Account #${e.entity_id ?? "?"}`, `Akaun #${e.entity_id ?? "?"}`) : `${e.entity.replace(/_/g, " ")}${e.entity_id ? ` #${e.entity_id}` : ""}`;
const titleOf = (action: string) => { const [mod, ...rest] = action.split("."); const w = rest.join(" ").replace(/_/g, " "); return `${(mod ?? "").charAt(0).toUpperCase()}${(mod ?? "").slice(1)}${w ? ` — ${w}` : ""}`; };
/* a detail field that could carry a secret is never drawn, whatever the entry holds */
const SECRET = /(token|secret|totp|password|hash|otp|code|key)$/i;
export const fieldsOf = (detail?: string | null): [string, string][] => {
  if (!detail) return [];
  try {
    const o = JSON.parse(detail) as unknown;
    if (!o || typeof o !== "object" || Array.isArray(o)) return [["detail", String(detail).slice(0, 300)]];
    return Object.entries(o as Record<string, unknown>).slice(0, 12).map(([k, v]) => [k.replace(/_/g, " "), SECRET.test(k) ? L("(hidden)", "(disembunyikan)") : v !== null && typeof v === "object" ? JSON.stringify(v).slice(0, 200) : String(v).slice(0, 200)]);
  } catch { return [["detail", String(detail).slice(0, 300)]]; }
};

/** v1.251.0 - `person`: one account's trail (Users > Audit History) */
export function AuditPanel({ person = null, personName = null, onClearPerson }: { person?: number | null; personName?: string | null; onClearPerson?: () => void } = {}) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loaded, setLoaded] = useState(false); // v1.77.0 — first fetch settled (ok or not)
  const [failed, setFailed] = useState(false);
  const [kind, setKind] = useState<Kind>("");
  const [q, setQ] = useState("");
  const [actor, setActor] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [flagged, setFlagged] = useState(false);
  const [sort, setSort] = useState<{ key: string; asc: boolean }>({ key: "date", asc: false });
  const [page, setPage] = useState(1);
  const [size, setSize] = useState<PageSize>(10);
  const [picked, setPicked] = useState<number | null>(null);

  const load = useCallback(async () => {
    const qs = new URLSearchParams({ limit: "300" });
    if (kind) qs.set("action", kind);
    if (person) qs.set("target", String(person));
    const res = await api<{ entries: Entry[] }>(`/audit?${qs.toString()}`);
    if (res.ok && res.data) { setEntries(res.data.entries ?? []); setFailed(false); } else setFailed(true);
    setLoaded(true);
  }, [kind, person]);
  useEffect(() => { void load(); }, [load]);

  const actors = useMemo(() => [...new Set(entries.map((e) => e.user_name || SYSTEM()))].sort(), [entries]);
  const needle = q.trim().toLowerCase();
  const rows = useMemo(() => entries.filter((e) => {
    const who = e.user_name || SYSTEM();
    const day = myt(e.created_at).day;
    return (!needle || [who, e.action, targetOf(e), e.detail ?? ""].some((x) => x.toLowerCase().includes(needle)))
      && (!actor || who === actor) && (!from || day >= from) && (!to || day <= to) && (!flagged || levelOf(e.action) === "warn");
  }).sort((a, b) => {
    const d = sort.asc ? 1 : -1;
    switch (sort.key) {
      case "actor": return d * (a.user_name || "~").localeCompare(b.user_name || "~");
      case "action": return d * a.action.localeCompare(b.action);
      case "target": return d * targetOf(a).localeCompare(targetOf(b));
      default: return d * (a.created_at.localeCompare(b.created_at) || a.id - b.id);
    }
  }), [entries, needle, actor, from, to, flagged, sort]);
  /* a filter starts the register again at its first page (set during render, not in an effect) */
  const fkey = `${needle}|${actor}|${from}|${to}|${flagged}|${kind}|${sort.key}|${sort.asc}`;
  const [seenKey, setSeenKey] = useState(fkey);
  if (fkey !== seenKey) { setSeenKey(fkey); setPage(1); }
  const shown = rows.find((e) => e.id === picked) ?? rows[0] ?? null;

  const figures = {
    users: entries.filter((e) => /^(user|staff|account|permissions)\./.test(e.action) || e.entity === "users").length,
    signin: entries.filter((e) => /^auth\.login/.test(e.action)).length,
    flagged: entries.filter((e) => levelOf(e.action) === "warn").length,
  };
  const scope = person ? L("This account's trail", "Jejak akaun ini") : kind ? L("Newest 300 of this type", "300 terbaru jenis ini") : L("The newest 300 recorded", "300 terbaru direkodkan");
  /* through lib/csv.ts: the BOM, CRLF and formula defusing every export shares */
  const exportCsv = () => downloadCsv(`audit-log-${new Date().toISOString().slice(0, 10)}.csv`, [
    ["When (MYT)", "Actor", "Event", "Target", "Level", "Detail"],
    ...rows.map((e) => [myt(e.created_at).full, e.user_name || "System", e.action, targetOf(e), LEVEL[levelOf(e.action)][0], fieldsOf(e.detail).map(([k, v]) => `${k}: ${v}`).join("; ")]),
  ]);

  const cols: TableCol<Entry>[] = [
    { key: "date", label: L("When (MYT)", "Bila (MYT)"), sort: "date", cell: (e) => <span className={css.when}>{myt(e.created_at).text}</span> },
    { key: "actor", label: L("Actor", "Pelaku"), sort: "actor", cell: (e) => <strong className={css.actor}>{e.user_name || SYSTEM()}</strong> },
    { key: "action", label: L("Event", "Peristiwa"), sort: "action", main: true, cell: (e) => <code className={css.code}>{e.action}</code> },
    { key: "target", label: L("Target", "Sasaran"), sort: "target", cell: (e) => <span className={css.target}>{targetOf(e)}</span> },
    { key: "level", label: L("Level", "Tahap"), cell: (e) => { const lv = LEVEL[levelOf(e.action)]; return <span className={lv[2]}>{L(lv[0], lv[1])}</span>; } },
  ];

  const detail = shown && (() => {
    const lv = LEVEL[levelOf(shown.action)];
    const f = fieldsOf(shown.detail);
    return (
      <div className={css.detail} data-testid="audit-detail" data-record={`audit:${shown.id}`}>
        <div className={css.detailHead}>
          <span className={css.well}><AppIcon name="document" /></span>
          <span className={css.detailTitle}><strong>{titleOf(shown.action)}</strong><small>{myt(shown.created_at).full}</small></span>
          <span className={lv[2]}>{L(lv[0], lv[1])}</span>
        </div>
        <dl className={css.facts}>
          <div><dt>{L("Actor", "Pelaku")}</dt><dd>{shown.user_name || SYSTEM()}</dd></div>
          <div><dt>{L("Action", "Tindakan")}</dt><dd><code className={css.code}>{shown.action}</code></dd></div>
          <div><dt>{L("Target", "Sasaran")}</dt><dd>{targetOf(shown)}</dd></div>
          <div><dt>{L("Entry", "Entri")}</dt><dd>#{shown.id}</dd></div>
        </dl>
        <div className={css.recorded}>
          <p className={css.label}>{L("What was recorded", "Apa yang direkodkan")}</p>
          {f.length === 0 ? <p className={css.muted}>{L("No further detail was recorded with this event.", "Tiada butiran lanjut direkodkan bersama peristiwa ini.")}</p> : (
            <dl className={css.fields} data-testid="audit-fields">{f.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
          )}
        </div>
        <p className={css.note}><AppIcon name="lock" />{L("Audit entries are append-only: nothing here edits or deletes them.", "Entri audit hanya ditambah: tiada apa di sini menyunting atau memadamnya.")}</p>
      </div>
    );
  })();

  return (
    <div className={css.page} data-testid="audit-history">
      <KpiRow label={L("Audit figures", "Angka audit")} testid="audit-strip">
        <KpiTile icon="document" tone="blue" label={L("Audit Events", "Peristiwa Audit")} value={entries.length} busy={!loaded} sub={scope}
          onClick={() => { setFlagged(false); setKind(""); }} pressed={!flagged && kind === ""} />
        <KpiTile icon="users" tone="gold" label={L("User Changes", "Perubahan Pengguna")} value={figures.users} busy={!loaded} sub={L("Accounts, roles and permissions", "Akaun, peranan dan kebenaran")}
          onClick={() => { setFlagged(false); setKind("user"); }} pressed={kind === "user"} />
        <KpiTile icon="lock" tone="green" label={L("Sign-in Events", "Peristiwa Log Masuk")} value={figures.signin} busy={!loaded} sub={L("Authentication history", "Sejarah pengesahan")}
          onClick={() => { setFlagged(false); setKind("auth.login"); }} pressed={kind === "auth.login"} />
        <KpiTile icon="warning" tone="red" label={L("Flagged Events", "Peristiwa Ditanda")} value={figures.flagged} busy={!loaded} sub={L("Refusals and failures - review", "Penolakan dan kegagalan - semak")}
          onClick={() => setFlagged((v) => !v)} pressed={flagged} />
      </KpiRow>
      <WorkspaceSplit testid="audit-split">
        <SplitPane testid="audit-register" title={L("Audit Event Register", "Daftar Peristiwa Audit")} label={L("Audit event register", "Daftar peristiwa audit")}
          sub={L("Search and review recorded system activity.", "Cari dan semak aktiviti sistem yang direkodkan.")}
          actions={<button type="button" className={btnSm} onClick={exportCsv} disabled={rows.length === 0} data-testid="audit-export"><AppIcon name="download" />{L("Export Log", "Eksport Log")}</button>}
          toolbar={<div className={css.tools}>
            {person && <span className={css.person}><span className={chipSmInfo} data-testid="audit-person">{L(`Showing ${personName ?? `#${person}`} only`, `Hanya ${personName ?? `#${person}`}`)}</span>
              {onClearPerson && <button type="button" className={btnSm} onClick={onClearPerson}>{L("Show everyone", "Papar semua")}</button>}</span>}
            <label className={css.search}><AppIcon name="search" /><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={L("Search actor, action, target", "Cari pelaku, tindakan, sasaran")} aria-label={L("Search the audit log", "Cari log audit")} data-testid="audit-search" /></label>
            <select className={selectClassSm} value={actor} onChange={(e) => setActor(e.target.value)} aria-label={L("Actor", "Pelaku")} data-testid="audit-actor">
              <option value="">{L("All actors", "Semua pelaku")}</option>
              {actors.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
            <FilterPopover testid="audit-dates" label={L("Date range", "Julat tarikh")} count={(from ? 1 : 0) + (to ? 1 : 0)} onClear={() => { setFrom(""); setTo(""); }}>
              <FilterField label={L("From", "Dari")}><input type="date" className={inputClassSm} value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} data-testid="audit-from" /></FilterField>
              <FilterField label={L("Until", "Hingga")}><input type="date" className={inputClassSm} value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} data-testid="audit-to" /></FilterField>
            </FilterPopover>
            <div className={css.kinds}><PillSwitch testid="audit-kind" label={L("Event type", "Jenis peristiwa")} value={kind} onChange={(k: Kind) => { setFlagged(false); setKind(k); }}
              options={KINDS.map(([k, en, ms]) => [k, L(en, ms)] as const)} /></div>
          </div>}>
          {failed ? <p className={css.muted} role="alert">{L("The audit log could not be read - the server refused or did not answer.", "Log audit tidak dapat dibaca - pelayan menolak atau tidak menjawab.")}</p> : (
            <CompactTaskTable rows={rows} cols={cols} label={L("Audit events", "Peristiwa audit")} loading={!loaded} record="audit" testid="audit-table"
              sort={sort.key} dir={sort.asc ? "asc" : "desc"} onSort={(k) => setSort((s) => (s.key === k ? { key: k, asc: !s.asc } : { key: k, asc: k !== "date" }))}
              onOpen={setPicked} picked={shown?.id ?? null} dense
              page={page} size={size} onPage={setPage} onSize={(n) => { setSize(n); setPage(1); }}
              empty={<p className={css.muted}>{L("No matching activity.", "Tiada aktiviti sepadan.")}</p>} />
          )}
        </SplitPane>
        <SplitPane testid="audit-selected" title={L("Selected Event Details", "Butiran Peristiwa Dipilih")} sub={L("Read-only investigation panel.", "Panel siasatan baca sahaja.")} label={L("Selected event", "Peristiwa dipilih")}>
          {!loaded ? <SkelRows rows={5} /> : detail ?? <p className={css.muted}>{L("Choose an event in the register to see it here.", "Pilih peristiwa dalam daftar untuk melihatnya di sini.")}</p>}
        </SplitPane>
      </WorkspaceSplit>
    </div>
  );
}

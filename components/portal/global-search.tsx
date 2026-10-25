"use client";

/* v1.205.0 - GLOBAL SEARCH, THE PAGE (the owner's brief and mockup,
   25-10-2026). The Ctrl K palette stays for a quick jump; Enter on its
   "See all results" line (or the same line pressed) opens this page over the
   tab you were on. Choosing any tab closes it (portal-provider.tsx).

   ONE SEARCH, NOT A NEW ONE. Every row is a hit from /staff/search - the
   endpoint the palette has used since v1.107.0, which reads each module's
   own table under the permission that module's own tab uses (and Leave and
   Claims by the very rule their lists use: leaveSeesAll, claimScope). This
   page groups those hits by module, counts them, filters and sorts them,
   and labels the status each record already carries. It stores nothing and
   writes nothing.

   EVERY ROW OPENS ITS RECORD: the module that owns it opens it in its own
   drawer or row (lib/record-focus.ts), exactly as pressing it there would.

   Not built from the mockup: its sample people, hotels, tasks, counts and
   dates; "relevance" (the search keeps the module's own order - there is no
   score to sort by); and an Enquiries module (retired in v1.183.0). */

import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { dmy, mytToday } from "@/lib/format";
import { t as tr } from "@/lib/i18n";
import type { TabName } from "@/lib/portal-tabs";
import { taskFigures } from "@/lib/task-figures";
import { AppIcon, type AppIconName } from "@/components/ui/app-icon";
import { Avatar } from "@/components/ui/avatar";
import { Skel } from "@/components/ui/skeleton";
import { chipDanger, chipGold, chipInfo, chipNeutral, chipSuccess, chipWarn, selectClassSm } from "@/lib/ui-styles";
import { L, leaveTypeL } from "@/components/portal/page-shared";
import { usePortal } from "@/components/portal/portal-provider";
import { NotificationsPanel } from "@/components/portal/notifications-panel";
import gs from "./global-search.module.css";

/** What /staff/search returns for one record (worker/src/search.ts Hit). */
export interface SearchHit {
  kind: string; id: number; title: string; sub: string; tab: string;
  status?: string | null; date?: string | null; dateIs?: "updated" | "created" | "applied" | "due"; photo?: string | null;
}

/* the modules, in the mockup's order; `source` is the worker's source name
   (the `only` filter), `open` the record kind the owning module opens */
export const KINDS: { kind: string; label: [string, string]; icon: AppIconName; source: string; open: string }[] = [
  { kind: "staff", label: ["Staff", "Kakitangan"], icon: "users", source: "staff", open: "staff" },
  { kind: "task", label: ["Tasks", "Tugasan"], icon: "orders", source: "task", open: "task" },
  { kind: "leave", label: ["Leave", "Cuti"], icon: "holiday", source: "leave", open: "leave" },
  { kind: "claim", label: ["Claims", "Tuntutan"], icon: "receipt", source: "claim", open: "claim" },
  { kind: "hotel", label: ["Hotels", "Hotel"], icon: "place", source: "hotel", open: "hotel" },
  { kind: "contact", label: ["Hotel contacts", "Kenalan hotel"], icon: "person", source: "contact", open: "hotel" },
  { kind: "client", label: ["Customers", "Pelanggan"], icon: "clients", source: "client", open: "client" },
  { kind: "invoice", label: ["Invoices", "Invois"], icon: "money", source: "invoice", open: "document" },
  { kind: "document", label: ["Quotations & DOs", "Sebut harga & DO"], icon: "documents", source: "document", open: "document" },
  { kind: "asset", label: ["Assets", "Aset"], icon: "package", source: "asset", open: "asset" },
  { kind: "stock", label: ["Inventory", "Inventori"], icon: "inventory", source: "stock", open: "stock" },
];
const META = Object.fromEntries(KINDS.map((k) => [k.kind, k]));

/* the hotel pipeline's words (hotels-panel.tsx STAGE_LABEL - held equal by
   tests/global-search.mjs) */
const HOTEL_STAGE: Record<string, [string, string]> = {
  lead: ["Not contacted", "Belum dihubungi"],
  contacted: ["Contacted", "Dihubungi"],
  agreed: ["Stay agreed", "Penginapan dipersetujui"],
  reviewed: ["Reviewed", "Telah diulas"],
  published: ["Published", "Diterbitkan"],
  declined: ["Declined", "Menolak"],
};
const HOTEL_TONE: Record<string, string> = { lead: chipNeutral, contacted: chipInfo, agreed: chipGold, reviewed: chipGold, published: chipSuccess, declined: chipDanger };
const cap = (s: string) => s.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

/** The status a record already carries, in its module's own words. */
export function statusOf(h: SearchHit, todayISO: string): [string, string] | null {
  const s = h.status ?? "";
  switch (h.kind) {
    case "staff": return s === "left" ? [L("Left", "Telah keluar"), chipNeutral] : [L("Active", "Aktif"), chipSuccess];
    case "task": {
      /* the Tasks page's own words and its overdue rule (lib/task-figures.ts) */
      if (s !== "completed" && taskFigures([{ status: s, deadline: h.date ?? null }], todayISO).overdueCount > 0) return [L("Overdue", "Tertunggak"), chipDanger];
      return s === "completed" ? [L("Closed", "Selesai"), chipSuccess] : s === "in_progress" ? [L("Pending", "Menunggu"), chipWarn] : [L("Open", "Terbuka"), chipInfo];
    }
    case "leave":
      return s === "approved" ? [L("Approved", "Diluluskan"), chipSuccess] : s === "rejected" ? [L("Rejected", "Ditolak"), chipDanger]
        : s === "cancelled" ? [L("Cancelled", "Dibatalkan"), chipNeutral] : [L("Pending", "Menunggu"), chipWarn];
    case "claim":
      return s === "paid" ? [L("Paid", "Dibayar"), chipSuccess] : s === "approved" ? [L("Approved", "Diluluskan"), chipSuccess]
        : s === "rejected" ? [L("Rejected", "Ditolak"), chipDanger] : [L("Pending", "Menunggu"), chipWarn];
    case "hotel": case "contact": {
      const k = s || "lead";
      const w = HOTEL_STAGE[k];
      return w ? [L(w[0], w[1]), HOTEL_TONE[k] ?? chipNeutral] : null;
    }
    case "invoice":
      return !s ? null : s === "paid" ? [L("Paid", "Dibayar"), chipSuccess] : s === "unpaid" ? [L("Unpaid", "Belum dibayar"), chipWarn] : [cap(s), chipInfo];
    case "document":
      return !s ? null : s === "delivered" ? [L("Delivered", "Dihantar"), chipSuccess] : [cap(s), chipInfo];
    case "stock":
      return s === "out" ? [L("Out of stock", "Habis stok"), chipDanger] : s === "low" ? [L("Low stock", "Stok rendah"), chipWarn] : [L("In stock", "Ada stok"), chipSuccess];
    case "asset":
      return !s ? null : s === "in_use" ? [L("In use", "Sedang digunakan"), chipInfo] : s === "spare" ? [L("Spare", "Simpanan"), chipNeutral]
        : s === "repair" ? [L("In repair", "Dalam pembaikan"), chipWarn] : s === "lost" ? [L("Lost", "Hilang"), chipDanger] : s === "disposed" ? [L("Disposed", "Dilupuskan"), chipNeutral] : [cap(s), chipNeutral];
    default: return null;
  }
}
/* leave and claims come back as their stored words (annual, travel): said
   the way their modules say them */
const titleOf = (h: SearchHit) => h.kind === "leave" ? L(`${cap(leaveTypeL(h.title))} leave`, `Cuti ${leaveTypeL(h.title)}`)
  : h.kind === "claim" ? L(`${cap(h.title)} claim`, `Tuntutan ${h.title}`) : h.title;
const DATE_WORD: Record<string, [string, string]> = { updated: ["Updated", "Dikemas kini"], created: ["Created", "Dibuat"], applied: ["Applied", "Dipohon"], due: ["Due", "Tarikh akhir"] };

type SortK = "found" | "newest" | "az";
const PER_ALL = 8;   // a group's first look, and what "View all" opens past
const PER_ONE = 25;  // one module chosen: the worker's ceiling

export function GlobalSearch() {
  const { searchQ, setSearchQ, openRecord, canOpen, tab, lang } = usePortal();
  const q = (searchQ ?? "").trim();
  const [draft, setDraft] = useState(searchQ ?? "");
  const [kindF, setKindF] = useState<string>("all");
  const [sortK, setSortK] = useState<SortK>("found");
  const inputRef = useRef<HTMLInputElement | null>(null);

  /* one request per (query, module); an answer for an older question is
     never shown for a newer one (the palette's rule, v1.107.0) */
  const only = kindF === "all" ? "" : META[kindF]?.source ?? "";
  const per = kindF === "all" ? PER_ALL : PER_ONE;
  const key = q.length >= 2 ? `${q}|${only}|${per}` : "";
  const [res, setRes] = useState<{ key: string; hits: SearchHit[]; sources: string[]; failed: boolean } | null>(null);
  const seq = useRef(0);
  useEffect(() => {
    if (!key) return;
    const mine = ++seq.current;
    void api<{ hits: SearchHit[]; sources?: string[] }>(`/staff/search?q=${encodeURIComponent(q)}&per=${per}${only ? `&only=${only}` : ""}`).then((r) => {
      if (seq.current !== mine) return;
      setRes({ key, hits: r.ok && r.data?.hits ? r.data.hits : [], sources: r.data?.sources ?? [], failed: !r.ok });
    });
  }, [key, q, per, only]);
  /* the "all" answer is kept for the chips' counts while one module is open */
  const [allRes, setAllRes] = useState<{ q: string; hits: SearchHit[]; sources: string[] } | null>(null);
  if (res && res.key === `${q}||${PER_ALL}` && allRes?.q !== q) setAllRes({ q, hits: res.hits, sources: res.sources });

  const loading = Boolean(key) && res?.key !== key;
  const hits = useMemo(() => (res?.key === key ? res.hits : []), [res, key]);
  const counts = useMemo(() => {
    const base = allRes?.q === q ? allRes.hits : hits;
    const c: Record<string, number> = {};
    for (const h of base) c[h.kind] = (c[h.kind] ?? 0) + 1;
    return c;
  }, [allRes, q, hits]);
  const sources = (allRes?.q === q ? allRes.sources : res?.sources) ?? [];
  const searchable = KINDS.filter((k) => sources.includes(k.source));
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const moduleCount = Object.keys(counts).length;
  const [today] = useState(() => mytToday());

  const byKind = useMemo(() => {
    const sorted = (list: SearchHit[]) => sortK === "az" ? [...list].sort((a, b) => titleOf(a).localeCompare(titleOf(b)))
      : sortK === "newest" ? [...list].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "")) : list;
    return KINDS.map((k) => ({ meta: k, list: sorted(hits.filter((h) => h.kind === k.kind)) })).filter((g) => g.list.length > 0);
  }, [hits, sortK]);

  const submit = () => { const v = draft.trim(); setKindF("all"); setSearchQ(v); };
  const open = (h: SearchHit) => {
    const m = META[h.kind];
    if (!m || !canOpen(h.tab)) return;
    openRecord(h.tab as TabName, m.open, h.id);
  };
  const plus = (n: number, cap: number) => (n >= cap ? `${n}+` : String(n));

  return (
    <div className={gs.page}>
      <div className={gs.main}>
        <div className={gs.top}>
          <button type="button" className={gs.back} onClick={() => setSearchQ(null)}>
            <AppIcon name="previous" />{L(`Back to ${tr(tab, lang)}`, `Kembali ke ${tr(tab, lang)}`)}
          </button>
          <form className={gs.bar} role="search" onSubmit={(e) => { e.preventDefault(); submit(); }}>
            <label className={gs.field}>
              <AppIcon name="search" />
              <input ref={inputRef} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={L("A name, a hotel, a phone number, a document number…", "Nama, hotel, nombor telefon, nombor dokumen…")}
                aria-label={L("Search everything", "Cari semua")} enterKeyHint="search" />
              {draft && <button type="button" className={gs.clear} onClick={() => { setDraft(""); inputRef.current?.focus(); }} aria-label={L("Clear the search", "Kosongkan carian")}><AppIcon name="error" /></button>}
            </label>
            <select className={selectClassSm} value={kindF} onChange={(e) => setKindF(e.target.value)} aria-label={L("Module", "Modul")}>
              <option value="all">{L("All modules", "Semua modul")}</option>
              {searchable.map((k) => <option key={k.kind} value={k.kind}>{L(k.label[0], k.label[1])}</option>)}
            </select>
            <button type="submit" className={gs.go}>{L("Search", "Cari")}</button>
          </form>
        </div>

        {q.length >= 2 && (
          <div className={gs.chips} role="group" aria-label={L("Show results from", "Tunjuk hasil daripada")}>
            <button type="button" aria-pressed={kindF === "all"} onClick={() => setKindF("all")}>{L("All results", "Semua hasil")} <span>{total}</span></button>
            {KINDS.filter((k) => counts[k.kind]).map((k) => (
              <button key={k.kind} type="button" aria-pressed={kindF === k.kind} onClick={() => setKindF(k.kind)}>
                {L(k.label[0], k.label[1])} <span>{plus(counts[k.kind] ?? 0, PER_ALL)}</span>
              </button>
            ))}
          </div>
        )}

        <div className={gs.summary}>
          <div>
            <h2 className={gs.h}>{q.length >= 2 ? L(`Search results for “${q}”`, `Hasil carian untuk “${q}”`) : L("Global search", "Carian global")}</h2>
            <p className={gs.sub}>
              {q.length < 2 ? L("Type at least two letters.", "Taip sekurang-kurangnya dua huruf.")
                : loading ? <Skel w={192} h={12} />
                : res?.failed ? L("The search did not reach the server — try again.", "Carian tidak sampai ke pelayan — cuba lagi.")
                : L(`Found ${total} result(s) across ${moduleCount} module(s) you can open.`, `${total} hasil dalam ${moduleCount} modul yang boleh anda buka.`)}
            </p>
          </div>
          {hits.length > 1 && (
            <select className={selectClassSm} value={sortK} onChange={(e) => setSortK(e.target.value as SortK)} aria-label={L("Order inside each module", "Susunan dalam setiap modul")}>
              <option value="found">{L("Order: as each module lists them", "Susunan: seperti senarai modul")}</option>
              <option value="newest">{L("Order: newest first", "Susunan: terbaru dahulu")}</option>
              <option value="az">{L("Order: name A–Z", "Susunan: nama A–Z")}</option>
            </select>
          )}
        </div>

        {/* a group in the shape of a result group until the answer lands */}
        {loading && (
          <div className={gs.group} aria-hidden>
            <div className={gs.groupHead}><Skel w={36} h={36} /><Skel w={128} h={16} /></div>
            {[0, 1, 2].map((i) => (
              <div key={i} className={gs.skelRow}><Skel w={40} h={40} /><span className={gs.skelText}><Skel w={208} h={14} /><Skel w={144} h={12} /></span><Skel w={64} h={20} round="full" /></div>
            ))}
          </div>
        )}

        {!loading && q.length >= 2 && !res?.failed && hits.length === 0 && (
          <div className={gs.group}>
            <p className={gs.empty}><AppIcon name="search" />{L(`Nothing found for “${q}”.`, `Tiada apa-apa untuk “${q}”.`)}</p>
            {searchable.length > 0 && (
              <p className={gs.note}>{L("Searched: ", "Dicari: ")}{searchable.map((k) => L(k.label[0], k.label[1])).join(", ")}{L(" — the modules your role may open.", " — modul yang boleh dibuka oleh peranan anda.")}</p>
            )}
          </div>
        )}

        {!loading && byKind.map(({ meta, list }) => {
          const n = counts[meta.kind] ?? list.length;
          return (
            <section key={meta.kind} className={gs.group} aria-label={L(meta.label[0], meta.label[1])}>
              <header className={gs.groupHead}>
                <span className={gs.well} aria-hidden><AppIcon name={meta.icon} /></span>
                <h3>{L(meta.label[0], meta.label[1])} <span>({kindF === "all" ? plus(n, PER_ALL) : plus(list.length, PER_ONE)})</span></h3>
                {kindF === "all" && n >= PER_ALL && (
                  <button type="button" className={gs.viewAll} onClick={() => setKindF(meta.kind)}>{L("View all", "Lihat semua")}<AppIcon name="next" /></button>
                )}
              </header>
              <ul className={gs.rows}>
                {list.map((h) => {
                  const st = statusOf(h, today);
                  const may = canOpen(h.tab);
                  const inner = (
                    <>
                      {h.kind === "staff"
                        ? <Avatar name={h.title} photoKey={h.photo} size="md" />
                        : <span className={gs.rowIcon} aria-hidden><AppIcon name={meta.icon} /></span>}
                      <span className={gs.rowText}>
                        <strong>{titleOf(h)}</strong>
                        <span>{h.sub.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, "$3-$2-$1")}</span>
                      </span>
                      <span className={gs.rowStatus}>{st && <span className={st[1]}>{st[0]}</span>}</span>
                      <span className={gs.rowMeta}>
                        <span>{tr(h.tab, lang)}</span>
                        {h.date && <span>{L(DATE_WORD[h.dateIs ?? "updated"]![0], DATE_WORD[h.dateIs ?? "updated"]![1])} {dmy(h.date)}</span>}
                      </span>
                      {may && <AppIcon name="next" className={gs.chev} />}
                    </>
                  );
                  return (
                    <li key={`${h.kind}-${h.id}-${h.title}`}>
                      {may
                        ? <button type="button" className={gs.row} onClick={() => open(h)} title={L("Open the record", "Buka rekod")}>{inner}</button>
                        : <div className={gs.row}>{inner}</div>}
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
      <aside className={gs.railWrap}>
        <NotificationsPanel variant="rail" />
      </aside>
    </div>
  );
}

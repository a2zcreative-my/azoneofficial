"use client";

/**
 * THE HOTEL DIRECTORY — v1.100.0.
 *
 * CEO, 05-09-2026, with 1. DATA HOTEL.xlsx: *"add new tabs for save all this
 * data list, make sure that it is being listed by State ... make the
 * infographic map for me to easier clickable and also professional with nice
 * futuristic. Also make sure that I can a function to edit or to delete it."*
 *
 * THE MAP IS THE REAL ONE. v1.100.0 drew a grid of rounded tiles, reasoning
 * that an outline makes Perlis a speck and Sarawak a third of the picture.
 * The CEO, 05-09-2026, with a screenshot of the Operations map beside it:
 * *"why Hotel mapped doesnt looks like this?!!!!"* — and he was right. The
 * portal has had real Malaysian geography since v1.20.1, in
 * lib/malaysia-map.ts, drawn by the Operations map and the ELFIA Traffic map.
 * Inventing a third, worse map in the same product was the mistake; this card
 * is now the third consumer of the same geometry, drawn in the same visual
 * language (gold choropleth, navy count bubble, two insets, dashed divider),
 * so the three maps in this portal look like one product.
 *
 * The tiles' one real advantage is kept: a state too small to hit — Kuala
 * Lumpur is 104 hotels on a shape a few pixels wide, Putrajaya is a point —
 * is reached by its BUBBLE, which is a button here rather than decoration.
 *
 * EVERYTHING IS THE PORTAL'S OWN STYLE. card, inputClass, rowBtn,
 * rowBtnDanger, btnSmPrimary from lib/ui-styles and components/ui — the CEO
 * asked for edit and delete "based on globally css or style", so there is not
 * one bespoke button in this file. The shades on the map are the theme's
 * primary at five steps, so it follows a re-brand and reads in both
 * themes.
 *
 * WHO SEES IT: CEO, COO, CCO, hr_admin, admin, super_admin — hotels_view in
 * the worker, TAB_ROLES.Hotels on the client. The list is 442 hotels with
 * named people and their mobile numbers, so seeing it and changing it are
 * the same tier.
 *
 * v1.110.0 (roadmap phase 05) — THE DIRECTORY BECOMES A PIPELINE; v1.111.0
 * — IN THE RIGHT LANGUAGE. The roadmap read these 442 hotels as a sales list
 * and v1.110.0 built quoted / won / invoices / revenue on the map. The CEO,
 * 05-09-2026, the same hour: Hotels is a separate venture - the review-content
 * business, hotel and Airbnb stays reviewed and published, in the manner of a
 * food reviewer - not the operating company. So each row now says where the
 * hotel stands ON THE WAY TO A PUBLISHED REVIEW: not contacted, contacted,
 * stay agreed, reviewed, published, declined; when it was last spoken to;
 * when the next call is due; and, once published, where the review lives.
 * The chips above the list turn 442 rows into a worklist: "Not contacted" is
 * who to ask, "Due" is who to ask again. An open hotel shows its call log and
 * a form to log the call you just made - QUEUEABLE, so it is kept on the
 * phone in a lobby with no signal and sent later at the time it was pressed.
 * The map's second colouring is reviews published per state. No money in
 * here, and the Watchers do not look in here. worker/src/hotel-pipeline.ts
 * is the other half.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { makeApi } from "@/lib/api";
import { useSaveToast } from "@/components/ui/save-toast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Skel, StaleHint } from "@/components/ui/skeleton";
import { rowBtn, rowBtnDanger } from "@/components/ui/row-button";
import { card, inputClass, inputClassSm, fieldLabel, btnSmPrimary, btnSm } from "@/lib/ui-styles";
import { downloadCsv, csvStampMyt } from "@/lib/csv";
import { useCachedApi } from "@/lib/cached-api";
import { getLang } from "@/lib/i18n";
/* v1.100.3 — one country, one geometry: the same module the Operations map
   and the ELFIA Traffic map draw from. Its names are Title Case; the hotel
   list keeps the workbook's upper case, and `stateKey` is the one place the
   two meet. */
import { STATES } from "@/lib/malaysia-map";

const api = makeApi("/staff/hotels");
const staffApi = makeApi("/staff");
const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);

interface Contact {
  id?: number; person_name: string | null; phone: string | null; phone2: string | null; email: string | null;
}
interface Hotel {
  id: number; state: string; hotel_name: string; company: string | null; address: string | null;
  rooms: number | null; stars: string | null; mof_validity: string | null; halal_validity: string | null;
  notes: string | null; updated_at?: string; contacts: Contact[];
  /* v1.110.0 - the pipeline facts; absent until migration 0116 is on the database */
  stage?: string; last_contact_at?: string | null; next_at?: string | null; owner_id?: number | null; review_url?: string | null;
}
interface StatePipeline { contacted: number; agreed: number; published: number }
interface ListData {
  hotels: Hotel[]; states: string[]; by_state: Record<string, number>; state_pipeline?: Record<string, StatePipeline>;
  can_manage?: boolean; pending_migration?: boolean;
}

/* ---- the pipeline vocabulary, one place, both languages. The worker's
   STAGES and OUTCOMES in the same order; tests/hotel-pipeline.mjs holds
   the two together. ---- */
const STAGE_LABEL: Record<string, [string, string]> = {
  lead: ["Not contacted", "Belum dihubungi"],
  contacted: ["Contacted", "Dihubungi"],
  agreed: ["Stay agreed", "Penginapan dipersetujui"],
  reviewed: ["Reviewed", "Telah diulas"],
  published: ["Published", "Diterbitkan"],
  declined: ["Declined", "Menolak"],
};
/* the colour says the stage before the word does; semantic, not the accent */
const STAGE_CLASS: Record<string, string> = {
  lead: "bg-secondary text-muted-foreground",
  contacted: "bg-primary/10 text-primary",
  agreed: "bg-gold/15 text-gold",
  reviewed: "bg-gold/15 text-gold",
  published: "bg-success-soft text-success",
  declined: "bg-destructive/10 text-destructive",
};
const OUTCOME_LABEL: Record<string, [string, string]> = {
  spoke: ["Spoke to them", "Bercakap dengan mereka"],
  no_answer: ["No answer", "Tiada jawapan"],
  callback: ["Asked to call back", "Minta panggil semula"],
  declined: ["They declined", "Mereka menolak"],
  agreed: ["A stay is agreed", "Penginapan dipersetujui"],
  stayed: ["We stayed and reviewed", "Kami menginap dan mengulas"],
  published: ["The review is published", "Ulasan diterbitkan"],
};
const OUTCOMES = Object.keys(OUTCOME_LABEL);
/* the chips above the list: "" is every hotel, "due" is the worklist, the rest are stages */
const FILTERS: { key: string; en: string; ms: string }[] = [
  { key: "", en: "All", ms: "Semua" },
  { key: "lead", en: "Not contacted", ms: "Belum dihubungi" },
  { key: "due", en: "Due for a call", ms: "Perlu dipanggil" },
  { key: "contacted", en: "Contacted", ms: "Dihubungi" },
  { key: "agreed", en: "Stay agreed", ms: "Dipersetujui" },
  { key: "reviewed", en: "Reviewed", ms: "Diulas" },
  { key: "published", en: "Published", ms: "Diterbitkan" },
  { key: "declined", en: "Declined", ms: "Menolak" },
];
const stageLabel = (s: string | undefined) => { const p = STAGE_LABEL[s ?? "lead"] ?? STAGE_LABEL.lead!; return L(p[0], p[1]); };
const outcomeLabel = (o: string) => { const p = OUTCOME_LABEL[o]; return p ? L(p[0], p[1]) : o; };

/** Today in Malaysia as YYYY-MM-DD - a follow-up is overdue against this, not UTC. */
const todayMyt = (): string => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
/** "2026-09-12" → "12-09-2026" - the house date order. */
const dmy = (iso: string): string => { const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}-${m[2]}-${m[1]}` : iso; };
/** SQLite "YYYY-MM-DD HH:MM:SS" (UTC) → "today", "3d ago", "2mo ago". */
function ago(sqlite: string): string {
  const t = new Date(sqlite.replace(" ", "T") + "Z").getTime();
  if (Number.isNaN(t)) return "";
  const d = Math.floor((Date.now() - t) / 86_400_000);
  if (d <= 0) return L("today", "hari ini");
  if (d < 30) return L(`${d}d ago`, `${d}h lalu`);
  return L(`${Math.floor(d / 30)}mo ago`, `${Math.floor(d / 30)}b lalu`);
}
/** The geometry names a state "Kuala Lumpur"; the workbook named it
    "KUALA LUMPUR". One function decides they are the same place. */
const stateKey = (geometryName: string): string => geometryName.toUpperCase();

/* The geometry is the COUNTRY: sixteen units, Labuan among them. The workbook
   is the SALES TERRITORY: fifteen sheets, no Labuan sheet. So the map draws
   all sixteen shapes - Labuan simply shades as empty, which is true - while
   the "which state" picker offers only names the server will accept, because
   an option that is refused on save is a bug with a shrug for an error
   message. The server sends its own list (the migration's CHECK, one
   vocabulary); this is what the picker shows before that arrives.
   tests/hotels-guard.mjs holds the two lists together. */
const NOT_A_WORKBOOK_STATE = new Set(["LABUAN"]);
const PICKABLE = STATES.map((sh) => stateKey(sh.name)).filter((s) => !NOT_A_WORKBOOK_STATE.has(s)).sort();

/* ======================================================================
   THE PIPELINE ON ONE HOTEL — v1.110.0. Module scope (house rule #30): a
   component defined inside HotelsPanel would remount on every keystroke in
   the search box and lose the half-typed call note.
   ====================================================================== */
interface CallRow { id: number; contact_id: number | null; called_at: string; outcome: string; notes: string | null; next_at: string | null; by_name: string | null; contact_name: string | null }
interface PipeData { hotel: { stage: string; review_url: string | null }; calls: CallRow[] }
type Toast = (title: string, sub?: string, variant?: "success" | "notice") => void;

function HotelPipeline({ hotel, canManage, toast, onChanged }: { hotel: Hotel; canManage: boolean; toast: Toast; onChanged: () => Promise<void> }) {
  const view = useCachedApi<PipeData>(`/staff/hotels/${hotel.id}/pipeline`, true, ["hotels"]);
  const [outcome, setOutcome] = useState<string>("spoke");
  const [contactId, setContactId] = useState<string>(hotel.contacts[0]?.id ? String(hotel.contacts[0].id) : "");
  const [notes, setNotes] = useState("");
  const [nextAt, setNextAt] = useState("");
  const [reviewUrl, setReviewUrl] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const data = view.data;
  const changed = async () => { view.refresh(); await onChanged(); };

  /* ---- log a call: QUEUEABLE, so it may come back "queued" with no signal ---- */
  const logCall = async () => {
    if (outcome === "published" && reviewUrl.trim() && !/^https?:\/\//i.test(reviewUrl.trim())) {
      toast(L("Not logged", "Tidak direkodkan"), L("The review link must start with http:// or https://", "Pautan ulasan mesti bermula dengan http:// atau https://"), "notice");
      return;
    }
    setBusy("call");
    const body = {
      outcome, contact_id: contactId ? Number(contactId) : null, notes: notes.trim() || null, next_at: nextAt || null,
      review_url: outcome === "published" && reviewUrl.trim() ? reviewUrl.trim() : null,
    };
    const r = await staffApi<{ ok?: boolean; stage?: string; error?: { message?: string } }>(`/hotels/${hotel.id}/calls`, { method: "POST", body: JSON.stringify(body) });
    setBusy(null);
    if (r.queued) {
      toast(L("Kept — no signal", "Disimpan — tiada isyarat"),
        L(`Your call note for ${hotel.hotel_name} is on this phone and will be sent when you are back online.`, `Nota panggilan anda untuk ${hotel.hotel_name} ada pada telefon ini dan akan dihantar apabila anda kembali dalam talian.`));
      setNotes(""); setNextAt(""); setReviewUrl("");
      return;
    }
    if (r.ok) {
      toast(L("Call logged", "Panggilan direkodkan"),
        `${hotel.hotel_name} — ${outcomeLabel(outcome)}${r.data?.stage ? ` · ${L("now", "kini")} ${stageLabel(r.data.stage)}` : ""}${nextAt ? ` · ${L("call back", "panggil semula")} ${dmy(nextAt)}` : ""}`);
      setNotes(""); setNextAt(""); setReviewUrl("");
      await changed();
    } else {
      toast(L("Not logged", "Tidak direkodkan"), r.data?.error?.message ?? L("The server refused that", "Pelayan menolaknya"), "notice");
    }
  };

  /* ---- the stage by hand: declined, or a correction ---- */
  const setStage = async (stage: string) => {
    setBusy("stage");
    const r = await staffApi<{ ok?: boolean; error?: { message?: string } }>(`/hotels/${hotel.id}/stage`, { method: "PUT", body: JSON.stringify({ stage }) });
    setBusy(null);
    if (r.ok) { toast(L("Stage set", "Peringkat ditetapkan"), `${hotel.hotel_name} — ${stageLabel(stage)}`); await changed(); }
    else toast(L("Not changed", "Tidak diubah"), r.data?.error?.message ?? L("The server refused that", "Pelayan menolaknya"), "notice");
  };

  if (view.loading) {
    return <div className="border-border/70 mt-3 space-y-2 border-t pt-3" aria-busy="true"><Skel className="h-3 w-40" /><Skel className="h-8 rounded-lg" /><Skel className="h-3 w-56" /></div>;
  }
  if (view.failed && !data) {
    return (
      <p className="text-warning mt-3 text-[11px]">
        {L("The pipeline is not on this database yet — run the deploy so migrations 0116 and 0117 apply.", "Saluran belum ada pada pangkalan data ini — jalankan deploy supaya migrasi 0116 dan 0117 digunakan.")}
      </p>
    );
  }
  const calls = data?.calls ?? [];
  const stage = data?.hotel.stage ?? hotel.stage ?? "lead";
  const published = data?.hotel.review_url ?? hotel.review_url ?? null;

  return (
    <div className="border-border/70 mt-3 border-t pt-3">
      {/* ---- where it stands, and the review if it is out ---- */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full px-2 py-px text-[11px] font-medium ${STAGE_CLASS[stage] ?? STAGE_CLASS.lead}`}>{stageLabel(stage)}</span>
          {canManage && (
            <select className={`${inputClassSm} w-auto`} value={stage} disabled={busy === "stage"} aria-label={L("Set the stage by hand", "Tetapkan peringkat secara manual")}
              onChange={(e) => { if (e.target.value !== stage) void setStage(e.target.value); }}>
              {Object.keys(STAGE_LABEL).map((s) => <option key={s} value={s}>{stageLabel(s)}</option>)}
            </select>
          )}
        </span>
        {published && (
          <a className="text-primary truncate text-[11px] underline" href={published} target="_blank" rel="noopener noreferrer">
            {L("Read the review", "Baca ulasan")} ↗
          </a>
        )}
      </div>

      {/* ---- log the call you just made ---- */}
      {canManage && (
        <div className="bg-secondary/60 mt-3 rounded-lg p-2.5">
          <p className="mb-1.5 text-[10px] font-semibold tracking-wider uppercase">{L("Log a call", "Rekod panggilan")}</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <label>
              <span className={fieldLabel}>{L("How did it go", "Bagaimana hasilnya")}</span>
              <select className={inputClassSm} value={outcome} onChange={(e) => setOutcome(e.target.value)}>
                {OUTCOMES.map((o) => <option key={o} value={o}>{outcomeLabel(o)}</option>)}
              </select>
            </label>
            <label>
              <span className={fieldLabel}>{L("Who you spoke to", "Siapa yang anda hubungi")}</span>
              <select className={inputClassSm} value={contactId} onChange={(e) => setContactId(e.target.value)}>
                <option value="">{L("(not recorded)", "(tidak direkodkan)")}</option>
                {hotel.contacts.filter((c) => c.id).map((c) => <option key={c.id} value={String(c.id)}>{c.person_name || c.phone || `#${c.id}`}</option>)}
              </select>
            </label>
            <label>
              <span className={fieldLabel}>{L("Call back on", "Panggil semula pada")}</span>
              <input type="date" className={inputClassSm} value={nextAt} min={todayMyt()} onChange={(e) => setNextAt(e.target.value)} />
            </label>
          </div>
          {outcome === "published" && (
            <label className="mt-2 block">
              <span className={fieldLabel}>{L("Where the review lives", "Di mana ulasan itu")}</span>
              <input type="url" className={`${inputClassSm} w-full`} value={reviewUrl} placeholder="https://" inputMode="url"
                onChange={(e) => setReviewUrl(e.target.value)} />
            </label>
          )}
          <textarea className={`${inputClassSm} mt-2 w-full`} rows={2} maxLength={1000} value={notes}
            placeholder={L("What was said, what they offered, what you promised", "Apa yang dikatakan, apa yang mereka tawarkan, apa yang anda janjikan")}
            aria-label={L("Call notes", "Nota panggilan")} onChange={(e) => setNotes(e.target.value)} />
          <div className="mt-2 flex items-center gap-2">
            <button type="button" className={btnSmPrimary} disabled={busy === "call"} onClick={() => void logCall()}>
              {busy === "call" ? <Skel className="inline-block h-3 w-12" /> : L("Log call", "Rekod panggilan")}
            </button>
            <span className="text-muted-foreground text-[11px]">{L("Kept on this phone if there is no signal.", "Disimpan pada telefon ini jika tiada isyarat.")}</span>
          </div>
        </div>
      )}

      {/* ---- the call log ---- */}
      <p className="text-muted-foreground mt-3 text-[10px] font-semibold tracking-wider uppercase">
        {calls.length ? L(`Calls (${calls.length})`, `Panggilan (${calls.length})`) : L("Calls", "Panggilan")}
      </p>
      {calls.length === 0 ? (
        <p className="text-muted-foreground mt-1 text-[11px]">{L("Nobody has logged a call to this hotel yet.", "Belum ada siapa merekod panggilan ke hotel ini.")}</p>
      ) : (
        <ul className="divide-border/60 mt-1 divide-y">
          {calls.slice(0, 20).map((c) => (
            <li key={c.id} className="py-1.5">
              <div className="flex flex-wrap items-baseline gap-x-2 text-[11px]">
                <span className="font-medium">{outcomeLabel(c.outcome)}</span>
                {c.contact_name && <span className="text-muted-foreground">{L("with", "dengan")} {c.contact_name}</span>}
                <span className="text-muted-foreground">{c.by_name ?? ""} · {dmy(c.called_at)} · {ago(c.called_at)}</span>
                {c.next_at && <span className="text-muted-foreground">{L("call back", "panggil semula")} {dmy(c.next_at)}</span>}
              </div>
              {c.notes && <p className="mt-0.5 whitespace-pre-wrap text-xs">{c.notes}</p>}
            </li>
          ))}
          {calls.length > 20 && <li className="text-muted-foreground pt-1.5 text-[11px]">{L(`and ${calls.length - 20} earlier`, `dan ${calls.length - 20} lebih awal`)}</li>}
        </ul>
      )}
    </div>
  );
}

const emptyHotel = (): Hotel => ({
  id: 0, state: "KUALA LUMPUR", hotel_name: "", company: "", address: "",
  rooms: null, stars: "", mof_validity: "", halal_validity: "", notes: "",
  contacts: [{ person_name: "", phone: "", phone2: "", email: "" }],
});

export function HotelsPanel() {
  const { show: toast, node: toastNode } = useSaveToast();
  const { confirm, node: confirmNode } = useConfirm();

  const [state, setState] = useState<string>("");     // "" = every state
  const [qLive, setQLive] = useState("");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<number | null>(null);
  const [draft, setDraft] = useState<Hotel | null>(null);
  const [saving, setSaving] = useState(false);
  /* v1.110.0 - the worklist chip ("" all, "due", or a stage) and the map's colouring */
  const [filter, setFilter] = useState<string>("");
  const [mapMode, setMapMode] = useState<"hotels" | "published">("hotels");

  /* Typing waits for the pause — the list is 442 hotels and their people. */
  useEffect(() => {
    const t = window.setTimeout(() => setQ(qLive.trim()), 300);
    return () => window.clearTimeout(t);
  }, [qLive]);

  /* v1.104.0 (roadmap phase 02) - remembered, then refreshed. The view you
     had last time paints at once from the device; the fetch runs behind it
     and swaps the figures in. Every (state, search) pair is its own entry,
     so pressing Johor and then Selangor and then Johor again shows Johor
     instantly the second time. A write on any hotel bumps the "hotels" topic
     and the open view refetches by itself, so nobody works from a list a
     colleague changed a minute ago. */
  const filterQs = filter === "due" ? "&due=1" : filter ? `&stage=${filter}` : "";
  const view = useCachedApi<ListData>(
    `/staff/hotels?${state ? `state=${encodeURIComponent(state)}&` : ""}${q ? `q=${encodeURIComponent(q)}` : ""}${filterQs}`,
    true, ["hotels"],
  );
  const hotels = useMemo(() => view.data?.hotels ?? [], [view.data]);
  const states = useMemo(() => view.data?.states ?? [], [view.data]);
  const byState = useMemo(() => view.data?.by_state ?? {}, [view.data]);
  const statePipe = useMemo(() => view.data?.state_pipeline ?? {}, [view.data]);
  const canManage = Boolean(view.data?.can_manage);
  const pending = Boolean(view.data?.pending_migration);
  /* the pipeline columns exist once 0116 has run; before that the rows have no stage */
  const pipelineOn = hotels.length === 0 || hotels[0]?.stage !== undefined;
  const loaded = !view.loading;
  const refresh = view.refresh;
  const load = useCallback(async () => { refresh(); }, [refresh]);

  const total = useMemo(() => Object.values(byState).reduce((a, b) => a + b, 0), [byState]);
  const maxState = useMemo(() => Math.max(1, ...Object.values(byState)), [byState]);
  const totalPublished = useMemo(() => Object.values(statePipe).reduce((a, b) => a + b.published, 0), [statePipe]);
  const maxPublished = useMemo(() => Math.max(1, ...Object.values(statePipe).map((m) => m.published)), [statePipe]);
  const byPublished = mapMode === "published";
  const today = todayMyt();

  const save = async () => {
    if (!draft) return;
    if (!draft.hotel_name.trim()) {
      toast(L("Not saved", "Tidak disimpan"), L("The hotel needs a name", "Hotel perlukan nama"), "notice");
      return;
    }
    setSaving(true);
    const payload = {
      ...draft,
      rooms: draft.rooms === null || String(draft.rooms) === "" ? null : Number(draft.rooms),
      contacts: draft.contacts,
    };
    const r = draft.id
      ? await api<{ ok: boolean; error?: { message?: string } }>(`/${draft.id}`, { method: "PUT", body: JSON.stringify(payload) })
      : await api<{ ok: boolean; error?: { message?: string } }>(``, { method: "POST", body: JSON.stringify(payload) });
    setSaving(false);
    if (r.ok) {
      toast(L("Saved", "Disimpan"), `${draft.hotel_name} — ${draft.state}`);
      setDraft(null);
      await load();
    } else {
      toast(L("Not saved", "Tidak disimpan"), r.data?.error?.message ?? L("The server refused that", "Pelayan menolaknya"), "notice");
    }
  };

  const remove = async (h: Hotel) => {
    const ok = await confirm({
      title: L(`Remove ${h.hotel_name}?`, `Buang ${h.hotel_name}?`),
      message: L("It leaves the list with its contacts. Nothing is destroyed — the record is kept and the removal is recorded against your name, so it can be restored.",
                 "Ia keluar dari senarai bersama kenalannya. Tiada apa dimusnahkan — rekod disimpan dan pembuangan direkodkan atas nama anda, jadi ia boleh dipulihkan."),
      confirmLabel: L("Remove", "Buang"),
      variant: "danger",
    });
    if (!ok) return;
    const r = await api<{ ok: boolean; error?: { message?: string } }>(`/${h.id}`, { method: "DELETE" });
    if (r.ok) { toast(L("Removed", "Dibuang"), h.hotel_name); await load(); }
    else toast(L("Not removed", "Tidak dibuang"), r.data?.error?.message ?? "", "notice");
  };

  const exportCsv = () => {
    downloadCsv(`hotels${state ? `-${state.toLowerCase().replace(/\W+/g, "-")}` : ""}`, [
      [`# ${L("Hotel directory", "Direktori hotel")}${state ? ` — ${state}` : ""}`],
      [`# ${L("Generated", "Dijana")} ${csvStampMyt()} — ${hotels.length} ${L("hotels", "hotel")}`],
      [],
      [L("State", "Negeri"), L("Hotel", "Hotel"), L("Company", "Syarikat"), L("Address", "Alamat"),
       L("Rooms", "Bilik"), L("Stars", "Bintang"), L("MOF valid", "MOF sah"), L("Halal valid", "Halal sah"),
       L("Contact", "Kenalan"), L("Phone", "Telefon"), L("Phone 2", "Telefon 2"), L("Email", "E-mel")],
      ...hotels.flatMap((h) => (h.contacts.length ? h.contacts : [{ person_name: "", phone: "", phone2: "", email: "" } as Contact]).map((c) => [
        h.state, h.hotel_name, h.company ?? "", h.address ?? "", h.rooms ?? "", h.stars ?? "",
        h.mof_validity ?? "", h.halal_validity ?? "",
        c.person_name ?? "", c.phone ?? "", c.phone2 ?? "", c.email ?? "",
      ])),
    ]);
  };

  const patchContact = (i: number, k: keyof Contact, v: string) =>
    setDraft((d) => d && ({ ...d, contacts: d.contacts.map((c, x) => (x === i ? { ...c, [k]: v } : c)) }));

  return (
    <div className="grid grid-cols-1 gap-4">
      {toastNode}
      {confirmNode}
      {/* ================= THE MAP ================= */}
      <div className={card}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-sm font-semibold">{byPublished ? L("Reviews published by state", "Ulasan diterbitkan mengikut negeri") : L("Hotels by state", "Hotel mengikut negeri")}</p>
            <p className="text-muted-foreground mt-0.5 text-xs">
              {byPublished
                ? L("Press a state to see its hotels. The shade is how many reviews are published there.",
                    "Tekan sesebuah negeri untuk melihat hotelnya. Warna menunjukkan berapa ulasan diterbitkan di sana.")
                : L("Press a state to see its hotels. The shade is how many are in it.",
                    "Tekan sesebuah negeri untuk melihat hotelnya. Warna menunjukkan bilangannya.")}
            </p>
          </div>
          <span className="flex flex-wrap items-center gap-1.5">
            {/* v1.111.0 - the second colouring: where the published reviews are, not where the hotels are */}
            {pipelineOn && (
              <span role="radiogroup" aria-label={L("Colour the map by", "Warnakan peta mengikut")} className="bg-secondary flex rounded-full p-0.5 text-[11px]">
                {(["hotels", "published"] as const).map((m) => (
                  <button key={m} type="button" role="radio" aria-checked={mapMode === m} onClick={() => setMapMode(m)}
                    className={`rounded-full px-2.5 py-0.5 font-medium transition-colors ${mapMode === m ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"}`}>
                    {m === "hotels" ? L("Hotels", "Hotel") : L("Published", "Diterbitkan")}
                  </button>
                ))}
              </span>
            )}
            <span className="bg-secondary text-muted-foreground rounded-full px-2.5 py-1 text-[11px] font-medium">
              {byPublished ? `${totalPublished} ${L("published", "diterbitkan")}` : `${total} ${L("hotels", "hotel")} · ${states.length} ${L("states", "negeri")}`}
            </span>
            {state && (
              <button type="button" className={rowBtn} onClick={() => setState("")}>
                {L("All states", "Semua negeri")}
              </button>
            )}
          </span>
        </div>

        {pending && (
          <p className="text-warning mt-3 text-xs">
            {L("The hotel tables are not on this database yet — run the deploy so migrations 0111 and 0112 apply.",
               "Jadual hotel belum ada pada pangkalan data ini — jalankan deploy supaya migrasi 0111 dan 0112 digunakan.")}
          </p>
        )}

        {/* the cartogram: a glass panel with a slow sweep behind it */}
        {/* v1.100.3 — the real map, drawn exactly as the Operations map draws
            it: gold fill whose weight is the count, a navy bubble carrying the
            number, the two standard insets and the dashed divider between
            them. A state with no hotels is left in the neutral fill rather
            than shaded, because nothing is not a small something. */}
        <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1fr)_240px]">
          {!loaded ? (
            <Skel className="aspect-[860/380] w-full rounded-xl" />
          ) : (
            <svg viewBox="0 0 860 380" className="w-full"
              aria-label={L("Map of Malaysia — each state is a button showing how many hotels are in it",
                            "Peta Malaysia — setiap negeri ialah butang yang menunjukkan bilangan hotelnya")}>
              <text x="14" y="16" style={{ font: "600 11px sans-serif", letterSpacing: "0.08em" }} fill="var(--muted-foreground)">
                {L("PENINSULAR MALAYSIA", "SEMENANJUNG MALAYSIA")}
              </text>
              <text x="340" y="46" style={{ font: "600 11px sans-serif", letterSpacing: "0.08em" }} fill="var(--muted-foreground)">
                SABAH &amp; SARAWAK
              </text>
              <line x1="320" y1="24" x2="320" y2="364" stroke="var(--border)" strokeWidth="1" strokeDasharray="3 5" />
              {/* the selected state is drawn last so its stroke sits above its neighbours */}
              {(state ? [...STATES.filter((x) => stateKey(x.name) !== state), ...STATES.filter((x) => stateKey(x.name) === state)] : STATES).map((sh) => {
                const key = stateKey(sh.name);
                const n = byState[key] ?? 0;
                const pub = statePipe[key]?.published ?? 0;
                /* by published the weight is how many reviews are out in the
                   state; a state with hotels but none yet is the neutral fill */
                const w = byPublished ? pub / maxPublished : n / maxState;
                const has = byPublished ? pub > 0 : n > 0;
                const isSel = state === key;
                const label = byPublished
                  ? `${sh.name}: ${pub} ${L("published", "diterbitkan")} · ${n} ${L("hotels", "hotel")}`
                  : `${sh.name}: ${n} ${n === 1 ? L("hotel", "hotel") : L("hotels", "hotel")}`;
                return (
                  <path key={sh.name} d={sh.d}
                    role="button" tabIndex={0} aria-pressed={isSel}
                    aria-label={label}
                    onClick={() => setState(isSel ? "" : key)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setState(isSel ? "" : key); } }}
                    className="cursor-pointer outline-none transition-opacity hover:opacity-75 focus-visible:opacity-75"
                    fill={has ? "var(--gold-solid)" : "var(--secondary)"}
                    fillOpacity={has ? 0.3 + 0.55 * w : 1}
                    stroke={isSel ? "var(--primary)" : "var(--border)"}
                    strokeWidth={isSel ? 2.5 : 1}
                    strokeLinejoin="round">
                    <title>{label}</title>
                  </path>
                );
              })}
              {/* The bubbles are BUTTONS, not decoration: Kuala Lumpur holds
                  104 hotels on a shape a few pixels across and Putrajaya is a
                  single point, so on the Operations map those two are
                  effectively unreachable. Here the number you can read is the
                  thing you press. */}
              {STATES.map((sh) => {
                const key = stateKey(sh.name);
                const n = byState[key] ?? 0;
                const pub = statePipe[key]?.published ?? 0;
                if (!n) return null;
                if (byPublished && !pub) return null;
                const r = byPublished ? 9 + Math.sqrt(pub / maxPublished) * 9 : 9 + Math.sqrt(n / maxState) * 9;
                const isSel = state === key;
                const label = byPublished
                  ? `${sh.name}: ${pub} ${L("published", "diterbitkan")}`
                  : `${sh.name}: ${n} ${n === 1 ? L("hotel", "hotel") : L("hotels", "hotel")}`;
                return (
                  <g key={`b-${sh.name}`} role="button" tabIndex={0} aria-pressed={isSel}
                    aria-label={label}
                    onClick={() => setState(isSel ? "" : key)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setState(isSel ? "" : key); } }}
                    className="cursor-pointer outline-none">
                    <circle cx={sh.cx} cy={sh.cy} r={r}
                      fill="var(--brand-primary)" stroke={isSel ? "var(--primary)" : "var(--gold-solid)"}
                      strokeWidth={isSel ? 2.5 : 1.5} opacity="0.92" />
                    <text x={sh.cx} y={sh.cy + 3.5} textAnchor="middle" style={{ font: "700 10px sans-serif", fill: "#fff" }}>
                      {byPublished ? pub : n}
                    </text>
                    <title>{label}</title>
                  </g>
                );
              })}
            </svg>
          )}

          {/* the side panel: the whole country, or the state you pressed */}
          <div className="border-border rounded-xl border p-3">
            {!loaded ? (
              <div className="space-y-2">
                <Skel className="h-4 w-32" />
                <Skel className="h-12 rounded-lg" />
                <Skel className="h-3 w-full" /><Skel className="h-3 w-full" /><Skel className="h-3 w-full" />
              </div>
            ) : (
              <>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold">{state || L("Malaysia — all states", "Malaysia — semua negeri")}</p>
                    <p className="text-muted-foreground text-[11px]">
                      {state
                        ? `${Math.round(((byState[state] ?? 0) / Math.max(1, total)) * 100)}% ${L("of the directory", "daripada direktori")}`
                        : L("Press a state on the map for its hotels.", "Tekan sesebuah negeri pada peta untuk hotelnya.")}
                    </p>
                  </div>
                  {state && <button type="button" className={btnSm} onClick={() => setState("")}>{L("All states", "Semua negeri")}</button>}
                </div>
                <div className="bg-secondary mt-2.5 rounded-lg px-2.5 py-2">
                  <p className="text-muted-foreground text-[10px] font-semibold tracking-wider uppercase">{byPublished ? L("Published", "Diterbitkan") : L("Hotels", "Hotel")}</p>
                  <p className="text-lg font-bold tabular-nums">
                    {byPublished ? (state ? (statePipe[state]?.published ?? 0) : totalPublished) : (state ? (byState[state] ?? 0) : total)}
                  </p>
                  {pipelineOn && (() => {
                    /* the pipeline in one line: asked, stays agreed, reviews out */
                    const sp = state ? statePipe[state] : null;
                    const sum = (k: keyof StatePipeline) => (sp ? sp[k] : Object.values(statePipe).reduce((a, b) => a + b[k], 0));
                    const n = state ? (byState[state] ?? 0) : total;
                    return (
                      <p className="text-muted-foreground mt-0.5 text-[11px] tabular-nums">
                        {L(`${sum("contacted")} of ${n} contacted · ${sum("agreed")} stays agreed · ${sum("published")} published`,
                           `${sum("contacted")} daripada ${n} dihubungi · ${sum("agreed")} penginapan dipersetujui · ${sum("published")} diterbitkan`)}
                      </p>
                    );
                  })()}
                </div>
                <p className="text-muted-foreground mt-3 text-[10px] font-semibold tracking-wider uppercase">
                  {byPublished ? L("Most reviews published", "Ulasan terbanyak diterbitkan") : L("Most hotels", "Hotel terbanyak")}
                </p>
                <ul className="mt-1.5 space-y-1">
                  {(byPublished
                    ? Object.entries(statePipe).map(([st, m]) => [st, m.published] as [string, number]).filter(([, v]) => v > 0)
                    : Object.entries(byState)
                  ).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([st, n]) => (
                    <li key={st}>
                      <button type="button" onClick={() => setState(state === st ? "" : st)}
                        className={`flex w-full items-center justify-between gap-2 text-xs ${state === st ? "font-semibold" : ""}`}>
                        <span className="truncate">{st}</span>
                        <span className="tabular-nums">{n}</span>
                      </button>
                    </li>
                  ))}
                  {byPublished && totalPublished === 0 && (
                    <li className="text-muted-foreground text-[11px]">{L("No review is published yet. Log a call with \"The review is published\" and its link on the hotel.", "Belum ada ulasan diterbitkan. Rekod panggilan dengan \"Ulasan diterbitkan\" dan pautannya pada hotel.")}</li>
                  )}
                </ul>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ================= THE LIST ================= */}
      <div className={card}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold">
            {state || L("Every state", "Semua negeri")}
            <span className="text-muted-foreground ml-2 text-xs font-normal">
              {loaded ? `${hotels.length} ${L("shown", "dipaparkan")}${hotels.length > 12 ? L(" — scroll the list", " — tatal senarai") : ""}` : ""}
            </span>
            <StaleHint show={view.stale} className="ml-2" />
          </p>
          <span className="flex flex-wrap items-center gap-1.5">
            <input className={`${inputClassSm} w-44`} value={qLive} placeholder={L("Find hotel, company or person", "Cari hotel, syarikat atau orang")}
              aria-label={L("Search the directory", "Cari direktori")} onChange={(e) => setQLive(e.target.value)} />
            {qLive && (
              <button type="button" className="text-muted-foreground text-xs underline" onClick={() => setQLive("")}>
                {L("Clear", "Kosongkan")}
              </button>
            )}
            <button type="button" className={rowBtn} onClick={exportCsv} disabled={!loaded || hotels.length === 0}>
              {L("Export CSV", "Eksport CSV")}
            </button>
            {canManage && (
              <button type="button" className={btnSmPrimary} onClick={() => { setDraft({ ...emptyHotel(), state: state || "KUALA LUMPUR" }); setOpen(null); }}>
                {L("+ Add hotel", "+ Tambah hotel")}
              </button>
            )}
          </span>
        </div>

        {/* ---- v1.110.0: the worklist chips. "Never contacted" is who to ring;
            "Due" is who to ring back - a follow-up date that has passed, or a
            worked hotel quiet for ninety days. The server does the filtering
            (?stage=, ?due=1), so each chip is its own remembered view. ---- */}
        {pipelineOn && (
          <div className="mt-3 flex flex-wrap gap-1.5" role="tablist" aria-label={L("Show hotels that are", "Tunjuk hotel yang")}>
            {FILTERS.map((f) => (
              <button key={f.key} type="button" role="tab" aria-selected={filter === f.key} onClick={() => setFilter(f.key)}
                className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${filter === f.key ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground hover:text-foreground"}`}>
                {L(f.en, f.ms)}
              </button>
            ))}
          </div>
        )}

        {/* ---- the editor: one form, create and edit alike ---- */}
        {draft && (
          <div className="border-border bg-secondary/30 mt-3 rounded-xl border p-3">
            <p className="mb-2 text-xs font-semibold">
              {draft.id ? L("Edit hotel", "Sunting hotel") : L("New hotel", "Hotel baharu")}
            </p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <label className="sm:col-span-1">
                <span className={fieldLabel}>{L("State", "Negeri")}</span>
                <select className={inputClass} value={draft.state} onChange={(e) => setDraft({ ...draft, state: e.target.value })}>
                  {(states.length ? states : PICKABLE).map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
              <label className="sm:col-span-2">
                <span className={fieldLabel}>{L("Name of hotel", "Nama hotel")}</span>
                <input className={inputClass} value={draft.hotel_name} maxLength={160}
                  onChange={(e) => setDraft({ ...draft, hotel_name: e.target.value })} />
              </label>
              <label className="sm:col-span-2">
                <span className={fieldLabel}>{L("Name of company", "Nama syarikat")}</span>
                <input className={inputClass} value={draft.company ?? ""} maxLength={160}
                  onChange={(e) => setDraft({ ...draft, company: e.target.value })} />
              </label>
              <label>
                <span className={fieldLabel}>{L("Rooms", "Bilik")}</span>
                <input className={inputClass} type="number" min={0} value={draft.rooms ?? ""}
                  onChange={(e) => setDraft({ ...draft, rooms: e.target.value === "" ? null : Number(e.target.value) })} />
              </label>
              <label className="sm:col-span-3">
                <span className={fieldLabel}>{L("Address", "Alamat")}</span>
                <input className={inputClass} value={draft.address ?? ""} maxLength={300}
                  onChange={(e) => setDraft({ ...draft, address: e.target.value })} />
              </label>
              <label>
                <span className={fieldLabel}>{L("Star rating", "Penarafan bintang")}</span>
                <input className={inputClass} value={draft.stars ?? ""} maxLength={20} placeholder="****"
                  onChange={(e) => setDraft({ ...draft, stars: e.target.value })} />
              </label>
              <label>
                <span className={fieldLabel}>{L("MOF valid until", "MOF sah hingga")}</span>
                <input className={inputClass} value={draft.mof_validity ?? ""} maxLength={40} placeholder="31.12.2027"
                  onChange={(e) => setDraft({ ...draft, mof_validity: e.target.value })} />
              </label>
              <label>
                <span className={fieldLabel}>{L("Halal valid until", "Halal sah hingga")}</span>
                <input className={inputClass} value={draft.halal_validity ?? ""} maxLength={40} placeholder="31.12.2027"
                  onChange={(e) => setDraft({ ...draft, halal_validity: e.target.value })} />
              </label>
            </div>

            <p className="mt-3 mb-1 text-xs font-semibold">{L("Contact people", "Orang untuk dihubungi")}</p>
            {draft.contacts.map((c, i) => (
              <div key={i} className="mb-2 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_1fr_1.2fr_auto]">
                <input className={inputClassSm} placeholder={L("Name", "Nama")} value={c.person_name ?? ""}
                  aria-label={L("Contact name", "Nama kenalan")} onChange={(e) => patchContact(i, "person_name", e.target.value)} />
                <input className={inputClassSm} placeholder="012-345 6789" value={c.phone ?? ""}
                  aria-label={L("Phone", "Telefon")} onChange={(e) => patchContact(i, "phone", e.target.value)} />
                <input className={inputClassSm} placeholder="03-1234 5678" value={c.phone2 ?? ""}
                  aria-label={L("Second phone", "Telefon kedua")} onChange={(e) => patchContact(i, "phone2", e.target.value)} />
                <input className={inputClassSm} placeholder="name@hotel.com" value={c.email ?? ""}
                  aria-label={L("Email", "E-mel")} onChange={(e) => patchContact(i, "email", e.target.value)} />
                <button type="button" className={rowBtnDanger}
                  onClick={() => setDraft({ ...draft, contacts: draft.contacts.filter((_, x) => x !== i) })}>
                  ✕
                </button>
              </div>
            ))}
            <div className="flex flex-wrap items-center gap-2">
              {draft.contacts.length < 6 && (
                <button type="button" className={rowBtn}
                  onClick={() => setDraft({ ...draft, contacts: [...draft.contacts, { person_name: "", phone: "", phone2: "", email: "" }] })}>
                  {L("+ Add contact", "+ Tambah kenalan")}
                </button>
              )}
              <span className="text-muted-foreground text-[11px]">
                {L("Phone numbers are rewritten in Malaysian form when saved — 012-345 6789, 03-1234 5678.",
                   "Nombor telefon ditulis semula dalam bentuk Malaysia apabila disimpan — 012-345 6789, 03-1234 5678.")}
              </span>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" className={btnSmPrimary} disabled={saving} onClick={() => void save()}>
                {saving ? <Skel className="inline-block h-3 w-12" /> : L("Save", "Simpan")}
              </button>
              <button type="button" className={btnSm} onClick={() => setDraft(null)}>{L("Cancel", "Batal")}</button>
            </div>
          </div>
        )}

        {/* ---- the rows ---- */}
        {!loaded ? (
          <div className="mt-3 space-y-2">{Array.from({ length: 6 }, (_, i) => <Skel key={i} className="h-12" />)}</div>
        ) : hotels.length === 0 ? (
          <p className="text-muted-foreground mt-3 text-xs">
            {q ? L("Nothing matches that.", "Tiada yang sepadan.")
               : filter === "due" ? L("Nobody is due a call. Every follow-up date is ahead and no worked hotel has gone quiet.", "Tiada siapa perlu dipanggil. Semua tarikh susulan masih ke hadapan dan tiada hotel yang senyap.")
               : filter ? L(`No hotel is at "${stageLabel(filter)}"${state ? ` in ${state}` : ""}.`, `Tiada hotel pada "${stageLabel(filter)}"${state ? ` di ${state}` : ""}.`)
               : L("No hotels in this state yet.", "Belum ada hotel di negeri ini.")}
          </p>
        ) : (
          /* v1.101.1 - CEO, 05-09-2026: *"Every state 442 shown show the list
             too long, should scrollable at least."* And he is right: 442 rows
             is a page fourteen screens deep whose Export CSV button, search
             box and map are all off the top of it by the time you are reading
             Johor.

             So the LIST scrolls in its own box, not the page. This is not the
             two-scrollbar mistake v1.99.4 undid on the staff circle - that was
             a 30rem box around a 34rem PICTURE, where the scroller cut a whole
             thing in half for no gain. A directory is a list you page through
             by nature: the toolbar above stays put, the map stays put, and
             flicking the rows never loses your place on the page. The height
             is capped against the VIEWPORT so it fills a big monitor and does
             not swallow a laptop. */
          <ul className="divide-border mt-3 divide-y overflow-y-auto overscroll-contain pr-1"
            style={{ maxHeight: "min(38rem, calc(100svh - 20rem))" }}>
            {hotels.map((h) => (
              <li key={h.id} className="py-2">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <button type="button" className="min-w-0 flex-1 text-left" aria-expanded={open === h.id}
                    onClick={() => setOpen(open === h.id ? null : h.id)}>
                    <span className="flex flex-wrap items-baseline gap-x-2">
                      <span className="text-sm font-medium">{h.hotel_name}</span>
                      <span className="bg-secondary text-muted-foreground rounded-full px-2 py-px text-[10px]">{h.state}</span>
                      {h.stars && <span className="text-gold text-[11px]">{h.stars}</span>}
                      {h.rooms ? <span className="text-muted-foreground text-[11px]">{h.rooms} {L("rooms", "bilik")}</span> : null}
                    </span>
                    <span className="text-muted-foreground mt-0.5 block truncate text-xs">
                      {h.company || L("(no company named)", "(syarikat tidak dinyatakan)")}
                      {h.contacts.length ? ` · ${h.contacts.length} ${h.contacts.length === 1 ? L("contact", "kenalan") : L("contacts", "kenalan")}` : ` · ${L("no contact", "tiada kenalan")}`}
                    </span>
                    {/* v1.110.0 - the pipeline facts on the row: stage, last spoken to, next call, the review */}
                    {h.stage !== undefined && (
                      <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
                        <span className={`rounded-full px-2 py-px font-medium ${STAGE_CLASS[h.stage] ?? STAGE_CLASS.lead}`}>{stageLabel(h.stage)}</span>
                        {h.last_contact_at && <span className="text-muted-foreground">{L("spoke", "bercakap")} {ago(h.last_contact_at)}</span>}
                        {h.next_at && (
                          <span className={h.next_at <= today ? "text-warning font-medium" : "text-muted-foreground"}>
                            {h.next_at <= today ? L("call back due", "panggil semula perlu") : L("call back", "panggil semula")} {dmy(h.next_at)}
                          </span>
                        )}
                        {h.review_url && <span className="text-success">{L("review out", "ulasan keluar")} ↗</span>}
                      </span>
                    )}
                  </button>
                  {canManage && (
                    <span className="flex shrink-0 flex-wrap gap-1.5">
                      <button type="button" className={rowBtn} onClick={() => { setDraft({ ...h, contacts: h.contacts.length ? h.contacts.map((c) => ({ ...c })) : [{ person_name: "", phone: "", phone2: "", email: "" }] }); setOpen(h.id); }}>
                        {L("Edit", "Sunting")}
                      </button>
                      <button type="button" className={rowBtnDanger} onClick={() => void remove(h)}>
                        {L("Delete", "Padam")}
                      </button>
                    </span>
                  )}
                </div>
                {open === h.id && (
                  <div className="bg-secondary/40 mt-2 rounded-lg p-3 text-xs">
                    {h.address && <p className="text-muted-foreground mb-2">{h.address}</p>}
                    {(h.mof_validity || h.halal_validity) && (
                      <p className="text-muted-foreground mb-2">
                        {h.mof_validity ? `${L("MOF until", "MOF hingga")} ${h.mof_validity}` : ""}
                        {h.mof_validity && h.halal_validity ? " · " : ""}
                        {h.halal_validity ? `${L("Halal until", "Halal hingga")} ${h.halal_validity}` : ""}
                      </p>
                    )}
                    {h.contacts.length === 0 ? (
                      <p className="text-muted-foreground">{L("No contact person recorded.", "Tiada orang untuk dihubungi direkodkan.")}</p>
                    ) : (
                      <ul className="space-y-1.5">
                        {h.contacts.map((c, i) => (
                          <li key={c.id ?? i} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                            <span className="font-medium">{c.person_name || L("(name not given)", "(nama tiada)")}</span>
                            {c.phone && <a className="text-primary underline" href={`tel:+60${c.phone.replace(/\D/g, "").replace(/^0/, "")}`}>{c.phone}</a>}
                            {c.phone2 && <a className="text-primary underline" href={`tel:+60${c.phone2.replace(/\D/g, "").replace(/^0/, "")}`}>{c.phone2}</a>}
                            {c.email && <a className="text-primary underline" href={`mailto:${c.email}`}>{c.email}</a>}
                          </li>
                        ))}
                      </ul>
                    )}
                    {h.notes && <p className="text-muted-foreground mt-2 whitespace-pre-wrap">{h.notes}</p>}
                    {h.stage !== undefined && (
                      <HotelPipeline hotel={h} canManage={canManage} toast={toast} onChanged={load} />
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

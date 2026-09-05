"use client";

/**
 * THE HOTEL DIRECTORY — v1.100.0.
 *
 * CEO, 05-09-2026, with 1. DATA HOTEL.xlsx: *"add new tabs for save all this
 * data list, make sure that it is being listed by State ... make the
 * infographic map for me to easier clickable and also professional with nice
 * futuristic. Also make sure that I can a function to edit or to delete it."*
 *
 * THE MAP IS A TILE CARTOGRAM, NOT A TRACING. Every state is one rounded
 * tile, laid out in the country's rough geography — Perlis and Kedah at the
 * top left, Johor at the foot of the peninsula, Sarawak and Sabah out to the
 * east. That is a deliberate choice over an outline of Malaysia: an outline
 * makes Perlis a speck nobody can hit and Sarawak a third of the picture,
 * which is the opposite of what a list of 442 hotels needs. A tile is the
 * same size for every state, always legible, always clickable, and it can
 * carry its own count and a shade for how many hotels are in it — which is
 * what makes this an infographic rather than a decoration.
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
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { makeApi } from "@/lib/api";
import { useSaveToast } from "@/components/ui/save-toast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Skel } from "@/components/ui/skeleton";
import { rowBtn, rowBtnDanger } from "@/components/ui/row-button";
import { card, inputClass, inputClassSm, fieldLabel, btnSmPrimary, btnSm } from "@/lib/ui-styles";
import { downloadCsv, csvStampMyt } from "@/lib/csv";
import { getLang } from "@/lib/i18n";

const api = makeApi("/staff/hotels");
const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);

interface Contact {
  id?: number; person_name: string | null; phone: string | null; phone2: string | null; email: string | null;
}
interface Hotel {
  id: number; state: string; hotel_name: string; company: string | null; address: string | null;
  rooms: number | null; stars: string | null; mof_validity: string | null; halal_validity: string | null;
  notes: string | null; updated_at?: string; contacts: Contact[];
}

/**
 * The cartogram. `x` and `y` are grid cells, not coordinates: Perlis is
 * north-west of Kedah, Johor is at the bottom, Borneo sits to the east with
 * Sabah above Sarawak. `w` widens the two Borneo states because they really
 * are the big ones and a one-cell Sarawak reads as a mistake.
 */
const TILES: { state: string; short: string; x: number; y: number; w?: number }[] = [
  { state: "PERLIS", short: "PLS", x: 0, y: 0 },
  { state: "KEDAH", short: "KDH", x: 1, y: 0 },
  { state: "KELANTAN", short: "KTN", x: 3, y: 0 },
  { state: "SABAH", short: "SBH", x: 5, y: 0, w: 2 },
  { state: "PULAU PINANG", short: "PNG", x: 0, y: 1 },
  { state: "PERAK", short: "PRK", x: 1, y: 1 },
  { state: "TERENGGANU", short: "TRG", x: 3, y: 1 },
  { state: "SELANGOR", short: "SGR", x: 1, y: 2 },
  { state: "KUALA LUMPUR", short: "KL", x: 2, y: 2 },
  { state: "PAHANG", short: "PHG", x: 3, y: 2 },
  { state: "SARAWAK", short: "SWK", x: 5, y: 2, w: 2 },
  { state: "NEGERI SEMBILAN", short: "NS", x: 1, y: 3 },
  { state: "PUTRAJAYA", short: "PJY", x: 2, y: 3 },
  { state: "MELAKA", short: "MLK", x: 1, y: 4 },
  { state: "JOHOR", short: "JHR", x: 2, y: 4 },
];
const GRID_W = 7;
const GRID_H = 5;

const emptyHotel = (): Hotel => ({
  id: 0, state: "KUALA LUMPUR", hotel_name: "", company: "", address: "",
  rooms: null, stars: "", mof_validity: "", halal_validity: "", notes: "",
  contacts: [{ person_name: "", phone: "", phone2: "", email: "" }],
});

/** One state tile. Module scope, per guard #30. */
function Tile({ t, n, max, active, onPick }: {
  t: (typeof TILES)[number]; n: number; max: number; active: boolean; onPick: () => void;
}) {
  /* v1.100.2 — five steps of the theme's own primary, reaching FULL strength
     at the top. The first version stopped at 60% mixed into white, so even
     Kuala Lumpur's 104 came out a pale slate and the whole map read grey.
     A choropleth whose darkest tile is not dark has no top end. */
  const share = max > 0 ? n / max : 0;
  const fill = n === 0 ? 6 : share > 0.7 ? 100 : share > 0.4 ? 72 : share > 0.2 ? 48 : share > 0.08 ? 28 : 15;
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onPick}
      title={`${t.state} — ${n} ${n === 1 ? "hotel" : "hotels"}`}
      className={`hp-tile group absolute flex flex-col items-center justify-center rounded-xl border text-center transition-all duration-200
        ${active ? "border-primary ring-primary z-10 scale-[1.04] ring-2" : "border-border/70 hover:border-primary/70 hover:scale-[1.03]"}`}
      style={{
        left: `${(t.x / GRID_W) * 100}%`,
        top: `${(t.y / GRID_H) * 100}%`,
        width: `calc(${((t.w ?? 1) / GRID_W) * 100}% - 0.5rem)`,
        height: `calc(${(1 / GRID_H) * 100}% - 0.5rem)`,
        margin: "0.25rem",
        background: `color-mix(in oklab, var(--primary) ${fill}%, var(--card))`,
      }}
    >
      <span className={`text-[11px] leading-none font-bold tracking-[0.12em] ${fill >= 48 ? "text-primary-foreground" : "text-muted-foreground"}`}>
        {t.short}
      </span>
      <span className={`mt-1.5 text-lg leading-none font-bold tabular-nums ${fill >= 48 ? "text-primary-foreground" : "text-foreground"}`}>
        {n}
      </span>
    </button>
  );
}

export function HotelsPanel() {
  const { show: toast, node: toastNode } = useSaveToast();
  const { confirm, node: confirmNode } = useConfirm();

  const [hotels, setHotels] = useState<Hotel[]>([]);
  const [byState, setByState] = useState<Record<string, number>>({});
  const [states, setStates] = useState<string[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [pending, setPending] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [state, setState] = useState<string>("");     // "" = every state
  const [qLive, setQLive] = useState("");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<number | null>(null);
  const [draft, setDraft] = useState<Hotel | null>(null);
  const [saving, setSaving] = useState(false);

  /* Typing waits for the pause — the list is 442 hotels and their people. */
  useEffect(() => {
    const t = window.setTimeout(() => setQ(qLive.trim()), 300);
    return () => window.clearTimeout(t);
  }, [qLive]);

  const load = useCallback(async () => {
    setLoaded(false);
    const r = await api<{ hotels: Hotel[]; states: string[]; by_state: Record<string, number>; can_manage?: boolean; pending_migration?: boolean }>(
      `?${state ? `state=${encodeURIComponent(state)}&` : ""}${q ? `q=${encodeURIComponent(q)}` : ""}`,
    );
    if (r.ok && r.data) {
      setHotels(r.data.hotels ?? []);
      setStates(r.data.states ?? []);
      setByState(r.data.by_state ?? {});
      setCanManage(Boolean(r.data.can_manage));
      setPending(Boolean(r.data.pending_migration));
    }
    setLoaded(true);
  }, [state, q]);
  useEffect(() => { void load(); }, [load]);

  const total = useMemo(() => Object.values(byState).reduce((a, b) => a + b, 0), [byState]);
  const maxState = useMemo(() => Math.max(1, ...Object.values(byState)), [byState]);

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
      <style>{`@keyframes hp-in { from { opacity: 0; transform: translateY(4px) } to { opacity: 1; transform: none } }
        .hp-tile { animation: hp-in .3s ease-out both }
        @media (prefers-reduced-motion: reduce) { .hp-tile { animation: none } }`}</style>

      {/* ================= THE MAP ================= */}
      <div className={card}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-sm font-semibold">{L("Hotels by state", "Hotel mengikut negeri")}</p>
            <p className="text-muted-foreground mt-0.5 text-xs">
              {L("Press a state to see its hotels. The shade is how many are in it.",
                 "Tekan sesebuah negeri untuk melihat hotelnya. Warna menunjukkan bilangannya.")}
            </p>
          </div>
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="bg-secondary text-muted-foreground rounded-full px-2.5 py-1 text-[11px] font-medium">
              {total} {L("hotels", "hotel")} · {states.length} {L("states", "negeri")}
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
        {/* v1.100.2 — the FRAME carries the width, not the grid inside it. The
            first version put max-w on the grid and left the bordered panel
            full-width, so a 704px map sat in the middle of a 1600px box with
            a third of it empty on either side and the border miles away from
            the picture. */}
        <div className="border-border/60 bg-card/50 relative mx-auto mt-3 w-full overflow-hidden rounded-2xl border p-4 backdrop-blur-sm"
          style={{ maxWidth: "46rem" }}>
          <span aria-hidden className="pointer-events-none absolute inset-0"
            style={{ background: "radial-gradient(120% 90% at 20% 0%, color-mix(in oklab, var(--primary) 7%, transparent) 0%, transparent 60%)" }} />
          <div className="relative w-full" style={{ aspectRatio: `${GRID_W} / ${GRID_H}` }}>
            {/* The empty column between the peninsula and Borneo is the sea,
                and saying so is what turns a hole into a map. */}
            <span aria-hidden
              className="text-muted-foreground/50 pointer-events-none absolute flex items-center justify-center text-[9px] font-semibold tracking-[0.2em]"
              style={{ left: `${(4 / GRID_W) * 100}%`, top: `${(0.6 / GRID_H) * 100}%`, width: `${(1 / GRID_W) * 100}%`, height: `${(2 / GRID_H) * 100}%` }}>
              <span style={{ writingMode: "vertical-rl" }}>SOUTH CHINA SEA</span>
            </span>
            {!loaded && TILES.map((t) => (
              <div key={t.state} className="absolute p-1" aria-hidden
                style={{
                  left: `${(t.x / GRID_W) * 100}%`, top: `${(t.y / GRID_H) * 100}%`,
                  width: `${((t.w ?? 1) / GRID_W) * 100}%`, height: `${(1 / GRID_H) * 100}%`,
                }}>
                <Skel className="h-full w-full rounded-xl" />
              </div>
            ))}
            {loaded && TILES.map((t) => (
              <Tile key={t.state} t={t} n={byState[t.state] ?? 0} max={maxState}
                active={state === t.state} onPick={() => setState(state === t.state ? "" : t.state)} />
            ))}
          </div>
          <p className="text-muted-foreground mt-2 text-center text-[11px]">
            {L("Peninsular Malaysia on the left, Sabah and Sarawak to the east — one tile per state, sized alike so every state can be read and pressed.",
               "Semenanjung Malaysia di kiri, Sabah dan Sarawak di timur — satu jubin bagi setiap negeri, sama saiz supaya setiap negeri boleh dibaca dan ditekan.")}
          </p>
        </div>
      </div>

      {/* ================= THE LIST ================= */}
      <div className={card}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold">
            {state || L("Every state", "Semua negeri")}
            <span className="text-muted-foreground ml-2 text-xs font-normal">
              {loaded ? `${hotels.length} ${L("shown", "dipaparkan")}` : ""}
            </span>
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
                  {(states.length ? states : TILES.map((t) => t.state)).map((s) => <option key={s} value={s}>{s}</option>)}
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
               : L("No hotels in this state yet.", "Belum ada hotel di negeri ini.")}
          </p>
        ) : (
          <ul className="divide-border mt-3 divide-y">
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

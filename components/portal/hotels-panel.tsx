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
/* v1.100.3 — one country, one geometry: the same module the Operations map
   and the ELFIA Traffic map draw from. Its names are Title Case; the hotel
   list keeps the workbook's upper case, and `stateKey` is the one place the
   two meet. */
import { STATES } from "@/lib/malaysia-map";

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

const emptyHotel = (): Hotel => ({
  id: 0, state: "KUALA LUMPUR", hotel_name: "", company: "", address: "",
  rooms: null, stars: "", mof_validity: "", halal_validity: "", notes: "",
  contacts: [{ person_name: "", phone: "", phone2: "", email: "" }],
});

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
                const isSel = state === key;
                return (
                  <path key={sh.name} d={sh.d}
                    role="button" tabIndex={0} aria-pressed={isSel}
                    aria-label={`${sh.name}: ${n} ${n === 1 ? L("hotel", "hotel") : L("hotels", "hotel")}`}
                    onClick={() => setState(isSel ? "" : key)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setState(isSel ? "" : key); } }}
                    className="cursor-pointer outline-none transition-opacity hover:opacity-75 focus-visible:opacity-75"
                    fill={n > 0 ? "var(--gold-solid)" : "var(--secondary)"}
                    fillOpacity={n > 0 ? 0.3 + 0.55 * (n / maxState) : 1}
                    stroke={isSel ? "var(--primary)" : "var(--border)"}
                    strokeWidth={isSel ? 2.5 : 1}
                    strokeLinejoin="round">
                    <title>{`${sh.name} · ${n} ${n === 1 ? L("hotel", "hotel") : L("hotels", "hotel")}`}</title>
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
                if (!n) return null;
                const r = 9 + Math.sqrt(n / maxState) * 9;
                const isSel = state === key;
                return (
                  <g key={`b-${sh.name}`} role="button" tabIndex={0} aria-pressed={isSel}
                    aria-label={`${sh.name}: ${n} ${n === 1 ? L("hotel", "hotel") : L("hotels", "hotel")}`}
                    onClick={() => setState(isSel ? "" : key)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setState(isSel ? "" : key); } }}
                    className="cursor-pointer outline-none">
                    <circle cx={sh.cx} cy={sh.cy} r={r}
                      fill="var(--brand-primary)" stroke={isSel ? "var(--primary)" : "var(--gold-solid)"}
                      strokeWidth={isSel ? 2.5 : 1.5} opacity="0.92" />
                    <text x={sh.cx} y={sh.cy + 3.5} textAnchor="middle" style={{ font: "700 10px sans-serif", fill: "#fff" }}>{n}</text>
                    <title>{`${sh.name} · ${n} ${n === 1 ? L("hotel", "hotel") : L("hotels", "hotel")}`}</title>
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
                  <p className="text-muted-foreground text-[10px] font-semibold tracking-wider uppercase">{L("Hotels", "Hotel")}</p>
                  <p className="text-lg font-bold tabular-nums">{state ? (byState[state] ?? 0) : total}</p>
                </div>
                <p className="text-muted-foreground mt-3 text-[10px] font-semibold tracking-wider uppercase">{L("Most hotels", "Hotel terbanyak")}</p>
                <ul className="mt-1.5 space-y-1">
                  {Object.entries(byState).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([st, n]) => (
                    <li key={st}>
                      <button type="button" onClick={() => setState(state === st ? "" : st)}
                        className={`flex w-full items-center justify-between gap-2 text-xs ${state === st ? "font-semibold" : ""}`}>
                        <span className="truncate">{st}</span>
                        <span className="tabular-nums">{n}</span>
                      </button>
                    </li>
                  ))}
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

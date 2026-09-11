"use client";

/**
 * CRISCIKEE — the crispy chicken skin, and what customers make of it. v1.149.0.
 *
 * The CEO, 10-09-2026: *"WHO is buying/testing Criscikee → WHAT flavor they
 * prefer → HOW MUCH they like it → WHY they like/dislike it."*
 *
 * Three screens under one tab, drawn with SectionTabs like the store panel:
 *
 *   Dashboard  - every figure the API computes (worker/src/criscikee.ts
 *                /analytics): the KPI strip, each flavour's performance, the
 *                flavour x gender and flavour x age-group grids, a segment
 *                picker over the full cube, the customers' own words, and the
 *                insights - which withhold the word "best" below MIN_SAMPLE.
 *   Reviews    - the list: search, seven filters, three sorts, view / edit /
 *                delete, and the form that adds one in as few taps as the
 *                data allows.
 *   Flavors    - the product line: add, rename, retire. Never delete.
 *
 * NOTHING IS ADDED UP HERE. The browser filters what it was sent and draws
 * it; every count, average and percentage comes from SQL. The one exception
 * is the segment picker, which chooses one cell from a cube the API already
 * aggregated - a lookup, not a sum.
 *
 * Every string is L(en, ms). Every surface is from lib/ui-styles. Every
 * figure that opens something is a button. Every mutation toasts. Every
 * fetch has a skeleton in its own shape. Every component is module-scope.
 * The guards say so, and tests/criscikee.mjs says the rest.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { makeApi } from "@/lib/api";
import { useSaveToast } from "@/components/ui/save-toast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Skel, SkelStat, StaleHint } from "@/components/ui/skeleton";
import { rowBtn, rowBtnDanger, rowBtnPrimary, rowActions } from "@/components/ui/row-button";
import {
  card, insetCard, inputClass, inputClassSm, selectClass, fieldLabel, btnClass, btnGhost, btnSm, btnSmPrimary,
  th, td, thR2, tdR2, chipSmNeutral, chipSmSuccess, chipSmWarn, chipSmDanger, chipSmInfo, listRow,
} from "@/lib/ui-styles";
import { StatTile, StatStrip } from "@/components/ui/stat-tile";
import { MiniBar } from "@/components/ui/stat-card";
import { AppIcon, PanelTitle } from "@/components/ui/app-icon";
import { ZoneLabel, SectionTabs } from "@/components/portal/page-shared";
import { DetailsToggle } from "@/components/ui/details-toggle";
import { useCachedApi } from "@/lib/cached-api";
import { getLang } from "@/lib/i18n";
import { dmy, mytToday } from "@/lib/format";
import {
  GENDERS, AGE_GROUPS, IMPRESSIONS, SENTIMENTS, ageGroupOf, labelOf,
  AGE_MIN, AGE_MAX, COMMENT_MAX, MIN_SAMPLE,
} from "@/lib/criscikee";

const api = makeApi("/staff/criscikee");
const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);
const lbl = (list: readonly (readonly [string, string, string])[], code: string | null | undefined) => labelOf(list, code, getLang());

/* ---- what the API sends ---- */
interface Flavor { id: number; name: string; description: string | null; is_active: number; sort_order: number; reviews: number }
interface Review {
  id: number; flavor_id: number; flavor_name: string | null; age: number; age_group: string; gender: string;
  rating: number; comment: string; impression: string; sentiment: string; sentiment_source: "auto" | "manual";
  sentiment_reasons: string | null; reviewed_on: string; created_by_name: string | null; created_at: string;
}
interface FlavorStat {
  flavor_id: number; name: string; is_active: number; n: number; avg_rating: number | null;
  positive: number; neutral: number; negative: number; positive_pct: number; neutral_pct: number; negative_pct: number; enough: boolean;
}
interface Cross { flavor_id: number; k: string; n: number; avg_rating: number }
interface Segment { flavor_id: number; gender: string; age_group: string; n: number; avg_rating: number; positive: number; neutral: number; negative: number; positive_pct: number }
interface Best { flavor: string; avg_rating: number; n: number }
interface Analytics {
  pending_migration?: boolean;
  min_sample: number;
  kpis: {
    total_reviews: number; avg_rating: number | null; positive_pct: number; neutral_pct: number; negative_pct: number;
    most_loved: Best | null; most_reviewed: { flavor: string; n: number } | null;
    top_age_group: { age_group: string; n: number } | null; top_gender: { gender: string; n: number } | null;
  };
  flavors: FlavorStat[];
  by_gender: Record<string, { n: number; avg_rating: number }>;
  by_age_group: Record<string, { n: number; avg_rating: number }>;
  by_impression: Record<string, number>;
  by_rating: Record<string, number>;
  flavor_by_gender: Cross[];
  flavor_by_age_group: Cross[];
  segments: Segment[];
  voice: { id: number; flavor_id: number; comment: string; rating: number; sentiment: string; gender: string; age_group: string; reviewed_on: string }[];
  insights: {
    best_rated: Best | null; most_popular: { flavor: string; n: number } | null;
    most_positive: { flavor: string; positive_pct: number; n: number } | null;
    most_negative: { flavor: string; negative_pct: number; n: number } | null;
    best_by_gender: Record<string, Best | null>; best_by_age_group: Record<string, Best | null>;
    opportunity: { flavor: string; flavor_id: number; gender: string; age_group: string; n: number; avg_rating: number; positive_pct: number }[];
    too_few: { flavor: string; n: number }[];
  };
  can_review: boolean; can_manage: boolean;
}

/* ---- small shared pieces (module scope - render-stability guard) ---- */

/** Five stars, the filled ones in gold. Read-only. */
function Stars({ value, className = "" }: { value: number; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-0.5 ${className}`} aria-label={L(`${value} of 5 stars`, `${value} daripada 5 bintang`)} title={`${value}/5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <AppIcon key={i} name="star" className={`h-3.5 w-3.5 ${i <= value ? "fill-current text-warning" : "text-muted-foreground/40"}`} />
      ))}
    </span>
  );
}

/** Five tappable stars for the form. Each is a real button, 44px on a phone. */
function RatingInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-1" role="radiogroup" aria-label={L("Flavour rating", "Penilaian perisa")}>
      {[1, 2, 3, 4, 5].map((i) => (
        <button key={i} type="button" role="radio" aria-checked={value === i} aria-label={L(`${i} star${i === 1 ? "" : "s"}`, `${i} bintang`)}
          className="inline-flex h-11 w-11 items-center justify-center rounded-lg transition-colors hover:bg-secondary sm:h-9 sm:w-9"
          onClick={() => onChange(i)}>
          <AppIcon name="star" className={`h-7 w-7 sm:h-6 sm:w-6 ${i <= value ? "fill-current text-warning" : "text-muted-foreground/40"}`} />
        </button>
      ))}
      <span className="text-muted-foreground ml-1 text-xs tabular-nums">{value > 0 ? `${value}/5` : L("tap a star", "ketik bintang")}</span>
    </div>
  );
}

const SENT_CHIP: Record<string, string> = { positive: chipSmSuccess, neutral: chipSmNeutral, negative: chipSmDanger };
const IMP_CHIP: Record<string, string> = { loved_it: chipSmSuccess, good: chipSmInfo, average: chipSmWarn, not_my_taste: chipSmDanger };

function SentimentChip({ s, source }: { s: string; source?: "auto" | "manual" }) {
  return (
    <span className={SENT_CHIP[s] ?? chipSmNeutral} title={source === "manual" ? L("Set by hand", "Ditetapkan secara manual") : L("Classified from the comment", "Dikelaskan daripada komen")}>
      {lbl(SENTIMENTS, s)}{source === "manual" ? " ·" : ""}
    </span>
  );
}

/** A heat cell for the two grids: the average, and how many it rests on.
    Colour says the average; a faint cell says the sample is too small to
    read anything into - the number is still there, the confidence is not. */
function HeatCell({ avg, n, minSample }: { avg: number | null; n: number; minSample: number }) {
  if (n === 0 || avg == null) return <td className={`${tdR2} text-muted-foreground/50`}>—</td>;
  const tone = avg >= 4.5 ? "bg-success-soft text-success" : avg >= 4 ? "bg-success-soft/50 text-success" : avg >= 3.5 ? "bg-warning-soft text-warning" : avg >= 3 ? "bg-warning-soft/50 text-warning" : "bg-danger-soft text-danger";
  const thin = n < minSample;
  return (
    <td className={`${tdR2} ${tone} ${thin ? "opacity-60" : ""}`}
      title={thin ? L(`${n} review${n === 1 ? "" : "s"} — below the ${minSample} needed to read anything into it`, `${n} ulasan — bawah ${minSample} yang diperlukan`) : L(`${n} reviews`, `${n} ulasan`)}>
      <span className="font-semibold">{avg.toFixed(1)}</span>
      <span className="ml-1 text-[10px] opacity-70">({n})</span>
    </td>
  );
}

/* ================= the tab ================= */
type Screen = "dashboard" | "reviews" | "flavors";

export function CriscikeePanel() {
  const [screen, setScreen] = useState<Screen>("dashboard");
  const { show: toast, node: toastNode } = useSaveToast();
  const { confirm, node: confirmNode } = useConfirm();
  const flavorsView = useCachedApi<{ flavors: Flavor[]; can_review: boolean; can_manage: boolean; pending_migration?: boolean }>("/staff/criscikee/flavors", true, ["criscikee"]);
  const flavors = useMemo(() => flavorsView.data?.flavors ?? [], [flavorsView.data]);
  const canReview = Boolean(flavorsView.data?.can_review);
  const canManage = Boolean(flavorsView.data?.can_manage);
  const pending = Boolean(flavorsView.data?.pending_migration);
  const refreshFlavors = flavorsView.refresh;
  const reloadFlavors = useCallback(() => { refreshFlavors(); }, [refreshFlavors]);

  const TABS = [
    ["dashboard", L("Dashboard", "Papan pemuka")],
    ["reviews", L("Customer reviews", "Ulasan pelanggan")],
    ["flavors", L("Flavors", "Perisa")],
  ] as const;

  return (
    <div className="space-y-3 md:space-y-4">
      <div className={card}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <PanelTitle icon="drumstick">Criscikee <span className="text-muted-foreground font-normal">· {L("crispy chicken skin", "kulit ayam rangup")}</span></PanelTitle>
          <StaleHint show={flavorsView.stale} />
        </div>
        <p className="text-muted-foreground mt-1 text-xs">
          {L("Who is trying it, which flavour they prefer, how much they like it, and why — in their own words.",
             "Siapa yang mencuba, perisa mana yang mereka suka, sejauh mana, dan mengapa — dalam kata-kata mereka sendiri.")}
        </p>
        {pending && (
          <p className="text-warning mt-2 text-xs font-medium">
            {L("Criscikee is not set up on the server yet — run the deploy so migration 0125 applies.", "Criscikee belum disediakan di pelayan — jalankan deploy supaya migrasi 0125 dilaksanakan.")}
          </p>
        )}
        <SectionTabs value={screen} onChange={setScreen} tabs={TABS} className="mt-3" />
      </div>

      {screen === "dashboard" && <DashboardView flavors={flavors} onGoReviews={() => setScreen("reviews")} />}
      {screen === "reviews" && <ReviewsView flavors={flavors} canReview={canReview} canManage={canManage} toast={toast} confirm={confirm} onFlavorsChanged={reloadFlavors} />}
      {screen === "flavors" && <FlavorsView flavors={flavors} loaded={!flavorsView.loading} canManage={canManage} toast={toast} reload={reloadFlavors} />}

      {toastNode}
      {confirmNode}
    </div>
  );
}

/* ================= DASHBOARD ================= */

function DashboardView({ flavors, onGoReviews }: { flavors: Flavor[]; onGoReviews: () => void }) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const qs = `${from ? `from=${from}&` : ""}${to ? `to=${to}` : ""}`.replace(/&$/, "");
  const view = useCachedApi<Analytics>(`/staff/criscikee/analytics${qs ? `?${qs}` : ""}`, true, ["criscikee"]);
  const a = view.data;
  const loaded = !view.loading && !!a;
  const minSample = a?.min_sample ?? MIN_SAMPLE;
  const nameOf = useMemo(() => new Map(flavors.map((f) => [f.id, f.name])), [flavors]);
  const flavorStats = useMemo(() => (a?.flavors ?? []).filter((f) => f.n > 0 || f.is_active), [a]);

  /* ---- segment picker: one cell of the cube, chosen here ---- */
  const [segFlavor, setSegFlavor] = useState<number>(0);
  const [segGender, setSegGender] = useState<string>("");
  const [segAge, setSegAge] = useState<string>("");
  const segment = useMemo(() => {
    if (!a) return null;
    /* Any of the three may be left as "all": the matching cells are summed
       from counts and weighted by n, which is the only arithmetic this file
       does, and it is a weighted mean of means already computed in SQL. */
    const cells = a.segments.filter((c) =>
      (!segFlavor || c.flavor_id === segFlavor) && (!segGender || c.gender === segGender) && (!segAge || c.age_group === segAge));
    const n = cells.reduce((s, c) => s + c.n, 0);
    if (n === 0) return { n: 0, avg: null as number | null, pos: 0 };
    const avg = cells.reduce((s, c) => s + c.avg_rating * c.n, 0) / n;
    const pos = cells.reduce((s, c) => s + c.positive, 0);
    return { n, avg: Math.round(avg * 100) / 100, pos: Math.round((pos / n) * 1000) / 10 };
  }, [a, segFlavor, segGender, segAge]);

  const cross = (rows: Cross[] | undefined, flavorId: number, k: string) => rows?.find((r) => r.flavor_id === flavorId && r.k === k) ?? null;

  return (
    <>
      {/* ---- the period, and the KPI strip ---- */}
      <section className="space-y-3 md:space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <ZoneLabel>{L("Who, and how much", "Siapa, dan sejauh mana")}</ZoneLabel>
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-muted-foreground text-xs">{L("From", "Dari")}
              <input type="date" className={`${inputClassSm} ml-1`} value={from} max={to || mytToday()} onChange={(e) => setFrom(e.target.value)} /></label>
            <label className="text-muted-foreground text-xs">{L("To", "Hingga")}
              <input type="date" className={`${inputClassSm} ml-1`} value={to} min={from || undefined} max={mytToday()} onChange={(e) => setTo(e.target.value)} /></label>
            {(from || to) && <button type="button" className={btnSm} onClick={() => { setFrom(""); setTo(""); }}>{L("All time", "Sepanjang masa")}</button>}
            <StaleHint show={view.stale} />
          </div>
        </div>

        {!loaded ? (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4" aria-hidden>{Array.from({ length: 8 }, (_, i) => <SkelStat key={i} />)}</div>
        ) : (
          <StatStrip>
            <StatTile tone="brand" label={L("Total reviews", "Jumlah ulasan")} value={a.kpis.total_reviews}
              onClick={onGoReviews} title={L("Open the reviews", "Buka ulasan")} />
            <StatTile tone="gold" label={L("Average rating", "Purata penilaian")}
              value={a.kpis.avg_rating == null ? "—" : `${a.kpis.avg_rating.toFixed(2)} / 5`}
              hint={a.kpis.total_reviews ? L(`across ${a.kpis.total_reviews} reviews`, `merentas ${a.kpis.total_reviews} ulasan`) : L("no reviews yet", "belum ada ulasan")} />
            <StatTile tone="success" label={L("Most loved flavour", "Perisa paling disukai")}
              value={a.kpis.most_loved?.flavor ?? "—"}
              hint={a.kpis.most_loved ? `${a.kpis.most_loved.avg_rating.toFixed(2)} ★ · ${a.kpis.most_loved.n} ${L("reviews", "ulasan")}`
                : L(`needs ${minSample}+ reviews on a flavour`, `perlukan ${minSample}+ ulasan pada satu perisa`)} />
            <StatTile tone="info" label={L("Most reviewed", "Paling banyak diulas")}
              value={a.kpis.most_reviewed?.flavor ?? "—"}
              hint={a.kpis.most_reviewed ? `${a.kpis.most_reviewed.n} ${L("reviews", "ulasan")}` : undefined} />
            <StatTile tone={a.kpis.positive_pct >= 70 ? "success" : a.kpis.positive_pct >= 50 ? "gold" : "danger"} label={L("Positive reviews", "Ulasan positif")}
              value={a.kpis.total_reviews ? `${a.kpis.positive_pct}%` : "—"}
              hint={a.kpis.total_reviews ? L(`${a.kpis.neutral_pct}% neutral · ${a.kpis.negative_pct}% negative`, `${a.kpis.neutral_pct}% neutral · ${a.kpis.negative_pct}% negatif`) : undefined} />
            <StatTile tone="muted" label={L("Top age group", "Kumpulan umur utama")}
              value={a.kpis.top_age_group ? lbl(AGE_GROUPS, a.kpis.top_age_group.age_group) : "—"}
              hint={a.kpis.top_age_group ? `${a.kpis.top_age_group.n} ${L("reviews", "ulasan")}` : undefined} />
            <StatTile tone="muted" label={L("Top gender", "Jantina utama")}
              value={a.kpis.top_gender ? lbl(GENDERS, a.kpis.top_gender.gender) : "—"}
              hint={a.kpis.top_gender ? `${a.kpis.top_gender.n} ${L("reviews", "ulasan")}` : undefined} />
            <StatTile tone="muted" label={L("Rating spread", "Taburan penilaian")}
              value={<span className="text-sm font-semibold">{[5, 4, 3, 2, 1].map((r) => `${r}★ ${a.by_rating[String(r)] ?? 0}`).join(" · ")}</span>} />
          </StatStrip>
        )}
      </section>

      {/* ---- flavour performance ---- */}
      <section className="space-y-3 md:space-y-4">
        <ZoneLabel>{L("Flavour performance", "Prestasi perisa")}</ZoneLabel>
        {!loaded ? (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4" aria-hidden>
            {Array.from({ length: 4 }, (_, i) => <div key={i} className={insetCard}><Skel className="h-4 w-20" /><Skel className="mt-2 h-7 w-16" /><Skel className="mt-2 h-2 w-full" /><Skel className="mt-3 h-3 w-full" /></div>)}
          </div>
        ) : flavorStats.length === 0 ? (
          <p className="text-muted-foreground text-sm">{L("No flavours yet — add one under Flavors.", "Belum ada perisa — tambah di bawah Perisa.")}</p>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
            {flavorStats.map((f) => {
              const latest = a.voice.find((v) => v.flavor_id === f.flavor_id);
              return (
                <div key={f.flavor_id} className={`${insetCard} ${f.is_active ? "" : "opacity-70"}`}>
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-semibold">{f.name}{!f.is_active && <span className={`${chipSmNeutral} ml-1.5`}>{L("retired", "dihentikan")}</span>}</p>
                    {!f.enough && f.n > 0 && <span className={chipSmWarn} title={L(`Under ${minSample} reviews — shown, not ranked`, `Bawah ${minSample} ulasan — ditunjuk, tidak disenaraikan`)}>{L("small sample", "sampel kecil")}</span>}
                  </div>
                  <p className="mt-1 text-2xl font-bold tabular-nums">{f.avg_rating == null ? "—" : f.avg_rating.toFixed(1)}<span className="text-muted-foreground text-sm font-normal"> / 5</span></p>
                  <p className="text-muted-foreground text-xs">{f.n} {L(`review${f.n === 1 ? "" : "s"}`, "ulasan")}</p>
                  {f.n > 0 && (
                    <>
                      <MiniBar pct={f.positive_pct} tone={f.positive_pct >= 70 ? "green" : f.positive_pct >= 50 ? "gold" : "red"} className="mt-2" />
                      <p className="mt-1 text-[11px] tabular-nums">
                        <span className="text-success font-semibold">{f.positive_pct}% {L("positive", "positif")}</span>
                        <span className="text-muted-foreground"> · {f.neutral_pct}% {L("neutral", "neutral")} · </span>
                        <span className="text-danger">{f.negative_pct}% {L("negative", "negatif")}</span>
                      </p>
                    </>
                  )}
                  {/* by gender and by age group, for THIS flavour, small */}
                  {f.n > 0 && (
                    <DetailsToggle label={L("By gender and age", "Ikut jantina dan umur")} className="mt-1">
                      <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px]">
                        {GENDERS.map(([g]) => { const c = cross(a.flavor_by_gender, f.flavor_id, g); return (
                          <p key={g} className="flex justify-between"><span className="text-muted-foreground">{lbl(GENDERS, g)}</span><span className="tabular-nums">{c ? `${c.avg_rating.toFixed(1)} (${c.n})` : "—"}</span></p>); })}
                        {AGE_GROUPS.map(([ag]) => { const c = cross(a.flavor_by_age_group, f.flavor_id, ag); return (
                          <p key={ag} className="flex justify-between"><span className="text-muted-foreground">{lbl(AGE_GROUPS, ag)}</span><span className="tabular-nums">{c ? `${c.avg_rating.toFixed(1)} (${c.n})` : "—"}</span></p>); })}
                      </div>
                    </DetailsToggle>
                  )}
                  {latest && <p className="text-muted-foreground mt-2 line-clamp-2 text-[11px] italic">“{latest.comment}”</p>}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ---- the two grids ---- */}
      <section className="space-y-3 md:space-y-4">
        <ZoneLabel>{L("Flavour by gender, and by age group", "Perisa ikut jantina, dan ikut kumpulan umur")}</ZoneLabel>
        <div className="grid grid-cols-1 gap-3 md:gap-4 xl:grid-cols-2">
          <div className={card}>
            <p className="text-sm font-semibold">{L("Flavour × gender", "Perisa × jantina")}</p>
            <p className="text-muted-foreground text-xs">{L("Average rating, with how many reviews it rests on. A faded cell has too few to read into.", "Purata penilaian, dengan bilangan ulasan. Sel pudar terlalu sedikit untuk ditafsir.")}</p>
            <div className="mt-2 overflow-x-auto">
              {!loaded ? <Skel className="h-32 w-full" /> : (
                <table className="w-full border-collapse text-xs">
                  <thead><tr className="border-border border-b">
                    <th className={th}>{L("Flavour", "Perisa")}</th>
                    {GENDERS.map(([g]) => <th key={g} className={thR2}>{lbl(GENDERS, g)}</th>)}
                    <th className={thR2}>{L("Overall", "Keseluruhan")}</th>
                  </tr></thead>
                  <tbody>{flavorStats.map((f) => (
                    <tr key={f.flavor_id} className="border-border border-b last:border-0">
                      <td className={`${td} font-medium`}>{f.name}</td>
                      {GENDERS.map(([g]) => { const c = cross(a.flavor_by_gender, f.flavor_id, g); return <HeatCell key={g} avg={c?.avg_rating ?? null} n={c?.n ?? 0} minSample={minSample} />; })}
                      <HeatCell avg={f.avg_rating} n={f.n} minSample={minSample} />
                    </tr>
                  ))}</tbody>
                </table>
              )}
            </div>
          </div>
          <div className={card}>
            <p className="text-sm font-semibold">{L("Age group × flavour", "Kumpulan umur × perisa")}</p>
            <p className="text-muted-foreground text-xs">{L("Which flavour each age group rates highest.", "Perisa yang dinilai tertinggi oleh setiap kumpulan umur.")}</p>
            <div className="mt-2 overflow-x-auto">
              {!loaded ? <Skel className="h-40 w-full" /> : (
                <table className="w-full border-collapse text-xs">
                  <thead><tr className="border-border border-b">
                    <th className={th}>{L("Age group", "Kumpulan umur")}</th>
                    {flavorStats.map((f) => <th key={f.flavor_id} className={thR2}>{f.name}</th>)}
                  </tr></thead>
                  <tbody>{AGE_GROUPS.map(([ag]) => (
                    <tr key={ag} className="border-border border-b last:border-0">
                      <td className={`${td} font-medium`}>{lbl(AGE_GROUPS, ag)}<span className="text-muted-foreground ml-1 text-[10px]">({a.by_age_group[ag]?.n ?? 0})</span></td>
                      {flavorStats.map((f) => { const c = cross(a.flavor_by_age_group, f.flavor_id, ag); return <HeatCell key={f.flavor_id} avg={c?.avg_rating ?? null} n={c?.n ?? 0} minSample={minSample} />; })}
                    </tr>
                  ))}</tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ---- the segment picker ---- */}
      <section className="space-y-3 md:space-y-4">
        <ZoneLabel>{L("Customer segment", "Segmen pelanggan")}</ZoneLabel>
        <div className={card}>
          <p className="text-sm font-semibold">{L("Age group + gender + flavour", "Kumpulan umur + jantina + perisa")}</p>
          <p className="text-muted-foreground text-xs">{L("Pick any combination. Leave one as “all” to widen it.", "Pilih mana-mana gabungan. Biarkan satu sebagai “semua” untuk meluaskannya.")}</p>
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
            <select className={selectClass} value={segAge} onChange={(e) => setSegAge(e.target.value)} aria-label={L("Age group", "Kumpulan umur")}>
              <option value="">{L("All age groups", "Semua kumpulan umur")}</option>
              {AGE_GROUPS.map(([k]) => <option key={k} value={k}>{lbl(AGE_GROUPS, k)}</option>)}
            </select>
            <select className={selectClass} value={segGender} onChange={(e) => setSegGender(e.target.value)} aria-label={L("Gender", "Jantina")}>
              <option value="">{L("All genders", "Semua jantina")}</option>
              {GENDERS.map(([k]) => <option key={k} value={k}>{lbl(GENDERS, k)}</option>)}
            </select>
            <select className={selectClass} value={segFlavor} onChange={(e) => setSegFlavor(Number(e.target.value))} aria-label={L("Flavour", "Perisa")}>
              <option value={0}>{L("All flavours", "Semua perisa")}</option>
              {flavors.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </div>
          {!loaded ? <Skel className="mt-3 h-16 w-full" /> : segment && segment.n > 0 ? (
            <div className="mt-3 flex flex-wrap items-end gap-x-6 gap-y-2">
              <div>
                <p className="text-muted-foreground text-[10px] font-semibold tracking-wider uppercase">
                  {segGender ? lbl(GENDERS, segGender) : L("Everyone", "Semua")} / {segAge ? lbl(AGE_GROUPS, segAge) : L("all ages", "semua umur")} / {segFlavor ? nameOf.get(segFlavor) : L("all flavours", "semua perisa")}
                </p>
                <p className="mt-1 text-3xl font-bold tabular-nums">{segment.avg?.toFixed(2)} <span className="text-muted-foreground text-base font-normal">/ 5</span></p>
              </div>
              <p className="text-sm tabular-nums"><span className="font-semibold">{segment.n}</span> {L("reviews", "ulasan")}</p>
              <p className="text-sm tabular-nums"><span className="text-success font-semibold">{segment.pos}%</span> {L("positive", "positif")}</p>
              {segment.n < minSample && <span className={chipSmWarn}>{L(`fewer than ${minSample} — treat with care`, `kurang daripada ${minSample} — berhati-hati`)}</span>}
            </div>
          ) : (
            <p className="text-muted-foreground mt-3 text-sm">{L("No reviews match that combination yet.", "Belum ada ulasan yang sepadan dengan gabungan itu.")}</p>
          )}
        </div>
      </section>

      {/* ---- customer voice ---- */}
      <section className="space-y-3 md:space-y-4">
        <ZoneLabel>{L("Customer voice", "Suara pelanggan")}</ZoneLabel>
        <CustomerVoice flavors={flavors} />
      </section>

      {/* ---- insights ---- */}
      <section className="space-y-3 md:space-y-4">
        <ZoneLabel>{L("Insights", "Wawasan")}</ZoneLabel>
        {!loaded ? <div className={card}><Skel className="h-4 w-40" /><Skel className="mt-2 h-3 w-full" /><Skel className="mt-1 h-3 w-4/5" /></div> : <InsightsCard a={a} minSample={minSample} />}
      </section>
    </>
  );
}

/* ---- customer voice: real comments, grouped by flavour, four filters ---- */
function CustomerVoice({ flavors }: { flavors: Flavor[] }) {
  const [flavor, setFlavor] = useState(0);
  const [sentiment, setSentiment] = useState("");
  const [gender, setGender] = useState("");
  const [age, setAge] = useState("");
  const qs = [flavor ? `flavor=${flavor}` : "", sentiment ? `sentiment=${sentiment}` : "", gender ? `gender=${gender}` : "", age ? `age_group=${age}` : "", "sort=date&dir=desc"].filter(Boolean).join("&");
  const view = useCachedApi<{ reviews: Review[] }>(`/staff/criscikee/reviews?${qs}`, true, ["criscikee"]);
  const loaded = !view.loading;
  const grouped = useMemo(() => {
    const m = new Map<number, Review[]>();
    for (const r of view.data?.reviews ?? []) {
      const list = m.get(r.flavor_id) ?? [];
      if (list.length < 6) list.push(r);
      m.set(r.flavor_id, list);
    }
    return [...m.entries()].map(([id, list]) => ({ id, name: list[0]?.flavor_name ?? flavors.find((f) => f.id === id)?.name ?? "?", list }));
  }, [view.data, flavors]);

  return (
    <div className={card}>
      <div className="flex flex-wrap items-center gap-2">
        <select className={selectClass} value={flavor} onChange={(e) => setFlavor(Number(e.target.value))} aria-label={L("Flavour", "Perisa")}>
          <option value={0}>{L("All flavours", "Semua perisa")}</option>
          {flavors.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
        <select className={selectClass} value={sentiment} onChange={(e) => setSentiment(e.target.value)} aria-label={L("Sentiment", "Sentimen")}>
          <option value="">{L("Any sentiment", "Semua sentimen")}</option>
          {SENTIMENTS.map(([k]) => <option key={k} value={k}>{lbl(SENTIMENTS, k)}</option>)}
        </select>
        <select className={selectClass} value={gender} onChange={(e) => setGender(e.target.value)} aria-label={L("Gender", "Jantina")}>
          <option value="">{L("Any gender", "Semua jantina")}</option>
          {GENDERS.map(([k]) => <option key={k} value={k}>{lbl(GENDERS, k)}</option>)}
        </select>
        <select className={selectClass} value={age} onChange={(e) => setAge(e.target.value)} aria-label={L("Age group", "Kumpulan umur")}>
          <option value="">{L("Any age", "Semua umur")}</option>
          {AGE_GROUPS.map(([k]) => <option key={k} value={k}>{lbl(AGE_GROUPS, k)}</option>)}
        </select>
        <StaleHint show={view.stale} />
      </div>
      {!loaded ? (
        <div className="mt-3 space-y-2" aria-hidden>{Array.from({ length: 3 }, (_, i) => <div key={i}><Skel className="h-3.5 w-16" /><Skel className="mt-1 h-3 w-full" /><Skel className="mt-1 h-3 w-3/4" /></div>)}</div>
      ) : grouped.length === 0 ? (
        <p className="text-muted-foreground mt-3 text-sm">{L("Nothing said yet for that selection.", "Belum ada yang diperkatakan untuk pilihan itu.")}</p>
      ) : (
        <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2">
          {grouped.map((g) => (
            <div key={g.id}>
              <p className="text-sm font-semibold">{g.name}</p>
              <ul className="mt-1 space-y-2">
                {g.list.map((r) => (
                  <li key={r.id} className="border-border border-l-2 pl-3">
                    <p className="text-sm whitespace-pre-line">“{r.comment}”</p>
                    <p className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                      <Stars value={r.rating} /> <SentimentChip s={r.sentiment} source={r.sentiment_source} />
                      <span>· {lbl(GENDERS, r.gender)}, {lbl(AGE_GROUPS, r.age_group)} · {dmy(r.reviewed_on)}</span>
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---- insights: what the numbers say, and what they are not yet allowed to ---- */
function InsightsCard({ a, minSample }: { a: Analytics; minSample: number }) {
  const i = a.insights;
  const row = (label: string, body: React.ReactNode) => (
    <li className={listRow}><span className="text-muted-foreground text-xs">{label}</span><span className="text-sm font-medium text-right">{body}</span></li>
  );
  const none = <span className="text-muted-foreground font-normal">{L(`not yet — needs ${minSample}+ reviews`, `belum — perlukan ${minSample}+ ulasan`)}</span>;
  return (
    <div className={card}>
      <p className="text-muted-foreground text-xs">
        {L(`A flavour or a segment is only called best, most positive or most negative once it has at least ${minSample} reviews. Below that the figure is shown and the verdict is withheld — one five-star review is not a winning flavour.`,
           `Sesuatu perisa atau segmen hanya digelar terbaik, paling positif atau paling negatif apabila ada sekurang-kurangnya ${minSample} ulasan. Di bawah itu angka ditunjuk dan keputusan ditahan.`)}
      </p>
      <ul className="mt-2">
        {row(L("Best performing flavour", "Perisa prestasi terbaik"), i.best_rated ? <>{i.best_rated.flavor} <span className="text-muted-foreground font-normal">{i.best_rated.avg_rating.toFixed(2)} ★ · {i.best_rated.n}</span></> : none)}
        {row(L("Most popular flavour", "Perisa paling popular"), i.most_popular ? <>{i.most_popular.flavor} <span className="text-muted-foreground font-normal">{i.most_popular.n} {L("reviews", "ulasan")}</span></> : none)}
        {row(L("Most positive flavour", "Perisa paling positif"), i.most_positive ? <>{i.most_positive.flavor} <span className="text-success font-normal">{i.most_positive.positive_pct}%</span></> : none)}
        {row(L("Most negative flavour", "Perisa paling negatif"), i.most_negative ? <>{i.most_negative.flavor} <span className="text-danger font-normal">{i.most_negative.negative_pct}%</span></> : <span className="text-muted-foreground font-normal">{L("none with enough reviews", "tiada yang cukup ulasan")}</span>)}
        {GENDERS.map(([g]) => row(L(`Best flavour — ${lbl(GENDERS, g)}`, `Perisa terbaik — ${lbl(GENDERS, g)}`), i.best_by_gender[g] ? <>{i.best_by_gender[g]!.flavor} <span className="text-muted-foreground font-normal">{i.best_by_gender[g]!.avg_rating.toFixed(2)} ★ · {i.best_by_gender[g]!.n}</span></> : none))}
        {AGE_GROUPS.map(([ag]) => row(L(`Best flavour — ${lbl(AGE_GROUPS, ag)}`, `Perisa terbaik — ${lbl(AGE_GROUPS, ag)}`), i.best_by_age_group[ag] ? <>{i.best_by_age_group[ag]!.flavor} <span className="text-muted-foreground font-normal">{i.best_by_age_group[ag]!.avg_rating.toFixed(2)} ★ · {i.best_by_age_group[ag]!.n}</span></> : none))}
      </ul>
      <p className="mt-3 text-sm font-semibold">{L("Highest-opportunity segments", "Segmen peluang tertinggi")}</p>
      <p className="text-muted-foreground text-xs">{L(`Rated 4 or above with ${minSample}+ reviews — strong, and believed.`, `Dinilai 4 ke atas dengan ${minSample}+ ulasan — kukuh, dan dipercayai.`)}</p>
      {i.opportunity.length === 0 ? (
        <p className="text-muted-foreground mt-1 text-sm">{L("No segment has both a strong rating and enough reviews yet.", "Belum ada segmen dengan penilaian kukuh dan ulasan yang mencukupi.")}</p>
      ) : (
        <ul className="mt-1">
          {i.opportunity.map((o) => (
            <li key={`${o.flavor_id}-${o.gender}-${o.age_group}`} className={listRow}>
              <span className="text-sm">{lbl(GENDERS, o.gender)} / {lbl(AGE_GROUPS, o.age_group)} / <span className="font-semibold">{o.flavor}</span></span>
              <span className="text-xs tabular-nums"><span className="font-semibold">{o.avg_rating.toFixed(2)} ★</span> · {o.n} {L("reviews", "ulasan")} · <span className="text-success">{o.positive_pct}% {L("positive", "positif")}</span></span>
            </li>
          ))}
        </ul>
      )}
      {i.too_few.length > 0 && (
        <p className="text-muted-foreground mt-2 text-[11px]">
          {L("Shown but not ranked (too few reviews): ", "Ditunjuk tetapi tidak disenaraikan (ulasan terlalu sedikit): ")}
          {i.too_few.map((t) => `${t.flavor} (${t.n})`).join(", ")}
        </p>
      )}
    </div>
  );
}

/* ================= REVIEWS ================= */

type SortCol = "date" | "age" | "rating";
const EMPTY_FORM = { flavor_id: 0, age: "", gender: "", rating: 0, comment: "", impression: "", sentiment: "auto", reviewed_on: "" };
type Form = typeof EMPTY_FORM;

function ReviewsView({ flavors, canReview, canManage, toast, confirm, onFlavorsChanged }: {
  flavors: Flavor[]; canReview: boolean; canManage: boolean;
  toast: (title: string, sub?: string, variant?: "success" | "notice") => void;
  confirm: (o: { title: string; message?: string; confirmLabel?: string; variant?: "default" | "danger" }) => Promise<boolean>;
  onFlavorsChanged: () => void;
}) {
  /* ---- search + filters + sort, all server-side ---- */
  const [qLive, setQLive] = useState(""); const [q, setQ] = useState("");
  useEffect(() => { const t = window.setTimeout(() => setQ(qLive.trim()), 300); return () => window.clearTimeout(t); }, [qLive]);
  const [fFlavor, setFFlavor] = useState(0); const [fGender, setFGender] = useState(""); const [fAge, setFAge] = useState("");
  const [fRating, setFRating] = useState(0); const [fSent, setFSent] = useState(""); const [fImp, setFImp] = useState("");
  const [fFrom, setFFrom] = useState(""); const [fTo, setFTo] = useState("");
  const [sort, setSort] = useState<{ col: SortCol; asc: boolean }>({ col: "date", asc: false });
  const cycle = (col: SortCol) => setSort((s) => (s.col === col ? { col, asc: !s.asc } : { col, asc: col !== "date" }));
  const qs = [
    q ? `q=${encodeURIComponent(q)}` : "", fFlavor ? `flavor=${fFlavor}` : "", fGender ? `gender=${fGender}` : "", fAge ? `age_group=${fAge}` : "",
    fRating ? `rating=${fRating}` : "", fSent ? `sentiment=${fSent}` : "", fImp ? `impression=${fImp}` : "", fFrom ? `from=${fFrom}` : "", fTo ? `to=${fTo}` : "",
    `sort=${sort.col}&dir=${sort.asc ? "asc" : "desc"}`,
  ].filter(Boolean).join("&");
  const view = useCachedApi<{ reviews: Review[]; total: number; shown: number; pending_migration?: boolean }>(`/staff/criscikee/reviews?${qs}`, true, ["criscikee"]);
  const reviews = useMemo(() => view.data?.reviews ?? [], [view.data]);
  const loaded = !view.loading;
  const refresh = view.refresh;
  const load = useCallback(() => { refresh(); }, [refresh]);
  const anyFilter = Boolean(q || fFlavor || fGender || fAge || fRating || fSent || fImp || fFrom || fTo);
  const clearFilters = () => { setQLive(""); setFFlavor(0); setFGender(""); setFAge(""); setFRating(0); setFSent(""); setFImp(""); setFFrom(""); setFTo(""); };

  /* ---- the form ---- */
  const [openForm, setOpenForm] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<Form>({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [openRow, setOpenRow] = useState<number | null>(null);
  const activeFlavors = flavors.filter((f) => f.is_active);

  const startNew = () => { setEditId(null); setForm({ ...EMPTY_FORM, flavor_id: activeFlavors[0]?.id ?? 0, reviewed_on: mytToday() }); setOpenForm(true); };
  const startEdit = (r: Review) => {
    setEditId(r.id);
    setForm({ flavor_id: r.flavor_id, age: String(r.age), gender: r.gender, rating: r.rating, comment: r.comment, impression: r.impression, sentiment: r.sentiment_source === "manual" ? r.sentiment : "auto", reviewed_on: r.reviewed_on });
    setOpenForm(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const cancelForm = () => { setOpenForm(false); setEditId(null); setForm({ ...EMPTY_FORM }); };

  const save = async () => {
    const age = Number(form.age);
    if (!form.flavor_id) { toast(L("Not saved", "Tidak disimpan"), L("Pick a flavour", "Pilih perisa"), "notice"); return; }
    if (!Number.isInteger(age) || age < AGE_MIN || age > AGE_MAX) { toast(L("Not saved", "Tidak disimpan"), L(`Age must be a whole number between ${AGE_MIN} and ${AGE_MAX}`, `Umur mesti nombor bulat antara ${AGE_MIN} dan ${AGE_MAX}`), "notice"); return; }
    if (!form.gender) { toast(L("Not saved", "Tidak disimpan"), L("Pick a gender", "Pilih jantina"), "notice"); return; }
    if (!form.rating) { toast(L("Not saved", "Tidak disimpan"), L("Tap a star rating", "Ketik penilaian bintang"), "notice"); return; }
    if (!form.comment.trim()) { toast(L("Not saved", "Tidak disimpan"), L("The customer's comment is the WHY — it is required", "Komen pelanggan ialah SEBABNYA — ia diperlukan"), "notice"); return; }
    if (form.comment.length > COMMENT_MAX) { toast(L("Not saved", "Tidak disimpan"), L(`Comment is over ${COMMENT_MAX} characters`, `Komen melebihi ${COMMENT_MAX} aksara`), "notice"); return; }
    if (!form.impression) { toast(L("Not saved", "Tidak disimpan"), L("Pick an overall impression", "Pilih kesan keseluruhan"), "notice"); return; }
    setSaving(true);
    const payload = { flavor_id: form.flavor_id, age, gender: form.gender, rating: form.rating, comment: form.comment.trim(), impression: form.impression, sentiment: form.sentiment, reviewed_on: form.reviewed_on || undefined };
    const res = editId
      ? await api<{ ok?: boolean; sentiment?: string; error?: { message?: string } }>(`/reviews/${editId}`, { method: "PATCH", body: JSON.stringify(payload) })
      : await api<{ ok?: boolean; sentiment?: string; error?: { message?: string } }>(`/reviews`, { method: "POST", body: JSON.stringify(payload) });
    setSaving(false);
    if (!res.ok) { toast(L("Not saved", "Tidak disimpan"), res.data?.error?.message ?? L("Please try again", "Sila cuba lagi"), "notice"); return; }
    const s = res.data?.sentiment ? lbl(SENTIMENTS, res.data.sentiment) : "";
    toast(editId ? L("Review updated", "Ulasan dikemas kini") : L("Review saved", "Ulasan disimpan"),
      s ? L(`Sentiment: ${s}`, `Sentimen: ${s}`) : "");
    cancelForm(); load(); onFlavorsChanged();
  };

  const remove = async (r: Review) => {
    const ok = await confirm({
      title: L("Remove this review?", "Buang ulasan ini?"),
      message: L(`${r.flavor_name ?? ""} · ${r.rating}★ · “${r.comment.slice(0, 80)}${r.comment.length > 80 ? "…" : ""}”. It leaves every figure on the dashboard. The record is kept and the removal is written against your name.`,
                 `${r.flavor_name ?? ""} · ${r.rating}★ · “${r.comment.slice(0, 80)}${r.comment.length > 80 ? "…" : ""}”. Ia dikeluarkan daripada setiap angka. Rekod disimpan dan pembuangan dicatat atas nama anda.`),
      confirmLabel: L("Remove", "Buang"), variant: "danger",
    });
    if (!ok) return;
    const res = await api<{ ok?: boolean; error?: { message?: string } }>(`/reviews/${r.id}`, { method: "DELETE" });
    if (res.ok) { toast(L("Removed", "Dibuang"), L("The review no longer counts", "Ulasan itu tidak lagi dikira")); load(); onFlavorsChanged(); }
    else toast(L("Not removed", "Tidak dibuang"), res.data?.error?.message ?? "", "notice");
  };

  const ageN = Number(form.age);
  const agePreview = Number.isInteger(ageN) && ageN >= AGE_MIN && ageN <= AGE_MAX ? lbl(AGE_GROUPS, ageGroupOf(ageN)) : "";
  const sortHead = (col: SortCol, label: string, cls: string) => (
    <th className={`${cls} cursor-pointer select-none whitespace-nowrap`} title={L(`Sort by ${label} — click again to reverse`, `Isih ikut ${label} — klik lagi untuk terbalik`)} onClick={() => cycle(col)}>
      {label}{sort.col === col ? (sort.asc ? " ▲" : " ▼") : ""}
    </th>
  );

  return (
    <>
      {/* ---- the form ---- */}
      <section className="space-y-3 md:space-y-4">
        <ZoneLabel>{L("Record", "Rekod")}</ZoneLabel>
        <div className={card}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <PanelTitle icon="edit">{editId ? L("Edit review", "Sunting ulasan") : L("New customer review", "Ulasan pelanggan baharu")}</PanelTitle>
            {canReview ? (
              <button type="button" className={openForm ? btnGhost : btnClass} onClick={() => (openForm ? cancelForm() : startNew())}>
                {openForm ? (editId ? L("Cancel edit", "Batal sunting") : L("Hide form", "Sembunyi borang")) : L("+ Add review", "+ Tambah ulasan")}
              </button>
            ) : <span className="text-muted-foreground text-xs">{L("Your role can read reviews but not add them.", "Peranan anda boleh membaca ulasan tetapi tidak menambahnya.")}</span>}
          </div>
          {openForm && canReview && (
            <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
              <label className="block"><span className={fieldLabel}>{L("Flavour *", "Perisa *")}</span>
                <select className={inputClass} value={form.flavor_id} onChange={(e) => setForm((f) => ({ ...f, flavor_id: Number(e.target.value) }))}>
                  <option value={0}>{L("— pick —", "— pilih —")}</option>
                  {activeFlavors.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                  {editId && flavors.filter((f) => !f.is_active && f.id === form.flavor_id).map((f) => <option key={f.id} value={f.id}>{f.name} ({L("retired", "dihentikan")})</option>)}
                </select></label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block"><span className={fieldLabel}>{L("Age *", "Umur *")}</span>
                  <input type="number" inputMode="numeric" min={AGE_MIN} max={AGE_MAX} className={inputClass} value={form.age} placeholder="27"
                    onChange={(e) => setForm((f) => ({ ...f, age: e.target.value }))} />
                  <span className="text-muted-foreground mt-0.5 block text-[11px]">{agePreview ? L(`Age group: ${agePreview}`, `Kumpulan umur: ${agePreview}`) : L("age group fills itself", "kumpulan umur diisi sendiri")}</span></label>
                <label className="block"><span className={fieldLabel}>{L("Gender *", "Jantina *")}</span>
                  <select className={inputClass} value={form.gender} onChange={(e) => setForm((f) => ({ ...f, gender: e.target.value }))}>
                    <option value="">{L("— pick —", "— pilih —")}</option>
                    {GENDERS.map(([k]) => <option key={k} value={k}>{lbl(GENDERS, k)}</option>)}
                  </select></label>
              </div>
              <div className="block md:col-span-2"><span className={fieldLabel}>{L("Flavour rating *", "Penilaian perisa *")}</span>
                <RatingInput value={form.rating} onChange={(v) => setForm((f) => ({ ...f, rating: v }))} /></div>
              <label className="block md:col-span-2"><span className={fieldLabel}>{L("Customer's comment * — their words, exactly", "Komen pelanggan * — kata-kata mereka, tepat")}</span>
                <textarea className={`${inputClass} min-h-32 resize-y`} rows={5} maxLength={COMMENT_MAX} value={form.comment} placeholder={L("e.g. BBQ memang sedap, rasa dia ngam dan crispy.", "cth. BBQ memang sedap, rasa dia ngam dan crispy.")}
                  onChange={(e) => setForm((f) => ({ ...f, comment: e.target.value }))} />
                <span className="text-muted-foreground mt-0.5 flex justify-between gap-2 text-[11px]">
                  <span>{L("Enter starts a new line — a, b, c on separate lines is kept that way.", "Enter memulakan baris baharu — a, b, c pada baris berasingan dikekalkan begitu.")}</span>
                  <span className="tabular-nums">{form.comment.length}/{COMMENT_MAX}</span>
                </span></label>
              <label className="block"><span className={fieldLabel}>{L("Overall impression *", "Kesan keseluruhan *")}</span>
                <select className={inputClass} value={form.impression} onChange={(e) => setForm((f) => ({ ...f, impression: e.target.value }))}>
                  <option value="">{L("— pick —", "— pilih —")}</option>
                  {IMPRESSIONS.map(([k]) => <option key={k} value={k}>{lbl(IMPRESSIONS, k)}</option>)}
                </select></label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block"><span className={fieldLabel}>{L("Sentiment", "Sentimen")}</span>
                  <select className={inputClass} value={form.sentiment} onChange={(e) => setForm((f) => ({ ...f, sentiment: e.target.value }))}>
                    <option value="auto">{L("Auto — from the comment", "Auto — daripada komen")}</option>
                    {SENTIMENTS.map(([k]) => <option key={k} value={k}>{lbl(SENTIMENTS, k)} ({L("set by hand", "manual")})</option>)}
                  </select></label>
                <label className="block"><span className={fieldLabel}>{L("Date", "Tarikh")}</span>
                  <input type="date" className={inputClass} value={form.reviewed_on} max={mytToday()} onChange={(e) => setForm((f) => ({ ...f, reviewed_on: e.target.value }))} /></label>
              </div>
              <div className="flex flex-wrap items-center gap-2 md:col-span-2">
                <button type="button" className={btnClass} disabled={saving} onClick={() => void save()}>
                  {saving ? <Skel className="inline-block h-3 w-16" /> : editId ? L("Save changes", "Simpan perubahan") : L("Save review", "Simpan ulasan")}
                </button>
                <button type="button" className={btnGhost} onClick={cancelForm}>{L("Cancel", "Batal")}</button>
                <span className="text-muted-foreground text-[11px]">{L("The comment is read for sentiment when you save; you can overrule it.", "Komen dibaca untuk sentimen semasa disimpan; anda boleh mengatasinya.")}</span>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* ---- the list ---- */}
      <section className="space-y-3 md:space-y-4">
        <ZoneLabel>{L("Every review", "Setiap ulasan")}</ZoneLabel>
        <div className={card}>
          <div className="flex flex-wrap items-center gap-2">
            <input className={`${inputClassSm} w-56`} value={qLive} placeholder={L("Search comments or flavour", "Cari komen atau perisa")} aria-label={L("Search reviews", "Cari ulasan")} onChange={(e) => setQLive(e.target.value)} />
            <select className={selectClass} value={fFlavor} onChange={(e) => setFFlavor(Number(e.target.value))} aria-label={L("Flavour", "Perisa")}>
              <option value={0}>{L("Flavour: all", "Perisa: semua")}</option>{flavors.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
            <select className={selectClass} value={fGender} onChange={(e) => setFGender(e.target.value)} aria-label={L("Gender", "Jantina")}>
              <option value="">{L("Gender: all", "Jantina: semua")}</option>{GENDERS.map(([k]) => <option key={k} value={k}>{lbl(GENDERS, k)}</option>)}
            </select>
            <select className={selectClass} value={fAge} onChange={(e) => setFAge(e.target.value)} aria-label={L("Age group", "Kumpulan umur")}>
              <option value="">{L("Age: all", "Umur: semua")}</option>{AGE_GROUPS.map(([k]) => <option key={k} value={k}>{lbl(AGE_GROUPS, k)}</option>)}
            </select>
            <select className={selectClass} value={fRating} onChange={(e) => setFRating(Number(e.target.value))} aria-label={L("Rating", "Penilaian")}>
              <option value={0}>{L("Rating: all", "Penilaian: semua")}</option>{[5, 4, 3, 2, 1].map((r) => <option key={r} value={r}>{r} ★</option>)}
            </select>
            <select className={selectClass} value={fSent} onChange={(e) => setFSent(e.target.value)} aria-label={L("Sentiment", "Sentimen")}>
              <option value="">{L("Sentiment: all", "Sentimen: semua")}</option>{SENTIMENTS.map(([k]) => <option key={k} value={k}>{lbl(SENTIMENTS, k)}</option>)}
            </select>
            <select className={selectClass} value={fImp} onChange={(e) => setFImp(e.target.value)} aria-label={L("Impression", "Kesan")}>
              <option value="">{L("Impression: all", "Kesan: semua")}</option>{IMPRESSIONS.map(([k]) => <option key={k} value={k}>{lbl(IMPRESSIONS, k)}</option>)}
            </select>
            <input type="date" className={inputClassSm} value={fFrom} max={fTo || mytToday()} aria-label={L("From date", "Dari tarikh")} onChange={(e) => setFFrom(e.target.value)} />
            <input type="date" className={inputClassSm} value={fTo} min={fFrom || undefined} max={mytToday()} aria-label={L("To date", "Hingga tarikh")} onChange={(e) => setFTo(e.target.value)} />
            {anyFilter && <button type="button" className="text-muted-foreground text-xs underline" onClick={clearFilters}>{L("Clear", "Kosongkan")}</button>}
            <StaleHint show={view.stale} />
          </div>
          <p className="text-muted-foreground mt-2 text-xs tabular-nums">
            {loaded ? (anyFilter
              ? L(`${view.data?.shown ?? 0} of ${view.data?.total ?? 0} reviews match`, `${view.data?.shown ?? 0} daripada ${view.data?.total ?? 0} ulasan sepadan`)
              : L(`${view.data?.total ?? 0} reviews`, `${view.data?.total ?? 0} ulasan`)) : <Skel className="inline-block h-3 w-24" />}
            {loaded && (view.data?.shown ?? 0) >= 500 && <span className="text-warning ml-2">{L("showing the first 500 — narrow the filters to see the rest", "menunjukkan 500 pertama — sempitkan penapis")}</span>}
          </p>

          {!loaded ? (
            <div className="mt-2" aria-hidden>
              <div className="hidden md:block"><table className="w-full border-collapse text-xs"><thead><tr>{["Date", "Age", "Gender", "Flavour", "Rating", "Comment", "Sentiment"].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
                <tbody>{Array.from({ length: 5 }, (_, i) => <tr key={i} className="border-border border-t">{Array.from({ length: 7 }, (_, j) => <td key={j} className={td}><Skel className="h-3.5 w-16" /></td>)}</tr>)}</tbody></table></div>
              <ul className="space-y-2 md:hidden">{Array.from({ length: 4 }, (_, i) => <li key={i} className={insetCard}><Skel className="h-3.5 w-32" /><Skel className="mt-1.5 h-3 w-full" /><Skel className="mt-1 h-3 w-2/3" /></li>)}</ul>
            </div>
          ) : reviews.length === 0 ? (
            <p className="text-muted-foreground mt-3 text-sm">{anyFilter ? L("No reviews match those filters.", "Tiada ulasan sepadan dengan penapis itu.") : L("No reviews yet — add the first one above.", "Belum ada ulasan — tambah yang pertama di atas.")}</p>
          ) : (
            <>
              {/* phone: a list, from the same array */}
              <ul className="mt-3 space-y-2 md:hidden">
                {reviews.map((r) => (
                  <li key={r.id} className={insetCard}>
                    <div className="flex flex-wrap items-center justify-between gap-1">
                      <span className="text-sm font-semibold">{r.flavor_name ?? "?"}</span>
                      <Stars value={r.rating} />
                    </div>
                    <p className="mt-1 text-sm whitespace-pre-line">“{r.comment}”</p>
                    <p className="text-muted-foreground mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
                      <span>{dmy(r.reviewed_on)}</span><span>· {r.age}, {lbl(GENDERS, r.gender)} ({lbl(AGE_GROUPS, r.age_group)})</span>
                      <span className={IMP_CHIP[r.impression] ?? chipSmNeutral}>{lbl(IMPRESSIONS, r.impression)}</span>
                      <SentimentChip s={r.sentiment} source={r.sentiment_source} />
                    </p>
                    <div className={`${rowActions} mt-2`}>
                      <button type="button" className={rowBtn} onClick={() => setOpenRow(openRow === r.id ? null : r.id)}>{openRow === r.id ? L("Hide", "Sembunyi") : L("View", "Lihat")}</button>
                      {canReview && <button type="button" className={rowBtn} onClick={() => startEdit(r)}>{L("Edit", "Sunting")}</button>}
                      {canManage && <button type="button" className={rowBtnDanger} onClick={() => void remove(r)}>{L("Delete", "Padam")}</button>}
                    </div>
                    {openRow === r.id && <ReviewDetail r={r} />}
                  </li>
                ))}
              </ul>
              {/* desk: the table, from the same array */}
              <div className="mt-3 hidden max-h-[32rem] overflow-x-auto overflow-y-auto pr-1 md:block">
                <table className="tbl-sticky w-full min-w-[900px] border-collapse">
                  <thead><tr className="border-border border-b">
                    {sortHead("date", L("Date", "Tarikh"), th)}
                    {sortHead("age", L("Age", "Umur"), thR2)}
                    <th className={th}>{L("Gender", "Jantina")}</th>
                    <th className={th}>{L("Age group", "Kumpulan umur")}</th>
                    <th className={th}>{L("Flavour", "Perisa")}</th>
                    {sortHead("rating", L("Rating", "Penilaian"), th)}
                    <th className={th}>{L("Comment", "Komen")}</th>
                    <th className={th}>{L("Impression", "Kesan")}</th>
                    <th className={th}>{L("Sentiment", "Sentimen")}</th>
                    <th className={th}></th>
                  </tr></thead>
                  <tbody>
                    {reviews.map((r) => (
                      <tr key={r.id} className="border-border border-b align-top last:border-0">
                        <td className={`${td} whitespace-nowrap`}>{dmy(r.reviewed_on)}</td>
                        <td className={tdR2}>{r.age}</td>
                        <td className={td}>{lbl(GENDERS, r.gender)}</td>
                        <td className={`${td} whitespace-nowrap`}>{lbl(AGE_GROUPS, r.age_group)}</td>
                        <td className={`${td} font-medium`}>{r.flavor_name ?? "?"}</td>
                        <td className={td}><Stars value={r.rating} /></td>
                        <td className={`${td} max-w-md`}>
                          <span className={openRow === r.id ? "block whitespace-pre-line" : "line-clamp-2"}>“{r.comment}”</span>
                          {openRow === r.id && <ReviewDetail r={r} />}
                        </td>
                        <td className={td}><span className={IMP_CHIP[r.impression] ?? chipSmNeutral}>{lbl(IMPRESSIONS, r.impression)}</span></td>
                        <td className={td}><SentimentChip s={r.sentiment} source={r.sentiment_source} /></td>
                        <td className={`${td} whitespace-nowrap`}>
                          <div className={`${rowActions} flex-nowrap`}>
                            <button type="button" className={rowBtn} onClick={() => setOpenRow(openRow === r.id ? null : r.id)}>{openRow === r.id ? L("Hide", "Sembunyi") : L("View", "Lihat")}</button>
                            {canReview && <button type="button" className={rowBtn} onClick={() => startEdit(r)}>{L("Edit", "Sunting")}</button>}
                            {canManage && <button type="button" className={rowBtnDanger} onClick={() => void remove(r)}>{L("Delete", "Padam")}</button>}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </section>
    </>
  );
}

/** What "View" opens: the whole record, and WHY the machine said what it said. */
function ReviewDetail({ r }: { r: Review }) {
  return (
    <div className="text-muted-foreground mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px] sm:grid-cols-3">
      <p><span className="font-medium">{L("Recorded by", "Direkod oleh")}</span> {r.created_by_name ?? "—"}</p>
      <p><span className="font-medium">{L("Entered", "Dimasukkan")}</span> {dmy(r.created_at)}</p>
      <p><span className="font-medium">{L("Sentiment", "Sentimen")}</span> {lbl(SENTIMENTS, r.sentiment)} ({r.sentiment_source === "manual" ? L("set by hand", "manual") : L("auto", "auto")})</p>
      {r.sentiment_reasons && <p className="col-span-2 sm:col-span-3"><span className="font-medium">{L("Why", "Sebab")}</span> {r.sentiment_reasons}</p>}
    </div>
  );
}

/* ================= FLAVORS ================= */

function FlavorsView({ flavors, loaded, canManage, toast, reload }: {
  flavors: Flavor[]; loaded: boolean; canManage: boolean;
  toast: (title: string, sub?: string, variant?: "success" | "notice") => void; reload: () => void;
}) {
  const [name, setName] = useState(""); const [desc, setDesc] = useState("");
  const [editId, setEditId] = useState<number | null>(null);
  const [eName, setEName] = useState(""); const [eDesc, setEDesc] = useState("");
  const [busy, setBusy] = useState(false);

  const add = async () => {
    if (!name.trim()) { toast(L("Not added", "Tidak ditambah"), L("The flavour needs a name", "Perisa perlukan nama"), "notice"); return; }
    setBusy(true);
    const res = await api<{ ok?: boolean; error?: { message?: string } }>(`/flavors`, { method: "POST", body: JSON.stringify({ name: name.trim(), description: desc.trim() || null }) });
    setBusy(false);
    if (res.ok) { toast(L("Flavour added", "Perisa ditambah"), name.trim()); setName(""); setDesc(""); reload(); }
    else toast(L("Not added", "Tidak ditambah"), res.data?.error?.message ?? "", "notice");
  };
  const saveEdit = async (id: number) => {
    if (!eName.trim()) { toast(L("Not saved", "Tidak disimpan"), L("The flavour needs a name", "Perisa perlukan nama"), "notice"); return; }
    const res = await api<{ ok?: boolean; error?: { message?: string } }>(`/flavors/${id}`, { method: "PATCH", body: JSON.stringify({ name: eName.trim(), description: eDesc.trim() || null }) });
    if (res.ok) { toast(L("Flavour updated", "Perisa dikemas kini"), eName.trim()); setEditId(null); reload(); }
    else toast(L("Not saved", "Tidak disimpan"), res.data?.error?.message ?? "", "notice");
  };
  const toggle = async (f: Flavor) => {
    const res = await api<{ ok?: boolean; error?: { message?: string } }>(`/flavors/${f.id}`, { method: "PATCH", body: JSON.stringify({ is_active: !f.is_active }) });
    if (res.ok) toast(f.is_active ? L("Flavour retired", "Perisa dihentikan") : L("Flavour active", "Perisa aktif"),
      f.is_active ? L(`${f.name} is off the review form; its ${f.reviews} reviews stay in every figure`, `${f.name} dikeluarkan daripada borang; ${f.reviews} ulasannya kekal dalam setiap angka`) : f.name);
    else toast(L("Not changed", "Tidak diubah"), res.data?.error?.message ?? "", "notice");
    reload();
  };

  return (
    <section className="space-y-3 md:space-y-4">
      <ZoneLabel>{L("The product line", "Barisan produk")}</ZoneLabel>
      <div className={card}>
        <PanelTitle icon="package">{L("Flavours", "Perisa")}</PanelTitle>
        <p className="text-muted-foreground mt-1 text-xs">
          {L("A flavour is retired, never deleted — its reviews keep counting. Only active flavours appear on the review form.",
             "Perisa dihentikan, tidak dipadam — ulasannya terus dikira. Hanya perisa aktif muncul pada borang ulasan.")}
        </p>
        {canManage && (
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_2fr_auto] sm:items-end">
            <label className="block"><span className={fieldLabel}>{L("New flavour", "Perisa baharu")}</span>
              <input className={inputClass} value={name} placeholder={L("e.g. Salted Egg", "cth. Telur Masin")} onChange={(e) => setName(e.target.value)} /></label>
            <label className="block"><span className={fieldLabel}>{L("Description (optional)", "Keterangan (pilihan)")}</span>
              <input className={inputClass} value={desc} placeholder={L("what it tastes like", "bagaimana rasanya")} onChange={(e) => setDesc(e.target.value)} /></label>
            <button type="button" className={btnClass} disabled={busy} onClick={() => void add()}>{busy ? <Skel className="inline-block h-3 w-12" /> : L("Add", "Tambah")}</button>
          </div>
        )}
        {!loaded ? (
          <ul className="mt-3 space-y-2" aria-hidden>{Array.from({ length: 4 }, (_, i) => <li key={i} className={listRow}><Skel className="h-4 w-24" /><Skel className="h-4 w-16" /></li>)}</ul>
        ) : flavors.length === 0 ? (
          <p className="text-muted-foreground mt-3 text-sm">{L("No flavours yet.", "Belum ada perisa.")}</p>
        ) : (
          <ul className="mt-3">
            {flavors.map((f) => (
              <li key={f.id} className={listRow}>
                {editId === f.id ? (
                  <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-[1fr_2fr_auto] sm:items-center">
                    <input className={inputClassSm} value={eName} onChange={(e) => setEName(e.target.value)} aria-label={L("Name", "Nama")} />
                    <input className={inputClassSm} value={eDesc} onChange={(e) => setEDesc(e.target.value)} aria-label={L("Description", "Keterangan")} />
                    <div className={rowActions}>
                      <button type="button" className={rowBtnPrimary} onClick={() => void saveEdit(f.id)}>{L("Save", "Simpan")}</button>
                      <button type="button" className={rowBtn} onClick={() => setEditId(null)}>{L("Cancel", "Batal")}</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{f.name} {f.is_active ? <span className={chipSmSuccess}>{L("active", "aktif")}</span> : <span className={chipSmNeutral}>{L("retired", "dihentikan")}</span>}</p>
                      <p className="text-muted-foreground text-xs">{f.description || L("no description", "tiada keterangan")} · {f.reviews} {L("reviews", "ulasan")}</p>
                    </div>
                    {canManage && (
                      <div className={rowActions}>
                        <button type="button" className={rowBtn} onClick={() => { setEditId(f.id); setEName(f.name); setEDesc(f.description ?? ""); }}>{L("Edit", "Sunting")}</button>
                        <button type="button" className={f.is_active ? rowBtnDanger : btnSmPrimary} onClick={() => void toggle(f)}
                          title={f.is_active ? L("Take it off the review form; reviews are kept", "Keluarkan daripada borang; ulasan disimpan") : L("Put it back on the review form", "Kembalikan ke borang")}>
                          {f.is_active ? L("Retire", "Hentikan") : L("Activate", "Aktifkan")}
                        </button>
                      </div>
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

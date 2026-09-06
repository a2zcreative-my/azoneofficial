"use client";

/* Moved verbatim from app/portal/page.tsx in v1.114.0 (housekeeping: the
   605 KB page split by domain). Nothing here was rewritten; only the imports
   at the top are new and the declarations are exported. */
import { L, User } from "@/components/portal/page-shared";
import { BusinessLinesCard, SalesHistoryCard } from "@/components/portal/sales";
import { useSaveToast } from "@/components/ui/save-toast";
import { Skel, SkelRows } from "@/components/ui/skeleton";
import { MiniBar } from "@/components/ui/stat-card";
import { useLiveRefresh } from "@/hooks/use-live-refresh";
import { api } from "@/lib/api";
import { fmtRM, ym } from "@/lib/format";
import { firstName, properName } from "@/lib/names";
import { bySeniority } from "@/lib/staff-order";
import { btnClass, btnSm, btnSmPrimary, card, inputClass } from "@/lib/ui-styles";
import { useCallback, useEffect, useState } from "react";

/* ================= v1.6.0 — Leaderboard + targets/commission ================ */

export const TARGET_ADMIN_ROLES = ["super_admin", "admin", "ceo", "coo", "cco"];

export interface LeaderRow {
  user_id: number;
  name: string;
  role: string;
  photo_key: string | null;
  sales_cents: number;
  target_cents: number | null;
  pct: number | null;
  commission_cents: number;
  rank: number | null;
}

/** The sales leaderboard — attributed sales per person this month, progress to
    target, and the commission the active rules would pay. The motivational
    heart of the sales floor. */
/* v1.64.3: `compact` renders the board for the 240px column beside the
   Operations map — same data, same order, no card chrome. What goes is the
   progress bar and the long attribution paragraph, neither of which survives
   that width; the paragraph moves to the row tooltip so the explanation is
   one hover away rather than gone. */
export function LeaderboardCard({ user, compact }: { user: User; compact?: boolean }) {
  const [rows, setRows] = useState<LeaderRow[] | null>(null);
  const [hasRules, setHasRules] = useState(false);
  const canSeeCommission = TARGET_ADMIN_ROLES.includes(user.role);
  /* v1.65.0: lifted out of the effect so the live hook can re-run it. The
     board moves when an order lands, when a live session is logged and when
     a commission rule changes — several topics, one loader. */
  const load = useCallback(() => {
    void api<{ rows: LeaderRow[]; has_rules: boolean }>(
      `/staff/leaderboard`
    ).then((r) => {
      if (r.ok && r.data) {
        setRows(r.data.rows);
        setHasRules(r.data.has_rules);
      } else setRows([]);
    });
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  useLiveRefresh(["orders", "sales", "live-sessions", "targets", "commission"], load);
  /* v1.25.5: unknown until proven empty — a skeleton while the board loads,
     never a blank hole where the card should be. */
  if (!rows) {
    return (
      <div className={compact ? "border-border rounded-xl border p-3" : card}>
        <Skel className={compact ? "h-4 w-32" : "h-4 w-56"} />
        <Skel className="mt-1.5 h-3 w-full max-w-md" />
        <div className="mt-3 space-y-1.5">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-2 px-2 py-1.5">
              <Skel className="h-6 w-6 rounded-full" />
              <Skel className="h-3.5 flex-1" />
              <Skel className="hidden h-2 w-28 sm:block" />
              <Skel className="h-3.5 w-20" />
            </div>
          ))}
        </div>
      </div>
    );
  }
  /* v1.25.5: no emoji in the UI — ranks are a gold badge for the podium and a
     plain #n below it. An unranked line (no attributed sales yet) shows a
     dash: the person is on the board, they just have not sold this month. */
  const w = compact ? "w-5" : "w-7";
  const rankBadge = (rank: number | null) => {
    if (rank === null)
      return (
        <span className={`text-muted-foreground ${w} shrink-0 text-center text-xs`}>
          —
        </span>
      );
    if (rank <= 3) {
      const tone =
        rank === 1
          ? "bg-gold-solid text-white"
          : rank === 2
            ? "bg-gold-soft text-gold-deep"
            : "bg-secondary text-gold-deep";
      return (
        <span className={`flex ${w} shrink-0 justify-center`}>
          <span
            className={`grid place-items-center rounded-full font-bold tabular-nums ${compact ? "h-5 w-5 text-[10px]" : "h-6 w-6 text-[11px]"} ${tone}`}
          >
            {rank}
          </span>
        </span>
      );
    }
    return (
      <span className={`text-muted-foreground ${w} shrink-0 text-center text-xs tabular-nums`}>
        #{rank}
      </span>
    );
  };
  const top = rows[0]?.sales_cents ?? 0;
  const why = L(
    "Attributed sales per person: paid invoices they closed, TikTok GMV during their live sessions, walk-in sales they recorded — and for sales marketing, TikTok orders that land while they are clocked in (split when several are on shift). Sales, live and CCO are always listed, even at RM 0.00.",
    "Jualan yang dikaitkan bagi setiap orang: invois dibayar yang mereka tutup, GMV TikTok semasa sesi LIVE mereka, jualan walk-in yang mereka rekodkan — dan bagi sales marketing, pesanan TikTok yang masuk semasa mereka daftar masuk (dibahagi apabila beberapa orang bertugas). Jualan, LIVE dan CCO sentiasa disenaraikan, walaupun RM 0.00."
  );

  /* ---- the narrow board that lives beside the map ---- */
  if (compact) {
    return (
      <div className="border-border rounded-xl border p-3">
        <p className="text-sm font-semibold">
          {L("Sales leaderboard", "Papan pendahulu jualan")}
        </p>
        <p className="text-muted-foreground text-[11px]" title={why}>
          {L("This month, attributed per person.", "Bulan ini, dikaitkan setiap orang.")}
        </p>
        {rows.length === 0 ? (
          <p className="text-muted-foreground mt-2 text-xs">
            {L("Nobody on the board yet.", "Belum ada sesiapa di papan.")}
          </p>
        ) : (
          <div className="mt-2 -mx-1 space-y-0.5">
            {rows.map((r) => {
              const isMe = r.user_id === user.id;
              return (
                <div
                  key={r.user_id}
                  title={`${r.name} · ${r.role.replace(/_/g, " ")} · ${fmtRM(r.sales_cents)}`}
                  className={`flex items-center gap-1.5 rounded-md px-1 py-1 text-xs ${isMe ? "bg-gold-soft/50 ring-gold ring-1" : ""}`}
                >
                  {rankBadge(r.rank)}
                  <span className="min-w-0 flex-1 truncate">
                    <span className={r.rank === null ? "text-muted-foreground" : "font-medium"}>
                      {firstName(r.name)}
                    </span>
                    {canSeeCommission && r.commission_cents > 0 && (
                      <span className="text-gold-deep ml-1 text-[10px] tabular-nums">
                        +{fmtRM(r.commission_cents)}
                      </span>
                    )}
                  </span>
                  <span
                    className={`shrink-0 text-right tabular-nums ${r.rank === null ? "text-muted-foreground" : "font-semibold"}`}
                  >
                    {fmtRM(r.sales_cents)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
        {canSeeCommission && !hasRules && rows.length > 0 && (
          <p className="text-muted-foreground mt-1.5 text-[10px]">
            {L("Add a commission rule to show payouts.", "Tambah peraturan komisen untuk memaparkan bayaran.")}
          </p>
        )}
      </div>
    );
  }
  return (
    <div className={card}>
      <p className="text-sm font-semibold">
        {L(
          "Sales leaderboard — this month",
          "Papan pendahulu jualan — bulan ini"
        )}
      </p>
      <p className="text-muted-foreground mt-0.5 text-xs">
        {L(
          "Attributed sales per person: paid invoices they closed, TikTok GMV during their live sessions, walk-in sales they recorded — and for sales marketing, TikTok orders that land while they are clocked in (split when several are on shift). Sales, live and CCO are always listed, even at RM 0.00.",
          "Jualan yang dikaitkan bagi setiap orang: invois dibayar yang mereka tutup, GMV TikTok semasa sesi LIVE mereka, jualan walk-in yang mereka rekodkan — dan bagi sales marketing, pesanan TikTok yang masuk semasa mereka daftar masuk (dibahagi apabila beberapa orang bertugas). Jualan, LIVE dan CCO sentiasa disenaraikan, walaupun RM 0.00."
        )}
      </p>
      {rows.length === 0 ? (
        <p className="text-muted-foreground mt-3 text-sm">
          {L(
            "No sales staff on the board yet — assign a sales or live-host role and the board fills as orders land and lives run.",
            "Belum ada kakitangan jualan di papan — tetapkan peranan jualan atau hos LIVE dan papan akan terisi apabila pesanan masuk dan LIVE berjalan."
          )}
        </p>
      ) : (
        <div className="mt-3 space-y-1.5">
          {rows.map((r) => {
            const isMe = r.user_id === user.id;
            return (
              <div
                key={r.user_id}
                className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm ${isMe ? "bg-gold-soft/50 ring-gold ring-1" : r.rank !== null && r.rank <= 3 ? "bg-secondary/60" : ""}`}
              >
                {rankBadge(r.rank)}
                <span className="min-w-0 flex-1 truncate">
                  <span
                    className={`font-medium ${r.rank === null ? "text-muted-foreground" : ""}`}
                  >
                    {r.name}
                  </span>
                  {isMe && (
                    <span className="text-gold-deep ml-1 text-[11px] font-semibold">
                      {L("you", "anda")}
                    </span>
                  )}
                  <span className="text-muted-foreground ml-1.5 text-[11px] capitalize">
                    {r.role.replace(/_/g, " ")}
                  </span>
                </span>
                <span className="hidden w-28 shrink-0 sm:block">
                  <MiniBar
                    pct={top > 0 ? (r.sales_cents / top) * 100 : 0}
                    tone={r.rank === 1 ? "green" : "gold"}
                  />
                </span>
                <span
                  className={`w-24 shrink-0 text-right font-semibold tabular-nums ${r.rank === null ? "text-muted-foreground font-normal" : ""}`}
                >
                  {fmtRM(r.sales_cents)}
                </span>
                {r.pct !== null && (
                  <span
                    className={`hidden w-12 shrink-0 text-right text-xs tabular-nums sm:block ${r.pct >= 100 ? "text-bull font-semibold" : "text-muted-foreground"}`}
                  >
                    {r.pct}%
                  </span>
                )}
                {canSeeCommission && r.commission_cents > 0 && (
                  <span
                    className="text-gold-deep w-20 shrink-0 text-right text-xs tabular-nums"
                    title={L(
                      "commission the active rules would pay",
                      "komisen yang akan dibayar oleh peraturan aktif"
                    )}
                  >
                    +{fmtRM(r.commission_cents)}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
      {canSeeCommission && !hasRules && rows.length > 0 && (
        <p className="text-muted-foreground mt-2 text-[11px]">
          {L(
            "Add a commission rule below to show each person's payout here.",
            "Tambah peraturan komisen di bawah untuk memaparkan bayaran setiap orang di sini."
          )}
        </p>
      )}
    </div>
  );
}

export interface CommRule {
  id: number;
  name: string;
  base_pct: number;
  bonus_pct: number;
  applies_to: string;
  active: number;
}

/* v1.64.3 (CEO: "Sales history ... Business lines ... should combine into 1
   card of Targets & commission for minimalist"): three cards that all answer
   "how is the money doing and who is paid for it" became one card with three
   tabs. Three headers, three borders and roughly six hundred pixels of the
   Ecommerce tab go with them.

   All three stay MOUNTED and are hidden with CSS rather than unmounted on a
   tab switch. Unmounting would refetch on every click and — worse — throw
   away a half-typed target. Same three requests as before, once, on load.

   The card is shown to everyone with revenue access, but the Targets tab
   only exists for TARGET_ADMIN_ROLES. Before this change, history and
   business lines were visible to the wider REVENUE_ROLES; folding them into
   an admin-only card would have quietly taken them away from people who
   could see them yesterday. */
export function MoneyCard({ user }: { user: User }) {
  const canTargets = TARGET_ADMIN_ROLES.includes(user.role);
  const tabs: { k: "targets" | "history" | "lines"; label: string }[] = [
    ...(canTargets
      ? [{ k: "targets" as const, label: L("Targets & commission", "Sasaran & komisen") }]
      : []),
    { k: "history", label: L("Sales history", "Sejarah jualan") },
    { k: "lines", label: L("Business lines", "Bidang perniagaan") },
  ];
  const [tab, setTab] = useState<"targets" | "history" | "lines">(
    canTargets ? "targets" : "history"
  );

  return (
    <div className={card}>
      <div className="flex flex-wrap items-center gap-1">
        {tabs.map((t) => (
          <button
            key={t.k}
            type="button"
            className={`${btnSm} ${tab === t.k ? "!bg-primary !text-primary-foreground" : ""}`}
            onClick={() => setTab(t.k)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {canTargets && (
        <div className={tab === "targets" ? "mt-3" : "hidden"}>
          <TargetsCommissionCard bare />
        </div>
      )}
      <div className={tab === "history" ? "mt-3" : "hidden"}>
        <SalesHistoryCard bare />
      </div>
      <div className={tab === "lines" ? "mt-3" : "hidden"}>
        <BusinessLinesCard bare />
      </div>
    </div>
  );
}

/** Management: per-person & per-team targets, and commission rules. */
export function TargetsCommissionCard({ bare }: { bare?: boolean } = {}) {
  const month = new Date(Date.now() + 8 * 3600 * 1000)
    .toISOString()
    .slice(0, 7);
  const [staff, setStaff] = useState<
    { id: number; name: string; role: string; position?: string | null; employment_status?: string | null }[]
  >([]);
  const [userTargets, setUserTargets] = useState<Record<number, number>>({});
  const [teamTargets, setTeamTargets] = useState<Record<string, number>>({});
  /* v1.92.0 (CEO: "it should have a save button") — what is typed, kept
     apart from what is stored. A field used to save itself on blur, which
     is a form nobody can review before it commits; now every box is a draft
     and one button writes the ones that changed. */
  const [draftU, setDraftU] = useState<Record<number, string>>({});
  const [draftT, setDraftT] = useState<Record<string, string>>({});
  const [savingT, setSavingT] = useState(false);
  const [rules, setRules] = useState<CommRule[] | null>(null);
  const [draft, setDraft] = useState({
    name: "",
    base_pct: "",
    bonus_pct: "",
    applies_to: "all",
  });
  const { show: showToast, node: toastNode } = useSaveToast();
  /* v1.77.0 — skeleton until the first fetch lands (targets and rules are
     two requests; each region clears its own skeleton). */
  const [loaded, setLoaded] = useState(false);
  const [rulesLoaded, setRulesLoaded] = useState(false);

  const loadTargets = useCallback(() => {
    void api<{
      staff: { id: number; name: string; role: string }[];
      user_targets: { user_id: number; target_cents: number }[];
      team_targets: { team: string; target_cents: number }[];
    }>(`/staff/targets?month=${month}`).then((r) => {
      if (r.ok && r.data) {
        setStaff([...r.data.staff].sort(bySeniority));
        const u = Object.fromEntries(r.data.user_targets.map((t) => [t.user_id, t.target_cents]));
        const tt = Object.fromEntries(r.data.team_targets.map((t) => [t.team, t.target_cents]));
        setUserTargets(u);
        setTeamTargets(tt);
        setDraftU(Object.fromEntries(Object.entries(u).map(([k, v]) => [k, String(v / 100)])));
        setDraftT(Object.fromEntries(Object.entries(tt).map(([k, v]) => [k, String(v / 100)])));
      }
      setLoaded(true);
    });
  }, [month]);
  const loadRules = useCallback(() => {
    void api<{ rules: CommRule[] }>(`/staff/commission/rules`).then((r) => {
      if (r.ok && r.data) setRules(r.data.rules);
      setRulesLoaded(true);
    });
  }, []);
  useEffect(() => {
    loadTargets();
    loadRules();
  }, [loadTargets, loadRules]);
  /* Two loaders, one topic each. A rule added on another screen appears here
     without anyone reloading the tab. */
  useLiveRefresh(["targets"], loadTargets);
  useLiveRefresh(["commission"], loadRules);

  /* The boxes whose draft differs from what is stored. An emptied box is
     not a change: a target is set or raised here, and nothing here removes
     one, so a blank stays whatever the server holds. */
  const changed = (): { scope: "user" | "team"; id: number | string; cents: number; label: string }[] => {
    const out: { scope: "user" | "team"; id: number | string; cents: number; label: string }[] = [];
    for (const p of staff) {
      const v = (draftU[p.id] ?? "").trim();
      if (!v) continue;
      const cents = Math.round(Number(v) * 100);
      if (!Number.isFinite(cents) || cents < 0) continue;
      if (cents !== (userTargets[p.id] ?? -1)) out.push({ scope: "user", id: p.id, cents, label: firstName(p.name) });
    }
    for (const team of ["sales", "live"]) {
      const v = (draftT[team] ?? "").trim();
      if (!v) continue;
      const cents = Math.round(Number(v) * 100);
      if (!Number.isFinite(cents) || cents < 0) continue;
      if (cents !== (teamTargets[team] ?? -1)) out.push({ scope: "team", id: team, cents, label: team });
    }
    return out;
  };
  const pendingTargets = changed();
  const saveTargets = async () => {
    const list = changed();
    if (list.length === 0) {
      showToast(L("No change", "Tiada perubahan"), L("Nothing differs from what is saved", "Tiada yang berbeza daripada yang disimpan"), "notice");
      return;
    }
    setSavingT(true);
    const failed: string[] = [];
    for (const c of list) {
      const res = await api<{ error?: { message?: string } }>(`/staff/targets`, {
        method: "POST",
        body: JSON.stringify({ scope: c.scope, id: c.id, month, target_cents: c.cents }),
      });
      if (!res.ok) failed.push(`${c.label}${res.data?.error?.message ? ` (${res.data.error.message})` : ""}`);
    }
    setSavingT(false);
    if (failed.length) {
      showToast(L("Partly saved", "Disimpan sebahagian"), `${L("Not saved", "Tidak disimpan")}: ${failed.join(", ")}`, "notice");
    } else {
      showToast(L("Saved", "Disimpan"), `${list.length} ${L("target(s) set for", "sasaran ditetapkan untuk")} ${ym(month)}`);
    }
    loadTargets();
  };

  return (
    <div className={bare ? "" : card}>
      {toastNode}
      {!bare && (
        <p className="text-sm font-semibold">
          {L("Targets & commission", "Sasaran & komisen")} — {ym(month)}
        </p>
      )}
      <p className="text-muted-foreground mt-0.5 text-xs">
        {L(
          "Set each person's and each team's monthly goal, and the commission rules that pay them. Feeds the leaderboard and the dashboard.",
          "Tetapkan matlamat bulanan setiap orang dan setiap pasukan, serta peraturan komisen yang membayar mereka. Menyalur ke papan pendahulu dan papan pemuka."
        )}
      </p>

      <div className="mt-3">
        <p className="text-muted-foreground text-[10px] font-semibold tracking-wider uppercase">
          {L("Per-person targets (RM)", "Sasaran individu (RM)")}
        </p>
        {/* v1.21.1 (CEO: "should not so much row like this"): a labelled
            grid — the whole floor fits in two or three short rows instead
            of one full-width input per person. */}
        <div className="mt-1.5 grid grid-cols-1 gap-x-3 gap-y-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {/* v1.77.0 — skeleton until the first fetch lands: label + input
              per person, in the same grid. */}
          {!loaded &&
            Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="min-w-0" aria-hidden>
                <Skel className="mb-1 h-2.5 w-2/3" />
                <Skel className="h-8 w-full" />
              </div>
            ))}
          {loaded && staff.map((s) => (
            <label key={s.id} className="block min-w-0">
              <span
                className="text-muted-foreground mb-0.5 block truncate text-[11px] font-medium"
                title={s.name}
              >
                {properName(s.name)}{" "}
                <span className="capitalize">
                  · {s.role.replace(/_/g, " ")}
                </span>
              </span>
              <input
                type="number"
                min={0}
                step="100"
                className={`${inputClass} h-8 text-xs ${pendingTargets.some((c) => c.scope === "user" && c.id === s.id) ? "ring-warning ring-2" : ""}`}
                value={draftU[s.id] ?? ""}
                placeholder={L("e.g. 8000", "cth. 8000")}
                onChange={(e) => setDraftU((d) => ({ ...d, [s.id]: e.target.value }))}
              />
            </label>
          ))}
          {loaded && staff.length === 0 && (
            <p className="text-muted-foreground text-xs">
              {L(
                "No staff to target yet.",
                "Belum ada kakitangan untuk disasarkan."
              )}
            </p>
          )}
        </div>
      </div>

      <div className="mt-3">
        <p className="text-muted-foreground text-[10px] font-semibold tracking-wider uppercase">
          {L("Team targets (RM)", "Sasaran pasukan (RM)")}
        </p>
        <div className="mt-1.5 flex flex-wrap gap-3">
          {["sales", "live"].map((team) => (
            <label key={team} className="flex items-center gap-2 text-sm">
              <span className="capitalize">
                {team === "sales" ? L("sales", "jualan") : team}
              </span>
              {/* v1.77.0 — the input is uncontrolled (defaultValue), so it
                  must not mount before the stored target is known. */}
              {!loaded ? (
                <Skel className="h-8 w-32" />
              ) : (
              <input
                type="number"
                min={0}
                step="100"
                className={`${inputClass} h-8 w-32 text-xs ${pendingTargets.some((c) => c.scope === "team" && c.id === team) ? "ring-warning ring-2" : ""}`}
                value={draftT[team] ?? ""}
                placeholder={L("team goal", "sasaran pasukan")}
                onChange={(e) => setDraftT((d) => ({ ...d, [team]: e.target.value }))}
              />
              )}
            </label>
          ))}
          {/* v1.92.0 — one button for every box above; it says how many
              will be written, and the boxes that will be are ringed. */}
          {loaded && (
            <button type="button" className={btnClass} disabled={savingT || pendingTargets.length === 0}
              onClick={() => void saveTargets()}>
              {savingT ? <Skel className="inline-block h-3 w-16" /> : pendingTargets.length
                ? `${L("Save targets", "Simpan sasaran")} (${pendingTargets.length})`
                : L("Save targets", "Simpan sasaran")}
            </button>
          )}
        </div>
      </div>

      <div className="border-border mt-4 border-t pt-3">
        <p className="text-muted-foreground text-[10px] font-semibold tracking-wider uppercase">
          {L("Commission rules", "Peraturan komisen")}
        </p>
        <div className="mt-1.5 space-y-1">
          {/* v1.77.0 — skeleton until the first fetch lands. */}
          {!rulesLoaded && <SkelRows rows={2} />}
          {rulesLoaded && (rules ?? []).map((r) => (
            <div
              key={r.id}
              className="flex flex-wrap items-center gap-2 text-sm"
            >
              <span className="min-w-0 flex-1 truncate">
                <span className="font-medium">{r.name}</span>
                <span className="text-muted-foreground ml-1.5 text-xs">
                  {L(`${r.base_pct}% base`, `${r.base_pct}% asas`)}
                  {r.bonus_pct
                    ? L(
                        ` + ${r.bonus_pct}% over target`,
                        ` + ${r.bonus_pct}% melebihi sasaran`
                      )
                    : ""}{" "}
                  ·{" "}
                  {r.applies_to === "all"
                    ? L("everyone", "semua")
                    : r.applies_to.replace(/_/g, " ")}
                </span>
              </span>
              <button
                type="button"
                className={btnSm}
                onClick={async () => {
                  await api(`/staff/commission/rules/${r.id}`, {
                    method: "PATCH",
                    body: JSON.stringify({ active: r.active ? 0 : 1 }),
                  });
                  loadRules();
                }}
              >
                {r.active ? L("On", "Hidup") : L("Off", "Mati")}
              </button>
              <button
                type="button"
                className={`${btnSm} text-destructive`}
                onClick={async () => {
                  /* v1.77.0 — a rule that pays commission, removed in
                     silence. Both outcomes are spoken now. */
                  const res = await api<{ error?: { message?: string } }>(
                    `/staff/commission/rules/${r.id}`,
                    { method: "DELETE" },
                  );
                  showToast(
                    res.ok ? L("Rule removed", "Peraturan dibuang") : L("Not removed", "Tidak dibuang"),
                    res.ok
                      ? L("It no longer applies to new commission.", "Ia tidak lagi digunakan untuk komisen baharu.")
                      : (res.data?.error?.message ?? L("The server refused that", "Pelayan menolaknya")),
                    res.ok ? undefined : "notice",
                  );
                  loadRules();
                }}
              >
                {L("Remove", "Buang")}
              </button>
            </div>
          ))}
          {rulesLoaded && rules && rules.length === 0 && (
            <p className="text-muted-foreground text-xs">
              {L(
                "No rules yet — add one below (e.g. 1.5% base + 3% over target).",
                "Tiada peraturan lagi — tambah satu di bawah (cth. 1.5% asas + 3% melebihi sasaran)."
              )}
            </p>
          )}
        </div>
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <input
            className={`${inputClass} h-8 w-40 text-xs`}
            placeholder={L("Rule name", "Nama peraturan")}
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
          <label className="text-xs">
            {L("base %", "% asas")}
            <input
              type="number"
              min={0}
              max={100}
              step="0.1"
              className={`${inputClass} ml-1 h-8 w-16 text-xs`}
              value={draft.base_pct}
              onChange={(e) => setDraft({ ...draft, base_pct: e.target.value })}
            />
          </label>
          <label className="text-xs">
            {L("bonus %", "% bonus")}
            <input
              type="number"
              min={0}
              max={100}
              step="0.1"
              className={`${inputClass} ml-1 h-8 w-16 text-xs`}
              value={draft.bonus_pct}
              onChange={(e) =>
                setDraft({ ...draft, bonus_pct: e.target.value })
              }
            />
          </label>
          <button
            type="button"
            className={btnSmPrimary}
            disabled={!draft.name || !draft.base_pct}
            onClick={async () => {
              const res = await api(`/staff/commission/rules`, {
                method: "POST",
                body: JSON.stringify({
                  name: draft.name,
                  base_pct: Number(draft.base_pct),
                  bonus_pct: Number(draft.bonus_pct || 0),
                  applies_to: draft.applies_to,
                }),
              });
              if (res.ok) {
                setDraft({
                  name: "",
                  base_pct: "",
                  bonus_pct: "",
                  applies_to: "all",
                });
                showToast(
                  L("Saved", "Disimpan"),
                  L("Commission rule added", "Peraturan komisen ditambah")
                );
                loadRules();
              }
            }}
          >
            {L("Add rule", "Tambah peraturan")}
          </button>
        </div>
      </div>
    </div>
  );
}

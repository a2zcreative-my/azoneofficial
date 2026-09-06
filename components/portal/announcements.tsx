"use client";

/* Moved verbatim from app/portal/page.tsx in v1.114.0 (housekeeping: the
   605 KB page split by domain). Nothing here was rewritten; only the imports
   at the top are new and the declarations are exported. */
import { Sub } from "@/components/portal/leave";
import { Announcement, L, MANAGE_ROLES, User, annCatL } from "@/components/portal/page-shared";
import { SkelCard } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { useCachedApi } from "@/lib/cached-api";
import { dmy } from "@/lib/format";
import { btnClass, btnGhost, card, inputClass } from "@/lib/ui-styles";
import { ReactNode, useCallback, useMemo, useState } from "react";

/* ================= Announcements ================= */

/* v1.4.215 (CEO pasted his real internal memo): Malay month names for the
   memo's default Tarikh line. */
export const MS_MONTHS = [
  "Januari",
  "Februari",
  "Mac",
  "April",
  "Mei",
  "Jun",
  "Julai",
  "Ogos",
  "September",
  "Oktober",
  "November",
  "Disember",
];
export const todayMalay = () => {
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  return `${d.getUTCDate()} ${MS_MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};

/* v1.4.215: renders an announcement body the way the CEO's memo reads —
   "Label: value" lines get a bold label, consecutive "* " lines become a
   real bullet list, everything else stays a paragraph. Plain bodies
   render exactly as before (they simply contain no label/bullet lines). */
export function MemoBody({ body }: { body: string }) {
  const lines = body.split("\n");
  const out: ReactNode[] = [];
  let bullets: string[] = [];
  const flush = () => {
    if (bullets.length > 0) {
      out.push(
        <ul key={`ul${out.length}`} className="my-1 list-disc space-y-0.5 pl-5">
          {bullets.map((b, i) => (
            <li key={i}>{b}</li>
          ))}
        </ul>
      );
      bullets = [];
    }
  };
  lines.forEach((ln, i) => {
    const bullet = ln.match(/^\s*[*•-]\s+(.*)$/);
    if (bullet) {
      bullets.push(bullet[1]!);
      return;
    }
    flush();
    const label = ln.match(/^([A-Za-z][A-Za-z\s()\/&]{1,30}):\s+(.+)$/);
    if (label && !label[2]!.startsWith("//")) {
      out.push(
        <p key={i}>
          <span className="font-semibold">{label[1]}:</span> {label[2]}
        </p>
      );
    } else if (ln.trim() === "") {
      out.push(<div key={i} className="h-2" />);
    } else {
      out.push(<p key={i}>{ln}</p>);
    }
  });
  flush();
  return <div className="mt-2 text-sm">{out}</div>;
}

export function Announcements({ user }: { user: User }) {
  const [draft, setDraft] = useState({ title: "", body: "", category: "news" });
  /* v1.4.223 (CEO: "placement textbox I want: Subject, To: From: and
     Body"): To/From on EVERY post — labels switch to Kepada/Daripada in
     memo mode, which also adds Tarikh + Perkara (v1.4.215). */
  const [toFrom, setToFrom] = useState({
    to: "All the staffs",
    from: "Management",
  }); // v1.4.224 defaults per CEO
  /* v1.4.262 (CEO: "subject and perkara is the same thing!"): they were.
     Perkara IS a memo's subject — the form asked for it twice and a careless
     publish could carry two different subjects on one memo. The Subject box
     is the single source; the memo header composes Perkara from it. */
  const [memo, setMemo] = useState({ tarikh: todayMalay() });
  const canPost = MANAGE_ROLES.includes(user.role);

  /* v1.104.0 (roadmap phase 02) - the feed everybody opens first thing,
     remembered on the device: last time's posts paint at once and the fresh
     ones swap in behind. A publish bumps "announcements" and every open feed
     refetches (the topic wiring moved INTO the hook).
     v1.77.0 (kept): skeleton until the first EVER fetch lands. */
  const feed = useCachedApi<{ announcements: Announcement[] }>("/staff/announcements", true, ["announcements"]);
  const anns = useMemo(() => feed.data?.announcements ?? [], [feed.data]);
  const loaded = !feed.loading;
  const refreshFeed = feed.refresh;
  const load = useCallback(async () => { refreshFeed(); }, [refreshFeed]);

  const post = async () => {
    if (!draft.title || !draft.body) return;
    /* v1.4.215: a memo publishes with its header lines composed into the
       body — no schema change, and the feed renders them bold. */
    const isMemo = draft.category === "memo";
    const headerLines = [
      toFrom.to.trim() && `${isMemo ? "Kepada" : "To"}: ${toFrom.to.trim()}`,
      toFrom.from.trim() &&
        `${isMemo ? "Daripada" : "From"}: ${toFrom.from.trim()}`,
      isMemo && memo.tarikh.trim() && `Tarikh: ${memo.tarikh.trim()}`,
      isMemo && draft.title.trim() && `Perkara: ${draft.title.trim()}`,
    ].filter(Boolean);
    const body =
      headerLines.length > 0
        ? headerLines.join("\n") + "\n\n" + draft.body
        : draft.body;
    await api(`/staff/announcements`, {
      method: "POST",
      body: JSON.stringify({ ...draft, body }),
    });
    setDraft({ title: "", body: "", category: "news" });
    setToFrom({ to: "All the staffs", from: "Management" });
    setMemo({ tarikh: todayMalay() });
    void load();
  };
  const ack = async (id: number) => {
    await api(`/staff/announcements/${id}/ack`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    void load();
  };

  return (
    <div className="space-y-4 md:space-y-6">
      {canPost && (
        <div className={card}>
          <p className="text-sm font-semibold">
            {L("Publish news", "Terbit berita")}
          </p>
          {/* v1.4.163 (CEO: "head section is not same as Dashboard"): this
              form predated the subhead standard — description + Sub labels
              added so it matches every other card. */}
          <p className="text-muted-foreground mt-0.5 text-xs">
            {L(
              "Posted to every staff member — it appears on their Dashboard and in this feed until they press Acknowledge.",
              "Disiarkan kepada setiap kakitangan — ia muncul di Papan Pemuka mereka dan dalam suapan ini sehingga mereka menekan Perakui."
            )}
          </p>
          <div className="mt-3 space-y-3">
            {/* v1.4.224 (CEO): order = Category → Subject → To | From → Body. */}
            <Sub t={L("Category", "Kategori")}>
              <select
                className={`${inputClass} sm:max-w-44`}
                value={draft.category}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, category: e.target.value }))
                }
              >
                {["news", "meeting", "holiday", "kpi", "training", "memo"].map(
                  (c) => (
                    <option key={c} value={c}>
                      {annCatL(c)}
                    </option>
                  )
                )}
              </select>
            </Sub>
            <Sub
              t={
                draft.category === "memo"
                  ? L("Subject / Perkara", "Perkara")
                  : L("Subject", "Perkara")
              }
            >
              <input
                className={inputClass}
                placeholder="e.g. Perubahan waktu balik bekerja"
                value={draft.title}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, title: e.target.value }))
                }
              />
            </Sub>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {/* v1.4.223: To/From placement boxes on EVERY post; memo mode
                  relabels to Kepada/Daripada and adds Tarikh + Perkara. */}
              <Sub
                t={
                  draft.category === "memo"
                    ? L("Kepada (To)", "Kepada")
                    : L("To", "Kepada")
                }
              >
                <input
                  className={inputClass}
                  value={toFrom.to}
                  onChange={(e) =>
                    setToFrom((m) => ({ ...m, to: e.target.value }))
                  }
                />
              </Sub>
              <Sub
                t={
                  draft.category === "memo"
                    ? L("Daripada (From)", "Daripada")
                    : L("From", "Daripada")
                }
              >
                <input
                  className={inputClass}
                  value={toFrom.from}
                  onChange={(e) =>
                    setToFrom((m) => ({ ...m, from: e.target.value }))
                  }
                />
              </Sub>
              {draft.category === "memo" && (
                <Sub t="Tarikh">
                  <input
                    className={inputClass}
                    value={memo.tarikh}
                    onChange={(e) =>
                      setMemo((m) => ({ ...m, tarikh: e.target.value }))
                    }
                  />
                </Sub>
              )}
            </div>
            <Sub
              t={
                draft.category === "memo"
                  ? "Kandungan memo"
                  : L("Body", "Kandungan")
              }
            >
              <textarea
                className={inputClass}
                rows={draft.category === "memo" ? 8 : 3}
                placeholder={
                  draft.category === "memo"
                    ? "Isi memo — guna * di awal baris untuk senarai bullet, dan 'Label: nilai' untuk baris tebal (cth. Masa: 9:00 pagi)"
                    : L("The full announcement text", "Teks penuh pengumuman")
                }
                value={draft.body}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, body: e.target.value }))
                }
              />
            </Sub>
            <button
              type="button"
              className={btnClass}
              onClick={() => void post()}
            >
              {L("Publish", "Terbitkan")}
            </button>
          </div>
        </div>
      )}
      <div className="max-h-[28rem] space-y-6 overflow-y-auto pr-1">
        {/* v1.77.0 — skeleton until the first fetch lands: two article
            cards (title row + body lines), the shape of a post. */}
        {!loaded && [0, 1].map((i) => <SkelCard key={i} lines={3} sub={false} />)}
        {loaded && anns.map((a) => (
          <article
            key={a.id}
            className={
              a.acked
                ? card
                : `${card} border-warning/30 bg-warning-soft `
            }
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold">
                {!a.acked && (
                  <span className="mr-2 inline-flex -translate-y-px animate-pulse items-center rounded-full bg-amber-500 px-2 py-0.5 align-middle text-[10px] font-bold tracking-wide text-white uppercase">
                    {L("New", "Baru")}
                  </span>
                )}
                {a.title}{" "}
                <span className="text-muted-foreground font-normal">
                  · {annCatL(a.category)} · {dmy(a.created_at)}
                </span>
              </p>
              {a.acked ? (
                <span className="text-muted-foreground text-xs">
                  {L("Acknowledged ✓", "Diperakui ✓")}
                </span>
              ) : (
                <button
                  type="button"
                  className={btnGhost}
                  onClick={() => void ack(a.id)}
                >
                  {L("Acknowledge", "Perakui")}
                </button>
              )}
            </div>
            <MemoBody body={a.body} />
          </article>
        ))}
      </div>
      {loaded && anns.length === 0 && (
        <p className="text-muted-foreground text-sm">
          {L("No announcements yet.", "Tiada pengumuman lagi.")}
        </p>
      )}
    </div>
  );
}

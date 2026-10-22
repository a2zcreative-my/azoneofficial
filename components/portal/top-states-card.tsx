"use client";

/* v1.185.0 - TOP STATES (BY ORDERS), the owner's reference beside the
   Fulfilment overview: the states the TikTok orders ship to, ranked, with
   the order count, the revenue and a share bar. The same /staff/orders/geo
   read and the same stateOf() the Operations map uses, so the list and the
   map can never disagree; "View map" scrolls to the map on this page. */

import { useCallback, useEffect, useMemo, useState } from "react";
import { AppIcon, PanelTitle } from "@/components/ui/app-icon";
import { Skel } from "@/components/ui/skeleton";
import { useLiveRefresh } from "@/hooks/use-live-refresh";
import { makeApi } from "@/lib/api";
import { fmtRM } from "@/lib/format";
import { getLang } from "@/lib/i18n";
import { stateOf } from "@/lib/malaysia-map";
import { btnSm, card } from "@/lib/ui-styles";
import css from "./top-states-card.module.css";

const api = makeApi("/staff");
const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);
type CityRow = { city: string; orders: number; cents: number };

export function TopStatesCard({ onViewMap, max = 5 }: { onViewMap?: () => void; max?: number }) {
  const [cities, setCities] = useState<CityRow[] | null>(null);
  const load = useCallback(() => {
    void api<{ cities: CityRow[] }>(`/orders/geo`).then((r) => setCities(r.ok && r.data?.cities ? r.data.cities : []));
  }, []);
  useEffect(() => {
    load();
    window.addEventListener("azone:tiktok-synced", load);
    return () => window.removeEventListener("azone:tiktok-synced", load);
  }, [load]);
  useLiveRefresh(["orders", "web-orders"], load);

  const rows = useMemo(() => {
    const by = new Map<string, { orders: number; cents: number }>();
    let total = 0;
    for (const c of cities ?? []) {
      const st = stateOf(c.city);
      if (!st) continue;
      const cur = by.get(st) ?? { orders: 0, cents: 0 };
      cur.orders += c.orders; cur.cents += c.cents; by.set(st, cur); total += c.orders;
    }
    return { total, list: [...by.entries()].map(([state, v]) => ({ state, ...v })).sort((a, b) => b.orders - a.orders || b.cents - a.cents).slice(0, max) };
  }, [cities, max]);
  const top = rows.list[0]?.orders ?? 0;

  return (
    <div className={card}>
      <div className={css.head}>
        <PanelTitle icon="place">{L("Top states (by orders)", "Negeri teratas (ikut pesanan)")}</PanelTitle>
        {onViewMap && <button type="button" className={btnSm} onClick={onViewMap}>{L("View map", "Lihat peta")}</button>}
      </div>
      {cities === null ? (
        <div className={css.list} aria-busy="true">
          {[0, 1, 2].map((i) => <Skel key={i} className={css.rowSkel} />)}
        </div>
      ) : rows.list.length === 0 ? (
        <p className="erp-meta erp-mt-2">{L("No orders with a buyer city yet — Sync from TikTok fills this in.", "Belum ada pesanan dengan bandar pembeli — Segerak dari TikTok mengisinya.")}</p>
      ) : (
        <ol className={css.list}>
          {rows.list.map((r, i) => (
            <li key={r.state} className={css.row}>
              <span className={css.rank}>{i + 1}</span>
              <span className={css.body}>
                <span className={css.line}>
                  <span className={css.state}>{r.state}</span>
                  <span className={`erp-num ${css.orders}`}>{r.orders} {L(r.orders === 1 ? "order" : "orders", "pesanan")}</span>
                  <span className={`erp-num ${css.cents}`}>{fmtRM(r.cents)}</span>
                  <span className={`erp-num ${css.share}`}>{rows.total ? `${((r.orders / rows.total) * 100).toFixed(1)}%` : ""}</span>
                </span>
                <span className={css.bar} aria-hidden>
                  <span className={css.fill} style={{ width: `${top ? Math.max(4, Math.round((r.orders / top) * 100)) : 0}%` }} />
                </span>
              </span>
            </li>
          ))}
        </ol>
      )}
      {cities !== null && rows.list.length > 0 && (
        <p className={`erp-meta ${css.foot}`}><AppIcon name="place" />{L(`${rows.total} orders placed by state`, `${rows.total} pesanan mengikut negeri`)}</p>
      )}
    </div>
  );
}

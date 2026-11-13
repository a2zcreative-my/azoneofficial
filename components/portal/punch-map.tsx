"use client";

/* v1.297.0 - THE REAL MAP (the CEO, 13-11-2026: "the Geofence I want to make
   it real instead of like this"). The Location Verification card's map, drawn
   from OpenStreetMap's standard tiles with no library and no key:

     the site      the gold pin, at the office point the geofence stores
     the fence     the green dashed circle, its radius in metres to scale
     the punch     the blue pin (orange when outside), at the position the
                   person's own punch recorded, with its accuracy ring

   Who sees what: the server sends positions only for the person's OWN day
   (GET /staff/attendance, forUser = the signed-in person). Team views never
   carry a position. The tiles come from tile.openstreetmap.org: the browser
   asks for the map squares around the office, as any map does; nothing about
   the person is sent beyond that request. The page credits OpenStreetMap, as
   its licence requires. If the tiles cannot load, the card falls back to the
   distance diagram and says so. Pan by dragging, zoom with the buttons. */

import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { AppIcon } from "@/components/ui/app-icon";
import { L } from "@/components/portal/page-shared";
import { Skel } from "@/components/ui/skeleton";
import css from "./punch-map.module.css";

export interface MapPoint { lat: number; lng: number }
const TILE = 256;
const H = 280;
const MIN_Z = 3, MAX_Z = 19;
const world = (p: MapPoint, z: number) => {
  const n = TILE * 2 ** z;
  const s = Math.sin((Math.max(-85, Math.min(85, p.lat)) * Math.PI) / 180);
  return { x: ((p.lng + 180) / 360) * n, y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n };
};
const metresPerPx = (lat: number, z: number) => (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** z;

/** the zoom that fits the fence and the punch (with its accuracy) in the frame */
function fitZoom(site: MapPoint, radius: number, punch: MapPoint | null, acc: number, w: number): number {
  for (let z = MAX_Z; z >= MIN_Z; z--) {
    const m = metresPerPx(site.lat, z);
    const half = Math.min(w, H) / 2 - 24;
    if (radius / m > half) continue;
    if (punch) {
      const a = world(site, z), b = world(punch, z);
      const accPx = acc / m;
      if (Math.abs(a.x - b.x) / 2 + Math.max(accPx, 14) > w / 2 - 24 || Math.abs(a.y - b.y) / 2 + Math.max(accPx, 14) > H / 2 - 24) continue;
      if (Math.abs(a.x - b.x) + radius / m > w - 48 || Math.abs(a.y - b.y) + radius / m > H - 48) continue;
    }
    return z;
  }
  return MIN_Z;
}

export function PunchMap({ site, radius, punch, accuracy, outside, siteLabel, onFail }: {
  site: MapPoint;
  radius: number;
  punch: MapPoint | null;
  accuracy: number | null;
  outside: boolean;
  siteLabel: string;
  /** every tile failed: the card shows the distance diagram instead */
  onFail: () => void;
}) {
  const box = useRef<HTMLDivElement | null>(null);
  const [w, setW] = useState(360);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => { if (e) setW(Math.max(200, Math.round(e.contentRect.width))); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const fit = fitZoom(site, radius, punch, accuracy ?? 0, w);
  const [view, setView] = useState<{ dz: number; dx: number; dy: number }>({ dz: 0, dx: 0, dy: 0 });
  const z = Math.max(MIN_Z, Math.min(MAX_Z, fit + view.dz));
  const a = world(site, z);
  const b = punch ? world(punch, z) : null;
  /* centred between the two points (the site alone with no punch), then panned */
  const cx = (b ? (a.x + b.x) / 2 : a.x) - view.dx;
  const cy = (b ? (a.y + b.y) / 2 : a.y) - view.dy;
  const left = cx - w / 2, top = cy - H / 2;
  const n = 2 ** z;
  const tiles: { key: string; x: number; y: number; src: string }[] = [];
  for (let tx = Math.floor(left / TILE); tx <= Math.floor((left + w) / TILE); tx++) {
    for (let ty = Math.floor(top / TILE); ty <= Math.floor((top + H) / TILE); ty++) {
      if (ty < 0 || ty >= n) continue;
      const wx = ((tx % n) + n) % n;
      tiles.push({ key: `${z}/${tx}/${ty}`, x: tx * TILE - left, y: ty * TILE - top, src: `https://tile.openstreetmap.org/${z}/${wx}/${ty}.png` });
    }
  }
  const [failed, setFailed] = useState(0);
  const [loaded, setLoaded] = useState(0);
  useEffect(() => { if (failed > 0 && loaded === 0 && failed >= tiles.length) onFail(); }, [failed, loaded, tiles.length, onFail]);
  const m = metresPerPx(site.lat, z);
  const S = { x: a.x - left, y: a.y - top };
  const P = b ? { x: b.x - left, y: b.y - top } : null;
  /* drag to pan (mouse, pen or a finger) */
  const drag = useRef<{ x: number; y: number; dx: number; dy: number } | null>(null);
  const down = (e: RPointerEvent<HTMLDivElement>) => { (e.target as HTMLElement).setPointerCapture?.(e.pointerId); drag.current = { x: e.clientX, y: e.clientY, dx: view.dx, dy: view.dy }; };
  const move = (e: RPointerEvent<HTMLDivElement>) => { const d = drag.current; if (d) setView((v) => ({ ...v, dx: d.dx + (e.clientX - d.x), dy: d.dy + (e.clientY - d.y) })); };
  const up = () => { drag.current = null; };
  const zoomBy = (k: number) => setView((v) => ({ dz: Math.max(MIN_Z - fit, Math.min(MAX_Z - fit, v.dz + k)), dx: v.dx * 2 ** k, dy: v.dy * 2 ** k }));
  return (
    <figure className={css.map} data-testid="punch-map">
      <div ref={box} className={css.frame} style={{ height: H }} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
        role="img" aria-label={P
          ? L(`Map: ${siteLabel} and your punch, ${outside ? "outside" : "inside"} the ${radius} metre geofence.`, `Peta: ${siteLabel} dan punch anda, ${outside ? "di luar" : "di dalam"} geofence ${radius} meter.`)
          : L(`Map: ${siteLabel} and its ${radius} metre geofence. No punch location today.`, `Peta: ${siteLabel} dan geofence ${radius} meter. Tiada lokasi punch hari ini.`)}>
        {/* until the first square arrives: the map's own shape, shimmering (never a sentence about waiting) */}
        {loaded === 0 && failed === 0 && <Skel className={css.loading} round="none" />}
        {tiles.map((t) => (
          // eslint-disable-next-line @next/next/no-img-element -- map tiles: plain images positioned by the map's own maths
          <img key={t.key} src={t.src} alt="" width={TILE} height={TILE} draggable={false} className={css.tile} style={{ left: t.x, top: t.y }}
            referrerPolicy="strict-origin-when-cross-origin" onLoad={() => setLoaded((x) => x + 1)} onError={() => setFailed((x) => x + 1)} />
        ))}
        <svg className={css.overlay} width={w} height={H} viewBox={`0 0 ${w} ${H}`} aria-hidden>
          <circle cx={S.x} cy={S.y} r={radius / m} className={css.fence} />
          {P && accuracy !== null && <circle cx={P.x} cy={P.y} r={Math.min(accuracy / m, 2000)} className={css.accuracy} />}
          {P && <line x1={S.x} y1={S.y} x2={P.x} y2={P.y} className={outside ? css.reachOut : css.reach} />}
          <path d={`M ${S.x} ${S.y} C ${S.x - 4} ${S.y - 10} ${S.x - 11} ${S.y - 15} ${S.x - 11} ${S.y - 23} A 11 11 0 1 1 ${S.x + 11} ${S.y - 23} C ${S.x + 11} ${S.y - 15} ${S.x + 4} ${S.y - 10} ${S.x} ${S.y} Z`} className={css.site} />
          <circle cx={S.x} cy={S.y - 23} r="4" className={css.siteDot} />
          {P && <><circle cx={P.x} cy={P.y} r="9" className={css.punchHalo} /><circle cx={P.x} cy={P.y} r="6" className={outside ? css.punchOut : css.punch} /></>}
        </svg>
      </div>
      <div className={css.zoom} role="group" aria-label={L("Map zoom", "Zum peta")}>
        <button type="button" onClick={() => zoomBy(1)} aria-label={L("Zoom in", "Zum masuk")}>+</button>
        <button type="button" onClick={() => zoomBy(-1)} aria-label={L("Zoom out", "Zum keluar")}>−</button>
        <button type="button" onClick={() => setView({ dz: 0, dx: 0, dy: 0 })} aria-label={L("Fit the site and the punch", "Muatkan tapak dan punch")}><AppIcon name="place" /></button>
      </div>
      <figcaption className={css.attrib}>
        <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap</a>
      </figcaption>
    </figure>
  );
}

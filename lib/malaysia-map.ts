/* v1.43.0 — the Malaysia map, shared.
   Extracted VERBATIM from components/portal/ops-map.tsx (v1.20.1) the day the
   ELFIA Traffic map joined it as a second consumer — one country, one
   geometry, drawn by two cards. Pure data + pure helpers, no React: both maps
   keep their own rendering and their own semantics (orders vs visitors).

   Real Malaysian state boundaries (Natural Earth-derived geometry, projected
   as the standard two insets: Peninsular Malaysia + Sabah & Sarawak) on a
   860×380 canvas (Mercator, 1dp). Generated offline from
   @highcharts/map-collection — inlined so the app itself gains no dependency. */

export type StateShape = { name: string; d: string; cx: number; cy: number };

export const STATES: StateShape[] = [
  { name: "Sabah", cx: 702.1, cy: 140.4,
    d: "M764.0,176.6L764.0,176.6L764.0,176.6ZM756.4,167.6L759.6,170.0L750.5,167.3ZM744.6,121.1L744.6,121.1L744.6,121.1ZM714.5,88.4L714.5,88.4L714.5,88.4ZM697.7,60.9L697.7,60.9L697.7,60.9ZM707.3,65.6L699.7,69.6L699.4,62.8L703.1,60L708.1,61.3ZM733.1,187.8L724.9,187.6L724.8,183.4ZM633.8,155.5L639.2,151.3L641.1,145.5L636.5,145.1L631.3,141.3L633.1,137.1L638.9,132.4L640.3,129.3L643.8,132.8L650.8,131.6L653.6,124.1L658.9,120.3L662.5,111.0L661.1,108.8L668.5,102.9L670.7,98.7L677.0,94.0L682.7,85.1L683.6,78.7L687.9,72.6L690.1,74.8L691.2,81.1L688.0,88.7L689.8,90.5L695.7,85.5L699.1,79.9L697.9,77.3L702.6,73.6L707.0,76.2L705.9,80.2L709.2,88.7L714.5,91.7L718.1,89.0L726.5,98.2L725.7,103.7L720.8,106.0L723.7,114.4L716.5,118.1L727.7,117.6L737.5,111.5L741.8,119.4L733.1,122.6L735.3,126.5L742.1,126.4L743.2,122.2L747.3,120.8L753.1,122.1L773.4,135.8L780.1,137.6L784.9,136.3L787.6,139.5L787.3,146.0L782.9,149.8L764.0,156.3L757.1,156.8L751.0,152.5L742.2,158.8L750.1,168.0L756.3,171.1L762.5,176.3L758.4,179.7L742.2,182.1L736.9,184.8L732.4,183.8L723.6,177.1L721.0,178.8L722.8,182.7L719.5,187.7L714.2,186.7L705.5,179.9L703.4,180.8L689.0,180.9L685.2,179.4L672.5,182.3L669.2,178.7L661.9,178.9L657.7,183.2L650.6,178.5L649.6,182.8L642.4,188.3L643.9,181.6L640.8,178.9L639.3,170.6L643.2,161.0L641.8,155.7Z" },
  { name: "Sarawak", cx: 548.3, cy: 250.5,
    d: "M473.6,258.6L469.5,256.0L469.8,242.7L472.4,246.2ZM633.8,155.5L641.8,155.7L643.2,161.0L639.3,170.6L640.8,178.9L643.9,181.6L642.4,188.3L641.3,194.2L638.4,198.2L640.5,199.8L638.8,209.9L640.9,216.5L637.6,219.8L637.6,227.8L635.5,232.9L629.3,234.7L626.6,232.5L619.6,241.0L619.2,249.8L623.4,250.5L625.2,253.7L622.0,255.0L613.7,262.3L608.1,264.2L608.2,272.6L610.8,273.1L610.2,278L603.8,281.3L603.7,286.3L597.0,296.6L591.2,294.0L583.4,297.1L579.2,295.5L573.4,296.4L563.0,304.7L557.1,301.5L552.9,302.3L550.0,300.0L540.6,296.8L535.4,297.4L538.0,292.6L531.3,290.8L527.8,292.0L515.9,291.4L504.3,296.1L504.4,299.3L501.2,307.8L493.5,309.5L490.0,313.7L483.4,312.8L478.7,314.2L471.2,313.5L465.1,311.0L451.3,314.2L448.5,317.7L439.4,320L431.3,314.6L427.8,314.3L424.0,307.1L419.3,305.4L414.6,298.9L410.9,297.9L402.9,288.6L402.9,282.8L398.4,278.5L403.1,270.8L403.5,276.6L406.5,280.5L412.7,283.7L414.4,286.4L427.4,285.9L430.9,282.2L431.8,285.5L438.0,285.2L435.8,289.3L446.3,292.2L450.7,291.4L463.4,299.4L457.5,291.9L458.7,287.0L462.7,286.8L461.0,283.1L465.6,271.2L464.5,268.3L465.5,258.6L467.0,256.7L471.8,260.5L475.0,259.2L473.3,254.7L474.7,246.9L483.9,240.4L497.6,238.7L526.2,231.5L537.4,227.6L539.8,222.9L548.1,214.7L554.4,204.0L566.5,194.0L574.9,183.1L577.0,170.0L586.8,174.8L588.3,183.5L593.7,183.7L600.4,193.3L607.6,188.8L608.2,182.7L610.8,177.1L608.2,174.2L607.0,164.5L614.9,161.3L617.6,157.4L618.4,169.2L621.4,178.8L631.4,180.9L627.8,175.1L627.9,168.6L625.2,161.0L622.8,158.6L624.9,156.0L631.2,157.9Z" },
  { name: "Labuan", cx: 625.7, cy: 141.6,
    d: "M627.3,142.3L623.3,143.9L626.6,138.5Z" },
  { name: "Pulau Pinang", cx: 61.4, cy: 111.3,
    d: "M54.9,105.6L57.0,107.7L53.6,117.3L47.9,115.0L47.6,104.9ZM60.6,126.1L62.3,114.8L57.6,98.4L68.7,99.5L70.2,124.4L66.8,125.2Z" },
  { name: "Kedah", cx: 74, cy: 75.4,
    d: "M30.5,47.5L30.7,51.2L19.2,55.5L14,44.7L22.7,45.5L26.7,42.9ZM26.0,54.5L26.0,54.5L26.0,54.5ZM57.6,98.4L58.9,83.4L57.2,70.9L48.1,55.5L58.3,43.5L59.0,39.1L75.7,44.0L79.7,41.2L85.4,46.0L86.3,55.6L102.4,56.5L101.7,76.7L95.6,85.7L94.1,99.4L87.4,112.5L82.7,113.7L70.2,128.5L66.8,125.2L70.2,124.4L68.7,99.5Z" },
  { name: "Selangor", cx: 128.5, cy: 239.7,
    d: "M113.3,255.0L113.3,255.0L113.3,255.0ZM114.4,258.8L114.4,258.8L114.4,258.8ZM141.8,281.8L130.7,277.7L121.9,268.0L115.0,266.1L120.3,256.7L115.7,240.0L104.1,227.6L99.9,218.5L85.9,208.4L87.6,204.9L93.8,203.9L113.2,215.4L118.7,213.5L118.8,208.0L129.7,215.1L135.9,209.3L147.3,220.0L144.4,233.9L153.7,240.8L156.6,254.5L150.4,265.6L144.1,265.3L144.9,273.0ZM138.6,254.7L142.4,255.0L144.3,246.0L138.3,242.6L135.6,245.6ZM139.0,264.5L139.0,264.5L139.0,264.5Z" },
  { name: "Pahang", cx: 193, cy: 211.8,
    d: "M289.6,270.6L293.4,263.9L294.9,274.4ZM247.7,184.8L244.7,188.1L247.3,196.7L241.2,210.1L250.1,225.3L246.7,234.2L248.4,244.3L247.1,259.2L249.5,266.0L259.8,277.1L257.8,290.8L242.9,281.9L230.2,285.8L219.9,281.8L209.1,269.5L202.2,266.8L182.8,249.6L166.5,244.8L162.9,246.2L153.7,240.8L144.4,233.9L147.3,220.0L135.9,209.3L131.9,194.9L133.3,190.1L126.1,181.8L124.6,171.5L118.4,168.6L120.6,157.4L125.7,159.9L137.9,160.2L144.7,155.6L145.2,149.7L152.8,156.7L156.6,148.3L166.1,148.4L171.1,155.5L179.9,155.4L181.8,151.8L195.6,152.4L199.5,147.7L210.9,153.5L213.5,166.2L222.0,170.6L216.3,178.4L216.7,188.5L219.9,187.0L235.0,194.0L239.0,201.9L241.5,197.9L239.2,191.2L241.7,184.1Z" },
  { name: "Kuala Lumpur", cx: 140.1, cy: 248.7,
    d: "M138.6,254.7L135.6,245.6L138.3,242.6L144.3,246.0L142.4,255.0Z" },
  { name: "Putrajaya", cx: 139, cy: 264.5,
    d: "M139.0,264.5L139.0,264.5L139.0,264.5Z" },
  { name: "Perlis", cx: 50.7, cy: 40.6,
    d: "M48.1,55.5L43.7,44.3L46.1,28.7L53.1,29.0L59.0,39.1L58.3,43.5Z" },
  { name: "Johor", cx: 243.8, cy: 315.5,
    d: "M259.8,277.1L267.6,280.0L272.0,289.8L278.7,297.5L280.4,306.6L294.0,330.8L300,352.5L299.0,357.4L288.5,356.9L282.7,343.2L280.3,354.2L272.1,350.6L262.3,352.8L252.2,363.3L243.0,346.9L222.7,335.9L216.3,333.9L208.3,327.0L203.3,327.8L189.0,312.7L193.0,294.0L195.8,292.5L197.9,279.4L202.2,266.8L209.1,269.5L219.9,281.8L230.2,285.8L242.9,281.9L257.8,290.8Z" },
  { name: "Perak", cx: 104.3, cy: 147.8,
    d: "M87.6,204.9L80.2,203.3L80.1,195.8L85.1,195.8L83.0,189.0L74.8,185.6L70.6,175.5L74.8,162.3L71.4,142.5L66.3,141.4L60.5,134.0L60.6,126.1L66.8,125.2L70.2,128.5L82.7,113.7L87.4,112.5L94.1,99.4L95.6,85.7L103.9,94.1L111.2,90.3L112.7,84.8L133.0,77.4L140.2,86.1L138.6,101.4L143.7,103.5L143.4,111.1L135.5,111.2L130.1,116.5L122.6,143.9L120.6,157.4L118.4,168.6L124.6,171.5L126.1,181.8L133.3,190.1L131.9,194.9L135.9,209.3L129.7,215.1L118.8,208.0L118.7,213.5L113.2,215.4L93.8,203.9Z" },
  { name: "Kelantan", cx: 161, cy: 115.9,
    d: "M120.6,157.4L122.6,143.9L130.1,116.5L135.5,111.2L143.4,111.1L143.7,103.5L138.6,101.4L140.2,86.1L146.6,87.7L153.5,80.4L156.4,71.0L162.6,65.8L163.4,55.7L171.1,57.3L182.2,63.4L192.3,80.7L182.6,91.1L183.2,107.4L186.0,110.7L184.4,122.4L191.4,126.9L191.3,139.6L198.4,142.8L199.5,147.7L195.6,152.4L181.8,151.8L179.9,155.4L171.1,155.5L166.1,148.4L156.6,148.3L152.8,156.7L145.2,149.7L144.7,155.6L137.9,160.2L125.7,159.9Z" },
  { name: "Melaka", cx: 178.5, cy: 298.2,
    d: "M195.8,292.5L193.0,294.0L189.0,312.7L170.4,305.1L158.2,294.4L170.2,288.1L182.5,288.4Z" },
  { name: "Negeri Sembilan", cx: 171.5, cy: 270.7,
    d: "M202.2,266.8L197.9,279.4L195.8,292.5L182.5,288.4L170.2,288.1L158.2,294.4L150.6,294.1L145.5,283.0L141.8,281.8L144.9,273.0L144.1,265.3L150.4,265.6L156.6,254.5L153.7,240.8L162.9,246.2L166.5,244.8L182.8,249.6Z" },
  { name: "Terengganu", cx: 217.8, cy: 138,
    d: "M199.5,147.7L198.4,142.8L191.3,139.6L191.4,126.9L184.4,122.4L186.0,110.7L183.2,107.4L182.6,91.1L192.3,80.7L200.0,88.7L212.7,98.2L217.9,100.0L227.8,110.0L247.9,146.1L248.2,165.1L251.0,176.3L247.7,184.8L241.7,184.1L239.2,191.2L241.5,197.9L239.0,201.9L235.0,194.0L219.9,187.0L216.7,188.5L216.3,178.4L222.0,170.6L213.5,166.2L210.9,153.5Z" },
];

/* Common Malaysian cities → state (lower-case keys; loose contains match). */
export const CITY_STATE: [string, string][] = [
  ["kuala lumpur", "Kuala Lumpur"], ["cheras", "Kuala Lumpur"], ["kepong", "Kuala Lumpur"], ["setapak", "Kuala Lumpur"], ["wilayah persekutuan", "Kuala Lumpur"],
  ["petaling", "Selangor"], ["shah alam", "Selangor"], ["subang", "Selangor"], ["klang", "Selangor"], ["puchong", "Selangor"],
  ["ampang", "Selangor"], ["kajang", "Selangor"], ["gombak", "Selangor"], ["rawang", "Selangor"], ["sepang", "Selangor"],
  ["cyberjaya", "Selangor"], ["bangi", "Selangor"], ["selayang", "Selangor"], ["damansara", "Selangor"], ["selangor", "Selangor"],
  ["putrajaya", "Putrajaya"],
  ["johor bahru", "Johor"], ["johor", "Johor"], ["skudai", "Johor"], ["batu pahat", "Johor"], ["muar", "Johor"],
  ["kluang", "Johor"], ["kulai", "Johor"], ["pasir gudang", "Johor"], ["iskandar", "Johor"], ["segamat", "Johor"], ["pontian", "Johor"],
  ["penang", "Pulau Pinang"], ["pulau pinang", "Pulau Pinang"], ["georgetown", "Pulau Pinang"], ["butterworth", "Pulau Pinang"], ["bukit mertajam", "Pulau Pinang"],
  ["ipoh", "Perak"], ["perak", "Perak"], ["taiping", "Perak"], ["teluk intan", "Perak"], ["manjung", "Perak"], ["sitiawan", "Perak"],
  ["alor setar", "Kedah"], ["kedah", "Kedah"], ["sungai petani", "Kedah"], ["kulim", "Kedah"], ["langkawi", "Kedah"],
  ["kangar", "Perlis"], ["perlis", "Perlis"],
  ["kota bharu", "Kelantan"], ["kelantan", "Kelantan"], ["pasir mas", "Kelantan"], ["tanah merah", "Kelantan"],
  ["kuala terengganu", "Terengganu"], ["terengganu", "Terengganu"], ["kemaman", "Terengganu"], ["dungun", "Terengganu"],
  ["kuantan", "Pahang"], ["pahang", "Pahang"], ["temerloh", "Pahang"], ["bentong", "Pahang"],
  ["seremban", "Negeri Sembilan"], ["negeri sembilan", "Negeri Sembilan"], ["nilai", "Negeri Sembilan"], ["port dickson", "Negeri Sembilan"],
  ["melaka", "Melaka"], ["malacca", "Melaka"], ["alor gajah", "Melaka"],
  ["kuching", "Sarawak"], ["sarawak", "Sarawak"], ["miri", "Sarawak"], ["sibu", "Sarawak"], ["bintulu", "Sarawak"],
  ["kota kinabalu", "Sabah"], ["sabah", "Sabah"], ["sandakan", "Sabah"], ["tawau", "Sabah"], ["lahad datu", "Sabah"], ["keningau", "Sabah"],
  ["labuan", "Labuan"],
];

export function stateOf(cityRaw: string): string | null {
  const c = cityRaw.toLowerCase();
  for (const [needle, st] of CITY_STATE) if (c.includes(needle)) return st;
  return null;
}

export function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

/* ---- v1.140.0: the viewer-facing edges of each state, for the
   extrusion. Generated by scratch/gen-state-walls.mjs from STATES
   above - regenerate it if the geometry ever changes. Each state is a
   list of RUNS of touching edges; wallPath() sweeps each run. ---- */
export const STATE_WALLS: Record<string, [number, number][][]> = {
  "Sabah": [[[759.6,170],[750.5,167.3]], [[707.3,65.6],[699.7,69.6],[699.4,62.8]], [[708.1,61.3],[707.3,65.6]], [[733.1,187.8],[724.9,187.6],[724.8,183.4]], [[641.1,145.5],[636.5,145.1],[631.3,141.3]], [[662.5,111],[661.1,108.8]], [[691.2,81.1],[688,88.7]], [[699.1,79.9],[697.9,77.3]], [[707,76.2],[705.9,80.2]], [[726.5,98.2],[725.7,103.7],[720.8,106]], [[723.7,114.4],[716.5,118.1]], [[741.8,119.4],[733.1,122.6]], [[787.6,139.5],[787.3,146],[782.9,149.8],[764,156.3],[757.1,156.8],[751,152.5],[742.2,158.8]], [[762.5,176.3],[758.4,179.7],[742.2,182.1],[736.9,184.8],[732.4,183.8],[723.6,177.1],[721,178.8]], [[722.8,182.7],[719.5,187.7],[714.2,186.7],[705.5,179.9],[703.4,180.8],[689,180.9],[685.2,179.4],[672.5,182.3],[669.2,178.7],[661.9,178.9],[657.7,183.2],[650.6,178.5],[649.6,182.8],[642.4,188.3]], [[643.9,181.6],[640.8,178.9],[639.3,170.6]], [[643.2,161],[641.8,155.7],[633.8,155.5]]],
  "Sarawak": [[[473.6,258.6],[469.5,256]], [[643.2,161],[639.3,170.6]], [[643.9,181.6],[641.3,194.2],[638.4,198.2]], [[640.5,199.8],[638.8,209.9]], [[640.9,216.5],[637.6,219.8]], [[637.6,227.8],[635.5,232.9],[629.3,234.7],[626.6,232.5],[619.6,241],[619.2,249.8]], [[625.2,253.7],[622,255],[613.7,262.3],[608.1,264.2]], [[610.8,273.1],[610.2,278],[603.8,281.3],[603.7,286.3],[597,296.6],[591.2,294],[583.4,297.1],[579.2,295.5],[573.4,296.4],[563,304.7],[557.1,301.5],[552.9,302.3],[550,300],[540.6,296.8],[535.4,297.4]], [[538,292.6],[531.3,290.8],[527.8,292],[515.9,291.4],[504.3,296.1]], [[504.4,299.3],[501.2,307.8],[493.5,309.5],[490,313.7],[483.4,312.8],[478.7,314.2],[471.2,313.5],[465.1,311],[451.3,314.2],[448.5,317.7],[439.4,320],[431.3,314.6],[427.8,314.3],[424,307.1],[419.3,305.4],[414.6,298.9],[410.9,297.9],[402.9,288.6]], [[402.9,282.8],[398.4,278.5]], [[438,285.2],[435.8,289.3]], [[463.4,299.4],[457.5,291.9]], [[462.7,286.8],[461,283.1]], [[465.6,271.2],[464.5,268.3]], [[475,259.2],[473.3,254.7]], [[610.8,177.1],[608.2,174.2],[607,164.5]], [[631.4,180.9],[627.8,175.1]], [[627.9,168.6],[625.2,161],[622.8,158.6]]],
  "Labuan": [[[627.3,142.3],[623.3,143.9]]],
  "Pulau Pinang": [[[57,107.7],[53.6,117.3],[47.9,115],[47.6,104.9]], [[62.3,114.8],[57.6,98.4]], [[70.2,124.4],[60.6,126.1]]],
  "Kedah": [[[30.7,51.2],[19.2,55.5],[14,44.7]], [[58.9,83.4],[57.2,70.9],[48.1,55.5]], [[102.4,56.5],[101.7,76.7],[95.6,85.7],[94.1,99.4],[87.4,112.5],[82.7,113.7],[70.2,128.5],[66.8,125.2]], [[70.2,124.4],[68.7,99.5],[57.6,98.4]]],
  "Selangor": [[[141.8,281.8],[130.7,277.7],[121.9,268],[115,266.1]], [[120.3,256.7],[115.7,240],[104.1,227.6],[99.9,218.5],[85.9,208.4]], [[147.3,220],[144.4,233.9]], [[156.6,254.5],[150.4,265.6],[144.1,265.3]], [[144.9,273],[141.8,281.8]], [[138.6,254.7],[142.4,255],[144.3,246]], [[135.6,245.6],[138.6,254.7]]],
  "Pahang": [[[294.9,274.4],[289.6,270.6]], [[247.7,184.8],[244.7,188.1]], [[247.3,196.7],[241.2,210.1]], [[250.1,225.3],[246.7,234.2]], [[248.4,244.3],[247.1,259.2]], [[259.8,277.1],[257.8,290.8],[242.9,281.9],[230.2,285.8],[219.9,281.8],[209.1,269.5],[202.2,266.8],[182.8,249.6],[166.5,244.8],[162.9,246.2],[144.4,233.9]], [[147.3,220],[135.9,209.3],[131.9,194.9]], [[133.3,190.1],[126.1,181.8],[124.6,171.5],[118.4,168.6]], [[222,170.6],[216.3,178.4]], [[241.5,197.9],[239.2,191.2]]],
  "Kuala Lumpur": [[[138.6,254.7],[135.6,245.6]], [[144.3,246],[142.4,255],[138.6,254.7]]],
  "Putrajaya": [],
  "Perlis": [[[48.1,55.5],[43.7,44.3]], [[59,39.1],[58.3,43.5],[48.1,55.5]]],
  "Johor": [[[300,352.5],[299,357.4],[288.5,356.9],[282.7,343.2],[280.3,354.2],[272.1,350.6],[262.3,352.8],[252.2,363.3],[243,346.9],[222.7,335.9],[216.3,333.9],[208.3,327],[203.3,327.8],[189,312.7]]],
  "Perak": [[[87.6,204.9],[80.2,203.3],[80.1,195.8]], [[85.1,195.8],[83,189],[74.8,185.6],[70.6,175.5]], [[74.8,162.3],[71.4,142.5],[66.3,141.4],[60.5,134]], [[140.2,86.1],[138.6,101.4]], [[143.7,103.5],[143.4,111.1],[135.5,111.2],[130.1,116.5],[122.6,143.9],[118.4,168.6]], [[133.3,190.1],[131.9,194.9]], [[135.9,209.3],[129.7,215.1],[118.8,208],[118.7,213.5],[113.2,215.4],[93.8,203.9],[87.6,204.9]]],
  "Kelantan": [[[143.7,103.5],[138.6,101.4]], [[192.3,80.7],[182.6,91.1]], [[186,110.7],[184.4,122.4]], [[191.4,126.9],[191.3,139.6]], [[199.5,147.7],[195.6,152.4],[181.8,151.8],[179.9,155.4],[171.1,155.5],[166.1,148.4],[156.6,148.3],[152.8,156.7],[145.2,149.7],[144.7,155.6],[137.9,160.2],[125.7,159.9],[120.6,157.4]]],
  "Melaka": [[[195.8,292.5],[193,294],[189,312.7],[170.4,305.1],[158.2,294.4]]],
  "Negeri Sembilan": [[[202.2,266.8],[197.9,279.4],[195.8,292.5],[182.5,288.4],[170.2,288.1],[158.2,294.4],[150.6,294.1],[145.5,283],[141.8,281.8]], [[144.9,273],[144.1,265.3]], [[156.6,254.5],[153.7,240.8]]],
  "Terengganu": [[[199.5,147.7],[198.4,142.8],[191.3,139.6]], [[191.4,126.9],[184.4,122.4]], [[186,110.7],[183.2,107.4],[182.6,91.1]], [[251,176.3],[247.7,184.8],[241.7,184.1],[239.2,191.2]], [[241.5,197.9],[239,201.9],[235,194],[219.9,187],[216.7,188.5],[216.3,178.4]], [[222,170.6],[213.5,166.2],[210.9,153.5],[199.5,147.7]]],
};

/**
 * HOW HIGH A STATE STANDS — v1.140.0.
 *
 * The CEO, 08-09-2026, on the four maps: a 3D states map, without WebGL and
 * without giving up the sixteen buttons a screen reader and a keyboard can
 * reach. So a state is not tilted, it is RAISED: its own figure decides how
 * far it lifts off the page, and the face swept underneath it is the wall.
 *
 * Square root, not linear, and the same curve the bubbles have used since
 * v1.20.1 - one state ten times the size of the rest would otherwise flatten
 * every other state to nothing. A floor of 2px, because a state with real
 * money in it that lifts by a third of a pixel reads as a state with none;
 * the ceiling of 16px is what the viewBox has room for above Perlis.
 */
export function liftFor(value: number, max: number): number {
  if (!(max > 0) || !(value > 0)) return 0;
  return 2 + 14 * Math.sqrt(Math.min(value / max, 1));
}

/**
 * AN ENCLAVE RISES WITH ITS HOST — v1.140.0.
 *
 * Selangor's outline carries Kuala Lumpur and Putrajaya as HOLES in itself,
 * because that is what they are on the ground. Raise Selangor 16px and Kuala
 * Lumpur 14.4px and the hole rises with Selangor while the territory inside it
 * does not: a 1.6px sliver of the page shows through, and it reads as a crack
 * across the map. Found in the first render of the extrusion, not in
 * production.
 *
 * So an enclave takes its host's height exactly and the crack cannot open,
 * whichever of the two carries the bigger figure. Its own figure is not lost -
 * the bubble and the fill ramp carry it, exactly as they do today. Labuan is
 * offshore, an island in its own right, and rises on its own figure.
 */
export const HOST_STATE: Record<string, string> = {
  "Kuala Lumpur": "Selangor",
  Putrajaya: "Selangor",
};

/** Every state's lift in one pass, enclaves settled. `valueOf` is whatever the
    map is counting - ringgit, orders, visitors, hotels. */
export function liftsFor(valueOf: (name: string) => number, max: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of STATES) out[s.name] = liftFor(valueOf(s.name), max);
  for (const [enclave, host] of Object.entries(HOST_STATE)) {
    if (out[host] !== undefined) out[enclave] = out[host];
  }
  return out;
}

/**
 * THE FACE UNDER A RAISED STATE.
 *
 * The state is drawn twice over: once where it sits, lifted by `h`, and once
 * as this wall, which fills the gap the lift opens. Each RUN of viewer-facing
 * edges (see scratch/gen-state-walls.mjs) becomes one closed subpath - forward
 * along the top, back along the bottom - so the whole wall is a single path
 * node however many runs a state has. An island is its own run; so is a bay.
 *
 * Nothing is drawn at h = 0: a state with no figure has no wall, and an empty
 * `d` is the honest answer, not a zero-height sliver of ink.
 */
export function wallPath(name: string, h: number): string {
  if (!(h > 0)) return "";
  const runs = STATE_WALLS[name];
  if (!runs || runs.length === 0) return "";
  let d = "";
  for (const run of runs) {
    if (run.length < 2) continue;
    d += `M${run[0]![0]} ${run[0]![1] - h}`;
    for (let i = 1; i < run.length; i += 1) d += `L${run[i]![0]} ${run[i]![1] - h}`;
    for (let i = run.length - 1; i >= 0; i -= 1) d += `L${run[i]![0]} ${run[i]![1]}`;
    d += "Z";
  }
  return d;
}

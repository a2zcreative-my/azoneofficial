/* v1.241.0 (go-live audit F6) - shared by the lazy panels (the automatic
   reload) and the portal recovery screen (the manual one). Kept apart from
   lazy-panels.tsx so the recovery screen does not import every panel. */

export const CHUNK_RELOAD_KEY = "azone-chunk-reload";
export const CHUNK_RELOAD_GAP_MS = 10 * 60 * 1000;
export function isChunkLoadError(e: unknown): boolean {
  const err = e as { name?: unknown; message?: unknown } | null;
  const name = typeof err?.name === "string" ? err.name : "";
  const msg = typeof err?.message === "string" ? err.message : String(e ?? "");
  return name === "ChunkLoadError" || /Loading chunk [^ ]+ failed|Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed/i.test(msg);
}
/** True when this tab may reload itself now (no self-reload in the last ten minutes); records the moment. */
export function claimChunkReload(now = Date.now()): boolean {
  try {
    const last = Number(sessionStorage.getItem(CHUNK_RELOAD_KEY) ?? 0);
    if (last && now - last < CHUNK_RELOAD_GAP_MS) return false;
    sessionStorage.setItem(CHUNK_RELOAD_KEY, String(now));
    return true;
  } catch { return false; } // no storage: never reload blind - the recovery screen takes it
}

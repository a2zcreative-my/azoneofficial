/* worker/src/backup-store.ts - WHERE BACKUPS LIVE, HOW LONG, AND THE MEDIA COPY.

   v1.244.0 (go-live audit F7 and the media gap, Release D; the owner's
   decisions D-4 "backups bucket now; staging later" and D-9 "DB 30 nights,
   media 90 days, audit never", 31-10-2026).

   THE BUCKET. Until 1.243.0 the nightly database export sat in the SAME
   bucket as the photos, receipts and signed documents it describes, under
   backups/, and nothing copied the media anywhere. One mistaken bucket
   operation lost both. Now a second bucket, bound as BACKUPS
   (azoneofficial-backups, created by the owner - wrangler.toml), holds:

     db/db-YYYY-MM-DD-HHMMSS/p00001.ndjson.gz ... manifest.json
                                   the nightly export (backup-manifest.ts)
     media/current/<key>           the latest copy of every media object,
                                   with its source etag, size and SHA-256
     media/versions/<day>/<key>    the copy a changed object replaced
     media/deleted/<day>/<key>     the copy of an object deleted from MEDIA
     media/manifests/<stamp>.json  what each copy pass took (incremental)
     media/index.json              the weekly full index (reconciliation)

   Without the binding (an older wrangler.toml, the guards' doubles) the
   database export falls back to MEDIA/backups/ exactly as before and the
   media copy does not run - it says so in System Health.

   RETENTION (D-9): the newest 30 complete database backups; media versions,
   deleted copies and incremental manifests for 90 days; media/current never
   expires while its object is live. audit_log is never pruned anywhere. */

export type Bucket = R2Bucket;
export interface StoreEnv { MEDIA: Bucket; BACKUPS?: Bucket }

export const DB_KEEP = 30;
export const MEDIA_KEEP_DAYS = 90;
export const MEDIA_HASH_MAX = 50 * 1024 * 1024; // larger objects are copied by stream, unhashed

export function backupStore(env: StoreEnv): { bucket: Bucket; root: string; separate: boolean } {
  return env.BACKUPS ? { bucket: env.BACKUPS, root: "db/", separate: true } : { bucket: env.MEDIA, root: "backups/", separate: false };
}

export const mytNow = (ms = Date.now()) => new Date(ms + 8 * 3600 * 1000).toISOString();
export const backupStamp = (ms = Date.now()) => {
  const t = mytNow(ms);
  return `${t.slice(0, 10)}-${t.slice(11, 19).replace(/:/g, "")}`;
};

export async function listAll(b: Bucket, prefix: string, include?: ("customMetadata" | "httpMetadata")[]): Promise<R2Object[]> {
  const out: R2Object[] = [];
  let cursor: string | undefined;
  do {
    const r = await b.list({ prefix, cursor, limit: 1000, ...(include ? { include } : {}) } as R2ListOptions);
    out.push(...r.objects);
    cursor = r.truncated ? (r as { cursor?: string }).cursor : undefined;
  } while (cursor);
  return out;
}

async function listPrefixes(b: Bucket, prefix: string): Promise<{ prefixes: string[]; objects: R2Object[] }> {
  const prefixes: string[] = []; const objects: R2Object[] = [];
  let cursor: string | undefined;
  do {
    const r = await b.list({ prefix, delimiter: "/", cursor, limit: 1000 } as R2ListOptions);
    prefixes.push(...((r as { delimitedPrefixes?: string[] }).delimitedPrefixes ?? []));
    objects.push(...r.objects);
    cursor = r.truncated ? (r as { cursor?: string }).cursor : undefined;
  } while (cursor);
  return { prefixes, objects };
}

async function deleteKeys(b: Bucket, keys: string[]): Promise<number> {
  for (let i = 0; i < keys.length; i += 1000) await b.delete(keys.slice(i, i + 1000));
  return keys.length;
}

export interface BackupUnit { id: string; kind: "paged" | "legacy"; key: string; complete: boolean; size: number; uploaded: string }

/** Every backup in the store, newest first: paged (a prefix with its
    manifest) and the 1.243.0-and-earlier single files. */
export async function backupUnits(env: StoreEnv): Promise<BackupUnit[]> {
  const { bucket, root } = backupStore(env);
  const { prefixes, objects } = await listPrefixes(bucket, root);
  const units: BackupUnit[] = [];
  for (const p of prefixes) {
    if (!/\/db-\d{4}-\d{2}-\d{2}-\d{6}\/$/.test(p)) continue;
    const m = await bucket.head(`${p}manifest.json`);
    units.push({ id: p, kind: "paged", key: `${p}manifest.json`, complete: !!m,
      size: m ? Number((m.customMetadata ?? {}).gz_bytes ?? m.size) : 0, uploaded: m ? m.uploaded.toISOString() : "" });
  }
  for (const o of objects) {
    if (!/db-\d{4}-\d{2}-\d{2}\.json(\.gz)?$/.test(o.key)) continue;
    units.push({ id: o.key, kind: "legacy", key: o.key, complete: true, size: o.size, uploaded: o.uploaded.toISOString() });
  }
  const stamp = (u: BackupUnit) => u.kind === "paged"
    ? (u.id.match(/db-(\d{4}-\d{2}-\d{2}-\d{6})\/$/)?.[1] ?? "")
    : `${u.id.match(/db-(\d{4}-\d{2}-\d{2})\.json/)?.[1] ?? ""}-000000`;
  return units.sort((a, b) => stamp(b).localeCompare(stamp(a)));
}

/** D-9: keep the newest 30 complete backups; remove older ones and any
    incomplete prefix older than two days (never one still being written). */
export async function pruneDbBackups(env: StoreEnv, keep = DB_KEEP, now = Date.now()): Promise<{ removed: number; kept: number }> {
  const { bucket } = backupStore(env);
  const units = await backupUnits(env);
  const complete = units.filter((u) => u.complete);
  const doomed = complete.slice(keep);
  const cutoff = backupStamp(now - 2 * 86400000);
  for (const u of units) {
    if (u.complete || u.kind !== "paged") continue;
    const stamp = u.id.match(/db-(\d{4}-\d{2}-\d{2}-\d{6})\/$/)?.[1] ?? "";
    if (stamp && stamp < cutoff) doomed.push(u);
  }
  let removed = 0;
  for (const u of doomed) {
    if (u.kind === "legacy") { await bucket.delete(u.key); removed++; continue; }
    const keys = (await listAll(bucket, u.id)).map((o) => o.key);
    await deleteKeys(bucket, keys);
    removed++;
  }
  return { removed, kept: Math.min(complete.length, keep) };
}

/* ------------------------------ the media copy ------------------------------ */

export interface MediaCopyResult { at: string; live: number; copied: number; replaced: number; pending: number; bytes: number; unhashed: number; skipped?: string }

const isBackupKey = (k: string) => k.startsWith("backups/");

/** Copy every new or changed media object (up to `cap` this pass) into
    BACKUPS/media/current/, keeping the copy it replaces under versions/. */
export async function runMediaCopy(env: StoreEnv, cap: number, now = Date.now()): Promise<MediaCopyResult> {
  const at = new Date(now).toISOString();
  if (!env.BACKUPS) return { at, live: 0, copied: 0, replaced: 0, pending: 0, bytes: 0, unhashed: 0, skipped: "no BACKUPS bucket bound" };
  const B = env.BACKUPS;
  const live = (await listAll(env.MEDIA, "")).filter((o) => !isBackupKey(o.key));
  const copies = new Map((await listAll(B, "media/current/", ["customMetadata"])).map((o) => [o.key.slice("media/current/".length), o]));
  const todo = live.filter((o) => {
    const c = copies.get(o.key);
    return !c || (c.customMetadata ?? {}).src_etag !== o.etag || Number((c.customMetadata ?? {}).src_size) !== o.size;
  }).sort((a, b) => a.key.localeCompare(b.key));
  const day = mytNow(now).slice(0, 10);
  const took: { key: string; size: number; sha256: string; etag: string }[] = [];
  let replaced = 0, bytes = 0, unhashed = 0;
  for (const o of todo.slice(0, cap)) {
    const src = await env.MEDIA.get(o.key);
    if (!src) continue; // deleted since the listing
    const prev = copies.get(o.key);
    if (prev) {
      const old = await B.get(prev.key);
      if (old) { await B.put(`media/versions/${day}/${o.key}`, await bodyOf(old), { httpMetadata: old.httpMetadata, customMetadata: old.customMetadata }); replaced++; }
    }
    let sha = "";
    if (src.size <= MEDIA_HASH_MAX) {
      const buf = await src.arrayBuffer();
      sha = await sha256OfBuffer(buf);
      await B.put(`media/current/${o.key}`, buf, { sha256: sha, httpMetadata: src.httpMetadata,
        customMetadata: { src_etag: src.etag, src_size: String(src.size), sha256: sha, copied_at: at } });
    } else {
      unhashed++;
      await B.put(`media/current/${o.key}`, src.body, { httpMetadata: src.httpMetadata,
        customMetadata: { src_etag: src.etag, src_size: String(src.size), sha256: "", copied_at: at } });
    }
    bytes += src.size;
    took.push({ key: o.key, size: src.size, sha256: sha, etag: src.etag });
  }
  if (took.length) await B.put(`media/manifests/${backupStamp(now)}.json`, JSON.stringify({ at, objects: took }), { httpMetadata: { contentType: "application/json" } });
  return { at, live: live.length, copied: took.length, replaced, pending: Math.max(0, todo.length - took.length), bytes, unhashed };
}

export interface ReconcileResult { at: string; live: number; present: number; missing: number; stale: number; orphaned: number; moved: number; sampled: number; bad: number; bad_keys: string[] }

/** Weekly: every live object has a current copy with the same etag and size;
    a sample of copies is re-read and its SHA-256 checked; a copy whose object
    is gone moves to deleted/<day>/ (kept 90 days); media/index.json is
    rewritten in full. */
export async function runMediaReconcile(env: StoreEnv, sample = 20, moveCap = 200, now = Date.now()): Promise<ReconcileResult | null> {
  if (!env.BACKUPS) return null;
  const B = env.BACKUPS;
  const at = new Date(now).toISOString();
  const live = new Map((await listAll(env.MEDIA, "")).filter((o) => !isBackupKey(o.key)).map((o) => [o.key, o]));
  const copies = (await listAll(B, "media/current/", ["customMetadata"])).map((o) => ({ key: o.key.slice("media/current/".length), o }));
  const byKey = new Map(copies.map((c) => [c.key, c.o]));
  let missing = 0, stale = 0;
  for (const [k, o] of live) {
    const c = byKey.get(k);
    if (!c) missing++;
    else if ((c.customMetadata ?? {}).src_etag !== o.etag || Number((c.customMetadata ?? {}).src_size) !== o.size) stale++;
  }
  const orphans = copies.filter((c) => !live.has(c.key));
  const day = mytNow(now).slice(0, 10);
  let moved = 0;
  for (const c of orphans.slice(0, moveCap)) {
    const obj = await B.get(c.o.key);
    if (obj) await B.put(`media/deleted/${day}/${c.key}`, await bodyOf(obj), { httpMetadata: obj.httpMetadata, customMetadata: obj.customMetadata });
    await B.delete(c.o.key);
    moved++;
  }
  /* the sample rotates with the week, so every copy is re-read in turn */
  const hashed = copies.filter((c) => live.has(c.key) && (c.o.customMetadata ?? {}).sha256);
  const week = Math.floor(now / (7 * 86400000));
  const start = hashed.length ? (week * sample) % hashed.length : 0;
  const pick = hashed.length <= sample ? hashed : [...hashed.slice(start), ...hashed.slice(0, start)].slice(0, sample);
  const badKeys: string[] = [];
  for (const c of pick) {
    const obj = await B.get(c.o.key);
    const got = obj ? await sha256OfBuffer(await obj.arrayBuffer()) : "";
    if (got !== (c.o.customMetadata ?? {}).sha256) badKeys.push(c.key);
  }
  const index = copies.filter((c) => live.has(c.key)).map((c) => ({ key: c.key, size: Number((c.o.customMetadata ?? {}).src_size ?? c.o.size), sha256: (c.o.customMetadata ?? {}).sha256 ?? "", etag: (c.o.customMetadata ?? {}).src_etag ?? "" }));
  await B.put("media/index.json", JSON.stringify({ at, objects: index }), { httpMetadata: { contentType: "application/json" } });
  return { at, live: live.size, present: live.size - missing, missing, stale, orphaned: orphans.length, moved, sampled: pick.length, bad: badKeys.length, bad_keys: badKeys.slice(0, 20) };
}

/** D-9: media versions, deleted copies and incremental manifests older than
    90 days go; the current copies stay. */
export async function pruneMediaBackups(env: StoreEnv, keepDays = MEDIA_KEEP_DAYS, cap = 5000, now = Date.now()): Promise<number> {
  if (!env.BACKUPS) return 0;
  const B = env.BACKUPS;
  const cutoff = mytNow(now - keepDays * 86400000).slice(0, 10);
  const doomed: string[] = [];
  for (const root of ["media/versions/", "media/deleted/"]) {
    const { prefixes } = await listPrefixes(B, root);
    for (const p of prefixes) {
      const d = p.slice(root.length, root.length + 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(d) && d < cutoff) doomed.push(...(await listAll(B, p)).map((o) => o.key));
      if (doomed.length >= cap) break;
    }
  }
  for (const o of await listAll(B, "media/manifests/")) {
    const d = o.key.slice("media/manifests/".length, "media/manifests/".length + 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(d) && d < cutoff) doomed.push(o.key);
  }
  return deleteKeys(B, doomed.slice(0, cap));
}

/** Small objects are moved as bytes; a large one as the stream R2 handed us
    (its length is known, which is what R2 needs to accept it). */
async function bodyOf(o: R2ObjectBody): Promise<ArrayBuffer | ReadableStream> {
  return o.size <= MEDIA_HASH_MAX ? o.arrayBuffer() : o.body;
}

async function sha256OfBuffer(buf: ArrayBuffer): Promise<string> {
  const h = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(h), (b) => b.toString(16).padStart(2, "0")).join("");
}

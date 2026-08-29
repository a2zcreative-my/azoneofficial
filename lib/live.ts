"use client";

/**
 * v1.65.0 — live cards.
 *
 * The portal used to load each card once and then let it rot. Two people on
 * the same shift could be looking at two different versions of the truth, and
 * the only cure was knowing to press reload — which is exactly the knowledge
 * the person who most needs the fresh number does not have.
 *
 * HOW IT WORKS, in one paragraph. The server keeps one integer per topic
 * (tasks, leave, orders, elfia …) and adds one to it whenever a write on that
 * topic succeeds. The numbers ride the notification SSE stream that was
 * already open. A card says which topics it cares about; when one of those
 * numbers moves, the card refetches through its own normal endpoint.
 *
 * WHY A NUMBER AND NOT THE DATA. Pushing the changed row would mean deciding,
 * on the server, who is allowed to see it — for every card, for every role,
 * forever — and getting that wrong shows the wrong person real figures. A
 * counter says only "something in this topic moved". The refetch then goes
 * through the endpoint that already knows who is asking. The blast radius of
 * a bug here is a wasted request, not a leak.
 *
 * WHY NOT REACT CONTEXT. A module-level store needs no provider threaded
 * through a 13,000-line page, works from any panel file without a prop, and
 * survives the tab strip unmounting whole subtrees. The trade is that it is
 * global state — which is correct here, because the versions genuinely are
 * global: they describe the database, not a component.
 */

type Versions = Record<string, number>;

let versions: Versions = {};
const subs = new Set<() => void>();

/* Bursts are normal: one save can bump a topic that three open cards watch,
   and a bulk action bumps once per request. Coalescing inside a frame turns a
   flurry into one round of refetches. */
let flushTimer: ReturnType<typeof setTimeout> | null = null;
function flush(): void {
  if (flushTimer !== null) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    for (const fn of subs) {
      try {
        fn();
      } catch {
        /* one bad subscriber must not stop the rest */
      }
    }
  }, 250);
}

/** Merge a frame from the stream (or a focus poll). Only ever moves forward:
    a late frame from a dying connection cannot drag a number backwards. */
export function applyVersions(next: Versions | null | undefined): void {
  if (!next || typeof next !== "object") return;
  let moved = false;
  for (const [topic, v] of Object.entries(next)) {
    if (typeof v !== "number" || !Number.isFinite(v)) continue;
    if ((versions[topic] ?? -1) < v) {
      versions[topic] = v;
      moved = true;
    }
  }
  if (moved) flush();
}

/** Re-run every subscriber without a new frame. The portal shell calls this
    when a tab returns to the foreground: the numbers may already be current
    (a frame arrived while hidden) but the cards deliberately did not act on
    them, so somebody has to say "now". */
export function pokeVersions(): void {
  flush();
}

export function getVersion(topic: string): number {
  return versions[topic] ?? 0;
}

/** Test seam and sign-out reset — a new session must not inherit the old
    session's baselines, or its first frame looks like a change. */
export function resetVersions(): void {
  versions = {};
}

export function subscribeVersions(fn: () => void): () => void {
  subs.add(fn);
  return () => {
    subs.delete(fn);
  };
}

/**
 * A SMALL, STRICT HOOKS RUNTIME — P0.4, for tests only.
 *
 * `lib/cached-api.ts` is the layer every remembered view in the portal reads
 * through. After the P0.4 refactor its correctness lives in four places that
 * a regex cannot see: the identity of the values `getSnapshot` returns, the
 * number of times it subscribes, the order two responses are allowed to land
 * in, and what it does when a component goes away mid-flight. Those have to
 * be RUN.
 *
 * The repository has no DOM and no React test renderer, so this file supplies
 * the hooks the module uses, for one component instance at a time. It is
 * deliberately small enough to read in one sitting, and deliberately STRICTER
 * than React where it can be:
 *
 *   · `useSyncExternalStore` calls getSnapshot TWICE every render and records
 *     an instability if the two results are not Object.is-equal. React would
 *     merely loop for ever; here it is a named failure with a line number.
 *   · every subscribe and unsubscribe is counted, so "it resubscribes on
 *     every render" is a number rather than an impression.
 *   · rendering after unmount is recorded as a failure rather than a warning.
 *
 * What it is NOT: a React implementation. It has no reconciliation, no
 * children, no concurrent rendering and no Suspense. It models the parts of
 * the contract this module depends on — hook order, dependency comparison,
 * effects after commit with cleanups before re-runs, batched asynchronous
 * re-render — and nothing else. A behaviour that needs more than that does
 * not belong in a node guard; it belongs in the browser probes.
 */

const is = Object.is;
const sameDeps = (a, b) =>
  Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => is(v, b[i]));

/**
 * One shared dispatcher, because the module under test imports `react` at
 * module scope and cannot be handed a different one per component. The
 * currently-rendering instance installs itself here for the length of its
 * body, exactly as React does.
 */
export const dispatcher = { current: null };

const call = (name) => (...args) => {
  if (!dispatcher.current) throw new Error(`${name} called outside a render`);
  return dispatcher.current[name](...args);
};

/** The module the stubbed `react` import resolves to. */
export const useState = call("useState");
export const useRef = call("useRef");
export const useCallback = call("useCallback");
export const useMemo = call("useMemo");
export const useEffect = call("useEffect");
export const useEffectEvent = call("useEffectEvent");
export const useSyncExternalStore = call("useSyncExternalStore");

/**
 * Render `component` (a function of no arguments returning anything) and keep
 * it live until `unmount()`. Returns a handle:
 *
 *   value            what the last render returned
 *   renders          how many times the component body ran
 *   subscribes       how many times any store's subscribe() was called
 *   unsubscribes     ditto for the returned unsubscribe
 *   snapshotFaults   getSnapshot returned a different identity twice in a row
 *   afterUnmount     the component tried to render after unmount
 *   rerender()       force a render (a parent re-rendering with new props)
 *   unmount()        run every cleanup, in reverse declaration order
 *   settle()         await the queued render/effect work
 *
 * `strict: true` models React's development double-invoke: the body runs
 * twice per render and, on mount, the effects run, are cleaned up, and run
 * again. That is the cheapest way to catch a fetch that fires twice or a
 * subscription that leaks.
 */
export function mount(component, { strict = false } = {}) {
  const slots = [];
  let cursor = 0;
  let live = true;
  let rendering = false;
  let queued = false;
  let firstCommit = true;

  const h = {
    value: undefined,
    renders: 0,
    subscribes: 0,
    unsubscribes: 0,
    snapshotFaults: [],
    afterUnmount: 0,
  };

  const slot = (init) => {
    if (cursor === slots.length) slots.push(init());
    return slots[cursor++];
  };

  const schedule = () => {
    if (!live) { h.afterUnmount++; return; }
    if (queued) return;
    queued = true;
    queueMicrotask(() => { queued = false; if (live) render(); });
  };

  /* effects queued by this render, in declaration order */
  let effectQueue = [];

  const queueEffect = (slot, run) => { slot.lastRun = run; effectQueue.push({ slot, run }); };

  const runEffects = () => {
    const q = effectQueue;
    effectQueue = [];
    for (const e of q) {
      if (typeof e.slot.cleanup === "function") { e.slot.cleanup(); e.slot.cleanup = undefined; }
      const c = e.run();
      e.slot.cleanup = typeof c === "function" ? c : undefined;
    }
  };
  const runCleanups = () => {
    for (let i = slots.length - 1; i >= 0; i--) {
      const s = slots[i];
      if (typeof s.cleanup === "function") { s.cleanup(); s.cleanup = undefined; }
    }
  };

  const hooks = {
    useState(init) {
      const s = slot(() => ({ value: typeof init === "function" ? init() : init }));
      if (!s.set) {
        s.set = (next) => {
          const v = typeof next === "function" ? next(s.value) : next;
          if (is(v, s.value)) return;
          s.value = v;
          schedule();
        };
      }
      return [s.value, s.set];
    },
    useRef(init) {
      return slot(() => ({ current: init }));
    },
    useCallback(fn, deps) {
      const s = slot(() => ({ fn: undefined, deps: undefined }));
      if (!sameDeps(s.deps, deps)) { s.fn = fn; s.deps = deps; }
      return s.fn;
    },
    useMemo(fn, deps) {
      const s = slot(() => ({ value: undefined, deps: undefined }));
      if (!sameDeps(s.deps, deps)) { s.value = fn(); s.deps = deps; }
      return s.value;
    },
    useEffect(fn, deps) {
      const s = slot(() => ({ deps: undefined, cleanup: undefined, first: true }));
      const changed = s.first || deps === undefined || !sameDeps(s.deps, deps);
      s.first = false;
      s.deps = deps;
      if (changed) queueEffect(s, fn);
    },
    /* React 19's useEffectEvent: stable identity, always the newest body,
       only legal inside an effect — which is the only place it is called. */
    useEffectEvent(fn) {
      const s = slot(() => ({ latest: undefined, stable: undefined }));
      s.latest = fn;
      if (!s.stable) s.stable = (...args) => s.latest(...args);
      return s.stable;
    },
    useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot) {
      const s = slot(() => ({ subscribe: undefined, get: undefined, value: undefined, cleanup: undefined, first: true }));
      s.get = getSnapshot;
      void getServerSnapshot;

      /* THE CHECK THIS FILE EXISTS FOR: two calls, one render, same identity. */
      const a = getSnapshot();
      const b = getSnapshot();
      if (!is(a, b)) {
        h.snapshotFaults.push(`getSnapshot returned a new identity on a second call (${String(a)} vs ${String(b)})`);
      }
      s.value = a;

      if (s.first || !is(s.subscribe, subscribe)) {
        s.first = false;
        const sub = subscribe;
        s.subscribe = sub;
        queueEffect(s, () => {
          h.subscribes++;
          const off = sub(() => {
            const next = s.get();
            if (is(next, s.value)) return;   // React does not re-render for an equal snapshot
            s.value = next;
            schedule();
          });
          /* React re-checks after subscribing, because the store can move
             between render and commit. */
          const afterSubscribe = s.get();
          if (!is(afterSubscribe, s.value)) { s.value = afterSubscribe; schedule(); }
          return () => { h.unsubscribes++; off(); };
        });
      }
      return a;
    },
  };

  function body() {
    cursor = 0;
    h.renders++;
    const previous = dispatcher.current;
    dispatcher.current = hooks;
    try { return component(); } finally { dispatcher.current = previous; }
  }

  function render() {
    if (!live) { h.afterUnmount++; return; }
    if (rendering) throw new Error("render during render");
    rendering = true;
    try {
      let out = body();
      if (strict) { out = body(); }           // the development double-invoke
      h.value = out;
    } finally {
      rendering = false;
    }
    runEffects();
    if (strict && firstCommit) {
      firstCommit = false;
      /* React 19 development: mount, unmount, mount again — EVERY effect,
         not only the subscriptions. Anything that double-fires (a second
         request per card) or leaks a subscription shows up here. */
      runCleanups();
      for (const s of slots) if (s.lastRun) effectQueue.push({ slot: s, run: s.lastRun });
      runEffects();
    } else {
      firstCommit = false;
    }
  }

  /* install the hooks for the module under test */
  h.hooks = hooks;
  h.rerender = () => { if (live) render(); };
  h.unmount = () => { if (!live) return; live = false; runCleanups(); };
  h.settle = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)); };

  render();
  return h;
}

export const tick = () => new Promise((r) => setTimeout(r, 0));

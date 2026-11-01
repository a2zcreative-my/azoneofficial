"use client";

/* v1.246.2 - THE PHOTO BOOK. The portal names staff in hundreds of rows
   (tasks, claims, leave, assets, projects...) and most of those lists never
   carried the photo, so the avatar fell back to initials everywhere but the
   profile. Instead of threading photo_key through every query, the book is
   read ONCE per session (GET /staff/photo-book: ids, names, photo keys of
   the staff who have a photo - nothing else) and the Avatar looks a name up
   in it when the row gives it no key of its own.

   An explicit photoKey (even null) still wins: a list that knows better is
   never second-guessed. A name that is not in the book keeps its initials. */

import { useSyncExternalStore } from "react";

type Person = { id: number; name: string; full_name: string | null; photo_key: string };
type Book = { byName: Map<string, string>; byId: Map<number, string>; loaded: boolean };

let book: Book = { byName: new Map(), byId: new Map(), loaded: false };
let started = false;
const subs = new Set<() => void>();
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

function load() {
  if (started || typeof window === "undefined") return;
  started = true;
  fetch("/api/v1/staff/photo-book", { credentials: "include" })
    .then((r) => (r.ok ? r.json() : null))
    .then((j: { people?: Person[] } | null) => {
      const byName = new Map<string, string>(); const byId = new Map<number, string>();
      for (const p of j?.people ?? []) {
        byId.set(p.id, p.photo_key);
        if (p.name) byName.set(norm(p.name), p.photo_key);
        if (p.full_name) byName.set(norm(p.full_name), p.photo_key);
      }
      book = { byName, byId, loaded: true };
      for (const fn of subs) fn();
    })
    .catch(() => { book = { ...book, loaded: true }; for (const fn of subs) fn(); });
}

const subscribe = (fn: () => void) => { subs.add(fn); load(); return () => { subs.delete(fn); }; };
const get = () => book;
const getServer = (): Book => ({ byName: new Map(), byId: new Map(), loaded: false });

/** The photo key for a staff name (or id), from the book; null when unknown. */
export function usePhotoBook(): { lookup: (name: string, id?: number | null) => string | null; loaded: boolean } {
  const b = useSyncExternalStore(subscribe, get, getServer);
  return {
    loaded: b.loaded,
    lookup: (name, id) => (id != null && b.byId.get(id)) || b.byName.get(norm(name)) || null,
  };
}

/** Tests and sign-out: forget the book so the next render reads it again. */
export function resetPhotoBook() { book = { byName: new Map(), byId: new Map(), loaded: false }; started = false; }

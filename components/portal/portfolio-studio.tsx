"use client";
/* eslint-disable @next/next/no-img-element -- work thumbnails come from the staff media route */

/**
 * v1.389.0 - STAFF -> PORTFOLIOS: the Staff Portfolio Card Generator (the CEO, 19-11-2026).
 *
 * Pick a person on staff; their name, position, department, photo and responsibilities come
 * from their staff record (worker/src/portfolios.ts reads them every time - nothing is copied
 * and nothing here writes the staff record except the existing staff photo door). Add a
 * tagline, specialties, the work; adjust the photo (zoom, position, remove the background);
 * preview the front and back exactly as they will be saved (one canvas: lib/portfolio-card.ts);
 * publish (the approval); then the QR, Download PNG / PDF, copy the link and share.
 *
 * No QR before publishing: a QR is only ever drawn for a page that exists.
 * The strip is the shared KpiRow / KpiTile; buttons, fields, chips and the drawer are the
 * portal's own (lib/ui-styles.ts, SideDrawer). Only the exported card has its own look.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AppIcon } from "@/components/ui/app-icon";
import { Avatar } from "@/components/ui/avatar";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { LineTabs } from "@/components/ui/line-tabs";
import { DrawerFoot, DrawerForm, DrawerPanel, SideDrawer } from "@/components/ui/side-drawer";
import { useSaveToast } from "@/components/ui/save-toast";
import { SkelRows } from "@/components/ui/skeleton";
import { TabZone } from "@/components/portal/tab-concept";
import { csrfFetch, makeApi } from "@/lib/api";
import { getLang } from "@/lib/i18n";
import { CARD_SIZES, type CardCrop, type CardSize, type CardTemplate } from "@/lib/portfolio-card";
import {
  cardDataOf, reviewWords, decodePortrait, fetchBlob, fileBase, loadLogo, mediaUrl, paint, pdfOf, pngOf, qrPng, qrSvg, saveBlob, shareCard, testScan,
  type LoadedPortrait, type PortfolioDetail, type PortfolioMs,
} from "@/lib/portfolio-render";
import { btnSm, btnSmPrimary, btnSmQuiet, chipSmInfo, chipSmNeutral, chipSmSuccess, chipSmWarn, fieldLabel, inputClass, selectClass, textareaClass, th, td } from "@/lib/ui-styles";
import css from "./portfolio-studio.module.css";

const api = makeApi("/staff");
const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);

interface Person {
  user_id: number; name: string; position: string | null; department: string | null; photo_key: string | null; public_duties: number;
  portfolio: { id: number; slug: string; state: string; updated_at: string | null; published_at: string | null; tagline: string | null; specialties: number; public_url: string | null; portrait_stale: boolean } | null;
  /** 0219 - where the review stands */
  review?: { stage: "precheck" | "approval" | "returned"; prechecker: { name: string | null; role: string | null } | null; mine: boolean } | null;
}
interface ListResp { people: Person[]; counts: { staff: number; published: number; draft: number; unpublished: number; none: number; no_photo: number }; can: { edit: boolean; publish: boolean } }

const STATE_CHIP: Record<string, [string, () => string]> = {
  draft: [chipSmWarn, () => L("Draft", "Draf")],
  published: [chipSmSuccess, () => L("Published", "Diterbitkan")],
  unpublished: [chipSmNeutral, () => L("Unpublished", "Ditarik balik")],
};
const DEFAULT_CROP: CardCrop = { zoom: 1, x: 0, y: 0 };
/** a cut-out keeps the whole photo's size with clear pixels around the person: trim it to the
    person (and a small margin) so the card and the public page show them large */
async function trimToPerson(png: Blob): Promise<Blob> {
  const { alphaBox } = await import("@/lib/portfolio-card");
  const bmp = await createImageBitmap(png);
  const b = alphaBox(bmp, bmp.width, bmp.height);
  const m = Math.round(Math.max(b.w, b.h) * 0.03);
  const x = Math.max(0, Math.floor(b.x - m)), y = Math.max(0, Math.floor(b.y - m));
  const w = Math.min(bmp.width - x, Math.ceil(b.w + m * 2)), h = Math.min(bmp.height - y, Math.ceil(b.h + m));
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  c.getContext("2d")!.drawImage(bmp, x, y, w, h, 0, 0, w, h);
  return new Promise((res) => c.toBlob((o) => res(o ?? png), "image/png"));
}
const lines = (s: string) => s.split(/\n/).map((x) => x.trim()).filter(Boolean);

export function PortfolioStudio({ focusUserId, onFocused }: { focusUserId?: number | null; onFocused?: () => void }) {
  const { show, node: toastNode } = useSaveToast();
  const [list, setList] = useState<ListResp | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "published" | "draft" | "unpublished" | "none">("all");
  const [openId, setOpenId] = useState<number | null>(null);

  const load = useCallback(async () => {
    const r = await api<ListResp>("/portfolios");
    if (r.ok && r.data) { setList(r.data); setErr(null); }
    else setErr(r.status === 409 || r.status === 500 ? L("Portfolios need this release's database update (migration 0215) - run PUSH.bat", "Portfolio memerlukan kemas kini pangkalan data (migrasi 0215) - jalankan PUSH.bat") : L("Could not load portfolios", "Tidak dapat memuatkan portfolio"));
  }, []);
  useEffect(() => { void load(); }, [load]);

  const create = useCallback(async (userId: number) => {
    const r = await api<{ id: number }>("/portfolios", { method: "POST", body: JSON.stringify({ user_id: userId }) });
    if (r.ok && r.data?.id) { setOpenId(r.data.id); void load(); }
    else show(L("Could not create the portfolio", "Tidak dapat mencipta portfolio"), (r.data as { error?: { message?: string } } | null)?.error?.message ?? "", "error");
  }, [load, show]);

  /* Staff -> a person's profile -> Portfolio lands here for that person */
  useEffect(() => {
    if (!focusUserId || !list) return;
    const p = list.people.find((x) => x.user_id === focusUserId);
    if (p?.portfolio) setOpenId(p.portfolio.id);
    else if (p && list.can.edit) void create(p.user_id);
    onFocused?.();
  }, [focusUserId, list, create, onFocused]);

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (list?.people ?? []).filter((p) => (filter === "all" || (filter === "none" ? !p.portfolio : p.portfolio?.state === filter))
      && (!t || `${p.name} ${p.position ?? ""} ${p.department ?? ""}`.toLowerCase().includes(t)));
  }, [list, q, filter]);

  const c = list?.counts;
  const tile = (key: typeof filter, icon: Parameters<typeof KpiTile>[0]["icon"], tone: Parameters<typeof KpiTile>[0]["tone"], label: string, value: number | undefined, sub: string) => (
    <KpiTile icon={icon} tone={tone} label={label} value={value ?? 0} busy={!list} sub={sub} onClick={() => setFilter(key)} pressed={filter === key} testid={`pf-kpi-${key}`} />
  );

  return (
    <div className={css.root} data-testid="portfolio-studio">
      {toastNode}
      <TabZone label={L("Portfolio figures", "Angka portfolio")}>
        <KpiRow label={L("Portfolio figures", "Angka portfolio")} cols={5} testid="pf-kpis">
          {tile("all", "users", "navy", L("Staff", "Kakitangan"), c?.staff, L("On staff today", "Dalam kakitangan hari ini"))}
          {tile("published", "success", "green", L("Published", "Diterbitkan"), c?.published, L("Public page and QR live", "Halaman awam dan QR aktif"))}
          {tile("draft", "edit", "gold", L("Drafts", "Draf"), c?.draft, L("Not public yet", "Belum awam"))}
          {tile("unpublished", "blocked", "purple", L("Unpublished", "Ditarik balik"), c?.unpublished, L("Taken off the web", "Dikeluarkan dari web"))}
          {tile("none", "person", "blue", L("No portfolio", "Tiada portfolio"), c?.none, c ? L(`${c.no_photo} without a photo`, `${c.no_photo} tanpa foto`) : "")}
        </KpiRow>
      </TabZone>

      <TabZone label={L("Staff portfolios", "Portfolio kakitangan")}>
        <section className="erp-card" data-testid="pf-list">
          <div className={css.listHead}>
            <div>
              <h3 className="erp-heading">{L("Staff portfolios", "Portfolio kakitangan")}</h3>
              <p className="erp-meta">{L("Name, position, department, photo and responsibilities come from each staff record. Nothing is public until it is published.", "Nama, jawatan, jabatan, foto dan tanggungjawab diambil daripada rekod kakitangan. Tiada yang awam sehingga diterbitkan.")}</p>
            </div>
            <input className={inputClass} type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={L("Search staff", "Cari kakitangan")} aria-label={L("Search staff", "Cari kakitangan")} data-testid="pf-search" />
          </div>
          {err && <p className="erp-meta" role="alert" data-testid="pf-error">{err}</p>}
          <div className="erp-table-scroll">
            <table className={css.table}>
              <thead><tr><th className={th}>{L("Staff", "Kakitangan")}</th><th className={th}>{L("Position", "Jawatan")}</th><th className={th}>{L("Department", "Jabatan")}</th><th className={th}>{L("Status", "Status")}</th><th className={th}>{L("Public link", "Pautan awam")}</th><th className={th} aria-label={L("Actions", "Tindakan")} /></tr></thead>
              <tbody>
                {shown.map((p) => {
                  const st = p.portfolio ? STATE_CHIP[p.portfolio.state] : null;
                  return (
                    <tr key={p.user_id} data-testid={`pf-row-${p.user_id}`}>
                      <td className={td}><span className={css.who}><Avatar name={p.name} photoKey={p.photo_key} userId={p.user_id} size="sm" /><span><strong>{p.name}</strong>{!p.photo_key && <small className="erp-meta">{L("No photo yet", "Belum ada foto")}</small>}</span></span></td>
                      <td className={td}>{p.position ?? <span className="erp-meta">{L("Not set", "Belum ditetapkan")}</span>}</td>
                      <td className={td}>{p.department ?? <span className="erp-meta">-</span>}</td>
                      <td className={td}>{st ? <span className={st[0]}>{st[1]()}</span> : <span className={chipSmInfo}>{L("No portfolio", "Tiada portfolio")}</span>}{p.portfolio?.portrait_stale && <small className="erp-meta"> {L("New staff photo", "Foto baharu")}</small>}
                        {p.review && <small className="erp-meta" data-testid={`pf-review-${p.user_id}`}> {p.review.mine ? L("Waiting for your pre-check", "Menunggu semakan awal anda") : p.review.stage === "approval" ? L("Ready to approve", "Sedia untuk diluluskan") : reviewWords(p.review, getLang() === "ms")}</small>}</td>
                      <td className={td}>{p.portfolio?.public_url ? <a href={p.portfolio.public_url} target="_blank" rel="noopener" className={css.link}>/portfolio/{p.portfolio.slug}</a> : <span className="erp-meta">{L("None until published", "Tiada sehingga diterbitkan")}</span>}</td>
                      <td className={td}>
                        {p.portfolio
                          ? <button type="button" className={btnSm} onClick={() => setOpenId(p.portfolio!.id)} data-testid={`pf-open-${p.user_id}`}><AppIcon name="edit" />{L("Open", "Buka")}</button>
                          : list?.can.edit && <button type="button" className={btnSmPrimary} onClick={() => void create(p.user_id)} data-testid={`pf-create-${p.user_id}`}><AppIcon name="add" />{L("Create", "Cipta")}</button>}
                      </td>
                    </tr>
                  );
                })}
                {!list && <tr><td className={td} colSpan={6}><SkelRows rows={4} /></td></tr>}
                {list && !shown.length && <tr><td className={td} colSpan={6}><span className="erp-meta">{L("Nobody matches", "Tiada padanan")}</span></td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      </TabZone>

      <PortfolioEditor id={openId} onClose={() => { setOpenId(null); void load(); }} notify={show} />
    </div>
  );
}

type Tab = "card" | "details" | "work" | "bm" | "publish";
type Draft = Partial<PortfolioDetail["portfolio"]>;

export function PortfolioEditor({ id, onClose, notify }: { id: number | null; onClose: () => void; notify: (t: string, s?: string, v?: "success" | "notice" | "error") => void }) {
  const [d, setD] = useState<PortfolioDetail | null>(null);
  const [draft, setDraft] = useState<Draft>({});
  const [tab, setTab] = useState<Tab>("card");
  const [side, setSide] = useState<"front" | "back">("front");
  const [size, setSize] = useState<CardSize>("story");
  const [portrait, setPortrait] = useState<LoadedPortrait | null>(null);
  const [pending, setPending] = useState<Blob | null>(null); // a cut-out or a new portfolio photo, not saved yet
  const [pendingOwn, setPendingOwn] = useState(false); // the pending picture is the portfolio's own photo
  /* the list boxes as typed: the saved list is cleaned (trimmed, blank lines dropped), but cleaning on every
     keystroke ate the space after a word and the Enter for a new line (the CEO, 19-11-2026) */
  const [listText, setListText] = useState<{ specialties?: string; expertise?: string }>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [reviewNote, setReviewNote] = useState(""); // 0219 - the pre-checker's note (needed to return it)
  const [logo, setLogo] = useState<HTMLImageElement | null>(null);
  const [fontsReady, setFontsReady] = useState(false);
  const front = useRef<HTMLCanvasElement | null>(null);
  const back = useRef<HTMLCanvasElement | null>(null);

  /* the toast's function may change between renders: read it through a ref, so a toast never
     reloads the portfolio (and never throws away what is being typed) */
  const notifyRef = useRef(notify);
  notifyRef.current = notify;
  const load = useCallback(async () => {
    if (!id) return;
    const r = await api<PortfolioDetail>(`/portfolios/${id}`);
    if (r.ok && r.data) { setD(r.data); setDraft({}); setPending(null); setPendingOwn(false); setListText({}); }
    else notifyRef.current(L("Could not open the portfolio", "Tidak dapat membuka portfolio"), "", "error");
  }, [id]);
  useEffect(() => { setD(null); setTab("card"); if (id) void load(); }, [id, load]);
  useEffect(() => { void loadLogo().then(setLogo); void document.fonts?.ready.then(() => setFontsReady(true)); }, []);

  /* the picture on the card: an unsaved cut-out, else the portfolio's portrait (unless the staff photo changed since), else the staff photo */
  const portraitKey = d ? (d.portfolio.portrait_key && !d.portfolio.portrait_stale ? d.portfolio.portrait_key : d.staff.photo_key) : null;
  useEffect(() => {
    let live = true;
    void (async () => {
      const blob = pending ?? (portraitKey ? await fetchBlob(mediaUrl(portraitKey)) : null);
      const p = blob ? await decodePortrait(blob).catch(() => null) : null;
      if (live) setPortrait(p);
    })();
    return () => { live = false; };
  }, [portraitKey, pending]);

  const merged = useMemo(() => (d ? { ...d.portfolio, ...draft } : null), [d, draft]);
  const data = useMemo(() => (d ? cardDataOf(d, draft) : null), [d, draft]);
  const crop: CardCrop = (merged?.photo_crop as CardCrop | null) ?? DEFAULT_CROP;
  const assets = useMemo(() => ({ logo, portrait, crop }), [logo, portrait, crop]);
  useEffect(() => {
    if (!data) return;
    if (front.current) paint(front.current, "front", size, data, assets);
    if (back.current) paint(back.current, "back", size, data, assets);
  }, [data, assets, size, fontsReady, side]);

  if (!id) return null;
  const set = (patch: Draft) => setDraft((x) => ({ ...x, ...patch }));
  const dirty = Object.keys(draft).length > 0 || Boolean(pending);
  const edit = Boolean(d?.can.edit);
  const published = d?.portfolio.state === "published";

  const save = async (): Promise<boolean> => {
    if (!d) return false;
    if (pending) {
      setBusy("portrait");
      /* the portfolio's own photo - a new upload, or a cut-out of the own photo already in use - never the staff record */
      const own = pendingOwn || Boolean(d.portfolio.portrait_own && !d.portfolio.portrait_stale);
      const res = await csrfFetch(`/api/v1/staff/portfolios/${d.portfolio.id}/portrait${own ? "?own=1" : ""}`, { method: "POST", headers: { "Content-Type": pending.type || "image/png" }, body: pending });
      setBusy(null);
      if (!res.ok) { notify(L("The portrait was not saved", "Potret tidak disimpan"), "", "error"); return false; }
    }
    if (Object.keys(draft).length) {
      const fresh = await api<PortfolioDetail>(`/portfolios/${d.portfolio.id}`);
      const version = pending && fresh.data ? fresh.data.portfolio.version : d.portfolio.version;
      setBusy("save");
      const r = await api<{ version: number }>(`/portfolios/${d.portfolio.id}`, { method: "PUT", body: JSON.stringify({ ...draft, version }) });
      setBusy(null);
      if (!r.ok) { notify(L("Not saved", "Tidak disimpan"), (r.data as { error?: { message?: string } } | null)?.error?.message ?? "", "error"); return false; }
    }
    notify(L("Saved", "Disimpan"), published ? L("Publish again to put the changes on the public page", "Terbitkan semula untuk memaparkan perubahan") : "");
    await load();
    return true;
  };

  const removeBackground = async () => {
    if (!portraitKey && !pending) return;
    setBusy("cutout");
    try {
      const src = pending ?? (await fetchBlob(mediaUrl(portraitKey!)));
      if (!src) throw new Error("no photo");
      const { cutoutPhoto } = await import("@/lib/cutout");
      setPending(await trimToPerson(await cutoutPhoto(src)));
      notify(L("Background removed", "Latar belakang dibuang"), L("Check the preview, then Save", "Semak pratonton, kemudian Simpan"));
    } catch { notify(L("The background could not be removed on this device", "Latar belakang tidak dapat dibuang pada peranti ini"), "", "error"); }
    setBusy(null);
  };
  const resetToStaffPhoto = async () => {
    if (!d) return;
    setPending(null); setPendingOwn(false);
    const r = await api(`/portfolios/${d.portfolio.id}/portrait/reset`, { method: "POST", body: "{}" });
    if (r.ok) { notify(L("Using the staff photo", "Menggunakan foto kakitangan")); void load(); }
  };
  /* the portfolio's own photo: shown in the preview at once, saved with Save - the staff record photo is not touched */
  const pickPortfolioPhoto = async (f: File | undefined) => {
    if (!d || !f) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(f.type)) { notify(L("Use a JPG, PNG or WebP image", "Gunakan imej JPG, PNG atau WebP"), "", "error"); return; }
    setBusy("photo");
    const { compressImage } = await import("@/lib/compress-image");
    const blob = await compressImage(f, 2800, 0.92).catch(() => null); // v1.390.1 - enough detail for the 2x card (was 2000)
    setBusy(null);
    if (!blob) { notify(L("That photo could not be read", "Foto itu tidak dapat dibaca"), "", "error"); return; }
    setPending(blob); setPendingOwn(true);
    notify(L("Portfolio photo added", "Foto portfolio ditambah"), L("Check the preview, then Save - the staff record photo is not changed", "Semak pratonton, kemudian Simpan - foto rekod kakitangan tidak diubah"));
  };

  const publish = async () => {
    if (!d) return;
    if (dirty && !(await save())) return;
    const fresh = await api<PortfolioDetail>(`/portfolios/${d.portfolio.id}`);
    const r = await api<{ public_url: string }>(`/portfolios/${d.portfolio.id}/publish`, { method: "POST", body: JSON.stringify({ version: fresh.data?.portfolio.version ?? d.portfolio.version }) });
    if (r.ok) { notify(L("Published", "Diterbitkan"), r.data?.public_url ?? ""); void load(); }
    else notify(L("Not published", "Tidak diterbitkan"), (r.data as { error?: { message?: string } } | null)?.error?.message ?? "", "error");
  };
  /* 0220 - Translate to BM: a proposal from the English in the editor; it fills only the empty BM boxes */
  const translate = async () => {
    if (!d || !merged) return;
    setBusy("translate");
    const r = await api<{ content_ms: PortfolioMs | null }>(`/portfolios/${d.portfolio.id}/translate`, { method: "POST", body: JSON.stringify({ tagline: merged.tagline ?? "", intro: merged.intro ?? "", experience: merged.experience ?? "", specialties: merged.specialties ?? [], expertise: merged.expertise ?? [] }) });
    setBusy(null);
    if (!r.ok || !r.data?.content_ms) { notify(L("Not translated", "Tidak diterjemah"), (r.data as { error?: { message?: string } } | null)?.error?.message ?? "", "error"); return; }
    const got = r.data.content_ms; const cur: PortfolioMs = merged.content_ms ?? {};
    const keep = (a?: string, b?: string) => (a && a.trim() ? a : b);
    const items: NonNullable<PortfolioMs["items"]> = { ...(got.items ?? {}) };
    for (const [k, v] of Object.entries(cur.items ?? {})) items[k] = { title: keep(v.title, items[k]?.title), description: keep(v.description, items[k]?.description) };
    const phrases: Record<string, string> = { ...(got.phrases ?? {}) };
    for (const [k, v] of Object.entries(cur.phrases ?? {})) if (v.trim()) phrases[k] = v;
    set({ content_ms: { tagline: keep(cur.tagline, got.tagline), intro: keep(cur.intro, got.intro), experience: keep(cur.experience, got.experience), phrases, items } });
    notify(L("Translated - check every line", "Diterjemah - semak setiap baris"), L("Boxes you had already written were kept. Save to keep the BM words.", "Kotak yang telah anda tulis dikekalkan. Simpan untuk mengekalkan perkataan BM."));
  };
  /* v1.390.0 - the person's own portfolio: save, then ask the approvers to check and publish it */
  const submit = async () => {
    if (!d) return;
    if (dirty && !(await save())) return;
    setBusy("submit");
    const r = await api<{ stage: "precheck" | "approval"; prechecker: { name: string | null; role: string | null } | null; already?: boolean }>("/portfolios/mine/submit", { method: "POST", body: "{}" });
    setBusy(null);
    if (r.ok && r.data) {
      notify(r.data.already ? L("Already sent", "Sudah dihantar") : L("Sent for approval", "Dihantar untuk kelulusan"),
        r.data.stage === "precheck" && r.data.prechecker
          ? L(`${r.data.prechecker.name} (${(r.data.prechecker.role ?? "").toUpperCase()}) pre-checks it first, then the CEO approves it. Downloads open once it is published.`, `${r.data.prechecker.name} (${(r.data.prechecker.role ?? "").toUpperCase()}) menyemak dahulu, kemudian CEO meluluskannya. Muat turun dibuka selepas diterbitkan.`)
          : L("The CEO will check it and publish it. Downloads open once it is published.", "CEO akan menyemak dan menerbitkannya. Muat turun dibuka selepas diterbitkan."));
      void load();
    } else notify(L("Not sent", "Tidak dihantar"), (r.data as { error?: { message?: string } } | null)?.error?.message ?? "", "error");
  };
  /* 0219 - the COO / CCO on the reporting chart: pre-checked, or returned with a note */
  const precheck = async (decision: "ok" | "return") => {
    if (!d) return;
    if (decision === "return" && reviewNote.trim().length < 5) { notify(L("Say what needs changing", "Nyatakan apa yang perlu diubah"), L("Write a short note (5 characters or more) before returning it", "Tulis nota ringkas (5 aksara atau lebih) sebelum mengembalikannya"), "error"); return; }
    setBusy("precheck");
    const r = await api(`/portfolios/${d.portfolio.id}/precheck`, { method: "POST", body: JSON.stringify({ decision, note: reviewNote.trim() || null }) });
    setBusy(null);
    if (r.ok) {
      notify(decision === "ok" ? L("Pre-checked", "Disemak awal") : L("Returned", "Dikembalikan"), decision === "ok" ? L("The CEO is asked to approve and publish it", "CEO diminta meluluskan dan menerbitkannya") : L("The person is told what to change", "Orang itu dimaklumkan apa yang perlu diubah"));
      setReviewNote(""); void load();
    } else notify(L("Not done", "Tidak dibuat"), (r.data as { error?: { message?: string } } | null)?.error?.message ?? "", "error");
  };
  const unpublish = async () => {
    if (!d) return;
    const r = await api(`/portfolios/${d.portfolio.id}/unpublish`, { method: "POST", body: "{}" });
    if (r.ok) { notify(L("Unpublished", "Ditarik balik"), L("The public page and its QR no longer open", "Halaman awam dan QR tidak lagi dibuka")); void load(); }
  };

  const exportPng = async (s: "front" | "back") => { if (d && data) saveBlob(await pngOf(s, size, data, assets), `${fileBase(d)}-${s}${size === "compact" ? "-54x86" : ""}.png`); };
  const exportPdf = () => { if (d && data) saveBlob(pdfOf(size, data, assets), `${fileBase(d)}${size === "compact" ? "-54x86mm" : ""}.pdf`); };
  const copyLink = async () => {
    if (!d?.portfolio.public_url) return;
    try { await navigator.clipboard.writeText(d.portfolio.public_url); notify(L("Link copied", "Pautan disalin"), d.portfolio.public_url); }
    catch { notify(L("Copy this link", "Salin pautan ini"), d.portfolio.public_url, "notice"); }
  };
  const share = async () => {
    if (!d || !data) return;
    const blob = await pngOf("front", size, data, assets);
    const ok = await shareCard(blob, `${fileBase(d)}-front.png`, d.portfolio.public_url, `${d.staff.name} - A2Z Creative Marketing`);
    if (!ok) { saveBlob(blob, `${fileBase(d)}-front.png`); notify(L("Saved the card image", "Imej kad disimpan"), L("This device has no share sheet - send the saved image", "Peranti ini tiada lembaran kongsi - hantar imej yang disimpan"), "notice"); }
  };
  const scan = async () => {
    if (!d || !data || !d.portfolio.public_url) return;
    const got = await testScan(await pngOf("back", size, data, assets));
    if (got === "unsupported") notify(L("This browser cannot read QR codes", "Pelayar ini tidak dapat membaca QR"), L("Scan the back of the card with your phone camera", "Imbas belakang kad dengan kamera telefon"), "notice");
    else if (got === d.portfolio.public_url) notify(L("QR scans correctly", "QR diimbas dengan betul"), got);
    else notify(L("The QR did not read back", "QR tidak terbaca"), got ?? "", "error");
  };

  const st = d ? STATE_CHIP[d.portfolio.state] : null;
  const scale = 0.32;
  const { w: CW, h: CH } = CARD_SIZES[size];

  const preview = d && (
    <DrawerPanel icon="preview" title={L("Card preview", "Pratonton kad")} sub={L("Saved exactly as shown", "Disimpan sama seperti dipaparkan")} testid="pf-preview">
      <div className={css.previewBar}>
        <span className="erp-flex" role="group" aria-label={L("Side", "Sisi")}>
          <button type="button" className={side === "front" ? btnSmPrimary : btnSm} aria-pressed={side === "front"} onClick={() => setSide("front")} data-testid="pf-side-front">{L("Front", "Depan")}</button>
          <button type="button" className={side === "back" ? btnSmPrimary : btnSm} aria-pressed={side === "back"} onClick={() => setSide("back")} data-testid="pf-side-back">{L("Back", "Belakang")}</button>
        </span>
        <select className={selectClass} value={size} onChange={(e) => setSize(e.target.value as CardSize)} aria-label={L("Card size", "Saiz kad")} data-testid="pf-size">
          <option value="story">{L("Digital 1080 x 1920", "Digital 1080 x 1920")}</option>
          <option value="compact">{L("Printed card 54 x 86 mm", "Kad cetak 54 x 86 mm")}</option>
        </select>
      </div>
      <div className={css.canvasWrap} style={{ aspectRatio: `${CW} / ${CH}` }}>
        <canvas ref={front} className={side === "front" ? css.canvas : css.hidden} width={CW} height={CH} style={{ width: CW * scale }} aria-label={L("Front of the card", "Depan kad")} data-testid="pf-canvas-front" />
        <canvas ref={back} className={side === "back" ? css.canvas : css.hidden} width={CW} height={CH} style={{ width: CW * scale }} aria-label={L("Back of the card", "Belakang kad")} data-testid="pf-canvas-back" />
      </div>
      {!published && <p className="erp-meta" data-testid="pf-qr-note">{L("The QR appears on the back once the portfolio is published - it never points at a page that does not exist.", "QR muncul di belakang selepas portfolio diterbitkan - ia tidak sekali-kali menunjuk ke halaman yang tiada.")}</p>}
    </DrawerPanel>
  );

  return (
    <SideDrawer open={Boolean(id)} onClose={onClose} form dirty={dirty} icon="identification"
      title={d ? d.staff.name : L("Portfolio", "Portfolio")}
      subtitle={d ? <span className="erp-flex">{st && <span className={st[0]} data-testid="pf-state">{st[1]()}</span>}<span>{d.staff.position ?? L("No position on the staff record", "Tiada jawatan pada rekod")}{d.staff.department ? ` · ${d.staff.department}` : ""}</span></span> : undefined}>
      {!d ? <SkelRows rows={6} /> : (
        <DrawerForm aside={preview} testid="pf-editor">
          {d.review && (
            <section className={css.photoBox} data-testid="pf-review">
              <strong>{L("Review", "Semakan")}</strong>
              <p className="erp-meta" data-testid="pf-review-words">{reviewWords(d.review, getLang() === "ms")}{d.review.changed_since && d.review.stage !== "returned" ? L(" - changed since it was sent", " - berubah sejak dihantar") : ""}</p>
              {d.can.precheck && (
                <>
                  <label className={fieldLabel}>{L("Note (needed to return it)", "Nota (perlu untuk mengembalikan)")}
                    <textarea className={textareaClass} rows={2} maxLength={500} value={reviewNote} onChange={(e) => setReviewNote(e.target.value)} data-testid="pf-review-note" />
                  </label>
                  <div className={css.actions}>
                    <button type="button" className={btnSmPrimary} disabled={Boolean(busy)} onClick={() => void precheck("ok")} data-testid="pf-precheck-ok"><AppIcon name="verify" />{L("Pre-check OK", "Semakan awal OK")}</button>
                    <button type="button" className={btnSm} disabled={Boolean(busy)} onClick={() => void precheck("return")} data-testid="pf-precheck-return"><AppIcon name="blocked" />{L("Return with note", "Kembalikan dengan nota")}</button>
                  </div>
                </>
              )}
            </section>
          )}
          <LineTabs value={tab} onChange={setTab} label={L("Portfolio sections", "Bahagian portfolio")} testid="pf-tab"
            tabs={[["card", L("Card", "Kad")], ["details", L("Details", "Butiran")], ["work", L("Work", "Kerja"), d.items.length], ["bm", L("BM text", "Teks BM")], ["publish", L("Publish & share", "Terbit & kongsi")]]} />

          {tab === "card" && (
            <div className="erp-stack" data-testid="pf-sec-card">
              <label className={fieldLabel}>{L("Template", "Templat")}
                <select className={selectClass} value={merged!.template} disabled={!edit} onChange={(e) => set({ template: e.target.value as CardTemplate })} data-testid="pf-template">
                  <option value="navy">{L("Navy & gold (A2Z)", "Biru tua & emas (A2Z)")}</option>
                  <option value="gold">{L("Gold accent", "Aksen emas")}</option>
                  <option value="light">{L("Light blue", "Biru cerah")}</option>
                </select>
              </label>
              <label className={fieldLabel}>{L("Name on the card (nickname)", "Nama pada kad (nama panggilan)")}
                <input className={inputClass} maxLength={60} value={merged!.display_name ?? ""} disabled={!edit} onChange={(e) => set({ display_name: e.target.value })} placeholder={d.staff.name} data-testid="pf-display-name" />
                <span className="erp-meta">{L("Shown on the card and the public page. Leave empty to use the full name. The staff record keeps the full name.", "Dipaparkan pada kad dan halaman awam. Biarkan kosong untuk nama penuh. Rekod kakitangan kekal dengan nama penuh.")}</span>
              </label>
              <label className={fieldLabel}>{L("Letters for the name", "Huruf untuk nama")}
                <select className={selectClass} value={merged!.name_case === "upper" ? "upper" : "normal"} disabled={!edit} onChange={(e) => set({ name_case: e.target.value === "upper" ? "upper" : "normal" })} data-testid="pf-name-case">
                  <option value="normal">{L("Normal letters (Nurul Fasehah)", "Huruf biasa (Nurul Fasehah)")}</option>
                  <option value="upper">{L("CAPITAL LETTERS (NURUL FASEHAH)", "HURUF BESAR (NURUL FASEHAH)")}</option>
                </select>
              </label>
              <label className={fieldLabel}>{L("Professional tagline", "Slogan profesional")}
                <input className={inputClass} maxLength={120} value={merged!.tagline ?? ""} disabled={!edit} onChange={(e) => set({ tagline: e.target.value })} placeholder={L("One short line about how they work", "Satu baris ringkas tentang cara mereka bekerja")} data-testid="pf-tagline" />
              </label>
              <label className={fieldLabel}>{L("Key specialties (3 to 5, one per line)", "Kepakaran utama (3 hingga 5, satu sebaris)")}
                <textarea className={textareaClass} rows={5} value={listText.specialties ?? (merged!.specialties ?? []).join("\n")} disabled={!edit} onChange={(e) => { setListText((t) => ({ ...t, specialties: e.target.value })); set({ specialties: lines(e.target.value).slice(0, 5) }); }} data-testid="pf-specialties" />
              </label>
              {(merged!.specialties ?? []).length > 0 && (merged!.specialties ?? []).length < 3 && <p className="erp-meta">{L("The card is designed for three to five.", "Kad direka untuk tiga hingga lima.")}</p>}

              <div className={css.photoBox} data-testid="pf-photo">
                <strong>{L("Photo", "Foto")}</strong>
                <p className="erp-meta">{portraitKey || pending
                  ? (pending ? (pendingOwn ? L("New portfolio photo - not saved yet", "Foto portfolio baharu - belum disimpan") : L("Background removed - not saved yet", "Latar dibuang - belum disimpan")) : d.portfolio.portrait_own && !d.portfolio.portrait_stale ? L("Using the portfolio's own photo - the staff record photo is not changed", "Menggunakan foto portfolio sendiri - foto rekod kakitangan tidak diubah") : d.portfolio.portrait_key && !d.portfolio.portrait_stale ? L("Using the adjusted portrait", "Menggunakan potret yang dilaraskan") : L("Using the staff record photo", "Menggunakan foto rekod kakitangan"))
                  : L("No photo yet - the card shows a placeholder with the initials. A photo is not needed to create or publish.", "Belum ada foto - kad memaparkan pemegang tempat dengan huruf awal. Foto tidak diperlukan untuk mencipta atau menerbit.")}</p>
                {d.portfolio.portrait_stale && <p className="erp-meta">{L("The staff photo changed after this portrait was made - the card now uses the new staff photo.", "Foto kakitangan berubah selepas potret ini dibuat - kad kini menggunakan foto baharu.")}</p>}
                <div className={css.actions}>
                  {edit && (
                    <label className={btnSm} data-testid="pf-own-photo-label"><AppIcon name="upload" />{busy === "photo" ? L("Reading...", "Membaca...") : d.portfolio.portrait_own ? L("Replace portfolio photo", "Ganti foto portfolio") : L("Upload portfolio photo", "Muat naik foto portfolio")}
                      <input type="file" accept="image/jpeg,image/png,image/webp" className="erp-sr-only" onChange={(e) => { void pickPortfolioPhoto(e.target.files?.[0]); e.target.value = ""; }} data-testid="pf-own-photo" />
                    </label>
                  )}
                  {edit && (portraitKey || pending) && <button type="button" className={btnSm} disabled={busy === "cutout"} onClick={() => void removeBackground()} data-testid="pf-cutout"><AppIcon name="fix" />{busy === "cutout" ? L("Removing...", "Membuang...") : L("Remove background", "Buang latar")}</button>}
                  {edit && (d.portfolio.portrait_key || pending) && <button type="button" className={btnSmQuiet} onClick={() => void resetToStaffPhoto()} data-testid="pf-photo-reset">{L("Use the staff record photo instead", "Guna foto rekod kakitangan")}</button>}
                </div>
                {(portraitKey || pending) && edit && (
                  <div className={css.sliders}>
                    {([["zoom", L("Zoom", "Zum"), 1, 2.5, 0.02], ["x", L("Left / right", "Kiri / kanan"), -1, 1, 0.02], ["y", L("Up / down", "Atas / bawah"), -1, 1, 0.02]] as const).map(([k, label, min, max, step]) => (
                      <label key={k} className={fieldLabel}>{label}
                        <input type="range" min={min} max={max} step={step} value={crop[k]} onChange={(e) => set({ photo_crop: { ...crop, [k]: Number(e.target.value) } })} data-testid={`pf-crop-${k}`} />
                      </label>
                    ))}
                    <button type="button" className={btnSmQuiet} onClick={() => set({ photo_crop: DEFAULT_CROP })}>{L("Reset position", "Set semula kedudukan")}</button>
                  </div>
                )}
              </div>
            </div>
          )}

          {tab === "details" && (
            <div className="erp-stack" data-testid="pf-sec-details">
              <label className={fieldLabel}>{L("Professional introduction (public page)", "Pengenalan profesional (halaman awam)")}
                <textarea className={textareaClass} rows={5} maxLength={1200} value={merged!.intro ?? ""} disabled={!edit} onChange={(e) => set({ intro: e.target.value })} data-testid="pf-intro" />
              </label>
              <section className={css.photoBox} data-testid="pf-duties">
                <strong>{L("Key responsibilities on the card", "Tanggungjawab utama pada kad")}</strong>
                <p className="erp-meta">{L("These come from the person's responsibilities (Staff -> Departments & Roles -> Edit responsibilities). Only the ones ticked Public are shown - up to five.", "Ini daripada tanggungjawab orang itu (Kakitangan -> Jabatan & Peranan -> Sunting tanggungjawab). Hanya yang ditanda Awam dipaparkan - hingga lima.")}</p>
                {d.duties.public.length
                  ? <ol className={css.dutyList}>{d.duties.public.map((t) => <li key={t}>{t}</li>)}</ol>
                  : <p className="erp-meta" data-testid="pf-duties-none">{d.duties.all
                      ? L(`${d.duties.all} written, none ticked Public yet - the card's back shows no responsibilities until one is.`, `${d.duties.all} ditulis, tiada yang ditanda Awam - belakang kad tidak memaparkan tanggungjawab sehingga ada.`)
                      : L("None written yet.", "Belum ada yang ditulis.")}</p>}
              </section>
              <label className={fieldLabel}>{L("Expertise and services (one per line)", "Kepakaran dan perkhidmatan (satu sebaris)")}
                <textarea className={textareaClass} rows={4} value={listText.expertise ?? (merged!.expertise ?? []).join("\n")} disabled={!edit} onChange={(e) => { setListText((t) => ({ ...t, expertise: e.target.value })); set({ expertise: lines(e.target.value).slice(0, 8) }); }} data-testid="pf-expertise" />
              </label>
              <label className={fieldLabel}>{L("Experience (optional, e.g. 3 years)", "Pengalaman (pilihan, cth. 3 tahun)")}
                <input className={inputClass} maxLength={40} value={merged!.experience ?? ""} disabled={!edit} onChange={(e) => set({ experience: e.target.value })} data-testid="pf-experience" />
              </label>
              <fieldset className={css.duties}>
                <legend className={fieldLabel}>{L("Social links (optional, https)", "Pautan sosial (pilihan, https)")}</legend>
                {(["instagram", "tiktok", "facebook", "linkedin", "youtube"] as const).map((k) => (
                  <label key={k} className={fieldLabel}>{k[0]!.toUpperCase() + k.slice(1)}
                    <input className={inputClass} type="url" value={merged!.socials?.[k] ?? ""} disabled={!edit} placeholder={`https://www.${k}.com/...`} onChange={(e) => set({ socials: { ...(merged!.socials ?? {}), [k]: e.target.value } })} data-testid={`pf-social-${k}`} />
                  </label>
                ))}
                <p className="erp-meta">{L("Empty: the card shows the company's own channels.", "Kosong: kad memaparkan saluran syarikat.")}</p>
              </fieldset>
            </div>
          )}

          {tab === "work" && <WorkSection d={d} edit={edit} onChanged={() => void load()} notify={notify} />}

          {/* 0220 - the words a BM visitor reads: Translate proposes them, the person checks them, Save keeps them */}
          {tab === "bm" && (() => {
            const ms: PortfolioMs = merged!.content_ms ?? {};
            const setMs = (patch: PortfolioMs) => set({ content_ms: { ...ms, ...patch } });
            const phrases = [...new Set([d.staff.position ?? "", d.staff.department ?? "", ...(merged!.specialties ?? []), ...(merged!.expertise ?? []), ...d.duties.public].filter(Boolean))];
            const phrase = (en: string, v: string) => setMs({ phrases: { ...(ms.phrases ?? {}), [en]: v } });
            const item = (id: number, k: "title" | "description", v: string) => setMs({ items: { ...(ms.items ?? {}), [id]: { ...(ms.items?.[id] ?? {}), [k]: v } } });
            return (
              <div className="erp-stack" data-testid="pf-sec-bm">
                <section className={css.photoBox}>
                  <strong>{L("Bahasa Melayu on the public page", "Bahasa Melayu pada halaman awam")}</strong>
                  <p className="erp-meta">{L("A visitor who chooses BM reads these words. A box left empty shows the English. Translate to BM fills the empty boxes from the English in this editor - check every line, then Save. The public page changes when it is published.", "Pelawat yang memilih BM membaca perkataan ini. Kotak kosong memaparkan Bahasa Inggeris. Terjemah ke BM mengisi kotak kosong daripada Bahasa Inggeris dalam editor ini - semak setiap baris, kemudian Simpan. Halaman awam berubah apabila diterbitkan.")}</p>
                  {edit && <div className={css.actions}><button type="button" className={btnSmPrimary} disabled={Boolean(busy)} onClick={() => void translate()} data-testid="pf-translate"><AppIcon name="fix" />{busy === "translate" ? L("Translating...", "Menterjemah...") : L("Translate to BM", "Terjemah ke BM")}</button></div>}
                </section>
                <label className={fieldLabel}>{L("Tagline (BM)", "Slogan (BM)")}
                  <input className={inputClass} maxLength={120} value={ms.tagline ?? ""} disabled={!edit} placeholder={merged!.tagline ?? ""} onChange={(e) => setMs({ tagline: e.target.value })} data-testid="pf-ms-tagline" />
                </label>
                {(merged!.intro || ms.intro) && <label className={fieldLabel}>{L("Introduction (BM)", "Pengenalan (BM)")}
                  <textarea className={textareaClass} rows={4} maxLength={1200} value={ms.intro ?? ""} disabled={!edit} placeholder={merged!.intro ?? ""} onChange={(e) => setMs({ intro: e.target.value })} data-testid="pf-ms-intro" />
                </label>}
                {(merged!.experience || ms.experience) && <label className={fieldLabel}>{L("Experience (BM)", "Pengalaman (BM)")}
                  <input className={inputClass} maxLength={40} value={ms.experience ?? ""} disabled={!edit} placeholder={merged!.experience ?? ""} onChange={(e) => setMs({ experience: e.target.value })} data-testid="pf-ms-experience" />
                </label>}
                {phrases.length > 0 && (
                  <fieldset className={css.duties} data-testid="pf-ms-phrases">
                    <legend className={fieldLabel}>{L("Position, department, specialties, expertise and responsibilities", "Jawatan, jabatan, kepakaran, keistimewaan dan tanggungjawab")}</legend>
                    {phrases.map((en) => (
                      <label key={en} className={fieldLabel}><span className="erp-meta">{en}</span>
                        <input className={inputClass} maxLength={600} value={ms.phrases?.[en] ?? ""} disabled={!edit} placeholder={L("BM - empty shows the English", "BM - kosong memaparkan Bahasa Inggeris")} onChange={(e) => phrase(en, e.target.value)} />
                      </label>
                    ))}
                  </fieldset>
                )}
                {d.items.length > 0 && (
                  <fieldset className={css.duties} data-testid="pf-ms-items">
                    <legend className={fieldLabel}>{L("Work", "Kerja")}</legend>
                    {d.items.map((i) => (
                      <div key={i.id} className="erp-stack">
                        <label className={fieldLabel}><span className="erp-meta">{i.title}</span>
                          <input className={inputClass} maxLength={120} value={ms.items?.[i.id]?.title ?? ""} disabled={!edit} placeholder={L("Title in BM", "Tajuk dalam BM")} onChange={(e) => item(i.id, "title", e.target.value)} />
                        </label>
                        {i.description && <label className={fieldLabel}><span className="erp-meta">{i.description}</span>
                          <textarea className={textareaClass} rows={2} maxLength={600} value={ms.items?.[i.id]?.description ?? ""} disabled={!edit} placeholder={L("Description in BM", "Penerangan dalam BM")} onChange={(e) => item(i.id, "description", e.target.value)} />
                        </label>}
                      </div>
                    ))}
                  </fieldset>
                )}
              </div>
            );
          })()}

          {tab === "publish" && (
            <div className="erp-stack" data-testid="pf-sec-publish">
              <label className={fieldLabel}>{L("Public address", "Alamat awam")}
                <span className={css.slugRow}><span className="erp-meta">a2zcreative.my/portfolio/</span>
                  <input className={inputClass} value={merged!.slug ?? ""} disabled={!edit || Boolean(d.portfolio.published_at)} onChange={(e) => set({ slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") })} data-testid="pf-slug" /></span>
                <small className="erp-meta">{d.portfolio.published_at ? L("Fixed: printed QR codes point at it.", "Tetap: QR yang dicetak menunjuk kepadanya.") : L("Fixed from the first publish.", "Tetap selepas terbitan pertama.")}</small>
              </label>
              <fieldset className={css.duties} data-testid="pf-contact">
                <legend className={fieldLabel}>{L("Contact on the card and the page", "Hubungan pada kad dan halaman")}</legend>
                <p className="erp-meta">{L("Off: the company's email and WhatsApp are shown. Showing this person's own email or phone needs the approver's tick.", "Tutup: emel dan WhatsApp syarikat dipaparkan. Memaparkan emel atau telefon sendiri memerlukan kelulusan.")}</p>
                <label className={fieldLabel}>{L("Work email", "Emel kerja")}<input className={inputClass} type="email" value={merged!.contact_email ?? ""} disabled={!edit} onChange={(e) => set({ contact_email: e.target.value })} data-testid="pf-email" /></label>
                <label className={css.check}><input type="checkbox" checked={Boolean(merged!.show_email)} disabled={!d.can.publish || !merged!.contact_email} onChange={(e) => set({ show_email: e.target.checked })} data-testid="pf-show-email" /><span>{L("Approved: show this email in public", "Diluluskan: papar emel ini kepada awam")}</span></label>
                <label className={fieldLabel}>{L("Phone", "Telefon")}<input className={inputClass} type="tel" value={merged!.contact_phone ?? ""} disabled={!edit} onChange={(e) => set({ contact_phone: e.target.value })} data-testid="pf-phone" /></label>
                <label className={css.check}><input type="checkbox" checked={Boolean(merged!.show_phone)} disabled={!d.can.publish || !merged!.contact_phone} onChange={(e) => set({ show_phone: e.target.checked })} data-testid="pf-show-phone" /><span>{L("Approved: show this phone in public", "Diluluskan: papar telefon ini kepada awam")}</span></label>
              </fieldset>

              <section className={css.photoBox} data-testid="pf-share">
                <strong>{published ? L("Live at", "Aktif di") : L("Not public", "Tidak awam")}</strong>
                {published
                  ? <a href={d.portfolio.public_url!} target="_blank" rel="noopener" className={css.link} data-testid="pf-public-url">{d.portfolio.public_url}</a>
                  : <p className="erp-meta">{d.portfolio.state === "unpublished" ? L("Unpublished: the page and the QR do not open.", "Ditarik balik: halaman dan QR tidak dibuka.") : L("A draft is private. Publishing is the approval.", "Draf adalah peribadi. Penerbitan ialah kelulusan.")}</p>}
                {published && d.portfolio.unpublished_changes && <p className="erp-meta" data-testid="pf-unpublished-changes">{L("There are saved changes the public page does not show yet - publish again.", "Ada perubahan yang belum dipaparkan - terbitkan semula.")}</p>}
                <div className={css.actions}>
                  <button type="button" className={btnSm} disabled={!published} onClick={() => void exportPng("front")} data-testid="pf-png-front"><AppIcon name="download" />{L("Front PNG", "PNG depan")}</button>
                  <button type="button" className={btnSm} disabled={!published} onClick={() => void exportPng("back")} data-testid="pf-png-back"><AppIcon name="download" />{L("Back PNG", "PNG belakang")}</button>
                  <button type="button" className={btnSm} disabled={!published} onClick={exportPdf} data-testid="pf-pdf"><AppIcon name="document" />PDF</button>
                  <button type="button" className={btnSm} disabled={!published} onClick={() => void copyLink()} data-testid="pf-copy"><AppIcon name="link" />{L("Copy link", "Salin pautan")}</button>
                  <button type="button" className={btnSm} disabled={!published} onClick={() => void share()} data-testid="pf-share-btn"><AppIcon name="send" />{L("Share", "Kongsi")}</button>
                </div>
                <div className={css.actions}>
                  <button type="button" className={btnSm} disabled={!published} onClick={async () => d.portfolio.public_url && saveBlob(await qrPng(d.portfolio.public_url), `${fileBase(d)}-qr.png`)} data-testid="pf-qr-png"><AppIcon name="qr" />QR PNG</button>
                  <button type="button" className={btnSm} disabled={!published} onClick={() => d.portfolio.public_url && saveBlob(new Blob([qrSvg(d.portfolio.public_url)], { type: "image/svg+xml" }), `${fileBase(d)}-qr.svg`)} data-testid="pf-qr-svg"><AppIcon name="qr" />QR SVG</button>
                  <button type="button" className={btnSm} disabled={!published} onClick={() => void scan()} data-testid="pf-scan"><AppIcon name="verify" />{L("Test scan", "Uji imbasan")}</button>
                </div>
                {!published && <p className="erp-meta">{L("Downloads, link and QR open once the portfolio is published.", "Muat turun, pautan dan QR dibuka selepas diterbitkan.")}</p>}
              </section>
            </div>
          )}

          <DrawerFoot>
            <button type="button" className={btnSm} onClick={onClose}>{L("Close", "Tutup")}</button>
            {edit && <button type="button" className={btnSm} disabled={!dirty || Boolean(busy)} onClick={() => void save()} data-testid="pf-save"><AppIcon name="save" />{L("Save", "Simpan")}</button>}
            {d.can.submit && <button type="button" className={btnSmPrimary} disabled={Boolean(busy) || !d.staff.position} onClick={() => void submit()} title={!d.staff.position ? L("Your staff record has no position yet - ask HR", "Rekod kakitangan anda belum ada jawatan - minta HR") : undefined} data-testid="pf-submit"><AppIcon name="send" />{busy === "submit" ? L("Sending...", "Menghantar...") : published ? L("Send changes for approval", "Hantar perubahan untuk kelulusan") : L("Send for approval", "Hantar untuk kelulusan")}</button>}
            {d.can.publish && published && <button type="button" className={btnSm} onClick={() => void unpublish()} data-testid="pf-unpublish"><AppIcon name="blocked" />{L("Unpublish", "Tarik balik")}</button>}
            {d.can.publish && <button type="button" className={btnSmPrimary} disabled={Boolean(busy) || !d.staff.position} onClick={() => void publish()} title={!d.staff.position ? L("Give this person a position on their staff record first", "Beri jawatan pada rekod kakitangan dahulu") : undefined} data-testid="pf-publish"><AppIcon name="verify" />{published ? L("Publish changes", "Terbit perubahan") : L("Publish", "Terbit")}</button>}
          </DrawerFoot>
        </DrawerForm>
      )}
    </SideDrawer>
  );
}

function WorkSection({ d, edit, onChanged, notify }: { d: PortfolioDetail; edit: boolean; onChanged: () => void; notify: (t: string, s?: string, v?: "success" | "notice" | "error") => void }) {
  const [kind, setKind] = useState<"image" | "video">("image");
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const pid = d.portfolio.id;

  const add = async () => {
    if (!title.trim()) return;
    if (file) {
      const okTypes = kind === "video" ? ["video/mp4", "video/webm", "image/jpeg", "image/png", "image/webp"] : ["image/jpeg", "image/png", "image/webp"];
      if (!okTypes.includes(file.type)) { notify(L("That file type is not accepted", "Jenis fail tidak diterima"), kind === "video" ? "MP4, WebM, JPG, PNG, WebP" : "JPG, PNG, WebP", "error"); return; }
    }
    setBusy(true);
    const r = await api<{ id: number }>(`/portfolios/${pid}/items`, { method: "POST", body: JSON.stringify({ kind, title, description: desc, video_url: kind === "video" ? url : null }) });
    if (r.ok && r.data?.id && file) {
      let body: Blob = file;
      if (file.type.startsWith("image/")) { const { compressImage } = await import("@/lib/compress-image"); body = await compressImage(file, 2000, 0.88); }
      const up = await csrfFetch(`/api/v1/staff/portfolios/${pid}/items/${r.data.id}/media`, { method: "POST", headers: { "Content-Type": body.type || file.type }, body });
      if (!up.ok) notify(L("The file was not uploaded", "Fail tidak dimuat naik"), "", "error");
    }
    setBusy(false);
    if (r.ok) { setTitle(""); setDesc(""); setUrl(""); setFile(null); notify(L("Work added", "Kerja ditambah")); onChanged(); }
    else notify(L("Not added", "Tidak ditambah"), (r.data as { error?: { message?: string } } | null)?.error?.message ?? "", "error");
  };
  const toggleFeatured = async (id: number, featured: boolean) => { await api(`/portfolios/${pid}/items/${id}`, { method: "PUT", body: JSON.stringify({ featured }) }); onChanged(); };
  const remove = async (id: number) => { await api(`/portfolios/${pid}/items/${id}/remove`, { method: "POST", body: "{}" }); onChanged(); };

  return (
    <div className="erp-stack" data-testid="pf-sec-work">
      {d.items.length === 0 && <p className="erp-meta">{L("No work yet. Add project images and videos; mark the best as featured.", "Belum ada kerja. Tambah imej dan video projek; tandakan yang terbaik.")}</p>}
      <ul className={css.items}>
        {d.items.map((i) => (
          <li key={i.id} className={css.item} data-testid={`pf-item-${i.id}`}>
            {i.media_key && i.media_type?.startsWith("image/") ? <img src={mediaUrl(i.media_key)} alt="" className={css.thumb} /> : <span className={css.thumbIcon}><AppIcon name={i.kind === "video" ? "video" : "content"} /></span>}
            <span className={css.itemText}><strong>{i.title}</strong>{i.description && <small className="erp-meta">{i.description}</small>}{i.video_url && <small className="erp-meta">{i.video_url}</small>}</span>
            {edit && <span className={css.actions}>
              <button type="button" className={i.featured ? btnSmPrimary : btnSm} aria-pressed={i.featured} onClick={() => void toggleFeatured(i.id, !i.featured)}><AppIcon name="star" />{L("Featured", "Pilihan")}</button>
              <button type="button" className={btnSmQuiet} onClick={() => void remove(i.id)} data-testid={`pf-item-remove-${i.id}`}>{L("Remove", "Buang")}</button>
            </span>}
          </li>
        ))}
      </ul>
      {edit && (
        <fieldset className={css.duties} data-testid="pf-add-work">
          <legend className={fieldLabel}>{L("Add work", "Tambah kerja")}</legend>
          <label className={fieldLabel}>{L("Kind", "Jenis")}
            <select className={selectClass} value={kind} onChange={(e) => setKind(e.target.value as "image" | "video")}><option value="image">{L("Project image", "Imej projek")}</option><option value="video">{L("Video", "Video")}</option></select>
          </label>
          <label className={fieldLabel}>{L("Title", "Tajuk")}<input className={inputClass} maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} data-testid="pf-work-title" /></label>
          <label className={fieldLabel}>{L("Description", "Penerangan")}<textarea className={textareaClass} rows={3} maxLength={600} value={desc} onChange={(e) => setDesc(e.target.value)} /></label>
          {kind === "video" && <label className={fieldLabel}>{L("Video link (YouTube, TikTok, Instagram, Facebook or Vimeo)", "Pautan video (YouTube, TikTok, Instagram, Facebook atau Vimeo)")}<input className={inputClass} type="url" value={url} onChange={(e) => setUrl(e.target.value)} /></label>}
          <label className={fieldLabel}>{kind === "video" ? L("Or upload the video (MP4 / WebM, up to 60 MB)", "Atau muat naik video (MP4 / WebM, hingga 60 MB)") : L("Image (JPG, PNG or WebP)", "Imej (JPG, PNG atau WebP)")}
            <input type="file" accept={kind === "video" ? "video/mp4,video/webm,image/jpeg,image/png,image/webp" : "image/jpeg,image/png,image/webp"} onChange={(e) => setFile(e.target.files?.[0] ?? null)} data-testid="pf-work-file" />
          </label>
          <button type="button" className={btnSmPrimary} disabled={busy || !title.trim() || (kind === "image" && !file) || (kind === "video" && !file && !url.trim())} onClick={() => void add()} data-testid="pf-work-add"><AppIcon name="add" />{busy ? L("Adding...", "Menambah...") : L("Add", "Tambah")}</button>
        </fieldset>
      )}
    </div>
  );
}

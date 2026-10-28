"use client";

/**
 * v1.129.0 — THE CARDS TAB: share a director's digital business card.
 * v1.218.0 — Cards 2.0 (the owner's brief and answers, 28-10-2026): the three
 * officer cards redrawn as card faces, the four share actions kept (Copy link,
 * WhatsApp, Show QR, Download image - now the portrait card image), a "Share &
 * print" strip, the public card previewed inside the portal (a drawer showing
 * the very component the public page renders, at desktop or phone width), and
 * a read-only check that each card still matches the officer's staff record.
 *
 * CEO, 06-09-2026: *"only ceo, coo, cco can share their business card to
 * client and the other staff cant access this tabs ... at the same time make
 * sure that it is nice to see on mobile apps view by client/customer."*
 *
 * WHAT THE RESTRICTION IS, SAID PLAINLY.
 * The tab is drawn for ceo / coo / cco only (TAB_ROLES in lib/portal-tabs.ts),
 * so no other staff member is offered a way to share a director's card. That
 * is an ORGANISATIONAL boundary: the cards themselves are PUBLIC pages -
 * a2zcreative.my/farhan is a static file on a CDN, printed on paper, with a
 * QR code pointing at it. This tab cannot make a card private and does not
 * try to. It decides who the PORTAL hands a share button to.
 *
 * ONE PUBLIC PROFILE. Every card here reads constants/team.ts, the approved
 * public profile, exactly as the public page does. The staff record is only
 * compared (GET /staff/cards/profile-check: four fields, read-only); nothing
 * is copied from it and nothing is edited here.
 */

import { useCallback, useEffect, useState, type ReactNode } from "react";

import { CardView } from "@/components/cards/card-view";
import { AppIcon, PanelTitle } from "@/components/ui/app-icon";
import { SideDrawer } from "@/components/ui/side-drawer";
import { TabPage, TabZone } from "@/components/portal/tab-concept";
import { useSaveToast } from "@/components/ui/save-toast";
import { Skel } from "@/components/ui/skeleton";
import { SITE_CONFIG } from "@/constants/site";
import { TEAM, cardMonogram, type TeamCard } from "@/constants/team";
import { api } from "@/lib/api";
import { getLang } from "@/lib/i18n";
import { card, insetCard } from "@/lib/ui-styles";
import css from "./cards-panel.module.css";

const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);

/** Which record belongs to the person looking at the tab. */
const OWN_SLUG: Record<string, string> = { ceo: "farhan", coo: "zoll", cco: "izz" };
const ROLE_OF: Record<string, string> = { farhan: "ceo", zoll: "coo", izz: "cco" };

/** The message that rides with the link on WhatsApp — bilingual, because the
    client on the other end reads one of the two and the card opens in BM. */
const shareText = (m: TeamCard, url: string) =>
  getLang() === "ms"
    ? `Salam, ini kad perniagaan digital ${m.known.ms} — ${m.role.ms}, ${SITE_CONFIG.name}.\n${url}`
    : `Hello, here is ${m.known.en}'s digital business card — ${m.role.en}, ${SITE_CONFIG.name}.\n${url}`;
const badge = (m: TeamCard) => m.role.en.split("/").pop()?.trim() ?? "";
const digits = (s: string) => s.replace(/[^0-9]/g, "").replace(/^0/, "60");

type Officer = { role: string; name: string; position: string | null; phone: string | null; has_photo: number };

/** What differs between a card and its officer's staff record - said, never fixed. */
function differences(m: TeamCard, o: Officer | undefined): string[] {
  if (!o) return [L("No current staff record holds this role.", "Tiada rekod kakitangan semasa memegang jawatan ini.")];
  const out: string[] = [];
  const staffWords = o.name.toUpperCase().split(/\s+/);
  if (!m.name.toUpperCase().split(/\s+/).every((w) => staffWords.includes(w))) {
    out.push(L(`Name - staff record: ${o.name}; card: ${m.name}`, `Nama - rekod kakitangan: ${o.name}; kad: ${m.name}`));
  }
  if (!o.phone) out.push(L("The staff record has no phone number.", "Rekod kakitangan tiada nombor telefon."));
  else if (digits(o.phone) !== digits(m.mobileE164)) {
    out.push(L(`Phone - staff record: ${o.phone}; card: ${m.mobile}`, `Telefon - rekod kakitangan: ${o.phone}; kad: ${m.mobile}`));
  }
  if (o.position && !o.position.toUpperCase().includes(badge(m).toUpperCase())) {
    out.push(L(`Position - staff record: ${o.position}; card: ${m.role.en}`, `Jawatan - rekod kakitangan: ${o.position}; kad: ${m.role.ms}`));
  }
  return out;
}

/** One action button. 44px tall: this is used one-handed, in front of a client. */
function Action({ icon, label, onClick, href, download }: {
  icon: Parameters<typeof AppIcon>[0]["name"];
  label: string;
  onClick?: () => void;
  href?: string;
  download?: string;
}) {
  if (href) {
    return (
      <a href={href} target={download ? undefined : "_blank"} rel="noopener noreferrer" download={download} className={css.action}>
        <AppIcon name={icon} />
        <span>{label}</span>
      </a>
    );
  }
  return (
    <button type="button" onClick={onClick} className={css.action}>
      <AppIcon name={icon} />
      <span>{label}</span>
    </button>
  );
}

/** The full-screen QR. It exists to be SCANNED, so it takes the screen. */
function QrScreen({ m, url, onClose }: { m: TeamCard; url: string; onClose: () => void }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", esc);
    /* Body, never <html> — the document-scroll owners are globals.css and
       app-shell, and a third would be a bug (see styles/globals.css). */
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", esc);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
  return (
    <div className={css.qrScreen} role="dialog" aria-modal="true" aria-label={L(`QR code for ${m.name}`, `Kod QR untuk ${m.name}`)} onClick={onClose}>
      <p className={css.qrEyebrow}>{SITE_CONFIG.name}</p>
      {/* min(78vw, 78vh) - the largest square that fits either way up. White plate: a QR on navy does not scan. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`/cards/${m.slug}-qr.png`} alt={url} className={css.qrImg} />
      <div className={css.qrWho}>
        <p>{m.name}</p>
        <p>{m.role.ms}</p>
        <p>{url.replace("https://", "")}</p>
      </div>
      <p className={css.qrHint}>{L("Tap anywhere to close", "Ketik di mana-mana untuk tutup")}</p>
    </div>
  );
}

/** Copy a card's link, and say so either way. */
function useCopy() {
  const { show: showToast, node: toastNode } = useSaveToast();
  const copy = useCallback(async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      showToast(L("Link copied", "Pautan disalin"), url.replace("https://", ""));
    } catch {
      /* clipboard is blocked outside a secure context and in some webviews.
         Saying so beats a button that silently does nothing. */
      showToast(
        L("Not copied", "Tidak disalin"),
        L("This browser refused the clipboard — press and hold the address to copy it",
          "Pelayar ini menolak papan klip — tekan dan tahan alamat untuk menyalinnya"),
        "notice",
      );
    }
  }, [showToast]);
  return { copy, toastNode };
}

function OfficerCard({ m, mine, check, onPreview, reading }: { m: TeamCard; mine: boolean; check: string[] | null | undefined; onPreview: () => void; reading: ReactNode }) {
  const { copy, toastNode } = useCopy();
  const [qr, setQr] = useState(false);
  const url = `${SITE_CONFIG.url}/${m.slug}`;

  return (
    <article className={css.officer} aria-label={m.name}>
      {toastNode}
      {qr && <QrScreen m={m} url={url} onClose={() => setQr(false)} />}

      {/* The navy face, at a glance - you are about to send this. */}
      <div className={css.face}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-white.png" alt="" className={css.logo} width={991} height={547} />
        {mine && <span className={css.yours}>{L("Yours", "Anda")}</span>}
        <div className={css.who}>
          <span className={css.portrait}>
            {m.photo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={m.photo} alt="" className={css.photo} />
            ) : (
              <span aria-hidden className={css.mono}>{cardMonogram(m)}</span>
            )}
          </span>
          <span className={css.lines}>
            <span className={css.badge}>{badge(m)}</span>
            <strong>{m.name}</strong>
            {/* The Malay title: the card opens in BM and so does the vCard. */}
            <span>{m.role.ms}</span>
            <span className={css.co}>{SITE_CONFIG.name}</span>
          </span>
        </div>
      </div>

      <div className={css.linkRow}>
        <AppIcon name="link" />
        <span>{url.replace("https://", "")}</span>
        <button type="button" onClick={() => void copy(url)} aria-label={L(`Copy ${m.name}'s link`, `Salin pautan ${m.name}`)}><AppIcon name="documents" /></button>
      </div>

      {/* Two by two, and it stays two by two at 320px. */}
      <div className={css.actions}>
        <Action icon="link" label={L("Copy link", "Salin pautan")} onClick={() => void copy(url)} />
        <Action icon="chat" label="WhatsApp" href={`https://wa.me/?text=${encodeURIComponent(shareText(m, url))}`} />
        <Action icon="qr" label={L("Show QR", "Tunjuk QR")} onClick={() => setQr(true)} />
        <Action icon="download" label={L("Download image", "Muat turun imej")} href={`/cards/${m.slug}-card.png`} download={`${m.slug}-a2z-card.png`} />
      </div>

      <button type="button" className={css.preview} onClick={onPreview}>
        <AppIcon name="preview" />
        {L("Preview as a client sees it", "Pratonton seperti dilihat pelanggan")}
      </button>

      {/* the staff-record check: a line-shaped skeleton while it is read */}
      {check === undefined && reading}
      {check && (
        check.length === 0 ? (
          <p className={css.match}><AppIcon name="success" /> {L("Matches the staff record", "Sepadan dengan rekod kakitangan")}</p>
        ) : (
          <div className={css.mismatch} role="note">
            <p><AppIcon name="warning" /> {L("Differs from the staff record - decide which is right:", "Berbeza daripada rekod kakitangan - tentukan yang betul:")}</p>
            <ul>{check.map((c) => <li key={c}>{c}</li>)}</ul>
          </div>
        )
      )}
    </article>
  );
}

export function CardsPanel({ role = "" }: { role?: string }) {
  /* Own card first, then the other two in the registry's order. A director
     opening this tab is usually sending their own. */
  const own = OWN_SLUG[role];
  const ordered = [...TEAM].sort((a, b) =>
    a.slug === own ? -1 : b.slug === own ? 1 : 0,
  );
  const [preview, setPreview] = useState<TeamCard | null>(null);
  const [frame, setFrame] = useState<"mobile" | "desktop">("mobile");
  const [pick, setPick] = useState<string>(ordered[0]?.slug ?? "");
  /* undefined = still reading; null = not available (refused, or an older worker) */
  const [officers, setOfficers] = useState<Officer[] | null | undefined>(undefined);
  const { copy, toastNode } = useCopy();

  /* the read-only staff-record comparison; a refusal or an older worker shows nothing */
  useEffect(() => {
    let alive = true;
    void api<{ officers: Officer[] }>(`/staff/cards/profile-check`).then((r) => {
      if (alive) setOfficers(r.ok && r.data?.officers ? r.data.officers : null);
    });
    return () => { alive = false; };
  }, []);
  const checkOf = (m: TeamCard) => (officers === undefined ? undefined : officers ? differences(m, officers.find((o) => o.role === ROLE_OF[m.slug])) : null);
  const chosen = ordered.find((m) => m.slug === pick) ?? ordered[0]!;
  const chosenUrl = `${SITE_CONFIG.url}/${chosen.slug}`;

  return (
    <TabPage>
      {toastNode}
      <TabZone label={L("The officers", "Pegawai")}>
        <section className={card} aria-label={L("Digital business cards", "Kad perniagaan digital")}>
          <PanelTitle icon="person">{L("Digital business cards", "Kad perniagaan digital")}</PanelTitle>
          <p className={css.meta}>
            {L("Send a client the digital card — it opens in Malay, switches to English, and saves straight into their phone contacts.",
               "Hantar kad digital kepada pelanggan — ia dibuka dalam Bahasa Melayu, boleh tukar ke Bahasa Inggeris, dan disimpan terus ke dalam kenalan telefon mereka.")}
          </p>
          {/* Said here, not only in a code comment: somebody will otherwise
              assume this tab makes the cards private. */}
          <p className={css.note}>
            <AppIcon name="info" />
            {L("This tab is limited to the CEO, COO and CCO. The cards themselves are public pages — they are printed on paper with a QR code — so this controls who shares them from the portal, not who can open one.",
               "Tab ini terhad kepada CEO, COO dan CCO. Kad itu sendiri ialah halaman awam — ia dicetak pada kad dengan kod QR — jadi ini mengawal siapa yang berkongsi daripada portal, bukan siapa yang boleh membukanya.")}
          </p>
          <div className={css.grid}>
            {ordered.map((m) => (
              <OfficerCard key={m.slug} m={m} mine={m.slug === own} check={checkOf(m)} onPreview={() => setPreview(m)}
                reading={<span className={css.checkSkel}><Skel h={14} w="70%" /></span>} />
            ))}
          </div>
        </section>
      </TabZone>

      <TabZone label={L("Share & print", "Kongsi & cetak")}>
        <section className={card} aria-label={L("Share & print", "Kongsi & cetak")}>
          <div className={css.head}>
            <div>
              <PanelTitle icon="print">{L("Share & print", "Kongsi & cetak")}</PanelTitle>
              <p className={css.meta}>{L("The same files and link as the card above - for print, a slide or a message.", "Fail dan pautan yang sama seperti kad di atas - untuk cetakan, slaid atau mesej.")}</p>
            </div>
            <div className={css.pick} role="group" aria-label={L("Whose card", "Kad siapa")}>
              {ordered.map((m) => <button key={m.slug} type="button" aria-pressed={pick === m.slug} onClick={() => setPick(m.slug)}>{badge(m)}</button>)}
            </div>
          </div>
          <ul className={css.tools}>
            <li className={insetCard}>
              <span className={css.well}><AppIcon name="qr" /></span>
              <strong>{L("QR code", "Kod QR")}</strong>
              <span>{L("High resolution (900 px) for printing.", "Resolusi tinggi (900 px) untuk cetakan.")}</span>
              <a className={css.tool} href={`/cards/${chosen.slug}-qr.png`} download={`${chosen.slug}-a2z-qr.png`}>{L("Download QR", "Muat turun QR")}</a>
            </li>
            <li className={insetCard}>
              <span className={css.well}><AppIcon name="document" /></span>
              <strong>{L("Card image", "Imej kad")}</strong>
              <span>{L("Portrait card (1080 × 1350) for a phone or a print.", "Kad potret (1080 × 1350) untuk telefon atau cetakan.")}</span>
              <a className={css.tool} href={`/cards/${chosen.slug}-card.png`} download={`${chosen.slug}-a2z-card.png`}>{L("Download image", "Muat turun imej")}</a>
            </li>
            <li className={insetCard}>
              <span className={css.well}><AppIcon name="link" /></span>
              <strong>{L("Share link", "Pautan kongsi")}</strong>
              <span>{chosenUrl.replace("https://", "")}</span>
              <button type="button" className={css.tool} onClick={() => void copy(chosenUrl)}>{L("Copy link", "Salin pautan")}</button>
            </li>
            <li className={insetCard}>
              <span className={css.well}><AppIcon name="chat" /></span>
              <strong>{L("WhatsApp share", "Kongsi WhatsApp")}</strong>
              <span>{L("Opens WhatsApp with the link and a short greeting.", "Membuka WhatsApp dengan pautan dan ucapan ringkas.")}</span>
              <a className={css.tool} href={`https://wa.me/?text=${encodeURIComponent(shareText(chosen, chosenUrl))}`} target="_blank" rel="noopener noreferrer">{L("Share on WhatsApp", "Kongsi di WhatsApp")}</a>
            </li>
          </ul>
          <p className={css.note}>
            <AppIcon name="lock" />
            {L("Only the approved public details are on a card - name, title, work email, the printed mobile and the office. Staff ID, IC, payroll and private details never are. To change a card, ask the administrator: it is published, not edited here.",
               "Hanya butiran awam yang diluluskan ada pada kad - nama, jawatan, e-mel kerja, nombor telefon yang dicetak dan pejabat. ID kakitangan, IC, gaji dan butiran peribadi tidak sesekali. Untuk menukar kad, minta pentadbir: ia diterbitkan, bukan disunting di sini.")}
            {" "}<a href={`/cards/${chosen.slug}-og.png`} target="_blank" rel="noopener noreferrer">{L("Link preview image", "Imej pratonton pautan")}</a>
          </p>
        </section>
      </TabZone>

      <SideDrawer open={!!preview} onClose={() => setPreview(null)} wide
        title={L("Public card preview", "Pratonton kad awam")}
        subtitle={L("Exactly what a client sees - the same card, not a copy.", "Tepat seperti dilihat pelanggan - kad yang sama, bukan salinan.")}>
        {preview && (
          <div className={css.previewWrap}>
            <div className={css.frames} role="group" aria-label={L("Preview size", "Saiz pratonton")}>
              <button type="button" aria-pressed={frame === "desktop"} onClick={() => setFrame("desktop")}>{L("Desktop", "Desktop")}</button>
              <button type="button" aria-pressed={frame === "mobile"} onClick={() => setFrame("mobile")}>{L("Mobile", "Mudah alih")}</button>
            </div>
            <div className={frame === "mobile" ? css.phone : css.desk}>
              <CardView m={preview} embedded />
            </div>
            <a className={css.preview} href={`${SITE_CONFIG.url}/${preview.slug}`} target="_blank" rel="noopener noreferrer">
              <AppIcon name="external" /> {L("Open the live page", "Buka halaman sebenar")}
            </a>
          </div>
        )}
      </SideDrawer>
    </TabPage>
  );
}

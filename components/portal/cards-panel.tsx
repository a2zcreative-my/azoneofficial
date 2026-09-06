"use client";

/**
 * v1.129.0 — THE CARDS TAB: share a director's digital business card.
 *
 * CEO, 06-09-2026: *"only ceo, coo, cco can share their business card to
 * client and the other staff cant access this tabs ... at the same time make
 * sure that it is nice to see on mobile apps view by client/customer."*
 *
 * WHAT THE RESTRICTION IS, SAID PLAINLY.
 * The tab is drawn for ceo / coo / cco only (TAB_ROLES in lib/portal-tabs.ts),
 * so no other staff member is offered a way to share a director's card. That
 * is an ORGANISATIONAL boundary, and it is worth being honest about what it
 * is not: the cards themselves are PUBLIC pages — a2zcreative.my/farhan is a
 * static file on a CDN, printed on paper, with a QR code pointing at it. This
 * tab cannot make a card private and does not try to. It decides who the
 * PORTAL hands a share button to.
 *
 * There is therefore no API behind this tab and nothing for a server-side
 * gate to protect: the three records are static (constants/team.ts) and the
 * page is a link away for anybody on earth. A tab whose data is already
 * public needs no second lock; claiming one would be theatre.
 *
 * WHAT "NICE ON MOBILE" MEANT HERE.
 * The person using this tab is holding a phone in front of a client. So the
 * four actions are 44px targets in a two-by-two grid that stays two-by-two at
 * 320px; the QR opens FULL SCREEN at the largest square the viewport allows,
 * because it is going to be scanned across a table by a camera; and the card
 * preview is the real navy face, not a description of one — you are about to
 * send it, so you should see it.
 *
 * WHY NOT ONE CARD PER OFFICER. His own card is first and marked, but all
 * three are here: introducing a client to the COO because the job is
 * operational, or the CCO because it is commercial, is exactly when a second
 * card gets sent, and asking a colleague to send their own link mid-meeting
 * is the thing this tab exists to avoid.
 */

import { useCallback, useEffect, useState } from "react";

import { AppIcon, PanelTitle } from "@/components/ui/app-icon";
import { useSaveToast } from "@/components/ui/save-toast";
import { SITE_CONFIG } from "@/constants/site";
import { TEAM, cardMonogram, type TeamCard } from "@/constants/team";
import { getLang } from "@/lib/i18n";
import { card, insetCard } from "@/lib/ui-styles";

const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);

/** Which record belongs to the person looking at the tab. */
const OWN_SLUG: Record<string, string> = { ceo: "farhan", coo: "zoll", cco: "izz" };

/** The message that rides with the link on WhatsApp — bilingual, because the
    client on the other end reads one of the two and the card opens in BM. */
const shareText = (m: TeamCard, url: string) =>
  getLang() === "ms"
    ? `Salam, ini kad perniagaan digital ${m.known.ms} — ${m.role.ms}, ${SITE_CONFIG.name}.\n${url}`
    : `Hello, here is ${m.known.en}'s digital business card — ${m.role.en}, ${SITE_CONFIG.name}.\n${url}`;

/** One action button. 44px tall: this is used one-handed, in front of a client. */
function Action({ icon, label, onClick, href }: {
  icon: Parameters<typeof AppIcon>[0]["name"];
  label: string;
  onClick?: () => void;
  href?: string;
}) {
  const cls =
    "border-border hover:bg-secondary flex h-11 items-center justify-center gap-2 rounded-lg border px-3 text-sm font-medium transition-colors";
  if (href) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={cls}>
        <AppIcon name={icon} />
        <span className="truncate">{label}</span>
      </a>
    );
  }
  return (
    <button type="button" onClick={onClick} className={cls}>
      <AppIcon name={icon} />
      <span className="truncate">{label}</span>
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
    <div
      className="bg-brand fixed inset-0 z-50 flex flex-col items-center justify-center gap-5 p-6 text-white"
      role="dialog"
      aria-modal="true"
      aria-label={L(`QR code for ${m.name}`, `Kod QR untuk ${m.name}`)}
      onClick={onClose}
    >
      <p className="text-gold text-[11px] font-semibold tracking-[0.3em] uppercase">
        {SITE_CONFIG.name}
      </p>
      {/* min(78vw, 78vh) — the largest square that fits either way up, so
          turning the phone sideways to show it across a table still works.
          White plate: a QR on navy does not scan. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/cards/${m.slug}-qr.png`}
        alt={url}
        className="h-[min(78vw,78vh)] w-[min(78vw,78vh)] rounded-2xl bg-white p-4"
      />
      <div className="text-center">
        <p className="text-lg font-semibold">{m.name}</p>
        <p className="text-gold mt-0.5 text-sm">{m.role.ms}</p>
        <p className="mt-2 text-sm text-white/70">{url.replace("https://", "")}</p>
      </div>
      <p className="text-xs text-white/50">{L("Tap anywhere to close", "Ketik di mana-mana untuk tutup")}</p>
    </div>
  );
}

function OfficerCard({ m, mine }: { m: TeamCard; mine: boolean }) {
  const { show: showToast, node: toastNode } = useSaveToast();
  const [qr, setQr] = useState(false);
  const url = `${SITE_CONFIG.url}/${m.slug}`;

  const copy = useCallback(async () => {
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
  }, [url, showToast]);

  return (
    <div className={insetCard}>
      {toastNode}
      {qr && <QrScreen m={m} url={url} onClose={() => setQr(false)} />}

      {/* The navy face, at a glance — you are about to send this. */}
      <div className="bg-brand -m-3 mb-3 flex items-center gap-3 rounded-t-xl p-3 text-white">
        {m.photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={m.photo} alt="" className="border-gold/40 h-12 w-12 shrink-0 rounded-full border object-cover" />
        ) : (
          <span aria-hidden className="border-gold/40 text-gold flex h-12 w-12 shrink-0 items-center justify-center rounded-full border text-sm font-semibold">
            {cardMonogram(m)}
          </span>
        )}
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{m.name}</p>
          {/* The Malay title: the card opens in BM and so does the vCard. */}
          <p className="text-gold truncate text-xs">{m.role.ms}</p>
        </div>
        {mine && (
          <span className="bg-gold ml-auto shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold text-black">
            {L("Yours", "Anda")}
          </span>
        )}
      </div>

      <p className="text-muted-foreground text-xs break-all">{url.replace("https://", "")}</p>

      {/* Two by two, and it stays two by two at 320px — four across would
          put "Send on WhatsApp" on two lines inside a 70px button. */}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Action icon="link" label={L("Copy link", "Salin pautan")} onClick={copy} />
        <Action
          icon="chat"
          label={L("WhatsApp", "WhatsApp")}
          href={`https://wa.me/?text=${encodeURIComponent(shareText(m, url))}`}
        />
        <Action icon="qr" label={L("Show QR", "Tunjuk QR")} onClick={() => setQr(true)} />
        <Action icon="download" label={L("Image", "Imej")} href={`/cards/${m.slug}-og.png`} />
      </div>

      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-muted-foreground mt-2 inline-flex items-center gap-1.5 text-xs underline"
      >
        <AppIcon name="preview" className="h-3.5 w-3.5" />
        {L("Open the card as a client sees it", "Buka kad seperti dilihat pelanggan")}
      </a>
    </div>
  );
}

export function CardsPanel({ role = "" }: { role?: string }) {
  /* Own card first, then the other two in the registry's order. A director
     opening this tab is usually sending their own. */
  const own = OWN_SLUG[role];
  const ordered = [...TEAM].sort((a, b) =>
    a.slug === own ? -1 : b.slug === own ? 1 : 0,
  );

  return (
    <div className="space-y-4 md:space-y-6">
      <div className={card}>
        <PanelTitle icon="person">{L("Business cards", "Kad perniagaan")}</PanelTitle>
        <p className="text-muted-foreground mt-1 text-sm">
          {L("Send a client the digital card — it opens in Malay, switches to English, and saves straight into their phone contacts.",
             "Hantar kad digital kepada pelanggan — ia dibuka dalam Bahasa Melayu, boleh tukar ke Bahasa Inggeris, dan disimpan terus ke dalam kenalan telefon mereka.")}
        </p>
        {/* Said here, not only in a code comment: somebody will otherwise
            assume this tab makes the cards private. */}
        <p className="text-muted-foreground mt-1.5 text-xs">
          {L("This tab is limited to the CEO, COO and CCO. The cards themselves are public pages — they are printed on paper with a QR code — so this controls who shares them from the portal, not who can open one.",
             "Tab ini terhad kepada CEO, COO dan CCO. Kad itu sendiri ialah halaman awam — ia dicetak pada kad dengan kod QR — jadi ini mengawal siapa yang berkongsi daripada portal, bukan siapa yang boleh membukanya.")}
        </p>

        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {ordered.map((m) => (
            <OfficerCard key={m.slug} m={m} mine={m.slug === own} />
          ))}
        </div>
      </div>
    </div>
  );
}

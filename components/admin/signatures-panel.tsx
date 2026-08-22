"use client";

/* v1.38.0 (IMPLEMENTATION-PLAN.md S-1) — the signature vault's upload card.

   The five officer signatures used to be plain files under /signatures/ —
   downloadable by ANYONE, no login, and referenced from approved leave and
   claim forms. They now live in private R2 and are served only through
   authenticated routes; this card is where an admin puts them there.

   Because the old files were public for an unknown period, the honest move
   is to re-scan FRESH signatures rather than re-upload the leaked images —
   then a leaked copy no longer matches what appears on new documents. */

import { useCallback, useEffect, useState } from "react";
import { csrfFetch } from "@/lib/api";
import { useSaveToast } from "@/components/ui/save-toast";
import { card } from "@/lib/ui-styles";
import { getLang } from "@/lib/i18n";

const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);

const ROLES: { file: string; label: string }[] = [
  { file: "ceo-sign.png", label: "CEO" },
  { file: "coo-sign.png", label: "COO" },
  { file: "cco-sign.png", label: "CCO" },
  { file: "hr-admin-sign.png", label: "HR Admin" },
  { file: "sales-marketing-sign.png", label: "Sales & Marketing" },
];

export function SignaturesPanel() {
  const { show: showToast, node: toastNode } = useSaveToast();
  const [status, setStatus] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);

  /* Presence check: a HEAD-ish GET per role. 404 = not uploaded yet. */
  const load = useCallback(async () => {
    const next: Record<string, boolean> = {};
    await Promise.all(ROLES.map(async (r) => {
      try {
        const res = await fetch(`/api/v1/staff/signature/${r.file}`, { credentials: "include" });
        next[r.file] = res.ok;
      } catch { next[r.file] = false; }
    }));
    setStatus(next);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const upload = async (file: string, blob: File) => {
    if (blob.type !== "image/png") {
      showToast(L("Not uploaded", "Tidak dimuat naik"), L("Signatures must be PNG (transparent background)", "Tandatangan mesti PNG (latar telus)"), "notice");
      return;
    }
    setBusy(file);
    const res = await csrfFetch(`/api/v1/staff/signatures/${file}`, {
      method: "POST",
      headers: { "Content-Type": "image/png" },
      body: blob,
    });
    setBusy(null);
    if (!res.ok) {
      showToast(L("Not uploaded", "Tidak dimuat naik"), L("Upload failed — admin or CEO only", "Muat naik gagal — admin atau CEO sahaja"), "notice");
      return;
    }
    showToast(L("Uploaded", "Dimuat naik"), `${file} ${L("is in the vault — documents sign with it from now on", "berada dalam bilik kebal — dokumen ditandatangani dengannya mulai sekarang")}`);
    void load();
  };

  return (
    <div className={card}>
      {toastNode}
      <h2 className="text-base font-semibold">{L("Signatures", "Tandatangan")}</h2>
      <p className="text-muted-foreground mt-1 text-sm">
        {L("Served only to signed-in staff and token-holding customers — never public. Upload a FRESH scan: the old public files must be treated as compromised.",
           "Hanya diberikan kepada kakitangan yang log masuk dan pelanggan pemegang token — tidak sekali-kali umum. Muat naik imbasan BARU: fail lama yang pernah umum perlu dianggap terjejas.")}
      </p>
      <ul className="mt-3 space-y-2">
        {ROLES.map((r) => (
          <li key={r.file} className="flex flex-wrap items-center gap-3 text-sm">
            <span className="w-40 font-medium">{r.label}</span>
            {status[r.file]
              ? <span className="text-green-700 dark:text-green-400">{L("In the vault", "Dalam bilik kebal")}</span>
              : <span className="font-medium text-amber-700 dark:text-amber-400">{L("Missing — documents print a blank zone", "Tiada — dokumen mencetak ruang kosong")}</span>}
            <label className="cursor-pointer rounded border border-border px-2 py-0.5 text-xs hover:bg-secondary">
              {busy === r.file ? L("Uploading…", "Memuat naik…") : status[r.file] ? L("Replace", "Ganti") : L("Upload PNG", "Muat naik PNG")}
              <input type="file" accept="image/png" className="hidden" disabled={busy !== null}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(r.file, f); e.target.value = ""; }} />
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}

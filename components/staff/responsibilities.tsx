"use client";

/* v1.174.0 — ROLES AND RESPONSIBILITIES.
 *
 * The CEO, 21-09-2026: *"On the staff tabs, I want to add Roles and
 * Responsibilities of the staff that currently working for me. I need to
 * make sure that I can edit the roles and responsibilities in staff tabs."*
 * He chose: a role title and a bullet list (one responsibility per line);
 * written by the CEO and the HR tier; read by everyone who opens the Staff
 * tab, and by the person themselves on their Profile.
 *
 * ONE block, two doors. `ResponsibilitiesBlock` is the Staff tab's - it
 * reads, and for `canEdit` it opens an editor and writes the whole thing
 * (title + list) to PUT /staff/users/:id/responsibilities, the worker's own
 * route behind PERMS.responsibilities_edit (worker/src/permissions.ts).
 * `ResponsibilitiesView` is the read-only half the Profile tab shows. The
 * two draw the same list, so what the CEO wrote is what the person reads.
 *
 * The block is shown for WORKING staff (is_active) - the CEO's words - and
 * the worker refuses a write for anyone else (409 inactive). A leaver's
 * text stays readable on their record. Nothing here decides anything: the
 * permission is the worker's; the client only hides a button it may not
 * press (house rule: the server refuses what the picker hides).
 *
 * A toast on success AND on refusal (house rule #25); the editor keeps the
 * text on a failed save so nothing typed is lost. Styling: the shared
 * classes + responsibilities.module.css, tokens only (Tailwind is retired).
 */

import { useState } from "react";
import { AppIcon } from "@/components/ui/app-icon";
import { useSaveToast } from "@/components/ui/save-toast";
import { Skel } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { dmyMYT } from "@/lib/format";
import { getLang } from "@/lib/i18n";
import { btnSm, btnSmPrimary, inputClass, textareaClass } from "@/lib/ui-styles";
import css from "./responsibilities.module.css";

const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);

/** The four columns migration 0137 adds to a staff record, as the list and
    profile routes return them. */
export interface Responsibilities {
  role_title?: string | null;
  responsibilities?: string | null;
  responsibilities_updated_at?: string | null;
  responsibilities_updated_by_name?: string | null;
}

/** One responsibility per line; blank lines and leading bullets dropped -
    the same rule the worker applies, so the preview is the saved list. */
export function responsibilityLines(text: string | null | undefined): string[] {
  return (text ?? "").split(/\r?\n/).map((l) => l.replace(/^\s*[-•*]\s*/, "").trim()).filter(Boolean);
}

export const RESPONSIBILITY_LIMITS = { title: 120, line: 200, lines: 30 } as const;

/** The read-only half: title, numbered list, who wrote it. */
export function ResponsibilitiesView({ value, loaded = true, emptyText }: {
  value: Responsibilities;
  loaded?: boolean;
  /** What to say when nothing is written yet (the Profile says something different from the Staff tab). */
  emptyText?: string;
}) {
  if (!loaded) {
    return (
      <div aria-busy="true">
        <Skel className={`erp-mt-2`} h="1rem" w="55%" />
        <Skel className={`erp-mt-2`} h="0.75rem" w="90%" />
        <Skel className={`erp-mt-1`} h="0.75rem" w="80%" />
      </div>
    );
  }
  const lines = responsibilityLines(value.responsibilities);
  const title = (value.role_title ?? "").trim();
  if (!title && lines.length === 0) {
    return <p className={`erp-text-sm erp-muted ${css.empty}`}>{emptyText ?? L("Not written yet.", "Belum ditulis.")}</p>;
  }
  return (
    <>
      {title && <p className={css.title}>{title}</p>}
      {lines.length > 0 && (
        <ol className={css.list} aria-label={L("Responsibilities", "Tanggungjawab")}>
          {lines.map((l, i) => <li key={`${i}-${l}`} className={css.item}>{l}</li>)}
        </ol>
      )}
      {value.responsibilities_updated_at && (
        <p className={`erp-meta ${css.meta}`}>
          {L("Written", "Ditulis")}{value.responsibilities_updated_by_name ? ` ${L("by", "oleh")} ${value.responsibilities_updated_by_name}` : ""} · {dmyMYT(value.responsibilities_updated_at)}
        </p>
      )}
    </>
  );
}

/** The Staff tab's block: read, and for the CEO / HR tier, edit. */
export function ResponsibilitiesBlock({ userId, personName, value, canEdit, onSaved }: {
  userId: number;
  personName: string;
  value: Responsibilities;
  /** Mirrors PERMS.responsibilities_edit - the worker refuses what this hides. */
  canEdit: boolean;
  /** The saved record, so the directory shows it without a refetch. */
  onSaved?: (next: Responsibilities) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const { show: toast, node: toastNode } = useSaveToast();

  const open = () => {
    setTitle((value.role_title ?? "").trim());
    setText(responsibilityLines(value.responsibilities).join("\n"));
    setEditing(true);
  };
  const lines = responsibilityLines(text);
  const tooMany = lines.length > RESPONSIBILITY_LIMITS.lines;
  const tooLong = lines.some((l) => l.length > RESPONSIBILITY_LIMITS.line);

  const save = async () => {
    if (tooMany || tooLong) return;
    setSaving(true);
    const r = await api<{ ok?: boolean; role_title?: string | null; responsibilities?: string[]; updated_by_name?: string | null; error?: { message?: string } }>(
      `/staff/users/${userId}/responsibilities`,
      { method: "PUT", body: JSON.stringify({ role_title: title.trim(), responsibilities: lines }) },
    );
    setSaving(false);
    if (!r.ok) {
      toast(L("Not saved", "Tidak disimpan"), r.data?.error?.message ?? L("The server refused that", "Pelayan menolaknya"), "notice");
      return;
    }
    const next: Responsibilities = {
      role_title: r.data?.role_title ?? (title.trim() || null),
      responsibilities: (r.data?.responsibilities ?? lines).join("\n") || null,
      responsibilities_updated_at: new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 19).replace("T", " "),
      responsibilities_updated_by_name: r.data?.updated_by_name ?? null,
    };
    onSaved?.(next);
    setEditing(false);
    toast(L("Saved", "Disimpan"), L(`Roles and responsibilities — ${personName}`, `Peranan dan tanggungjawab — ${personName}`));
  };

  return (
    <div className={css.block} data-testid="responsibilities">
      {toastNode}
      <div className={css.head}>
        <p className={css.eyebrow}><AppIcon name="target" className="erp-icon-sm" />{L("Roles and responsibilities", "Peranan dan tanggungjawab")}</p>
        {canEdit && !editing && (
          <button type="button" className={btnSm} onClick={open}
            title={L("Write or change this person's role title and responsibilities — recorded with your name", "Tulis atau ubah tajuk peranan dan tanggungjawab orang ini — direkodkan dengan nama anda")}>
            {(value.role_title || value.responsibilities) ? L("Edit", "Sunting") : L("Write", "Tulis")}
          </button>
        )}
      </div>
      {!editing ? (
        <ResponsibilitiesView value={value}
          emptyText={canEdit
            ? L("Not written yet — press Write to set the role title and what this person is answerable for.", "Belum ditulis — tekan Tulis untuk menetapkan tajuk peranan dan tanggungjawab orang ini.")
            : L("Not written yet.", "Belum ditulis.")} />
      ) : (
        <div className={css.editor}>
          <div className={css.grid}>
            <label className="erp-field">
              <span className="erp-label">{L("Role title", "Tajuk peranan")}</span>
              <input className={inputClass} value={title} maxLength={RESPONSIBILITY_LIMITS.title}
                placeholder={L("e.g. Sales Executive — ELFIA accounts", "cth. Eksekutif Jualan — akaun ELFIA")}
                onChange={(e) => setTitle(e.target.value)} />
            </label>
            <label className="erp-field">
              <span className="erp-label">{L("Responsibilities — one per line", "Tanggungjawab — satu setiap baris")}</span>
              <textarea className={`${textareaClass} ${css.textarea}`} value={text} rows={6}
                placeholder={L("Answer every enquiry within 24 hours\nRaise quotations and invoices on the Sales tab\nLog every hotel call on the Hotels tab", "Jawab setiap pertanyaan dalam 24 jam\nSediakan sebut harga dan invois di tab Jualan\nRekod setiap panggilan hotel di tab Hotel")}
                onChange={(e) => setText(e.target.value)} />
              <span className={`erp-help ${css.count}${tooMany || tooLong ? " erp-danger" : ""}`}>
                {lines.length}/{RESPONSIBILITY_LIMITS.lines} {L("lines", "baris")}
                {tooLong ? ` · ${L(`a line is longer than ${RESPONSIBILITY_LIMITS.line} characters`, `satu baris melebihi ${RESPONSIBILITY_LIMITS.line} aksara`)}` : ""}
                {tooMany ? ` · ${L("too many lines", "terlalu banyak baris")}` : ""}
              </span>
            </label>
          </div>
          <div className={css.actions}>
            <span className="erp-meta">{L("Saved whole, with your name and the time; the person reads it on their Profile.", "Disimpan sepenuhnya, dengan nama anda dan masa; orang itu membacanya di Profil mereka.")}</span>
            <span className="erp-flex erp-gap-2">
              <button type="button" className={btnSm} disabled={saving} onClick={() => setEditing(false)}>{L("Cancel", "Batal")}</button>
              <button type="button" className={btnSmPrimary} disabled={saving || tooMany || tooLong} onClick={() => void save()}>
                {saving ? L("Saving…", "Menyimpan…") : L("Save", "Simpan")}
              </button>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

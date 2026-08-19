"use client";

/**
 * Website editor (v1.4.5) — the friendly face of the CMS.
 *
 * The old Content tab was a raw key/value box: it worked, but an editor had to
 * know the key names by heart, and nothing told them which text on the live
 * site a key controlled. This panel is the fix — every field below maps to a
 * key the site actually reads, labelled by where it appears on the page.
 *
 * The raw editor still exists (Advanced tab) for keys outside this list.
 * Empty field = the site shows its built-in default; the site can never break
 * from a missing value.
 */

import { api } from "@/lib/api"; // v1.5.0: one shared helper (was a per-file copy)
import { useCallback, useEffect, useState } from "react";
import { inputClass, btnClass } from "@/lib/ui-styles";
import { useSaveToast } from "@/components/ui/save-toast";
import { getLang } from "@/lib/i18n";
const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);




interface Field {
  key: string;
  label: string;
  hint: string;
  multiline?: boolean;
}

interface Group {
  title: string;
  description: string;
  fields: Field[];
}

/** Every key here is read by the live site via <Editable>. */
const GROUPS: Group[] = [
  {
    title: "Homepage — hero",
    description: "The first thing every visitor reads.",
    fields: [
      {
        key: "home.hero.headline",
        label: "Headline",
        hint: "Default: “Grow your sales through live commerce”",
      },
      {
        key: "home.hero.subheadline",
        label: "Sub-headline",
        hint: "The sentence under the headline.",
        multiline: true,
      },
    ],
  },
  {
    title: "Homepage — about",
    description: "The credibility block under the hero.",
    fields: [
      { key: "about.body1", label: "First paragraph", hint: "", multiline: true },
      { key: "about.body2", label: "Second paragraph", hint: "", multiline: true },
    ],
  },
  {
    title: "Homepage — services",
    description: "Heading above the seven service cards.",
    fields: [
      { key: "home.services.title", label: "Section title", hint: "" },
      { key: "home.services.intro", label: "Section intro", hint: "", multiline: true },
    ],
  },
  {
    title: "Homepage — session showcase",
    description: "Heading above the TikTok / Shopee channel section.",
    fields: [
      { key: "home.showcase.title", label: "Section title", hint: "" },
      { key: "home.showcase.intro", label: "Section intro", hint: "", multiline: true },
    ],
  },
  {
    title: "Footer",
    description: "Site-wide.",
    fields: [
      {
        key: "footer.slogan",
        label: "Strapline",
        hint: "Default: “LIVE . CONNECT . GROW.”",
      },
    ],
  },
  {
    title: "Statistics",
    description:
      "Shown on the homepage once real figures exist; leave empty to show the qualitative trust signals instead. JSON list, e.g. [{\"value\":\"500+\",\"label\":\"Live sessions hosted\"}]",
    fields: [
      {
        key: "stats.items",
        label: "Statistics (JSON)",
        hint: "Empty = trust signals shown, never zeroes.",
        multiline: true,
      },
    ],
  },
];

/* Display-only BM lookups for the GROUPS table above — keys and the EN
   strings themselves never change, so nothing the site reads is affected. */
const GROUP_TITLE_MS: Record<string, string> = {
  "Homepage — hero": "Laman utama — hero",
  "Homepage — about": "Laman utama — tentang",
  "Homepage — services": "Laman utama — perkhidmatan",
  "Homepage — session showcase": "Laman utama — pameran sesi",
  "Footer": "Pengaki",
  "Statistics": "Statistik",
};
const GROUP_DESC_MS: Record<string, string> = {
  "The first thing every visitor reads.": "Perkara pertama yang dibaca setiap pelawat.",
  "The credibility block under the hero.": "Blok kredibiliti di bawah hero.",
  "Heading above the seven service cards.": "Tajuk di atas tujuh kad perkhidmatan.",
  "Heading above the TikTok / Shopee channel section.": "Tajuk di atas bahagian saluran TikTok / Shopee.",
  "Site-wide.": "Seluruh tapak.",
  "Shown on the homepage once real figures exist; leave empty to show the qualitative trust signals instead. JSON list, e.g. [{\"value\":\"500+\",\"label\":\"Live sessions hosted\"}]":
    "Dipaparkan di laman utama apabila angka sebenar wujud; biarkan kosong untuk memaparkan isyarat kepercayaan kualitatif. Senarai JSON, cth. [{\"value\":\"500+\",\"label\":\"Live sessions hosted\"}]",
};
const FIELD_LABEL_MS: Record<string, string> = {
  "home.hero.headline": "Tajuk utama",
  "home.hero.subheadline": "Sub-tajuk",
  "about.body1": "Perenggan pertama",
  "about.body2": "Perenggan kedua",
  "home.services.title": "Tajuk bahagian",
  "home.services.intro": "Pengenalan bahagian",
  "home.showcase.title": "Tajuk bahagian",
  "home.showcase.intro": "Pengenalan bahagian",
  "footer.slogan": "Slogan",
  "stats.items": "Statistik (JSON)",
};
const FIELD_HINT_MS: Record<string, string> = {
  "home.hero.headline": "Lalai: “Grow your sales through live commerce”",
  "home.hero.subheadline": "Ayat di bawah tajuk utama.",
  "footer.slogan": "Lalai: “LIVE . CONNECT . GROW.”",
  "stats.items": "Kosong = isyarat kepercayaan dipaparkan, bukan sifar.",
};
const fieldLabel = (f: Field) => L(f.label, FIELD_LABEL_MS[f.key] ?? f.label);
const fieldHint = (f: Field) => (f.hint ? L(f.hint, FIELD_HINT_MS[f.key] ?? f.hint) : f.hint);

export function SiteEditor() {
  const { show: showToast, node: toastNode } = useSaveToast();
  const [values, setValues] = useState<Record<string, string>>({});
  const [initial, setInitial] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Record<string, number>>({});
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const res = await api<{ content: { key: string; value: string }[] }>("/content");
    if (res.ok && res.data) {
      const map: Record<string, string> = {};
      for (const row of res.data.content) {
        // values are stored JSON-encoded; show strings without quotes
        try {
          const parsed: unknown = JSON.parse(row.value);
          map[row.key] = typeof parsed === "string" ? parsed : row.value;
        } catch {
          map[row.key] = row.value;
        }
      }
      setValues(map);
      setInitial(map);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const save = async (field: Field) => {
    setError("");
    setSaving(field.key);
    const raw = values[field.key] ?? "";
    // stats.items is JSON; everything else is a plain string
    let payload: unknown = raw;
    if (field.key === "stats.items" && raw.trim()) {
      try {
        payload = JSON.parse(raw);
      } catch {
        setError(L("Statistics must be valid JSON — check the example in the description.", "Statistik mesti JSON yang sah — semak contoh dalam penerangan."));
        setSaving(null);
        return;
      }
    }
    const res = await api(`/content/${encodeURIComponent(field.key)}`, {
      method: "PUT",
      body: JSON.stringify({ value: payload }),
    });
    setSaving(null);
    if (!res.ok) {
      setError(L("Save failed — check your connection and try again.", "Simpan gagal — semak sambungan anda dan cuba lagi."));
      showToast(L("No changes", "Tiada perubahan"), `${fieldLabel(field)} ${L("was not saved — check your connection and try again", "tidak disimpan — semak sambungan anda dan cuba lagi")}`, "notice");
      return;
    }
    setInitial((s) => ({ ...s, [field.key]: raw }));
    setSavedAt((s) => ({ ...s, [field.key]: Date.now() }));
    showToast(L("Saved", "Disimpan"), `${fieldLabel(field)} ${L("updated — live on the website now", "dikemas kini — kini dipaparkan di laman web")}`);
  };

  return (
    <div className="space-y-8">
      {toastNode}
      <div className="rounded-lg border border-border bg-secondary/40 px-4 py-3">
        <p className="text-sm font-medium">{L("This tab edits the live website.", "Tab ini menyunting laman web langsung.")}</p>
        <p className="text-muted-foreground mt-0.5 text-xs">
          {L(
            "Each field controls the text named beside it. Save a field and the site picks it up on the next page load — no rebuild, no code change. An empty field means the site shows its built-in default, so nothing here can break the page.",
            "Setiap medan mengawal teks yang dinamakan di sebelahnya. Simpan medan dan laman web mengambilnya pada muatan halaman seterusnya — tiada bina semula, tiada perubahan kod. Medan kosong bermakna laman memaparkan lalai terbina dalamnya, jadi tiada apa-apa di sini boleh merosakkan halaman.",
          )}
        </p>
      </div>

      {error && <p className="text-destructive text-sm">{error}</p>}

      {GROUPS.map((group) => (
        <section key={group.title}>
          <h3 className="text-sm font-semibold tracking-tight">{L(group.title, GROUP_TITLE_MS[group.title] ?? group.title)}</h3>
          <p className="text-muted-foreground mt-0.5 text-xs">{L(group.description, GROUP_DESC_MS[group.description] ?? group.description)}</p>
          <div className="mt-3 space-y-4">
            {group.fields.map((field) => {
              const dirty = (values[field.key] ?? "") !== (initial[field.key] ?? "");
              const justSaved = savedAt[field.key] && Date.now() - savedAt[field.key]! < 4000;
              return (
                <label key={field.key} className="block">
                  <span className="mb-1 flex items-center gap-2 text-xs font-medium">
                    {fieldLabel(field)}
                    {justSaved && !dirty && (
                      <span className="text-xs font-medium text-green-700">{L("Saved ✓", "Disimpan ✓")}</span>
                    )}
                  </span>
                  {field.multiline ? (
                    <textarea
                      className={`${inputClass} min-h-20`}
                      value={values[field.key] ?? ""}
                      placeholder={fieldHint(field)}
                      onChange={(e) =>
                        setValues((s) => ({ ...s, [field.key]: e.target.value }))
                      }
                    />
                  ) : (
                    <input
                      className={inputClass}
                      value={values[field.key] ?? ""}
                      placeholder={fieldHint(field)}
                      onChange={(e) =>
                        setValues((s) => ({ ...s, [field.key]: e.target.value }))
                      }
                    />
                  )}
                  {field.hint && field.multiline === undefined && (
                    <span className="text-muted-foreground mt-0.5 block text-[11px]">
                      {fieldHint(field)}
                    </span>
                  )}
                  {dirty && (
                    <button
                      type="button"
                      className={`${btnClass} mt-2 h-8 px-3 text-xs`}
                      disabled={saving === field.key}
                      onClick={() => void save(field)}
                    >
                      {saving === field.key ? L("Saving…", "Menyimpan…") : L("Save", "Simpan")}
                    </button>
                  )}
                </label>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

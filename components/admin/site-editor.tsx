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
        setError("Statistics must be valid JSON — check the example in the description.");
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
      setError("Save failed — check your connection and try again.");
      showToast("No changes", `${field.label} was not saved — check your connection and try again`, "notice");
      return;
    }
    setInitial((s) => ({ ...s, [field.key]: raw }));
    setSavedAt((s) => ({ ...s, [field.key]: Date.now() }));
    showToast("Saved", `${field.label} updated — live on the website now`);
  };

  return (
    <div className="space-y-8">
      {toastNode}
      <div className="rounded-lg border border-border bg-secondary/40 px-4 py-3">
        <p className="text-sm font-medium">This tab edits the live website.</p>
        <p className="text-muted-foreground mt-0.5 text-xs">
          Each field controls the text named beside it. Save a field and the
          site picks it up on the next page load — no rebuild, no code change.
          An empty field means the site shows its built-in default, so nothing
          here can break the page.
        </p>
      </div>

      {error && <p className="text-destructive text-sm">{error}</p>}

      {GROUPS.map((group) => (
        <section key={group.title}>
          <h3 className="text-sm font-semibold tracking-tight">{group.title}</h3>
          <p className="text-muted-foreground mt-0.5 text-xs">{group.description}</p>
          <div className="mt-3 space-y-4">
            {group.fields.map((field) => {
              const dirty = (values[field.key] ?? "") !== (initial[field.key] ?? "");
              const justSaved = savedAt[field.key] && Date.now() - savedAt[field.key]! < 4000;
              return (
                <label key={field.key} className="block">
                  <span className="mb-1 flex items-center gap-2 text-xs font-medium">
                    {field.label}
                    {justSaved && !dirty && (
                      <span className="text-xs font-medium text-green-700">Saved ✓</span>
                    )}
                  </span>
                  {field.multiline ? (
                    <textarea
                      className={`${inputClass} min-h-20`}
                      value={values[field.key] ?? ""}
                      placeholder={field.hint}
                      onChange={(e) =>
                        setValues((s) => ({ ...s, [field.key]: e.target.value }))
                      }
                    />
                  ) : (
                    <input
                      className={inputClass}
                      value={values[field.key] ?? ""}
                      placeholder={field.hint}
                      onChange={(e) =>
                        setValues((s) => ({ ...s, [field.key]: e.target.value }))
                      }
                    />
                  )}
                  {field.hint && field.multiline === undefined && (
                    <span className="text-muted-foreground mt-0.5 block text-[11px]">
                      {field.hint}
                    </span>
                  )}
                  {dirty && (
                    <button
                      type="button"
                      className={`${btnClass} mt-2 h-8 px-3 text-xs`}
                      disabled={saving === field.key}
                      onClick={() => void save(field)}
                    >
                      {saving === field.key ? "Saving…" : "Save"}
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

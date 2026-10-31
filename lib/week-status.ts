/* v1.239.0 - THE WEEKLY STATUS WORDS, ONE PLACE (the owner, 31-10-2026,
   claude/WEEKLY-TARGET-DASHBOARD-AUDIT.md). The worker decides the status
   (weekly-sales.ts statusOf: remaining working days, progress, open pipeline
   and activity - never the percentage alone); the Sales scorecard and the
   Dashboard card both say it in these words. Display only: nothing here is
   stored. */
export type WeekStatus = "no_target" | "not_working" | "planning" | "achieved" | "on_track" | "at_risk" | "action" | "missed";
export type WeekTone = "neutral" | "info" | "success" | "warn" | "danger";

export const WEEK_STATUS: Record<WeekStatus, { en: string; ms: string; tone: WeekTone; hint_en: string; hint_ms: string }> = {
  no_target: { en: "No target assigned", ms: "Tiada sasaran ditetapkan", tone: "neutral", hint_en: "Nothing has been approved for this week.", hint_ms: "Tiada apa diluluskan untuk minggu ini." },
  not_working: { en: "Not working this week", ms: "Tidak bekerja minggu ini", tone: "neutral", hint_en: "On leave or holidays all week.", hint_ms: "Bercuti sepanjang minggu." },
  planning: { en: "Planning", ms: "Perancangan", tone: "info", hint_en: "Early in the week - no judgement yet.", hint_ms: "Awal minggu - belum dinilai." },
  achieved: { en: "Target achieved", ms: "Sasaran dicapai", tone: "success", hint_en: "The week's target is reached.", hint_ms: "Sasaran minggu ini dicapai." },
  on_track: { en: "On track", ms: "Mengikut landasan", tone: "success", hint_en: "At or ahead of where the working days say.", hint_ms: "Pada atau mendahului jangkaan hari bekerja." },
  at_risk: { en: "Attention needed", ms: "Perlu perhatian", tone: "warn", hint_en: "Behind, but open quotations can still cover the gap.", hint_ms: "Ketinggalan, tetapi sebut harga terbuka masih boleh menampung jurang." },
  action: { en: "At risk", ms: "Berisiko", tone: "danger", hint_en: "Behind, and the open pipeline does not cover the gap.", hint_ms: "Ketinggalan, dan saluran terbuka tidak menampung jurang." },
  missed: { en: "Below target", ms: "Bawah sasaran", tone: "warn", hint_en: "The week ended under its target.", hint_ms: "Minggu tamat di bawah sasaran." },
};

export const GOAL_LABEL: Record<string, [string, string]> = {
  quotations: ["Quotations sent", "Sebut harga dihantar"],
  followups: ["Customer follow-ups done", "Susulan pelanggan selesai"],
  qualified_enquiries: ["Enquiries qualified", "Pertanyaan layak"],
  introductions: ["Leads introduced (verified)", "Petunjuk diperkenalkan (disahkan)"],
};

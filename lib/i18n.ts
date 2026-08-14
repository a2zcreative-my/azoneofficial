/* v1.9.0 — EN/BM for the portal CHROME (navigation, tab names, common
   buttons, greeting). Scope is deliberate: labels the whole team sees on
   every screen. Data/content and deep panels stay English for now — a
   half-translated form is worse than an honest bilingual chrome.
   Stored per device (localStorage azone-lang). */

export type Lang = "en" | "ms";

const DICT: Record<string, { en: string; ms: string }> = {
  // tab labels (keys = tab names used in ALL_TABS)
  "Dashboard": { en: "Dashboard", ms: "Papan Pemuka" },
  "Overview": { en: "Overview", ms: "Ringkasan" },
  "Announcements": { en: "News", ms: "Berita" },
  "HR": { en: "HR", ms: "HR" },
  "Staff Details": { en: "Staff", ms: "Kakitangan" },
  "Attendance": { en: "Attendance", ms: "Kehadiran" },
  "Leave": { en: "Leave", ms: "Cuti" },
  "Tasks": { en: "Tasks", ms: "Tugasan" },
  "Pipeline": { en: "Pipeline", ms: "Saluran Jualan" },
  "Content": { en: "Content", ms: "Kandungan" },
  "Claims": { en: "Claims", ms: "Tuntutan" },
  "Payroll": { en: "Payroll", ms: "Gaji" },
  "Expenses": { en: "Expenses", ms: "Perbelanjaan" },
  "Sales": { en: "Sales", ms: "Jualan" },
  "Inventory": { en: "Inventory", ms: "Inventori" },
  "Stokis": { en: "Stokis", ms: "Stokis" },
  "Ecommerce": { en: "Ecommerce", ms: "E-dagang" },
  "Assets": { en: "Assets", ms: "Aset" },
  "Birthdays": { en: "Birthdays", ms: "Hari Lahir" },
  "Profile": { en: "Profile", ms: "Profil" },
  "Users": { en: "Users", ms: "Pengguna" },
  // chrome
  "Sign out": { en: "Sign out", ms: "Log keluar" },
  "Search…": { en: "Search…", ms: "Cari…" },
  "Staff Portal": { en: "Staff Portal", ms: "Portal Kakitangan" },
  "Welcome": { en: "Welcome", ms: "Selamat datang" },
  "Hello": { en: "Hello", ms: "Hai" },
  "More": { en: "More", ms: "Lagi" },
  "Quick actions": { en: "Quick actions", ms: "Tindakan pantas" },
  "Clock in": { en: "Clock in", ms: "Daftar masuk" },
  "Clock out": { en: "Clock out", ms: "Daftar keluar" },
  "Clocked in ✓": { en: "Clocked in ✓", ms: "Sudah masuk ✓" },
  "Clocked out ✓": { en: "Clocked out ✓", ms: "Sudah keluar ✓" },
  "Apply leave": { en: "Apply leave", ms: "Mohon cuti" },
  "Create quotation": { en: "Create quotation", ms: "Buat sebut harga" },
  "Notifications": { en: "Notifications", ms: "Pemberitahuan" },
  // v1.9.1 — geofence + clock-out reminder chrome
  "Don't forget to clock out": { en: "Don't forget to clock out", ms: "Jangan lupa daftar keluar" },
  "tap Clock out before you leave.": { en: "tap Clock out before you leave.", ms: "tekan Daftar keluar sebelum pulang." },
  "Office check-in is on": { en: "Office check-in is on", ms: "Daftar kehadiran di pejabat diaktifkan" },
};

export function getLang(): Lang {
  if (typeof window === "undefined") return "en";
  return window.localStorage.getItem("azone-lang") === "ms" ? "ms" : "en";
}

export function setLang(lang: Lang): void {
  try { window.localStorage.setItem("azone-lang", lang); } catch { /* private mode */ }
}

/** Translate a chrome string. Unknown strings pass through unchanged. */
export function t(key: string, lang: Lang): string {
  return DICT[key]?.[lang] ?? key;
}

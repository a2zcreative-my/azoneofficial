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
  "Web Orders": { en: "Web Orders", ms: "Pesanan Web" },
  "ELFIA Traffic": { en: "ELFIA Traffic", ms: "Trafik ELFIA" },
  "ELFIA Store": { en: "ELFIA Store", ms: "Kedai ELFIA" },
  "Ecommerce": { en: "Ecommerce", ms: "E-dagang" },
  "Assets": { en: "Assets", ms: "Aset" },
  "Threads": { en: "Threads", ms: "Threads" },
  "Birthdays": { en: "Birthdays", ms: "Hari Lahir" },
  "Profile": { en: "Profile", ms: "Profil" },
  "Users": { en: "Users", ms: "Pengguna" },
  // chrome
  "Sign out": { en: "Sign out", ms: "Log keluar" },
  "Search…": { en: "Search…", ms: "Cari…" },
  /* v1.27.0 — the portal is A2Z CREATIVE MARKETING's now (A2Z is the parent
     company and owns the internal infrastructure; AZ ONE OFFICIAL is a
     separate legal entity and stays on payslips, invoices and receipts).
     The DICT KEY stays "Staff Portal" so every existing tr("Staff Portal",
     lang) call site keeps resolving — only the VALUES moved. */
  "Staff Portal": { en: "A2Z CREATIVE MARKETING / Staff Portal", ms: "A2Z CREATIVE MARKETING / Portal Kakitangan" },
  /* v1.27.0 — the SAME identity, sized for the one place it does not fit.
     The portal's desktop header eyebrow gets 182px (measured: three columns
     open at 1440px, the greeting truncates in the same space), and it is set
     in text-xs uppercase with 0.3em tracking, so the full lockup above is
     390px — three wrapped lines where there used to be one. This short form
     is 172px in EN, so the header keeps its current height; the full company
     name sits right below it in the breadcrumb, which has room for it. */
  "Staff Portal short": { en: "A2Z Staff Portal", ms: "A2Z Portal Kakitangan" },
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
  // v1.10.0 — mobile app shell
  "Today": { en: "Today", ms: "Hari ini" },
  "On shift": { en: "On shift", ms: "Sedang bertugas" },
  "Preferences": { en: "Preferences", ms: "Tetapan" },
  "Next event": { en: "Next event", ms: "Acara akan datang" },
  "Public holiday": { en: "Public holiday", ms: "Cuti umum" },
  "Birthday": { en: "Birthday", ms: "Hari lahir" },
  /* v1.23.2 (CEO: "Why some doesn't change to BM? … only BM having
     inconsistent change") — tabs added since v1.9 that never got entries,
     plus every Dashboard card and the Schedule & Roster read surfaces. */
  "Finance": { en: "Finance", ms: "Kewangan" },
  "Reconciliation": { en: "Reconciliation", ms: "Penyelarasan" },
  "Commission": { en: "Commission", ms: "Komisen" },
  "Ads Fund": { en: "Ads Fund", ms: "Dana Iklan" },
  "Purchasing": { en: "Purchasing", ms: "Pembelian" },
  "Accounting": { en: "Accounting", ms: "Perakaunan" },
  // dashboard cards
  "Pending leave": { en: "Pending leave", ms: "Cuti menunggu" },
  "None pending.": { en: "None pending.", ms: "Tiada yang menunggu." },
  "My open tasks": { en: "My open tasks", ms: "Tugasan terbuka saya" },
  "Nothing assigned.": { en: "Nothing assigned.", ms: "Tiada tugasan." },
  "News": { en: "News", ms: "Berita" },
  "No announcements.": { en: "No announcements.", ms: "Tiada pengumuman." },
  "Today's sales · LIVE": { en: "Today's sales · LIVE", ms: "Jualan hari ini · LANGSUNG" },
  "vs yesterday": { en: "vs yesterday", ms: "berbanding semalam" },
  "TikTok orders": { en: "TikTok orders", ms: "pesanan TikTok" },
  "Revenue": { en: "Revenue", ms: "Hasil" },
  "target": { en: "target", ms: "sasaran" },
  "auto-target": { en: "auto-target", ms: "sasaran auto" },
  "All-time — every channel": { en: "All-time — every channel", ms: "Keseluruhan — semua saluran" },
  "this month is your best yet 🏆": { en: "this month is your best yet 🏆", ms: "bulan ini terbaik setakat ini 🏆" },
  "vs best month": { en: "vs best month", ms: "berbanding bulan terbaik" },
  "months of business": { en: "months of business", ms: "bulan berniaga" },
  "Needs attention": { en: "Needs attention", ms: "Perlu perhatian" },
  "Nothing waiting on you": { en: "Nothing waiting on you", ms: "Tiada yang menunggu anda" },
  "Leave pending": { en: "Leave pending", ms: "Cuti menunggu" },
  "Claims pending": { en: "Claims pending", ms: "Tuntutan menunggu" },
  "OT pending": { en: "OT pending", ms: "OT menunggu" },
  "Low stock": { en: "Low stock", ms: "Stok rendah" },
  "Quotations open": { en: "Quotations open", ms: "Sebut harga terbuka" },
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

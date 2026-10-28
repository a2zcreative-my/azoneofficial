/**
 * BROWSER FIXTURES — the portal's every screen, populated.
 * v1.175.0: moved into the repository. It used to live only in the author's
 * sandbox, which is how three endpoints (`/staff/attendance/ot/pending`,
 * `/staff/clients/summary`, `/staff/attendance/report`) went un-fixtured for
 * two days: every card that reads them rendered EMPTY, so every width sweep
 * honestly reported nothing wrong. A probe is only as good as the rows its
 * fixture renders.
 *
 * TWO RULES WHEN YOU ADD TO THIS FILE:
 *   1. Every endpoint a card reads needs an entry, or that card is untested.
 *   2. The rows carry the company's REAL shape of data — long Malaysian
 *      names, RM amounts with thousands, a company name with a bracket —
 *      because that is what overflows and what gets shredded.
 *
 * `ROLE` (env, default "ceo") swaps the signed-in role, so the same build can
 * be walked as a CEO, a salesperson and an ordinary staff member — which is
 * what the role-aware dashboard (v1.175.0) has to be checked against.
 *
 * Used by tests/browser/serve.mjs. No dependencies: plain Node.
 */

const ROLE = process.env.ROLE ?? "ceo";

const items = [
  { id: 1, sku: "ELFIA001", name: "ELFIA Premium product", stock: 4, status: "low", unit_cost_cents: 2400, unit_price_cents: 4500, category: "elfia" },
  { id: 2, sku: "ELFIA002", name: "ELFIA Daily care", stock: 30, status: "in_stock", unit_cost_cents: 1200, unit_price_cents: 2400, category: "elfia" },
];
const queue = [{ id: "task:1", bucket: "tasks", title: "Check inventory delivery", sub: "Nur Aisyah", since: "2026-09-14 08:00:00", tab: "Tasks", overdue: true }];
function baseFixture(p) {
  let data = { records: [], tasks: [], leave: [], leaves: [], announcements: [], events: [], sessions: [], items: [], rows: [], findings: [], open: [], watchers: [], notifications: [], users: [], versions: {}, materials: [], returns: [], outs: [], birthdays: [], holidays: [], lines: [], buckets: [], staff: [], customers: [], docs: [], clients: [], hosts: [], cities: [], orders: [], rules: [], assets: [], hotels: [], states: [], by_state: {}, reports: [], claims: [], can_decide: true, expenses: [], accounts: [], rates: [], balances: {}, days: [], base: [], entries: [], banks: [], people: {}, overrides: {}, mine: { allow: [], deny: [] }, punches: [], requests: [], memberships: [], setup: [], summary: {}, counts: {}, total: 0, missing: [], targets: [], daily: [], products: [], skus: [], videos: [], lives: [], series: [], points: [], months: [] };
  const fallback = data;
  if (p === "/auth/me") data = { user: { id: 9001, name: "Fixture Person", role: ROLE, email: "fixture@example.test", status: "active" } };
  /* v1.203.0 - the overview's Sales Performance: the month by channel, and
     every revenue line by month (overall) - the bars include stokis and
     ELFIA web orders, so September's bar is higher than the month figure */
  if (p === "/staff/revenue") data = { month: "2026-09", last_month: "2026-08", tiktok: { this_cents: 125000, this_orders: 20, last_cents: 110000, last_orders: 18 }, invoiced: { this_cents: 200000, this_docs: 4, last_cents: 140000, last_docs: 3 },
    overall: { total_cents: 2_480_000, months: [["2025-12", 98000], ["2026-01", 121000], ["2026-02", 143000], ["2026-03", 187000], ["2026-04", 214000], ["2026-05", 196000], ["2026-06", 262000], ["2026-07", 301000], ["2026-08", 288000], ["2026-09", 352000]].map(([month, cents]) => ({ month, cents })) } };
  if (p === "/staff/tabs/access") data = { overrides: {}, mine: { allow: [], deny: [] }, people: {} };
  if (p === "/staff/desk") data = { items: queue, counts: { tasks: 1 }, total: 1, missing: [] };
  if (p === "/staff/overview") data = { inventory_status: [{ status: "in_stock", n: 1 }, { status: "low", n: 1 }],
    /* v1.200.0 - the company-wide task card, from the same rows as the board */
    task_summary: [{ status: "open", n: 3 }, { status: "in_progress", n: 2 }, { status: "completed", n: 2 }], task_overdue: 2, task_unacked: 2,
    task_by_staff: [{ name: "Fixture Person", role: "ceo", open_tasks: 2, done_tasks: 1 }, { name: "Nur Aisyah", role: "sales_marketing", open_tasks: 1, done_tasks: 1 }, { name: "Farid Zul", role: "live_host", open_tasks: 1, done_tasks: 0 }, { name: "Mei Ling", role: "hr_admin", open_tasks: 1, done_tasks: 0 }] };
  if (p === "/staff/inventory") data = { items };
  /* v1.193.0 - the Inventory Overview and Reports read these two */
  if (p === "/staff/inventory/manual-outs") data = { outs: [
    { id: 41, item_id: 2, sku: "ELFIA002", item_name: "ELFIA Daily care", qty: 12, unit_sale_cents: null, remark: "Restock from supplier — 12 cartons", created_at: D + "16 02:10:00", created_by_name: "Nur Aisyah", out_date: D + "16", reverted: 0, direction: "in", item_cost_cents: 1200 },
    { id: 40, item_id: 1, sku: "ELFIA001", item_name: "ELFIA Premium product", qty: 2, unit_sale_cents: null, remark: "Marketing / content shoot — coming back — Raya shoot", created_at: D + "12 06:00:00", created_by_name: "Farid Zul", out_date: D + "12", reverted: 0, direction: "out", item_cost_cents: 2400 },
    { id: 39, item_id: 1, sku: "ELFIA001", item_name: "ELFIA Premium product", qty: 1, unit_sale_cents: null, remark: "Damaged / defective — torn seam", created_at: D + "05 03:00:00", created_by_name: "Nur Aisyah", out_date: D + "05", reverted: 0, direction: "out", item_cost_cents: 2400 }] };
  if (p === "/staff/inventory/tiktok-out") data = { items: [
    { id: 2, sku: "ELFIA002", name: "ELFIA Daily care", stock: 30, today_qty: 3, month_qty: 41, total_qty: 180, last_at: D + "18 01:40:00", unit_price_cents: 2400, avg_sale_cents: 2150, month_value_cents: 88150 },
    { id: 1, sku: "ELFIA001", name: "ELFIA Premium product", stock: 4, today_qty: 0, month_qty: 9, total_qty: 66, last_at: D + "16 12:00:00", unit_price_cents: 4500, avg_sale_cents: 4290, month_value_cents: 38610 }] };
  if (p === "/staff/inventory/bridge-health") data = { key_configured: true, applied_24h: 0, unknown_24h: 0, unknown: [] };
  if (p === "/staff/fulfilment/summary") data = { month: "2026-09", by_status: { preparing: 1, shipped: 1, in_transit: 1, delivered: 2, returned: 1 }, oldest_preparing: { order_ref: "TT-586117208715331063", days: 5 }, orders: [] };
  if (p === "/staff/roster") data = { week_start: "2026-09-14", days: ["2026-09-14", "2026-09-15", "2026-09-16", "2026-09-17", "2026-09-18", "2026-09-19", "2026-09-20"], manager: true, sessions: [], on_leave: [], conflicts: [], requests: [], available_today: [], task_blocks: [], unscheduled: [], events: [] };
  if (p === "/staff/attendance/monitor") data = { date: "2026-09-16", staff: [] };
  if (p === "/staff/reports/outstanding") data = { invoices: [], total_cents: 0 };
  if (p === "/staff/payroll") data = { entries: [], release: { available_from: "2026-10-05 10:00:00", released: null, employer: "A2Z Creative Marketing" } };
  if (p === "/staff/hankeis") data = { can: { order_create: true, payment_verify: true, pack: true, settings: true }, counts: { awaiting_payment: 1, verified: 2 }, money: { verified_cents: 12000 }, open_exceptions: 0, outbox_pending: 0, recent: [{ id: 1, order_no: "HK-0001", total_cents: 6000, order_state: "open", payment_state: "awaiting_payment", fulfilment_state: "pending", created_at: "2026-09-20 10:00:00", customer_name: "Aina" }], setup: { qr_configured: true, recipient_configured: true, account_configured: true, ocr_available: false } };
  if (p === "/staff/hankeis/catalogue") data = { products: [], packages: [] };
  if (p === "/staff/hankeis/customers") data = { customers: [] };
  if (p === "/staff/sales-performance/overview") Object.assign(data, { me: 9001, can_manage: true, today: "2026-09-16", days: 1, tiktok_orders: [], range: { from: "2026-09-16", to: "2026-09-16", label: "today" } });
  return data === fallback ? undefined : data;
}





const D = "2026-09-";
const staff = [
  { id: 9001, name: "Fixture Person", full_name: "Fixture Person", role: "ceo", email: "fixture@example.test", status: "active", is_active: 1, department: "Management", position: "CEO", employee_id: "A2Z-001" },
  { id: 9002, name: "Nur Aisyah", full_name: "Nur Aisyah binti Rahman", role: "sales_marketing", email: "aisyah@example.test", status: "active", is_active: 1, department: "Sales", position: "Sales Executive", employee_id: "A2Z-002", reports_to: 9001, photo_key: "staff/9002-aisyah.jpg", phone: "+60 12-345 6789", joined_on: "2025-03-03", employment_status: "permanent", birthday: "1998-09-25", role_title: "Sales Executive — ELFIA accounts", responsibilities: "Answer every enquiry within 24 hours\nRaise quotations and invoices on the Sales tab\nLog every hotel call on the Hotels tab\nClose the day on Sales Performance", responsibilities_updated_at: "2026-09-15 10:12:00", responsibilities_updated_by_name: "Fixture Person" },
  { id: 9003, name: "Farid Zul", full_name: "Farid Zulkifli", role: "live_host", email: "farid@example.test", status: "active", is_active: 1, department: "Live", position: "Live Host", employee_id: "A2Z-003", reports_to: 9002 },
  { id: 9004, name: "Mei Ling", full_name: "Tan Mei Ling", role: "hr_admin", email: "mei@example.test", status: "active", is_active: 0, department: "HR", position: "HR Admin", employee_id: "A2Z-004", reports_to: 9001 },
];
const tasks = [
  { id: 1, title: "Check inventory delivery", description: "ELFIA restock arrives Tuesday.", priority: "high", deadline: D + "12", status: "open", progress: 20, assignee: "Nur Aisyah", assigned_to: 9002, created_by: 9001, created_at: D + "08 01:00:00", item_count: 3, item_done: 1, acknowledged: 1 },
  { id: 2, title: "Prepare Raya live rundown", priority: "normal", deadline: D + "25", status: "in_progress", progress: 60, assignee: "Farid Zul", assigned_to: 9003, created_by: 9001, created_at: D + "10 02:00:00", acknowledged: 0 },
  { id: 3, title: "Send September payslips", priority: "normal", deadline: D + "30", status: "open", progress: 0, assignee: "Mei Ling", assigned_to: 9004, created_by: 9004, created_at: D + "11 03:00:00", acknowledged: 1 },
  { id: 4, title: "Renew studio insurance", priority: "low", deadline: D + "02", status: "completed", progress: 100, assignee: "Fixture Person", assigned_to: 9001, created_by: 9001, created_at: D + "01 01:00:00", acknowledged: 1 },
  /* v1.200.0 - the signed-in person's own work, every state the Tasks tabs draw */
  { id: 5, title: "Approve the October content plan", description: "Three campaigns, two lives a week.\nCheck the budget line.", priority: "urgent", deadline: D + "15", status: "open", progress: 33, assignee: "Fixture Person", assigned_to: 9001, created_by: 9002, created_at: D + "13 04:00:00", item_count: 3, item_done: 1, acknowledged: 0 },
  { id: 6, title: "Sign the hotel partnership letter", priority: "normal", deadline: D + "22", status: "in_progress", progress: 50, assignee: "Fixture Person", assigned_to: 9001, created_by: 9001, created_at: D + "14 05:00:00", acknowledged: 1 },
  { id: 7, title: "Update product photos for catalogue", priority: "normal", deadline: D + "10", status: "completed", progress: 100, assignee: "Nur Aisyah", assigned_to: 9002, created_by: 9001, created_at: D + "05 06:00:00", item_count: 2, item_done: 2, acknowledged: 1 },
];
const announcements = [
  { id: 1, title: "Office closed on Malaysia Day", body: "16 September is a public holiday. Live sessions continue from home.", category: "general", created_at: D + "10 09:00:00", acked: 0 },
  { id: 2, title: "New claim form", body: "Use the Claims tab; paper forms are no longer accepted.", category: "hr", created_at: D + "03 09:00:00", acked: 1 },
  { id: 3, title: "Q3 town hall", body: "Friday 3pm at the studio.", category: "general", created_at: D + "01 09:00:00", acked: 1 },
];
const leave = [
  { id: 1, type: "annual", start_date: D + "22", end_date: D + "23", days: 2, status: "pending", stage: "hr", applicant_role: "sales_marketing", user_id: 9002, user_name: "Nur Aisyah", user_full: "Nur Aisyah binti Rahman", reason: "Family matters", created_at: D + "14 10:00:00" },
  { id: 2, type: "medical", start_date: D + "08", end_date: D + "08", days: 1, status: "approved", stage: "approved", applicant_role: "live_host", user_id: 9003, user_name: "Farid Zul", created_at: D + "08 08:00:00" },
  { id: 3, type: "annual", start_date: "2026-08-19", end_date: "2026-08-20", days: 2, status: "approved", stage: "approved", applicant_role: "ceo", user_id: 9001, user_name: "Fixture Person", created_at: "2026-08-10 09:00:00" },
];
const claims = [
  { id: 7, user_id: 9002, claim_date: D + "10", category: "travel", amount_cents: 4500, description: "Grab to client", status: "pending", claimant: "Nur Aisyah", claimant_full: "Nur Aisyah binti Rahman", items: "[]", claim_type: "reimbursement", created_at: D + "10 09:00:00" },
  { id: 8, user_id: 9003, claim_date: D + "04", category: "equipment", amount_cents: 18900, description: "Ring light", status: "approved", paid_at: D + "06 10:00:00", claimant: "Farid Zul", items: "[]", claim_type: "reimbursement", created_at: D + "04 09:00:00" },
  { id: 9, user_id: 9001, claim_date: D + "02", category: "meals", amount_cents: 6200, description: "Client lunch", status: "approved", claimant: "Fixture Person", items: "[]", claim_type: "reimbursement", created_at: D + "02 09:00:00" },
  { id: 10, user_id: 9002, claim_date: "2026-08-28", category: "travel", amount_cents: 3000, description: "Parking", status: "rejected", claimant: "Nur Aisyah", items: "[]", claim_type: "reimbursement", created_at: "2026-08-28 09:00:00" },
];
const enquiries = [
  { id: 1, name: "Aina Rahman", company: "Aina Boutique", phone: "0174761019", email: null, message: "Do you run TikTok lives for small fashion brands?", category: "live_commerce", status: "new", reply: null, replied_at: null, replied_name: null, assigned_to: null, assigned_name: null, created_at: D + "15 09:00:00", overdue: true, hours_waiting: 30 },
  { id: 2, name: "Hafiz Omar", company: null, phone: "0123456789", email: "hafiz@example.test", message: "Quotation for a product video, 3 SKUs.", category: "video", status: "new", reply: null, replied_at: null, replied_name: null, assigned_to: 9002, assigned_name: "Nur Aisyah", created_at: D + "16 08:00:00", overdue: false, hours_waiting: 2 },
  { id: 3, name: "Siti Zainab", company: "Zainab Kitchen", phone: null, email: "siti@example.test", message: "Website package pricing?", category: "web", status: "contacted", reply: "Sent the packages PDF.", replied_at: D + "12 11:00:00", replied_name: "Nur Aisyah", assigned_to: 9002, assigned_name: "Nur Aisyah", created_at: D + "11 09:00:00", overdue: false, hours_waiting: 26 },
];
const assets = [
  { id: 1, asset_tag: "A2Z-CAM-01", name: "Sony A7 IV", category: "studio", brand_model: "Sony ILCE-7M4", serial_no: "S123", purchase_date: "2025-03-01", purchase_price_cents: 1099900, vendor: "Shashinki", warranty_until: "2027-03-01", location: "Studio", assigned_to: 9003, assigned_name: "Farid Zul", status: "in_use", condition_note: null, created_at: "2025-03-02 09:00:00", updated_at: "2026-09-02 10:00:00" },
  { id: 2, asset_tag: "A2Z-LAP-02", name: "MacBook Air M3", category: "electronics", brand_model: "Apple", serial_no: "M456", purchase_date: "2025-06-10", purchase_price_cents: 549900, vendor: "Machines", warranty_until: "2026-10-10", location: "Office", assigned_to: 9002, assigned_name: "Nur Aisyah", status: "in_use", condition_note: null, created_at: "2025-06-11 09:00:00", updated_at: null },
  { id: 3, asset_tag: "A2Z-LGT-03", name: "Godox SL60", category: "studio", brand_model: "Godox", serial_no: null, purchase_date: "2024-01-15", purchase_price_cents: 45000, vendor: null, warranty_until: null, location: "Studio", assigned_to: null, assigned_name: null, status: "repair", condition_note: "Fan noise", created_at: "2024-01-16 09:00:00", updated_at: "2026-09-14 11:20:00" },
  { id: 4, asset_tag: "A2Z-TRP-04", name: "Manfrotto tripod", category: "studio", brand_model: null, serial_no: null, purchase_date: "2023-05-01", purchase_price_cents: 89000, vendor: null, warranty_until: null, location: "Store", assigned_to: null, assigned_name: null, status: "spare", condition_note: null, created_at: "2023-05-02 09:00:00", updated_at: null },
  /* v1.199.0 - enough rows for the Assets tabs: a page of the register, every status, three locations */
  { id: 5, asset_tag: "AZOA-005", name: "Monitor 27\"", category: "electronics", brand_model: "Dell P2723D", serial_no: "D27-118", purchase_date: "2025-08-04", purchase_price_cents: 89900, vendor: "Shopee", warranty_until: "2028-08-04", location: "Office", assigned_to: 9002, assigned_name: "Nur Aisyah", status: "in_use", condition_note: null, created_at: "2025-08-05 09:00:00", updated_at: null },
  { id: 6, asset_tag: "AZOA-006", name: "Office chair", category: "furniture", brand_model: "Ergohuman", serial_no: null, purchase_date: "2025-08-04", purchase_price_cents: 129000, vendor: null, warranty_until: null, location: "Office", assigned_to: 9004, assigned_name: "Mei Ling", status: "in_use", condition_note: null, created_at: "2025-08-05 09:05:00", updated_at: null },
  { id: 7, asset_tag: "AZOA-007", name: "Wireless mic set", category: "studio", brand_model: "Rode Wireless GO II", serial_no: "RW2-77", purchase_date: "2025-11-20", purchase_price_cents: 139900, vendor: "Shashinki", warranty_until: "2026-11-20", location: "Studio", assigned_to: null, assigned_name: null, status: "lost", condition_note: "Not returned after the Melaka shoot", created_at: "2025-11-21 09:00:00", updated_at: "2026-09-10 16:00:00" },
  { id: 8, asset_tag: "AZOA-008", name: "Printer", category: "electronics", brand_model: "Ricoh SP 230", serial_no: null, purchase_date: "2022-02-01", purchase_price_cents: 52000, vendor: null, warranty_until: null, location: "Office", assigned_to: null, assigned_name: null, status: "disposed", condition_note: "Drum failed, written off", created_at: "2022-02-02 09:00:00", updated_at: "2026-08-28 09:30:00" },
  { id: 9, asset_tag: "AZOA-009", name: "Ring light 18\"", category: "studio", brand_model: "Neewer", serial_no: null, purchase_date: "2026-01-05", purchase_price_cents: 26000, vendor: "Shopee", warranty_until: null, location: "Studio", assigned_to: 9003, assigned_name: "Farid Zul", status: "in_use", condition_note: null, created_at: "2026-01-06 09:00:00", updated_at: null },
  { id: 10, asset_tag: "AZOA-010", name: "Display rack", category: "furniture", brand_model: null, serial_no: null, purchase_date: null, purchase_price_cents: null, vendor: null, warranty_until: null, location: null, assigned_to: null, assigned_name: null, status: "spare", condition_note: null, created_at: "2026-09-15 09:00:00", updated_at: null },
  { id: 11, asset_tag: "AZOA-011", name: "Company car", category: "vehicle", brand_model: "Perodua Bezza", serial_no: "JXX 1234", purchase_date: "2024-07-01", purchase_price_cents: 4200000, vendor: null, warranty_until: "2027-07-01", location: "Office", assigned_to: 9001, assigned_name: "Fixture Person", status: "in_use", condition_note: null, created_at: "2024-07-02 09:00:00", updated_at: null },
];
/* v1.202.0 - fourteen made-up hotels across eight states, every outreach
   stage, two due for a call (a passed date, and a worked hotel quiet for
   more than ninety days), a published review, contacts on most. Test data
   only: the names are invented and never go near production. */
const hotels = [
  { id: 1, state: "MELAKA", hotel_name: "Casa del Rio", company: "Casa del Rio Sdn Bhd", address: "88 Jalan Kota Laksamana, 75200 Melaka", rooms: 66, stars: "*****", mof_validity: "31.12.2027", halal_validity: null, notes: null, contacts: [{ id: 11, person_name: "Puan Rina", phone: "012-345 6789", phone2: null, email: "sales@casa.example.test" }], stage: "agreed", last_contact_at: D + "10 03:00:00", next_at: D + "24", owner_id: 9002, review_url: null },
  { id: 2, state: "PULAU PINANG", hotel_name: "Eastern & Oriental", company: null, address: "10 Lebuh Farquhar, 10200 George Town", rooms: 100, stars: "*****", mof_validity: null, halal_validity: null, notes: null, contacts: [{ id: 21, person_name: "Mr Lim", phone: "04-222 2000", phone2: null, email: null }], stage: "published", last_contact_at: D + "01 03:00:00", next_at: null, owner_id: 9002, review_url: "https://example.test/eo" },
  { id: 3, state: "SELANGOR", hotel_name: "Sunway Resort", company: null, address: "Persiaran Lagoon, 47500 Subang Jaya", rooms: 477, stars: "*****", mof_validity: null, halal_validity: null, notes: null, contacts: [{ id: 31, person_name: "Cik Aida", phone: "03-7492 8000", phone2: null, email: null }], stage: "contacted", last_contact_at: D + "14 03:00:00", next_at: D + "16", owner_id: 9003, review_url: null },
  { id: 4, state: "KUALA LUMPUR", hotel_name: "Bukit Bintang Suites", company: "BB Hospitality Sdn Bhd", address: "12 Jalan Bukit Bintang, 55100 Kuala Lumpur", rooms: 210, stars: "****", mof_validity: null, halal_validity: "30.06.2027", notes: "Prefers WhatsApp in the afternoon.", contacts: [{ id: 41, person_name: "Encik Faiz", phone: "013-222 3344", phone2: "03-2141 0000", email: "faiz@bbsuites.example.test" }, { id: 42, person_name: "Ms Tan", phone: null, phone2: null, email: "frontdesk@bbsuites.example.test" }], stage: "lead", last_contact_at: null, next_at: null, owner_id: null, review_url: null },
  { id: 5, state: "KUALA LUMPUR", hotel_name: "Klang Valley Inn", company: null, address: "3 Jalan Ampang, 50450 Kuala Lumpur", rooms: 80, stars: "***", mof_validity: null, halal_validity: null, notes: null, contacts: [], stage: "lead", last_contact_at: null, next_at: null, owner_id: null, review_url: null },
  { id: 6, state: "KUALA LUMPUR", hotel_name: "Titiwangsa Lake Hotel", company: "Titiwangsa Hotels Bhd", address: "Jalan Temerloh, 53200 Kuala Lumpur", rooms: 150, stars: "****", mof_validity: null, halal_validity: null, notes: null, contacts: [{ id: 61, person_name: "Puan Salmah", phone: "019-555 1212", phone2: null, email: null }], stage: "reviewed", last_contact_at: D + "05 03:00:00", next_at: null, owner_id: 9002, review_url: null },
  { id: 7, state: "JOHOR", hotel_name: "Danga Bay Residence", company: null, address: "Jalan Skudai, 80200 Johor Bahru", rooms: 120, stars: "****", mof_validity: null, halal_validity: null, notes: null, contacts: [{ id: 71, person_name: "Encik Hakim", phone: "07-222 9000", phone2: null, email: null }], stage: "contacted", last_contact_at: "2026-05-02 03:00:00", next_at: null, owner_id: 9003, review_url: null },
  { id: 8, state: "JOHOR", hotel_name: "Desaru Shore Villas", company: "Desaru Coast Sdn Bhd", address: "Jalan Pantai 3, 81930 Bandar Penawar", rooms: 48, stars: "*****", mof_validity: null, halal_validity: null, notes: null, contacts: [], stage: "declined", last_contact_at: D + "02 03:00:00", next_at: null, owner_id: 9003, review_url: null },
  { id: 9, state: "JOHOR", hotel_name: "Puteri Harbour Hotel", company: null, address: "Persiaran Puteri Selatan, 79000 Nusajaya", rooms: 260, stars: "****", mof_validity: null, halal_validity: null, notes: null, contacts: [], stage: "lead", last_contact_at: null, next_at: null, owner_id: null, review_url: null },
  { id: 10, state: "PAHANG", hotel_name: "Cameron Highlands Lodge", company: null, address: "Jalan Besar, 39000 Tanah Rata", rooms: 40, stars: "***", mof_validity: null, halal_validity: null, notes: null, contacts: [{ id: 101, person_name: "Mr Raj", phone: "05-491 1000", phone2: null, email: null }], stage: "published", last_contact_at: D + "03 03:00:00", next_at: null, owner_id: 9002, review_url: "https://example.test/cameron" },
  { id: 11, state: "SABAH", hotel_name: "Kinabalu Bay Hotel", company: null, address: "Jalan Tun Fuad, 88400 Kota Kinabalu", rooms: 180, stars: "****", mof_validity: null, halal_validity: null, notes: null, contacts: [{ id: 111, person_name: "Cik Nora", phone: "088-123 456", phone2: null, email: null }], stage: "agreed", last_contact_at: D + "12 03:00:00", next_at: D + "30", owner_id: 9002, review_url: null },
  { id: 12, state: "SARAWAK", hotel_name: "Waterfront Kuching", company: null, address: "Jalan Tunku Abdul Rahman, 93100 Kuching", rooms: 300, stars: "****", mof_validity: null, halal_validity: null, notes: null, contacts: [], stage: "lead", last_contact_at: null, next_at: null, owner_id: null, review_url: null },
  { id: 13, state: "SELANGOR", hotel_name: "Shah Alam Convention Hotel", company: null, address: "Persiaran Perbandaran, 40000 Shah Alam", rooms: 220, stars: "****", mof_validity: null, halal_validity: null, notes: null, contacts: [{ id: 131, person_name: "Encik Zaki", phone: "03-5511 2000", phone2: null, email: null }], stage: "lead", last_contact_at: null, next_at: null, owner_id: null, review_url: null },
  { id: 14, state: "KEDAH", hotel_name: "Langkawi Cove Resort", company: null, address: "Jalan Pantai Tengah, 07000 Langkawi", rooms: 90, stars: "****", mof_validity: null, halal_validity: null, notes: null, contacts: [], stage: "lead", last_contact_at: null, next_at: null, owner_id: null, review_url: null },
];
const MY_STATES_FX = ["KUALA LUMPUR", "SELANGOR", "PUTRAJAYA", "NEGERI SEMBILAN", "JOHOR", "MELAKA", "KEDAH", "PERAK", "PERLIS", "TERENGGANU", "PULAU PINANG", "PAHANG", "KELANTAN", "SABAH", "SARAWAK"];
/* the worker's isDue (hotel-pipeline.ts), against the fixture's fixed today */
const hotelDue = (h) => (h.next_at && h.next_at.slice(0, 10) <= "2026-09-18")
  || ((h.stage === "contacted" || h.stage === "agreed") && h.last_contact_at && (Date.parse("2026-09-18T00:00:00Z") - Date.parse(h.last_contact_at.replace(" ", "T") + "Z")) / 86400000 > 90);
const webOrders = [
  { id: 1, store: "elfia", order_number: "ELF-1001", status: "paid", customer_name: "Aina Rahman", phone: "0174761019", address: "12 Jalan Bunga", subtotal_cents: 12000, shipping_cents: 800, total_cents: 12800, tracking_no: null, tracking_courier: null, tracking_url: null, placed_at: D + "18 10:00:00" },
  { id: 2, store: "elfia", order_number: "ELF-1002", status: "shipped", customer_name: "Farid Zul", phone: "0123456789", address: null, subtotal_cents: 4500, shipping_cents: 800, total_cents: 5300, tracking_no: "JT123", tracking_courier: "jnt", tracking_url: "https://example.test/t/JT123", placed_at: D + "17 09:00:00" },
  { id: 3, store: "elfia", order_number: "ELF-1003", status: "payment_review", customer_name: "Siti Zainab", phone: "0198765432", address: "5 Lorong Damai", subtotal_cents: 24000, shipping_cents: 0, total_cents: 24000, tracking_no: null, tracking_courier: null, tracking_url: null, placed_at: D + "19 14:00:00" },
];
const stokis = [
  { id: 1, name: "Kak Ros", company: "Ros Enterprise", phone: "0112223333", location: "Johor Bahru", status: "active", commission_pct: 10, total_cents: 890000, balance_cents: 45000, month_cents: 120000, commission_cents: 12000, joined_at: "2025-11-01" },
  { id: 2, name: "Abang Din", company: null, phone: "0134445555", location: "Kuantan", status: "active", commission_pct: 8, total_cents: 320000, balance_cents: 0, month_cents: 60000, commission_cents: 4800, joined_at: "2026-02-15" },
  { id: 3, name: "Puan Sarah", company: "Sarah Kosmetik", phone: null, location: "Ipoh", status: "inactive", commission_pct: 10, total_cents: 50000, balance_cents: 0, month_cents: 0, commission_cents: 0, joined_at: "2025-06-01" },
];
const content = [
  { id: 1, title: "Raya haul live", kind: "live", platform: "tiktok", stage: "script", scheduled_date: D + "25", assigned_to: 9003, assigned_name: "Farid Zul", created_at: D + "10 09:00:00" },
  { id: 2, title: "ELFIA serum reel", kind: "reel", platform: "instagram", stage: "edit", scheduled_date: D + "20", assigned_to: 9002, assigned_name: "Nur Aisyah", created_at: D + "08 09:00:00" },
  { id: 3, title: "Hotel review - Casa del Rio", kind: "video", platform: "tiktok", stage: "posted", posted_at: D + "05 18:00:00", assigned_to: 9002, assigned_name: "Nur Aisyah", created_at: D + "01 09:00:00" },
  { id: 4, title: "Merdeka campaign recap", kind: "campaign", platform: "facebook", stage: "idea", created_at: D + "15 09:00:00" },
];
const commission = [
  { id: 1, host_id: 9003, host_name: "Farid Zul", period: "2026-09", basis_cents: 1250000, amount_cents: 62500, status: "pending", note: "" },
  { id: 2, host_id: 9003, host_name: "Farid Zul", period: "2026-08", basis_cents: 1100000, amount_cents: 55000, status: "approved", note: "" },
  { id: 3, host_id: 9002, host_name: "Nur Aisyah", period: "2026-08", basis_cents: 400000, amount_cents: 20000, status: "paid", note: "" },
];
const cash = [
  { id: 1, entry_date: D + "05", type: "in", category: "sales", bank_id: 1, bank_name: "Maybank", amount_cents: 200000, description: "INV-0912 paid", ref: "INV-0912" },
  { id: 2, entry_date: D + "06", type: "out", category: "payroll", bank_id: 1, bank_name: "Maybank", amount_cents: 1450000, description: "August payroll", ref: "PAY-2026-08" },
  { id: 3, entry_date: D + "12", type: "out", category: "software", bank_id: 1, bank_name: "Maybank", amount_cents: 12900, description: "Adobe", ref: "" },
];
const expenses = [
  { id: 1, expense_date: D + "12", category: "software", amount_cents: 12900, vendor: "Adobe", description: "Creative Cloud", paid_at: D + "12 10:00:00" },
  { id: 2, expense_date: D + "15", category: "rent", amount_cents: 350000, vendor: "Landlord", description: "Studio rent", due_day: 20, paid_at: null },
  { id: 3, expense_date: D + "03", category: "ads", amount_cents: 80000, vendor: "TikTok Ads", description: "Boost", paid_at: D + "03 10:00:00" },
];
const docs = [
  /* v1.181.11 - revised once at the customer's request */
  { id: 1, doc_type: "QT", doc_number: "QT-AZO150926-1", company: "Aina Boutique", total_cents: 450000, payment_status: null, delivery_status: null, created_at: D + "15 10:00:00", salesperson_name: "Nur Aisyah", kind: "service", revision: 1, revised_at: D + "18 11:20:00", salesperson_id: 9002 },
  { id: 2, doc_type: "INV", doc_number: "INV-AZO100926-2", company: "Zainab Kitchen", total_cents: 280000, payment_status: "paid", delivery_status: null, created_at: D + "10 10:00:00", paid_at: D + "12 10:00:00", salesperson_name: "Nur Aisyah", salesperson_id: 9002 },
  { id: 3, doc_type: "INV", doc_number: "INV-AZO050926-3", company: "Casa del Rio Sdn Bhd", total_cents: 990000, payment_status: "unpaid", delivery_status: null, created_at: D + "05 10:00:00", salesperson_name: "Fixture Person", salesperson_id: 9001 },
  { id: 4, doc_type: "INV", doc_number: "INV-AZO200826-4", company: "Hafiz Trading", total_cents: 120000, payment_status: "unpaid", delivery_status: null, created_at: "2026-08-20 10:00:00", salesperson_name: "Nur Aisyah", salesperson_id: 9002 },
];
const customers = [
  { id: 1, company: "Aina Boutique", contact: "Aina Rahman", phone: "0174761019", email: null, address: "12 Jalan Bunga, Melaka" },
  { id: 2, company: "Zainab Kitchen", contact: "Siti Zainab", phone: "0198765432", email: "siti@example.test", address: "5 Lorong Damai, Shah Alam" },
];
const accounts = [
  { id: 1, code: "1000", name: "Maybank current", type: "asset", debit_cents: 2500000, credit_cents: 0 },
  { id: 2, code: "4000", name: "Sales", type: "income", debit_cents: 0, credit_cents: 2000000 },
  { id: 3, code: "5000", name: "Payroll", type: "expense", debit_cents: 1450000, credit_cents: 0 },
  { id: 4, code: "3000", name: "Capital", type: "equity", debit_cents: 0, credit_cents: 1950000 },
];

export function fixture(p0, url, { onMissing = () => {} } = {}) {
  let data = baseFixture(p0);
  const q = url ? new URL(url).searchParams : new URLSearchParams();
  /* the panels' own prefixes: makeApi("/staff"), makeApi("/staff/erp"), makeApi("/staff/companies") */
  const p = p0.replace(/^\/staff\/erp(?=\/)/, "").replace(/^\/staff(?=\/(?:claims|stokis|content|task-reports|birthdays|expenses|hosts|banks|commission|cashflow|gl)\b)/, "");
  /* v1.182.0 - THE DASHBOARD'S OWN ENDPOINTS. The 12-10 review made a
     missing fixture an empty object, which is right (an empty card is an
     honest sweep), but the Dashboard had never been given its rows and its
     Events card threw on `undefined.filter`. These are the shapes the worker
     sends, with the company's own kind of data: a month of punches for the
     signed-in person, the day verdicts, today's shift, who is in, the
     notifications, the events and the live sessions. */
  /* v1.198.0 - THE PAYROLL RUN, populated, so the five Payroll tabs and the
     calculation regression (scratch payroll capture) have every case on the
     screen: a full-month salary, approved OT that differs from the saved
     box, half a day of unpaid leave, a mid-month joiner (incomplete month)
     with a public holiday worked and a salary advance, a part-time live host
     paid by the hour, and a no-clock-in list with a pending leave day. */
  /* v1.207.0 - an earlier month, saved and released, for the history (invented) */
  if (p === "/staff/payroll" && (q.get("month") ?? "") === "2026-08") {
    data = { entries: [
      { user_id: 9001, basic_cents: 400000, commission_cents: 0, allowance_cents: 0, deduction_cents: 0, ot_hours: null, note: null, net_cents: 400000 },
      { user_id: 9002, basic_cents: 210000, commission_cents: 0, allowance_cents: 15000, deduction_cents: 0, ot_hours: null, note: null, net_cents: 221500 },
    ], release: { available_from: "2026-09-05 10:00:00", released: { released_at: "2026-09-05 02:00:00", issuer_code: "a2z" }, employer: "A2Z Creative Marketing" } };
  }
  if (p === "/staff/payroll" && (q.get("month") ?? "") === "2026-09") {
    data = { entries: [
      { user_id: 9001, basic_cents: 400000, commission_cents: 0, allowance_cents: 0, deduction_cents: 0, worked_days: 20, month_working_days: 22, ot_hours: null, note: null, net_cents: 400000 },
      { user_id: 9002, basic_cents: 210000, commission_cents: 0, allowance_cents: 15000, deduction_cents: 0, worked_days: 19, month_working_days: 22, ot_hours: 2, note: null },
      { user_id: 9003, basic_cents: 0, commission_cents: 0, allowance_cents: 5000, deduction_cents: 0, ot_hours: null, hourly_minutes: 3600, hourly_rate_cents: 1500, hourly_minutes_live: 3600, hourly_rate_live: 1500, net_cents: 95000, hourly_pay_live: 90000, hourly_clocked_live: 3900, hourly_break_live: 300, hourly_days_live: 5 },
    ], release: { available_from: "2026-10-05 10:00:00", released: null, employer: "A2Z Creative Marketing" } };
  }
  if (p === "/staff/payroll/attendance-days" && (q.get("month") ?? "") === "2026-09") {
    data = {
      days: [{ user_id: 9001, days: 20 }, { user_id: 9002, days: 19 }, { user_id: 9004, days: 14 }],
      working_days: 22,
      unpaid: [{ user_id: 9002, days: 0.5 }],
      unpaid_detail: [
        { user_id: 9002, days: 0.5, rest_days: 0, cents: 3500, capped: false, clocked_beyond_employment: false, clocked_days: 19, payable_days: 22, ph_worked: 0, ph_worked_dates: [], ph_worked_cents: 0, salary_advance_cents: 0 },
        { user_id: 9004, days: 0, rest_days: 0, cents: 0, capped: false, clocked_beyond_employment: false, clocked_days: 14, payable_days: 15, ph_worked: 1, ph_worked_dates: ["2026-09-16"], ph_worked_cents: 15385, salary_advance_cents: 10000 },
      ],
      ot_approved: [{ user_id: 9002, minutes: 150, days: 2 }],
      employed: [{ user_id: 9004, payable_days: 15, proration_days: 20 }],
      proration: { basis: "calendar", month_days: 30, unpaid_divisor: 30 },
    };
  }
  if (p === "/staff/payroll/base") data = { base: [{ user_id: 9001, base_salary_cents: 400000 }, { user_id: 9002, base_salary_cents: 210000 }, { user_id: 9004, base_salary_cents: 200000 }] };
  if (p === "/staff/payroll/absences" && (q.get("month") ?? "") === "2026-09") {
    data = { staff: [{ user_id: 9002, name: "Nur Aisyah", missing: ["2026-09-08"], short: [{ d: "2026-09-10", hours: 5.5, of: 7, break_minutes: 60 }], pending: [{ d: "2026-09-11", type: "annual" }], partial_review: [] }] };
  }
  if (p === "/staff/payroll/m2e-settings") data = { corporate_id: "MY0000000", payer_account: "", client_batch_id: "", has_template: false };
  if (p === "/staff/payroll/detail") data = { extras: null };
  if (p === "/staff/attendance") {
    const month = q.get("month") ?? "2026-09";
    const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
    const recs = []; const days = [];
    for (let d = 1; d <= 30; d++) {
      const iso = `${month}-${String(d).padStart(2, "0")}`;
      if (iso > today) break;
      const dow = new Date(`${iso}T00:00:00Z`).getUTCDay();
      if (dow === 0) { days.push({ date: iso, status: "rest_day", in: null, out: null, open: false, scheduled: false, worked: false }); continue; }
      if (d === 8) { days.push({ date: iso, status: "leave", in: null, out: null, open: false, scheduled: true, worked: false }); continue; }
      const late = d % 7 === 3; const half = d === 12;
      const inT = late ? "09:41" : "08:5" + (d % 10); const outT = half ? "13:02" : iso === today ? null : "18:1" + (d % 10);
      recs.push({ type: "clock_in", created_at: `${iso} ${String(Number(inT.slice(0, 2)) - 8).padStart(2, "0")}:${inT.slice(3)}:00` });
      if (outT) recs.push({ type: "clock_out", created_at: `${iso} ${String(Number(outT.slice(0, 2)) - 8).padStart(2, "0")}:${outT.slice(3)}:00` });
      days.push({ date: iso, status: iso === today ? "pending" : half ? "half_day" : late ? "late" : "ok", in: inT, out: outT, open: iso === today, scheduled: true, worked: true });
    }
    data = { as_of: today, records: recs, ot: [], ot_eligible: true, days,
      today_shift: { entry: { clocked_in: true, open_since: "2026-10-20 00:56:00", clock_out_at: null, launch_shift: false, leave_review: false, work_label: "Office" }, kind: "office", label: "Office day",
        windows: [{ start: "09:00", end: "18:00" }], slots: [{ start: "09:00", end: "18:00", what: "Office", claimed: true }], slots_label: "Today", can_clock_in: false, why_not: null, can_ot: false } };
  }
  if (p === "/staff/attendance/monitor") data = { date: D + "16", geofence: { lat: 1.56, lng: 103.72, radius_m: 150, label: "Setia Tropika office" },
    /* v1.191.0 - stored as the worker stores them: UTC "YYYY-MM-DD HH:MM:SS"
       (08:10 MYT is 00:10 UTC), a GPS fix, and one person already gone home */
    staff: staff.slice(0, 8).map((x, i) => ({ id: x.id, name: x.full_name ?? x.name, role: x.role,
      in_at: i < 6 ? `${D}16 0${i % 2}:${String(10 + i * 7).padStart(2, "0")}:00` : null,
      out_at: i === 1 ? `${D}16 09:31:00` : null, last_type: i < 6 ? (i === 1 ? "clock_out" : "clock_in") : null, shifts: i < 6 ? 1 : 0,
      in_gps: i < 6 ? (i === 3 ? "1.5712,103.7601,25" : "1.5601,103.7201,12") : null })) };
  /* v1.185.0 - the Ecommerce page: the TikTok connection, the orders the
     sync stored, and the buyer cities behind the map and the top states */
  if (p === "/integrations/tiktok/status") data = { configured: true, authorized: true, last_event_at: "2026-10-08 10:24:00", last_event_verified: true };
  if (p === "/staff/postage") data = { records: [
    { id: 501, order_ref: "TT-586296403794167044", status: "delivered", created_at: "2026-10-04 04:55:00", items_label: "1× ELFIA Premium product", courier: "jnt", tracking_no: "JT6401234567", buyer_city: "Johor Bahru", order_amount_cents: 3970 },
    { id: 502, order_ref: "TT-586387023799551479", status: "delivered", created_at: "2026-10-04 04:55:00", items_label: "1× ELFIA Daily care", courier: "jnt", tracking_no: "JT6401234568", buyer_city: "Skudai", order_amount_cents: 3970 },
    { id: 503, order_ref: "TT-586117409959413239", status: "shipped", created_at: "2026-09-17 11:30:00", items_label: "1× ELFIA Daily care", courier: "poslaju", tracking_no: "EM123456789MY", buyer_city: "Melaka", order_amount_cents: 2550 },
    { id: 504, order_ref: "TT-586117208715331063", status: "preparing", created_at: "2026-09-17 10:53:00", items_label: "1× ELFIA Premium product", courier: null, tracking_no: null, buyer_city: "Alor Gajah", order_amount_cents: 2550, note: "Buyer asked for gift wrap" },
    { id: 505, order_ref: "TT-586094180474719255", status: "in_transit", created_at: "2026-09-16 02:41:00", items_label: "2× ELFIA Premium product", courier: "jnt", tracking_no: "JT6401234570", buyer_city: "Kuantan", order_amount_cents: 7900 },
    { id: 506, order_ref: "TT-586090000000000001", status: "returned", created_at: "2026-09-12 06:10:00", items_label: "1× ELFIA Daily care", courier: "jnt", tracking_no: "JT6401234571", buyer_city: "Kuala Terengganu", order_amount_cents: 3970 },
  ] };
  /* v1.212.0 - the paged TikTok read (GET /staff/postage?source=tiktok):
     one page, the count per status for the same search, and the orders that
     moved no stock (one more fixture order, 507, carries none) */
  if (p === "/staff/postage" && q.get("source") === "tiktok") {
    const all = [...data.records.map((r) => ({ ...r, note: r.note ?? (r.id % 2 ? "TikTok order (auto)" : "TikTok order (synced)"), line_count: 1, updated_at: r.created_at })),
      { id: 507, order_ref: "TT-586400000000000007", status: "preparing", created_at: "2026-10-05 08:00:00", updated_at: "2026-10-05 08:00:00", items_label: null, line_count: 0, courier: "TikTok", tracking_no: null, buyer_city: "Ipoh", order_amount_cents: 4500, note: "TikTok order (synced) · not in inventory: SKU ELFIA-X9" }];
    const term = (q.get("q") ?? "").toLowerCase();
    const st = q.get("status") ?? "";
    const per = Math.min(50, Math.max(5, Number(q.get("per")) || 20));
    const page = Math.max(1, Number(q.get("page")) || 1);
    const noMove = (r) => r.status !== "returned" && r.line_count === 0;
    const found = all.filter((r) => !term || `${r.order_ref} ${r.tracking_no ?? ""} ${r.courier ?? ""} ${r.buyer_city ?? ""} ${r.items_label ?? ""}`.toLowerCase().includes(term))
      .filter((r) => q.get("stock") !== "none" || noMove(r));
    const counts = { all: found.length, no_stock: all.filter(noMove).length };
    for (const k of ["preparing", "shipped", "in_transit", "delivered", "returned"]) counts[k] = found.filter((r) => r.status === k).length;
    const rows = (st ? found.filter((r) => r.status === st) : found).sort((x, y) => y.created_at.localeCompare(x.created_at));
    data = { records: rows.slice((page - 1) * per, page * per), total: rows.length, page, per, counts };
  }
  if (p === "/staff/orders/geo") data = { cities: [
    { city: "Johor Bahru", orders: 30, cents: 80000 }, { city: "Skudai", orders: 16, cents: 43200 },
    { city: "Kuala Terengganu", orders: 2, cents: 3970 }, { city: "Melaka", orders: 2, cents: 2550 }, { city: "Kuantan", orders: 1, cents: 936 },
  ] };
  /* v1.184.0 - the Dashboard's Leave Application card */
  if (p === "/staff/leave/month") data = { month: D.slice(0, 7), leave: [
    { id: 12, user_id: staff[1]?.id ?? 2, name: staff[1]?.full_name ?? staff[1]?.name ?? "NUR NASUHA BINTI ZAINAL ABIDIN", photo_key: null, position: "Account Executive", type: "annual", start_date: D + "24", end_date: D + "26", days: 3, day_part: null, status: "pending", reason: "Dental surgery", created_at: D + "16 09:02:00" },
    { id: 13, user_id: staff[2]?.id ?? 3, name: staff[2]?.full_name ?? staff[2]?.name ?? "Jonathan Ibrahim", photo_key: null, position: "Designer", type: "annual", start_date: D + "06", end_date: D + "06", days: 1, day_part: null, status: "approved", reason: "Personal leave", created_at: D + "01 10:00:00" },
    { id: 14, user_id: staff[3]?.id ?? 4, name: staff[3]?.full_name ?? staff[3]?.name ?? "Thomas Goodman", photo_key: null, position: "Live host", type: "emergency", start_date: D + "09", end_date: D + "09", days: 1, day_part: null, status: "approved", reason: "Family emergency", created_at: D + "09 07:30:00" },
    { id: 15, user_id: staff[4]?.id ?? 5, name: staff[4]?.full_name ?? staff[4]?.name ?? "Maisha Fonzales", photo_key: null, position: "Marketing", type: "medical", start_date: D + "14", end_date: D + "15", days: 2, day_part: null, status: "rejected", reason: null, created_at: D + "13 18:00:00" },
  ] };
  if (p === "/staff/attendance/geofence") data = { configured: true, radius_m: 150, label: "Setia Tropika office", lat: 1.56, lng: 103.72 };
  if (p === "/staff/notifications") data = { notifications: [
    { id: 1, kind: "leave", message: "Nur Aisyah binti Rahman applied for annual leave, 22-09 to 23-09", is_read: 0, created_at: D + "16 01:02:00", ref: "leave:1" },
    { id: 4, kind: "task", message: "⏰ OVERDUE: Check inventory delivery — was due 2026-09-12", is_read: 0, created_at: D + "17 23:00:00", ref: "task:1:od:2026-09-18" },
    { id: 5, kind: "stock", message: "ELFIA Premium product is low on stock (4 left)", is_read: 1, created_at: D + "15 03:00:00", ref: "stock:1" },
    { id: 2, kind: "claim", message: "Claim #8 (RM 1,240.00) is waiting for your decision", is_read: 0, created_at: D + "13 06:40:00", ref: "claim:8" },
    { id: 3, kind: "news", message: "Raya 2027 live schedule published", is_read: 1, created_at: D + "10 02:00:00", ref: "announcement:3" }] };
  if (p === "/staff/events") data = { staff: staff.map((x) => ({ id: x.id, name: x.name })), events: [
    { id: 1, title: "Management meeting", category: "meeting", event_date: D + "22", start_time: "18:00", end_time: "19:00", location: "Office", details: "Q4 targets and the Raya live calendar", created_by_name: "Fixture Person", attendees: [] },
    { id: 2, title: "ELFIA Raya shoot", category: "shoot", event_date: D + "25", start_time: "09:30", end_time: "15:00", location: "Studio, Setia Tropika", details: null, created_by_name: "Nur Aisyah", attendees: [{ id: 9003, name: "Farid Zul" }] },
    { id: 3, title: "Annual report briefing", category: "company", event_date: "2026-10-02", start_time: "10:00", end_time: null, location: "Zoom", details: null, created_by_name: "Fixture Person", attendees: [] }] };
  if (p === "/staff/holidays") data = { holidays: [{ id: 1, holiday_date: "2026-09-16", name: "Malaysia Day", kind: "public" }, { id: 2, holiday_date: "2026-11-08", name: "Deepavali", kind: "public" }, { id: 3, holiday_date: "2026-11-09", name: "Deepavali (replacement)", kind: "replacement" }] }; // v1.192.0 - the route's own column name
  if (p === "/staff/payslip") data = { month: "2026-08", staff: { name: "Nur Aisyah", email: "aisyah@example.test", employee_id: "A2Z-002", position: "Sales Executive", department: "Sales" },
    attendance: { days_present: 21, on_time: 18, late: 3, half_days: 0, early_outs: 1 }, approved_leave_days: 1 }; // v1.192.0
  if (p === "/staff/leave/calendar") data = { leave: [{ user_id: 9002, name: "Nur Aisyah", start_date: D + "22", end_date: D + "23" }] };
  if (p === "/staff/live-sessions") data = { sessions: [
    /* v1.203.0 - two still to come, for the overview's Live Sessions card */
    { id: 3, session_date: D + "18", start_time: "20:00", end_time: "22:00", host_user_id: 9003, host_name: "Farid Zul", client_id: 1, client_name: "Aina Boutique", status: "scheduled", platform: "tiktok", notes: "Weekend bundle" },
    { id: 4, session_date: D + "21", start_time: "15:00", end_time: "17:00", host_user_id: 9002, host_name: "Nur Aisyah", client_id: 2, client_name: "Zainab Kitchen", status: "scheduled", platform: "shopee", notes: null },
    { id: 1, session_date: D + "16", start_time: "14:00", end_time: "16:00", host_user_id: 9003, host_name: "Farid Zul", client_id: 1, client_name: "Aina Boutique", status: "scheduled", platform: "tiktok", notes: "Raya edit" },
    { id: 2, session_date: D + "17", start_time: "20:00", end_time: "22:00", host_user_id: 9002, host_name: "Nur Aisyah", client_id: 2, client_name: "Zainab Kitchen", status: "scheduled", platform: "tiktok", notes: null }] };
  if (p === "/staff/revenue/lines") data = { lines: [
    { key: "tiktok", label: "TikTok Shop", total_cents: 125000, months: [{ month: "2026-07", cents: 90000 }, { month: "2026-08", cents: 110000 }, { month: "2026-09", cents: 125000 }] },
    { key: "invoiced", label: "Invoiced", total_cents: 200000, months: [{ month: "2026-07", cents: 160000 }, { month: "2026-08", cents: 140000 }, { month: "2026-09", cents: 200000 }] }] };
  if (p === "/staff/sales/by-hour") data = { buckets: Array.from({ length: 24 }, (_, h) => ({ hour: h, cents: h >= 10 && h <= 22 ? 1500 + ((h * 37) % 9000) : 0, orders: h >= 10 && h <= 22 ? 1 + (h % 4) : 0 })) };
  if (p === "/birthdays-lite") data = { birthdays: [{ id: 9002, name: "Nur Aisyah", birthday: "1997-09-28" }, { id: 9003, name: "Farid Zul", birthday: "1995-10-04" }] };
  /* v1.200.0 - as the worker answers: everything with ?all=1 (managers), otherwise the caller's own */
  if (p === "/staff/tasks") data = { tasks: q.get("all") === "1" ? tasks : tasks.filter((t) => t.assigned_to === 9001) };
  /* v1.205.0 - /staff/search over this fixture's own invented records (the
     worker's shape: kind, id, title, sub, tab, status, date, photo), `per`
     and `only` honoured. Gates are the worker's job and its guard's
     (tests/global-search.mjs runs the real handler); every source here. */
  if (p === "/staff/search") {
    const needle = (q.get("q") ?? "").trim().toLowerCase();
    const per = Math.min(25, Number(q.get("per")) || 6);
    const only = (q.get("only") ?? "").split(",").filter(Boolean);
    const has = (...xs) => xs.some((x) => String(x ?? "").toLowerCase().includes(needle));
    const nm = (id) => { const u = staff.find((x) => x.id === id); return u ? (u.full_name || u.name) : ""; };
    const src = {
      staff: staff.filter((u) => has(u.name, u.full_name, u.position, u.department)).map((u) => ({ kind: "staff", id: u.id, title: u.full_name || u.name, sub: [u.position, u.department, u.employee_id].filter(Boolean).join(" · "), tab: "Staff Details", status: "active", photo: u.photo_key ?? null })),
      task: tasks.filter((t) => has(t.title, t.description)).map((t) => ({ kind: "task", id: t.id, title: t.title, sub: t.assignee, tab: "Tasks", status: t.status, date: t.deadline, dateIs: "due" })),
      leave: leave.filter((l) => has(l.user_name, l.user_full, l.type)).map((l) => ({ kind: "leave", id: l.id, title: l.type, sub: `${l.user_full || l.user_name} · ${l.start_date}${l.end_date !== l.start_date ? ` – ${l.end_date}` : ""}`, tab: "Leave", status: l.status, date: l.created_at, dateIs: "applied" })),
      claim: claims.filter((c) => has(c.claimant, c.claimant_full, c.description, c.category)).map((c) => ({ kind: "claim", id: c.id, title: c.category, sub: `${c.claimant_full || c.claimant} · ${c.claim_date}`, tab: "Claims", status: c.paid_at ? "paid" : c.status, date: c.created_at, dateIs: "created" })),
      hotel: hotels.filter((h) => has(h.hotel_name, h.company, h.address)).map((h) => ({ kind: "hotel", id: h.id, title: h.hotel_name, sub: `${h.company ? `${h.company} · ` : ""}${h.state}`, tab: "Hotels", status: h.stage ?? "lead", date: h.updated_at ?? null, dateIs: "updated" })),
      contact: hotels.flatMap((h) => (h.contacts ?? []).filter((c) => has(c.person_name)).map((c) => ({ kind: "contact", id: h.id, title: c.person_name, sub: `${h.hotel_name}${c.phone ? ` · ${c.phone}` : ""}`, tab: "Hotels", status: h.stage ?? "lead" }))),
      client: customers.filter((c) => has(c.company, c.contact)).map((c) => ({ kind: "client", id: c.id, title: c.company, sub: [c.contact, c.phone].filter(Boolean).join(" · "), tab: "Sales" })),
      invoice: docs.filter((d) => d.doc_type === "INV" && has(d.doc_number, d.company)).map((d) => ({ kind: "invoice", id: d.id, title: `${d.doc_type} ${d.doc_number}`, sub: `${d.company} · RM ${(d.total_cents / 100).toFixed(2)}`, tab: "Sales", status: d.payment_status, date: d.created_at, dateIs: "created" })),
      document: docs.filter((d) => d.doc_type !== "INV" && has(d.doc_number, d.company)).map((d) => ({ kind: "document", id: d.id, title: `${d.doc_type} ${d.doc_number}`, sub: `${d.company} · RM ${(d.total_cents / 100).toFixed(2)}`, tab: "Sales", status: null, date: d.created_at, dateIs: "created" })),
      asset: assets.filter((a) => has(a.asset_tag, a.name, a.brand_model)).map((a) => ({ kind: "asset", id: a.id, title: `${a.asset_tag} — ${a.name}`, sub: [a.brand_model, a.location].filter(Boolean).join(" · "), tab: "Assets", status: a.status, date: a.updated_at, dateIs: "updated" })),
      stock: items.filter((i) => has(i.sku, i.name)).map((i) => ({ kind: "stock", id: i.id, title: i.name, sub: `${i.sku} · ${i.stock} in stock`, tab: "Inventory", status: i.status === "low" ? "low" : "in_stock" })),
    };
    void nm;
    const sources = Object.keys(src).filter((k) => only.length === 0 || only.includes(k));
    data = needle.length < 2 ? { hits: [], q: needle } : { hits: sources.flatMap((k) => src[k].slice(0, per)), q: needle, sources: Object.keys(src) };
  }
  /* v1.200.0 - a task's scope checklist, with who ticked what */
  if (/^\/staff\/tasks\/\d+\/items$/.test(p)) {
    const id = Number(p.split("/")[3]);
    data = { items: id === 5 ? [
      { id: 51, title: "Read the three campaign briefs", done: 1, done_at: D + "14 03:00:00", done_by_name: "Fixture Person" },
      { id: 52, title: "Check the budget line", done: 0 },
      { id: 53, title: "Reply to Nur Aisyah", done: 0 },
    ] : id === 1 ? [
      { id: 11, title: "Count the cartons", done: 1, done_at: D + "12 02:00:00", done_by_name: "Nur Aisyah" },
      { id: 12, title: "Check the batch numbers", done: 0 },
      { id: 13, title: "Update stock in Inventory", done: 0 },
    ] : [] };
  }
  if (p === "/staff/staff-list" || p === "/staff-list") data = { staff: staff.map((s) => ({ id: s.id, name: s.name, role: s.role })) };
  /* v1.189.0 - the Users tabs: two with 2FA, one leaver still active, a few
     Google sign-ups as customers, and a sign-in log with a 2FA change in it */
  if (p === "/staff/users") {
    const us = [
      ...staff.map((x, i) => ({ ...x, totp_enabled: i < 2 ? 1 : 0, ...(x.id === 9003 ? { left_on: "2026-10-01", employment_status: "part_time" } : {}) })),
      { id: 9101, name: "Narida", full_name: "Narida Binti Aziz", role: "customer", email: "narida@example.test", is_active: 1 },
      { id: 9102, name: "Kamal", full_name: null, role: "customer", email: "kamal.hashim@example.test", is_active: 1 },
      { id: 9103, name: "Siti", full_name: "Siti Nurhaliza", role: "customer", email: "siti@example.test", is_active: 0 },
    ];
    data = { users: us, staff: us };
  }
  /* v1.201.0 - one staff vault for the Staff Records tab: a contract on
     file and two of the six joining steps ticked */
  if (/^\/staff\/users\/\d+\/documents$/.test(p)) data = p.includes("/9002/") ? {
    documents: [{ id: 71, kind: "contract", label: null, filename: "Employment-contract.pdf", size: 182000, created_at: "2025-03-03 02:00:00", uploaded_by_name: "Fixture Person" }],
    onboarding: { offer_letter: true, contract: true },
  } : { documents: [], onboarding: {} };
  if (p === "/staff/users/activity") data = { events: [
    { action: "auth.login_2fa", created_at: "2026-10-22 02:19:00", name: "Fixture Person", email: "fixture@example.test" },
    { action: "auth.login", created_at: "2026-10-22 01:44:00", name: "Nur Aisyah binti Rahman", email: "aisyah@example.test" },
    { action: "auth.login_google", created_at: "2026-10-21 10:36:00", name: "Narida Binti Aziz", email: "narida@example.test" },
    { action: "auth.2fa_disabled", created_at: "2026-10-21 09:14:00", name: "Farid Zulkifli", email: "farid@example.test" },
    { action: "auth.login", created_at: "2026-10-21 09:12:00", name: "Farid Zulkifli", email: "farid@example.test" },
    { action: "auth.2fa_backup_used", created_at: "2026-10-20 03:02:00", name: "Tan Mei Ling", email: "mei@example.test" },
    { action: "auth.2fa_enabled", created_at: "2026-10-19 08:00:00", name: "Fixture Person", email: "fixture@example.test" },
  ] };
  if (p === "/staff/profile") data = { profile: { id: 9001, email: "fixture@example.test", name: "Fixture Person", role: ROLE, employee_id: "A2Z-001", position: "CEO", department: "Management", phone: "0123456789", employment_status: "permanent", photo_key: "staff/9001-fixture.jpg", role_title: "Chief Executive Officer", responsibilities: "Set the direction and the targets\nApprove claims, leave entitlement and payroll\nOwn the client relationships", responsibilities_updated_at: "2026-09-10 09:00:00" } };
  if (p === "/staff/announcements") data = { announcements };
  if (p === "/staff/leave") data = { leave: q.get("all") ? leave : leave.filter((l) => l.user_id === 9001) };
  if (p === "/staff/leave/balance") data = { balances: { annual: { entitled: 14, used: 2, accrued: 10.5 }, medical: { entitled: 14, used: 0, accrued: 14 }, emergency: { entitled: 3, used: 0, accrued: 3 }, unpaid: { entitled: 0, used: 0 }, replacement: { entitled: 0, used: 0, accrued: 1 } }, hourly: false };
  if (p === "/claims") data = { claims, can_decide: true };
  if (p === "/claims/mileage-rate") data = { cents_per_km: 60, can_set: true };
  if (p === "/enquiries") data = { enquiries: q.get("status") ? enquiries.filter((e) => e.status === q.get("status")) : enquiries, counts: { new: 2, overdue: 1, mine: 0, contacted: 1, qualified: 0, closed: 0 }, people: staff.map((s) => ({ id: s.id, name: s.name, role: s.role })), overdue_hours: 24 };
  /* v1.199.0 - can_remove is the worker's hr_manage answer: the four roles that keep the register */
  if (p === "/staff/assets") data = { assets, can_remove: ["super_admin", "admin", "hr_admin", "ceo"].includes(ROLE) };
  /* v1.199.0 - the audit trail the Assets Reports & Audit tab reads (admin tier on the worker) */
  /* v1.203.0 - the whole trail (no ?action), as the admin tier reads it on the overview */
  if (p === "/audit" && !q.get("action")) data = !["super_admin", "admin", "ceo"].includes(ROLE) ? { error: { code: "forbidden", message: "Admin required" } } : { entries: [
    { id: 990, action: "auth.login", entity: "users", entity_id: "9001", detail: null, created_at: "2026-09-18 01:58:00", user_name: "Fixture Person" },
    { id: 989, action: "hotel.update", entity: "hotels", entity_id: "1", detail: "{\"hotel_name\":\"Casa del Rio\",\"state\":\"MELAKA\"}", created_at: "2026-09-18 01:50:00", user_name: "Nur Aisyah" },
    { id: 988, action: "leave.approve", entity: "leave_requests", entity_id: "7", detail: "{\"name\":\"Tan Mei Ling\"}", created_at: "2026-09-18 00:55:00", user_name: "Fixture Person" },
    { id: 987, action: "task.complete", entity: "tasks", entity_id: "4", detail: "{\"title\":\"Renew studio insurance\"}", created_at: "2026-09-17 23:40:00", user_name: "Fixture Person" },
    { id: 986, action: "asset.create", entity: "assets", entity_id: "11", detail: "{\"asset_tag\":\"AZOA-011\",\"name\":\"Company car\"}", created_at: "2026-09-17 21:00:00", user_name: "Tan Mei Ling" },
    { id: 985, action: "staff.responsibilities_update", entity: "users", entity_id: "9002", detail: "{\"name\":\"Nur Aisyah\"}", created_at: "2026-09-17 08:00:00", user_name: "Fixture Person" },
  ] };
  /* v1.203.0 - what /system/health says (CEO and admin): a backup last night, nothing pending, one error today */
  if (p === "/system/health") data = !["super_admin", "admin", "ceo"].includes(ROLE) ? { error: { code: "forbidden", message: "Admin or CEO required" } } : {
    errors: [{ id: 41, created_at: "2026-09-18 00:12:00", source: "cron", message: "TikTok sync timed out once" }],
    last_backup: { key: "backups/2026-09-17.sql.gz", size: 412000, uploaded: "2026-09-17T19:20:00.000Z" }, last_offsite: "2026-09-10", migrations_pending: [] };
  if (p === "/audit" && (q.get("action") ?? "") === "asset." && !["super_admin", "admin", "ceo"].includes(ROLE)) data = { error: { code: "forbidden", message: "Admin required" } };
  else if (p === "/audit" && (q.get("action") ?? "") === "asset.") data = { entries: [
    { id: 905, action: "asset.update", entity: "assets", entity_id: "3", detail: JSON.stringify({ asset_tag: "A2Z-LGT-03", name: "Godox SL60", status: "repair", assigned_to: "", location: "Studio", condition_note: "Fan noise" }), created_at: "2026-09-14 03:20:00", user_name: "Mei Ling" },
    { id: 904, action: "asset.update", entity: "assets", entity_id: "7", detail: JSON.stringify({ asset_tag: "AZOA-007", name: "Wireless mic set", status: "lost", assigned_to: "", location: "Studio", condition_note: "Not returned after the Melaka shoot" }), created_at: "2026-09-10 08:00:00", user_name: "Fixture Person" },
    { id: 903, action: "asset.remove", entity: "assets", entity_id: "12", detail: JSON.stringify({ tag: "AZOA-012", reason: "typo", snapshot: { asset_tag: "AZOA-012", name: "Monitor 27\"" } }), created_at: "2026-09-05 02:00:00", user_name: "Mei Ling" },
    { id: 902, action: "asset.update", entity: "assets", entity_id: "1", detail: JSON.stringify({ asset_tag: "A2Z-CAM-01", name: "Sony A7 IV", status: "in_use", assigned_to: "9003", location: "Studio" }), created_at: "2026-09-02 02:00:00", user_name: "Fixture Person" },
    { id: 901, action: "asset.create", entity: "assets", entity_id: "10", detail: JSON.stringify({ tag: "AZOA-010" }), created_at: "2026-09-15 01:00:00", user_name: "Mei Ling" },
  ] };
  /* v1.202.0 - the list answers as the worker does: ?state, ?q (the hotel and
     its people), ?stage, ?due=1; by_state and state_pipeline are always the
     whole directory */
  if (p === "/staff/hotels/" || p === "/staff/hotels") {
    const st = q.get("state"), qq = (q.get("q") ?? "").toLowerCase(), stg = q.get("stage");
    let list = hotels.filter((h) => !st || h.state === st);
    if (qq) list = list.filter((h) => [h.hotel_name, h.company, h.address, h.state].some((v) => (v ?? "").toLowerCase().includes(qq)) || h.contacts.some((c) => [c.person_name, c.phone, c.phone2, c.email].some((v) => (v ?? "").toLowerCase().includes(qq))));
    if (stg) list = list.filter((h) => h.stage === stg);
    if (q.get("due") === "1") list = list.filter(hotelDue);
    const by_state = Object.fromEntries(MY_STATES_FX.map((x) => [x, hotels.filter((h) => h.state === x).length]));
    const state_pipeline = Object.fromEntries(MY_STATES_FX.map((x) => { const hs = hotels.filter((h) => h.state === x); return [x, { contacted: hs.filter((h) => h.stage !== "lead").length, agreed: hs.filter((h) => h.stage === "agreed" || h.stage === "reviewed").length, published: hs.filter((h) => h.stage === "published").length }]; }));
    data = { hotels: list, total: hotels.length, states: MY_STATES_FX, by_state, state_pipeline, can_manage: true };
  }
  if (/^\/staff\/hotels\/\d+\/pipeline$/.test(p)) {
    const h = hotels.find((x) => x.id === Number(p.split("/")[3]));
    data = { hotel: { stage: h?.stage ?? "lead", review_url: h?.review_url ?? null }, calls: h?.id === 1 ? [
      { id: 501, contact_id: 11, called_at: D + "10 03:00:00", outcome: "agreed", notes: "Two nights in October, family room.", next_at: D + "24", by_name: "Nur Aisyah", contact_name: "Puan Rina" },
      { id: 500, contact_id: 11, called_at: D + "04 03:00:00", outcome: "callback", notes: null, next_at: D + "10", by_name: "Nur Aisyah", contact_name: "Puan Rina" },
    ] : [] };
  }
  if (p === "/staff/web-orders") data = { orders: q.get("status") ? webOrders.filter((o) => o.status === q.get("status")) : webOrders };
  if (p === "/stokis") data = { stokis, month: "2026-09" };
  if (p === "/content") data = { content };
  if (p === "/commission") data = { entries: commission };
  if (p === "/commission/rates") data = { rates: [{ id: 1, host_id: 9003, host_name: "Farid Zul", percent: 5, per_hour_cents: 0, effective_from: "2026-01-01" }] };
  if (p === "/hosts") data = { hosts: [{ id: 9003, name: "Farid Zul" }, { id: 9002, name: "Nur Aisyah" }] };
  if (p === "/cashflow") data = { entries: cash };
  if (p === "/banks") data = { banks: [{ id: 1, name: "Maybank", account_no: "5621", balance_cents: 2500000 }] };
  if (p === "/expenses") data = { expenses, upcoming: [], staff_payroll: null, staff_claims: { in_month: [], due: [], paid: [] } };
  /* v1.215.0 - the CEO/COO paid confirmation (0145). CONFIRMED=1 serves
     INV-AZO100926-2 as confirmed; otherwise it awaits confirmation. */
  if (p === "/staff/docs") data = {
    docs: process.env.CONFIRMED ? docs.map((d) => d.id === 2 ? { ...d, paid_confirmed_at: D + "13 02:00:00", paid_confirmed_by: "Fixture COO", paid_confirmed_cents: d.total_cents } : d) : docs,
    can_confirm_paid: ["ceo", "coo", "super_admin"].includes(ROLE),
  };
  /* v1.216.0 - the Sales figures over the whole table, worked out by hand
     from the documents above (scope=all) and for the signed-in 9001 (mine);
     the company's September target (invented) gives the week its pace */
  if (p === "/staff/docs/summary") {
    const mine = q.get("scope") === "mine";
    const z = { cents: 0, n: 0 };
    const fz = { raised: 0, raised_cents: 0, invoiced: 0, won_cents: 0, paid: 0, part: 0, expired: 0 };
    data = mine ? {
      month: "2026-09", scope: "mine", today: "2026-09-18",
      collected: z, collected_last: z, invoiced: { cents: 990000, n: 1 }, invoiced_last: z, quotations: z, quotations_spark: [0, 0, 0, 0, 0, 0],
      outstanding: { n: 1, total_cents: 990000, balance_cents: 590000 }, cash_cents: 400000, cash_last_cents: 0, parts_known: true,
      daily: [], funnel: fz,
      week: { from: "2026-09-14", to: "2026-09-20", target_pace_cents: null, collected: z, quotations: z, won: z, funnel: fz, new_customers: 0, enquiries: 0, qualified: 0 },
    } : {
      month: "2026-09", scope: "all", today: "2026-09-18",
      collected: { cents: 280000, n: 1 }, collected_last: z, invoiced: { cents: 1270000, n: 2 }, invoiced_last: { cents: 120000, n: 1 },
      quotations: { cents: 450000, n: 1 }, quotations_spark: [0, 0, 0, 0, 0, 1],
      outstanding: { n: 2, total_cents: 1110000, balance_cents: 710000 }, cash_cents: 680000, cash_last_cents: 0, parts_known: true,
      daily: [{ day: "2026-09-12", cents: 280000 }], funnel: { ...fz, raised: 1, raised_cents: 450000 },
      week: { from: "2026-09-14", to: "2026-09-20", target_pace_cents: 700000, collected: z, quotations: { cents: 450000, n: 1 }, won: z,
        funnel: { ...fz, raised: 1, raised_cents: 450000 }, new_customers: 0, enquiries: 2, qualified: 0 },
    };
  }
  if (p === "/staff/payroll/commission-sources") data = { month: q.get("month") ?? "", policy: null,
    rows: process.env.CONFIRMED && (q.get("month") ?? "") === "2026-09" ? [{ invoice_id: 2, doc_number: "INV-AZO100926-2", company: "Zainab Kitchen", amount_cents: 280000, payment_ref: null,
      paid_at: D + "12 10:00:00", confirmed_at: D + "13 02:00:00", confirmed_by_name: "Fixture COO", salesperson_id: 9002, closer_name: "Nur Aisyah" }] : [] };
  /* v1.181.11 - the quotation above, whole, and the version its revision replaced */
  if (p === "/staff/docs/1") data = { doc: { ...docs[0], customer_id: 1, salesperson_id: 9002, contact_person: "Aina Rahman", address: "12 Jalan Bunga, Melaka", customer_phone: "0174761019",
    items: JSON.stringify([{ name: "TikTok LIVE hosting - 8 sessions", qty: 1, unit_price_cents: 300000, uom: "PKG" }, { name: "Product photography - 20 photos", qty: 1, unit_price_cents: 150000, uom: "SET" }]),
    discount_cents: 0, tax_percent: 0, delivery_cents: 0, issuer_code: "a2z", created_by_role: "sales_marketing", signer_name: "Nur Aisyah", signer_position: "Sales Executive" } };
  /* v1.181.14 - stock received from suppliers, reorder levels */
  if (p === "/staff/inventory/receipts") data = { can_write: true, suppliers: ["Kilang Tudung Sdn Bhd", "Syarikat Fabrik Maju"],
    receipts: [
      { id: 3, supplier: "Kilang Tudung Sdn Bhd", received_on: D + "18", reference: "DO-7781", note: null, total_cents: 104000, bill_due_on: "2026-10-18", bill_paid_on: null, voided_at: null, void_reason: null, received_by: "Nur Aisyah", lines: 2, created_at: D + "18 03:00:00" },
      { id: 2, supplier: "Syarikat Fabrik Maju", received_on: D + "11", reference: "INV-55120", note: null, total_cents: 36000, bill_due_on: null, bill_paid_on: null, voided_at: null, void_reason: null, received_by: "Fixture Person", lines: 1, created_at: D + "11 03:00:00" },
      { id: 1, supplier: "Kilang Tudung Sdn Bhd", received_on: D + "02", reference: null, note: null, total_cents: 20000, bill_due_on: "2026-09-30", bill_paid_on: D + "29", voided_at: D + "03 02:00:00", void_reason: "Entered twice", received_by: "Nur Aisyah", lines: 1, created_at: D + "02 03:00:00" }],
    reorder: [{ id: 1, sku: "BWL-001", name: "ELFIA Bawal Premium Extra Long 1", stock: 3, reorder_level: 12, reorder_qty: 40 }],
    levels: [{ id: 1, sku: "BWL-001", name: "ELFIA Bawal Premium Extra Long 1", stock: 3, reorder_level: 12, reorder_qty: 40 }] };
  /* v1.181.17 - people: a joiner with steps open, a leaver, two on probation, letters, training; the leave month; the approval limit on */
  if (p === "/staff/people/overview") data = { today: D + "18", joining_keys: ["offer_letter", "contract", "bank", "twofa", "badge", "groups"],
    leaving_keys: ["assets_returned", "access_removed", "claims_settled", "final_pay", "exit_letter", "groups_removed"],
    joining: [{ id: 9005, name: "Siti Nur Aisyah binti Abdullah", position: "Live Host", joined_on: D + "01", open: ["badge", "groups"] }],
    leaving: [{ id: 9006, name: "Hafiz Kamal", position: "Video Editor", left_on: D + "30", items: { access_removed: true }, open: ["assets_returned", "claims_settled", "final_pay", "exit_letter", "groups_removed"], assets_held: 2 }],
    probation: [{ id: 9005, name: "Siti Nur Aisyah binti Abdullah", position: "Live Host", joined_on: "2026-07-01", suggested_ends_on: "2026-10-01", review: { id: 3, ends_on: D + "30", outcome: null } },
      { id: 9007, name: "Farid Zulkifli", position: "Sales Executive", joined_on: D + "01", suggested_ends_on: "2026-12-01", review: null }],
    decided: [{ id: 1, user_id: 9002, name: "Nur Aisyah", ends_on: "2026-08-31", outcome: "confirmed", note: null, decided_at: "2026-08-30 03:00:00", decided_by_name: "Fixture Person" }],
    letters: [{ id: 2, user_id: 9002, kind: "confirmation", ref_no: "A2Z/HR/2026/002", issued_on: "2026-09-01", subject: "Confirmation of employment - Sales Executive", voided_at: null, void_reason: null, name: "Nur Aisyah", issued_by_name: "Fixture Person" },
      { id: 1, user_id: 9007, kind: "offer", ref_no: "A2Z/HR/2026/001", issued_on: "2026-08-20", subject: "Offer of employment - Sales Executive", voided_at: "2026-08-21 02:00:00", void_reason: "Wrong salary", name: "Farid Zulkifli", issued_by_name: "Fixture Person" }],
    training: [{ id: 1, user_id: 9003, name: "Farid Zul", title: "TikTok Shop live selling masterclass", provider: "TikTok Shop Academy", on_date: D + "12", hours: 6, cost_cents: 45000, paid_by: "company" }],
    staff: staff.map((x) => ({ id: x.id, name: x.name, position: x.position ?? null })) };
  if (/^\/staff\/people\/\d+\/letter-fields$/.test(p)) data = { person: { id: 9005, name: "Siti Nur Aisyah binti Abdullah", ic_number: "990101-01-1234", position: "Live Host", department: "Live", employment_status: "probation", joined_on: "2026-07-01", left_on: null, base_salary_cents: 220000, address: null } };
  if (p === "/staff/people/leave-calendar") {
    /* the month asked for, with the same three people in it */
    const m = q.get("month") ?? "2026-09";
    const last = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).toISOString().slice(0, 10);
    data = { month: m, first: `${m}-01`, last, leave: [
      { id: 1, user_id: 9002, name: "Nur Aisyah", department: "Sales", type: "annual", start_date: `${m}-08`, end_date: `${m}-10`, days: 3, status: "approved" },
      { id: 2, user_id: 9007, name: "Farid Zulkifli", department: "Sales", type: "annual", start_date: `${m}-10`, end_date: `${m}-11`, days: 2, status: "pending" },
      { id: 3, user_id: 9003, name: "Farid Zul", department: "Live", type: "medical", start_date: `${m}-22`, end_date: `${m}-22`, days: 1, status: "approved" }] };
  }
  if (p === "/staff/quotes/approval") data = { limit_cents: 400000, pending: [{ id: 1 }], approved: [], can_set: true, can_approve: true };
  /* v1.181.16 - client files: tags, terms, a follow-up, a monthly invoice due; Aina Boutique's file; an acceptance */
  if (p === "/staff/customers/crm") data = { today: D + "18", can_write: true,
    tags: [{ customer_id: 1, tag: "retainer" }, { customer_id: 1, tag: "hijab" }, { customer_id: 2, tag: "f&b" }],
    terms: [{ customer_id: 1, terms_days: 30 }],
    followups: [{ id: 1, customer_id: 1, company: "Aina Boutique", due_on: D + "18", note: "Ask about the Raya live package", owner_id: 9002, owner_name: "Nur Aisyah" }],
    recurring: [{ id: 2, customer_id: 1, company: "Aina Boutique", source_doc_id: 3, source_number: "INV-AZO050926-3", total_cents: 300000, day_of_month: 5, note: null, due_on: D + "05", raised: false, raised_number: null, due: true }] };
  if (p === "/staff/customers/1/file") data = { customer: { id: 1, company: "Aina Boutique", contact_person: "Aina Rahman", phone: "0174761019", email: null },
    contacts: [{ id: 1, name: "Aina Rahman", role: "Owner", phone: "0174761019", email: null, note: null }, { id: 2, name: "Hafiz Kamal", role: "Finance", phone: "0123344556", email: "accounts@ainaboutique.test", note: null }],
    tags: ["hijab", "retainer"], all_tags: ["f&b", "hijab", "retainer"], terms_days: 30,
    followups: [{ id: 1, due_on: D + "18", note: "Ask about the Raya live package", owner_id: 9002, owner_name: "Nur Aisyah", created_at: D + "10 02:00:00", done_at: null, done_note: null, cancelled_at: null, done_by_name: null },
      { id: 3, due_on: D + "22", note: "Send the September report", owner_id: 9001, owner_name: "Fixture Person", created_at: D + "10 02:00:00", done_at: null, done_note: null, cancelled_at: null, done_by_name: null },
      { id: 2, due_on: D + "02", note: "Confirm the hosting schedule", owner_id: 9002, owner_name: "Nur Aisyah", created_at: D + "01 02:00:00", done_at: D + "02 06:00:00", done_note: null, cancelled_at: null, done_by_name: "Nur Aisyah" }],
    recurring: [{ id: 2, customer_id: 1, source_doc_id: 3, source_number: "INV-AZO050926-3", total_cents: 300000, day_of_month: 5, note: null, due_on: D + "05", raised: false, raised_number: null, due: true }],
    invoices: [{ id: 3, doc_number: "INV-AZO050926-3", total_cents: 990000, created_at: D + "05 02:00:00" }],
    owners: [{ id: 9001, name: "Fixture Person" }, { id: 9002, name: "Nur Aisyah" }], me: 9001, today: D + "18", can_write: true };
  /* v1.181.16 - a shared quotation the customer can accept (the public page) */
  if (/^\/public\/doc\/[a-f0-9]{32}$/.test(p)) data = { doc: { ...docs[0], company: "Aina Boutique", contact_person: "Aina Rahman", address: "12 Jalan Bunga, Melaka", customer_phone: "0174761019",
    items: JSON.stringify([{ name: "TikTok LIVE hosting - 8 sessions", qty: 1, unit_price_cents: 300000, uom: "PKG" }, { name: "Product photography - 20 photos", qty: 1, unit_price_cents: 150000, uom: "SET" }]),
    discount_cents: 0, tax_percent: 0, delivery_cents: 0, issuer_code: "a2z", kind: "service", signer_role: null, signer_name: "Nur Aisyah", signer_position: "Sales Executive", can_accept: true, acceptance: null } };
  if (p === "/staff/docs/1/acceptance") data = { acceptances: [{ revision: 0, accepted_name: "Aina Rahman", accepted_position: "Owner", accepted_at: D + "16 04:12:00", ip: "203.0.113.9" }] };
  /* v1.181.15 - the books: six months (August closed and changed since), the position, the audit trail */
  if (p === "/staff/books/months") {
    const f = (inv, rec, exp, pay) => ({ invoiced_cents: inv, received_cents: rec, part_payments_cents: 0, expenses_cents: exp, stock_received_cents: 36000, payroll_net_cents: pay, documents: 14 });
    data = { current_month: "2026-09", months: [
      { month: "2026-09", figures: { ...f(1890000, 1250000, 412000, 0), part_payments_cents: 400000, stock_received_cents: 160000 }, closed: null, changed_since_close: null, history: [] },
      { month: "2026-08", figures: f(2140000, 1980000, 388000, 1625000), closed: { id: 2, at: "2026-09-02 02:10:00", by: "Fixture Person", note: "Checked with the bank statement" }, changed_since_close: { received_cents: 450000, documents: 1 }, history: [{ id: 2, at: "2026-09-02 02:10:00", by: "Fixture Person", reopened_at: null, reopen_reason: null }] },
      { month: "2026-07", figures: f(1760000, 1700000, 365000, 1610000), closed: { id: 1, at: "2026-08-03 01:00:00", by: "Fixture Person", note: null }, changed_since_close: {}, history: [{ id: 1, at: "2026-08-03 01:00:00", by: "Fixture Person", reopened_at: null, reopen_reason: null }] },
      { month: "2026-06", figures: f(1530000, 1490000, 341000, 1598000), closed: null, changed_since_close: null, history: [] },
      { month: "2026-05", figures: f(1210000, 1180000, 330000, 1598000), closed: null, changed_since_close: null, history: [] },
      { month: "2026-04", figures: f(980000, 950000, 322000, 1540000), closed: null, changed_since_close: null, history: [] }] };
  }
  if (p === "/staff/books/position") data = { as_of: D + "18",
    debtors: [{ id: 3, doc_number: "INV-AZO050926-3", company: "Casa del Rio Melaka Boutique Hotel Sdn Bhd", total_cents: 990000, created_at: D + "05 02:00:00", due_date: D + "30", received_cents: 400000, balance_cents: 590000 },
      { id: 7, doc_number: "INV-AZO120926-7", company: "Aina Boutique", total_cents: 240000, created_at: D + "12 02:00:00", due_date: null, received_cents: 0, balance_cents: 240000 }],
    debtors_cents: 830000, creditors: [{ id: 3, supplier: "Kilang Tudung Sdn Bhd", received_on: D + "18", bill_due_on: "2026-10-18", total_cents: 104000 }], creditors_cents: 104000,
    stock: [{ category: "Bawal", items: 12, units: 340, value_cents: 1530000, uncosted: 0 }, { category: "Shawl", items: 8, units: 120, value_cents: 612000, uncosted: 2 }],
    stock_value_cents: 2142000, uncosted_items: 2 };
  if (p === "/staff/books/audit") data = { areas: [{ area: "invoice", n: 41 }, { area: "inventory", n: 22 }, { area: "books", n: 3 }],
    rows: [{ id: 903, action: "books.close", entity: "period_closes", entity_id: "2", detail: "{\"month\":\"2026-08\",\"invoiced_cents\":2140000,\"received_cents\":1980000}", created_at: "2026-09-02 02:10:00", who: "Fixture Person" },
      { id: 902, action: "invoice.part_payment", entity: "sales_documents", entity_id: "3", detail: "{\"amount_cents\":150000,\"received_on\":\"2026-09-16\"}", created_at: D + "16 03:00:00", who: "Nur Aisyah" },
      { id: 901, action: "inventory.receive", entity: "stock_receipts", entity_id: "3", detail: null, created_at: D + "18 03:00:00", who: "Nur Aisyah" }] };
  /* v1.181.15 - one stock take open on Bawal, two earlier */
  if (p === "/staff/stock-counts") data = { counts: [
    { id: 4, category: "Bawal", note: null, status: "open", started_at: D + "18 01:00:00", posted_at: null, cancelled_at: null, started_by_name: "Nur Aisyah", lines: 3, counted: 2, variances: 1 },
    { id: 3, category: null, note: null, status: "posted", started_at: "2026-08-31 01:00:00", posted_at: "2026-08-31 09:00:00", cancelled_at: null, started_by_name: "Nur Aisyah", lines: 20, counted: 20, variances: 3 },
    { id: 2, category: "Shawl", note: null, status: "cancelled", started_at: "2026-08-20 01:00:00", posted_at: null, cancelled_at: "2026-08-20 02:00:00", started_by_name: "Fixture Person", lines: 8, counted: 2, variances: 0 }] };
  if (p === "/staff/stock-counts/4") data = { count: { id: 4, category: "Bawal", note: null, status: "open", started_at: D + "18 01:00:00", posted_at: null }, lines: [
    { id: 1, item_id: 1, sku: "BWL-001", item_name: "ELFIA Bawal Premium Extra Long 1", system_qty: 3, counted_qty: 2, posted_delta: null, stock_now: 3, unit_cost_cents: 4500 },
    { id: 2, item_id: 2, sku: "BWL-002", item_name: "ELFIA Bawal Cotton Voile Printed Raya Edition", system_qty: 24, counted_qty: 24, posted_delta: null, stock_now: 22, unit_cost_cents: 3800 },
    { id: 3, item_id: 3, sku: "BWL-003", item_name: "ELFIA Bawal Satin Silk", system_qty: 15, counted_qty: null, posted_delta: null, stock_now: 15, unit_cost_cents: null }] };
  /* v1.181.13 - part payments on the unpaid Casa del Rio invoice, and one client's history */
  if (p === "/staff/docs/part-payments") data = { invoices: [{ invoice_id: 3, received_cents: 400000, parts: 2, last_received_on: D + "16" }] };
  /* v1.214.0 - any other document, whole (Edit reads it) */
  { const m = /^\/staff\/docs\/(\d+)$/.exec(p); const row = m && docs.find((x) => x.id === Number(m[1]));
    if (row && row.id !== 1) data = { doc: { ...row, customer_id: 2, items: JSON.stringify([{ name: "TikTok LIVE hosting - 4 sessions", qty: 1, unit_price_cents: row.total_cents }]),
      discount_cents: 0, tax_percent: 0, delivery_cents: 0, issuer_code: "a2z", revision: 0 } }; }
  /* v1.214.0 - the paid invoice's payments read (the workspace opens it) */
  if (p === "/staff/docs/2/payments") data = { invoice: { id: 2, doc_number: "INV-AZO100926-2", total_cents: 280000, payment_status: "paid", paid_at: D + "12 10:00:00", created_at: D + "10 10:00:00" }, can_record: true, payments: [], received_cents: 0, balance_cents: 280000 };
  if (p === "/staff/docs/3/payments") data = { invoice: { id: 3, doc_number: "INV-AZO050926-3", total_cents: 990000, payment_status: "unpaid" }, can_record: true,
    received_cents: 400000, balance_cents: 590000, payments: [
      { id: 1, amount_cents: 250000, received_on: D + "08", method: "bank_transfer", reference: "MBB080926-4471", note: null, created_at: D + "08 03:00:00", voided_at: null, void_reason: null, recorded_by: "Nur Aisyah", voided_by_name: null },
      { id: 2, amount_cents: 150000, received_on: D + "16", method: "bank_transfer", reference: "MBB160926-1180", note: null, created_at: D + "16 03:00:00", voided_at: null, void_reason: null, recorded_by: "Nur Aisyah", voided_by_name: null },
      { id: 3, amount_cents: 50000, received_on: D + "12", method: "bank_transfer", reference: "CHQ 001244", note: null, created_at: D + "12 03:00:00", voided_at: D + "13 02:00:00", void_reason: "Cheque bounced", recorded_by: "Nur Aisyah", voided_by_name: "Fixture Person" }] };
  if (p === "/staff/customers/1/timeline") data = { customer: { id: 1, company: "Aina Boutique" }, hidden: [], events: [
      { at: D + "18 11:20", kind: "revision", title: "QT-AZO150926-1 revised to REV 1", detail: "REV original kept in History" },
      { at: D + "16", kind: "part_payment", title: "Part payment on INV-AZO050926-3", amount_cents: 150000, detail: "MBB160926-1180" },
      { at: D + "15 18:00", kind: "doc_qt", title: "Quotation QT-AZO150926-1", amount_cents: 450000 },
      { at: D + "14 10:12", kind: "enquiry", title: "Enquiry from Aina Rahman", detail: "new · Can you quote live hosting for our Raya collection, 8 sessions?" },
      { at: D + "12 14:00", kind: "live", title: "Live session with Farid Zul", detail: "14:00-16:00 · completed" },
      { at: D + "10 09:30", kind: "engagement", title: "Nur Aisyah: whatsapp · follow_up", detail: "interested · verified" }] };
  if (p === "/staff/docs/1/revisions") data = { revisions: [{ revision: 0, total_cents: 300000, replaced_at: D + "18 03:20:00", replaced_by_name: "Nur Aisyah",
    doc: { items: JSON.stringify([{ name: "TikTok LIVE hosting - 8 sessions", qty: 1, unit_price_cents: 300000, uom: "PKG" }]), discount_cents: 0, tax_percent: 0, delivery_cents: 0, total_cents: 300000, created_at: D + "15 10:00:00", revision: 0, revised_at: null, kind: "service" } }] };
  if (p === "/staff/customers") data = { customers };
  if (p === "/gl/accounts") data = { accounts };
  if (p === "/gl/trial-balance") data = { accounts, rows: accounts };
  if (p === "/task-reports") data = { reports: [{ id: 1, report_date: D + "15", author: "Nur Aisyah", period: "daily", content: "Called 6 hotels, 2 agreed to a stay." },
    { id: 2, report_date: D + "14", author: "Fixture Person", period: "weekly", content: "Week 37:\n- 4 lives, 2 over target\n- Raya stock counted\n- Two claims settled" }] }; // v1.192.0 - the route's own column (period)
  if (p === "/birthdays") data = { birthdays: [{ id: 9002, name: "Nur Aisyah", birthday: "1997-09-28" }] };
  if (p === "/staff/tiktok-analytics" || p === "/tiktok-analytics") data = { window: { start_date_ge: "2026-09-01", end_date_lt: "2026-09-17", days: 16 }, shop: { gmv: 85918, orders: 55, units: 61, buyers: 49 }, shop_ok: true, shop_has: { gmv: true, orders: true, units: true, buyers: true }, daily: Array.from({ length: 16 }, (_, i) => ({ date: `2026-09-${String(i + 1).padStart(2, "0")}`, gmv: 3000 + (i * 700) % 5000, orders: 2 + (i % 5) })), products: [{ id: "1729384756", name: "ELFIA Premium serum 30ml", gmv: 42000, orders: 20, units: 22 }, { id: "1729384757", name: "ELFIA Daily care set", gmv: 30000, orders: 18, units: 20 }, { id: "1729384758", name: "ELFIA Brightening mask", gmv: 13918, orders: 17, units: 19 }], skus: [], videos: [{ id: "7412345678901234567", name: "Raya haul - ELFIA serum demo", title: "Raya haul - ELFIA serum demo", gmv: 32000, orders: 15, units: 16, views: 18200, click_through_rate: 0.042 }, { id: "7412345678901234568", name: "Morning routine with ELFIA", title: "Morning routine with ELFIA", gmv: 21000, orders: 11, units: 12, views: 9400, click_through_rate: 0.031 }], lives: [{ id: "L1", name: "Sunday live", gmv: 15000, orders: 9, units: 10, views: 3200 }], fetched_at_myt: "2026-09-16 10:00", cached: true, worker_version: "1.173.0", names: { sources: ["catalogue"], notes: [], products: 3, variants: 3 } };
  /* v1.174.3 - THE ROWS THE PROBES WERE BLIND TO. The overflow sweeps kept
     reporting 0 on Attendance and Sales because these two endpoints fell
     through to the generic fixture and both cards rendered EMPTY. The CEO's
     real data is long Malaysian names, which is what actually overflowed -
     so the fixture carries them. */
  if (p === "/staff/attendance/ot/pending") data = { can_replace: true, pending: [
    { user_id: 9002, name: "NUR NASUHA BINTI ZAINAL ABIDIN", d: "2026-09-21", ot_in: "18:00", ot_out: "19:07", minutes: 67, assigned: "Sales duty" },
    { user_id: 9004, name: "NURUL FASEHAH BINTI SHAHRUDDIN", d: "2026-09-20", ot_in: "19:00", ot_out: "19:32", minutes: 32, assigned: "ELFIA" },
    { user_id: 9005, name: "NURFARAH SUAIDAH BINTI MOHD SAIFUDDIN", d: "2026-09-19", ot_in: "18:30", ot_out: "21:15", minutes: 165 },
  ] };
  /* v1.177.0 - the Dashboard's six company figures. Without this row the
     catch-all default answered, and its `clients: []` (a LIST, for the panels
     that want one) reached a tile that wanted a COUNT - so the CLIENTS tile
     drew its caption over empty space on every sweep, and every sweep passed.
     The figures here are counts, which is what /staff/dashboard/summary
     actually returns. */
  if (p === "/staff/dashboard/summary") data = {
    clients: 14, active_stokis: 3, lives_today: 2, in_today: 6,
    unpaid_invoices: 4, cash_in_cents: 1_284_000, cash_out_cents: 902_500,
    sales_cents: 325_000, target_cents: 300_000, today_sales_cents: 0,
    /* v1.181.4 - the donut's three, so the Attendance today card draws (and
       agrees with /staff/dashboard/attendance-today below: 3 + 2 + 2 = 7) */
    attendance_on_time: 3, attendance_late: 2, staff_total: 7,
    /* v1.203.0 - the worker's own names for the counts the overview reads */
    open_quotations: 5, outstanding_invoices: 4, pending_leave: 1, pending_claims: 2, pending_ot: 1, low_stock: 1,
  };
  if (p === "/staff/clients/summary" || p === "/staff/clients") data = { sessions: { "1": 0, "2": 2, "3": 0 }, clients: [
    { id: 1, company: "Bambijan Food Empire", invoiced_cents: 45000, paid_cents: 45000, quotations: 1 },
    { id: 2, company: "Madam Jariah", invoiced_cents: 0, paid_cents: 0, quotations: 4 },
    { id: 3, company: "Nor Shah Enterprise Sdn Bhd (Cawangan Melaka)", invoiced_cents: 0, paid_cents: 0, quotations: 1 },
  ] };
  if (p === "/staff/clients/live-economics") data = { month: "2026-09", clients: [{ id: 2, company: "Madam Jariah", minutes: 180, paid_cents: 0 }], hosts: [{ id: 9003, name: "Farid Zul", minutes: 180, gmv_cents: 45000 }] };
  /* v1.174.4 - the ADMIN attendance report: the register table and the
     per-person summary. Another pair the fixture did not know, so the
     Attendance tab rendered neither table and the sweeps saw nothing. Long
     Malaysian names, because that is what the columns have to hold. */
  if (p === "/staff/attendance/report" || p === "/attendance/report") data = {
    records: [9002, 9004, 9005, 9006, 9007].flatMap((uid, i) => {
      const nm = ["NUR NASUHA BINTI ZAINAL ABIDIN", "NURUL FASEHAH BINTI SHAHRUDDIN", "NURFARAH SUAIDAH BINTI MOHD SAIFUDDIN", "MOHD ALIF FARHAN BIN NAZARUDIN", "MOHAMAD IZZUDIN BIN AMDAN"][i];
      const rl = ["Sales Executive", "Administrative Executive", "Designer", "Chief Executive Officer", "Chief Commercial Officer"][i];
      return [0, 1, 2].flatMap((k) => [
        { id: uid * 100 + k * 2, user_id: uid, name: nm, role: rl, type: "clock_in", created_at: `2026-09-${String(15 + k).padStart(2, "0")} 00:24:00`, myt_time: `2026-09-${String(15 + k).padStart(2, "0")} 08:24`, flag: k === 1 ? "late" : "ok", day_kind: "workday", shift_label: "Operation 10:00-18:00", scheduled_minutes: 480 },
        { id: uid * 100 + k * 2 + 1, user_id: uid, name: nm, role: rl, type: "clock_out", created_at: `2026-09-${String(15 + k).padStart(2, "0")} 10:31:00`, myt_time: `2026-09-${String(15 + k).padStart(2, "0")} 18:31`, flag: "completed", day_kind: "workday", shift_label: "Operation 10:00-18:00", scheduled_minutes: 480 },
      ]);
    }),
    leave: [
      { id: 1, user_id: 9002, name: "NUR NASUHA BINTI ZAINAL ABIDIN", role: "Sales Executive", leave_type: "unpaid", date: "2026-09-08", days: 0.25, reason: "Short day - clocked 5h of 8h", recorded_direct: 1 },
      { id: 2, user_id: 9002, name: "NUR NASUHA BINTI ZAINAL ABIDIN", role: "Sales Executive", leave_type: "emergency", date: "2026-09-09", days: 1, reason: "Family matter" },
      { id: 3, user_id: 9004, name: "NURUL FASEHAH BINTI SHAHRUDDIN", role: "Administrative Executive", leave_type: "annual", date: "2026-09-21", days: 1, reason: "Vacation" },
    ],
    overtime: [],
  };
  /* v1.181.4 - the names behind the Attendance today donut. */
  if (p === "/staff/dashboard/attendance-today") data = {
    date: "2026-09-24", cutoff: "10:00",
    on_time: [
      { id: 9007, name: "MOHD ALIF FARHAN BIN NAZARUDIN", position: "Chief Executive Officer", first_in: "08:24" },
      { id: 9005, name: "NURFARAH SUAIDAH BINTI MOHD SAIFUDDIN", position: "Designer", first_in: "09:41" },
      { id: 9003, name: "Farid Zul", position: "Live Host", first_in: "09:58" },
    ],
    late: [
      { id: 9002, name: "NUR NASUHA BINTI ZAINAL ABIDIN", position: "Sales Executive", first_in: "10:07" },
      { id: 9004, name: "NURUL FASEHAH BINTI SHAHRUDDIN", position: "Administrative Executive", first_in: "11:32" },
    ],
    not_in: [
      { id: 9006, name: "MOHAMAD IZZUDIN BIN AMDAN", position: "Chief Commercial Officer", leave_type: null },
      { id: 9008, name: "Mei Ling", position: "HR Executive", leave_type: "medical" },
    ],
  };
  /* v1.175.0 - the desk with BOTH halves populated, so the two lists, the
     next-action line and the one inline action are all on screen. The base
     fixture's single task is not enough to see any of them. */
  if (p === "/staff/desk") {
    const deskItems = [
      { bucket: "leave", id: "leave:12", tab: "Leave", kind: "decide", who: "NUR NASUHA BINTI ZAINAL ABIDIN",
        title: "NUR NASUHA BINTI ZAINAL ABIDIN — annual leave, 3 days", sub: "24-09-2026 – 26-09-2026 · final approval",
        next: "Approve or reject", since: "2026-09-16 09:02:00", overdue: true },
      { bucket: "claims", id: "claim:8", tab: "Claims", kind: "decide", who: "NURUL FASEHAH BINTI SHAHRUDDIN",
        title: "NURUL FASEHAH BINTI SHAHRUDDIN — RM 1,240.00", sub: "Client entertainment, Melaka · final approval",
        next: "Approve or reject", since: "2026-09-13 14:40:00", overdue: true },
      { bucket: "ot", id: "ot:9002:2026-09-21", tab: "Attendance", kind: "decide", who: "NUR NASUHA BINTI ZAINAL ABIDIN",
        title: "NUR NASUHA BINTI ZAINAL ABIDIN — 1h07 overtime on 21-09-2026", sub: "both punches recorded, undecided",
        next: "Approve, give replacement leave, or reject", since: "2026-09-21 11:07:00", overdue: false },
      { bucket: "tasks", id: "task-close:4", tab: "Tasks", kind: "decide", who: "Farid Zulkifli",
        title: "Refresh the ELFIA shopfront banners", sub: "Farid Zulkifli finished every item",
        next: "Review the work and close it", since: "2026-09-19 08:00:00", overdue: false },
      { bucket: "tasks", id: "task:1", tab: "Tasks", kind: "do", who: null,
        title: "Check inventory delivery", sub: "overdue — due 14-09-2026",
        next: "Finish it", since: "2026-09-14 08:00:00", overdue: true },
      { bucket: "enquiries", id: "enquiry:31", tab: "Enquiries", kind: "do", who: "Nor Shah Enterprise Sdn Bhd",
        title: "Nor Shah Enterprise Sdn Bhd (Cawangan Melaka) — live session", sub: "new, nobody has taken it",
        next: "Take it, or open it to reply", since: "2026-09-21 16:20:00", overdue: false, takeable: true },
      { bucket: "news", id: "announcement:6", tab: "Announcements", kind: "do", who: null,
        title: "Raya schedule and the shop's closing days", sub: "announcement",
        next: "Read it and acknowledge", since: "2026-09-18 09:00:00", overdue: false },
    ];
    const deskCounts = {};
    for (const i of deskItems) deskCounts[i.bucket] = (deskCounts[i.bucket] ?? 0) + 1;
    data = { items: deskItems, counts: deskCounts, total: deskItems.length, missing: [] };
  }
  /* v1.176.0 - the watchers, so the Desk page's "Needs attention" zone has
     GROUPED findings to draw (eleven low-stock SKUs under one row). */
  if (p === "/staff/watchers") data = {
    watchers: [
      { key: "low_stock", label: "Stock below the line", audience: ["ceo", "coo", "sales_marketing"], tab: "Inventory", threshold_label: "units", default_threshold: 5, enabled: true, threshold: 5, open: 11 },
      { key: "order_stuck", label: "Paid web order not shipped", audience: ["ceo", "coo", "sales_marketing"], tab: "Web Orders", threshold_label: "days", default_threshold: 3, enabled: true, threshold: 3, open: 2 },
      { key: "claim_aging", label: "Claim undecided", audience: ["ceo"], tab: "Claims", threshold_label: "days", default_threshold: 7, enabled: true, threshold: 7, open: 0 },
      { key: "asset_warranty", label: "Asset warranty ending", audience: ["ceo", "hr_admin"], tab: "Assets", threshold_label: "days ahead", default_threshold: 30, enabled: false, threshold: 30, open: 0 },
      { key: "leave_aging", label: "Leave request waiting too long", audience: ["ceo", "hr_admin"], tab: "Leave", threshold_label: "days", default_threshold: 3, enabled: true, threshold: 3, open: 1 },
    ],
    open: [
      ...Array.from({ length: 11 }, (_, i) => ({ ref: `stock:${i + 1}`, watcher: "low_stock", title: `ELFIA Bawal Premium Extra Long ${i + 1} — ${i} left, below 5`, first_seen: `2026-09-${String(10 + (i % 9)).padStart(2, "0")} 08:00:00` })),
      { ref: "order:1042", watcher: "order_stuck", title: "Web order #1042 — paid 4 days ago, not shipped", first_seen: "2026-09-18 08:00:00" },
      { ref: "order:1051", watcher: "order_stuck", title: "Web order #1051 — paid 3 days ago, not shipped", first_seen: "2026-09-19 08:00:00" },
      { ref: "leave:12", watcher: "leave_aging", title: "NUR NASUHA BINTI ZAINAL ABIDIN — leave waiting 6 days", first_seen: "2026-09-16 08:00:00" },
    ],
    pending_migration: false,
  };
  if (p === "/staff/finance/pnl" || p === "/finance/pnl") data = { month: "2026-09", revenue_cents: 2000000, cogs_cents: 300000, expenses_cents: 1800000, net_cents: -100000, rows: [] };
  if (data === undefined) { onMissing(p0); return {}; }
  return data;
}

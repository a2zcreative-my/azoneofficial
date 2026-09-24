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
  if (p === "/auth/me") data = { user: { id: 9001, name: "Fixture Person", role: ROLE, email: "fixture@example.test", status: "active" } };
  if (p === "/staff/revenue") data = { month: "2026-09", last_month: "2026-08", tiktok: { this_cents: 125000, this_orders: 20, last_cents: 110000, last_orders: 18 }, invoiced: { this_cents: 200000, this_docs: 4, last_cents: 140000, last_docs: 3 } };
  if (p === "/staff/tabs/access") data = { overrides: {}, mine: { allow: [], deny: [] }, people: {} };
  if (p === "/staff/desk") data = { items: queue, counts: { tasks: 1 }, total: 1, missing: [] };
  if (p === "/staff/overview") data = { inventory_status: [{ status: "in_stock", n: 1 }, { status: "low", n: 1 }], task_summary: [] };
  if (p === "/staff/inventory") data = { items };
  if (p === "/staff/inventory/bridge-health") data = { key_configured: true, applied_24h: 0, unknown_24h: 0, unknown: [] };
  if (p === "/staff/fulfilment/summary") data = { month: "2026-09", by_status: { preparing: 2, shipped: 3 }, oldest_preparing: null, orders: [] };
  if (p === "/staff/roster") data = { week_start: "2026-09-14", days: ["2026-09-14", "2026-09-15", "2026-09-16", "2026-09-17", "2026-09-18", "2026-09-19", "2026-09-20"], manager: true, sessions: [], on_leave: [], conflicts: [], requests: [], available_today: [], task_blocks: [], unscheduled: [], events: [] };
  if (p === "/staff/attendance/monitor") data = { date: "2026-09-16", staff: [] };
  if (p === "/staff/reports/outstanding") data = { invoices: [], total_cents: 0 };
  if (p === "/staff/payroll") data = { entries: [], release: { available_from: "2026-10-05 10:00:00", released: null, employer: "A2Z Creative Marketing" } };
  if (p === "/staff/hankeis") data = { can: { order_create: true, payment_verify: true, pack: true, settings: true }, counts: { awaiting_payment: 1, verified: 2 }, money: { verified_cents: 12000 }, open_exceptions: 0, outbox_pending: 0, recent: [{ id: 1, order_no: "HK-0001", total_cents: 6000, order_state: "open", payment_state: "awaiting_payment", fulfilment_state: "pending", created_at: "2026-09-20 10:00:00", customer_name: "Aina" }], setup: { qr_configured: true, recipient_configured: true, account_configured: true, ocr_available: false } };
  if (p === "/staff/hankeis/catalogue") data = { products: [], packages: [] };
  if (p === "/staff/hankeis/customers") data = { customers: [] };
  if (p === "/staff/sales-performance/overview") Object.assign(data, { me: 9001, can_manage: true, today: "2026-09-16", days: 1, tiktok_orders: [], range: { from: "2026-09-16", to: "2026-09-16", label: "today" } });
  return data;
}





const D = "2026-09-";
const staff = [
  { id: 9001, name: "Fixture Person", full_name: "Fixture Person", role: "ceo", email: "fixture@example.test", status: "active", is_active: 1, department: "Management", position: "CEO", employee_id: "A2Z-001" },
  { id: 9002, name: "Nur Aisyah", full_name: "Nur Aisyah binti Rahman", role: "sales_marketing", email: "aisyah@example.test", status: "active", is_active: 1, department: "Sales", position: "Sales Executive", employee_id: "A2Z-002", role_title: "Sales Executive — ELFIA accounts", responsibilities: "Answer every enquiry within 24 hours\nRaise quotations and invoices on the Sales tab\nLog every hotel call on the Hotels tab\nClose the day on Sales Performance", responsibilities_updated_at: "2026-09-15 10:12:00", responsibilities_updated_by_name: "Fixture Person" },
  { id: 9003, name: "Farid Zul", full_name: "Farid Zulkifli", role: "live_host", email: "farid@example.test", status: "active", is_active: 1, department: "Live", position: "Live Host", employee_id: "A2Z-003" },
  { id: 9004, name: "Mei Ling", full_name: "Tan Mei Ling", role: "hr_admin", email: "mei@example.test", status: "active", is_active: 0, department: "HR", position: "HR Admin", employee_id: "A2Z-004" },
];
const tasks = [
  { id: 1, title: "Check inventory delivery", description: "ELFIA restock arrives Tuesday.", priority: "high", deadline: D + "12", status: "open", progress: 20, assignee: "Nur Aisyah", assigned_to: 9002, item_count: 3, item_done: 1, acknowledged: 1 },
  { id: 2, title: "Prepare Raya live rundown", priority: "normal", deadline: D + "25", status: "in_progress", progress: 60, assignee: "Farid Zul", assigned_to: 9003, acknowledged: 0 },
  { id: 3, title: "Send September payslips", priority: "normal", deadline: D + "30", status: "open", progress: 0, assignee: "Mei Ling", assigned_to: 9004, acknowledged: 1 },
  { id: 4, title: "Renew studio insurance", priority: "low", deadline: D + "02", status: "completed", progress: 100, assignee: "Fixture Person", assigned_to: 9001, acknowledged: 1 },
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
  { id: 1, asset_tag: "A2Z-CAM-01", name: "Sony A7 IV", category: "studio", brand_model: "Sony ILCE-7M4", serial_no: "S123", purchase_date: "2025-03-01", purchase_price_cents: 1099900, vendor: "Shashinki", warranty_until: "2027-03-01", location: "Studio", assigned_to: 9003, assigned_name: "Farid Zul", status: "in_use", condition_note: null },
  { id: 2, asset_tag: "A2Z-LAP-02", name: "MacBook Air M3", category: "electronics", brand_model: "Apple", serial_no: "M456", purchase_date: "2025-06-10", purchase_price_cents: 549900, vendor: "Machines", warranty_until: "2026-06-10", location: "Office", assigned_to: 9002, assigned_name: "Nur Aisyah", status: "in_use", condition_note: null },
  { id: 3, asset_tag: "A2Z-LGT-03", name: "Godox SL60", category: "studio", brand_model: "Godox", serial_no: null, purchase_date: "2024-01-15", purchase_price_cents: 45000, vendor: null, warranty_until: null, location: "Studio", assigned_to: null, assigned_name: null, status: "repair", condition_note: "Fan noise" },
  { id: 4, asset_tag: "A2Z-TRP-04", name: "Manfrotto tripod", category: "studio", brand_model: null, serial_no: null, purchase_date: "2023-05-01", purchase_price_cents: 89000, vendor: null, warranty_until: null, location: "Store", assigned_to: null, assigned_name: null, status: "spare", condition_note: null },
];
const hotels = [
  { id: 1, state: "Melaka", hotel_name: "Casa del Rio", company: "Casa del Rio Sdn Bhd", address: "88 Jalan Kota Laksamana", rooms: 66, stars: "5", mof_validity: null, halal_validity: null, notes: null, contacts: [], stage: "agreed", last_contact_at: D + "10", next_at: D + "24", owner_id: 9002, review_url: null },
  { id: 2, state: "Pulau Pinang", hotel_name: "Eastern & Oriental", company: null, address: "10 Lebuh Farquhar", rooms: 100, stars: "5", mof_validity: null, halal_validity: null, notes: null, contacts: [], stage: "published", last_contact_at: D + "01", next_at: null, owner_id: 9002, review_url: "https://example.test/eo" },
  { id: 3, state: "Selangor", hotel_name: "Sunway Resort", company: null, address: null, rooms: 477, stars: "5", mof_validity: null, halal_validity: null, notes: null, contacts: [], stage: "contacted", last_contact_at: D + "14", next_at: D + "21", owner_id: 9003, review_url: null },
];
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
  { id: 1, doc_type: "QT", doc_number: "QT-AZO150926-1", company: "Aina Boutique", total_cents: 450000, payment_status: null, delivery_status: null, created_at: D + "15 10:00:00", salesperson_name: "Nur Aisyah" },
  { id: 2, doc_type: "INV", doc_number: "INV-AZO100926-2", company: "Zainab Kitchen", total_cents: 280000, payment_status: "paid", delivery_status: null, created_at: D + "10 10:00:00", paid_at: D + "12 10:00:00", salesperson_name: "Nur Aisyah" },
  { id: 3, doc_type: "INV", doc_number: "INV-AZO050926-3", company: "Casa del Rio Sdn Bhd", total_cents: 990000, payment_status: "unpaid", delivery_status: null, created_at: D + "05 10:00:00", salesperson_name: "Fixture Person" },
  { id: 4, doc_type: "INV", doc_number: "INV-AZO200826-4", company: "Hafiz Trading", total_cents: 120000, payment_status: "unpaid", delivery_status: null, created_at: "2026-08-20 10:00:00", salesperson_name: "Nur Aisyah" },
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

export function fixture(p0, url) {
  let data = baseFixture(p0);
  const q = url ? new URL(url).searchParams : new URLSearchParams();
  /* the panels' own prefixes: makeApi("/staff"), makeApi("/staff/erp"), makeApi("/staff/companies") */
  const p = p0.replace(/^\/staff\/erp(?=\/)/, "").replace(/^\/staff(?=\/(?:claims|stokis|content|task-reports|birthdays|expenses|hosts|banks|commission|cashflow|gl)\b)/, "");
  if (p === "/staff/tasks") data = { tasks };
  if (p === "/staff/staff-list" || p === "/staff-list") data = { staff: staff.map((s) => ({ id: s.id, name: s.name, role: s.role })) };
  if (p === "/staff/users") data = { users: staff, staff };
  if (p === "/staff/profile") data = { profile: { id: 9001, email: "fixture@example.test", name: "Fixture Person", role: ROLE, employee_id: "A2Z-001", position: "CEO", department: "Management", phone: "0123456789", employment_status: "permanent", photo_key: "staff/9001-fixture.jpg", role_title: "Chief Executive Officer", responsibilities: "Set the direction and the targets\nApprove claims, leave entitlement and payroll\nOwn the client relationships", responsibilities_updated_at: "2026-09-10 09:00:00" } };
  if (p === "/staff/announcements") data = { announcements };
  if (p === "/staff/leave") data = { leave: q.get("all") ? leave : leave.filter((l) => l.user_id === 9001) };
  if (p === "/staff/leave/balance") data = { balances: { annual: { entitled: 14, used: 2, accrued: 10.5 }, medical: { entitled: 14, used: 0, accrued: 14 }, emergency: { entitled: 3, used: 0, accrued: 3 }, unpaid: { entitled: 0, used: 0 }, replacement: { entitled: 0, used: 0, accrued: 1 } }, hourly: false };
  if (p === "/claims") data = { claims, can_decide: true };
  if (p === "/claims/mileage-rate") data = { cents_per_km: 60, can_set: true };
  if (p === "/enquiries") data = { enquiries: q.get("status") ? enquiries.filter((e) => e.status === q.get("status")) : enquiries, counts: { new: 2, overdue: 1, mine: 0, contacted: 1, qualified: 0, closed: 0 }, people: staff.map((s) => ({ id: s.id, name: s.name, role: s.role })), overdue_hours: 24 };
  if (p === "/staff/assets") data = { assets, can_remove: true };
  if (p === "/staff/hotels/" || p === "/staff/hotels") data = { hotels, states: ["Melaka", "Pulau Pinang", "Selangor"], by_state: { Melaka: 1, "Pulau Pinang": 1, Selangor: 1 }, state_pipeline: { Melaka: { contacted: 1, agreed: 1, published: 0 }, "Pulau Pinang": { contacted: 1, agreed: 1, published: 1 }, Selangor: { contacted: 1, agreed: 0, published: 0 } }, can_manage: true };
  if (p === "/staff/web-orders") data = { orders: q.get("status") ? webOrders.filter((o) => o.status === q.get("status")) : webOrders };
  if (p === "/stokis") data = { stokis, month: "2026-09" };
  if (p === "/content") data = { content };
  if (p === "/commission") data = { entries: commission };
  if (p === "/commission/rates") data = { rates: [{ id: 1, host_id: 9003, host_name: "Farid Zul", percent: 5, per_hour_cents: 0, effective_from: "2026-01-01" }] };
  if (p === "/hosts") data = { hosts: [{ id: 9003, name: "Farid Zul" }, { id: 9002, name: "Nur Aisyah" }] };
  if (p === "/cashflow") data = { entries: cash };
  if (p === "/banks") data = { banks: [{ id: 1, name: "Maybank", account_no: "5621", balance_cents: 2500000 }] };
  if (p === "/expenses") data = { expenses, upcoming: [], staff_payroll: null, staff_claims: { in_month: [], due: [], paid: [] } };
  if (p === "/staff/docs") data = { docs };
  if (p === "/staff/customers") data = { customers };
  if (p === "/gl/accounts") data = { accounts };
  if (p === "/gl/trial-balance") data = { accounts, rows: accounts };
  if (p === "/task-reports") data = { reports: [{ id: 1, report_date: D + "15", author: "Nur Aisyah", kind: "daily", content: "Called 6 hotels, 2 agreed to a stay." }] };
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
  return data;
}

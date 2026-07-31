var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/staff.ts
var PERMS = {
  // who can approve leave / view attendance reports / manage staff / birthdays
  hr_manage: ["super_admin", "managing_director", "ceo", "coo", "admin", "hr_admin"],
  // who can post announcements & create/assign tasks
  team_manage: ["super_admin", "managing_director", "ceo", "coo", "admin", "live_manager", "hr_admin"],
  // CRM + quotations + DO
  sales: ["super_admin", "managing_director", "business_dev", "finance_admin", "admin", "hr_admin"],
  // invoices & finance status changes
  finance: ["super_admin", "managing_director", "finance_admin", "admin", "hr_admin"],
  // HR task reports (daily / weekly / monthly)
  task_reports: ["super_admin", "managing_director", "admin", "hr_admin"],
  // inventory, postage tracking, marketing materials
  inventory: ["super_admin", "managing_director", "admin", "sales_marketing", "marketing", "coo"],
  // business development pipeline + strategy
  bd_manage: ["super_admin", "managing_director", "admin", "cco"],
  // daily operational + sales reports
  ops_manage: ["super_admin", "managing_director", "admin", "coo"],
  // read-only visibility across every module (CEO review & monitoring)
  exec_view: ["super_admin", "managing_director", "admin", "ceo", "coo", "cco"]
};
var POSTAGE_STATUSES = ["preparing", "shipped", "in_transit", "delivered", "returned"];
var BD_STATUSES = ["open", "pending", "kiv", "closed_won", "closed_lost"];
function stockStatus(stock) {
  return stock === 0 ? "out_of_stock" : stock <= 5 ? "low" : "in_stock";
}
__name(stockStatus, "stockStatus");
var SHIFT = {
  label: "10:00\u201318:00 MYT, Monday\u2013Friday",
  startMinutes: 10 * 60,
  endMinutes: 18 * 60
};
function can(user, perm) {
  return PERMS[perm].includes(user.role);
}
__name(can, "can");
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}
__name(json, "json");
function err(code, message, status) {
  return json({ error: { code, message } }, status);
}
__name(err, "err");
function str(v, max = 2e3) {
  return typeof v === "string" && v.trim().length > 0 && v.length <= max;
}
__name(str, "str");
async function notify(env, userId, kind, message, ref) {
  await env.DB.prepare(
    `INSERT INTO notifications (user_id, kind, message, ref) VALUES (?1, ?2, ?3, ?4)`
  ).bind(userId, kind, message, ref ?? null).run();
}
__name(notify, "notify");
async function audit(env, userId, action, entity, entityId) {
  await env.DB.prepare(
    `INSERT INTO audit_log (user_id, action, entity, entity_id) VALUES (?1, ?2, ?3, ?4)`
  ).bind(userId, action, entity ?? null, entityId ?? null).run();
}
__name(audit, "audit");
var LEAVE_TYPES = ["annual", "medical", "emergency", "unpaid", "replacement"];
var DEFAULT_ENTITLEMENT = { annual: 14, medical: 14, emergency: 3, replacement: 0, unpaid: 0 };
async function docNumber(env, docType) {
  const now = new Date(Date.now() + 8 * 3600 * 1e3);
  const day = now.toISOString().slice(0, 10).replace(/-/g, "");
  const dd = day.slice(6, 8);
  const mm = day.slice(4, 6);
  const yy = day.slice(2, 4);
  await env.DB.prepare(
    `INSERT INTO doc_counters_daily (doc_type, day, counter) VALUES (?1, ?2, 1)
     ON CONFLICT(doc_type, day) DO UPDATE SET counter = counter + 1`
  ).bind(docType, day).run();
  const row = await env.DB.prepare(
    `SELECT counter FROM doc_counters_daily WHERE doc_type = ?1 AND day = ?2`
  ).bind(docType, day).first();
  return `${docType}-AZOO${dd}${mm}${yy}-${row?.counter ?? 1}`;
}
__name(docNumber, "docNumber");
async function handleStaff(request, env, path, user) {
  const method = request.method;
  const body = ["POST", "PUT", "PATCH"].includes(method) ? await request.json().catch(() => null) : null;
  if (path === "/profile" && method === "GET") {
    const row = await env.DB.prepare(
      `SELECT id, email, name, role, employee_id, position, department, phone, employment_status
       FROM users WHERE id = ?1`
    ).bind(user.id).first();
    return json({ profile: row });
  }
  if (path === "/profile" && method === "PATCH") {
    const sets = [];
    const vals = [];
    if (str(body?.phone, 40)) {
      sets.push(`phone = ?${sets.length + 1}`);
      vals.push(body.phone);
    }
    if (str(body?.name, 120)) {
      sets.push(`name = ?${sets.length + 1}`);
      vals.push(body.name);
    }
    if (sets.length === 0) return err("invalid_input", "Nothing to update", 400);
    await env.DB.prepare(`UPDATE users SET ${sets.join(", ")} WHERE id = ?${sets.length + 1}`).bind(...vals, user.id).run();
    await audit(env, user.id, "staff.profile_update");
    return json({ ok: true });
  }
  if (path === "/users" && method === "GET") {
    if (!can(user, "hr_manage")) return err("forbidden", "HR access required", 403);
    const { results } = await env.DB.prepare(
      `SELECT id, name, email, role, employee_id, position, department, phone, employment_status, is_active
       FROM users ORDER BY name`
    ).all();
    return json({ users: results });
  }
  const staffUser = path.match(/^\/users\/(\d+)$/);
  if (staffUser && method === "PATCH") {
    if (!can(user, "hr_manage")) return err("forbidden", "HR access required", 403);
    const id = staffUser[1];
    const fields = ["employee_id", "position", "department", "employment_status", "birthday"];
    const sets = [];
    const vals = [];
    for (const f of fields) {
      if (str(body?.[f], 120)) {
        sets.push(`${f} = ?${sets.length + 1}`);
        vals.push(body[f]);
      }
    }
    if (sets.length === 0) return err("invalid_input", "Nothing to update", 400);
    await env.DB.prepare(`UPDATE users SET ${sets.join(", ")} WHERE id = ?${sets.length + 1}`).bind(...vals, id).run();
    await audit(env, user.id, "staff.hr_update", "users", id);
    return json({ ok: true });
  }
  if (path === "/attendance" && method === "POST") {
    const types = ["clock_in", "clock_out", "break_in", "break_out"];
    if (!body || typeof body.type !== "string" || !types.includes(body.type)) {
      return err("invalid_input", `type must be one of: ${types.join(", ")}`, 400);
    }
    await env.DB.prepare(
      `INSERT INTO attendance_records (user_id, type, ip, user_agent, gps)
       VALUES (?1, ?2, ?3, ?4, ?5)`
    ).bind(
      user.id,
      body.type,
      request.headers.get("CF-Connecting-IP"),
      (request.headers.get("User-Agent") ?? "").slice(0, 300),
      str(body.gps, 100) ? body.gps : null
    ).run();
    return json({ ok: true }, 201);
  }
  if (path === "/attendance" && method === "GET") {
    const url = new URL(request.url);
    const month = url.searchParams.get("month") ?? (/* @__PURE__ */ new Date()).toISOString().slice(0, 7);
    const targetUser = url.searchParams.get("user_id");
    const forUser = targetUser && can(user, "hr_manage") ? Number(targetUser) : user.id;
    const { results } = await env.DB.prepare(
      `SELECT type, ip, created_at FROM attendance_records
       WHERE user_id = ?1 AND created_at LIKE ?2 || '%'
       ORDER BY created_at DESC LIMIT 400`
    ).bind(forUser, month).all();
    return json({ month, records: results });
  }
  if (path === "/attendance/report" && method === "GET") {
    if (!can(user, "hr_manage")) return err("forbidden", "HR access required", 403);
    const url = new URL(request.url);
    const month = url.searchParams.get("month") ?? (/* @__PURE__ */ new Date()).toISOString().slice(0, 7);
    const { results } = await env.DB.prepare(
      `SELECT u.name, u.email, a.user_id, a.type, a.created_at
       FROM attendance_records a JOIN users u ON u.id = a.user_id
       WHERE a.created_at LIKE ?1 || '%' ORDER BY a.created_at`
    ).bind(month).all();
    const annotated = results.map((r) => {
      const myt = new Date((/* @__PURE__ */ new Date(r.created_at + "Z")).getTime() + 8 * 3600 * 1e3);
      const dayIdx = myt.getUTCDay();
      const minutes = myt.getUTCHours() * 60 + myt.getUTCMinutes();
      const workday = dayIdx >= 1 && dayIdx <= 5;
      return {
        ...r,
        myt_time: myt.toISOString().slice(0, 16).replace("T", " "),
        workday,
        flag: !workday ? "weekend" : r.type === "clock_in" && minutes > SHIFT.startMinutes ? "late" : r.type === "clock_out" && minutes < SHIFT.endMinutes ? "early_out" : "ok"
      };
    });
    return json({ month, shift: SHIFT.label, records: annotated });
  }
  if (path === "/leave" && method === "POST") {
    if (!body || typeof body.type !== "string" || !LEAVE_TYPES.includes(body.type) || !str(body.start_date, 10) || !str(body.end_date, 10) || typeof body.days !== "number" || body.days <= 0 || body.days > 60) {
      return err("invalid_input", "type, start_date, end_date, and days are required", 400);
    }
    const res = await env.DB.prepare(
      `INSERT INTO leave_requests (user_id, type, start_date, end_date, days, reason, mc_media_id)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) RETURNING id`
    ).bind(
      user.id,
      body.type,
      body.start_date,
      body.end_date,
      body.days,
      str(body.reason, 1e3) ? body.reason : null,
      typeof body.mc_media_id === "number" ? body.mc_media_id : null
    ).first();
    await audit(env, user.id, "leave.apply", "leave_requests", String(res?.id));
    return json({ id: res?.id }, 201);
  }
  if (path === "/leave" && method === "GET") {
    const url = new URL(request.url);
    const all = url.searchParams.get("all") === "1" && can(user, "hr_manage");
    const { results } = await env.DB.prepare(
      all ? `SELECT l.*, u.name AS user_name FROM leave_requests l JOIN users u ON u.id = l.user_id ORDER BY l.created_at DESC LIMIT 200` : `SELECT * FROM leave_requests WHERE user_id = ?1 ORDER BY created_at DESC LIMIT 100`
    ).bind(...all ? [] : [user.id]).all();
    return json({ leave: results });
  }
  if (path === "/leave/balance" && method === "GET") {
    const year = (/* @__PURE__ */ new Date()).getFullYear();
    const balances = {};
    for (const t of LEAVE_TYPES) {
      const ent = await env.DB.prepare(
        `SELECT entitled FROM leave_balances WHERE user_id = ?1 AND year = ?2 AND type = ?3`
      ).bind(user.id, year, t).first();
      const used = await env.DB.prepare(
        `SELECT COALESCE(SUM(days), 0) AS used FROM leave_requests
         WHERE user_id = ?1 AND type = ?2 AND status = 'approved'
         AND start_date LIKE ?3 || '%'`
      ).bind(user.id, t, String(year)).first();
      balances[t] = { entitled: ent?.entitled ?? DEFAULT_ENTITLEMENT[t] ?? 0, used: used?.used ?? 0 };
    }
    return json({ year, balances });
  }
  const leaveMatch = path.match(/^\/leave\/(\d+)$/);
  if (leaveMatch && method === "PATCH") {
    const id = leaveMatch[1];
    const row = await env.DB.prepare(
      `SELECT user_id, status FROM leave_requests WHERE id = ?1`
    ).bind(id).first();
    if (!row) return err("not_found", "Leave request not found", 404);
    const action = body?.action;
    if (action === "cancel") {
      if (row.user_id !== user.id || row.status !== "pending") {
        return err("forbidden", "Only your own pending requests can be cancelled", 403);
      }
      await env.DB.prepare(`UPDATE leave_requests SET status = 'cancelled' WHERE id = ?1`).bind(id).run();
      return json({ ok: true });
    }
    if (action === "approve" || action === "reject") {
      if (!can(user, "hr_manage")) return err("forbidden", "Approval rights required", 403);
      if (row.status !== "pending") return err("invalid_input", "Request is not pending", 400);
      const status = action === "approve" ? "approved" : "rejected";
      await env.DB.prepare(
        `UPDATE leave_requests SET status = ?1, reviewed_by = ?2, review_comment = ?3 WHERE id = ?4`
      ).bind(status, user.id, str(body?.comment, 500) ? body.comment : null, id).run();
      await notify(env, row.user_id, "leave", `Your leave request #${id} was ${status}`, `leave:${id}`);
      await audit(env, user.id, `leave.${action}`, "leave_requests", id);
      return json({ ok: true });
    }
    return err("invalid_input", "action must be cancel, approve, or reject", 400);
  }
  if (path === "/announcements" && method === "GET") {
    const { results } = await env.DB.prepare(
      `SELECT a.*, (SELECT COUNT(*) FROM announcement_acks k
                    WHERE k.announcement_id = a.id AND k.user_id = ?1) AS acked
       FROM announcements a ORDER BY a.created_at DESC LIMIT 50`
    ).bind(user.id).all();
    return json({ announcements: results });
  }
  if (path === "/announcements" && method === "POST") {
    if (!can(user, "team_manage")) return err("forbidden", "Management access required", 403);
    if (!body || !str(body.title, 200) || !str(body.body, 5e3)) {
      return err("invalid_input", "title and body are required", 400);
    }
    const cats = ["news", "meeting", "holiday", "kpi", "training"];
    const category = typeof body.category === "string" && cats.includes(body.category) ? body.category : "news";
    const res = await env.DB.prepare(
      `INSERT INTO announcements (title, body, category, created_by) VALUES (?1, ?2, ?3, ?4) RETURNING id`
    ).bind(body.title, body.body, category, user.id).first();
    await audit(env, user.id, "announcement.create", "announcements", String(res?.id));
    return json({ id: res?.id }, 201);
  }
  const ackMatch = path.match(/^\/announcements\/(\d+)\/ack$/);
  if (ackMatch && method === "POST") {
    await env.DB.prepare(
      `INSERT INTO announcement_acks (announcement_id, user_id) VALUES (?1, ?2)
       ON CONFLICT(announcement_id, user_id) DO NOTHING`
    ).bind(ackMatch[1], user.id).run();
    return json({ ok: true });
  }
  if (path === "/tasks" && method === "GET") {
    const url = new URL(request.url);
    const all = url.searchParams.get("all") === "1" && can(user, "team_manage");
    const { results } = await env.DB.prepare(
      all ? `SELECT t.*, u.name AS assignee FROM tasks t JOIN users u ON u.id = t.assigned_to ORDER BY t.created_at DESC LIMIT 200` : `SELECT * FROM tasks WHERE assigned_to = ?1 ORDER BY created_at DESC LIMIT 100`
    ).bind(...all ? [] : [user.id]).all();
    return json({ tasks: results });
  }
  if (path === "/tasks" && method === "POST") {
    if (!can(user, "team_manage")) return err("forbidden", "Management access required", 403);
    if (!body || !str(body.title, 200) || typeof body.assigned_to !== "number") {
      return err("invalid_input", "title and assigned_to are required", 400);
    }
    const prio = ["low", "normal", "high", "urgent"];
    const res = await env.DB.prepare(
      `INSERT INTO tasks (title, description, assigned_to, created_by, priority, deadline)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6) RETURNING id`
    ).bind(
      body.title,
      str(body.description, 5e3) ? body.description : null,
      body.assigned_to,
      user.id,
      typeof body.priority === "string" && prio.includes(body.priority) ? body.priority : "normal",
      str(body.deadline, 10) ? body.deadline : null
    ).first();
    await notify(env, body.assigned_to, "task", `New task assigned: ${body.title}`, `task:${res?.id}`);
    await audit(env, user.id, "task.create", "tasks", String(res?.id));
    return json({ id: res?.id }, 201);
  }
  const taskMatch = path.match(/^\/tasks\/(\d+)$/);
  if (taskMatch && method === "PATCH") {
    const id = taskMatch[1];
    const row = await env.DB.prepare(`SELECT assigned_to FROM tasks WHERE id = ?1`).bind(id).first();
    if (!row) return err("not_found", "Task not found", 404);
    if (row.assigned_to !== user.id && !can(user, "team_manage")) {
      return err("forbidden", "Not your task", 403);
    }
    const sets = [];
    const vals = [];
    if (typeof body?.progress === "number" && body.progress >= 0 && body.progress <= 100) {
      sets.push(`progress = ?${sets.length + 1}`);
      vals.push(body.progress);
    }
    if (typeof body?.status === "string" && ["open", "in_progress", "completed"].includes(body.status)) {
      sets.push(`status = ?${sets.length + 1}`);
      vals.push(body.status);
    }
    if (sets.length === 0) return err("invalid_input", "Nothing to update", 400);
    await env.DB.prepare(`UPDATE tasks SET ${sets.join(", ")} WHERE id = ?${sets.length + 1}`).bind(...vals, id).run();
    return json({ ok: true });
  }
  const commentMatch = path.match(/^\/tasks\/(\d+)\/comments$/);
  if (commentMatch && method === "POST") {
    if (!body || !str(body.comment, 2e3)) return err("invalid_input", "comment is required", 400);
    await env.DB.prepare(
      `INSERT INTO task_comments (task_id, user_id, comment, attachment_media_id) VALUES (?1, ?2, ?3, ?4)`
    ).bind(
      commentMatch[1],
      user.id,
      body.comment,
      typeof body.attachment_media_id === "number" ? body.attachment_media_id : null
    ).run();
    return json({ ok: true }, 201);
  }
  if (commentMatch && method === "GET") {
    const { results } = await env.DB.prepare(
      `SELECT c.comment, c.created_at, u.name FROM task_comments c
       JOIN users u ON u.id = c.user_id WHERE c.task_id = ?1 ORDER BY c.created_at`
    ).bind(commentMatch[1]).all();
    return json({ comments: results });
  }
  if (path === "/customers" && (method === "GET" || method === "POST")) {
    if (!can(user, "sales")) return err("forbidden", "Sales access required", 403);
    if (method === "GET") {
      const { results } = await env.DB.prepare(
        `SELECT * FROM customers ORDER BY company LIMIT 300`
      ).all();
      return json({ customers: results });
    }
    if (!body || !str(body.company, 200)) return err("invalid_input", "company is required", 400);
    const res = await env.DB.prepare(
      `INSERT INTO customers (company, contact_person, phone, email, address, notes, created_by)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) RETURNING id`
    ).bind(
      body.company,
      str(body.contact_person, 120) ? body.contact_person : null,
      str(body.phone, 40) ? body.phone : null,
      str(body.email, 200) ? body.email : null,
      str(body.address, 500) ? body.address : null,
      str(body.notes, 2e3) ? body.notes : null,
      user.id
    ).first();
    await audit(env, user.id, "customer.create", "customers", String(res?.id));
    return json({ id: res?.id }, 201);
  }
  const custMatch = path.match(/^\/customers\/(\d+)$/);
  if (custMatch && method === "PUT") {
    if (!can(user, "sales")) return err("forbidden", "Sales access required", 403);
    const fields = ["company", "contact_person", "phone", "email", "address", "notes"];
    const sets = [];
    const vals = [];
    for (const f of fields) {
      if (str(body?.[f], 2e3)) {
        sets.push(`${f} = ?${sets.length + 1}`);
        vals.push(body[f]);
      }
    }
    if (sets.length === 0) return err("invalid_input", "Nothing to update", 400);
    await env.DB.prepare(`UPDATE customers SET ${sets.join(", ")} WHERE id = ?${sets.length + 1}`).bind(...vals, custMatch[1]).run();
    return json({ ok: true });
  }
  if (path === "/docs" && method === "GET") {
    if (!can(user, "sales")) return err("forbidden", "Sales access required", 403);
    const url = new URL(request.url);
    const t = url.searchParams.get("type");
    const filter = t && ["QT", "DO", "INV"].includes(t) ? `WHERE d.doc_type = '${t}'` : "";
    const { results } = await env.DB.prepare(
      `SELECT d.*, c.company FROM sales_documents d
       JOIN customers c ON c.id = d.customer_id ${filter}
       ORDER BY d.created_at DESC LIMIT 200`
    ).all();
    return json({ docs: results });
  }
  if (path === "/docs" && method === "POST") {
    if (!body || typeof body.doc_type !== "string" || !["QT", "DO", "INV"].includes(body.doc_type)) {
      return err("invalid_input", "doc_type must be QT, DO, or INV", 400);
    }
    const docType = body.doc_type;
    if (docType === "INV" ? !can(user, "finance") : !can(user, "sales")) {
      return err("forbidden", "Insufficient rights for this document type", 403);
    }
    if (typeof body.customer_id !== "number" || !Array.isArray(body.items) || body.items.length === 0) {
      return err("invalid_input", "customer_id and items are required", 400);
    }
    const items = body.items.filter((i) => str(i.name, 200) && typeof i.qty === "number" && i.qty > 0 && typeof i.unit_price_cents === "number" && i.unit_price_cents >= 0).map((i) => ({ name: i.name, qty: i.qty, unit_price_cents: i.unit_price_cents }));
    if (items.length === 0) return err("invalid_input", "Each item needs name, qty, unit_price_cents", 400);
    const subtotal = items.reduce((s, i) => s + i.qty * i.unit_price_cents, 0);
    const discount = typeof body.discount_cents === "number" && body.discount_cents >= 0 ? body.discount_cents : 0;
    const taxPct = typeof body.tax_percent === "number" && body.tax_percent >= 0 ? body.tax_percent : 0;
    const total = Math.max(0, Math.round((subtotal - discount) * (1 + taxPct / 100)));
    const number = await docNumber(env, docType);
    const res = await env.DB.prepare(
      `INSERT INTO sales_documents
       (doc_type, doc_number, customer_id, items, discount_cents, tax_percent, total_cents,
        notes, valid_until, delivery_status, payment_status, due_date, created_by)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13) RETURNING id`
    ).bind(
      docType,
      number,
      body.customer_id,
      JSON.stringify(items),
      discount,
      taxPct,
      total,
      str(body.notes, 2e3) ? body.notes : null,
      docType === "QT" && str(body.valid_until, 10) ? body.valid_until : null,
      docType === "DO" ? "pending" : null,
      docType === "INV" ? "unpaid" : null,
      docType === "INV" && str(body.due_date, 10) ? body.due_date : null,
      user.id
    ).first();
    await audit(env, user.id, `doc.create_${docType.toLowerCase()}`, "sales_documents", String(res?.id));
    return json({ id: res?.id, doc_number: number, total_cents: total }, 201);
  }
  const docMatch = path.match(/^\/docs\/(\d+)$/);
  if (docMatch && method === "PATCH") {
    const id = docMatch[1];
    const doc = await env.DB.prepare(`SELECT doc_type FROM sales_documents WHERE id = ?1`).bind(id).first();
    if (!doc) return err("not_found", "Document not found", 404);
    if (doc.doc_type === "INV") {
      if (!can(user, "finance")) return err("forbidden", "Finance access required", 403);
      const ok = typeof body?.payment_status === "string" && ["unpaid", "paid", "overdue"].includes(body.payment_status);
      if (!ok) return err("invalid_input", "payment_status must be unpaid|paid|overdue", 400);
      await env.DB.prepare(`UPDATE sales_documents SET payment_status = ?1 WHERE id = ?2`).bind(body.payment_status, id).run();
    } else if (doc.doc_type === "DO") {
      if (!can(user, "sales")) return err("forbidden", "Sales access required", 403);
      const ok = typeof body?.delivery_status === "string" && ["pending", "delivered"].includes(body.delivery_status);
      if (!ok) return err("invalid_input", "delivery_status must be pending|delivered", 400);
      await env.DB.prepare(`UPDATE sales_documents SET delivery_status = ?1 WHERE id = ?2`).bind(body.delivery_status, id).run();
    } else {
      return err("invalid_input", "Quotations have no status updates yet", 400);
    }
    await audit(env, user.id, "doc.update_status", "sales_documents", id);
    return json({ ok: true });
  }
  if (path === "/task-reports" && method === "GET") {
    if (!can(user, "task_reports") && !can(user, "exec_view")) {
      return err("forbidden", "HR or executive access required", 403);
    }
    const { results } = await env.DB.prepare(
      `SELECT t.id, t.period, t.report_date, t.content, t.created_at, u.name AS author
       FROM task_reports t LEFT JOIN users u ON u.id = t.created_by
       ORDER BY t.report_date DESC, t.id DESC LIMIT 100`
    ).all();
    return json({ reports: results });
  }
  if (path === "/task-reports" && method === "POST") {
    if (!can(user, "task_reports")) return err("forbidden", "HR access required", 403);
    const periods = ["daily", "weekly", "monthly"];
    if (!body || typeof body.period !== "string" || !periods.includes(body.period) || !str(body.report_date, 10) || !str(body.content, 8e3)) {
      return err("invalid_input", "period (daily/weekly/monthly), report_date and content are required", 400);
    }
    await env.DB.prepare(
      `INSERT INTO task_reports (period, report_date, content, created_by) VALUES (?1, ?2, ?3, ?4)`
    ).bind(body.period, body.report_date, body.content, user.id).run();
    await audit(env, user.id, "hr.task_report", "task_reports");
    return json({ ok: true }, 201);
  }
  if (path === "/birthdays" && method === "GET") {
    const { results } = await env.DB.prepare(
      `SELECT name, birthday FROM users
       WHERE birthday IS NOT NULL AND is_active = 1 AND role != 'customer'
       ORDER BY substr(birthday, 6)`
    ).all();
    return json({ birthdays: results });
  }
  if (path === "/inventory" && method === "GET") {
    if (!can(user, "inventory") && !can(user, "exec_view")) {
      return err("forbidden", "Inventory access required", 403);
    }
    const { results } = await env.DB.prepare(
      `SELECT i.*, u.name AS updated_by_name FROM inventory_items i
       LEFT JOIN users u ON u.id = i.updated_by ORDER BY i.name`
    ).all();
    return json({ items: results });
  }
  if (path === "/inventory" && method === "POST") {
    if (!can(user, "inventory")) return err("forbidden", "Inventory access required", 403);
    if (!body || !str(body.sku, 60) || !str(body.name, 200)) {
      return err("invalid_input", "sku and name are required", 400);
    }
    const stock = typeof body.stock === "number" && body.stock >= 0 ? Math.floor(body.stock) : 0;
    try {
      await env.DB.prepare(
        `INSERT INTO inventory_items (sku, name, stock, status, note, updated_by)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)`
      ).bind(body.sku, body.name, stock, stockStatus(stock), str(body.note, 500) ? body.note : null, user.id).run();
    } catch {
      return err("conflict", "An item with this SKU already exists", 409);
    }
    await audit(env, user.id, "inventory.create");
    return json({ ok: true }, 201);
  }
  const invMatch = path.match(/^\/inventory\/(\d+)$/);
  if (invMatch && method === "PATCH") {
    if (!can(user, "inventory")) return err("forbidden", "Inventory access required", 403);
    if (!body || typeof body.stock !== "number" || body.stock < 0) {
      return err("invalid_input", "stock (>= 0) is required", 400);
    }
    const stock = Math.floor(body.stock);
    await env.DB.prepare(
      `UPDATE inventory_items SET stock = ?1, status = ?2,
         note = COALESCE(?3, note), updated_by = ?4, updated_at = datetime('now')
       WHERE id = ?5`
    ).bind(stock, stockStatus(stock), str(body.note, 500) ? body.note : null, user.id, invMatch[1]).run();
    await audit(env, user.id, "inventory.update", "inventory_items", invMatch[1]);
    return json({ ok: true });
  }
  if (path === "/postage" && method === "GET") {
    if (!can(user, "inventory") && !can(user, "exec_view")) {
      return err("forbidden", "Access required", 403);
    }
    const { results } = await env.DB.prepare(
      `SELECT * FROM postage_records ORDER BY updated_at DESC LIMIT 200`
    ).all();
    return json({ records: results });
  }
  if (path === "/postage" && method === "POST") {
    if (!can(user, "inventory")) return err("forbidden", "Access required", 403);
    if (!body || !str(body.order_ref, 100)) return err("invalid_input", "order_ref is required", 400);
    await env.DB.prepare(
      `INSERT INTO postage_records (order_ref, courier, tracking_no, status, note, updated_by)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)`
    ).bind(
      body.order_ref,
      str(body.courier, 80) ? body.courier : null,
      str(body.tracking_no, 120) ? body.tracking_no : null,
      POSTAGE_STATUSES.includes(body.status) ? body.status : "preparing",
      str(body.note, 500) ? body.note : null,
      user.id
    ).run();
    await audit(env, user.id, "postage.create");
    return json({ ok: true }, 201);
  }
  const postMatch = path.match(/^\/postage\/(\d+)$/);
  if (postMatch && method === "PATCH") {
    if (!can(user, "inventory")) return err("forbidden", "Access required", 403);
    if (!body || !POSTAGE_STATUSES.includes(body.status)) {
      return err("invalid_input", `status must be one of: ${POSTAGE_STATUSES.join(", ")}`, 400);
    }
    await env.DB.prepare(
      `UPDATE postage_records SET status = ?1, tracking_no = COALESCE(?2, tracking_no),
         note = COALESCE(?3, note), updated_by = ?4, updated_at = datetime('now') WHERE id = ?5`
    ).bind(
      body.status,
      str(body.tracking_no, 120) ? body.tracking_no : null,
      str(body.note, 500) ? body.note : null,
      user.id,
      postMatch[1]
    ).run();
    await audit(env, user.id, "postage.update", "postage_records", postMatch[1]);
    return json({ ok: true });
  }
  if (path === "/materials" && method === "GET") {
    if (!can(user, "inventory") && !can(user, "exec_view")) {
      return err("forbidden", "Access required", 403);
    }
    const { results } = await env.DB.prepare(
      `SELECT m.*, u.name AS requested_by_name FROM material_requests m
       LEFT JOIN users u ON u.id = m.requested_by ORDER BY m.created_at DESC LIMIT 100`
    ).all();
    return json({ materials: results });
  }
  if (path === "/materials" && method === "POST") {
    if (!can(user, "inventory")) return err("forbidden", "Access required", 403);
    if (!body || !str(body.title, 200)) return err("invalid_input", "title is required", 400);
    await env.DB.prepare(
      `INSERT INTO material_requests (title, description, requested_by) VALUES (?1, ?2, ?3)`
    ).bind(body.title, str(body.description, 2e3) ? body.description : null, user.id).run();
    await audit(env, user.id, "materials.create");
    return json({ ok: true }, 201);
  }
  const matMatch = path.match(/^\/materials\/(\d+)$/);
  if (matMatch && method === "PATCH") {
    if (!can(user, "inventory")) return err("forbidden", "Access required", 403);
    const statuses = ["requested", "in_progress", "done", "rejected"];
    if (!body || !statuses.includes(body.status)) {
      return err("invalid_input", `status must be one of: ${statuses.join(", ")}`, 400);
    }
    await env.DB.prepare(
      `UPDATE material_requests SET status = ?1, updated_at = datetime('now') WHERE id = ?2`
    ).bind(body.status, matMatch[1]).run();
    return json({ ok: true });
  }
  if (path === "/bd" && method === "GET") {
    if (!can(user, "bd_manage") && !can(user, "exec_view")) {
      return err("forbidden", "Commercial access required", 403);
    }
    const { results } = await env.DB.prepare(
      `SELECT b.*, u.name AS owner_name FROM bd_pipeline b
       LEFT JOIN users u ON u.id = b.owner_id
       ORDER BY CASE b.status WHEN 'open' THEN 0 WHEN 'pending' THEN 1 WHEN 'kiv' THEN 2 ELSE 3 END,
                b.updated_at DESC LIMIT 200`
    ).all();
    return json({ pipeline: results });
  }
  if (path === "/bd" && method === "POST") {
    if (!can(user, "bd_manage")) return err("forbidden", "Commercial access required", 403);
    if (!body || !str(body.client, 200)) return err("invalid_input", "client is required", 400);
    await env.DB.prepare(
      `INSERT INTO bd_pipeline (client, status, value_note, strategy, next_action, owner_id)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)`
    ).bind(
      body.client,
      BD_STATUSES.includes(body.status) ? body.status : "open",
      str(body.value_note, 300) ? body.value_note : null,
      str(body.strategy, 2e3) ? body.strategy : null,
      str(body.next_action, 300) ? body.next_action : null,
      user.id
    ).run();
    await audit(env, user.id, "bd.create");
    return json({ ok: true }, 201);
  }
  const bdMatch = path.match(/^\/bd\/(\d+)$/);
  if (bdMatch && method === "PATCH") {
    if (!can(user, "bd_manage")) return err("forbidden", "Commercial access required", 403);
    if (!body) return err("invalid_input", "Body required", 400);
    const sets = [];
    const vals = [];
    if (BD_STATUSES.includes(body.status)) {
      sets.push(`status = ?${sets.length + 1}`);
      vals.push(body.status);
    }
    if (str(body.strategy, 2e3)) {
      sets.push(`strategy = ?${sets.length + 1}`);
      vals.push(body.strategy);
    }
    if (str(body.next_action, 300)) {
      sets.push(`next_action = ?${sets.length + 1}`);
      vals.push(body.next_action);
    }
    if (str(body.value_note, 300)) {
      sets.push(`value_note = ?${sets.length + 1}`);
      vals.push(body.value_note);
    }
    if (sets.length === 0) return err("invalid_input", "Nothing to update", 400);
    sets.push(`updated_at = datetime('now')`);
    await env.DB.prepare(`UPDATE bd_pipeline SET ${sets.join(", ")} WHERE id = ?${vals.length + 1}`).bind(...vals, bdMatch[1]).run();
    await audit(env, user.id, "bd.update", "bd_pipeline", bdMatch[1]);
    return json({ ok: true });
  }
  if (path === "/ops-reports" && method === "GET") {
    if (!can(user, "ops_manage") && !can(user, "exec_view")) {
      return err("forbidden", "Operations access required", 403);
    }
    const { results } = await env.DB.prepare(
      `SELECT o.*, u.name AS author FROM ops_reports o
       LEFT JOIN users u ON u.id = o.created_by
       ORDER BY o.report_date DESC LIMIT 60`
    ).all();
    return json({ reports: results });
  }
  if (path === "/ops-reports" && method === "POST") {
    if (!can(user, "ops_manage")) return err("forbidden", "Operations access required", 403);
    if (!body || !str(body.report_date, 10) || !str(body.operational_summary, 8e3)) {
      return err("invalid_input", "report_date and operational_summary are required", 400);
    }
    await env.DB.prepare(
      `INSERT INTO ops_reports (report_date, operational_summary, sales_summary, strategy_note, created_by)
       VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT(report_date, created_by) DO UPDATE SET
         operational_summary = ?2, sales_summary = ?3, strategy_note = ?4`
    ).bind(
      body.report_date,
      body.operational_summary,
      str(body.sales_summary, 8e3) ? body.sales_summary : null,
      str(body.strategy_note, 4e3) ? body.strategy_note : null,
      user.id
    ).run();
    await audit(env, user.id, "ops.report", "ops_reports");
    return json({ ok: true }, 201);
  }
  if (path === "/overview" && method === "GET") {
    if (!can(user, "exec_view")) return err("forbidden", "Executive access required", 403);
    const today = new Date(Date.now() + 8 * 3600 * 1e3).toISOString().slice(0, 10);
    const [attendance, pendingLeave, docs, lowStock, bd, latestOps] = await Promise.all([
      env.DB.prepare(
        `SELECT COUNT(DISTINCT user_id) AS n FROM attendance_records
         WHERE type = 'clock_in' AND date(created_at, '+8 hours') = ?1`
      ).bind(today).first(),
      env.DB.prepare(`SELECT COUNT(*) AS n FROM leave_requests WHERE status = 'pending'`).first(),
      env.DB.prepare(
        `SELECT doc_type, COUNT(*) AS n FROM sales_documents GROUP BY doc_type`
      ).all(),
      env.DB.prepare(
        `SELECT COUNT(*) AS n FROM inventory_items WHERE status IN ('low', 'out_of_stock')`
      ).first(),
      env.DB.prepare(`SELECT status, COUNT(*) AS n FROM bd_pipeline GROUP BY status`).all(),
      env.DB.prepare(
        `SELECT report_date, operational_summary, sales_summary FROM ops_reports
         ORDER BY report_date DESC LIMIT 1`
      ).first()
    ]);
    return json({
      date: today,
      clocked_in_today: attendance?.n ?? 0,
      pending_leave: pendingLeave?.n ?? 0,
      documents: docs.results,
      low_stock_items: lowStock?.n ?? 0,
      bd_pipeline: bd.results,
      latest_ops_report: latestOps
    });
  }
  if (path === "/notifications" && method === "GET") {
    const { results } = await env.DB.prepare(
      `SELECT id, kind, message, ref, is_read, created_at FROM notifications
       WHERE user_id = ?1 ORDER BY created_at DESC LIMIT 50`
    ).bind(user.id).all();
    return json({ notifications: results });
  }
  if (path === "/notifications/read" && method === "POST") {
    await env.DB.prepare(`UPDATE notifications SET is_read = 1 WHERE user_id = ?1`).bind(user.id).run();
    return json({ ok: true });
  }
  return null;
}
__name(handleStaff, "handleStaff");

// src/index.ts
var PBKDF2_ITERATIONS = 1e5;
function toHex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
__name(toHex, "toHex");
async function hashPassword(password, saltHex, pepper, iterations) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(password + pepper),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const salt = new Uint8Array(
    saltHex.match(/.{2}/g).map((h) => parseInt(h, 16))
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    256
  );
  return toHex(bits);
}
__name(hashPassword, "hashPassword");
async function sha256Hex(input) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return toHex(buf);
}
__name(sha256Hex, "sha256Hex");
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
__name(timingSafeEqual, "timingSafeEqual");
function randomHex(bytes) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return toHex(arr.buffer);
}
__name(randomHex, "randomHex");
async function createPasswordHash(password, pepper) {
  const salt = randomHex(16);
  const hash = await hashPassword(password, salt, pepper, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${salt}$${hash}`;
}
__name(createPasswordHash, "createPasswordHash");
async function verifyPassword(password, stored, pepper) {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const iterations = parseInt(parts[1], 10);
  const salt = parts[2];
  const expected = parts[3];
  if (!salt || !expected || isNaN(iterations)) return false;
  const actual = await hashPassword(password, salt, pepper, iterations);
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) {
    diff |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}
__name(verifyPassword, "verifyPassword");
function json2(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...headers }
  });
}
__name(json2, "json");
function errorResponse(code, message, status) {
  return json2({ error: { code, message } }, status);
}
__name(errorResponse, "errorResponse");
function corsHeaders(env) {
  return {
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Credentials": "true"
  };
}
__name(corsHeaders, "corsHeaders");
function getCookie(req, name) {
  const cookie = req.headers.get("Cookie") ?? "";
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match?.[1] ?? null;
}
__name(getCookie, "getCookie");
var SESSION_COOKIE = "azone_session";
var SESSION_TTL_HOURS = 12;
var OAUTH_STATE_COOKIE = "azone_oauth_state";
async function createSession(env, userId) {
  const token = randomHex(32);
  const tokenHash = await sha256Hex(token);
  await env.DB.prepare(
    `INSERT INTO sessions (id, user_id, expires_at)
     VALUES (?1, ?2, datetime('now', '+${SESSION_TTL_HOURS} hours'))`
  ).bind(tokenHash, userId).run();
  await env.DB.prepare(`DELETE FROM sessions WHERE expires_at <= datetime('now')`).run();
  return token;
}
__name(createSession, "createSession");
function sessionCookie(token) {
  return `${SESSION_COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_HOURS * 3600}`;
}
__name(sessionCookie, "sessionCookie");
async function getSessionUser(req, env) {
  const raw = getCookie(req, SESSION_COOKIE);
  if (!raw) return null;
  const token = await sha256Hex(raw);
  const row = await env.DB.prepare(
    `SELECT u.id, u.email, u.name, u.role
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.id = ?1 AND s.expires_at > datetime('now') AND u.is_active = 1`
  ).bind(token).first();
  return row ?? null;
}
__name(getSessionUser, "getSessionUser");
var ROLE_RANK = {
  customer: 0,
  live_host: 0,
  marketing: 1,
  sales_marketing: 1,
  live_manager: 1,
  business_dev: 1,
  finance_admin: 1,
  hr_admin: 1,
  coo: 1,
  cco: 1,
  editor: 2,
  ceo: 3,
  managing_director: 3,
  admin: 3,
  super_admin: 4
};
function atLeast(user, role) {
  return !!user && ROLE_RANK[user.role] >= ROLE_RANK[role];
}
__name(atLeast, "atLeast");
async function audit2(env, userId, action, entity, entityId, detail) {
  await env.DB.prepare(
    `INSERT INTO audit_log (user_id, action, entity, entity_id, detail)
     VALUES (?1, ?2, ?3, ?4, ?5)`
  ).bind(userId, action, entity ?? null, entityId ?? null, detail ? JSON.stringify(detail) : null).run();
}
__name(audit2, "audit");
async function checkRateLimit(env, key, limit, windowSeconds) {
  const row = await env.DB.prepare(
    `SELECT count, window_start FROM rate_limits WHERE key = ?1`
  ).bind(key).first();
  const now = Date.now();
  const windowStart = row ? Date.parse(row.window_start + "Z") : 0;
  const inWindow = row && now - windowStart < windowSeconds * 1e3;
  if (inWindow && row.count >= limit) return false;
  if (inWindow) {
    await env.DB.prepare(`UPDATE rate_limits SET count = count + 1 WHERE key = ?1`).bind(key).run();
  } else {
    await env.DB.prepare(
      `INSERT INTO rate_limits (key, count, window_start) VALUES (?1, 1, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET count = 1, window_start = datetime('now')`
    ).bind(key).run();
  }
  return true;
}
__name(checkRateLimit, "checkRateLimit");
function clientIp(request) {
  return request.headers.get("CF-Connecting-IP") ?? "unknown";
}
__name(clientIp, "clientIp");
var CRUD = {
  products: {
    table: "products",
    columns: ["slug", "name", "category", "description", "price_cents", "inventory", "is_featured", "is_visible", "seo_title", "seo_description"],
    required: ["slug", "name"],
    orderBy: "created_at DESC"
  },
  posts: {
    table: "posts",
    columns: ["slug", "title", "excerpt", "body", "status", "publish_at", "category", "tags", "featured_media_id", "seo_title", "seo_description", "author_id"],
    required: ["slug", "title", "body"],
    orderBy: "created_at DESC"
  },
  portfolio: {
    table: "portfolio_items",
    columns: ["client", "summary", "result", "is_published"],
    required: ["client"],
    orderBy: "created_at DESC"
  },
  testimonials: {
    table: "testimonials",
    columns: ["author", "company", "position", "review", "rating", "photo_media_id", "is_published"],
    required: ["author", "review"],
    orderBy: "id DESC"
  }
};
function isNonEmptyString(v, max = 500) {
  return typeof v === "string" && v.trim().length > 0 && v.length <= max;
}
__name(isNonEmptyString, "isNonEmptyString");
var index_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const cors = corsHeaders(env);
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }
    if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) {
      const origin = request.headers.get("Origin");
      if (origin && origin !== env.ALLOWED_ORIGIN) {
        return errorResponse("forbidden_origin", "Origin not allowed", 403);
      }
    }
    let res;
    try {
      res = await route(request, env, path);
    } catch (err2) {
      console.error(err2);
      res = errorResponse("internal", "Something went wrong", 500);
    }
    const headers = new Headers(res.headers);
    for (const [k, v] of Object.entries(cors)) headers.set(k, v);
    return new Response(res.body, { status: res.status, headers });
  }
};
async function route(request, env, path) {
  const method = request.method;
  if (path === "/api/v1/health" && method === "GET") {
    return json2({ ok: true, service: "azoneofficial-api" });
  }
  if (path === "/api/v1/content-public" && method === "GET") {
    const { results } = await env.DB.prepare(
      `SELECT key, value FROM site_content`
    ).all();
    return json2(
      { content: results },
      200,
      { "Cache-Control": "public, max-age=60" }
    );
  }
  if (path === "/api/v1/enquiries" && method === "POST") {
    const allowed = await checkRateLimit(env, `enquiry:${clientIp(request)}`, 5, 3600);
    if (!allowed) {
      return errorResponse("rate_limited", "Too many submissions \u2014 please try again later or WhatsApp us", 429);
    }
    const body = await request.json().catch(() => null);
    if (!body || !isNonEmptyString(body.name, 120) || !isNonEmptyString(body.message, 4e3)) {
      return errorResponse("invalid_input", "name and message are required", 400);
    }
    await env.DB.prepare(
      `INSERT INTO enquiries (name, company, phone, email, message)
       VALUES (?1, ?2, ?3, ?4, ?5)`
    ).bind(
      body.name.trim(),
      isNonEmptyString(body.company, 200) ? body.company : null,
      isNonEmptyString(body.phone, 40) ? body.phone : null,
      isNonEmptyString(body.email, 200) ? body.email : null,
      body.message.trim()
    ).run();
    return json2({ ok: true }, 201);
  }
  if (path === "/api/v1/auth/login" && method === "POST") {
    const allowed = await checkRateLimit(env, `login:${clientIp(request)}`, 10, 900);
    if (!allowed) {
      return errorResponse("rate_limited", "Too many attempts \u2014 try again in 15 minutes", 429);
    }
    const body = await request.json().catch(() => null);
    if (!body || !isNonEmptyString(body.email, 200) || !isNonEmptyString(body.password, 200)) {
      return errorResponse("invalid_input", "email and password are required", 400);
    }
    const user2 = await env.DB.prepare(
      `SELECT id, email, name, role, password_hash FROM users
       WHERE email = ?1 AND is_active = 1`
    ).bind(body.email.toLowerCase().trim()).first();
    const ok = user2 && await verifyPassword(body.password, user2.password_hash, env.SESSION_PEPPER);
    if (!ok) {
      return errorResponse("invalid_credentials", "Email or password is incorrect", 401);
    }
    const token = await createSession(env, user2.id);
    await audit2(env, user2.id, "auth.login");
    return json2(
      { user: { id: user2.id, email: user2.email, name: user2.name, role: user2.role } },
      200,
      { "Set-Cookie": sessionCookie(token) }
    );
  }
  if (path === "/api/v1/auth/logout" && method === "POST") {
    const raw = getCookie(request, SESSION_COOKIE);
    if (raw) {
      await env.DB.prepare(`DELETE FROM sessions WHERE id = ?1`).bind(await sha256Hex(raw)).run();
    }
    return json2({ ok: true }, 200, {
      "Set-Cookie": `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`
    });
  }
  if (path === "/api/v1/auth/setup" && method === "POST") {
    const allowedSetup = await checkRateLimit(env, `setup:${clientIp(request)}`, 5, 3600);
    if (!allowedSetup) return errorResponse("rate_limited", "Too many attempts", 429);
    const existing = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM users WHERE role = 'super_admin'`
    ).first();
    if ((existing?.n ?? 0) > 0) {
      return errorResponse("gone", "Setup already completed", 410);
    }
    const body = await request.json().catch(() => null);
    if (!body || typeof body.token !== "string" || !env.SETUP_TOKEN || !timingSafeEqual(body.token, env.SETUP_TOKEN)) {
      return errorResponse("forbidden", "Invalid setup token", 403);
    }
    const emailOk = typeof body.email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(body.email);
    if (!emailOk || !isNonEmptyString(body.name, 120) || !isNonEmptyString(body.password, 200) || body.password.length < 10) {
      return errorResponse("invalid_input", "email, name, and a password of 10+ characters are required", 400);
    }
    const hash = await createPasswordHash(body.password, env.SESSION_PEPPER);
    const res = await env.DB.prepare(
      `INSERT INTO users (email, password_hash, name, role, is_active)
       VALUES (?1, ?2, ?3, 'super_admin', 1) RETURNING id`
    ).bind(body.email.toLowerCase().trim(), hash, body.name.trim()).first();
    await audit2(env, res?.id ?? null, "auth.bootstrap_super_admin", "users", String(res?.id));
    const token = await createSession(env, res.id);
    return json2({ ok: true }, 201, { "Set-Cookie": sessionCookie(token) });
  }
  if (path === "/api/v1/auth/register" && method === "POST") {
    const allowedReg = await checkRateLimit(env, `register:${clientIp(request)}`, 5, 3600);
    if (!allowedReg) return errorResponse("rate_limited", "Too many registrations \u2014 try again later", 429);
    const body = await request.json().catch(() => null);
    const emailOk = body && typeof body.email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(body.email);
    if (!body || !emailOk || !isNonEmptyString(body.name, 120) || !isNonEmptyString(body.password, 200) || body.password.length < 10) {
      return errorResponse("invalid_input", "Valid email, name, and a password of 10+ characters are required", 400);
    }
    const email = body.email.toLowerCase().trim();
    const hash = await createPasswordHash(body.password, env.SESSION_PEPPER);
    try {
      const res = await env.DB.prepare(
        `INSERT INTO users (email, password_hash, name, role, is_active)
         VALUES (?1, ?2, ?3, 'customer', 1) RETURNING id`
      ).bind(email, hash, body.name.trim()).first();
      await audit2(env, res?.id ?? null, "auth.register_customer", "users", String(res?.id));
      const token = await createSession(env, res.id);
      return json2(
        { ok: true, user: { id: res.id, email, name: body.name.trim(), role: "customer" } },
        201,
        { "Set-Cookie": sessionCookie(token) }
      );
    } catch {
      return errorResponse("conflict", "An account with this email already exists", 409);
    }
  }
  const redirectUri = `${env.ALLOWED_ORIGIN}/api/v1/auth/google/callback`;
  if (path === "/api/v1/auth/google" && method === "GET") {
    const state = randomHex(16);
    const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authUrl.searchParams.set("client_id", env.GOOGLE_CLIENT_ID);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", "openid email profile");
    authUrl.searchParams.set("state", state);
    authUrl.searchParams.set("prompt", "select_account");
    return new Response(null, {
      status: 302,
      headers: {
        Location: authUrl.toString(),
        "Set-Cookie": `${OAUTH_STATE_COOKIE}=${state}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`
      }
    });
  }
  if (path === "/api/v1/auth/google/callback" && method === "GET") {
    const url2 = new URL(request.url);
    const code = url2.searchParams.get("code");
    const state = url2.searchParams.get("state");
    const cookieState = getCookie(request, OAUTH_STATE_COOKIE);
    const clearState = `${OAUTH_STATE_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
    if (!code || !state || !cookieState || state !== cookieState) {
      return new Response(null, {
        status: 302,
        headers: { Location: "/admin?error=oauth", "Set-Cookie": clearState }
      });
    }
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        redirect_uri: redirectUri,
        grant_type: "authorization_code"
      })
    });
    const tokens = await tokenRes.json().catch(() => null);
    if (!tokenRes.ok || !tokens?.access_token) {
      return new Response(null, {
        status: 302,
        headers: { Location: "/admin?error=oauth", "Set-Cookie": clearState }
      });
    }
    const profileRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${tokens.access_token}` }
    });
    const profile = await profileRes.json().catch(() => null);
    if (!profileRes.ok || !profile?.email || profile.email_verified !== true) {
      return new Response(null, {
        status: 302,
        headers: { Location: "/admin?error=oauth", "Set-Cookie": clearState }
      });
    }
    const email = profile.email.toLowerCase().trim();
    let account = await env.DB.prepare(
      `SELECT id, is_active FROM users WHERE email = ?1`
    ).bind(email).first();
    if (!account) {
      const isCompany = email.endsWith(`@${env.COMPANY_DOMAIN}`);
      const res = await env.DB.prepare(
        `INSERT INTO users (email, password_hash, name, role, is_active)
         VALUES (?1, 'oauth$google', ?2, ?3, 1) RETURNING id, is_active`
      ).bind(email, profile.name ?? email, isCompany ? "marketing" : "customer").first();
      account = res;
      await audit2(env, null, isCompany ? "auth.google_signup_company" : "auth.google_signup_customer", "users", String(account.id));
    }
    if (!account.is_active) {
      return new Response(null, {
        status: 302,
        headers: { Location: "/admin?pending=1", "Set-Cookie": clearState }
      });
    }
    const roleRow = await env.DB.prepare(`SELECT role FROM users WHERE id = ?1`).bind(account.id).first();
    const dest = roleRow?.role === "customer" ? "/account" : ["ceo", "coo", "cco", "business_dev", "finance_admin", "live_manager", "live_host", "hr_admin", "sales_marketing", "managing_director"].includes(roleRow?.role ?? "") ? "/portal" : "/admin";
    const token = await createSession(env, account.id);
    await audit2(env, account.id, "auth.login_google");
    const headers = new Headers({ Location: dest });
    headers.append("Set-Cookie", sessionCookie(token));
    headers.append("Set-Cookie", clearState);
    return new Response(null, { status: 302, headers });
  }
  const user = await getSessionUser(request, env);
  if (path === "/api/v1/auth/change-password" && method === "POST") {
    if (!user) return errorResponse("unauthenticated", "Sign in required", 401);
    const body = await request.json().catch(() => null);
    if (!body || !isNonEmptyString(body.current_password, 200) || !isNonEmptyString(body.new_password, 200) || body.new_password.length < 10) {
      return errorResponse("invalid_input", "Current password and a new password of 10+ characters are required", 400);
    }
    const row = await env.DB.prepare(`SELECT password_hash FROM users WHERE id = ?1`).bind(user.id).first();
    if (!row || row.password_hash.startsWith("oauth$")) {
      return errorResponse("google_account", "This account signs in with Google and has no password to change", 400);
    }
    const valid = await verifyPassword(body.current_password, row.password_hash, env.SESSION_PEPPER);
    if (!valid) return errorResponse("invalid_credentials", "Current password is incorrect", 401);
    const hash = await createPasswordHash(body.new_password, env.SESSION_PEPPER);
    await env.DB.prepare(`UPDATE users SET password_hash = ?1 WHERE id = ?2`).bind(hash, user.id).run();
    await env.DB.prepare(`DELETE FROM sessions WHERE user_id = ?1`).bind(user.id).run();
    const fresh = await createSession(env, user.id);
    await audit2(env, user.id, "auth.change_password");
    return json2({ ok: true }, 200, { "Set-Cookie": sessionCookie(fresh) });
  }
  if (path === "/api/v1/auth/me" && method === "GET") {
    if (!user) return errorResponse("unauthenticated", "Sign in required", 401);
    return json2({ user });
  }
  if (path.startsWith("/api/v1/staff/")) {
    if (!user) return errorResponse("unauthenticated", "Sign in required", 401);
    if (user.role === "customer") return errorResponse("forbidden", "Staff access only", 403);
    const staffRes = await handleStaff(
      request,
      env,
      path.slice("/api/v1/staff".length),
      user
    );
    if (staffRes) return staffRes;
    return errorResponse("not_found", "Staff route not found", 404);
  }
  if (path === "/api/v1/enquiries" && method === "GET") {
    if (!atLeast(user, "marketing")) {
      return errorResponse("forbidden", "Marketing role or above required", 403);
    }
    const { results } = await env.DB.prepare(
      `SELECT id, name, company, phone, email, message, status, assigned_to, created_at
       FROM enquiries ORDER BY created_at DESC LIMIT 100`
    ).all();
    return json2({ enquiries: results });
  }
  if (path.match(/^\/api\/v1\/enquiries\/\d+$/) && method === "PATCH") {
    if (!atLeast(user, "marketing")) {
      return errorResponse("forbidden", "Marketing role or above required", 403);
    }
    const id = path.split("/").pop();
    const body = await request.json().catch(() => null);
    const allowed = ["new", "contacted", "qualified", "closed"];
    if (!body || typeof body.status !== "string" || !allowed.includes(body.status)) {
      return errorResponse("invalid_input", `status must be one of: ${allowed.join(", ")}`, 400);
    }
    await env.DB.prepare(`UPDATE enquiries SET status = ?1 WHERE id = ?2`).bind(body.status, id).run();
    await audit2(env, user.id, "enquiry.update_status", "enquiries", id, { status: body.status });
    return json2({ ok: true });
  }
  if (path === "/api/v1/dashboard/summary" && method === "GET") {
    if (!atLeast(user, "marketing")) {
      return errorResponse("forbidden", "Sign in required", 403);
    }
    const enquiries = await env.DB.prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN status = 'new' THEN 1 ELSE 0 END) AS new_count
       FROM enquiries`
    ).first();
    const posts = await env.DB.prepare(`SELECT COUNT(*) AS total FROM posts`).first();
    const portfolio = await env.DB.prepare(`SELECT COUNT(*) AS total FROM portfolio_items`).first();
    const testimonials = await env.DB.prepare(`SELECT COUNT(*) AS total FROM testimonials`).first();
    const { results: activity } = await env.DB.prepare(
      `SELECT a.action, a.entity, a.entity_id, a.created_at, u.name AS user_name
       FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
       ORDER BY a.created_at DESC LIMIT 15`
    ).all();
    return json2({ enquiries, posts, portfolio, testimonials, activity });
  }
  if (path === "/api/v1/account/enquiries" && method === "GET") {
    if (!user) return errorResponse("unauthenticated", "Sign in required", 401);
    const acct = await env.DB.prepare(
      `SELECT password_hash, created_at FROM users WHERE id = ?1`
    ).bind(user.id).first();
    const verified = acct?.password_hash.startsWith("oauth$") ?? false;
    const { results } = await env.DB.prepare(
      verified ? `SELECT id, message, status, created_at FROM enquiries
           WHERE email = ?1 ORDER BY created_at DESC LIMIT 50` : `SELECT id, message, status, created_at FROM enquiries
           WHERE email = ?1 AND created_at >= ?2 ORDER BY created_at DESC LIMIT 50`
    ).bind(...verified ? [user.email] : [user.email, acct?.created_at ?? ""]).all();
    return json2({ enquiries: results });
  }
  const contentMatch = path.match(/^\/api\/v1\/content\/([\w.\-]+)$/);
  if (contentMatch) {
    const key = contentMatch[1];
    if (method === "GET") {
      const row = await env.DB.prepare(`SELECT key, value, updated_at FROM site_content WHERE key = ?1`).bind(key).first();
      if (!row) return errorResponse("not_found", "No content for this key", 404);
      return json2(row);
    }
    if (method === "PUT") {
      if (!atLeast(user, "editor")) return errorResponse("forbidden", "Editor role or above required", 403);
      const body = await request.json().catch(() => null);
      if (!body || typeof body.value === "undefined") {
        return errorResponse("invalid_input", "value is required", 400);
      }
      await env.DB.prepare(
        `INSERT INTO site_content (key, value, updated_by, updated_at)
         VALUES (?1, ?2, ?3, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value = ?2, updated_by = ?3, updated_at = datetime('now')`
      ).bind(key, JSON.stringify(body.value), user.id).run();
      await audit2(env, user.id, "content.update", "site_content", key);
      return json2({ ok: true });
    }
  }
  const mediaServe = path.match(/^\/api\/v1\/media\/file\/(.+)$/);
  if (mediaServe && method === "GET") {
    const key = decodeURIComponent(mediaServe[1]);
    if (key.startsWith("private/") && (!user || user.role === "customer")) {
      return errorResponse("forbidden", "Staff access required", 403);
    }
    const obj = await env.MEDIA.get(key);
    if (!obj) return errorResponse("not_found", "File not found", 404);
    const headers = new Headers();
    obj.writeHttpMetadata(headers);
    headers.set("Cache-Control", "public, max-age=31536000, immutable");
    return new Response(obj.body, { headers });
  }
  if (path === "/api/v1/media" && method === "GET") {
    if (!atLeast(user, "editor")) return errorResponse("forbidden", "Editor role or above required", 403);
    const { results } = await env.DB.prepare(
      `SELECT id, r2_key, kind, alt, created_at FROM media ORDER BY created_at DESC LIMIT 200`
    ).all();
    return json2({ media: results });
  }
  if (path === "/api/v1/media" && method === "POST") {
    if (!atLeast(user, "editor")) return errorResponse("forbidden", "Editor role or above required", 403);
    const url2 = new URL(request.url);
    const filename = (url2.searchParams.get("filename") ?? "upload.bin").replace(/[^\w.\-]/g, "_");
    const kind = url2.searchParams.get("kind") ?? "image";
    if (!["image", "video", "document", "logo"].includes(kind)) {
      return errorResponse("invalid_input", "kind must be image|video|document|logo", 400);
    }
    if (!request.body) return errorResponse("invalid_input", "Request body required", 400);
    const key = `uploads/${Date.now()}-${filename}`;
    await env.MEDIA.put(key, request.body, {
      httpMetadata: { contentType: request.headers.get("Content-Type") ?? "application/octet-stream" }
    });
    const res = await env.DB.prepare(
      `INSERT INTO media (r2_key, kind, alt, uploaded_by) VALUES (?1, ?2, ?3, ?4) RETURNING id`
    ).bind(key, kind, url2.searchParams.get("alt"), user.id).first();
    await audit2(env, user.id, "media.upload", "media", String(res?.id ?? key));
    return json2({ id: res?.id, r2_key: key, url: `/api/v1/media/file/${encodeURIComponent(key)}` }, 201);
  }
  const mediaDelete = path.match(/^\/api\/v1\/media\/(\d+)$/);
  if (mediaDelete && method === "DELETE") {
    if (!atLeast(user, "editor")) return errorResponse("forbidden", "Editor role or above required", 403);
    const id = mediaDelete[1];
    const row = await env.DB.prepare(`SELECT r2_key FROM media WHERE id = ?1`).bind(id).first();
    if (!row) return errorResponse("not_found", "Media not found", 404);
    await env.MEDIA.delete(row.r2_key);
    await env.DB.prepare(`DELETE FROM media WHERE id = ?1`).bind(id).run();
    await audit2(env, user.id, "media.delete", "media", id);
    return json2({ ok: true });
  }
  const crudMatch = path.match(/^\/api\/v1\/(products|posts|portfolio|testimonials)(?:\/(\d+))?$/);
  if (crudMatch) {
    const cfg = CRUD[crudMatch[1]];
    const id = crudMatch[2];
    if (method === "GET" && !id) {
      const isEditor = atLeast(user, "editor");
      const publicFilter = cfg.table === "products" ? "WHERE is_visible = 1" : cfg.table === "posts" ? "WHERE status = 'published'" : "WHERE is_published = 1";
      const { results } = await env.DB.prepare(
        `SELECT * FROM ${cfg.table} ${isEditor ? "" : publicFilter} ORDER BY ${cfg.orderBy} LIMIT 200`
      ).all();
      return json2({ items: results });
    }
    if (method === "GET" && id) {
      const row = await env.DB.prepare(`SELECT * FROM ${cfg.table} WHERE id = ?1`).bind(id).first();
      if (!row) return errorResponse("not_found", "Not found", 404);
      return json2(row);
    }
    if (!atLeast(user, "editor")) return errorResponse("forbidden", "Editor role or above required", 403);
    const body = await request.json().catch(() => null);
    if (method === "POST" && !id) {
      if (!body || !cfg.required.every((c) => isNonEmptyString(body[c], 1e4))) {
        return errorResponse("invalid_input", `Required: ${cfg.required.join(", ")}`, 400);
      }
      const cols = cfg.columns.filter((c) => typeof body[c] !== "undefined");
      const placeholders = cols.map((_, i) => `?${i + 1}`).join(", ");
      const stmt = env.DB.prepare(
        `INSERT INTO ${cfg.table} (${cols.join(", ")}) VALUES (${placeholders}) RETURNING id`
      ).bind(...cols.map((c) => body[c]));
      const res = await stmt.first();
      await audit2(env, user.id, `${cfg.table}.create`, cfg.table, String(res?.id));
      return json2({ id: res?.id }, 201);
    }
    if (method === "PUT" && id) {
      if (!body) return errorResponse("invalid_input", "Body required", 400);
      const cols = cfg.columns.filter((c) => typeof body[c] !== "undefined");
      if (cols.length === 0) return errorResponse("invalid_input", "No writable fields provided", 400);
      const sets = cols.map((c, i) => `${c} = ?${i + 1}`).join(", ");
      await env.DB.prepare(`UPDATE ${cfg.table} SET ${sets} WHERE id = ?${cols.length + 1}`).bind(...cols.map((c) => body[c]), id).run();
      await audit2(env, user.id, `${cfg.table}.update`, cfg.table, id, { fields: cols });
      return json2({ ok: true });
    }
    if (method === "DELETE" && id) {
      if (!atLeast(user, "admin")) return errorResponse("forbidden", "Admin role or above required", 403);
      await env.DB.prepare(`DELETE FROM ${cfg.table} WHERE id = ?1`).bind(id).run();
      await audit2(env, user.id, `${cfg.table}.delete`, cfg.table, id);
      return json2({ ok: true });
    }
  }
  if (path === "/api/v1/content" && method === "GET") {
    if (!atLeast(user, "editor")) return errorResponse("forbidden", "Editor role or above required", 403);
    const { results } = await env.DB.prepare(
      `SELECT key, value, updated_at FROM site_content ORDER BY key`
    ).all();
    return json2({ content: results });
  }
  if (path === "/api/v1/users" && method === "GET") {
    if (!atLeast(user, "admin")) return errorResponse("forbidden", "Admin role required", 403);
    const { results } = await env.DB.prepare(
      `SELECT id, email, name, role, is_active, created_at FROM users ORDER BY id`
    ).all();
    return json2({ users: results });
  }
  if (path === "/api/v1/users" && method === "POST") {
    if (!atLeast(user, "admin")) return errorResponse("forbidden", "Admin role required", 403);
    const body = await request.json().catch(() => null);
    const roles = ["super_admin", "admin", "editor", "marketing", "managing_director", "ceo", "coo", "cco", "business_dev", "finance_admin", "live_manager", "live_host", "hr_admin", "sales_marketing", "customer"];
    if (!body || !isNonEmptyString(body.email, 200) || !isNonEmptyString(body.name, 120) || !isNonEmptyString(body.password, 200) || body.password.length < 10 || typeof body.role !== "string" || !roles.includes(body.role)) {
      return errorResponse("invalid_input", "email, name, role, and a password of 10+ characters are required", 400);
    }
    if (body.role === "super_admin" && !atLeast(user, "super_admin")) {
      return errorResponse("forbidden", "Only a super admin can create a super admin", 403);
    }
    const hash = await createPasswordHash(body.password, env.SESSION_PEPPER);
    try {
      const res = await env.DB.prepare(
        `INSERT INTO users (email, password_hash, name, role) VALUES (?1, ?2, ?3, ?4) RETURNING id`
      ).bind(body.email.toLowerCase().trim(), hash, body.name.trim(), body.role).first();
      await audit2(env, user.id, "user.create", "users", String(res?.id), { role: body.role });
      return json2({ id: res?.id }, 201);
    } catch {
      return errorResponse("conflict", "A user with this email already exists", 409);
    }
  }
  const userMatch = path.match(/^\/api\/v1\/users\/(\d+)$/);
  if (userMatch && method === "PATCH") {
    if (!atLeast(user, "admin")) return errorResponse("forbidden", "Admin role required", 403);
    const id = userMatch[1];
    const body = await request.json().catch(() => null);
    if (!body) return errorResponse("invalid_input", "Body required", 400);
    const target = await env.DB.prepare(`SELECT role FROM users WHERE id = ?1`).bind(id).first();
    if (!target) return errorResponse("not_found", "User not found", 404);
    if (target.role === "super_admin" && !atLeast(user, "super_admin")) {
      return errorResponse("forbidden", "Only a super admin can modify a super admin", 403);
    }
    if (body.role === "super_admin" && !atLeast(user, "super_admin")) {
      return errorResponse("forbidden", "Only a super admin can grant super admin", 403);
    }
    if (String(user.id) === id && typeof body.role === "string" && body.role !== user.role) {
      return errorResponse("invalid_input", "You cannot change your own role", 400);
    }
    const roles = ["super_admin", "admin", "editor", "marketing", "managing_director", "ceo", "coo", "cco", "business_dev", "finance_admin", "live_manager", "live_host", "hr_admin", "sales_marketing", "customer"];
    const changed = [];
    if (typeof body.role === "string" && roles.includes(body.role)) {
      await env.DB.prepare(`UPDATE users SET role = ?1 WHERE id = ?2`).bind(body.role, id).run();
      changed.push("role");
    }
    if (typeof body.is_active === "number") {
      if (String(user.id) === id && body.is_active === 0) {
        return errorResponse("invalid_input", "You cannot deactivate your own account", 400);
      }
      await env.DB.prepare(`UPDATE users SET is_active = ?1 WHERE id = ?2`).bind(body.is_active ? 1 : 0, id).run();
      if (!body.is_active) {
        await env.DB.prepare(`DELETE FROM sessions WHERE user_id = ?1`).bind(id).run();
      }
      changed.push("is_active");
    }
    if (isNonEmptyString(body.password, 200) && body.password.length >= 10) {
      const hash = await createPasswordHash(body.password, env.SESSION_PEPPER);
      await env.DB.prepare(`UPDATE users SET password_hash = ?1 WHERE id = ?2`).bind(hash, id).run();
      await env.DB.prepare(`DELETE FROM sessions WHERE user_id = ?1`).bind(id).run();
      changed.push("password");
    }
    if (changed.length === 0) return errorResponse("invalid_input", "Nothing to update", 400);
    await audit2(env, user.id, "user.update", "users", id, { changed });
    return json2({ ok: true });
  }
  const revokeMatch = path.match(/^\/api\/v1\/users\/(\d+)\/revoke-sessions$/);
  if (revokeMatch && method === "POST") {
    if (!atLeast(user, "admin")) return errorResponse("forbidden", "Admin role required", 403);
    const id = revokeMatch[1];
    const target = await env.DB.prepare(`SELECT role FROM users WHERE id = ?1`).bind(id).first();
    if (!target) return errorResponse("not_found", "User not found", 404);
    if (target.role === "super_admin" && !atLeast(user, "super_admin")) {
      return errorResponse("forbidden", "Only a super admin can force out a super admin", 403);
    }
    const res = await env.DB.prepare(`DELETE FROM sessions WHERE user_id = ?1`).bind(id).run();
    await audit2(env, user.id, "user.force_logout", "users", id, {
      sessions_revoked: res.meta.changes ?? 0
    });
    return json2({ ok: true, sessions_revoked: res.meta.changes ?? 0 });
  }
  return errorResponse("not_found", "Route not found", 404);
}
__name(route, "route");
export {
  createPasswordHash,
  index_default as default
};
//# sourceMappingURL=index.js.map

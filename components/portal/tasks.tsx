"use client";

/* Moved verbatim from app/portal/page.tsx in v1.114.0 (housekeeping: the
   605 KB page split by domain). Nothing here was rewritten; only the imports
   at the top are new and the declarations are exported. */
import { Sub } from "@/components/portal/leave";
import { L, MANAGE_ROLES, Task, TaskItem, User, priorityL } from "@/components/portal/page-shared";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useSaveToast } from "@/components/ui/save-toast";
import { Skel, SkelRows } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { useCachedApi } from "@/lib/cached-api";
import { btnClass, card, inputClass } from "@/lib/ui-styles";
import { useCallback, useMemo, useState } from "react";

/* ================= Tasks ================= */

export function Tasks({ user }: { user: User }) {
  const [draft, setDraft] = useState({
    title: "",
    description: "",
    scope: "", // v1.42.0 — one deliverable per line → tickable task_items
    assigned_to: 0,
    priority: "normal",
    deadline: "",
  });
  const [openTask, setOpenTask] = useState<number | null>(null);
  const [items, setItems] = useState<TaskItem[] | null>(null);
  const { confirm: askDelete, node: deleteConfirmNode } = useConfirm();
  const { show: showTaskToast, node: taskToastNode } = useSaveToast();
  const canManage = MANAGE_ROLES.includes(user.role);
  const todayISO = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);

  /* v1.104.0 (roadmap phase 02) - remembered, then refreshed. Yesterday's
     board paints from the device at once; the fetch swaps the live one in
     behind it, and any write on a task bumps "tasks" so every open board
     refetches (the topic wiring moved INTO the hook).
     v1.77.0 (kept): skeleton until the first EVER fetch lands. */
  const board = useCachedApi<{ tasks: Task[] }>(`/staff/tasks${canManage ? "?all=1" : ""}`, true, ["tasks"]);
  const tasks = useMemo(() => board.data?.tasks ?? [], [board.data]);
  const loaded = !board.loading;
  /* v1.21.0 (CEO: "populate list of users instead of staff list data…
     staff name list should be populate full staff name"): the assignee
     picker read /staff/users — EVERY account, dupes, Super Admin and
     all. /staff-list is the one picker source: active staff only,
     full_name preferred. Used by Content/Sales already; now here too. */
  const roster = useCachedApi<{ staff: { id: number; name: string }[] }>("/staff/staff-list", canManage, ["users"]);
  const team = useMemo(() => roster.data?.staff ?? [], [roster.data]);
  const refreshBoard = board.refresh;
  const load = useCallback(async () => { refreshBoard(); }, [refreshBoard]);

  const create = async () => {
    if (!draft.title) return;
    // Staff self-assign; managers may pick someone. 0 = self on the server.
    const payload = {
      ...draft,
      assigned_to: draft.assigned_to || undefined,
      // v1.42.0: the scope, one line per deliverable
      items: draft.scope.split("\n").map((l) => l.trim()).filter(Boolean),
    };
    await api(`/staff/tasks`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    setDraft({
      title: "",
      description: "",
      scope: "",
      assigned_to: 0,
      priority: "normal",
      deadline: "",
    });
    void load();
  };
  const openChecklist = async (id: number) => {
    if (openTask === id) { setOpenTask(null); setItems(null); return; }
    setOpenTask(id); setItems(null);
    const r = await api<{ items: TaskItem[] }>(`/staff/tasks/${id}/items`);
    if (r.ok && r.data) setItems(r.data.items ?? []);
  };
  const toggleItem = async (taskId: number, itemId: number) => {
    const r = await api<{ done: number; progress: number }>(
      `/staff/tasks/${taskId}/items/${itemId}/toggle`,
      { method: "POST", body: JSON.stringify({}) }
    );
    if (r.queued) {
      /* v1.105.0 - the tick is kept on the phone and will land when the
         signal is back; until then the box cannot move, so say why. */
      showTaskToast(L("Kept — no signal", "Disimpan — tiada isyarat"),
        L("The tick is saved on this phone and will be sent when you are back online.", "Tanda disimpan pada telefon ini dan akan dihantar apabila anda kembali dalam talian."), "notice");
    } else if (r.ok) {
      const rr = await api<{ items: TaskItem[] }>(`/staff/tasks/${taskId}/items`);
      if (rr.ok && rr.data) setItems(rr.data.items ?? []);
      void load();
    } else {
      /* v1.78.0 — a tick that does not save used to do nothing at all: the
         box simply stayed as it was, which reads as "I mis-clicked" rather
         than "the server refused". Success needs no toast — the tick moving
         IS the receipt — but a refusal has no other tell. */
      showTaskToast(
        L("Not saved", "Tidak disimpan"),
        L("That tick did not reach the server — try again", "Tanda itu tidak sampai ke pelayan — cuba lagi"),
        "notice",
      );
    }
  };
  const acknowledge = async (id: number) => {
    await api(`/staff/tasks/${id}/ack`, { method: "POST", body: JSON.stringify({}) });
    void load();
  };
  /* v1.79.0 (CEO: "when I clicked closed it doesnt popup which is not
     correct!") — THIS is the dropdown, the one whose third option is
     literally "Closed". It PATCHed the task and said nothing either way, so
     closing a task looked identical to a refused request, and the only tell
     was the reload putting the old value back a second later. Guard #25's
     new rule 3 walks controls, not just buttons, and found it. */
  const update = async (id: number, patch: Record<string, unknown>) => {
    const r = await api(`/staff/tasks/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
    const st = typeof patch.status === "string" ? patch.status : "";
    if (r.queued) {
      /* v1.105.0 - kept on the phone; the board will show it once sent */
      showTaskToast(L("Kept — no signal", "Disimpan — tiada isyarat"),
        L("Saved on this phone. It will be sent the moment you are back online.", "Disimpan pada telefon ini. Ia akan dihantar sebaik sahaja anda kembali dalam talian."), "notice");
    } else if (r.ok) {
      showTaskToast(
        st === "completed" ? L("Task closed", "Tugasan ditutup")
          : st === "in_progress" ? L("Marked pending", "Ditanda belum selesai")
          : st === "open" ? L("Re-opened", "Dibuka semula")
          : L("Task updated", "Tugasan dikemas kini"),
        L("Saved", "Disimpan"),
      );
    } else {
      showTaskToast(
        L("Not saved", "Tidak disimpan"),
        L("That change did not reach the server — try again", "Perubahan itu tidak sampai ke pelayan — cuba lagi"),
        "notice",
      );
    }
    void load();
  };
  /* v1.72.0 (CEO: "I want to have an option for me to delete which is roles
     CEO only") — the button is CEO-only here AND the route refuses everyone
     else, so a hand-made request gets the same answer as a hidden button.
     The confirm names the task and says what leaves with it: closing a task
     is the reversible act, this one is not. */
  const canDelete = ["ceo", "super_admin"].includes(user.role);
  const remove = async (t: Task) => {
    if (
      !(await askDelete({
        title: L("Delete this task?", "Padam tugasan ini?"),
        message: L(
          `"${t.title}" goes for good, and so does everything on it — the scope checklist, the comments, the acknowledgement, and any days already booked for it on the roster. To simply end a task, set it to Closed instead.`,
          `"${t.title}" akan hilang terus, berserta segalanya padanya — senarai skop, komen, pengakuan terima, dan mana-mana hari yang telah ditempah untuknya pada roster. Untuk menamatkan tugasan sahaja, tetapkan kepada Selesai.`
        ),
        confirmLabel: L("Delete task", "Padam tugasan"),
        variant: "danger",
      }))
    )
      return;
    const res = await api<{ error?: { message?: string } }>(`/staff/tasks/${t.id}`, { method: "DELETE" });
    /* v1.77.0 (CEO: "there is no popup box to show if there is any task
       successfully deleted") — a destructive action that says nothing leaves
       the person unsure whether it happened, and the row vanishing could just
       as easily be a filter. Both outcomes are now spoken. */
    if (!res.ok) {
      showTaskToast(L("Not deleted", "Tidak dipadam"),
        res.data?.error?.message ?? L("The server refused that", "Pelayan menolaknya"), "notice");
      return;
    }
    showTaskToast(L("Task deleted", "Tugasan dipadam"),
      L(`"${t.title}" and everything on it is gone.`, `"${t.title}" dan segalanya padanya telah hilang.`));
    void load();
  };

  return (
    <div className="grid grid-cols-1 gap-4 md:gap-6 lg:grid-cols-2">
      {deleteConfirmNode}
      {taskToastNode}
      <div className={card}>
        <p className="text-sm font-semibold">
          {canManage
            ? L("Create / assign a task", "Buat / agih tugasan")
            : L("Create a task", "Buat tugasan")}
        </p>
        <p className="text-muted-foreground mt-0.5 text-xs">
          {L(
            "You know your work best — add your own tasks with a deadline and track them as open, pending, or closed.",
            "Anda paling tahu kerja anda — tambah tugasan sendiri dengan tarikh akhir dan jejak sebagai terbuka, menunggu atau selesai."
          )}
        </p>
        <div className="mt-3 space-y-3">
          <Sub t={L("Title", "Tajuk")}>
            <input
              className={inputClass}
              placeholder={L(
                "e.g. Prepare LIVE rundown",
                "cth. Sediakan rundown LIVE"
              )}
              value={draft.title}
              onChange={(e) =>
                setDraft((d) => ({ ...d, title: e.target.value }))
              }
            />
          </Sub>
          <Sub t={L("Description", "Keterangan")}>
            <textarea
              className={inputClass}
              rows={2}
              placeholder={L("What needs doing?", "Apa yang perlu dibuat?")}
              value={draft.description}
              onChange={(e) =>
                setDraft((d) => ({ ...d, description: e.target.value }))
              }
            />
          </Sub>
          <Sub t={L("Scope — one deliverable per line", "Skop — satu hasil kerja setiap baris")}>
            <textarea
              className={inputClass}
              rows={3}
              placeholder={L(
                "e.g.\nDraft the catalogue layout\nCollect product photos\nSend PDF for approval",
                "cth.\nDraf susun atur katalog\nKumpul foto produk\nHantar PDF untuk kelulusan"
              )}
              value={draft.scope}
              onChange={(e) =>
                setDraft((d) => ({ ...d, scope: e.target.value }))
              }
            />
            <p className="text-muted-foreground mt-1 text-xs">
              {L(
                "Each line becomes a tickable item — progress counts itself as the staff tick them off.",
                "Setiap baris menjadi item boleh ditanda — kemajuan dikira sendiri apabila kakitangan menandanya."
              )}
            </p>
          </Sub>
          {canManage && (
            <Sub t={L("Assign to", "Agihkan kepada")}>
              <select
                className={inputClass}
                value={draft.assigned_to}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    assigned_to: Number(e.target.value),
                  }))
                }
              >
                <option value={0}>
                  {L("Assign to myself", "Agih kepada diri sendiri")}
                </option>
                {team.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </Sub>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Sub t={L("Priority", "Keutamaan")}>
              <select
                className={inputClass}
                value={draft.priority}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, priority: e.target.value }))
                }
              >
                {["low", "normal", "high", "urgent"].map((p) => (
                  <option key={p} value={p}>
                    {priorityL(p)}
                  </option>
                ))}
              </select>
            </Sub>
            <Sub t={L("Deadline (optional)", "Tarikh akhir (pilihan)")}>
              <input
                type="date"
                className={inputClass}
                value={draft.deadline}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, deadline: e.target.value }))
                }
              />
            </Sub>
          </div>
          <button
            type="button"
            className={btnClass}
            onClick={() => void create()}
          >
            {L("Create task", "Buat tugasan")}
          </button>
        </div>
      </div>

      <div className={card}>
        <p className="text-sm font-semibold">
          {canManage
            ? L("All tasks", "Semua tugasan")
            : L("My tasks", "Tugasan saya")}
        </p>
        {/* v1.77.0 — skeleton until the first fetch lands. */}
        {!loaded && <SkelRows rows={5} className="max-h-96" />}
        {loaded && tasks.length === 0 && (
          <p className="text-muted-foreground mt-2 text-sm">
            {L("No tasks.", "Tiada tugasan.")}
          </p>
        )}
        <div className="max-h-96 overflow-y-auto">
          {loaded && tasks.map((t) => {
            /* v1.42.0: the list is a monitoring surface — an overdue task is
               RED before anyone reads a date, an unacknowledged assignment
               wears an amber badge, and the scope tally shows how far along
               the work actually is. */
            const overdue = !!t.deadline && t.deadline < todayISO && t.status !== "completed";
            const mine = t.assigned_to === undefined || t.assigned_to === user.id;
            const assigned = t.created_by != null && t.assigned_to != null && t.created_by !== t.assigned_to;
            return (
            <div
              key={t.id}
              className="border-border border-b py-2 text-sm last:border-0"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  <span className={`font-medium ${overdue ? "text-danger" : ""}`}>{t.title}</span>
                  {t.assignee ? (
                    <span className="text-muted-foreground">
                      {" "}
                      · {t.assignee}
                    </span>
                  ) : null}
                  <span className={overdue ? "text-danger font-medium" : "text-muted-foreground"}>
                    {" "}
                    · {priorityL(t.priority)}
                    {t.deadline
                      ? overdue
                        ? L(` · OVERDUE — was due ${t.deadline}`, ` · TERTUNGGAK — sepatutnya ${t.deadline}`)
                        : L(` · due ${t.deadline}`, ` · sebelum ${t.deadline}`)
                      : ""}
                  </span>
                  {(t.item_count ?? 0) > 0 && (
                    <button
                      type="button"
                      className="border-border hover:bg-secondary ml-2 rounded-full border px-2 py-0.5 text-xs"
                      title={L("Open the scope checklist", "Buka senarai semak skop")}
                      onClick={() => void openChecklist(t.id)}
                    >
                      ✓ {t.item_done ?? 0}/{t.item_count} {L("scope", "skop")}
                    </button>
                  )}
                  {assigned && t.acknowledged === 0 && t.status !== "completed" && (
                    mine ? (
                      <button
                        type="button"
                        className="bg-warning-soft text-warning ml-2 rounded-full px-2 py-0.5 text-xs font-medium"
                        onClick={() => void acknowledge(t.id)}
                        title={L("Confirm you have seen and understood this task — your assigner is notified", "Sahkan anda telah melihat dan memahami tugasan ini — pemberi tugasan dimaklumkan")}
                      >
                        {L("Acknowledge", "Akui terima")}
                      </button>
                    ) : (
                      <span className="bg-warning-soft text-warning ml-2 rounded-full px-2 py-0.5 text-xs font-medium">
                        {L("Not acknowledged", "Belum diakui")}
                      </span>
                    )
                  )}
                </span>
                <span className="flex items-center gap-2">
                  <select
                    className="border-input bg-background rounded-lg border px-2 py-1 text-xs"
                    value={t.status}
                    onChange={(e) =>
                      void update(t.id, {
                        status: e.target.value,
                        progress:
                          e.target.value === "completed" ? 100 : t.progress,
                      })
                    }
                  >
                    {[
                      ["open", "Open"],
                      ["in_progress", "Pending"],
                      ["completed", "Closed"],
                    ].map(([v, lbl]) => (
                      <option key={v} value={v}>
                        {L(
                          lbl!,
                          v === "open"
                            ? "Terbuka"
                            : v === "in_progress"
                              ? "Menunggu"
                              : "Selesai"
                        )}
                      </option>
                    ))}
                  </select>
                  <span className="text-muted-foreground text-xs">
                    {t.progress}%
                  </span>
                  {canDelete && (
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-danger px-1 text-base leading-none"
                      title={L("Delete this task (CEO only)", "Padam tugasan ini (CEO sahaja)")}
                      aria-label={L("Delete task", "Padam tugasan")}
                      onClick={() => void remove(t)}
                    >
                      ×
                    </button>
                  )}
                </span>
              </div>
              {openTask === t.id && (
                <div className="border-border mt-2 rounded-lg border p-2">
                  {/* v1.77.0 — skeleton until the first fetch lands: two
                      checklist lines, the shape of the scope items. */}
                  {!items && (
                    <div className="space-y-2 py-1" aria-hidden>
                      {[0, 1].map((i) => (
                        <div key={i} className="flex items-center gap-2">
                          <Skel className="h-4 w-4 shrink-0" />
                          <Skel className={`h-3.5 ${i === 0 ? "w-2/3" : "w-1/2"}`} />
                        </div>
                      ))}
                    </div>
                  )}
                  {items && items.length === 0 && (
                    <p className="text-muted-foreground text-xs">{L("No scope items on this task.", "Tiada item skop pada tugasan ini.")}</p>
                  )}
                  {items && items.map((it) => (
                    <label key={it.id} className="flex items-start gap-2 py-1 text-sm">
                      <input
                        type="checkbox"
                        checked={it.done === 1}
                        disabled={!mine && !canManage}
                        onChange={() => void toggleItem(t.id, it.id)}
                      />
                      <span className={it.done ? "text-muted-foreground line-through" : ""}>
                        {it.title}
                        {it.done === 1 && it.done_by_name ? (
                          <span className="text-muted-foreground ml-1 text-xs no-underline">
                            — {it.done_by_name}{it.done_at ? ` · ${it.done_at.slice(0, 10)}` : ""}
                          </span>
                        ) : null}
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          );
          })}
        </div>
      </div>
    </div>
  );
}

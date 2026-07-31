"use client";

/** Customer area (/account) — a customer's own details and enquiry history. */

import { useEffect, useState } from "react";
import { ChangePasswordForm } from "@/components/account/change-password-form";

const API = "/api/v1";

interface User { id: number; email: string; name: string; role: string }
interface Enquiry { id: number; message: string; status: string; created_at: string }

async function api<T>(path: string, init?: RequestInit) {
  try {
    const res = await fetch(`${API}${path}`, {
      credentials: "include",
      headers: init?.body ? { "Content-Type": "application/json" } : undefined,
      ...init,
    });
    return { ok: res.ok, data: (await res.json().catch(() => null)) as T | null };
  } catch {
    return { ok: false, data: null };
  }
}

const card = "rounded-lg border border-border bg-card p-5";
const inputClass =
  "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring";
const btnClass =
  "bg-primary text-primary-foreground hover:bg-primary/85 inline-flex h-9 items-center rounded-lg px-4 text-sm font-medium transition-colors disabled:opacity-50";
const btnGhost =
  "inline-flex h-9 items-center rounded-lg border border-border px-4 text-sm font-medium transition-colors hover:bg-secondary";


/** ISO "YYYY-MM-DD…" → "DD-MM-YYYY" (+ " HH:MM" when time is present). */
function dmy(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = iso.slice(0, 10).split("-");
  if (d.length !== 3) return iso;
  const date = `${d[2]}-${d[1]}-${d[0]}`;
  const time = iso.length >= 16 ? ` ${iso.slice(11, 16)}` : "";
  return date + time;
}

export default function AccountPage() {
  const [user, setUser] = useState<User | null>(null);
  const [checked, setChecked] = useState(false);
  const [enquiries, setEnquiries] = useState<Enquiry[]>([]);
  const [ask, setAsk] = useState("");
  const [tab, setTab] = useState<"Account" | "Enquiries">("Account");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    void api<{ user: User }>("/auth/me").then((r) => {
      if (r.ok && r.data?.user) {
        // /account is the customer area only. A staff or admin account that
        // lands here is sent to its own interface — no role sees another
        // role's surface.
        if (r.data.user.role !== "customer") {
          const dest = ["editor", "marketing", "admin", "super_admin"].includes(r.data.user.role)
            ? "/admin"
            : "/portal";
          window.location.replace(dest);
          return;
        }
        setUser(r.data.user);
        void api<{ enquiries: Enquiry[] }>("/account/enquiries").then((e) =>
          setEnquiries(e.data?.enquiries ?? []),
        );
      } else {
        window.location.replace("/login");
        return;
      }
      setChecked(true);
    });
  }, []);

  if (!checked || !user) return null;

  return (
    <div className="mx-auto w-full max-w-4xl px-5 py-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-gold-deep text-xs font-medium tracking-[0.3em] uppercase">
            My account
          </p>
          <h1 className="text-xl font-semibold tracking-tight">
            Welcome, {user.name.split(" ")[0]}
          </h1>
        </div>
        <button
          type="button"
          className={btnGhost}
          onClick={() =>
            void api("/auth/logout", { method: "POST", body: JSON.stringify({}) }).then(
              () => window.location.replace("/"),
            )
          }
        >
          Sign out
        </button>
      </header>

      <nav className="mt-6 flex gap-2" aria-label="Account sections">
        {(["Account", "Enquiries"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={
              tab === t
                ? "bg-primary text-primary-foreground rounded-lg px-4 py-1.5 text-sm font-medium"
                : "border-border rounded-lg border px-4 py-1.5 text-sm hover:bg-secondary"
            }
          >
            {t === "Enquiries" ? "My Enquiries" : t}
          </button>
        ))}
      </nav>

      {tab === "Account" && (
      <div className="mt-6 grid gap-6 sm:grid-cols-2">
        <div className={card}>
          <p className="text-sm font-semibold">My details</p>
          <p className="text-muted-foreground mt-2 text-sm">{user.name}</p>
          <p className="text-muted-foreground text-sm">{user.email}</p>
        </div>
        <div className={`${card} sm:col-span-2`}>
          <p className="text-sm font-semibold">Change password</p>
          <p className="text-muted-foreground mt-1 mb-3 text-xs">
            Changing your password signs you out on every other device. Signed
            in with Google? Your password lives with Google, not here.
          </p>
          <ChangePasswordForm />
        </div>
        <div className={card}>
          <p className="text-sm font-semibold">ELFIA drops</p>
          <p className="text-muted-foreground mt-2 text-sm">
            Our featured client launches new pieces on TikTok Live — shop
            through ELFIA&apos;s own store.
          </p>
          <a
            href="https://elfiaofficialstore.com"
            target="_blank"
            rel="noopener noreferrer"
            className={`${btnGhost} mt-3`}
          >
            Visit elfiaofficialstore.com
          </a>
        </div>
      </div>

      )}

      {tab === "Enquiries" && (
      <>
      <div className={`${card} mt-6`}>
        <p className="text-sm font-semibold">Ask AZ ONE OFFICIAL</p>
        <p className="text-muted-foreground mt-0.5 text-xs">
          Send a question to our team — it reaches staff with your name and
          email attached, and your thread shows below.
        </p>
        <textarea
          className={`${inputClass} mt-3`}
          rows={3}
          placeholder="What would you like to ask?"
          value={ask}
          onChange={(e) => setAsk(e.target.value)}
        />
        <button
          type="button"
          className={`${btnClass} mt-2`}
          disabled={!ask.trim() || sending}
          onClick={async () => {
            setSending(true);
            const r = await fetch("/api/v1/account/enquiries", {
              method: "POST",
              credentials: "include",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ message: ask }),
            });
            setSending(false);
            if (r.ok) {
              setAsk("");
              void api<{ enquiries: Enquiry[] }>("/account/enquiries").then((e) =>
                setEnquiries(e.data?.enquiries ?? []),
              );
            }
          }}
        >
          {sending ? "Sending…" : "Send enquiry"}
        </button>
      </div>

      <div className={`${card} mt-6`}>
        <p className="text-sm font-semibold">My enquiries</p>
        {enquiries.length === 0 ? (
          <p className="text-muted-foreground mt-2 text-sm">
            No enquiries yet — send your first question above.
          </p>
        ) : (
          enquiries.map((e) => (
            <div key={e.id} className="border-border border-b py-2 text-sm last:border-0">
              <p>{e.message}</p>
              <p className="text-muted-foreground mt-1 text-xs">
                Status: {e.status} · {dmy(e.created_at)}
              </p>
            </div>
          ))
        )}
      </div>
      </>
      )}
    </div>
  );
}

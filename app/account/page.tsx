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
const btnGhost =
  "inline-flex h-9 items-center rounded-lg border border-border px-4 text-sm font-medium transition-colors hover:bg-secondary";

export default function AccountPage() {
  const [user, setUser] = useState<User | null>(null);
  const [checked, setChecked] = useState(false);
  const [enquiries, setEnquiries] = useState<Enquiry[]>([]);

  useEffect(() => {
    void api<{ user: User }>("/auth/me").then((r) => {
      if (r.ok && r.data?.user) {
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
    <div className="mx-auto w-full max-w-3xl px-6 py-8">
      <header className="flex flex-wrap items-center justify-between gap-4">
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

      <div className={`${card} mt-6`}>
        <p className="text-sm font-semibold">My enquiries</p>
        {enquiries.length === 0 ? (
          <p className="text-muted-foreground mt-2 text-sm">
            No enquiries yet — send one from the{" "}
            <a href="/contact" className="text-foreground underline">
              contact page
            </a>{" "}
            using this email and it will appear here.
          </p>
        ) : (
          enquiries.map((e) => (
            <div key={e.id} className="border-border border-b py-2 text-sm last:border-0">
              <p>{e.message}</p>
              <p className="text-muted-foreground mt-1 text-xs">
                Status: {e.status} · {e.created_at.slice(0, 10)}
              </p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

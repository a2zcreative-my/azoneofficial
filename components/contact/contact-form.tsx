"use client";

import { useState } from "react";

import { whatsappUrl } from "@/constants/content";

const API_BASE = "/api/v1";

type Status = "idle" | "sending" | "sent" | "error";

export function ContactForm() {
  const [status, setStatus] = useState<Status>("idle");
  const [form, setForm] = useState({
    name: "",
    company: "",
    phone: "",
    email: "",
    message: "",
  });

  const update =
    (field: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [field]: e.target.value }));

  const submit = async () => {
    if (!form.name.trim() || !form.message.trim()) return;
    setStatus("sending");
    try {
      const res = await fetch(`${API_BASE}/enquiries`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      setStatus(res.ok ? "sent" : "error");
    } catch {
      setStatus("error");
    }
  };

  if (status === "sent") {
    return (
      <p className="rounded-xl border border-border bg-secondary p-5 text-sm">
        Message received — we&apos;ll get back to you within one working day.
      </p>
    );
  }

  const inputClass =
    "w-full rounded-lg border border-input bg-background px-4 py-2.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring";

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-foreground">
            Name *
          </span>
          <input
            className={inputClass}
            value={form.name}
            onChange={update("name")}
            autoComplete="name"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-foreground">
            Company
          </span>
          <input
            className={inputClass}
            value={form.company}
            onChange={update("company")}
            autoComplete="organization"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-foreground">
            Phone
          </span>
          <input
            className={inputClass}
            value={form.phone}
            onChange={update("phone")}
            autoComplete="tel"
            inputMode="tel"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-foreground">
            Email
          </span>
          <input
            className={inputClass}
            value={form.email}
            onChange={update("email")}
            autoComplete="email"
            inputMode="email"
          />
        </label>
      </div>
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-foreground">
          Message *
        </span>
        <textarea
          className={inputClass}
          rows={5}
          value={form.message}
          onChange={update("message")}
        />
      </label>

      {status === "error" && (
        <p className="text-sm text-destructive">
          The form couldn&apos;t send just now — please{" "}
          <a
            href={whatsappUrl()}
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            message us on WhatsApp
          </a>{" "}
          instead.
        </p>
      )}

      <button
        type="button"
        onClick={submit}
        disabled={status === "sending" || !form.name.trim() || !form.message.trim()}
        className="bg-primary text-primary-foreground hover:bg-primary/85 inline-flex h-11 items-center rounded-full px-8 text-sm font-medium transition-colors disabled:opacity-50"
      >
        {status === "sending" ? "Sending…" : "Send message"}
      </button>
    </div>
  );
}

"use client";

import { useState } from "react";

import { Button } from "@azone/ui";



type Status = "idle" | "sending" | "sent" | "error";

export function ContactForm({
  site,
  apiBase = "/api/v1",
  whatsappHref,
}: {
  /** Tenant key — enquiries are stored against it. */
  site: string;
  apiBase?: string;
  /** Fallback route if the API is unreachable. */
  whatsappHref?: string;
}) {
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
      const res = await fetch(`${apiBase}/enquiries`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, site }),
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
    "w-full rounded-lg border border-input bg-background px-4 py-2.5 text-base text-foreground outline-none focus:ring-2 focus:ring-ring sm:text-sm";

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
            href={whatsappHref ?? "#"}
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            message us on WhatsApp
          </a>{" "}
          instead.
        </p>
      )}

      <Button
        onClick={submit}
        disabled={
          status === "sending" || !form.name.trim() || !form.message.trim()
        }
      >
        {status === "sending" ? "Sending…" : "Send message"}
      </Button>
    </div>
  );
}

"use client";

import { ArrowLeft, RefreshCw } from "lucide-react";
import Link from "next/link";
import { getLang } from "@/lib/i18n";
import { btnClass, btnGhost } from "@/lib/ui-styles";

export default function PageError({ reset }: { reset: () => void }) {
  const ms = getLang() === "ms";
  return (
    <main className="bg-background flex min-h-dvh items-center justify-center p-6">
      <div className="w-full max-w-md space-y-4">
        <h1 className="text-lg font-semibold">
          {ms
            ? "Halaman ini tidak dapat dipaparkan"
            : "This page could not be displayed"}
        </h1>
        <div className="flex flex-wrap gap-3">
          <button type="button" className={`${btnClass} gap-2`} onClick={reset}>
            <RefreshCw size={18} aria-hidden />
            {ms ? "Cuba lagi" : "Try again"}
          </button>
          <Link className={`${btnGhost} gap-2`} href="/">
            <ArrowLeft size={18} aria-hidden />
            {ms ? "Kembali ke laman utama" : "Back to home"}
          </Link>
        </div>
      </div>
    </main>
  );
}

"use client";

/* v1.9.0 — selfie clock-in (the reference app's "Selfie required" step).
   Opens the front camera, captures a frame to JPEG, uploads it to
   /staff/attendance/selfie and hands the returned key to the punch.
   Deliberately OPTIONAL: no camera / no permission / skip all still allow
   the clock-in — attendance must never be blocked by a webcam. */

import { useCallback, useEffect, useRef, useState } from "react";
import { btnClass, btnGhost } from "@/lib/ui-styles";

export function SelfieCapture({ onDone, onCancel }: {
  /** Called with the uploaded R2 key, or null when skipped. */
  onDone: (selfieKey: string | null) => void;
  onCancel: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [state, setState] = useState<"starting" | "live" | "unavailable" | "uploading">("starting");

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 640 } },
          audio: false,
        });
        if (!alive) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => undefined);
        }
        setState("live");
      } catch {
        if (alive) setState("unavailable");
      }
    })();
    return () => {
      alive = false;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, []);

  const capture = useCallback(async () => {
    const video = videoRef.current;
    if (!video || state !== "live") return;
    setState("uploading");
    try {
      const side = Math.min(video.videoWidth || 640, video.videoHeight || 640);
      const canvas = document.createElement("canvas");
      canvas.width = 480; canvas.height = 480;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no canvas");
      // center-crop to square, mirrored like a mirror selfie
      const sx = ((video.videoWidth || side) - side) / 2;
      const sy = ((video.videoHeight || side) - side) / 2;
      ctx.translate(480, 0); ctx.scale(-1, 1);
      ctx.drawImage(video, sx, sy, side, side, 0, 0, 480, 480);
      const blob: Blob | null = await new Promise((res) => canvas.toBlob((b) => res(b), "image/jpeg", 0.82));
      if (!blob) throw new Error("no blob");
      const r = await fetch("/api/v1/staff/attendance/selfie", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "image/jpeg",
          "X-CSRF-Token": (document.cookie.match(/(?:^|; )csrf_token=([^;]*)/)?.[1] ?? ""),
        },
        body: blob,
      });
      const d = (await r.json().catch(() => null)) as { selfie_key?: string } | null;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      onDone(r.ok && d?.selfie_key ? d.selfie_key : null);
    } catch {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      onDone(null); // never block the punch on a camera/upload failure
    }
  }, [state, onDone]);

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      {/* review fix: no backdrop-tap close — a silent cancel here looks
          identical to a successful clock-in. Explicit buttons only. */}
      <div className="bg-card border-border w-full max-w-xs rounded-2xl border p-4 text-center shadow-2xl">
        <p className="text-sm font-semibold">🤳 Selfie clock-in</p>
        {state === "unavailable" ? (
          <p className="text-muted-foreground mt-2 text-xs">
            Camera not available (or permission denied) — you can still clock in without a selfie.
          </p>
        ) : (
          <div className="mx-auto mt-3 aspect-square w-56 overflow-hidden rounded-2xl bg-black">
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video ref={videoRef} playsInline muted className="h-full w-full -scale-x-100 object-cover" />
          </div>
        )}
        <div className="mt-4 flex flex-col gap-2">
          {state === "live" && (
            <button type="button" className={`${btnClass} justify-center`} onClick={() => void capture()}>
              📸 Capture &amp; clock in
            </button>
          )}
          {state === "uploading" && <p className="text-muted-foreground text-xs">Uploading…</p>}
          {state !== "uploading" && (
            <button type="button" className={`${btnGhost} justify-center`} onClick={() => { streamRef.current?.getTracks().forEach((t) => t.stop()); onDone(null); }}>
              Skip — clock in without selfie
            </button>
          )}
          {state !== "uploading" && (
            <button type="button" className="text-muted-foreground text-xs underline" onClick={onCancel}>Cancel</button>
          )}
        </div>
      </div>
    </div>
  );
}

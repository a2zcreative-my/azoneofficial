"use client";

import { useEffect } from "react";

/** Registers the service worker so the site can be installed to the home
    screen and opens standalone — the mobile-app experience (v1.4.49). */
export function PwaRegister() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }
  }, []);
  return null;
}

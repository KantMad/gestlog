"use client";

import { useEffect } from "react";

// Enregistre le service worker (côté client uniquement) → active l'installabilité PWA.
export function PwaRegister() {
  useEffect(() => {
    if (typeof window !== "undefined" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        /* échec silencieux (ex. navigateur non compatible) */
      });
    }
  }, []);
  return null;
}

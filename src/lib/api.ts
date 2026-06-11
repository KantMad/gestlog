import { NextResponse } from "next/server";

// Gestion d'erreur centralisée pour les route handlers.
// - Journalise l'erreur complète côté serveur (visible dans les logs Vercel).
// - Ne renvoie JAMAIS le détail technique au client (fuite d'info : schéma DB,
//   SQL, contraintes…). Message générique + code 500.
export function handleApiError(e: unknown, label = "api"): NextResponse {
  console.error(`[${label}]`, e);
  return NextResponse.json(
    { error: "Erreur interne du serveur" },
    { status: 500 }
  );
}

import { NextResponse } from "next/server";
import type { z } from "zod";

// Parse + valide le corps JSON d'une requête avec un schéma Zod.
// Renvoie { data } si valide, sinon { error: NextResponse 400 }.
// Usage : const r = await parseBody(request, Schema); if ("error" in r) return r.error;
export async function parseBody<T>(
  request: Request,
  schema: z.ZodType<T>
): Promise<{ data: T } | { error: NextResponse }> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return { error: NextResponse.json({ error: "Corps JSON invalide" }, { status: 400 }) };
  }
  const result = schema.safeParse(body);
  if (!result.success) {
    return {
      error: NextResponse.json(
        { error: "Données invalides", details: result.error.flatten().fieldErrors },
        { status: 400 }
      ),
    };
  }
  return { data: result.data };
}

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

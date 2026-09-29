import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/lib/api";
import { syncCatalogToCaisse } from "@/lib/caisse/catalog-sync";

// POST — Envoie le CATALOGUE (fiches produits) à la caisse. Appelé par un cron.
// Auth : header x-api-key = SYNC_API_KEY, comme /api/sync/caisse-retry.
//
// Body (tout est optionnel) :
//   { dryRun: true, offset: 0, batchSize: 500, maxItems: 1000, budgetMs: 40000 }
//
// 🔴 `dryRun: true` par DÉFAUT quand rien n'est précisé : un appel de catalogue déclenché
// par erreur ne doit rien écrire chez le commerçant. Le cron, lui, passe explicitement
// `dryRun: false`.
//
// ⚠️ Le catalogue complet fait ~56 000 codes-barres : la route en traite autant qu'elle
// peut dans son budget de temps puis renvoie `nextOffset`. L'appelant rappelle avec cet
// offset jusqu'à ce qu'il vaille `null`. L'import est rejouable, une reprise ne casse rien.
export async function POST(request: NextRequest) {
  if (request.headers.get("x-api-key") !== process.env.SYNC_API_KEY) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  try {
    const body = await request.json().catch(() => ({}));
    const summary = await syncCatalogToCaisse({
      dryRun: body?.dryRun !== false,
      offset: Number(body?.offset) || 0,
      ...(body?.batchSize != null ? { batchSize: Number(body.batchSize) } : {}),
      ...(body?.maxItems != null ? { maxItems: Number(body.maxItems) } : {}),
      ...(body?.budgetMs != null ? { budgetMs: Number(body.budgetMs) } : {}),
    });
    // Journalisé côté serveur : c'est la trace qu'on relit après le cron de nuit.
    console.log("[caisse-catalog]", JSON.stringify({ ...summary, ecartsPrix: undefined, rejets: undefined }));
    return NextResponse.json({ data: summary }, { status: summary.erreurs.length ? 502 : 200 });
  } catch (e) {
    return handleApiError(e, "api/sync/caisse-catalog");
  }
}

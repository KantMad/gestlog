import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { handleApiError } from "@/lib/api";

export const maxDuration = 60;

// POST — Synchronise l'adresse de LIVRAISON des clients depuis TIO (`lng_shop`).
// Body : { clients: [{ code, city, zipcode }] } (ou tableau direct).
//
// ⚠️ C'est bien la ville de **livraison** (`lng_shop.city`), pas celle de facturation
// (`lng_shop.billing_city`) — ex. « Classic stock Talange » livre à TALANGE mais facture
// à Cholet. Sert à nommer le fichier d'intégration CC.
//
// Ne crée JAMAIS de client : seuls les clients déjà connus de GestLog sont mis à jour
// (les clients naissent de la synchro des commandes). Une valeur vide n'écrase pas l'existant.
export async function POST(request: NextRequest) {
  try {
    if (request.headers.get("x-api-key") !== process.env.SYNC_API_KEY) {
      return NextResponse.json({ error: "Non autorise" }, { status: 401 });
    }

    const body = await request.json();
    const list: { code?: string; city?: string; zipcode?: string }[] = Array.isArray(body)
      ? body
      : body.clients || [];

    // Dédoublonne par code — `lng_shop.reference` n'est pas unique (plusieurs boutiques
    // peuvent partager une référence) : on garde la 1re entrée qui porte une ville.
    const byCode = new Map<string, { city: string; zipcode: string }>();
    for (const c of list) {
      const code = String(c.code || "").trim();
      if (!code) continue;
      const city = String(c.city || "").trim();
      const zipcode = String(c.zipcode || "").trim();
      const prev = byCode.get(code);
      if (prev && prev.city && !city) continue; // ne pas écraser une ville par du vide
      byCode.set(code, { city: city || prev?.city || "", zipcode: zipcode || prev?.zipcode || "" });
    }
    const rows = [...byCode.entries()];

    const CHUNK = 300;
    let updated = 0;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const slice = rows.slice(i, i + CHUNK);
      const flat: unknown[] = [];
      const values = slice.map(([code, v]) => {
        flat.push(code, v.city, v.zipcode);
        return `($${flat.length - 2}::text, $${flat.length - 1}::text, $${flat.length}::text)`;
      });
      const res = await prisma.$executeRawUnsafe(
        `UPDATE "Client" c SET
           "deliveryCity"     = COALESCE(NULLIF(v.city, ''),    c."deliveryCity"),
           "deliveryPostcode" = COALESCE(NULLIF(v.zipcode, ''), c."deliveryPostcode"),
           "updatedAt" = NOW()
         FROM (VALUES ${values.join(",")}) AS v(code, city, zipcode)
         WHERE c.code = v.code`,
        ...flat
      );
      updated += res;
    }

    return NextResponse.json({
      success: true,
      data: { received: list.length, distinct: rows.length, updated },
    });
  } catch (e) {
    return handleApiError(e, "api/sync/client-addresses");
  }
}

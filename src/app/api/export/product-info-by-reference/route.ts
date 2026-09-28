import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";

export const maxDuration = 60;

// POST — Informations produit (descriptif, pays d'origine) par référence.
// Body : { references: string[] } → { descriptions: { REF: texte },
//                                     countries: { REF: code ISO-2 }, unknown: [...] }
//
// Source : `Product.description` et `Product.originCountry`, alimentées par la synchro
// produits depuis TIO (`lng_product.description_fr` / `.country`). Les deux sont portées
// par le PRODUIT, pas par le coloris : plusieurs lignes `Product` (une par couleur)
// partagent la même valeur, on prend donc la première non vide par référence.
//
// ⚠️ Tout est renvoyé BRUT — le HTML du descriptif comme le code pays « 000 » de TIO :
// l'interprétation est faite côté client par `flattenDescription` et `paysOrigine`
// (testés), pour que la base garde la source intacte.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const references: string[] = Array.isArray(body?.references)
      ? [
          ...new Set(
            (body.references as unknown[])
              .map((r) => String(r ?? "").trim())
              .filter((r): r is string => r.length > 0)
          ),
        ]
      : [];
    if (references.length === 0) {
      return NextResponse.json({ error: "references requis" }, { status: 400 });
    }

    // Un DISTINCT ON par référence : une référence porte autant de lignes Product que de
    // coloris (jusqu'à une dizaine), toutes avec le même descriptif.
    // Une ligne par référence : on retient le descriptif le plus complet, et le pays le
    // plus « parlant » (un vrai code avant le « 000 » de TIO, cf. paysOrigine).
    const rows = await prisma.$queryRawUnsafe<
      { reference: string; description: string | null; country: string | null }[]
    >(
      `SELECT DISTINCT ON (p."reference")
              p."reference"     AS reference,
              p."description"   AS description,
              p."originCountry" AS country
         FROM "Product" p
        WHERE p."reference" = ANY($1::text[])
        ORDER BY p."reference",
                 (p."description" IS NOT NULL AND btrim(p."description") <> '') DESC,
                 (p."originCountry" IS NOT NULL AND btrim(p."originCountry") NOT IN ('', '000')) DESC,
                 length(coalesce(p."description", '')) DESC`,
      references
    );

    const descriptions: Record<string, string> = {};
    const countries: Record<string, string> = {};
    for (const r of rows) {
      if (r.description && r.description.trim()) descriptions[r.reference] = r.description;
      if (r.country && r.country.trim()) countries[r.reference] = r.country;
    }

    return NextResponse.json({
      data: {
        descriptions,
        countries,
        unknown: references.filter((r) => !descriptions[r]),
      },
    });
  } catch (e) {
    return handleApiError(e, "api/export/product-info-by-reference");
  }
}

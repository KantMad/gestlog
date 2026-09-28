import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";

export const maxDuration = 60;

// POST — Descriptif de chaque référence produit demandée.
// Body : { references: string[] } → { descriptions: { REF: texte }, unknown: [...] }
//
// Source : `Product.description`, alimentée par la synchro produits depuis TIO
// (`lng_product.description_fr`). Le descriptif est porté par le PRODUIT, pas par le
// coloris : plusieurs lignes `Product` (une par couleur) partagent la même valeur, on
// prend donc la première non vide par référence.
//
// ⚠️ Le HTML léger de TIO est renvoyé BRUT : l'aplatissement est fait côté client par
// `flattenDescription` (testé), pour que la base garde la source intacte.
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
    const rows = await prisma.$queryRawUnsafe<{ reference: string; description: string }[]>(
      `SELECT DISTINCT ON (p."reference") p."reference" AS reference, p."description" AS description
         FROM "Product" p
        WHERE p."reference" = ANY($1::text[])
          AND p."description" IS NOT NULL
          AND btrim(p."description") <> ''
        ORDER BY p."reference", length(p."description") DESC`,
      references
    );

    const descriptions: Record<string, string> = {};
    for (const r of rows) descriptions[r.reference] = r.description;

    return NextResponse.json({
      data: {
        descriptions,
        unknown: references.filter((r) => !descriptions[r]),
      },
    });
  } catch (e) {
    return handleApiError(e, "api/export/description-by-reference");
  }
}

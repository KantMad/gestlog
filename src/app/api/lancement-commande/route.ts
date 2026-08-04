import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { parseSizeScale } from "@/lib/utils";

export const maxDuration = 60;

// POST — Grilles de tailles des références d'un export « commandes à la couleur ».
// Body : { references: string[] } → { sizeScales: { REF: ["S","M",…] }, missing: [...] }
//
// Sert à nommer les colonnes T0..T11 de l'export TIO : `T0` = 1re taille de la grille
// du PRODUIT. ⚠️ On n'utilise PAS `SizeType` : ses positions en base ne suivent pas
// toujours l'ordre d'habillage (HAU y commence par M), alors que `Product.sizeScale`
// porte l'ordre réel. Cf. src/lib/lancement-commande.ts.
//
// Une référence existe souvent en PLUSIEURS couleurs : on retient la grille la plus
// COMPLÈTE (certaines déclinaisons n'ont qu'une partie des tailles).
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
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

    const products = await prisma.product.findMany({
      where: { reference: { in: references } },
      select: { reference: true, sizeScale: true },
    });

    const sizeScales: Record<string, string[]> = {};
    for (const p of products) {
      const scale = parseSizeScale(p.sizeScale).filter(Boolean);
      if (scale.length === 0) continue;
      const current = sizeScales[p.reference];
      if (!current || scale.length > current.length) sizeScales[p.reference] = scale;
    }

    const missing = references.filter((r) => !sizeScales[r]);
    return NextResponse.json({ sizeScales, missing });
  } catch (e) {
    return handleApiError(e, "api/lancement-commande");
  }
}

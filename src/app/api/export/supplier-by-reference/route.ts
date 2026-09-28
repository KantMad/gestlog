import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { resolveProductSuppliers } from "@/lib/product-supplier";

export const maxDuration = 60;

// POST — Fournisseur de chaque référence produit demandée.
// Body : { references: string[] } → { suppliers: { REF: nom }, origins: { REF: origine },
//                                     conflicts: [...], unknown: [...] }
//
// Deux sources cumulées, cf. lib/product-supplier.ts : les **correspondances importées**
// (`SupplierProductRef`, écran Infos produits) d'abord, puis les **commandes fournisseurs**
// déjà passées. Aucune des deux ne suffit seule.
//
// ⚠️ Accès : la route est sous `/api/export`, donc filtrée par le droit d'écran `/export`
// (cf. lib/screens.ts). Le lien produit → fournisseur est une information commercialement
// sensible ; elle ne sort pas de ce périmètre.
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

    // La table des correspondances est petite (une ligne par référence) : lue en entier.
    // Les commandes fournisseurs passent par un DISTINCT en SQL — les lire ligne à ligne
    // ramènerait des milliers de lignes pour quelques centaines de références.
    const [correspondances, commandes] = await Promise.all([
      prisma.supplierProductRef.findMany({
        select: { reference: true, supplier: { select: { name: true } } },
      }),
      prisma.$queryRawUnsafe<{ reference: string; supplier: string }[]>(
        `SELECT DISTINCT p."reference" AS reference, s."name" AS supplier
           FROM "SupplierOrderLine" sol
           JOIN "Product" p ON p.id = sol."productId"
           JOIN "SupplierOrder" so ON so.id = sol."supplierOrderId"
           JOIN "Supplier" s ON s.id = so."supplierId"`
      ),
    ]);

    const resolution = resolveProductSuppliers(
      correspondances.map((c) => ({ reference: c.reference, supplier: c.supplier.name })),
      commandes
    );

    const demandees = new Set(references);
    const suppliers: Record<string, string> = {};
    const origins: Record<string, string> = {};
    for (const ref of references) {
      const f = resolution.byReference.get(ref);
      if (f) {
        suppliers[ref] = f;
        origins[ref] = resolution.originByReference.get(ref) ?? "inconnu";
      }
    }

    return NextResponse.json({
      data: {
        suppliers,
        origins,
        unknown: references.filter((r) => !suppliers[r]),
        // Une référence servie par plusieurs fournisseurs : un seul est retenu (le premier
        // par ordre alphabétique) pour ne pas doubler les quantités du classeur.
        conflicts: resolution.conflicts.filter((c) => demandees.has(c.reference)),
      },
    });
  } catch (e) {
    return handleApiError(e, "api/export/supplier-by-reference");
  }
}

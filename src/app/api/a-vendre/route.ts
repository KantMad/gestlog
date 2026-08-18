import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { parseSizeQuantities, parseSizeScale } from "@/lib/utils";
import { sortSizeScale } from "@/lib/size-order";
import { countSizeGaps, type AVendreRow } from "@/lib/a-vendre";

export const maxDuration = 60;

// GET — Stock entrepôt à écouler, filtrable.
//   ?seasonIds=a,b   (facultatif) produits COMMANDÉS dans ces saisons
//   ?categories=…    ?subCategories=…   (CSV)
//   ?minQty=10       quantité minimale À LA COULEUR
//   ?maxGaps=0       trous de tailles autorisés (-1 = pas de limite)
//
// ⚠️ Source = `StockEntry` (stock physique TIO), PAS le « disponible » de la Répartition.
// Le lien produit→saison n'existe pas en base : il est reconstitué via les commandes
// clients (1 500 des 1 560 produits en stock y sont rattachables) — un produit permanent
// peut donc appartenir à plusieurs saisons, c'est voulu.
export async function GET(request: NextRequest) {
  try {
    const p = request.nextUrl.searchParams;
    const csv = (k: string) =>
      (p.get(k) || "").split(",").map((s) => s.trim()).filter(Boolean);
    const seasonIds = csv("seasonIds");
    const categories = csv("categories");
    const subCategories = csv("subCategories");
    const minQty = Math.max(0, parseInt(p.get("minQty") || "0", 10) || 0);
    const maxGapsRaw = p.get("maxGaps");
    const maxGaps = maxGapsRaw == null || maxGapsRaw === "" ? -1 : parseInt(maxGapsRaw, 10);

    const where: Record<string, unknown> = { totalQuantity: { gt: 0 } };
    const productWhere: Record<string, unknown> = {};
    if (categories.length > 0) productWhere.category = { in: categories };
    if (subCategories.length > 0) productWhere.subCategory = { in: subCategories };
    if (seasonIds.length > 0) {
      productWhere.clientOrderLines = {
        some: { clientOrder: { seasonId: { in: seasonIds } } },
      };
    }
    if (Object.keys(productWhere).length > 0) where.product = productWhere;

    const entries = await prisma.stockEntry.findMany({
      where,
      select: {
        quantitiesBySize: true,
        totalQuantity: true,
        product: {
          select: {
            id: true, reference: true, color: true, colorLabel: true, label: true,
            category: true, subCategory: true, sizeScale: true,
            salePrice: true, costPrice: true,
          },
        },
      },
    });

    const rows: AVendreRow[] = [];
    for (const e of entries) {
      if (e.totalQuantity < minQty) continue;
      const pr = e.product;
      const stockRaw = parseSizeQuantities(e.quantitiesBySize);

      // Grille = celle du produit, complétée par d'éventuelles tailles présentes au stock
      // mais absentes de la grille (référentiel incomplet) — sinon on perdrait des pièces.
      const scale = sortSizeScale([
        ...parseSizeScale(pr.sizeScale),
        ...Object.keys(stockRaw),
      ]);

      const stock: Record<string, number> = {};
      for (const s of scale) stock[s] = stockRaw[s] || 0;

      const gaps = countSizeGaps(scale, stock);
      if (maxGaps >= 0 && gaps > maxGaps) continue;

      rows.push({
        productId: pr.id,
        reference: pr.reference,
        color: pr.color,
        colorLabel: pr.colorLabel,
        label: pr.label,
        category: pr.category,
        subCategory: pr.subCategory,
        sizeScale: scale,
        stock,
        total: e.totalQuantity,
        gaps,
        salePrice: pr.salePrice,
        costPrice: pr.costPrice,
      });
    }

    // « À vendre en priorité » : ce qui immobilise le plus d'argent d'abord. On valorise au
    // PRIX DE GROS (celui facturé aux boutiques, et le seul renseigné à 100 %).
    rows.sort(
      (a, b) =>
        (b.costPrice ?? 0) * b.total - (a.costPrice ?? 0) * a.total ||
        b.total - a.total ||
        a.reference.localeCompare(b.reference, "fr")
    );

    // Facettes : proposées d'après le stock existant (pas tout le référentiel).
    const all = await prisma.stockEntry.findMany({
      where: { totalQuantity: { gt: 0 } },
      select: { product: { select: { category: true, subCategory: true } } },
    });
    const facetCategories = [...new Set(all.map((x) => x.product.category).filter(Boolean))].sort() as string[];
    const facetSub = [
      ...new Set(
        all
          .filter((x) => categories.length === 0 || (x.product.category && categories.includes(x.product.category)))
          .map((x) => x.product.subCategory)
          .filter(Boolean)
      ),
    ].sort() as string[];

    return NextResponse.json({
      rows,
      facets: { categories: facetCategories, subCategories: facetSub },
      meta: { stockedProducts: all.length, returned: rows.length },
    });
  } catch (e) {
    return handleApiError(e, "api/a-vendre");
  }
}

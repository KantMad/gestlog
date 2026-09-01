import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { parseSizeQuantities, parseSizeScale } from "@/lib/utils";
import { sortSizeScale } from "@/lib/size-order";
import { countSizeGaps, type AVendreRow } from "@/lib/a-vendre";
import { resolveProductSeason, sortSeasons } from "@/lib/a-vendre-season";

export const maxDuration = 60;

// GET — Stock entrepôt à écouler, filtrable.
//   ?seasons=PE26,AH26   (facultatif) NOMS de saisons de collection
//   ?categories=…        ?subCategories=…   (CSV)
//   ?minQty=10           quantité minimale À LA COULEUR
//   ?maxGaps=0           trous de tailles autorisés (-1 = pas de limite)
//
// ⚠️ Source = `StockEntry` (stock physique TIO), PAS le « disponible » de la Répartition.
//
// ⚠️ SAISONS : le lien produit→saison n'existe pas en base, il est reconstitué. Cet écran
// ne connaît QUE des collections PE/AH — les saisons sentinelles « Réassort » et
// « Hors-saison » n'y apparaissent plus. Avant ce correctif, 1 087 produits sur 1 570
// s'affichaient à la fois sous leur vraie collection ET sous une sentinelle.
// Le rattachement suit la cascade de `lib/a-vendre-season.ts` (commande → référence
// sœur → préfixe). Chaque produit porte UNE saison de rattachement (sa collection de
// LANCEMENT = la plus ancienne) et la liste de toutes ses saisons de commande.
// Le filtre par saison porte sur cette liste, complétée par la saison de rattachement :
// un produit lancé en PE25 et recommandé en AH26 ressort donc sur les deux.
//
// ⚠️ Rien n'est écrit en base. Les commandes et la synchro TIO gardent leurs saisons
// sentinelles, indispensables ailleurs (écran Commandes client, rapprochement BL/FAC).
export async function GET(request: NextRequest) {
  try {
    const p = request.nextUrl.searchParams;
    const csv = (k: string) =>
      (p.get(k) || "").split(",").map((s) => s.trim()).filter(Boolean);
    const seasonNames = csv("seasons");
    const categories = csv("categories");
    const subCategories = csv("subCategories");
    const minQty = Math.max(0, parseInt(p.get("minQty") || "0", 10) || 0);
    const maxGapsRaw = p.get("maxGaps");
    const maxGaps = maxGapsRaw == null || maxGapsRaw === "" ? -1 : parseInt(maxGapsRaw, 10);

    const where: Record<string, unknown> = { totalQuantity: { gt: 0 } };
    const productWhere: Record<string, unknown> = {};
    if (categories.length > 0) productWhere.category = { in: categories };
    if (subCategories.length > 0) productWhere.subCategory = { in: subCategories };
    if (Object.keys(productWhere).length > 0) where.product = productWhere;

    // Couples (produit, saison de collection) et (référence, saison) constatés dans les
    // commandes clients. Requêtes GROUPÉES : on ne remonte pas les lignes une par une.
    const [byProduct, byReference] = await Promise.all([
      prisma.$queryRawUnsafe<{ pid: string; name: string }[]>(
        `SELECT DISTINCT l."productId" AS pid, s.name
         FROM "ClientOrderLine" l
         JOIN "ClientOrder" o ON o.id = l."clientOrderId"
         JOIN "Season" s ON s.id = o."seasonId"
         WHERE s.type IN ('AH', 'PE')`
      ),
      prisma.$queryRawUnsafe<{ reference: string; name: string }[]>(
        `SELECT DISTINCT p.reference, s.name
         FROM "ClientOrderLine" l
         JOIN "ClientOrder" o ON o.id = l."clientOrderId"
         JOIN "Season" s ON s.id = o."seasonId"
         JOIN "Product" p ON p.id = l."productId"
         WHERE s.type IN ('AH', 'PE')`
      ),
    ]);
    const seasonsOfProduct = new Map<string, string[]>();
    for (const r of byProduct) {
      const list = seasonsOfProduct.get(r.pid);
      if (list) list.push(r.name);
      else seasonsOfProduct.set(r.pid, [r.name]);
    }
    const seasonsOfReference = new Map<string, string[]>();
    for (const r of byReference) {
      const list = seasonsOfReference.get(r.reference);
      if (list) list.push(r.name);
      else seasonsOfReference.set(r.reference, [r.name]);
    }

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
    const seasonCount = new Map<string, number>();
    let undated = 0;
    for (const e of entries) {
      if (e.totalQuantity < minQty) continue;
      const pr = e.product;

      const resolved = resolveProductSeason({
        reference: pr.reference,
        orderSeasons: seasonsOfProduct.get(pr.id) ?? [],
        siblingSeasons: seasonsOfReference.get(pr.reference) ?? [],
      });
      // Saisons interrogeables pour ce produit : celles où il a été commandé, plus sa
      // collection de rattachement (sinon un produit déduit ne ressortirait sur aucun filtre).
      const matchable = sortSeasons([
        ...resolved.seasons,
        ...(resolved.season ? [resolved.season] : []),
      ]);
      for (const n of matchable) seasonCount.set(n, (seasonCount.get(n) ?? 0) + 1);
      if (!resolved.season) undated++;
      if (seasonNames.length > 0 && !matchable.some((n) => seasonNames.includes(n))) continue;
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
        season: resolved.season,
        seasonOrigin: resolved.origin,
        seasons: matchable,
      });
    }

    // « À vendre en priorité » : le plus gros VOLUME d'abord (ce qui encombre le plus
    // l'entrepôt). Départage par valeur au prix de gros, puis par référence.
    rows.sort(
      (a, b) =>
        b.total - a.total ||
        (b.costPrice ?? 0) * b.total - (a.costPrice ?? 0) * a.total ||
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
      facets: {
        categories: facetCategories,
        subCategories: facetSub,
        // Uniquement des collections PE/AH, de la plus récente à la plus ancienne.
        seasons: sortSeasons([...seasonCount.keys()]).reverse(),
      },
      meta: {
        stockedProducts: all.length,
        returned: rows.length,
        // Produits qu'aucune règle ne rattache : collections antérieures à PE23.
        withoutSeason: undated,
      },
    });
  } catch (e) {
    return handleApiError(e, "api/a-vendre");
  }
}

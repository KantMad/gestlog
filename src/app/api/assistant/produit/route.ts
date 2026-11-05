import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/lib/api";
import { cleAssistantValide } from "@/lib/assistant-cle";
import { prisma } from "@/lib/prisma";
import { construireFiche, motsDeRecherche, type FicheStockRow, type FicheVenteRow } from "@/lib/assistant-fiche";

// GET — Fiche d'une référence, en LECTURE SEULE pour l'assistant IA.
//   ?reference=RMPULL_W001   (casse ignorée)   &jours=30 (ventes du site, 1 à 92)
// Auth : en-tête `x-api-key` = ASSISTANT_READ_KEY. Cf. docs/11-assistant-ia.md.
export async function GET(request: NextRequest) {
  try {
    if (!cleAssistantValide(request.headers.get("x-api-key"))) {
      return NextResponse.json({ error: "Non autorise" }, { status: 401 });
    }
    const reference = (request.nextUrl.searchParams.get("reference") ?? "").trim();
    const jours = Number(request.nextUrl.searchParams.get("jours") ?? 30);
    if (!reference || reference.length > 80) {
      return NextResponse.json({ error: "Paramètre reference attendu" }, { status: 400 });
    }
    if (!Number.isInteger(jours) || jours < 1 || jours > 92) {
      return NextResponse.json({ error: "Paramètre jours attendu entre 1 et 92" }, { status: 400 });
    }

    const stocks = await prisma.$queryRawUnsafe<FicheStockRow[]>(
      `SELECT p.reference, p.color, p."colorCode", p."colorLabel", p.label, p.category,
              p."subCategory", p."sizeScale", p."salePrice", p."costPrice",
              COALESCE(ARRAY_AGG(s."quantitiesBySize") FILTER (WHERE s.id IS NOT NULL), '{}') AS "quantitiesBySize"
       FROM "Product" p
       LEFT JOIN "StockEntry" s ON s."productId" = p.id
       WHERE UPPER(p.reference) = UPPER($1)
       GROUP BY p.id`,
      reference
    );

    if (!stocks.length) {
      // Référence inconnue : les références dont la référence ou la désignation contient le plus
      // de mots de la demande (« pull col rond gris » → le pull col rond, même sans « gris »).
      const mots = motsDeRecherche(reference).map((m) => `%${m.replace(/[%_\\]/g, "\\$&")}%`);
      const lignes = mots.length
        ? await prisma.$queryRawUnsafe<{ reference: string; nom: string | null; score: number }[]>(
            `SELECT p.reference, MAX(p.label) AS nom,
                    MAX((SELECT COUNT(*) FROM unnest($1::text[]) w
                         WHERE p.label ILIKE w OR p.reference ILIKE w))::int AS score
             FROM "Product" p
             GROUP BY p.reference
             HAVING MAX((SELECT COUNT(*) FROM unnest($1::text[]) w
                         WHERE p.label ILIKE w OR p.reference ILIKE w)) > 0
             ORDER BY score DESC, p.reference LIMIT 10`,
            mots
          )
        : [];
      const meilleurs = lignes.filter((l) => l.score === lignes[0]?.score);
      const candidats = meilleurs.map(({ reference, nom }) => ({ reference, nom }));
      return NextResponse.json({ trouve: false, candidats });
    }

    // Ventes du site, commandes annulées, remboursées ou échouées exclues (règles des best sellers).
    const ventes = await prisma.$queryRawUnsafe<FicheVenteRow[]>(
      `SELECT ol.color, ol.size, SUM(ol.quantity)::int AS quantity
       FROM "BtocOrderLine" ol
       JOIN "BtocOrder" o ON o.id = ol."orderId"
       WHERE o.status NOT IN ('cancelled', 'refunded', 'failed')
         AND UPPER(SPLIT_PART(ol.sku, '-', 1)) = UPPER($1)
         AND o."orderDate" >= NOW() - ($2 || ' days')::interval
       GROUP BY ol.color, ol.size`,
      reference,
      String(jours)
    );

    return NextResponse.json({ trouve: true, jours, fiche: construireFiche(stocks, ventes) });
  } catch (e) {
    return handleApiError(e, "api/assistant/produit");
  }
}

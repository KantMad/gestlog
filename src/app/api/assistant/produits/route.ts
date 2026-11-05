import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/lib/api";
import { cleAssistantValide } from "@/lib/assistant-cle";
import { prisma } from "@/lib/prisma";
import { parisRangeToUtc } from "@/lib/btoc-dates";
import {
  fusionnerProduits,
  type AssistantStockReferenceRow,
  type AssistantVenteRow,
} from "@/lib/assistant-produits";

// GET — Ventes du site et stock, par référence, en LECTURE SEULE pour l'assistant IA.
//   ?debut=YYYY-MM-DD&fin=YYYY-MM-DD   jours de Paris, inclus (92 jours au plus)
// Auth : en-tête `x-api-key` = ASSISTANT_READ_KEY. Cf. docs/11-assistant-ia.md.

const JOUR = /^\d{4}-\d{2}-\d{2}$/;
const jourValide = (j: string) => JOUR.test(j) && !isNaN(new Date(`${j}T12:00:00Z`).getTime());

export async function GET(request: NextRequest) {
  try {
    if (!cleAssistantValide(request.headers.get("x-api-key"))) {
      return NextResponse.json({ error: "Non autorise" }, { status: 401 });
    }
    const debut = request.nextUrl.searchParams.get("debut") ?? "";
    const fin = request.nextUrl.searchParams.get("fin") ?? "";
    if (!jourValide(debut) || !jourValide(fin) || debut > fin) {
      return NextResponse.json({ error: "Paramètres debut et fin attendus au format YYYY-MM-DD, debut ≤ fin" }, { status: 400 });
    }
    if ((Date.parse(fin) - Date.parse(debut)) / 86_400_000 > 92) {
      return NextResponse.json({ error: "Période limitée à 92 jours" }, { status: 400 });
    }
    const { gte, lt } = parisRangeToUtc(debut, fin);

    // Mêmes règles que l'export « Best sellers » (sans l'historique importé) : commandes
    // annulées, remboursées ou échouées exclues ; remboursements partiels déduits.
    const ventes = await prisma.$queryRawUnsafe<AssistantVenteRow[]>(
      `WITH lignes AS (
        SELECT SPLIT_PART(ol.sku, '-', 1) AS reference, ol.name, ol.quantity AS qty, ol.total AS revenue
        FROM "BtocOrderLine" ol
        JOIN "BtocOrder" o ON o.id = ol."orderId"
        WHERE o.status NOT IN ('cancelled', 'refunded', 'failed')
          AND ol.sku IS NOT NULL AND ol.sku != ''
          AND o."orderDate" >= $1 AND o."orderDate" < $2
        UNION ALL
        SELECT SPLIT_PART(rl.sku, '-', 1), rl.name, -rl.quantity, -rl.total
        FROM "BtocRefundLine" rl
        JOIN "BtocOrder" o ON o."wooId" = rl."orderWooId"
        WHERE o.status NOT IN ('cancelled', 'refunded', 'failed')
          AND rl.sku IS NOT NULL AND rl.sku != ''
          AND o."orderDate" >= $1 AND o."orderDate" < $2
      )
      SELECT reference, MAX(name) AS name, SUM(qty)::int AS quantity, SUM(revenue) AS revenue
      FROM lignes GROUP BY reference`,
      gte,
      lt
    );

    // Stock entrepôt actuel, toutes couleurs d'une même référence réunies.
    const stocks = await prisma.$queryRawUnsafe<AssistantStockReferenceRow[]>(
      `SELECT p.reference, MAX(p.label) AS label, MAX(p.category) AS category,
              SUM(s."totalQuantity")::int AS "totalQuantity"
       FROM "StockEntry" s
       JOIN "Product" p ON p.id = s."productId"
       GROUP BY p.reference`
    );

    return NextResponse.json({ debut, fin, produits: fusionnerProduits(ventes, stocks) });
  } catch (e) {
    return handleApiError(e, "api/assistant/produits");
  }
}

import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { parisRangeToUtc } from "@/lib/btoc-dates";
import {
  aggregateAssistantStock,
  mapAssistantOrders,
  type AssistantOrderRow,
  type AssistantStockRow,
} from "@/lib/assistant-recap";

// GET — Récap en LECTURE SEULE pour l'assistant IA (Mac mini du bureau).
//   ?jour=YYYY-MM-DD   jour calendaire de Paris (obligatoire)
// Auth : en-tête `x-api-key` = ASSISTANT_READ_KEY (clé distincte de SYNC_API_KEY, qui
// permet d'ÉCRIRE). Sans clé configurée, la route refuse tout.
// Cf. docs/11-assistant-ia.md.

function cleValide(recue: string | null): boolean {
  const attendue = process.env.ASSISTANT_READ_KEY;
  if (!attendue || !recue) return false;
  const a = Buffer.from(recue);
  const b = Buffer.from(attendue);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(request: NextRequest) {
  try {
    if (!cleValide(request.headers.get("x-api-key"))) {
      return NextResponse.json({ error: "Non autorise" }, { status: 401 });
    }

    const jour = request.nextUrl.searchParams.get("jour") ?? "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(jour) || isNaN(new Date(`${jour}T12:00:00Z`).getTime())) {
      return NextResponse.json({ error: "Paramètre jour attendu au format YYYY-MM-DD" }, { status: 400 });
    }
    const { gte, lt } = parisRangeToUtc(jour, jour);

    // Commandes TIO uniquement (choix métier du 26/10/2026), par date de commande TIO.
    const orders = await prisma.$queryRawUnsafe<AssistantOrderRow[]>(
      `SELECT o."orderNumber", c.name AS "clientName", o."orderDate", o."totalAmount",
              o.status, o."orderType"
       FROM "ClientOrder" o
       JOIN "Client" c ON c.id = o."clientId"
       WHERE o.source = 'TIO' AND o."orderDate" >= $1 AND o."orderDate" < $2
       ORDER BY o."orderDate" DESC, o."orderNumber" DESC`,
      gte,
      lt
    );

    // Stock entrepôt actuel (la synchro TIO remplace les StockEntry du produit) : une
    // ligne par produit, valorisée ensuite par catégorie.
    const stock = await prisma.$queryRawUnsafe<AssistantStockRow[]>(
      `SELECT p.category, SUM(s."totalQuantity")::int AS "totalQuantity",
              p."costPrice", p."salePrice"
       FROM "StockEntry" s
       JOIN "Product" p ON p.id = s."productId"
       GROUP BY p.id, p.category, p."costPrice", p."salePrice"`
    );

    return NextResponse.json({
      jour,
      commandes: mapAssistantOrders(orders),
      stock: aggregateAssistantStock(stock),
    });
  } catch (e) {
    return handleApiError(e, "api/assistant/recap");
  }
}

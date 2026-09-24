import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { parseSizeQuantities, sumQuantities } from "@/lib/utils";
import { resolveOrderSource } from "@/lib/order-source";
import { buildMontantReport, type MontantLine } from "@/lib/repartition-montants";

export const maxDuration = 60;

// GET — Montants commandés / répartis / manquants, vus du seul pipeline de répartition.
//
// ?seasonId (requis)  ?catalogId  ?clients=id,id  ?clientMode=include|exclude
//
// ⚠️ Source des commandes : `resolveOrderSource` (TEXAS dès qu'il en existe sur la saison,
// sinon TIO). *AH26 porte les deux : 282 commandes TEXAS et 334 TIO. Lire les deux
// doublerait tout — et les répartitions ne référencent que les TEXAS (90 sur 282).*
//
// ⚠️ Seules les sessions de répartition **VALIDATED** comptent. *Une session CANCELLED
// existe en base (460 lignes) : la compter ferait apparaître comme répartie une
// distribution qui a été annulée.*
//
// 🔴 Le « réparti » vient des `AllocationLine`, PAS de `Delivery` : cette table est vide
// et aucun chemin de code n'en crée jamais (cf. lib/repartition-montants.ts).
export async function GET(request: NextRequest) {
  try {
    const p = request.nextUrl.searchParams;
    const seasonId = p.get("seasonId");
    if (!seasonId) {
      return NextResponse.json({ error: "Saison requise" }, { status: 400 });
    }
    const catalogId = p.get("catalogId") || null;
    const clientIds = (p.get("clients") || "").split(",").map((s) => s.trim()).filter(Boolean);
    const clientMode = p.get("clientMode") === "exclude" ? "exclude" : "include";

    const source = await resolveOrderSource(seasonId);

    const clientFilter =
      clientIds.length === 0
        ? {}
        : clientMode === "exclude"
          ? { clientId: { notIn: clientIds } }
          : { clientId: { in: clientIds } };

    const [lines, allocations] = await Promise.all([
      prisma.clientOrderLine.findMany({
        where: {
          clientOrder: {
            seasonId,
            source,
            orderType: "COMMANDE",
            ...(catalogId ? { catalogId } : {}),
            ...clientFilter,
          },
        },
        select: {
          productId: true,
          amount: true,
          totalQuantity: true,
          cancelledBySize: true,
          clientOrderId: true,
          clientOrder: {
            select: {
              clientId: true,
              client: { select: { name: true, code: true } },
              catalogId: true,
              catalog: { select: { name: true } },
            },
          },
        },
      }),
      prisma.allocationLine.findMany({
        where: {
          allocationSession: { seasonId, status: "VALIDATED" },
        },
        select: { clientOrderId: true, productId: true, allocatedBySize: true },
      }),
    ]);

    // Réparti par (commande, produit) : une même ligne peut avoir été servie par
    // PLUSIEURS sessions successives — on additionne, on ne remplace pas.
    const reparti = new Map<string, number>();
    for (const a of allocations) {
      if (!a.clientOrderId) continue;
      const k = `${a.clientOrderId}|${a.productId}`;
      reparti.set(k, (reparti.get(k) ?? 0) + sumQuantities(parseSizeQuantities(a.allocatedBySize)));
    }

    // ⚠️ Une ligne de commande est unique par (commande, produit) : la quantité répartie
    // se rattache donc sans ambiguïté. Si ce n'était pas le cas, la même quantité serait
    // comptée sur chaque ligne homonyme — d'où le contrôle ci-dessous.
    const vus = new Set<string>();
    let doublons = 0;

    const rows: MontantLine[] = lines.map((l) => {
      const k = `${l.clientOrderId}|${l.productId}`;
      if (vus.has(k)) doublons++;
      const dejaVu = vus.has(k);
      vus.add(k);
      return {
        clientId: l.clientOrder.clientId,
        clientName: l.clientOrder.client.name || l.clientOrder.client.code || "—",
        catalogId: l.clientOrder.catalogId,
        catalogName: l.clientOrder.catalog?.name ?? null,
        amount: l.amount,
        totalQuantity: l.totalQuantity,
        cancelledQty: sumQuantities(parseSizeQuantities(l.cancelledBySize)),
        // La quantité répartie n'est portée QUE par la première ligne du couple :
        // la reporter sur chaque homonyme la compterait deux fois.
        allocatedQty: dejaVu ? 0 : (reparti.get(k) ?? 0),
      };
    });

    const report = buildMontantReport(rows);

    const sessions = await prisma.allocationSession.count({
      where: { seasonId, status: "VALIDATED" },
    });

    return NextResponse.json({
      ...report,
      meta: {
        source,
        lineCount: lines.length,
        orderLineDuplicates: doublons,
        validatedSessions: sessions,
      },
    });
  } catch (e) {
    return handleApiError(e, "api/statistics/repartition-montants");
  }
}

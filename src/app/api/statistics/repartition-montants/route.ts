import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { parseSizeQuantities, sumQuantities } from "@/lib/utils";
import { resolveOrderSource } from "@/lib/order-source";
import { buildMontantReport, type MontantLine } from "@/lib/repartition-montants";
import { warehouseSeasonCode } from "@/lib/warehouse-import";

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
//
// 🔴 Le « livré » vient des BONS DE LIVRAISON entrepôt (`WarehouseDocumentLine`), joints
// à la boutique par `clientCode` et au produit par référence + coloris. *Sur AH26 :
// 179 codes boutique sur 179 et 730 couples référence-coloris sur 731 sont reconnus.*
// Le rattachement se fait au niveau (boutique, produit) : les BL importés en masse ne
// portent aucun numéro de commande TIO, on ne peut donc pas descendre à la commande.
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

    // Code saison des documents entrepôt : AH 2026 → « W26 ».
    const season = await prisma.season.findUnique({
      where: { id: seasonId },
      select: { type: true, year: true },
    });
    const blSeason = season ? warehouseSeasonCode(season.type, season.year) : null;

    const [lines, allocations, livraisons] = await Promise.all([
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
      // Livré par (boutique, produit). Un DISTINCT côté SQL évite de ramener les
      // 29 196 lignes de BL d'une saison pour les regrouper en mémoire.
      blSeason
        ? prisma.$queryRawUnsafe<{ clientId: string; productId: string; livre: bigint }[]>(
            `SELECT cl.id AS "clientId", p.id AS "productId", SUM(l.quantity)::bigint AS livre
               FROM "WarehouseDocumentLine" l
               JOIN "WarehouseDocument" d ON d.id = l."documentId"
               JOIN "Client" cl ON cl.code = d."clientCode"
               JOIN "Product" p ON p.reference = l.reference
                                AND (p."colorCode" = l."colorCode" OR p.color = l."colorCode")
              WHERE d.season = $1 AND d."docType" = 'BL' AND l.quantity > 0
              GROUP BY 1, 2`,
            blSeason
          )
        : Promise.resolve([]),
    ]);

    // Réparti par (commande, produit) : une même ligne peut avoir été servie par
    // PLUSIEURS sessions successives — on additionne, on ne remplace pas.
    const reparti = new Map<string, number>();
    for (const a of allocations) {
      if (!a.clientOrderId) continue;
      const k = `${a.clientOrderId}|${a.productId}`;
      reparti.set(k, (reparti.get(k) ?? 0) + sumQuantities(parseSizeQuantities(a.allocatedBySize)));
    }

    const livreParCouple = new Map<string, number>();
    for (const r of livraisons) {
      livreParCouple.set(`${r.clientId}|${r.productId}`, Number(r.livre));
    }

    // ⚠️ Une ligne de commande est unique par (commande, produit) : la quantité répartie
    // se rattache donc sans ambiguïté. Si ce n'était pas le cas, la même quantité serait
    // comptée sur chaque ligne homonyme — d'où le contrôle ci-dessous.
    const vus = new Set<string>();
    let doublons = 0;
    // ⚠️ Le livré est connu par (BOUTIQUE, produit), pas par commande : si la même
    // boutique a commandé le même produit sur deux commandes, la quantité livrée ne doit
    // être portée que par la PREMIÈRE, sinon elle compterait deux fois.
    const livreConsomme = new Set<string>();

    const rows: MontantLine[] = lines.map((l) => {
      const k = `${l.clientOrderId}|${l.productId}`;
      if (vus.has(k)) doublons++;
      const dejaVu = vus.has(k);
      vus.add(k);
      const kc = `${l.clientOrder.clientId}|${l.productId}`;
      const livre = livreConsomme.has(kc) ? 0 : (livreParCouple.get(kc) ?? 0);
      livreConsomme.add(kc);
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
        deliveredQty: livre,
      };
    });

    const report = buildMontantReport(rows);

    const sessions = await prisma.allocationSession.count({
      where: { seasonId, status: "VALIDATED" },
    });

    // ⚠️ Pièces livrées à une boutique pour un produit qu'elle n'a PAS commandé sur le
    // périmètre lu : sans ligne de commande, ni prix ni catalogue — elles ne peuvent pas
    // entrer dans les euros. On les compte et on les affiche plutôt que de les taire.
    // *Sur AH26 : 12 964 pièces sur 63 676, soit 20 %.*
    const livreTotal = livraisons.reduce((n, r) => n + Number(r.livre), 0);
    const livreRattache = report.total.qLivree;

    return NextResponse.json({
      ...report,
      meta: {
        source,
        lineCount: lines.length,
        orderLineDuplicates: doublons,
        validatedSessions: sessions,
        blSeason,
        blPiecesTotal: livreTotal,
        blPiecesHorsCommande: Math.max(0, livreTotal - livreRattache),
      },
    });
  } catch (e) {
    return handleApiError(e, "api/statistics/repartition-montants");
  }
}

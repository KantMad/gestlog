import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { distributeOrderAmount, type AmountLine } from "@/lib/order-amount";

export const maxDuration = 300;

// POST — Reconstruit le CA des lignes de commande vidées par la synchro TIO.
//
// 🔴 Pourquoi. La synchro calculait `montant de ligne = brut × (total ÷ Σ brut)`, le brut
// venant des prix portés par `product_data`. *TIO ne porte plus ces prix sur les commandes
// antérieures à 2026 : Σ brut = 0 → ratio = 0 → toutes les lignes à 0 €, alors que le total
// de la commande était intact. Constaté le 28/09/2026 : 299 commandes de 2025 vidées, soit
// 3 276 978 €.* La synchro ne détruit plus (cf. api/sync/orders), mais l'existant reste à
// réparer.
//
// Répartition du total sur les lignes au prorata de `Product.costPrice × quantité`
// (cf. lib/order-amount.ts). ⚠️ C'est une RÉPARTITION du total réel, pas une invention :
// validée sur les 124 commandes saines de 2025, où le prix catalogue prédit le montant
// réel à ~5 % près.
//
// Body : { seasonNames?: string[], dryRun?: boolean, limit?: number }
// Sans `seasonNames`, toutes les saisons sont examinées. `dryRun` par défaut à TRUE :
// il faut demander explicitement l'écriture.
export async function POST(request: NextRequest) {
  try {
    if (request.headers.get("x-api-key") !== process.env.SYNC_API_KEY) {
      return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
    }
    const body = await request.json().catch(() => ({}));
    const seasonNames: string[] = Array.isArray(body?.seasonNames) ? body.seasonNames : [];
    // ⚠️ Écriture seulement sur demande explicite : `dryRun: false`.
    const dryRun = body?.dryRun !== false;
    const limit = Number(body?.limit) > 0 ? Number(body.limit) : 0;

    // Commandes dont TOUTES les lignes sont à 0 alors que le total est connu.
    const candidates = await prisma.clientOrder.findMany({
      where: {
        source: "TIO",
        orderType: "COMMANDE",
        totalAmount: { gt: 0 },
        ...(seasonNames.length ? { season: { name: { in: seasonNames } } } : {}),
      },
      select: {
        id: true,
        orderNumber: true,
        totalAmount: true,
        season: { select: { name: true } },
        lines: {
          select: {
            id: true,
            amount: true,
            totalQuantity: true,
            product: { select: { costPrice: true, salePrice: true } },
          },
        },
      },
    });

    const aReparer = candidates.filter(
      (o) => o.lines.length > 0 && o.lines.every((l) => l.amount === 0) && o.lines.some((l) => l.totalQuantity > 0)
    );
    const cible = limit > 0 ? aReparer.slice(0, limit) : aReparer;

    let lignesEcrites = 0;
    let caRetabli = 0;
    const parBase: Record<string, number> = { prix: 0, quantité: 0, aucune: 0 };
    const parSaison: Record<string, { commandes: number; ca: number }> = {};
    const exemples: unknown[] = [];

    for (const o of cible) {
      const lignes: AmountLine[] = o.lines.map((l) => ({
        id: l.id,
        quantity: l.totalQuantity,
        // Prix de gros d'abord ; le prix de vente sert de repli, la répartition étant
        // relative, une échelle homogène suffit.
        unitPrice: l.product.costPrice || l.product.salePrice || 0,
      }));
      const { amounts, basis } = distributeOrderAmount(lignes, o.totalAmount ?? 0);
      parBase[basis] = (parBase[basis] ?? 0) + 1;
      if (amounts.size === 0) continue;

      const saison = o.season?.name ?? "—";
      const e = (parSaison[saison] ||= { commandes: 0, ca: 0 });
      e.commandes++;
      e.ca += o.totalAmount ?? 0;
      caRetabli += o.totalAmount ?? 0;

      if (exemples.length < 5) {
        exemples.push({
          commande: o.orderNumber,
          saison,
          total: o.totalAmount,
          lignes: amounts.size,
          base: basis,
          apercu: [...amounts.entries()].slice(0, 3).map(([, v]) => v),
        });
      }

      if (!dryRun) {
        // Une transaction par commande : la somme des lignes doit valoir le total, ou rien.
        await prisma.$transaction(
          [...amounts.entries()].map(([id, amount]) =>
            prisma.clientOrderLine.update({ where: { id }, data: { amount } })
          )
        );
      }
      lignesEcrites += amounts.size;
    }

    if (!dryRun && cible.length > 0) {
      // Trace de l'opération : ces montants sont RECONSTRUITS, pas reçus de TIO.
      const season = await prisma.season.findFirst({ where: { name: { in: Object.keys(parSaison) } } });
      if (season) {
        await prisma.importLog.create({
          data: {
            seasonId: season.id,
            importType: "REPAIR_ORDER_AMOUNTS",
            fileName: `reconstruction CA — ${cible.length} commande(s)`,
            rowCount: lignesEcrites,
            errorCount: 0,
            errors: JSON.stringify({
              methode: "total commande réparti au prorata de costPrice × quantité",
              parSaison,
              parBase,
            }),
          },
        });
      }
    }

    return NextResponse.json({
      data: {
        dryRun,
        commandesExaminees: candidates.length,
        commandesAReparer: aReparer.length,
        commandesTraitees: cible.length,
        lignes: lignesEcrites,
        caRetabli: Math.round(caRetabli),
        parBase,
        parSaison,
        exemples,
      },
    });
  } catch (e) {
    return handleApiError(e, "api/sync/repair-order-amounts");
  }
}

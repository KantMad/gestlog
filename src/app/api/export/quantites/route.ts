import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { resolveOrderSource } from "@/lib/order-source";
import { buildQuantitySheet, type QuantityLine } from "@/lib/export-quantites";

export const maxDuration = 60;

// GET — Quantités commandées par les clients, tailles en colonnes.
//
// ?seasonId (requis)  ?catalogId  ?dateFrom&dateTo (dates de commande)
// ?sku=REF1,REF2      (préfixe de référence, ou "REF_COLORIS")
// ?clients=id,id      ?clientMode=include|exclude
//     include = "aucune boutique SAUF celles-ci"
//     exclude = "toutes les boutiques SAUF celles-ci"
// ?withBoutique=1     (détail par boutique)
//
// ⚠️ Source des commandes : `resolveOrderSource` (TEXAS dès qu'il existe des commandes
// Texas sur la saison, sinon TIO). Interroger la table sans ce filtre ferait DOUBLER les
// quantités sur une saison présente dans les deux sources.
//
// ⚠️ Toutes les commandes n'ont pas de date : sur AH26, les 282 commandes TEXAS ont
// `orderDate` NULL. Un filtre de période les écarterait TOUTES, en silence — la route
// renvoie donc `meta.undatedOrders` pour que l'écran puisse le dire.
//
// ⚠️ Ce sont les quantités COMMANDÉES : les pièces soldées (`cancelledBySize`) ne sont pas
// déduites, et le type de commande est `COMMANDE` (pas VSS), comme sur les autres écrans B2B.
export async function GET(request: NextRequest) {
  try {
    const p = request.nextUrl.searchParams;
    const seasonId = p.get("seasonId");
    if (!seasonId) {
      return NextResponse.json({ error: "Saison requise" }, { status: 400 });
    }
    const catalogId = p.get("catalogId") || null;
    const dateFrom = p.get("dateFrom");
    const dateTo = p.get("dateTo");
    const clientIds = (p.get("clients") || "").split(",").map((s) => s.trim()).filter(Boolean);
    const clientMode = p.get("clientMode") === "exclude" ? "exclude" : "include";
    const skus = (p.get("sku") || "")
      .split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
    const withBoutique = p.get("withBoutique") === "1";

    const source = await resolveOrderSource(seasonId);

    // Bornes de dates : borne haute portée à la fin de la journée, sinon le jour `dateTo`
    // serait exclu (orderDate est un instant, pas une date).
    const orderDate: { gte?: Date; lte?: Date } = {};
    if (dateFrom) orderDate.gte = new Date(`${dateFrom}T00:00:00.000Z`);
    if (dateTo) orderDate.lte = new Date(`${dateTo}T23:59:59.999Z`);

    const clientFilter =
      clientIds.length === 0
        ? {}
        : clientMode === "exclude"
          ? { clientId: { notIn: clientIds } }
          : { clientId: { in: clientIds } };

    // Un SKU saisi vaut pour la référence seule ou pour "RÉFÉRENCE_COLORIS" : les deux
    // écritures circulent dans les fichiers métier.
    const skuFilter =
      skus.length === 0
        ? {}
        : {
            OR: skus.flatMap((s) => {
              const [ref, color] = s.split(/[_-]/);
              // `colorCode` est nullable ; le code de repli est `color` (non nul).
              return color
                ? [
                    { reference: ref, colorCode: color },
                    { reference: ref, color },
                    { reference: { startsWith: s } },
                  ]
                : [{ reference: { startsWith: s } }];
            }),
          };

    const lines = await prisma.clientOrderLine.findMany({
      where: {
        clientOrder: {
          seasonId,
          source,
          orderType: "COMMANDE",
          ...(catalogId ? { catalogId } : {}),
          ...(dateFrom || dateTo ? { orderDate } : {}),
          ...clientFilter,
        },
        ...(skus.length ? { product: skuFilter } : {}),
      },
      select: {
        quantitiesBySize: true,
        product: {
          select: {
            reference: true, label: true,
            colorCode: true, color: true, colorLabel: true,
          },
        },
        clientOrder: { select: { client: { select: { code: true, name: true } } } },
      },
    });

    // Commandes du périmètre PRIVÉES de date : invisibles dès qu'une période est demandée.
    const undatedOrders =
      dateFrom || dateTo
        ? await prisma.clientOrder.count({
            where: {
              seasonId,
              source,
              orderType: "COMMANDE",
              orderDate: null,
              ...(catalogId ? { catalogId } : {}),
              ...clientFilter,
            },
          })
        : 0;

    const rows: QuantityLine[] = lines.map((l) => ({
      reference: l.product.reference,
      label: l.product.label || "",
      colorCode: l.product.colorCode || l.product.color || "",
      colorLabel: l.product.colorLabel || "",
      clientCode: l.clientOrder.client.code || "",
      clientName: l.clientOrder.client.name || l.clientOrder.client.code || "—",
      quantitiesBySize: l.quantitiesBySize,
    }));

    const sheet = buildQuantitySheet(rows, { withBoutique });

    return NextResponse.json({
      ...sheet,
      meta: { source, lineCount: lines.length, undatedOrders },
    });
  } catch (e) {
    return handleApiError(e, "api/export/quantites");
  }
}

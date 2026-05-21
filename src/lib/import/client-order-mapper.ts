import { prisma } from "@/lib/prisma";
import { stringifySizeQuantities, sumQuantities } from "@/lib/utils";
import { detectSizeColumns, extractSizeQuantities, type ParsedSheet } from "./parser";

export interface ColumnMapping {
  orderNumber: string;
  clientCode: string;
  clientName: string;
  reference: string;
  color: string;
  colorCode?: string;
  orderType?: string;
}

export async function importClientOrders(
  sheet: ParsedSheet,
  mapping: ColumnMapping,
  seasonId: string
) {
  const sizeColumns = detectSizeColumns(sheet.headers);
  const errors: string[] = [];
  let imported = 0;

  const orderGroups = new Map<string, typeof sheet.rows>();
  for (const row of sheet.rows) {
    const orderNum = String(row[mapping.orderNumber] || "").trim();
    if (!orderNum) continue;
    if (!orderGroups.has(orderNum)) orderGroups.set(orderNum, []);
    orderGroups.get(orderNum)!.push(row);
  }

  for (const [orderNumber, rows] of orderGroups) {
    try {
      const firstRow = rows[0];
      const clientCode = String(firstRow[mapping.clientCode] || "").trim();
      const clientName = String(firstRow[mapping.clientName] || clientCode).trim();

      if (!clientCode) {
        errors.push(`Commande ${orderNumber}: code client manquant`);
        continue;
      }

      const client = await prisma.client.upsert({
        where: { code: clientCode },
        update: { name: clientName },
        create: { code: clientCode, name: clientName },
      });

      await prisma.clientSeason.upsert({
        where: { clientId_seasonId: { clientId: client.id, seasonId } },
        update: {},
        create: { clientId: client.id, seasonId },
      });

      const orderType = mapping.orderType
        ? String(firstRow[mapping.orderType] || "COMMANDE").trim()
        : "COMMANDE";

      const clientOrder = await prisma.clientOrder.upsert({
        where: { orderNumber_seasonId: { orderNumber, seasonId } },
        update: {},
        create: {
          orderNumber,
          seasonId,
          clientId: client.id,
          orderType: orderType === "VSS" ? "VSS" : "COMMANDE",
        },
      });

      for (const row of rows) {
        const reference = String(row[mapping.reference] || "").trim();
        const color = String(row[mapping.color] || "").trim();
        if (!reference || !color) {
          errors.push(`Commande ${orderNumber}: référence ou couleur manquante`);
          continue;
        }

        const quantities = extractSizeQuantities(row, sizeColumns);
        if (Object.keys(quantities).length === 0) continue;

        const product = await prisma.product.upsert({
          where: { reference_color: { reference, color } },
          update: {},
          create: {
            reference,
            color,
            colorCode: mapping.colorCode ? String(row[mapping.colorCode] || "") : undefined,
            sizeScale: sizeColumns.join(","),
          },
        });

        await prisma.clientOrderLine.upsert({
          where: {
            clientOrderId_productId: {
              clientOrderId: clientOrder.id,
              productId: product.id,
            },
          },
          update: {
            quantitiesBySize: stringifySizeQuantities(quantities),
            totalQuantity: sumQuantities(quantities),
          },
          create: {
            clientOrderId: clientOrder.id,
            productId: product.id,
            quantitiesBySize: stringifySizeQuantities(quantities),
            totalQuantity: sumQuantities(quantities),
          },
        });

        imported++;
      }
    } catch (e) {
      errors.push(`Commande ${orderNumber}: ${String(e)}`);
    }
  }

  return { imported, errors };
}

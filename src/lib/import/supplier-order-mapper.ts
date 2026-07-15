import { prisma } from "@/lib/prisma";
import { stringifySizeQuantities, sumQuantities } from "@/lib/utils";
import { detectSizeColumns, extractSizeQuantities, type ParsedSheet } from "./parser";

export interface SupplierOrderMapping {
  orderNumber: string;
  supplierCode: string;
  supplierName: string;
  reference: string;
  color: string;
  colorCode?: string;
}

export async function importSupplierOrders(
  sheet: ParsedSheet,
  mapping: SupplierOrderMapping,
  seasonId: string,
  importLogId?: string
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
      const supplierCode = String(firstRow[mapping.supplierCode] || "").trim();
      const supplierName = String(firstRow[mapping.supplierName] || supplierCode).trim();

      if (!supplierCode) {
        errors.push(`Commande ${orderNumber}: code fournisseur manquant`);
        continue;
      }

      // Cloisonnement saison : une commande ne peut exister que sur UNE saison.
      const elsewhere = await prisma.supplierOrder.findFirst({
        where: { orderNumber, seasonId: { not: seasonId } },
        include: { season: { select: { name: true } } },
      });
      if (elsewhere) {
        errors.push(
          `Commande ${orderNumber} déjà présente en saison « ${elsewhere.season.name} » — une commande ne peut être que sur une saison (import ignoré).`
        );
        continue;
      }

      const supplier = await prisma.supplier.upsert({
        where: { code: supplierCode },
        update: { name: supplierName },
        create: { code: supplierCode, name: supplierName },
      });

      const supplierOrder = await prisma.supplierOrder.upsert({
        where: { orderNumber_seasonId: { orderNumber, seasonId } },
        update: { importLogId },
        create: {
          orderNumber,
          seasonId,
          supplierId: supplier.id,
          importLogId,
        },
      });

      const keptProductIds: string[] = [];
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

        await prisma.supplierOrderLine.upsert({
          where: {
            supplierOrderId_productId: {
              supplierOrderId: supplierOrder.id,
              productId: product.id,
            },
          },
          update: {
            quantitiesBySize: stringifySizeQuantities(quantities),
            totalQuantity: sumQuantities(quantities),
          },
          create: {
            supplierOrderId: supplierOrder.id,
            productId: product.id,
            quantitiesBySize: stringifySizeQuantities(quantities),
            totalQuantity: sumQuantities(quantities),
          },
        });
        keptProductIds.push(product.id);

        imported++;
      }

      // Supprime les lignes périmées (produits plus dans le fichier ré-importé).
      if (keptProductIds.length > 0) {
        await prisma.supplierOrderLine.deleteMany({
          where: { supplierOrderId: supplierOrder.id, productId: { notIn: keptProductIds } },
        });
      }
    } catch (e) {
      errors.push(`Commande ${orderNumber}: ${String(e)}`);
    }
  }

  return { imported, errors };
}

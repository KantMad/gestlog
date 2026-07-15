import { prisma } from "@/lib/prisma";
import { stringifySizeQuantities, sumQuantities } from "@/lib/utils";
import { detectSizeColumns, extractSizeQuantities, type ParsedSheet } from "./parser";

export interface ReceptionMapping {
  supplierOrderNumber: string;
  reference: string;
  color: string;
  colorCode?: string;
}

export async function importReception(
  sheet: ParsedSheet,
  mapping: ReceptionMapping,
  seasonId: string,
  receptionNumber: string,
  importLogId?: string
) {
  const sizeColumns = detectSizeColumns(sheet.headers);
  const errors: string[] = [];
  let imported = 0;

  const orderNumbers = new Set<string>();
  for (const row of sheet.rows) {
    const num = String(row[mapping.supplierOrderNumber] || "").trim();
    if (num) orderNumbers.add(num);
  }

  for (const orderNumber of orderNumbers) {
    const supplierOrder = await prisma.supplierOrder.findUnique({
      where: { orderNumber_seasonId: { orderNumber, seasonId } },
      include: { supplier: true },
    });

    if (!supplierOrder) {
      errors.push(`Commande fournisseur ${orderNumber} introuvable pour cette saison`);
      continue;
    }

    const reception = await prisma.supplierReception.create({
      data: {
        receptionNumber,
        supplierOrderId: supplierOrder.id,
        supplierId: supplierOrder.supplierId,
        importLogId,
      },
    });

    const rows = sheet.rows.filter(
      (r) => String(r[mapping.supplierOrderNumber] || "").trim() === orderNumber
    );

    for (const row of rows) {
      const reference = String(row[mapping.reference] || "").trim();
      const color = String(row[mapping.color] || "").trim();
      if (!reference || !color) {
        errors.push(`Réception ${orderNumber}: référence ou couleur manquante`);
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

      await prisma.receptionLine.create({
        data: {
          supplierReceptionId: reception.id,
          productId: product.id,
          quantitiesBySize: stringifySizeQuantities(quantities),
          totalQuantity: sumQuantities(quantities),
        },
      });

      imported++;
    }

    const allReceptions = await prisma.supplierReception.findMany({
      where: { supplierOrderId: supplierOrder.id },
    });
    await prisma.supplierOrder.update({
      where: { id: supplierOrder.id },
      data: { status: allReceptions.length > 0 ? "PARTIEL" : "EN_ATTENTE" },
    });
  }

  return { imported, errors };
}

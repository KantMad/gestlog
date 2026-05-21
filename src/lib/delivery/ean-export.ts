import { prisma } from "@/lib/prisma";
import { parseSizeQuantities } from "@/lib/utils";

export interface EanExportRow {
  ean: string;
  quantity: number;
  reference: string;
  color: string;
  size: string;
}

export async function generateEanExport(deliveryId: string): Promise<{
  rows: EanExportRow[];
  csv: string;
  fileName: string;
}> {
  const delivery = await prisma.delivery.findUnique({
    where: { id: deliveryId },
    include: {
      client: true,
      lines: { include: { product: true } },
    },
  });

  if (!delivery) throw new Error("Livraison introuvable");

  const rows: EanExportRow[] = [];

  for (const line of delivery.lines) {
    const quantities = parseSizeQuantities(line.quantitiesBySize);

    for (const [size, qty] of Object.entries(quantities)) {
      if (qty <= 0) continue;

      const eanRecord = await prisma.productSizeEan.findUnique({
        where: {
          reference_color_size: {
            reference: line.product.reference,
            color: line.product.color,
            size,
          },
        },
      });

      rows.push({
        ean: eanRecord?.ean || `MISSING_${line.product.reference}_${line.product.color}_${size}`,
        quantity: qty,
        reference: line.product.reference,
        color: line.product.color,
        size,
      });
    }
  }

  const csv = rows.map((r) => `${r.ean};${r.quantity}`).join("\n");
  const fileName = `EAN_LIV${delivery.deliveryNumber}_${delivery.client.code}.csv`;

  await prisma.eanExport.create({
    data: {
      deliveryId,
      fileName,
      exportData: JSON.stringify(rows),
    },
  });

  await prisma.delivery.update({
    where: { id: deliveryId },
    data: { eanExportGenerated: true },
  });

  return { rows, csv, fileName };
}

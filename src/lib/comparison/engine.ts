import { prisma } from "@/lib/prisma";
import {
  parseSizeQuantities,
  subtractQuantities,
  sumQuantities,
  parseSizeScale,
  type SizeQuantities,
} from "@/lib/utils";

export interface ComparisonRow {
  productId: string;
  reference: string;
  color: string;
  sizeScale: string[];
  ordered: SizeQuantities;
  received: SizeQuantities;
  gap: SizeQuantities;
  totalOrdered: number;
  totalReceived: number;
  totalGap: number;
  gapPercent: number;
  status: "conforme" | "ecart_mineur" | "ecart_majeur";
}

export interface ComparisonSummary {
  supplierId: string;
  supplierName: string;
  supplierCode: string;
  totalOrdered: number;
  totalReceived: number;
  conformityRate: number;
  lineCount: number;
  anomalyCount: number;
  rows: ComparisonRow[];
}

export async function computeComparison(
  seasonId: string,
  supplierId?: string
): Promise<ComparisonSummary[]> {
  const where: Record<string, string> = { seasonId };
  if (supplierId) where.supplierId = supplierId;

  const supplierOrders = await prisma.supplierOrder.findMany({
    where,
    include: {
      supplier: true,
      lines: { include: { product: true } },
      receptions: { include: { lines: { include: { product: true } } } },
    },
  });

  const summaryBySupplier = new Map<string, ComparisonSummary>();

  for (const order of supplierOrders) {
    const supplier = order.supplier;
    if (!summaryBySupplier.has(supplier.id)) {
      summaryBySupplier.set(supplier.id, {
        supplierId: supplier.id,
        supplierName: supplier.name,
        supplierCode: supplier.code,
        totalOrdered: 0,
        totalReceived: 0,
        conformityRate: 0,
        lineCount: 0,
        anomalyCount: 0,
        rows: [],
      });
    }

    const summary = summaryBySupplier.get(supplier.id)!;

    for (const line of order.lines) {
      const ordered = parseSizeQuantities(line.quantitiesBySize);
      const sizeScale = parseSizeScale(line.product.sizeScale);

      const received: SizeQuantities = {};
      for (const reception of order.receptions) {
        for (const recLine of reception.lines) {
          if (recLine.productId === line.productId) {
            const recQty = parseSizeQuantities(recLine.quantitiesBySize);
            for (const [size, qty] of Object.entries(recQty)) {
              received[size] = (received[size] || 0) + qty;
            }
          }
        }
      }

      const gap = subtractQuantities(ordered, received);
      const totalOrdered = sumQuantities(ordered);
      const totalReceived = sumQuantities(received);
      const totalGap = totalOrdered - totalReceived;
      const gapPercent =
        totalOrdered > 0
          ? Math.round((Math.abs(totalGap) / totalOrdered) * 100)
          : 0;

      let status: ComparisonRow["status"] = "conforme";
      if (totalGap !== 0) {
        status = gapPercent <= 10 ? "ecart_mineur" : "ecart_majeur";
      }

      summary.rows.push({
        productId: line.productId,
        reference: line.product.reference,
        color: line.product.color,
        sizeScale,
        ordered,
        received,
        gap,
        totalOrdered,
        totalReceived,
        totalGap,
        gapPercent,
        status,
      });

      summary.totalOrdered += totalOrdered;
      summary.totalReceived += totalReceived;
      summary.lineCount++;
      if (status !== "conforme") summary.anomalyCount++;
    }
  }

  for (const summary of summaryBySupplier.values()) {
    summary.conformityRate =
      summary.totalOrdered > 0
        ? Math.round((summary.totalReceived / summary.totalOrdered) * 100)
        : 0;
  }

  // Fournisseurs toujours triés par ordre alphabétique (nom), insensible à la casse/accents.
  return Array.from(summaryBySupplier.values()).sort((a, b) =>
    a.supplierName.localeCompare(b.supplierName, "fr", { sensitivity: "base" })
  );
}

import { prisma } from "@/lib/prisma";
import {
  parseSizeQuantities,
  subtractQuantities,
  sumQuantities,
  parseSizeScale,
  type SizeQuantities,
} from "@/lib/utils";

// Une réception physique du fournisseur (un colisage importé), pour afficher les
// réceptions séparément dans l'écran Comparaison (au lieu d'un « Reçu » global agrégé).
export interface ComparisonReception {
  id: string;
  receptionNumber: string;
  receptionDate: string; // ISO
  orderNumber: string;
  totalReceived: number; // total de pièces reçues dans CETTE réception
}

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
  // Quantité reçue de ce produit dans chaque réception (clé = ComparisonReception.id).
  receivedByReception: Record<string, number>;
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
  // Réceptions du fournisseur (toutes commandes confondues), triées par date croissante.
  receptions: ComparisonReception[];
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
        receptions: [],
        rows: [],
      });
    }

    const summary = summaryBySupplier.get(supplier.id)!;

    // Réceptions du fournisseur (une par colisage) — enregistrées une seule fois, avec leur
    // total de pièces, pour être affichées SÉPARÉMENT dans la comparaison.
    for (const reception of order.receptions) {
      if (summary.receptions.some((r) => r.id === reception.id)) continue;
      const totalReceived = reception.lines.reduce(
        (s, l) => s + sumQuantities(parseSizeQuantities(l.quantitiesBySize)),
        0
      );
      summary.receptions.push({
        id: reception.id,
        receptionNumber: reception.receptionNumber,
        receptionDate: reception.receptionDate.toISOString(),
        orderNumber: order.orderNumber,
        totalReceived,
      });
    }

    for (const line of order.lines) {
      const ordered = parseSizeQuantities(line.quantitiesBySize);
      const sizeScale = parseSizeScale(line.product.sizeScale);

      const received: SizeQuantities = {};
      const receivedByReception: Record<string, number> = {};
      for (const reception of order.receptions) {
        for (const recLine of reception.lines) {
          if (recLine.productId === line.productId) {
            const recQty = parseSizeQuantities(recLine.quantitiesBySize);
            for (const [size, qty] of Object.entries(recQty)) {
              received[size] = (received[size] || 0) + qty;
              receivedByReception[reception.id] =
                (receivedByReception[reception.id] || 0) + qty;
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
        receivedByReception,
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
    // Réceptions triées par date croissante (R1 = la plus ancienne).
    summary.receptions.sort((a, b) => a.receptionDate.localeCompare(b.receptionDate));
  }

  // Fournisseurs toujours triés par ordre alphabétique (nom), insensible à la casse/accents.
  return Array.from(summaryBySupplier.values()).sort((a, b) =>
    a.supplierName.localeCompare(b.supplierName, "fr", { sensitivity: "base" })
  );
}

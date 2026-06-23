import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { allocationSimulateSchema } from "@/lib/validators";
import { runAllocation } from "@/lib/allocation/engine";
import {
  parseSizeQuantities,
  parseSizeScale,
  addQuantities,
  stringifySizeQuantities,
  sumQuantities,
  type SizeQuantities,
} from "@/lib/utils";
import type {
  AllocationInput,
  AllocationDemand,
  ClientConfig,
} from "@/lib/allocation/types";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = allocationSimulateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { seasonId, catalogId, clientIds, supplierIds, productReferences, orderType } = parsed.data;

    // Build filter — restrict by catalog, clients, order type
    const orderWhere: Record<string, unknown> = { seasonId };
    if (catalogId) {
      orderWhere.catalogId = catalogId;
    }
    if (clientIds && clientIds.length > 0) {
      orderWhere.clientId = { in: clientIds };
    }
    // Default: only COMMANDE (exclude VSS/réassort), unless explicitly "ALL" or "VSS"
    const effectiveOrderType = orderType || "COMMANDE";
    if (effectiveOrderType !== "ALL") {
      orderWhere.orderType = effectiveOrderType;
    }

    const clientOrders = await prisma.clientOrder.findMany({
      where: orderWhere,
      include: {
        lines: { include: { product: true } },
        client: true,
      },
    });

    // Build supplier filter
    const supplierWhere: Record<string, unknown> = { seasonId };
    if (supplierIds && supplierIds.length > 0) {
      supplierWhere.supplierId = { in: supplierIds };
    }

    const supplierOrders = await prisma.supplierOrder.findMany({
      where: supplierWhere,
      include: {
        receptions: { include: { lines: true } },
        lines: true,
      },
    });

    const clientSeasons = await prisma.clientSeason.findMany({
      where: { seasonId, isActive: true },
      include: { client: true },
    });

    // Quand un/des fournisseur(s) sont sélectionnés, on restreint la DEMANDE à
    // leurs produits (commandés OU reçus). Sinon la simulation listerait tous les
    // fournisseurs (les produits des autres apparaissant juste à 0 alloué).
    const supplierProductFilter =
      supplierIds && supplierIds.length > 0 ? new Set<string>() : null;

    const receivedByProduct = new Map<string, SizeQuantities>();
    for (const so of supplierOrders) {
      for (const line of so.lines) supplierProductFilter?.add(line.productId);
      for (const reception of so.receptions) {
        for (const rl of reception.lines) {
          supplierProductFilter?.add(rl.productId);
          const qty = parseSizeQuantities(rl.quantitiesBySize);
          const existing = receivedByProduct.get(rl.productId) || {};
          receivedByProduct.set(rl.productId, addQuantities(existing, qty));
        }
      }
    }

    const available = new Map<string, SizeQuantities>();
    for (const [productId, qty] of receivedByProduct) {
      available.set(productId, qty);
    }

    // Build a set of product references to filter (if any)
    const refFilter = productReferences && productReferences.length > 0
      ? new Set(productReferences)
      : null;

    const demands: AllocationDemand[] = [];
    for (const order of clientOrders) {
      for (const line of order.lines) {
        // Skip products not in the reference filter
        if (refFilter && !refFilter.has(line.product.reference)) continue;
        // Skip products not supplied by the selected supplier(s)
        if (supplierProductFilter && !supplierProductFilter.has(line.productId)) continue;
        demands.push({
          clientId: order.clientId,
          clientOrderId: order.id,
          productId: line.productId,
          sizeScale: parseSizeScale(line.product.sizeScale),
          requested: parseSizeQuantities(line.quantitiesBySize),
        });
      }
    }

    const clientConfigs = new Map<string, ClientConfig>();
    for (const cs of clientSeasons) {
      clientConfigs.set(cs.clientId, {
        ranking: cs.ranking,
        maxReductionOrder: cs.maxReductionOrder,
        maxReductionLine: cs.maxReductionLine,
        minDeliveryThreshold: cs.minDeliveryThreshold,
        rotationScore: cs.rotationScore,
      });
    }

    // Build display-name maps for human-readable warnings
    const clientNames = new Map<string, string>();
    for (const cs of clientSeasons) {
      clientNames.set(cs.clientId, cs.client.name);
    }

    const productMap = new Map<string, { reference: string; color: string; sizeScale: string }>();
    const productNames = new Map<string, string>();
    for (const order of clientOrders) {
      for (const line of order.lines) {
        if (!productMap.has(line.productId)) {
          productMap.set(line.productId, {
            reference: line.product.reference,
            color: line.product.color,
            sizeScale: line.product.sizeScale,
          });
          productNames.set(
            line.productId,
            `${line.product.reference} / ${line.product.color}`
          );
        }
      }
    }

    const input: AllocationInput = {
      seasonId,
      available,
      demands,
      clientConfigs,
      clientNames,
      productNames,
    };

    const result = runAllocation(input);

    const enrichedLines = result.lines.map((line) => ({
      ...line,
      clientName: clientNames.get(line.clientId) || line.clientId,
      productReference: productMap.get(line.productId)?.reference || "",
      productColor: productMap.get(line.productId)?.color || "",
      sizeScale: parseSizeScale(
        productMap.get(line.productId)?.sizeScale || ""
      ),
    }));

    const clientImpacts = new Map<
      string,
      {
        clientId: string;
        clientName: string;
        totalOriginal: number;
        totalAllocated: number;
        totalReduced: number;
        reductionPercent: number;
        lineCount: number;
        reducedLineCount: number;
      }
    >();

    for (const line of enrichedLines) {
      if (!clientImpacts.has(line.clientId)) {
        clientImpacts.set(line.clientId, {
          clientId: line.clientId,
          clientName: line.clientName,
          totalOriginal: 0,
          totalAllocated: 0,
          totalReduced: 0,
          reductionPercent: 0,
          lineCount: 0,
          reducedLineCount: 0,
        });
      }
      const impact = clientImpacts.get(line.clientId)!;
      const origTotal = sumQuantities(line.original);
      const allocTotal = sumQuantities(line.allocated);
      impact.totalOriginal += origTotal;
      impact.totalAllocated += allocTotal;
      impact.totalReduced += origTotal - allocTotal;
      impact.lineCount++;
      if (origTotal > allocTotal) impact.reducedLineCount++;
    }

    for (const impact of clientImpacts.values()) {
      impact.reductionPercent =
        impact.totalOriginal > 0
          ? Math.round((impact.totalReduced / impact.totalOriginal) * 100)
          : 0;
    }

    // Collect unique product references for filter display
    const uniqueRefs = new Set<string>();
    for (const p of productMap.values()) {
      uniqueRefs.add(p.reference);
    }

    return NextResponse.json({
      lines: enrichedLines,
      warnings: result.warnings,
      clientImpacts: Array.from(clientImpacts.values()),
      summary: {
        totalDemands: demands.length,
        totalProducts: new Set(demands.map((d) => d.productId)).size,
        totalClients: clientImpacts.size,
        totalOriginal: Array.from(clientImpacts.values()).reduce(
          (s, c) => s + c.totalOriginal,
          0
        ),
        totalAllocated: Array.from(clientImpacts.values()).reduce(
          (s, c) => s + c.totalAllocated,
          0
        ),
      },
      availableProductRefs: Array.from(uniqueRefs).sort(),
    });
  } catch (e) {
    return handleApiError(e, "api/allocation/simulate");
  }
}

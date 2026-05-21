import { NextRequest, NextResponse } from "next/server";
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

    const { seasonId } = parsed.data;

    const clientOrders = await prisma.clientOrder.findMany({
      where: { seasonId },
      include: {
        lines: { include: { product: true } },
        client: true,
      },
    });

    const supplierOrders = await prisma.supplierOrder.findMany({
      where: { seasonId },
      include: {
        receptions: { include: { lines: true } },
        lines: true,
      },
    });

    const clientSeasons = await prisma.clientSeason.findMany({
      where: { seasonId, isActive: true },
      include: { client: true },
    });

    const receivedByProduct = new Map<string, SizeQuantities>();
    for (const so of supplierOrders) {
      for (const reception of so.receptions) {
        for (const rl of reception.lines) {
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

    const demands: AllocationDemand[] = [];
    for (const order of clientOrders) {
      for (const line of order.lines) {
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

    const input: AllocationInput = {
      seasonId,
      available,
      demands,
      clientConfigs,
    };

    const result = runAllocation(input);

    const clientMap = new Map<string, string>();
    for (const cs of clientSeasons) {
      clientMap.set(cs.clientId, cs.client.name);
    }

    const productMap = new Map<string, { reference: string; color: string; sizeScale: string }>();
    for (const order of clientOrders) {
      for (const line of order.lines) {
        if (!productMap.has(line.productId)) {
          productMap.set(line.productId, {
            reference: line.product.reference,
            color: line.product.color,
            sizeScale: line.product.sizeScale,
          });
        }
      }
    }

    const enrichedLines = result.lines.map((line) => ({
      ...line,
      clientName: clientMap.get(line.clientId) || line.clientId,
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
    });
  } catch (e) {
    return NextResponse.json(
      { error: `Erreur simulation: ${String(e)}` },
      { status: 500 }
    );
  }
}

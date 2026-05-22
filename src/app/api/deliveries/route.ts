import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseSizeQuantities, sumQuantities } from "@/lib/utils";

export async function GET(request: NextRequest) {
  const seasonId = request.nextUrl.searchParams.get("seasonId");
  const catalogId = request.nextUrl.searchParams.get("catalogId");

  if (!seasonId) {
    return NextResponse.json({ error: "seasonId requis" }, { status: 400 });
  }

  try {
    // Build where clause — if catalogId provided, filter deliveries that have
    // a clientOrder belonging to that catalog
    const where: Record<string, unknown> = {
      allocationSession: { seasonId },
    };
    if (catalogId) {
      where.clientOrderId = {
        in: (
          await prisma.clientOrder.findMany({
            where: { seasonId, catalogId },
            select: { id: true },
          })
        ).map((o) => o.id),
      };
    }

    const deliveries = await prisma.delivery.findMany({
      where,
      include: {
        client: true,
        lines: { include: { product: true } },
        _count: { select: { eanExports: true } },
      },
      orderBy: { deliveryNumber: "asc" },
    });

    // Also fetch catalog info for each delivery's client order
    const orderIds = deliveries
      .map((d) => d.clientOrderId)
      .filter((id): id is string => !!id);
    const orders = orderIds.length > 0
      ? await prisma.clientOrder.findMany({
          where: { id: { in: orderIds } },
          select: { id: true, catalogId: true, catalog: { select: { id: true, name: true } } },
        })
      : [];
    const orderCatalogMap = new Map(
      orders.map((o) => [o.id, o.catalog ? { id: o.catalog.id, name: o.catalog.name } : null])
    );

    const data = deliveries.map((d) => {
      const totalQuantity = d.lines.reduce((sum, l) => {
        return sum + sumQuantities(parseSizeQuantities(l.quantitiesBySize));
      }, 0);

      return {
        id: d.id,
        deliveryNumber: d.deliveryNumber,
        clientId: d.clientId,
        clientName: d.client.name,
        clientCode: d.client.code,
        status: d.status,
        colorCode: d.colorCode,
        catalog: d.clientOrderId ? orderCatalogMap.get(d.clientOrderId) || null : null,
        eanExportGenerated: d.eanExportGenerated,
        eanExportCount: d._count.eanExports,
        lineCount: d.lines.length,
        totalQuantity,
        shippedAt: d.shippedAt,
        createdAt: d.createdAt,
        lines: d.lines.map((l) => ({
          id: l.id,
          productId: l.productId,
          reference: l.product.reference,
          color: l.product.color,
          sizeScale: l.product.sizeScale,
          quantities: parseSizeQuantities(l.quantitiesBySize),
          totalQuantity: l.totalQuantity,
        })),
      };
    });

    return NextResponse.json({ data });
  } catch (e) {
    return NextResponse.json(
      { error: `Erreur: ${String(e)}` },
      { status: 500 }
    );
  }
}

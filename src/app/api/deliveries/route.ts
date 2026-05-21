import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseSizeQuantities, sumQuantities } from "@/lib/utils";

export async function GET(request: NextRequest) {
  const seasonId = request.nextUrl.searchParams.get("seasonId");

  if (!seasonId) {
    return NextResponse.json({ error: "seasonId requis" }, { status: 400 });
  }

  try {
    const deliveries = await prisma.delivery.findMany({
      where: {
        allocationSession: { seasonId },
      },
      include: {
        client: true,
        lines: { include: { product: true } },
        _count: { select: { eanExports: true } },
      },
      orderBy: { deliveryNumber: "asc" },
    });

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

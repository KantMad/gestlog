import { NextResponse } from "next/server";
import { handleApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { parseSizeQuantities, sumQuantities } from "@/lib/utils";

// GET — deliveries at depot (sent or validated)
export async function GET() {
  try {
    const deliveries = await prisma.delivery.findMany({
      where: {
        status: { in: ["ENVOYEE_DEPOT", "VALIDEE_DEPOT"] },
      },
      include: {
        client: true,
        lines: { include: { product: true } },
      },
      orderBy: [{ sentToDepotAt: "desc" }, { deliveryNumber: "asc" }],
    });

    const data = deliveries.map((d) => {
      const totalQuantity = d.lines.reduce((sum, l) => {
        return sum + sumQuantities(parseSizeQuantities(l.quantitiesBySize));
      }, 0);

      return {
        id: d.id,
        deliveryNumber: d.deliveryNumber,
        clientName: d.client.name,
        clientCode: d.client.code,
        status: d.status,
        colorCode: d.colorCode,
        depotStatus: d.depotStatus,
        nbColis: d.nbColis,
        nbPieces: d.nbPieces,
        blNumber: d.blNumber,
        carrier: d.carrier,
        comment: d.comment,
        sentToDepotAt: d.sentToDepotAt,
        totalQuantity,
        lineCount: d.lines.length,
        lines: d.lines.map((l) => ({
          id: l.id,
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
    return handleApiError(e, "api/depot/deliveries");
  }
}

import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { parseSizeQuantities, parseSizeScale, sumQuantities } from "@/lib/utils";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params;

  try {
    const session = await prisma.allocationSession.findUnique({
      where: { id: sessionId },
      include: {
        lines: {
          include: { product: true },
        },
        season: true,
      },
    });

    if (!session) {
      return NextResponse.json(
        { error: "Session non trouvée" },
        { status: 404 }
      );
    }

    const clientIds = [...new Set(session.lines.map((l) => l.clientId).filter(Boolean))];
    const clients = await prisma.client.findMany({
      where: { id: { in: clientIds as string[] } },
    });
    const clientMap = new Map(clients.map((c) => [c.id, c.name]));

    const enrichedLines = session.lines.map((line) => ({
      id: line.id,
      clientId: line.clientId,
      clientName: clientMap.get(line.clientId || "") || line.clientId || "",
      clientOrderId: line.clientOrderId,
      productId: line.productId,
      productReference: line.product.reference,
      productColor: line.product.color,
      sizeScale: parseSizeScale(line.product.sizeScale),
      original: parseSizeQuantities(line.originalBySize),
      allocated: parseSizeQuantities(line.allocatedBySize),
      reduced: parseSizeQuantities(line.reducedBySize),
      reductionReason: line.reductionReason,
      status: line.status,
      isManualAdjustment: line.isManualAdjustment,
    }));

    return NextResponse.json({
      session: {
        id: session.id,
        seasonId: session.seasonId,
        seasonName: session.season.name,
        status: session.status,
        notes: session.notes,
        sessionDate: session.sessionDate,
        createdAt: session.createdAt,
      },
      lines: enrichedLines,
    });
  } catch (e) {
    return handleApiError(e, "api/allocation/sessions/[sessionId]");
  }
}

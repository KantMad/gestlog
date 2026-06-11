import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { stringifySizeQuantities } from "@/lib/utils";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { seasonId, lines, notes } = body;

    if (!seasonId || !lines || !Array.isArray(lines)) {
      return NextResponse.json(
        { error: "seasonId et lines requis" },
        { status: 400 }
      );
    }

    const session = await prisma.allocationSession.create({
      data: {
        seasonId,
        status: "VALIDATED",
        notes: notes || null,
        lines: {
          create: lines.map(
            (line: {
              clientId: string;
              clientOrderId: string;
              productId: string;
              original: Record<string, number>;
              allocated: Record<string, number>;
              reduced: Record<string, number>;
              reductionReason: string;
              status: string;
              isManualAdjustment: boolean;
            }) => ({
              clientId: line.clientId,
              clientOrderId: line.clientOrderId,
              productId: line.productId,
              originalBySize: stringifySizeQuantities(line.original),
              allocatedBySize: stringifySizeQuantities(line.allocated),
              reducedBySize: stringifySizeQuantities(line.reduced),
              reductionReason: line.reductionReason,
              status: line.status,
              isManualAdjustment: line.isManualAdjustment,
            })
          ),
        },
      },
      include: { lines: true },
    });

    const clientSeasons = await prisma.clientSeason.findMany({
      where: { seasonId },
    });

    const impactedClients = new Set(lines.map((l: { clientId: string }) => l.clientId));
    const nonImpactedClients = new Set<string>();
    for (const line of lines) {
      const orig = Object.values(line.original as Record<string, number>).reduce(
        (s: number, v: number) => s + v,
        0
      );
      const alloc = Object.values(line.allocated as Record<string, number>).reduce(
        (s: number, v: number) => s + v,
        0
      );
      if (orig === alloc) {
        nonImpactedClients.add(line.clientId);
      }
    }

    for (const cs of clientSeasons) {
      if (impactedClients.has(cs.clientId) && !nonImpactedClients.has(cs.clientId)) {
        await prisma.clientSeason.update({
          where: { id: cs.id },
          data: { rotationScore: cs.rotationScore + 1 },
        });
      }
    }

    return NextResponse.json({
      sessionId: session.id,
      lineCount: session.lines.length,
      status: session.status,
    });
  } catch (e) {
    return handleApiError(e, "api/allocation/validate");
  }
}

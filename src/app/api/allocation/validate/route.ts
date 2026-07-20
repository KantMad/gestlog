import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { stringifySizeQuantities } from "@/lib/utils";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    // sourceSessionId : présent quand on REVALIDE une session reprise (« Reprendre pour
    // modifier »). On met alors à jour CETTE session (date rafraîchie, lignes remplacées)
    // au lieu de créer un doublon.
    const { seasonId, lines, notes, sourceSessionId } = body;

    if (!seasonId || !lines || !Array.isArray(lines)) {
      return NextResponse.json(
        { error: "seasonId et lines requis" },
        { status: 400 }
      );
    }

    type ValidateLine = {
      clientId: string;
      clientOrderId: string;
      productId: string;
      original: Record<string, number>;
      allocated: Record<string, number>;
      reduced: Record<string, number>;
      reductionReason: string;
      status: string;
      isManualAdjustment: boolean;
    };
    const lineData = (lines as ValidateLine[]).map((line) => ({
      clientId: line.clientId,
      clientOrderId: line.clientOrderId,
      productId: line.productId,
      originalBySize: stringifySizeQuantities(line.original),
      allocatedBySize: stringifySizeQuantities(line.allocated),
      reducedBySize: stringifySizeQuantities(line.reduced),
      reductionReason: line.reductionReason,
      status: line.status,
      isManualAdjustment: line.isManualAdjustment,
    }));

    // Reprise → mise à jour EN PLACE de la session d'origine (pas de doublon).
    const existing = sourceSessionId
      ? await prisma.allocationSession.findFirst({
          where: { id: sourceSessionId, seasonId, status: "VALIDATED" },
          select: { id: true },
        })
      : null;

    const session = existing
      ? await prisma.$transaction(async (tx) => {
          await tx.allocationLine.deleteMany({ where: { allocationSessionId: existing.id } });
          return tx.allocationSession.update({
            where: { id: existing.id },
            data: {
              sessionDate: new Date(), // la répartition d'origine « change de date »
              notes: notes || null,
              lines: { create: lineData },
            },
            include: { lines: true },
          });
        })
      : await prisma.allocationSession.create({
          data: { seasonId, status: "VALIDATED", notes: notes || null, lines: { create: lineData } },
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

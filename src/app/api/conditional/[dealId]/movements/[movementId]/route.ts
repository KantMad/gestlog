import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";

// DELETE — Annule un import (le mouvement et ses lignes). Le solde se recalcule seul :
// c'est ce qui permet de corriger un fichier envoyé par erreur sans tout reprendre.
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ dealId: string; movementId: string }> }
) {
  try {
    const { dealId, movementId } = await params;
    const movement = await prisma.conditionalMovement.findFirst({
      where: { id: movementId, dealId },
      select: { id: true },
    });
    if (!movement) {
      return NextResponse.json({ error: "Mouvement introuvable" }, { status: 404 });
    }
    await prisma.conditionalMovement.delete({ where: { id: movementId } });
    return NextResponse.json({ success: true });
  } catch (e) {
    return handleApiError(e, "api/conditional/[dealId]/movements/[movementId]");
  }
}

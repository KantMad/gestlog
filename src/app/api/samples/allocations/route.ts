import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { parseSizeQuantities } from "@/lib/utils";

// GET ?seasonId=&productId= — qui détient déjà ce produit, et en quelles tailles ?
// Sert à décider CHEZ QUI prélever avant même de saisir : l'écran Échantillons déplie ce
// détail sous chaque ligne de la grille. Source : la dernière répartition VALIDÉE de la
// saison (celle qui fait foi ; c'est aussi celle que corrigent les retraits).
export async function GET(request: NextRequest) {
  try {
    const seasonId = request.nextUrl.searchParams.get("seasonId");
    const productId = request.nextUrl.searchParams.get("productId");
    if (!seasonId || !productId) {
      return NextResponse.json({ error: "seasonId et productId requis" }, { status: 400 });
    }

    const session = await prisma.allocationSession.findFirst({
      where: { seasonId, status: "VALIDATED" },
      orderBy: { sessionDate: "desc" },
      select: { id: true, sessionDate: true },
    });
    if (!session) return NextResponse.json({ session: null, rows: [] });

    const lines = await prisma.allocationLine.findMany({
      where: { allocationSessionId: session.id, productId },
      select: { id: true, clientId: true, allocatedBySize: true, originalBySize: true },
    });
    const clientIds = [...new Set(lines.map((l) => l.clientId).filter(Boolean))] as string[];
    const clients = await prisma.client.findMany({
      where: { id: { in: clientIds } },
      select: { id: true, name: true },
    });
    const nameById = new Map(clients.map((c) => [c.id, c.name]));

    const rows = lines
      .map((l) => ({
        lineId: l.id,
        clientId: l.clientId,
        clientName: nameById.get(l.clientId || "") || l.clientId || "",
        allocated: parseSizeQuantities(l.allocatedBySize),
        original: parseSizeQuantities(l.originalBySize),
      }))
      .filter((r) => Object.values(r.allocated).some((n) => n > 0))
      .sort((a, b) => a.clientName.localeCompare(b.clientName, "fr", { sensitivity: "base" }));

    return NextResponse.json({
      session: { id: session.id, sessionDate: session.sessionDate },
      rows,
    });
  } catch (e) {
    return handleApiError(e, "api/samples/allocations");
  }
}

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

    // ⚠️ PAS « la dernière session de la saison » : les sessions couvrent des périmètres
    // différents (une par fournisseur/lot). Un produit peut être réparti dans une session
    // ANTÉRIEURE et absent de la dernière → on prenait alors « aucune répartition » à tort.
    // On cherche donc la session validée la plus récente QUI CONTIENT CE PRODUIT.
    const candidates = await prisma.allocationLine.findMany({
      where: {
        productId,
        allocationSession: { seasonId, status: "VALIDATED" },
      },
      select: {
        id: true,
        clientId: true,
        allocatedBySize: true,
        originalBySize: true,
        allocationSession: { select: { id: true, sessionDate: true } },
      },
      orderBy: { allocationSession: { sessionDate: "desc" } },
    });
    if (candidates.length === 0) return NextResponse.json({ session: null, rows: [] });

    const session = candidates[0].allocationSession;
    const lines = candidates.filter((l) => l.allocationSession.id === session.id);
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

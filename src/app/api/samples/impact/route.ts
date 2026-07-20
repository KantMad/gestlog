import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { bulkSamplesSchema } from "@/lib/validators";
import { parseSizeQuantities } from "@/lib/utils";

// POST — AVANT d'enregistrer une grille de prélèvements, dit lesquels empiètent sur une
// répartition DÉJÀ VALIDÉE, et chez quelles boutiques les pièces se trouvent.
//
// Règle : pour un (produit, taille), reçu R, alloué A (dernière session validée) et
// prélèvements totaux S — il faut retirer `S + A − R` pièces des boutiques dès que
// `S + A > R`. L'utilisateur choisit ensuite CHEZ QUI (cf. /api/samples/bulk).
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = bulkSamplesSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Données invalides" }, { status: 400 });
    }
    const { items } = parsed.data;

    // Saison déduite des réceptions visées (l'écran travaille toujours sur une saison).
    const receptionIds = [...new Set(items.map((i) => i.supplierReceptionId))];
    const receptions = await prisma.supplierReception.findMany({
      where: { id: { in: receptionIds } },
      select: { supplierOrder: { select: { seasonId: true } } },
    });
    const seasonId = receptions[0]?.supplierOrder.seasonId;
    if (!seasonId) return NextResponse.json({ conflicts: [], session: null });

    // Dernière répartition VALIDÉE de la saison : c'est elle qui fait foi.
    const session = await prisma.allocationSession.findFirst({
      where: { seasonId, status: "VALIDATED" },
      orderBy: { sessionDate: "desc" },
      select: {
        id: true,
        sessionDate: true,
        lines: {
          select: {
            id: true,
            clientId: true,
            productId: true,
            allocatedBySize: true,
            product: { select: { reference: true, color: true, colorLabel: true } },
          },
        },
      },
    });
    if (!session) return NextResponse.json({ conflicts: [], session: null });

    const productIds = [...new Set(items.map((i) => i.productId))];

    // Reçu TOTAL par produit/taille sur la saison (un produit peut venir de 2 réceptions).
    const recLines = await prisma.receptionLine.findMany({
      where: { productId: { in: productIds }, supplierReception: { supplierOrder: { seasonId } } },
      select: { productId: true, quantitiesBySize: true },
    });
    const received: Record<string, Record<string, number>> = {};
    for (const l of recLines) {
      const m = (received[l.productId] ||= {});
      for (const [size, n] of Object.entries(parseSizeQuantities(l.quantitiesBySize))) {
        m[size] = (m[size] || 0) + n;
      }
    }

    // Prélèvements DÉJÀ enregistrés (hors ceux que la grille va remplacer).
    const existing = await prisma.shipmentSample.findMany({
      where: { productId: { in: productIds }, supplierReception: { supplierOrder: { seasonId } } },
      select: { supplierReceptionId: true, productId: true, size: true, quantity: true },
    });
    const submitted = new Set(items.map((i) => `${i.supplierReceptionId}__${i.productId}__${i.size}`));
    const samplesTotal: Record<string, Record<string, number>> = {};
    for (const e of existing) {
      // Une cellule présente dans la grille est REMPLACÉE par la valeur soumise.
      if (submitted.has(`${e.supplierReceptionId}__${e.productId}__${e.size}`)) continue;
      const m = (samplesTotal[e.productId] ||= {});
      m[e.size] = (m[e.size] || 0) + e.quantity;
    }
    for (const i of items) {
      const m = (samplesTotal[i.productId] ||= {});
      m[i.size] = (m[i.size] || 0) + i.quantity;
    }

    // Clients (pour afficher des noms lisibles).
    const clientIds = [...new Set(session.lines.map((l) => l.clientId).filter(Boolean))] as string[];
    const clients = await prisma.client.findMany({
      where: { id: { in: clientIds } },
      select: { id: true, name: true },
    });
    const clientName = new Map(clients.map((c) => [c.id, c.name]));

    const conflicts = [];
    for (const productId of productIds) {
      const sizes = new Set(items.filter((i) => i.productId === productId).map((i) => i.size));
      for (const size of sizes) {
        const R = received[productId]?.[size] || 0;
        const S = samplesTotal[productId]?.[size] || 0;
        const rows = session.lines.filter((l) => l.productId === productId);
        const A = rows.reduce((s, l) => s + (parseSizeQuantities(l.allocatedBySize)[size] || 0), 0);
        const needed = S + A - R;
        if (needed <= 0) continue;
        const allocations = rows
          .map((l) => ({
            lineId: l.id,
            clientId: l.clientId,
            clientName: clientName.get(l.clientId || "") || l.clientId || "",
            allocated: parseSizeQuantities(l.allocatedBySize)[size] || 0,
          }))
          .filter((a) => a.allocated > 0)
          .sort((a, b) => b.allocated - a.allocated);
        const p = rows[0]?.product;
        conflicts.push({
          productId,
          reference: p?.reference || "",
          color: p?.color || "",
          colorLabel: p?.colorLabel || null,
          size,
          received: R,
          samples: S,
          allocated: A,
          needed,
          allocations,
        });
      }
    }

    return NextResponse.json({
      session: { id: session.id, sessionDate: session.sessionDate },
      conflicts,
    });
  } catch (e) {
    return handleApiError(e, "api/samples/impact");
  }
}

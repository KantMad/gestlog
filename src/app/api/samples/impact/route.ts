import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { bulkSamplesSchema } from "@/lib/validators";
import { parseSizeQuantities } from "@/lib/utils";

// POST — AVANT d'enregistrer une grille de prélèvements, dit lesquels empiètent sur une
// répartition DÉJÀ VALIDÉE, et chez quelles boutiques les pièces se trouvent.
//
// Règle : pour un (produit, taille), reçu R, alloué A et prélèvements totaux S — il faut
// retirer `S + A − R` pièces des boutiques dès que `S + A > R`. L'utilisateur choisit
// ensuite CHEZ QUI (cf. /api/samples/bulk).
// A est lu dans la session validée la plus récente CONTENANT CE PRODUIT (pas la dernière
// de la saison : les sessions couvrent des lots/fournisseurs différents).
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

    const productIds = [...new Set(items.map((i) => i.productId))];

    // ⚠️ PAS « la dernière session de la saison » : les sessions couvrent des périmètres
    // différents (une par fournisseur/lot). Un produit peut être réparti dans une session
    // ANTÉRIEURE → la chercher sur la seule dernière session manquait le conflit et laissait
    // prélever des pièces déjà attribuées. On retient, POUR CHAQUE PRODUIT, la session
    // validée la plus récente qui le contient.
    const allLines = await prisma.allocationLine.findMany({
      where: {
        productId: { in: productIds },
        allocationSession: { seasonId, status: "VALIDATED" },
      },
      select: {
        id: true,
        clientId: true,
        productId: true,
        allocatedBySize: true,
        product: { select: { reference: true, color: true, colorLabel: true } },
        allocationSession: { select: { id: true, sessionDate: true } },
      },
      orderBy: { allocationSession: { sessionDate: "desc" } },
    });
    if (allLines.length === 0) return NextResponse.json({ conflicts: [], session: null });

    // Session retenue par produit = celle de sa ligne la plus récente (tri desc ci-dessus).
    const sessionByProduct = new Map<string, { id: string; sessionDate: Date }>();
    for (const l of allLines) {
      if (!sessionByProduct.has(l.productId)) sessionByProduct.set(l.productId, l.allocationSession);
    }
    const linesByProduct = new Map<string, typeof allLines>();
    for (const l of allLines) {
      if (l.allocationSession.id !== sessionByProduct.get(l.productId)?.id) continue;
      const arr = linesByProduct.get(l.productId) || [];
      arr.push(l);
      linesByProduct.set(l.productId, arr);
    }

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
    const clientIds = [...new Set(allLines.map((l) => l.clientId).filter(Boolean))] as string[];
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
        const rows = linesByProduct.get(productId) || [];
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
        const sess = sessionByProduct.get(productId);
        conflicts.push({
          productId,
          reference: p?.reference || "",
          color: p?.color || "",
          colorLabel: p?.colorLabel || null,
          sessionId: sess?.id || null,
          sessionDate: sess?.sessionDate || null,
          size,
          received: R,
          samples: S,
          allocated: A,
          needed,
          allocations,
        });
      }
    }

    // Plus de « session » unique : chaque conflit porte la sienne (cf. sessionId/sessionDate).
    return NextResponse.json({ conflicts });
  } catch (e) {
    return handleApiError(e, "api/samples/impact");
  }
}

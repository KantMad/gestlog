import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { verifySession } from "@/lib/session";
import { pullSamplesSchema } from "@/lib/validators";
import { parseSizeQuantities, stringifySizeQuantities } from "@/lib/utils";

// POST — LE mouvement « mettre une pièce de côté pour échantillon », en UN seul geste :
// on prend une pièce déjà **attribuée à une boutique** (répartition validée) et on la sort
// à la fois de cette commande client ET du disponible fournisseur.
//   1. l'allocation de la boutique est réduite (reducedBySize / status recalculés) ;
//   2. un ShipmentSample est créé/incrémenté → la pièce entre en échantillonnage (liste
//      globale) et, comme les échantillons sont soustraits du disponible à la répartition,
//      elle n'est plus disponible dans la réception fournisseur.
// La réception physique (ReceptionLine) n'est pas modifiée : c'est le fait « le fournisseur
// a livré N pièces », qui reste vrai.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = pullSamplesSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Données invalides" }, { status: 400 });
    }
    const { picks } = parsed.data;

    const lineIds = [...new Set(picks.map((p) => p.lineId))];
    const lines = await prisma.allocationLine.findMany({
      where: { id: { in: lineIds } },
      select: {
        id: true,
        clientId: true,
        productId: true,
        allocatedBySize: true,
        originalBySize: true,
        allocationSession: { select: { id: true, seasonId: true } },
      },
    });
    const lineById = new Map(lines.map((l) => [l.id, l]));

    // Reçu et échantillons déjà pris, par (réception, produit, taille) — pour plafonner.
    const recKeys = [...new Set(picks.map((p) => `${p.supplierReceptionId}__${lineById.get(p.lineId)?.productId}`))];
    const receptionIds = [...new Set(picks.map((p) => p.supplierReceptionId))];
    const productIds = [...new Set(lines.map((l) => l.productId))];
    const recLines = await prisma.receptionLine.findMany({
      where: { supplierReceptionId: { in: receptionIds }, productId: { in: productIds } },
      select: { supplierReceptionId: true, productId: true, quantitiesBySize: true },
    });
    const receivedByPair = new Map<string, Record<string, number>>();
    for (const l of recLines) {
      receivedByPair.set(`${l.supplierReceptionId}__${l.productId}`, parseSizeQuantities(l.quantitiesBySize));
    }
    const existingSamples = await prisma.shipmentSample.findMany({
      where: { supplierReceptionId: { in: receptionIds }, productId: { in: productIds } },
      select: { supplierReceptionId: true, productId: true, size: true, quantity: true },
    });
    const sampleByCell = new Map<string, number>();
    for (const s of existingSamples) {
      sampleByCell.set(`${s.supplierReceptionId}__${s.productId}__${s.size}`, s.quantity);
    }

    // Seuils de livraison (recalcul du statut après réduction de l'allocation).
    const thresholds = new Map<string, number>();
    const cs = await prisma.clientSeason.findMany({
      where: {
        clientId: { in: [...new Set(lines.map((l) => l.clientId).filter(Boolean))] as string[] },
        seasonId: { in: [...new Set(lines.map((l) => l.allocationSession.seasonId))] },
      },
      select: { clientId: true, seasonId: true, minDeliveryThreshold: true },
    });
    for (const c of cs) thresholds.set(`${c.clientId}__${c.seasonId}`, c.minDeliveryThreshold);

    // Validation ATOMIQUE : on refuse tout si un seul pick est invalide (pas de mouvement
    // à moitié fait). On agrège les quantités à ajouter en échantillon par cellule.
    const addSampleByCell = new Map<string, number>(); // recId__prod__size → +N
    const decAllocByLineSize = new Map<string, number>(); // lineId__size → −N
    for (const p of picks) {
      const line = lineById.get(p.lineId);
      if (!line) return NextResponse.json({ error: "Ligne de répartition introuvable." }, { status: 400 });
      const alloc = parseSizeQuantities(line.allocatedBySize)[p.size] || 0;
      const alreadyDec = decAllocByLineSize.get(`${p.lineId}__${p.size}`) || 0;
      if (p.quantity > alloc - alreadyDec) {
        return NextResponse.json(
          { error: `Impossible de reprendre ${p.quantity} en ${p.size} : la boutique n'en a que ${alloc}.` },
          { status: 400 }
        );
      }
      const cell = `${p.supplierReceptionId}__${line.productId}__${p.size}`;
      const received = receivedByPair.get(`${p.supplierReceptionId}__${line.productId}`)?.[p.size] || 0;
      const already = (sampleByCell.get(cell) || 0) + (addSampleByCell.get(cell) || 0);
      if (already + p.quantity > received) {
        return NextResponse.json(
          {
            error: `Échantillon impossible en ${p.size} : ${already + p.quantity} demandé(s) pour ${received} reçue(s) sur cette réception.`,
          },
          { status: 400 }
        );
      }
      addSampleByCell.set(cell, (addSampleByCell.get(cell) || 0) + p.quantity);
      decAllocByLineSize.set(`${p.lineId}__${p.size}`, alreadyDec + p.quantity);
    }

    const session = await verifySession(request.cookies.get("gestlog_session")?.value);
    const user = session
      ? await prisma.user.findUnique({ where: { id: session.uid }, select: { name: true } })
      : null;

    let pulled = 0;
    await prisma.$transaction(async (tx) => {
      // 1. Réduire l'allocation des boutiques + recalculer écart / statut.
      const byLine = new Map<string, Record<string, number>>();
      for (const [k, n] of decAllocByLineSize) {
        const [lineId, size] = k.split("__");
        const m = byLine.get(lineId) || {};
        m[size] = (m[size] || 0) + n;
        byLine.set(lineId, m);
      }
      for (const [lineId, decs] of byLine) {
        const line = lineById.get(lineId)!;
        const alloc = parseSizeQuantities(line.allocatedBySize);
        for (const [size, n] of Object.entries(decs)) {
          alloc[size] = (alloc[size] || 0) - n;
          if (alloc[size] <= 0) delete alloc[size];
        }
        const original = parseSizeQuantities(line.originalBySize);
        const reduced: Record<string, number> = {};
        for (const [size, req] of Object.entries(original)) {
          const gap = req - (alloc[size] || 0);
          if (gap > 0) reduced[size] = gap;
        }
        const total = Object.values(alloc).reduce((s, x) => s + x, 0);
        const min = thresholds.get(`${line.clientId}__${line.allocationSession.seasonId}`) ?? 0;
        await tx.allocationLine.update({
          where: { id: lineId },
          data: {
            allocatedBySize: stringifySizeQuantities(alloc),
            reducedBySize: stringifySizeQuantities(reduced),
            reductionReason: Object.keys(reduced).length > 0 ? "ALLOCATION" : "NONE",
            status: total === 0 ? "ANNULE" : total < min ? "EN_ATTENTE" : "LIVRABLE",
          },
        });
      }

      // 2. Créer / incrémenter les échantillons (→ liste globale + retiré du disponible).
      for (const [cell, add] of addSampleByCell) {
        const [supplierReceptionId, productId, size] = cell.split("__");
        const prev = sampleByCell.get(cell) || 0;
        await tx.shipmentSample.upsert({
          where: { supplierReceptionId_productId_size: { supplierReceptionId, productId, size } },
          update: { quantity: prev + add, createdBy: user?.name ?? null },
          create: { supplierReceptionId, productId, size, quantity: prev + add, createdBy: user?.name ?? null },
        });
        pulled += add;
      }

      // 3. Trace sur les sessions touchées (un instantané validé ne se modifie pas en silence).
      const touched = [...new Set(lines.map((l) => l.allocationSession.id))];
      for (const sid of touched) {
        const s = await tx.allocationSession.findUnique({ where: { id: sid }, select: { notes: true } });
        const stamp = `Échantillons : pièces reprises aux boutiques (contrôle qualité)`;
        if (!s?.notes?.includes(stamp)) {
          await tx.allocationSession.update({
            where: { id: sid },
            data: { notes: s?.notes ? `${s.notes} · ${stamp}` : stamp },
          });
        }
      }
    });

    return NextResponse.json({ pulled });
  } catch (e) {
    return handleApiError(e, "api/samples/pull");
  }
}

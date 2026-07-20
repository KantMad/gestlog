import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { verifySession } from "@/lib/session";
import { bulkSamplesSchema } from "@/lib/validators";
import { parseSizeQuantities, stringifySizeQuantities } from "@/lib/utils";

// POST — enregistre EN UNE FOIS toutes les cellules d'une grille de prélèvements.
// Le formulaire ligne à ligne était inutilisable pour plusieurs dizaines de pièces.
// quantity 0 → suppression. Chaque item est validé contre le RÉELLEMENT REÇU.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = bulkSamplesSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Données invalides", details: parsed.error.flatten() },
        { status: 400 }
      );
    }
    const { items, removals } = parsed.data;

    // Quantités reçues des lignes concernées, en UNE requête (et non une par cellule).
    const pairs = [...new Set(items.map((i) => `${i.supplierReceptionId}__${i.productId}`))];
    const receptionIds = [...new Set(items.map((i) => i.supplierReceptionId))];
    const productIds = [...new Set(items.map((i) => i.productId))];
    const lines = await prisma.receptionLine.findMany({
      where: { supplierReceptionId: { in: receptionIds }, productId: { in: productIds } },
      select: { supplierReceptionId: true, productId: true, quantitiesBySize: true },
    });
    const receivedByPair = new Map<string, Record<string, number>>();
    for (const l of lines) {
      receivedByPair.set(`${l.supplierReceptionId}__${l.productId}`, parseSizeQuantities(l.quantitiesBySize));
    }

    const session = await verifySession(request.cookies.get("gestlog_session")?.value);
    const user = session
      ? await prisma.user.findUnique({ where: { id: session.uid }, select: { name: true } })
      : null;

    const errors: string[] = [];
    const toUpsert: typeof items = [];
    const toDelete: typeof items = [];
    for (const it of items) {
      const key = `${it.supplierReceptionId}__${it.productId}`;
      if (!pairs.includes(key)) continue;
      const received = receivedByPair.get(key)?.[it.size] || 0;
      if (it.quantity === 0) {
        toDelete.push(it);
        continue;
      }
      if (received <= 0) {
        errors.push(`Taille ${it.size} : aucune pièce reçue — prélèvement ignoré.`);
        continue;
      }
      if (it.quantity > received) {
        errors.push(
          `Taille ${it.size} : ${it.quantity} demandé(s) mais ${received} reçue(s) — prélèvement ignoré.`
        );
        continue;
      }
      toUpsert.push(it);
    }

    // Retraits sur une répartition DÉJÀ VALIDÉE, décidés par l'utilisateur (écran de
    // confirmation). On modifie `allocatedBySize` et on recalcule `reducedBySize` /
    // `status` pour que la session reste cohérente, avec une trace dans ses notes.
    const removalLines = removals?.length
      ? await prisma.allocationLine.findMany({
          where: { id: { in: [...new Set(removals.map((r) => r.lineId))] } },
          select: {
            id: true,
            clientId: true,
            allocationSessionId: true,
            originalBySize: true,
            allocatedBySize: true,
            status: true,
            allocationSession: { select: { seasonId: true } },
          },
        })
      : [];
    const removalById = new Map(removalLines.map((l) => [l.id, l]));

    // Seuil minimum de livraison par boutique : sans lui, une ligne EN_ATTENTE (sous le
    // seuil) repasserait à tort en LIVRABLE au moindre retrait.
    const thresholds = new Map<string, number>();
    if (removalLines.length > 0) {
      const cs = await prisma.clientSeason.findMany({
        where: {
          clientId: { in: [...new Set(removalLines.map((l) => l.clientId).filter(Boolean))] as string[] },
          seasonId: { in: [...new Set(removalLines.map((l) => l.allocationSession.seasonId))] },
        },
        select: { clientId: true, seasonId: true, minDeliveryThreshold: true },
      });
      for (const c of cs) thresholds.set(`${c.clientId}__${c.seasonId}`, c.minDeliveryThreshold);
    }

    let saved = 0;
    let deleted = 0;
    let pulled = 0;
    await prisma.$transaction(async (tx) => {
      for (const r of removals || []) {
        const line = removalById.get(r.lineId);
        if (!line) continue;
        const alloc = parseSizeQuantities(line.allocatedBySize);
        const take = Math.min(r.quantity, alloc[r.size] || 0);
        if (take <= 0) continue;
        alloc[r.size] = (alloc[r.size] || 0) - take;
        if (alloc[r.size] <= 0) delete alloc[r.size];
        const original = parseSizeQuantities(line.originalBySize);
        const reduced: Record<string, number> = {};
        for (const [size, req] of Object.entries(original)) {
          const gap = req - (alloc[size] || 0);
          if (gap > 0) reduced[size] = gap;
        }
        const total = Object.values(alloc).reduce((s, n) => s + n, 0);
        const min = thresholds.get(`${line.clientId}__${line.allocationSession.seasonId}`) ?? 0;
        await tx.allocationLine.update({
          where: { id: line.id },
          data: {
            allocatedBySize: stringifySizeQuantities(alloc),
            reducedBySize: stringifySizeQuantities(reduced),
            reductionReason: Object.keys(reduced).length > 0 ? "ALLOCATION" : "NONE",
            // Même règle qu'à la répartition : 0 → ANNULE, sous le seuil → EN_ATTENTE.
            status: total === 0 ? "ANNULE" : total < min ? "EN_ATTENTE" : "LIVRABLE",
          },
        });
        pulled += take;
      }
      // Trace d'audit sur la session touchée (une session validée est un instantané :
      // toute modification doit rester visible).
      const touched = [...new Set((removals || []).map((r) => removalById.get(r.lineId)?.allocationSessionId).filter(Boolean))] as string[];
      for (const sid of touched) {
        const s = await tx.allocationSession.findUnique({ where: { id: sid }, select: { notes: true } });
        const stamp = `${pulled} pièce(s) retirée(s) pour échantillons (contrôle qualité)`;
        await tx.allocationSession.update({
          where: { id: sid },
          data: { notes: s?.notes ? `${s.notes} · ${stamp}` : stamp },
        });
      }
      for (const it of toDelete) {
        const r = await tx.shipmentSample.deleteMany({
          where: {
            supplierReceptionId: it.supplierReceptionId,
            productId: it.productId,
            size: it.size,
          },
        });
        deleted += r.count;
      }
      for (const it of toUpsert) {
        await tx.shipmentSample.upsert({
          where: {
            supplierReceptionId_productId_size: {
              supplierReceptionId: it.supplierReceptionId,
              productId: it.productId,
              size: it.size,
            },
          },
          update: { quantity: it.quantity, createdBy: user?.name ?? null },
          create: {
            supplierReceptionId: it.supplierReceptionId,
            productId: it.productId,
            size: it.size,
            quantity: it.quantity,
            createdBy: user?.name ?? null,
          },
        });
        saved++;
      }
    });

    const pieces = toUpsert.reduce((s, i) => s + i.quantity, 0);
    return NextResponse.json({ saved, deleted, pieces, pulled, errors });
  } catch (e) {
    return handleApiError(e, "api/samples/bulk");
  }
}

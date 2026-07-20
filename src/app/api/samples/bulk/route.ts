import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { verifySession } from "@/lib/session";
import { bulkSamplesSchema } from "@/lib/validators";
import { parseSizeQuantities } from "@/lib/utils";

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
    const { items } = parsed.data;

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

    let saved = 0;
    let deleted = 0;
    await prisma.$transaction(async (tx) => {
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
    return NextResponse.json({ saved, deleted, pieces, errors });
  } catch (e) {
    return handleApiError(e, "api/samples/bulk");
  }
}

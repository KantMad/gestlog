import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { verifySession } from "@/lib/session";
import { createSampleSchema } from "@/lib/validators";
import { parseSizeQuantities } from "@/lib/utils";

// ─── Échantillons « shipment sample » ────────────────────────────────────────────────
// Pièces prélevées sur une réception pour le contrôle qualité du siège. Elles ne seront
// jamais livrées → elles sont RETIRÉES DU DISPONIBLE à la répartition (cf.
// /api/allocation/simulate). La réception elle-même n'est jamais modifiée.

// GET ?seasonId= — prélèvements de la saison + réceptions/produits sélectionnables.
export async function GET(request: NextRequest) {
  try {
    const seasonId = request.nextUrl.searchParams.get("seasonId");
    if (!seasonId) return NextResponse.json({ error: "seasonId requis" }, { status: 400 });

    const receptions = await prisma.supplierReception.findMany({
      where: { supplierOrder: { seasonId } },
      select: {
        id: true,
        receptionNumber: true,
        receptionDate: true,
        supplier: { select: { name: true, code: true } },
        supplierOrder: { select: { orderNumber: true } },
        lines: {
          select: {
            quantitiesBySize: true,
            product: { select: { id: true, reference: true, color: true, colorLabel: true } },
          },
        },
      },
      orderBy: { receptionDate: "desc" },
    });

    const samples = await prisma.shipmentSample.findMany({
      where: { supplierReception: { supplierOrder: { seasonId } } },
      select: {
        id: true,
        supplierReceptionId: true,
        size: true,
        quantity: true,
        notes: true,
        createdBy: true,
        createdAt: true,
        product: { select: { id: true, reference: true, color: true, colorLabel: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    // Ce qui est sélectionnable : par réception, les produits reçus et leurs tailles avec la
    // quantité REÇUE (plafond du prélèvement) — l'écran n'affiche que du réellement reçu.
    const data = receptions.map((r) => ({
      id: r.id,
      receptionNumber: r.receptionNumber,
      receptionDate: r.receptionDate,
      orderNumber: r.supplierOrder.orderNumber,
      supplierName: r.supplier.name,
      supplierCode: r.supplier.code,
      products: r.lines.map((l) => ({
        productId: l.product.id,
        reference: l.product.reference,
        color: l.product.color,
        colorLabel: l.product.colorLabel,
        received: parseSizeQuantities(l.quantitiesBySize),
      })),
    }));

    return NextResponse.json({ receptions: data, samples });
  } catch (e) {
    return handleApiError(e, "api/samples#GET");
  }
}

// POST — crée/met à jour un prélèvement (quantité 0 → suppression).
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = createSampleSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Données invalides", details: parsed.error.flatten() },
        { status: 400 }
      );
    }
    const { supplierReceptionId, productId, size, quantity, notes } = parsed.data;

    // La ligne doit exister dans CETTE réception : on ne prélève que du réellement reçu.
    const line = await prisma.receptionLine.findFirst({
      where: { supplierReceptionId, productId },
      select: { quantitiesBySize: true },
    });
    if (!line) {
      return NextResponse.json(
        { error: "Ce produit n'est pas dans cette réception." },
        { status: 400 }
      );
    }
    const received = parseSizeQuantities(line.quantitiesBySize)[size] || 0;
    if (received <= 0) {
      return NextResponse.json(
        { error: `Aucune pièce reçue en taille ${size} pour ce produit.` },
        { status: 400 }
      );
    }
    if (quantity > received) {
      return NextResponse.json(
        { error: `Impossible de prélever ${quantity} : seulement ${received} reçue(s) en ${size}.` },
        { status: 400 }
      );
    }

    if (quantity === 0) {
      await prisma.shipmentSample.deleteMany({ where: { supplierReceptionId, productId, size } });
      return NextResponse.json({ deleted: true });
    }

    const session = await verifySession(request.cookies.get("gestlog_session")?.value);
    const user = session ? await prisma.user.findUnique({ where: { id: session.uid }, select: { name: true } }) : null;

    const sample = await prisma.shipmentSample.upsert({
      where: { supplierReceptionId_productId_size: { supplierReceptionId, productId, size } },
      update: { quantity, notes: notes ?? null, createdBy: user?.name ?? null },
      create: {
        supplierReceptionId,
        productId,
        size,
        quantity,
        notes: notes ?? null,
        createdBy: user?.name ?? null,
      },
    });
    return NextResponse.json({ data: sample });
  } catch (e) {
    return handleApiError(e, "api/samples#POST");
  }
}

// DELETE ?id= — retire un prélèvement (les pièces redeviennent disponibles).
export async function DELETE(request: NextRequest) {
  try {
    const id = request.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id requis" }, { status: 400 });
    await prisma.shipmentSample.delete({ where: { id } });
    return NextResponse.json({ deleted: true });
  } catch (e) {
    return handleApiError(e, "api/samples#DELETE");
  }
}

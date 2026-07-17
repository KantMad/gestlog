import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { parseSizeQuantities, parseSizeScale, sumQuantities } from "@/lib/utils";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params;

  try {
    const session = await prisma.allocationSession.findUnique({
      where: { id: sessionId },
      include: {
        lines: {
          include: { product: true },
        },
        season: true,
      },
    });

    if (!session) {
      return NextResponse.json(
        { error: "Session non trouvée" },
        { status: 404 }
      );
    }

    const clientIds = [...new Set(session.lines.map((l) => l.clientId).filter(Boolean))];
    const clients = await prisma.client.findMany({
      where: { id: { in: clientIds as string[] } },
    });
    const clientMap = new Map(clients.map((c) => [c.id, c]));

    const enrichedLines = session.lines.map((line) => ({
      id: line.id,
      clientId: line.clientId,
      clientName: clientMap.get(line.clientId || "")?.name || line.clientId || "",
      clientCode: clientMap.get(line.clientId || "")?.code || "",
      clientOrderId: line.clientOrderId,
      productId: line.productId,
      productReference: line.product.reference,
      productColor: line.product.color,
      productColorLabel: line.product.colorLabel || "",
      sizeScale: parseSizeScale(line.product.sizeScale),
      original: parseSizeQuantities(line.originalBySize),
      allocated: parseSizeQuantities(line.allocatedBySize),
      reduced: parseSizeQuantities(line.reducedBySize),
      reductionReason: line.reductionReason,
      status: line.status,
      isManualAdjustment: line.isManualAdjustment,
    }));

    // EAN par produit et par taille (export « EAN / quantité » depuis la session validée).
    const refs = [...new Set(session.lines.map((l) => l.product.reference))];
    const eanRows = refs.length
      ? await prisma.productSizeEan.findMany({
          where: { reference: { in: refs } },
          select: { reference: true, color: true, size: true, ean: true },
        })
      : [];
    const eanByKey = new Map(eanRows.map((e) => [`${e.reference}__${e.color}__${e.size}`, e.ean]));
    const eansByProduct: Record<string, Record<string, string>> = {};
    for (const line of session.lines) {
      if (eansByProduct[line.productId]) continue;
      const m: Record<string, string> = {};
      for (const size of parseSizeScale(line.product.sizeScale)) {
        const ean = eanByKey.get(`${line.product.reference}__${line.product.color}__${size}`);
        if (ean) m[size] = ean;
      }
      eansByProduct[line.productId] = m;
    }

    // Fournisseur(s) de chaque produit — permet de filtrer l'export SANS toucher au calcul
    // (la session est un instantané figé). Un produit peut venir de plusieurs fournisseurs.
    const productIds = [...new Set(session.lines.map((l) => l.productId))];
    const solLines = productIds.length
      ? await prisma.supplierOrderLine.findMany({
          where: { productId: { in: productIds }, supplierOrder: { seasonId: session.seasonId } },
          select: { productId: true, supplierOrder: { select: { supplierId: true } } },
        })
      : [];
    const supplierIdsByProduct: Record<string, string[]> = {};
    for (const l of solLines) {
      const arr = (supplierIdsByProduct[l.productId] ||= []);
      if (!arr.includes(l.supplierOrder.supplierId)) arr.push(l.supplierOrder.supplierId);
    }
    const supplierIds = [...new Set(Object.values(supplierIdsByProduct).flat())];
    const suppliers = supplierIds.length
      ? await prisma.supplier.findMany({
          where: { id: { in: supplierIds } },
          select: { id: true, code: true, name: true },
          orderBy: { name: "asc" },
        })
      : [];

    return NextResponse.json({
      eansByProduct,
      supplierIdsByProduct,
      suppliers,
      session: {
        id: session.id,
        seasonId: session.seasonId,
        seasonName: session.season.name,
        status: session.status,
        notes: session.notes,
        sessionDate: session.sessionDate,
        createdAt: session.createdAt,
      },
      lines: enrichedLines,
    });
  } catch (e) {
    return handleApiError(e, "api/allocation/sessions/[sessionId]");
  }
}

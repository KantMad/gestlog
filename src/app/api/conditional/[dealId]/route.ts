import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import {
  computeBalance, summarize, invoiceAmount,
  type ConditionalStoredLine, type ConditionalMovementType,
} from "@/lib/conditional";

// GET — Détail d'une opération : mouvements, solde par produit/taille, anomalies,
// et montant à facturer (ventes déclarées × prix de gros du référentiel).
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ dealId: string }> }
) {
  try {
    const { dealId } = await params;
    const deal = await prisma.conditionalDeal.findUnique({
      where: { id: dealId },
      include: {
        client: { select: { id: true, code: true, name: true } },
        movements: {
          orderBy: { createdAt: "asc" },
          include: {
            lines: {
              include: {
                product: { select: { id: true, label: true, colorLabel: true, costPrice: true } },
              },
            },
          },
        },
      },
    });
    if (!deal) return NextResponse.json({ error: "Opération introuvable" }, { status: 404 });

    const stored: ConditionalStoredLine[] = [];
    const costByProduct: Record<string, number | null> = {};
    const labelByKey: Record<string, { label: string | null; colorLabel: string | null }> = {};
    for (const m of deal.movements) {
      for (const l of m.lines) {
        stored.push({
          type: m.type as ConditionalMovementType,
          productId: l.productId,
          ean: l.ean,
          reference: l.reference,
          color: l.color,
          size: l.size,
          quantity: l.quantity,
        });
        if (l.productId) costByProduct[l.productId] = l.product?.costPrice ?? null;
        if (l.product) {
          labelByKey[`${l.reference}__${l.color}`] = {
            label: l.product.label,
            colorLabel: l.product.colorLabel,
          };
        }
      }
    }

    const balance = computeBalance(stored);
    const summary = summarize(balance);
    const invoice = invoiceAmount(balance, costByProduct);

    return NextResponse.json({
      deal: {
        id: deal.id, label: deal.label, status: deal.status, notes: deal.notes,
        client: deal.client, createdAt: deal.createdAt,
      },
      movements: deal.movements.map((m) => ({
        id: m.id, type: m.type, fileName: m.fileName, importedBy: m.importedBy,
        movementDate: m.movementDate, createdAt: m.createdAt,
        lines: m.lines.length,
        pieces: m.lines.reduce((s, l) => s + l.quantity, 0),
      })),
      balance: balance.map((r) => ({
        ...r,
        label: labelByKey[`${r.reference}__${r.color}`]?.label ?? null,
        colorLabel: labelByKey[`${r.reference}__${r.color}`]?.colorLabel ?? null,
        costPrice: r.productId ? costByProduct[r.productId] ?? null : null,
      })),
      summary,
      invoice,
    });
  } catch (e) {
    return handleApiError(e, "api/conditional/[dealId]");
  }
}

// PATCH — Clôturer / rouvrir une opération, ou modifier ses notes.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ dealId: string }> }
) {
  try {
    const { dealId } = await params;
    const body = await request.json();
    const data: { status?: string; notes?: string | null } = {};
    if (body?.status === "CLOTUREE" || body?.status === "EN_COURS") data.status = body.status;
    if (body?.notes !== undefined) data.notes = body.notes ? String(body.notes) : null;
    const deal = await prisma.conditionalDeal.update({ where: { id: dealId }, data });
    return NextResponse.json({ data: deal });
  } catch (e) {
    return handleApiError(e, "api/conditional/[dealId]");
  }
}

// DELETE — Supprime l'opération et tout son historique (cascade).
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ dealId: string }> }
) {
  try {
    const { dealId } = await params;
    await prisma.conditionalDeal.delete({ where: { id: dealId } });
    return NextResponse.json({ success: true });
  } catch (e) {
    return handleApiError(e, "api/conditional/[dealId]");
  }
}

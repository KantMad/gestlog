import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";

// GET — Liste des opérations conditionnelles, avec un aperçu de leur solde.
export async function GET() {
  try {
    const deals = await prisma.conditionalDeal.findMany({
      orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
      include: {
        client: { select: { code: true, name: true } },
        movements: { select: { type: true, lines: { select: { quantity: true } } } },
      },
    });

    const data = deals.map((d) => {
      let delivered = 0, sold = 0, returned = 0;
      for (const m of d.movements) {
        const q = m.lines.reduce((s, l) => s + l.quantity, 0);
        if (m.type === "LIVRAISON") delivered += q;
        else if (m.type === "VENTE") sold += q;
        else returned += q;
      }
      return {
        id: d.id,
        label: d.label,
        status: d.status,
        clientCode: d.client.code,
        clientName: d.client.name,
        movements: d.movements.length,
        delivered, sold, returned,
        remaining: delivered - sold - returned,
        updatedAt: d.updatedAt,
      };
    });
    return NextResponse.json({ data });
  } catch (e) {
    return handleApiError(e, "api/conditional");
  }
}

// POST — Crée une opération : { clientId, label, notes? }
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const clientId = String(body?.clientId || "").trim();
    const label = String(body?.label || "").trim();
    if (!clientId || !label) {
      return NextResponse.json({ error: "Client et libellé requis" }, { status: 400 });
    }
    const existing = await prisma.conditionalDeal.findFirst({ where: { clientId, label } });
    if (existing) {
      return NextResponse.json(
        { error: "Une opération porte déjà ce libellé pour ce client." },
        { status: 409 }
      );
    }
    const deal = await prisma.conditionalDeal.create({
      data: { clientId, label, notes: body?.notes ? String(body.notes) : null },
    });
    return NextResponse.json({ data: deal });
  } catch (e) {
    return handleApiError(e, "api/conditional");
  }
}

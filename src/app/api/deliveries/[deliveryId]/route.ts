import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { updateDeliveryDetailsSchema } from "@/lib/validators";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ deliveryId: string }> }
) {
  const { deliveryId } = await params;

  try {
    const delivery = await prisma.delivery.findUnique({
      where: { id: deliveryId },
      include: {
        client: true,
        lines: { include: { product: true } },
        shipmentGroup: true,
        _count: { select: { eanExports: true } },
      },
    });

    if (!delivery) {
      return NextResponse.json({ error: "Livraison introuvable" }, { status: 404 });
    }

    return NextResponse.json({ data: delivery });
  } catch (e) {
    return handleApiError(e, "api/deliveries/[deliveryId]");
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ deliveryId: string }> }
) {
  const { deliveryId } = await params;

  try {
    const body = await request.json();
    const parsed = updateDeliveryDetailsSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const updateData: Record<string, unknown> = {};
    const d = parsed.data;

    if (d.status !== undefined) {
      updateData.status = d.status;
      if (d.status === "EXPEDIEE") updateData.shippedAt = new Date();
      if (d.status === "ENVOYEE_DEPOT") updateData.sentToDepotAt = new Date();
      if (d.status === "VALIDEE_DEPOT") updateData.validatedAt = new Date();
    }
    if (d.nbColis !== undefined) updateData.nbColis = d.nbColis;
    if (d.nbPieces !== undefined) updateData.nbPieces = d.nbPieces;
    if (d.blNumber !== undefined) updateData.blNumber = d.blNumber;
    if (d.carrier !== undefined) updateData.carrier = d.carrier;
    if (d.depotStatus !== undefined) updateData.depotStatus = d.depotStatus;
    if (d.comment !== undefined) updateData.comment = d.comment;
    if (d.shipmentGroupId !== undefined) updateData.shipmentGroupId = d.shipmentGroupId;

    const delivery = await prisma.delivery.update({
      where: { id: deliveryId },
      data: updateData,
    });

    return NextResponse.json({ data: delivery });
  } catch (e) {
    return handleApiError(e, "api/deliveries/[deliveryId]");
  }
}

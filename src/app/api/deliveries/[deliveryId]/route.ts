import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { updateDeliveryStatusSchema } from "@/lib/validators";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ deliveryId: string }> }
) {
  const { deliveryId } = await params;

  try {
    const body = await request.json();
    const parsed = updateDeliveryStatusSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const data: Record<string, unknown> = { status: parsed.data.status };
    if (parsed.data.status === "EXPEDIEE") {
      data.shippedAt = new Date();
    }

    const delivery = await prisma.delivery.update({
      where: { id: deliveryId },
      data,
    });

    return NextResponse.json({ data: delivery });
  } catch (e) {
    return NextResponse.json(
      { error: `Erreur: ${String(e)}` },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { createShipmentGroupSchema } from "@/lib/validators";

// GET — list all shipment groups
export async function GET() {
  try {
    const groups = await prisma.shipmentGroup.findMany({
      include: {
        deliveries: {
          include: { client: true },
          orderBy: { deliveryNumber: "asc" },
        },
        _count: { select: { deliveries: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ data: groups });
  } catch (e) {
    return handleApiError(e, "api/shipment-groups");
  }
}

// POST — create a new shipment group and optionally attach deliveries
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = createShipmentGroupSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const group = await prisma.shipmentGroup.create({
      data: {
        name: parsed.data.name,
        carrier: parsed.data.carrier || null,
      },
    });

    // Attach deliveries if provided
    if (parsed.data.deliveryIds && parsed.data.deliveryIds.length > 0) {
      await prisma.delivery.updateMany({
        where: { id: { in: parsed.data.deliveryIds } },
        data: { shipmentGroupId: group.id },
      });
    }

    return NextResponse.json({ data: group });
  } catch (e) {
    return handleApiError(e, "api/shipment-groups");
  }
}

import { NextRequest, NextResponse } from "next/server";
import { generateDeliveries } from "@/lib/delivery/generator";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { allocationSessionId } = body;

    if (!allocationSessionId) {
      return NextResponse.json(
        { error: "allocationSessionId requis" },
        { status: 400 }
      );
    }

    const result = await generateDeliveries({ allocationSessionId });

    return NextResponse.json({
      success: true,
      deliveryCount: result.count,
      deliveryIds: result.deliveryIds,
    });
  } catch (e) {
    return NextResponse.json(
      { error: `Erreur génération: ${String(e)}` },
      { status: 500 }
    );
  }
}

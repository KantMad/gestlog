import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/lib/api";
import { generateEanExport } from "@/lib/delivery/ean-export";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ deliveryId: string }> }
) {
  const { deliveryId } = await params;

  try {
    const result = await generateEanExport(deliveryId);

    return new NextResponse(result.csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${result.fileName}"`,
      },
    });
  } catch (e) {
    return handleApiError(e, "api/deliveries/[deliveryId]/ean");
  }
}

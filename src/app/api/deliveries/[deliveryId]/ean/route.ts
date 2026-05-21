import { NextRequest, NextResponse } from "next/server";
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
    return NextResponse.json(
      { error: `Erreur export EAN: ${String(e)}` },
      { status: 500 }
    );
  }
}

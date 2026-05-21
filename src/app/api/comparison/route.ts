import { NextRequest, NextResponse } from "next/server";
import { computeComparison } from "@/lib/comparison/engine";

export async function GET(request: NextRequest) {
  const seasonId = request.nextUrl.searchParams.get("seasonId");
  const supplierId = request.nextUrl.searchParams.get("supplierId");

  if (!seasonId) {
    return NextResponse.json({ error: "seasonId requis" }, { status: 400 });
  }

  try {
    const data = await computeComparison(
      seasonId,
      supplierId || undefined
    );
    return NextResponse.json({ data });
  } catch (e) {
    return NextResponse.json(
      { error: `Erreur de comparaison: ${String(e)}` },
      { status: 500 }
    );
  }
}
